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

export function estimateExecutionPlan(nodes, dataset, capabilities = {}) {
  let parameters = 0;
  let operationsPerStep = 0;
  let minimumTier = 'L0';
  let browserBackendComplete = true;
  let usesAdam = false;

  nodes.forEach((node) => {
    const manifest = node.data.manifest;
    parameters += componentParameters(manifest.op, node.data.parameters ?? {});
    operationsPerStep += componentOperations(manifest.op, node.data.parameters ?? {});
    minimumTier = maximumTier(minimumTier, manifest.runtime?.minimumTier ?? 'L1');
    if (manifest.runtime?.browserBackend === 'none') browserBackendComplete = false;
    if (['adam_optimizer', 'adamw_optimizer'].includes(manifest.op)) usesAdam = true;
  });

  const isTraining = nodes.some((node) => ['training', 'optimizer', 'loss'].includes(node.data.manifest.kind));
  const bytesPerParameter = isTraining ? (usesAdam ? 24 : 16) : 4;
  const activationBytes = Math.max(8 * 1024 * 1024, operationsPerStep * 0.08);
  const datasetCells = dataset ? dataset.rows.length * Math.max(1, dataset.columns.length) : 0;
  const datasetBytes = datasetCells * 32;
  const peakBytes = (parameters * bytesPerParameter + activationBytes + datasetBytes) * 1.35;
  const peakMemoryMB = peakBytes / (1024 ** 2);
  const cpuSeconds = Math.max(0.05, operationsPerStep / 25_000_000);
  const webgpuSeconds = Math.max(0.02, operationsPerStep / 500_000_000);

  let recommendedTier = minimumTier;
  if (parameters > 50_000_000 || peakMemoryMB > 1024 || operationsPerStep > 20_000_000_000) recommendedTier = 'L3';
  else if (parameters > 5_000_000 || peakMemoryMB > 384 || operationsPerStep > 2_000_000_000) recommendedTier = maximumTier(recommendedTier, 'L2');
  else if (parameters > 100_000 || peakMemoryMB > 128 || operationsPerStep > 10_000_000) recommendedTier = maximumTier(recommendedTier, 'L1');

  if (datasetBytes > 100 * 1024 * 1024) recommendedTier = maximumTier(recommendedTier, 'L2');
  const canRunHere = recommendedTier === 'L0' && browserBackendComplete;
  const webgpuDetected = Boolean(capabilities.webgpu);
  const reasons = [];
  if (parameters > 100_000) reasons.push('tier.reason.parameters');
  if (peakMemoryMB > 128) reasons.push('tier.reason.memory');
  if (operationsPerStep > 10_000_000) reasons.push('tier.reason.compute');
  if (!browserBackendComplete) reasons.push('tier.reason.backend');
  if (recommendedTier === 'L1' && !webgpuDetected) reasons.push('tier.reason.noWebgpu');
  if (datasetBytes > 30 * 1024 * 1024) reasons.push('tier.reason.dataset');

  return {
    recommendedTier,
    parameters: Math.round(parameters),
    peakMemoryMB: Number(peakMemoryMB.toFixed(1)),
    operationsPerStep: Math.round(operationsPerStep),
    estimatedSeconds: Number((recommendedTier === 'L0' ? cpuSeconds : webgpuSeconds).toFixed(2)),
    canRunHere,
    browserBackendComplete,
    webgpuDetected,
    reasons,
  };
}
