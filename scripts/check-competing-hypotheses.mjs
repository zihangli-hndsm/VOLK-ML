import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  appendDiscriminationPlan,
  appendHypothesisGroup,
  clearDiscriminationPlans,
  clearHypothesisGroups,
  createDiscriminationPlan,
  createHypothesisGroup,
  deriveDiscriminationStructure,
  discriminationSemanticEdges,
  DISCRIMINATION_STATUSES,
  normalizeHypothesisGroupState,
} from '../src/core/exploration/competingHypotheses.js';
import { createHypothesis, normalizeHypothesisState } from '../src/core/exploration/hypothesis.js';
import { createTestDesign } from '../src/core/exploration/testDesign.js';

const hypotheses = [
  createHypothesis({ id: 'hypothesis-a', statement: 'Noise increase raises Test error.', prediction: { choice: 'increase' } }),
  createHypothesis({ id: 'hypothesis-b', statement: 'Noise increase leaves Test error similar.', prediction: { choice: 'similar' } }),
  createHypothesis({ id: 'hypothesis-c', statement: 'Noise increase lowers Test error.', prediction: { choice: 'decrease' } }),
].filter(Boolean);
const hypothesisState = normalizeHypothesisState({ hypotheses });
const design = createTestDesign({
  id: 'design-1',
  hypothesisId: 'hypothesis-a',
  baselineExperimentId: 'experiment-1',
  intervention: { factorKind: 'observationProcess', semanticPath: 'observationProcess.noise', operationType: 'SET_GENERATOR_PARAMETER', path: 'noise.amount', toValue: 0.8 },
  outcomeObservableIds: ['outcome.testMse'],
});
assert.ok(design, 'an existing Test Design is the plan execution contract');

const emptyGroups = clearHypothesisGroups();
assert.equal(emptyGroups.groups.length, 0, 'no group is inferred from nearby hypotheses');
const invalidGroup = createHypothesisGroup({ id: 'invalid', hypothesisIds: ['hypothesis-a', 'forged'], hypotheses });
assert.equal(invalidGroup, null, 'group rejects non-learner or forged hypothesis references');
const group = createHypothesisGroup({ id: 'group-1', question: 'Which explanation does the noise test separate?', hypothesisIds: ['hypothesis-a', 'hypothesis-b'], hypotheses });
assert.ok(group, 'learner explicitly creates a competing group');
const groups = appendHypothesisGroup(emptyGroups, group, { hypotheses });
assert.deepEqual(groups.groups[0].hypothesisIds, ['hypothesis-a', 'hypothesis-b'], 'group preserves explicit learner selection');

const plan = createDiscriminationPlan({
  id: 'plan-1',
  hypothesisGroupId: group.id,
  testDesignId: design.id,
  predictedOutcomes: [
    { hypothesisId: 'hypothesis-a', prediction: 'increase', note: 'written by learner' },
    { hypothesisId: 'hypothesis-b', prediction: 'similar' },
  ],
  groups: groups.groups,
  hypotheses,
  testDesigns: [design],
});
assert.ok(plan, 'plan stores learner-authored predictions for one existing Test Design');
assert.equal(createDiscriminationPlan({
  id: 'plan-forged',
  hypothesisGroupId: group.id,
  testDesignId: design.id,
  predictedOutcomes: [{ hypothesisId: 'hypothesis-a', prediction: 'increase' }],
  groups: groups.groups,
  hypotheses,
  testDesigns: [design],
}), null, 'plan requires one prediction per hypothesis in the group');

const plans = appendDiscriminationPlan(clearDiscriminationPlans(), plan, { groups: groups.groups, hypotheses, testDesigns: [design] });
assert.equal(plans.plans.length, 1, 'plans remain bounded session-local state');
assert.equal(deriveDiscriminationStructure({ plan, group }).status, DISCRIMINATION_STATUSES.DIVERGE, 'different learner predictions are classified as diverging');
const overlapPlan = createDiscriminationPlan({
  ...plan,
  id: 'plan-overlap',
  predictedOutcomes: [{ hypothesisId: 'hypothesis-a', prediction: 'increase' }, { hypothesisId: 'hypothesis-b', prediction: 'increase' }],
  groups: groups.groups,
  hypotheses,
  testDesigns: [design],
});
assert.equal(deriveDiscriminationStructure({ plan: overlapPlan, group }).status, DISCRIMINATION_STATUSES.OVERLAP, 'same learner predictions overlap');
const incompletePlan = { ...plan, predictedOutcomes: [{ hypothesisId: 'hypothesis-a', prediction: 'increase' }] };
assert.equal(deriveDiscriminationStructure({ plan: incompletePlan, group }).status, DISCRIMINATION_STATUSES.INSUFFICIENT, 'missing predictions remain insufficient');

const observed = deriveDiscriminationStructure({ plan, group, observedPrediction: 'increase' });
assert.equal(observed.predictions.find((item) => item.hypothesisId === 'hypothesis-a').matchesObservedDirection, true, 'observed direction is compared factually');
assert.equal(observed.winnerHypothesisId, null, 'observed outcome never selects a winner');
assert.deepEqual(hypothesisState.hypotheses.map((item) => item.status), ['proposed', 'proposed', 'proposed'], 'observation does not mutate hypothesis status');

const edges = discriminationSemanticEdges({ group, plan, testDesign: design, hypotheses });
assert.deepEqual(edges.map((edge) => edge.relation), ['predicted_by', 'predicted_by', 'tested_by'], 'graph uses neutral discrimination relations');
assert.ok(edges.every((edge) => !String(edge.relation).includes('caused')), 'no causal graph edge is generated');
assert.equal(normalizeHypothesisGroupState({ groups: [{ ...group, hypothesisIds: ['hypothesis-a', 'hypothesis-b', 'hypothesis-c', 'hypothesis-a', 'hypothesis-c'] }] }, { hypotheses }).groups[0].hypothesisIds.length, 3, 'group IDs are deduplicated and bounded');

const uiSource = readFileSync(new URL('../src/components/playground/CompetingHypothesesPanel.jsx', import.meta.url), 'utf8');
assert.match(uiSource, /data-competing-hypotheses/);
assert.match(uiSource, /grid-cols-2/);
assert.match(uiSource, /sm:grid-cols-4/);
assert.ok(!uiSource.includes('winner'), 'UI does not present a winner');
console.log('Competing hypotheses checks passed: explicit groups, bounded learner predictions, neutral discrimination structure, Test Design reuse, no winner, no causal edge, and responsive UI hooks.');
