import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { deriveInquirySuggestions, INQUIRY_SUGGESTION_KINDS } from '../src/core/exploration/inquirySuggestion.js';
import { INQUIRY_CONCEPT_IDS } from '../src/core/exploration/learnerInquiry.js';

const directCandidate = (conceptId, reasonCode) => ({
  conceptId,
  confidence: 'direct',
  reasonCode,
  supportingEventIds: [`event-${conceptId}`],
  supportingObservationIds: conceptId === INQUIRY_CONCEPT_IDS.DISTRIBUTION_SHIFT
    ? ['COVERAGE_MISMATCH']
    : ['TEST_ERROR_CHANGED_MORE'],
});

const host = createPlaygroundHost({ getDataset: () => null });
await host.open({ playgroundId: 'mlp-classification', seed: 811 });
const context = host.inspectContext();
const beforeFingerprint = context.conditionFingerprint;
const inquiry = {
  candidates: [
    directCandidate(INQUIRY_CONCEPT_IDS.DISTRIBUTION_SHIFT, 'test-world-change-with-coverage-mismatch'),
    directCandidate(INQUIRY_CONCEPT_IDS.GENERALIZATION, 'test-world-change-with-test-error-difference'),
  ],
};

const first = deriveInquirySuggestions({ inquiry, context });
const second = deriveInquirySuggestions({ inquiry, context });
assert.deepEqual(first, second, 'the same grounded inquiry state produces deep-equal deterministic suggestions');
assert.ok(first.suggestions.length > 0 && first.suggestions.length <= 2, 'the suggestion budget is bounded to at most two follow-up questions');

const support = first.suggestions.find((item) => item.kind === INQUIRY_SUGGESTION_KINDS.MANUAL_WORLD);
assert.ok(support, 'coverage/generalization evidence produces an inspectable Test-support suggestion');
assert.equal(support.intervention.factor, 'world.test.input', 'the World suggestion isolates Test support rather than guessing a cause');
assert.ok(support.holdFactors.includes('world.train.input'), 'the support suggestion explicitly states that Train input remains fixed');
assert.ok(support.expectedObservableIds.includes('coverageMismatch'), 'the support suggestion names existing coverage evidence to inspect');
assert.equal(Object.hasOwn(support, 'teachingGoal'), false, 'World semantics not represented by TeachingGoal stay as an inspectable manual suggestion');

const capacity = first.suggestions.find((item) => item.kind === INQUIRY_SUGGESTION_KINDS.TEACHING_GOAL);
assert.ok(capacity, 'a descriptor-declared capacity control can produce an executable TeachingGoal suggestion');
assert.equal(capacity.teachingGoal.type, 'compare-control', 'capacity suggestion reuses the existing TeachingGoal family');
assert.equal(capacity.teachingGoal.control, 'hiddenUnits', 'the model-owned declaration, not a React/model-id branch, selects capacity');
assert.deepEqual(capacity.holdFactors, ['world', 'learning', 'evaluation', 'randomness-policy'], 'capacity suggestion states bounded intended holds');
assert.equal(capacity.teachingGoal.values.length, 2, 'capacity suggestion compares exactly two validated registered values');

const plan = await host.plan({ goal: capacity.teachingGoal });
const composed = await host.composeScript({ plan });
assert.equal(composed.dryRun.valid, true, 'suggested TeachingGoal passes the existing strict script dry run');
assert.equal(composed.fidelity.valid, true, 'suggested TeachingGoal passes existing deterministic teaching fidelity');
assert.equal(host.inspectContext().conditionFingerprint, beforeFingerprint, 'planning and composing a suggestion do not mutate the Experiment condition');

const loaded = await host.loadScript(composed.script, { provenance: 'inquiry-suggestion-check' });
let runtime = loaded;
for (let index = 0; index < (loaded.scriptState?.totalSteps ?? 0); index += 1) {
  runtime = await host.dispatch({ type: 'SCRIPT_STEP', actor: 'system' });
}
assert.equal(runtime.scriptState?.step, runtime.scriptState?.totalSteps, 'a learner-approved TeachingGoal remains executable through the normal Script Runtime path');

const forged = deriveInquirySuggestions({
  inquiry: { candidates: [{ conceptId: INQUIRY_CONCEPT_IDS.GENERALIZATION, confidence: 'direct', reasonCode: 'forged', supportingEventIds: ['event-forged'] }] },
  context,
});
assert.deepEqual(forged.suggestions, [], 'caller-authored or ungrounded candidate reasons cannot create an inquiry suggestion');
assert.deepEqual(deriveInquirySuggestions({ inquiry: { candidates: [] }, context }).suggestions, [], 'no factual inquiry opportunity produces no placeholder suggestion');
assert.deepEqual(host.suggestInquiry().suggestions, [], 'Host suggestions consume its own deterministic inquiry projection rather than caller input');
await host.close();

console.log('Inquiry suggestion checks passed: bounded deterministic support/capacity proposals, explicit holds and evidence, manual World parity, TeachingGoal planning/composition/dry-run/fidelity/runtime path, no mutation before execution, and forged-candidate rejection.');
