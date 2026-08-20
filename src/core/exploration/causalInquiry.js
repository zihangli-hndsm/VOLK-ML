// Goal 6 is a bounded scientific-reasoning projection over existing factual
// inquiry evidence. It does not model causal effects, infer hidden variables,
// or create a second World/Experiment runtime.
import { INQUIRY_CONCEPT_IDS } from './learnerInquiry.js';

export const CAUSAL_INQUIRY_VERSION = 1;
export const CAUSAL_INQUIRY_STEP_IDS = Object.freeze({
  OBSERVED_PATTERN: 'observed-pattern',
  HYPOTHESIS: 'hypothesis',
  INTERVENTION: 'intervention',
  CONTROLLED_COMPARISON: 'controlled-comparison',
  COUNTERFACTUAL: 'counterfactual-reasoning',
  MIXED_COMPARISON: 'mixed-comparison',
  CONFOUNDED_COMPARISON: 'mixed-comparison',
  REPEAT_UNCERTAINTY: 'repeat-uncertainty',
});

export const CAUSAL_INQUIRY_REGISTRY = Object.freeze({
  [CAUSAL_INQUIRY_STEP_IDS.OBSERVED_PATTERN]: Object.freeze({
    id: CAUSAL_INQUIRY_STEP_IDS.OBSERVED_PATTERN,
    titleKey: 'playground.causalInquiry.observedPattern.title',
    summaryKey: 'playground.causalInquiry.observedPattern.summary',
    evidenceRequirements: ['detector-notice'],
  }),
  [CAUSAL_INQUIRY_STEP_IDS.HYPOTHESIS]: Object.freeze({
    id: CAUSAL_INQUIRY_STEP_IDS.HYPOTHESIS,
    titleKey: 'playground.causalInquiry.hypothesis.title',
    summaryKey: 'playground.causalInquiry.hypothesis.summary',
    evidenceRequirements: ['explicit-thread-prediction'],
  }),
  [CAUSAL_INQUIRY_STEP_IDS.INTERVENTION]: Object.freeze({
    id: CAUSAL_INQUIRY_STEP_IDS.INTERVENTION,
    titleKey: 'playground.causalInquiry.intervention.title',
    summaryKey: 'playground.causalInquiry.intervention.summary',
    evidenceRequirements: ['semantic-factor-change'],
  }),
  [CAUSAL_INQUIRY_STEP_IDS.CONTROLLED_COMPARISON]: Object.freeze({
    id: CAUSAL_INQUIRY_STEP_IDS.CONTROLLED_COMPARISON,
    titleKey: 'playground.causalInquiry.controlledComparison.title',
    summaryKey: 'playground.causalInquiry.controlledComparison.summary',
    evidenceRequirements: ['exact-one-factor-comparison'],
  }),
  [CAUSAL_INQUIRY_STEP_IDS.COUNTERFACTUAL]: Object.freeze({
    id: CAUSAL_INQUIRY_STEP_IDS.COUNTERFACTUAL,
    titleKey: 'playground.causalInquiry.counterfactual.title',
    summaryKey: 'playground.causalInquiry.counterfactual.summary',
    evidenceRequirements: ['duplicated-baseline', 'exact-one-factor-comparison'],
  }),
  [CAUSAL_INQUIRY_STEP_IDS.MIXED_COMPARISON]: Object.freeze({
    id: CAUSAL_INQUIRY_STEP_IDS.MIXED_COMPARISON,
    titleKey: 'playground.causalInquiry.confoundedComparison.title',
    summaryKey: 'playground.causalInquiry.confoundedComparison.summary',
    evidenceRequirements: ['mixed-factor-comparison'],
  }),
  [CAUSAL_INQUIRY_STEP_IDS.REPEAT_UNCERTAINTY]: Object.freeze({
    id: CAUSAL_INQUIRY_STEP_IDS.REPEAT_UNCERTAINTY,
    titleKey: 'playground.causalInquiry.repeatUncertainty.title',
    summaryKey: 'playground.causalInquiry.repeatUncertainty.summary',
    evidenceRequirements: ['repeat-variation-observed'],
  }),
});

const MAX_CAUSAL_STEPS = 7;
const MAX_EVENT_IDS = 6;

function safeString(value, max = 120) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= max ? text : null;
}

function safeIds(values, max = MAX_EVENT_IDS) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => safeString(value)).filter(Boolean))].slice(0, max);
}

function normalizedEvents(semanticEvents) {
  const events = Array.isArray(semanticEvents) ? semanticEvents : semanticEvents?.events;
  return (events ?? []).map((event) => ({
    id: safeString(event?.id),
    sequence: Number.isInteger(event?.sequence) ? event.sequence : 0,
    type: safeString(event?.type),
    reasonCode: safeString(event?.reasonCode),
    semanticFactors: safeIds(event?.semanticFactors),
    experimentIds: safeIds(event?.experimentIds, 4),
  })).filter((event) => event.id && event.sequence > 0 && event.type)
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
}

function directCandidate(inquiry, conceptId, eventIds = new Set()) {
  return (inquiry?.candidates ?? []).find((candidate) => (
    candidate?.conceptId === conceptId
    && candidate.confidence === 'direct'
    && typeof candidate.reasonCode === 'string'
    && Array.isArray(candidate.supportingEventIds)
    && candidate.supportingEventIds.length > 0
    && candidate.supportingEventIds.every((id) => eventIds.has(id))
  )) ?? null;
}

