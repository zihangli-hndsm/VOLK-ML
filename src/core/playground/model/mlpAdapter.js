import {
  computeMlpDecisionRegions,
  DEFAULT_MLP_SEED,
  forwardMlp,
  initMlpParameters,
  mlpLossForSamples,
  predictMlp,
  trainMlp,
} from './mlpMath.js';
import { createSplit, featureStats } from '../data/datasetAdapter.js';
import { playgroundError } from '../../playgrounds/session.js';

const DECISION_RESOLUTION = 48;
const finiteOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

// PR F.3: the MLP is feature-name agnostic. Samples are full feature vectors
// in featureColumns order; the 2D view projects xFeature/yFeature (normalized
// for workspace datasets, identity for the deterministic XOR example) and
// fixes hidden features at the normalized mean (0).
function identityNormalization(featureCount) {
  return { means: Array(featureCount).fill(0), stds: Array(featureCount).fill(1) };
}

function buildLabelMapping(samples) {
  const labels = [...new Set(samples.map((sample) => sample.label))].sort();
  const toIndex = Object.fromEntries(labels.map((label, index) => [label, index]));
  return { labels, toIndex };
}

function viewVector(modelState, x, y) {
  const { featureColumns, xFeature, yFeature, normalization } = modelState;
  const xi = featureColumns.indexOf(xFeature);
  const yi = featureColumns.indexOf(yFeature);
  const vector = featureColumns.map(() => 0);
  vector[xi] = (x - normalization.means[xi]) / normalization.stds[xi];
  vector[yi] = (y - normalization.means[yi]) / normalization.stds[yi];
  return vector;
}

function normalizedSample(modelState, sample) {
  return sample.x.map((value, index) => (
    (value - modelState.normalization.means[index]) / modelState.normalization.stds[index]
  ));
}

