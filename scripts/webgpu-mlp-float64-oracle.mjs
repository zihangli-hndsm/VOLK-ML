// Independent scalar Float64 oracle for the bounded browser WebGPU MLP trainer.
// Keep this implementation separate from the WGSL source and production runtime.
export const TRAINING_ORACLE_ENVELOPE = Object.freeze({ absolute: 1e-5, relative: 5e-4 });

function sigmoid(value) {
  const clipped = Math.max(-30, Math.min(30, value));
  return 1 / (1 + Math.exp(-clipped));
}

function softmax(values) {
  const maximum = Math.max(...values);
  const exponents = values.map((value) => Math.exp(value - maximum));
  const sum = exponents.reduce((total, value) => total + value, 0);
  return exponents.map((value) => value / sum);
}

export function initializeOracleParameters(architecture, seed = 2026) {
  let flattened = [];
  const layers = architecture.layers.map((source, index) => {
    if (source.op !== 'dense') return { ...source };
    let state = seed + index;
    const next = () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296 - 0.5;
    };
    const scale = Math.sqrt(2 / Math.max(1, source.input_features + source.units));
    const weights = Array.from({ length: source.units }, () => (
      Array.from({ length: source.input_features }, () => next() * scale)
    ));
    const bias = Array.from({ length: source.units }, () => 0);
    flattened.push(...weights.flat(), ...bias);
    return { ...source, weights, bias };
  });
  return { layers, parameters: flattened };
}

function flattenLayers(layers) {
  return layers.flatMap((layer) => layer.op === 'dense' ? [...layer.weights.flat(), ...layer.bias] : []);
}

function applyParameters(layers, parameters) {
  let cursor = 0;
  return layers.map((layer) => {
    if (layer.op !== 'dense') return { ...layer };
    const weights = Array.from({ length: layer.units }, () => (
      Array.from({ length: layer.input_features }, () => parameters[cursor++])
    ));
    const bias = Array.from({ length: layer.units }, () => parameters[cursor++]);
    return { ...layer, weights, bias };
  });
}

function forward(layers, input) {
  let values = [...input];
  const trace = [values];
  for (const layer of layers) {
    if (layer.op === 'dense') {
      values = layer.weights.map((row, unit) => row.reduce(
        (sum, weight, feature) => sum + weight * values[feature],
        layer.bias[unit],
      ));
    } else if (layer.op === 'relu') values = values.map((value) => Math.max(0, value));
    else if (layer.op === 'sigmoid') values = values.map(sigmoid);
    else if (layer.op === 'tanh') values = values.map(Math.tanh);
    else if (layer.op === 'softmax') values = softmax(values);
    else throw new Error(`Oracle does not support ${layer.op}.`);
    trace.push(values);
  }
  return { values, trace };
}

function softmaxJacobianVector(probabilities, upstream) {
  const projection = probabilities.reduce((sum, value, index) => sum + value * upstream[index], 0);
  return probabilities.map((value, index) => value * (upstream[index] - projection));
}

function activationDerivative(output, op) {
  if (op === 'relu') return output.map((value) => value > 0 ? 1 : 0);
  if (op === 'sigmoid') return output.map((value) => value * (1 - value));
  if (op === 'tanh') return output.map((value) => 1 - value * value);
  return output.map(() => 1);
}

