import {
  leastSquaresFit,
  meanSquaredError,
  playgroundRanges,
  regressionGradient,
} from '../../linearRegressionPlayground.js';
import {
  createLinearRegressionTrainer,
  fitLinearNormalization,
  denormalizeLinearParameters,
  normalizeLinearParameters,
  stepLinearRegressionTrainer,
} from '../../linearRegressionMath.js';
import { playgroundError } from '../../playgrounds/session.js';

const finiteOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

function trainingPoints(points) {
  return points.filter((point) => point.membership !== 'test');
}

function testPoints(points) {
  return points.filter((point) => point.membership === 'test');
}

function pointForModel(point, feature, target) {
  const x = finiteOrNull(point.features?.[feature]) ?? finiteOrNull(point.x);
  const y = finiteOrNull(point.features?.[target]) ?? finiteOrNull(point.target) ?? finiteOrNull(point.y);
  return {
    ...point,
    x,
    y,
    target: y,
    ...(point.features ? { features: structuredClone(point.features) } : {}),
  };
}

function validateRegressionWorld(world) {
  if (world.task !== 'regression') {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { reason: 'linear regression requires a regression World' });
  }
  const trainCount = world.observations.filter((point) => point.membership !== 'test').length;
  if (trainCount < 2) {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { reason: 'minimum two training points' });
  }
  return world;
}

function recomputeDerived(points) {
  const train = trainingPoints(points);
  if (train.length < 2) {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { reason: 'minimum two training points' });
  }
  return {
    ranges: playgroundRanges(points.map(({ x, y }) => ({ x, y }))),
    optimum: leastSquaresFit(train.map(({ x, y }) => ({ x, y }))),
  };
}

function clearTraining(modelState) {
  return {
    ...modelState,
    gradient: null,
    training: { currentStep: 0, history: [], totalSteps: 0 },
  };
}

function sceneGradient(gradient) {
  if (!gradient) return null;
  return {
    weight: Array.isArray(gradient.weights) ? gradient.weights[0] : gradient.weight,
    bias: gradient.bias,
    magnitude: gradient.magnitude,
  };
}

function emitLineUpdate(recorder, modelState) {
  const train = trainingPoints(modelState.points);
  recorder.emit('prediction.updated', { weight: modelState.weight, bias: modelState.bias });
  recorder.emit('residuals.computed', {
    count: train.length,
    mse: meanSquaredError(train, modelState.weight, modelState.bias),
  });
}