function viewRange(modelState) {
  const { points, featureColumns, xFeature, yFeature } = modelState;
  const xi = featureColumns.indexOf(xFeature);
  const yi = featureColumns.indexOf(yFeature);
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

function networkState(modelState, query) {
  const { params, hiddenSize } = modelState;
  const revealMode = modelState.mode === 'prediction';
  const revealed = revealMode ? modelState.revealed : hiddenSize;
  const vector = viewVector(modelState, query.x, query.y);
  const forward = forwardMlp(params, vector);
  const outputVisible = !revealMode || revealed >= hiddenSize;
  const nodes = [
    ...modelState.featureColumns.map((column, index) => ({
      id: `in-${index}`,
      layer: 0,
      label: column,
      value: vector[index],
    })),
    ...forward.a1.map((activation, index) => ({
      id: `h-${index}`,
      layer: 1,
      label: `h${index + 1}`,
      value: index < revealed ? activation : null,
    })),
    { id: 'out', layer: 2, label: 'ŷ', value: outputVisible ? forward.probability : null },
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

function trainAccuracy(modelState, params, samples) {
  const correct = samples.filter((sample) => (
    predictMlp(params, normalizedSample(modelState, sample)).label === sample.label
  )).length;
  return correct / Math.max(1, samples.length);
}

function refreshProjection(modelState, controls) {
  const decisionRegions = controls.showDecisionRegions
    ? computeMlpDecisionRegions({
      params: modelState.params,
      points: modelState.points,
      featureColumns: modelState.featureColumns,
      xFeature: modelState.xFeature,
      yFeature: modelState.yFeature,
      normalization: modelState.normalization,
      resolution: DECISION_RESOLUTION,
    })
    : null;
  return { ...modelState, decisionRegions };
}

function emitQueryTrace(recorder, modelState, controls) {
  const query = modelState.query;
  recorder.emit('query.received', { x: query.x, y: query.y });
  if (modelState.mode === 'prediction' && modelState.revealed >= modelState.hiddenSize) {
    const prediction = predictMlp(modelState.params, viewVector(modelState, query.x, query.y));
    recorder.emit('prediction.emitted', { label: prediction.label, hiddenUnits: modelState.hiddenSize });
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
    featureOptions: { type: 'array<string>', description: 'Available feature columns for the 2D view' },
    projection: { type: 'projection', description: '2D slice projection metadata' },
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
    const featureColumns = source.featureColumns;
    const samples = points.map((point, index) => ({
      id: point.id ?? index,
      x: featureColumns.map((column) => point.features[column]),
      label: point.label,
      y: point.label,
    }));
    const labelMapping = buildLabelMapping(samples);
    const workspace = source.kind === 'workspace-dataset';
    const split = workspace
      ? createSplit({ samples, trainRatio: source.trainRatio ?? 0.8, seed: seed ?? DEFAULT_MLP_SEED })
      : null;
    const trainSamples = split ? split.train : samples;
    const testSamples = split ? split.test : [];
    const normalization = workspace
      ? featureStats(trainSamples, featureColumns)
      : identityNormalization(featureColumns.length);
    const xFeature = featureColumns.includes(controls.xFeature) ? controls.xFeature : featureColumns[0];
    const yFeature = featureColumns.includes(controls.yFeature)
      ? controls.yFeature
      : featureColumns.find((column) => column !== xFeature) ?? featureColumns[0];
    const hiddenSize = Math.max(1, Math.round(controls.hiddenUnits ?? 3));
    const params = initMlpParameters({ hiddenSize, inputSize: featureColumns.length, seed: seed ?? DEFAULT_MLP_SEED });
    const state = {
      points,
      samples,
      trainSamples,
      testSamples,
      featureColumns,
      labelMapping,
      normalization,
      xFeature,
      yFeature,
      seed: seed ?? DEFAULT_MLP_SEED,
      params,
      hiddenSize,
      query: { x: 0, y: 0 },
      mode: null,
      revealed: 0,
      training: {
        initialParams: structuredClone(params),
        currentStep: 0,
        history: [],
        totalSteps: 0,
        stopReason: null,
      },
      decisionRegions: null,
    };
    const ranges = viewRange(state);
    state.query = {
      x: finiteOrNull(controls.queryX) ?? (ranges.xMin + ranges.xMax) / 2,
      y: finiteOrNull(controls.queryY) ?? (ranges.yMin + ranges.yMax) / 2,
    };
    recorder.emit('data.loaded', { points: points.length, features: featureColumns });
    if (workspace) {
      recorder.emit('split.created', {
        trainRows: trainSamples.length,
        testRows: testSamples.length,
        trainIds: trainSamples.map((sample) => sample.id),
        testIds: testSamples.map((sample) => sample.id),
      });
      recorder.emit('normalization.fitted', {
        means: normalization.means,
        stds: normalization.stds,
      });
    }
    recorder.emit('mlp.initialized', {
      hiddenSize,
      inputSize: featureColumns.length,
      outputSize: 1,
    });
    return {
      controls: {
        xFeature,
        yFeature,
        hiddenUnits: hiddenSize,
        learningRate: controls.learningRate ?? 0.5,
        trainingSteps: controls.trainingSteps ?? 50,
        queryX: state.query.x,
        queryY: state.query.y,
        showDecisionRegions: Boolean(controls.showDecisionRegions),
      },
      modelState: refreshProjection(state, controls),
      totalSteps: 0,
    };
  },

  applyModelAction(modelState, action, { controls, recorder }) {
    if (action.type === 'SET_CONTROL') {
      if (action.key === 'xFeature' || action.key === 'yFeature') {
        const nextFeature = action.value;
        if (!modelState.featureColumns.includes(nextFeature)) {
          throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key, value: nextFeature });
        }
        if (nextFeature === modelState[action.key]) return {};
        const next = { ...modelState, [action.key]: nextFeature };
        if (next.xFeature === next.yFeature) {
          next.yFeature = modelState.featureColumns.find((column) => column !== next.xFeature) ?? next.xFeature;
        }
        const ranges = viewRange(next);
        const query = { x: (ranges.xMin + ranges.xMax) / 2, y: (ranges.yMin + ranges.yMax) / 2 };
        return {
          controls: { xFeature: next.xFeature, yFeature: next.yFeature, queryX: query.x, queryY: query.y },
          modelState: refreshProjection({ ...next, query }, controls),
        };
      }
      if (action.key === 'hiddenUnits') {
        const hiddenSize = Math.max(1, Math.round(finiteOrNull(action.value) ?? modelState.hiddenSize));
        const params = initMlpParameters({
          hiddenSize,
          inputSize: modelState.featureColumns.length,
          seed: modelState.seed ?? DEFAULT_MLP_SEED,
        });
        recorder.emit('mlp.initialized', {
          hiddenSize,
          inputSize: modelState.featureColumns.length,
          outputSize: 1,
        });
        return {
          controls: { hiddenUnits: hiddenSize },
          modelState: refreshProjection({
            ...modelState,
            params,
            hiddenSize,
            revealed: 0,
            mode: null,
            training: {
              initialParams: structuredClone(params),
              currentStep: 0,
              history: [],
              totalSteps: 0,
              stopReason: null,
            },
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
      const samples = modelState.trainSamples.map((sample) => ({
        x: normalizedSample(modelState, sample),
        y: modelState.labelMapping.toIndex[sample.label],
      }));
      recorder.emit('mlp.initialized', {
        hiddenSize: modelState.hiddenSize,
        inputSize: modelState.featureColumns.length,
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
          mode: 'training',
          revealed: 0,
          training: {
            initialParams: structuredClone(modelState.params),
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
        const { history, initialParams } = modelState.training;
        if (!history.length) return {};
        const target = action.type === 'SEEK' ? Math.round(action.step ?? 0) : modelState.training.currentStep + 1;
        const currentStep = Math.max(0, Math.min(target, history.length));
        const params = currentStep === 0
          ? structuredClone(initialParams)
          : structuredClone(history[currentStep - 1].params);
        return {
          modelState: refreshProjection({
            ...modelState,
            params,
            training: { ...modelState.training, currentStep },
          }, controls),
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
          const prediction = predictMlp(modelState.params, viewVector(modelState, modelState.query.x, modelState.query.y));
          recorder.emit('prediction.emitted', { label: prediction.label, hiddenUnits: modelState.hiddenSize });
        }
        return { modelState: next, timeline: { step: revealed } };
      }
      return {};
    }
    return {};
  },

  deriveScene(modelState, { controls }) {
    const {
      points, params, query, training, mode, revealed, hiddenSize,
      featureColumns, xFeature, yFeature, trainSamples, testSamples, normalization,
    } = modelState;
    const xi = featureColumns.indexOf(xFeature);
    const yi = featureColumns.indexOf(yFeature);
    const historySlice = training.history.slice(0, training.currentStep);
    const trainingSamples = trainSamples.map((sample) => ({
      x: normalizedSample(modelState, sample),
      y: modelState.labelMapping.toIndex[sample.label],
    }));
    const currentLoss = historySlice.length
      ? historySlice.at(-1).loss
      : mlpLossForSamples(params, trainingSamples);
    const accuracy = trainAccuracy(modelState, params, trainSamples);
    const testAccuracy = testSamples.length
      ? trainAccuracy(modelState, params, testSamples)
      : null;
    const prediction = predictMlp(params, viewVector(modelState, query.x, query.y));
    const predictedLabel = mode === 'prediction' && revealed >= hiddenSize
      ? prediction.label
      : null;
    const ranges = viewRange(modelState);
    const trainIds = new Set(trainSamples.map((sample) => sample.id));
    const hiddenFeatures = featureColumns.filter((column) => column !== xFeature && column !== yFeature);
    const viewPoint = (point) => ({
      x: (point.features[xFeature] - normalization.means[xi]) / normalization.stds[xi],
      y: (point.features[yFeature] - normalization.means[yi]) / normalization.stds[yi],
    });
    const scene = {
      points: points.map((point) => ({
        id: point.id,
        ...viewPoint(point),
        label: point.label,
        subset: trainIds.has(point.id) ? 'train' : 'test',
      })),
      scatterPoints: points.map((point) => ({
        id: point.id,
        ...viewPoint(point),
        label: point.label,
      })),
      axes: { x: xFeature, y: yFeature },
      featureOptions: featureColumns,
      projection: {
        enabled: hiddenFeatures.length > 0,
        xFeature,
        yFeature,
        fixedFeatures: Object.fromEntries(hiddenFeatures.map((feature) => [feature, 0])),
      },
      ranges,
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
        ...(testAccuracy !== null ? { testAccuracy } : {}),
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
