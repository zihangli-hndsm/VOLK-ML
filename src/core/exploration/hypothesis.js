// Session-local learner hypotheses. This module is deliberately data-only:
// it never dispatches runtime actions, persists data, or mutates World/Experiment.

import { isEvidenceInstanceId } from './evidenceProvenance.js';

export const HYPOTHESIS_VERSION = 1;
export const MAX_HYPOTHESES = 8;
export const MAX_HYPOTHESIS_STATEMENT_LENGTH = 240;
export const MAX_HYPOTHESIS_CONCEPTS = 4;
export const MAX_HYPOTHESIS_EVIDENCE = 8;
export const HYPOTHESIS_PREDICTION_CHOICES = Object.freeze(['increase', 'decrease', 'similar', 'uncertain']);

export const HYPOTHESIS_STATUSES = Object.freeze({
  PROPOSED: 'proposed',
  TESTING: 'testing',
  SUPPORTED: 'supported',
  REJECTED: 'rejected',
  REVISED: 'revised',
});

const VALID_STATUSES = new Set(Object.values(HYPOTHESIS_STATUSES));
const MAX_ID_LENGTH = 160;

function boundedId(value) {
  const normalized = typeof value === 'string' ? value.trim().slice(0, MAX_ID_LENGTH) : '';
  return normalized || null;
}

function safeIds(values, limit) {
  return [...new Set((Array.isArray(values) ? values : []).map(boundedId).filter(Boolean))].slice(0, limit);
}

function safeEvidenceIds(values, limit) {
  return safeIds(values, limit).filter((id) => isEvidenceInstanceId(id));
}

function normalizeStatement(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePrediction(value) {
  if (!value || typeof value !== 'object' || !HYPOTHESIS_PREDICTION_CHOICES.includes(value.choice)) return null;
  return Object.freeze({ choice: value.choice });
}

function normalizeCreatedAt(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 64) return null;
  return value.trim();
}

export function clearHypotheses() {
  return Object.freeze({ version: HYPOTHESIS_VERSION, hypotheses: Object.freeze([]) });
}

export function createHypothesis({ id, statement, linkedConceptIds = [], createdFrom = 'learner', createdAt = null, experimentId = null, threadId = null, prediction = null } = {}) {
  const normalizedId = boundedId(id);
  const normalizedStatement = normalizeStatement(statement);
  if (!normalizedId || !normalizedStatement || createdFrom !== 'learner') return null;
  if (normalizedStatement.length > MAX_HYPOTHESIS_STATEMENT_LENGTH) return null;
  return Object.freeze({
    id: normalizedId,
    statement: normalizedStatement,
    linkedConceptIds: Object.freeze(safeIds(linkedConceptIds, MAX_HYPOTHESIS_CONCEPTS)),
    ...(normalizeCreatedAt(createdAt) ? { createdAt: normalizeCreatedAt(createdAt) } : {}),
    ...(boundedId(experimentId) ? { experimentId: boundedId(experimentId) } : {}),
    ...(boundedId(threadId) ? { threadId: boundedId(threadId) } : {}),
    ...(normalizePrediction(prediction) ? { prediction: normalizePrediction(prediction) } : {}),
    status: HYPOTHESIS_STATUSES.PROPOSED,
    evidenceIds: Object.freeze([]),
    createdFrom: 'learner',
  });
}

function normalizeHypothesis(value) {
  const hypothesis = createHypothesis({
    id: value?.id,
    statement: value?.statement,
    linkedConceptIds: value?.linkedConceptIds,
    createdFrom: value?.createdFrom,
    createdAt: value?.createdAt,
    experimentId: value?.experimentId,
    threadId: value?.threadId,
    prediction: value?.prediction,
  });
  if (!hypothesis) return null;
  const status = VALID_STATUSES.has(value?.status) ? value.status : HYPOTHESIS_STATUSES.PROPOSED;
  return Object.freeze({
    ...hypothesis,
    status,
    evidenceIds: Object.freeze(safeEvidenceIds(value?.evidenceIds, MAX_HYPOTHESIS_EVIDENCE)),
  });
}

export function normalizeHypothesisState(value) {
  const hypotheses = (Array.isArray(value?.hypotheses) ? value.hypotheses : [])
    .map(normalizeHypothesis)
    .filter(Boolean)
    .slice(0, MAX_HYPOTHESES);
  return Object.freeze({ version: HYPOTHESIS_VERSION, hypotheses: Object.freeze(hypotheses) });
}

export function appendHypothesis(state, hypothesis) {
  const current = normalizeHypothesisState(state);
  const normalized = normalizeHypothesis(hypothesis);
  if (!normalized || current.hypotheses.some((item) => item.id === normalized.id) || current.hypotheses.length >= MAX_HYPOTHESES) return current;
  return Object.freeze({ version: HYPOTHESIS_VERSION, hypotheses: Object.freeze([...current.hypotheses, normalized]) });
}

export function setHypothesisStatus(state, { hypothesisId, status } = {}) {
  const current = normalizeHypothesisState(state);
  if (!boundedId(hypothesisId) || !VALID_STATUSES.has(status)) return current;
  return Object.freeze({
    version: HYPOTHESIS_VERSION,
    hypotheses: Object.freeze(current.hypotheses.map((hypothesis) => hypothesis.id === hypothesisId
      ? Object.freeze({ ...hypothesis, status })
      : hypothesis)),
  });
}

export function bindHypothesisEvidence(state, { hypothesisId, evidenceIds = [], validEvidenceIds = [] } = {}) {
  const current = normalizeHypothesisState(state);
  const allowed = new Set(safeIds(validEvidenceIds, Number.MAX_SAFE_INTEGER));
  const attached = safeEvidenceIds(evidenceIds, MAX_HYPOTHESIS_EVIDENCE).filter((id) => allowed.has(id));
  return Object.freeze({
    version: HYPOTHESIS_VERSION,
    hypotheses: Object.freeze(current.hypotheses.map((hypothesis) => hypothesis.id === hypothesisId
      ? Object.freeze({ ...hypothesis, evidenceIds: Object.freeze([...new Set([...hypothesis.evidenceIds, ...attached])].slice(0, MAX_HYPOTHESIS_EVIDENCE)) })
      : hypothesis)),
  });
}

export function getHypothesis(state, hypothesisId) {
  return normalizeHypothesisState(state).hypotheses.find((hypothesis) => hypothesis.id === hypothesisId) ?? null;
}
