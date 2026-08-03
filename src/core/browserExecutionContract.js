import { flattenCustomComposites } from './customComposites.js';

const activationOps = new Set(['relu', 'sigmoid', 'tanh', 'softmax']);
const rootOps = new Set(['supervised_trainer', 'knn_classifier', 'gradient_descent']);

const validRows = (dataset, classification) => (dataset?.rows ?? []).map((row) => {
  const values = (dataset.featureColumns ?? []).map((column) => Number(row[column]));
  const target = row?.[dataset.targetColumn];
  if (!values.every(Number.isFinite) || target === null || target === undefined || target === '') return null;
  return { x: values, y: classification ? String(target) : Number(target) };
}).filter((sample) => sample && (classification || Number.isFinite(sample.y)));

const classificationSplitHasTest = (rows) => (
  [...new Map(rows.map((row) => [row.y, 0])).keys()].some((label) => rows.filter((row) => row.y === label).length > 1)
);

function port(manifest, direction, handle) {
  return (direction === 'input' ? manifest.inputs : manifest.outputs).find((item) => item.name === handle);
}

function failure(reason, flattened) {
  return { valid: false, reason, flattened };
}

export function analyzeBrowserExecutionGraph({ nodes, edges, dataset, alreadyFlattened = false }) {
  let flattened;
  try {
    flattened = alreadyFlattened ? { nodes, edges } : flattenCustomComposites(nodes, edges);
  } catch {
    return failure('error.compositeNesting', { nodes, edges });
  }
  const graphNodes = flattened.nodes;
  const graphEdges = flattened.edges;
  if (!graphEdges.length) return failure('error.connectBeforeRun', flattened);
  const nodeById = new Map(graphNodes.map((node) => [node.id, node]));
  const activeIds = new Set(graphEdges.flatMap((edge) => [edge.source, edge.target]));
  const activeNodes = graphNodes.filter((node) => activeIds.has(node.id));
  const incoming = (node, handle) => graphEdges.filter((edge) => edge.target === node.id && edge.targetHandle === handle);
  const outgoing = (node) => graphEdges.filter((edge) => edge.source === node.id);

  for (const edge of graphEdges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target || !port(source.data.manifest, 'output', edge.sourceHandle) || !port(target.data.manifest, 'input', edge.targetHandle)) {
      return failure('error.invalidConnection', flattened);
    }
  }
  for (const node of activeNodes) {
    for (const input of node.data.manifest.inputs) {
      if (incoming(node, input.name).length !== 1) return failure('error.missingInput', flattened);
    }
  }
  if (!dataset) return failure('error.datasetMissing', flattened);
  const roots = activeNodes.filter((node) => rootOps.has(node.data.manifest.op));
  if (roots.length === 0) return failure('error.noTrainedModel', flattened);
  if (roots.length > 1) return failure('error.multipleTrainingRoots', flattened);
  const root = roots[0];
  const allowed = new Set([root.id]);
  const requireSource = (node, handle, op) => {
    const edge = incoming(node, handle)[0];
    const source = nodeById.get(edge?.source);
    if (!source || source.data.manifest.op !== op) return null;
    allowed.add(source.id);
    return source;
  };
  const requireData = (split) => {
    const data = split && requireSource(split, 'dataset', 'tabular_data');
    return data ? split : null;
  };
  const classification = dataset.task === 'classification';
  const rows = validRows(dataset, classification);
  if (rows.length < 3) return failure('error.tooFewRows', flattened);

  if (root.data.manifest.op === 'knn_classifier') {
    if (!classification) return failure('error.classificationDatasetRequired', flattened);
    if (new Set(rows.map((row) => row.y)).size < 2) return failure('error.classificationNeedsClasses', flattened);
    if (!classificationSplitHasTest(rows)) return failure('error.classificationTestRequired', flattened);
    if (!requireSource(root, 'dataset', 'tabular_data')) return failure('error.invalidConnection', flattened);
  } else if (root.data.manifest.op === 'gradient_descent') {
    if (classification) return failure('error.regressionDatasetRequired', flattened);
    const linear = requireSource(root, 'model', 'linear_regression');
    if (!linear || !requireData(requireSource(linear, 'split', 'train_test_split'))) return failure('error.invalidConnection', flattened);
  } else {
    const split = requireSource(root, 'dataset', 'train_test_split');
    const output = requireSource(root, 'model', 'model_output');
    const loss = incoming(root, 'loss')[0] && nodeById.get(incoming(root, 'loss')[0].source);
    const optimizer = incoming(root, 'optimizer')[0] && nodeById.get(incoming(root, 'optimizer')[0].source);
    if (!split || !output || !loss || !optimizer || !requireData(split)) return failure('error.invalidConnection', flattened);
    allowed.add(loss.id);
    allowed.add(optimizer.id);
    if (!['mse_loss', 'cross_entropy_loss'].includes(loss.data.manifest.op) || !['sgd_optimizer', 'adam_optimizer'].includes(optimizer.data.manifest.op)) {
      return failure('error.backendMissing', flattened);
    }
    const architecture = [];
    const seen = new Set();
    let current = output;
    while (current.data.manifest.op !== 'tensor_input') {
      if (seen.has(current.id)) return failure('error.pipelineCycle', flattened);
      seen.add(current.id);
      const op = current.data.manifest.op;
      if (!['model_output', 'dense', ...activationOps].includes(op)) return failure('error.browserMlpArchitecture', flattened);
      architecture.push(current);
      allowed.add(current.id);
      const edge = incoming(current, 'input')[0];
      current = nodeById.get(edge?.source);
      if (!current) return failure('error.browserMlpArchitecture', flattened);
    }
    allowed.add(current.id);
    const dimensions = String(current.data.parameters.shape ?? '').split(',').map((part) => Number(part.trim()));
    if (dimensions.length !== 1 || !Number.isInteger(dimensions[0]) || dimensions[0] <= 0 || current.data.parameters.dtype === 'int32') {
      return failure('error.browserMlpShape', flattened);
    }
    let width = dimensions[0];
    const layers = architecture.reverse().filter((node) => node.data.manifest.op !== 'model_output');
    const dense = layers.filter((node) => node.data.manifest.op === 'dense');
    if (!dense.length) return failure('error.browserMlpArchitecture', flattened);
    for (const node of layers) {
      if (node.data.manifest.op !== 'dense') continue;
      const inputFeatures = Number(node.data.parameters.input_features);
      const units = Number(node.data.parameters.units);
      if (!Number.isInteger(inputFeatures) || inputFeatures !== width || !Number.isInteger(units) || units <= 0) return failure('error.browserMlpShape', flattened);
      width = units;
    }
    const finalOp = layers.at(-1)?.data.manifest.op;
    if (classification) {
      if (new Set(rows.map((row) => row.y)).size < 2 || !classificationSplitHasTest(rows) || loss.data.manifest.op !== 'cross_entropy_loss' || finalOp !== 'softmax' || width !== new Set(rows.map((row) => row.y)).size) {
        return failure('error.browserMlpClassification', flattened);
      }
    } else if (loss.data.manifest.op !== 'mse_loss' || width !== 1 || finalOp === 'softmax') {
      return failure('error.browserMlpRegression', flattened);
    }
  }

  for (const edge of outgoing(root)) {
    const consumer = nodeById.get(edge.target);
    if (!consumer) return failure('error.invalidConnection', flattened);
    const op = consumer.data.manifest.op;
    const allowedConsumer = op === 'interactive_predictor'
      || (classification && op === 'evaluate_classification')
      || (!classification && op === 'evaluate_regression');
    if (!allowedConsumer) return failure('error.wrongEvaluator', flattened);
    allowed.add(consumer.id);
  }
  if (activeNodes.some((node) => !allowed.has(node.id))) return failure('error.invalidConnection', flattened);
  return { valid: true, reason: null, root, task: dataset.task, flattened };
}
