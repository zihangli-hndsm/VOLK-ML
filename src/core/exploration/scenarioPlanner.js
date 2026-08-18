import { conditionFingerprintForSession } from './observables.js';
import { worldRecipePatchChangedPaths, worldRecipePatchSemanticDomains, worldRecipeSemanticDomains } from './worldRecipe.js';
import { interpretExplorationRequest } from './explorationInterpreter.js';
import { listGeneratorParameterCapabilities } from './operationRegistry.js';
import { scenarioError, validateScenarioSpec } from './scenarioSpec.js';
import { EXPLORATION_INTENTS } from './explorationIntents.js';
import { coverageMismatch } from './observables.js';
import {
  PEDAGOGICAL_EXPERIMENT_GOALS,
  validateExplorationDesign,
} from './pedagogicalExperiment.js';

const clone = (value) => structuredClone(value);

function rangeFor(world, membership) {
  const values = world.observations.filter((point) => point.membership === membership).map((point) => Number(point.x)).filter(Number.isFinite);
  return values.length ? { min: Math.min(...values), max: Math.max(...values) } : { min: -1, max: 1 };
}

function outlierPoints(context) {
  const world = context.world;
  const train = rangeFor(world, 'train');
  const slope = Number(context.experiment?.result?.model?.weight ?? 1);
  const bias = Number(context.experiment?.result?.model?.bias ?? 0);
  const x = train.max + Math.max(1, (train.max - train.min) * 0.5);
  return [
    { x, y: slope * x + bias + 5, membership: 'train', provenance: 'agent' },
    { x: x + 0.5, y: slope * (x + 0.5) + bias - 5, membership: 'train', provenance: 'agent' },
  ];
}

function generatorCapability(context, path) {
  const registered = (context.exploration?.worldOperations ?? [])
    .find((operation) => operation.type === 'SET_GENERATOR_PARAMETER')
    ?.parameterSchema?.parameters;
  return (registered ?? listGeneratorParameterCapabilities()).find((item) => item.path === path) ?? null;
}

function worldOperationType(context, capability) {
  const operation = (context.exploration?.worldOperations ?? []).find((item) => item.capability === capability && item.agentDiscoverable !== false);
  if (!operation) throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { capability });
  return operation.type;
}

function requireGeneratorCapability(context, path) {
  const capability = generatorCapability(context, path);
  if (!capability) throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { operation: 'SET_GENERATOR_PARAMETER', path });
  return capability;
}

function differentInputType(context, split) {
  const current = context.world.generator.spec[split]?.input?.type;
  const capability = requireGeneratorCapability(context, `${split}.input.type`);
  const next = capability.options.find((value) => value !== current);
  if (!next) throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { reason: 'second-input-distribution-unavailable', split });
  return { path: `${split}.input.type`, value: next };
}

