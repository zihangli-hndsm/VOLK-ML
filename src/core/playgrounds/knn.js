import {
  buildProjectionVector,
  computeTestAccuracy,
  DEFAULT_KNN_SEED,
  fitKnn,
  predictKnn,
  rankNeighbors,
  refitKnnFromSplit,
  voteNeighbors,
} from '../knnMath.js';
import { playgroundError } from './session.js';

const DECISION_RESOLUTION = 48;
const DECISION_SAMPLE_LIMIT = 200;
const MAX_K = 20;

const finiteOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

function projectedRanges(points, xFeature, yFeature) {
  const xs = points.map((point) => point.features[xFeature]);
  const ys = points.map((point) => point.features[yFeature]);
  const xSpan = Math.max(1, Math.max(...xs) - Math.min(...xs));
  const ySpan = Math.max(1, Math.max(...ys) - Math.min(...ys));
  return {
    xMin: Math.min(...xs) - xSpan * 0.08,
    xMax: Math.max(...xs) + xSpan * 0.08,
    yMin: Math.min(...ys) - ySpan * 0.08,
    yMax: Math.max(...ys) + ySpan * 0.08,
  };
}

// Decision regions for the current 2D slice: each grid cell becomes a full
// feature vector with hidden features fixed at the training mean (z-score 0 in
// normalized view) and is predicted with the same shared KNN model used by the
// runtime and the query/neighbor path.
function computeDecisionRegions(modelState, fit, controls) {
  const { featureColumns, xFeature, yFeature, rawTrain } = modelState;
  const useNormalized = controls.normalize;
  const model = {
    type: 'knn_classifier',
    train: fit.normalizedTrain,
    normalization: fit.normalization,
    k: fit.k,
  };
  const xi = featureColumns.indexOf(xFeature);
  const yi = featureColumns.indexOf(yFeature);
  const viewPoints = rawTrain.map((point) => ({
    id: point.id,
    x: useNormalized
      ? (point.features[xFeature] - fit.normalization.means[xi]) / fit.normalization.stds[xi]
      : point.features[xFeature],
    y: useNormalized
      ? (point.features[yFeature] - fit.normalization.means[yi]) / fit.normalization.stds[yi]
      : point.features[yFeature],
  }));
  const sampled = viewPoints.length <= DECISION_SAMPLE_LIMIT
    ? viewPoints
    : Array.from({ length: DECISION_SAMPLE_LIMIT }, (_, index) => (
      viewPoints[Math.round(index * (viewPoints.length - 1) / (DECISION_SAMPLE_LIMIT - 1))]
    ));
  const xs = sampled.map((sample) => sample.x);
  const ys = sampled.map((sample) => sample.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xPad = Math.max(0.01, (xMax - xMin) * 0.1);
  const yPad = Math.max(0.01, (yMax - yMin) * 0.1);
  const cells = [];
  for (let row = 0; row < DECISION_RESOLUTION; row += 1) {
    for (let column = 0; column < DECISION_RESOLUTION; column += 1) {
      const x = xMin - xPad + ((xMax - xMin + xPad * 2) * (column + 0.5)) / DECISION_RESOLUTION;
      const y = yMin - yPad + ((yMax - yMin + yPad * 2) * (row + 0.5)) / DECISION_RESOLUTION;
      const vector = featureColumns.map((feature, index) => {
        if (feature === xFeature) return x;
        if (feature === yFeature) return y;
        return useNormalized ? 0 : fit.normalization.means[index];
      });
      const label = useNormalized
        ? voteNeighbors(rankNeighbors(fit.normalizedTrain, vector, fit.k)).predictedLabel
        : predictKnn(model, vector);
      cells.push({ x, y, label });
    }
  }
  return cells;
}

// Accuracy of the current view (slice + normalization mode) evaluated on the
// unchanged test set. With two visible features and normalization on, this
// equals the runtime accuracy; otherwise it is an explicit what-if accuracy.
function computeViewAccuracy(modelState, fit, controls) {
  const { featureColumns, xFeature, yFeature, test } = modelState;
  if (!Array.isArray(test) || !test.length) return null;
  const useNormalized = controls.normalize;
  const model = {
    type: 'knn_classifier',
    train: fit.normalizedTrain,
    normalization: fit.normalization,
    k: fit.k,
  };
  const xi = featureColumns.indexOf(xFeature);
  const yi = featureColumns.indexOf(yFeature);
  let correct = 0;
  test.forEach((sample) => {
    const vector = featureColumns.map((feature, index) => {
      if (feature === xFeature) {
        return useNormalized
          ? (sample.features[xFeature] - fit.normalization.means[xi]) / fit.normalization.stds[xi]
          : sample.features[xFeature];
      }
      if (feature === yFeature) {
        return useNormalized
          ? (sample.features[yFeature] - fit.normalization.means[yi]) / fit.normalization.stds[yi]
          : sample.features[yFeature];
      }
      return useNormalized ? 0 : fit.normalization.means[index];
    });
    const predicted = useNormalized
      ? voteNeighbors(rankNeighbors(fit.normalizedTrain, vector, fit.k)).predictedLabel
      : predictKnn(model, vector);
    if (predicted === sample.label) correct += 1;
  });
  return correct / test.length;
}

// Full query vector for the current 2D slice. Hidden features are fixed at the
// training mean (z-score 0 in normalized view).
function viewQueryVector(modelState, fit, controls) {
  const { featureColumns, xFeature, yFeature, query } = modelState;
  const useNormalized = controls.normalize;
  const xi = featureColumns.indexOf(xFeature);
  const yi = featureColumns.indexOf(yFeature);
  return buildProjectionVector({
    xFeature,
    yFeature,
    x: useNormalized
      ? (query.x - fit.normalization.means[xi]) / fit.normalization.stds[xi]
      : query.x,
    y: useNormalized
      ? (query.y - fit.normalization.means[yi]) / fit.normalization.stds[yi]
      : query.y,
    featureColumns,
    normalization: fit.normalization,
    fixedValues: useNormalized
      ? Object.fromEntries(featureColumns.map((feature) => [feature, 0]))
      : Object.fromEntries(featureColumns.map((feature, index) => [feature, fit.normalization.means[index]])),
  });
}

function nextSession(session, patch) {
  return {
    ...session,
    controls: { ...session.controls, ...(patch.controls ?? {}) },
    modelState: { ...session.modelState, ...(patch.modelState ?? {}) },
    timeline: { ...session.timeline, ...(patch.timeline ?? {}) },
  };
}

function refreshProjection(modelState, controls) {
  const ranges = projectedRanges(modelState.points, modelState.xFeature, modelState.yFeature);
  const decisionRegions = controls.showDecisionRegions
    ? computeDecisionRegions(modelState, modelState.fit, controls)
    : null;
  return { ...modelState, ranges, decisionRegions };
}

function nextPointId(points, counter) {
  let id = `p-${counter}`;
  let next = counter;
  while (points.some((point) => point.id === id)) {
    next += 1;
    id = `p-${next}`;
  }
  return { id, counter: next + 1 };
}

export const knnPlayground = {
  id: 'knn-classification',
  version: 1,
  titleKey: 'playground.knn.title',
  descriptionKey: 'playground.knn.description',
  supportedOps: ['knn_classifier'],
  supportedTasks: ['classification'],
  sourceKinds: ['example', 'workspace-dataset'],

  controls: [
    { key: 'xFeature', type: 'select' },
    { key: 'yFeature', type: 'select' },
    { key: 'k', type: 'number', min: 1, max: MAX_K, step: 1 },
    { key: 'queryX', type: 'number' },
    { key: 'queryY', type: 'number' },
    { key: 'showNeighborOrder', type: 'boolean' },
    { key: 'showDecisionRegions', type: 'boolean' },
    { key: 'normalize', type: 'boolean' },
    { key: 'distanceMetric', type: 'select', options: ['euclidean'] },
  ],

  actions: [
    'SET_CONTROL',
    'SET_QUERY_POINT',
    'MOVE_QUERY_POINT',
    'ADD_TRAINING_POINT',
    'MOVE_TRAINING_POINT',
    'REMOVE_TRAINING_POINT',
    'STEP_NEIGHBOR_REVEAL',
    'START_NEIGHBOR_REVEAL',
    'STEP',
    'SEEK',
    'RESET',
    'RUN_SCENARIO',
  ],

  scenarios: [
    {
      id: 'intro',
      titleKey: 'playground.scenario.intro',
      steps: [
        { action: { type: 'SET_CONTROL', key: 'showNeighborOrder', value: true }, durationMs: 500, narrationKey: 'playground.knn.scenario.introOrder' },
        { action: { type: 'SET_CONTROL', key: 'k', value: 1 }, durationMs: 500, narrationKey: 'playground.knn.scenario.introK1' },
        { action: { type: 'START_NEIGHBOR_REVEAL' }, durationMs: 400, narrationKey: 'playground.knn.scenario.introReveal' },
        { action: { type: 'STEP' }, durationMs: 700, narrationKey: 'playground.knn.scenario.introNeighbor1' },
        { action: { type: 'SET_CONTROL', key: 'k', value: 5 }, durationMs: 600, narrationKey: 'playground.knn.scenario.introK5' },
        { action: { type: 'SET_CONTROL', key: 'showDecisionRegions', value: true }, durationMs: 600, narrationKey: 'playground.knn.scenario.introRegions' },
        { action: { type: 'STEP' }, durationMs: 600, narrationKey: 'playground.knn.scenario.introNeighbor2' },
        { action: { type: 'STEP' }, durationMs: 600, narrationKey: 'playground.knn.scenario.introNeighbor3' },
        { action: { type: 'STEP' }, durationMs: 600, narrationKey: 'playground.knn.scenario.introNeighbor4' },
        { action: { type: 'STEP' }, durationMs: 700, narrationKey: 'playground.knn.scenario.introVote' },
        { action: { type: 'MOVE_QUERY_POINT', x: null, y: null }, durationMs: 800, narrationKey: 'playground.knn.scenario.introBoundary' },
      ],
    },
  ],

  validateSource(source) {
    if (!source || typeof source !== 'object') throw playgroundError('INVALID_PLAYGROUND_SOURCE');
    if (!['example', 'workspace-dataset'].includes(source.kind)) throw playgroundError('INVALID_PLAYGROUND_SOURCE', { kind: source.kind });
    const featureColumns = Array.isArray(source.featureColumns) && source.featureColumns.length >= 2
      ? source.featureColumns
      : null;
    if (!featureColumns) throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'needs at least two numeric features' });
    const points = Array.isArray(source.points)
      ? source.points.map((point, index) => ({
        id: point.id ?? index,
        features: Object.fromEntries(featureColumns.map((column) => [
          column,
          finiteOrNull(point.features?.[column] ?? point[column]),
        ])),
        label: point.label,
      })).filter((point) => featureColumns.every((column) => point.features[column] !== null) && typeof point.label === 'string' && point.label)
      : [];
    if (points.length < 2) throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'needs at least two labeled points' });
    const rawTrainRatio = Number(source.trainRatio);
    const trainRatio = Number.isFinite(rawTrainRatio) && rawTrainRatio > 0 && rawTrainRatio < 1
      ? rawTrainRatio
      : 0.8;
    return {
      kind: source.kind,
      name: source.name ?? 'Example data',
      fingerprint: source.fingerprint ?? `${points.length}:${featureColumns.join(',')}`,
      points,
      featureColumns,
      trainRatio,
      total: source.total ?? points.length,
      usingDataset: source.usingDataset ?? false,
    };
  },

  createInitialState({ source, controls, seed }) {
    const points = source.points.map((point) => ({
      id: point.id,
      features: { ...point.features },
      label: point.label,
    }));
    const xFeature = source.featureColumns[0];
    const yFeature = source.featureColumns[1];
    const ranges = projectedRanges(points, xFeature, yFeature);
    const merged = {
      xFeature,
      yFeature,
      k: 5,
      queryX: (ranges.xMin + ranges.xMax) / 2,
      queryY: (ranges.yMin + ranges.yMax) / 2,
      showNeighborOrder: false,
      showDecisionRegions: false,
      normalize: true,
      distanceMetric: 'euclidean',
      ...controls,
    };
    const samples = points.map((point) => ({
      id: point.id,
      x: source.featureColumns.map((column) => point.features[column]),
      y: point.label,
    }));
    const fitted = fitKnn({
      samples,
      k: merged.k,
      trainRatio: source.trainRatio,
      seed: seed ?? DEFAULT_KNN_SEED,
    });
    const toPoints = (trainSamples) => trainSamples.map((sample) => ({
      id: sample.id,
      features: Object.fromEntries(source.featureColumns.map((column, index) => [column, sample.x[index]])),
      label: sample.y,
    }));
    const train = toPoints(fitted.rawTrain);
    const test = toPoints(fitted.test);
    const fit = {
      normalizedTrain: fitted.train,
      normalization: fitted.normalization,
      k: fitted.k,
      trainRows: fitted.trainRows,
      testRows: fitted.testRows,
      testAccuracy: computeTestAccuracy(
        {
          normalizedTrain: fitted.train,
          normalization: fitted.normalization,
          k: fitted.k,
        },
        fitted.test,
        source.featureColumns,
      ),
    };
    const state = {
      points,
      rawTrain: train,
      test,
      fit,
      featureColumns: source.featureColumns,
      xFeature: merged.xFeature,
      yFeature: merged.yFeature,
      ranges,
      query: { x: finiteOrNull(merged.queryX) ?? (ranges.xMin + ranges.xMax) / 2, y: finiteOrNull(merged.queryY) ?? (ranges.yMin + ranges.yMax) / 2 },
      revealed: 0,
      decisionRegions: null,
      pointCounter: 0,
    };
    return {
      controls: {
        xFeature: merged.xFeature,
        yFeature: merged.yFeature,
        k: fit.k,
        queryX: state.query.x,
        queryY: state.query.y,
        showNeighborOrder: Boolean(merged.showNeighborOrder),
        showDecisionRegions: Boolean(merged.showDecisionRegions),
        normalize: merged.normalize !== false,
        distanceMetric: merged.distanceMetric === 'euclidean' ? 'euclidean' : 'euclidean',
      },
      modelState: refreshProjection(state, { ...merged, k: fit.k }),
      totalSteps: fit.k,
    };
  },

  reduce(session, action) {
    const { modelState, controls } = session;
    if (action.type === 'SET_CONTROL') {
      if (action.key === 'xFeature' || action.key === 'yFeature') {
        const nextFeature = action.value;
        if (nextFeature === modelState.xFeature || nextFeature === modelState.yFeature) return session;
        const next = { ...modelState, [action.key]: nextFeature };
        if (next.xFeature === next.yFeature) {
          next.yFeature = nextFeature === next.xFeature
            ? modelState.featureColumns?.find((column) => column !== nextFeature) ?? nextFeature
            : next.yFeature;
        }
        const ranges = projectedRanges(next.points, next.xFeature, next.yFeature);
        const query = { x: (ranges.xMin + ranges.xMax) / 2, y: (ranges.yMin + ranges.yMax) / 2 };
        return nextSession(session, {
          controls: { xFeature: next.xFeature, yFeature: next.yFeature, queryX: query.x, queryY: query.y },
          modelState: refreshProjection({ ...next, query, revealed: 0, ranges }, controls),
        });
      }
      if (action.key === 'k') {
        const k = Math.max(1, Math.min(
          Math.round(finiteOrNull(action.value) ?? controls.k),
          Math.max(1, Math.min(MAX_K, modelState.fit.trainRows)),
        ));
        const fit = { ...modelState.fit, k };
        fit.testAccuracy = computeTestAccuracy(fit, modelState.test, modelState.featureColumns);
        return nextSession(session, {
          controls: { k },
          modelState: refreshProjection(
            { ...modelState, fit, revealed: Math.min(modelState.revealed, k) },
            { ...controls, k },
          ),
          timeline: { ...session.timeline, step: Math.min(session.timeline.step, k), totalSteps: k },
        });
      }
      if (action.key === 'queryX' || action.key === 'queryY') {
        const value = finiteOrNull(action.value);
        if (value === null) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
        const query = { ...modelState.query, [action.key === 'queryX' ? 'x' : 'y']: value };
        return nextSession(session, { controls: { [action.key]: value }, modelState: { ...modelState, query } });
      }
      if (action.key === 'showNeighborOrder' || action.key === 'showDecisionRegions' || action.key === 'normalize') {
        const value = Boolean(action.value);
        return nextSession(session, {
          controls: { [action.key]: value },
          modelState: refreshProjection(modelState, { ...controls, [action.key]: value }),
        });
      }
      if (action.key === 'distanceMetric') {
        if (action.value !== 'euclidean') throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key, value: action.value });
        return nextSession(session, { controls: { distanceMetric: 'euclidean' } });
      }
      throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
    }
    if (action.type === 'SET_QUERY_POINT' || action.type === 'MOVE_QUERY_POINT') {
      const x = action.x === null ? modelState.ranges.xMax : finiteOrNull(action.x);
      const y = action.y === null ? (modelState.ranges.yMin + modelState.ranges.yMax) / 2 : finiteOrNull(action.y);
      if (x === null || y === null) throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type });
      const query = { x, y };
      return nextSession(session, { controls: { queryX: x, queryY: y }, modelState: { ...modelState, query } });
    }
    if (action.type === 'ADD_TRAINING_POINT') {
      const x = finiteOrNull(action.x);
      const y = finiteOrNull(action.y);
      if (x === null || y === null || typeof action.label !== 'string' || !action.label) {
        throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type });
      }
      const hiddenMeans = Object.fromEntries(modelState.featureColumns.map((feature, index) => [
        feature,
        modelState.fit.normalization.means[index],
      ]));
      const { id, counter } = nextPointId(modelState.points, modelState.pointCounter);
      const point = {
        id,
        features: { ...hiddenMeans, [modelState.xFeature]: x, [modelState.yFeature]: y },
        label: action.label,
      };
      const rawTrain = [...modelState.rawTrain, point];
      const points = [...modelState.points, point];
      const ranges = projectedRanges(points, modelState.xFeature, modelState.yFeature);
      const fit = refitKnnFromSplit({
        rawTrain,
        test: modelState.test,
        k: controls.k,
        featureColumns: modelState.featureColumns,
      });
      return nextSession(session, {
        controls: { k: fit.k },
        modelState: refreshProjection(
          { ...modelState, rawTrain, points, ranges, fit, pointCounter: counter },
          { ...controls, k: fit.k },
        ),
      });
    }
    if (action.type === 'MOVE_TRAINING_POINT' || action.type === 'REMOVE_TRAINING_POINT') {
      const editingTrain = modelState.rawTrain.some((point) => point.id === action.pointId);
      if (!editingTrain) return session;
      let rawTrain;
      let points;
      if (action.type === 'REMOVE_TRAINING_POINT') {
        rawTrain = modelState.rawTrain.filter((point) => point.id !== action.pointId);
        if (rawTrain.length < 1) throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type, reason: 'minimum one training point' });
        points = modelState.points.filter((point) => point.id !== action.pointId);
      } else {
        const x = finiteOrNull(action.x);
        const y = finiteOrNull(action.y);
        if (x === null || y === null) throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type });
        rawTrain = modelState.rawTrain.map((point) => (point.id === action.pointId
          ? { ...point, features: { ...point.features, [modelState.xFeature]: x, [modelState.yFeature]: y } }
          : point));
        points = modelState.points.map((point) => (point.id === action.pointId
          ? { ...point, features: { ...point.features, [modelState.xFeature]: x, [modelState.yFeature]: y } }
          : point));
      }
      const ranges = projectedRanges(points, modelState.xFeature, modelState.yFeature);
      const fit = refitKnnFromSplit({
        rawTrain,
        test: modelState.test,
        k: controls.k,
        featureColumns: modelState.featureColumns,
      });
      return nextSession(session, {
        controls: { k: fit.k },
        modelState: refreshProjection(
          { ...modelState, rawTrain, points, ranges, fit },
          { ...controls, k: fit.k },
        ),
      });
    }
    if (action.type === 'START_NEIGHBOR_REVEAL') {
      return nextSession(session, {
        modelState: { ...modelState, revealed: 0 },
        timeline: { ...session.timeline, step: 0, totalSteps: modelState.fit.k },
      });
    }
    if (action.type === 'STEP' || action.type === 'SEEK' || action.type === 'STEP_NEIGHBOR_REVEAL') {
      const target = action.type === 'SEEK' ? Math.round(action.step ?? 0) : modelState.revealed + 1;
      const revealed = Math.max(0, Math.min(target, modelState.fit.k));
      return nextSession(session, {
        modelState: { ...modelState, revealed },
        timeline: { ...session.timeline, step: revealed },
      });
    }
    return session;
  },

  deriveScene(session) {
    const { modelState, controls, timeline } = session;
    const { fit, featureColumns, xFeature, yFeature } = modelState;
    const xi = featureColumns.indexOf(xFeature);
    const yi = featureColumns.indexOf(yFeature);
    const useNormalized = Boolean(controls.normalize);
    const queryVector = viewQueryVector(modelState, fit, controls);
    const viewTraining = useNormalized
      ? fit.normalizedTrain
      : modelState.rawTrain.map((point) => ({
        id: point.id,
        x: featureColumns.map((column) => point.features[column]),
        y: point.label,
      }));
    const neighbors = rankNeighbors(viewTraining, queryVector, fit.k);
    const activeNeighbors = neighbors.slice(0, modelState.revealed);
    const voting = modelState.revealed > 0 ? voteNeighbors(activeNeighbors) : {
      counts: {},
      distanceSums: {},
      predictedLabel: null,
      tie: false,
      tieBreakReason: null,
    };
    const trainIds = new Set(modelState.rawTrain.map((point) => point.id));
    const hiddenFeatures = featureColumns.filter((feature) => feature !== xFeature && feature !== yFeature);
    const viewAccuracy = computeViewAccuracy(modelState, fit, controls);
    const scene = {
      points: modelState.points.map((point) => {
        const raw = [point.features[xFeature], point.features[yFeature]];
        const normalized = [
          (raw[0] - fit.normalization.means[xi]) / fit.normalization.stds[xi],
          (raw[1] - fit.normalization.means[yi]) / fit.normalization.stds[yi],
        ];
        return {
          id: point.id,
          x: raw[0],
          y: raw[1],
          label: point.label,
          normalizedX: normalized[0],
          normalizedY: normalized[1],
          subset: trainIds.has(point.id) ? 'train' : 'test',
        };
      }),
      query: {
        x: modelState.query.x,
        y: modelState.query.y,
        normalizedX: queryVector[xi],
        normalizedY: queryVector[yi],
        vector: queryVector,
      },
      neighbors: neighbors.map((neighbor, index) => ({
        pointId: neighbor.pointId,
        rank: index + 1,
        distance: neighbor.distance,
        label: neighbor.label,
        selected: index < modelState.revealed,
      })),
      voting,
      decisionRegions: {
        enabled: Boolean(controls.showDecisionRegions),
        resolution: DECISION_RESOLUTION,
        cells: modelState.decisionRegions ?? [],
      },
      ranges: modelState.ranges,
      featureOptions: featureColumns,
      normalize: useNormalized,
      normalization: {
        xMean: fit.normalization.means[xi],
        xStd: fit.normalization.stds[xi],
        yMean: fit.normalization.means[yi],
        yStd: fit.normalization.stds[yi],
      },
      projection: {
        enabled: hiddenFeatures.length > 0,
        xFeature,
        yFeature,
        fixedFeatures: Object.fromEntries(hiddenFeatures.map((feature) => [
          feature,
          fit.normalization.means[featureColumns.indexOf(feature)],
        ])),
      },
    };
    let observation = {
      titleKey: 'playground.knn.observation.intro',
      bodyKey: 'playground.knn.observation.introBody',
      params: { trainRows: fit.trainRows, testRows: fit.testRows },
    };
    if (!useNormalized && modelState.revealed === 0) {
      observation = {
        titleKey: 'playground.knn.observation.noNormalize',
        bodyKey: 'playground.knn.observation.noNormalizeBody',
        params: {},
      };
    } else if (modelState.revealed > 0 && modelState.revealed < fit.k) {
      const neighbor = neighbors[modelState.revealed - 1];
      observation = {
        titleKey: 'playground.knn.observation.neighbor',
        bodyKey: 'playground.knn.observation.neighborBody',
        params: { rank: modelState.revealed, label: neighbor.label, distance: Math.sqrt(neighbor.distance).toFixed(3) },
      };
    } else if (modelState.revealed >= fit.k) {
      observation = {
        titleKey: voting.tie ? 'playground.knn.observation.tie' : 'playground.knn.observation.prediction',
        bodyKey: voting.tie ? 'playground.knn.observation.tieBody' : 'playground.knn.observation.predictionBody',
        params: { label: voting.predictedLabel, k: fit.k, reason: voting.tieBreakReason ?? '' },
      };
    }
    const metrics = {
      revealed: modelState.revealed,
      k: fit.k,
      predictedLabel: voting.predictedLabel,
      trainingPoints: fit.trainRows,
      testRows: fit.testRows,
    };
    if (modelState.test.length) {
      metrics.runtimeAccuracy = fit.testAccuracy;
      metrics.currentViewAccuracy = viewAccuracy;
    }
    return {
      scene,
      metrics,
      observation,
      formula: {
        key: 'playground.formula.knn',
        params: {
          k: fit.k,
          nearest: neighbors.length ? Math.sqrt(neighbors[0].distance).toFixed(3) : '—',
        },
        highlight: null,
      },
      capabilities: {
        canPlay: true,
        canPause: session.status === 'playing',
        canStep: fit.k > 0,
        canSeek: fit.k > 0,
        canReset: true,
        canEditData: true,
      },
    };
  },
};
