// Deterministic learner inquiry projection. This is local presentation context
// built from the bounded Semantic Event log and existing runtime evidence; it
// neither changes an Experiment nor infers causal conclusions.

export const LEARNER_INQUIRY_VERSION = 1;
export const MAX_INQUIRY_EVENTS = 24;
export const MAX_INQUIRY_CANDIDATES = 6;

export const INQUIRY_CONCEPT_IDS = Object.freeze({
  CONTROLLED_COMPARISON: 'controlled-comparison',
  MIXED_FACTOR_COMPARISON: 'mixed-factor-comparison',
  DISTRIBUTION_SHIFT: 'train-test-distribution-shift',
  GENERALIZATION: 'generalization',
  STABILITY: 'stability',
  COUNTERFACTUAL_REASONING: 'counterfactual-reasoning',
});

// This is a recognition registry, not a lesson sequence or a learner ranking.
// Each requirement is a bounded reason code implemented below, so candidate
// provenance remains inspectable without trusting an LLM or caller prose.
export const INQUIRY_CONCEPT_REGISTRY = Object.freeze({
  [INQUIRY_CONCEPT_IDS.CONTROLLED_COMPARISON]: Object.freeze({
    id: INQUIRY_CONCEPT_IDS.CONTROLLED_COMPARISON,
    version: LEARNER_INQUIRY_VERSION,
    titleKey: 'playground.inquiry.controlledComparison.title',
    summaryKey: 'playground.inquiry.controlledComparison.summary',
    evidenceRequirements: ['duplicated-baseline', 'one-factor-comparison'],
    prerequisites: [],
    relatedConceptIds: [INQUIRY_CONCEPT_IDS.COUNTERFACTUAL_REASONING],
    nextInquiryActions: ['compare-another-factor'],
  }),
  [INQUIRY_CONCEPT_IDS.MIXED_FACTOR_COMPARISON]: Object.freeze({
    id: INQUIRY_CONCEPT_IDS.MIXED_FACTOR_COMPARISON,
    version: LEARNER_INQUIRY_VERSION,
    titleKey: 'playground.inquiry.mixedComparison.title',
    summaryKey: 'playground.inquiry.mixedComparison.summary',
    evidenceRequirements: ['mixed-comparison'],
    prerequisites: [],
    relatedConceptIds: [INQUIRY_CONCEPT_IDS.CONTROLLED_COMPARISON],
    nextInquiryActions: ['isolate-one-factor'],
  }),
  [INQUIRY_CONCEPT_IDS.DISTRIBUTION_SHIFT]: Object.freeze({
    id: INQUIRY_CONCEPT_IDS.DISTRIBUTION_SHIFT,
    version: LEARNER_INQUIRY_VERSION,
    titleKey: 'playground.inquiry.distributionShift.title',
    summaryKey: 'playground.inquiry.distributionShift.summary',
    evidenceRequirements: ['test-world-change', 'coverage-mismatch'],
    prerequisites: [],
    relatedConceptIds: [INQUIRY_CONCEPT_IDS.GENERALIZATION],
    nextInquiryActions: ['adjust-test-support'],
  }),
  [INQUIRY_CONCEPT_IDS.GENERALIZATION]: Object.freeze({
    id: INQUIRY_CONCEPT_IDS.GENERALIZATION,
    version: LEARNER_INQUIRY_VERSION,
    titleKey: 'playground.inquiry.generalization.title',
    summaryKey: 'playground.inquiry.generalization.summary',
    evidenceRequirements: ['test-world-change', 'test-error-changed-more'],
    prerequisites: [],
    relatedConceptIds: [INQUIRY_CONCEPT_IDS.DISTRIBUTION_SHIFT],
    nextInquiryActions: ['inspect-test-evidence'],
  }),
  [INQUIRY_CONCEPT_IDS.STABILITY]: Object.freeze({
    id: INQUIRY_CONCEPT_IDS.STABILITY,
    version: LEARNER_INQUIRY_VERSION,
    titleKey: 'playground.inquiry.stability.title',
    summaryKey: 'playground.inquiry.stability.summary',
    evidenceRequirements: ['repeat-completed', 'repeat-variation-observed'],
    prerequisites: [],
    relatedConceptIds: [],
    nextInquiryActions: ['repeat-with-new-seed'],
  }),
  [INQUIRY_CONCEPT_IDS.COUNTERFACTUAL_REASONING]: Object.freeze({
    id: INQUIRY_CONCEPT_IDS.COUNTERFACTUAL_REASONING,
    version: LEARNER_INQUIRY_VERSION,
    titleKey: 'playground.inquiry.counterfactual.title',
    summaryKey: 'playground.inquiry.counterfactual.summary',
    evidenceRequirements: ['duplicated-baseline', 'one-factor-comparison'],
    prerequisites: [INQUIRY_CONCEPT_IDS.CONTROLLED_COMPARISON],
    relatedConceptIds: [INQUIRY_CONCEPT_IDS.CONTROLLED_COMPARISON],
    nextInquiryActions: ['change-one-condition'],
  }),
});