function generatorChanges(context, target) {
  if (context.world?.generator?.spec) {
    if (target === 'test-shift') {
      const test = context.world.generator.spec.test.input.params;
      const min = Number(test.min ?? -1);
      const max = Number(test.max ?? 1);
      const shift = Math.max(1, max - min);
      return [
        { semanticTarget: 'test-input-support', operation: worldOperationType(context, 'world.generator.parameter'), parameters: { path: 'test.input.params.min', value: min + shift * 1.5 } },
        { semanticTarget: 'test-input-support', operation: worldOperationType(context, 'world.generator.parameter'), parameters: { path: 'test.input.params.max', value: max + shift * 1.5 } },
        { semanticTarget: 'test-input-support', operation: worldOperationType(context, 'world.generator.regenerate'), parameters: { seed: context.world.randomness?.seed ?? 42 } },
      ];
    }
    if (target === 'two-distributions') {
      const train = differentInputType(context, 'train');
      const test = differentInputType(context, 'test');
      return [
        { semanticTarget: 'input-distribution', operation: worldOperationType(context, 'world.generator.parameter'), parameters: train },
        { semanticTarget: 'input-distribution', operation: worldOperationType(context, 'world.generator.parameter'), parameters: test },
        { semanticTarget: 'input-distribution', operation: worldOperationType(context, 'world.generator.regenerate'), parameters: { seed: context.world.randomness?.seed ?? 42 } },
      ];
    }
    if (target === 'harder-noise') {
      return [
        { semanticTarget: 'noise', operation: worldOperationType(context, 'world.generator.parameter'), parameters: { path: 'noise.amount', value: Number(context.world.generator.spec.noise.amount ?? 0) + 0.5 } },
        { semanticTarget: 'noise', operation: worldOperationType(context, 'world.generator.regenerate'), parameters: { seed: context.world.randomness?.seed ?? 42 } },
      ];
    }
  }
  if (target === 'harder-noise') {
    const pointIds = context.world?.observations?.map((point) => point.id) ?? [];
    if (!pointIds.length) throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { reason: 'observations-required' });
    return [{
      semanticTarget: 'noise',
      operation: worldOperationType(context, 'world.observations.transform'),
      parameters: {
        feature: context.world.featureNames.at(-1),
        kind: 'noise',
        amount: 0.5,
        pointIds,
        scope: 'all-observations',
        seed: context.world.randomness?.seed ?? 42,
      },
    }];
  }
  const testIds = context.world?.observations?.filter((point) => point.membership === 'test').map((point) => point.id) ?? [];
  if (testIds.length) {
    return [{ semanticTarget: 'test-input-support', operation: worldOperationType(context, 'world.observations.transform'), parameters: { feature: context.world.featureNames[0], kind: 'shift', amount: 2, pointIds: testIds, scope: 'test-observations' } }];
  }
  const fallbackTestIds = context.world?.observations?.slice(-Math.max(1, Math.floor((context.world.observations.length || 1) / 5))).map((point) => point.id) ?? [];
  if (!fallbackTestIds.length) throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { reason: 'test-observations-required' });
  return [
    { semanticTarget: 'existing-train-test-setup', operation: worldOperationType(context, 'world.observations.membership'), parameters: { pointIds: fallbackTestIds, membership: 'test' } },
    { semanticTarget: 'test-input-support', operation: worldOperationType(context, 'world.observations.transform'), parameters: { feature: context.world.featureNames[0], kind: 'shift', amount: 2, pointIds: fallbackTestIds, scope: 'test-observations' } },
  ];
}

function learningRateChange(context, direction) {
  const schema = (context.controlSchemas ?? []).find((item) => item.key === 'learningRate');
  if (!schema) throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_CONTROL', { key: 'learningRate' });
  const current = Number(context.controls?.learningRate ?? schema.default ?? schema.min);
  const step = Number(schema.step ?? 0.001);
  const delta = Math.max(step, Math.abs(current) * 0.5);
  const raw = direction === 'decrease' ? current - delta : current + delta;
  const value = Math.min(Number(schema.max), Math.max(Number(schema.min), raw));
  if (value === current) throw scenarioError('EXPLORATION_SCENARIO_CONTROL_OUT_OF_RANGE', { key: 'learningRate' });
  return { key: 'learningRate', value: Number(value.toFixed(6)) };
}

