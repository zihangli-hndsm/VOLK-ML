import { getModelAdapter } from '../playground/model/modelRegistry.js';
import { getPlayground, listPlaygroundDescriptors } from '../playgrounds/registry.js';
import { normalizeGeneratorSpec } from './generator.js';
import { listWorldOperations } from './operationRegistry.js';
import { listGeneratorParameterCapabilities } from './operationRegistry.js';
import { OBSERVABLE_IDS } from './observables.js';
import { validateCanonicalControlValue } from '../playground/controlValidation.js';
import { AFFORDANCE_IDS } from './guidedExploration.js';
import { getWorldRecipePreset } from './worldRecipePresets.js';
import { EPISODE_ONE_EXPLORATION_CONTRACT, EPISODE_ONE_ORCHESTRATION_CONTRACT } from './inquiryContracts.js';

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

const dataLabSetup = ({
  id,
  seed,
  generator = null,
  recipe = null,
  modelAdapterId = 'linear-regression',
  modelPlaygroundId = 'linear-regression',
  modelControls = {},
}) => ({
  playgroundId: 'data-lab',
  modelAdapterId,
  seed,
  controls: {},
  setup: [
    { type: 'ATTACH_MODEL', modelPlaygroundId, actor: 'system' },
    ...Object.entries(modelControls).map(([key, value]) => ({ type: 'SET_CONTROL', key, value, actor: 'system' })),
    {
      type: 'APPLY_WORLD_TRANSACTION',
      actor: 'system',
      transaction: {
        id: `big-idea-${id}-setup-v1`,
        actor: 'system',
        intent: 'big-idea-start',
        operations: [
          ...(recipe
            ? [{ type: 'SET_WORLD_RECIPE', recipe, seed }]
            : [{ type: 'SET_WORLD_GENERATOR', spec: generator }]),
          { type: 'REGENERATE_WORLD', seed, seedSource: 'entrance' },
        ],
      },
    },
  ],
});

const distributionShiftRecipe = () => {
  const recipe = getWorldRecipePreset('rings');
  return {
    ...recipe,
    groups: recipe.groups.map((group) => ({
      ...group,
      splitTransforms: {
        ...group.splitTransforms,
        test: { translate: [1.6, 0.8], rotate: 0, scale: [1, 1] },
      },
      sampling: {
        train: { ...group.sampling.train, count: 40 },
        test: { ...group.sampling.test, count: 20 },
      },
    })),
  };
};

const entries = [
  {
    version: BIG_IDEA_VERSION,
    id: 'episode-1-sampling-variability',
    episodeId: 'episode-0-world-data-model',
    titleKey: 'episode.one.title',
    summaryKey: 'episode.one.summary',
    questionKey: 'episode.one.question',
    explorationContractId: EPISODE_ONE_EXPLORATION_CONTRACT.id,
    orchestrationContractId: EPISODE_ONE_ORCHESTRATION_CONTRACT.id,
    featured: true,
    startingPoint: dataLabSetup({
      id: 'episode-1-sampling-variability', seed: 7101,
      generator: linearGenerator({ slope: 1.5, bias: 0.5, noise: 0.8, train: { min: -2, max: 2, samples: 12 }, test: { min: -2, max: 2, samples: 12 } }),
    }),
    focus: { observables: ['world.trainSampleCount', 'model.slope', 'model.bias', 'outcome.trainMse'], affordances: ['experiment.duplicate', 'experiment.compare', 'model.run'] },
    suggestedActions: [{ type: 'RUN' }, { type: 'DUPLICATE_EXPERIMENT' }, { type: 'RESAMPLE_WORLD' }, { type: 'SET_COMPARE' }],
  },
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
      modelAdapterId: 'knn',
      modelPlaygroundId: 'knn-classification',
      modelControls: { k: 5, normalize: true },
      recipe: distributionShiftRecipe(),
    }),
    focus: {
      observables: ['world.trainXRange', 'world.testXRange', 'coverageMismatch', 'outcome.trainAccuracy', 'outcome.testAccuracy'],
      affordances: ['world.trainTestLayer', 'world.point', 'experiment.duplicate', 'experiment.compare', 'model.run'],
    },
    suggestedActions: [
      { type: 'PATCH_WORLD_RECIPE' },
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

const SETUP_ACTION_TYPES = new Set(['ATTACH_MODEL', 'SET_CONTROL', 'RUN', 'APPLY_WORLD_TRANSACTION']);
const ACTORS = new Set(['human', 'agent', 'system']);
const modelPlaygroundForAdapter = (adapterId) => listPlaygroundDescriptors()
  .find((playground) => playground.kind !== 'session' && playground.adapterId === adapterId) ?? null;

function assertPlainObject(value, reason, details = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(reason, details);
}

function assertAllowedKeys(value, allowed, reason, details = {}) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(reason, { ...details, key });
  }
}