const EVENT_TYPES = new Set([
  'experiment.duplicated',
  'experiment.factor-changed',
  'world.intervened',
  'comparison.completed',
  'repeat.completed',
  'observation.detected',
]);
const OBSERVATION_IDS = new Set([
  'COVERAGE_MISMATCH',
  'TEST_ERROR_CHANGED_MORE',
  'REPEAT_VARIATION',
]);
const STAGES = new Set(['exploring', 'comparing', 'observing', 'repeating']);

const clone = (value) => structuredClone(value);

function safeString(value, max = 120) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized && normalized.length <= max ? normalized : null;
}

function safeStrings(values, max = 12) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => safeString(value))
    .filter(Boolean))].slice(0, max);
}

function safeEvent(event) {
  if (!event || !EVENT_TYPES.has(event.type) || !safeString(event.id)) return null;
  return {
    id: event.id,
    sequence: Number.isInteger(event.sequence) && event.sequence > 0 ? event.sequence : 0,
    type: event.type,
    experimentIds: safeStrings(event.experimentIds, 4),
    semanticFactors: safeStrings(event.semanticFactors),
    reasonCode: safeString(event.reasonCode),
    evidenceRefs: safeStrings(event.evidenceRefs),
  };
}

function normalizedEvents(value) {
  const records = Array.isArray(value) ? value : value?.events;
  return (records ?? []).map(safeEvent).filter(Boolean)
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
    .slice(-MAX_INQUIRY_EVENTS);
}

function normalizedComparison(comparison) {
  if (!comparison?.enabled || !comparison?.diff) return null;
  const activeExperimentId = safeString(comparison.activeExperimentId);
  const againstExperimentId = safeString(comparison.againstExperimentId);
  const changedFactors = safeStrings(comparison.diff.changed);
  const clarity = safeString(comparison.diff.clarity);
  if (!activeExperimentId || !againstExperimentId || !clarity) return null;
  return {
    enabled: true,
    activeExperimentId,
    againstExperimentId,
    experimentIds: [againstExperimentId, activeExperimentId],
    changedFactors,
    heldFactors: safeStrings(comparison.diff.unchanged),
    clarity,
  };
}

function comparisonFor(snapshot) {
  const comparison = snapshot?.experimentWorkspace?.comparison ?? snapshot?.comparison;
  const activeExperimentId = snapshot?.experimentWorkspace?.activeExperimentId ?? snapshot?.activeExperimentId;
  return normalizedComparison({ ...comparison, activeExperimentId });
}

function sameExperimentPair(event, comparison) {
  if (!comparison || event.experimentIds.length !== 2) return false;
  return event.experimentIds.every((id) => comparison.experimentIds.includes(id));
}

function eventForActiveExperiment(event, comparison) {
  return !comparison || !event.experimentIds.length || event.experimentIds.includes(comparison.activeExperimentId);
}

function lastEvent(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return null;
}

function candidate(conceptId, supportingEvents, supportingObservations, reasonCode) {
  return {
    conceptId,
    confidence: 'direct',
    supportingEventIds: safeStrings(supportingEvents.map((event) => event?.id), 6),
    supportingObservationIds: safeStrings(supportingObservations.map((event) => event?.reasonCode), 6),
    reasonCode,
  };
}

