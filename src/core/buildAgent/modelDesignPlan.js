import {
  BUILD_AGENT_CONTRACT_VERSION,
  BUILD_EXECUTION_EXPECTATIONS,
  BUILD_MODEL_FAMILIES,
  BUILD_TASKS,
  assertJsonSafe,
  boundedId,
  boundedInteger,
  boundedNumber,
  boundedStringArray,
  failBuildAgent,
  rejectUnknownFields,
} from './contracts.js';
import { resolveBuildGoal } from './buildGoal.js';

export const BUILD_BLUEPRINT_IDS = Object.freeze({
  regressionLinear: 'tabular-regression-linear-v1',
  classificationKnn: 'tabular-classification-knn-v1',
  regressionMlp: 'tabular-regression-mlp-v1',
  classificationMlp: 'tabular-classification-mlp-v1',
});

const PLAN_FIELDS = [
  'version', 'planId', 'blueprintId', 'task', 'modelFamily', 'architecture',
  'dataset', 'training', 'executionExpectation', 'capabilityRefs',
];

const BLUEPRINT_BY_FAMILY = Object.freeze({
  'regression:linear-regression': BUILD_BLUEPRINT_IDS.regressionLinear,
  'classification:knn': BUILD_BLUEPRINT_IDS.classificationKnn,
  'regression:mlp': BUILD_BLUEPRINT_IDS.regressionMlp,
  'classification:mlp': BUILD_BLUEPRINT_IDS.classificationMlp,
});

const DEFAULT_TRAINING = Object.freeze({
  [BUILD_BLUEPRINT_IDS.regressionLinear]: { trainRatio: 0.8, epochs: 200 },
  [BUILD_BLUEPRINT_IDS.classificationKnn]: { trainRatio: 0.8 },
  [BUILD_BLUEPRINT_IDS.regressionMlp]: { trainRatio: 0.8, epochs: 250, batchSize: 10, shuffle: true, loss: 'mse', optimizer: 'sgd' },
  [BUILD_BLUEPRINT_IDS.classificationMlp]: { trainRatio: 0.8, epochs: 120, batchSize: 16, shuffle: true, loss: 'cross-entropy', optimizer: 'sgd' },
});

const CAPABILITIES = Object.freeze({
  [BUILD_BLUEPRINT_IDS.regressionLinear]: ['dataset.table', 'split.train-test', 'model.linear-regression', 'trainer.gradient-descent', 'evaluation.regression'],
  [BUILD_BLUEPRINT_IDS.classificationKnn]: ['dataset.table', 'model.knn', 'evaluation.classification'],
  [BUILD_BLUEPRINT_IDS.regressionMlp]: ['dataset.table', 'split.train-test', 'model.mlp', 'loss.mse', 'optimizer.sgd', 'trainer.supervised', 'evaluation.regression'],
  [BUILD_BLUEPRINT_IDS.classificationMlp]: ['dataset.table', 'split.train-test', 'model.mlp', 'loss.cross-entropy', 'optimizer.sgd', 'trainer.supervised', 'evaluation.classification'],
});

function planId(goalId, blueprintId) {
  return `build-plan-${goalId}-${blueprintId}`.slice(0, 192);
}

function normalizeTraining(blueprintId, goalParameters) {
  const defaults = DEFAULT_TRAINING[blueprintId];
  const parameters = goalParameters ?? {};
  const training = {
    ...defaults,
    ...(parameters.trainRatio === undefined ? {} : { trainRatio: parameters.trainRatio }),
    ...(parameters.epochs === undefined ? {} : { epochs: parameters.epochs }),
    ...(parameters.batchSize === undefined ? {} : { batchSize: parameters.batchSize }),
  };
  if (training.trainRatio !== undefined) training.trainRatio = boundedNumber(training.trainRatio, 'training.trainRatio', { min: 0.5, max: 0.9 });
  if (training.epochs !== undefined) training.epochs = boundedInteger(training.epochs, 'training.epochs', { min: 1, max: 1_000 });
  if (training.batchSize !== undefined) training.batchSize = boundedInteger(training.batchSize, 'training.batchSize', { min: 1, max: 512 });
  if (training.shuffle !== undefined && typeof training.shuffle !== 'boolean') failBuildAgent('BUILD_PLAN_INVALID', 'training.shuffle must be boolean.');
  return training;
}

