import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createWorld } from '../src/core/exploration/world.js';
import { applyWorldTransaction } from '../src/core/exploration/operations.js';
import { normalizeGeneratorSpec } from '../src/core/exploration/generator.js';
import { deriveObservableSet } from '../src/core/exploration/observables.js';
import { detectObservations } from '../src/core/exploration/observationDetectors.js';
import { EXPLORATION_RECIPES, THINGS_TO_TRY } from '../src/core/exploration/guidedExploration.js';

const spec = normalizeGeneratorSpec({
  relation: { slope: 2, bias: 1 }, noise: { amount: 0.5 },
  train: { input: { type: 'uniform', params: { min: -1, max: 1 } }, samples: 30 },
  test: { input: { type: 'uniform', params: { min: 3, max: 5 } }, samples: 20 }, outliers: { count: 0 },
});
const source = createWorld({ id: 'guided-world', task: 'regression', featureNames: ['x', 'y'], observations: [
  { id: 'train-1', x: -1, y: -1, membership: 'train' }, { id: 'train-2', x: 1, y: 1, membership: 'train' },
  { id: 'test-1', x: 3, y: 3, membership: 'test' }, { id: 'test-2', x: 5, y: 5, membership: 'test' },
] });
const generated = applyWorldTransaction(source, {
  id: 'guided-generate', actor: 'human', intent: 'generate',
  operations: [{ type: 'SET_WORLD_GENERATOR', spec }, { type: 'REGENERATE_WORLD', seed: 42 }],
}).world;

const evidence = deriveObservableSet({
  world: generated,
  result: { model: { weight: 2, bias: 1, trainingStep: 20 }, metrics: { trainMse: 1, testMse: 4 } },
});
assert.equal(evidence.raw['world.trainSampleCount'].value, 30);
assert.equal(evidence.raw['world.testSampleCount'].value, 20);
assert.equal(evidence.raw['world.trainXRange'].value.count, 30);
assert.ok(evidence.raw['world.trainXRange'].value.min >= -1 && evidence.raw['world.trainXRange'].value.max <= 1);
assert.equal(evidence.derived.generalizationGap.value, 3);
assert.equal(evidence.derived.coverageMismatch.value.testOutsideTrainFraction, 1);
assert.equal(evidence.raw['model.slope'].value, 2);
assert.equal(evidence.raw['outcome.testMse'].value, 4);
const unavailable = deriveObservableSet({ world: generated, result: null });
assert.equal(unavailable.raw['model.slope'].available, false);
assert.equal(unavailable.raw['outcome.testMse'].available, false);

const baselineEvidence = deriveObservableSet({
  world: generated,
  result: { model: { weight: 2, bias: 1 }, metrics: { trainMse: 1, testMse: 1 } },
});
const changedEvidence = deriveObservableSet({
  world: generated,
  result: { model: { weight: 1, bias: 1 }, metrics: { trainMse: 1.1, testMse: 4 } },
});
const notices = detectObservations({
  observables: changedEvidence,
  comparisonObservables: baselineEvidence,
  comparison: { diff: { changed: ['world', 'learning'], clarity: 'mixed' }, experimentIds: ['A', 'B'] },
});
assert.deepEqual(notices.map((item) => item.id), ['MIXED_COMPARISON', 'TEST_ERROR_CHANGED_MORE', 'GENERALIZATION_GAP_INCREASED', 'COVERAGE_MISMATCH', 'SLOPE_MOVED_STRONGLY']);
assert.ok(notices.every((item) => !String(item.messageKey).includes('cause')));
assert.equal(detectObservations({ observables: changedEvidence, comparisonObservables: baselineEvidence, comparison: { diff: { changed: ['world'], clarity: 'high' } } }).some((item) => item.id === 'MIXED_COMPARISON'), false);

const host = createPlaygroundHost({ getDataset: () => null });
try {
  await host.open({ playgroundId: 'data-lab', seed: 42 });
  await host.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: 'linear-regression' });
  await host.dispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction: {
    id: 'guided-host-generate', actor: 'human', intent: 'generate',
    operations: [{ type: 'SET_WORLD_GENERATOR', spec }, { type: 'REGENERATE_WORLD', seed: 42 }],
  } });
  await host.dispatch({ type: 'RUN' });
  const before = host.getState();
  const beforeWorld = structuredClone(before.world);
  const beforeExperimentId = before.experiment.id;
  const beforeWorkspace = structuredClone(before.experimentWorkspace);
  const firstRepeat = await host.dispatch({ type: 'REPEAT_EXPERIMENT', trials: 5 });
  assert.equal(firstRepeat.repeatEvidence.trialCount, 5);
  assert.deepEqual(firstRepeat.repeatEvidence.trials.map((trial) => trial.seed), [42, 43, 44, 45, 46]);
  assert.deepEqual(firstRepeat.world, beforeWorld, 'repeat does not replace active World');
  assert.equal(firstRepeat.experiment.id, beforeExperimentId, 'repeat does not replace active Experiment');
  assert.deepEqual(firstRepeat.world.generator.spec, beforeWorld.generator.spec, 'repeat does not replace desired generator spec');
  assert.deepEqual(firstRepeat.experimentWorkspace.experiments, beforeWorkspace.experiments);
  const secondRepeat = await host.dispatch({ type: 'REPEAT_EXPERIMENT', trials: 5 });
  assert.deepEqual(secondRepeat.repeatEvidence, firstRepeat.repeatEvidence, 'repeat is reproducible');
  await assert.rejects(() => host.dispatch({ type: 'REPEAT_EXPERIMENT', trials: 1 }), (error) => error.code === 'INVALID_PLAYGROUND_ACTION');
  await assert.rejects(() => host.dispatch({ type: 'REPEAT_EXPERIMENT', trials: 21 }), (error) => error.code === 'INVALID_PLAYGROUND_ACTION');
  const context = host.inspectContext();
  assert.deepEqual(context.observables, secondRepeat.observables);
  assert.deepEqual(context.derivedObservables, secondRepeat.derivedObservables);
  assert.deepEqual(context.observations, secondRepeat.observations);
  assert.deepEqual(context.repeatEvidence, secondRepeat.repeatEvidence);
  assert.deepEqual(context.exploration.observables, secondRepeat.observables);
  assert.deepEqual(context.exploration.derivedObservables, secondRepeat.derivedObservables);
  await assert.rejects(() => host.dispatch({ type: 'REPEAT_EXPERIMENT', trials: 0 }), (error) => error.code === 'INVALID_PLAYGROUND_ACTION');
} finally {
  await host.close();
}

assert.equal(THINGS_TO_TRY.length, 5);
assert.equal(EXPLORATION_RECIPES.length, 2);
assert.ok(EXPLORATION_RECIPES.every((recipe) => recipe.setup?.spec && recipe.affordances.length));
console.log('Guided Exploration checks passed: raw/derived observables, unavailable evidence, factual detectors, coverage mismatch, deterministic bounded Repeat, non-mutating active state, Agent inspection parity, and recipe registries.');
