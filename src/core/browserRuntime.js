import { localizedError } from '../i18n.js';
import { flattenCustomComposites } from './customComposites.js';
import { analyzeBrowserExecutionGraph, profileBrowserDataset } from './browserExecutionContract.js';

function resolvePort(manifest, direction, handleId) {
  const ports = direction === 'output' ? manifest.outputs : manifest.inputs;
  return ports.find((port) => port.name === handleId) ?? (ports.length === 1 ? ports[0] : null);
}

function deterministicShuffle(samples, seed = 2026) {
  const shuffled = [...samples];
  let state = seed >>> 0;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    const target = state % (index + 1);
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function valuesAreFinite(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(valuesAreFinite);
  if (value && typeof value === 'object') return Object.values(value).every(valuesAreFinite);
  return true;
}

function requireFiniteTrainingState(...values) {
  if (!values.every(valuesAreFinite)) throw localizedError('error.browserMlpDiverged');
}

function splitSamples(samples, trainRatio) {
  const shuffled = deterministicShuffle(samples);
  const splitIndex = Math.max(1, Math.min(
    shuffled.length - 1,
    Math.floor(shuffled.length * trainRatio),
  ));
  return {
    train: shuffled.slice(0, splitIndex),
    test: shuffled.slice(splitIndex),
  };
}

function stratifiedSplit(samples, trainRatio) {
  const groups = new Map();
  samples.forEach((sample) => {
    const group = groups.get(sample.y) ?? [];
    group.push(sample);
    groups.set(sample.y, group);
  });
  const train = [];
  const test = [];
  groups.forEach((group) => {
    const shuffled = deterministicShuffle(group);
    if (shuffled.length === 1) {
      train.push(shuffled[0]);
      return;
    }
    const splitIndex = Math.max(1, Math.min(
      shuffled.length - 1,
      Math.floor(shuffled.length * trainRatio),
    ));
    train.push(...shuffled.slice(0, splitIndex));
    test.push(...shuffled.slice(splitIndex));
  });
  return {
    train: deterministicShuffle(train),
    test: deterministicShuffle(test),
  };
}

function featureNormalization(samples, featureCount) {
  const means = Array.from({ length: featureCount }, (_, feature) => (
    samples.reduce((sum, sample) => sum + sample.x[feature], 0) / samples.length
  ));
  const stds = Array.from({ length: featureCount }, (_, feature) => (
    Math.sqrt(samples.reduce(
      (sum, sample) => sum + (sample.x[feature] - means[feature]) ** 2,
      0,
    ) / samples.length) || 1
  ));
  return { means, stds };
}

function normalizeFeatures(values, normalization) {
  return values.map((value, feature) => (
    (value - normalization.means[feature]) / normalization.stds[feature]
  ));
}

function nearestNeighborLabel(model, rawFeatures) {
  const normalized = normalizeFeatures(rawFeatures, model.normalization);
  const neighbors = model.train.map((sample) => ({
    label: sample.y,
    distance: sample.x.reduce(
      (sum, value, feature) => sum + (value - normalized[feature]) ** 2,
      0,
    ),
  })).sort((left, right) => left.distance - right.distance).slice(0, model.k);
  const votes = new Map();
  neighbors.forEach(({ label, distance }) => {
    const current = votes.get(label) ?? { count: 0, distance: 0 };
    votes.set(label, { count: current.count + 1, distance: current.distance + distance });
  });
  return [...votes.entries()].sort((left, right) => (
    right[1].count - left[1].count
    || left[1].distance - right[1].distance
    || left[0].localeCompare(right[0])
  ))[0]?.[0];
}

const neuralActivations = new Set(['relu', 'sigmoid', 'tanh', 'softmax']);
const neuralArchitectureOps = new Set(['tensor_input', 'dense', ...neuralActivations, 'model_output']);

function parseShape(shape) {
  const dimensions = String(shape ?? '').split(',').map((part) => Number(part.trim()));
  return dimensions.length === 1 && Number.isInteger(dimensions[0]) && dimensions[0] > 0 ? dimensions[0] : null;
}

function activation(values, op) {
  if (op === 'relu') return values.map((value) => Math.max(0, value));
  if (op === 'sigmoid') return values.map((value) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value)))));
  if (op === 'tanh') return values.map((value) => Math.tanh(value));
  if (op === 'softmax') {
    const maximum = Math.max(...values);
    const exponentials = values.map((value) => Math.exp(value - maximum));
    const total = exponentials.reduce((sum, value) => sum + value, 0);
    return exponentials.map((value) => value / total);
  }
  return values;
}

