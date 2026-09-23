import {
  BUILD_AGENT_CONTRACT_VERSION,
  BUILD_ARCHITECTURES,
  BUILD_EXECUTION_EXPECTATIONS,
  BUILD_MODEL_FAMILIES,
  BUILD_TASKS,
  assertJsonSafe,
  assertVersion,
  boundedId,
  boundedInteger,
  boundedNumber,
  boundedStringArray,
  failBuildAgent,
  rejectUnknownFields,
} from './contracts.js';
import { assertDatasetContext, featureNames } from './datasetContext.js';

const GOAL_FIELDS = [
  'version', 'goalId', 'task', 'modelFamily', 'architecture', 'dataset',
  'executionExpectation', 'parameters',
];

function nullableEnum(value, values, field) {
  const normalized = value === undefined ? null : value;
  if (normalized !== null && !values.includes(normalized)) {
    failBuildAgent('BUILD_GOAL_INVALID', `${field} is not supported.`, { field, value, supported: values });
  }
  return normalized;
}

function validateDatasetBinding(value) {
  if (value === undefined || value === null) return null;
  rejectUnknownFields(value, ['featureColumns', 'targetColumn'], 'BUILD_GOAL_INVALID', 'dataset');
  if (!Array.isArray(value.featureColumns) || value.featureColumns.length === 0) {
    failBuildAgent('BUILD_GOAL_INVALID', 'dataset.featureColumns must be non-empty.');
  }
  return {
    featureColumns: boundedStringArray(value.featureColumns, 'dataset.featureColumns', { max: 64 }),
    targetColumn: boundedId(value.targetColumn, 'dataset.targetColumn'),
  };
}

function validateParameters(value) {
  if (value === undefined || value === null) return null;
  rejectUnknownFields(value, ['hiddenUnits', 'trainRatio', 'epochs', 'batchSize'], 'BUILD_GOAL_INVALID', 'parameters');
  return {
    ...(value.hiddenUnits === undefined ? {} : { hiddenUnits: boundedInteger(value.hiddenUnits, 'parameters.hiddenUnits', { min: 1, max: 128 }) }),
    ...(value.trainRatio === undefined ? {} : { trainRatio: boundedNumber(value.trainRatio, 'parameters.trainRatio', { min: 0.5, max: 0.9 }) }),
    ...(value.epochs === undefined ? {} : { epochs: boundedInteger(value.epochs, 'parameters.epochs', { min: 1, max: 1_000 }) }),
    ...(value.batchSize === undefined ? {} : { batchSize: boundedInteger(value.batchSize, 'parameters.batchSize', { min: 1, max: 512 }) }),
  };
}

export function validateBuildGoal(value) {
  rejectUnknownFields(value, GOAL_FIELDS, 'BUILD_GOAL_INVALID', 'goal');
  assertVersion(value.version, 'goal.version');
  const goal = {
    version: BUILD_AGENT_CONTRACT_VERSION,
    goalId: boundedId(value.goalId, 'goalId'),
    task: nullableEnum(value.task, BUILD_TASKS, 'task'),
    modelFamily: nullableEnum(value.modelFamily, BUILD_MODEL_FAMILIES, 'modelFamily'),
    architecture: nullableEnum(value.architecture, BUILD_ARCHITECTURES, 'architecture'),
    dataset: validateDatasetBinding(value.dataset),
    executionExpectation: value.executionExpectation,
    parameters: validateParameters(value.parameters),
  };
  if (!BUILD_EXECUTION_EXPECTATIONS.includes(goal.executionExpectation)) {
    failBuildAgent('BUILD_GOAL_INVALID', 'executionExpectation is not supported.', {
      executionExpectation: goal.executionExpectation,
      supported: BUILD_EXECUTION_EXPECTATIONS,
    });
  }
  assertJsonSafe(goal, 'BUILD_GOAL_INVALID');
  return structuredClone(goal);
}

function clarification(code, missing, details = {}) {
  return {
    kind: 'clarification',
    version: BUILD_AGENT_CONTRACT_VERSION,
    code,
    missing: [...missing],
    details: structuredClone(details),
  };
}

