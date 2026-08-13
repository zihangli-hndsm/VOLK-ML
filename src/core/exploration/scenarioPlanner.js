import { conditionFingerprintForSession } from './observables.js';
import { interpretExplorationRequest } from './explorationInterpreter.js';
import { scenarioError, validateScenarioSpec } from './scenarioSpec.js';

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

function generatorChanges(context, target) {
  if (context.world?.generator?.spec) {
    if (target === 'test-shift' || target === 'two-distributions') {
      const test = context.world.generator.spec.test.input.params;
      const min = Number(test.min ?? -1);
      const max = Number(test.max ?? 1);
      const shift = Math.max(1, max - min);
      return [
        { semanticTarget: 'test-input-support', operation: 'SET_GENERATOR_PARAMETER', parameters: { path: 'test.input.params.min', value: min + shift * 1.5 } },
        { semanticTarget: 'test-input-support', operation: 'SET_GENERATOR_PARAMETER', parameters: { path: 'test.input.params.max', value: max + shift * 1.5 } },
        { semanticTarget: 'test-input-support', operation: 'REGENERATE_WORLD', parameters: { seed: context.world.randomness?.seed ?? 42 } },
      ];
    }
    if (target === 'harder-noise') {
      return [
        { semanticTarget: 'noise', operation: 'SET_GENERATOR_PARAMETER', parameters: { path: 'noise.amount', value: Number(context.world.generator.spec.noise.amount ?? 0) + 0.5 } },
        { semanticTarget: 'noise', operation: 'REGENERATE_WORLD', parameters: { seed: context.world.randomness?.seed ?? 42 } },
      ];
    }
  }
  const testIds = context.world?.observations?.filter((point) => point.membership === 'test').map((point) => point.id) ?? [];
  if (testIds.length) {
    return [{ semanticTarget: 'test-input-support', operation: 'TRANSFORM_FEATURE_VALUES', parameters: { feature: context.world.featureNames[0], kind: 'shift', amount: 2, pointIds: testIds, scope: 'test-observations' } }];
  }
  const fallbackTestIds = context.world?.observations?.slice(-Math.max(1, Math.floor((context.world.observations.length || 1) / 5))).map((point) => point.id) ?? [];
  if (!fallbackTestIds.length) throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { reason: 'test-observations-required' });
  return [
    { semanticTarget: 'existing-train-test-setup', operation: 'SET_TRAIN_TEST_MEMBERSHIP', parameters: { pointIds: fallbackTestIds, membership: 'test' } },
    { semanticTarget: 'test-input-support', operation: 'TRANSFORM_FEATURE_VALUES', parameters: { feature: context.world.featureNames[0], kind: 'shift', amount: 2, pointIds: fallbackTestIds, scope: 'test-observations' } },
  ];
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
    fidelity: { status: 'exact', represented: [], missing: [], approximations: [] },
  };
  if (intent === 'outliers') return {
    ...common,
    interpretation: { summary: 'Add two bounded outlier observations to a duplicate while keeping model and learning settings fixed.', ambiguity: null },
    change: [{ semanticTarget: 'outliers', operation: 'ADD_POINTS', parameters: { points: outlierPoints(context) } }],
    hold: ['model-configuration', 'learning-configuration', 'latent-relation', 'noise', 'existing-train-test-setup'],
    observe: ['model.slope', 'outcome.trainMse', 'outcome.testMse', 'slopeDifference'],
  };
  if (intent === 'test-shift' || intent === 'two-distributions') return {
    ...common,
    interpretation: { summary: intent === 'test-shift' ? 'Move Test input support away from Train input support.' : 'Compare the current input distribution with a shifted Test distribution.', ambiguity: null },
    change: generatorChanges(context, intent),
    hold: ['model-configuration', 'learning-configuration', 'latent-relation', 'noise', 'train-distribution'],
    observe: ['world.trainXRange', 'world.testXRange', 'coverageMismatch', 'outcome.trainMse', 'outcome.testMse', 'generalizationGap'],
  };
  if (intent === 'harder-noise') return {
    ...common,
    interpretation: { summary: 'Increase observation noise while holding the model configuration fixed.', ambiguity: null },
    change: generatorChanges(context, intent),
    hold: ['model-configuration', 'learning-configuration', 'latent-relation'],
    observe: ['world.generatorNoise', 'model.slope', 'outcome.trainMse', 'outcome.testMse'],
  };
  if (intent === 'line-move') return {
    ...common,
    interpretation: { summary: 'Compare the current fit against a duplicate with the most recently edited observation restored when a baseline is available.', ambiguity: null },
    change: [{ semanticTarget: 'observation-values', operation: 'ADD_POINTS', parameters: { points: outlierPoints(context).slice(0, 1) } }],
    hold: ['model-configuration', 'learning-configuration', 'latent-relation', 'noise'],
    observe: ['model.slope', 'model.bias', 'outcome.trainMse', 'outcome.testMse', 'slopeDifference'],
  };
  throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_REQUEST', { intent });
}

export function planExplorationRequest(request, context) {
  const interpretation = interpretExplorationRequest(request);
  if (interpretation.ambiguity) return { kind: 'clarification', request, interpretation };
  const draft = intentSpec(interpretation.intent, request, context);
  return { kind: 'proposal', scenario: validateScenarioSpec(draft, context), interpretation };
}

export function planExplorationIntent(intent, request, context) {
  return { kind: 'proposal', scenario: validateScenarioSpec(intentSpec(intent, request, context), context) };
}
