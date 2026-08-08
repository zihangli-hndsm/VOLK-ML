import { teachingError } from './teachingPlan.js';

// Lexical text parsing (PR E.1.1). This layer only recognizes wording and
// produces a *structured goal candidate*; it never decides model execution
// behavior. Every candidate is subsequently checked against
// inspectContext().controlSchemas by the schema-grounded planner, so an
// explicit request for an unavailable control is rejected instead of being
// silently reinterpreted.
//
// Explicit control syntax: `key=value` assignments (e.g. k=1, learningRate=2).
// Two assignments for the same control (or a compare hint such as 比较/区别/
// compare/vs) imply compare-control; a single assignment implies what-if.

const CONTROL_ALIASES = {
  lr: 'learningRate',
  'learning-rate': 'learningRate',
};

const COMPARE_HINTS = /比较|对比|区别|差异|compare|versus|vs\.?\b|difference/i;
const LEARNING_RATE_ALIASES = /学习率|learning\s*rate|learning-rate/i;
const TOO_HIGH = /太高|过高|发散|too\s*high|diverg/i;
const DIAGNOSE_HINTS = /诊断|diagnos/i;
const PREDICTION_HINTS = /预测|prediction|predict/i;
const INTRODUCE_HINTS = /介绍|introduce|overview/i;

function collectAssignments(text) {
  const assignments = [];
  const pattern = /([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*(-?\d+(?:\.\d+)?)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    assignments.push({
      control: CONTROL_ALIASES[match[1].toLowerCase()] ?? match[1],
      value: Number(match[2]),
    });
  }
  return assignments;
}

// Returns a structured goal candidate object, or null when the text is a
// genuinely generic teaching request (explain-process fallback applies).
// Throws TEACHING_GOAL_UNSUPPORTED for empty input and
// TEACHING_PLAN_INVALID for ambiguous explicit syntax.
export function parseTeachingGoalText(text) {
  const goalText = String(text ?? '').trim();
  if (!goalText) throw teachingError('TEACHING_GOAL_UNSUPPORTED', { goal: text });

  // Explicit diagnose request: diagnose semantics are not implemented in
  // E.1/E.1.1, so the planner rejects it with TEACHING_GOAL_UNSUPPORTED.
  if (DIAGNOSE_HINTS.test(goalText)) {
    return { type: 'diagnose' };
  }

  const assignments = collectAssignments(goalText);
  if (assignments.length > 0) {
    const controls = [...new Set(assignments.map((assignment) => assignment.control))];
    if (controls.length > 1) {
      throw teachingError('TEACHING_PLAN_INVALID', {
        reason: 'multiple controls in one goal',
        controls,
      });
    }
    const control = controls[0];
    const values = assignments.map((assignment) => assignment.value);
    const wantsCompare = COMPARE_HINTS.test(goalText) || values.length >= 2;
    if (wantsCompare) {
      return { type: 'compare-control', objective: 'compare', control, values };
    }
    return { type: 'what-if', objective: 'show_parameter_effect', control, value: values[0] };
  }

  // Lexical aliases: "learning rate too high / diverges" maps to a semantic
  // probe specification (direction only). The Planner owns the numeric
  // choice, derived from the current controls + controlSchemas, so the same
  // text produces different legal probes under different current states.
  if (LEARNING_RATE_ALIASES.test(goalText) && TOO_HIGH.test(goalText)) {
    return { type: 'what-if', objective: 'show_failure_case', control: 'learningRate', direction: 'increase' };
  }

  // "Explain this KNN prediction" style requests normalize to the
  // explain_prediction objective; the planner rejects it in contexts without
  // a predict operation.
  if (PREDICTION_HINTS.test(goalText)) {
    return { type: 'explain-process', objective: 'explain_prediction' };
  }

  if (INTRODUCE_HINTS.test(goalText)) {
    return { type: 'explain-process', objective: 'introduce' };
  }

  return null;
}
