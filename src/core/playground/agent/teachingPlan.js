import { playgroundError } from '../../playgrounds/session.js';
import { TEACHING_OBJECTIVES } from './teachingTaxonomy.js';

// TeachingPlan v1: a JSON-safe, model-independent description of teaching
// intent, produced by the deterministic planner and consumed by the Composer.
// A plan says WHAT to teach (and which control values to compare), never HOW
// to render it.
//
// Since PR E.1.1, phases are typed and semantically meaningful. The Composer
// iterates/compiles plan.phases; it never regenerates the teaching sequence
// from plan.goal.type. Changing, removing or reordering a phase must change
// the composed script.
//
// Phase vocabulary (higher-level than a Visualization Script):
//   observe      - surface the current semantic evidence
//   set-control  - change one control to a concrete value
//   run          - execute a model operation for an objective
//   reveal       - play back `count` reveal/STEP steps to reach evidence
//   capture      - snapshot semantic evidence under a captureId
//   restore      - return to a previously captured experiment baseline
//   summarize    - end the sequence with a localized teaching observation

export const TEACHING_GOAL_TYPES = ['explain-process', 'compare-control', 'what-if'];

export const TEACHING_PHASE_KINDS = [
  'observe',
  'set-control',
  'run',
  'reveal',
  'capture',
  'restore',
  'summarize',
];

export function teachingError(code, details = {}) {
  return playgroundError(code, details);
}

// Single Teaching-level control validator shared by the Planner goal
// validation and the TeachingPlan context validation. It never silently
// coerces external values:
//   number  -> must be an actual finite number within [min, max]
//   boolean -> must be an actual boolean
//   select  -> must be one of the declared options; a select without
//              declared options is not safely plannable
export function validateTeachingControlValue(schema, value) {
  if (!schema || typeof schema !== 'object') {
    throw teachingError('TEACHING_CONTROL_INVALID', { reason: 'unknown control schema' });
  }
  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw teachingError('TEACHING_VALUE_OUT_OF_RANGE', { control: schema.key, value });
    }
    if (schema.min !== undefined && value < schema.min) {
      throw teachingError('TEACHING_VALUE_OUT_OF_RANGE', { control: schema.key, value, min: schema.min });
    }
    if (schema.max !== undefined && value > schema.max) {
      throw teachingError('TEACHING_VALUE_OUT_OF_RANGE', { control: schema.key, value, max: schema.max });
    }
    return value;
  }
  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw teachingError('TEACHING_CONTROL_INVALID', {
        control: schema.key,
        reason: 'boolean control requires a boolean value',
      });
    }
    return value;
  }
  if (schema.type === 'select') {
    if (!Array.isArray(schema.options) || schema.options.length === 0) {
      throw teachingError('TEACHING_CONTROL_INVALID', {
        control: schema.key,
        reason: 'select control without declared options is not safely plannable',
      });
    }
    if (!schema.options.includes(value)) {
      throw teachingError('TEACHING_VALUE_OUT_OF_RANGE', { control: schema.key, value, options: schema.options });
    }
    return value;
  }
  return value;
}

function isJsonSafe(value) {
  try {
    structuredClone(value);
    return true;
  } catch {
    return false;
  }
}

function validateGoal(goal) {
  if (!goal || typeof goal !== 'object' || Array.isArray(goal)) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'goal' });
  }
  if (!TEACHING_GOAL_TYPES.includes(goal.type)) {
    throw teachingError('TEACHING_GOAL_UNSUPPORTED', { type: goal.type });
  }
  if (goal.objective !== undefined && !TEACHING_OBJECTIVES.includes(goal.objective)) {
    throw teachingError('TEACHING_GOAL_UNSUPPORTED', { objective: goal.objective });
  }
  if (goal.type === 'compare-control' || goal.type === 'what-if') {
    if (typeof goal.control !== 'string' || !goal.control) {
      throw teachingError('TEACHING_CONTROL_INVALID', { reason: 'control' });
    }
    if (goal.type === 'compare-control') {
      if (!Array.isArray(goal.values) || goal.values.length !== 2) {
        throw teachingError('TEACHING_PLAN_INVALID', { reason: 'compare values need exactly two entries' });
      }
    }
    if (goal.type === 'what-if' && goal.value === undefined) {
      throw teachingError('TEACHING_PLAN_INVALID', { reason: 'what-if needs a value' });
    }
  }
}

function validatePhase(phase, ids) {
  if (!phase || typeof phase !== 'object' || Array.isArray(phase)) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'phase declaration' });
  }
  if (typeof phase.id !== 'string' || !phase.id) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'phase id' });
  }
  if (ids.has(phase.id)) throw teachingError('TEACHING_PLAN_INVALID', { reason: 'duplicate phase id' });
  ids.add(phase.id);
  if (!TEACHING_PHASE_KINDS.includes(phase.kind)) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: `unknown phase kind ${phase.kind}`, phaseId: phase.id });
  }
  if (phase.kind === 'set-control') {
    if (typeof phase.control !== 'string' || !phase.control || phase.value === undefined) {
      throw teachingError('TEACHING_PLAN_INVALID', { reason: 'set-control needs control + value', phaseId: phase.id });
    }
  }
  if (phase.kind === 'run' && (typeof phase.objective !== 'string' || !phase.objective)) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'run needs an objective', phaseId: phase.id });
  }
  if (phase.kind === 'reveal' && (!Number.isInteger(phase.count) || phase.count < 0)) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'reveal count must be a non-negative integer', phaseId: phase.id });
  }
  for (const kind of ['capture', 'restore']) {
    if (phase.kind === kind && (typeof phase.captureId !== 'string' || !phase.captureId)) {
      throw teachingError('TEACHING_PLAN_INVALID', { reason: `${kind} needs a captureId`, phaseId: phase.id });
    }
  }
  if (phase.kind === 'summarize' && (typeof phase.titleKey !== 'string' || typeof phase.bodyKey !== 'string')) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'summarize needs titleKey + bodyKey', phaseId: phase.id });
  }
}

