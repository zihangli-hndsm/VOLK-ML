import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import {
  INQUIRY_CONCEPT_IDS,
  deriveLearnerInquiryState,
  getInquiryConcept,
  listInquiryConcepts,
} from '../src/core/exploration/learnerInquiry.js';
import { materializeWorldGesture } from '../src/core/exploration/gestures.js';

const event = ({ id, sequence, type, experimentIds = [], semanticFactors = [], reasonCode, evidenceRefs = [] }) => ({
  id,
  sequence,
  type,
  experimentIds,
  semanticFactors,
  reasonCode,
  evidenceRefs,
});

const comparison = (changed = ['world'], clarity = 'high') => ({
  enabled: true,
  activeExperimentId: 'experiment-b',
  againstExperimentId: 'experiment-a',
  diff: { changed, unchanged: ['model', 'learning', 'evaluation', 'randomness'], clarity },
});

assert.equal(listInquiryConcepts().length, 6, 'Goal 2 catalog remains deliberately bounded');
assert.equal(getInquiryConcept(INQUIRY_CONCEPT_IDS.GENERALIZATION).id, INQUIRY_CONCEPT_IDS.GENERALIZATION, 'registry declarations are available without an Agent or UI');
assert.deepEqual(getInquiryConcept('not-a-concept'), null, 'unknown concept IDs are not accepted by the registry');

const host = createPlaygroundHost({ getDataset: () => null });
let snapshot = await host.open({ playgroundId: 'linear-regression', seed: 43 });
const baselineId = snapshot.experimentWorkspace.activeExperimentId;
snapshot = await host.dispatch({ type: 'DUPLICATE_EXPERIMENT', actor: 'human' });
const branchId = snapshot.experimentWorkspace.activeExperimentId;
snapshot = await host.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.2, actor: 'human' });
snapshot = await host.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: baselineId, actor: 'human' });

const cleanIds = snapshot.learnerInquiry.candidates.map((item) => item.conceptId);
assert.ok(cleanIds.includes(INQUIRY_CONCEPT_IDS.CONTROLLED_COMPARISON), 'duplicate plus one canonical factor and comparison produces a controlled-comparison candidate');
assert.ok(cleanIds.includes(INQUIRY_CONCEPT_IDS.COUNTERFACTUAL_REASONING), 'the same clean baseline variation produces a bounded counterfactual-reasoning pattern candidate');
const controlled = snapshot.learnerInquiry.candidates.find((item) => item.conceptId === INQUIRY_CONCEPT_IDS.CONTROLLED_COMPARISON);
assert.deepEqual(controlled.supportingEventIds.length, 2, 'controlled comparison retains inspectable duplicate and compare event references');
assert.equal(snapshot.learnerInquiry.activeComparison.activeExperimentId, branchId, 'inquiry state uses the authoritative active Experiment identity');
assert.equal(snapshot.learnerInquiry.inquiryStage, 'comparing', 'active comparison determines the bounded inquiry stage');
assert.deepEqual(host.inspectContext().exploration.learnerInquiry, snapshot.learnerInquiry, 'normal snapshot and detached inspection expose the same deterministic inquiry projection');

const mixedHost = createPlaygroundHost({ getDataset: () => null });
let mixed = await mixedHost.open({ playgroundId: 'linear-regression', seed: 47 });
const mixedBaseline = mixed.experimentWorkspace.activeExperimentId;
mixed = await mixedHost.dispatch({ type: 'DUPLICATE_EXPERIMENT', actor: 'human' });
mixed = await mixedHost.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.3, actor: 'human' });
const gesture = materializeWorldGesture({
  id: 'inquiry-mixed-gesture',
  tool: 'brush',
  path: [{ x: -1, y: 0 }, { x: 0, y: 1 }],
  membership: 'test',
  existingPointCount: mixed.world.observations.length,
});
mixed = await mixedHost.dispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction: gesture });
mixed = await mixedHost.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: mixedBaseline, actor: 'human' });
assert.equal(mixed.experimentWorkspace.comparison.diff.clarity, 'mixed', 'fixture produces an authoritative mixed comparison');
assert.ok(mixed.learnerInquiry.candidates.some((item) => item.conceptId === INQUIRY_CONCEPT_IDS.MIXED_FACTOR_COMPARISON), 'multiple changed semantic factors and comparison produce the mixed-factor candidate');
assert.equal(mixed.learnerInquiry.candidates.some((item) => item.conceptId === INQUIRY_CONCEPT_IDS.CONTROLLED_COMPARISON), false, 'mixed comparison never becomes a controlled-comparison candidate');

