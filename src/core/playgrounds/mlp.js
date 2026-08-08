import { playgroundError } from './session.js';

const finiteOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

// Metadata descriptor for the MLP classification playground (PR F.1). All
// session/model behavior lives in the unified playground runtime and the MLP
// model adapter.
export const mlpPlayground = {
  id: 'mlp-classification',
  version: 1,
  adapterId: 'mlp',
  titleKey: 'playground.mlp.title',
  descriptionKey: 'playground.mlp.description',
  supportedOps: ['mlp_classifier'],
  supportedTasks: ['classification'],
  sourceKinds: ['example'],

  controls: [
    // runObjective declares which model operation a what-if/compare on this
    // control should run; it is declarative metadata, not a model-id switch.
    { key: 'hiddenUnits', type: 'number', min: 1, max: 8, step: 1, runObjective: 'predict' },
    { key: 'learningRate', type: 'number', min: 0.001, max: 2, step: 0.001, runObjective: 'fit' },
    { key: 'trainingSteps', type: 'number', min: 1, max: 50, step: 1, runObjective: 'fit' },
    { key: 'queryX', type: 'number' },
    { key: 'queryY', type: 'number' },
    { key: 'showDecisionRegions', type: 'boolean' },
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
    if (source.kind !== 'example') throw playgroundError('INVALID_PLAYGROUND_SOURCE', { kind: source.kind });
    // F.1 intentionally supports only the deterministic XOR example source;
    // the adapter/math read the x1/x2 features directly. Do not advertise a
    // broader source contract than the implementation supports. Generic
    // workspace-dataset feature mapping is later dataset-integration work.
    const featureColumns = Array.isArray(source.featureColumns)
      && source.featureColumns.length === 2
      && source.featureColumns.includes('x1')
      && source.featureColumns.includes('x2')
      ? source.featureColumns
      : null;
    if (!featureColumns) {
      throw playgroundError('INVALID_PLAYGROUND_SOURCE', {
        reason: 'MLP F.1 requires the deterministic x1/x2 example representation',
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
    return {
      kind: source.kind,
      name: source.name ?? 'Example data',
      fingerprint: source.fingerprint ?? `${points.length}:${featureColumns.join(',')}`,
      points,
      featureColumns,
      total: source.total ?? points.length,
      usingDataset: false,
    };
  },
};
