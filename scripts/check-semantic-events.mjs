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
snapshot = await host.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: baselineId, actor: 'human' });

const events = snapshot.semanticEvents.events;
assert.deepEqual(host.inspectContext().exploration.semanticEvents.events, events, 'the same bounded semantic events are available to detached inspection without a React/DOM dependency');
assert.deepEqual(events.slice(0, 3).map((event) => event.type), [
  'experiment.duplicated',
  'world.intervened',
  'comparison.completed',
], 'duplicate, one completed gesture transaction, and committed comparison preserve semantic order');
assert.deepEqual(events[0].experimentIds, [baselineId, branchId], 'duplicate event references only canonical Experiment identities');
assert.deepEqual(events[1].operationTypes, ['ADD_POINTS'], 'many pointer samples materialize as one semantic World intervention');
assert.equal(events[1].actor, 'human', 'completed learner gestures retain explicit human provenance');
assert.deepEqual(events[1].semanticFactors, ['world.test.observations'], 'test-only gestures retain a bounded Test observation factor');
assert.equal(events.filter((event) => event.type === 'world.intervened').length, 1, 'one completed gesture creates exactly one World event');
assert.equal(events[2].reasonCode, 'comparison-ready', 'comparison event exists only after its runtime diff is available');
assert.ok(snapshot.experimentWorkspace.comparison.diff, 'runtime comparison diff exists before comparison presentation event');
assert.ok(events.every((event) => event.occurredAt === '2026-08-19T00:00:00.000Z'), 'event timestamps can be injected deterministically');
assert.ok(events.every((event, index) => event.sequence === index + 1), 'event order is a bounded canonical sequence');
assert.ok(events.length <= MAX_SEMANTIC_EVENTS, 'event history remains bounded');

snapshot = await host.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.2, actor: 'human' });
const controlEvent = snapshot.semanticEvents.events.findLast((event) => event.type === 'experiment.factor-changed');
assert.equal(controlEvent.type, 'experiment.factor-changed', 'a registered control commit becomes a semantic factor-change event');
assert.equal(controlEvent.actor, 'human', 'explicit learner actions retain human provenance');
assert.deepEqual(controlEvent.semanticFactors, ['learning'], 'factor identity agrees with canonical Experiment comparison semantics');
assert.equal(controlEvent.reasonCode, 'control.learningRate', 'the registered control identity remains inspectable without becoming a separate comparison factor');

snapshot = await host.dispatch({ type: 'REPEAT_EXPERIMENT', trials: 3, actor: 'human' });
const repeatEvent = snapshot.semanticEvents.events.findLast((event) => event.type === 'repeat.completed');
assert.ok(repeatEvent, 'successful repeat evidence becomes a semantic completion event');

const serialized = JSON.stringify(events);
assert.ok(!serialized.includes('semantic-gesture-point-'), 'event payloads never retain generated point IDs');
assert.ok(!serialized.includes('"path"'), 'event payloads never retain pointer paths');
assert.ok(!serialized.includes('"coordinates"'), 'event payloads never retain World coordinates');
assert.ok(!serialized.includes('"observations"'), 'event payloads never retain raw World observations');

const beforeFailure = structuredClone(snapshot.semanticEvents.events);
await assert.rejects(
  host.dispatch({ type: 'SET_CONTROL', key: 'not-a-control', value: 1, actor: 'human' }),
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
const duplicateObservation = eventStore.append(deriveSemanticEventDrafts({
  after: { observations: [syntheticObservation] },
  action: { type: 'SET_VISUAL', actor: 'system' },
}));
assert.equal(firstObservation.length, 1, 'new detector notice is recorded');
assert.equal(duplicateObservation.length, 0, 'unchanged detector notice is deduplicated without weakening its factual contract');
assert.deepEqual(firstObservation[0].evidenceRefs, ['coverageMismatch'], 'observation events retain bounded semantic observable references only');
assert.ok(!JSON.stringify(firstObservation[0]).includes('testOutsideTrainFraction'), 'observation evidence values do not leak into the event stream');

const slightlyChangedObservationDrafts = deriveSemanticEventDrafts({
  after: { observations: [{ ...syntheticObservation, evidence: { testOutsideTrainFraction: 0.76 } }] },
  action: { type: 'RUN', actor: 'system' },
});
assert.equal(eventStore.append(slightlyChangedObservationDrafts).length, 0, 'small evidence-value changes do not repeat an observation while its meaning remains active');
eventStore.append(deriveSemanticEventDrafts({ after: { observations: [] }, action: { type: 'RUN', actor: 'system' } }));
assert.equal(eventStore.append(observationDrafts).length, 1, 'an observation that clears and genuinely reappears receives a new lifecycle event');

const factorStore = createSemanticEventStore({ now: () => '2026-08-19T00:00:00.000Z' });
const factorHost = createPlaygroundHost({ getDataset: () => null, semanticEventStore: factorStore });
let factors = await factorHost.open({ playgroundId: 'linear-regression', seed: 19 });
const trainGesture = materializeWorldGesture({
  id: 'semantic-train-gesture',
  tool: 'brush',
  path: [{ x: 0, y: 0 }, { x: 0.4, y: 0.4 }],
  membership: 'train',
  existingPointCount: factors.world.observations.length,
});
factors = await factorHost.dispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction: trainGesture });
assert.deepEqual(factors.semanticEvents.events.findLast((event) => event.type === 'world.intervened').semanticFactors, ['world.train.observations'], 'train-only gestures retain a bounded Train observation factor');
const factorCount = () => factors.semanticEvents.events.filter((event) => event.type === 'experiment.factor-changed').length;
const beforeViewControls = factorCount();
factors = await factorHost.dispatch({ type: 'SET_CONTROL', key: 'showResiduals', value: false, actor: 'human' });
factors = await factorHost.dispatch({ type: 'SET_CONTROL', key: 'showBestFit', value: true, actor: 'human' });
factors = await factorHost.dispatch({ type: 'SET_CONTROL', key: 'weight', value: 1, actor: 'human' });
factors = await factorHost.dispatch({ type: 'SET_CONTROL', key: 'bias', value: 1, actor: 'human' });
assert.equal(factorCount(), beforeViewControls, 'view-only and derived controls do not become experiment-factor events');
factors = await factorHost.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.2, actor: 'human' });
assert.equal(factorCount(), beforeViewControls + 1, 'canonical learning controls remain experiment-factor events');
const firstFactorId = factors.experimentWorkspace.activeExperimentId;
factors = await factorHost.dispatch({ type: 'DUPLICATE_EXPERIMENT', actor: 'human' });
factors = await factorHost.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.3, actor: 'human' });
factors = await factorHost.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: firstFactorId, actor: 'human' });
const comparedControl = factors.semanticEvents.events.findLast((event) => event.type === 'experiment.factor-changed');
assert.ok(factors.experimentWorkspace.comparison.diff.changed.includes(comparedControl.semanticFactors[0]), 'control event factor agrees with the canonical comparison factor');