function unsupported(code, details = {}) {
  return {
    kind: 'unsupported',
    version: BUILD_AGENT_CONTRACT_VERSION,
    code,
    details: structuredClone(details),
  };
}

/** Resolve nullable goal fields against the authoritative local context. */
export function resolveBuildGoal(value, datasetContext) {
  const goal = validateBuildGoal(value);
  const context = assertDatasetContext(datasetContext);
  const missing = [];
  if (!context.task) missing.push('task');
  if (!context.targetColumn?.name) missing.push('targetColumn');
  if (!context.featureColumns?.length) missing.push('featureColumns');
  if (missing.length) return clarification('BUILD_CLARIFICATION_REQUIRED', missing);

  const task = goal.task ?? context.task;
  if (goal.task && goal.task !== context.task) {
    return unsupported('BUILD_TASK_DATASET_MISMATCH', { goalTask: goal.task, datasetTask: context.task });
  }
  const selectedFeatures = goal.dataset?.featureColumns ?? featureNames(context);
  const contextFeatures = new Set(featureNames(context));
  const unknownFeatures = selectedFeatures.filter((feature) => !contextFeatures.has(feature));
  if (unknownFeatures.length) return clarification('BUILD_FEATURES_NOT_FOUND', ['dataset.featureColumns'], { unknownFeatures });
  const targetColumn = goal.dataset?.targetColumn ?? context.targetColumn.name;
  if (targetColumn !== context.targetColumn.name) return clarification('BUILD_TARGET_NOT_FOUND', ['dataset.targetColumn'], { targetColumn });
  const nonNumeric = selectedFeatures.filter((feature) => context.featureColumns.find((item) => item.name === feature)?.type !== 'number');
  if (nonNumeric.length) return unsupported('BUILD_NUMERIC_FEATURES_REQUIRED', { features: nonNumeric });

  let modelFamily = goal.modelFamily;
  let architecture = goal.architecture;
  if (architecture === 'explicit-mlp' && modelFamily && modelFamily !== 'mlp') {
    return unsupported('BUILD_ARCHITECTURE_FAMILY_MISMATCH', { architecture, modelFamily });
  }
  if (architecture === 'explicit-mlp') modelFamily = 'mlp';
  if (!modelFamily) modelFamily = task === 'classification' ? 'knn' : 'linear-regression';
  if (!architecture) architecture = modelFamily === 'mlp' ? 'explicit-mlp' : 'baseline';
  if (modelFamily === 'mlp' && architecture !== 'explicit-mlp') {
    return unsupported('BUILD_MLP_ARCHITECTURE_REQUIRED', { architecture });
  }
  if (modelFamily !== 'mlp' && architecture !== 'baseline') {
    return unsupported('BUILD_BASELINE_ARCHITECTURE_REQUIRED', { architecture, modelFamily });
  }
  if (task === 'regression' && modelFamily === 'knn') return unsupported('BUILD_REGRESSION_MODEL_UNSUPPORTED', { modelFamily });
  if (task === 'classification' && modelFamily === 'linear-regression') return unsupported('BUILD_CLASSIFICATION_MODEL_UNSUPPORTED', { modelFamily });
  if (task === 'classification' && (!Number.isInteger(context.classCount) || context.classCount < 2)) {
    return clarification('BUILD_CLASS_COUNT_REQUIRED', ['at-least-two-classes']);
  }
  if (!context.hasUsableTestSplit) return clarification('BUILD_TEST_SPLIT_REQUIRED', ['usable-test-split']);
  if (goal.executionExpectation === 'browser-local' && context.usableRowCount < 3) {
    return clarification('BUILD_ROWS_REQUIRED', ['at-least-three-usable-rows']);
  }

  return {
    kind: 'resolved',
    version: BUILD_AGENT_CONTRACT_VERSION,
    goal: {
      ...goal,
      task,
      modelFamily,
      architecture,
      dataset: { featureColumns: selectedFeatures, targetColumn },
    },
    context,
  };
}

export function isBuildClarification(value) {
  return value?.kind === 'clarification';
}

export function isBuildUnsupported(value) {
  return value?.kind === 'unsupported';
}

export { clarification, unsupported };
