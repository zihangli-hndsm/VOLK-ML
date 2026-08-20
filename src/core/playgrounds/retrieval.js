import { playgroundError } from './session.js';
import { validateDocumentSource } from '../playground/model/retrievalAdapter.js';
import { normalizeDomainObservationPayload } from '../exploration/domainContract.js';

function validateSource(source, domain, task, payloadKind) {
  if (!source || typeof source !== 'object' || source.domain !== domain || source.task !== task || !Array.isArray(source.documents) || !source.documents.length || typeof source.query !== 'string' || !Array.isArray(source.samples) || !source.samples.length) {
    throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: `${domain}-source-required` });
  }
  if (source.samples.some((sample) => sample?.payload?.kind !== payloadKind)) throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'query-payload-required' });
  const samples = source.samples.map((sample, index) => ({
    ...sample,
    payload: normalizeDomainObservationPayload(domain, sample.payload, `samples[${index}].payload`),
  }));
  return validateDocumentSource({ ...source, samples }, domain, task);
}

function descriptor({ id, domain, adapterId, task, titleKey, descriptionKey, supportedOps, payloadKind }) {
  return {
    id,
    domain,
    version: 1,
    adapterId,
    titleKey,
    descriptionKey,
    supportedOps,
    supportedTasks: [task],
    sourceKinds: ['example', `${domain}-dataset`],
    controls: [
      { key: 'topK', type: 'number', min: 1, max: 8, step: 1, runObjective: 'retrieve', domain: 'model', presentation: { importance: 'primary', roles: ['experiment', 'inspection'], quickControl: true } },
      { key: 'showScores', type: 'boolean', domain: 'view', presentation: { importance: 'secondary', roles: ['inspection'] } },
    ],
    actions: ['SET_CONTROL', 'RESET'],
    scenarios: [],
    validateSource(source) { return validateSource(source, domain, task, payloadKind); },
  };
}

export const retrievalPlayground = descriptor({
  id: 'retrieval-ranking',
  domain: 'retrieval',
  adapterId: 'retrieval-ranking',
  task: 'retrieval',
  titleKey: 'playground.retrieval.title',
  descriptionKey: 'playground.retrieval.description',
  supportedOps: ['retrieval_ranking'],
  payloadKind: 'retrieval',
});

export const ragPlayground = descriptor({
  id: 'rag-grounding',
  domain: 'rag',
  adapterId: 'rag-grounding',
  task: 'grounded-generation',
  titleKey: 'playground.rag.title',
  descriptionKey: 'playground.rag.description',
  supportedOps: ['rag_grounding'],
  payloadKind: 'rag',
});
