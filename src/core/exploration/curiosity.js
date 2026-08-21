// Phase 10.1: deterministic curiosity is a bounded projection over facts
// that already passed the Semantic Event and learner-inquiry contracts. It is
// an unresolved exploration opportunity, not a learner-state classifier and
// not a causal conclusion.

import { INQUIRY_CONCEPT_IDS } from './learnerInquiry.js';

export const CURIOSITY_VERSION = 1;
export const MAX_CURIOSITY_EVENTS = 24;
export const MAX_CURIOSITY_REFS = 6;
export const MAX_CURIOSITY_ITEMS = 4;
const CURIOSITY_STATE_KEYS = new Set([
  'version',
  'available',
  'activeQuestions',
  'unresolvedComparisons',
  'unexploredFactors',
  'evidenceGaps',
  'reflectionOpportunities',
  'opportunities',
]);

export const CURIOSITY_GAP_IDS = Object.freeze({
  SINGLE_FACTOR_MECHANISM: 'single-factor-mechanism-unclear',
  MIXED_FACTOR_COMPARISON: 'mixed-factor-comparison',
  DISTRIBUTION_SHIFT: 'distribution-shift-question',
  REPEAT_VARIATION: 'repeat-stability-question',
});

export const CURIOSITY_ACTIONS = Object.freeze({
  INSPECT_MECHANISM: 'inspect-mechanism',
  ISOLATE_ONE_FACTOR: 'isolate-one-factor',
  INSPECT_TEST_EVIDENCE: 'inspect-test-evidence',
  REPEAT_WITH_NEW_SEED: 'repeat-with-new-seed',
});

const ACTORS = new Set(['human', 'agent', 'system']);
const EVENT_TYPES = new Set([
  'experiment.duplicated',
  'experiment.factor-changed',
  'world.intervened',
  'comparison.completed',
  'repeat.completed',
  'observation.detected',
]);

// These are presentation/action contracts already owned by the exploration
// system. Curiosity never creates a runtime operation from these values.
const CATALOG = Object.freeze({
  [CURIOSITY_GAP_IDS.SINGLE_FACTOR_MECHANISM]: Object.freeze({
    id: CURIOSITY_GAP_IDS.SINGLE_FACTOR_MECHANISM,
    version: CURIOSITY_VERSION,
    relatedConcept: INQUIRY_CONCEPT_IDS.CONTROLLED_COMPARISON,
    questionKey: 'playground.curiosity.singleFactor.question',
    suggestedDirection: CURIOSITY_ACTIONS.INSPECT_MECHANISM,
    requiredEvidence: ['duplicated-baseline', 'one-factor-comparison'],
    availableAction: 'inspect-mechanism',
    requiredCapability: 'mechanism-depth',
  }),
  [CURIOSITY_GAP_IDS.MIXED_FACTOR_COMPARISON]: Object.freeze({
    id: CURIOSITY_GAP_IDS.MIXED_FACTOR_COMPARISON,
    version: CURIOSITY_VERSION,
    relatedConcept: INQUIRY_CONCEPT_IDS.MIXED_FACTOR_COMPARISON,
    questionKey: 'playground.curiosity.mixedFactors.question',
    suggestedDirection: CURIOSITY_ACTIONS.ISOLATE_ONE_FACTOR,
    requiredEvidence: ['mixed-comparison'],
    availableAction: 'isolate-one-factor',
    requiredCapability: 'scenario-preflight',
  }),
  [CURIOSITY_GAP_IDS.DISTRIBUTION_SHIFT]: Object.freeze({
    id: CURIOSITY_GAP_IDS.DISTRIBUTION_SHIFT,
    version: CURIOSITY_VERSION,
    relatedConcept: INQUIRY_CONCEPT_IDS.DISTRIBUTION_SHIFT,
    questionKey: 'playground.curiosity.distributionShift.question',
    suggestedDirection: CURIOSITY_ACTIONS.INSPECT_TEST_EVIDENCE,
    requiredEvidence: ['test-world-change', 'coverage-mismatch'],
    availableAction: 'inspect-test-evidence',
    requiredCapability: 'evidence-depth',
  }),
  [CURIOSITY_GAP_IDS.REPEAT_VARIATION]: Object.freeze({
    id: CURIOSITY_GAP_IDS.REPEAT_VARIATION,
    version: CURIOSITY_VERSION,
    relatedConcept: INQUIRY_CONCEPT_IDS.STABILITY,
    questionKey: 'playground.curiosity.repeatVariation.question',
    suggestedDirection: CURIOSITY_ACTIONS.REPEAT_WITH_NEW_SEED,
    requiredEvidence: ['repeat-completed', 'repeat-variation-observed'],
    availableAction: 'repeat-with-new-seed',
    requiredCapability: 'repeat',
  }),
});
const RELATED_CONCEPTS = new Set(Object.values(INQUIRY_CONCEPT_IDS));