function validateTraining(value) {
  rejectUnknownFields(value, ['trainRatio', 'epochs', 'batchSize', 'shuffle', 'loss', 'optimizer', 'hiddenUnits'], 'BUILD_PLAN_INVALID', 'training');
  if (value.trainRatio !== undefined) boundedNumber(value.trainRatio, 'training.trainRatio', { min: 0.5, max: 0.9 });
  if (value.epochs !== undefined) boundedInteger(value.epochs, 'training.epochs', { min: 1, max: 1_000 });
  if (value.batchSize !== undefined) boundedInteger(value.batchSize, 'training.batchSize', { min: 1, max: 512 });
  if (value.hiddenUnits !== undefined) boundedInteger(value.hiddenUnits, 'training.hiddenUnits', { min: 1, max: 128 });
  if (value.shuffle !== undefined && typeof value.shuffle !== 'boolean') failBuildAgent('BUILD_PLAN_INVALID', 'training.shuffle must be boolean.');
  if (value.loss !== undefined && !['mse', 'cross-entropy'].includes(value.loss)) failBuildAgent('BUILD_PLAN_INVALID', 'training.loss is unsupported.');
  if (value.optimizer !== undefined && value.optimizer !== 'sgd') failBuildAgent('BUILD_PLAN_INVALID', 'training.optimizer is unsupported.');
}

function typedUnsupportedGoalRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.task === 'string' && value.task.trim() && !BUILD_TASKS.includes(value.task)) {
    return {
      kind: 'unsupported',
      version: BUILD_AGENT_CONTRACT_VERSION,
      code: 'BUILD_TASK_UNSUPPORTED',
      details: { task: value.task },
    };
  }
  if (typeof value.modelFamily === 'string' && value.modelFamily.trim() && !BUILD_MODEL_FAMILIES.includes(value.modelFamily)) {
    return {
      kind: 'unsupported',
      version: BUILD_AGENT_CONTRACT_VERSION,
      code: 'BUILD_MODEL_FAMILY_UNSUPPORTED',
      details: { modelFamily: value.modelFamily },
    };
  }
  return null;
}

export function validateModelDesignPlan(value) {
  rejectUnknownFields(value, PLAN_FIELDS, 'BUILD_PLAN_INVALID', 'plan');
  if (value.version !== BUILD_AGENT_CONTRACT_VERSION) failBuildAgent('BUILD_CONTRACT_VERSION_UNSUPPORTED', 'plan.version is unsupported.');
  if (typeof value.planId !== 'string' || !value.planId.trim()) failBuildAgent('BUILD_PLAN_INVALID', 'plan.planId is required.');
  if (!Object.values(BUILD_BLUEPRINT_IDS).includes(value.blueprintId)) failBuildAgent('BUILD_PLAN_INVALID', 'plan.blueprintId is unsupported.');
  if (!['regression', 'classification'].includes(value.task)) failBuildAgent('BUILD_PLAN_INVALID', 'plan.task is unsupported.');
  if (!['linear-regression', 'knn', 'mlp'].includes(value.modelFamily)) failBuildAgent('BUILD_PLAN_INVALID', 'plan.modelFamily is unsupported.');
  if (!['baseline', 'explicit-mlp'].includes(value.architecture)) failBuildAgent('BUILD_PLAN_INVALID', 'plan.architecture is unsupported.');
  if (BLUEPRINT_BY_FAMILY[`${value.task}:${value.modelFamily}`] !== value.blueprintId) failBuildAgent('BUILD_PLAN_INVALID', 'plan.blueprintId does not match task/model family.');
  if ((value.modelFamily === 'mlp') !== (value.architecture === 'explicit-mlp')) failBuildAgent('BUILD_PLAN_INVALID', 'plan.architecture does not match model family.');
  rejectUnknownFields(value.dataset, ['featureColumns', 'targetColumn', 'featureCount', 'classCount'], 'BUILD_PLAN_INVALID', 'dataset');
  if (!Array.isArray(value.dataset.featureColumns) || value.dataset.featureColumns.length < 1) failBuildAgent('BUILD_PLAN_INVALID', 'plan.dataset.featureColumns is required.');
  boundedStringArray(value.dataset.featureColumns, 'dataset.featureColumns', { max: 64 });
  boundedId(value.dataset.targetColumn, 'dataset.targetColumn');
  boundedInteger(value.dataset.featureCount, 'dataset.featureCount', { min: 1, max: 64 });
  if (value.dataset.classCount !== null) boundedInteger(value.dataset.classCount, 'dataset.classCount', { min: 0, max: 10_000 });
  validateTraining(value.training);
  if (!BUILD_EXECUTION_EXPECTATIONS.includes(value.executionExpectation)) failBuildAgent('BUILD_PLAN_INVALID', 'plan.executionExpectation is unsupported.');
  if (!Array.isArray(value.capabilityRefs) || value.capabilityRefs.length < 1) failBuildAgent('BUILD_PLAN_INVALID', 'plan.capabilityRefs is required.');
  assertJsonSafe(value, 'BUILD_PLAN_INVALID');
  return structuredClone(value);
}