function validatePhases(phases) {
  if (!Array.isArray(phases)) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'phases must be an array' });
  }
  const ids = new Set();
  for (const phase of phases) validatePhase(phase, ids);
}

export function validateTeachingPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'declaration' });
  }
  if (!isJsonSafe(plan)) throw teachingError('TEACHING_PLAN_INVALID', { reason: 'not json-safe' });
  if (plan.version !== 1) throw teachingError('TEACHING_PLAN_INVALID', { reason: 'version' });
  if (typeof plan.id !== 'string' || !plan.id) throw teachingError('TEACHING_PLAN_INVALID', { reason: 'id' });
  if (typeof plan.playgroundId !== 'string' || !plan.playgroundId) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'playgroundId' });
  }
  validateGoal(plan.goal);
  validatePhases(plan.phases);
  return plan;
}

// Computes the compiled Visualization Script step cost of a TeachingPlan
// without materializing any steps: every phase costs 1 except `reveal`,
// which costs phase.count (0 for an empty reveal). This is the pre-expansion
// resource guard for the Composer.
export function estimateCompiledStepCost(plan) {
  validateTeachingPlan(plan);
  return plan.phases.reduce(
    (total, phase) => total + (phase.kind === 'reveal' ? phase.count : 1),
    0,
  );
}

// Finds the script operation whose declarative `intent` matches an objective
// ('predict' | 'fit' | ...). When several operations share an intent, the one
// that declares a reveal playback timeline wins, because it is the operation
// that prepares step-by-step evidence. This is pure schema lookup: it never
// consults model ids or operation names.
export function findOperationByIntent(context, intent) {
  const operations = context?.model?.operations ?? {};
  const matches = Object.entries(operations).filter(([, schema]) => schema?.intent === intent);
  const withPlayback = matches.find(([, schema]) => schema?.playback?.revealCountControl);
  return (withPlayback ?? matches[0] ?? null)?.[0] ?? null;
}

// Validates a TeachingPlan against the current inspectContext() before any
// composition work: the plan must belong to this playground and every control
// / semantic field / run objective it references must still exist. A plan
// created for KNN must never be silently reinterpreted in an LR context and
// only fail later during the dry run.
export function validatePlanAgainstContext(plan, context) {
  validateTeachingPlan(plan);
  if (!context || typeof context !== 'object' || !context.playground?.id) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'context' });
  }
  if (plan.playgroundId !== context.playground.id) {
    throw teachingError('TEACHING_PLAN_INVALID', {
      reason: 'playground mismatch',
      plan: plan.playgroundId,
      context: context.playground.id,
    });
  }
  const controlKeys = new Set((context.controlSchemas ?? []).map((schema) => schema.key));
  const controlSchemas = new Map((context.controlSchemas ?? []).map((schema) => [schema.key, schema]));
  const semanticFields = new Set(context.model?.semanticFields ?? []);
  for (const phase of plan.phases) {
    if (phase.control !== undefined && !controlKeys.has(phase.control)) {
      throw teachingError('TEACHING_CONTROL_INVALID', { control: phase.control, phaseId: phase.id });
    }
    if (phase.kind === 'set-control') {
      validateTeachingControlValue(controlSchemas.get(phase.control), phase.value);
    }
    if (phase.kind === 'run' && !findOperationByIntent(context, phase.objective)) {
      throw teachingError('TEACHING_PLAN_INVALID', {
        reason: 'unresolvable run objective',
        objective: phase.objective,
        phaseId: phase.id,
      });
    }
    for (const field of phase.evidence ?? []) {
      if (typeof field !== 'string') {
        throw teachingError('TEACHING_PLAN_INVALID', { reason: 'evidence must be a semantic field name', phaseId: phase.id });
      }
      const first = field.split('.')[0];
      if (!semanticFields.has(first)) {
        throw teachingError('TEACHING_PLAN_INVALID', { reason: 'unknown evidence field', field, phaseId: phase.id });
      }
    }
  }
  // Pre-expansion resource guard: a TeachingPlan must never be able to
  // allocate an arbitrarily large Visualization Script before Script
  // validation runs. Both the raw phase count and the compiled step cost are
  // bounded by context.resourceLimits.maxSteps.
  const maxSteps = context.resourceLimits?.maxSteps;
  if (Number.isFinite(maxSteps)) {
    if (plan.phases.length > maxSteps) {
      throw teachingError('TEACHING_PLAN_INVALID', {
        reason: 'resource limit',
        phases: plan.phases.length,
        maxSteps,
      });
    }
    const estimatedSteps = estimateCompiledStepCost(plan);
    if (estimatedSteps > maxSteps) {
      throw teachingError('TEACHING_PLAN_INVALID', {
        reason: 'resource limit',
        estimatedSteps,
        maxSteps,
      });
    }
  }
  return plan;
}
