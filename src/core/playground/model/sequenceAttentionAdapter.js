import { playgroundError } from '../../playgrounds/session.js';

const SMOOTHING = 0.25;

function vocabulary(samples) {
  return [...new Set(samples.flatMap((sample) => sample.payload.tokens))].sort();
}

function tokenCounts(samples, tokens) {
  const counts = Object.fromEntries(tokens.map((token) => [token, 0]));
  samples.forEach((sample) => sample.payload.tokens.forEach((token) => { counts[token] += 1; }));
  return counts;
}

function fitTokenModel(samples) {
  const labels = [...new Set(samples.map((sample) => sample.label))].sort();
  const tokens = vocabulary(samples);
  const byLabel = Object.fromEntries(labels.map((label) => {
    const selected = samples.filter((sample) => sample.label === label);
    const counts = tokenCounts(selected, tokens);
    const total = selected.reduce((sum, sample) => sum + sample.payload.tokens.length, 0);
    return [label, Object.fromEntries(tokens.map((token) => [token, (counts[token] + SMOOTHING) / (total + tokens.length * SMOOTHING)]))];
  }));
  return { labels, tokens, byLabel };
}

function score(sample, label, tokenModel) {
  return sample.payload.tokens.reduce((sum, token) => sum + Math.log(tokenModel.byLabel[label]?.[token] ?? SMOOTHING), 0);
}

function predict(sample, tokenModel) {
  return tokenModel.labels
    .map((label) => ({ label, value: score(sample, label, tokenModel) }))
    .sort((left, right) => right.value - left.value)[0]?.label ?? null;
}

function accuracy(samples, tokenModel) {
  if (!samples.length) return null;
  return samples.filter((sample) => predict(sample, tokenModel) === sample.label).length / samples.length;
}

function attentionFor(sample, tokenModel) {
  const tokens = sample.payload.tokens;
  const labels = tokenModel.labels;
  const raw = tokens.map((token) => {
    const values = labels.map((label) => tokenModel.byLabel[label]?.[token] ?? 0);
    return Math.max(...values) - Math.min(...values);
  });
  const max = Math.max(...raw, 1e-9);
  const cells = [];
  tokens.forEach((token, row) => {
    tokens.forEach((_, column) => {
      cells.push({ row, column, value: row === column ? raw[row] / max : 0 });
    });
  });
  return { rows: Math.max(1, tokens.length), columns: Math.max(1, tokens.length), cells };
}

function deriveModelState(samples, controls, previous = {}) {
  const train = samples.filter((sample) => sample.membership !== 'test');
  const test = samples.filter((sample) => sample.membership === 'test');
  const tokenModel = fitTokenModel(train);
  const displaySample = test[0] ?? train[0];
  const attention = displaySample ? attentionFor(displaySample, tokenModel) : { rows: 1, columns: 1, cells: [] };
  return {
    samples,
    tokenModel,
    trainAccuracy: accuracy(train, tokenModel),
    testAccuracy: accuracy(test, tokenModel),
    training: previous.training ?? { currentStep: 0, totalSteps: 0, history: [] },
    tokens: displaySample?.payload.tokens ?? [],
    highlightedTokenIndexes: displaySample ? displaySample.payload.tokens.map((_, index) => index).filter((index) => attention.cells[index * attention.columns + index]?.value > 0.5) : [],
    attention,
    controls,
  };
}

function validateSequenceWorld(world) {
  if (world?.domain !== 'sequence' || world.task !== 'classification') {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { reason: 'sequence classifier requires a sequence classification World', reasonCode: 'world-task-incompatible' });
  }
  const train = world.observations.filter((observation) => observation.membership !== 'test');
  if (!train.length || train.some((observation) => observation.payload?.kind !== 'sequence' || !observation.label)) {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { reason: 'sequence classifier requires labeled training sequences', reasonCode: 'invalid-world' });
  }
  return world;
}

export const sequenceAttentionAdapter = {
  id: 'sequence-attention',
  domain: 'sequence',
  capabilities: {
    fit: true,
    predict: true,
    evaluate: true,
    traceFit: true,
    tracePredict: false,
    attention: true,
  },
  trainingMicroscopeCapabilities: {
    lossTrace: true,
    parameters: [],
    gradients: [],
    updates: false,
    preprocessing: ['token-normalization'],
  },
  defaultVisualizationPreset: 'sequence.intro',
  teachingCapabilities: {
    show_attention: {
      operationIntent: 'fit',
      visualEvidence: ['tokens', 'attention.cells'],
      runtimeEvidence: ['metrics'],
      traceEvidence: ['training.completed'],
    },
  },
  semanticSchema: {
    tokens: { type: 'array<string>', description: 'Finite tokens in the displayed sequence' },
    attention: { type: 'matrixState', description: 'Bounded deterministic token attention weights' },
    metrics: { type: 'metrics', description: 'Train and test sequence classification accuracy' },
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
  scriptOperationActions: { traceFit: () => ({ type: 'START_TRAINING' }) },

  initialize({ source, controls, recorder }) {
    const merged = { trainingSteps: 1, showAttention: true, ...controls };
    const modelState = deriveModelState(source.samples, merged);
    recorder.emit('data.loaded', { samples: source.samples.length, domain: 'sequence' });
    recorder.emit('split.created', {
      kind: 'explicit-membership',
      trainRows: source.samples.filter((sample) => sample.membership !== 'test').length,
      testRows: source.samples.filter((sample) => sample.membership === 'test').length,
    });
    recorder.emit('evaluation.completed', { trainAccuracy: modelState.trainAccuracy, testAccuracy: modelState.testAccuracy });
    return { controls: merged, modelState, totalSteps: 0 };
  },

  validateWorld(world) {
    return validateSequenceWorld(world);
  },

  applyModelAction(modelState, action, { controls, recorder }) {
    if (action.type === 'SET_CONTROL') {
      if (action.key === 'trainingSteps') {
        const value = Math.max(1, Math.min(20, Math.round(Number(action.value))));
        if (!Number.isFinite(value)) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
        return { controls: { trainingSteps: value }, modelState: { ...modelState, training: { currentStep: 0, totalSteps: 0, history: [] } } };
      }
      if (action.key === 'showAttention') return { controls: { showAttention: Boolean(action.value) } };
      throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
    }
    if (action.type === 'START_TRAINING') {
      const nextState = deriveModelState(modelState.samples, controls, { training: { currentStep: 0, totalSteps: Math.max(1, Math.round(controls.trainingSteps)), history: [] } });
      const history = Array.from({ length: nextState.training.totalSteps }, (_, index) => ({ step: index + 1, trainAccuracy: nextState.trainAccuracy, testAccuracy: nextState.testAccuracy }));
      recorder.emit('training.started', { totalSteps: history.length, domain: 'sequence' });
      recorder.emit('training.completed', { steps: history.length, requestedSteps: history.length, domain: 'sequence' });
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

  deriveScene(modelState) {
    return {
      scene: {
        tokens: modelState.tokens,
        highlightedTokenIndexes: modelState.highlightedTokenIndexes,
        attention: modelState.attention,
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
