import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHypothesis } from '../src/core/exploration/hypothesis.js';
import { createTestDesign } from '../src/core/exploration/testDesign.js';
import { deriveConceptGraph } from '../src/core/ui/conceptGraph.js';
import {
  appendCounterfactualQuestion,
  associateCounterfactualTestDesign,
  clearCounterfactualQuestions,
  counterfactualSemanticEdges,
  counterfactualToTestDesign,
  createCounterfactualQuestion,
  deriveCounterfactualMap,
  isCounterfactualStale,
  markCounterfactualTested,
  setCounterfactualStatus,
} from '../src/core/exploration/counterfactual.js';

const hypothesis = createHypothesis({ id: 'hypothesis-counterfactual', statement: 'The changed factor may increase Test error.' });
const question = createCounterfactualQuestion({
  id: 'counterfactual-1',
  question: 'What if the learning rate is higher?',
  baselineExperimentId: 'experiment-baseline',
  baselineConditionFingerprint: 'fingerprint-a',
  intervention: { factorKind: 'learning', semanticPath: 'learning.controls.learningRate', operationType: 'SET_CONTROL', controlKey: 'learningRate', fromValue: 0.1, toValue: 0.2 },
  heldConstantFactors: ['world', 'model'],
  outcomeObservableIds: ['outcome.testMse'],
  prediction: { choice: 'increase' },
});
assert.ok(question, 'counterfactual requires a learner-owned bounded question');
const state = appendCounterfactualQuestion(clearCounterfactualQuestions(), question);
assert.equal(state.questions.length, 1, 'counterfactual state is bounded and session-local');
assert.equal(isCounterfactualStale(question, { baselineExperimentId: 'experiment-baseline', conditionFingerprint: 'fingerprint-b' }), true, 'condition fingerprint makes stale baseline explicit');
assert.equal(isCounterfactualStale(question, { baselineExperimentId: 'experiment-other', conditionFingerprint: 'fingerprint-a' }), true, 'experiment identity makes stale baseline explicit');
const stale = setCounterfactualStatus(state, { questionId: question.id, status: 'stale' });
assert.equal(counterfactualToTestDesign(stale.questions[0], { hypothesisId: hypothesis.id }), null, 'stale question cannot silently become a test');
const design = counterfactualToTestDesign(question, { hypothesisId: hypothesis.id, id: 'test-design-counterfactual-1' });
assert.ok(design, 'explicit learner action reuses the existing Test Design contract');
assert.equal(design.baselineExperimentId, question.baselineExperimentId);
assert.equal(design.intervention.semanticPath, question.intervention.semanticPath);
const converted = associateCounterfactualTestDesign(state, { questionId: question.id, testDesignId: design.id });
assert.equal(converted.questions[0].status, 'converted', 'conversion does not imply execution');
assert.equal(markCounterfactualTested(converted, { questionId: question.id, testDesignId: design.id, executionSucceeded: false }).questions[0].status, 'converted', 'failed execution does not mark tested');
const tested = markCounterfactualTested(converted, { questionId: question.id, testDesignId: design.id, executionSucceeded: true, observedEvidenceInstanceIds: ['evidence-instance-1', 'reason-code'] });
assert.equal(tested.questions[0].status, 'tested');
assert.deepEqual(tested.questions[0].observedEvidenceInstanceIds, ['evidence-instance-1']);
const edges = counterfactualSemanticEdges(question);
assert.ok(edges.some((edge) => edge.relation === 'changed'));
assert.ok(edges.some((edge) => edge.relation === 'held_fixed'));
assert.ok(edges.some((edge) => edge.relation === 'outcome_of_interest'));
assert.ok(edges.every((edge) => edge.relation !== 'observed_under'), 'untested questions do not emit observed evidence');
assert.ok(edges.every((edge) => !String(edge.relation).includes('cause') && !String(edge.relation).includes('confidence')), 'map relations remain neutral');
const map = deriveCounterfactualMap(state.questions);
assert.equal(map.nodes.length, 1);
assert.ok(map.edges.length >= 3);
const graph = deriveConceptGraph({ counterfactualQuestions: state.questions });
assert.equal(graph.counterfactualNodes.length, 1, 'Concept Map projects counterfactual questions');
assert.ok(graph.counterfactualEdges.some((edge) => edge.relation === 'predicted'));
const ui = readFileSync(new URL('../src/components/playground/CounterfactualExplorationPanel.jsx', import.meta.url), 'utf8');
assert.match(ui, /data-counterfactual-exploration/);
assert.match(ui, /sm:grid-cols-4/);
assert.match(ui, /Turn into Test Design|playground\.counterfactual\.testThis/);
assert.doesNotMatch(ui, /dispatchRuntimeAction|executeTestDesign|RUN/);
const mapUi = readFileSync(new URL('../src/components/playground/ConceptMap.jsx', import.meta.url), 'utf8');
assert.match(mapUi, /data-concept-map-counterfactual/);
const moduleSource = readFileSync(new URL('../src/core/exploration/counterfactual.js', import.meta.url), 'utf8');
assert.doesNotMatch(moduleSource, /caused_by|causes|probability|mastery/);
console.log('Counterfactual exploration checks passed: detached learner questions, stale baseline guards, explicit Test Design conversion, neutral map projection, no execution authority, and responsive UI hooks.');