function intentSpec(intent, request, context) {
  const baseline = {
    experimentId: context.experiment.id,
    conditionFingerprint: conditionFingerprintForSession({ world: context.world, adapterId: context.experiment.model?.adapterId, experiment: context.experiment }),
  };
  const common = {
    version: 1,
    request,
    baseline,
    execution: { duplicateBaseline: true, run: true, compare: true, repeat: null },
  };
  if (intent === 'outliers') return {
    ...common,
    interpretation: { summary: 'Add two bounded outlier observations to a duplicate while keeping model and learning settings fixed.', ambiguity: null },
    change: [{ semanticTarget: 'outliers', operation: worldOperationType(context, 'world.observations.add'), parameters: { points: outlierPoints(context) } }],
    hold: ['model-configuration', 'learning-configuration', 'latent-relation', 'noise', 'existing-train-test-setup'],
    observe: ['model.slope', 'outcome.trainMse', 'outcome.testMse', 'slopeDifference'],
  };
  if (intent === 'test-shift' || intent === 'two-distributions') return {
    ...common,
    interpretation: { summary: intent === 'test-shift' ? 'Move Test input support away from Train input support.' : 'Compare linear regression under two registered input distribution families.', ambiguity: null },
    change: generatorChanges(context, intent),
    hold: intent === 'test-shift'
      ? ['model-configuration', 'learning-configuration', 'latent-relation', 'noise', 'train-distribution']
      : ['model-configuration', 'learning-configuration', 'latent-relation', 'noise', 'train-sample-count', 'test-sample-count'],
    observe: ['world.trainXRange', 'world.testXRange', 'coverageMismatch', 'outcome.trainMse', 'outcome.testMse', 'generalizationGap'],
  };
  if (intent === 'harder-noise') return {
    ...common,
    interpretation: { summary: 'Increase observation noise while holding the model configuration fixed.', ambiguity: null },
    change: generatorChanges(context, intent),
    hold: ['model-configuration', 'learning-configuration', 'latent-relation'],
    observe: ['world.generatorNoise', 'model.slope', 'outcome.trainMse', 'outcome.testMse'],
  };
  if (intent === EXPLORATION_INTENTS.LEARNING_RATE_INCREASE || intent === EXPLORATION_INTENTS.LEARNING_RATE_DECREASE) return {
    ...common,
    interpretation: { summary: 'Change only the learning rate while holding the World and model configuration fixed.', ambiguity: null },
    change: [{ semanticTarget: 'learning-configuration', operation: 'SET_CONTROL', parameters: learningRateChange(context, intent === EXPLORATION_INTENTS.LEARNING_RATE_DECREASE ? 'decrease' : 'increase') }],
    hold: ['world', 'model-configuration', 'evaluation-configuration'],
    observe: ['model.slope', 'model.bias', 'outcome.trainMse', 'outcome.testMse'],
  };
  if (intent === 'line-move') {
    const action = [...(context.recentWorldActions ?? [])].at(-1);
    const isPointAction = action?.reversible
      && action.operationTypes.some((type) => ['ADD_POINTS', 'MOVE_POINT', 'REMOVE_POINT', 'REMOVE_POINTS'].includes(type));
    if (!isPointAction) return null;
    return {
      ...common,
      interpretation: { summary: 'Compare the current fit with the real recent point intervention undone in a duplicate.', ambiguity: null },
      change: [{ semanticTarget: 'observation-values', operation: 'UNDO_WORLD_ACTION', parameters: { actionId: action.id } }],
      hold: ['model-configuration', 'learning-configuration', 'latent-relation', 'noise'],
      observe: ['model.slope', 'model.bias', 'outcome.trainMse', 'outcome.testMse', 'slopeDifference'],
    };
  }
  throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_REQUEST', { intent });
}

