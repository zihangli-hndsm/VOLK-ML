import { profileBrowserDataset } from '../browserExecutionContract.js';
import { validateAgentDataset } from '../canvasAgent.js';
import {
  BUILD_AGENT_CONTRACT_VERSION,
  assertJsonSafe,
  boundedInteger,
  boundedString,
  boundedStringArray,
  failBuildAgent,
  rejectUnknownFields,
} from './contracts.js';

const DATASET_SOURCE_KINDS = new Set(['workspace-dataset', 'teaching-dataset', 'none']);

function columnType(dataset, name) {
  const declared = dataset.columns?.find((column) => column.name === name)?.type;
  if (declared === 'number' || declared === 'text') return declared;
  const values = dataset.rows.map((row) => row?.[name]).filter((value) => value !== null && value !== undefined && value !== '');
  return values.length && values.every((value) => Number.isFinite(Number(value))) ? 'number' : 'text';
}

function sourceKindOf(value) {
  const sourceKind = value ?? 'workspace-dataset';
  if (!DATASET_SOURCE_KINDS.has(sourceKind)) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Unsupported dataset source kind.', { sourceKind });
  return sourceKind;
}

/**
 * Derive a bounded semantic context from the authoritative local dataset.
 * This function intentionally returns no rows or raw cell values.
 */
export function createBuildDatasetContext(dataset, { sourceKind = 'workspace-dataset' } = {}) {
  let normalized;
  if (!dataset || typeof dataset !== 'object') {
    failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'A local dataset is required.');
  }
  try {
    normalized = validateAgentDataset(dataset);
  } catch (error) {
    failBuildAgent(error?.code === 'INVALID_DATASET' ? 'BUILD_DATASET_CONTEXT_INVALID' : 'BUILD_DATASET_CONTEXT_INVALID', 'Dataset cannot be used by Build Agent A.', {
      cause: error?.code ?? 'INVALID_DATASET',
    });
  }
  const profile = profileBrowserDataset(normalized);
  const featureColumns = normalized.featureColumns.map((name) => ({ name, type: columnType(normalized, name) }));
  const target = { name: normalized.targetColumn, type: columnType(normalized, normalized.targetColumn) };
  if (featureColumns.some((column) => column.type !== 'number')) {
    // Keep the context available for a typed unsupported result instead of
    // rejecting it as malformed input.
  }
  const context = {
    version: BUILD_AGENT_CONTRACT_VERSION,
    sourceKind: sourceKindOf(sourceKind),
    task: normalized.task,
    featureColumns,
    targetColumn: target,
    rowCount: normalized.rows.length,
    usableRowCount: profile.samples.length,
    classCount: normalized.task === 'classification' ? profile.classCount : null,
    hasUsableTestSplit: normalized.task === 'classification'
      ? profile.classificationSplitHasTest && profile.samples.length >= 3
      : profile.samples.length >= 3,
  };
  assertJsonSafe(context, 'BUILD_DATASET_CONTEXT_INVALID');
  return structuredClone(context);
}

/**
 * The only dataset shape allowed into a provider request. It is deliberately
 * smaller than the local context and has no row, label, or value payload.
 */
