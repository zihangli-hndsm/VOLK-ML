import assert from 'node:assert/strict';
import {
  appendHypothesis,
  bindHypothesisEvidence,
  clearHypotheses,
  createHypothesis,
  getHypothesis,
  setHypothesisStatus,
  HYPOTHESIS_STATUSES,
} from '../src/core/exploration/hypothesis.js';
import { deriveConceptGraph } from '../src/core/ui/conceptGraph.js';
import { deriveLumiInteraction } from '../src/core/ui/lumiInteraction.js';

const base = clearHypotheses();
const world = { id: 'world-before', points: [{ x: 1, y: 2 }] };
assert.equal(createHypothesis({ id: 'h1', statement: 'Noise may relate to test error', createdFrom: 'agent' }), null);
assert.equal(createHypothesis({ id: 'h1', statement: '' }), null);
assert.equal(createHypothesis({ id: 'h1', statement: 'x'.repeat(241) }), null);

const created = createHypothesis({
  id: 'h1',
  statement: 'The shifted test distribution may relate to lower accuracy.',
  linkedConceptIds: ['train-test-distribution-shift', 'train-test-distribution-shift'],
});
assert.equal(created.status, HYPOTHESIS_STATUSES.PROPOSED);
assert.deepEqual(created.evidenceIds, []);
let state = appendHypothesis(base, created);
assert.equal(state.hypotheses.length, 1);
assert.equal(getHypothesis(state, 'h1').status, HYPOTHESIS_STATUSES.PROPOSED);

// No automatic status upgrade or evidence attachment occurs during projection.
const journey = {
  events: [{ type: 'connect', conceptId: 'train-test-distribution-shift', evidenceId: 'observation-1' }],
  currentTarget: { type: 'concept', id: 'train-test-distribution-shift' },
  connectedConceptIds: ['train-test-distribution-shift'],
};
const withoutHypothesis = deriveConceptGraph({ journey, activeConceptId: 'train-test-distribution-shift' });
assert.equal(withoutHypothesis.hypothesisNodes.length, 0);
const graph = deriveConceptGraph({ journey, activeConceptId: 'train-test-distribution-shift', hypotheses: state.hypotheses });
assert.equal(graph.hypothesisNodes.length, 1);
assert.equal(graph.hypothesisNodes[0].status, HYPOTHESIS_STATUSES.PROPOSED);
assert.ok(graph.hypothesisEdges.some((edge) => edge.relation === 'hypothesis_link'));
assert.equal(graph.causalEdgeCount, 0);

state = bindHypothesisEvidence(state, {
  hypothesisId: 'h1',
  evidenceIds: ['observation-1', 'not-existing'],
  validEvidenceIds: ['observation-1'],
});
assert.deepEqual(getHypothesis(state, 'h1').evidenceIds, ['observation-1']);
assert.equal(getHypothesis(state, 'h1').status, HYPOTHESIS_STATUSES.PROPOSED);
state = setHypothesisStatus(state, { hypothesisId: 'h1', status: HYPOTHESIS_STATUSES.TESTING });
assert.equal(getHypothesis(state, 'h1').status, HYPOTHESIS_STATUSES.TESTING);

const attention = deriveLumiInteraction({
  snapshot: {
    observations: [{ id: 'observation-1' }],
    learnerInquiry: { candidates: [{ conceptId: 'train-test-distribution-shift' }] },
  },
  activeConceptId: 'train-test-distribution-shift',
});
assert.deepEqual(attention.hypothesisPrompt, { conceptId: 'train-test-distribution-shift', evidenceId: 'observation-1' });
assert.equal(Object.prototype.hasOwnProperty.call(attention, 'createHypothesis'), false);
assert.deepEqual(world, { id: 'world-before', points: [{ x: 1, y: 2 }] });

console.log('Hypothesis checks passed: explicit learner creation, bounded session state, evidence binding, graph projection, no automatic causal inference, and World isolation.');