const clone = (value) => structuredClone(value);

function safeString(value, max = 120) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized && normalized.length <= max ? normalized : null;
}

function safeStrings(values, max = MAX_CURIOSITY_REFS) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => safeString(value))
    .filter(Boolean))].slice(0, max);
}

function strictStrings(values, max) {
  if (!Array.isArray(values) || values.length > max) return null;
  if (values.some((value) => !safeString(value))) return null;
  return [...new Set(values)];
}

function normalizedEvents(value) {
  const records = Array.isArray(value) ? value : value?.events;
  return (records ?? []).map((event) => {
    if (!event || !EVENT_TYPES.has(event.type) || !safeString(event.id)) return null;
    return {
      id: safeString(event.id),
      sequence: Number.isInteger(event.sequence) && event.sequence > 0 ? event.sequence : 0,
      type: event.type,
      actor: ACTORS.has(event.actor) ? event.actor : 'system',
      experimentIds: safeStrings(event.experimentIds, 4),
      semanticFactors: safeStrings(event.semanticFactors, 12),
      semanticFactorPaths: safeStrings(event.semanticFactorPaths ?? event.semanticFactors, 12),
      reasonCode: safeString(event.reasonCode),
      evidenceRefs: safeStrings(event.evidenceRefs, MAX_CURIOSITY_REFS),
    };
  }).filter(Boolean)
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
    .slice(-MAX_CURIOSITY_EVENTS);
}

function currentCandidate(inquiry, conceptId) {
  return (Array.isArray(inquiry?.candidates) ? inquiry.candidates : [])
    .find((candidate) => candidate?.conceptId === conceptId && candidate?.confidence === 'direct') ?? null;
}

function currentComparison(inquiry) {
  const comparison = inquiry?.activeComparison;
  if (!comparison?.enabled || !comparison.activeExperimentId || !comparison.againstExperimentId) return null;
  return {
    activeExperimentId: comparison.activeExperimentId,
    againstExperimentId: comparison.againstExperimentId,
    experimentIds: [comparison.againstExperimentId, comparison.activeExperimentId],
    clarity: safeString(comparison.clarity),
    semanticFactorCount: Number.isInteger(comparison.semanticFactorCount) ? comparison.semanticFactorCount : 0,
    semanticFactorPaths: safeStrings(comparison.semanticFactorPaths, 12),
    semanticChangedPaths: safeStrings(comparison.semanticChangedPaths, 12),
  };
}

function eventMap(events) {
  return new Map(events.map((event) => [event.id, event]));
}

function humanEvidenceFor(candidate, events) {
  const byId = eventMap(events);
  const ids = safeStrings(candidate?.supportingEventIds, MAX_CURIOSITY_REFS);
  const supportingEvents = ids.map((id) => byId.get(id)).filter(Boolean);
  return supportingEvents.length === ids.length && supportingEvents.every((event) => event.actor === 'human')
    ? supportingEvents
    : [];
}

function eventBelongsToComparison(event, comparison) {
  if (!comparison || !event?.experimentIds?.length) return false;
  if (event.experimentIds.length === 2) {
    return event.experimentIds.every((id) => comparison.experimentIds.includes(id));
  }
  return event.experimentIds.length === 1
    && event.experimentIds[0] === comparison.activeExperimentId;
}

function comparisonEvidenceFor(candidate, comparison, events) {
  const supporting = humanEvidenceFor(candidate, events);
  return supporting.length > 0 && supporting.every((event) => eventBelongsToComparison(event, comparison))
    ? supporting
    : [];
}

