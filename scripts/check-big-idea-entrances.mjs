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

// The primary acceptance vertical works without an AI provider and uses the
// same World, Run, Duplicate, and Compare actions as ordinary Free Explore.
{
  const { agent } = await open('distribution-shift');
  const initial = agent.inspectContext();
  assert.equal(initial.playground.id, 'data-lab');
  assert.equal(initial.playground.modelAdapter, 'linear-regression');
  assert.ok(initial.world.observations.some((point) => point.membership === 'train'));
  assert.ok(initial.world.observations.some((point) => point.membership === 'test'));
  const baseline = await agent.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
  const baselineId = baseline.experimentWorkspace.experiments[0].id;
  const beforeRange = baseline.derivedObservables.coverageMismatch.value;
  let changed = await agent.dispatch({
    type: 'APPLY_WORLD_TRANSACTION',
    transaction: {
      id: 'phase-7-distribution-shift-manual-test-intervention',
      intent: 'manual-test-support',
      operations: [
        { type: 'SET_GENERATOR_PARAMETER', path: 'test.input.params.min', value: 1.2 },
        { type: 'REGENERATE_WORLD', seed: 7104 },
      ],
    },
  });
  assert.notDeepEqual(changed.derivedObservables.coverageMismatch.value, beforeRange, 'Test intervention changes semantic coverage');
  changed = await agent.dispatch({ type: 'RUN' });
  assert.equal(changed.observables['outcome.testMse'].available, true, 'Run updates Test evidence');
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

// A caller-supplied invalid seed fails before the host commits a candidate.
{
  const failedHost = createPlaygroundHost({ getDataset: () => null });
  const failedAgent = createPlaygroundAgentApi(failedHost);
  await assert.rejects(() => failedAgent.openBigIdeaEntrance({ id: 'distribution-shift', seed: 'not-a-seed' }), /INVALID_BIG_IDEA_ENTRANCE/);
  assert.throws(() => failedAgent.getState(), /PLAYGROUND_NOT_OPEN/);
}

console.log('Big Idea entrance checks passed: registry, localization, semantic initialization, deterministic seeds, Distribution Shift manual parity, Compare evidence, immediate divergence, explicit Threads, Model Capacity control, Agent inspection, Agent-off operation, and direct-entry regression.');
