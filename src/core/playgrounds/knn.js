import {
  fitFeatureNormalization,
  normalizeFeatures,
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

function projectedTraining(points, xFeature, yFeature, normalize) {
  const raw = points.map((point) => ({ id: point.id, y: point.label, x: [point.features[xFeature], point.features[yFeature]] }));
  if (!normalize) return { training: raw, normalization: null };
  const normalization = fitFeatureNormalization(raw, 2);
  return {
    training: raw.map((sample) => ({ ...sample, x: normalizeFeatures(sample.x, normalization) })),
    normalization,
  };
}

function computeDecisionRegions(points, xFeature, yFeature, k, normalize) {
  const { training } = projectedTraining(points, xFeature, yFeature, normalize);
  const sampled = training.length <= DECISION_SAMPLE_LIMIT
    ? training
    : Array.from({ length: DECISION_SAMPLE_LIMIT }, (_, index) => (
      training[Math.round(index * (training.length - 1) / (DECISION_SAMPLE_LIMIT - 1))]
    ));
  const xs = sampled.map((sample) => sample.x[0]);
  const ys = sampled.map((sample) => sample.x[1]);
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
      const neighbors = rankNeighbors(sampled, [x, y], Math.min(k, sampled.length));
      cells.push({ x, y, label: voteNeighbors(neighbors).predictedLabel });
    }
  }
  return cells;
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
    ? computeDecisionRegions(modelState.points, modelState.xFeature, modelState.yFeature, controls.k, controls.normalize)
    : null;
  return { ...modelState, ranges, decisionRegions };
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
        { action: { type: 'SET_CONTROL', key: 'k', value: 1 }, durationMs: 500, narrationKey: 'playground.knn.scenario.introK1' },
        { action: { type: 'START_NEIGHBOR_REVEAL' }, durationMs: 400, narrationKey: 'playground.knn.scenario.introReveal' },
        { action: { type: 'STEP' }, durationMs: 700, narrationKey: 'playground.knn.scenario.introNeighbor1' },
        { action: { type: 'SET_CONTROL', key: 'k', value: 5 }, durationMs: 600, narrationKey: 'playground.knn.scenario.introK5' },
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
    return {
      kind: source.kind,
      name: source.name ?? 'Example data',
      fingerprint: source.fingerprint ?? `${points.length}:${featureColumns.join(',')}`,
      points,
      featureColumns,
      total: source.total ?? points.length,
      usingDataset: source.usingDataset ?? false,
    };
  },

  createInitialState({ source, controls }) {
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
    const k = Math.max(1, Math.min(Math.round(merged.k), Math.min(MAX_K, points.length)));
    const state = {
      points,
      xFeature: merged.xFeature,
      yFeature: merged.yFeature,
      ranges,
      query: { x: finiteOrNull(merged.queryX) ?? (ranges.xMin + ranges.xMax) / 2, y: finiteOrNull(merged.queryY) ?? (ranges.yMin + ranges.yMax) / 2 },
      revealed: 0,
      decisionRegions: null,
    };
    return {
      controls: {
        xFeature: merged.xFeature,
        yFeature: merged.yFeature,
        k,
        queryX: state.query.x,
        queryY: state.query.y,
        showNeighborOrder: Boolean(merged.showNeighborOrder),
        showDecisionRegions: Boolean(merged.showDecisionRegions),
        normalize: merged.normalize !== false,
        distanceMetric: merged.distanceMetric === 'euclidean' ? 'euclidean' : 'euclidean',
      },
      modelState: refreshProjection(state, { ...merged, k, showDecisionRegions: Boolean(merged.showDecisionRegions), normalize: merged.normalize !== false }),
      totalSteps: k,
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
        const k = Math.max(1, Math.min(Math.round(finiteOrNull(action.value) ?? controls.k), Math.min(MAX_K, modelState.points.length)));
        return nextSession(session, {
          controls: { k },
          modelState: refreshProjection({ ...modelState, revealed: Math.min(modelState.revealed, k) }, { ...controls, k }),
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
      const points = [...modelState.points, { id: `p-${modelState.points.length}-${Date.now()}`, features: { ...modelState.points[0]?.features, [modelState.xFeature]: x, [modelState.yFeature]: y }, label: action.label }];
      const ranges = projectedRanges(points, modelState.xFeature, modelState.yFeature);
      return nextSession(session, { modelState: refreshProjection({ ...modelState, points, ranges }, controls) });
    }
    if (action.type === 'MOVE_TRAINING_POINT' || action.type === 'REMOVE_TRAINING_POINT') {
      let points;
      if (action.type === 'REMOVE_TRAINING_POINT') {
        points = modelState.points.filter((point) => point.id !== action.pointId);
        if (points.length < 2) throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type, reason: 'minimum two points' });
      } else {
        const x = finiteOrNull(action.x);
        const y = finiteOrNull(action.y);
        if (x === null || y === null) throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type });
        points = modelState.points.map((point) => (point.id === action.pointId
          ? { ...point, features: { ...point.features, [modelState.xFeature]: x, [modelState.yFeature]: y } }
          : point));
      }
      const ranges = projectedRanges(points, modelState.xFeature, modelState.yFeature);
      return nextSession(session, { modelState: refreshProjection({ ...modelState, points, ranges }, controls) });
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
    const { modelState, controls, timeline } = session;
    const { training, normalization } = projectedTraining(modelState.points, modelState.xFeature, modelState.yFeature, controls.normalize);
    const queryRaw = [modelState.query.x, modelState.query.y];
    const query = controls.normalize ? normalizeFeatures(queryRaw, normalization) : [...queryRaw];
    const neighbors = rankNeighbors(training, query, controls.k);
    const activeNeighbors = neighbors.slice(0, modelState.revealed);
    const voting = modelState.revealed > 0 ? voteNeighbors(activeNeighbors) : {
      counts: {},
      distanceSums: {},
      predictedLabel: null,
      tie: false,
      tieBreakReason: null,
    };
    const scene = {
      points: modelState.points.map((point) => {
        const raw = [point.features[modelState.xFeature], point.features[modelState.yFeature]];
        const normalized = controls.normalize ? normalizeFeatures(raw, normalization) : raw;
        return {
          id: point.id,
          x: raw[0],
          y: raw[1],
          label: point.label,
          normalizedX: normalized[0],
          normalizedY: normalized[1],
        };
      }),
      query: {
        x: modelState.query.x,
        y: modelState.query.y,
        normalizedX: query[0],
        normalizedY: query[1],
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
      featureOptions: modelState.points.length ? Object.keys(modelState.points[0].features) : [],
      normalize: Boolean(controls.normalize),
    };
    let observation = {
      titleKey: 'playground.knn.observation.intro',
      bodyKey: 'playground.knn.observation.introBody',
      params: {},
    };
    if (modelState.revealed > 0 && modelState.revealed < controls.k) {
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
        trainingPoints: modelState.points.length,
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
