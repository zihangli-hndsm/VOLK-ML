// Learner-owned counterfactual questions. A question is a detached inquiry
// record; converting it to a Test Design is explicit and still does not run it.

import { createTestDesign } from './testDesign.js';

export const COUNTERFACTUAL_VERSION = 1;
export const MAX_COUNTERFACTUAL_QUESTIONS = 8;
export const MAX_COUNTERFACTUAL_TEXT_LENGTH = 240;
export const COUNTERFACTUAL_STATUSES = Object.freeze({
  PROPOSED: 'proposed',
  TESTED: 'tested',
  STALE: 'stale',
});
export const COUNTERFACTUAL_GRAPH_RELATIONS = Object.freeze({
  COMPARED_WITH: 'compared_with',
  CHANGED: 'changed',
  HELD_FIXED: 'held_fixed',
  OBSERVED_UNDER: 'observed_under',
  PREDICTED: 'predicted',
  TESTED_BY: 'tested_by',
  INTERPRETED_AS: 'interpreted_as',
  REVISED_FROM: 'revised_from',
});

const VALID_STATUSES = new Set(Object.values(COUNTERFACTUAL_STATUSES));
const VALID_FACTORS = new Set(['world', 'observationProcess', 'trainTest', 'model', 'learning', 'evaluation']);

function boundedString(value, max = MAX_COUNTERFACTUAL_TEXT_LENGTH) {
  const normalized = typeof value === 'string' ? value.trim().slice(0, max) : '';
  return normalized || null;
}

function boundedIds(values, limit) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => boundedString(value, 160)).filter(Boolean))].slice(0, limit);
}

function normalizeIntervention(value) {
  if (!value || typeof value !== 'object' || !VALID_FACTORS.has(value.factorKind)) return null;
  const operationType = boundedString(value.operationType, 80);
  const semanticPath = boundedString(value.semanticPath, 160);
  const controlKey = boundedString(value.controlKey, 80);
  const path = boundedString(value.path, 120);
  if (!operationType || (!semanticPath && !controlKey && !path)) return null;
  const normalized = {
    factorKind: value.factorKind,
    operationType,
    ...(semanticPath ? { semanticPath } : {}),
    ...(controlKey ? { controlKey } : {}),
    ...(path ? { path } : {}),
  };
  if (value.fromValue !== undefined) normalized.fromValue = value.fromValue;
  if (value.toValue !== undefined) normalized.toValue = value.toValue;
  if (value.requiresRegenerate) normalized.requiresRegenerate = true;
  return Object.freeze(normalized);
}

function normalizePrediction(value) {
  if (!value || typeof value !== 'object' || !['increase', 'decrease', 'similar', 'uncertain'].includes(value.choice)) return null;
  return Object.freeze({ choice: value.choice });
}

export function clearCounterfactualQuestions() {
  return Object.freeze({ version: COUNTERFACTUAL_VERSION, questions: Object.freeze([]) });
}

export function createCounterfactualQuestion({
  id,
  question,
  baselineExperimentId,
  baselineConditionFingerprint,
  intervention,
  heldConstantFactors = [],
  outcomeObservableIds = [],
  prediction = null,
  status = COUNTERFACTUAL_STATUSES.PROPOSED,
  createdFrom = 'learner',
} = {}) {
  const normalizedId = boundedString(id, 160);
  const normalizedQuestion = boundedString(question);
  const normalizedBaseline = boundedString(baselineExperimentId, 160);
  const normalizedFingerprint = boundedString(baselineConditionFingerprint, 240);
  const normalizedIntervention = normalizeIntervention(intervention);
  if (!normalizedId || !normalizedQuestion || !normalizedBaseline || !normalizedFingerprint || !normalizedIntervention || createdFrom !== 'learner' || !VALID_STATUSES.has(status)) return null;
  return Object.freeze({
    version: COUNTERFACTUAL_VERSION,
    id: normalizedId,
    question: normalizedQuestion,
    baselineExperimentId: normalizedBaseline,
    baselineConditionFingerprint: normalizedFingerprint,
    intervention: normalizedIntervention,
    heldConstantFactors: Object.freeze(boundedIds(heldConstantFactors, 12)),
    outcomeObservableIds: Object.freeze(boundedIds(outcomeObservableIds, 6)),
    ...(normalizePrediction(prediction) ? { prediction: normalizePrediction(prediction) } : {}),
    status,
    createdFrom: 'learner',
  });
}

