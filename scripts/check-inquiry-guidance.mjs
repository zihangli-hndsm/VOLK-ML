import assert from 'node:assert/strict';
import {
  INQUIRY_GUIDANCE_POLICIES,
  MAX_INQUIRY_INTERRUPTS,
  createInquiryGuidanceAiInterpreter,
  deriveDeterministicInquiryGuidance,
  deriveInquiryGuidanceTrigger,
  nextInquiryGuidanceHistory,
  projectInquiryGuidanceAiContext,
  validateInquiryGuidance,
} from '../src/core/exploration/inquiryGuidance.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';

const event = (id, sequence) => ({ id, sequence, type: 'observation.detected', reasonCode: 'TEST_ERROR_CHANGED_MORE' });
const inquiry = {
  candidates: [{
    conceptId: 'generalization',
    confidence: 'direct',
    reasonCode: 'test-world-change-with-test-error-difference',
    supportingEventIds: ['event-4'],
  }],
};
const suggestions = {
  suggestions: [{
    id: 'inspect-test-support',
    kind: 'manual-world',
    intervention: { factor: 'world.test.input' },
    relatedConceptIds: ['generalization'],
  }],
};
const context = {
  playground: { modelAdapter: 'knn-classification', task: 'classification' },
  data: { task: 'classification' },
  presentation: { availableDepths: ['evidence', 'mechanism'] },
  exploration: { learnerInquiry: { inquiryStage: 'observing' } },
};
const events = [event('event-1', 1), event('event-2', 2), event('event-3', 3), event('event-4', 4)];
const trigger = deriveInquiryGuidanceTrigger({ inquiry, semanticEvents: events, suggestions });
assert.ok(trigger, 'only a new semantic event directly supporting a direct candidate creates a guidance trigger');
assert.equal(trigger.eventId, 'event-4', 'the trigger is tied to the completed supporting event');
assert.deepEqual(trigger.suggestions.map((item) => item.id), ['inspect-test-support'], 'the trigger exposes only a directly related prevalidated suggestion');
assert.equal(deriveInquiryGuidanceTrigger({ inquiry, semanticEvents: events.slice(0, -1), suggestions }), null, 'the same inquiry candidate does not trigger before its supporting semantic event');

const fallback = deriveDeterministicInquiryGuidance({ trigger, context });
assert.equal(fallback.policy, INQUIRY_GUIDANCE_POLICIES.SUGGEST_EXPERIMENT, 'the deterministic fallback is useful only for an already-valid related suggestion');
assert.equal(fallback.suggestionId, 'inspect-test-support', 'fallback cannot author a new experiment');
assert.equal(deriveDeterministicInquiryGuidance({ trigger: null }).policy, INQUIRY_GUIDANCE_POLICIES.IGNORE, 'no qualifying event defaults quietly to ignore');

let history = nextInquiryGuidanceHistory([], { trigger, guidance: fallback });
assert.equal(deriveInquiryGuidanceTrigger({ inquiry, semanticEvents: events, suggestions, history }), null, 'handled events cannot repeatedly invoke the optional guidance layer');
const nextEvents = [...events, event('event-5', 5), event('event-6', 6), event('event-7', 7)];
const nextInquiry = { candidates: [{ ...inquiry.candidates[0], supportingEventIds: ['event-7'] }] };
const nextTrigger = deriveInquiryGuidanceTrigger({ inquiry: nextInquiry, semanticEvents: nextEvents, suggestions, history });
assert.ok(nextTrigger, 'cooldown permits another meaningful event after the bounded event interval');
history = nextInquiryGuidanceHistory(history, { trigger: nextTrigger, guidance: fallback });
for (let index = 0; index < MAX_INQUIRY_INTERRUPTS - 2; index += 1) {
  const sequence = 10 + index * 3;
  const current = deriveInquiryGuidanceTrigger({
    inquiry: { candidates: [{ ...inquiry.candidates[0], supportingEventIds: [`event-${sequence}`] }] },
    semanticEvents: [...nextEvents, event(`event-${sequence - 2}`, sequence - 2), event(`event-${sequence - 1}`, sequence - 1), event(`event-${sequence}`, sequence)],
    suggestions,
    history,
  });
  assert.ok(current, 'the bounded interruption budget accepts distinct events before its limit');
  history = nextInquiryGuidanceHistory(history, { trigger: current, guidance: fallback });
}
assert.equal(deriveInquiryGuidanceTrigger({
  inquiry: { candidates: [{ ...inquiry.candidates[0], supportingEventIds: ['event-20'] }] },
  semanticEvents: [...nextEvents, event('event-18', 18), event('event-19', 19), event('event-20', 20)],
  suggestions,
  history,
}), null, 'the interruption budget stops later optional guidance in the local session');

