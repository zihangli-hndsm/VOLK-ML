import assert from 'node:assert/strict';
import {
  beginLumiRequest,
  cancelLumiRequest,
  consumeLumiFeedback,
  createLumiFeedbackEvent,
  createLumiPresentationState,
  deriveLumiPresentationState,
  finishLumiRequest,
  lumiFeedbackDuration,
  surfaceLumiFeedback,
  LUMI_PRESENTATION_STATES,
} from '../src/core/ui/lumiPresentationRuntime.js';
import { createLumiTargetRegistry, resolveLumiTargetEntries } from '../src/core/ui/lumiTargetRegistry.js';
import { createLumiPolicyRequestIdentity, deriveEpisode1Guidance, isCurrentLumiPolicyResult } from '../src/core/ui/lumiEpisodeGuidance.js';

let state = createLumiPresentationState({ sessionId: 's', contextId: 'episode-1' });
state = beginLumiRequest(state, { source: 'ask', requestId: 'ask-1' });
assert.equal(deriveLumiPresentationState({ presentation: state, guideAvailable: true }), LUMI_PRESENTATION_STATES.THINK);
state = finishLumiRequest(state, { requestId: 'stale', feedbackEvent: createLumiFeedbackEvent({ id: 'stale' }) });
assert.ok(state.activeRequest, 'stale completion must not close the active request');
state = finishLumiRequest(state, { requestId: 'ask-1', feedbackEvent: createLumiFeedbackEvent({ id: 'answer-1', source: 'ask' }) });
assert.equal(deriveLumiPresentationState({ presentation: state }), LUMI_PRESENTATION_STATES.ILLUMINATE);
state = consumeLumiFeedback(state, 'answer-1');
assert.equal(deriveLumiPresentationState({ presentation: state, guideAvailable: true }), LUMI_PRESENTATION_STATES.GUIDE);
assert.equal(lumiFeedbackDuration({ reducedMotion: true }), 220);
assert.equal(lumiFeedbackDuration(), 1100);
state = cancelLumiRequest(state);
assert.equal(state.activeRequest, null);
state = surfaceLumiFeedback(state, { id: 'concept:1', kind: 'concept', source: 'runtime', target: 'ideas.map' });
assert.equal(deriveLumiPresentationState({ presentation: state }), LUMI_PRESENTATION_STATES.ILLUMINATE);
state = consumeLumiFeedback(state, 'concept:1');
assert.equal(deriveLumiPresentationState({ presentation: state }), LUMI_PRESENTATION_STATES.AMBIENT);

const element = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 30 }) };
const registry = createLumiTargetRegistry();
let registryNotifications = 0;
const unsubscribeRegistry = registry.subscribe(() => { registryNotifications += 1; });
const ref = { current: element };
assert.equal(registry.register('world.sample', { ref, controlId: 'sample', courseId: 'episode-1' }), true);
assert.equal(registryNotifications, 1);
assert.equal(registry.resolve('world.sample', { width: 400, height: 300 }).status, 'ready');
assert.equal(resolveLumiTargetEntries([], 'world.sample').status, 'missing');
assert.equal(resolveLumiTargetEntries([{ key: 'world.sample', ref, controlId: 'a' }, { key: 'world.sample', ref, controlId: 'b' }], 'world.sample').status, 'ambiguous');
assert.equal(resolveLumiTargetEntries([{ key: 'world.sample', ref, enabled: false }], 'world.sample').status, 'unavailable');
assert.equal(resolveLumiTargetEntries([{ key: 'world.sample', ref, reveal: { type: 'scroll', learnerInitiated: true } }], 'world.sample', { width: 20, height: 20 }).target.reveal.learnerInitiated, true);
registry.clear();
unsubscribeRegistry();
assert.equal(registry.resolve('world.sample', { width: 400, height: 300 }).status, 'missing', 'context cleanup revokes prior target');

const snapshot = { inquiryRuntime: { stage: 'resample', eligibleActions: [{ type: 'RESAMPLE_WORLD' }], evidence: { status: 'insufficient' } } };
const guidance = deriveEpisode1Guidance({ snapshot, policyAction: { type: 'SUGGEST_EXPERIMENT', payload: { operation: 'RESAMPLE_WORLD' } } });
assert.deepEqual(guidance, { targetKey: 'world.sample', actionType: 'SUGGEST_EXPERIMENT', proposalOnly: true, stage: 'resample', requestReason: 'same-world-resample' });
assert.equal(deriveEpisode1Guidance({ snapshot, policyAction: { type: 'SUGGEST_EXPERIMENT', payload: { operation: 'RUN' } } }), null);
assert.equal(snapshot.inquiryRuntime.stage, 'resample', 'presentation guidance must not mutate inquiry runtime');
const delayedBaseline = { inquiryRuntime: { contractId: 'episode-1', stage: 'resample' }, semanticEvents: { events: [{ sequence: 4 }] } };
const currentCompare = { inquiryRuntime: { contractId: 'episode-1', stage: 'evidence' }, semanticEvents: { events: [{ sequence: 6 }] } };
assert.equal(isCurrentLumiPolicyResult({ requestId: 'lumi-policy-1', currentRequestId: 'lumi-policy-2', requestIdentity: createLumiPolicyRequestIdentity(delayedBaseline), currentIdentity: createLumiPolicyRequestIdentity(currentCompare) }), false, 'late result cannot overwrite newer stage');
assert.equal(isCurrentLumiPolicyResult({ requestId: 'lumi-policy-2', currentRequestId: 'lumi-policy-2', requestIdentity: createLumiPolicyRequestIdentity(currentCompare), currentIdentity: createLumiPolicyRequestIdentity(currentCompare) }), true);

console.log('LUMI visible guidance checks passed');