function evidenceRefs(events, observationIds = []) {
  return [
    ...events.map((event) => ({ kind: 'event', id: event.id })),
    ...safeStrings(observationIds).map((id) => ({ kind: 'observation', id })),
  ].slice(0, MAX_CURIOSITY_REFS);
}

function reflectionFor(entry, candidate, events, observationIds = []) {
  return {
    id: entry.id,
    type: 'reflection',
    relatedConcept: entry.relatedConcept,
    supportingEvidence: evidenceRefs(events, observationIds),
    questionKey: entry.questionKey,
    suggestedDirection: entry.suggestedDirection,
  };
}

function opportunityFor(entry, reflection) {
  return {
    id: `opportunity:${entry.id}`,
    concept: entry.relatedConcept,
    curiosityGap: entry.id,
    availableAction: entry.availableAction,
    requiredCapability: entry.requiredCapability,
    reflectionId: reflection.id,
  };
}

function actionCapabilities(value) {
  const availableActions = Array.isArray(value?.availableActions)
    ? value.availableActions.filter((action) => typeof action === 'string')
    : [];
  return new Set(availableActions);
}

function validDistributionCandidate(candidate, inquiry, events) {
  if (!candidate || !inquiry?.activeObservationIds?.includes('COVERAGE_MISMATCH')) return false;
  const supporting = humanEvidenceFor(candidate, events);
  const comparison = currentComparison(inquiry);
  return supporting.length > 0
    && (!comparison || supporting.every((event) => eventBelongsToComparison(event, comparison)))
    && supporting.some((event) => event.type === 'world.intervened'
    && event.semanticFactors.some((factor) => factor === 'world.test.input' || factor === 'world.test.observations'));
}

function validRepeatCandidate(candidate, inquiry, events) {
  if (!candidate || !inquiry?.activeObservationIds?.includes('REPEAT_VARIATION')) return false;
  const supporting = humanEvidenceFor(candidate, events);
  const comparison = currentComparison(inquiry);
  return supporting.length > 0
    && (!comparison || supporting.every((event) => eventBelongsToComparison(event, comparison)))
    && supporting.some((event) => event.type === 'repeat.completed');
}

function validSingleFactorCandidate(candidate, comparison, events) {
  if (!candidate || !comparison || comparison.clarity !== 'high' || comparison.semanticFactorCount !== 1) return false;
  const supporting = comparisonEvidenceFor(candidate, comparison, events);
  return supporting.some((event) => event.type === 'experiment.duplicated')
    && supporting.some((event) => event.type === 'comparison.completed');
}

function validMixedCandidate(candidate, comparison, events) {
  if (!candidate || !comparison || comparison.clarity !== 'mixed' || comparison.semanticFactorCount < 2) return false;
  return comparisonEvidenceFor(candidate, comparison, events)
    .some((event) => event.type === 'comparison.completed');
}

export function listCuriosityGaps() {
  return Object.values(CATALOG).map(clone);
}

export function getCuriosityGap(id) {
  return CATALOG[id] ? clone(CATALOG[id]) : null;
}

