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
    { key: 'xFeature', type: 'select', domain: 'evaluation', presentation: { importance: 'advanced', roles: ['inspection'] } },
    { key: 'yFeature', type: 'select', domain: 'evaluation', presentation: { importance: 'advanced', roles: ['inspection'] } },
    // runObjective declares which model operation a what-if/compare on this
    // control should run; it is declarative metadata, not a model-id switch.
    { key: 'k', type: 'number', min: 1, max: MAX_K, step: 1, runObjective: 'predict', domain: 'model', presentation: { importance: 'primary', roles: ['experiment', 'inspection'], explanationKey: 'playground.controlHint.k' } },
    { key: 'queryX', type: 'number', domain: 'evaluation', presentation: { importance: 'secondary', roles: ['inspection'] } },
    { key: 'queryY', type: 'number', domain: 'evaluation', presentation: { importance: 'secondary', roles: ['inspection'] } },
    { key: 'showNeighborOrder', type: 'boolean', domain: 'view', presentation: { importance: 'advanced', roles: ['inspection'] } },
    { key: 'showDecisionRegions', type: 'boolean', domain: 'view', presentation: { importance: 'secondary', roles: ['inspection'] } },
    { key: 'normalize', type: 'boolean', domain: 'learning', presentation: { importance: 'secondary', roles: ['experiment', 'inspection'] } },
    { key: 'distanceMetric', type: 'select', options: ['euclidean'], domain: 'model', presentation: { importance: 'secondary', roles: ['experiment', 'inspection'] } },
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
      presetId: 'knn.intro',
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
