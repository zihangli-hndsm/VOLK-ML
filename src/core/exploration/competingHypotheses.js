// Session-local learner-authored competing hypotheses and discrimination plans.
// This module describes predictions around an existing Test Design; it never
// executes experiments, ranks hypotheses, or infers truth.

import {
  HYPOTHESIS_PREDICTION_CHOICES,
  normalizeHypothesisState,
} from './hypothesis.js';
import { normalizeTestDesignState } from './testDesign.js';

export const COMPETING_HYPOTHESES_VERSION = 1;
export const MAX_HYPOTHESIS_GROUPS = 6;
export const MAX_HYPOTHESES_PER_GROUP = 4;
export const MAX_DISCRIMINATION_PLANS = 8;
export const MAX_COMPETING_QUESTION_LENGTH = 240;
export const MAX_DISCRIMINATION_NOTE_LENGTH = 160;

export const DISCRIMINATION_STATUSES = Object.freeze({
  DIVERGE: 'predictions-diverge',
  OVERLAP: 'predictions-overlap',
  INSUFFICIENT: 'insufficient-predictions',
});

const VALID_PREDICTIONS = new Set(HYPOTHESIS_PREDICTION_CHOICES);
const CONCRETE_PREDICTIONS = new Set(['increase', 'decrease', 'similar']);
const VALID_STATUSES = new Set(Object.values(DISCRIMINATION_STATUSES));
const MAX_ID_LENGTH = 160;

function boundedString(value, max = MAX_ID_LENGTH) {
  const normalized = typeof value === 'string' ? value.trim().slice(0, max) : '';
  return normalized || null;
}

function boundedIds(values, limit) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => boundedString(value))
    .filter(Boolean))].slice(0, limit);
}

function normalizeQuestion(value) {
  return boundedString(value, MAX_COMPETING_QUESTION_LENGTH);
}

function normalizeNote(value) {
  return boundedString(value, MAX_DISCRIMINATION_NOTE_LENGTH);
}

function learnerHypothesisIds(hypotheses) {
  return new Set(normalizeHypothesisState({ version: 1, hypotheses }).hypotheses
    .filter((hypothesis) => hypothesis.createdFrom === 'learner')
    .map((hypothesis) => hypothesis.id));
}

function testDesignIds(testDesigns) {
  return new Set(normalizeTestDesignState({ version: 1, designs: testDesigns }).designs.map((design) => design.id));
}

export function clearHypothesisGroups() {
  return Object.freeze({ version: COMPETING_HYPOTHESES_VERSION, groups: Object.freeze([]) });
}

export function clearDiscriminationPlans() {
  return Object.freeze({ version: COMPETING_HYPOTHESES_VERSION, plans: Object.freeze([]) });
}

export function createHypothesisGroup({ id, question = '', hypothesisIds = [], hypotheses = [], createdFrom = 'learner' } = {}) {
  const normalizedId = boundedString(id);
  const normalizedHypothesisIds = boundedIds(hypothesisIds, MAX_HYPOTHESES_PER_GROUP);
  const allowed = learnerHypothesisIds(hypotheses);
  if (!normalizedId || createdFrom !== 'learner' || normalizedHypothesisIds.length < 2
    || normalizedHypothesisIds.some((hypothesisId) => !allowed.has(hypothesisId))) return null;
  return Object.freeze({
    version: COMPETING_HYPOTHESES_VERSION,
    id: normalizedId,
    ...(normalizeQuestion(question) ? { question: normalizeQuestion(question) } : {}),
    hypothesisIds: Object.freeze(normalizedHypothesisIds),
    createdFrom: 'learner',
  });
}

export function normalizeHypothesisGroup(value, { hypotheses = [] } = {}) {
  if (!value || typeof value !== 'object') return null;
  return createHypothesisGroup({ ...value, hypotheses });
}

export function normalizeHypothesisGroupState(value, { hypotheses = [] } = {}) {
  const groups = (Array.isArray(value?.groups) ? value.groups : [])
    .map((group) => normalizeHypothesisGroup(group, { hypotheses }))
    .filter(Boolean)
    .slice(0, MAX_HYPOTHESIS_GROUPS);
  return Object.freeze({ version: COMPETING_HYPOTHESES_VERSION, groups: Object.freeze(groups) });
}

export function appendHypothesisGroup(state, group, { hypotheses = [] } = {}) {
  const current = normalizeHypothesisGroupState(state, { hypotheses });
  const normalized = normalizeHypothesisGroup(group, { hypotheses });
  if (!normalized || current.groups.some((item) => item.id === normalized.id) || current.groups.length >= MAX_HYPOTHESIS_GROUPS) return current;
  return Object.freeze({ version: COMPETING_HYPOTHESES_VERSION, groups: Object.freeze([...current.groups, normalized]) });
}

export function getHypothesisGroup(state, groupId, { hypotheses = [] } = {}) {
  const normalizedId = boundedString(groupId);
  return normalizeHypothesisGroupState(state, { hypotheses }).groups.find((group) => group.id === normalizedId) ?? null;
}

function normalizePredictedOutcome(value) {
  if (!value || typeof value !== 'object' || !boundedString(value.hypothesisId) || !VALID_PREDICTIONS.has(value.prediction)) return null;
  const note = normalizeNote(value.note);
  return Object.freeze({
    hypothesisId: boundedString(value.hypothesisId),
    prediction: value.prediction,
    ...(note ? { note } : {}),
  });
}

