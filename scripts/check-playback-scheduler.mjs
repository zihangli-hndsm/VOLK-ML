import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { mergeTimelinePatch } from '../src/core/playground/playgroundRuntime.js';
import {
  createPlaybackScheduler,
  getPlaybackDelay,
} from '../src/core/playground/playbackScheduler.js';

assert.deepEqual(
  mergeTimelinePatch({ step: 0, totalSteps: 0, speed: 1 }, { step: 0, totalSteps: 20, speed: undefined }),
  { step: 0, totalSteps: 20, speed: 1 },
  'undefined timeline fields preserve the previous value',
);
assert.deepEqual(
  mergeTimelinePatch({ step: 0, totalSteps: 20, speed: 1 }, { speed: 2 }),
  { step: 0, totalSteps: 20, speed: 2 },
  'explicit timeline fields replace the previous value',
);

const reducedMotionSnapshot = {
  script: { steps: [{ id: 'train', durationMs: 800 }] },
  scriptState: { status: 'playing', step: 0, totalSteps: 1 },
  timeline: { step: 0, totalSteps: 0, speed: 1 },
};
assert.equal(
  getPlaybackDelay(reducedMotionSnapshot, { type: 'SCRIPT_STEP' }, { reducedMotion: true }),
  0,
  'reduced motion schedules immediate semantic progress',
);

const speedHost = createPlaygroundHost({ getDataset: () => null });
await speedHost.open({ playgroundId: 'linear-regression', seed: 718 });
const defaultTraining = await speedHost.dispatch({ type: 'START_TRAINING' });
assert.equal(defaultTraining.timeline.speed, 1, 'START_TRAINING preserves the default playback speed');
await speedHost.dispatch({ type: 'SET_SPEED', value: 2 });
const changedTraining = await speedHost.dispatch({ type: 'START_TRAINING' });
assert.equal(changedTraining.timeline.speed, 2, 'START_TRAINING preserves an explicit playback speed');
await speedHost.close();

const pending = new Map();
let timerId = 0;
const schedule = (callback, delay) => {
  const id = ++timerId;
  pending.set(id, { callback, delay });
  return id;
};
const cancelScheduled = (id) => pending.delete(id);
const takeTimer = () => {
  const entry = pending.entries().next().value;
  if (!entry) return null;
  pending.delete(entry[0]);
  return entry[1];
};

const host = createPlaygroundHost({ getDataset: () => null });
await host.open({ playgroundId: 'linear-regression', seed: 717 });
await host.loadPreset({ presetId: 'linear-regression.intuition' });
let snapshot = host.getState();
const revealSnapshots = [];
let scheduler;
scheduler = createPlaybackScheduler({
  dispatch: (action) => host.dispatch(action),
  schedule,
  cancelScheduled,
  onError: (failure) => { throw failure.error; },
});
host.subscribe((next) => {
  snapshot = next;
  if ([4, 5, 6].includes(next.scriptState.step)) {
    revealSnapshots.push({
      step: next.scene.training.currentStep,
      weight: next.scene.line.weight,
      bias: next.scene.line.bias,
    });
  }
  scheduler.schedule(next, { reducedMotion: true });
});
await host.dispatch({ type: 'SCRIPT_RESET' });
await host.dispatch({ type: 'SCRIPT_PLAY' });
scheduler.schedule(snapshot, { reducedMotion: true });
let guard = 0;
while (pending.size && guard < 30) {
  const timer = takeTimer();
  await timer.callback();
  guard += 1;
}
assert.equal(snapshot.scriptState.status, 'completed', 'scheduler integration reaches script completion');
assert.deepEqual(revealSnapshots.map((item) => item.step), [7, 14, 20], 'scheduler integration advances sampled training progress');
assert.ok(new Set(revealSnapshots.map((item) => `${item.weight}:${item.bias}`)).size > 1, 'scheduler integration observes visible line changes');
assert.equal(pending.size, 0, 'completed playback leaves no pending timer');
await host.close();

const failures = [];
const failingPending = [];
const failingScheduler = createPlaybackScheduler({
  dispatch: async () => { throw Object.assign(new Error('START_TRAINING failed'), { code: 'TEST_PLAYBACK_FAILURE' }); },
  schedule: (callback) => { failingPending.push(callback); return failingPending.length - 1; },
  cancelScheduled: () => {},
  onError: (failure) => failures.push(failure),
});
failingScheduler.schedule(reducedMotionSnapshot, { reducedMotion: true });
await failingPending.shift()();
assert.equal(failures.length, 1, 'rejected scheduled dispatch is reported once');
assert.equal(failures[0].action.type, 'SCRIPT_STEP');
assert.equal(failingPending.length, 0, 'failed playback does not retry indefinitely');

console.log('Playback scheduler checks passed: defined timeline patch semantics, reduced-motion scheduling, sampled LR progress, and failure-safe dispatch handling.');
