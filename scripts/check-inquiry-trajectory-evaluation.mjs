import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createInquiryTrajectoryStore, deriveInquiryTrajectory } from '../src/core/exploration/inquiryTrajectory.js';
import { createSemanticEventStore } from '../src/core/exploration/semanticEvents.js';

const semanticEvents = {
  events: [
    { sequence: 1, type: 'world.intervened', actor: 'human', occurredAt: '2026-08-20T00:00:05.000Z', semanticFactors: ['world.train.observations'] },
    { sequence: 2, type: 'experiment.duplicated', actor: 'human', occurredAt: '2026-08-20T00:00:08.000Z', semanticFactors: [] },
    { sequence: 3, type: 'comparison.completed', actor: 'human', occurredAt: '2026-08-20T00:00:12.000Z', semanticFactors: ['learning'] },
    { sequence: 4, type: 'comparison.completed', actor: 'human', occurredAt: '2026-08-20T00:00:15.000Z', semanticFactors: ['world', 'learning'] },
    { sequence: 5, type: 'repeat.completed', actor: 'human', occurredAt: '2026-08-20T00:00:20.000Z', semanticFactors: [] },
  ],
};
const presentationEvents = [
  { type: 'concept-card-surfaced', occurredAt: '2026-08-20T00:00:10.000Z', afterSemanticEventSequence: 2 },
  { type: 'concept-card-engaged', occurredAt: '2026-08-20T00:00:11.000Z', afterSemanticEventSequence: 2 },
  { type: 'depth-opened', occurredAt: '2026-08-20T00:00:11.500Z', afterSemanticEventSequence: 2 },
  { type: 'suggestion-surfaced', occurredAt: '2026-08-20T00:00:13.000Z', afterSemanticEventSequence: 3 },
  { type: 'suggestion-accepted', occurredAt: '2026-08-20T00:00:14.000Z', afterSemanticEventSequence: 3 },
  { type: 'suggestion-modified', occurredAt: '2026-08-20T00:00:14.500Z', afterSemanticEventSequence: 3 },
];
const activeExplorationThread = {
  entries: [
    { kind: 'question', text: 'Why did this change?' },
    { kind: 'prediction', text: 'I think the Test result may change.' },
    { kind: 'question', text: 'Would it change again with another sample?' },
  ],
};
const trajectory = deriveInquiryTrajectory({
  sessionStartedAt: '2026-08-20T00:00:00.000Z',
  semanticEvents,
  presentationEvents,
  activeExplorationThread,
});
assert.equal(trajectory.session.timeToFirstMeaningfulManipulationMs, 5000, 'time to first meaningful human manipulation derives from bounded completed semantic events');
assert.equal(trajectory.session.hasSecondExperiment, true, 'duplicate records the second-experiment signal');
assert.equal(trajectory.experiments.compareUsed, true, 'comparison use derives from completed comparison events');
assert.equal(trajectory.experiments.oneFactorComparisonRate, 0.5, 'one-factor comparison rate derives only from canonical comparison factor counts');
assert.equal(trajectory.experiments.repeatCount, 1, 'repeat use derives from completed repeat events');
assert.deepEqual(trajectory.guidance, {
  conceptCardsSurfaced: 1,
  conceptCardsEngaged: 1,
  suggestionsSurfaced: 1,
  suggestionsAccepted: 1,
  suggestionsModified: 1,
  depthTransitions: 1,
  transitionedToIndependentExploration: false,
}, 'guidance state records bounded presentation outcomes without text or suggestion payloads');
assert.deepEqual(trajectory.thread, { questionCount: 2, predictionCount: 1, followUpQuestionCount: 1, hasFollowUpQuestion: true }, 'Thread evidence measures recorded follow-up questions/predictions without evaluating their language');
assert.equal(JSON.stringify(trajectory).includes('Why did this change?'), false, 'trajectory never retains learner question text');
assert.equal(JSON.stringify(trajectory).includes('world.train.observations'), false, 'trajectory never retains World factors, coordinates, or raw observations');
assert.deepEqual(trajectory, deriveInquiryTrajectory({ sessionStartedAt: '2026-08-20T00:00:00.000Z', semanticEvents, presentationEvents, activeExplorationThread }), 'the same completed events yield a deterministic trajectory projection');

const independent = deriveInquiryTrajectory({
  sessionStartedAt: '2026-08-20T00:00:00.000Z',
  semanticEvents: { events: [...semanticEvents.events, { sequence: 6, type: 'experiment.factor-changed', actor: 'human', occurredAt: '2026-08-20T00:00:25.000Z', semanticFactors: ['learning'] }] },
  presentationEvents: [{ type: 'agent-guidance-surfaced', occurredAt: '2026-08-20T00:00:21.000Z', afterSemanticEventSequence: 5 }],
});
assert.equal(independent.guidance.transitionedToIndependentExploration, true, 'a later human semantic action after guidance is a process signal for independent exploration, not a mastery claim');

