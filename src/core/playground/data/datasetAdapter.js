import {
  DEFAULT_KNN_SEED,
  deterministicShuffle,
  fitFeatureNormalization,
  stratifiedSplit,
} from '../../knnMath.js';
import { buildProjectionVector } from '../../knnMath.js';

// Unified dataset context used by every model adapter and visualization
// script. All functions are pure and JSON-safe.

const finiteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// Normalizes a raw workspace/teaching dataset into { schema, rows, task,
// featureColumns, targetColumn, trainRatio }.
export function inspectDataset(dataset) {
  if (dataset === null || dataset === undefined) {
    return {
      schema: [],
      rows: [],
      task: null,
      featureColumns: [],
      targetColumn: null,
      trainRatio: 0.8,
    };
  }
  if (typeof dataset !== 'object') {
    throw Object.assign(new Error('INVALID_PLAYGROUND_SOURCE'), { code: 'INVALID_PLAYGROUND_SOURCE', details: { reason: 'dataset' } });
  }
  const featureColumns = Array.isArray(dataset.featureColumns)
    ? dataset.featureColumns.filter((column) => typeof column === 'string' && column)
    : [];
  const targetColumn = typeof dataset.targetColumn === 'string' ? dataset.targetColumn : null;
  const task = dataset.task === 'classification' ? 'classification' : 'regression';
  const rows = Array.isArray(dataset.rows)
    ? dataset.rows.filter((row) => row && typeof row === 'object')
    : [];
  return {
    schema: Array.isArray(dataset.columns) ? dataset.columns.map((column) => ({ ...column })) : [],
    rows,
    task,
    featureColumns,
    targetColumn,
    trainRatio: Number.isFinite(Number(dataset.trainRatio)) ? Number(dataset.trainRatio) : 0.8,
  };
}

// Builds the `$data` context for a session. `$data` must describe the dataset
// the model adapter actually uses: workspace sources keep the full workspace
// context, teaching/fallback sources are reconstructed from the normalized
// source points so rows/features/target always match the model.
export function buildDataState({ source, workspaceDataset }) {
  if (source?.usingDataset && workspaceDataset) {
    return inspectDataset(workspaceDataset);
  }
  if (source?.domain && source.domain !== 'tabular') {
    return {
      domain: source.domain,
      schema: [],
      rows: (source.samples ?? []).map((sample) => ({
        id: sample.id,
        label: sample.label,
        membership: sample.membership ?? sample.split,
        payload: sample.payload,
      })),
      task: source.task ?? null,
      featureColumns: [],
      targetColumn: null,
      trainRatio: source.trainRatio ?? null,
    };
  }
  const inferredClassification = source?.task === 'classification'
    || (!source?.task && Array.isArray(source?.featureColumns) && source.featureColumns.length >= 2 && !source?.target);
  if (inferredClassification && Array.isArray(source?.featureColumns) && source.featureColumns.length >= 2) {
    return {
      schema: [
        ...source.featureColumns.map((name) => ({ name, type: 'number', missing: 0 })),
        { name: 'label', type: 'string', missing: 0 },
      ],
      rows: source.points.map((point) => ({ ...point.features, label: point.label })),
      task: 'classification',
      featureColumns: [...source.featureColumns],
      targetColumn: 'label',
      trainRatio: source.trainRatio ?? 0.8,
    };
  }
  const feature = source?.feature ?? 'x';
  const target = source?.target ?? 'y';
  if (source?.task === 'regression' && Array.isArray(source?.featureColumns) && source.featureColumns.length) {
    const featureColumns = [...source.featureColumns];
    return {
      schema: [
        ...featureColumns.map((name) => ({ name, type: 'number', missing: 0 })),
        { name: target, type: 'number', missing: 0 },
      ],
      rows: (source?.points ?? []).map((point) => ({
        ...Object.fromEntries(featureColumns.map((name) => [name, point.features?.[name]])),
        [target]: point.features?.[target] ?? point.target ?? point.y,
      })),
      task: 'regression',
      featureColumns,
      targetColumn: target,
      trainRatio: source.trainRatio ?? null,
    };
  }
  return {
    schema: [
      { name: feature, type: 'number', missing: 0 },
      { name: target, type: 'number', missing: 0 },
    ],
    rows: (source?.points ?? []).map((point) => ({ [feature]: point.x, [target]: point.y })),
    task: 'regression',
    featureColumns: [feature],
    targetColumn: target,
    trainRatio: null,
  };
}

// Converts dataset rows into shared samples { id, x: [...], y } for
// classification; for regression the target is numeric.
export function rowsToSamples(dataset, featureColumns, targetColumn, task) {
  const samples = [];
  (dataset.rows ?? []).forEach((row, index) => {
    const rawFeatures = featureColumns.map((column) => row?.[column]);
    const rawTarget = row?.[targetColumn];
    if (rawFeatures.some((value) => finiteNumber(value) === null) || rawTarget === undefined || rawTarget === null) return;
    const y = task === 'classification' ? String(rawTarget) : finiteNumber(rawTarget);
    if (task !== 'classification' && y === null) return;
    if (task === 'classification' && !y) return;
    samples.push({
      id: index,
      x: rawFeatures.map((value) => finiteNumber(value)),
      y,
    });
  });
  return samples;
}

// Deterministic train/test split shared by the dataset layer. Classification
// uses the shared stratified split (same seed semantics as fitKnn); regression
// uses a plain deterministic shuffle.
export function createSplit({ samples, trainRatio, seed = DEFAULT_KNN_SEED }) {
  if (samples.some((sample) => typeof sample.y === 'string')) {
    return stratifiedSplit(samples, trainRatio, seed);
  }
  const shuffled = deterministicShuffle(samples, seed);
  const splitIndex = Math.max(1, Math.min(
    shuffled.length - 1,
    Math.floor(shuffled.length * trainRatio),
  ));
  return {
    train: shuffled.slice(0, splitIndex),
    test: shuffled.slice(splitIndex),
  };
}

// Per-feature means/stds over samples { x: [...] }.
export function featureStats(samples, featureColumns) {
  return fitFeatureNormalization(samples, featureColumns.length);
}

// Projects a 2D slice into a full feature vector: x/y features come from the
// query and hidden features are fixed at the training mean by default.
export function buildSlice({
  xFeature,
  yFeature,
  x,
  y,
  featureColumns,
  normalization,
  fixedFeatureStrategy = 'mean',
}) {
  const fixedValues = fixedFeatureStrategy === 'mean'
    ? Object.fromEntries(featureColumns.map((feature, index) => [feature, normalization.means[index]]))
    : undefined;
  return buildProjectionVector({
    xFeature,
    yFeature,
    x,
    y,
    featureColumns,
    normalization,
    fixedValues,
  });
}

// Uniformly samples at most `limit` rows while preserving order.
export function sampleRows(rows, limit = 80) {
  if (rows.length <= limit) return [...rows];
  return Array.from({ length: limit }, (_, index) => (
    rows[Math.round(index * (rows.length - 1) / (limit - 1))]
  ));
}
