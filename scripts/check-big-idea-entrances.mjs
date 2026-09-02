import assert from 'node:assert/strict';
import { messages, languages } from '../src/locales/ui.js';
import { resolveMessage } from '../src/i18n.js';
import { createPlaygroundAgentApi } from '../src/core/playgroundAgent.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import {
  BIG_IDEA_VERSION,
  getBigIdeaEntrance,
  listBigIdeaEntrances,
  validateBigIdeaEntrance,
} from '../src/core/exploration/bigIdeaRegistry.js';
import { getModelAdapter } from '../src/core/playground/model/modelRegistry.js';
import { getPlayground } from '../src/core/playgrounds/registry.js';

const entries = listBigIdeaEntrances();
const expectedIds = [
  'episode-1-sampling-variability',
  'finding-patterns',
  'noise-robustness',
  'generalization',
  'distribution-shift',
  'model-capacity',
];
assert.deepEqual(entries.map((entry) => entry.id), expectedIds, 'Phase 7 registry ids are stable');
assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length, 'registry ids are unique');
assert.equal(JSON.stringify(entries), JSON.stringify(listBigIdeaEntrances()), 'registry declarations are deterministic');
assert.doesNotThrow(() => JSON.stringify(entries), 'registry is JSON-safe');

for (const entry of entries) {
  assert.equal(entry.version, BIG_IDEA_VERSION);
  assert.equal(validateBigIdeaEntrance(entry), true);
  for (const key of [entry.titleKey, entry.summaryKey, entry.questionKey]) {
    assert.ok(messages[key], `localization metadata exists for ${key}`);
    for (const language of languages) {
      assert.equal(typeof messages[key][language.code], 'string', `${key} resolves in ${language.code}`);
      assert.ok(resolveMessage(key, language.code), `${key} has visible copy in ${language.code}`);
    }
  }
  assert.ok(getPlayground(entry.startingPoint.playgroundId), `${entry.id} playground exists`);
  assert.ok(getModelAdapter(entry.startingPoint.modelAdapterId), `${entry.id} model adapter exists`);
}

const open = async (id) => {
  const host = createPlaygroundHost({ getDataset: () => null });
  const agent = createPlaygroundAgentApi(host);
  const snapshot = await agent.openBigIdeaEntrance({ id });
  return { host, agent, snapshot };
};

const openWithSeed = async (id, seed) => {
  const host = createPlaygroundHost({ getDataset: () => null });
  const agent = createPlaygroundAgentApi(host);
  const snapshot = await agent.openBigIdeaEntrance({ id, seed });
  return { host, agent, snapshot };
};

for (const entry of entries) {
  const first = await open(entry.id);
  assert.equal(first.snapshot.bigIdea.id, entry.id);
  assert.equal(first.snapshot.bigIdea.version, BIG_IDEA_VERSION);
  assert.ok(first.snapshot.experimentWorkspace, `${entry.id} has a normal Experiment Workspace`);
  assert.ok(first.snapshot.world, `${entry.id} has a normal World`);
  assert.equal(first.snapshot.explorationThreads.length, 0, `${entry.id} does not auto-create a Thread`);
  const context = first.agent.inspectContext();
  assert.deepEqual(context.exploration.bigIdea, first.snapshot.bigIdea, `${entry.id} inspection matches runtime provenance`);
  const available = new Set([
    ...Object.keys(first.snapshot.observables ?? {}),
    ...Object.keys(first.snapshot.derivedObservables ?? {}),
  ]);
  for (const observableId of entry.focus.observables) assert.ok(available.has(observableId), `${entry.id} exposes ${observableId}`);

  const second = await open(entry.id);
  assert.deepEqual(second.snapshot.world, first.snapshot.world, `${entry.id} default seed is deterministic`);
  assert.deepEqual(second.snapshot.controls, first.snapshot.controls, `${entry.id} controls are deterministic`);
}