const boundedSemanticStore = createSemanticEventStore({ limit: 2, now: () => '2026-08-20T00:00:05.000Z' });
boundedSemanticStore.reset();
boundedSemanticStore.append([
  { type: 'world.intervened', actor: 'human', semanticFactors: ['world.train.observations'], semanticFactorPaths: ['world.train.observations'] },
  { type: 'experiment.duplicated', actor: 'human', semanticFactors: [] },
  { type: 'comparison.completed', actor: 'human', semanticFactors: ['learning'], semanticFactorPaths: ['learning.controls.learningRate'] },
  { type: 'repeat.completed', actor: 'human', semanticFactors: [] },
]);
const aggregateTrajectory = deriveInquiryTrajectory({
  sessionStartedAt: '2026-08-20T00:00:00.000Z',
  semanticEvents: boundedSemanticStore.snapshot(),
});
assert.equal(aggregateTrajectory.session.timeToFirstMeaningfulManipulationMs, 5000, 'session aggregate preserves first human manipulation after event-window eviction');
assert.equal(aggregateTrajectory.session.hasSecondExperiment, true, 'session aggregate preserves duplicate behavior after event-window eviction');
assert.equal(aggregateTrajectory.experiments.compareCount, 1, 'session aggregate preserves comparison count after event-window eviction');
assert.equal(aggregateTrajectory.experiments.oneFactorComparisonRate, 1, 'session aggregate uses precise semantic paths for one-factor rates');
assert.equal(aggregateTrajectory.experiments.repeatCount, 1, 'session aggregate preserves repeat count after event-window eviction');

const clock = ['2026-08-20T00:00:00.000Z', '2026-08-20T00:00:01.000Z', '2026-08-20T00:00:02.000Z'];
const trajectoryStore = createInquiryTrajectoryStore({ now: () => clock.shift() ?? '2026-08-20T00:00:03.000Z' });
trajectoryStore.reset();
assert.equal(trajectoryStore.append({ type: 'concept-card-surfaced', afterSemanticEventSequence: 2 }).type, 'concept-card-surfaced', 'the presentation store accepts only bounded event types');
assert.equal(trajectoryStore.append({ type: 'forged-event', afterSemanticEventSequence: 2 }), null, 'unrecognized presentation events are rejected');
assert.equal(JSON.stringify(trajectoryStore.snapshot()).includes('concept-card-surfaced'), true, 'the local store retains only bounded event identity');
for (let index = 0; index < 40; index += 1) trajectoryStore.append({ type: 'depth-opened', afterSemanticEventSequence: index });
assert.equal(deriveInquiryTrajectory({ ...trajectoryStore.snapshot() }).guidance.depthTransitions, 40, 'presentation aggregates remain monotonic after the bounded event window evicts old entries');

const eventClock = ['2026-08-20T00:00:04.000Z'];
const host = createPlaygroundHost({
  getDataset: () => null,
  semanticEventStore: createSemanticEventStore({ now: () => eventClock.shift() ?? '2026-08-20T00:00:05.000Z' }),
  inquiryTrajectoryStore: createInquiryTrajectoryStore({ now: () => '2026-08-20T00:00:00.000Z' }),
});
let snapshot = await host.open({ playgroundId: 'linear-regression', seed: 491 });
const beforeFingerprint = host.inspectContext().conditionFingerprint;
const originalPoint = snapshot.world.observations[0];
snapshot = await host.dispatch({
  type: 'APPLY_WORLD_TRANSACTION',
  transaction: { id: 'trajectory-move', actor: 'human', intent: 'move-point', operations: [{ type: 'MOVE_POINT', pointId: originalPoint.id, x: originalPoint.features.x + 0.25, y: originalPoint.target }] },
});
const baselineId = snapshot.experimentWorkspace.activeExperimentId;
snapshot = await host.dispatch({ type: 'DUPLICATE_EXPERIMENT', actor: 'human' });
snapshot = await host.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.2, actor: 'human' });
snapshot = await host.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: baselineId, actor: 'human' });
const beforePresentation = host.inspectContext().conditionFingerprint;
host.recordInquiryPresentationEvent({ type: 'concept-card-surfaced', conceptId: 'controlled-comparison' });
host.recordInquiryPresentationEvent({ type: 'concept-card-engaged', conceptId: 'controlled-comparison' });
assert.equal(host.recordInquiryPresentationEvent({ type: 'concept-card-surfaced', conceptId: 'forged-concept' }), null, 'forged concept presentation IDs cannot enter the canonical trajectory');
assert.equal(host.recordInquiryPresentationEvent({ type: 'suggestion-accepted', suggestionId: 'forged-suggestion' }), null, 'suggestion acceptance requires a currently valid, previously surfaced suggestion');
assert.equal(host.inspectContext().conditionFingerprint, beforePresentation, 'presentation recording never mutates the World/Experiment condition');
assert.equal(snapshot.inquiryTrajectory.session.timeToFirstMeaningfulManipulationMs, 4000, 'normal snapshots expose the trajectory derived from real completed runtime events');
assert.equal(host.getState().inquiryTrajectory.guidance.conceptCardsSurfaced, 1, 'presentation engagement is visible through the same normal snapshot boundary');
assert.deepEqual(host.getState().inquiryTrajectory, host.inspectContext().exploration.inquiryTrajectory, 'normal and Agent inspection expose the same bounded trajectory state');
assert.equal(beforeFingerprint === host.inspectContext().conditionFingerprint, false, 'the real semantic World intervention remains distinct from non-mutating presentation recording');
await host.close();

console.log('Inquiry trajectory evaluation checks passed: bounded local process metrics, completed-action comparison/repeat rates, card/depth/suggestion signals, Thread follow-up counts, independent-exploration transition, no text/data retention, and runtime/presentation separation.');