function step(id, reasonCode, eventIds = []) {
  return {
    id,
    confidence: 'direct',
    reasonCode,
    supportingEventIds: safeIds(eventIds),
  };
}

function latest(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return null;
}

function explicitPrediction(inquiry, activeExplorationThread) {
  const direct = inquiry?.explicitHypothesis;
  if (safeString(direct?.entryId) && safeString(direct?.text, 500)) return direct;
  const prediction = [...(activeExplorationThread?.entries ?? [])].reverse()
    .find((entry) => entry?.kind === 'prediction' && safeString(entry?.id) && safeString(entry?.text, 500));
  return prediction ? { entryId: prediction.id, text: prediction.text } : null;
}

function belongsToCurrentComparison(event, comparison) {
  if (!comparison) return true;
  return event.experimentIds.length === 0
    || event.experimentIds.every((id) => comparison.experimentIds.includes(id));
}

function nextStepFor(steps) {
  const ids = new Set(steps.map((item) => item.id));
  if (ids.has(CAUSAL_INQUIRY_STEP_IDS.MIXED_COMPARISON)) return 'isolate-one-factor';
  if (ids.has(CAUSAL_INQUIRY_STEP_IDS.REPEAT_UNCERTAINTY)) return 'compare-repeat-variation';
  if (ids.has(CAUSAL_INQUIRY_STEP_IDS.CONTROLLED_COMPARISON)) return 'consider-counterfactual';
  if (ids.has(CAUSAL_INQUIRY_STEP_IDS.INTERVENTION)) return 'compare-with-baseline';
  if (ids.has(CAUSAL_INQUIRY_STEP_IDS.HYPOTHESIS)) return 'run-proposed-test';
  if (ids.has(CAUSAL_INQUIRY_STEP_IDS.OBSERVED_PATTERN)) return 'state-a-prediction';
  return null;
}

// This state names a reasoning pattern. In particular, a detector notice is
// an observed pattern, not a measured association or causal relationship.
export function deriveCausalInquiryState({ inquiry, semanticEvents, activeExplorationThread } = {}) {
  const events = normalizedEvents(semanticEvents);
  const comparison = inquiry?.activeComparison ?? null;
  const currentEventIds = new Set(events
    .filter((event) => belongsToCurrentComparison(event, comparison))
    .map((event) => event.id));
  const steps = [];
  const observed = latest(events, (event) => event.type === 'observation.detected' && belongsToCurrentComparison(event, comparison));
  if (observed) steps.push(step(CAUSAL_INQUIRY_STEP_IDS.OBSERVED_PATTERN, 'detector-notice', [observed.id]));

  const prediction = explicitPrediction(inquiry, activeExplorationThread);
  if (prediction) steps.push(step(CAUSAL_INQUIRY_STEP_IDS.HYPOTHESIS, 'explicit-thread-prediction', prediction.entryId ? [prediction.entryId] : []));

  const intervention = latest(events, (event) => (
    (event.type === 'world.intervened' || event.type === 'experiment.factor-changed')
    && event.semanticFactors.length > 0
    && belongsToCurrentComparison(event, comparison)
  ));
  if (intervention) steps.push(step(CAUSAL_INQUIRY_STEP_IDS.INTERVENTION, 'semantic-factor-change', [intervention.id]));

  const controlled = directCandidate(inquiry, INQUIRY_CONCEPT_IDS.CONTROLLED_COMPARISON, currentEventIds);
  if (controlled) steps.push(step(CAUSAL_INQUIRY_STEP_IDS.CONTROLLED_COMPARISON, 'exact-one-factor-comparison', controlled.supportingEventIds));

  const counterfactual = directCandidate(inquiry, INQUIRY_CONCEPT_IDS.COUNTERFACTUAL_REASONING, currentEventIds);
  if (counterfactual) steps.push(step(CAUSAL_INQUIRY_STEP_IDS.COUNTERFACTUAL, 'duplicated-baseline-one-factor', counterfactual.supportingEventIds));

  const mixed = directCandidate(inquiry, INQUIRY_CONCEPT_IDS.MIXED_FACTOR_COMPARISON, currentEventIds);
  if (mixed) steps.push(step(CAUSAL_INQUIRY_STEP_IDS.MIXED_COMPARISON, 'mixed-factor-comparison', mixed.supportingEventIds));

  const repeat = directCandidate(inquiry, INQUIRY_CONCEPT_IDS.STABILITY, currentEventIds);
  if (repeat) steps.push(step(CAUSAL_INQUIRY_STEP_IDS.REPEAT_UNCERTAINTY, 'repeat-variation-observed', repeat.supportingEventIds));

  const bounded = steps.slice(0, MAX_CAUSAL_STEPS);
  return {
    version: CAUSAL_INQUIRY_VERSION,
    steps: bounded,
    nextAction: nextStepFor(bounded),
  };
}

export function listCausalInquirySteps() {
  return Object.values(CAUSAL_INQUIRY_REGISTRY).map((entry) => structuredClone(entry));
}
