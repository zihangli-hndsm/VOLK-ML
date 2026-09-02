import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { detectSamplingVariability } from '../src/core/exploration/samplingVariability.js';
import { validateInquiryContracts } from '../src/core/exploration/inquiryContracts.js';
import { validateLumiAction, staySilent, decideLumiAction } from '../src/core/exploration/lumiPolicy.js';
import { createVolkCloudClient } from '../src/services/volkCloud/client.js';

const contracts = validateInquiryContracts();
assert.equal(contracts.exploration.valid, true);
assert.equal(contracts.orchestration.valid, true);
assert.equal(validateLumiAction({ type: 'SUGGEST_EXPERIMENT', authority: 'direct' }).valid, false);
assert.equal(validateLumiAction(staySilent()).valid, true);

const host = createPlaygroundHost({ getDataset: () => null });
let snapshot = await host.openBigIdeaEntrance({ id: 'episode-1-sampling-variability' });
assert.equal(snapshot.inquiryRuntime.currentQuestion, 'episode.one.question');
const worldFingerprint = snapshot.worldIdentity.fingerprint;
await host.recordInquiryPrediction({ expectation: 'different', reasoning: 'A new sample may move the fit.' });
snapshot = await host.dispatch({ type: 'RUN' });
assert.ok(snapshot.semanticEvents.events.some((event) => event.type === 'model.fit-completed'));
assert.ok(snapshot.semanticEvents.events.some((event) => event.type === 'experiment.baseline-captured'));
snapshot = await host.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
snapshot = await host.dispatch({ type: 'RESAMPLE_WORLD' });
assert.equal(snapshot.worldIdentity.fingerprint, worldFingerprint);
snapshot = await host.dispatch({ type: 'RUN' });
snapshot = await host.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: snapshot.experimentWorkspace.comparison.againstExperimentId });
assert.equal(snapshot.samplingVariability.status, 'evidenced');
assert.ok(snapshot.inquiryRuntime.candidateConcepts.includes('SAMPLING_VARIABILITY'));
assert.ok(snapshot.semanticEvents.events.some((event) => event.type === 'concept.evidenced'));
assert.equal((await decideLumiAction({ context: { guidance: { cooldownRemaining: 4 } }, cloudPolicy: { decide: async () => { throw new Error('offline'); } } })).type, 'STAY_SILENT');

const weak = detectSamplingVariability({ snapshot: {
  experimentWorkspace: { activeExperimentId: 'b', comparison: { enabled: true, againstExperimentId: 'a', diff: { clarity: 'high', semanticFactorCount: 1 } }, records: {
    a: { id: 'a', state: { status: 'completed', timeline: { step: 1 }, traces: [{ type: 'training.completed' }], experiment: { id: 'a', world: { id: 'w', observations: [{ x: 0, y: 0 }, { x: 1, y: 1 }], generator: { realization: { seed: 1 } } }, result: { model: { weight: 1, bias: 0 } } } } },
    b: { id: 'b', state: { status: 'completed', timeline: { step: 1 }, traces: [{ type: 'training.completed' }], experiment: { id: 'b', world: { id: 'w', observations: [{ x: 0, y: 0.001 }, { x: 1, y: 1.001 }], generator: { realization: { seed: 2 } } }, result: { model: { weight: 1, bias: 0.001 } } } } },
  } },
} });
assert.equal(weak.status, 'valid-weak');

let policyCalls = 0;
const cloudClient = createVolkCloudClient({ baseUrl: 'http://127.0.0.1:8010', fetchImpl: async (url, options) => {
  policyCalls += 1;
  assert.equal(url, 'http://127.0.0.1:8010/v0/lumi/respond');
  const request = JSON.parse(options.body);
  return { ok: true, status: 200, async json() { return { apiVersion: '0', requestId: request.requestId, action: 'STAY_SILENT', payload: {}, requiresLearnerConfirmation: false }; } };
} });
const cloudHost = createPlaygroundHost({ getDataset: () => null, cloudClient });
await cloudHost.openBigIdeaEntrance({ id: 'episode-1-sampling-variability' });
const cloudBefore = cloudHost.getState();
const cloudAction = await cloudHost.decideLumiAction();
assert.equal(cloudAction.type, 'STAY_SILENT');
assert.equal(policyCalls, 1);
const cloudAfter = cloudHost.getState();
assert.deepEqual(cloudAfter.world, cloudBefore.world);
assert.deepEqual(cloudAfter.experiment, cloudBefore.experiment);
const malformedHost = createPlaygroundHost({ getDataset: () => null, cloudClient: createVolkCloudClient({ baseUrl: 'http://127.0.0.1:8010', fetchImpl: async () => ({ ok: true, status: 200, async json() { return { apiVersion: '9', requestId: 'stale', action: 'RUN', payload: {} }; } }) }) });
await malformedHost.openBigIdeaEntrance({ id: 'episode-1-sampling-variability' });
const malformedBefore = malformedHost.getState();
const fallback = await malformedHost.decideLumiAction();
const malformedAfter = malformedHost.getState();
assert.ok(['ASK', 'SUGGEST_EXPERIMENT', 'STAY_SILENT'].includes(fallback.type));
assert.deepEqual(malformedAfter.world, malformedBefore.world);
assert.deepEqual(malformedAfter.experiment, malformedBefore.experiment);
assert.deepEqual(malformedAfter.observations, malformedBefore.observations);
console.log('Inquiry Episode 1 runtime checks passed');
