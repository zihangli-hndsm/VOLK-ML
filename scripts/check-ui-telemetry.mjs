import assert from 'node:assert/strict';
import {
  createFirstMeaningfulManipulationTracker,
  createMemoryExplorationTelemetry,
  dispatchWithFirstMeaningfulManipulation,
  trackCommittedExperimentAction,
} from '../src/core/telemetry/explorationTelemetry.js';

const humanAction = { type: 'APPLY_WORLD_TRANSACTION', transaction: { actor: 'human' } };
const agentAction = { type: 'APPLY_WORLD_TRANSACTION', transaction: { actor: 'agent' } };

async function dispatchThrough(tracker, telemetry, action, dispatch) {
  return dispatchWithFirstMeaningfulManipulation({ action, dispatch, tracker, telemetry });
}

const telemetry = createMemoryExplorationTelemetry();
const tracker = createFirstMeaningfulManipulationTracker();
let rejectNext = true;
const dispatch = async () => {
  if (rejectNext) {
    rejectNext = false;
    throw new Error('rejected world transaction');
  }
  return { committed: true };
};

await assert.rejects(() => dispatchThrough(tracker, telemetry, humanAction, dispatch), /rejected world transaction/);
assert.equal(telemetry.getEvents().length, 0, 'rejected first transaction does not claim telemetry');
await dispatchThrough(tracker, telemetry, humanAction, dispatch);
assert.equal(telemetry.getEvents().length, 1, 'next successful human transaction emits exactly one event');

await dispatchThrough(tracker, telemetry, humanAction, async () => ({ committed: true }));
await dispatchThrough(tracker, telemetry, humanAction, async () => ({ committed: true }));
assert.equal(telemetry.getEvents().length, 1, 'multiple successful human transactions still emit once per session');

await dispatchThrough(tracker, telemetry, agentAction, async () => ({ committed: true }));
assert.equal(telemetry.getEvents().length, 1, 'agent World transactions never emit first human manipulation');

tracker.reset();
const throwingTelemetry = { track() { throw new Error('telemetry unavailable'); } };
await assert.doesNotReject(
  () => dispatchThrough(tracker, throwingTelemetry, humanAction, async () => ({ committed: true })),
  'telemetry failure does not reject a committed World transaction',
);
const secondCommit = await dispatchThrough(tracker, throwingTelemetry, humanAction, async () => ({ committed: true }));
assert.deepEqual(secondCommit, { committed: true }, 'tracker remains claimed after a successful transaction even when telemetry fails');

const experimentTelemetry = createMemoryExplorationTelemetry();
trackCommittedExperimentAction({ type: 'DUPLICATE_EXPERIMENT' }, {}, experimentTelemetry);
trackCommittedExperimentAction({ type: 'SET_COMPARE', enabled: true }, {
  experimentWorkspace: { comparison: { diff: { changed: ['world'] } } },
}, experimentTelemetry);
trackCommittedExperimentAction({ type: 'SET_COMPARE', enabled: false }, {
  experimentWorkspace: { comparison: { diff: { changed: ['world'] } } },
}, experimentTelemetry);
trackCommittedExperimentAction({ type: 'REPEAT_EXPERIMENT', trials: 5 }, {}, experimentTelemetry);
assert.deepEqual(
  experimentTelemetry.getEvents().map((event) => event.type),
  ['experiment_duplicated', 'experiment_compared', 'repeat_requested'],
  'experiment telemetry is emitted only for committed semantic actions',
);
assert.deepEqual(experimentTelemetry.getEvents()[1].payload, { changedFactors: ['world'] }, 'compare telemetry uses runtime diff facts');

console.log('UI-4 telemetry checks passed: commit-gated, human-only, deduplicated, semantic, and fail-open.');