function activationGradient(output, op) {
  if (op === 'relu') return output.map((value) => (value > 0 ? 1 : 0));
  if (op === 'sigmoid') return output.map((value) => value * (1 - value));
  if (op === 'tanh') return output.map((value) => 1 - value ** 2);
  return output.map(() => 1);
}

function softmaxGradient(output, upstream) {
  const projection = output.reduce((sum, value, index) => sum + value * upstream[index], 0);
  return output.map((value, index) => value * (upstream[index] - projection));
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

function forwardNeural(layers, input) {
  let values = input;
  const trace = [{ op: 'input', output: values }];
  layers.forEach((layer) => {
    if (layer.op === 'dense') {
      values = layer.weights.map((row, unit) => row.reduce((sum, weight, feature) => sum + weight * values[feature], layer.bias[unit]));
    } else values = activation(values, layer.op);
    trace.push({ op: layer.op, layer, output: values });
  });
  return { values, trace };
}

function trainBrowserMlp({ architecture, split, loss, optimizer, trainer, onLoss, onYield }) {
  const sourceDataset = split.dataset;
  const inputSize = sourceDataset.featureColumns.length;
  if (architecture.inputSize !== inputSize) throw localizedError('error.browserMlpShape');
  const denseLayers = architecture.layers.filter((layer) => layer.op === 'dense');
  if (!denseLayers.length || !architecture.layers.at(-1)?.op || architecture.layers.some((layer) => !['dense', ...neuralActivations].includes(layer.op))) {
    throw localizedError('error.browserMlpArchitecture');
  }
  const layers = architecture.layers.map((layer, index) => (
    layer.op === 'dense'
      ? {
        ...layer,
        ...initializeDense(layer.input_features, layer.units, layer.use_bias, 2026 + index),
        adam: {
          weights: Array.from({ length: layer.units }, () => Array.from({ length: layer.input_features }, () => ({ m: 0, v: 0 }))),
          bias: Array.from({ length: layer.units }, () => ({ m: 0, v: 0 })),
        },
        sgd: {
          weights: Array.from({ length: layer.units }, () => Array.from({ length: layer.input_features }, () => 0)),
          bias: Array.from({ length: layer.units }, () => 0),
        },
      }
      : { ...layer }
  ));
  let currentWidth = inputSize;
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    if (layer.op === 'dense') {
      if (layer.input_features !== currentWidth) throw localizedError('error.browserMlpShape');
      currentWidth = layer.units;
    }
  }
  const outputUnits = denseLayers.at(-1).units;
  const isClassification = sourceDataset.task === 'classification';
  const labels = isClassification ? [...new Set(split.train.map((sample) => sample.y))].sort() : [];
  if (isClassification && (labels.length < 2 || outputUnits !== labels.length || loss.op !== 'cross_entropy_loss' || layers.at(-1).op !== 'softmax')) {
    throw localizedError('error.browserMlpClassification');
  }
  if (!isClassification && (outputUnits !== 1 || loss.op !== 'mse_loss')) throw localizedError('error.browserMlpRegression');
  const normalization = featureNormalization(split.train, inputSize);
  const normalizedTrain = split.train.map((sample) => ({ ...sample, x: normalizeFeatures(sample.x, normalization) }));
  requireFiniteTrainingState(normalization, normalizedTrain);
  const history = [];
  const learningRate = Number(optimizer.learning_rate);
  const epochs = Number(trainer.epochs);
  const batchSize = Math.max(1, Number(trainer.batch_size));
  let optimizerStep = 0;
  const applyGradient = (layer, unit, feature, gradient, isBias = false) => {
    if (optimizer.op === 'sgd_optimizer') {
      const velocity = isBias ? layer.sgd.bias : layer.sgd.weights[unit];
      const index = isBias ? unit : feature;
      velocity[index] = Number(optimizer.momentum ?? 0) * velocity[index] + gradient;
      return learningRate * velocity[index];
    }
    const state = isBias ? layer.adam.bias[unit] : layer.adam.weights[unit][feature];
    state.m = 0.9 * state.m + 0.1 * gradient;
    state.v = 0.999 * state.v + 0.001 * gradient ** 2;
    const correctedM = state.m / (1 - 0.9 ** optimizerStep);
    const correctedV = state.v / (1 - 0.999 ** optimizerStep);
    return learningRate * correctedM / (Math.sqrt(correctedV) + 1e-8);
  };
  const emptyGradients = () => layers.map((layer) => (
    layer.op === 'dense'
      ? { weights: layer.weights.map((row) => row.map(() => 0)), bias: layer.bias.map(() => 0) }
      : null
  ));
  const accumulateSampleGradients = (sample, gradients) => {
    const { values, trace } = forwardNeural(layers, sample.x);
    requireFiniteTrainingState(values, trace);
    let delta;
    let sampleLoss;
    if (isClassification) {
      const targetIndex = labels.indexOf(sample.y);
      sampleLoss = -Math.log(Math.max(1e-12, values[targetIndex]));
      delta = values.map((value, index) => value - (index === targetIndex ? 1 : 0));
    } else {
      const error = values[0] - sample.y;
      sampleLoss = error ** 2;
      delta = [2 * error];
    }
    requireFiniteTrainingState(sampleLoss, delta);
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const layer = layers[index];
      const previous = trace[index].output;
      if (layer.op !== 'dense') {
        if (layer.op === 'softmax') {
          if (index !== layers.length - 1) delta = softmaxGradient(trace[index + 1].output, delta);
        } else {
          delta = delta.map((value, unit) => value * activationGradient(trace[index + 1].output, layer.op)[unit]);
        }
        continue;
      }
      const propagated = previous.map((_, feature) => layer.weights.reduce((sum, row, unit) => sum + row[feature] * delta[unit], 0));
      gradients[index].weights.forEach((row, unit) => row.forEach((_, feature) => {
        gradients[index].weights[unit][feature] += delta[unit] * previous[feature];
      }));
      if (layer.use_bias) gradients[index].bias.forEach((_, unit) => { gradients[index].bias[unit] += delta[unit]; });
      delta = propagated;
    }
    requireFiniteTrainingState(gradients, delta);
    return sampleLoss;
  };
  const applyBatchGradients = (gradients, examplesInBatch) => {
    optimizerStep += 1;
    layers.forEach((layer, index) => {
      if (layer.op !== 'dense') return;
      layer.weights = layer.weights.map((row, unit) => row.map((weight, feature) => (
        weight - applyGradient(layer, unit, feature, gradients[index].weights[unit][feature] / examplesInBatch)
      )));
      if (layer.use_bias) layer.bias = layer.bias.map((value, unit) => (
        value - applyGradient(layer, unit, null, gradients[index].bias[unit] / examplesInBatch, true)
      ));
    });
    requireFiniteTrainingState(layers);
  };
  return (async () => {
    for (let epoch = 0; epoch < epochs; epoch += 1) {
      const examples = trainer.shuffle ? deterministicShuffle(normalizedTrain, 2026 + epoch) : normalizedTrain;
      let epochLoss = 0;
      for (let start = 0; start < examples.length; start += batchSize) {
        const batch = examples.slice(start, start + batchSize);
        const gradients = emptyGradients();
        batch.forEach((sample) => { epochLoss += accumulateSampleGradients(sample, gradients); });
        requireFiniteTrainingState(epochLoss);
        applyBatchGradients(gradients, batch.length);
      }
      const averageLoss = epochLoss / examples.length;
      requireFiniteTrainingState(averageLoss);
      history.push(averageLoss);
      if (epoch % Math.max(1, Math.floor(epochs / 50)) === 0 || epoch === epochs - 1) {
        onLoss([...history]);
        await onYield();
      }
    }
    const inferenceLayers = layers.map(({ adam, sgd, ...layer }) => layer);
    requireFiniteTrainingState(inferenceLayers, history);
    return {
      type: 'browser_mlp', sourceNodeId: trainer.id, modelNodeId: architecture.modelNodeId,
      featureColumns: sourceDataset.featureColumns, targetColumn: sourceDataset.targetColumn,
      layers: inferenceLayers, normalization, labels, task: sourceDataset.task, test: split.test,
      trainRows: split.train.length, testRows: split.test.length, metrics: null, lossHistory: history,
      epochs, learningRate, trainedAt: new Date().toISOString(), hasPredictor: false,
    };
  })();
}

