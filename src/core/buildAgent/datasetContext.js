import { isBrowserMissingValue, profileBrowserDataset } from '../browserExecutionContract.js';
import { validateAgentDataset } from '../canvasAgent.js';
import {
  BUILD_AGENT_CONTRACT_VERSION,
  assertBuildIdentity,
  assertJsonSafe,
  boundedInteger,
  boundedString,
  boundedStringArray,
  failBuildAgent,
  rejectUnknownFields,
  stableBuildIdentity,
} from './contracts.js';

const DATASET_SOURCE_KINDS = new Set(['workspace-dataset', 'teaching-dataset', 'none']);
const MISSING_SEMANTIC_CELL = Object.freeze({ kind: 'missing' });

function columnType(dataset, name) {
  const values = dataset.rows.map((row) => row?.[name]).filter((value) => !isBrowserMissingValue(value));
  return values.length && values.every((value) => Number.isFinite(Number(value))) ? 'number' : 'text';
}

function semanticCell(value) {
  // Match the browser runtime: absent, null, and blank cells all mean that
  // this row cannot contribute that field to a fitted sample.
  return isBrowserMissingValue(value) ? MISSING_SEMANTIC_CELL : value;
}

function sourceKindOf(value) {
  const sourceKind = value ?? 'workspace-dataset';
  if (!DATASET_SOURCE_KINDS.has(sourceKind)) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Unsupported dataset source kind.', { sourceKind });
  return sourceKind;
}

function datasetSemanticState(dataset) {
  const featureColumns = dataset.featureColumns.map((name) => ({ name, type: columnType(dataset, name) }));
  const targetColumn = { name: dataset.targetColumn, type: columnType(dataset, dataset.targetColumn) };
  return {
    task: dataset.task,
    featureColumns,
    targetColumn,
    rowData: dataset.rows.map((row) => [
      ...dataset.featureColumns.map((name) => semanticCell(row?.[name])),
      semanticCell(row?.[dataset.targetColumn]),
    ]),
  };
}

function fingerprintNormalizedDataset(dataset) {
  return stableBuildIdentity(datasetSemanticState(dataset), 'dataset');
}

/** Compute identity from the local normalized data used by the existing runtime. */
export function fingerprintBuildDataset(dataset) {
  if (!dataset || typeof dataset !== 'object') failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'A local dataset is required.');
  let normalized;
  try {
    normalized = validateAgentDataset(dataset);
  } catch (error) {
    failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Dataset cannot be fingerprinted.', { cause: error?.code ?? 'INVALID_DATASET' });
  }
  return fingerprintNormalizedDataset(normalized);
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
    failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Dataset cannot be used by Build Agent A.', {
      cause: error?.code ?? 'INVALID_DATASET',
    });
  }
  // Planning counts are target-valid counts. Actual selected-feature usability
  // is checked against the local dataset by proposal preflight.
  const profile = profileBrowserDataset({ ...normalized, featureColumns: [] });
  const featureColumns = normalized.featureColumns.map((name) => ({ name, type: columnType(normalized, name) }));
  const target = { name: normalized.targetColumn, type: columnType(normalized, normalized.targetColumn) };
  const context = {
    version: BUILD_AGENT_CONTRACT_VERSION,
    sourceKind: sourceKindOf(sourceKind),
    datasetFingerprint: fingerprintNormalizedDataset(normalized),
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
    'version', 'sourceKind', 'datasetFingerprint', 'task', 'featureColumns', 'targetColumn',
    'rowCount', 'usableRowCount', 'classCount', 'hasUsableTestSplit',
  ], 'BUILD_DATASET_CONTEXT_INVALID', 'datasetContext');
  if (context.version !== BUILD_AGENT_CONTRACT_VERSION) failBuildAgent('BUILD_CONTRACT_VERSION_UNSUPPORTED', 'Dataset context version is unsupported.');
  assertBuildIdentity(context.datasetFingerprint, 'dataset', 'datasetContext.datasetFingerprint');
  if (!['regression', 'classification'].includes(context.task)) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Dataset context task is invalid.');
  if (typeof context.hasUsableTestSplit !== 'boolean') failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'hasUsableTestSplit must be boolean.');
  if (!Array.isArray(context.featureColumns) || context.featureColumns.length === 0) {
    failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'datasetContext.featureColumns must be non-empty.');
  }
  const featureColumns = context.featureColumns.map((column, index) => {
    rejectUnknownFields(column, ['name', 'type'], 'BUILD_DATASET_CONTEXT_INVALID', `datasetContext.featureColumns[${index}]`);
    if (!['number', 'text'].includes(column.type)) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Feature column type is invalid.', { feature: column.name });
    return { name: boundedString(column.name, `featureColumns[${index}].name`, 96), type: column.type };
  });
  boundedStringArray(featureColumns.map((column) => column.name), 'featureColumns', { max: 64 });
  rejectUnknownFields(context.targetColumn, ['name', 'type'], 'BUILD_DATASET_CONTEXT_INVALID', 'datasetContext.targetColumn');
  if (!['number', 'text'].includes(context.targetColumn.type)) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Target column type is invalid.');
  const targetName = boundedString(context.targetColumn.name, 'targetColumn.name', 96);
  if (featureColumns.some((column) => column.name === targetName)) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Target column cannot also be a feature.');
  const projected = {
    version: BUILD_AGENT_CONTRACT_VERSION,
    sourceKind: sourceKindOf(context.sourceKind),
    task: context.task,
    featureColumns,
    targetColumn: {
      name: targetName,
      type: context.targetColumn.type,
    },
    rowCount: boundedInteger(context.rowCount, 'rowCount', { min: 0, max: 1_000_000 }),
    usableRowCount: boundedInteger(context.usableRowCount, 'usableRowCount', { min: 0, max: 1_000_000 }),
    classCount: context.classCount === null ? null : boundedInteger(context.classCount, 'classCount', { min: 0, max: 10_000 }),
    hasUsableTestSplit: context.hasUsableTestSplit,
  };
  if (projected.usableRowCount > projected.rowCount) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'usableRowCount cannot exceed rowCount.');
  if ((projected.task === 'classification') !== (projected.classCount !== null)) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'classCount must match task semantics.');
  if (projected.task === 'classification' && projected.classCount < 2) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Classification requires at least two classes.');
  assertJsonSafe(projected, 'BUILD_DATASET_CONTEXT_INVALID');
  return projected;
}