// The caller override is the one effective seed authority for entrance-owned
// regeneration. Assert the generated condition, not only session.seed.
{
  const defaultA = await open('distribution-shift');
  const defaultB = await open('distribution-shift');
  assert.deepEqual(defaultA.snapshot.world, defaultB.snapshot.world, 'default entrance seed reproduces the same World');

  const seededC = await openWithSeed('distribution-shift', 123);
  const seededD = await openWithSeed('distribution-shift', 456);
  assert.notDeepEqual(seededC.snapshot.world.observations, seededD.snapshot.world.observations, 'different effective seeds produce different observations');
  for (const { snapshot, seed } of [{ snapshot: seededC.snapshot, seed: 123 }, { snapshot: seededD.snapshot, seed: 456 }]) {
    assert.equal(snapshot.seed, seed);
    assert.equal(snapshot.world.generator.seed, seed);
    assert.equal(snapshot.world.generator.realization.seed, seed);
    assert.equal(snapshot.world.randomness.seed, seed);
  }
  assert.notEqual(seededC.agent.inspectContext().conditionFingerprint, seededD.agent.inspectContext().conditionFingerprint, 'condition fingerprint follows generated World identity');
}

// The primary acceptance vertical works without an AI provider and uses the
// same World, Run, Duplicate, and Compare actions as ordinary Free Explore.
{
  const { agent } = await open('distribution-shift');
  const initial = agent.inspectContext();
  assert.equal(initial.playground.id, 'data-lab');
  assert.equal(initial.playground.modelAdapter, 'knn');
  assert.deepEqual(initial.world.featureNames, ['x', 'y']);
  assert.equal(agent.getState().viewState.xFeature, 'x', 'generated recipe synchronizes the visible x projection');
  assert.equal(agent.getState().viewState.yFeature, 'y', 'generated recipe synchronizes the visible y projection');
  assert.equal(agent.getState().viewState.boundsMode, 'auto', 'feature synchronization refits the generated World');
  assert.equal(initial.world.generator.kind, 'world-recipe');
  assert.equal(initial.world.generator.recipe.groups.every((group) => group.shape.type === 'ring' || group.shape.type === 'blob'), true);
  assert.equal(initial.world.generator.recipe.groups.every((group) => group.splitTransforms.test.translate[0] === 1.6 && group.splitTransforms.test.translate[1] === 0.8), true);
  assert.ok(initial.world.observations.some((point) => point.membership === 'train'));
  assert.ok(initial.world.observations.some((point) => point.membership === 'test'));
  const initialSnapshot = agent.getState();
  const xs = initial.world.observations.map((point) => point.x);
  const ys = initial.world.observations.map((point) => point.y);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 1, 'distribution shift spans the x axis');
  assert.ok(Math.max(...ys) - Math.min(...ys) > 1, 'distribution shift is a two-dimensional cloud, not a line');
  assert.ok(initialSnapshot.metrics.trainAccuracy >= 0.95);
  assert.ok(initialSnapshot.metrics.testAccuracy <= 0.65);
  assert.ok(initialSnapshot.metrics.trainAccuracy - initialSnapshot.metrics.testAccuracy >= 0.25);
  const baseline = await agent.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
  const baselineId = baseline.experimentWorkspace.experiments[0].id;
  const beforeRange = baseline.derivedObservables.coverageMismatch.value;
  let changed = await agent.dispatch({
    type: 'APPLY_WORLD_TRANSACTION',
    transaction: {
      id: 'phase-7-distribution-shift-manual-test-intervention',
      intent: 'manual-test-support',
      operations: [
        { type: 'PATCH_WORLD_RECIPE', patch: { version: 1, changes: [{ type: 'TRANSLATE_GROUP', groupId: 'outer-ring', split: 'test', delta: [0.2, 0] }] } },
        { type: 'REGENERATE_WORLD', seed: 7104 },
      ],
    },
  });
  assert.notDeepEqual(changed.derivedObservables.coverageMismatch.value, beforeRange, 'Test intervention changes semantic coverage');
  changed = await agent.dispatch({ type: 'RUN' });
  assert.equal(changed.observables['outcome.testAccuracy'].available, true, 'Run updates Test evidence');
  changed = await agent.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: baselineId });
  assert.equal(changed.experimentWorkspace.comparison.enabled, true);
  assert.ok(changed.experimentWorkspace.comparison.diff.changed.includes('world'), 'Compare identifies the World/train-test change');
}

