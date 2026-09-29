import assert from 'node:assert/strict';
import { traceBrowserMlpInference } from '../src/core/browserRuntime.js';
import {
  assessBrowserWebGpuMlpInference,
  browserWebGpuMlpConfigIdentity,
  runBrowserWebGpuMlpBatchInference,
  runBrowserWebGpuMlpInference,
  verifyBrowserWebGpuMlpParity,
} from '../src/core/execution/browserWebGpuMlp.js';

const model = {
  type: 'browser_mlp',
  sourceNodeId: 'trainer-1',
  modelNodeId: 'output-1',
  featureColumns: ['x1', 'x2'],
  targetColumn: 'label',
  normalization: { means: [0.5, -0.25], stds: [2, 0.5] },
  task: 'classification',
  labels: ['a', 'b'],
  layers: [
    { op: 'dense', input_features: 2, units: 2, use_bias: true, weights: [[0.5, -0.25], [0.75, 0.1]], bias: [0.1, -0.2] },
    { op: 'relu' },
    { op: 'dense', input_features: 2, units: 2, use_bias: true, weights: [[0.2, -0.4], [-0.3, 0.6]], bias: [0.05, 0.2] },
    { op: 'sigmoid' },
    { op: 'tanh' },
    { op: 'dense', input_features: 2, units: 2, use_bias: true, weights: [[0.9, -0.1], [-0.5, 0.7]], bias: [0.1, -0.05] },
    { op: 'softmax' },
  ],
};

const capability = assessBrowserWebGpuMlpInference(model, { requestAdapter() {} });
assert.deepEqual(capability, { supported: true, reason: null });
assert.equal(assessBrowserWebGpuMlpInference(model, null).reason, 'WEBGPU_UNAVAILABLE');
assert.equal(assessBrowserWebGpuMlpInference({ ...model, layers: [{ op: 'attention' }] }, { requestAdapter() {} }).reason, 'WEBGPU_OPERATION_UNSUPPORTED');
const configBefore = browserWebGpuMlpConfigIdentity(model);
const input = [0.1, -0.7];
const cpu = traceBrowserMlpInference(model, input);
const gpuTrace = {
  normalizedInput: [...new Float32Array(cpu.normalizedInput)],
  stages: cpu.stages.map(({ op, values }) => ({ op, values: [...new Float32Array(values)] })),
};
const parity = verifyBrowserWebGpuMlpParity(cpu, gpuTrace);
assert.ok(parity.normalizationMaxAbsError <= 1e-6 + 1e-6 * Math.max(...cpu.normalizedInput.map(Math.abs)));
assert.ok(['dense', 'relu', 'sigmoid', 'tanh', 'softmax'].every((op) => Object.hasOwn(parity.maxAbsoluteErrorByOperation, op)));
assert.throws(() => verifyBrowserWebGpuMlpParity(cpu, {
  ...gpuTrace,
  stages: gpuTrace.stages.map((stage, index) => index === 0 && stage.op === 'dense'
    ? { ...stage, values: stage.values.map((value, valueIndex) => valueIndex === 0 ? value + 1 : value) }
    : stage),
}), /WEBGPU_PARITY_MISMATCH/);
assert.throws(() => verifyBrowserWebGpuMlpParity(cpu, {
  ...gpuTrace,
  stages: gpuTrace.stages.map((stage) => stage.op === 'relu'
    ? { ...stage, values: stage.values.map((value) => value > 0 ? -1e-4 : 1e-4) }
    : stage),
}), /WEBGPU_PARITY_MISMATCH/, 'ReLU parity checks positive/zero classification as well as numeric tolerance.');
assert.throws(() => verifyBrowserWebGpuMlpParity(cpu, {
  ...gpuTrace,
  stages: gpuTrace.stages.map((stage) => stage.op === 'softmax'
    ? { ...stage, values: [0.5, 0.25] }
    : stage),
}), /WEBGPU_PARITY_MISMATCH/, 'Softmax rows must sum to one within the fixed bound.');
assert.throws(() => verifyBrowserWebGpuMlpParity(cpu, {
  ...gpuTrace,
  stages: gpuTrace.stages.map((stage) => stage.op === 'tanh'
    ? { ...stage, values: [Number.NaN, ...stage.values.slice(1)] }
    : stage),
}), /WEBGPU_NON_FINITE_OUTPUT/);

