import {
  computeMlpDecisionRegions,
  DEFAULT_MLP_SEED,
  forwardMlp,
  initMlpParameters,
  mlpLossForSamples,
  predictMlp,
  trainMlp,
} from './mlpMath.js';
import { playgroundError } from '../../playgrounds/session.js';

const DECISION_RESOLUTION = 48;
const finiteOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

function networkState(modelState, query) {
  const { params, hiddenSize } = modelState;
  const revealed = modelState.mode === 'prediction' ? modelState.revealed : hiddenSize;
  const forward = forwardMlp(params, [query.x, query.y]);
  const nodes = [
    { id: 'in-0', layer: 0, label: 'x1', value: query.x },
    { id: 'in-1', layer: 0, label: 'x2', value: query.y },
    ...forward.a1.map((activation, index) => ({
      id: `h-${index}`,
      layer: 1,
      label: `h${index + 1}`,
      value: index < revealed ? activation : null,
    })),
    { id: 'out', layer: 2, label: 'ŷ', value: forward.probability },
  ];
  const edges = [
    ...params.W1.map((row, hidden) => row.map((weight, input) => ({
      source: `in-${input}`,
      target: `h-${hidden}`,
      weight,
    }))).flat(),
    ...params.W2[0].map((weight, hidden) => ({
      source: `h-${hidden}`,
      target: 'out',
      weight,
    })),
  ];
  return { nodes, edges, hidden: forward.a1 };
}

function matrixState(params) {
  return {
    rows: params.W1.length,
    columns: params.W1[0].length,
    cells: params.W1.flatMap((row, rowIndex) => row.map((value, column) => ({
      row: rowIndex,
      column,
      value,
      label: `w${rowIndex + 1}${column + 1}`,
    }))),
  };
}

// Weight-magnitude histogram with 8 fixed bins over all current weights.
function histogramState(params) {
  const values = [...params.W1.flat(), ...params.W2.flat(), params.b2].map(Math.abs);
  const max = Math.max(1e-9, ...values);
  const binCount = 8;
  const bins = Array.from({ length: binCount }, (_, index) => {
    const start = (index / binCount) * max;
    const end = ((index + 1) / binCount) * max;
    return {
      start,
      end,
      count: values.filter((value) => value >= start && (index === binCount - 1 ? value <= end : value < end)).length,
    };
  });
  return { bins };
}

function trainAccuracy(params, samples) {
  const correct = samples.filter((sample) => predictMlp(params, sample.x).label === sample.label).length;
  return correct / Math.max(1, samples.length);
}

function refreshProjection(modelState, controls) {
  const decisionRegions = controls.showDecisionRegions
    ? computeMlpDecisionRegions({
      params: modelState.params,
      points: modelState.points,
      resolution: DECISION_RESOLUTION,
    })
    : null;
  return { ...modelState, decisionRegions };
}

function emitQueryTrace(recorder, modelState, controls) {
  const query = modelState.query;
  recorder.emit('query.received', { x: query.x, y: query.y });
  if (modelState.mode === 'prediction' && modelState.revealed >= modelState.hiddenSize) {
    const prediction = predictMlp(modelState.params, [query.x, query.y]);
    recorder.emit('prediction.emitted', { label: prediction.label, k: modelState.hiddenSize });
  }
}