function worldDesignSpec(worldDesign, request, context) {
  const currentRecipe = context.world?.generator?.kind === 'world-recipe' ? context.world.generator.recipe : null;
  const intendedTask = worldDesign.mode === 'create'
    ? worldDesign.recipe?.task
    : currentRecipe?.task;
  const outcomeObservables = intendedTask === 'classification'
    ? ['outcome.trainAccuracy', 'outcome.testAccuracy']
    : ['outcome.trainMse', 'outcome.testMse'];
  const intendedWorldRecipeDomains = worldDesign.mode === 'create'
    ? ['whole-recipe']
    : worldRecipePatchSemanticDomains(currentRecipe, worldDesign.patch);
  const intendedWorldRecipePaths = worldDesign.mode === 'create'
    ? ['whole-recipe']
    : worldRecipePatchChangedPaths(currentRecipe, worldDesign.patch);
  const heldWorldRecipeDomains = currentRecipe
    ? worldRecipeSemanticDomains(currentRecipe).filter((domain) => !intendedWorldRecipeDomains.includes(domain))
    : [];
  const baseline = {
    experimentId: context.experiment.id,
    conditionFingerprint: conditionFingerprintForSession({ world: context.world, adapterId: context.experiment.model?.adapterId, experiment: context.experiment }),
  };
  const common = {
    version: 1,
    request,
    baseline,
    execution: { duplicateBaseline: true, run: true, compare: true, repeat: null },
    hold: [...(worldDesign.requestedHolds ?? []), 'model-configuration', 'learning-configuration', 'evaluation-configuration'],
    intendedWorldRecipeDomains,
    intendedWorldRecipePaths,
    heldWorldRecipeDomains,
    observe: ['world.trainXRange', 'world.testXRange', ...outcomeObservables],
  };
  if (worldDesign.mode === 'create' && worldDesign.recipe) return {
    ...common,
    interpretation: { summary: 'Create a deterministic World Recipe and materialize it through the normal World generator boundary.', ambiguity: null },
    intendedFactors: ['world-recipe'],
    change: [
      { semanticTarget: 'world-recipe', operation: worldOperationType(context, 'world.recipe.configure'), parameters: { recipe: worldDesign.recipe, seed: context.world.randomness?.seed ?? 42 } },
      { semanticTarget: 'generator-realization', operation: worldOperationType(context, 'world.generator.regenerate'), parameters: { seed: context.world.randomness?.seed ?? 42 } },
    ],
  };
  if (worldDesign.mode === 'edit' && worldDesign.patch) return {
    ...common,
    interpretation: { summary: 'Edit the current World Recipe through a bounded semantic patch and regenerate its deterministic realization.', ambiguity: null },
    intendedFactors: ['world-recipe'],
    change: [
      { semanticTarget: 'world-recipe', operation: worldOperationType(context, 'world.recipe.patch'), parameters: { patch: worldDesign.patch } },
      { semanticTarget: 'generator-realization', operation: worldOperationType(context, 'world.generator.regenerate'), parameters: { seed: context.world.randomness?.seed ?? 42 } },
    ],
  };
  throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'worldDesign', reason: 'unsupported-design' });
}

function recipeForPedagogicalDesign(design, context) {
  const recipe = context.world?.generator?.kind === 'world-recipe'
    ? context.world.generator.recipe
    : null;
  if (!recipe) return null;
  const groups = recipe.groups ?? [];
  const firstDifferentLabelPair = groups.flatMap((left, leftIndex) => groups.slice(leftIndex + 1).map((right) => ({ left, right })))
    .find(({ left, right }) => left.label !== right.label);
  if (design.goal === PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_OVERLAP) {
    if (!firstDifferentLabelPair) throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { reason: 'distinct-class-groups-required' });
    const { left, right } = firstDifferentLabelPair;
    const observationsByGroup = new Map();
    for (const point of context.world?.observations ?? []) {
      const groupId = point.generation?.groupId;
      if (!groupId || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) continue;
      if (!observationsByGroup.has(groupId)) observationsByGroup.set(groupId, []);
      observationsByGroup.get(groupId).push(point);
    }
    const labelGroupIds = new Map();
    for (const group of groups) {
      if (!labelGroupIds.has(group.label)) labelGroupIds.set(group.label, []);
      labelGroupIds.get(group.label).push(group.id);
    }
    if (labelGroupIds.size !== 2 || [...labelGroupIds.values()].some((ids) => ids.length !== 1)) {
      throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { reason: 'class-group-selection-ambiguous' });
    }
    const mean = (items) => items.length
      ? items.reduce((sum, point) => [sum[0] + Number(point.x), sum[1] + Number(point.y)], [0, 0]).map((value) => value / items.length)
      : null;
    const leftCentroid = mean(observationsByGroup.get(left.id) ?? []);
    const rightCentroid = mean(observationsByGroup.get(right.id) ?? []);
    if (!leftCentroid || !rightCentroid) throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { reason: 'class-realization-unavailable' });
    const deltaBetweenGroups = [
      leftCentroid[0] - rightCentroid[0],
      leftCentroid[1] - rightCentroid[1],
    ];
    const length = Math.hypot(...deltaBetweenGroups);
    const delta = length > 1e-9
      ? deltaBetweenGroups.map((value) => Number((value / length * 0.35).toFixed(6)))
      : [0.35, 0];
    return {
      version: 1,
      changes: [{ type: 'TRANSLATE_GROUP', groupId: right.id, split: 'all', delta }],
    };
  }
  if (design.goal === PEDAGOGICAL_EXPERIMENT_GOALS.TRAIN_TEST_SUPPORT_SHIFT) {
    const range = (membership) => {
      const values = (context.world?.observations ?? []).filter((point) => point.membership === membership).map((point) => Number(point.x)).filter(Number.isFinite);
      return values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
    };
    const trainRange = range('train');
    const testRange = range('test');
    if (!trainRange || !testRange) throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { reason: 'coverage-measurement-unavailable' });
    const before = coverageMismatch(trainRange, testRange);
    const transformLimit = groups.reduce((limit, group) => Math.min(limit, ...['train', 'test'].map((split) => {
      const current = group.splitTransforms?.[split]?.translate?.[0] ?? 0;
      return 20 - Math.abs(Number(current));
    })), 1.25);
    const magnitude = Math.max(0, Math.min(1.25, transformLimit));
    const candidates = [magnitude, -magnitude].map((delta) => ({
      delta,
      mismatch: coverageMismatch(trainRange, { min: testRange.min + delta, max: testRange.max + delta }),
    }));
    const best = candidates.sort((a, b) => b.mismatch.testOutsideTrainFraction - a.mismatch.testOutsideTrainFraction)[0];
    if (!best || magnitude <= 0 || best.mismatch.testOutsideTrainFraction <= before.testOutsideTrainFraction + 1e-6) {
      throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { reason: 'coverage-mismatch-cannot-increase' });
    }
    return {
      version: 1,
      changes: groups.map((group) => ({
        type: 'TRANSLATE_GROUP',
        groupId: group.id,
        split: 'test',
        delta: [best.delta, 0],
      })),
    };
  }
  if (design.goal === PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE) {
    const current = Number(recipe.noise?.train?.position?.amount ?? 0);
    if (current >= 5 - 1e-9) throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { reason: 'pedagogical-limit-reached' });
    return {
      version: 1,
      changes: [{ type: 'SET_NOISE', split: 'train', kind: 'position', amount: Number(Math.min(5, current + 0.08).toFixed(6)) }],
    };
  }
  if (design.goal === PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY) {
    const current = Number(recipe.noise?.train?.outliers?.fraction ?? 0);
    if (current >= 0.25 - 1e-9) throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { reason: 'pedagogical-limit-reached' });
    return {
      version: 1,
      changes: [{ type: 'SET_OUTLIERS', split: 'train', fraction: Number(Math.min(0.25, current + 0.03).toFixed(6)), placement: 'radial', distance: 2 }],
    };
  }
  throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_REQUEST', { goal: design.goal });
}

