import { flattenCustomComposites } from './customComposites.js';

const tierOrder = ['L0', 'L1', 'L2', 'L3'];

export const executionTiers = [
  {
    id: 'L0',
    nameKey: 'tier.L0.name',
    descriptionKey: 'tier.L0.description',
    available: true,
    target: 'browser-cpu',
  },
  {
    id: 'L1',
    nameKey: 'tier.L1.name',
    descriptionKey: 'tier.L1.description',
    available: false,
    target: 'browser-webgpu',
  },
  {
    id: 'L2',
    nameKey: 'tier.L2.name',
    descriptionKey: 'tier.L2.description',
    available: false,
    target: 'python-local',
  },
  {
    id: 'L3',
    nameKey: 'tier.L3.name',
    descriptionKey: 'tier.L3.description',
    available: false,
    target: 'remote-gpu',
  },
];

const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const shapeSize = (value) => String(value ?? '').split(',').map((part) => numeric(part.trim(), 1)).reduce((product, size) => product * Math.max(1, size), 1);

function componentParameters(op, p) {
  switch (op) {
    case 'dense': return numeric(p.input_features) * numeric(p.units) + (p.use_bias ? numeric(p.units) : 0);
    case 'conv2d': return numeric(p.kernel_size) ** 2 * numeric(p.input_channels) * numeric(p.filters) + (p.use_bias ? numeric(p.filters) : 0);
    case 'batch_norm1d': return numeric(p.features) * 2;
    case 'batch_norm2d': return numeric(p.channels) * 2;
    case 'layer_norm': return shapeSize(p.normalized_shape) * 2;
    case 'embedding': return numeric(p.vocab_size) * numeric(p.embedding_dim);
    case 'lstm': {
      const directions = p.bidirectional ? 2 : 1;
      return directions * 4 * (numeric(p.input_size) * numeric(p.hidden_size) + numeric(p.hidden_size) ** 2 + numeric(p.hidden_size)) * numeric(p.layers, 1);
    }
    case 'gru': {
      const directions = p.bidirectional ? 2 : 1;
      return directions * 3 * (numeric(p.input_size) * numeric(p.hidden_size) + numeric(p.hidden_size) ** 2 + numeric(p.hidden_size)) * numeric(p.layers, 1);
    }
    case 'multihead_attention': return 4 * numeric(p.embed_dim) ** 2;
    case 'mlp_block': return numeric(p.input_features) * numeric(p.hidden_units) + numeric(p.hidden_units);
    case 'conv_block': return numeric(p.kernel_size) ** 2 * numeric(p.input_channels) * numeric(p.filters) + numeric(p.filters) * 3;
    case 'residual_mlp_block': return 2 * (numeric(p.features) ** 2 + numeric(p.features));
    default: return 0;
  }
}

function componentOperations(op, p) {
  const parameters = componentParameters(op, p);
  if (op === 'conv2d' || op === 'conv_block') return parameters * 64 * 64 * 2;
  if (op === 'multihead_attention') return parameters * 128 * 2;
  if (op === 'lstm' || op === 'gru') return parameters * 128 * 2;
  return parameters * 2;
}

const maximumTier = (current, next) => (
  tierOrder.indexOf(next) > tierOrder.indexOf(current) ? next : current
);

