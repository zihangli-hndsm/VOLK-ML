import { playgroundError } from '../../playgrounds/session.js';

// V1 keeps the image model intentionally small and deterministic: a fixed
// 2x2 mean convolution produces local features, then a prototype head learns
// one feature vector per label. The adapter owns this model math; the stage
// only receives the resulting feature map and metrics.
function convolutionFeatures(payload) {
  const { width, height, pixels } = payload;
  const features = [];
  for (let row = 0; row < height - 1; row += 1) {
    for (let column = 0; column < width - 1; column += 1) {
      const values = [
        pixels[row * width + column],
        pixels[row * width + column + 1],
        pixels[(row + 1) * width + column],
        pixels[(row + 1) * width + column + 1],
      ];
      features.push(values.reduce((sum, value) => sum + value, 0) / values.length);
    }
  }
  return features;
}

function prototypeFor(samples) {
  const first = samples[0]?.payload;
  if (!first) return [];
  const featureVectors = samples.map((sample) => convolutionFeatures(sample.payload));
  return Array.from({ length: featureVectors[0].length }, (_, index) => (
    featureVectors.reduce((sum, vector) => sum + vector[index], 0) / featureVectors.length
  ));
}

function squaredDistance(left, right) {
  return left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);
}

function targetPrototypes(samples) {
  const labels = [...new Set(samples.map((sample) => sample.label))].sort();
  return Object.fromEntries(labels.map((label) => [label, prototypeFor(samples.filter((sample) => sample.label === label))]));
}

function fitPrototypes(samples, { steps = 1, learningRate = 1, evaluate = null } = {}) {
  const targets = targetPrototypes(samples);
  const labels = Object.keys(targets);
  const size = labels[0] ? targets[labels[0]].length : 0;
  let prototypes = Object.fromEntries(labels.map((label) => [label, Array.from({ length: size }, () => 0)]));
  const history = [];
  for (let step = 0; step < Math.max(1, steps); step += 1) {
    prototypes = Object.fromEntries(labels.map((label) => [label, targets[label].map((target, index) => (
      prototypes[label][index] + (target - prototypes[label][index]) * learningRate
    ))]));
    history.push({
      step: step + 1,
      trainAccuracy: accuracy(samples, prototypes),
      testAccuracy: typeof evaluate === 'function' ? evaluate(prototypes) : null,
    });
  }
  return { prototypes, history };
}

function predict(sample, prototypes) {
  const entries = Object.entries(prototypes);
  if (!entries.length) return null;
  const features = convolutionFeatures(sample.payload);
  return entries.sort((left, right) => squaredDistance(features, left[1]) - squaredDistance(features, right[1]))[0][0];
}

function accuracy(samples, prototypes) {
  if (!samples.length) return null;
  const correct = samples.filter((sample) => predict(sample, prototypes) === sample.label).length;
  return correct / samples.length;
}

function featureMap(sample) {
  const { width, height, pixels } = sample.payload;
  const cells = [];
  for (let row = 0; row < height - 1; row += 1) {
    for (let column = 0; column < width - 1; column += 1) {
      const values = [
        pixels[row * width + column],
        pixels[row * width + column + 1],
        pixels[(row + 1) * width + column],
        pixels[(row + 1) * width + column + 1],
      ];
      cells.push({ row, column, value: values.reduce((sum, value) => sum + value, 0) / values.length });
    }
  }
  return { rows: Math.max(1, height - 1), columns: Math.max(1, width - 1), cells };
}

function validateImageWorld(world) {
  if (world?.domain !== 'image' || world.task !== 'classification') {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { reason: 'image classifier requires an image classification World', reasonCode: 'world-task-incompatible' });
  }
  if (!world.observations.some((observation) => observation.membership !== 'test')) {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { reason: 'image classifier requires training images' });
  }
  return world;
}

function deriveModelState(samples, controls, previous = {}) {
  const train = samples.filter((sample) => sample.membership !== 'test');
  const test = samples.filter((sample) => sample.membership === 'test');
  const fitted = fitPrototypes(train, {
    steps: Math.max(1, Math.min(20, Math.round(Number(controls.trainingSteps) || 1))),
    learningRate: Math.max(0.05, Math.min(1, Number(controls.learningRate) || 1)),
    evaluate: (prototypes) => accuracy(test, prototypes),
  });
  const prototypes = fitted.prototypes;
  return {
    samples,
    prototypes,
    trainAccuracy: accuracy(train, prototypes),
    testAccuracy: accuracy(test, prototypes),
    training: previous.training ?? { currentStep: 0, totalSteps: 0, history: [] },
    trainingHistory: fitted.history,
    featureMap: samples[0] ? featureMap(samples[0]) : { rows: 1, columns: 1, cells: [] },
    imageSamples: samples.map((sample) => ({
      id: sample.id,
      label: sample.label,
      width: sample.payload.width,
      height: sample.payload.height,
      pixels: [...sample.payload.pixels],
    })),
    controls,
  };
}