/** Resolve a BuildGoal into a detached, declarative model design plan. */
export function planBuildGoal(goal, datasetContext) {
  let resolved;
  try {
    resolved = resolveBuildGoal(goal, datasetContext);
  } catch (error) {
    const typed = typedUnsupportedGoalRequest(goal);
    if (typed) return typed;
    throw error;
  }
  if (resolved.kind !== 'resolved') return resolved;
  const { goal: normalizedGoal, context } = resolved;
  const blueprintId = BLUEPRINT_BY_FAMILY[`${normalizedGoal.task}:${normalizedGoal.modelFamily}`];
  if (!blueprintId) return { kind: 'unsupported', version: BUILD_AGENT_CONTRACT_VERSION, code: 'BUILD_CAPABILITY_UNSUPPORTED', details: { task: normalizedGoal.task, modelFamily: normalizedGoal.modelFamily } };
  if (normalizedGoal.executionExpectation === 'future-cloud') {
    return { kind: 'unsupported', version: BUILD_AGENT_CONTRACT_VERSION, code: 'BUILD_FUTURE_CLOUD_UNAVAILABLE', details: { blueprintId } };
  }
  if (normalizedGoal.executionExpectation === 'unsupported') {
    return { kind: 'unsupported', version: BUILD_AGENT_CONTRACT_VERSION, code: 'BUILD_EXECUTION_UNSUPPORTED', details: { blueprintId } };
  }
  if (normalizedGoal.executionExpectation === 'export-only' && normalizedGoal.modelFamily === 'knn') {
    return { kind: 'unsupported', version: BUILD_AGENT_CONTRACT_VERSION, code: 'BUILD_KNN_EXPORT_UNSUPPORTED', details: { blueprintId } };
  }
  const training = normalizeTraining(blueprintId, normalizedGoal.parameters);
  if (normalizedGoal.modelFamily === 'mlp') training.hiddenUnits = normalizedGoal.parameters?.hiddenUnits ?? 6;
  const plan = {
    version: BUILD_AGENT_CONTRACT_VERSION,
    planId: planId(normalizedGoal.goalId, blueprintId),
    blueprintId,
    task: normalizedGoal.task,
    modelFamily: normalizedGoal.modelFamily,
    architecture: normalizedGoal.architecture,
    dataset: {
      featureColumns: normalizedGoal.dataset.featureColumns,
      targetColumn: normalizedGoal.dataset.targetColumn,
      featureCount: normalizedGoal.dataset.featureColumns.length,
      classCount: context.classCount,
    },
    training,
    executionExpectation: normalizedGoal.executionExpectation,
    capabilityRefs: CAPABILITIES[blueprintId],
  };
  return { kind: 'plan', version: BUILD_AGENT_CONTRACT_VERSION, plan: validateModelDesignPlan(plan), context };
}

export { DEFAULT_TRAINING, CAPABILITIES };