// Divergence is immediate and valid: the entrance is provenance, not a
// controller that reapplies its defaults after the learner acts.
{
  const { agent } = await open('finding-patterns');
  const point = agent.getState().world.observations[0];
  const moved = await agent.dispatch({
    type: 'APPLY_WORLD_TRANSACTION',
    transaction: {
      id: 'phase-7-immediate-divergence',
      intent: 'immediate-divergence',
      operations: [{ type: 'MOVE_POINT', pointId: point.id, x: point.x + 0.25, y: point.y + 0.25 }],
    },
  });
  const movedPoint = moved.world.observations.find((candidate) => candidate.id === point.id);
  assert.equal(movedPoint.x, point.x + 0.25);
  assert.equal(moved.bigIdea.id, 'finding-patterns');
}

// Restart is explicit: it replaces the experiment with the canonical
// deterministic starting condition and never creates a Thread.
{
  const { agent, snapshot: initial } = await open('distribution-shift');
  const point = initial.world.observations[0];
  await agent.dispatch({
    type: 'APPLY_WORLD_TRANSACTION',
    transaction: {
      id: 'phase-7-restart-mutation',
      intent: 'restart-regression',
      operations: [{ type: 'MOVE_POINT', pointId: point.id, x: point.x + 1, y: point.y + 1 }],
    },
  });
  const restarted = await agent.restartBigIdeaEntrance({ id: 'distribution-shift' });
  assert.deepEqual(restarted.world, initial.world, 'Restart restores the deterministic entrance World');
  assert.equal(restarted.bigIdea.id, 'distribution-shift');
  assert.equal(restarted.experimentWorkspace.experiments.length, 1, 'Restart creates a fresh active experiment');
  assert.equal(restarted.explorationThreads.length, 0, 'Restart does not auto-create a Thread');
  const beforeFailedRestart = agent.getState();
  await assert.rejects(() => agent.restartBigIdeaEntrance({ id: 'distribution-shift', seed: 'bad-seed' }), /INVALID_BIG_IDEA_ENTRANCE/);
  assert.deepEqual(agent.getState().world, beforeFailedRestart.world, 'failed restart preserves the active session');
}

// Thread integration is explicit and uses the Phase 6 authority contract.
{
  const { agent } = await open('distribution-shift');
  assert.equal(agent.getState().explorationThreads.length, 0);
  const question = resolveMessage('bigIdea.distributionShift.question', 'en');
  const snapshot = agent.createExplorationThread({
    title: resolveMessage('bigIdea.distributionShift.title', 'en'),
    question,
    source: 'big-idea:distribution-shift',
  });
  const entry = snapshot.activeExplorationThread.entries[0];
  assert.equal(entry.kind, 'question');
  assert.equal(entry.text, question);
  assert.equal(entry.source, 'big-idea:distribution-shift');
  assert.equal(snapshot.activeExplorationThread.entries.filter((item) => item.kind !== 'question').length, 0);
}

// Model Capacity exposes the actual MLP hidden-unit control and does not fake
// a cross-adapter comparison.
{
  const { agent } = await open('model-capacity');
  assert.equal(agent.getState().playgroundId, 'mlp-classification');
  assert.equal(agent.getState().modelPlaygroundId, 'mlp-classification');
  assert.equal(agent.getState().controls.hiddenUnits, 2);
  const changed = await agent.dispatch({ type: 'SET_CONTROL', key: 'hiddenUnits', value: 4 });
  assert.equal(changed.controls.hiddenUnits, 4);
  assert.equal(changed.observables['model.hiddenUnits'].value, 4, 'the observable follows the real capacity control');
  const rerun = await agent.dispatch({ type: 'RUN' });
  assert.equal(rerun.observables['model.hiddenUnits'].value, 4);
}

// Existing direct model entry remains additive and independent of the catalog.
{
  const host = createPlaygroundHost({ getDataset: () => null });
  const agent = createPlaygroundAgentApi(host);
  const snapshot = await agent.open({ playgroundId: 'linear-regression', seed: 42 });
  assert.equal(snapshot.playgroundId, 'linear-regression');
}

