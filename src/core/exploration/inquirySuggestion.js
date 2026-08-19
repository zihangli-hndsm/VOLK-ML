// Goal 4: deterministic causal-inquiry suggestions. This is deliberately a
// small projection over already-grounded inquiry candidates and registered
// capabilities. A suggestion names a hypothesis to test; it never says the
// hypothesis is true, mutates a session, or invents a World operation.

import { INQUIRY_CONCEPT_IDS } from './learnerInquiry.js';
import { planTeachingGoal } from '../playground/agent/teachingPlanner.js';

export const INQUIRY_SUGGESTION_VERSION = 1;
export const INQUIRY_SUGGESTION_KINDS = Object.freeze({
  MANUAL_WORLD: 'manual-world',
  TEACHING_GOAL: 'teaching-goal',
});

const MAX_SUGGESTIONS = 2;
const MAX_HOLDS = 6;

const clone = (value) => structuredClone(value);

const DIRECT_REASONS = Object.freeze({
  [INQUIRY_CONCEPT_IDS.DISTRIBUTION_SHIFT]: 'test-world-change-with-coverage-mismatch',
  [INQUIRY_CONCEPT_IDS.GENERALIZATION]: 'test-world-change-with-test-error-difference',
});

function hasCandidate(inquiry, id) {
  return (inquiry?.candidates ?? []).some((candidate) => (
    candidate?.conceptId === id
    && candidate?.confidence === 'direct'
    && candidate?.reasonCode === DIRECT_REASONS[id]
    && Array.isArray(candidate?.supportingEventIds)
    && candidate.supportingEventIds.length > 0
  ));
}

function taskOutcomeIds(context) {
  const task = context?.world?.task ?? context?.data?.task ?? context?.playground?.task;
  const candidates = task === 'classification'
    ? ['outcome.trainAccuracy', 'outcome.testAccuracy']
    : task === 'regression'
      ? ['outcome.trainMse', 'outcome.testMse']
      : [];
  const available = new Set([
    ...Object.keys(context?.observables ?? {}),
    ...Object.keys(context?.derivedObservables ?? {}),
  ]);
  return candidates.filter((id) => available.has(id));
}

function supportsTestWorldIntervention(context) {
  const types = new Set((context?.exploration?.worldOperations ?? []).map((operation) => operation?.type));
  if (context?.world?.generator?.kind === 'world-recipe') return types.has('PATCH_WORLD_RECIPE');
  if (context?.world?.generator?.spec) return types.has('SET_GENERATOR_PARAMETER');
  return types.has('MOVE_POINT') || types.has('TRANSFORM_FEATURE_VALUES');
}

function manualSupportShiftSuggestion(context) {
  if (!supportsTestWorldIntervention(context)) return null;
  return {
    version: INQUIRY_SUGGESTION_VERSION,
    id: 'inspect-test-support',
    kind: INQUIRY_SUGGESTION_KINDS.MANUAL_WORLD,
    questionKey: 'playground.inquirySuggestion.support.question',
    hypothesisKey: 'playground.inquirySuggestion.support.hypothesis',
    intervention: { factor: 'world.test.input', actionKey: 'playground.inquirySuggestion.support.intervention' },
    holdFactors: ['world.train.input', 'model', 'learning', 'evaluation', 'randomness-policy'],
    expectedObservableIds: ['coverageMismatch', ...taskOutcomeIds(context)].slice(0, 3),
    relatedConceptIds: [INQUIRY_CONCEPT_IDS.DISTRIBUTION_SHIFT, INQUIRY_CONCEPT_IDS.GENERALIZATION],
    reasonCode: 'test-support-isolation',
  };
}

function capacityControl(context) {
  return (context?.controlSchemas ?? []).find((schema) => (
    schema?.domain === 'model'
    && schema?.type === 'number'
    && schema?.presentation?.inquiryRole === 'capacity'
    && Number.isFinite(Number(context?.controls?.[schema.key]))
    && Number.isFinite(Number(schema.max))
  )) ?? null;
}

function largerValue(schema, current) {
  const min = Number(schema.min ?? 0);
  const max = Number(schema.max);
  const step = Math.abs(Number(schema.step ?? 1)) || 1;
  const raised = Math.max(current + step, Math.ceil(current * 1.5 / step) * step);
  const value = Math.min(max, raised);
  return value > Math.max(min, current) ? Number(value.toFixed(10)) : null;
}