export const mlpAdapter = {
  id: 'mlp',
  capabilities: {
    fit: true,
    predict: true,
    evaluate: true,
    traceFit: true,
    tracePredict: true,
    decisionSurface: true,
  },
  defaultVisualizationPreset: 'mlp.intro',
  // Declarative teaching capabilities (PR F.1): the MLP owns its evidence
  // contract, the generic taxonomy/fidelity layers never special-case it.
  teachingCapabilities: {
    show_training: {
      operationIntent: 'fit',
      visualEvidence: ['scatterPoints', 'training.lossHistory', 'training.parameterTrajectory', 'network.nodes', 'matrix.cells'],
      runtimeEvidence: ['training.parameterHistory', 'metrics'],
      traceEvidence: ['training.completed'],
    },
    explain_prediction: {
      operationIntent: 'predict',
      visualEvidence: ['scatterPoints', 'decisionRegions.cells', 'network.nodes', 'network.edges'],
      runtimeEvidence: ['metrics.predictedLabel'],
      traceEvidence: ['prediction.emitted'],
    },
  },
  semanticSchema: {
    scatterPoints: { type: 'array<classifiedPoint2d>', description: 'Training points in the 2D feature view' },
    axes: { type: 'axes2d', description: 'Axis labels for the plot' },
    decisionRegions: { type: 'decisionRegion', description: '2D decision region grid of the trained network' },
    training: { type: 'trainingState', description: 'Training progress, loss history and parameter trajectory' },
    network: { type: 'networkState', description: 'Layered network graph with current activations' },
    matrix: { type: 'matrixState', description: 'Weight matrix grid' },
    histogram: { type: 'histogramState', description: 'Weight magnitude histogram' },
    metrics: { type: 'metrics', description: 'Loss, accuracy and prediction metrics' },
    observation: { type: 'observation', description: 'Teaching observation' },
  },
  scriptOperations: {
    traceFit: {
      intent: 'fit',
      args: {},
      effects: ['training.started', 'parameters.changed'],
      alwaysProducesTrace: ['mlp.initialized', 'training.completed'],
      mayProduceTrace: ['loss.measured', 'gradient.computed', 'parameters.updated'],
      enablesTrace: [],
      // Declarative playback policy: revealing `trainingSteps` times reaches
      // the completed training evidence state.
      playback: { revealCountControl: 'trainingSteps' },
    },
    tracePredict: {
      intent: 'predict',
      args: {},
      effects: ['prediction.started'],
      alwaysProducesTrace: ['query.received'],
      mayProduceTrace: ['prediction.emitted'],
      // Hidden-unit activations are revealed by later STEP actions.
      enablesTrace: ['mlp.hiddenActivated', 'prediction.emitted'],
      // Declarative playback policy: revealing `hiddenUnits` times reaches
      // the completed prediction evidence state.
      playback: { revealCountControl: 'hiddenUnits' },
    },
  },
  scriptOperationActions: {
    traceFit: () => ({ type: 'START_TRAINING' }),
    tracePredict: () => ({ type: 'START_PREDICT' }),
  },

  initialize({ source, controls, seed, recorder }) {
    const points = source.points.map((point) => ({
      id: point.id,
      features: { ...point.features },
      label: point.label,
    }));
    const samples = points.map((point) => ({
      id: point.id,
      x: [point.features.x1, point.features.x2],
      label: point.label,
    }));
    const merged = {
      hiddenUnits: 3,
      learningRate: 0.5,
      trainingSteps: 50,
      queryX: 1,
      queryY: -1,
      showDecisionRegions: false,
      ...controls,
    };
    const hiddenSize = Math.max(1, Math.round(merged.hiddenUnits));
    const params = initMlpParameters({ hiddenSize, seed: seed ?? DEFAULT_MLP_SEED });
    const query = {
      x: finiteOrNull(merged.queryX) ?? 1,
      y: finiteOrNull(merged.queryY) ?? -1,
    };
    const state = {
      points,
      samples,
      seed: seed ?? DEFAULT_MLP_SEED,
      params,
      hiddenSize,
      query,
      mode: null,
      revealed: 0,
      training: { currentStep: 0, history: [], totalSteps: 0, stopReason: null },
      decisionRegions: null,
    };
    recorder.emit('data.loaded', { points: points.length, features: ['x1', 'x2'] });
    recorder.emit('mlp.initialized', { hiddenSize, inputSize: 2, outputSize: 1 });
    return {
      controls: {
        hiddenUnits: hiddenSize,
        learningRate: merged.learningRate,
        trainingSteps: merged.trainingSteps,
        queryX: query.x,
        queryY: query.y,
        showDecisionRegions: Boolean(merged.showDecisionRegions),
      },
      modelState: refreshProjection(state, merged),
      totalSteps: 0,
    };
  },

  applyModelAction(modelState, action, { controls, recorder }) {
    if (action.type === 'SET_CONTROL') {
      if (action.key === 'hiddenUnits') {
        const hiddenSize = Math.max(1, Math.round(finiteOrNull(action.value) ?? modelState.hiddenSize));
        const params = initMlpParameters({ hiddenSize, seed: modelState.seed ?? DEFAULT_MLP_SEED });
        recorder.emit('mlp.initialized', { hiddenSize, inputSize: 2, outputSize: 1 });
        return {
          controls: { hiddenUnits: hiddenSize },
          modelState: refreshProjection({
            ...modelState,
            params,
            hiddenSize,
            revealed: 0,
            mode: null,
            training: { currentStep: 0, history: [], totalSteps: 0, stopReason: null },
          }, controls),
          timeline: { totalSteps: 0, step: 0 },
        };
      }
      if (action.key === 'learningRate' || action.key === 'trainingSteps') {
        return { controls: { [action.key]: action.value } };
      }
      if (action.key === 'queryX' || action.key === 'queryY') {
        const value = finiteOrNull(action.value);
        if (value === null) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
        const query = { ...modelState.query, [action.key === 'queryX' ? 'x' : 'y']: value };
        const next = { ...modelState, query };
        emitQueryTrace(recorder, next, controls);
        return { controls: { [action.key]: value }, modelState: next };
      }
      if (action.key === 'showDecisionRegions') {
        const value = Boolean(action.value);
        return {
          controls: { [action.key]: value },
          modelState: refreshProjection(modelState, { ...controls, [action.key]: value }),
        };
      }
      throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
    }
    if (action.type === 'START_TRAINING') {
      const steps = Math.max(1, Math.round(controls.trainingSteps));
      const learningRate = Number(controls.learningRate);
      const samples = modelState.samples.map((sample) => ({
        x: [sample.x[0], sample.x[1]],
        y: sample.label === 'b' ? 1 : 0,
      }));
      recorder.emit('mlp.initialized', {
        hiddenSize: modelState.hiddenSize,
        inputSize: 2,
        outputSize: 1,
      });
      const result = trainMlp({
        samples,
        params: modelState.params,
        learningRate,
        steps,
        seed: modelState.seed ?? DEFAULT_MLP_SEED,
      });
      for (const entry of result.history) {
        recorder.emit('loss.measured', { step: entry.step, loss: entry.loss });
        recorder.emit('gradient.computed', { step: entry.step, magnitude: entry.gradientMagnitude });
        recorder.emit('parameters.updated', { step: entry.step, weight: entry.weight, bias: entry.bias });
      }
      if (result.stopReason) {
        recorder.emit('training.completed', {
          steps: result.history.length,
          requestedSteps: steps,
          stoppedReason: result.stopReason,
        });
      } else {
        recorder.emit('training.completed', { steps: result.history.length, requestedSteps: steps });
      }
      return {
        modelState: {
          ...modelState,
          params: result.params,
          mode: 'training',
          revealed: 0,
          training: {
            currentStep: 0,
            history: result.history,
            totalSteps: result.history.length,
            stopReason: result.stopReason,
          },
        },
        timeline: { step: 0, totalSteps: result.history.length },
      };
    }
    if (action.type === 'START_PREDICT') {
      recorder.emit('query.received', { x: modelState.query.x, y: modelState.query.y });
      return {
        modelState: {
          ...modelState,
          mode: 'prediction',
          revealed: 0,
        },
        timeline: { step: 0, totalSteps: modelState.hiddenSize },
      };
    }
    if (action.type === 'STEP' || action.type === 'SEEK') {
      if (modelState.mode === 'training') {
        const { history } = modelState.training;
        if (!history.length) return {};
        const target = action.type === 'SEEK' ? Math.round(action.step ?? 0) : modelState.training.currentStep + 1;
        const currentStep = Math.max(0, Math.min(target, history.length));
        return {
          modelState: {
            ...modelState,
            training: { ...modelState.training, currentStep },
          },
          timeline: { step: currentStep },
        };
      }
      if (modelState.mode === 'prediction') {
        const target = action.type === 'SEEK' ? Math.round(action.step ?? 0) : modelState.revealed + 1;
        const revealed = Math.max(0, Math.min(target, modelState.hiddenSize));
        const next = { ...modelState, revealed };
        if (revealed > modelState.revealed) {
          const { hidden } = networkState(modelState, modelState.query);
          recorder.emit('mlp.hiddenActivated', {
            index: revealed - 1,
            activation: hidden[revealed - 1] ?? 0,
          });
        }
        if (revealed >= modelState.hiddenSize) {
          const prediction = predictMlp(modelState.params, [modelState.query.x, modelState.query.y]);
          recorder.emit('prediction.emitted', { label: prediction.label, k: modelState.hiddenSize });
        }
        return { modelState: next, timeline: { step: revealed } };
      }
      return {};
    }
    return {};
  },

  deriveScene(modelState, { controls }) {
    const { points, params, query, training, mode, revealed, hiddenSize } = modelState;
    const historySlice = training.history.slice(0, training.currentStep);
    const currentLoss = historySlice.length
      ? historySlice.at(-1).loss
      : mlpLossForSamples(params, modelState.samples.map((sample) => ({
        x: [sample.x[0], sample.x[1]],
        y: sample.label === 'b' ? 1 : 0,
      })));
    const accuracy = trainAccuracy(params, modelState.samples);
    const prediction = predictMlp(params, [query.x, query.y]);
    const predictedLabel = mode === 'prediction' && revealed >= hiddenSize
      ? prediction.label
      : null;
    const scene = {
      points: points.map((point) => ({
        id: point.id,
        x: point.features.x1,
        y: point.features.x2,
        label: point.label,
        subset: 'train',
      })),
      scatterPoints: points.map((point) => ({
        id: point.id,
        x: point.features.x1,
        y: point.features.x2,
        label: point.label,
      })),
      axes: { x: 'x1', y: 'x2' },
      decisionRegions: {
        enabled: Boolean(controls.showDecisionRegions),
        resolution: DECISION_RESOLUTION,
        cells: modelState.decisionRegions?.cells ?? [],
      },
      training: {
        currentStep: training.currentStep,
        totalSteps: training.totalSteps,
        lossHistory: historySlice.map((entry) => entry.loss),
        parameterHistory: historySlice.map((entry) => ({ step: entry.step, weight: entry.weight, bias: entry.bias })),
        parameterTrajectory: historySlice.map((entry) => ({ step: entry.step, value: entry.weight })),
      },
      network: networkState(modelState, query),
      matrix: matrixState(params),
      histogram: histogramState(params),
      metrics: {
        loss: currentLoss,
        accuracy,
        revealed: mode === 'prediction' ? revealed : training.currentStep,
        predictedLabel,
      },
    };
    let observation = {
      titleKey: 'playground.mlp.observation.intro',
      bodyKey: 'playground.mlp.observation.introBody',
      params: { hidden: hiddenSize, points: points.length },
    };
    if (training.stopReason && training.currentStep > 0 && training.currentStep >= training.totalSteps) {
      observation = training.stopReason === 'learning-rate-too-high'
        ? {
          titleKey: 'playground.mlp.observation.lrTooHigh',
          bodyKey: 'playground.mlp.observation.lrTooHighBody',
          params: { step: historySlice.at(-1)?.step ?? 1, loss: historySlice.at(-1)?.loss.toExponential(3) ?? '∞' },
        }
        : {
          titleKey: 'playground.mlp.observation.diverged',
          bodyKey: 'playground.mlp.observation.divergedBody',
          params: {},
        };
    } else if (mode === 'training' && training.currentStep > 0 && training.currentStep < training.totalSteps) {
      const entry = historySlice.at(-1);
      observation = {
        titleKey: 'playground.mlp.observation.trainingStep',
        bodyKey: 'playground.mlp.observation.trainingStepBody',
        params: { step: entry.step, loss: entry.loss.toFixed(4), magnitude: entry.gradientMagnitude.toFixed(4) },
      };
    } else if (mode === 'prediction' && revealed >= hiddenSize) {
      observation = {
        titleKey: 'playground.mlp.observation.prediction',
        bodyKey: 'playground.mlp.observation.predictionBody',
        params: { label: prediction.label, probability: prediction.probability.toFixed(3) },
      };
    } else if (controls.showDecisionRegions) {
      observation = {
        titleKey: 'playground.mlp.observation.decisionRegions',
        bodyKey: 'playground.mlp.observation.decisionRegionsBody',
        params: { accuracy: accuracy.toFixed(3) },
      };
    } else if (mode === 'prediction' && revealed > 0) {
      observation = {
        titleKey: 'playground.mlp.observation.hiddenReveal',
        bodyKey: 'playground.mlp.observation.hiddenRevealBody',
        params: { revealed, hidden: hiddenSize },
      };
    }
    return {
      scene,
      metrics: scene.metrics,
      observation,
      formula: null,
      capabilities: {
        canPlay: true,
        canPause: false,
        canStep: true,
        canSeek: training.totalSteps > 0 || mode === 'prediction',
        canReset: true,
        canEditData: false,
      },
    };
  },
};