export function normalizeCounterfactualQuestion(value) {
  return createCounterfactualQuestion(value);
}

export function normalizeCounterfactualState(value) {
  const questions = (Array.isArray(value?.questions) ? value.questions : [])
    .map(normalizeCounterfactualQuestion)
    .filter(Boolean)
    .slice(0, MAX_COUNTERFACTUAL_QUESTIONS);
  return Object.freeze({ version: COUNTERFACTUAL_VERSION, questions: Object.freeze(questions) });
}

export function appendCounterfactualQuestion(state, question) {
  const current = normalizeCounterfactualState(state);
  const normalized = normalizeCounterfactualQuestion(question);
  if (!normalized || current.questions.some((item) => item.id === normalized.id) || current.questions.length >= MAX_COUNTERFACTUAL_QUESTIONS) return current;
  return Object.freeze({ version: COUNTERFACTUAL_VERSION, questions: Object.freeze([...current.questions, normalized]) });
}

export function setCounterfactualStatus(state, { questionId, status } = {}) {
  const current = normalizeCounterfactualState(state);
  if (!boundedString(questionId, 160) || !VALID_STATUSES.has(status)) return current;
  return Object.freeze({ version: COUNTERFACTUAL_VERSION, questions: Object.freeze(current.questions.map((question) => question.id === questionId ? Object.freeze({ ...question, status }) : question)) });
}

export function isCounterfactualStale(question, { baselineExperimentId, conditionFingerprint } = {}) {
  if (!question) return true;
  return Boolean(
    boundedString(baselineExperimentId, 160)
      && baselineExperimentId !== question.baselineExperimentId,
  ) || Boolean(conditionFingerprint && conditionFingerprint !== question.baselineConditionFingerprint);
}

export function counterfactualToTestDesign(question, { hypothesisId, id } = {}) {
  const normalized = normalizeCounterfactualQuestion(question);
  const normalizedHypothesisId = boundedString(hypothesisId, 160);
  if (!normalized || !normalizedHypothesisId || normalized.status === COUNTERFACTUAL_STATUSES.STALE) return null;
  return createTestDesign({
    id: boundedString(id, 160),
    hypothesisId: normalizedHypothesisId,
    baselineExperimentId: normalized.baselineExperimentId,
    baselineConditionFingerprint: normalized.baselineConditionFingerprint,
    intervention: normalized.intervention,
    heldConstantFactors: normalized.heldConstantFactors,
    outcomeObservableIds: normalized.outcomeObservableIds,
    prediction: normalized.prediction,
    createdFrom: 'learner',
  });
}

export function counterfactualSemanticEdges(question) {
  const normalized = normalizeCounterfactualQuestion(question);
  if (!normalized) return [];
  const edges = [
    { from: normalized.id, to: normalized.baselineExperimentId, relation: COUNTERFACTUAL_GRAPH_RELATIONS.COMPARED_WITH },
    { from: normalized.id, to: normalized.intervention.semanticPath ?? normalized.intervention.controlKey ?? normalized.intervention.path, relation: COUNTERFACTUAL_GRAPH_RELATIONS.CHANGED },
    ...normalized.heldConstantFactors.map((factor) => ({ from: normalized.id, to: factor, relation: COUNTERFACTUAL_GRAPH_RELATIONS.HELD_FIXED })),
    ...normalized.outcomeObservableIds.map((observableId) => ({ from: normalized.id, to: observableId, relation: COUNTERFACTUAL_GRAPH_RELATIONS.OBSERVED_UNDER })),
  ];
  if (normalized.prediction) edges.push({ from: normalized.id, to: normalized.prediction.choice, relation: COUNTERFACTUAL_GRAPH_RELATIONS.PREDICTED });
  return edges.slice(0, 24).map((edge) => Object.freeze(edge));
}

export function deriveCounterfactualMap(questions = []) {
  const normalized = normalizeCounterfactualState({ questions });
  const nodes = normalized.questions.map((question) => Object.freeze({
    id: question.id,
    kind: 'counterfactual',
    status: question.status,
    question: question.question,
    intervention: question.intervention,
  }));
  const edges = normalized.questions.flatMap(counterfactualSemanticEdges).slice(0, 48).map((edge) => Object.freeze(edge));
  return Object.freeze({ nodes: Object.freeze(nodes), edges: Object.freeze(edges) });
}