export function canonicalizeCuriosityState(value) {
  if (!value || value.version !== CURIOSITY_VERSION || typeof value.available !== 'boolean') return null;
  if (Object.keys(value).some((key) => !CURIOSITY_STATE_KEYS.has(key))) return null;
  const validGap = (id) => Boolean(CATALOG[id]);
  const validRelatedConcept = (id) => RELATED_CONCEPTS.has(id);
  const rawReflections = Array.isArray(value.reflectionOpportunities) ? value.reflectionOpportunities : [];
  if (rawReflections.length > MAX_CURIOSITY_ITEMS) return null;
  const reflectionOpportunities = rawReflections.map((reflection) => {
      const entry = CATALOG[reflection?.id];
      if (!reflection || reflection.type !== 'reflection' || !validGap(reflection.id)
        || !entry || !validRelatedConcept(reflection.relatedConcept)
        || reflection.relatedConcept !== entry.relatedConcept
        || reflection.questionKey !== entry.questionKey
        || reflection.suggestedDirection !== entry.suggestedDirection
        || !Array.isArray(reflection.supportingEvidence)
        || reflection.supportingEvidence.length > MAX_CURIOSITY_REFS
        || reflection.supportingEvidence.some((ref) => (ref?.kind !== 'event' && ref?.kind !== 'observation') || !safeString(ref.id))) return null;
      const supportingEvidence = reflection.supportingEvidence.map((ref) => ({ kind: ref.kind, id: safeString(ref.id) }));
      return {
        id: entry.id,
        type: 'reflection',
        relatedConcept: entry.relatedConcept,
        supportingEvidence,
        questionKey: entry.questionKey,
        suggestedDirection: entry.suggestedDirection,
      };
  });
  if (reflectionOpportunities.some((reflection) => !reflection)) return null;
  if (new Set(reflectionOpportunities.map((reflection) => reflection.id)).size !== reflectionOpportunities.length) return null;
  const reflectionById = new Map(reflectionOpportunities.map((reflection) => [reflection.id, reflection]));
  const rawOpportunities = Array.isArray(value.opportunities) ? value.opportunities : [];
  if (rawOpportunities.length > MAX_CURIOSITY_ITEMS) return null;
  const opportunities = rawOpportunities.map((opportunity) => {
      const entry = CATALOG[opportunity?.curiosityGap];
      if (!opportunity || !safeString(opportunity.id) || !validRelatedConcept(opportunity.concept)
        || !entry || opportunity.concept !== entry.relatedConcept
        || opportunity.availableAction !== entry.availableAction
        || opportunity.requiredCapability !== entry.requiredCapability
        || !safeString(opportunity.reflectionId)) return null;
      const reflection = reflectionById.get(opportunity.reflectionId);
      if (!reflection || reflection.id !== entry.id || reflection.relatedConcept !== entry.relatedConcept) return null;
      return {
        id: safeString(opportunity.id),
        concept: entry.relatedConcept,
        curiosityGap: entry.id,
        availableAction: entry.availableAction,
        requiredCapability: entry.requiredCapability,
        reflectionId: safeString(opportunity.reflectionId),
      };
  });
  if (opportunities.some((opportunity) => !opportunity)) return null;
  if (new Set(opportunities.map((opportunity) => opportunity.id)).size !== opportunities.length) return null;
  const activeQuestions = strictStrings(value.activeQuestions, MAX_CURIOSITY_ITEMS);
  const evidenceGaps = strictStrings(value.evidenceGaps, MAX_CURIOSITY_ITEMS);
  const unexploredFactors = strictStrings(value.unexploredFactors, 12);
  if (!activeQuestions || !evidenceGaps || !unexploredFactors) return null;
  if (activeQuestions.join('|') !== reflectionOpportunities.map((reflection) => reflection.questionKey).join('|')) return null;
  if (evidenceGaps.join('|') !== reflectionOpportunities.map((reflection) => reflection.id).join('|')) return null;
  const unresolvedComparisons = (Array.isArray(value.unresolvedComparisons) ? value.unresolvedComparisons : []);
  if (unresolvedComparisons.length > MAX_CURIOSITY_ITEMS || unresolvedComparisons.some((item) => (
    !item || !safeString(item.kind) || !Array.isArray(item.experimentIds) || item.experimentIds.length !== 2
    || item.experimentIds.some((id) => !safeString(id)) || !Number.isInteger(item.factorCount) || item.factorCount < 0
  ))) return null;
  return {
    version: CURIOSITY_VERSION,
    available: value.available,
    activeQuestions,
    unresolvedComparisons: unresolvedComparisons.map((item) => ({
      kind: item.kind,
      experimentIds: [...item.experimentIds],
      factorCount: item.factorCount,
    })),
    unexploredFactors,
    evidenceGaps,
    reflectionOpportunities,
    opportunities,
  };
}

