import assert from 'node:assert/strict';
import { createWorld, validateWorld } from '../src/core/exploration/world.js';
import { EXPLORATION_DOMAIN_IDS, getExplorationDomainContract } from '../src/core/exploration/domainContract.js';
import { getPhase9Probe, listPhase9Probes, validateAllPhase9Probes } from '../src/core/exploration/phase9Probes.js';
import { PRIMITIVE_TYPES, primitivePresentation } from '../src/core/playground/visualization/primitives.js';
import { validatePrimitiveContract } from '../src/core/playground/visualization/schemas.js';
import { createImageClassificationSource } from '../src/core/playground/domain/imageDataset.js';
import { createSequenceAttentionSource } from '../src/core/playground/domain/sequenceDataset.js';
import { createRagSource, createRetrievalSource } from '../src/core/playground/domain/retrievalDataset.js';
import { createRuntimeSession, deriveRuntimeSnapshot, dispatchRuntimeAction } from '../src/core/playground/playgroundRuntime.js';
import { getPlayground } from '../src/core/playgrounds/registry.js';
import { derivePhenomenonCapabilities } from '../src/core/ui/phenomenon.js';
import { validateTracePayload } from '../src/core/playground/trace/traceTypes.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createExecutionRequest, normalizeExecutionCapability, normalizeExecutionStatus } from '../src/core/playground/execution/executionContract.js';

assert.deepEqual(EXPLORATION_DOMAIN_IDS, ['tabular', 'image', 'sequence', 'retrieval', 'rag']);
for (const domain of EXPLORATION_DOMAIN_IDS) {
  const contract = getExplorationDomainContract(domain);
  assert.equal(contract.id, domain);
  assert.ok(contract.coordinateSpaces.length > 0);
  assert.ok(contract.semanticDepths.includes('phenomenon'));
}

const probeResults = validateAllPhase9Probes();
assert.deepEqual(probeResults.map((item) => item.valid), [true, true, true]);
assert.equal(listPhase9Probes().every((probe) => probe.executable === false), true);
assert.equal(getPhase9Probe('image-classification').domain, 'image');
assert.equal(getPhase9Probe('sequence-attention').depths.mechanism, 'attention-matrix');

const legacyWorld = createWorld({
  task: 'regression',
  observations: [{ id: 'p1', x: 0, y: 1, membership: 'train' }],
});
assert.equal(legacyWorld.domain, 'tabular');
assert.equal(validateWorld(legacyWorld).domain, 'tabular');

assert.ok(PRIMITIVE_TYPES.includes('image-grid'));
assert.ok(PRIMITIVE_TYPES.includes('token-sequence'));
assert.equal(primitivePresentation('image-grid').coordinateSpace, 'image');
assert.equal(primitivePresentation('attention-matrix').coordinateSpace, 'attention-matrix');

const imageContract = validatePrimitiveContract({
  id: 'probe-images',
  type: 'image-grid',
  props: { images: [{ id: 'image-1', width: 2, height: 2, pixels: [0, 1, 0.5, 0.25] }] },
});
assert.equal(imageContract.valid, true);

const sequenceContract = validatePrimitiveContract({
  id: 'probe-tokens',
  type: 'token-sequence',
  props: { tokens: ['the', 'model'], highlights: [1] },
});
assert.equal(sequenceContract.valid, true);

const imagePlayground = getPlayground('image-classification');
const imageSource = createImageClassificationSource({ seed: 17 });
let imageSession = createRuntimeSession(imagePlayground, { source: imageSource, seed: 17 });
let imageSnapshot = deriveRuntimeSnapshot(imageSession);
assert.equal(imageSnapshot.domain, 'image');
assert.equal(imageSnapshot.world.domain, 'image');
assert.equal(imageSnapshot.world.coordinateSpace, 'image');
assert.equal(imageSnapshot.world.task, 'classification');
assert.equal(imageSnapshot.dataState.domain, 'image');
assert.equal(imageSnapshot.observables['outcome.trainAccuracy'].available, true);
assert.equal(imageSnapshot.observables['outcome.testAccuracy'].available, true);
assert.equal(derivePhenomenonCapabilities(imageSnapshot).domainNative, true);
assert.ok(imageSnapshot.primitives.some((primitive) => primitive.type === 'image-grid'));
assert.ok(imageSnapshot.primitives.some((primitive) => primitive.type === 'attention-matrix'));
const initialTestAccuracy = imageSnapshot.observables['outcome.testAccuracy'].value;
imageSession = dispatchRuntimeAction(imageSession, { type: 'START_TRAINING' });
imageSnapshot = deriveRuntimeSnapshot(imageSession);
assert.equal(imageSnapshot.observables['outcome.testAccuracy'].value, initialTestAccuracy);
assert.ok(imageSnapshot.traces.some((trace) => trace.type === 'training.completed'));
imageSnapshot.traces.forEach((trace) => assert.equal(validateTracePayload(trace).valid, true));