assert.equal(validateInquiryGuidance({ policy: 'suggest-experiment', conceptId: 'generalization', suggestionId: 'forged', depth: null, hypothesis: null }, { trigger, context }), null, 'a provider cannot select an unvalidated suggestion');
assert.equal(validateInquiryGuidance({ policy: 'surface-concept', conceptId: 'generalization', suggestionId: null, depth: null, hypothesis: null, operation: 'forged' }, { trigger, context }), null, 'the local validator rejects fields outside the strict provider contract');
assert.equal(validateInquiryGuidance({ policy: 'suggest-deeper-inspection', conceptId: null, suggestionId: null, depth: 'evidence', hypothesis: 'A possible interpretation to test.' }, { trigger, context }).depth, 'evidence', 'a provider may only select an available presentation depth');

const projected = projectInquiryGuidanceAiContext({ trigger, context });
const projectedText = JSON.stringify(projected);
assert.equal(projectedText.includes('event-4'), false, 'provider context does not leak semantic event IDs');
assert.equal(projectedText.includes('coordinates'), false, 'provider context does not leak raw World observations');
assert.equal(projected.suggestions[0].id, 'inspect-test-support', 'provider context retains only bounded semantic selection identifiers');

let providerCalls = 0;
let capturedPrompt = '';
const ai = createInquiryGuidanceAiInterpreter({
  gateway: {
    async complete(request) {
      providerCalls += 1;
      capturedPrompt = request.messages[0].content;
      return {
        protocol: 'openai-responses',
        text: JSON.stringify({ policy: 'suggest-experiment', conceptId: 'generalization', suggestionId: 'inspect-test-support', depth: null, hypothesis: 'One possible next test is to reduce the shift.' }),
      };
    },
  },
});
const aiResult = await ai.interpret({ trigger, context, config: { protocol: 'openai-responses', apiKey: 'test-key', model: 'test-model' } });
assert.equal(aiResult.source, 'ai', 'a configured provider may rank only an already validated guidance action');
assert.equal(aiResult.suggestionId, 'inspect-test-support', 'AI output cannot create a new operation or suggestion');
assert.match(capturedPrompt, /authoritative deterministic context/, 'provider prompt explicitly establishes deterministic authority');
assert.match(capturedPrompt, /Never invent metrics/, 'provider prompt prohibits fact invention');
assert.equal(capturedPrompt.includes('event-4'), false, 'provider prompt retains no event identifier or raw event payload');

const invalid = createInquiryGuidanceAiInterpreter({ gateway: { async complete() { return { protocol: 'test', text: '{"policy":"suggest-experiment","conceptId":"generalization","suggestionId":"forged","depth":null,"hypothesis":null}' }; } } });
assert.deepEqual(await invalid.interpret({ trigger, context, config: { protocol: 'openai-responses', apiKey: 'test-key', model: 'test-model' } }), fallback, 'invalid provider output falls back deterministically');
const unavailable = createInquiryGuidanceAiInterpreter({ gateway: { async complete() { throw new Error('offline'); } } });
assert.deepEqual(await unavailable.interpret({ trigger, context, config: { protocol: 'openai-responses', apiKey: 'test-key', model: 'test-model' } }), fallback, 'provider failure falls back deterministically');
assert.equal(providerCalls, 1, 'AI runs only when an explicit qualifying trigger is supplied');

const host = createPlaygroundHost({ getDataset: () => null });
await host.open({ playgroundId: 'linear-regression', seed: 77 });
assert.equal(host.getInquiryGuidanceTrigger(), null, 'ordinary open state does not continuously solicit or fabricate guidance');
await host.close();

console.log('Inquiry guidance checks passed: event-triggered deterministic opportunities, bounded cooldown/budget, strict AI selection contract, provider-safe context, and no runtime mutation authority.');
