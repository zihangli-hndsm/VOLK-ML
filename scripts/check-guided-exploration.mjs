import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createWorld } from '../src/core/exploration/world.js';
import { applyWorldTransaction } from '../src/core/exploration/operations.js';
import { normalizeGeneratorSpec } from '../src/core/exploration/generator.js';
import {
  conditionFingerprintForSession,
  coverageMismatch,
  deriveObservableSet,
  isRepeatEvidenceCurrent,
} from '../src/core/exploration/observables.js';
import { detectObservations } from '../src/core/exploration/observationDetectors.js';
import { AFFORDANCE_IDS, EXPLORATION_RECIPES, THINGS_TO_TRY } from '../src/core/exploration/guidedExploration.js';

const coverageCases = [
  [[-1, 1], [-1, 1], 0, 0],
  [[-1, 1], [-0.5, 0.5], 0, 0.5],
  [[-2, 2], [-1, 1], 0, 0.5],
  [[-1, 1], [-2, 0], 0.5, 0.5],
  [[-1, 1], [0, 2], 0.5, 0.5],
  [[-1, 1], [3, 5], 1, 1],
  [[1, 1], [1, 1], 0, 0],
  [[-1, 1], [0, 0], 0, 1],
  [[-1, 1], [2, 2], 1, 1],
  [[0, 0], [-1, 1], 1, 0],
  [[2, 2], [-1, 1], 1, 1],
];
for (const [[trainMin, trainMax], [testMin, testMax], expectedTestOutside, expectedTrainOutside] of coverageCases) {
  const value = coverageMismatch({ min: trainMin, max: trainMax }, { min: testMin, max: testMax });
  assert.equal(value.testOutsideTrainFraction, expectedTestOutside);
  assert.equal(value.trainOutsideTestFraction, expectedTrainOutside);
  for (const numeric of [value.overlapWidth, value.overlapFractionOfTrain, value.overlapFractionOfTest, value.testOutsideTrainFraction, value.trainOutsideTestFraction]) {
    assert.ok(Number.isFinite(numeric), 'coverage fields stay finite for interval and point ranges');
  }
}

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
const pointCoverageEvidence = deriveObservableSet({
  world: createWorld({ observations: [
    { id: 'train', x: -1, y: 0, membership: 'train' },
    { id: 'test', x: 0, y: 0, membership: 'test' },
  ] }),
  result: { metrics: { trainMse: 1, testMse: 1 } },
});
assert.equal(pointCoverageEvidence.derived.coverageMismatch.value.testOutsideTrainFraction, 1);
assert.equal(detectObservations({ observables: pointCoverageEvidence }).some((item) => item.id === 'COVERAGE_MISMATCH'), true);
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
  assert.equal(typeof firstRepeat.repeatEvidence.conditionFingerprint, 'string');
  assert.equal(firstRepeat.derivedObservables.repeatSlopeSpread.available, true);
  assert.equal(isRepeatEvidenceCurrent(firstRepeat.repeatEvidence, firstRepeat.repeatEvidence.conditionFingerprint), true);
  const changedWorld = await host.dispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction: {
    id: 'guided-host-change-noise', actor: 'human', intent: 'world-generator',
    operations: [{ type: 'SET_GENERATOR_PARAMETER', path: 'noise.amount', value: 0.8 }],
  } });
  assert.equal(changedWorld.repeatEvidence, null, 'stale Repeat evidence is hidden after a semantic World change');
  assert.equal(changedWorld.derivedObservables.repeatSlopeSpread.available, false);
  assert.equal(changedWorld.observations.some((item) => item.id === 'REPEAT_VARIATION'), false);
  const staleContext = host.inspectContext();
  assert.equal(staleContext.repeatEvidence, null, 'Agent inspection does not expose stale Repeat evidence');
  assert.equal(staleContext.derivedObservables.repeatSlopeSpread.available, false);
  assert.equal(staleContext.exploration.repeatEvidence, null);
  await host.dispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction: {
    id: 'guided-host-regenerate-noise', actor: 'human', intent: 'regenerate-world',
    operations: [{ type: 'REGENERATE_WORLD', seed: 42 }],
  } });
  await host.dispatch({ type: 'RUN' });
  const refreshedRepeat = await host.dispatch({ type: 'REPEAT_EXPERIMENT', trials: 2 });
  assert.notEqual(refreshedRepeat.repeatEvidence.conditionFingerprint, firstRepeat.repeatEvidence.conditionFingerprint);
  assert.equal(refreshedRepeat.derivedObservables.repeatSlopeSpread.available, true);
  const changedLearning = await host.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.1 });
  assert.equal(changedLearning.repeatEvidence, null, 'stale Repeat evidence is hidden after a semantic learning-control change');
  assert.equal(changedLearning.derivedObservables.repeatSlopeSpread.available, false);
  const controlRepeat = await host.dispatch({ type: 'REPEAT_EXPERIMENT', trials: 2 });
  const unchangedFingerprint = controlRepeat.repeatEvidence.conditionFingerprint;
  const presentationOnly = await host.dispatch({ type: 'SET_VISUAL', patch: { highlight: 'test-support' } });
  assert.equal(presentationOnly.repeatEvidence.conditionFingerprint, unchangedFingerprint, 'presentation state does not invalidate semantic evidence');
  await assert.rejects(() => host.dispatch({ type: 'REPEAT_EXPERIMENT', trials: 1 }), (error) => error.code === 'INVALID_PLAYGROUND_ACTION');
  await assert.rejects(() => host.dispatch({ type: 'REPEAT_EXPERIMENT', trials: 21 }), (error) => error.code === 'INVALID_PLAYGROUND_ACTION');
  const context = host.inspectContext();
  assert.deepEqual(context.observables, presentationOnly.observables);
  assert.deepEqual(context.derivedObservables, presentationOnly.derivedObservables);
  assert.deepEqual(context.observations, presentationOnly.observations);
  assert.deepEqual(context.repeatEvidence, presentationOnly.repeatEvidence);
  assert.deepEqual(context.exploration.observables, presentationOnly.observables);
  assert.deepEqual(context.exploration.derivedObservables, presentationOnly.derivedObservables);
  assert.deepEqual(context.recipes, EXPLORATION_RECIPES);
  assert.deepEqual(context.thingsToTry, THINGS_TO_TRY);
  assert.deepEqual(context.affordances, AFFORDANCE_IDS);
  assert.deepEqual(context.exploration.recipes, EXPLORATION_RECIPES);
  assert.deepEqual(context.exploration.thingsToTry, THINGS_TO_TRY);
  assert.deepEqual(context.exploration.affordances, AFFORDANCE_IDS);
  await assert.rejects(() => host.dispatch({ type: 'REPEAT_EXPERIMENT', trials: 0 }), (error) => error.code === 'INVALID_PLAYGROUND_ACTION');
} finally {
  await host.close();
}

