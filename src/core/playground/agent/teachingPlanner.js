import {
  TEACHING_GOAL_TYPES,
  findOperationByIntent,
  teachingError,
  validatePlanAgainstContext,
  validateTeachingPlan,
  validateTeachingControlValue,
} from './teachingPlan.js';
import { parseTeachingGoalText } from './teachingGoalParser.js';

// Schema-grounded Teaching Planner (PR E.1.1). The planner never contains
// model behavior knowledge: control existence/values come from
// context.controlSchemas, run objectives come from the declarative
// `runObjective` on the control schema, operations come from
// context.model.operations (by `intent`), and reveal counts come from the
// operation's declarative `playback.revealCountControl`. Text parsing is
// delegated to parseTeachingGoalText() so lexical recognition can never
// decide model execution behavior.

function findControlSchema(context, key) {
  return (context?.controlSchemas ?? []).find((schema) => schema.key === key) ?? null;
}

// Generic semantic evidence for teaching phases: the stage primitives that
// are materializable in this context define which model fields carry the
// story, plus metrics/observation which every adapter declares.
function evidenceForContext(context) {
  const fields = new Set(['metrics', 'observation']);
  const semanticFields = new Set(context?.model?.semanticFields ?? []);
  for (const schema of context?.primitives ?? []) {
    if (schema.placement !== 'stage') continue;
    for (const candidates of Object.values(schema.compatibleBindings ?? {})) {
      for (const binding of candidates) {
        if (binding.startsWith('$model.')) {
          const first = binding.slice('$model.'.length).split('.')[0];
          if (semanticFields.has(first)) fields.add(first);
        }
      }
    }
  }
  return [...fields].sort();
}

function resolveRevealCount(context, operationName, currentControls) {
  const playback = context?.model?.operations?.[operationName]?.playback;
  if (!playback?.revealCountControl) return 0;
  const raw = currentControls?.[playback.revealCountControl];
  const number = Number(raw);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

// Builds the run+reveal phases for one branch of a compare/what-if plan.
// The run objective comes from the control's declarative `runObjective`; if
// the model declares no operation for it, the set-control itself is the
// evidence (e.g. LR weight/bias updates the prediction immediately).
function runPhases({ controlSchema, context, currentControls, suffix }) {
  const objective = controlSchema.runObjective;
  if (!objective) return [];
  const operationName = findOperationByIntent(context, objective);
  if (!operationName) {
    // A declared runObjective is a real contract: silently falling back to
    // immediate set-control evidence would hide a broken descriptor.
    throw teachingError('TEACHING_PLAN_INVALID', {
      reason: 'unresolvable run objective',
      objective,
      control: controlSchema.key,
    });
  }
  const phases = [{ id: `run-${suffix}`, kind: 'run', objective }];
  const reveals = resolveRevealCount(context, operationName, currentControls);
  if (reveals > 0) phases.push({ id: `reveal-${suffix}`, kind: 'reveal', count: reveals });
  return phases;
}

function buildComparisonPhases({ goal, context }) {
  const schema = findControlSchema(context, goal.control);
  if (!schema) throw teachingError('TEACHING_CONTROL_INVALID', { control: goal.control });
  if (!Array.isArray(goal.values) || goal.values.length !== 2) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'compare values need exactly two entries' });
  }
  const values = goal.values.map((value) => validateTeachingControlValue(schema, value));
  const evidence = evidenceForContext(context);
  const currentControls = { ...(context.controls ?? {}) };
  const branch = (value, suffix) => {
    currentControls[goal.control] = value;
    return [
      { id: `set-${suffix}`, kind: 'set-control', control: goal.control, value },
      ...runPhases({ controlSchema: schema, context, currentControls, suffix }),
      { id: `capture-${suffix}`, kind: 'capture', captureId: suffix, evidence },
    ];
  };
  return {
    values,
    phases: [
      { id: 'observe', kind: 'observe', evidence },
      { id: 'capture-baseline', kind: 'capture', captureId: 'baseline', evidence },
      ...branch(values[0], 'left'),
      { id: 'restore-baseline', kind: 'restore', captureId: 'baseline' },
      ...branch(values[1], 'right'),
      {
        id: 'summarize',
        kind: 'summarize',
        titleKey: 'playground.comparison.title',
        bodyKey: 'playground.comparison.body',
        params: { control: goal.control, left: values[0], right: values[1] },
      },
    ],
  };
}