await assert.rejects(
  runBrowserWebGpuMlpInference(model, input, { gpu: { requestAdapter: async () => null } }),
  /WEBGPU_ADAPTER_UNAVAILABLE/,
);
await assert.rejects(
  runBrowserWebGpuMlpInference(model, input, { gpu: { requestAdapter: async () => ({ requestDevice: async () => { throw new Error('device rejected'); } }) } }),
  /WEBGPU_EXECUTION_FAILED/,
);
await assert.rejects(
  runBrowserWebGpuMlpInference(model, input, { gpu: { requestAdapter: () => new Promise(() => {}) }, maxDurationMs: 10 }),
  /WEBGPU_TIMEOUT/,
);
const gpuGlobals = {
  usage: Object.getOwnPropertyDescriptor(globalThis, 'GPUBufferUsage'),
  mapMode: Object.getOwnPropertyDescriptor(globalThis, 'GPUMapMode'),
};
Object.defineProperty(globalThis, 'GPUBufferUsage', {
  configurable: true,
  value: { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, MAP_READ: 8 },
});
Object.defineProperty(globalThis, 'GPUMapMode', { configurable: true, value: { READ: 1 } });
let deviceLossDestroyed = false;
const lossDevice = {
  lost: Promise.resolve({ reason: 'unknown' }),
  queue: { writeBuffer() {}, submit() {} },
  createBuffer: () => ({ destroy() {}, mapAsync: () => new Promise(() => {}) }),
  createShaderModule: () => ({}),
  createComputePipelineAsync: () => new Promise(() => {}),
  destroy: () => { deviceLossDestroyed = true; },
};
try {
  await assert.rejects(
    runBrowserWebGpuMlpInference(model, input, {
      gpu: { requestAdapter: async () => ({ requestDevice: async () => lossDevice }) },
    }),
    (error) => error.code === 'WEBGPU_DEVICE_LOST',
    'A lost device during pending GPU work must fail closed, never produce a successful inference result.',
  );
  assert.equal(deviceLossDestroyed, true, 'The device is disposed after device loss.');
  assert.deepEqual(browserWebGpuMlpConfigIdentity(model), configBefore,
    'Device loss cannot mutate the fitted model snapshot.');
} finally {
  if (gpuGlobals.usage) Object.defineProperty(globalThis, 'GPUBufferUsage', gpuGlobals.usage);
  else delete globalThis.GPUBufferUsage;
  if (gpuGlobals.mapMode) Object.defineProperty(globalThis, 'GPUMapMode', gpuGlobals.mapMode);
  else delete globalThis.GPUMapMode;
}
const inFlightAbort = new AbortController();
let deviceRequestStarted = false;
await assert.rejects(
  runBrowserWebGpuMlpInference(model, input, {
    signal: inFlightAbort.signal,
    gpu: {
      requestAdapter: async () => ({
        requestDevice: () => {
          deviceRequestStarted = true;
          queueMicrotask(() => inFlightAbort.abort('cancelled'));
          return new Promise(() => {});
        },
      }),
    },
  }),
  (error) => error.code === 'WEBGPU_CANCELLED',
  'Cancellation while device acquisition is pending must not resolve as success.',
);
assert.equal(deviceRequestStarted, true, 'The cancellation case reaches pending device acquisition before aborting.');
assert.deepEqual(browserWebGpuMlpConfigIdentity(model), configBefore,
  'In-flight cancellation cannot mutate the fitted model snapshot.');
await assert.rejects(
  runBrowserWebGpuMlpBatchInference(model, [[0.1, -0.7], [0.2]], { gpu: { requestAdapter: async () => null } }),
  /WEBGPU_INPUT_INVALID/,
);
const aborted = new AbortController();
aborted.abort('cancelled');
await assert.rejects(
  runBrowserWebGpuMlpInference(model, input, { gpu: { requestAdapter: async () => ({}) }, signal: aborted.signal }),
  /WEBGPU_CANCELLED/,
);
assert.deepEqual(browserWebGpuMlpConfigIdentity(model), configBefore, 'Inference/failure checks do not mutate fitted weights or snapshot state.');

const regression = {
  ...model,
  task: 'regression',
  labels: [],
  layers: [
    { op: 'dense', input_features: 2, units: 3, use_bias: true, weights: [[0.1, 0.2], [-0.3, 0.4], [0.25, -0.1]], bias: [0, 0.2, -0.1] },
    { op: 'tanh' },
    { op: 'dense', input_features: 3, units: 1, use_bias: true, weights: [[0.2, 0.3, -0.5]], bias: [0.1] },
  ],
};
assert.equal(assessBrowserWebGpuMlpInference(regression, { requestAdapter() {} }).supported, true);
console.log('PASS WebGPU MLP inference contract: capability bounds, complete activation parity gates, failure containment, and immutable fitted state.');
