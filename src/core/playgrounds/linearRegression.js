import {
  leastSquaresFit,
  meanSquaredError,
  playgroundRanges,
  regressionGradient,
} from '../linearRegressionPlayground.js';
import {
  createLinearRegressionTrainer,
  normalizeLinearParameters,
  stepLinearRegressionTrainer,
} from '../linearRegressionMath.js';
import { playgroundError } from './session.js';

const finiteOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

function recomputeDerived(points) {
  return {
    ranges: playgroundRanges(points.map(({ x, y }) => ({ x, y }))),
    optimum: leastSquaresFit(points.map(({ x, y }) => ({ x, y }))),
  };
}

function nextSession(session, patch) {
  return {
    ...session,
    controls: { ...session.controls, ...(patch.controls ?? {}) },
    modelState: { ...session.modelState, ...(patch.modelState ?? {}) },
    timeline: { ...session.timeline, ...(patch.timeline ?? {}) },
  };
}

function clearTraining(modelState) {
  return {
    ...modelState,
    gradient: null,
    training: { currentStep: 0, history: [], totalSteps: 0 },
  };
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

// Converts the multi-feature trainer gradient into the 1D scene shape used by
// the linear regression renderer.
function sceneGradient(gradient) {
  if (!gradient) return null;
  return {
    weight: Array.isArray(gradient.weights) ? gradient.weights[0] : gradient.weight,
    bias: gradient.bias,
    magnitude: gradient.magnitude,
  };
}

export const linearRegressionPlayground = {
  id: 'linear-regression',
  version: 1,
  titleKey: 'playground.linearRegression.title',
  descriptionKey: 'playground.linearRegression.description',
  supportedOps: ['linear_regression'],
  supportedTasks: ['regression'],
  sourceKinds: ['example', 'workspace-dataset'],

  controls: [
    { key: 'weight', type: 'number', min: -100, max: 100, step: 0.01 },
    { key: 'bias', type: 'number', min: -100, max: 100, step: 0.01 },
    { key: 'learningRate', type: 'number', min: 0.001, max: 1, step: 0.001 },
    { key: 'trainingSteps', type: 'number', min: 1, max: 100, step: 1 },
    { key: 'showResiduals', type: 'boolean' },
    { key: 'showBestFit', type: 'boolean' },
  ],

  actions: [
    'SET_CONTROL',
    'ADD_POINT',
    'MOVE_POINT',
    'REMOVE_POINT',
    'SET_PARAMETERS',
    'SET_BEST_FIT',
    'START_TRAINING',
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
        { action: { type: 'SET_CONTROL', key: 'weight', value: 0 }, durationMs: 500, narrationKey: 'playground.lr.scenario.introStart' },
        { action: { type: 'SET_CONTROL', key: 'bias', value: 0 }, durationMs: 600, narrationKey: 'playground.lr.scenario.introFlat' },
        { action: { type: 'SET_CONTROL', key: 'showResiduals', value: true }, durationMs: 800, narrationKey: 'playground.lr.scenario.introResiduals' },
        { action: { type: 'START_TRAINING' }, durationMs: 600, narrationKey: 'playground.lr.scenario.introTrain' },
        { action: { type: 'STEP' }, durationMs: 700, narrationKey: 'playground.lr.scenario.introStep1' },
        { action: { type: 'STEP' }, durationMs: 700, narrationKey: 'playground.lr.scenario.introStep2' },
        { action: { type: 'STEP' }, durationMs: 700, narrationKey: 'playground.lr.scenario.introStep3' },
        { action: { type: 'SET_BEST_FIT' }, durationMs: 800, narrationKey: 'playground.lr.scenario.introBestFit' },
      ],
    },
  ],

  validateSource(source) {
    if (!source || typeof source !== 'object') throw playgroundError('INVALID_PLAYGROUND_SOURCE');
    if (!['example', 'workspace-dataset'].includes(source.kind)) throw playgroundError('INVALID_PLAYGROUND_SOURCE', { kind: source.kind });
    const points = Array.isArray(source.points)
      ? source.points.map((point, index) => ({
        id: point.id ?? index,
        x: finiteOrNull(point.x),
        y: finiteOrNull(point.y),
      })).filter((point) => point.x !== null && point.y !== null)
      : [];
    if (points.length < 2) throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'needs at least two finite points' });
    return {
      kind: source.kind,
      name: source.name ?? 'Example data',
      fingerprint: source.fingerprint ?? String(points.length),
      points,
      feature: source.feature ?? 'x',
      target: source.target ?? 'y',
      total: source.total ?? points.length,
      usingDataset: source.usingDataset ?? false,
    };
  },

  createInitialState({ source, controls }) {
    const points = source.points.map((point) => ({ id: point.id, x: point.x, y: point.y }));
    const derived = recomputeDerived(points);
    const initialBias = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    const merged = {
      weight: 0,
      bias: initialBias,
      learningRate: 0.05,
      trainingSteps: 20,
      showResiduals: false,
      showBestFit: false,
      ...controls,
    };
    return {
      controls: {
        weight: merged.weight,
        bias: merged.bias,
        learningRate: merged.learningRate,
        trainingSteps: merged.trainingSteps,
        showResiduals: Boolean(merged.showResiduals),
        showBestFit: Boolean(merged.showBestFit),
      },
      modelState: {
        points,
        ...derived,
        weight: merged.weight,
        bias: merged.bias,
        gradient: null,
        training: { currentStep: 0, history: [], totalSteps: 0 },
        pointCounter: 0,
      },
      totalSteps: 0,
    };
  },

  reduce(session, action) {
    const { modelState, controls } = session;
    if (action.type === 'SET_CONTROL' || action.type === 'SET_PARAMETERS') {
      if (action.key === 'weight' || action.type === 'SET_PARAMETERS') {
        const weight = action.type === 'SET_PARAMETERS' ? finiteOrNull(action.weight) : finiteOrNull(action.value);
        if (weight === null) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: 'weight' });
        return nextSession(session, { controls: { weight }, modelState: clearTraining({ ...modelState, weight }) });
      }
      if (action.key === 'bias') {
        const bias = finiteOrNull(action.value);
        if (bias === null) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: 'bias' });
        return nextSession(session, { controls: { bias }, modelState: clearTraining({ ...modelState, bias }) });
      }
      if (action.key === 'learningRate' || action.key === 'trainingSteps' || action.key === 'showResiduals' || action.key === 'showBestFit') {
        return nextSession(session, { controls: { [action.key]: action.value } });
      }
      throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
    }
    if (action.type === 'ADD_POINT') {
      const x = finiteOrNull(action.x);
      const y = finiteOrNull(action.y);
      if (x === null || y === null) throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type });
      const { id, counter } = nextPointId(modelState.points, modelState.pointCounter);
      const points = [...modelState.points, { id, x, y }];
      return nextSession(session, { modelState: { ...clearTraining({ ...modelState, points, pointCounter: counter }), ...recomputeDerived(points) } });
    }
    if (action.type === 'MOVE_POINT') {
      const x = finiteOrNull(action.x);
      const y = finiteOrNull(action.y);
      if (x === null || y === null) throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type });
      const points = modelState.points.map((point) => (point.id === action.pointId ? { ...point, x, y } : point));
      return nextSession(session, { modelState: { ...clearTraining({ ...modelState, points }), ...recomputeDerived(points) } });
    }
    if (action.type === 'REMOVE_POINT') {
      const points = modelState.points.filter((point) => point.id !== action.pointId);
      if (points.length < 2) throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type, reason: 'minimum two points' });
      return nextSession(session, { modelState: { ...clearTraining({ ...modelState, points }), ...recomputeDerived(points) } });
    }
    if (action.type === 'SET_BEST_FIT') {
      return nextSession(session, {
        controls: { weight: modelState.optimum.weight, bias: modelState.optimum.bias },
        modelState: clearTraining({ ...modelState, weight: modelState.optimum.weight, bias: modelState.optimum.bias }),
      });
    }
    if (action.type === 'START_TRAINING') {
      const points = modelState.points.map(({ x, y }) => ({ x, y }));
      const trainer = createLinearRegressionTrainer(points);
      const start = normalizeLinearParameters({
        weights: [modelState.weight],
        bias: modelState.bias,
        normalization: trainer.normalization,
      });
      const learningRate = Number(controls.learningRate);
      const steps = Math.max(1, Math.round(controls.trainingSteps));
      const initialLossNormalized = trainer.normalizedPoints.reduce((sum, sample) => {
        const prediction = start.weights.reduce(
          (total, weight, feature) => total + weight * sample.x[feature],
          start.bias,
        );
        return sum + (prediction - sample.y) ** 2;
      }, 0) / Math.max(1, trainer.normalizedPoints.length);
      const history = [];
      let current = { weights: start.weights, bias: start.bias };
      let previousLoss = initialLossNormalized;
      let stopReason = null;
      for (let step = 1; step <= steps; step += 1) {
        const next = stepLinearRegressionTrainer(trainer, { ...current, learningRate });
        const { normalizedParameters, rawParameters } = next;
        const finite = Number.isFinite(next.lossNormalized)
          && normalizedParameters.weights.every(Number.isFinite)
          && Number.isFinite(normalizedParameters.bias)
          && rawParameters.weights.every(Number.isFinite)
          && Number.isFinite(rawParameters.bias);
        if (!finite) {
          stopReason = 'diverged';
          break;
        }
        const entry = {
          step,
          weight: rawParameters.weights[0],
          bias: rawParameters.bias,
          normalizedWeight: normalizedParameters.weights[0],
          normalizedBias: normalizedParameters.bias,
          gradient: next.gradient,
          loss: next.nextLossRaw,
          lossNormalized: next.nextLossNormalized,
        };
        const lossGrew = next.nextLossNormalized - previousLoss
          > 1e-9 * Math.max(1, Math.abs(previousLoss));
        if (lossGrew) {
          history.push(entry);
          stopReason = 'learning-rate-too-high';
          break;
        }
        previousLoss = next.nextLossNormalized;
        history.push(entry);
        current = { weights: normalizedParameters.weights, bias: normalizedParameters.bias };
      }
      return nextSession(session, {
        modelState: {
          ...modelState,
          training: {
            currentStep: 0,
            history,
            totalSteps: history.length,
            stopReason,
            normalization: trainer.normalization,
          },
        },
        timeline: { step: 0, totalSteps: history.length, speed: session.timeline.speed },
      });
    }
    if (action.type === 'STEP' || action.type === 'SEEK') {
      const { training } = modelState;
      if (!training.history.length) return session;
      const target = action.type === 'SEEK' ? Math.round(action.step ?? 0) : training.currentStep + 1;
      const currentStep = Math.max(0, Math.min(target, training.totalSteps));
      const entry = training.history[Math.max(0, currentStep - 1)];
      const nextModel = entry
        ? { ...modelState, weight: entry.weight, bias: entry.bias, gradient: entry.gradient, training: { ...training, currentStep } }
        : { ...modelState, training: { ...training, currentStep } };
      return nextSession(session, {
        controls: { weight: nextModel.weight, bias: nextModel.bias },
        modelState: nextModel,
        timeline: { ...session.timeline, step: currentStep },
      });
    }
    return session;
  },

  deriveScene(session) {
    const { modelState, controls, timeline } = session;
    const { points, ranges, optimum, weight, bias } = modelState;
    const gradient = sceneGradient(modelState.gradient) ?? regressionGradient(points, weight, bias);
    const prediction = (x) => weight * x + bias;
    const scene = {
      points: points.map((point) => ({
        ...point,
        prediction: prediction(point.x),
        residual: point.y - prediction(point.x),
      })),
      line: {
        weight,
        bias,
        start: { x: ranges.xMin, y: prediction(ranges.xMin) },
        end: { x: ranges.xMax, y: prediction(ranges.xMax) },
      },
      bestFitLine: optimum,
      gradient,
      training: {
        currentStep: modelState.training.currentStep,
        totalSteps: modelState.training.totalSteps,
        lossHistory: modelState.training.history.slice(0, modelState.training.currentStep).map((entry) => entry.loss),
        parameterHistory: modelState.training.history.slice(0, modelState.training.currentStep).map((entry) => ({ weight: entry.weight, bias: entry.bias })),
      },
      ranges,
    };
    const mse = meanSquaredError(points, weight, bias);
    const training = modelState.training;
    let observation = {
      titleKey: 'playground.lr.observation.intro',
      bodyKey: 'playground.lr.observation.introBody',
      params: {},
    };
    if (training.stopReason && training.currentStep > 0 && training.currentStep >= training.totalSteps) {
      const entry = training.history[training.currentStep - 1];
      observation = training.stopReason === 'learning-rate-too-high'
        ? {
          titleKey: 'playground.lr.observation.lrTooHigh',
          bodyKey: 'playground.lr.observation.lrTooHighBody',
          params: { step: entry?.step ?? training.currentStep, loss: Number(entry?.loss ?? 0).toExponential(3) },
        }
        : {
          titleKey: 'playground.lr.observation.diverged',
          bodyKey: 'playground.lr.observation.divergedBody',
          params: {},
        };
    } else if (training.currentStep > 0 && training.currentStep < training.totalSteps) {
      const entry = training.history[training.currentStep - 1];
      observation = {
        titleKey: 'playground.lr.observation.trainingStep',
        bodyKey: 'playground.lr.observation.trainingStepBody',
        params: { step: training.currentStep, loss: entry.loss.toFixed(4), magnitude: entry.gradient.magnitude.toFixed(4) },
      };
    } else if (controls.showResiduals) {
      observation = {
        titleKey: 'playground.lr.observation.residuals',
        bodyKey: 'playground.lr.observation.residualsBody',
        params: { mse: mse.toFixed(4) },
      };
    } else if (controls.showBestFit) {
      observation = {
        titleKey: 'playground.lr.observation.bestFit',
        bodyKey: 'playground.lr.observation.bestFitBody',
        params: { weight: optimum.weight.toFixed(3), bias: optimum.bias.toFixed(3) },
      };
    }
    return {
      scene,
      metrics: { mse },
      observation,
      formula: {
        key: 'playground.formula.linear',
        params: {
          weight: weight.toFixed(3),
          bias: Math.abs(bias).toFixed(3),
          operator: bias < 0 ? '−' : '+',
        },
        highlight: training.currentStep > 0
          ? (Math.abs(gradient.weight) >= Math.abs(gradient.bias) ? 'weight' : 'bias')
          : null,
      },
      capabilities: {
        canPlay: true,
        canPause: session.status === 'playing',
        canStep: true,
        canSeek: training.totalSteps > 0,
        canReset: true,
        canEditData: true,
      },
    };
  },
};