export function createDiscriminationPlan({
  id,
  hypothesisGroupId,
  testDesignId,
  predictedOutcomes = [],
  groups = [],
  hypotheses = [],
  testDesigns = [],
  createdFrom = 'learner',
} = {}) {
  const normalizedId = boundedString(id);
  const normalizedGroupId = boundedString(hypothesisGroupId);
  const normalizedTestDesignId = boundedString(testDesignId);
  const groupState = normalizeHypothesisGroupState({ groups }, { hypotheses });
  const group = groupState.groups.find((item) => item.id === normalizedGroupId);
  const validTestDesignIds = testDesignIds(testDesigns);
  const normalizedPredictions = (Array.isArray(predictedOutcomes) ? predictedOutcomes : [])
    .map(normalizePredictedOutcome)
    .filter(Boolean)
    .slice(0, MAX_HYPOTHESES_PER_GROUP);
  const expectedIds = group?.hypothesisIds ?? [];
  const predictionIds = normalizedPredictions.map((item) => item.hypothesisId);
  const exactPredictionSet = expectedIds.length === predictionIds.length
    && expectedIds.every((hypothesisId) => predictionIds.includes(hypothesisId));
  if (!normalizedId || !normalizedGroupId || !normalizedTestDesignId || createdFrom !== 'learner'
    || !group || !validTestDesignIds.has(normalizedTestDesignId) || !exactPredictionSet
    || new Set(predictionIds).size !== predictionIds.length) return null;
  return Object.freeze({
    version: COMPETING_HYPOTHESES_VERSION,
    id: normalizedId,
    hypothesisGroupId: normalizedGroupId,
    testDesignId: normalizedTestDesignId,
    predictedOutcomes: Object.freeze(normalizedPredictions),
    createdFrom: 'learner',
  });
}

export function normalizeDiscriminationPlan(value, context = {}) {
  if (!value || typeof value !== 'object') return null;
  return createDiscriminationPlan({ ...value, ...context });
}

export function normalizeDiscriminationPlanState(value, context = {}) {
  const plans = (Array.isArray(value?.plans) ? value.plans : [])
    .map((plan) => normalizeDiscriminationPlan(plan, context))
    .filter(Boolean)
    .slice(0, MAX_DISCRIMINATION_PLANS);
  return Object.freeze({ version: COMPETING_HYPOTHESES_VERSION, plans: Object.freeze(plans) });
}

export function appendDiscriminationPlan(state, plan, context = {}) {
  const current = normalizeDiscriminationPlanState(state, context);
  const normalized = normalizeDiscriminationPlan(plan, context);
  if (!normalized || current.plans.some((item) => item.id === normalized.id) || current.plans.length >= MAX_DISCRIMINATION_PLANS) return current;
  return Object.freeze({ version: COMPETING_HYPOTHESES_VERSION, plans: Object.freeze([...current.plans, normalized]) });
}

export function getDiscriminationPlan(state, planId, context = {}) {
  const normalizedId = boundedString(planId);
  return normalizeDiscriminationPlanState(state, context).plans.find((plan) => plan.id === normalizedId) ?? null;
}

export function deriveDiscriminationStructure({ plan, group = null, observedPrediction = null } = {}) {
  const normalizedPlan = plan && typeof plan === 'object' ? plan : null;
  const predictions = Array.isArray(normalizedPlan?.predictedOutcomes) ? normalizedPlan.predictedOutcomes : [];
  const validPredictions = predictions.filter((item) => VALID_PREDICTIONS.has(item?.prediction));
  const expectedIds = Array.isArray(group?.hypothesisIds) ? group.hypothesisIds : [];
  const predictionByHypothesis = new Map(validPredictions.map((item) => [item.hypothesisId, item.prediction]));
  const hasConcretePredictionForEveryHypothesis = expectedIds.length > 0
    && expectedIds.every((hypothesisId) => CONCRETE_PREDICTIONS.has(predictionByHypothesis.get(hypothesisId)));
  const status = !hasConcretePredictionForEveryHypothesis
    ? DISCRIMINATION_STATUSES.INSUFFICIENT
    : new Set(expectedIds.map((hypothesisId) => predictionByHypothesis.get(hypothesisId))).size > 1
      ? DISCRIMINATION_STATUSES.DIVERGE
      : DISCRIMINATION_STATUSES.OVERLAP;
  const observed = VALID_PREDICTIONS.has(observedPrediction) ? observedPrediction : null;
  return Object.freeze({
    status,
    hypothesisCount: group?.hypothesisIds?.length ?? validPredictions.length,
    predictions: Object.freeze(validPredictions.map((item) => Object.freeze({
      hypothesisId: item.hypothesisId,
      prediction: item.prediction,
      ...(observed ? { matchesObservedDirection: item.prediction === observed } : {}),
    }))),
    observedPrediction: observed,
    winnerHypothesisId: null,
  });
}

export function discriminationSemanticEdges({ group, plan, testDesign, hypotheses = [] } = {}) {
  const normalizedGroup = group && typeof group === 'object' ? group : null;
  const normalizedPlan = plan && typeof plan === 'object' ? plan : null;
  const validHypothesisIds = learnerHypothesisIds(hypotheses);
  if (!normalizedGroup || !normalizedPlan || !validHypothesisIds.size) return [];
  const edges = normalizedGroup.hypothesisIds
    .filter((hypothesisId) => validHypothesisIds.has(hypothesisId))
    .map((hypothesisId) => ({ from: hypothesisId, to: normalizedPlan.id, relation: 'predicted_by' }));
  if (testDesign?.id === normalizedPlan.testDesignId) edges.push({ from: normalizedPlan.id, to: testDesign.id, relation: 'tested_by' });
  return edges.slice(0, MAX_HYPOTHESES_PER_GROUP + 1).map((edge) => Object.freeze(edge));
}

export function discriminationStatusMessageKey(status) {
  return VALID_STATUSES.has(status) ? `playground.discrimination.status.${status}` : 'playground.discrimination.status.insufficient-predictions';
}