function browserTopologyComplete(nodes, edges = null) {
  const ops = new Set(nodes.map((node) => node.data.manifest.op));
  if (ops.has('knn_classifier')) return ops.has('tabular_data');
  if (ops.has('gradient_descent')) return ops.has('tabular_data') && ops.has('train_test_split') && ops.has('linear_regression');
  if (!ops.has('supervised_trainer')) return false;
  if (!edges) return ['tabular_data', 'train_test_split', 'tensor_input', 'model_output', 'dense'].every((op) => ops.has(op))
    && (ops.has('mse_loss') || ops.has('cross_entropy_loss'))
    && (ops.has('sgd_optimizer') || ops.has('adam_optimizer'));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const trainers = nodes.filter((node) => node.data.manifest.op === 'supervised_trainer');
  if (trainers.length !== 1) return false;
  const trainer = trainers[0];
  const incomingEdge = (targetId, targetHandle) => edges.find((edge) => (
    edge.target === targetId && edge.targetHandle === targetHandle
  ));
  const modelEdge = incomingEdge(trainer.id, 'model');
  const lossEdge = incomingEdge(trainer.id, 'loss');
  const optimizerEdge = incomingEdge(trainer.id, 'optimizer');
  if (
    !modelEdge
    || !['mse_loss', 'cross_entropy_loss'].includes(nodeById.get(lossEdge?.source)?.data.manifest.op)
    || !['sgd_optimizer', 'adam_optimizer'].includes(nodeById.get(optimizerEdge?.source)?.data.manifest.op)
  ) return false;
  let current = nodeById.get(modelEdge.source);
  let denseCount = 0;
  const visited = new Set();
  const architecture = [];
  while (current && current.data.manifest.op !== 'tensor_input') {
    if (visited.has(current.id)) return false;
    visited.add(current.id);
    const op = current.data.manifest.op;
    if (!['model_output', 'dense', 'relu', 'sigmoid', 'tanh', 'softmax'].includes(op)) return false;
    if (op === 'dense') denseCount += 1;
    architecture.push(current);
    const previous = incomingEdge(current.id, 'input');
    if (!previous) return false;
    current = nodeById.get(previous.source);
  }
  if (!current || denseCount === 0) return false;
  const inputDimensions = String(current.data.parameters.shape ?? '').split(',').map((part) => Number(part.trim()));
  if (
    inputDimensions.length !== 1
    || !Number.isInteger(inputDimensions[0])
    || inputDimensions[0] <= 0
    || current.data.parameters.dtype === 'int32'
  ) return false;
  let width = inputDimensions[0];
  for (const node of architecture.reverse()) {
    if (node.data.manifest.op !== 'dense') continue;
    const inputFeatures = Number(node.data.parameters.input_features);
    const units = Number(node.data.parameters.units);
    if (!Number.isInteger(inputFeatures) || inputFeatures !== width || !Number.isInteger(units) || units <= 0) return false;
    width = units;
  }
  const requiredInputs = new Map([
    ['dataset', 'train_test_split'], ['model', 'model_output'],
    ['loss', null], ['optimizer', null],
  ]);
  return [...requiredInputs.entries()].every(([handle, requiredOp]) => edges.some((edge) => (
    edge.target === trainer.id
    && edge.targetHandle === handle
    && (!requiredOp || nodeById.get(edge.source)?.data.manifest.op === requiredOp)
  )));
}

