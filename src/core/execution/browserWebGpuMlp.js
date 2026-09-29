import { normalizeFeatures } from '../knnMath.js';
import { traceBrowserMlpInference } from '../browserRuntime.js';

export const BROWSER_WEBGPU_MLP_ADAPTER_ID = 'volk-browser-webgpu-mlp';
export const BROWSER_WEBGPU_MLP_PROVIDER_VERSION = 'browser-webgpu-mlp-wgsl-v1';
export const BROWSER_WEBGPU_MLP_CONFIG_VERSION = 'browser-webgpu-mlp-inference-v1';

const MAX_LAYERS = 32;
const MAX_INPUT_WIDTH = 4096;
const MAX_TOTAL_OUTPUT_VALUES = 8192;
const MAX_PARAMETERS = 1_000_000;
const MAX_SNAPSHOT_JSON_BYTES = 400_000;
const MAX_DURATION_MS = 30_000;
const WORKGROUP_SIZE = 64;
const ALLOWED_OPS = new Set(['dense', 'relu', 'sigmoid', 'tanh', 'softmax']);

function failure(code, details = {}) {
  return Object.assign(new Error(code), { name: 'BrowserWebGpuInferenceError', code, ...details });
}

function finiteArray(value) {
  return Array.isArray(value) && value.every(Number.isFinite);
}

function modelSnapshot(model) {
  if (!model || model.type !== 'browser_mlp' || !Array.isArray(model.layers)
    || !Array.isArray(model.featureColumns) || !model.featureColumns.length
    || model.featureColumns.length > MAX_INPUT_WIDTH
    || model.featureColumns.some((column) => typeof column !== 'string')
    || !model.normalization || !finiteArray(model.normalization.means)
    || !finiteArray(model.normalization.stds)
    || model.normalization.means.length !== model.featureColumns.length
    || model.normalization.stds.length !== model.featureColumns.length
    || !model.normalization.stds.every((value) => value > 0)
    || !['classification', 'regression'].includes(model.task)) {
    throw failure('WEBGPU_MODEL_UNSUPPORTED');
  }
  if (model.layers.length < 1 || model.layers.length > MAX_LAYERS) throw failure('WEBGPU_MODEL_LIMIT_EXCEEDED');
  let width = model.featureColumns.length;
  let totalOutputValues = 0;
  let totalParameters = 0;
  const layers = model.layers.map((layer) => {
    if (!layer || !ALLOWED_OPS.has(layer.op)) throw failure('WEBGPU_OPERATION_UNSUPPORTED');
    if (layer.op === 'dense') {
      const units = layer.units;
      const inputFeatures = layer.input_features;
      if (!Number.isInteger(units) || units < 1 || units > MAX_INPUT_WIDTH
        || inputFeatures !== width || !Array.isArray(layer.weights) || layer.weights.length !== units
        || !finiteArray(layer.bias) || layer.bias.length !== units
        || layer.weights.some((row) => !finiteArray(row) || row.length !== inputFeatures)) {
        throw failure('WEBGPU_MODEL_INVALID');
      }
      width = units;
      totalParameters += units * inputFeatures + units;
    } else if (layer.op === 'softmax' && width < 1) throw failure('WEBGPU_MODEL_INVALID');
    totalOutputValues += width;
    if (totalOutputValues > MAX_TOTAL_OUTPUT_VALUES) throw failure('WEBGPU_MODEL_LIMIT_EXCEEDED');
    return { ...layer };
  });
  if (totalParameters > MAX_PARAMETERS) throw failure('WEBGPU_MODEL_LIMIT_EXCEEDED');
  if (model.task === 'classification' && (!Array.isArray(model.labels) || model.labels.length !== width
    || model.labels.some((label) => typeof label !== 'string')
    || layers.at(-1).op !== 'softmax')) throw failure('WEBGPU_MODEL_INVALID');
  if (model.task === 'regression' && (width !== 1 || layers.at(-1).op === 'softmax')) throw failure('WEBGPU_MODEL_INVALID');
  const snapshot = {
    type: model.type,
    sourceNodeId: model.sourceNodeId,
    modelNodeId: model.modelNodeId ?? null,
    featureColumns: [...model.featureColumns],
    targetColumn: model.targetColumn,
    normalization: {
      means: [...model.normalization.means],
      stds: [...model.normalization.stds],
    },
    task: model.task,
    labels: [...(model.labels ?? [])],
    layers: layers.map((layer) => ({
      op: layer.op,
      ...(layer.op === 'dense' ? {
        input_features: layer.input_features,
        units: layer.units,
        use_bias: layer.use_bias === true,
        weights: layer.weights.map((row) => [...row]),
        bias: [...layer.bias],
      } : {}),
    })),
  };
  const snapshotJson = JSON.stringify(snapshot);
  const snapshotBytes = new TextEncoder().encode(snapshotJson).byteLength;
  if (snapshotBytes > MAX_SNAPSHOT_JSON_BYTES) throw failure('WEBGPU_INPUT_OVER_BUDGET');
  return { snapshot, snapshotBytes, layers, outputWidth: width, totalOutputValues };
}

