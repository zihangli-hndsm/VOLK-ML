// Bounded local retrieval/RAG fixtures. Documents stay inside the deterministic
// runtime; no network corpus or remote inference is needed for this slice.

const documents = [
  { id: 'doc-linear', title: 'Linear models', text: 'A linear model searches for a straight relationship between inputs and targets.' },
  { id: 'doc-neighbors', title: 'Local neighbors', text: 'A nearest neighbor model predicts from nearby examples and their labels.' },
  { id: 'doc-shift', title: 'Distribution shift', text: 'A test distribution can differ from the conditions represented in training data.' },
  { id: 'doc-evidence', title: 'Grounded evidence', text: 'A grounded answer should point back to the sources that support it.' },
];

export function createRetrievalSource() {
  return {
    kind: 'example',
    domain: 'retrieval',
    task: 'retrieval',
    name: 'Deterministic document retrieval',
    fingerprint: 'retrieval:intro-v1',
    query: 'nearby examples and training data',
    documents: documents.map((document) => ({ ...document })),
    samples: [{
      id: 'retrieval-query-1',
      membership: 'train',
      payload: { kind: 'retrieval', query: 'nearby examples and training data', documentIds: ['doc-neighbors', 'doc-shift'] },
    }],
  };
}

export function createRagSource() {
  return {
    kind: 'example',
    domain: 'rag',
    task: 'grounded-generation',
    name: 'Deterministic grounded retrieval',
    fingerprint: 'rag:intro-v1',
    query: 'what supports a grounded answer',
    documents: documents.map((document) => ({ ...document })),
    samples: [{
      id: 'rag-query-1',
      membership: 'train',
      payload: { kind: 'rag', query: 'what supports a grounded answer', sourceIds: ['doc-evidence'] },
    }],
  };
}
