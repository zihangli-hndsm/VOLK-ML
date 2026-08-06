import {
  fitKnn,
  normalizeFeatures,
  predictKnn,
  rankNeighbors,
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

function featureIndex(featureColumns, name) {
  return Math.max(0, featureColumns.indexOf(name));
}

function rawTrainPoints(fit, featureColumns) {
  return (fit.rawTrain ?? []).map((sample) => ({
    id: sample.index,
    label: sample.y,
    features: Object.fromEntries(featureColumns.map((column, index) => [column, sample.x[index]])),
  }));
}

function computeDecisionRegions(fit, points, featureColumns, xFeature, yFeature, k, normalize) {
  const xIndex = featureIndex(featureColumns, xFeature);
  const yIndex = featureIndex(featureColumns, yFeature);
  const sampled = points.length <= DECISION_SAMPLE_LIMIT
    ? points
    : Array.from({ length: DECISION_SAMPLE_LIMIT }, (_, index) => (
      points[Math.round(index * (points.length - 1) / (DECISION_SAMPLE_LIMIT - 1))]
    ));
  const xs = sampled.map((point) => point.features[xFeature]);
  const ys = sampled.map((point) => point.features[yFeature]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xPad = Math.max(0.01, (xMax - xMin) * 0.1);
  const yPad = Math.max(0.01, (yMax - yMin) * 0.1);
  const neighborsFor = (raw) => {
    const query = normalize
      ? normalizeFeatures(raw, fit.normalization)
      : raw;
    const training = normalize ? fit.train : (fit.rawTrain ?? []);
    return rankNeighbors(training, query, Math.min(k, training.length));
  };
  const cells = [];
  for (let row = 0; row < DECISION_RESOLUTION; row += 1) {
    for (let column = 0; column < DECISION_RESOLUTION; column += 1) {
      const x = xMin - xPad + ((xMax - xMin + xPad * 2) * (column + 0.5)) / DECISION_RESOLUTION;
      const y = yMin - yPad + ((yMax - yMin + yPad * 2) * (row + 0.5)) / DECISION_RESOLUTION;
      const features = { [xFeature]: x, [yFeature]: y };
      const vector = featureColumns.map((column) => features[column] ?? 0);
      cells.push({ x, y, label: voteNeighbors(neighborsFor(vector)).predictedLabel });
    }
  }
  return cells;
}

function computeTestAccuracy(fit) {
  if (!fit.test?.length) return null;
  const correct = fit.test.filter((sample) => predictKnn(fit, sample.x) === sample.y).length;
  return correct / fit.test.length;
}

function rebuildNormalizedTrain(modelState) {
  const fit = modelState.fit;
  const train = modelState.rawTrain.map((point) => {
    const vector = modelState.featureColumns.map((column) => point.features[column]);
    return { index: point.id, x: normalizeFeatures(vector, fit.normalization), y: point.label };
  });
  return { ...fit, train, k: Math.min(fit.k, train.length) };
}

function nextSession(session, patch) {
  return {
    ...session,
    controls: { ...session.controls, ...(patch.controls ?? {}) },
    modelState: { ...session.modelState, ...(patch.modelState ?? {}) },
    timeline: { ...session.timeline, ...(patch.timeline ?? {}) },
  };
}

function refitModel(modelState, source) {
  const fit = fitKnn({
    samples: modelState.samples,
    k: modelState.k,
    trainRatio: source.trainRatio ?? 0.8,
  });
  return {
    ...modelState,
    fit,
    k: fit.k,
    rawTrain: rawTrainPoints(fit, modelState.featureColumns),
    testAccuracy: computeTestAccuracy(fit),
  };
}

function refreshDecisionRegions(modelState) {
  if (!modelState.controls.showDecisionRegions) return { ...modelState, decisionRegions: null };
  const regions = computeDecisionRegions(
    modelState.fit,
    modelState.rawTrain,
    modelState.featureColumns,
    modelState.xFeature,
    modelState.yFeature,
    modelState.k,
    modelState.controls.normalize,
  );
  return { ...modelState, decisionRegions: regions };
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
    const samples = Array.isArray(source.samples)
      ? source.samples.map((sample, index) => ({
        index: sample.index ?? index,
        x: featureColumns.map((column, feature) => {
          const value = finiteOrNull(sample.x?.[feature] ?? sample[column]);
          return value;
        }),
        y: String(sample.y ?? sample.label ?? ''),
      })).filter((sample) => sample.x.every(Number.isFinite) && sample.y)
      : [];
    if (samples.length < 3) throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'needs at least three labeled samples' });
    if (new Set(samples.map((sample) => sample.y)).size < 2) {
      throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'needs at least two classes' });
    }
    return {
      kind: source.kind,
      name: source.name ?? 'Example data',
      fingerprint: source.fingerprint ?? `${samples.length}:${featureColumns.join(',')}`,
      samples,
      featureColumns,
      trainRatio: source.trainRatio ?? 0.8,
      total: source.total ?? samples.length,
      usingDataset: source.usingDataset ?? false,
    };
  },

  createInitialState({ source, controls }) {
    const xFeature = source.featureColumns[0];
    const yFeature = source.featureColumns[1];
    const k = Math.max(1, Math.min(Math.round(controls.k ?? 5), MAX_K));
    const fit = fitKnn({ samples: source.samples, k, trainRatio: source.trainRatio });
    const rawTrain = rawTrainPoints(fit, source.featureColumns);
    const ranges = projectedRanges(rawTrain, xFeature, yFeature);
    const query = {
      x: finiteOrNull(controls.queryX) ?? (ranges.xMin + ranges.xMax) / 2,
      y: finiteOrNull(controls.queryY) ?? (ranges.yMin + ranges.yMax) / 2,
    };
    const modelState = {
      samples: source.samples,
      fit,
      rawTrain,
      xFeature,
      yFeature,
      featureColumns: source.featureColumns,
      ranges,
      query,
      k: fit.k,
      revealed: 0,
      pointCounter: rawTrain.length,
      decisionRegions: null,
      testAccuracy: computeTestAccuracy(fit),
      controls: {
        normalize: controls.normalize !== false,
        showDecisionRegions: Boolean(controls.showDecisionRegions),
      },
    };
    return {
      controls: {
        xFeature,
        yFeature,
        k: fit.k,
        queryX: query.x,
        queryY: query.y,
        showNeighborOrder: Boolean(controls.showNeighborOrder),
        showDecisionRegions: Boolean(controls.showDecisionRegions),
        normalize: controls.normalize !== false,
        distanceMetric: 'euclidean',
      },
      modelState,
      totalSteps: fit.k,
    };
  },

  reduce(session, action) {
    const { modelState, controls } = session;
    const source = session.sourceData ?? { featureColumns: modelState.featureColumns, trainRatio: 0.8 };
    if (action.type === 'SET_CONTROL') {
      if (action.key === 'xFeature' || action.key === 'yFeature') {
        const next = { ...modelState, [action.key]: action.value };
        if (next.xFeature === next.yFeature) {
          next.yFeature = modelState.featureColumns.find((column) => column !== next.xFeature) ?? next.yFeature;
        }
        const ranges = projectedRanges(next.rawTrain, next.xFeature, next.yFeature);
        const query = { x: (ranges.xMin + ranges.xMax) / 2, y: (ranges.yMin + ranges.yMax) / 2 };
        const merged = refreshDecisionRegions({ ...next, ranges, query, revealed: 0 });
        return nextSession(session, {
          controls: { xFeature: next.xFeature, yFeature: next.yFeature, queryX: query.x, queryY: query.y },
          modelState: merged,
        });
      }
      if (action.key === 'k') {
        const k = Math.max(1, Math.min(Math.round(finiteOrNull(action.value) ?? controls.k), Math.min(MAX_K, modelState.rawTrain.length)));
        const fit = { ...modelState.fit, k };
        const merged = refreshDecisionRegions({ ...modelState, fit, k, revealed: Math.min(modelState.revealed, k) });
        return nextSession(session, {
          controls: { k },
          modelState: merged,
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
        const merged = refreshDecisionRegions({ ...modelState, controls: { ...modelState.controls, [action.key]: value } });
        return nextSession(session, { controls: { [action.key]: value }, modelState: merged });
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
      const index = modelState.pointCounter;
      const rawTrain = [...modelState.rawTrain, {
        id: index,
        features: { ...modelState.rawTrain[0].features, [modelState.xFeature]: x, [modelState.yFeature]: y },
        label: action.label,
      }];
      const fit = rebuildNormalizedTrain({ ...modelState, rawTrain });
      const ranges = projectedRanges(rawTrain, modelState.xFeature, modelState.yFeature);
      const merged = refreshDecisionRegions({
        ...modelState,
        fit,
        rawTrain,
        ranges,
        k: fit.k,
        pointCounter: index + 1,
      });
      return nextSession(session, { modelState: merged, timeline: { ...session.timeline, totalSteps: fit.k } });
    }
    if (action.type === 'MOVE_TRAINING_POINT' || action.type === 'REMOVE_TRAINING_POINT') {
      let rawTrain;
      if (action.type === 'REMOVE_TRAINING_POINT') {
        rawTrain = modelState.rawTrain.filter((point) => point.id !== action.pointId);
        if (rawTrain.length < 3) throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type, reason: 'minimum three samples' });
      } else {
        const x = finiteOrNull(action.x);
        const y = finiteOrNull(action.y);
        if (x === null || y === null) throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type });
        rawTrain = modelState.rawTrain.map((point) => {
          if (point.id !== action.pointId) return point;
          return { ...point, features: { ...point.features, [modelState.xFeature]: x, [modelState.yFeature]: y } };
        });
      }
      const fit = rebuildNormalizedTrain({ ...modelState, rawTrain });
      const ranges = projectedRanges(rawTrain, modelState.xFeature, modelState.yFeature);
      const merged = refreshDecisionRegions({
        ...modelState,
        fit,
        rawTrain,
        ranges,
        k: fit.k,
      });
      return nextSession(session, { modelState: merged, timeline: { ...session.timeline, totalSteps: fit.k } });
    }
    if (action.type === 'START_NEIGHBOR_REVEAL') {
      return nextSession(session, {
        modelState: { ...modelState, revealed: 0 },
        timeline: { ...session.timeline, step: 0, totalSteps: controls.k },
      });
    }
    if (action.type === 'STEP' || action.type === 'SEEK' || action.type === 'STEP_NEIGHBOR_REVEAL') {
      const target = action.type === 'SEEK' ? Math.round(action.step ?? 0) : modelState.revealed + 1;
      const revealed = Math.max(0, Math.min(target, controls.k));
      return nextSession(session, {
        modelState: { ...modelState, revealed },
        timeline: { ...session.timeline, step: revealed },
      });
    }
    return session;
  },

  deriveScene(session) {
    const { modelState, controls } = session;
    const fit = modelState.fit;
    const xIndex = featureIndex(modelState.featureColumns, modelState.xFeature);
    const yIndex = featureIndex(modelState.featureColumns, modelState.yFeature);
    const normalize = controls.normalize;
    const queryRaw = [modelState.query.x, modelState.query.y];
    const queryVector = modelState.featureColumns.map((column, index) => (
      index === xIndex ? modelState.query.x : index === yIndex ? modelState.query.y : 0
    ));
    const query = normalize ? normalizeFeatures(queryVector, fit.normalization) : queryVector;
    const training = normalize ? fit.train : (fit.rawTrain ?? []);
    const neighbors = rankNeighbors(training, query, Math.min(controls.k, training.length));
    const activeNeighbors = neighbors.slice(0, modelState.revealed);
    const voting = modelState.revealed > 0 ? voteNeighbors(activeNeighbors) : {
      counts: {},
      distanceSums: {},
      predictedLabel: null,
      tie: false,
      tieBreakReason: null,
    };
    const scene = {
      points: modelState.rawTrain.map((point) => {
        const raw = [point.features[modelState.xFeature], point.features[modelState.yFeature]];
        const vector = modelState.featureColumns.map((column, index) => (
          index === xIndex ? raw[0] : index === yIndex ? raw[1] : 0
        ));
        const normalized = normalizeFeatures(vector, fit.normalization);
        return {
          id: point.id,
          x: raw[0],
          y: raw[1],
          label: point.label,
          normalizedX: normalized[xIndex],
          normalizedY: normalized[yIndex],
        };
      }),
      query: {
        x: modelState.query.x,
        y: modelState.query.y,
        normalizedX: query[xIndex],
        normalizedY: query[yIndex],
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
      featureOptions: modelState.featureColumns,
      normalize: Boolean(controls.normalize),
      normalization: {
        xMean: fit.normalization.means[xIndex],
        xStd: fit.normalization.stds[xIndex],
        yMean: fit.normalization.means[yIndex],
        yStd: fit.normalization.stds[yIndex],
      },
      split: {
        trainRows: fit.trainRows,
        testRows: fit.testRows,
      },
    };
    let observation = {
      titleKey: 'playground.knn.observation.intro',
      bodyKey: 'playground.knn.observation.introBody',
      params: { trainRows: fit.trainRows, testRows: fit.testRows },
    };
    if (!normalize) {
      observation = {
        titleKey: 'playground.knn.observation.noNormalize',
        bodyKey: 'playground.knn.observation.noNormalizeBody',
        params: {},
      };
    } else if (modelState.revealed > 0 && modelState.revealed < controls.k) {
      const neighbor = neighbors[modelState.revealed - 1];
      observation = {
        titleKey: 'playground.knn.observation.neighbor',
        bodyKey: 'playground.knn.observation.neighborBody',
        params: { rank: modelState.revealed, label: neighbor.label, distance: Math.sqrt(neighbor.distance).toFixed(3) },
      };
    } else if (modelState.revealed >= controls.k) {
      observation = {
        titleKey: voting.tie ? 'playground.knn.observation.tie' : 'playground.knn.observation.prediction',
        bodyKey: voting.tie ? 'playground.knn.observation.tieBody' : 'playground.knn.observation.predictionBody',
        params: { label: voting.predictedLabel, k: controls.k, reason: voting.tieBreakReason ?? '' },
      };
    }
    return {
      scene,
      metrics: {
        revealed: modelState.revealed,
        k: controls.k,
        predictedLabel: voting.predictedLabel,
        trainingPoints: modelState.rawTrain.length,
        testAccuracy: modelState.testAccuracy ?? null,
      },
      observation,
      formula: {
        key: 'playground.formula.knn',
        params: {
          k: controls.k,
          nearest: neighbors.length ? Math.sqrt(neighbors[0].distance).toFixed(3) : '—',
        },
        highlight: null,
      },
      capabilities: {
        canPlay: true,
        canPause: session.status === 'playing',
        canStep: controls.k > 0,
        canSeek: controls.k > 0,
        canReset: true,
        canEditData: true,
      },
    };
  },
};