const sequencePlayground = getPlayground('sequence-attention');
const sequenceSource = createSequenceAttentionSource();
let sequenceSession = createRuntimeSession(sequencePlayground, { source: sequenceSource, seed: 23 });
let sequenceSnapshot = deriveRuntimeSnapshot(sequenceSession);
assert.equal(sequenceSnapshot.domain, 'sequence');
assert.equal(sequenceSnapshot.world.coordinateSpace, 'token-sequence');
assert.equal(sequenceSnapshot.world.observations.every((observation) => observation.payload?.kind === 'sequence'), true);
assert.equal(sequenceSnapshot.observables['outcome.testAccuracy'].available, true);
assert.equal(derivePhenomenonCapabilities(sequenceSnapshot).domainNative, true);
assert.ok(sequenceSnapshot.primitives.some((primitive) => primitive.type === 'token-sequence'));
assert.ok(sequenceSnapshot.primitives.some((primitive) => primitive.type === 'attention-matrix'));
sequenceSession = dispatchRuntimeAction(sequenceSession, { type: 'START_TRAINING' });
sequenceSnapshot = deriveRuntimeSnapshot(sequenceSession);
assert.ok(sequenceSnapshot.traces.some((trace) => trace.type === 'training.completed'));
assert.ok(sequenceSnapshot.primitives.find((primitive) => primitive.type === 'attention-matrix')?.props.cells.length > 0);
sequenceSnapshot.traces.forEach((trace) => assert.equal(validateTracePayload(trace).valid, true));

for (const [playgroundId, source, domain, task, primitiveType, metricId] of [
  ['retrieval-ranking', createRetrievalSource(), 'retrieval', 'retrieval', 'ranked-results', 'outcome.retrievalScore'],
  ['rag-grounding', createRagSource(), 'rag', 'grounded-generation', 'ranked-results', 'outcome.groundedSourceCount'],
]) {
  const runtime = createRuntimeSession(getPlayground(playgroundId), { source, seed: 31 });
  const snapshot = deriveRuntimeSnapshot(runtime);
  assert.equal(snapshot.domain, domain);
  assert.equal(snapshot.world.task, task);
  assert.equal(snapshot.world.coordinateSpace, 'ranked-list');
  assert.equal(snapshot.observables[metricId].available, true);
  assert.ok(snapshot.primitives.some((primitive) => primitive.type === primitiveType));
  snapshot.traces.forEach((trace) => assert.equal(validateTracePayload(trace).valid, true));
}

const domainHost = createPlaygroundHost({ getDataset: () => null });
await domainHost.open({ playgroundId: 'image-classification', seed: 41 });
const domainContext = domainHost.inspectContext();
assert.equal(domainContext.playground.domain, 'image');
assert.equal(domainContext.playground.coordinateSpace, 'image');
assert.equal(domainContext.exploration.domain.id, 'image');
assert.ok(domainContext.model.capabilities.imageFeatures);
assert.deepEqual(domainContext.model.execution, { mode: 'sync', supportsCancellation: false, maxConcurrentRuns: 1 });
assert.deepEqual(normalizeExecutionCapability({ mode: 'async', supportsCancellation: true, maxConcurrentRuns: 9 }), { mode: 'async', supportsCancellation: true, maxConcurrentRuns: 4 });
assert.deepEqual(normalizeExecutionStatus({ status: 'completed', runId: 'run-1' }), { version: 1, status: 'completed', runId: 'run-1', errorCode: null });
assert.deepEqual(createExecutionRequest({ sessionId: 'session-1', domain: 'image', operation: 'fit', inputFingerprint: 'bounded' }), { version: 1, sessionId: 'session-1', domain: 'image', operation: 'fit', inputFingerprint: 'bounded' });

console.log('Phase 9 cross-domain contracts passed');
