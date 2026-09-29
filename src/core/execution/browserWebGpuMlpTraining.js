import {
  DEFAULT_KNN_SEED,
  deterministicShuffle,
  fitFeatureNormalization,
  normalizeFeatures,
} from '../knnMath.js';

export const BROWSER_WEBGPU_MLP_TRAINING_ADAPTER_ID = 'volk-browser-webgpu-mlp-training';
export const BROWSER_WEBGPU_MLP_TRAINING_PROVIDER_VERSION = 'browser-webgpu-mlp-training-wgsl-v1';
export const BROWSER_WEBGPU_MLP_TRAINING_SEMANTICS_VERSION = 'browser-mlp-training-semantics-v1';
export const BROWSER_WEBGPU_MLP_ORACLE_ENVELOPE = Object.freeze({ absolute: 1e-5, relative: 5e-4 });

export const BROWSER_WEBGPU_MLP_TRAINING_LIMITS = Object.freeze({
  durationMs: 120_000,
  features: 256,
  trainRows: 8192,
  batchSize: 32,
  epochs: 500,
  layers: 32,
  activations: 8192,
  parameters: 8192,
  optimizerSteps: 100_000,
  examples: 500_000,
  estimatedOperations: 250_000_000,
  allocatedBytes: 64 * 1024 * 1024,
  requestBytes: 20 * 1024 * 1024,
  resultBytes: 256 * 1024,
});

const ALLOWED_OPS = new Set(['dense', 'relu', 'sigmoid', 'tanh', 'softmax']);
const STORAGE_BINDING_COUNT = 8;
const WORKGROUP_SIZE = 64;

function failure(code, details = {}) {
  return Object.assign(new Error(code), { name: 'BrowserWebGpuTrainingError', code, ...details });
}

function finiteArray(values) {
  return Array.isArray(values) && values.every(Number.isFinite);
}

function finiteTree(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteTree);
  if (value && typeof value === 'object') return Object.values(value).every(finiteTree);
  return true;
}

function initializeDense(inputSize, units, useBias, seed) {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296 - 0.5;
  };
  const scale = Math.sqrt(2 / Math.max(1, inputSize + units));
  return {
    weights: Array.from({ length: units }, () => Array.from({ length: inputSize }, () => next() * scale)),
    bias: Array.from({ length: units }, () => (useBias ? 0 : 0)),
  };
}