export function browserWebGpuMlpConfigIdentity(model) {
  const { snapshot } = modelSnapshot(model);
  return {
    adapter: BROWSER_WEBGPU_MLP_ADAPTER_ID,
    version: BROWSER_WEBGPU_MLP_CONFIG_VERSION,
    snapshot,
  };
}

export function assessBrowserWebGpuMlpInference(model, gpu = globalThis.navigator?.gpu) {
  try {
    modelSnapshot(model);
  } catch (error) {
    return Object.freeze({ supported: false, reason: error.code ?? 'WEBGPU_MODEL_UNSUPPORTED' });
  }
  if (!gpu || typeof gpu.requestAdapter !== 'function') {
    return Object.freeze({ supported: false, reason: 'WEBGPU_UNAVAILABLE' });
  }
  return Object.freeze({ supported: true, reason: null });
}

function assertFeatureInput(model, rawFeatures) {
  if (!Array.isArray(rawFeatures) || rawFeatures.length !== model.featureColumns.length
    || !finiteArray(rawFeatures)) throw failure('WEBGPU_INPUT_INVALID');
}

function denseShader(inputWidth, outputWidth) {
  return `
const INPUT_WIDTH: u32 = ${inputWidth}u;
const OUTPUT_WIDTH: u32 = ${outputWidth}u;
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weights: array<f32>;
@group(0) @binding(2) var<storage, read> biases: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let row = invocation.x;
  if (row >= OUTPUT_WIDTH) { return; }
  var sum = biases[row];
  for (var column: u32 = 0u; column < INPUT_WIDTH; column = column + 1u) {
    sum = sum + weights[row * INPUT_WIDTH + column] * input_values[column];
  }
  output_values[row] = sum;
}`;
}

function activationShader(op, width) {
  const expression = op === 'relu' ? 'max(value, 0.0)'
    : op === 'sigmoid' ? '1.0 / (1.0 + exp(-clamp(value, -30.0, 30.0)))'
      : op === 'tanh' ? 'tanh(value)'
        : `softmax_value(index)`;
  const softmaxFunctions = op === 'softmax' ? `
fn softmax_value(index: u32) -> f32 {
  var maximum = input_values[0];
  for (var cursor: u32 = 1u; cursor < WIDTH; cursor = cursor + 1u) {
    maximum = max(maximum, input_values[cursor]);
  }
  var total = 0.0;
  for (var cursor: u32 = 0u; cursor < WIDTH; cursor = cursor + 1u) {
    total = total + exp(input_values[cursor] - maximum);
  }
  return exp(input_values[index] - maximum) / total;
}` : '';
  return `
const WIDTH: u32 = ${width}u;
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_values: array<f32>;
${softmaxFunctions}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let index = invocation.x;
  if (index >= WIDTH) { return; }
  let value = input_values[index];
  output_values[index] = ${expression};
}`;
}

function alignedBytes(values) {
  return Math.max(4, Math.ceil(values.byteLength / 4) * 4);
}

function createStorageBuffer(device, values, usage, label) {
  const buffer = device.createBuffer({ size: alignedBytes(values), usage, label });
  device.queue.writeBuffer(buffer, 0, values);
  return buffer;
}

