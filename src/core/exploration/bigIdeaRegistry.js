import { getModelAdapter } from '../playground/model/modelRegistry.js';
import { getPlayground } from '../playgrounds/registry.js';
import { normalizeGeneratorSpec } from './generator.js';
import { listWorldOperations } from './operationRegistry.js';
import { listGeneratorParameterCapabilities } from './operationRegistry.js';
import { OBSERVABLE_IDS } from './observables.js';
import { validateCanonicalControlValue } from '../playground/controlValidation.js';

export const BIG_IDEA_VERSION = 1;

const clone = (value) => structuredClone(value);
const finiteInteger = (value) => Number.isInteger(value) && Number.isFinite(value);
const isJsonSafe = (value) => {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
};

const linearGenerator = ({ slope, bias, noise, train, test, outliers = 0 }) => ({
  relation: { slope, bias },
  noise: { amount: noise },
  train: { input: { type: 'uniform', params: train }, samples: train.samples },
  test: { input: { type: 'uniform', params: test }, samples: test.samples },
  outliers: { count: outliers },
});

const dataLabSetup = ({ id, seed, generator }) => ({
  playgroundId: 'data-lab',
  modelAdapterId: 'linear-regression',
  seed,
  controls: {},
  setup: [
    { type: 'ATTACH_MODEL', modelPlaygroundId: 'linear-regression', actor: 'system' },
    {
      type: 'APPLY_WORLD_TRANSACTION',
      actor: 'system',
      transaction: {
        id: `big-idea-${id}-setup-v1`,
        actor: 'system',
        intent: 'big-idea-start',
        operations: [
          { type: 'SET_WORLD_GENERATOR', spec: generator },
          { type: 'REGENERATE_WORLD', seed },
        ],
      },
    },
  ],
});

