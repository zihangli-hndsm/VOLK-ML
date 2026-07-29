import { localizedError } from '../i18n.js';

function resolvePort(manifest, direction, handleId) {
  const ports = direction === 'output' ? manifest.outputs : manifest.inputs;
  return ports.find((port) => port.name === handleId) ?? (ports.length === 1 ? ports[0] : null);
}

const isMissing = (value) => (
  value === null
  || value === undefined
  || (typeof value === 'string' && value.trim() === '')
);

function deterministicShuffle(samples) {
  const shuffled = [...samples];
  let seed = 2026;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    const target = seed % (index + 1);
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
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

function numericSamples(dataset) {
  return dataset.rows.map((row, index) => {
    const rawFeatures = dataset.featureColumns.map((column) => row[column]);
    const rawTarget = row[dataset.targetColumn];
    if (rawFeatures.some(isMissing) || isMissing(rawTarget)) return null;
    return { index, x: rawFeatures.map(Number), y: Number(rawTarget) };
  }).filter((sample) => sample && sample.x.every(Number.isFinite) && Number.isFinite(sample.y));
}

function classificationSamples(dataset) {
  return dataset.rows.map((row, index) => {
    const rawFeatures = dataset.featureColumns.map((column) => row[column]);
    const rawTarget = row[dataset.targetColumn];
    if (rawFeatures.some(isMissing) || isMissing(rawTarget)) return null;
    return { index, x: rawFeatures.map(Number), y: String(rawTarget) };
  }).filter((sample) => sample && sample.x.every(Number.isFinite));
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
  const plan = compileExecutionGraph(nodes, edges);
  if (!dataset) throw localizedError('error.datasetMissing');
  const outputs = new Map();
  let finalModel = null;
  const inputValue = (node, inputName) => {
    const connection = plan.incoming.get(node.id).find((item) => item.input.name === inputName);
    return connection ? outputs.get(connection.source.id) : undefined;
  };

  for (const node of plan.order) {
    onNodeStatus([node.id], 'running');
    const manifestId = node.data.manifest.id;
    let output;
    if (manifestId === 'tabular_data_node') {
      output = dataset;
    } else if (manifestId === 'train_test_split_node') {
      const sourceDataset = inputValue(node, 'dataset');
      if (sourceDataset.task !== 'regression') {
        throw localizedError('error.regressionDatasetRequired');
      }
      const valid = numericSamples(sourceDataset);
      if (valid.length < 3) throw localizedError('error.tooFewRows');
      const { train, test } = splitSamples(valid, node.data.parameters.train_ratio);
      output = {
        dataset: sourceDataset,
        train,
        test,
        trainRatio: node.data.parameters.train_ratio,
      };
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
      const valid = classificationSamples(sourceDataset);
      if (valid.length < 3) throw localizedError('error.tooFewRows');
      if (new Set(valid.map((sample) => sample.y)).size < 2) {
        throw localizedError('error.classificationNeedsClasses');
      }
      const { train, test } = stratifiedSplit(valid, node.data.parameters.train_ratio);
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
      if (trained.type !== 'linear_regression') {
        throw localizedError('error.wrongEvaluator');
      }
      const predictions = trained.test.map((sample) => ({
        actual: sample.y,
        predicted: predictWithModel(trained, sample.x),
      }));
      const mse = predictions.reduce(
        (sum, item) => sum + (item.predicted - item.actual) ** 2,
        0,
      ) / predictions.length;
      const testMean = predictions.reduce((sum, item) => sum + item.actual, 0)
        / predictions.length;
      const total = predictions.reduce(
        (sum, item) => sum + (item.actual - testMean) ** 2,
        0,
      );
      const residual = predictions.reduce(
        (sum, item) => sum + (item.actual - item.predicted) ** 2,
        0,
      );
      trained.metrics = {
        rmse: Math.sqrt(mse),
        r2: total ? 1 - residual / total : 0,
        trainRows: trained.trainRows,
        testRows: trained.testRows,
      };
      output = trained.metrics;
      finalModel = trained;
    } else if (manifestId === 'evaluate_classification_node') {
      const trained = inputValue(node, 'trained_model');
      if (trained.type !== 'knn_classifier') {
        throw localizedError('error.wrongEvaluator');
      }
      trained.metrics = evaluateClassification(trained);
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
    onNodeStatus([node.id], 'success');
  }
  if (!finalModel) throw localizedError('error.noTrainedModel');
  return finalModel;
}
