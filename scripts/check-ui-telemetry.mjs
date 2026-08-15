import assert from 'node:assert/strict';
import {
  createFirstMeaningfulManipulationTracker,
  createMemoryExplorationTelemetry,
  dispatchWithFirstMeaningfulManipulation,
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

console.log('UI-3 telemetry checks passed: commit-gated, human-only, deduplicated, and fail-open.');
