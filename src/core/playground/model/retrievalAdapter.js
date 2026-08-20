import { playgroundError } from '../../playgrounds/session.js';
import {
  cosineSimilarity,
  embedDocuments,
  embedText,
  EMBEDDING_DIMENSION_OPTIONS,
  DEFAULT_EMBEDDING_DIMENSION,
  projectEmbedding2d,
} from '../domain/embedding.js';

const MAX_DOCUMENTS = 128;
const MAX_SENTENCE_LENGTH = 320;

function rankDocuments(query, documents, topK, dimensions) {
  const queryVector = embedText(query, dimensions);
  const documentVectors = embedDocuments(documents, dimensions);
  return {
    queryVector,
    documentVectors,
    rankedResults: documents
      .map((document, index) => ({
        ...document,
        score: cosineSimilarity(queryVector, documentVectors[index].vector),
        embedding: documentVectors[index].vector,
      }))
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, topK)
      .map((document, index) => ({
        id: document.id,
        rank: index + 1,
        title: document.title,
        score: Number(document.score.toFixed(6)),
        embedding: [...document.embedding],
        projection: projectEmbedding2d(document.embedding),
      })),
  };
}

function groundedSentence(query, document) {
  if (!document) return null;
  const queryTerms = new Set(String(query).toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/i).filter(Boolean));
  const sentences = document.text.split(/[.!?。！？]+/).map((sentence) => sentence.trim()).filter(Boolean);
  const ranked = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      overlap: [...new Set(sentence.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/i).filter(Boolean))]
        .filter((term) => queryTerms.has(term)).length,
    }))
    .sort((left, right) => right.overlap - left.overlap || left.index - right.index);
  return (ranked[0]?.sentence ?? sentences[0] ?? '').slice(0, MAX_SENTENCE_LENGTH) || null;
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

function deriveState({ source, controls, previousTraining, metricKey }) {
  const dimensions = Number(controls.embeddingDimensions ?? DEFAULT_EMBEDDING_DIMENSION);
  const ranked = rankDocuments(source.query, source.documents, controls.topK, dimensions);
  const expectedIds = new Set(source.samples[0].payload.documentIds ?? source.samples[0].payload.sourceIds ?? []);
  const metric = metricKey === 'groundedSourceCount'
    ? ranked.rankedResults.filter((item) => expectedIds.has(item.id)).length
    : ranked.rankedResults.length && expectedIds.has(ranked.rankedResults[0].id) ? 1 : 0;
  const topDocument = source.documents.find((document) => document.id === ranked.rankedResults[0]?.id);
  const groundedAnswer = metricKey === 'groundedSourceCount'
    ? {
      text: groundedSentence(source.query, topDocument),
      sourceIds: ranked.rankedResults.filter((item) => expectedIds.has(item.id)).map((item) => item.id).slice(0, 4),
      query: source.query,
    }
    : null;
  return {
    query: source.query,
    documents: source.documents,
    queryEmbedding: ranked.queryVector,
    documentEmbeddings: ranked.documentVectors,
    rankedResults: ranked.rankedResults,
    metric,
    expectedIds: [...expectedIds],
    groundedAnswer,
    controls,
    training: previousTraining ?? { currentStep: 0, totalSteps: 0, history: [] },
  };
}

function createAdapter({ id, domain, task, payloadKind, preset, metricKey, metricLabel, resultField }) {
  const isRag = metricKey === 'groundedSourceCount';
  return {
    id,
    domain,
    capabilities: {
      fit: true,
      predict: true,
      evaluate: true,
      traceFit: false,
      tracePredict: false,
      retrieval: true,
      embedding: true,
      ...(isRag ? { groundedAnswer: true } : {}),
    },
    trainingMicroscopeCapabilities: { lossTrace: false, parameters: [], gradients: [], updates: false, preprocessing: ['deterministic-hashing-embedding'] },
    defaultVisualizationPreset: preset,
    semanticSchema: {
      rankedResults: { type: 'array<rankedResult>', description: 'Bounded ranked document results with deterministic cosine scores' },
      embedding: { type: 'vectorState', description: 'Bounded local hashing embedding; not an external model claim' },
      ...(isRag ? { groundedAnswer: { type: 'groundedAnswer', description: 'Extractive answer sentence with source IDs' } } : {}),
      metrics: { type: 'metrics', description: metricLabel },
    },
    scriptOperations: {},
    scriptOperationActions: {},
    initialize({ source, controls, recorder }) {
      const merged = { topK: 3, embeddingDimensions: String(DEFAULT_EMBEDDING_DIMENSION), showScores: true, ...controls };
      const modelState = deriveState({ source, controls: merged, metricKey });
      recorder.emit('data.loaded', { samples: source.documents.length, domain, embeddingDimensions: merged.embeddingDimensions });
      recorder.emit('split.created', { trainRows: source.samples.length, testRows: 0, kind: 'explicit-query' });
      recorder.emit('evaluation.completed', { [metricKey]: modelState.metric });
      return { controls: merged, modelState, totalSteps: 0 };
    },
    validateWorld(world) { return validateWorld(world, domain, task, payloadKind); },
    applyModelAction(modelState, action, { controls }) {
      if (action.type !== 'SET_CONTROL') return {};
      if (action.key === 'topK') {
        const value = Number(action.value);
        if (!Number.isInteger(value) || value < 1 || value > 8) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
        const nextControls = { ...controls, topK: value };
        const source = { domain, task, query: modelState.query, documents: modelState.documents, samples: [{ payload: { kind: payloadKind, ...(isRag ? { sourceIds: modelState.expectedIds } : { documentIds: modelState.expectedIds }) } }] };
        const next = deriveState({ source, controls: nextControls, previousTraining: modelState.training, metricKey });
        return { controls: { topK: value }, modelState: { ...modelState, ...next } };
      }
      if (action.key === 'embeddingDimensions') {
        const value = Number(action.value);
        if (!EMBEDDING_DIMENSION_OPTIONS.includes(value)) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
        const nextControls = { ...controls, embeddingDimensions: String(value) };
        const source = { domain, task, query: modelState.query, documents: modelState.documents, samples: [{ payload: { kind: payloadKind, ...(isRag ? { sourceIds: modelState.expectedIds } : { documentIds: modelState.expectedIds }) } }] };
        const next = deriveState({ source, controls: nextControls, previousTraining: modelState.training, metricKey });
        return { controls: { embeddingDimensions: String(value) }, modelState: { ...modelState, ...next } };
      }
      if (action.key === 'showScores') return { controls: { showScores: Boolean(action.value) } };
      throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
    },
    deriveScene(modelState) {
      return {
        scene: {
          rankedResults: modelState.rankedResults.map((item) => ({ ...item, embedding: undefined, ...(modelState.controls.showScores ? {} : { score: undefined }) })),
          queryEmbedding: modelState.queryEmbedding,
          embeddingProjection: projectEmbedding2d(modelState.queryEmbedding),
          ...(isRag ? { groundedAnswer: modelState.groundedAnswer } : {}),
        },
        metrics: {
          [metricKey]: modelState.metric,
          [resultField]: modelState.metric,
          embeddingDimensions: modelState.controls.embeddingDimensions,
        },
        observation: null,
        formula: null,
        capabilities: {
          canPlay: false,
          canPause: false,
          canStep: false,
          canSeek: false,
          canReset: true,
          canEditData: false,
          canInspectRepresentation: true,
        },
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
  metricLabel: 'Deterministic cosine retrieval relevance',
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