assert.equal(THINGS_TO_TRY.length, 5);
assert.equal(EXPLORATION_RECIPES.length, 2);
assert.ok(EXPLORATION_RECIPES.every((recipe) => recipe.setup?.spec && recipe.affordances.length));
assert.ok(EXPLORATION_RECIPES.every((recipe) => recipe.affordances.every((id) => AFFORDANCE_IDS.includes(id))));
assert.ok(EXPLORATION_RECIPES.every((recipe) => recipe.relevantObservableIds?.length));
const realObservableIds = new Set([...Object.keys(evidence.raw), ...Object.keys(evidence.derived)]);
assert.ok(EXPLORATION_RECIPES.every((recipe) => recipe.relevantObservableIds.every((id) => (
  realObservableIds.has(id)
))));
const identityWorld = createWorld({ observations: [{ id: 'p', x: 0, y: 0, membership: 'train' }] });
const identityA = conditionFingerprintForSession({ world: identityWorld, adapterId: 'linear-regression', controls: { learningRate: 0.1 }, experiment: { id: 'A', model: { adapterId: 'linear-regression' } } });
const identityB = conditionFingerprintForSession({ world: identityWorld, adapterId: 'linear-regression', controls: { learningRate: 0.1 }, experiment: { id: 'B', model: { adapterId: 'linear-regression' } } });
assert.equal(identityA, identityB, 'experiment identity is not part of semantic condition fingerprint');
const differentAdapter = conditionFingerprintForSession({ world: identityWorld, adapterId: 'knn', controls: { learningRate: 0.1 }, experiment: { id: 'A', model: { adapterId: 'knn' } } });
assert.notEqual(identityA, differentAdapter, 'model adapter identity is part of semantic condition fingerprint');
console.log('Guided Exploration checks passed: raw/derived observables, unavailable evidence, factual detectors, coverage mismatch, deterministic bounded Repeat, non-mutating active state, Agent inspection parity, and recipe registries.');