const entries = [
  {
    version: BIG_IDEA_VERSION,
    id: 'finding-patterns',
    titleKey: 'bigIdea.findingPatterns.title',
    summaryKey: 'bigIdea.findingPatterns.summary',
    questionKey: 'bigIdea.findingPatterns.question',
    startingPoint: dataLabSetup({
      id: 'finding-patterns',
      seed: 7101,
      generator: linearGenerator({
        slope: 1.5,
        bias: 0.5,
        noise: 0.25,
        train: { min: -2, max: 2, samples: 28 },
        test: { min: -2, max: 2, samples: 12 },
      }),
    }),
    focus: {
      observables: ['world.trainSampleCount', 'world.testSampleCount', 'model.slope', 'outcome.trainMse', 'outcome.testMse'],
      affordances: ['world.point', 'experiment.duplicate', 'experiment.compare', 'model.run'],
    },
    suggestedActions: [
      { type: 'MOVE_POINT' },
      { type: 'ADD_POINTS' },
      { type: 'RUN' },
      { type: 'DUPLICATE_EXPERIMENT' },
    ],
  },
  {
    version: BIG_IDEA_VERSION,
    id: 'noise-robustness',
    titleKey: 'bigIdea.noiseRobustness.title',
    summaryKey: 'bigIdea.noiseRobustness.summary',
    questionKey: 'bigIdea.noiseRobustness.question',
    startingPoint: dataLabSetup({
      id: 'noise-robustness',
      seed: 7102,
      generator: linearGenerator({
        slope: 1.5,
        bias: 0.5,
        noise: 0.7,
        train: { min: -2, max: 2, samples: 28 },
        test: { min: -2, max: 2, samples: 12 },
        outliers: 2,
      }),
    }),
    focus: {
      observables: ['world.generatorNoise', 'world.outlierCount', 'model.slope', 'outcome.trainMse', 'outcome.testMse'],
      affordances: ['world.generator.noise', 'world.outlier', 'world.point', 'experiment.duplicate', 'experiment.compare', 'model.run'],
    },
    suggestedActions: [
      { type: 'SET_GENERATOR_PARAMETER', path: 'noise.amount' },
      { type: 'MOVE_POINT' },
      { type: 'ADD_POINTS' },
      { type: 'DUPLICATE_EXPERIMENT' },
      { type: 'RUN' },
    ],
  },
  {
    version: BIG_IDEA_VERSION,
    id: 'generalization',
    titleKey: 'bigIdea.generalization.title',
    summaryKey: 'bigIdea.generalization.summary',
    questionKey: 'bigIdea.generalization.question',
    startingPoint: dataLabSetup({
      id: 'generalization',
      seed: 7103,
      generator: linearGenerator({
        slope: 1.6,
        bias: 0.4,
        noise: 0.2,
        train: { min: -0.8, max: 0.8, samples: 24 },
        test: { min: -2, max: 2, samples: 20 },
      }),
    }),
    focus: {
      observables: ['world.trainXRange', 'world.testXRange', 'coverageMismatch', 'outcome.trainMse', 'outcome.testMse', 'generalizationGap'],
      affordances: ['world.generator.testInput', 'world.generator.sampleCount', 'experiment.duplicate', 'experiment.compare', 'model.run'],
    },
    suggestedActions: [
      { type: 'SET_GENERATOR_PARAMETER', path: 'test.input.params.min' },
      { type: 'SET_GENERATOR_PARAMETER', path: 'test.input.params.max' },
      { type: 'DUPLICATE_EXPERIMENT' },
      { type: 'RUN' },
    ],
  },
  {
    version: BIG_IDEA_VERSION,
    id: 'distribution-shift',
    titleKey: 'bigIdea.distributionShift.title',
    summaryKey: 'bigIdea.distributionShift.summary',
    questionKey: 'bigIdea.distributionShift.question',
    startingPoint: dataLabSetup({
      id: 'distribution-shift',
      seed: 7104,
      generator: linearGenerator({
        slope: 1.6,
        bias: 0.4,
        noise: 0.2,
        train: { min: -2, max: -0.5, samples: 28 },
        test: { min: 0.5, max: 2.5, samples: 20 },
      }),
    }),
    focus: {
      observables: ['world.trainXRange', 'world.testXRange', 'coverageMismatch', 'outcome.trainMse', 'outcome.testMse'],
      affordances: ['world.trainTestLayer', 'world.generator.testInput', 'experiment.duplicate', 'experiment.compare', 'model.run'],
    },
    suggestedActions: [
      { type: 'SET_GENERATOR_PARAMETER', path: 'test.input.params.min' },
      { type: 'SET_GENERATOR_PARAMETER', path: 'test.input.params.max' },
      { type: 'REGENERATE_WORLD' },
      { type: 'RUN' },
      { type: 'DUPLICATE_EXPERIMENT' },
      { type: 'SET_COMPARE' },
    ],
  },
  {
    version: BIG_IDEA_VERSION,
    id: 'model-capacity',
    titleKey: 'bigIdea.modelCapacity.title',
    summaryKey: 'bigIdea.modelCapacity.summary',
    questionKey: 'bigIdea.modelCapacity.question',
    startingPoint: {
      playgroundId: 'mlp-classification',
      modelAdapterId: 'mlp',
      seed: 7105,
      controls: {
        hiddenUnits: 2,
        learningRate: 0.08,
        trainingSteps: 20,
        showDecisionRegions: true,
      },
      setup: [],
    },
    focus: {
      observables: ['model.hiddenUnits', 'learning.currentStep'],
      affordances: ['model.run'],
    },
    suggestedActions: [
      { type: 'SET_CONTROL', key: 'hiddenUnits' },
      { type: 'RUN' },
      { type: 'DUPLICATE_EXPERIMENT' },
      { type: 'SET_COMPARE' },
    ],
  },
];

function invalid(reason, details = {}) {
  const error = new Error('INVALID_BIG_IDEA_ENTRANCE');
  error.code = 'INVALID_BIG_IDEA_ENTRANCE';
  error.details = { reason, ...details };
  throw error;
}

