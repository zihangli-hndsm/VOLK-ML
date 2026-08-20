import { playgroundError } from '../../playgrounds/session.js';

const tokens = (value) => String(value ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const MAX_DOCUMENTS = 128;

function scoreDocument(query, document) {
  const queryTokens = new Set(tokens(query));
  const documentTokens = new Set(tokens(`${document.title} ${document.text}`));
  if (!queryTokens.size) return 0;
  return [...queryTokens].filter((token) => documentTokens.has(token)).length / queryTokens.size;
}

function rankDocuments(query, documents, topK) {
  return documents
    .map((document) => ({ ...document, score: scoreDocument(query, document) }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, topK)
    .map((document, index) => ({ id: document.id, rank: index + 1, title: document.title, score: document.score }));
}

export function validateDocumentSource(source, domain, task) {
  if (!source || typeof source !== 'object' || source.domain !== domain || source.task !== task) {
    throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: `${domain}-source-required` });
  }
  if (!Array.isArray(source.documents) || source.documents.length > MAX_DOCUMENTS || !Array.isArray(source.samples) || source.samples.length > 4) {
    throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'retrieval-resource-limit', maxDocuments: MAX_DOCUMENTS, maxQueries: 4 });
  }
  const documents = source.documents
    .filter((document) => document && typeof document.id === 'string' && document.id && typeof document.title === 'string' && typeof document.text === 'string').map((document) => ({
      id: document.id.slice(0, 128),
      title: document.title.slice(0, 160),
      text: document.text.slice(0, 1024),
    }));
  const query = typeof source.query === 'string' ? source.query.slice(0, 512) : '';
  if (!documents.length || !query || !Array.isArray(source.samples) || !source.samples.length) {
    throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'bounded-query-document-source-required' });
  }
  if (new Set(documents.map((document) => document.id)).size !== documents.length) {
    throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'duplicate-document-id' });
  }
  return { ...source, documents, query, samples: source.samples.map((sample) => ({ ...sample })) };
}

function validateWorld(world, domain, task, payloadKind) {
  if (world?.domain !== domain || world.task !== task) {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { reason: `${domain} adapter requires a compatible World`, reasonCode: 'world-task-incompatible' });
  }
  if (!world.observations.some((observation) => observation.payload?.kind === payloadKind)) {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { reason: `${domain} adapter requires a query World`, reasonCode: 'invalid-world' });
  }
  return world;
}

function createAdapter({ id, domain, task, payloadKind, preset, metricKey, metricLabel, resultField }) {
  return {
    id,
    domain,
    capabilities: { fit: true, predict: true, evaluate: true, traceFit: false, tracePredict: false, retrieval: true },
    trainingMicroscopeCapabilities: { lossTrace: false, parameters: [], gradients: [], updates: false, preprocessing: ['token-normalization'] },
    defaultVisualizationPreset: preset,
    semanticSchema: {
      rankedResults: { type: 'array<rankedResult>', description: 'Bounded ranked document results' },
      metrics: { type: 'metrics', description: metricLabel },
    },
    scriptOperations: {},
    scriptOperationActions: {},
    initialize({ source, controls, recorder }) {
      const merged = { topK: 3, showScores: true, ...controls };
      const rankedResults = rankDocuments(source.query, source.documents, merged.topK);
      const expectedIds = new Set(source.samples[0].payload.documentIds ?? source.samples[0].payload.sourceIds ?? []);
      const metric = metricKey === 'groundedSourceCount'
        ? rankedResults.filter((item) => expectedIds.has(item.id)).length
        : rankedResults.length && expectedIds.has(rankedResults[0].id) ? 1 : 0;
      const modelState = { query: source.query, documents: source.documents, rankedResults, metric, controls: merged, training: { currentStep: 0, totalSteps: 0, history: [] } };
      recorder.emit('data.loaded', { samples: source.documents.length, domain });
      recorder.emit('split.created', { trainRows: source.samples.length, testRows: 0, kind: 'explicit-query' });
      recorder.emit('evaluation.completed', { [metricKey]: metric });
      return { controls: merged, modelState, totalSteps: 0 };
    },
    validateWorld(world) { return validateWorld(world, domain, task, payloadKind); },
    applyModelAction(modelState, action, { controls, recorder }) {
      if (action.type !== 'SET_CONTROL') return {};
      if (action.key === 'topK') {
        const value = Number(action.value);
        if (!Number.isInteger(value) || value < 1 || value > 8) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
        const rankedResults = rankDocuments(modelState.query, modelState.documents, value);
        return { controls: { topK: value }, modelState: { ...modelState, rankedResults } };
      }
      if (action.key === 'showScores') return { controls: { showScores: Boolean(action.value) } };
      throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
    },
    deriveScene(modelState) {
      return {
        scene: { rankedResults: modelState.rankedResults.map((item) => ({ ...item, ...(modelState.controls.showScores ? {} : { score: undefined }) })) },
        metrics: { [metricKey]: modelState.metric, [resultField]: modelState.metric },
        observation: null,
        formula: null,
        capabilities: { canPlay: false, canPause: false, canStep: false, canSeek: false, canReset: true, canEditData: false },
      };
    },
  };
}

export const retrievalAdapter = createAdapter({
  id: 'retrieval-ranking',
  domain: 'retrieval',
  task: 'retrieval',
  payloadKind: 'retrieval',
  preset: 'retrieval.intro',
  metricKey: 'retrievalScore',
  metricLabel: 'Deterministic retrieval relevance',
  resultField: 'retrievalScore',
});

export const ragAdapter = createAdapter({
  id: 'rag-grounding',
  domain: 'rag',
  task: 'grounded-generation',
  payloadKind: 'rag',
  preset: 'rag.intro',
  metricKey: 'groundedSourceCount',
  metricLabel: 'Grounded source support',
  resultField: 'groundedSourceCount',
});