function pedagogicalObservables(design, task) {
  const outcome = task === 'classification'
    ? ['outcome.trainAccuracy', 'outcome.testAccuracy']
    : ['outcome.trainMse', 'outcome.testMse'];
  if (design.goal === PEDAGOGICAL_EXPERIMENT_GOALS.TRAIN_TEST_SUPPORT_SHIFT) {
    return ['world.trainXRange', 'world.testXRange', 'coverageMismatch', ...outcome];
  }
  return outcome;
}

export function planPedagogicalExperiment(designInput, request, context) {
  const design = validateExplorationDesign(designInput, { context });
  const currentRecipe = context.world?.generator?.kind === 'world-recipe' ? context.world.generator.recipe : null;
  const generator = context.world?.generator;
  const regeneratesWorld = Boolean(currentRecipe || generator?.kind === 'legacy-generator');
  if (regeneratesWorld && generator?.status !== 'clean') {
    return {
      kind: 'clarification',
      request,
      interpretation: { ambiguity: 'regenerate-baseline-first', messageKey: 'playground.pedagogical.regenerateBaseline' },
    };
  }
  if (design.goal === PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_OVERLAP && context.world?.task !== 'classification') {
    return {
      kind: 'clarification',
      request,
      interpretation: { ambiguity: 'classification-world-required', messageKey: 'playground.pedagogical.unsupported' },
    };
  }
  if (currentRecipe) {
    let patch;
    try {
      patch = recipeForPedagogicalDesign(design, context);
    } catch (error) {
      if (error?.code === 'EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION') {
        return {
          kind: 'clarification',
          request,
          interpretation: { ambiguity: error.details?.reason ?? 'pedagogical-intervention-unavailable', messageKey: error.details?.reason === 'pedagogical-limit-reached' ? 'playground.pedagogical.limitReached' : 'playground.pedagogical.unsupported' },
        };
      }
      throw error;
    }
    const draft = worldDesignSpec({ mode: 'edit', patch, requestedHolds: [] }, request, context);
    draft.pedagogicalDesign = design;
    draft.interpretation = { summary: 'Prepare a one-factor pedagogical experiment from the current World.', ambiguity: null };
    draft.observe = pedagogicalObservables(design, currentRecipe.task);
    draft.hold = [
      'model-configuration',
      'learning-configuration',
      'evaluation-configuration',
      'randomness-policy',
      ...(design.goal === PEDAGOGICAL_EXPERIMENT_GOALS.TRAIN_TEST_SUPPORT_SHIFT ? ['train-world'] : []),
    ];
    return { kind: 'proposal', scenario: validateScenarioSpec(draft, context), interpretation: { kind: 'exploration-design', design } };
  }

  const legacyIntent = {
    [PEDAGOGICAL_EXPERIMENT_GOALS.TRAIN_TEST_SUPPORT_SHIFT]: EXPLORATION_INTENTS.TEST_SHIFT,
    [PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE]: EXPLORATION_INTENTS.HARDER_NOISE,
    [PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY]: EXPLORATION_INTENTS.OUTLIERS,
  }[design.goal];
  if (!legacyIntent) {
    return {
      kind: 'clarification',
      request,
      interpretation: { ambiguity: 'current-world-does-not-support-goal', messageKey: 'playground.pedagogical.unsupported' },
    };
  }
  const draft = intentSpec(legacyIntent, request, context);
  draft.pedagogicalDesign = design;
  draft.interpretation = { summary: 'Prepare a one-factor pedagogical experiment from the current World.', ambiguity: null };
  draft.observe = pedagogicalObservables(design, context.world?.task);
  return { kind: 'proposal', scenario: validateScenarioSpec(draft, context), interpretation: { kind: 'exploration-design', design } };
}

