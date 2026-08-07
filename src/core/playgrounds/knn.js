import { playgroundError } from './session.js';

const MAX_K = 20;
const finiteOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

// Metadata descriptor. All session/model behavior lives in the unified
// playground runtime and the KNN model adapter.
export const knnPlayground = {
  id: 'knn-classification',
  version: 1,
  adapterId: 'knn',
  titleKey: 'playground.knn.title',
  descriptionKey: 'playground.knn.description',
  supportedOps: ['knn_classifier'],
  supportedTasks: ['classification'],
  sourceKinds: ['example', 'workspace-dataset'],

  controls: [
    { key: 'xFeature', type: 'select' },
    { key: 'yFeature', type: 'select' },
    { key: 'k', type: 'number', min: 1, max: MAX_K, step: 1 },
    { key: 'queryX', type: 'number' },
    { key: 'queryY', type: 'number' },
    { key: 'showNeighborOrder', type: 'boolean' },
    { key: 'showDecisionRegions', type: 'boolean' },
    { key: 'normalize', type: 'boolean' },
    { key: 'distanceMetric', type: 'select', options: ['euclidean'] },
  ],

  actions: [
    'SET_CONTROL',
    'SET_QUERY_POINT',
    'MOVE_QUERY_POINT',
    'ADD_TRAINING_POINT',
    'MOVE_TRAINING_POINT',
    'REMOVE_TRAINING_POINT',
    'STEP_NEIGHBOR_REVEAL',
    'START_NEIGHBOR_REVEAL',
    'STEP',
    'SEEK',
    'RESET',
    'RUN_SCENARIO',
  ],

  scenarios: [
    {
      id: 'intro',
      titleKey: 'playground.scenario.intro',
      steps: [
        { action: { type: 'SET_CONTROL', key: 'showNeighborOrder', value: true }, durationMs: 500, narrationKey: 'playground.knn.scenario.introOrder' },
        { action: { type: 'SET_CONTROL', key: 'k', value: 1 }, durationMs: 500, narrationKey: 'playground.knn.scenario.introK1' },
        { action: { type: 'START_NEIGHBOR_REVEAL' }, durationMs: 400, narrationKey: 'playground.knn.scenario.introReveal' },
        { action: { type: 'STEP' }, durationMs: 700, narrationKey: 'playground.knn.scenario.introNeighbor1' },
        { action: { type: 'SET_CONTROL', key: 'k', value: 5 }, durationMs: 600, narrationKey: 'playground.knn.scenario.introK5' },
        { action: { type: 'SET_CONTROL', key: 'showDecisionRegions', value: true }, durationMs: 600, narrationKey: 'playground.knn.scenario.introRegions' },
        { action: { type: 'STEP' }, durationMs: 600, narrationKey: 'playground.knn.scenario.introNeighbor2' },
        { action: { type: 'STEP' }, durationMs: 600, narrationKey: 'playground.knn.scenario.introNeighbor3' },
        { action: { type: 'STEP' }, durationMs: 600, narrationKey: 'playground.knn.scenario.introNeighbor4' },
        { action: { type: 'STEP' }, durationMs: 700, narrationKey: 'playground.knn.scenario.introVote' },
        { action: { type: 'MOVE_QUERY_POINT', x: null, y: null }, durationMs: 800, narrationKey: 'playground.knn.scenario.introBoundary' },
      ],
    },
  ],

  validateSource(source) {
    if (!source || typeof source !== 'object') throw playgroundError('INVALID_PLAYGROUND_SOURCE');
    if (!['example', 'workspace-dataset'].includes(source.kind)) throw playgroundError('INVALID_PLAYGROUND_SOURCE', { kind: source.kind });
    const featureColumns = Array.isArray(source.featureColumns) && source.featureColumns.length >= 2
      ? source.featureColumns
      : null;
    if (!featureColumns) throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'needs at least two numeric features' });
    const points = Array.isArray(source.points)
      ? source.points.map((point, index) => ({
        id: point.id ?? index,
        features: Object.fromEntries(featureColumns.map((column) => [
          column,
          finiteOrNull(point.features?.[column] ?? point[column]),
        ])),
        label: point.label,
      })).filter((point) => featureColumns.every((column) => point.features[column] !== null) && typeof point.label === 'string' && point.label)
      : [];
    if (points.length < 2) throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'needs at least two labeled points' });
    const rawTrainRatio = Number(source.trainRatio);
    const trainRatio = Number.isFinite(rawTrainRatio) && rawTrainRatio > 0 && rawTrainRatio < 1
      ? rawTrainRatio
      : 0.8;
    return {
      kind: source.kind,
      name: source.name ?? 'Example data',
      fingerprint: source.fingerprint ?? `${points.length}:${featureColumns.join(',')}`,
      points,
      featureColumns,
      trainRatio,
      total: source.total ?? points.length,
      usingDataset: source.usingDataset ?? false,
    };
  },
};