export function projectBuildDatasetContext(context) {
  rejectUnknownFields(context, [
    'version', 'sourceKind', 'task', 'featureColumns', 'targetColumn',
    'rowCount', 'usableRowCount', 'classCount', 'hasUsableTestSplit',
  ], 'BUILD_DATASET_CONTEXT_INVALID', 'datasetContext');
  if (context.version !== BUILD_AGENT_CONTRACT_VERSION) failBuildAgent('BUILD_CONTRACT_VERSION_UNSUPPORTED', 'Dataset context version is unsupported.');
  if (!Array.isArray(context.featureColumns) || context.featureColumns.length === 0) {
    failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'datasetContext.featureColumns must be non-empty.');
  }
  const featureColumns = context.featureColumns.map((column, index) => {
    rejectUnknownFields(column, ['name', 'type'], 'BUILD_DATASET_CONTEXT_INVALID', `datasetContext.featureColumns[${index}]`);
    if (column.type !== 'number') failBuildAgent('BUILD_DATASET_UNSUPPORTED', 'Build Agent A requires numeric feature columns.', { feature: column.name });
    return { name: boundedString(column.name, `featureColumns[${index}].name`, 96), type: 'number' };
  });
  rejectUnknownFields(context.targetColumn, ['name', 'type'], 'BUILD_DATASET_CONTEXT_INVALID', 'datasetContext.targetColumn');
  if (!['number', 'text'].includes(context.targetColumn.type)) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Target column type is invalid.');
  const projected = {
    version: BUILD_AGENT_CONTRACT_VERSION,
    sourceKind: sourceKindOf(context.sourceKind),
    task: context.task,
    featureColumns,
    targetColumn: {
      name: boundedString(context.targetColumn.name, 'targetColumn.name', 96),
      type: context.targetColumn.type,
    },
    rowCount: boundedInteger(context.rowCount, 'rowCount', { min: 0, max: 1_000_000 }),
    usableRowCount: boundedInteger(context.usableRowCount, 'usableRowCount', { min: 0, max: 1_000_000 }),
    classCount: context.classCount === null ? null : boundedInteger(context.classCount, 'classCount', { min: 0, max: 10_000 }),
    hasUsableTestSplit: context.hasUsableTestSplit === true,
  };
  assertJsonSafe(projected, 'BUILD_DATASET_CONTEXT_INVALID');
  return projected;
}

export function assertDatasetContext(value) {
  // Structural validation is intentionally separate from provider projection:
  // non-numeric columns are a typed unsupported outcome, not malformed input.
  rejectUnknownFields(value, [
    'version', 'sourceKind', 'task', 'featureColumns', 'targetColumn',
    'rowCount', 'usableRowCount', 'classCount', 'hasUsableTestSplit',
  ], 'BUILD_DATASET_CONTEXT_INVALID', 'datasetContext');
  if (value.version !== BUILD_AGENT_CONTRACT_VERSION) failBuildAgent('BUILD_CONTRACT_VERSION_UNSUPPORTED', 'Dataset context version is unsupported.');
  if (!['regression', 'classification'].includes(value.task)) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Dataset context task is invalid.');
  if (!Array.isArray(value.featureColumns) || value.featureColumns.length === 0) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'datasetContext.featureColumns must be non-empty.');
  const featureColumns = value.featureColumns.map((column, index) => {
    rejectUnknownFields(column, ['name', 'type'], 'BUILD_DATASET_CONTEXT_INVALID', `datasetContext.featureColumns[${index}]`);
    return { name: boundedString(column.name, `featureColumns[${index}].name`, 96), type: column.type };
  });
  rejectUnknownFields(value.targetColumn, ['name', 'type'], 'BUILD_DATASET_CONTEXT_INVALID', 'datasetContext.targetColumn');
  if (!['number', 'text'].includes(value.targetColumn.type)) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Target column type is invalid.');
  const context = {
    version: BUILD_AGENT_CONTRACT_VERSION,
    sourceKind: sourceKindOf(value.sourceKind),
    task: value.task,
    featureColumns,
    targetColumn: { name: boundedString(value.targetColumn.name, 'targetColumn.name', 96), type: value.targetColumn.type },
    rowCount: boundedInteger(value.rowCount, 'rowCount', { min: 0, max: 1_000_000 }),
    usableRowCount: boundedInteger(value.usableRowCount, 'usableRowCount', { min: 0, max: 1_000_000 }),
    classCount: value.classCount === null ? null : boundedInteger(value.classCount, 'classCount', { min: 0, max: 10_000 }),
    hasUsableTestSplit: value.hasUsableTestSplit === true,
  };
  assertJsonSafe(context, 'BUILD_DATASET_CONTEXT_INVALID');
  return context;
}

export function featureNames(context) {
  return boundedStringArray((context?.featureColumns ?? []).map((column) => column.name), 'featureColumns');
}
