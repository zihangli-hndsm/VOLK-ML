// JSON-safe Visualization Script for the KNN intro: neighbor order, neighbor
// reveal, k growth, decision regions and a boundary sweep.
export const knnIntro = {
  version: 1,
  id: 'knn.intro',
  model: { adapter: 'knn' },
  data: { source: 'workspace-or-default' },
  controls: ['xFeature', 'yFeature', 'k', 'queryX', 'queryY', 'showNeighborOrder', 'showDecisionRegions', 'normalize'],
  layout: {
    stage: ['decision-region', 'scatter', 'neighbor-links', 'query-point'],
    side: ['vote-bars', 'formula', 'metric-card', 'annotation'],
  },
  primitives: [
    { id: 'decision-region', type: 'decision-region' },
    { id: 'scatter', type: 'scatter' },
    { id: 'query-point', type: 'query-point' },
    { id: 'neighbor-links', type: 'neighbor-links' },
    { id: 'vote-bars', type: 'vote-bars' },
    { id: 'formula', type: 'formula' },
    { id: 'metric-card', type: 'metric-card' },
    { id: 'annotation', type: 'annotation' },
  ],
  steps: [
    { id: 'order', setControl: { showNeighborOrder: true }, narrationKey: 'playground.knn.scenario.introOrder', durationMs: 500 },
    { id: 'k1', setControl: { k: 1 }, narrationKey: 'playground.knn.scenario.introK1', durationMs: 500 },
    { id: 'revealStart', invoke: { operation: 'tracePredict', args: {} }, narrationKey: 'playground.knn.scenario.introReveal', durationMs: 400 },
    { id: 'n1', reveal: true, narrationKey: 'playground.knn.scenario.introNeighbor1', durationMs: 700 },
    { id: 'k5', setControl: { k: 5 }, narrationKey: 'playground.knn.scenario.introK5', durationMs: 600 },
    { id: 'regions', setControl: { showDecisionRegions: true }, narrationKey: 'playground.knn.scenario.introRegions', durationMs: 600 },
    { id: 'n2', reveal: true, narrationKey: 'playground.knn.scenario.introNeighbor2', durationMs: 600 },
    { id: 'n3', reveal: true, narrationKey: 'playground.knn.scenario.introNeighbor3', durationMs: 600 },
    { id: 'n4', reveal: true, narrationKey: 'playground.knn.scenario.introNeighbor4', durationMs: 600 },
    { id: 'vote', reveal: true, narrationKey: 'playground.knn.scenario.introVote', durationMs: 700 },
    { id: 'boundary', invoke: { operation: 'moveQuery', args: { x: null } }, narrationKey: 'playground.knn.scenario.introBoundary', durationMs: 800 },
  ],
};