export function compileExecutionGraph(nodes, edges) {
  if (!edges.length) throw localizedError('error.connectBeforeRun');
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const activeIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const activeNodes = nodes.filter((node) => activeIds.has(node.id));
  const incoming = new Map(activeNodes.map((node) => [node.id, []]));
  const outgoing = new Map(activeNodes.map((node) => [node.id, []]));
  edges.forEach((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) throw localizedError('error.missingConnectionNode');
    const sourcePort = resolvePort(source.data.manifest, 'output', edge.sourceHandle);
    const targetPort = resolvePort(target.data.manifest, 'input', edge.targetHandle);
    if (!sourcePort || !targetPort) {
      throw localizedError('error.invalidConnection', {
        source: source.data.manifest.name,
        target: target.data.manifest.name,
      });
    }
    if (sourcePort.type !== targetPort.type) {
      throw localizedError('error.typeMismatch', { source: sourcePort.type, target: targetPort.type });
    }
    incoming.get(target.id).push({
      edge,
      source,
      output: sourcePort,
      input: targetPort,
    });
    outgoing.get(source.id).push(target.id);
  });
  activeNodes.forEach((node) => node.data.manifest.inputs.forEach((input) => {
    const matches = incoming.get(node.id).filter((connection) => connection.input.name === input.name);
    if (!matches.length) {
      throw localizedError('error.missingInput', { node: node.data.manifest.name, input: input.name });
    }
    if (matches.length > 1) {
      throw localizedError('error.multipleInputs', { node: node.data.manifest.name, input: input.name });
    }
  }));
  const indegree = new Map(activeNodes.map((node) => [node.id, incoming.get(node.id).length]));
  const queue = activeNodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(nodeById.get(id));
    outgoing.get(id).forEach((targetId) => {
      const next = indegree.get(targetId) - 1;
      indegree.set(targetId, next);
      if (next === 0) queue.push(targetId);
    });
  }
  if (order.length !== activeNodes.length) throw localizedError('error.pipelineCycle');
  if (!order.some((node) => node.data.manifest.id === 'tabular_data_node')) {
    throw localizedError('error.dataNodeRequired');
  }
  return { order, incoming };
}