function compareValues(expected, actual, op, label) {
  if (!Array.isArray(expected) || expected.length !== actual.length) throw failure('WEBGPU_OUTPUT_INVALID');
  let maxAbsoluteError = 0;
  for (let index = 0; index < expected.length; index += 1) {
    const cpu = expected[index];
    const gpu = actual[index];
    if (!Number.isFinite(cpu) || !Number.isFinite(gpu)) throw failure('WEBGPU_NON_FINITE_OUTPUT');
    const delta = Math.abs(cpu - gpu);
    maxAbsoluteError = Math.max(maxAbsoluteError, delta);
    const tolerance = label === 'normalization' ? 1e-6 + 1e-6 * Math.abs(cpu)
      : op === 'dense' ? 1e-5 + 1e-4 * Math.abs(cpu)
        : op === 'relu' ? 1e-6
          : op === 'sigmoid' || op === 'tanh' || op === 'softmax' ? 2e-6 : 0;
    if (label !== 'normalization' && op === 'relu') {
      if ((cpu > 0) !== (gpu > 0) || delta > tolerance) throw failure('WEBGPU_PARITY_MISMATCH');
    } else if (delta > tolerance) throw failure('WEBGPU_PARITY_MISMATCH');
  }
  return maxAbsoluteError;
}

export function verifyBrowserWebGpuMlpParity(cpuTrace, gpuTrace) {
  if (!cpuTrace || !gpuTrace || !Array.isArray(cpuTrace.normalizedInput)
    || !Array.isArray(gpuTrace.normalizedInput) || !Array.isArray(cpuTrace.stages)
    || !Array.isArray(gpuTrace.stages) || cpuTrace.stages.length !== gpuTrace.stages.length) {
    throw failure('WEBGPU_OUTPUT_INVALID');
  }
  const normalizationMaxAbsError = compareValues(cpuTrace.normalizedInput, gpuTrace.normalizedInput, null, 'normalization');
  const maxAbsoluteErrorByOperation = {};
  for (let index = 0; index < cpuTrace.stages.length; index += 1) {
    const expected = cpuTrace.stages[index];
    const actual = gpuTrace.stages[index];
    if (expected.op !== actual.op) throw failure('WEBGPU_OUTPUT_INVALID');
    maxAbsoluteErrorByOperation[actual.op] = Math.max(
      maxAbsoluteErrorByOperation[actual.op] ?? 0,
      compareValues(expected.values, actual.values, actual.op, 'operation'),
    );
    if (actual.op === 'softmax') {
      const rowTotal = actual.values.reduce((sum, value) => sum + value, 0);
      if (!Number.isFinite(rowTotal) || Math.abs(rowTotal - 1) > 1e-5) throw failure('WEBGPU_PARITY_MISMATCH');
    }
  }
  return Object.freeze({
    normalizationMaxAbsError,
    maxAbsoluteErrorByOperation: Object.freeze(maxAbsoluteErrorByOperation),
  });
}

function webGpuConstants() {
  const usage = globalThis.GPUBufferUsage;
  const mapMode = globalThis.GPUMapMode;
  if (!usage || !mapMode) throw failure('WEBGPU_UNAVAILABLE');
  return {
    usage,
    mapRead: mapMode.READ,
  };
}

function abortError(signal) {
  if (signal?.reason === 'deadline') return failure('WEBGPU_TIMEOUT');
  return failure('WEBGPU_CANCELLED');
}

function withSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