function deriveSampleGradient(layers, x, target, { task, labels }) {
  const { values, trace } = forward(layers, x);
  let loss;
  let delta;
  if (task === 'classification') {
    const targetIndex = labels.indexOf(String(target));
    if (targetIndex < 0) throw new Error('Oracle target label is not registered.');
    loss = -Math.log(Math.max(1e-12, values[targetIndex]));
    delta = values.map((probability, index) => probability - (index === targetIndex ? 1 : 0));
  } else {
    const error = values[0] - Number(target);
    loss = error * error;
    delta = [2 * error];
  }
  const gradients = layers.map((layer) => layer.op === 'dense'
    ? { weights: layer.weights.map((row) => row.map(() => 0)), bias: layer.bias.map(() => 0) }
    : null);
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    if (layer.op === 'softmax') {
      if (index !== layers.length - 1) delta = softmaxJacobianVector(trace[index + 1], delta);
      continue;
    }
    if (layer.op !== 'dense') {
      const derivative = activationDerivative(trace[index + 1], layer.op);
      delta = delta.map((value, unit) => value * derivative[unit]);
      continue;
    }
    const previous = trace[index];
    const propagated = previous.map((_, feature) => layer.weights.reduce(
      (sum, row, unit) => sum + row[feature] * delta[unit],
      0,
    ));
    for (let unit = 0; unit < layer.units; unit += 1) {
      for (let feature = 0; feature < layer.input_features; feature += 1) {
        gradients[index].weights[unit][feature] = delta[unit] * previous[feature];
      }
      if (layer.use_bias) gradients[index].bias[unit] = delta[unit];
    }
    delta = propagated;
  }
  return { output: values, loss, gradients };
}

function flattenGradients(layers, gradients) {
  return layers.flatMap((layer, index) => layer.op === 'dense'
    ? [...gradients[index].weights.flat(), ...gradients[index].bias]
    : []);
}

/** Compute one independent Float64 mean-gradient optimizer step. */
export function oracleMlpMicroBatch({
  architecture,
  parameters,
  samples,
  task,
  labels = [],
  optimizer = 'sgd_optimizer',
  learningRate = 0.01,
  momentum = 0,
  state = null,
} = {}) {
  const layers = applyParameters(architecture.layers, parameters);
  const parameterCount = parameters.length;
  const summed = new Array(parameterCount).fill(0);
  const outputs = [];
  const sampleLosses = [];
  for (const sample of samples) {
    const result = deriveSampleGradient(layers, sample.x, sample.y, { task, labels });
    outputs.push(result.output);
    sampleLosses.push(result.loss);
    const flat = flattenGradients(layers, result.gradients);
    flat.forEach((gradient, index) => { summed[index] += gradient; });
  }
  const meanGradients = summed.map((gradient) => gradient / samples.length);
  const nextState = state ?? {
    steps: 0,
    velocity: new Array(parameterCount).fill(0),
    firstMoment: new Array(parameterCount).fill(0),
    secondMoment: new Array(parameterCount).fill(0),
  };
  nextState.steps += 1;
  const updatedParameters = parameters.map((parameter, index) => {
    const gradient = meanGradients[index];
    if (optimizer === 'sgd_optimizer') {
      nextState.velocity[index] = momentum * nextState.velocity[index] + gradient;
      return parameter - learningRate * nextState.velocity[index];
    }
    if (optimizer !== 'adam_optimizer') throw new Error(`Oracle does not support ${optimizer}.`);
    nextState.firstMoment[index] = 0.9 * nextState.firstMoment[index] + 0.1 * gradient;
    nextState.secondMoment[index] = 0.999 * nextState.secondMoment[index] + 0.001 * gradient * gradient;
    const correctedFirst = nextState.firstMoment[index] / (1 - 0.9 ** nextState.steps);
    const correctedSecond = nextState.secondMoment[index] / (1 - 0.999 ** nextState.steps);
    return parameter - learningRate * correctedFirst / (Math.sqrt(correctedSecond) + 1e-8);
  });
  return { outputs, sampleLosses, meanGradients, updatedParameters, state: nextState };
}

export function compareWithFixedEnvelope(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) return false;
  return actual.every((value, index) => Number.isFinite(value)
    && Number.isFinite(expected[index])
    && Math.abs(value - expected[index]) <= TRAINING_ORACLE_ENVELOPE.absolute
      + TRAINING_ORACLE_ENVELOPE.relative * Math.abs(expected[index]));
}