const invalidPlayground = getBigIdeaEntrance('finding-patterns');
invalidPlayground.startingPoint.playgroundId = 'missing';
assert.throws(() => validateBigIdeaEntrance(invalidPlayground), /INVALID_BIG_IDEA_ENTRANCE/);
const invalidControl = getBigIdeaEntrance('model-capacity');
invalidControl.startingPoint.controls.hiddenUnits = 99;
assert.throws(() => validateBigIdeaEntrance(invalidControl), /INVALID_BIG_IDEA_ENTRANCE/);
const invalidObservable = getBigIdeaEntrance('finding-patterns');
invalidObservable.focus.observables.push('hidden.runtime.secret');
assert.throws(() => validateBigIdeaEntrance(invalidObservable), /INVALID_BIG_IDEA_ENTRANCE/);

const assertInvalid = (entry, label) => {
  assert.throws(() => validateBigIdeaEntrance(entry), /INVALID_BIG_IDEA_ENTRANCE/, label);
};
const invalidAttach = getBigIdeaEntrance('finding-patterns');
invalidAttach.startingPoint.setup[0].modelPlaygroundId = 'missing-model-playground';
assertInvalid(invalidAttach, 'unknown ATTACH_MODEL playground is rejected');
const mismatchedAttach = getBigIdeaEntrance('finding-patterns');
mismatchedAttach.startingPoint.setup[0].modelPlaygroundId = 'mlp-classification';
assertInvalid(mismatchedAttach, 'ATTACH_MODEL adapter mismatch is rejected');
const invalidSetupControlKey = getBigIdeaEntrance('model-capacity');
invalidSetupControlKey.startingPoint.setup = [{ type: 'SET_CONTROL', key: 'missing-control', value: 1 }];
assertInvalid(invalidSetupControlKey, 'unknown setup control is rejected');
const invalidSetupControlValue = getBigIdeaEntrance('model-capacity');
invalidSetupControlValue.startingPoint.setup = [{ type: 'SET_CONTROL', key: 'hiddenUnits', value: 99 }];
assertInvalid(invalidSetupControlValue, 'invalid setup control value is rejected');
const invalidAffordance = getBigIdeaEntrance('finding-patterns');
invalidAffordance.focus.affordances.push('idea.invented');
assertInvalid(invalidAffordance, 'unknown focus affordance is rejected');
const invalidWorldOperation = getBigIdeaEntrance('finding-patterns');
invalidWorldOperation.startingPoint.setup[1].transaction.operations[0] = { type: 'INVENTED_WORLD_OPERATION' };
assertInvalid(invalidWorldOperation, 'unknown setup World operation is rejected');
const invalidGenerator = getBigIdeaEntrance('finding-patterns');
invalidGenerator.startingPoint.setup[1].transaction.operations[0].spec.noise.amount = -1;
assertInvalid(invalidGenerator, 'invalid generator spec is rejected');
const invalidRegenerationSeed = getBigIdeaEntrance('finding-patterns');
invalidRegenerationSeed.startingPoint.setup[1].transaction.operations[1].seed = 'not-a-seed';
assertInvalid(invalidRegenerationSeed, 'invalid regeneration seed is rejected');
const malformedSetup = getBigIdeaEntrance('model-capacity');
malformedSetup.startingPoint.setup = [{ type: 'RUN', unexpected: true }];
assertInvalid(malformedSetup, 'malformed setup action is rejected');

// A caller-supplied invalid seed fails before the host commits a candidate.
{
  const failedHost = createPlaygroundHost({ getDataset: () => null });
  const failedAgent = createPlaygroundAgentApi(failedHost);
  await assert.rejects(() => failedAgent.openBigIdeaEntrance({ id: 'distribution-shift', seed: 'not-a-seed' }), /INVALID_BIG_IDEA_ENTRANCE/);
  assert.throws(() => failedAgent.getState(), /PLAYGROUND_NOT_OPEN/);
}

console.log('Big Idea entrance checks passed: registry, localization, semantic initialization, deterministic seeds, Distribution Shift manual parity, Compare evidence, immediate divergence, explicit Threads, Model Capacity control, Agent inspection, Agent-off operation, and direct-entry regression.');