export function validateBigIdeaEntrance(entrance) {
  if (!entrance || typeof entrance !== 'object' || Array.isArray(entrance)) invalid('declaration');
  if (!isJsonSafe(entrance)) invalid('not-json-safe');
  if (entrance.version !== BIG_IDEA_VERSION) invalid('version', { version: entrance.version });
  if (typeof entrance.id !== 'string' || !entrance.id) invalid('id');
  for (const key of ['titleKey', 'summaryKey', 'questionKey']) {
    if (typeof entrance[key] !== 'string' || !entrance[key]) invalid('localization-key', { key });
  }
  const point = entrance.startingPoint;
  if (!point || typeof point !== 'object') invalid('starting-point');
  const playground = getPlayground(point.playgroundId);
  if (!playground) invalid('unknown-playground', { playgroundId: point.playgroundId });
  const modelPlaygroundId = point.modelAdapterId === playground.adapterId
    ? playground.id
    : point.modelAdapterId === 'linear-regression' || point.modelAdapterId === 'mlp'
      ? (point.modelAdapterId === 'linear-regression' ? 'linear-regression' : 'mlp-classification')
      : null;
  if (!modelPlaygroundId || !getModelAdapter(point.modelAdapterId)) {
    invalid('unknown-model-adapter', { modelAdapterId: point.modelAdapterId });
  }
  if (!finiteInteger(point.seed)) invalid('seed', { seed: point.seed });
  if (!Array.isArray(point.setup)) invalid('setup');
  const worldOperationTypes = new Set(listWorldOperations().map((item) => item.type));
  const generatorParameterPaths = new Set(listGeneratorParameterCapabilities().map((item) => item.path));
  const controls = new Map((getPlayground(modelPlaygroundId)?.controls ?? []).map((control) => [control.key, control]));
  for (const [key, value] of Object.entries(point.controls ?? {})) {
    const control = controls.get(key);
    if (!control) invalid('unsupported-control', { key });
    try { validateCanonicalControlValue(control, value); } catch (error) { invalid('invalid-control-value', { key, cause: error.code }); }
  }
  for (const action of point.setup) {
    if (!action || typeof action.type !== 'string') invalid('setup-action');
    if (action.type === 'APPLY_WORLD_TRANSACTION') {
      const operations = action.transaction?.operations;
      if (!Array.isArray(operations) || operations.length === 0) invalid('setup-world-transaction');
      for (const operation of operations) {
        if (!worldOperationTypes.has(operation.type)) invalid('unsupported-world-operation', { type: operation.type });
        if (operation.type === 'SET_WORLD_GENERATOR') normalizeGeneratorSpec(operation.spec);
        if (operation.type === 'REGENERATE_WORLD' && !finiteInteger(operation.seed)) invalid('invalid-regenerate-seed');
      }
    } else if (!['ATTACH_MODEL', 'SET_CONTROL', 'RUN'].includes(action.type)) {
      invalid('unsupported-setup-action', { type: action.type });
    }
  }
  if (!entrance.focus || !Array.isArray(entrance.focus.observables) || !Array.isArray(entrance.focus.affordances)) invalid('focus');
  for (const observableId of entrance.focus.observables) {
    if (!OBSERVABLE_IDS.includes(observableId)) invalid('unsupported-observable', { observableId });
  }
  if (!Array.isArray(entrance.suggestedActions)) invalid('suggested-actions');
  for (const suggestion of entrance.suggestedActions) {
    if (!suggestion || typeof suggestion.type !== 'string') invalid('suggested-action');
    if (suggestion.type === 'SET_CONTROL' && !controls.has(suggestion.key)) invalid('unsupported-control', { key: suggestion.key });
    if (suggestion.type === 'SET_GENERATOR_PARAMETER' && !generatorParameterPaths.has(suggestion.path)) {
      invalid('unsupported-generator-parameter', { path: suggestion.path });
    }
    if (suggestion.type !== 'SET_CONTROL' && suggestion.type !== 'RUN' && suggestion.type !== 'DUPLICATE_EXPERIMENT'
      && suggestion.type !== 'SET_COMPARE' && !worldOperationTypes.has(suggestion.type)) {
      invalid('unsupported-suggested-action', { type: suggestion.type });
    }
  }
  return true;
}

for (const entry of entries) validateBigIdeaEntrance(entry);

export function listBigIdeaEntrances() {
  return entries.map(clone);
}

export function getBigIdeaEntrance(id) {
  const entry = entries.find((item) => item.id === id);
  return entry ? clone(entry) : null;
}