export const imageCnnAdapter = {
  id: 'image-cnn',
  domain: 'image',
  capabilities: {
    fit: true,
    predict: true,
    evaluate: true,
    traceFit: true,
    tracePredict: false,
    imageFeatures: true,
    learningRate: true,
  },
  trainingMicroscopeCapabilities: {
    lossTrace: true,
    parameters: [],
    gradients: [],
    updates: false,
    preprocessing: ['image-normalization'],
  },
  defaultVisualizationPreset: 'image.intro',
  teachingCapabilities: {
    show_training: {
      operationIntent: 'fit',
      visualEvidence: ['imageSamples', 'featureMap.cells'],
      runtimeEvidence: ['metrics'],
      traceEvidence: ['training.completed'],
    },
  },
  semanticSchema: {
    imageSamples: { type: 'array<imageSample>', description: 'Finite normalized images in the current train/test condition' },
    imageGrid: { type: 'object', description: 'Image-grid layout metadata' },
    featureMap: { type: 'matrixState', description: 'Deterministic local feature response map' },
    metrics: { type: 'metrics', description: 'Train and test image classification accuracy' },
  },
  scriptOperations: {
    traceFit: {
      intent: 'fit',
      args: {},
      effects: ['training.started', 'prediction.changed'],
      alwaysProducesTrace: ['data.loaded', 'split.created', 'training.completed'],
      mayProduceTrace: ['evaluation.completed'],
      enablesTrace: [],
      playback: { revealCountControl: 'trainingSteps' },
    },
  },
  scriptOperationActions: {
    traceFit: () => ({ type: 'START_TRAINING' }),
  },

  initialize({ source, controls, recorder }) {
    const merged = { trainingSteps: 1, learningRate: 1, showFeatureMap: true, ...controls };
    const modelState = deriveModelState(source.samples, merged);
    recorder.emit('data.loaded', { samples: source.samples.length, domain: 'image' });
    recorder.emit('split.created', {
      kind: 'explicit-membership',
      trainRows: source.samples.filter((sample) => sample.membership !== 'test').length,
      testRows: source.samples.filter((sample) => sample.membership === 'test').length,
    });
    recorder.emit('evaluation.completed', { trainAccuracy: modelState.trainAccuracy, testAccuracy: modelState.testAccuracy });
    return { controls: merged, modelState, totalSteps: 0 };
  },

  validateWorld(world) {
    return validateImageWorld(world);
  },

  applyModelAction(modelState, action, { controls, recorder }) {
    if (action.type === 'SET_CONTROL') {
      if (action.key === 'trainingSteps') {
        const value = Math.max(1, Math.min(20, Math.round(Number(action.value))));
        if (!Number.isFinite(value)) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
        return { controls: { trainingSteps: value }, modelState: { ...modelState, training: { currentStep: 0, totalSteps: 0, history: [] } } };
      }
      if (action.key === 'learningRate') {
        const value = Number(action.value);
        if (!Number.isFinite(value) || value < 0.05 || value > 1) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
        const nextControls = { ...controls, learningRate: value };
        return { controls: { learningRate: value }, modelState: deriveModelState(modelState.samples, nextControls, { training: { currentStep: 0, totalSteps: 0, history: [] } }) };
      }
      if (action.key === 'showFeatureMap') return { controls: { showFeatureMap: Boolean(action.value) } };
      throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
    }
    if (action.type === 'START_TRAINING') {
      const nextState = deriveModelState(modelState.samples, controls, {
        training: { currentStep: 0, totalSteps: Math.max(1, Math.round(controls.trainingSteps)), history: [] },
      });
      const history = nextState.trainingHistory.slice(0, nextState.training.totalSteps);
      recorder.emit('training.started', { totalSteps: history.length, domain: 'image' });
      recorder.emit('training.completed', { steps: history.length, requestedSteps: history.length, domain: 'image' });
      recorder.emit('evaluation.completed', { trainAccuracy: nextState.trainAccuracy, testAccuracy: nextState.testAccuracy });
      return { modelState: { ...nextState, training: { ...nextState.training, history } }, timeline: { step: 0, totalSteps: history.length } };
    }
    if (action.type === 'STEP' || action.type === 'SEEK') {
      const target = action.type === 'SEEK' ? Math.round(action.step ?? 0) : modelState.training.currentStep + 1;
      const currentStep = Math.max(0, Math.min(target, modelState.training.totalSteps));
      return { modelState: { ...modelState, training: { ...modelState.training, currentStep } }, timeline: { step: currentStep, totalSteps: modelState.training.totalSteps } };
    }
    return {};
  },

  deriveScene(modelState, { controls }) {
    return {
      scene: {
        imageSamples: modelState.imageSamples,
        imageGrid: { columns: Math.min(4, Math.max(1, Math.ceil(Math.sqrt(modelState.imageSamples.length)))) },
        featureMap: modelState.featureMap,
      },
      metrics: {
        trainAccuracy: modelState.trainAccuracy,
        testAccuracy: modelState.testAccuracy,
        accuracy: modelState.testAccuracy ?? modelState.trainAccuracy,
      },
      observation: null,
      formula: null,
      capabilities: {
        canPlay: true,
        canPause: false,
        canStep: modelState.training.totalSteps > 0,
        canSeek: modelState.training.totalSteps > 0,
        canReset: true,
        canEditData: false,
      },
    };
  },
};