function evaluateClassification(model) {
  const predictions = model.test.map((sample) => ({
    actual: sample.y,
    predicted: nearestNeighborLabel(model, sample.x),
  }));
  const classes = [...new Set([
    ...model.train.map((sample) => sample.y),
    ...model.test.map((sample) => sample.y),
  ])];
  const correct = predictions.filter((item) => item.actual === item.predicted).length;
  const macroF1 = classes.reduce((sum, label) => {
    const truePositive = predictions.filter(
      (item) => item.actual === label && item.predicted === label,
    ).length;
    const falsePositive = predictions.filter(
      (item) => item.actual !== label && item.predicted === label,
    ).length;
    const falseNegative = predictions.filter(
      (item) => item.actual === label && item.predicted !== label,
    ).length;
    const precision = truePositive / Math.max(1, truePositive + falsePositive);
    const recall = truePositive / Math.max(1, truePositive + falseNegative);
    return sum + (precision + recall ? (2 * precision * recall) / (precision + recall) : 0);
  }, 0) / classes.length;
  return {
    accuracy: correct / predictions.length,
    macroF1,
    classes: classes.length,
    trainRows: model.trainRows,
    testRows: model.testRows,
  };
}

export function predictWithModel(model, rawFeatures) {
  if (model.type === 'knn_classifier') return nearestNeighborLabel(model, rawFeatures);
  if (model.type === 'browser_mlp') {
    const values = forwardNeural(model.layers, normalizeFeatures(rawFeatures, model.normalization)).values;
    return model.task === 'classification'
      ? model.labels[values.indexOf(Math.max(...values))]
      : values[0];
  }
  const {
    xMeans,
    xStds,
    yMean,
    yStd,
  } = model.normalization;
  const normalizedPrediction = model.weights.reduce(
    (sum, weight, feature) => (
      sum + weight * ((rawFeatures[feature] - xMeans[feature]) / xStds[feature])
    ),
    model.bias,
  );
  return normalizedPrediction * yStd + yMean;
}