export const linearRegressionAdapter = {
  id: 'linear-regression',
  capabilities: {
    fit: true,
    predict: true,
    evaluate: true,
    traceFit: true,
    tracePredict: true,
    parameterSurface: true,
  },
  trainingMicroscopeCapabilities: {
    lossTrace: true,
    parameters: ['weight', 'bias'],
    gradients: ['weight', 'bias'],
    updates: true,
    preprocessing: ['train-test-split', 'feature-target-normalization'],
  },
  defaultVisualizationPreset: 'linear-regression.intuition',
  // Declarative teaching capabilities (PR E.2.1). The model owns the failure
  // signal contract: show_failure_case is only supportable because the
  // adapter declares the training.completed stoppedReason predicate. The
  // generic taxonomy/fidelity layer never hardcodes LR field names.
  teachingCapabilities: {
    show_training: {
      operationIntent: 'fit',
      visualEvidence: ['line', 'training.lossHistory', 'metrics', 'formula'],
      runtimeEvidence: ['training.parameterHistory', 'metrics'],
      traceEvidence: ['training.completed'],
    },
    show_failure_case: {
      operationIntent: 'fit',
      visualEvidence: ['training.lossHistory', 'metrics', 'observation'],
      runtimeEvidence: ['training.parameterHistory', 'metrics', 'observation'],
      // The failure is only real when the runtime reports an actual
      // stoppedReason; a completed run without one must fail fidelity. Only
      // the inspectable learning-rate-too-high regime is advertised: it
      // emits loss.measured + gradient.computed and keeps the attempted
      // parameter transition in training.parameterHistory. The early
      // non-finite `diverged` stop reason remains valid runtime behavior but
      // is not a supported pedagogical outcome until a future contract can
      // explain that path truthfully.
      traceEvidence: [
        'loss.measured',
        'gradient.computed',
        { trace: 'training.completed', where: { stoppedReason: ['learning-rate-too-high'] } },
      ],
    },
  },
  semanticSchema: {
    scatterPoints: { type: 'array<point2d>', description: 'Observed training samples' },
    axes: { type: 'axes2d', description: 'Axis labels for the plot' },
    line: { type: 'line2d', description: 'Current regression line' },
    bestFitLine: { type: 'line2d', description: 'Least-squares reference line' },
    residualPoints: { type: 'array<residualPoint>', description: 'Per-point residual segments' },
    ranges: { type: 'ranges2d', description: 'Plot ranges' },
    training: { type: 'trainingState', description: 'Gradient descent progress' },
    metrics: { type: 'metrics', description: 'Current MSE' },
    formula: { type: 'formula', description: 'Rendered formula' },
    observation: { type: 'observation', description: 'Teaching observation' },
  },
  scriptOperations: {
    traceFit: {
      intent: 'fit',
      args: {},
      effects: ['training.started', 'parameters.changed', 'prediction.invalidated'],
      // START_TRAINING emits normalization/initialization and per-step events
      // while the step is finite; divergence or early stop skips some of them.
      alwaysProducesTrace: ['normalization.fitted', 'regression.initialized', 'training.completed'],
      mayProduceTrace: ['loss.measured', 'gradient.computed', 'parameters.updated', 'training.step'],
      // prediction.updated / residuals.computed are produced by later STEP
      // playback, not by the traceFit invocation itself.
      enablesTrace: ['prediction.updated', 'residuals.computed'],
      // Declarative playback policy: revealing `trainingSteps` times reaches
      // the completed training evidence state.
      playback: { revealCountControl: 'trainingSteps' },
    },
    setBestFit: {
      intent: 'parameterize',
      args: {},
      effects: ['parameters.changed', 'prediction.changed'],
      alwaysProducesTrace: ['parameters.updated', 'prediction.updated', 'residuals.computed'],
      mayProduceTrace: [],
      enablesTrace: [],
    },
  },
  scriptOperationActions: {
    traceFit: () => ({ type: 'START_TRAINING' }),
    setBestFit: () => ({ type: 'SET_BEST_FIT' }),
  },

  initialize({ source, controls, recorder }) {
    const feature = source.feature ?? source.featureColumns?.[0] ?? 'x';
    const target = source.target ?? 'y';
    const points = source.points.map((point) => ({
      ...pointForModel(point, feature, target),
      id: point.id,
      membership: point.membership ?? 'unspecified',
      provenance: point.provenance ?? (source.kind === 'workspace-dataset' ? 'imported' : 'generated'),
    }));
    const derived = recomputeDerived(points);
    const train = trainingPoints(points);
    const test = testPoints(points);
    const initialBias = train.reduce((sum, point) => sum + point.y, 0) / train.length;
    const merged = {
      weight: 0,
      bias: initialBias,
      learningRate: 0.05,
      trainingSteps: 20,
      showResiduals: false,
      showBestFit: false,
      ...controls,
    };
    const normalization = fitLinearNormalization(train.map((point) => ({ x: [point.x], y: point.y })), 1);
    recorder.emit('data.loaded', { points: points.length, feature: source.feature, target: source.target });
    recorder.emit('split.created', {
      kind: test.length ? 'explicit-membership' : 'all-data',
      trainRows: train.length,
      testRows: test.length,
    });
    recorder.emit('normalization.fitted', {
      xMean: normalization.xMeans[0],
      xStd: normalization.xStds[0],
      yMean: normalization.yMean,
      yStd: normalization.yStd,
    });
    recorder.emit('regression.initialized', { weight: merged.weight, bias: merged.bias });
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
        feature,
        target,
        featureColumns: source.featureColumns ? [...source.featureColumns] : [feature],
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

  validateWorld(world) {
    return validateRegressionWorld(world);
  },

  applyWorld(modelState, world, { recorder }) {
    validateRegressionWorld(world);
    const feature = modelState.feature ?? world.metadata?.modelFeature ?? 'x';
    const target = modelState.target ?? world.metadata?.targetFeature ?? 'y';
    const points = world.observations.map((point) => ({
      ...pointForModel(point, feature, target),
      id: point.id,
      membership: point.membership,
      provenance: point.provenance,
    }));
    const derived = recomputeDerived(points);
    const train = trainingPoints(points);
    const test = testPoints(points);
    const next = clearTraining({ ...modelState, points, ...derived });
    recorder.emit('data.loaded', { points: points.length });
    recorder.emit('split.created', {
      kind: test.length ? 'explicit-membership' : 'all-data',
      trainRows: train.length,
      testRows: test.length,
    });
    const normalization = fitLinearNormalization(train.map((point) => ({ x: [point.x], y: point.y })), 1);
    recorder.emit('normalization.fitted', {
      xMean: normalization.xMeans[0],
      xStd: normalization.xStds[0],
      yMean: normalization.yMean,
      yStd: normalization.yStd,
    });
    emitLineUpdate(recorder, next);
    return { modelState: next, timeline: { step: 0, totalSteps: 0 } };
  },

  resetLearning(modelState, { recorder }) {
    const train = trainingPoints(modelState.points);
    const initialBias = train.reduce((sum, point) => sum + point.y, 0) / Math.max(1, train.length);
    const next = clearTraining({ ...modelState, weight: 0, bias: initialBias });
    emitLineUpdate(recorder, next);
    return {
      modelState: next,
      controls: { weight: 0, bias: initialBias },
      timeline: { step: 0, totalSteps: 0 },
    };
  },

  applyModelAction(modelState, action, { controls, recorder, runId = 'unknown-run', conditionFingerprint = 'unknown-condition' }) {
    if (action.type === 'SET_CONTROL' || action.type === 'SET_PARAMETERS') {
      if (action.key === 'weight' || action.type === 'SET_PARAMETERS') {
        const weight = action.type === 'SET_PARAMETERS' ? finiteOrNull(action.weight) : finiteOrNull(action.value);
        if (weight === null) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: 'weight' });
        const next = clearTraining({ ...modelState, weight });
        emitLineUpdate(recorder, next);
        return { controls: { weight }, modelState: next };
      }
      if (action.key === 'bias') {
        const bias = finiteOrNull(action.value);
        if (bias === null) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: 'bias' });
        const next = clearTraining({ ...modelState, bias });
        emitLineUpdate(recorder, next);
        return { controls: { bias }, modelState: next };
      }
      if (action.key === 'learningRate' || action.key === 'trainingSteps' || action.key === 'showResiduals' || action.key === 'showBestFit') {
        if (action.key === 'learningRate' || action.key === 'trainingSteps') {
          const next = clearTraining(modelState);
          emitLineUpdate(recorder, next);
          return { controls: { [action.key]: action.value }, modelState: next };
        }
        return { controls: { [action.key]: action.value } };
      }
      throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
    }
    if (action.type === 'SET_BEST_FIT') {
      const next = clearTraining({ ...modelState, weight: modelState.optimum.weight, bias: modelState.optimum.bias });
      recorder.emit('parameters.updated', { weight: next.weight, bias: next.bias });
      emitLineUpdate(recorder, next);
      return { controls: { weight: next.weight, bias: next.bias }, modelState: next };
    }
    if (action.type === 'START_TRAINING') {
      const points = trainingPoints(modelState.points).map(({ x, y }) => ({ x, y }));
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
      recorder.emit('normalization.fitted', {
        xMean: trainer.normalization.xMeans[0],
        xStd: trainer.normalization.xStds[0],
        yMean: trainer.normalization.yMean,
        yStd: trainer.normalization.yStd,
      });
      recorder.emit('regression.initialized', { weight: modelState.weight, bias: modelState.bias });
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
        const rawBefore = denormalizeLinearParameters({
          weights: current.weights,
          bias: current.bias,
          normalization: trainer.normalization,
        });
        const normalizedDelta = {
          weight: normalizedParameters.weights[0] - current.weights[0],
          bias: normalizedParameters.bias - current.bias,
        };
        const rawDelta = {
          weight: rawParameters.weights[0] - rawBefore.weights[0],
          bias: rawParameters.bias - rawBefore.bias,
        };
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
        recorder.emit('loss.measured', { step, loss: entry.loss, lossNormalized: entry.lossNormalized });
        recorder.emit('gradient.computed', {
          step,
          weight: next.gradient.weights[0],
          bias: next.gradient.bias,
          magnitude: next.gradient.magnitude,
        });
        history.push(entry);
        recorder.emit('training.step', {
          step,
          runId: String(runId),
          conditionFingerprint: String(conditionFingerprint),
          parameters: {
            before: { weight: rawBefore.weights[0], bias: rawBefore.bias },
            after: { weight: rawParameters.weights[0], bias: rawParameters.bias },
            normalizedBefore: { weight: current.weights[0], bias: current.bias },
            normalizedAfter: { weight: normalizedParameters.weights[0], bias: normalizedParameters.bias },
          },
          objective: {
            before: { lossNormalized: next.lossNormalized },
            after: { loss: entry.loss, lossNormalized: entry.lossNormalized },
          },
          gradients: {
            weight: next.gradient.weights[0],
            bias: next.gradient.bias,
            magnitude: next.gradient.magnitude,
            space: 'normalized',
          },
          update: {
            learningRate,
            space: 'normalized',
            delta: normalizedDelta,
            rawDelta,
          },
          outcome: lossGrew
            ? { status: 'stopped', stopReason: 'learning-rate-too-high' }
            : { status: 'applied' },
        });
        if (lossGrew) {
          stopReason = 'learning-rate-too-high';
          break;
        }
        previousLoss = next.nextLossNormalized;
        recorder.emit('parameters.updated', { step, weight: entry.weight, bias: entry.bias });
        current = { weights: normalizedParameters.weights, bias: normalizedParameters.bias };
      }
      if (stopReason) {
        recorder.emit('training.completed', {
          steps: history.length,
          requestedSteps: steps,
          stoppedReason: stopReason,
        });
      } else {
        recorder.emit('training.completed', { steps: history.length, requestedSteps: steps });
      }
      return {
        modelState: {
          ...modelState,
          training: {
            currentStep: 0,
            history,
            totalSteps: history.length,
            stopReason,
            normalization: trainer.normalization,
            runId: String(runId),
            conditionFingerprint: String(conditionFingerprint),
          },
        },
        timeline: { step: 0, totalSteps: history.length, speed: undefined },
      };
    }
    if (action.type === 'STEP' || action.type === 'SEEK') {
      const { training } = modelState;
      if (!training.history.length) return {};
      const target = action.type === 'SEEK' ? Math.round(action.step ?? 0) : training.currentStep + 1;
      const currentStep = Math.max(0, Math.min(target, training.totalSteps));
      const entry = training.history[Math.max(0, currentStep - 1)];
      const nextModel = entry
        ? { ...modelState, weight: entry.weight, bias: entry.bias, gradient: entry.gradient, training: { ...training, currentStep } }
        : { ...modelState, training: { ...training, currentStep } };
      if (entry) {
        recorder.emit('prediction.updated', { weight: entry.weight, bias: entry.bias });
        recorder.emit('residuals.computed', {
          count: trainingPoints(modelState.points).length,
          mse: meanSquaredError(trainingPoints(modelState.points), entry.weight, entry.bias),
        });
      }
      return {
        controls: { weight: nextModel.weight, bias: nextModel.bias },
        modelState: nextModel,
        timeline: { step: currentStep },
      };
    }
    return {};
  },

  deriveScene(modelState, { controls, source }) {
    const { points, ranges, optimum, weight, bias } = modelState;
    const train = trainingPoints(points);
    const test = testPoints(points);
    const gradient = sceneGradient(modelState.gradient) ?? regressionGradient(train, weight, bias);
    const prediction = (x) => weight * x + bias;
    const bestFitLine = {
      weight: optimum.weight,
      bias: optimum.bias,
      start: { x: ranges.xMin, y: optimum.weight * ranges.xMin + optimum.bias },
      end: { x: ranges.xMax, y: optimum.weight * ranges.xMax + optimum.bias },
    };
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
      bestFitLine,
      gradient,
      training: {
        currentStep: modelState.training.currentStep,
        totalSteps: modelState.training.totalSteps,
        lossHistory: modelState.training.history.slice(0, modelState.training.currentStep).map((entry) => entry.loss),
        parameterHistory: modelState.training.history.slice(0, modelState.training.currentStep).map((entry) => ({ weight: entry.weight, bias: entry.bias })),
        // Derived parameter trajectory (weight over steps) for the generic
        // parameter-trajectory primitive.
        parameterTrajectory: modelState.training.history.slice(0, modelState.training.currentStep).map((entry, index) => ({
          step: entry.step ?? index + 1,
          value: entry.weight,
        })),
      },
      ranges,
      scatterPoints: points.map(({ id, x, y, membership }) => ({
        id,
        x,
        y,
        membership,
        subset: membership === 'test' ? 'test' : 'train',
      })),
      residualPoints: points.map((point) => ({
        id: point.id,
        x: point.x,
        y: point.y,
        prediction: prediction(point.x),
        membership: point.membership,
        subset: point.membership === 'test' ? 'test' : 'train',
      })),
      axes: { x: modelState.feature ?? source?.feature ?? 'x', y: modelState.target ?? source?.target ?? 'y' },
    };
    const trainMse = meanSquaredError(train, weight, bias);
    const testMse = test.length ? meanSquaredError(test, weight, bias) : null;
    const mse = trainMse;
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
      metrics: { mse, trainMse, testMse },
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
        canPause: false,
        canStep: true,
        canSeek: training.totalSteps > 0,
        canReset: true,
        canEditData: true,
      },
    };
  },

};
