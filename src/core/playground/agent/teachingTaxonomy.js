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

// Capability-grounded support derivation. Rules are generic:
//   predict intent + neighbor/vote evidence  -> explain_prediction
//   fit intent + training evidence          -> show_training / show_failure_case
//   any plannable control                   -> compare / show_parameter_effect
//   any playground                          -> introduce
// There is intentionally no model-id switch and no KNN/LR objective map.
export function getSupportedTeachingObjectives(context) {
  const intents = new Set(
    Object.values(context?.model?.operations ?? {})
      .map((operation) => operation?.intent)
      .filter(Boolean),
  );
  const fields = new Set(context?.model?.semanticFields ?? []);
  const hasPlannableControl = (context?.controlSchemas ?? []).some(isPlannableControl);
  const supported = ['introduce'];
  if (hasPlannableControl) supported.push('compare', 'show_parameter_effect');
  if (intents.has('predict') && fields.has('neighbors') && fields.has('voting')) {
    supported.push('explain_prediction');
  }
  if (intents.has('fit') && fields.has('training')) {
    supported.push('show_training');
    if (fields.has('observation')) supported.push('show_failure_case');
  }
  return supported;
}
