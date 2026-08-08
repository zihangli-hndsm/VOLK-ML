// Pedagogical objective taxonomy (PR E.2).
//
// The taxonomy is a bounded vocabulary of *why* an experiment is being
// taught. It is separate from the mechanical goal family (compare-control /
// what-if / explain-process), which describes the experiment structure.
//
// Not every objective is implemented or supportable in every context. The
// taxonomy is always exposed; `getSupportedTeachingObjectives(context)` is
// the capability-grounded answer to what the current model/context can
// actually fulfill. A goal that cannot be fulfilled must reject explicitly,
// never silently degrade to a generic explanation.

export const TEACHING_OBJECTIVES = [
  'introduce',
  'compare',
  'explain_prediction',
  'show_training',
  'show_error',
  'show_parameter_effect',
  'show_generalization',
  'show_feature_effect',
  'show_failure_case',
];

// A control is schema-plannable when the Teaching-level validator can decide
// its values: numbers and booleans always, selects only when the descriptor
// declares options (KNN xFeature/yFeature have no options, so they are not
// plannable until dynamic option metadata exists).
function isPlannableControl(schema) {
  if (schema?.type === 'number' || schema?.type === 'boolean') return true;
  if (schema?.type === 'select') {
    return Array.isArray(schema.options) && schema.options.length > 0;
  }
  return false;
}

// Capability-grounded support derivation (PR E.2.1). The taxonomy defines the
// objective vocabulary; the model/adapter declares its pedagogical evidence
// contract via `teachingCapabilities` (operationIntent + visual/runtime/
// trace evidence). An objective is supported only when the context carries a
// declared capability whose operationIntent actually resolves. Structural
// objectives (compare / show_parameter_effect) only need a plannable control;
// introduce is available on any playground. There is intentionally no model
// id switch and no guessed semantic field combination (e.g. fit + a
// training field alone never implies show_failure_case).
export function getSupportedTeachingObjectives(context) {
  const intents = new Set(
    Object.values(context?.model?.operations ?? {})
      .map((operation) => operation?.intent)
      .filter(Boolean),
  );
  const hasPlannableControl = (context?.controlSchemas ?? []).some(isPlannableControl);
  const capabilities = context?.teachingCapabilities ?? {};
  const supported = ['introduce'];
  if (hasPlannableControl) supported.push('compare', 'show_parameter_effect');
  for (const [objective, capability] of Object.entries(capabilities)) {
    if (capability?.operationIntent && intents.has(capability.operationIntent)) {
      supported.push(objective);
    }
  }
  return supported;
}
