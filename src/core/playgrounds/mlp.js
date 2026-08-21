import { playgroundError } from './session.js';

const finiteOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

// Metadata descriptor for the MLP classification playground (PR F.1). All
// session/model behavior lives in the unified playground runtime and the MLP
// model adapter.
export const mlpPlayground = {
  id: 'mlp-classification',
  domain: 'tabular',
  version: 1,
  adapterId: 'mlp',
  titleKey: 'playground.mlp.title',
  descriptionKey: 'playground.mlp.description',
  supportedOps: ['mlp_classifier'],
  supportedTasks: ['classification'],
  sourceKinds: ['example', 'workspace-dataset'],

  controls: [
    // 2D view feature selection (dynamic options from the dataset columns;
    // select-without-options stays not safely plannable, like KNN).
    { key: 'xFeature', type: 'select', domain: 'evaluation', presentation: { importance: 'advanced', roles: ['inspection'] } },
    { key: 'yFeature', type: 'select', domain: 'evaluation', presentation: { importance: 'advanced', roles: ['inspection'] } },
    // runObjective declares which model operation a what-if/compare on this
    // control should run; it is declarative metadata, not a model-id switch.
    { key: 'hiddenUnits', type: 'number', min: 1, max: 8, step: 1, runObjective: 'predict', domain: 'model', presentation: { importance: 'primary', roles: ['experiment', 'inspection'], explanationKey: 'playground.controlHint.hiddenUnits', quickControl: true, quickControlDefault: true, inquiryRole: 'capacity' } },
    { key: 'learningRate', type: 'number', min: 0.001, max: 2, step: 0.001, runObjective: 'fit', domain: 'learning', presentation: { importance: 'primary', roles: ['experiment', 'inspection'], explanationKey: 'playground.controlHint.learningRate', quickControl: true } },
    { key: 'trainingSteps', type: 'number', min: 1, max: 50, step: 1, runObjective: 'fit', domain: 'learning', presentation: { importance: 'primary', roles: ['experiment', 'inspection'], explanationKey: 'playground.controlHint.trainingSteps', quickControl: true } },
    { key: 'queryX', type: 'number', domain: 'evaluation', presentation: { importance: 'secondary', roles: ['inspection'] } },
    { key: 'queryY', type: 'number', domain: 'evaluation', presentation: { importance: 'secondary', roles: ['inspection'] } },
    { key: 'showDecisionRegions', type: 'boolean', domain: 'view', presentation: { importance: 'secondary', roles: ['inspection'] } },
  ],

  actions: [
    'SET_CONTROL',
    'START_TRAINING',
    'START_PREDICT',
    'STEP',
    'SEEK',
    'RESET',
    'RUN_SCENARIO',
  ],

  scenarios: [
    {
      id: 'intro',
      titleKey: 'playground.scenario.intro',
      presetId: 'mlp.intro',
    },
  ],

  validateSource(source) {
    if (!source || typeof source !== 'object') throw playgroundError('INVALID_PLAYGROUND_SOURCE');
    if (!['example', 'workspace-dataset'].includes(source.kind)) {
      throw playgroundError('INVALID_PLAYGROUND_SOURCE', { kind: source.kind });
    }
    const featureColumns = Array.isArray(source.featureColumns) && source.featureColumns.length >= 2
      ? source.featureColumns
      : null;
    if (!featureColumns) {
      throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'needs at least two numeric features' });
    }
    if (source.kind === 'example'
      && !(featureColumns.includes('x1') && featureColumns.includes('x2'))) {
      throw playgroundError('INVALID_PLAYGROUND_SOURCE', {
        reason: 'the deterministic example representation requires x1/x2',
        featureColumns: source.featureColumns,
      });
    }
    const points = Array.isArray(source.points)
      ? source.points.map((point, index) => ({
        id: point.id ?? index,
        features: Object.fromEntries(featureColumns.map((column) => [
          column,
          finiteOrNull(point.features?.[column] ?? point[column]),
        ])),
        label: point.label,
      })).filter((point) => (
        featureColumns.every((column) => point.features[column] !== null)
        && typeof point.label === 'string'
        && point.label
      ))
      : [];
    if (points.length < 2) throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'needs at least two labeled points' });
    const labels = [...new Set(points.map((point) => point.label))];
    if (labels.length !== 2) {
      throw playgroundError('INVALID_PLAYGROUND_SOURCE', {
        reason: 'MLP requires binary classification',
        labels: labels.length,
      });
    }
    return {
      kind: source.kind,
      name: source.name ?? 'Example data',
      fingerprint: source.fingerprint ?? `${points.length}:${featureColumns.join(',')}`,
      points,
      featureColumns,
      total: source.total ?? points.length,
      trainRatio: source.trainRatio ?? 0.8,
      usingDataset: source.kind === 'workspace-dataset',
    };
  },
};
