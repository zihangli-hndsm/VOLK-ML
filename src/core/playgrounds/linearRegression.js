import { playgroundError } from './session.js';

const finiteOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

// Metadata descriptor. All session/model behavior lives in the unified
// playground runtime and the linear-regression model adapter.
export const linearRegressionPlayground = {
  id: 'linear-regression',
  version: 1,
  adapterId: 'linear-regression',
  titleKey: 'playground.linearRegression.title',
  descriptionKey: 'playground.linearRegression.description',
  supportedOps: ['linear_regression'],
  supportedTasks: ['regression'],
  sourceKinds: ['example', 'workspace-dataset'],

  controls: [
    { key: 'weight', type: 'number', min: -100, max: 100, step: 0.01 },
    { key: 'bias', type: 'number', min: -100, max: 100, step: 0.01 },
    { key: 'learningRate', type: 'number', min: 0.001, max: 1, step: 0.001 },
    { key: 'trainingSteps', type: 'number', min: 1, max: 100, step: 1 },
    { key: 'showResiduals', type: 'boolean' },
    { key: 'showBestFit', type: 'boolean' },
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
    const points = Array.isArray(source.points)
      ? source.points.map((point, index) => ({
        id: point.id ?? index,
        x: finiteOrNull(point.x),
        y: finiteOrNull(point.y),
      })).filter((point) => point.x !== null && point.y !== null)
      : [];
    if (points.length < 2) throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'needs at least two finite points' });
    return {
      kind: source.kind,
      name: source.name ?? 'Example data',
      fingerprint: source.fingerprint ?? String(points.length),
      points,
      feature: source.feature ?? 'x',
      target: source.target ?? 'y',
      total: source.total ?? points.length,
      usingDataset: source.usingDataset ?? false,
    };
  },
};