function directCandidates(events, comparison) {
  const candidates = [];
  const comparisonEvent = lastEvent(events, (event) => event.type === 'comparison.completed' && sameExperimentPair(event, comparison));
  const duplicated = lastEvent(events, (event) => event.type === 'experiment.duplicated' && sameExperimentPair(event, comparison));
  const oneFactor = Boolean(comparisonEvent
    && comparison?.clarity === 'high'
    && comparison.changedFactors.length === 1
    && duplicated);

  if (comparisonEvent?.reasonCode === 'comparison-mixed' && comparison?.clarity === 'mixed' && comparison.changedFactors.length > 1) {
    candidates.push(candidate(INQUIRY_CONCEPT_IDS.MIXED_FACTOR_COMPARISON, [comparisonEvent], [], 'mixed-factor-comparison'));
  }
  if (oneFactor) {
    candidates.push(candidate(INQUIRY_CONCEPT_IDS.CONTROLLED_COMPARISON, [duplicated, comparisonEvent], [], 'duplicated-one-factor-comparison'));
    candidates.push(candidate(INQUIRY_CONCEPT_IDS.COUNTERFACTUAL_REASONING, [duplicated, comparisonEvent], [], 'changed-one-condition-against-baseline'));
  }

  const testWorldEvent = lastEvent(events, (event) => event.type === 'world.intervened'
    && eventForActiveExperiment(event, comparison)
    && event.semanticFactors.some((factor) => factor === 'world.test.input' || factor === 'world.test.observations'));
  const coverage = lastEvent(events, (event) => event.type === 'observation.detected'
    && event.reasonCode === 'COVERAGE_MISMATCH'
    && eventForActiveExperiment(event, comparison));
  const testError = lastEvent(events, (event) => event.type === 'observation.detected'
    && event.reasonCode === 'TEST_ERROR_CHANGED_MORE'
    && eventForActiveExperiment(event, comparison));
  if (testWorldEvent && coverage) {
    candidates.push(candidate(INQUIRY_CONCEPT_IDS.DISTRIBUTION_SHIFT, [testWorldEvent, coverage], [coverage], 'test-world-change-with-coverage-mismatch'));
  }
  if (testWorldEvent && testError) {
    candidates.push(candidate(INQUIRY_CONCEPT_IDS.GENERALIZATION, [testWorldEvent, testError], [testError], 'test-world-change-with-test-error-difference'));
  }

  const repeated = lastEvent(events, (event) => event.type === 'repeat.completed' && eventForActiveExperiment(event, comparison));
  const repeatVariation = lastEvent(events, (event) => event.type === 'observation.detected'
    && event.reasonCode === 'REPEAT_VARIATION'
    && eventForActiveExperiment(event, comparison));
  if (repeated && repeatVariation) {
    candidates.push(candidate(INQUIRY_CONCEPT_IDS.STABILITY, [repeated, repeatVariation], [repeatVariation], 'repeat-variation-observed'));
  }
  return candidates;
}

function explicitHypothesis(activeThread) {
  const prediction = [...(activeThread?.entries ?? [])].reverse().find((entry) => entry?.kind === 'prediction');
  const text = safeString(prediction?.text, 500);
  if (!text) return null;
  return { entryId: safeString(prediction.id), text };
}

function stageFor(events, comparison) {
  const last = events.at(-1);
  if (last?.type === 'repeat.completed') return 'repeating';
  if (last?.type === 'observation.detected') return 'observing';
  if (comparison?.enabled) return 'comparing';
  return 'exploring';
}

export function listInquiryConcepts() {
  return Object.values(INQUIRY_CONCEPT_REGISTRY).map(clone);
}

export function getInquiryConcept(id) {
  return INQUIRY_CONCEPT_REGISTRY[id] ? clone(INQUIRY_CONCEPT_REGISTRY[id]) : null;
}

// The only inputs are existing runtime facts. Presentation may pass an
// explicitly known depth; no depth is inferred from control or DOM activity.
export function deriveLearnerInquiryState({
  semanticEvents,
  snapshot,
  comparison,
  activeExplorationThread = snapshot?.activeExplorationThread,
  conceptsPreviouslySurfaced = [],
  conceptualDepth = null,
} = {}) {
  const events = normalizedEvents(semanticEvents);
  const currentComparison = normalizedComparison(comparison) ?? comparisonFor(snapshot);
  const concepts = directCandidates(events, currentComparison)
    .filter((item, index, all) => all.findIndex((candidateItem) => candidateItem.conceptId === item.conceptId) === index)
    .slice(0, MAX_INQUIRY_CANDIDATES);
  const normalizedDepth = safeString(conceptualDepth);
  const stage = stageFor(events, currentComparison);
  return {
    version: LEARNER_INQUIRY_VERSION,
    recentEventIds: events.map((event) => event.id),
    recentObservationIds: [...new Set(events.filter((event) => event.type === 'observation.detected' && OBSERVATION_IDS.has(event.reasonCode)).map((event) => event.reasonCode))],
    activeComparison: currentComparison,
    candidates: concepts,
    conceptsPreviouslySurfaced: safeStrings(conceptsPreviouslySurfaced, Object.keys(INQUIRY_CONCEPT_REGISTRY).length)
      .filter((id) => Boolean(INQUIRY_CONCEPT_REGISTRY[id])),
    inquiryStage: STAGES.has(stage) ? stage : 'exploring',
    explicitHypothesis: explicitHypothesis(activeExplorationThread),
    conceptualDepth: normalizedDepth,
  };
}
