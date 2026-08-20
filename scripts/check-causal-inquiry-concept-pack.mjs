import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import {
  CAUSAL_INQUIRY_STEP_IDS,
  deriveCausalInquiryState,
  listCausalInquirySteps,
} from '../src/core/exploration/causalInquiry.js';
import { getCausalWorldPrototype } from '../src/core/exploration/causalWorldPrototype.js';
import { INQUIRY_CONCEPT_IDS } from '../src/core/exploration/learnerInquiry.js';

const events = [
  { id: 'event-world', sequence: 1, type: 'world.intervened', semanticFactors: ['world.test.input'] },
  { id: 'event-observation', sequence: 2, type: 'observation.detected', reasonCode: 'COVERAGE_MISMATCH', semanticFactors: [] },
  { id: 'event-compare', sequence: 3, type: 'comparison.completed', semanticFactors: ['world'] },
  { id: 'event-repeat', sequence: 4, type: 'repeat.completed', semanticFactors: [] },
];
const direct = (conceptId, reasonCode, eventIds) => ({ conceptId, confidence: 'direct', reasonCode, supportingEventIds: eventIds });
const cleanInquiry = {
  explicitHypothesis: { entryId: 'prediction-1', text: 'The Test result may differ.' },
  candidates: [
    direct(INQUIRY_CONCEPT_IDS.CONTROLLED_COMPARISON, 'duplicated-one-factor-comparison', ['event-compare']),
    direct(INQUIRY_CONCEPT_IDS.COUNTERFACTUAL_REASONING, 'changed-one-condition-against-baseline', ['event-compare']),
    direct(INQUIRY_CONCEPT_IDS.STABILITY, 'repeat-variation-observed', ['event-repeat']),
  ],
};
const clean = deriveCausalInquiryState({ inquiry: cleanInquiry, semanticEvents: { events } });
const cleanIds = clean.steps.map((item) => item.id);
assert.ok(cleanIds.includes(CAUSAL_INQUIRY_STEP_IDS.OBSERVED_PATTERN), 'a deterministic detector notice starts with an observed pattern, not an asserted cause');
assert.ok(cleanIds.includes(CAUSAL_INQUIRY_STEP_IDS.HYPOTHESIS), 'only an explicit learner prediction becomes a hypothesis step');
assert.ok(cleanIds.includes(CAUSAL_INQUIRY_STEP_IDS.INTERVENTION), 'a registered World factor change becomes an intervention step');
assert.ok(cleanIds.includes(CAUSAL_INQUIRY_STEP_IDS.CONTROLLED_COMPARISON), 'an existing exact inquiry candidate becomes a controlled-comparison step');
assert.ok(cleanIds.includes(CAUSAL_INQUIRY_STEP_IDS.COUNTERFACTUAL), 'a preserved baseline variation becomes a counterfactual-reasoning step');
assert.ok(cleanIds.includes(CAUSAL_INQUIRY_STEP_IDS.REPEAT_UNCERTAINTY), 'repeat variation becomes an uncertainty step');
assert.equal(clean.nextAction, 'compare-repeat-variation', 'the next action follows grounded uncertainty evidence without asserting an explanation');

const mixed = deriveCausalInquiryState({
  inquiry: { candidates: [direct(INQUIRY_CONCEPT_IDS.MIXED_FACTOR_COMPARISON, 'mixed-factor-comparison', ['event-compare'])] },
  semanticEvents: { events },
});
assert.deepEqual(mixed.steps.map((item) => item.id), [
  CAUSAL_INQUIRY_STEP_IDS.OBSERVED_PATTERN,
  CAUSAL_INQUIRY_STEP_IDS.INTERVENTION,
  CAUSAL_INQUIRY_STEP_IDS.CONFOUNDED_COMPARISON,
], 'a mixed comparison is named as an interpretation limit, not silently promoted to a controlled causal test');
assert.equal(mixed.nextAction, 'isolate-one-factor', 'mixed evidence proposes isolation rather than causal certainty');

const noHypothesis = deriveCausalInquiryState({ inquiry: { candidates: [] }, semanticEvents: { events: [events[1]] } });
assert.equal(noHypothesis.steps.some((item) => item.id === CAUSAL_INQUIRY_STEP_IDS.HYPOTHESIS), false, 'ordinary observations never fabricate a learner hypothesis');
assert.equal(noHypothesis.steps.some((item) => item.id === 'association'), false, 'ordinary metric/detector evidence never fabricates an association claim without an explicit causal-world contract');
assert.ok(!JSON.stringify(clean).match(/caus|caused|proves|because/i), 'the runtime projection retains no causal conclusion language');
assert.deepEqual(clean, deriveCausalInquiryState({ inquiry: cleanInquiry, semanticEvents: { events } }), 'the same semantic inputs produce a deterministic causal-inquiry projection');

const staleComparison = deriveCausalInquiryState({
  inquiry: {
    activeComparison: {
      experimentIds: ['experiment-b', 'experiment-c'],
      activeExperimentId: 'experiment-c',
      againstExperimentId: 'experiment-b',
    },
    candidates: [],
  },
  semanticEvents: {
    events: [
      { id: 'stale-world', sequence: 1, type: 'world.intervened', experimentIds: ['experiment-a'], semanticFactors: ['world.test.input'] },
      { id: 'stale-observation', sequence: 2, type: 'observation.detected', experimentIds: ['experiment-a', 'experiment-b'], reasonCode: 'COVERAGE_MISMATCH', semanticFactors: [] },
    ],
  },
});
assert.equal(staleComparison.steps.some((item) => [CAUSAL_INQUIRY_STEP_IDS.OBSERVED_PATTERN, CAUSAL_INQUIRY_STEP_IDS.INTERVENTION].includes(item.id)), false, 'events from an older experiment/comparison pair cannot become current causal inquiry evidence');

const prototype = getCausalWorldPrototype();
assert.equal(prototype.status, 'design-only', 'the prototype is an inspectable design seam, not a second live World state machine');
assert.deepEqual(prototype.observables, ['study-effort', 'assessment-outcome'], 'the prototype declares observable variables explicitly');
assert.deepEqual(prototype.intervenables, ['study-effort'], 'the prototype declares the only permitted intervention explicitly');
assert.deepEqual(prototype.latentVariables, ['prior-preparation'], 'the prototype declares its latent variable rather than hiding it as a runtime fact');
assert.equal(Object.hasOwn(prototype, 'observations'), false, 'the design seam contains no raw observations or generated dataset');
assert.equal(Object.hasOwn(prototype, 'operations'), false, 'the design seam cannot become an Agent-only execution path');
assert.equal(listCausalInquirySteps().length, 7, 'the causal/scientific reasoning pack stays deliberately bounded');

const host = createPlaygroundHost({ getDataset: () => null });
const snapshot = await host.open({ playgroundId: 'linear-regression', seed: 391 });
assert.deepEqual(snapshot.causalInquiry, host.inspectContext().exploration.causalInquiry, 'normal snapshots and Agent inspection share the same deterministic causal inquiry projection');
await host.close();

console.log('Causal inquiry concept-pack checks passed: bounded factual reasoning stages, explicit hypothesis/intervention/comparison/confound/repeat guards, no fabricated association or causal conclusion, and a non-executable Causal World prototype contract.');