function trainingPlan({ architecture, split, loss, optimizer, trainer, seed = DEFAULT_KNN_SEED } = {}) {
  const dataset = split?.dataset;
  const featureCount = dataset?.featureColumns?.length;
  const trainRows = split?.train;
  if (!dataset || !Number.isInteger(featureCount) || featureCount < 1
    || featureCount > BROWSER_WEBGPU_MLP_TRAINING_LIMITS.features
    || !Array.isArray(trainRows) || trainRows.length < 2
    || trainRows.length > BROWSER_WEBGPU_MLP_TRAINING_LIMITS.trainRows
    || !architecture || architecture.inputSize !== featureCount
    || !Array.isArray(architecture.layers) || architecture.layers.length < 1
    || architecture.layers.length > BROWSER_WEBGPU_MLP_TRAINING_LIMITS.layers
    || !['classification', 'regression'].includes(dataset.task)) {
    throw failure('WEBGPU_TRAINING_INPUT_INVALID');
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw failure('WEBGPU_TRAINING_CONFIG_INVALID');
  if (!Number.isInteger(Number(trainer?.epochs)) || Number(trainer.epochs) < 1
    || Number(trainer.epochs) > BROWSER_WEBGPU_MLP_TRAINING_LIMITS.epochs
    || !Number.isInteger(Number(trainer.batch_size)) || Number(trainer.batch_size) < 1
    || Number(trainer.batch_size) > BROWSER_WEBGPU_MLP_TRAINING_LIMITS.batchSize
    || typeof trainer.shuffle !== 'boolean') throw failure('WEBGPU_TRAINING_LIMIT_EXCEEDED');
  if (!['sgd_optimizer', 'adam_optimizer'].includes(optimizer?.op)
    || !Number.isFinite(Number(optimizer.learning_rate)) || Number(optimizer.learning_rate) <= 0
    || Number(optimizer.learning_rate) > (optimizer.op === 'sgd_optimizer' ? 0.5 : 0.1)
    || !Number.isFinite(Number(optimizer.momentum ?? 0))
    || Number(optimizer.momentum ?? 0) < 0 || Number(optimizer.momentum ?? 0) > 0.99
    || !['mse_loss', 'cross_entropy_loss'].includes(loss?.op)) {
    throw failure('WEBGPU_TRAINING_CONFIG_INVALID');
  }
  if (dataset.task === 'classification' && loss.op !== 'cross_entropy_loss') throw failure('WEBGPU_TRAINING_TASK_INVALID');
  if (dataset.task === 'regression' && loss.op !== 'mse_loss') throw failure('WEBGPU_TRAINING_TASK_INVALID');

  const layers = [];
  let width = featureCount;
  let activationStride = featureCount;
  const stages = [{ op: 'input', width: featureCount, offset: 0 }];
  const parameterLayout = [];
  let parameterCount = 0;
  for (const [index, sourceLayer] of architecture.layers.entries()) {
    if (!sourceLayer || !ALLOWED_OPS.has(sourceLayer.op)) throw failure('WEBGPU_TRAINING_OPERATION_UNSUPPORTED');
    let layer;
    let outputWidth = width;
    const inputStage = stages.at(-1);
    if (sourceLayer.op === 'dense') {
      const inputFeatures = Number(sourceLayer.input_features);
      const units = Number(sourceLayer.units);
      const useBias = sourceLayer.use_bias === true;
      if (!Number.isInteger(inputFeatures) || inputFeatures !== width
        || !Number.isInteger(units) || units < 1 || units > BROWSER_WEBGPU_MLP_TRAINING_LIMITS.activations) {
        throw failure('WEBGPU_TRAINING_SHAPE_INVALID');
      }
      const initialized = initializeDense(inputFeatures, units, useBias, seed + index);
      layer = {
        op: 'dense', input_features: inputFeatures, units, use_bias: useBias,
        weights: initialized.weights, bias: initialized.bias,
      };
      outputWidth = units;
      const weightOffset = parameterCount;
      const biasOffset = weightOffset + inputFeatures * units;
      parameterLayout.push({
        layerIndex: layers.length,
        inputWidth: inputFeatures,
        outputWidth: units,
        weightOffset,
        biasOffset,
        useBias,
      });
      parameterCount = biasOffset + units;
    } else {
      if (sourceLayer.op === 'softmax' && width < 2) throw failure('WEBGPU_TRAINING_SHAPE_INVALID');
      layer = { op: sourceLayer.op };
    }
    const stage = { op: layer.op, width: outputWidth, offset: activationStride, inputOffset: inputStage.offset };
    activationStride += outputWidth;
    layers.push(layer);
    stages.push(stage);
    width = outputWidth;
    if (activationStride > BROWSER_WEBGPU_MLP_TRAINING_LIMITS.activations) throw failure('WEBGPU_TRAINING_LIMIT_EXCEEDED');
  }
  if (!parameterLayout.length || parameterCount < 1
    || parameterCount > BROWSER_WEBGPU_MLP_TRAINING_LIMITS.parameters) throw failure('WEBGPU_TRAINING_LIMIT_EXCEEDED');

  const isClassification = dataset.task === 'classification';
  const labels = isClassification ? [...new Set(trainRows.map((sample) => String(sample.y)))].sort() : [];
  if (isClassification && (labels.length < 2 || width !== labels.length || layers.at(-1).op !== 'softmax')) {
    throw failure('WEBGPU_TRAINING_TASK_INVALID');
  }
  if (!isClassification && (width !== 1 || layers.at(-1).op === 'softmax')) throw failure('WEBGPU_TRAINING_TASK_INVALID');

  const normalization = fitFeatureNormalization(trainRows, featureCount);
  const normalizedTrain = trainRows.map((sample) => ({ ...sample, x: normalizeFeatures(sample.x, normalization) }));
  if (!finiteTree(normalization) || !finiteTree(normalizedTrain)) throw failure('WEBGPU_TRAINING_NON_FINITE_INPUT');
  const labelIndex = new Map(labels.map((label, index) => [label, index]));
  const targets = normalizedTrain.map((sample) => (isClassification ? labelIndex.get(String(sample.y)) : Number(sample.y)));
  if (!finiteArray(targets)) throw failure('WEBGPU_TRAINING_NON_FINITE_INPUT');

  const epochs = Number(trainer.epochs);
  const batchSize = Number(trainer.batch_size);
  const trainingSteps = Math.ceil(normalizedTrain.length / batchSize) * epochs;
  const examplesProcessed = normalizedTrain.length * epochs;
  const optimizerOperationsPerParameter = optimizer.op === 'adam_optimizer' ? 16 : 6;
  const estimatedOperations = examplesProcessed * (parameterCount * 4 + activationStride * 12)
    + trainingSteps * parameterCount * optimizerOperationsPerParameter;
  if (trainingSteps > BROWSER_WEBGPU_MLP_TRAINING_LIMITS.optimizerSteps
    || examplesProcessed > BROWSER_WEBGPU_MLP_TRAINING_LIMITS.examples
    || estimatedOperations > BROWSER_WEBGPU_MLP_TRAINING_LIMITS.estimatedOperations) {
    throw failure('WEBGPU_TRAINING_LIMIT_EXCEEDED');
  }

  const batchCapacity = Math.min(batchSize, normalizedTrain.length);
  const inputBytes = normalizedTrain.length * featureCount * Float32Array.BYTES_PER_ELEMENT;
  const targetBytes = normalizedTrain.length * Float32Array.BYTES_PER_ELEMENT;
  const orderBytes = normalizedTrain.length * Uint32Array.BYTES_PER_ELEMENT;
  const activationBytes = batchCapacity * activationStride * Float32Array.BYTES_PER_ELEMENT;
  const gradientBytes = batchCapacity * parameterCount * Float32Array.BYTES_PER_ELEMENT;
  const parameterBytes = parameterCount * Float32Array.BYTES_PER_ELEMENT;
  const optimizerBytes = parameterBytes * 2;
  const averageGradientBytes = parameterBytes;
  const lossBytes = normalizedTrain.length * Float32Array.BYTES_PER_ELEMENT;
  const allocatedBytes = inputBytes + targetBytes + orderBytes + activationBytes * 2 + gradientBytes
    + parameterBytes + optimizerBytes + averageGradientBytes + lossBytes
    + parameterBytes + Float32Array.BYTES_PER_ELEMENT * 2 + 32;
  const serializedModelBytes = new TextEncoder().encode(JSON.stringify({
    layers,
    normalization,
    labels,
    featureColumns: dataset.featureColumns,
    targetColumn: dataset.targetColumn,
    lossHistory: Array.from({ length: epochs }, () => 0),
  })).byteLength;
  if (allocatedBytes > BROWSER_WEBGPU_MLP_TRAINING_LIMITS.allocatedBytes
    || serializedModelBytes > BROWSER_WEBGPU_MLP_TRAINING_LIMITS.resultBytes) {
    throw failure('WEBGPU_TRAINING_LIMIT_EXCEEDED');
  }

  return {
    dataset,
    split,
    architecture,
    layers,
    stages,
    parameterLayout,
    parameterCount,
    activationStride,
    inputWidth: featureCount,
    outputWidth: width,
    normalizedTrain,
    targets,
    normalization,
    labels,
    task: dataset.task,
    isClassification,
    optimizer: optimizer.op,
    learningRate: Number(optimizer.learning_rate),
    momentum: Number(optimizer.momentum ?? 0),
    epochs,
    batchSize,
    batchCapacity,
    shuffle: trainer.shuffle,
    seed,
    parameterCount,
    trainingSteps,
    examplesProcessed,
    estimatedOperations,
    allocatedBytes,
    serializedModelBytes,
    sourceNodeId: trainer.id,
    modelNodeId: architecture.modelNodeId,
  };
}

export function assessBrowserWebGpuMlpTraining(input, gpu = globalThis.navigator?.gpu) {
  try {
    const plan = trainingPlan(input);
    if (!gpu || typeof gpu.requestAdapter !== 'function') return Object.freeze({ supported: false, reason: 'WEBGPU_UNAVAILABLE' });
    return Object.freeze({
      supported: true,
      reason: null,
      estimate: Object.freeze({
        parameters: plan.parameterCount,
        trainingSteps: plan.trainingSteps,
        examples: plan.examplesProcessed,
        allocatedBytes: plan.allocatedBytes,
        estimatedOperations: plan.estimatedOperations,
      }),
    });
  } catch (error) {
    return Object.freeze({ supported: false, reason: error.code ?? 'WEBGPU_TRAINING_INPUT_INVALID' });
  }
}

function flattenParameters(plan) {
  const values = new Float64Array(plan.parameterCount);
  for (const layout of plan.parameterLayout) {
    const layer = plan.layers[layout.layerIndex];
    layer.weights.forEach((row, unit) => row.forEach((value, feature) => {
      values[layout.weightOffset + unit * layout.inputWidth + feature] = value;
    }));
    layer.bias.forEach((value, unit) => { values[layout.biasOffset + unit] = value; });
  }
  if (![...values].every(Number.isFinite)) throw failure('WEBGPU_TRAINING_NON_FINITE_INPUT');
  return values;
}

function serializeParameters(plan, flatParameters) {
  if (!flatParameters || flatParameters.length !== plan.parameterCount || ![...flatParameters].every(Number.isFinite)) {
    throw failure('WEBGPU_TRAINING_NON_FINITE_OUTPUT');
  }
  const layers = plan.layers.map((layer) => ({ ...layer }));
  for (const layout of plan.parameterLayout) {
    const layer = layers[layout.layerIndex];
    layer.weights = Array.from({ length: layout.outputWidth }, (_, unit) => (
      Array.from({ length: layout.inputWidth }, (_, feature) => flatParameters[layout.weightOffset + unit * layout.inputWidth + feature])
    ));
    layer.bias = Array.from({ length: layout.outputWidth }, (_, unit) => flatParameters[layout.biasOffset + unit]);
  }
  return layers;
}

function u32(value) { return `${value}u`; }

function floatLiteral(value) {
  if (!Number.isFinite(value)) throw failure('WEBGPU_TRAINING_CONFIG_INVALID');
  return Number.isInteger(value) ? `${value}.0` : value.toExponential();
}

function trainingShader(plan) {
  const forward = plan.layers.map((layer, index) => {
    const input = plan.stages[index];
    const output = plan.stages[index + 1];
    if (layer.op === 'dense') {
      const layout = plan.parameterLayout.find((item) => item.layerIndex === index);
      return `{
  for (var unit_${index}: u32 = 0u; unit_${index} < ${u32(layout.outputWidth)}; unit_${index} = unit_${index} + 1u) {
    var sum_${index}: f32 = parameters[${u32(layout.biasOffset)} + unit_${index}];
    for (var feature_${index}: u32 = 0u; feature_${index} < ${u32(layout.inputWidth)}; feature_${index} = feature_${index} + 1u) {
      sum_${index} = sum_${index} + parameters[${u32(layout.weightOffset)} + unit_${index} * ${u32(layout.inputWidth)} + feature_${index}]
        * activations[activation_base + ${u32(input.offset)} + feature_${index}];
    }
    activations[activation_base + ${u32(output.offset)} + unit_${index}] = sum_${index};
  }
}`;
    }
    if (layer.op === 'softmax') {
      return `{
  var maximum_${index}: f32 = activations[activation_base + ${u32(input.offset)}];
  for (var cursor_${index}: u32 = 1u; cursor_${index} < ${u32(output.width)}; cursor_${index} = cursor_${index} + 1u) {
    maximum_${index} = max(maximum_${index}, activations[activation_base + ${u32(input.offset)} + cursor_${index}]);
  }
  var total_${index}: f32 = 0.0;
  for (var cursor_${index}: u32 = 0u; cursor_${index} < ${u32(output.width)}; cursor_${index} = cursor_${index} + 1u) {
    total_${index} = total_${index} + exp(activations[activation_base + ${u32(input.offset)} + cursor_${index}] - maximum_${index});
  }
  for (var cursor_${index}: u32 = 0u; cursor_${index} < ${u32(output.width)}; cursor_${index} = cursor_${index} + 1u) {
    activations[activation_base + ${u32(output.offset)} + cursor_${index}]
      = exp(activations[activation_base + ${u32(input.offset)} + cursor_${index}] - maximum_${index}) / total_${index};
  }
}`;
    }
    const expression = layer.op === 'relu' ? 'max(value, 0.0)'
      : layer.op === 'sigmoid' ? '1.0 / (1.0 + exp(-clamp(value, -30.0, 30.0)))'
        : 'tanh(value)';
    return `{
  for (var unit_${index}: u32 = 0u; unit_${index} < ${u32(output.width)}; unit_${index} = unit_${index} + 1u) {
    let value: f32 = activations[activation_base + ${u32(input.offset)} + unit_${index}];
    activations[activation_base + ${u32(output.offset)} + unit_${index}] = ${expression};
  }
}`;
  }).join('\n');

  const backward = plan.layers.map((layer, index) => ({ layer, index })).reverse().map(({ layer, index }) => {
    const input = plan.stages[index];
    const output = plan.stages[index + 1];
    if (layer.op === 'dense') {
      const layout = plan.parameterLayout.find((item) => item.layerIndex === index);
      return `{
  for (var unit_${index}: u32 = 0u; unit_${index} < ${u32(layout.outputWidth)}; unit_${index} = unit_${index} + 1u) {
    let delta_${index}: f32 = deltas[delta_base + ${u32(output.offset)} + unit_${index}];
    for (var feature_${index}: u32 = 0u; feature_${index} < ${u32(layout.inputWidth)}; feature_${index} = feature_${index} + 1u) {
      let parameter_${index}: u32 = ${u32(layout.weightOffset)} + unit_${index} * ${u32(layout.inputWidth)} + feature_${index};
      sample_gradients[gradient_base + parameter_${index}] = delta_${index} * activations[activation_base + ${u32(input.offset)} + feature_${index}];
    }
    sample_gradients[gradient_base + ${u32(layout.biasOffset)} + unit_${index}] = ${layout.useBias ? `delta_${index}` : '0.0'};
  }
  for (var feature_${index}: u32 = 0u; feature_${index} < ${u32(layout.inputWidth)}; feature_${index} = feature_${index} + 1u) {
    var propagated_${index}: f32 = 0.0;
    for (var unit_${index}: u32 = 0u; unit_${index} < ${u32(layout.outputWidth)}; unit_${index} = unit_${index} + 1u) {
      propagated_${index} = propagated_${index} + parameters[${u32(layout.weightOffset)} + unit_${index} * ${u32(layout.inputWidth)} + feature_${index}]
        * deltas[delta_base + ${u32(output.offset)} + unit_${index}];
    }
    deltas[delta_base + ${u32(input.offset)} + feature_${index}] = propagated_${index};
  }
}`;
    }
    const fusedOutput = plan.isClassification && index === plan.layers.length - 1 && layer.op === 'softmax';
    if (fusedOutput) return `{
  for (var unit_${index}: u32 = 0u; unit_${index} < ${u32(output.width)}; unit_${index} = unit_${index} + 1u) {
    deltas[delta_base + ${u32(input.offset)} + unit_${index}] = deltas[delta_base + ${u32(output.offset)} + unit_${index}];
  }
}`;
    if (layer.op === 'softmax') return `{
  var projection_${index}: f32 = 0.0;
  for (var unit_${index}: u32 = 0u; unit_${index} < ${u32(output.width)}; unit_${index} = unit_${index} + 1u) {
    projection_${index} = projection_${index}
      + activations[activation_base + ${u32(output.offset)} + unit_${index}] * deltas[delta_base + ${u32(output.offset)} + unit_${index}];
  }
  for (var unit_${index}: u32 = 0u; unit_${index} < ${u32(output.width)}; unit_${index} = unit_${index} + 1u) {
    let probability_${index}: f32 = activations[activation_base + ${u32(output.offset)} + unit_${index}];
    deltas[delta_base + ${u32(input.offset)} + unit_${index}]
      = probability_${index} * (deltas[delta_base + ${u32(output.offset)} + unit_${index}] - projection_${index});
  }
}`;
    const derivative = layer.op === 'relu' ? 'select(0.0, 1.0, output_value > 0.0)'
      : layer.op === 'sigmoid' ? 'output_value * (1.0 - output_value)'
        : '(1.0 - output_value * output_value)';
    return `{
  for (var unit_${index}: u32 = 0u; unit_${index} < ${u32(output.width)}; unit_${index} = unit_${index} + 1u) {
    let output_value: f32 = activations[activation_base + ${u32(output.offset)} + unit_${index}];
    deltas[delta_base + ${u32(input.offset)} + unit_${index}]
      = deltas[delta_base + ${u32(output.offset)} + unit_${index}] * ${derivative};
  }
}`;
  }).join('\n');

  const output = plan.stages.at(-1);
  const lossAndDelta = plan.isClassification ? `
  let target_index: u32 = u32(targets[sample_row]);
  let target_probability: f32 = activations[activation_base + ${u32(output.offset)} + target_index];
  let sample_loss: f32 = -log(max(1e-12, target_probability));
  for (var unit: u32 = 0u; unit < ${u32(output.width)}; unit = unit + 1u) {
    let expected: f32 = select(0.0, 1.0, unit == target_index);
    deltas[delta_base + ${u32(output.offset)} + unit] = activations[activation_base + ${u32(output.offset)} + unit] - expected;
  }` : `
  let difference: f32 = activations[activation_base + ${u32(output.offset)}] - targets[sample_row];
  let sample_loss: f32 = difference * difference;
  deltas[delta_base + ${u32(output.offset)}] = 2.0 * difference;`;

  return `
const INPUT_WIDTH: u32 = ${u32(plan.inputWidth)};
const ACTIVATION_STRIDE: u32 = ${u32(plan.activationStride)};
const PARAMETER_COUNT: u32 = ${u32(plan.parameterCount)};
const TRAIN_ROWS: u32 = ${u32(plan.normalizedTrain.length)};
const BATCH_CAPACITY: u32 = ${u32(plan.batchCapacity)};
@group(0) @binding(0) var<storage, read> parameters: array<f32>;
@group(0) @binding(1) var<storage, read> features: array<f32>;
@group(0) @binding(2) var<storage, read> targets: array<f32>;
@group(0) @binding(3) var<storage, read> batch_indices: array<u32>;
@group(0) @binding(4) var<storage, read_write> activations: array<f32>;
@group(0) @binding(5) var<storage, read_write> deltas: array<f32>;
@group(0) @binding(6) var<storage, read_write> sample_gradients: array<f32>;
@group(0) @binding(7) var<storage, read_write> sample_losses: array<f32>;
struct BatchControl { count: u32, step: u32, start: u32, train_rows: u32 };
@group(0) @binding(8) var<uniform> control: BatchControl;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let lane: u32 = invocation.x;
  if (lane >= control.count || lane >= BATCH_CAPACITY) { return; }
  let sample_row: u32 = batch_indices[control.start + lane];
  let activation_base: u32 = lane * ACTIVATION_STRIDE;
  let delta_base: u32 = lane * ACTIVATION_STRIDE;
  let gradient_base: u32 = lane * PARAMETER_COUNT;
  for (var parameter: u32 = 0u; parameter < PARAMETER_COUNT; parameter = parameter + 1u) {
    sample_gradients[gradient_base + parameter] = 0.0;
  }
  for (var feature: u32 = 0u; feature < INPUT_WIDTH; feature = feature + 1u) {
    activations[activation_base + feature] = features[sample_row * INPUT_WIDTH + feature];
  }
  ${forward}
  ${lossAndDelta}
  sample_losses[sample_row] = sample_loss;
  ${backward}
}`;
}

function optimizerShader(plan) {
  const update = plan.optimizer === 'sgd_optimizer' ? `
  let velocity: f32 = control.momentum * optimizer_state_a[parameter_index] + gradient;
  optimizer_state_a[parameter_index] = velocity;
  parameters[parameter_index] = parameters[parameter_index] - LEARNING_RATE * velocity;` : `
  let first_moment: f32 = 0.9 * optimizer_state_a[parameter_index] + 0.1 * gradient;
  let second_moment: f32 = 0.999 * optimizer_state_b[parameter_index] + 0.001 * gradient * gradient;
  optimizer_state_a[parameter_index] = first_moment;
  optimizer_state_b[parameter_index] = second_moment;
  let corrected_first: f32 = first_moment / (1.0 - pow(0.9, f32(control.step)));
  let corrected_second: f32 = second_moment / (1.0 - pow(0.999, f32(control.step)));
  parameters[parameter_index] = parameters[parameter_index]
    - LEARNING_RATE * corrected_first / (sqrt(corrected_second) + 1e-8);`;
  return `
const PARAMETER_COUNT: u32 = ${u32(plan.parameterCount)};
const LEARNING_RATE: f32 = ${floatLiteral(plan.learningRate)};
@group(0) @binding(0) var<storage, read_write> parameters: array<f32>;
@group(0) @binding(1) var<storage, read> sample_gradients: array<f32>;
@group(0) @binding(2) var<storage, read_write> average_gradients: array<f32>;
@group(0) @binding(3) var<storage, read_write> optimizer_state_a: array<f32>;
@group(0) @binding(4) var<storage, read_write> optimizer_state_b: array<f32>;
struct BatchControl { count: u32, step: u32, start: u32, train_rows: u32, momentum: f32, padding_0: f32, padding_1: f32, padding_2: f32 };
@group(0) @binding(5) var<uniform> control: BatchControl;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let parameter_index: u32 = invocation.x;
  if (parameter_index >= PARAMETER_COUNT) { return; }
  var total: f32 = 0.0;
  for (var lane: u32 = 0u; lane < control.count; lane = lane + 1u) {
    total = total + sample_gradients[lane * PARAMETER_COUNT + parameter_index];
  }
  let gradient: f32 = total / f32(control.count);
  average_gradients[parameter_index] = gradient;
  ${update}
}`;
}

function lossReductionShader(trainRows) {
  return `
const TRAIN_ROWS: u32 = ${u32(trainRows)};
@group(0) @binding(0) var<storage, read> sample_losses: array<f32>;
@group(0) @binding(1) var<storage, read> batch_indices: array<u32>;
@group(0) @binding(2) var<storage, read_write> average_loss: array<f32>;
struct BatchControl { count: u32, step: u32, start: u32, train_rows: u32 };
@group(0) @binding(3) var<uniform> control: BatchControl;
@compute @workgroup_size(1)
fn main() {
  var total: f32 = 0.0;
  for (var index: u32 = 0u; index < TRAIN_ROWS; index = index + 1u) {
    total = total + sample_losses[batch_indices[index]];
  }
  average_loss[0] = total / f32(TRAIN_ROWS);
}`;
}

function webGpuConstants() {
  const usage = globalThis.GPUBufferUsage;
  const mapMode = globalThis.GPUMapMode;
  if (!usage || !mapMode) throw failure('WEBGPU_UNAVAILABLE');
  return { usage, mapRead: mapMode.READ };
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw failure(signal.reason === 'deadline' ? 'EXECUTION_TIMEOUT' : 'EXECUTION_CANCELLED');
}

function withSignal(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason === 'deadline'
    ? failure('EXECUTION_TIMEOUT') : failure('EXECUTION_CANCELLED'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason === 'deadline'
      ? failure('EXECUTION_TIMEOUT') : failure('EXECUTION_CANCELLED'));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

function bufferSize(value) { return Math.max(4, Math.ceil(value / 4) * 4); }

function allocate(device, usage, resources, size, flags, label) {
  if (!Number.isSafeInteger(size) || size < 1) throw failure('WEBGPU_TRAINING_LIMIT_EXCEEDED');
  let buffer;
  try {
    buffer = device.createBuffer({ size: bufferSize(size), usage: flags, label });
  } catch {
    throw failure('WEBGPU_RESOURCE_LIMIT');
  }
  resources.push(buffer);
  return buffer;
}

function validateDeviceLimits(limits, plan, needsOracleReadback) {
  if (!limits) throw failure('WEBGPU_LIMITS_UNAVAILABLE');
  const f32 = Float32Array.BYTES_PER_ELEMENT;
  const storageBufferSizes = [
    plan.normalizedTrain.length * plan.inputWidth * f32,
    plan.normalizedTrain.length * f32,
    plan.normalizedTrain.length * Uint32Array.BYTES_PER_ELEMENT,
    plan.batchCapacity * plan.activationStride * f32,
    plan.batchCapacity * plan.activationStride * f32,
    plan.batchCapacity * plan.parameterCount * f32,
    plan.parameterCount * f32,
    plan.parameterCount * f32,
    plan.parameterCount * f32,
    plan.parameterCount * f32,
    plan.normalizedTrain.length * f32,
    f32,
  ];
  const allBufferSizes = [...storageBufferSizes, plan.parameterCount * f32, f32, 32];
  if (needsOracleReadback) {
    allBufferSizes.push((plan.parameterCount * 2 + plan.batchCapacity * (plan.outputWidth + 1) + 8) * f32);
  }
  const maxStorage = Number(limits.maxStorageBufferBindingSize ?? 0);
  const maxBuffer = Number(limits.maxBufferSize ?? 0);
  if (!maxStorage || !maxBuffer || storageBufferSizes.some((size) => size > maxStorage)
    || allBufferSizes.some((size) => size > maxBuffer)
    || allBufferSizes.reduce((sum, size) => sum + size, 0) > BROWSER_WEBGPU_MLP_TRAINING_LIMITS.allocatedBytes
    || Number(limits.maxStorageBuffersPerShaderStage ?? 0) < STORAGE_BINDING_COUNT
    || Number(limits.maxComputeWorkgroupSizeX ?? 0) < WORKGROUP_SIZE
    || Number(limits.maxComputeInvocationsPerWorkgroup ?? 0) < WORKGROUP_SIZE
    || Math.ceil(plan.parameterCount / WORKGROUP_SIZE) > Number(limits.maxComputeWorkgroupsPerDimension ?? 0)) {
    throw failure('WEBGPU_RESOURCE_LIMIT');
  }
}

function setControl(device, uniformBuffer, { count, step, start = 0, trainRows, momentum = 0 }) {
  const values = new ArrayBuffer(32);
  const view = new DataView(values);
  view.setUint32(0, count, true);
  view.setUint32(4, step, true);
  view.setUint32(8, start, true);
  view.setUint32(12, trainRows, true);
  view.setFloat32(16, momentum, true);
  device.queue.writeBuffer(uniformBuffer, 0, values);
}

async function runWebGpuTraining(plan, {
  gpu = globalThis.navigator?.gpu,
  signal: parentSignal = null,
  maxDurationMs = BROWSER_WEBGPU_MLP_TRAINING_LIMITS.durationMs,
  onLoss = () => {},
  onYield = () => Promise.resolve(),
  onMicroBatch = null,
} = {}) {
    const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('deadline'), maxDurationMs);
  const forwardAbort = () => controller.abort(parentSignal?.reason ?? 'cancelled');
  if (parentSignal?.aborted) forwardAbort();
  else parentSignal?.addEventListener('abort', forwardAbort, { once: true });

  let device = null;
  let deviceLost = null;
  const resources = [];
  const oracleReadbacks = Boolean(onMicroBatch);
  try {
    throwIfAborted(controller.signal);
    if (!gpu || typeof gpu.requestAdapter !== 'function') throw failure('WEBGPU_UNAVAILABLE');
    const adapter = await withSignal(gpu.requestAdapter({ forceFallbackAdapter: false }), controller.signal);
    if (!adapter) throw failure('WEBGPU_ADAPTER_UNAVAILABLE');
    validateDeviceLimits(adapter.limits, plan, oracleReadbacks);
    device = await withSignal(adapter.requestDevice(), controller.signal);
    if (!device?.queue || typeof device.createComputePipelineAsync !== 'function') throw failure('WEBGPU_DEVICE_UNAVAILABLE');
    validateDeviceLimits(device.limits, plan, oracleReadbacks);
    deviceLost = device.lost.then(() => { throw failure('WEBGPU_DEVICE_LOST'); });
    deviceLost.catch(() => {});
    const awaitDevice = (promise) => Promise.race([withSignal(promise, controller.signal), deviceLost]);
    const { usage, mapRead } = webGpuConstants();
    const trainRows = plan.normalizedTrain.length;
    const featureValues = new Float32Array(trainRows * plan.inputWidth);
    plan.normalizedTrain.forEach((sample, row) => featureValues.set(sample.x, row * plan.inputWidth));
    const targetValues = new Float32Array(plan.targets);
    if (![...featureValues, ...targetValues].every(Number.isFinite)) throw failure('WEBGPU_TRAINING_NON_FINITE_INPUT');
    const initialParameters = flattenParameters(plan);
    const parameterValues = new Float32Array(initialParameters);
    const parameterBytes = parameterValues.byteLength;
    const f32 = Float32Array.BYTES_PER_ELEMENT;
    const paramsBuffer = allocate(device, usage, resources, parameterBytes, usage.STORAGE | usage.COPY_DST | usage.COPY_SRC, 'training-parameters');
    device.queue.writeBuffer(paramsBuffer, 0, parameterValues);
    const featureBuffer = allocate(device, usage, resources, featureValues.byteLength, usage.STORAGE | usage.COPY_DST, 'normalized-train-features');
    device.queue.writeBuffer(featureBuffer, 0, featureValues);
    const targetBuffer = allocate(device, usage, resources, targetValues.byteLength, usage.STORAGE | usage.COPY_DST, 'train-targets');
    device.queue.writeBuffer(targetBuffer, 0, targetValues);
    const orderBuffer = allocate(device, usage, resources, trainRows * Uint32Array.BYTES_PER_ELEMENT, usage.STORAGE | usage.COPY_DST, 'epoch-order');
    const activationBuffer = allocate(device, usage, resources, plan.batchCapacity * plan.activationStride * f32, usage.STORAGE | usage.COPY_SRC, 'batch-activations');
    const deltaBuffer = allocate(device, usage, resources, plan.batchCapacity * plan.activationStride * f32, usage.STORAGE, 'batch-deltas');
    const sampleGradientBuffer = allocate(device, usage, resources, plan.batchCapacity * plan.parameterCount * f32, usage.STORAGE, 'per-sample-gradients');
    const lossBuffer = allocate(device, usage, resources, trainRows * f32, usage.STORAGE | usage.COPY_SRC, 'sample-losses');
    const optimizerStateA = allocate(device, usage, resources, parameterBytes, usage.STORAGE | usage.COPY_DST, 'optimizer-state-a');
    const optimizerStateB = allocate(device, usage, resources, parameterBytes, usage.STORAGE | usage.COPY_DST, 'optimizer-state-b');
    const averageGradientBuffer = allocate(device, usage, resources, parameterBytes, usage.STORAGE | usage.COPY_SRC, 'average-gradients');
    const averageLossBuffer = allocate(device, usage, resources, f32, usage.STORAGE | usage.COPY_SRC, 'average-loss');
    const controlBuffer = allocate(device, usage, resources, 32,
      usage.UNIFORM | usage.COPY_DST | (oracleReadbacks ? usage.COPY_SRC : 0), 'training-control');
    const lossReadback = allocate(device, usage, resources, f32, usage.COPY_DST | usage.MAP_READ, 'average-loss-readback');
    const parameterReadback = allocate(device, usage, resources, parameterBytes, usage.COPY_DST | usage.MAP_READ, 'parameters-readback');
    const oracleReadbackBytes = (plan.parameterCount * 2 + plan.batchCapacity * (plan.outputWidth + 1) + 8) * f32;
    const oracleReadback = oracleReadbacks
      ? allocate(device, usage, resources, oracleReadbackBytes, usage.COPY_DST | usage.MAP_READ, 'micro-batch-oracle-readback')
      : null;
    device.queue.writeBuffer(optimizerStateA, 0, new Float32Array(plan.parameterCount));
    device.queue.writeBuffer(optimizerStateB, 0, new Float32Array(plan.parameterCount));

    const trainingModule = device.createShaderModule({ code: trainingShader(plan), label: 'webgpu-mlp-forward-backward' });
    const optimizerModule = device.createShaderModule({ code: optimizerShader(plan), label: 'webgpu-mlp-optimizer-update' });
    const reductionModule = device.createShaderModule({ code: lossReductionShader(trainRows), label: 'webgpu-mlp-loss-reduction' });
    const [trainingPipeline, optimizerPipeline, reductionPipeline] = await Promise.all([
      awaitDevice(device.createComputePipelineAsync({ layout: 'auto', compute: { module: trainingModule, entryPoint: 'main' } })),
      awaitDevice(device.createComputePipelineAsync({ layout: 'auto', compute: { module: optimizerModule, entryPoint: 'main' } })),
      awaitDevice(device.createComputePipelineAsync({ layout: 'auto', compute: { module: reductionModule, entryPoint: 'main' } })),
    ]);
    device.pushErrorScope('validation');
    const trainingBindGroup = device.createBindGroup({
      layout: trainingPipeline.getBindGroupLayout(0),
      entries: [paramsBuffer, featureBuffer, targetBuffer, orderBuffer, activationBuffer, deltaBuffer,
        sampleGradientBuffer, lossBuffer, controlBuffer].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    const optimizerBindGroup = device.createBindGroup({
      layout: optimizerPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: sampleGradientBuffer } },
        { binding: 2, resource: { buffer: averageGradientBuffer } },
        { binding: 3, resource: { buffer: optimizerStateA } },
        ...(plan.optimizer === 'adam_optimizer' ? [{ binding: 4, resource: { buffer: optimizerStateB } }] : []),
        { binding: 5, resource: { buffer: controlBuffer } },
      ],
    });
    const reductionBindGroup = device.createBindGroup({
      layout: reductionPipeline.getBindGroupLayout(0),
      entries: [lossBuffer, orderBuffer, averageLossBuffer]
        .map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    const bindGroupValidationError = await awaitDevice(device.popErrorScope());
    if (bindGroupValidationError) {
      throw Object.assign(new Error(bindGroupValidationError.message), { code: 'WEBGPU_TRAINING_VALIDATION_ERROR' });
    }

    let dispatchCount = 0;
    let optimizerStep = 0;
    const positionBySample = new Map(plan.normalizedTrain.map((sample, index) => [sample, index]));
    const runBatch = async ({ order, start, count, update, diagnostic = false }) => {
      throwIfAborted(controller.signal);
      device.pushErrorScope('validation');
      setControl(device, controlBuffer, { count, step: Math.max(1, optimizerStep), start, trainRows, momentum: plan.momentum });
      const encoder = device.createCommandEncoder({ label: 'webgpu-mlp-training-batch' });
      const trainingPass = encoder.beginComputePass({ label: 'webgpu-mlp-forward-backward-pass' });
      trainingPass.setPipeline(trainingPipeline);
      trainingPass.setBindGroup(0, trainingBindGroup);
      trainingPass.dispatchWorkgroups(Math.ceil(count / WORKGROUP_SIZE));
      dispatchCount += 1;
      trainingPass.end();
      if (update) {
        const optimizerPass = encoder.beginComputePass({ label: 'webgpu-mlp-optimizer-pass' });
        optimizerPass.setPipeline(optimizerPipeline);
        optimizerPass.setBindGroup(0, optimizerBindGroup);
        optimizerPass.dispatchWorkgroups(Math.ceil(plan.parameterCount / WORKGROUP_SIZE));
        dispatchCount += 1;
        optimizerPass.end();
      }
      if (diagnostic) {
        const gradientOffset = 0;
        const parameterOffset = parameterBytes;
        const outputOffset = parameterBytes * 2;
        const sampleLossOffset = outputOffset + plan.batchCapacity * plan.outputWidth * f32;
        const controlOffset = sampleLossOffset + plan.batchCapacity * f32;
        encoder.copyBufferToBuffer(averageGradientBuffer, 0, oracleReadback, gradientOffset, parameterBytes);
        encoder.copyBufferToBuffer(paramsBuffer, 0, oracleReadback, parameterOffset, parameterBytes);
        for (let lane = 0; lane < count; lane += 1) {
          const row = order[start + lane];
          const finalActivationOffset = (lane * plan.activationStride + plan.stages.at(-1).offset) * f32;
          encoder.copyBufferToBuffer(activationBuffer, finalActivationOffset,
            oracleReadback, outputOffset + lane * plan.outputWidth * f32, plan.outputWidth * f32);
          encoder.copyBufferToBuffer(lossBuffer, row * f32, oracleReadback,
            sampleLossOffset + lane * f32, f32);
        }
        encoder.copyBufferToBuffer(controlBuffer, 0, oracleReadback, controlOffset, 32);
      }
      device.queue.submit([encoder.finish()]);
      await awaitDevice(device.queue.onSubmittedWorkDone());
      const validationError = await awaitDevice(device.popErrorScope());
      if (validationError) {
        throw Object.assign(new Error(validationError.message), { code: 'WEBGPU_TRAINING_VALIDATION_ERROR' });
      }
      if (!diagnostic) return null;
      await awaitDevice(oracleReadback.mapAsync(mapRead));
      const values = new Float32Array(oracleReadback.getMappedRange());
      const gradientOffset = 0;
      const parameterOffset = parameterBytes;
      const outputOffset = parameterBytes * 2;
      const sampleLossOffset = outputOffset + plan.batchCapacity * plan.outputWidth * f32;
      const controlOffset = sampleLossOffset + plan.batchCapacity * f32;
      const diagnostics = {
        sampleIndices: order.slice(start, start + count),
        sampleLosses: Array.from(values.slice(sampleLossOffset / f32, sampleLossOffset / f32 + count)),
        outputs: Array.from({ length: count }, (_, lane) => Array.from(values.slice(
          outputOffset / f32 + lane * plan.outputWidth,
          outputOffset / f32 + (lane + 1) * plan.outputWidth,
        ))),
        meanGradients: Array.from(values.slice(gradientOffset / f32, gradientOffset / f32 + plan.parameterCount)),
        updatedParameters: Array.from(values.slice(parameterOffset / f32, parameterOffset / f32 + plan.parameterCount)),
        controlValues: Array.from(new Uint32Array(values.buffer, values.byteOffset + controlOffset, 8)),
      };
      oracleReadback.unmap();
      if (!finiteTree(diagnostics)) throw failure('WEBGPU_TRAINING_NON_FINITE_OUTPUT');
      return diagnostics;
    };

    const reduceEpochLoss = async (order) => {
      device.queue.writeBuffer(orderBuffer, 0, new Uint32Array(order));
      setControl(device, controlBuffer, { count: plan.batchCapacity, step: Math.max(1, optimizerStep), trainRows, start: 0, momentum: plan.momentum });
      const encoder = device.createCommandEncoder({ label: 'webgpu-mlp-loss-reduction' });
      const pass = encoder.beginComputePass({ label: 'webgpu-mlp-loss-reduction-pass' });
      pass.setPipeline(reductionPipeline);
      pass.setBindGroup(0, reductionBindGroup);
      pass.dispatchWorkgroups(1);
      dispatchCount += 1;
      pass.end();
      encoder.copyBufferToBuffer(averageLossBuffer, 0, lossReadback, 0, f32);
      device.queue.submit([encoder.finish()]);
      await awaitDevice(device.queue.onSubmittedWorkDone());
      await awaitDevice(lossReadback.mapAsync(mapRead));
      const average = new Float32Array(lossReadback.getMappedRange())[0];
      lossReadback.unmap();
      if (!Number.isFinite(average)) throw failure('WEBGPU_TRAINING_NON_FINITE_OUTPUT');
      return average;
    };

    const identityOrder = Array.from({ length: trainRows }, (_, index) => index);
    device.queue.writeBuffer(orderBuffer, 0, new Uint32Array(identityOrder));
    for (let start = 0; start < trainRows; start += plan.batchCapacity) {
      const count = Math.min(plan.batchCapacity, trainRows - start);
      await runBatch({ order: identityOrder, start, count, update: false });
    }
    const initialLoss = await reduceEpochLoss(identityOrder);
    const lossHistory = [];
    const reportStride = Math.max(1, Math.floor(plan.epochs / 50));
    for (let epoch = 0; epoch < plan.epochs; epoch += 1) {
      throwIfAborted(controller.signal);
      const examples = plan.shuffle
        ? deterministicShuffle(plan.normalizedTrain, plan.seed + epoch)
        : plan.normalizedTrain;
      const order = examples.map((sample) => positionBySample.get(sample));
      if (order.some((index) => !Number.isInteger(index))) throw failure('WEBGPU_TRAINING_ORDER_INVALID');
      device.queue.writeBuffer(orderBuffer, 0, new Uint32Array(order));
      for (let start = 0; start < trainRows; start += plan.batchCapacity) {
        throwIfAborted(controller.signal);
        const count = Math.min(plan.batchCapacity, trainRows - start);
        optimizerStep += 1;
        const diagnostics = await runBatch({
          order,
          start,
          count,
          update: true,
          diagnostic: Boolean(onMicroBatch),
        });
        if (diagnostics) onMicroBatch({
          epoch,
          step: optimizerStep,
          sampleIndices: diagnostics.sampleIndices,
          sampleLosses: diagnostics.sampleLosses,
          outputs: diagnostics.outputs,
          meanGradients: diagnostics.meanGradients,
          controlValues: diagnostics.controlValues,
          initialParameters: Array.from(initialParameters),
          updatedParameters: diagnostics.updatedParameters,
        });
      }
      const averageLoss = await reduceEpochLoss(order);
      lossHistory.push(averageLoss);
      if (epoch % reportStride === 0 || epoch === plan.epochs - 1) {
        onLoss([...lossHistory]);
        await onYield();
        throwIfAborted(controller.signal);
      }
    }

    const readEncoder = device.createCommandEncoder({ label: 'webgpu-mlp-result-readback' });
    readEncoder.copyBufferToBuffer(paramsBuffer, 0, parameterReadback, 0, parameterBytes);
    device.queue.submit([readEncoder.finish()]);
    await awaitDevice(device.queue.onSubmittedWorkDone());
    await awaitDevice(parameterReadback.mapAsync(mapRead));
    const finalParameters = Array.from(new Float32Array(parameterReadback.getMappedRange()));
    parameterReadback.unmap();
    if (!finiteTree(finalParameters) || !finiteTree(lossHistory)) throw failure('WEBGPU_TRAINING_NON_FINITE_OUTPUT');
    const trainedLayers = serializeParameters(plan, finalParameters);
    const model = {
      type: 'browser_mlp',
      sourceNodeId: plan.sourceNodeId,
      modelNodeId: plan.modelNodeId,
      featureColumns: [...plan.dataset.featureColumns],
      targetColumn: plan.dataset.targetColumn,
      layers: trainedLayers,
      normalization: plan.normalization,
      labels: plan.labels,
      task: plan.task,
      test: plan.split.test,
      trainRows: trainRows,
      testRows: plan.split.test.length,
      metrics: null,
      lossHistory,
      epochs: plan.epochs,
      learningRate: plan.learningRate,
      trainedAt: new Date().toISOString(),
      hasPredictor: false,
      trainingSummary: {
        initialLoss,
        finalTrainingLoss: lossHistory.at(-1),
        optimizerSteps: plan.trainingSteps,
        dispatchCount,
        providerVersion: BROWSER_WEBGPU_MLP_TRAINING_PROVIDER_VERSION,
      },
    };
    const { test: _testRows, ...boundedResult } = model;
    const resultBytes = new TextEncoder().encode(JSON.stringify(boundedResult)).byteLength;
    if (resultBytes > BROWSER_WEBGPU_MLP_TRAINING_LIMITS.resultBytes) throw failure('WEBGPU_TRAINING_LIMIT_EXCEEDED');
    if (controller.signal.aborted) throwIfAborted(controller.signal);
    return model;
  } catch (error) {
    if (controller.signal.aborted) throwIfAborted(controller.signal);
    if (error?.code) throw error;
    throw failure(device ? 'WEBGPU_TRAINING_EXECUTION_FAILED' : 'WEBGPU_RESOURCE_LIMIT');
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', forwardAbort);
    resources.forEach((resource) => {
      try { resource.destroy(); } catch { /* Device loss can dispose buffers first. */ }
    });
    try { device?.destroy(); } catch { /* Resource teardown remains fail-closed. */ }
  }
}

/** Fits only the registered sequential tabular MLP profile; all training math runs on WebGPU. */
export async function trainBrowserWebGpuMlp({
  architecture,
  split,
  loss,
  optimizer,
  trainer,
  onLoss,
  onYield,
  signal,
  seed = DEFAULT_KNN_SEED,
  gpu,
  maxDurationMs = BROWSER_WEBGPU_MLP_TRAINING_LIMITS.durationMs,
  onMicroBatch = null,
} = {}) {
  if (!Number.isInteger(maxDurationMs) || maxDurationMs < 1
    || maxDurationMs > BROWSER_WEBGPU_MLP_TRAINING_LIMITS.durationMs) throw failure('WEBGPU_TRAINING_CONFIG_INVALID');
  const plan = trainingPlan({ architecture, split, loss, optimizer, trainer, seed });
  return runWebGpuTraining(plan, { gpu, signal, maxDurationMs, onLoss, onYield, onMicroBatch });
}