const distributionEvents = [
  event({ id: 'event-world-test', sequence: 1, type: 'world.intervened', experimentIds: ['experiment-b'], semanticFactors: ['world.test.input'], reasonCode: 'world-transaction' }),
  event({ id: 'event-compare', sequence: 2, type: 'comparison.completed', experimentIds: ['experiment-a', 'experiment-b'], semanticFactors: ['world'], reasonCode: 'comparison-ready' }),
  event({ id: 'event-coverage', sequence: 3, type: 'observation.detected', experimentIds: ['experiment-a', 'experiment-b'], reasonCode: 'COVERAGE_MISMATCH', evidenceRefs: ['coverageMismatch'] }),
  event({ id: 'event-test-error', sequence: 4, type: 'observation.detected', experimentIds: ['experiment-a', 'experiment-b'], reasonCode: 'TEST_ERROR_CHANGED_MORE', evidenceRefs: ['outcome.testMse', 'outcome.trainMse'] }),
];
const distributionState = deriveLearnerInquiryState({ semanticEvents: { events: distributionEvents }, comparison: comparison(['world']) });
assert.ok(distributionState.candidates.some((item) => item.conceptId === INQUIRY_CONCEPT_IDS.DISTRIBUTION_SHIFT), 'Test World change plus factual coverage mismatch produces distribution-shift candidate');
assert.ok(distributionState.candidates.some((item) => item.conceptId === INQUIRY_CONCEPT_IDS.GENERALIZATION), 'Test World change plus factual Test-error difference produces generalization candidate');
assert.deepEqual(distributionState.candidates.find((item) => item.conceptId === INQUIRY_CONCEPT_IDS.DISTRIBUTION_SHIFT).supportingObservationIds, ['COVERAGE_MISMATCH'], 'candidate retains only stable observation identity rather than raw detector evidence');

const noTestWorld = deriveLearnerInquiryState({
  semanticEvents: { events: distributionEvents.filter((item) => item.id !== 'event-world-test') },
  comparison: comparison(['learning']),
});
assert.equal(noTestWorld.candidates.some((item) => [INQUIRY_CONCEPT_IDS.DISTRIBUTION_SHIFT, INQUIRY_CONCEPT_IDS.GENERALIZATION].includes(item.conceptId)), false, 'metric notices alone never claim a Test-world concept');

const repeatEvents = [
  event({ id: 'event-repeat', sequence: 1, type: 'repeat.completed', experimentIds: ['experiment-b'], reasonCode: 'repeat-evidence-ready' }),
  event({ id: 'event-repeat-observation', sequence: 2, type: 'observation.detected', experimentIds: ['experiment-b'], reasonCode: 'REPEAT_VARIATION', evidenceRefs: ['repeatSlopeSpread'] }),
];
const stability = deriveLearnerInquiryState({ semanticEvents: { events: repeatEvents } });
assert.ok(stability.candidates.some((item) => item.conceptId === INQUIRY_CONCEPT_IDS.STABILITY), 'repeat completion plus repeat variation notice produces a stability candidate');
assert.equal(deriveLearnerInquiryState({ semanticEvents: { events: repeatEvents.slice(0, 1) } }).candidates.length, 0, 'repeat completion alone does not claim observed variation');

const hypothesisState = deriveLearnerInquiryState({
  semanticEvents: { events: [] },
  activeExplorationThread: { entries: [{ id: 'prediction-1', kind: 'prediction', text: 'The Test error may change more.' }] },
  conceptualDepth: 'evidence',
  conceptsPreviouslySurfaced: [INQUIRY_CONCEPT_IDS.GENERALIZATION, 'forged-concept'],
});
assert.deepEqual(hypothesisState.explicitHypothesis, { entryId: 'prediction-1', text: 'The Test error may change more.' }, 'explicit Thread prediction is tracked only when it already exists');
assert.equal(hypothesisState.conceptualDepth, 'evidence', 'explicit presentation depth is retained without being inferred from runtime behavior');
assert.deepEqual(hypothesisState.conceptsPreviouslySurfaced, [INQUIRY_CONCEPT_IDS.GENERALIZATION], 'only registered bounded exposure IDs are retained');
assert.deepEqual(distributionState, deriveLearnerInquiryState({ semanticEvents: { events: distributionEvents }, comparison: comparison(['world']) }), 'same factual input produces a deep-equal deterministic inquiry state');
assert.ok(!JSON.stringify(distributionState).match(/caus|because|proves/i), 'candidates retain factual reason codes without causal language');

await host.close();
await mixedHost.close();
console.log('Learner inquiry checks passed: bounded registry, deterministic candidate provenance, clean/mixed comparison recognition, evidence-gated distribution/generalization/stability, false-positive guards, and no-AI state projection.');
