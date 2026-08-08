import { playgroundError } from '../../playgrounds/session.js';

// TeachingPlan v1: a JSON-safe, model-independent description of teaching
// intent, produced by the deterministic planner and consumed by the Composer.
// A plan says WHAT to teach (and which control values to compare), never HOW
// to render it.

export const TEACHING_GOAL_TYPES = ['explain-process', 'compare-control', 'what-if', 'diagnose'];

export function teachingError(code, details = {}) {
  return playgroundError(code, details);
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
  if (goal.type === 'compare-control' || goal.type === 'what-if') {
    if (typeof goal.control !== 'string' || !goal.control) {
      throw teachingError('TEACHING_CONTROL_INVALID', { reason: 'control' });
    }
    if (goal.type === 'compare-control' && (!Array.isArray(goal.values) || goal.values.length < 2)) {
      throw teachingError('TEACHING_PLAN_INVALID', { reason: 'compare values need at least two entries' });
    }
    if (goal.type === 'what-if' && goal.value === undefined) {
      throw teachingError('TEACHING_PLAN_INVALID', { reason: 'what-if needs a value' });
    }
  }
}

function validatePhases(phases) {
  if (!Array.isArray(phases)) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'phases must be an array' });
  }
  const ids = new Set();
  for (const phase of phases) {
    if (!phase || typeof phase !== 'object' || typeof phase.id !== 'string' || !phase.id) {
      throw teachingError('TEACHING_PLAN_INVALID', { reason: 'phase id' });
    }
    if (ids.has(phase.id)) throw teachingError('TEACHING_PLAN_INVALID', { reason: 'duplicate phase id' });
    ids.add(phase.id);
  }
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
