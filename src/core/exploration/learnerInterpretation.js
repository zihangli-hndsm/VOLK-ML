// Learner-owned interpretation and revision provenance. Evidence remains a
// factual occurrence; this module records only what the learner says it means.

import { isEvidenceInstanceId } from './evidenceProvenance.js';
import { normalizeHypothesisState } from './hypothesis.js';
import { normalizeTestDesignState } from './testDesign.js';

export const LEARNER_INTERPRETATION_VERSION = 1;
export const MAX_LEARNER_INTERPRETATIONS = 12;
export const MAX_HYPOTHESIS_REVISIONS = 12;
export const MAX_INTERPRETATION_NOTE_LENGTH = 280;
export const INTERPRETATION_JUDGMENTS = Object.freeze(['supports', 'challenges', 'uncertain', 'needs-more-testing']);

const VALID_JUDGMENTS = new Set(INTERPRETATION_JUDGMENTS);
const MAX_ID_LENGTH = 160;

function boundedString(value, max = MAX_ID_LENGTH) {
  const normalized = typeof value === 'string' ? value.trim().slice(0, max) : '';
  return normalized || null;
}

function boundedIds(values, limit) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => boundedString(value)).filter(Boolean))].slice(0, limit);
}

function hypothesisIds(hypotheses) {
  return new Set(normalizeHypothesisState({ version: 1, hypotheses }).hypotheses.map((hypothesis) => hypothesis.id));
}

function testDesignIds(testDesigns) {
  return new Set(normalizeTestDesignState({ version: 1, designs: testDesigns }).designs.map((design) => design.id));
}

function interpretationIds(interpretations, { hypotheses = [], testDesigns = [] } = {}) {
  const normalized = normalizeLearnerInterpretationState({ interpretations }, { hypotheses, testDesigns }).interpretations.map((interpretation) => interpretation.id);
  const stored = (Array.isArray(interpretations) ? interpretations : [])
    .filter((interpretation) => interpretation?.createdFrom === 'learner' && boundedString(interpretation?.id))
    .map((interpretation) => boundedString(interpretation.id));
  return new Set([...normalized, ...stored]);
}

export function clearLearnerInterpretations() {
  return Object.freeze({ version: LEARNER_INTERPRETATION_VERSION, interpretations: Object.freeze([]) });
}

export function clearHypothesisRevisions() {
  return Object.freeze({ version: LEARNER_INTERPRETATION_VERSION, revisions: Object.freeze([]) });
}

export function createLearnerInterpretation({
  id,
  hypothesisIds: referencedHypothesisIds = [],
  testDesignId = null,
  evidenceInstanceIds = [],
  judgment,
  note = '',
  createdFrom = 'learner',
  hypotheses = [],
  testDesigns = [],
} = {}) {
  const normalizedId = boundedString(id);
  const normalizedHypothesisIds = boundedIds(referencedHypothesisIds, 6);
  const normalizedEvidenceIds = boundedIds(evidenceInstanceIds, 8).filter(isEvidenceInstanceId);
  const allowedHypotheses = hypothesisIds(hypotheses);
  const allowedDesigns = testDesignIds(testDesigns);
  const normalizedTestDesignId = boundedString(testDesignId);
  const normalizedNote = boundedString(note, MAX_INTERPRETATION_NOTE_LENGTH);
  if (!normalizedId || createdFrom !== 'learner' || !VALID_JUDGMENTS.has(judgment) || normalizedEvidenceIds.length === 0
    || normalizedHypothesisIds.length === 0 || normalizedHypothesisIds.some((idValue) => !allowedHypotheses.has(idValue))
    || (normalizedTestDesignId && !allowedDesigns.has(normalizedTestDesignId))) return null;
  return Object.freeze({
    version: LEARNER_INTERPRETATION_VERSION,
    id: normalizedId,
    hypothesisIds: Object.freeze(normalizedHypothesisIds),
    ...(normalizedTestDesignId ? { testDesignId: normalizedTestDesignId } : {}),
    evidenceInstanceIds: Object.freeze(normalizedEvidenceIds),
    judgment,
    ...(normalizedNote ? { note: normalizedNote } : {}),
    createdFrom: 'learner',
  });
}