async function runGpuPipeline(device, modelInfo, normalizedInput, signal) {
  const { usage, mapRead } = webGpuConstants();
  const resources = [];
  const stages = [];
  let inputBuffer = createStorageBuffer(device, new Float32Array(normalizedInput), usage.STORAGE | usage.COPY_DST, 'normalized-input');
  resources.push(inputBuffer);
  let inputWidth = normalizedInput.length;
  try {
    for (const [layerIndex, layer] of modelInfo.layers.entries()) {
      if (signal.aborted) throw abortError(signal);
      const outputWidth = layer.op === 'dense' ? layer.units : inputWidth;
      const outputBuffer = device.createBuffer({
        size: outputWidth * Float32Array.BYTES_PER_ELEMENT,
        usage: usage.STORAGE | usage.COPY_SRC,
        label: `layer-${layerIndex}-output`,
      });
      resources.push(outputBuffer);
      const shader = layer.op === 'dense'
        ? denseShader(inputWidth, outputWidth)
        : activationShader(layer.op, outputWidth);
      const module = device.createShaderModule({ code: shader, label: `layer-${layerIndex}-${layer.op}` });
      const pipeline = await withSignal(device.createComputePipelineAsync({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      }), signal);
      const bindings = [
        { binding: 0, resource: { buffer: inputBuffer } },
      ];
      if (layer.op === 'dense') {
        const weights = new Float32Array(layer.weights.flat());
        const biases = new Float32Array(layer.bias);
        const weightBuffer = createStorageBuffer(device, weights, usage.STORAGE | usage.COPY_DST, `layer-${layerIndex}-weights`);
        const biasBuffer = createStorageBuffer(device, biases, usage.STORAGE | usage.COPY_DST, `layer-${layerIndex}-bias`);
        resources.push(weightBuffer, biasBuffer);
        bindings.push(
          { binding: 1, resource: { buffer: weightBuffer } },
          { binding: 2, resource: { buffer: biasBuffer } },
          { binding: 3, resource: { buffer: outputBuffer } },
        );
      } else bindings.push({ binding: 1, resource: { buffer: outputBuffer } });
      const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: bindings });
      const readback = device.createBuffer({
        size: outputWidth * Float32Array.BYTES_PER_ELEMENT,
        usage: usage.COPY_DST | usage.MAP_READ,
        label: `layer-${layerIndex}-readback`,
      });
      resources.push(readback);
      const encoder = device.createCommandEncoder({ label: `layer-${layerIndex}-commands` });
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(outputWidth / WORKGROUP_SIZE));
      pass.end();
      encoder.copyBufferToBuffer(outputBuffer, 0, readback, 0, outputWidth * Float32Array.BYTES_PER_ELEMENT);
      device.queue.submit([encoder.finish()]);
      await withSignal(readback.mapAsync(mapRead), signal);
      const values = [...new Float32Array(readback.getMappedRange()).map(Number)];
      readback.unmap();
      stages.push({ op: layer.op, values });
      inputBuffer = outputBuffer;
      inputWidth = outputWidth;
    }
    return stages;
  } finally {
    resources.forEach((resource) => {
      try { resource.destroy(); } catch { /* A lost device may already have invalidated it. */ }
    });
  }
}