// This is intentionally the only matcher in Goal 10. It consumes existing
// inquiry candidates and current evidence; it does not inspect raw World data
// or infer confusion, ability, intent, or causality.
export function deriveCuriosityState({ semanticEvents, inquiry } = {}) {
  const events = normalizedEvents(semanticEvents);
  const comparison = currentComparison(inquiry);
  const reflections = [];
  const activeQuestions = [];
  const evidenceGaps = [];

  const add = (entry, candidate, supportingEvents, observationIds = []) => {
    const reflection = reflectionFor(entry, candidate, supportingEvents, observationIds);
    reflections.push(reflection);
    activeQuestions.push(entry.questionKey);
    evidenceGaps.push(entry.id);
  };

  const controlled = currentCandidate(inquiry, INQUIRY_CONCEPT_IDS.CONTROLLED_COMPARISON);
  const controlledEvents = controlled ? humanEvidenceFor(controlled, events) : [];
  const mixed = currentCandidate(inquiry, INQUIRY_CONCEPT_IDS.MIXED_FACTOR_COMPARISON);
  const mixedEvents = mixed ? humanEvidenceFor(mixed, events) : [];
  const distribution = currentCandidate(inquiry, INQUIRY_CONCEPT_IDS.DISTRIBUTION_SHIFT);
  const distributionEvents = distribution ? humanEvidenceFor(distribution, events) : [];
  const stability = currentCandidate(inquiry, INQUIRY_CONCEPT_IDS.STABILITY);
  const stabilityEvents = stability ? humanEvidenceFor(stability, events) : [];

  // One unresolved relationship is enough for this first vertical slice. The
  // priority keeps intervention-specific evidence visible before a generic
  // one-factor reflection; it is not a claim about learner importance.
  if (validMixedCandidate(mixed, comparison, events)) {
    add(CATALOG[CURIOSITY_GAP_IDS.MIXED_FACTOR_COMPARISON], mixed, mixedEvents);
  } else if (validDistributionCandidate(distribution, inquiry, events)) {
    add(CATALOG[CURIOSITY_GAP_IDS.DISTRIBUTION_SHIFT], distribution, distributionEvents, ['COVERAGE_MISMATCH']);
  } else if (validRepeatCandidate(stability, inquiry, events)) {
    add(CATALOG[CURIOSITY_GAP_IDS.REPEAT_VARIATION], stability, stabilityEvents, ['REPEAT_VARIATION']);
  } else if (validSingleFactorCandidate(controlled, comparison, events)) {
    add(CATALOG[CURIOSITY_GAP_IDS.SINGLE_FACTOR_MECHANISM], controlled, controlledEvents);
  }

  const unresolvedComparisons = comparison && comparison.clarity === 'mixed'
    ? [{ kind: 'mixed-comparison', experimentIds: comparison.experimentIds, factorCount: comparison.semanticFactorCount }]
    : [];
  const unexploredFactors = comparison?.clarity === 'mixed'
    ? comparison.semanticFactorPaths
    : [];

  return canonicalizeCuriosityState({
    version: CURIOSITY_VERSION,
    available: reflections.length > 0,
    activeQuestions,
    unresolvedComparisons,
    unexploredFactors,
    evidenceGaps,
    reflectionOpportunities: reflections,
    // Action availability is resolved separately from factual reflection.
    opportunities: [],
  });
}

// Capability filtering is deliberately separate from fact detection. A gap
// can remain a truthful reflection even when no current registered action can
// be offered for it.
export function resolveCuriosityOpportunities({ curiosity, capabilities = {} } = {}) {
  const canonical = canonicalizeCuriosityState(curiosity);
  if (!canonical) return null;
  const available = actionCapabilities(capabilities);
  const opportunities = canonical.reflectionOpportunities
    .map((reflection) => {
      const entry = CATALOG[reflection.id];
      return available.has(entry.availableAction) ? opportunityFor(entry, reflection) : null;
    })
    .filter(Boolean);
  return canonicalizeCuriosityState({ ...canonical, opportunities });
}

// Provider boundary projection. It intentionally excludes event payloads,
// observation values, World data, and anything that could authorize a runtime
// action. The question remains a localization key until a trusted UI renders
// it.
export function projectCuriosityContext(value) {
  const canonical = canonicalizeCuriosityState(value);
  if (!canonical) return null;
  return {
    version: canonical.version,
    available: canonical.available,
    reflectionOpportunities: canonical.reflectionOpportunities.map((reflection) => ({
      id: reflection.id,
      type: reflection.type,
      relatedConcept: reflection.relatedConcept,
      questionKey: reflection.questionKey,
      suggestedDirection: reflection.suggestedDirection,
    })),
    opportunities: canonical.opportunities.map((opportunity) => ({
      id: opportunity.id,
      concept: opportunity.concept,
      curiosityGap: opportunity.curiosityGap,
      availableAction: opportunity.availableAction,
      requiredCapability: opportunity.requiredCapability,
    })),
  };
}
