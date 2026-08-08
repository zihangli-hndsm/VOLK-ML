import {
  buildProjectionVector,
  computeTestAccuracy,
  DEFAULT_KNN_SEED,
  fitKnn,
  predictKnn,
  rankNeighbors,
  refitKnnFromSplit,
  voteNeighbors,
} from '../../knnMath.js';
import { playgroundError } from '../../playgrounds/session.js';

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

function neighborsFor(modelState, fit, controls) {
  const { featureColumns } = modelState;
  const useNormalized = Boolean(controls.normalize);
  const queryVector = viewQueryVector(modelState, fit, controls);
  const viewTraining = useNormalized
    ? fit.normalizedTrain
    : modelState.rawTrain.map((point) => ({
      id: point.id,
      x: featureColumns.map((column) => point.features[column]),
      y: point.label,
    }));
  return rankNeighbors(viewTraining, queryVector, fit.k);
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

// Emits the query/neighbor/vote trace events for the current reveal state.
// `revealFrom` is the previously revealed count so STEP reveals neighbors one
// by one.
function emitQueryTrace(recorder, modelState, fit, controls, revealFrom = 0) {
  const neighbors = neighborsFor(modelState, fit, controls);
  const queryVector = viewQueryVector(modelState, fit, controls);
  recorder.emit('query.received', {
    x: modelState.query.x,
    y: modelState.query.y,
    vector: queryVector,
  });
  recorder.emit('knn.distancesComputed', {
    count: neighbors.length,
    nearest: neighbors.length ? Math.sqrt(neighbors[0].distance) : null,
  });
  for (let index = Math.max(0, revealFrom); index < modelState.revealed; index += 1) {
    const neighbor = neighbors[index];
    if (!neighbor) break;
    recorder.emit('knn.neighborSelected', {
      rank: index + 1,
      pointId: neighbor.pointId,
      distance: Math.sqrt(neighbor.distance),
      label: neighbor.label,
    });
  }
  if (modelState.revealed > 0) {
    const voting = voteNeighbors(neighbors.slice(0, modelState.revealed));
    recorder.emit('knn.voteUpdated', { counts: voting.counts, predictedLabel: voting.predictedLabel, tie: voting.tie });
  }
  if (modelState.revealed >= fit.k) {
    const voting = voteNeighbors(neighbors);
    recorder.emit('prediction.emitted', { label: voting.predictedLabel, k: fit.k });
  }
}

export const knnAdapter = {
  id: 'knn',
  capabilities: {
    fit: true,
    predict: true,
    evaluate: true,
    traceFit: true,
    tracePredict: true,
    decisionSurface: true,
  },
  defaultVisualizationPreset: 'knn.intro',
  // Declarative teaching capabilities (PR E.2.1). The model declares which
  // objectives it can fulfill and which semantic evidence each objective
  // requires. The generic taxonomy/fidelity layer never hardcodes KNN field
  // names; a future model (e.g. MLP with logits/probabilities/predictedLabel)
  // declares its own contract without touching the evaluator.
  teachingCapabilities: {
    explain_prediction: {
      operationIntent: 'predict',
      visualEvidence: ['displayQuery', 'neighbors', 'voting', 'displayPoints'],
      runtimeEvidence: ['metrics.predictedLabel'],
      traceEvidence: ['prediction.emitted'],
    },
  },
  semanticSchema: {
    displayPoints: { type: 'array<classifiedPoint2d>', description: 'Points in the active view coordinate space' },
    axes: { type: 'axes2d', description: 'Axis labels for the plot' },
    displayQuery: { type: 'point2d', description: 'Query point in the active view coordinate space' },
    neighbors: { type: 'array<neighbor>', description: 'Ranked neighbors of the query' },
    voting: { type: 'voteState', description: 'Current neighbor vote counts' },
    decisionRegions: { type: 'decisionRegion', description: '2D decision region grid' },
    projection: { type: 'projection', description: '2D slice projection metadata' },
    normalization: { type: 'normalization', description: 'Feature normalization statistics' },
    metrics: { type: 'metrics', description: 'Accuracy and reveal metrics' },
    formula: { type: 'formula', description: 'Rendered formula' },
    observation: { type: 'observation', description: 'Teaching observation' },
  },
  scriptOperations: {
    tracePredict: {
      intent: 'predict',
      args: {},
      effects: ['neighbors.recomputed', 'reveal.started'],
      alwaysProducesTrace: ['query.received', 'knn.distancesComputed'],
      mayProduceTrace: [],
      // START_NEIGHBOR_REVEAL resets the reveal state; neighbor/vote/
      // prediction events are emitted by later STEP actions.
      enablesTrace: ['knn.neighborSelected', 'knn.voteUpdated', 'prediction.emitted'],
      // Declarative playback policy: revealing `k` times reaches the
      // completed k-neighbor prediction evidence state.
      playback: { revealCountControl: 'k' },
    },
    moveQuery: {
      intent: 'predict',
      args: { x: { type: 'number|null' }, y: { type: 'number|null' } },
      effects: ['query.changed', 'prediction.invalidated', 'neighbors.recomputed'],
      alwaysProducesTrace: ['query.received', 'knn.distancesComputed'],
      // When the model is already in a revealed state, moving the query
      // re-emits neighbor/vote/prediction immediately.
      mayProduceTrace: ['knn.neighborSelected', 'knn.voteUpdated', 'prediction.emitted'],
      enablesTrace: ['knn.neighborSelected', 'knn.voteUpdated', 'prediction.emitted'],
    },
  },
  scriptOperationActions: {
    tracePredict: () => ({ type: 'START_NEIGHBOR_REVEAL' }),
    moveQuery: (args) => ({ type: 'MOVE_QUERY_POINT', x: args?.x ?? null, y: args?.y ?? null }),
  },

  initialize({ source, controls, seed, recorder }) {
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
    recorder.emit('data.loaded', {
      points: points.length,
      features: source.featureColumns,
      trainRatio: source.trainRatio,
    });
    recorder.emit('split.created', {
      trainRows: fit.trainRows,
      testRows: fit.testRows,
      trainIds: train.map((point) => point.id),
      testIds: test.map((point) => point.id),
    });
    recorder.emit('normalization.fitted', {
      means: fit.normalization.means,
      stds: fit.normalization.stds,
    });
    recorder.emit('knn.samplesStored', { count: fit.trainRows, trainIds: train.map((point) => point.id) });
    recorder.emit('evaluation.completed', { accuracy: fit.testAccuracy });
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

  applyModelAction(modelState, action, { controls, recorder }) {
    if (action.type === 'SET_CONTROL') {
      if (action.key === 'xFeature' || action.key === 'yFeature') {
        const nextFeature = action.value;
        if (nextFeature === modelState.xFeature || nextFeature === modelState.yFeature) return {};
        const next = { ...modelState, [action.key]: nextFeature };
        if (next.xFeature === next.yFeature) {
          next.yFeature = nextFeature === next.xFeature
            ? modelState.featureColumns?.find((column) => column !== nextFeature) ?? nextFeature
            : next.yFeature;
        }
        const ranges = projectedRanges(next.points, next.xFeature, next.yFeature);
        const query = { x: (ranges.xMin + ranges.xMax) / 2, y: (ranges.yMin + ranges.yMax) / 2 };
        return {
          controls: { xFeature: next.xFeature, yFeature: next.yFeature, queryX: query.x, queryY: query.y },
          modelState: refreshProjection({ ...next, query, revealed: 0, ranges }, controls),
        };
      }
      if (action.key === 'k') {
        const k = Math.max(1, Math.min(
          Math.round(finiteOrNull(action.value) ?? controls.k),
          Math.max(1, Math.min(MAX_K, modelState.fit.trainRows)),
        ));
        const fit = { ...modelState.fit, k };
        fit.testAccuracy = computeTestAccuracy(fit, modelState.test, modelState.featureColumns);
        recorder.emit('evaluation.completed', { accuracy: fit.testAccuracy, k });
        return {
          controls: { k },
          modelState: refreshProjection(
            { ...modelState, fit, revealed: Math.min(modelState.revealed, k) },
            { ...controls, k },
          ),
          timeline: { totalSteps: k },
        };
      }
      if (action.key === 'queryX' || action.key === 'queryY') {
        const value = finiteOrNull(action.value);
        if (value === null) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
        const query = { ...modelState.query, [action.key === 'queryX' ? 'x' : 'y']: value };
        const next = { ...modelState, query };
        emitQueryTrace(recorder, next, next.fit, { ...controls, [action.key]: value });
        return { controls: { [action.key]: value }, modelState: next };
      }
      if (action.key === 'showNeighborOrder' || action.key === 'showDecisionRegions' || action.key === 'normalize') {
        const value = Boolean(action.value);
        const nextControls = { ...controls, [action.key]: value };
        if (action.key === 'normalize') emitQueryTrace(recorder, modelState, modelState.fit, nextControls);
        return {
          controls: { [action.key]: value },
          modelState: refreshProjection(modelState, nextControls),
        };
      }
      if (action.key === 'distanceMetric') {
        if (action.value !== 'euclidean') throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key, value: action.value });
        return { controls: { distanceMetric: 'euclidean' } };
      }
      throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
    }
    if (action.type === 'SET_QUERY_POINT' || action.type === 'MOVE_QUERY_POINT') {
      const x = action.x === null ? modelState.ranges.xMax : finiteOrNull(action.x);
      const y = action.y === null ? (modelState.ranges.yMin + modelState.ranges.yMax) / 2 : finiteOrNull(action.y);
      if (x === null || y === null) throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type });
      const query = { x, y };
      const next = { ...modelState, query };
      emitQueryTrace(recorder, next, next.fit, controls);
      return { controls: { queryX: x, queryY: y }, modelState: next };
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
      recorder.emit('data.loaded', { points: points.length });
      recorder.emit('normalization.fitted', { means: fit.normalization.means, stds: fit.normalization.stds });
      recorder.emit('knn.samplesStored', { count: fit.trainRows, trainIds: rawTrain.map((point) => point.id) });
      recorder.emit('evaluation.completed', { accuracy: fit.testAccuracy, k: fit.k });
      return {
        controls: { k: fit.k },
        modelState: refreshProjection(
          { ...modelState, rawTrain, points, ranges, fit, pointCounter: counter },
          { ...controls, k: fit.k },
        ),
      };
    }
    if (action.type === 'MOVE_TRAINING_POINT' || action.type === 'REMOVE_TRAINING_POINT') {
      const editingTrain = modelState.rawTrain.some((point) => point.id === action.pointId);
      if (!editingTrain) return {};
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
      recorder.emit('normalization.fitted', { means: fit.normalization.means, stds: fit.normalization.stds });
      recorder.emit('knn.samplesStored', { count: fit.trainRows, trainIds: rawTrain.map((point) => point.id) });
      recorder.emit('evaluation.completed', { accuracy: fit.testAccuracy, k: fit.k });
      return {
        controls: { k: fit.k },
        modelState: refreshProjection(
          { ...modelState, rawTrain, points, ranges, fit },
          { ...controls, k: fit.k },
        ),
      };
    }
    if (action.type === 'START_NEIGHBOR_REVEAL') {
      const next = { ...modelState, revealed: 0 };
      emitQueryTrace(recorder, next, next.fit, controls);
      return {
        modelState: next,
        timeline: { step: 0, totalSteps: modelState.fit.k },
      };
    }
    if (action.type === 'STEP' || action.type === 'SEEK' || action.type === 'STEP_NEIGHBOR_REVEAL') {
      const target = action.type === 'SEEK' ? Math.round(action.step ?? 0) : modelState.revealed + 1;
      const revealed = Math.max(0, Math.min(target, modelState.fit.k));
      const next = { ...modelState, revealed };
      emitQueryTrace(recorder, next, next.fit, controls, modelState.revealed);
      return {
        modelState: next,
        timeline: { step: revealed },
      };
    }
    return {};
  },

  deriveScene(modelState, { controls }) {
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
      displayPoints: modelState.points.map((point) => {
        const raw = [point.features[xFeature], point.features[yFeature]];
        const normalized = [
          (raw[0] - fit.normalization.means[xi]) / fit.normalization.stds[xi],
          (raw[1] - fit.normalization.means[yi]) / fit.normalization.stds[yi],
        ];
        return {
          id: point.id,
          label: point.label,
          subset: trainIds.has(point.id) ? 'train' : 'test',
          x: useNormalized ? normalized[0] : raw[0],
          y: useNormalized ? normalized[1] : raw[1],
        };
      }),
      displayQuery: {
        x: useNormalized ? queryVector[xi] : modelState.query.x,
        y: useNormalized ? queryVector[yi] : modelState.query.y,
      },
      axes: { x: xFeature, y: yFeature },
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
        canPause: false,
        canStep: fit.k > 0,
        canSeek: fit.k > 0,
        canReset: true,
        canEditData: true,
      },
    };
  },

};
