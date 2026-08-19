import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import {
  createSemanticEventStore,
  deriveSemanticEventDrafts,
  MAX_SEMANTIC_EVENTS,
} from '../src/core/exploration/semanticEvents.js';
import { materializeWorldGesture } from '../src/core/exploration/gestures.js';

const eventStore = createSemanticEventStore({ now: () => '2026-08-19T00:00:00.000Z' });
const host = createPlaygroundHost({ getDataset: () => null, semanticEventStore: eventStore });
let snapshot = await host.open({ playgroundId: 'linear-regression', seed: 17 });
const baselineId = snapshot.experimentWorkspace.activeExperimentId;

snapshot = await host.dispatch({ type: 'DUPLICATE_EXPERIMENT', actor: 'human' });
const branchId = snapshot.experimentWorkspace.activeExperimentId;
assert.notEqual(branchId, baselineId, 'duplicate creates a new canonical Experiment before it is recorded');

const gesture = materializeWorldGesture({
  id: 'semantic-gesture',
  tool: 'brush',
  path: [
    { x: -1.5, y: 0.1 },
    { x: -1, y: 0.2 },
    { x: -0.5, y: 0.3 },
    { x: 0, y: 0.4 },
  ],
  membership: 'test',
  density: 2,
  existingPointCount: snapshot.world.observations.length,
});
snapshot = await host.dispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction: gesture });
snapshot = await host.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: baselineId });

const events = snapshot.semanticEvents.events;
assert.deepEqual(host.inspectContext().exploration.semanticEvents.events, events, 'the same bounded semantic events are available to detached inspection without a React/DOM dependency');
assert.deepEqual(events.slice(0, 3).map((event) => event.type), [
  'experiment.duplicated',
  'world.intervened',
  'comparison.completed',
], 'duplicate, one completed gesture transaction, and committed comparison preserve semantic order');
assert.deepEqual(events[0].experimentIds, [baselineId, branchId], 'duplicate event references only canonical Experiment identities');
assert.deepEqual(events[1].operationTypes, ['ADD_POINTS'], 'many pointer samples materialize as one semantic World intervention');
assert.equal(events.filter((event) => event.type === 'world.intervened').length, 1, 'one completed gesture creates exactly one World event');
assert.equal(events[2].reasonCode, 'comparison-ready', 'comparison event exists only after its runtime diff is available');
assert.ok(snapshot.experimentWorkspace.comparison.diff, 'runtime comparison diff exists before comparison presentation event');
assert.ok(events.every((event) => event.occurredAt === '2026-08-19T00:00:00.000Z'), 'event timestamps can be injected deterministically');
assert.ok(events.every((event, index) => event.sequence === index + 1), 'event order is a bounded canonical sequence');
assert.ok(events.length <= MAX_SEMANTIC_EVENTS, 'event history remains bounded');

snapshot = await host.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.2 });
const controlEvent = snapshot.semanticEvents.events.findLast((event) => event.type === 'experiment.factor-changed');
assert.equal(controlEvent.type, 'experiment.factor-changed', 'a registered control commit becomes a semantic factor-change event');
assert.deepEqual(controlEvent.semanticFactors, ['control.learningRate'], 'factor identity is semantic and detached from UI controls');
assert.equal(controlEvent.reasonCode, 'learning', 'registered control domain remains inspectable');

snapshot = await host.dispatch({ type: 'REPEAT_EXPERIMENT', trials: 3 });
const repeatEvent = snapshot.semanticEvents.events.findLast((event) => event.type === 'repeat.completed');
assert.ok(repeatEvent, 'successful repeat evidence becomes a semantic completion event');

const serialized = JSON.stringify(events);
assert.ok(!serialized.includes('semantic-gesture-point-'), 'event payloads never retain generated point IDs');
assert.ok(!serialized.includes('"path"'), 'event payloads never retain pointer paths');
assert.ok(!serialized.includes('"coordinates"'), 'event payloads never retain World coordinates');
assert.ok(!serialized.includes('"observations"'), 'event payloads never retain raw World observations');

const beforeFailure = structuredClone(snapshot.semanticEvents.events);
await assert.rejects(
  host.dispatch({ type: 'SET_CONTROL', key: 'not-a-control', value: 1 }),
  /INVALID_PLAYGROUND_CONTROL/,
);
assert.deepEqual(host.getState().semanticEvents.events, beforeFailure, 'rejected runtime actions create no semantic events');

const syntheticObservation = {
  id: 'COVERAGE_MISMATCH',
  relatedExperimentIds: [baselineId, branchId],
  relatedObservableIds: ['coverageMismatch'],
  evidence: { testOutsideTrainFraction: 0.75 },
};
const observationDrafts = deriveSemanticEventDrafts({
  after: { observations: [syntheticObservation] },
  action: { type: 'RUN', actor: 'system' },
});
assert.equal(observationDrafts.length, 1, 'detector notices bridge into the same event contract');
const firstObservation = eventStore.append(observationDrafts);
const duplicateObservation = eventStore.append(observationDrafts);
assert.equal(firstObservation.length, 1, 'new detector notice is recorded');
assert.equal(duplicateObservation.length, 0, 'unchanged detector notice is deduplicated without weakening its factual contract');
assert.deepEqual(firstObservation[0].evidenceRefs, ['coverageMismatch'], 'observation events retain bounded semantic observable references only');
assert.ok(!JSON.stringify(firstObservation[0]).includes('testOutsideTrainFraction'), 'observation evidence values do not leak into the event stream');

await host.close();
assert.deepEqual(eventStore.snapshot().events, [], 'semantic history is local to the open playground session');

console.log('Semantic event checks passed: bounded post-commit experiment/world/comparison events, gesture aggregation, observation bridging, rejection safety, JSON-safe payloads, and local-session reset.');