export async function executeBrowserGraph({
  nodes,
  edges,
  dataset,
  onNodeStatus = () => {},
  onLoss = () => {},
  onYield = () => Promise.resolve(),
}) {
  const flattened = flattenCustomComposites(nodes, edges);
  const plan = compileExecutionGraph(flattened.nodes, flattened.edges);
  if (!dataset) throw localizedError('error.datasetMissing');
  const contract = analyzeBrowserExecutionGraph({
    nodes: flattened.nodes,
    edges: flattened.edges,
    dataset,
    alreadyFlattened: true,
  });
  if (!contract.valid) throw localizedError(contract.reason);
  const outputs = new Map();
  let finalModel = null;
  const inputValue = (node, inputName) => {
    const connection = plan.incoming.get(node.id).find((item) => item.input.name === inputName);
    return connection ? outputs.get(connection.source.id) : undefined;
  };

  for (const node of plan.order) {
    onNodeStatus([node.data.runtimeOwnerId ?? node.id], 'running');
    const manifestId = node.data.manifest.id;
    const manifestOp = node.data.manifest.op;
    let output;
    if (manifestId === 'tabular_data_node') {
      output = dataset;
    } else if (manifestId === 'train_test_split_node') {
      const sourceDataset = inputValue(node, 'dataset');
      const valid = profileBrowserDataset(sourceDataset).samples;
      if (valid.length < 3) throw localizedError('error.tooFewRows');
      const { train, test } = sourceDataset.task === 'classification'
        ? stratifiedSplit(valid, node.data.parameters.train_ratio)
        : splitSamples(valid, node.data.parameters.train_ratio);
      if (sourceDataset.task === 'classification' && test.length === 0) {
        throw localizedError('error.classificationTestRequired');
      }
      output = {
        dataset: sourceDataset,
        train,
        test,
        trainRatio: node.data.parameters.train_ratio,
      };
    } else if (manifestOp === 'tensor_input') {
      const inputSize = parseShape(node.data.parameters.shape);
      if (!inputSize || node.data.parameters.dtype === 'int32') throw localizedError('error.browserMlpShape');
      output = { type: 'neural_architecture', inputSize, layers: [], modelNodeId: null };
    } else if (manifestOp === 'dense') {
      const architecture = inputValue(node, 'input');
      output = {
        ...architecture,
        layers: [...architecture.layers, {
          op: 'dense', input_features: Number(node.data.parameters.input_features),
          units: Number(node.data.parameters.units), use_bias: Boolean(node.data.parameters.use_bias),
        }],
      };
    } else if (neuralActivations.has(manifestOp)) {
      const architecture = inputValue(node, 'input');
      output = { ...architecture, layers: [...architecture.layers, { op: manifestOp }] };
    } else if (manifestOp === 'model_output') {
      const architecture = inputValue(node, 'input');
      output = {
        ...architecture,
        type: 'neural_model_spec',
        modelNodeId: node.data.runtimeOwnerId ?? node.id,
      };
    } else if (manifestOp === 'cross_entropy_loss' || manifestOp === 'mse_loss') {
      output = { op: manifestOp };
    } else if (manifestOp === 'sgd_optimizer' || manifestOp === 'adam_optimizer') {
      output = {
        op: manifestOp,
        learning_rate: node.data.parameters.learning_rate,
        momentum: node.data.parameters.momentum,
      };
    } else if (manifestOp === 'supervised_trainer') {
      output = await trainBrowserMlp({
        architecture: inputValue(node, 'model'), split: inputValue(node, 'dataset'),
        loss: inputValue(node, 'loss'), optimizer: inputValue(node, 'optimizer'),
        trainer: {
          ...node.data.parameters,
          id: node.data.runtimeOwnerId ?? node.id,
        },
        onLoss,
        onYield,
      });
      finalModel = output;
    } else if (manifestId === 'linear_regression_node') {
      output = {
        type: 'linear_regression_spec',
        split: inputValue(node, 'split'),
        learningRate: node.data.parameters.learning_rate,
        modelNodeId: node.id,
      };
    } else if (manifestId === 'gradient_descent_node') {
      const spec = inputValue(node, 'model');
      const { dataset: sourceDataset, train, test } = spec.split;
      const xMeans = sourceDataset.featureColumns.map(
        (_, feature) => train.reduce((sum, sample) => sum + sample.x[feature], 0) / train.length,
      );
      const xStds = sourceDataset.featureColumns.map((_, feature) => (
        Math.sqrt(train.reduce(
          (sum, sample) => sum + (sample.x[feature] - xMeans[feature]) ** 2,
          0,
        ) / train.length) || 1
      ));
      const yMean = train.reduce((sum, sample) => sum + sample.y, 0) / train.length;
      const yStd = Math.sqrt(train.reduce(
        (sum, sample) => sum + (sample.y - yMean) ** 2,
        0,
      ) / train.length) || 1;
      const normalized = train.map((sample) => ({
        x: sample.x.map((value, feature) => (value - xMeans[feature]) / xStds[feature]),
        y: (sample.y - yMean) / yStd,
      }));
      let weights = sourceDataset.featureColumns.map(() => 0);
      let bias = 0;
      const history = [];
      const epochs = node.data.parameters.epochs;
      for (let epoch = 0; epoch < epochs; epoch += 1) {
        let loss = 0;
        const dw = weights.map(() => 0);
        let db = 0;
        normalized.forEach(({ x, y }) => {
          const error = weights.reduce(
            (sum, weight, feature) => sum + weight * x[feature],
            bias,
          ) - y;
          loss += error * error;
          dw.forEach((_, feature) => { dw[feature] += 2 * error * x[feature]; });
          db += 2 * error;
        });
        loss /= normalized.length;
        weights = weights.map(
          (weight, feature) => weight - spec.learningRate * (dw[feature] / normalized.length),
        );
        bias -= spec.learningRate * (db / normalized.length);
        history.push(loss);
        if (epoch % Math.max(1, Math.floor(epochs / 50)) === 0 || epoch === epochs - 1) {
          onLoss([...history]);
          await onYield();
        }
      }
      output = {
        type: 'linear_regression',
        sourceNodeId: node.id,
        modelNodeId: spec.modelNodeId,
        featureColumns: sourceDataset.featureColumns,
        targetColumn: sourceDataset.targetColumn,
        weights,
        bias,
        normalization: {
          xMeans,
          xStds,
          yMean,
          yStd,
        },
        test,
        trainRows: train.length,
        testRows: test.length,
        metrics: null,
        lossHistory: history,
        epochs,
        learningRate: spec.learningRate,
        trainedAt: new Date().toISOString(),
        hasPredictor: false,
      };
      finalModel = output;
    } else if (manifestId === 'knn_node') {
      const sourceDataset = inputValue(node, 'dataset');
      if (sourceDataset.task !== 'classification') {
        throw localizedError('error.classificationDatasetRequired');
      }
      const valid = profileBrowserDataset(sourceDataset).samples;
      if (valid.length < 3) throw localizedError('error.tooFewRows');
      if (new Set(valid.map((sample) => sample.y)).size < 2) {
        throw localizedError('error.classificationNeedsClasses');
      }
      const { train, test } = stratifiedSplit(valid, node.data.parameters.train_ratio);
      if (test.length === 0) throw localizedError('error.classificationTestRequired');
      if (new Set(train.map((sample) => sample.y)).size < 2) {
        throw localizedError('error.classificationNeedsClasses');
      }
      const normalization = featureNormalization(train, sourceDataset.featureColumns.length);
      const normalizedTrain = train.map((sample) => ({
        ...sample,
        x: normalizeFeatures(sample.x, normalization),
      }));
      output = {
        type: 'knn_classifier',
        sourceNodeId: node.id,
        featureColumns: sourceDataset.featureColumns,
        targetColumn: sourceDataset.targetColumn,
        train: normalizedTrain,
        test,
        normalization,
        k: Math.min(node.data.parameters.k_value, normalizedTrain.length),
        trainRows: train.length,
        testRows: test.length,
        metrics: null,
        lossHistory: [],
        trainedAt: new Date().toISOString(),
        hasPredictor: false,
      };
      finalModel = output;
    } else if (manifestId === 'evaluate_node') {
      const trained = inputValue(node, 'trained_model');
      if (trained.type === 'browser_mlp') {
        if (trained.task !== 'regression') throw localizedError('error.wrongEvaluator');
        const predictions = trained.test.map((sample) => ({ actual: sample.y, predicted: predictWithModel(trained, sample.x) }));
        const mse = predictions.reduce((sum, item) => sum + (item.predicted - item.actual) ** 2, 0) / predictions.length;
        const testMean = predictions.reduce((sum, item) => sum + item.actual, 0) / predictions.length;
        const total = predictions.reduce((sum, item) => sum + (item.actual - testMean) ** 2, 0);
        const residual = predictions.reduce((sum, item) => sum + (item.actual - item.predicted) ** 2, 0);
        trained.metrics = { rmse: Math.sqrt(mse), r2: total ? 1 - residual / total : 0, trainRows: trained.trainRows, testRows: trained.testRows };
        requireFiniteTrainingState(trained.metrics);
      } else if (trained.type !== 'linear_regression') {
        throw localizedError('error.wrongEvaluator');
      } else {
        const predictions = trained.test.map((sample) => ({ actual: sample.y, predicted: predictWithModel(trained, sample.x) }));
        const mse = predictions.reduce((sum, item) => sum + (item.predicted - item.actual) ** 2, 0) / predictions.length;
        const testMean = predictions.reduce((sum, item) => sum + item.actual, 0) / predictions.length;
        const total = predictions.reduce((sum, item) => sum + (item.actual - testMean) ** 2, 0);
        const residual = predictions.reduce((sum, item) => sum + (item.actual - item.predicted) ** 2, 0);
        trained.metrics = { rmse: Math.sqrt(mse), r2: total ? 1 - residual / total : 0, trainRows: trained.trainRows, testRows: trained.testRows };
        requireFiniteTrainingState(trained.metrics);
      }
      output = trained.metrics;
      finalModel = trained;
    } else if (manifestId === 'evaluate_classification_node') {
      const trained = inputValue(node, 'trained_model');
      if (trained.type === 'browser_mlp') {
        if (trained.task !== 'classification') throw localizedError('error.wrongEvaluator');
        const predictions = trained.test.map((sample) => ({ actual: sample.y, predicted: predictWithModel(trained, sample.x) }));
        const labels = trained.labels;
        const correct = predictions.filter((item) => item.actual === item.predicted).length;
        const macroF1 = labels.reduce((sum, label) => {
          const tp = predictions.filter((item) => item.actual === label && item.predicted === label).length;
          const fp = predictions.filter((item) => item.actual !== label && item.predicted === label).length;
          const fn = predictions.filter((item) => item.actual === label && item.predicted !== label).length;
          const precision = tp / Math.max(1, tp + fp);
          const recall = tp / Math.max(1, tp + fn);
          return sum + (precision + recall ? (2 * precision * recall) / (precision + recall) : 0);
        }, 0) / labels.length;
        trained.metrics = { accuracy: correct / predictions.length, macroF1, classes: labels.length, trainRows: trained.trainRows, testRows: trained.testRows };
        requireFiniteTrainingState(trained.metrics);
      } else if (trained.type !== 'knn_classifier') {
        throw localizedError('error.wrongEvaluator');
      } else trained.metrics = evaluateClassification(trained);
      output = trained.metrics;
      finalModel = trained;
    } else if (manifestId === 'predictor_node') {
      const trained = inputValue(node, 'trained_model');
      trained.hasPredictor = true;
      output = trained;
      finalModel = trained;
    } else {
      throw localizedError('error.backendMissing', { node: node.data.manifest.name });
    }
    outputs.set(node.id, output);
    onNodeStatus([node.data.runtimeOwnerId ?? node.id], 'success');
  }
  if (!finalModel) throw localizedError('error.noTrainedModel');
  return finalModel;
}