export function planExplorationRequest(request, context) {
  const interpretation = interpretExplorationRequest(request);
  if (interpretation.ambiguity) return { kind: 'clarification', request, interpretation };
  const draft = intentSpec(interpretation.intent, request, context);
  if (!draft && interpretation.intent === 'line-move') {
    return {
      kind: 'clarification',
      request,
      interpretation: {
        ...interpretation,
        ambiguity: 'history-unavailable',
        message: 'I can see that the line is currently different, but I do not have a recoverable before-state for the point you mean. We can create a controlled test by preserving the current experiment and editing a duplicate.',
        choices: [],
      },
    };
  }
  return { kind: 'proposal', scenario: validateScenarioSpec(draft, context), interpretation };
}

export function planExplorationIntent(intent, request, context) {
  const draft = intentSpec(intent, request, context);
  if (!draft && intent === 'line-move') {
    return {
      kind: 'clarification',
      request,
      interpretation: {
        intent,
        ambiguity: 'history-unavailable',
        message: 'I can see that the line is currently different, but I do not have a recoverable before-state for the point you mean. We can create a controlled test by preserving the current experiment and editing a duplicate.',
        choices: [],
      },
    };
  }
  return { kind: 'proposal', scenario: validateScenarioSpec(draft, context) };
}

export function planWorldDesign(worldDesign, request, context) {
  const requiredCapability = worldDesign?.mode === 'edit' ? 'world.recipe.patch' : 'world.recipe.configure';
  const available = (context?.exploration?.worldOperations ?? []).some((operation) => operation.capability === requiredCapability && operation.agentDiscoverable !== false);
  if (!available) {
    return {
      kind: 'clarification',
      request,
      interpretation: { kind: 'world-design', ambiguity: 'world-composer-unavailable', message: 'This attached model cannot edit World recipes through the current runtime. Open the Data Lab or choose a model with World editing support first.', choices: [] },
    };
  }
  const draft = worldDesignSpec(worldDesign, request, context);
  return { kind: 'proposal', scenario: validateScenarioSpec(draft, context), interpretation: { kind: 'world-design', mode: worldDesign.mode } };
}
