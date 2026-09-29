import assert from 'node:assert/strict';
import {
  assessExecutionCapabilityV1,
  createExecutionRequestV1,
} from '../src/core/execution/executionContract.js';
import {
  assessBrowserWebGpuMlpTraining,
  BROWSER_WEBGPU_MLP_ORACLE_ENVELOPE,
  BROWSER_WEBGPU_MLP_TRAINING_LIMITS,
  BROWSER_WEBGPU_MLP_TRAINING_PROVIDER_VERSION,
  trainBrowserWebGpuMlp,
} from '../src/core/execution/browserWebGpuMlpTraining.js';
import {
  compareWithFixedEnvelope,
  initializeOracleParameters,
  oracleMlpMicroBatch,
  TRAINING_ORACLE_ENVELOPE,
} from './webgpu-mlp-float64-oracle.mjs';

const mockGpu = { requestAdapter: async () => null };
const regressionArchitecture = {
  inputSize: 1,
  modelNodeId: 'mlp-output',
  layers: [
    { op: 'dense', input_features: 1, units: 1, use_bias: true },
  ],
};
const regressionRows = [
  { index: 0, x: [-1], y: -1 },
  { index: 1, x: [0], y: 0 },
  { index: 2, x: [1], y: 1 },
  { index: 3, x: [2], y: 2 },
];
const regressionInput = {
  architecture: regressionArchitecture,
  split: {
    dataset: { task: 'regression', featureColumns: ['x'], targetColumn: 'y' },
    train: regressionRows,
    test: [],
  },
  loss: { op: 'mse_loss' },
  optimizer: { op: 'sgd_optimizer', learning_rate: 0.01, momentum: 0.4 },
  trainer: { id: 'trainer', epochs: 3, batch_size: 2, shuffle: true },
};

const assessed = assessBrowserWebGpuMlpTraining(regressionInput, mockGpu);
assert.equal(assessed.supported, true, 'the bounded registered MLP training profile preflights');
assert.equal(assessed.estimate.trainingSteps, 6, 'preflight counts all bounded optimizer steps');
assert.equal(assessed.estimate.parameters, 2, 'weight and bias are both bounded parameters');
assert.equal(assessBrowserWebGpuMlpTraining(regressionInput, null).reason, 'WEBGPU_UNAVAILABLE');
assert.equal(BROWSER_WEBGPU_MLP_ORACLE_ENVELOPE.absolute, 1e-5);
assert.equal(BROWSER_WEBGPU_MLP_ORACLE_ENVELOPE.relative, 5e-4);
assert.deepEqual(BROWSER_WEBGPU_MLP_ORACLE_ENVELOPE, TRAINING_ORACLE_ENVELOPE,
  'the production-advertised and independent oracle envelopes remain exactly fixed');
assert.equal(BROWSER_WEBGPU_MLP_TRAINING_LIMITS.durationMs, 120_000);
assert.equal(BROWSER_WEBGPU_MLP_TRAINING_LIMITS.allocatedBytes, 64 * 1024 * 1024);
assert.equal(BROWSER_WEBGPU_MLP_TRAINING_PROVIDER_VERSION, 'browser-webgpu-mlp-training-wgsl-v1');
assert.equal(compareWithFixedEnvelope([2.001], [2]), true, 'the exact fixed tolerance accepts an in-envelope value');
assert.equal(compareWithFixedEnvelope([2.00102], [2]), false, 'the exact fixed tolerance rejects an out-of-envelope value');
assert.equal(compareWithFixedEnvelope([2], [2], { relative: 1 }), true,
  'extra caller options cannot widen the declared parity tolerance');

const tooManyEpochs = {
  ...regressionInput,
  trainer: { ...regressionInput.trainer, epochs: BROWSER_WEBGPU_MLP_TRAINING_LIMITS.epochs + 1 },
};
assert.equal(assessBrowserWebGpuMlpTraining(tooManyEpochs, mockGpu).reason, 'WEBGPU_TRAINING_LIMIT_EXCEEDED');
const wrongTaskLoss = { ...regressionInput, loss: { op: 'cross_entropy_loss' } };
assert.equal(assessBrowserWebGpuMlpTraining(wrongTaskLoss, mockGpu).reason, 'WEBGPU_TRAINING_TASK_INVALID');
const unboundedLearningRate = {
  ...regressionInput,
  optimizer: { ...regressionInput.optimizer, learning_rate: 0.5001 },
};
assert.equal(assessBrowserWebGpuMlpTraining(unboundedLearningRate, mockGpu).reason, 'WEBGPU_TRAINING_CONFIG_INVALID');
const nonFiniteRows = {
  ...regressionInput,
  split: { ...regressionInput.split, train: [{ x: [Number.NaN], y: 0 }, ...regressionRows.slice(1)] },
};
assert.equal(assessBrowserWebGpuMlpTraining(nonFiniteRows, mockGpu).reason, 'WEBGPU_TRAINING_NON_FINITE_INPUT');
const unknownOperation = {
  ...regressionInput,
  architecture: { ...regressionArchitecture, layers: [{ op: 'attention' }] },
};
assert.equal(assessBrowserWebGpuMlpTraining(unknownOperation, mockGpu).reason, 'WEBGPU_TRAINING_OPERATION_UNSUPPORTED');
const badShape = {
  ...regressionInput,
  architecture: { ...regressionArchitecture, layers: [{ op: 'dense', input_features: 2, units: 1, use_bias: true }] },
};
assert.equal(assessBrowserWebGpuMlpTraining(badShape, mockGpu).reason, 'WEBGPU_TRAINING_SHAPE_INVALID');
await assert.rejects(
  trainBrowserWebGpuMlp({ ...regressionInput, gpu: mockGpu }),
  (error) => error.code === 'WEBGPU_ADAPTER_UNAVAILABLE',
  'unavailable WebGPU fails explicitly instead of silently falling back to CPU fitting',
);