export function estimateExecutionPlan(nodes, dataset, capabilities = {}) {
  const flattened = flattenCustomComposites(nodes, capabilities.edges ?? []);
  const planNodes = flattened.nodes;
  const planEdges = capabilities.edges ? flattened.edges : null;
  let parameters = 0;
  let operationsPerStep = 0;
  let minimumTier = 'L0';
  let browserBackendComplete = true;
  let usesAdam = false;

  planNodes.forEach((node) => {
    const manifest = node.data.manifest;
    parameters += componentParameters(manifest.op, node.data.parameters ?? {});
    operationsPerStep += componentOperations(manifest.op, node.data.parameters ?? {});
    minimumTier = maximumTier(minimumTier, manifest.runtime?.minimumTier ?? 'L1');
    if (manifest.runtime?.browserBackend === 'none') browserBackendComplete = false;
    if (['adam_optimizer', 'adamw_optimizer'].includes(manifest.op)) usesAdam = true;
  });

  const isTraining = planNodes.some((node) => ['training', 'optimizer', 'loss'].includes(node.data.manifest.kind));
  const bytesPerParameter = isTraining ? (usesAdam ? 24 : 16) : 4;
  const activationBytes = Math.max(8 * 1024 * 1024, operationsPerStep * 0.08);
  const datasetCells = dataset ? dataset.rows.length * Math.max(1, dataset.columns.length) : 0;
  const datasetBytes = datasetCells * 32;
  const trainer = planNodes.find((node) => node.data.manifest.op === 'supervised_trainer');
  const nodeById = new Map(planNodes.map((node) => [node.id, node]));
  const connectedSplitId = trainer && planEdges?.find((edge) => edge.target === trainer.id && edge.targetHandle === 'dataset')?.source;
  const split = nodeById.get(connectedSplitId) ?? planNodes.find((node) => node.data.manifest.op === 'train_test_split');
  const trainRatio = Number(split?.data.parameters.train_ratio ?? 0.8);
  const trainingExamples = dataset ? Math.max(1, Math.floor(dataset.rows.length * trainRatio)) : 1;
  const trainingSteps = trainer ? Math.max(1, Number(trainer.data.parameters.epochs)) * Math.ceil(trainingExamples / Math.max(1, Number(trainer.data.parameters.batch_size))) : 1;
  const trainingOperations = operationsPerStep * trainingExamples * (trainer ? Math.max(1, Number(trainer.data.parameters.epochs)) : 1);
  const peakBytes = (parameters * bytesPerParameter + activationBytes + datasetBytes) * 1.35;
  const peakMemoryMB = peakBytes / (1024 ** 2);
  const cpuSeconds = Math.max(0.05, trainingOperations / 25_000_000);
  const webgpuSeconds = Math.max(0.02, trainingOperations / 500_000_000);

  let recommendedTier = minimumTier;
  if (parameters > 50_000_000 || peakMemoryMB > 1024 || operationsPerStep > 20_000_000_000) recommendedTier = 'L3';
  else if (parameters > 5_000_000 || peakMemoryMB > 384 || operationsPerStep > 2_000_000_000) recommendedTier = maximumTier(recommendedTier, 'L2');
  else if (parameters > 100_000 || peakMemoryMB > 128 || operationsPerStep > 10_000_000) recommendedTier = maximumTier(recommendedTier, 'L1');

  if (trainingOperations > 20_000_000_000 || cpuSeconds > 800) recommendedTier = 'L3';
  else if (trainingOperations > 3_000_000_000 || cpuSeconds > 120) recommendedTier = maximumTier(recommendedTier, 'L2');
  else if (trainingOperations > 250_000_000 || cpuSeconds > 10) recommendedTier = maximumTier(recommendedTier, 'L1');

  if (datasetBytes > 100 * 1024 * 1024) recommendedTier = maximumTier(recommendedTier, 'L2');
  const topologyComplete = browserTopologyComplete(planNodes, planEdges);
  const canRunHere = recommendedTier === 'L0' && browserBackendComplete && topologyComplete;
  const webgpuDetected = Boolean(capabilities.webgpu);
  const reasons = [];
  if (parameters > 100_000) reasons.push('tier.reason.parameters');
  if (peakMemoryMB > 128) reasons.push('tier.reason.memory');
  if (operationsPerStep > 10_000_000) reasons.push('tier.reason.compute');
  if (trainingOperations > 250_000_000) reasons.push('tier.reason.trainingCompute');
  if (!browserBackendComplete) reasons.push('tier.reason.backend');
  if (!topologyComplete) reasons.push('tier.reason.incompleteGraph');
  if (recommendedTier === 'L1' && !webgpuDetected) reasons.push('tier.reason.noWebgpu');
  if (datasetBytes > 30 * 1024 * 1024) reasons.push('tier.reason.dataset');

  return {
    recommendedTier,
    parameters: Math.round(parameters),
    peakMemoryMB: Number(peakMemoryMB.toFixed(1)),
    operationsPerStep: Math.round(operationsPerStep),
    trainingSteps,
    trainingOperations: Math.round(trainingOperations),
    estimatedSeconds: Number((recommendedTier === 'L0' ? cpuSeconds : webgpuSeconds).toFixed(2)),
    canRunHere,
    browserBackendComplete,
    webgpuDetected,
    reasons,
  };
}
