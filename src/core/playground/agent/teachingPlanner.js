import { TEACHING_GOAL_TYPES, teachingError, validateTeachingPlan } from './teachingPlan.js';

// Deterministic Teaching Planner. It derives everything from
// inspectContext() (controlSchemas, operations, semantic fields) and never
// hardcodes model knowledge such as "KNN supports k 1..20".

function assertControlValue(schema, value) {
  if (schema.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) throw teachingError('TEACHING_VALUE_OUT_OF_RANGE', { control: schema.key, value });
    if (schema.min !== undefined && number < schema.min) {
      throw teachingError('TEACHING_VALUE_OUT_OF_RANGE', { control: schema.key, value, min: schema.min });
    }
    if (schema.max !== undefined && number > schema.max) {
      throw teachingError('TEACHING_VALUE_OUT_OF_RANGE', { control: schema.key, value, max: schema.max });
    }
    return number;
  }
  if (schema.type === 'select' && schema.options && !schema.options.includes(value)) {
    throw teachingError('TEACHING_VALUE_OUT_OF_RANGE', { control: schema.key, value, options: schema.options });
  }
  return value;
}

function findControlSchema(context, key) {
  return (context?.controlSchemas ?? []).find((schema) => schema.key === key) ?? null;
}

function comparePhases(values) {
  return [
    { id: 'show-data', titleKey: 'playground.process.title' },
    { id: 'capture-baseline' },
    { id: `evaluate-${values[0]}`, titleKey: 'playground.comparison.title' },
    { id: 'capture-left' },
    { id: 'restore-baseline' },
    { id: `evaluate-${values[1]}`, titleKey: 'playground.comparison.title' },
    { id: 'capture-right' },
    { id: 'summarize', titleKey: 'playground.comparison.body' },
  ];
}

function buildComparePlan({ goal, context, playgroundId }) {
  const schema = findControlSchema(context, goal.control);
  if (!schema) throw teachingError('TEACHING_CONTROL_INVALID', { control: goal.control });
  if (!Array.isArray(goal.values) || goal.values.length < 2) {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'compare values need at least two entries' });
  }
  const values = goal.values.map((value) => assertControlValue(schema, value));
  return validateTeachingPlan({
    version: 1,
    id: `compare-${goal.control}`,
    playgroundId,
    goal: { type: 'compare-control', control: goal.control, values },
    phases: comparePhases(values),
  });
}

function buildWhatIfPlan({ goal, context, playgroundId }) {
  const schema = findControlSchema(context, goal.control);
  if (!schema) throw teachingError('TEACHING_CONTROL_INVALID', { control: goal.control });
  const value = assertControlValue(schema, goal.value);
  return validateTeachingPlan({
    version: 1,
    id: `what-if-${goal.control}`,
    playgroundId,
    goal: { type: 'what-if', control: goal.control, value },
    phases: [
      { id: 'show-data', titleKey: 'playground.process.title' },
      { id: 'set-control', titleKey: 'playground.whatIf.title' },
      { id: 'train', titleKey: 'playground.whatIf.body' },
      { id: 'inspect', titleKey: 'playground.whatIf.body' },
      { id: 'summarize', titleKey: 'playground.whatIf.body' },
    ],
  });
}

function buildProcessPlan({ goalType, playgroundId }) {
  return validateTeachingPlan({
    version: 1,
    id: goalType,
    playgroundId,
    goal: { type: goalType },
    phases: [
      { id: 'show-data', titleKey: 'playground.process.title' },
      { id: 'run-model', titleKey: 'playground.process.body' },
      { id: 'reveal', titleKey: 'playground.process.body' },
      { id: 'summarize', titleKey: 'playground.process.body' },
    ],
  });
}

// Structured goal objects are the deterministic contract a later LLM planner
// must obey. Every value is checked against the controlSchemas from
// inspectContext(), so an impossible experiment is rejected with a stable
// error instead of being guessed.
function planStructuredGoal({ goal, context, playgroundId }) {
  if (!TEACHING_GOAL_TYPES.includes(goal.type)) {
    throw teachingError('TEACHING_GOAL_UNSUPPORTED', { type: goal.type });
  }
  if (goal.type === 'compare-control') {
    return buildComparePlan({ goal, context, playgroundId });
  }
  if (goal.type === 'what-if') {
    return buildWhatIfPlan({ goal, context, playgroundId });
  }
  return buildProcessPlan({ goalType: goal.type, playgroundId });
}

export function planTeachingGoal({ goal, context }) {
  if (!context || typeof context !== 'object') {
    throw teachingError('TEACHING_PLAN_INVALID', { reason: 'context' });
  }
  const playgroundId = context.playground?.id;

  // Explicit structured goal: validate it against the schema directly.
  if (goal && typeof goal === 'object' && !Array.isArray(goal)) {
    return planStructuredGoal({ goal, context, playgroundId });
  }

  const goalText = String(goal ?? '').trim();
  if (!goalText) throw teachingError('TEACHING_GOAL_UNSUPPORTED', { goal });
  const kSchema = findControlSchema(context, 'k');
  const lrSchema = findControlSchema(context, 'learningRate');

  let plan = null;

  // compare-control: any explicit k=... values imply a parameter comparison.
  const kValues = [...goalText.matchAll(/k\s*=\s*([0-9]+)/gi)].map((match) => Number(match[1]));
  if (kSchema && kValues.length > 0) {
    const values = kValues.length >= 2 ? kValues.slice(0, 2) : [kValues[0], 15];
    values.forEach((value) => assertControlValue(kSchema, value));
    plan = {
      version: 1,
      id: 'compare-control-k',
      playgroundId,
      goal: { type: 'compare-control', control: 'k', values },
      phases: comparePhases(values),
    };
  }

  // what-if: learning-rate style requests on a numeric control.
  if (!plan && lrSchema && /learning rate|学习率|what.?if|lr|太高|过高|发散|diverg/i.test(goalText)) {
    plan = buildWhatIfPlan({
      goal: { type: 'what-if', control: 'learningRate', value: 2 },
      context,
      playgroundId,
    });
  }

  // explain-process: default teaching intent for both models.
  if (!plan) {
    plan = buildProcessPlan({ goalType: 'explain-process', playgroundId });
  }

  return validateTeachingPlan(plan);
}