const generatorStore = createSemanticEventStore({ now: () => '2026-08-19T00:00:00.000Z' });
const generatorHost = createPlaygroundHost({ getDataset: () => null, semanticEventStore: generatorStore });
let generatorSnapshot = await generatorHost.open({ playgroundId: 'linear-regression', seed: 23 });
generatorSnapshot = await generatorHost.dispatch({
  type: 'SET_WORLD_GENERATOR',
  actor: 'human',
  spec: { train: { input: { type: 'uniform', params: { min: -2, max: 2 } }, samples: 20 }, test: { input: { type: 'uniform', params: { min: -2, max: 2 } }, samples: 20 } },
});
generatorSnapshot = await generatorHost.dispatch({ type: 'SET_GENERATOR_PARAMETER', actor: 'human', path: 'test.input.params.min', value: 1 });
assert.ok(generatorSnapshot.semanticEvents.events.findLast((event) => event.type === 'world.intervened').semanticFactors.includes('world.test.input'), 'test generator edits retain a test-input factor');
generatorSnapshot = await generatorHost.dispatch({ type: 'SET_GENERATOR_PARAMETER', actor: 'human', path: 'noise.amount', value: 0.8 });
assert.ok(generatorSnapshot.semanticEvents.events.findLast((event) => event.type === 'world.intervened').semanticFactors.includes('world.noise'), 'noise edits retain a noise factor');
generatorSnapshot = await generatorHost.dispatch({ type: 'SET_GENERATOR_PARAMETER', actor: 'human', path: 'outliers.count', value: 1 });
assert.ok(generatorSnapshot.semanticEvents.events.findLast((event) => event.type === 'world.intervened').semanticFactors.includes('world.outliers'), 'registered outlier edits retain an outlier factor');

const systemStore = createSemanticEventStore({ now: () => '2026-08-19T00:00:00.000Z' });
const systemHost = createPlaygroundHost({ getDataset: () => null, semanticEventStore: systemStore });
await systemHost.open({ playgroundId: 'linear-regression', seed: 29 });
let systemSnapshot = await systemHost.loadPreset({ presetId: 'linear-regression.intuition', parameters: { learningRate: 0.2 } });
assert.equal(systemSnapshot.semanticEvents.events.findLast((event) => event.type === 'experiment.factor-changed').actor, 'system', 'internal preset setup is never attributed to a learner');
systemSnapshot = await systemHost.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.3 });
assert.equal(systemSnapshot.semanticEvents.events.findLast((event) => event.type === 'experiment.factor-changed').actor, 'system', 'untrusted Host callers without explicit provenance default to system');

const agentStore = createSemanticEventStore({ now: () => '2026-08-19T00:00:00.000Z' });
const agentHost = createPlaygroundHost({ getDataset: () => null, semanticEventStore: agentStore });
await agentHost.open({ playgroundId: 'linear-regression', seed: 31 });
const agentProposal = agentHost.proposeExploration({ request: 'What happens if I add some outliers?' });
await agentHost.executeExploration({ scenario: agentProposal.scenario });
assert.ok(agentHost.getState().semanticEvents.events.some((event) => event.actor === 'agent'), 'accepted Agent execution retains agent provenance');

await factorHost.close();
await generatorHost.close();
await systemHost.close();
await agentHost.close();

await host.close();
assert.deepEqual(eventStore.snapshot().events, [], 'semantic history is local to the open playground session');

console.log('Semantic event checks passed: bounded post-commit experiment/world/comparison events, gesture aggregation, observation bridging, rejection safety, JSON-safe payloads, and local-session reset.');