/** Runs only inference on the explicit fitted snapshot. It never mutates model or training state. */
export async function runBrowserWebGpuMlpInference(model, rawFeatures, {
  gpu = globalThis.navigator?.gpu,
  signal: parentSignal = null,
  maxDurationMs = MAX_DURATION_MS,
} = {}) {
  const modelInfo = modelSnapshot(model);
  assertFeatureInput(model, rawFeatures);
  if (!Number.isInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > MAX_DURATION_MS) {
    throw failure('WEBGPU_BUDGET_INVALID');
  }
  if (!gpu || typeof gpu.requestAdapter !== 'function') throw failure('WEBGPU_UNAVAILABLE');
  const cpuReference = traceBrowserMlpInference(model, rawFeatures);
  if (!cpuReference.normalizedInput.every(Number.isFinite)) throw failure('WEBGPU_NON_FINITE_INPUT');
  if (!cpuReference.stages.every((stage) => stage.values.every(Number.isFinite))) throw failure('WEBGPU_NON_FINITE_OUTPUT');
  const inputBytes = modelInfo.snapshotBytes + new TextEncoder().encode(JSON.stringify(rawFeatures)).byteLength;
  if (inputBytes > 20 * 1024 * 1024) throw failure('WEBGPU_INPUT_OVER_BUDGET');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('deadline'), maxDurationMs);
  const forwardAbort = () => controller.abort(parentSignal.reason ?? 'cancelled');
  if (parentSignal) {
    if (parentSignal.aborted) forwardAbort();
    else parentSignal.addEventListener('abort', forwardAbort, { once: true });
  }
  let device = null;
  let deviceLost = null;
  const startedAt = Date.now();
  try {
    const adapter = await withSignal(gpu.requestAdapter(), controller.signal);
    if (!adapter) throw failure('WEBGPU_ADAPTER_UNAVAILABLE');
    device = await withSignal(adapter.requestDevice(), controller.signal);
    if (!device || !device.queue || typeof device.createShaderModule !== 'function') throw failure('WEBGPU_DEVICE_UNAVAILABLE');
    deviceLost = device.lost.then(() => { throw failure('WEBGPU_DEVICE_LOST'); });
    deviceLost.catch(() => {});
    const gpuStages = await Promise.race([
      runGpuPipeline(device, modelInfo, cpuReference.normalizedInput, controller.signal),
      deviceLost,
    ]);
    if (controller.signal.aborted) throw abortError(controller.signal);
    const parity = verifyBrowserWebGpuMlpParity(cpuReference, {
      normalizedInput: [...new Float32Array(cpuReference.normalizedInput)],
      stages: gpuStages,
    });
    const outputValues = gpuStages.at(-1)?.values;
    if (!finiteArray(outputValues)) throw failure('WEBGPU_NON_FINITE_OUTPUT');
    return Object.freeze({
      values: Object.freeze([...outputValues]),
      stages: Object.freeze(gpuStages.map((stage) => Object.freeze({ op: stage.op, values: Object.freeze([...stage.values]) }))),
      parity: Object.freeze({
        passed: true,
        ...parity,
      }),
      providerVersion: BROWSER_WEBGPU_MLP_PROVIDER_VERSION,
      elapsedMs: Math.max(0, Date.now() - startedAt),
    });
  } catch (error) {
    if (controller.signal.aborted) throw abortError(controller.signal);
    if (error?.code) throw error;
    throw failure('WEBGPU_EXECUTION_FAILED');
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', forwardAbort);
    try { device?.destroy(); } catch { /* Device loss is already a failed result. */ }
  }
}

/** Bounded row-batch inference over one immutable fitted snapshot; each row uses the same explicit GPU path. */
export async function runBrowserWebGpuMlpBatchInference(model, rows, {
  gpu = globalThis.navigator?.gpu,
  signal: parentSignal = null,
  maxDurationMs = MAX_DURATION_MS,
} = {}) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 128
    || rows.some((row) => !Array.isArray(row))) throw failure('WEBGPU_INPUT_INVALID');
  modelSnapshot(model);
  if (rows.some((row) => row.length !== model.featureColumns.length || !finiteArray(row))) throw failure('WEBGPU_INPUT_INVALID');
  if (!Number.isInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > MAX_DURATION_MS) {
    throw failure('WEBGPU_BUDGET_INVALID');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('deadline'), maxDurationMs);
  const forwardAbort = () => controller.abort(parentSignal.reason ?? 'cancelled');
  if (parentSignal) {
    if (parentSignal.aborted) forwardAbort();
    else parentSignal.addEventListener('abort', forwardAbort, { once: true });
  }
  const results = [];
  const startedAt = Date.now();
  try {
    for (const row of rows) {
      if (controller.signal.aborted) throw abortError(controller.signal);
      const remainingMs = maxDurationMs - (Date.now() - startedAt);
      if (remainingMs < 1) throw failure('WEBGPU_TIMEOUT');
      results.push(await runBrowserWebGpuMlpInference(model, row, {
        gpu,
        signal: controller.signal,
        maxDurationMs: Math.min(MAX_DURATION_MS, remainingMs),
      }));
    }
    return Object.freeze({
      predictions: Object.freeze(results.map((result) => result.values)),
      parity: Object.freeze({
        passed: results.every((result) => result.parity.passed),
        maxAbsoluteError: Math.max(0, ...results.flatMap((result) => Object.values(result.parity.maxAbsoluteErrorByOperation))),
      }),
      providerVersion: BROWSER_WEBGPU_MLP_PROVIDER_VERSION,
      elapsedMs: Math.max(0, Date.now() - startedAt),
    });
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', forwardAbort);
  }
}