function assertActor(value, reason = 'setup-actor') {
  if (value !== undefined && !ACTORS.has(value)) invalid(reason, { actor: value });
}

function validateSetupAction(action, { controls, modelAdapterId, worldOperationTypes }) {
  assertPlainObject(action, 'setup-action');
  if (!SETUP_ACTION_TYPES.has(action.type)) invalid('unsupported-setup-action', { type: action.type });
  assertActor(action.actor);

  if (action.type === 'ATTACH_MODEL') {
    assertAllowedKeys(action, new Set(['type', 'modelPlaygroundId', 'actor']), 'malformed-attach-model');
    if (typeof action.modelPlaygroundId !== 'string' || !action.modelPlaygroundId) {
      invalid('invalid-model-playground', { modelPlaygroundId: action.modelPlaygroundId });
    }
    const modelPlayground = getPlayground(action.modelPlaygroundId);
    if (!modelPlayground || modelPlayground.kind === 'session' || !modelPlayground.adapterId) {
      invalid('unknown-model-playground', { modelPlaygroundId: action.modelPlaygroundId });
    }
    if (!getModelAdapter(modelPlayground.adapterId)) {
      invalid('unknown-model-adapter', { modelAdapterId: modelPlayground.adapterId });
    }
    if (modelPlayground.adapterId !== modelAdapterId) {
      invalid('model-adapter-mismatch', {
        declared: modelAdapterId,
        attached: modelPlayground.adapterId,
      });
    }
    if (modelPlaygroundForAdapter(modelAdapterId)?.id !== modelPlayground.id) {
      invalid('unregistered-model-playground', { modelPlaygroundId: modelPlayground.id });
    }
    return;
  }

  if (action.type === 'SET_CONTROL') {
    assertAllowedKeys(action, new Set(['type', 'key', 'value', 'actor']), 'malformed-set-control');
    if (typeof action.key !== 'string' || !action.key) invalid('invalid-control-key', { key: action.key });
    const control = controls.get(action.key);
    if (!control) invalid('unsupported-control', { key: action.key });
    if (!Object.prototype.hasOwnProperty.call(action, 'value')) invalid('missing-control-value', { key: action.key });
    try {
      validateCanonicalControlValue(control, action.value);
    } catch (error) {
      invalid('invalid-control-value', { key: action.key, cause: error.code });
    }
    return;
  }

  if (action.type === 'RUN') {
    assertAllowedKeys(action, new Set(['type', 'actor']), 'malformed-run');
    return;
  }

  assertAllowedKeys(action, new Set(['type', 'transaction', 'actor']), 'malformed-world-transaction');
  const transaction = action.transaction;
  assertPlainObject(transaction, 'setup-world-transaction');
  assertAllowedKeys(transaction, new Set(['id', 'actor', 'intent', 'operations']), 'malformed-world-transaction');
  if (typeof transaction.id !== 'string' || !transaction.id) invalid('setup-world-transaction-id');
  if (typeof transaction.intent !== 'string' || !transaction.intent) invalid('setup-world-transaction-intent');
  assertActor(transaction.actor, 'setup-transaction-actor');
  if (!Array.isArray(transaction.operations) || transaction.operations.length === 0) invalid('setup-world-transaction');
  for (const operation of transaction.operations) {
    assertPlainObject(operation, 'world-operation');
    if (!worldOperationTypes.has(operation.type)) invalid('unsupported-world-operation', { type: operation.type });
    if (operation.type === 'SET_WORLD_GENERATOR') {
      assertAllowedKeys(operation, new Set(['type', 'spec']), 'malformed-world-operation', { type: operation.type });
      try {
        normalizeGeneratorSpec(operation.spec);
      } catch (error) {
        invalid('invalid-generator-spec', { cause: error.code });
      }
    }
    if (operation.type === 'REGENERATE_WORLD') {
      assertAllowedKeys(operation, new Set(['type', 'seed', 'seedSource']), 'malformed-world-operation', { type: operation.type });
      if (!finiteInteger(operation.seed)) invalid('invalid-regenerate-seed');
      if (operation.seedSource !== undefined && operation.seedSource !== 'entrance') {
        invalid('invalid-seed-source', { seedSource: operation.seedSource });
      }
    }
  }
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
  assertPlainObject(point, 'starting-point');
  const playground = getPlayground(point.playgroundId);
  if (!playground) invalid('unknown-playground', { playgroundId: point.playgroundId });
  if (typeof point.modelAdapterId !== 'string' || !point.modelAdapterId || !getModelAdapter(point.modelAdapterId)) {
    invalid('unknown-model-adapter', { modelAdapterId: point.modelAdapterId });
  }
  if (playground.adapterId && playground.adapterId !== point.modelAdapterId) {
    invalid('starting-point-model-adapter-mismatch', { modelAdapterId: point.modelAdapterId, playgroundId: playground.id });
  }
  const modelPlayground = modelPlaygroundForAdapter(point.modelAdapterId);
  if (!modelPlayground) invalid('unregistered-model-playground', { modelAdapterId: point.modelAdapterId });
  if (!finiteInteger(point.seed)) invalid('seed', { seed: point.seed });
  if (!Array.isArray(point.setup)) invalid('setup');
  const worldOperationTypes = new Set(listWorldOperations().map((item) => item.type));
  const generatorParameterPaths = new Set(listGeneratorParameterCapabilities().map((item) => item.path));
  const controls = new Map((modelPlayground.controls ?? []).map((control) => [control.key, control]));
  const declaredControls = point.controls ?? {};
  assertPlainObject(declaredControls, 'starting-point-controls');
  for (const [key, value] of Object.entries(declaredControls)) {
    const control = controls.get(key);
    if (!control) invalid('unsupported-control', { key });
    try { validateCanonicalControlValue(control, value); } catch (error) { invalid('invalid-control-value', { key, cause: error.code }); }
  }
  for (const action of point.setup) validateSetupAction(action, { controls, modelAdapterId: point.modelAdapterId, worldOperationTypes });
  assertPlainObject(entrance.focus, 'focus');
  if (!Array.isArray(entrance.focus.observables) || !Array.isArray(entrance.focus.affordances)) invalid('focus');
  for (const observableId of entrance.focus.observables) {
    if (!OBSERVABLE_IDS.includes(observableId)) invalid('unsupported-observable', { observableId });
  }
  for (const affordanceId of entrance.focus.affordances) {
    if (!AFFORDANCE_IDS.includes(affordanceId)) invalid('unsupported-affordance', { affordanceId });
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

export function resolveBigIdeaInitialization(entrance, { seed } = {}) {
  validateBigIdeaEntrance(entrance);
  const effectiveSeed = seed === undefined ? entrance.startingPoint.seed : seed;
  if (!finiteInteger(effectiveSeed)) invalid('seed', { seed: effectiveSeed });
  const resolvedSetup = entrance.startingPoint.setup.map((action) => {
    if (action.type !== 'APPLY_WORLD_TRANSACTION') return clone(action);
    return {
      ...clone(action),
      transaction: {
        ...clone(action.transaction),
        operations: action.transaction.operations.map((operation) => (
          operation.type === 'REGENERATE_WORLD' && operation.seedSource === 'entrance'
            ? { ...clone(operation), seed: effectiveSeed }
            : clone(operation)
        )),
      },
    };
  });
  return {
    effectiveSeed,
    controls: clone(entrance.startingPoint.controls ?? {}),
    resolvedSetup,
  };
}

for (const entry of entries) validateBigIdeaEntrance(entry);

export function listBigIdeaEntrances() {
  return entries.map(clone);
}

export function getBigIdeaEntrance(id) {
  if (id === 'episode-0-world-data-model') {
    const episodeOne = entries.find((item) => item.id === 'episode-1-sampling-variability');
    return episodeOne ? clone({
      ...episodeOne,
      id: 'episode-0-world-data-model',
      episodeId: 'episode-0-world-data-model',
      titleKey: 'episode.zero.title',
      questionKey: 'episode.zero.question',
      orchestrationContractId: episodeOne.orchestrationContractId,
    }) : null;
  }
  const entry = entries.find((item) => item.id === id);
  return entry ? clone(entry) : null;
}