function capacitySuggestion(context) {
  const control = capacityControl(context);
  if (!control) return null;
  const baseline = Number(context.controls[control.key]);
  const proposed = largerValue(control, baseline);
  if (proposed === null) return null;
  const teachingGoal = {
    type: 'compare-control',
    objective: 'compare',
    control: control.key,
    values: [baseline, proposed],
  };
  try {
    // Planning here is a deterministic schema/capability validation. Script
    // composition, dry-run, fidelity, and explicit loading remain on the
    // existing Host TeachingGoal API when a learner elects to run it.
    planTeachingGoal({ goal: teachingGoal, context });
  } catch {
    return null;
  }
  return {
    version: INQUIRY_SUGGESTION_VERSION,
    id: `compare-capacity-${control.key}`,
    kind: INQUIRY_SUGGESTION_KINDS.TEACHING_GOAL,
    questionKey: 'playground.inquirySuggestion.capacity.question',
    hypothesisKey: 'playground.inquirySuggestion.capacity.hypothesis',
    intervention: { factor: `model.${control.key}`, actionKey: 'playground.inquirySuggestion.capacity.intervention' },
    holdFactors: ['world', 'learning', 'evaluation', 'randomness-policy'].slice(0, MAX_HOLDS),
    expectedObservableIds: ['model.hiddenUnits', ...taskOutcomeIds(context)].filter((id, index, values) => values.indexOf(id) === index).slice(0, 3),
    relatedConceptIds: [INQUIRY_CONCEPT_IDS.GENERALIZATION],
    reasonCode: 'model-capacity-comparison',
    teachingGoal,
  };
}

function canonicalSuggestion(value) {
  if (!value || typeof value !== 'object') return null;
  if (!Object.values(INQUIRY_SUGGESTION_KINDS).includes(value.kind)) return null;
  if (typeof value.id !== 'string' || !value.id || typeof value.questionKey !== 'string' || typeof value.hypothesisKey !== 'string') return null;
  if (!value.intervention || typeof value.intervention.factor !== 'string' || typeof value.intervention.actionKey !== 'string') return null;
  const holdFactors = Array.isArray(value.holdFactors) ? value.holdFactors.filter((item) => typeof item === 'string' && item).slice(0, MAX_HOLDS) : [];
  const expectedObservableIds = Array.isArray(value.expectedObservableIds) ? value.expectedObservableIds.filter((item) => typeof item === 'string' && item).slice(0, 4) : [];
  const relatedConceptIds = Array.isArray(value.relatedConceptIds) ? value.relatedConceptIds.filter((item) => typeof item === 'string' && item).slice(0, 2) : [];
  const result = {
    version: INQUIRY_SUGGESTION_VERSION,
    id: value.id,
    kind: value.kind,
    questionKey: value.questionKey,
    hypothesisKey: value.hypothesisKey,
    intervention: { factor: value.intervention.factor, actionKey: value.intervention.actionKey },
    holdFactors,
    expectedObservableIds,
    relatedConceptIds,
    reasonCode: typeof value.reasonCode === 'string' ? value.reasonCode : null,
  };
  if (value.kind === INQUIRY_SUGGESTION_KINDS.TEACHING_GOAL && value.teachingGoal) result.teachingGoal = clone(value.teachingGoal);
  return result;
}

// Returns only suggestions whose premise is an existing direct inquiry
// candidate. The same state always returns the same bounded order.
export function deriveInquirySuggestions({ inquiry, context } = {}) {
  const suggestsSupport = hasCandidate(inquiry, INQUIRY_CONCEPT_IDS.DISTRIBUTION_SHIFT)
    || hasCandidate(inquiry, INQUIRY_CONCEPT_IDS.GENERALIZATION);
  const suggestsCapacity = hasCandidate(inquiry, INQUIRY_CONCEPT_IDS.GENERALIZATION);
  const suggestions = [
    ...(suggestsSupport ? [manualSupportShiftSuggestion(context)] : []),
    ...(suggestsCapacity ? [capacitySuggestion(context)] : []),
  ].map(canonicalSuggestion).filter(Boolean).slice(0, MAX_SUGGESTIONS);
  return { version: INQUIRY_SUGGESTION_VERSION, suggestions };
}