export function assertDatasetContext(value) {
  // Structural validation is intentionally separate from provider projection:
  // non-numeric columns are a typed unsupported outcome, not malformed input.
  rejectUnknownFields(value, [
    'version', 'sourceKind', 'datasetFingerprint', 'task', 'featureColumns', 'targetColumn',
    'rowCount', 'usableRowCount', 'classCount', 'hasUsableTestSplit',
  ], 'BUILD_DATASET_CONTEXT_INVALID', 'datasetContext');
  if (value.version !== BUILD_AGENT_CONTRACT_VERSION) failBuildAgent('BUILD_CONTRACT_VERSION_UNSUPPORTED', 'Dataset context version is unsupported.');
  assertBuildIdentity(value.datasetFingerprint, 'dataset', 'datasetContext.datasetFingerprint');
  if (!['regression', 'classification'].includes(value.task)) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Dataset context task is invalid.');
  if (!Array.isArray(value.featureColumns) || value.featureColumns.length === 0) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'datasetContext.featureColumns must be non-empty.');
  const featureColumns = value.featureColumns.map((column, index) => {
    rejectUnknownFields(column, ['name', 'type'], 'BUILD_DATASET_CONTEXT_INVALID', `datasetContext.featureColumns[${index}]`);
    if (!['number', 'text'].includes(column.type)) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Feature column type is invalid.');
    return { name: boundedString(column.name, `featureColumns[${index}].name`, 96), type: column.type };
  });
  boundedStringArray(featureColumns.map((column) => column.name), 'featureColumns', { max: 64 });
  rejectUnknownFields(value.targetColumn, ['name', 'type'], 'BUILD_DATASET_CONTEXT_INVALID', 'datasetContext.targetColumn');
  if (!['number', 'text'].includes(value.targetColumn.type)) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Target column type is invalid.');
  const targetName = boundedString(value.targetColumn.name, 'targetColumn.name', 96);
  if (featureColumns.some((column) => column.name === targetName)) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Target column cannot also be a feature.');
  if (typeof value.hasUsableTestSplit !== 'boolean') failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'hasUsableTestSplit must be boolean.');
  const context = {
    version: BUILD_AGENT_CONTRACT_VERSION,
    sourceKind: sourceKindOf(value.sourceKind),
    datasetFingerprint: value.datasetFingerprint,
    task: value.task,
    featureColumns,
    targetColumn: { name: targetName, type: value.targetColumn.type },
    rowCount: boundedInteger(value.rowCount, 'rowCount', { min: 0, max: 1_000_000 }),
    usableRowCount: boundedInteger(value.usableRowCount, 'usableRowCount', { min: 0, max: 1_000_000 }),
    classCount: value.classCount === null ? null : boundedInteger(value.classCount, 'classCount', { min: 0, max: 10_000 }),
    hasUsableTestSplit: value.hasUsableTestSplit,
  };
  if (context.usableRowCount > context.rowCount) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'usableRowCount cannot exceed rowCount.');
  if ((context.task === 'classification') !== (context.classCount !== null)) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'classCount must match task semantics.');
  if (context.task === 'classification' && context.classCount < 2) failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Classification requires at least two classes.');
  assertJsonSafe(context, 'BUILD_DATASET_CONTEXT_INVALID');
  return context;
}

export function featureNames(context) {
  return boundedStringArray((context?.featureColumns ?? []).map((column) => column.name), 'featureColumns');
}
