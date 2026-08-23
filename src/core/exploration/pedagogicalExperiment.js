// Bounded semantic layer for Agent-designed experiments. This module describes
// the question to isolate; the scenario planner remains the only owner of
// executable operations and observable selection.

export const PEDAGOGICAL_EXPERIMENT_VERSION = 1;

export const PEDAGOGICAL_EXPERIMENT_GOALS = Object.freeze({
  CLASS_SEPARATION: 'class-separation',
  TRAIN_TEST_SUPPORT_SHIFT: 'train-test-support-shift',
  OBSERVATION_NOISE: 'observation-noise',
  OUTLIER_SENSITIVITY: 'outlier-sensitivity',
});

export const PEDAGOGICAL_INTERVENTIONS = Object.freeze({
  MOVE_CLASS_TOWARD_CLASS: 'move-class-toward-class',
  SHIFT_TEST_SUPPORT: 'shift-test-support',
  INCREASE_POSITION_NOISE: 'increase-position-noise',
  ADD_OUTLIERS: 'add-outliers',
});

export const PEDAGOGICAL_EVIDENCE = Object.freeze({
  TASK_OUTCOME: 'task-outcome',
  COVERAGE_AND_OUTCOME: 'coverage-and-outcome',
  OUTCOME_AND_STABILITY: 'outcome-and-stability',
});

const integerConstant = (value) => ({ type: 'integer', const: value });
const stringConstant = (value) => ({ type: 'string', const: value });

const GOAL_CONTRACTS = Object.freeze({
  [PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION]: {
    intervention: PEDAGOGICAL_INTERVENTIONS.MOVE_CLASS_TOWARD_CLASS,
    evidence: PEDAGOGICAL_EVIDENCE.TASK_OUTCOME,
  },
  [PEDAGOGICAL_EXPERIMENT_GOALS.TRAIN_TEST_SUPPORT_SHIFT]: {
    intervention: PEDAGOGICAL_INTERVENTIONS.SHIFT_TEST_SUPPORT,
    evidence: PEDAGOGICAL_EVIDENCE.COVERAGE_AND_OUTCOME,
  },
  [PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE]: {
    intervention: PEDAGOGICAL_INTERVENTIONS.INCREASE_POSITION_NOISE,
    evidence: PEDAGOGICAL_EVIDENCE.TASK_OUTCOME,
  },
  [PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY]: {
    intervention: PEDAGOGICAL_INTERVENTIONS.ADD_OUTLIERS,
    evidence: PEDAGOGICAL_EVIDENCE.TASK_OUTCOME,
  },
});

const clone = (value) => structuredClone(value);

export function pedagogicalExperimentSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      version: integerConstant(PEDAGOGICAL_EXPERIMENT_VERSION),
      kind: stringConstant('exploration-design'),
      goal: { type: 'string', enum: Object.keys(GOAL_CONTRACTS) },
      intervention: { type: 'string', enum: Object.values(PEDAGOGICAL_INTERVENTIONS) },
      evidence: { type: 'string', enum: Object.values(PEDAGOGICAL_EVIDENCE) },
      prediction: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
    },
    required: ['version', 'kind', 'goal', 'intervention', 'evidence', 'prediction'],
  };
}

export function validateExplorationDesign(value, { context } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error('EXPLORATION_DESIGN_INVALID');
    error.code = 'EXPLORATION_DESIGN_INVALID';
    throw error;
  }
  const allowedKeys = ['version', 'kind', 'goal', 'intervention', 'evidence', 'prediction'];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    const error = new Error('EXPLORATION_DESIGN_INVALID');
    error.code = 'EXPLORATION_DESIGN_INVALID';
    error.details = { field: 'design', reason: 'unknown-key' };
    throw error;
  }
  const goal = String(value.goal ?? '');
  const contract = GOAL_CONTRACTS[goal];
  if (!contract || value.version !== PEDAGOGICAL_EXPERIMENT_VERSION || value.kind !== 'exploration-design') {
    const error = new Error('EXPLORATION_DESIGN_INVALID');
    error.code = 'EXPLORATION_DESIGN_INVALID';
    error.details = { field: 'goal' };
    throw error;
  }
  if (value.intervention !== contract.intervention || value.evidence !== contract.evidence) {
    const error = new Error('EXPLORATION_DESIGN_INVALID');
    error.code = 'EXPLORATION_DESIGN_INVALID';
    error.details = { field: 'intervention/evidence', reason: 'goal-contract-mismatch' };
    throw error;
  }
  if (value.prediction !== null && value.prediction !== undefined && typeof value.prediction !== 'boolean') {
    const error = new Error('EXPLORATION_DESIGN_INVALID');
    error.code = 'EXPLORATION_DESIGN_INVALID';
    error.details = { field: 'prediction' };
    throw error;
  }
  if (context?.world?.task && goal === PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION && context.world.task !== 'classification') {
    const error = new Error('EXPLORATION_DESIGN_UNSUPPORTED');
    error.code = 'EXPLORATION_DESIGN_UNSUPPORTED';
    error.details = { goal, task: context.world.task };
    throw error;
  }
  return {
    version: PEDAGOGICAL_EXPERIMENT_VERSION,
    kind: 'exploration-design',
    goal,
    intervention: contract.intervention,
    evidence: contract.evidence,
    prediction: value.prediction === true,
  };
}

export function createPedagogicalExperimentDesign(goal, { prediction = false } = {}) {
  const contract = GOAL_CONTRACTS[goal];
  if (!contract) return null;
  return validateExplorationDesign({
    version: PEDAGOGICAL_EXPERIMENT_VERSION,
    kind: 'exploration-design',
    goal,
    intervention: contract.intervention,
    evidence: contract.evidence,
    prediction,
  });
}

export function pedagogicalGoalContract(goal) {
  const contract = GOAL_CONTRACTS[goal];
  return contract ? clone(contract) : null;
}

export function pedagogicalGoalIds() {
  return Object.keys(GOAL_CONTRACTS);
}
