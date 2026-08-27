import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHypothesis, normalizeHypothesisState } from '../src/core/exploration/hypothesis.js';
import { createTestDesign } from '../src/core/exploration/testDesign.js';
import { deriveConceptGraph } from '../src/core/ui/conceptGraph.js';
import {
  appendHypothesisRevision,
  appendLearnerInterpretation,
  clearHypothesisRevisions,
  clearLearnerInterpretations,
  createHypothesisRevision,
  createLearnerInterpretation,
  interpretationSemanticEdges,
  normalizeLearnerInterpretationState,
} from '../src/core/exploration/learnerInterpretation.js';

const first = createHypothesis({ id: 'hypothesis-one', statement: 'The change increases Test error.' });
const second = createHypothesis({ id: 'hypothesis-two', statement: 'The change leaves Test error similar.' });
const hypotheses = [first, second];
const design = createTestDesign({
  id: 'design-interpretation',
  hypothesisId: first.id,
  baselineExperimentId: 'experiment-1',
  intervention: { factorKind: 'learning', semanticPath: 'learning.controls.learningRate', operationType: 'SET_CONTROL', controlKey: 'learningRate', toValue: 0.2 },
  outcomeObservableIds: ['outcome.testMse'],
});
const evidence = ['evidence-instance-1'];
const unavailableHistoricalEvidence = ['evidence-instance-999'];
const interpretation = createLearnerInterpretation({
  id: 'interpretation-1',
  hypothesisIds: [first.id, second.id],
  testDesignId: design.id,
  evidenceInstanceIds: [...evidence, ...unavailableHistoricalEvidence],
  judgment: 'supports',
  note: 'This is my reading of the observed change.',
  hypotheses,
  testDesigns: [design],
});
assert.ok(interpretation, 'interpretation requires an explicit learner action');
assert.deepEqual(interpretation.evidenceInstanceIds, evidence.concat(unavailableHistoricalEvidence), 'stable historical Evidence IDs remain attached even when unavailable');
assert.equal(createLearnerInterpretation({
  id: 'reason-code',
  hypothesisIds: [first.id],
  evidenceInstanceIds: ['COVERAGE_MISMATCH'],
  judgment: 'supports',
  hypotheses,
  testDesigns: [design],
}), null, 'reasonCode cannot masquerade as an Evidence instance ID');

const interpretationState = appendLearnerInterpretation(clearLearnerInterpretations(), interpretation, { hypotheses, testDesigns: [design] });
assert.equal(interpretationState.interpretations.length, 1, 'interpretations are bounded session history');
const beforeEvidence = [...interpretation.evidenceInstanceIds];
normalizeLearnerInterpretationState(interpretationState, { hypotheses, testDesigns: [design] });
assert.deepEqual(interpretation.evidenceInstanceIds, beforeEvidence, 'interpretation does not mutate Evidence');
assert.equal(normalizeHypothesisState({ hypotheses }).hypotheses[0].status, 'proposed', 'supports judgment does not change hypothesis status');

const child = createHypothesis({ id: 'hypothesis-one-revised', statement: 'The change may increase Test error only after repeated sampling.' });
const nextHypotheses = [...hypotheses, child];
const revision = createHypothesisRevision({
  id: 'revision-one',
  parentHypothesisId: first.id,
  childHypothesisId: child.id,
  interpretationIds: [interpretation.id],
  hypotheses: nextHypotheses,
  interpretations: interpretationState.interpretations,
});
assert.ok(revision, 'revision creates a separate child identity');
assert.equal(revision.id, 'revision-one', 'revision has a stable learner-owned identity');
assert.equal(revision.parentHypothesisId, first.id);
assert.equal(revision.childHypothesisId, child.id);
assert.equal(nextHypotheses.find((item) => item.id === first.id).statement, first.statement, 'old hypothesis remains historical');
const revisionState = appendHypothesisRevision(clearHypothesisRevisions(), revision, { hypotheses: nextHypotheses, interpretations: interpretationState.interpretations });
assert.equal(revisionState.revisions.length, 1, 'revision lineage remains bounded');
assert.equal(appendHypothesisRevision(revisionState, { ...revision, id: 'revision-one' }, { hypotheses: nextHypotheses, interpretations: interpretationState.interpretations }).revisions.length, 1, 'duplicate revision IDs are rejected');

const edges = [
  ...interpretationSemanticEdges({ interpretation }),
  ...interpretationSemanticEdges({ revision }),
];
assert.deepEqual(edges.map((edge) => edge.relation), ['interpreted_in', 'interpreted_in', 'informs_revision', 'informs_revision', 'revised_from']);
assert.ok(edges.every((edge) => !String(edge.relation).includes('proves') && !String(edge.relation).includes('caused')), 'interpretation graph never claims proof or causality');
const graph = deriveConceptGraph({ hypotheses: nextHypotheses, testDesigns: [design], interpretations: interpretationState.interpretations, revisions: revisionState.revisions });
assert.equal(graph.interpretationNodes.length, 1, 'Concept Graph projects learner interpretations');
assert.ok(graph.interpretationEdges.some((edge) => edge.relation === 'interpreted_in'));
assert.ok(graph.interpretationEdges.some((edge) => edge.relation === 'revised_from'));
assert.deepEqual(graph.interpretationEdges.find((edge) => edge.relation === 'revised_from'), { from: child.id, to: first.id, relation: 'revised_from' }, 'revision relation points from child to parent');
assert.ok(!readFileSync(new URL('../src/core/exploration/learnerInterpretation.js', import.meta.url), 'utf8').includes('hypothesis.status'), 'interpretation module has no status mutation authority');

const uiSource = readFileSync(new URL('../src/components/playground/LearnerInterpretationPanel.jsx', import.meta.url), 'utf8');
assert.match(uiSource, /data-learner-interpretation/);
assert.match(uiSource, /sm:grid-cols-4/);
assert.match(uiSource, /Your interpretation|playground\.interpretation\.yourInterpretation/);
console.log('Learner interpretation checks passed: explicit Evidence selection, stable IDs, unavailable history, learner-only judgment, separate revision lineage, neutral graph edges, bounded state, and responsive UI hooks.');