function buildWhatIfPhases({ goal, context }) {
  const schema = findControlSchema(context, goal.control);
  if (!schema) throw teachingError('TEACHING_CONTROL_INVALID', { control: goal.control });
  if (goal.value === undefined) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'what-if needs a value' });
  }
  const value = validateTeachingControlValue(schema, goal.value);
  const evidence = evidenceForContext(context);
  const currentControls = { ...(context.controls ?? {}), [goal.control]: value };
  return {
    value,
    phases: [
      { id: 'observe', kind: 'observe', evidence },
      { id: 'set-control', kind: 'set-control', control: goal.control, value },
      ...runPhases({ controlSchema: schema, context, currentControls, suffix: 'result' }),
      { id: 'capture-result', kind: 'capture', captureId: 'result', evidence },
      {
        id: 'summarize',
        kind: 'summarize',
        titleKey: 'playground.whatIf.title',
        bodyKey: 'playground.whatIf.body',
        params: { control: goal.control, value },
      },
    ],
  };
}

function buildExplainProcessPhases({ context }) {
  const evidence = evidenceForContext(context);
  const currentControls = { ...(context.controls ?? {}) };
  const phases = [{ id: 'observe', kind: 'observe', evidence }];
  const objective = findOperationByIntent(context, 'predict') ? 'predict' : 'fit';
  const operationName = findOperationByIntent(context, objective);
  if (operationName) {
    phases.push({ id: 'run', kind: 'run', objective });
    const reveals = resolveRevealCount(context, operationName, currentControls);
    if (reveals > 0) phases.push({ id: 'reveal', kind: 'reveal', count: reveals });
  }
  phases.push({
    id: 'summarize',
    kind: 'summarize',
    titleKey: 'playground.process.title',
    bodyKey: 'playground.process.body',
    params: {},
  });
  return phases;
}

function planForStructuredGoal({ goal, context, playgroundId }) {
  if (!TEACHING_GOAL_TYPES.includes(goal.type)) {
    throw teachingError('TEACHING_GOAL_UNSUPPORTED', { type: goal.type });
  }
  if (goal.type === 'compare-control') {
    const { values, phases } = buildComparisonPhases({ goal, context });
    const plan = validateTeachingPlan({
      version: 1,
      id: `compare-${goal.control}`,
      playgroundId,
      goal: { type: 'compare-control', control: goal.control, values },
      phases,
    });
    return validatePlanAgainstContext(plan, context);
  }
  if (goal.type === 'what-if') {
    const { value, phases } = buildWhatIfPhases({ goal, context });
    const plan = validateTeachingPlan({
      version: 1,
      id: `what-if-${goal.control}`,
      playgroundId,
      goal: { type: 'what-if', control: goal.control, value },
      phases,
    });
    return validatePlanAgainstContext(plan, context);
  }
  const plan = validateTeachingPlan({
    version: 1,
    id: 'explain-process',
    playgroundId,
    goal: { type: 'explain-process' },
    phases: buildExplainProcessPhases({ context }),
  });
  return validatePlanAgainstContext(plan, context);
}

export function planTeachingGoal({ goal, context }) {
  if (!context || typeof context !== 'object') {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'context' });
  }
  const playgroundId = context.playground?.id;
  if (!playgroundId) throw teachingError('TEACHING_PLAN_INVALID', { reason: 'playgroundId' });

  // Text goals go through the lexical parser first; structured goals are the
  // deterministic contract a later LLM planner must obey. Both are then
  // checked against controlSchemas/operations by the schema-grounded code.
  let structured = goal;
  if (typeof goal !== 'object' || goal === null || Array.isArray(goal)) {
    structured = parseTeachingGoalText(goal);
  }
  if (structured && typeof structured === 'object' && !Array.isArray(structured)) {
    return planForStructuredGoal({ goal: structured, context, playgroundId });
  }
  // Genuinely generic request: explain-process fallback is reserved for
  // requests that did not explicitly ask for an unsupported control/operation.
  return planForStructuredGoal({ goal: { type: 'explain-process' }, context, playgroundId });
}
