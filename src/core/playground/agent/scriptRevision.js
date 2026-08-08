import { composeScriptFromPlan } from './teachingComposer.js';
import { planTeachingGoal } from './teachingPlanner.js';
import { evaluateGoalFidelity, replayScriptForFidelity } from './teachingFidelity.js';
import { teachingError } from './teachingPlan.js';
import { validateScript } from '../visualization/scriptValidator.js';
import { dryRunScript } from './dryRun.js';

// Bounded Script revision (PR F.2). A structured revision request transforms
// an existing TeachingPlan + Visualization Script declaration; the result
// always passes validateScript -> strict dry run -> goal fidelity before it
// is returned. There is no free-form natural-language mutation and no
// arbitrary execution.
//
// Revision vocabulary (deterministic):
//   shorten                 { maxSteps }                      keep the first N steps
//   remove_visual           { primitiveTypes: [...] }         drop primitives + layout refs
//   keep_visuals            { primitiveTypes: [...] }         keep only these primitive types
//   focus_result            {}                                keep the final result group (last run/capture onward)
//   change_comparison_values { control, values: [a, b] }      re-plan a pairwise comparison

export const REVISION_TYPES = ['shorten', 'remove_visual', 'keep_visuals', 'focus_result', 'change_comparison_values'];

function requireJsonSafe(value) {
  try {
    structuredClone(value);
    return value;
  } catch {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'revision request is not JSON-safe' });
  }
}

function requirePrimitiveTypes(request) {
  if (!Array.isArray(request.primitiveTypes) || !request.primitiveTypes.length
    || request.primitiveTypes.some((type) => typeof type !== 'string')) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'revision needs primitiveTypes', type: request.type });
  }
  return [...new Set(request.primitiveTypes)];
}

function removePrimitives(script, keep) {
  const keepSet = new Set(keep);
  const revised = structuredClone(script);
  revised.primitives = revised.primitives.filter((primitive) => keepSet.has(primitive.type));
  const keptIds = new Set(revised.primitives.map((primitive) => primitive.id));
  const removedIds = new Set(script.primitives.map((primitive) => primitive.id).filter((id) => !keptIds.has(id)));
  for (const bucket of ['stage', 'side']) {
    revised.layout[bucket] = (revised.layout[bucket] ?? []).filter((id) => keptIds.has(id));
  }
  // Prune steps that target removed primitives (annotations need the
  // annotation primitive; show/hide/highlight reference primitive ids).
  revised.steps = revised.steps.filter((step) => {
    if (step.annotate !== undefined) {
      const annotationId = script.primitives.find((primitive) => primitive.type === 'annotation')?.id;
      if (!annotationId || removedIds.has(annotationId)) return false;
    }
    for (const operation of ['show', 'hide', 'highlight']) {
      if (step[operation] !== undefined && removedIds.has(step[operation])) return false;
    }
    return true;
  });
  return revised;
}

function focusResult(script) {
  const steps = script.steps;
  let start = -1;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index].invoke || steps[index].capture) {
      start = index;
      break;
    }
  }
  if (start < 0) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'cannot focus a script without run/capture steps' });
  }
  const revised = structuredClone(script);
  revised.steps = steps.slice(start);
  return revised;
}

function applyTransformation({ type, script, request }) {
  if (type === 'shorten') {
    const maxSteps = Number(request.maxSteps);
    if (!Number.isInteger(maxSteps) || maxSteps < 1) {
      throw teachingError('TEACHING_PLAN_INVALID', { reason: 'shorten needs a positive integer maxSteps' });
    }
    const revised = structuredClone(script);
    revised.steps = script.steps.slice(0, maxSteps);
    return revised;
  }
  if (type === 'remove_visual') {
    return removePrimitives(script, script.primitives.map((primitive) => primitive.type)
      .filter((primitiveType) => !requirePrimitiveTypes(request).includes(primitiveType)));
  }
  if (type === 'keep_visuals') {
    return removePrimitives(script, requirePrimitiveTypes(request));
  }
  if (type === 'focus_result') {
    return focusResult(script);
  }
  throw teachingError('TEACHING_PLAN_INVALID', { reason: `unsupported revision type ${type}` });
}

// Re-plans a pairwise comparison with new values and recomposes it.
function changeComparisonValues({ plan, request, context }) {
  if (plan.goal?.type !== 'compare-control') {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'change_comparison_values needs a compare-control plan' });
  }
  if (plan.goal.control !== request.control) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'comparison control mismatch', control: request.control });
  }
  if (!Array.isArray(request.values) || request.values.length !== 2) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'comparison values need exactly two entries' });
  }
  const revisedPlan = planTeachingGoal({
    goal: {
      type: 'compare-control',
      objective: plan.goal.objective ?? 'compare',
      control: plan.goal.control,
      values: request.values,
    },
    context,
  });
  const revisedScript = composeScriptFromPlan({ plan: revisedPlan, context });
  return { plan: revisedPlan, script: revisedScript };
}

export function reviseScriptDeclaration({ plan, script, request, context, session }) {
  requireJsonSafe(request);
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'revision request' });
  }
  if (!REVISION_TYPES.includes(request.type)) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: `unsupported revision type ${request.type}` });
  }

  let revisedPlan = plan;
  let revisedScript;
  if (request.type === 'change_comparison_values') {
    const replanned = changeComparisonValues({ plan, request, context });
    revisedPlan = replanned.plan;
    revisedScript = replanned.script;
  } else {
    revisedScript = applyTransformation({ type: request.type, script, request });
  }

  validateScript(revisedScript);
  const dryRun = dryRunScript({ script: revisedScript, session });
  if (!dryRun.valid) {
    throw Object.assign(new Error(dryRun.code), { code: dryRun.code, details: dryRun.details });
  }
  const execution = replayScriptForFidelity({ script: revisedScript, session });
  const fidelity = evaluateGoalFidelity({ plan: revisedPlan, script: revisedScript, context, execution });
  if (!fidelity.valid) {
    throw teachingError('TEACHING_GOAL_FIDELITY_FAILED', { missing: fidelity.missing });
  }
  return { plan: revisedPlan, script: revisedScript, fidelity, dryRun };
}