const simpleArchitecture = {
  inputSize: 1,
  layers: [{ op: 'dense', input_features: 1, units: 1, use_bias: true }],
};
const simpleRows = [{ x: [1], y: 3 }];
const simpleStep = oracleMlpMicroBatch({
  architecture: simpleArchitecture,
  parameters: [1, 0],
  samples: simpleRows,
  task: 'regression',
  optimizer: 'sgd_optimizer',
  learningRate: 0.1,
});
assert.deepEqual(simpleStep.outputs, [[1]]);
assert.deepEqual(simpleStep.sampleLosses, [4]);
assert.deepEqual(simpleStep.meanGradients, [-4, -4]);
assert.deepEqual(simpleStep.updatedParameters, [1.4, 0.4]);
const momentumStep = oracleMlpMicroBatch({
  architecture: simpleArchitecture,
  parameters: simpleStep.updatedParameters,
  samples: simpleRows,
  task: 'regression',
  optimizer: 'sgd_optimizer',
  learningRate: 0.1,
  momentum: 0.5,
  state: simpleStep.state,
});
assert.equal(momentumStep.state.steps, 2);
momentumStep.updatedParameters.forEach((value, index) => {
  assert.ok(Math.abs(value - [1.84, 0.84][index]) < 1e-14);
});

const adamFirst = oracleMlpMicroBatch({
  architecture: simpleArchitecture,
  parameters: [1, 0],
  samples: simpleRows,
  task: 'regression',
  optimizer: 'adam_optimizer',
  learningRate: 0.1,
});
const adamSecond = oracleMlpMicroBatch({
  architecture: simpleArchitecture,
  parameters: adamFirst.updatedParameters,
  samples: simpleRows,
  task: 'regression',
  optimizer: 'adam_optimizer',
  learningRate: 0.1,
  state: adamFirst.state,
});
assert.equal(adamSecond.state.steps, 2, 'the oracle applies Adam bias correction at the second optimizer step');
assert.ok(adamFirst.updatedParameters.every(Number.isFinite) && adamSecond.updatedParameters.every(Number.isFinite));

const classificationArchitecture = {
  inputSize: 1,
  layers: [
    { op: 'dense', input_features: 1, units: 2, use_bias: true },
    { op: 'softmax' },
  ],
};
const classificationStep = oracleMlpMicroBatch({
  architecture: classificationArchitecture,
  parameters: [0.1, -0.2, 0, 0],
  samples: [{ x: [0.5], y: 'left' }, { x: [-0.5], y: 'right' }],
  task: 'classification',
  labels: ['left', 'right'],
  optimizer: 'adam_optimizer',
  learningRate: 0.02,
});
assert.equal(classificationStep.outputs.length, 2);
assert.ok(classificationStep.outputs.every((output) => Math.abs(output.reduce((sum, item) => sum + item, 0) - 1) < 1e-15));
assert.ok(classificationStep.meanGradients.every(Number.isFinite));

const fitRequest = createExecutionRequestV1({
  requestId: 'h1t-explicit-fit-001',
  projectSessionId: 'h1t-local-session',
  graphIdentity: { kind: 'graph', fingerprint: 'h1t-registered-mlp-graph' },
  inputIdentity: 'sha256:1'.padEnd(71, '0'),
  configIdentity: 'sha256:2'.padEnd(71, '0'),
  providerId: 'browser-webgpu-mlp-training',
  mode: 'fit',
  budget: { maxDurationMs: 120_000, maxInputBytes: 20 * 1024 * 1024, maxOutputBytes: 256 * 1024 },
  approvedAt: new Date().toISOString(),
});
assert.equal(fitRequest.adapterId, 'volk-browser-webgpu-mlp-training', 'H0 execution identity binds WebGPU fit to the registered adapter');
assert.equal(fitRequest.approval.kind, 'explicit-user-action', 'fit approval records the learner action');
assert.equal(assessExecutionCapabilityV1({ providerId: 'browser-webgpu-mlp-training', graphIdentity: fitRequest.graphIdentity, mode: 'fit' }).status, 'supported');
assert.equal(assessExecutionCapabilityV1({ providerId: 'browser-webgpu', graphIdentity: fitRequest.graphIdentity, mode: 'fit' }).status, 'unsupported');
console.log('H1-T deterministic preflight, bounded failures, explicit H0 fit identity, and independent Float64 oracle checks passed.');