export function normalizeLearnerInterpretation(value, context = {}) {
  if (!value || typeof value !== 'object') return null;
  return createLearnerInterpretation({ ...value, ...context });
}

export function normalizeLearnerInterpretationState(value, context = {}) {
  const interpretations = (Array.isArray(value?.interpretations) ? value.interpretations : [])
    .map((interpretation) => normalizeLearnerInterpretation(interpretation, context))
    .filter(Boolean)
    .slice(0, MAX_LEARNER_INTERPRETATIONS);
  return Object.freeze({ version: LEARNER_INTERPRETATION_VERSION, interpretations: Object.freeze(interpretations) });
}

export function appendLearnerInterpretation(state, interpretation, context = {}) {
  const current = normalizeLearnerInterpretationState(state, context);
  const normalized = normalizeLearnerInterpretation(interpretation, context);
  if (!normalized || current.interpretations.some((item) => item.id === normalized.id) || current.interpretations.length >= MAX_LEARNER_INTERPRETATIONS) return current;
  return Object.freeze({ version: LEARNER_INTERPRETATION_VERSION, interpretations: Object.freeze([...current.interpretations, normalized]) });
}

export function createHypothesisRevision({
  id,
  parentHypothesisId,
  childHypothesisId,
  interpretationIds: referencedInterpretationIds = [],
  hypotheses = [],
  interpretations = [],
  testDesigns = [],
  createdFrom = 'learner',
} = {}) {
  const parentId = boundedString(parentHypothesisId);
  const childId = boundedString(childHypothesisId);
  const normalizedId = boundedString(id);
  const normalizedInterpretationIds = boundedIds(referencedInterpretationIds, 6);
  const validHypotheses = hypothesisIds(hypotheses);
  const validInterpretations = interpretationIds(interpretations, { hypotheses, testDesigns });
  if (!normalizedId || !parentId || !childId || parentId === childId || createdFrom !== 'learner'
    || !validHypotheses.has(parentId) || !validHypotheses.has(childId)
    || normalizedInterpretationIds.length === 0 || normalizedInterpretationIds.some((idValue) => !validInterpretations.has(idValue))) return null;
  return Object.freeze({
    id: normalizedId,
    version: LEARNER_INTERPRETATION_VERSION,
    parentHypothesisId: parentId,
    childHypothesisId: childId,
    interpretationIds: Object.freeze(normalizedInterpretationIds),
    createdFrom: 'learner',
  });
}

export function normalizeHypothesisRevisionState(value, context = {}) {
  const revisions = (Array.isArray(value?.revisions) ? value.revisions : [])
    .map((revision) => createHypothesisRevision({ ...revision, ...context }))
    .filter(Boolean)
    .slice(0, MAX_HYPOTHESIS_REVISIONS);
  return Object.freeze({ version: LEARNER_INTERPRETATION_VERSION, revisions: Object.freeze(revisions) });
}

export function appendHypothesisRevision(state, revision, context = {}) {
  const current = normalizeHypothesisRevisionState(state, context);
  const normalized = createHypothesisRevision({ ...revision, ...context });
  if (!normalized || current.revisions.some((item) => item.id === normalized.id || (item.parentHypothesisId === normalized.parentHypothesisId && item.childHypothesisId === normalized.childHypothesisId)) || current.revisions.length >= MAX_HYPOTHESIS_REVISIONS) return current;
  return Object.freeze({ version: LEARNER_INTERPRETATION_VERSION, revisions: Object.freeze([...current.revisions, normalized]) });
}

export function interpretationSemanticEdges({ interpretation, revision } = {}) {
  const edges = [];
  if (interpretation?.id) {
    for (const evidenceId of (interpretation.evidenceInstanceIds ?? []).filter(isEvidenceInstanceId)) {
      edges.push(Object.freeze({ from: evidenceId, to: interpretation.id, relation: 'interpreted_in' }));
    }
    for (const hypothesisId of interpretation.hypothesisIds ?? []) {
      edges.push(Object.freeze({ from: interpretation.id, to: hypothesisId, relation: 'informs_revision' }));
    }
  }
  if (revision?.parentHypothesisId && revision?.childHypothesisId) {
    edges.push(Object.freeze({ from: revision.childHypothesisId, to: revision.parentHypothesisId, relation: 'revised_from' }));
  }
  return edges.slice(0, 24);
}
