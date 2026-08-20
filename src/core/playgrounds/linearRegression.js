import { playgroundError } from './session.js';

const finiteOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

// Metadata descriptor. All session/model behavior lives in the unified
// playground runtime and the linear-regression model adapter.
export const linearRegressionPlayground = {
  id: 'linear-regression',
  domain: 'tabular',
  version: 1,
  adapterId: 'linear-regression',
  titleKey: 'playground.linearRegression.title',
  descriptionKey: 'playground.linearRegression.description',
  supportedOps: ['linear_regression'],
  supportedTasks: ['regression'],
  sourceKinds: ['example', 'workspace-dataset'],

  controls: [
    { key: 'weight', type: 'number', min: -100, max: 100, step: 0.01, domain: 'model', presentation: { importance: 'secondary', roles: ['inspection'] } },
    { key: 'bias', type: 'number', min: -100, max: 100, step: 0.01, domain: 'model', presentation: { importance: 'secondary', roles: ['inspection'] } },
    // Max 5: gradient descent runs on standardized (z-scored) data, so values
    // > 1 are required to demonstrate the learning-rate-too-high teaching
    // scenario. The descriptor is the single source for every public path.
    // runObjective declares which model operation a what-if/compare on this
    // control should run; it is declarative metadata, not a model-id switch.
    { key: 'learningRate', type: 'number', min: 0.001, max: 5, step: 0.001, runObjective: 'fit', domain: 'learning', presentation: { importance: 'primary', roles: ['experiment', 'inspection'], explanationKey: 'playground.controlHint.learningRate', quickControl: true } },
    { key: 'trainingSteps', type: 'number', min: 1, max: 100, step: 1, runObjective: 'fit', domain: 'learning', presentation: { importance: 'primary', roles: ['experiment', 'inspection'], explanationKey: 'playground.controlHint.trainingSteps', quickControl: true } },
    { key: 'showResiduals', type: 'boolean', domain: 'view', presentation: { importance: 'secondary', roles: ['inspection'] } },
    { key: 'showBestFit', type: 'boolean', domain: 'view', presentation: { importance: 'advanced', roles: ['inspection'] } },
  ],

  actions: [
    'SET_CONTROL',
    'ADD_POINT',
    'MOVE_POINT',
    'REMOVE_POINT',
    'SET_PARAMETERS',
    'SET_BEST_FIT',
    'START_TRAINING',
    'STEP',
    'SEEK',
    'RESET',
    'RUN_SCENARIO',
  ],

  scenarios: [
    {
      id: 'intro',
      titleKey: 'playground.scenario.intro',
      presetId: 'linear-regression.intuition',
    },
  ],

  validateSource(source) {
    if (!source || typeof source !== 'object') throw playgroundError('INVALID_PLAYGROUND_SOURCE');
    if (!['example', 'workspace-dataset'].includes(source.kind)) throw playgroundError('INVALID_PLAYGROUND_SOURCE', { kind: source.kind });
    const featureColumns = Array.isArray(source.featureColumns) && source.featureColumns.length
      ? [...source.featureColumns]
      : [source.feature ?? 'x'];
    const feature = source.feature ?? featureColumns[0];
    const target = source.target ?? 'y';
    const points = Array.isArray(source.points)
      ? source.points.map((point, index) => {
        const features = Object.fromEntries(featureColumns.map((column) => [
          column,
          finiteOrNull(point.features?.[column] ?? point[column] ?? (column === feature ? point.x : undefined)),
        ]));
        const targetValue = finiteOrNull(point.features?.[target] ?? point[target] ?? point.target ?? point.y);
        return {
          ...point,
          id: point.id ?? index,
          x: finiteOrNull(features[feature]),
          y: targetValue,
          target: targetValue,
          features: { ...features, [target]: targetValue },
          membership: point.membership ?? point.split ?? 'unspecified',
          provenance: point.provenance,
        };
      }).filter((point) => point.x !== null && point.y !== null
        && featureColumns.every((column) => point.features[column] !== null))
      : [];
    if (points.length < 2) throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'needs at least two finite points' });
    return {
      kind: source.kind,
      name: source.name ?? 'Example data',
      fingerprint: source.fingerprint ?? String(points.length),
      points,
      task: 'regression',
      feature,
      target,
      featureColumns,
      total: source.total ?? points.length,
      usingDataset: source.usingDataset ?? false,
    };
  },
};
