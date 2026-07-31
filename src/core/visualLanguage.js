const activationOps = new Set(['relu', 'gelu', 'sigmoid', 'tanh', 'softmax']);
const dataOps = new Set(['tabular_data', 'train_test_split']);
const outputKinds = new Set(['sink', 'evaluation', 'inference']);
const trainingKinds = new Set(['training', 'loss', 'optimizer']);

export function stageForManifest(manifest) {
  if (manifest.visualStage) return manifest.visualStage;
  if (dataOps.has(manifest.op) || manifest.kind === 'data') return 'data';
  if (trainingKinds.has(manifest.kind)) return 'training';
  if (outputKinds.has(manifest.kind)) return 'output';
  return 'model';
}

export const stageStyles = {
  data: {
    border: 'border-emerald-400',
    soft: 'bg-emerald-50',
    text: 'text-emerald-700',
    hex: '#10b981',
  },
  model: {
    border: 'border-blue-400',
    soft: 'bg-blue-50',
    text: 'text-blue-700',
    hex: '#3b82f6',
  },
  training: {
    border: 'border-orange-400',
    soft: 'bg-orange-50',
    text: 'text-orange-700',
    hex: '#f97316',
  },
  output: {
    border: 'border-violet-400',
    soft: 'bg-violet-50',
    text: 'text-violet-700',
    hex: '#8b5cf6',
  },
};

export function visualKindForManifest(manifest) {
  if (manifest.visualization?.type) return manifest.visualization.type;
  if (activationOps.has(manifest.op)) return manifest.op === 'gelu' ? 'smooth-curve' : manifest.op;
  if (manifest.op === 'dense') return 'dense';
  if (manifest.op === 'linear_regression') return 'scatter';
  if (manifest.op === 'knn_classifier') return 'neighbors';
  if (manifest.op === 'gradient_descent' || trainingKinds.has(manifest.kind)) return 'descent';
  if (manifest.op === 'tabular_data') return 'table';
  if (manifest.op === 'train_test_split') return 'split';
  if (manifest.op === 'multihead_attention' || manifest.op === 'transformer') return 'attention';
  if (['lstm', 'gru'].includes(manifest.op)) return 'sequence';
  if (manifest.op === 'conv2d') return 'convolution';
  if (manifest.op === 'max_pool2d') return 'pool';
  if (manifest.kind === 'composite') return 'composite';
  if (manifest.kind === 'merge') return 'merge';
  if (manifest.kind === 'sink') return 'output';
  if (manifest.kind === 'source') return 'tensor';
  return 'flow';
}

export function architectureLayout(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  edges.forEach((edge) => {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return;
    indegree.set(edge.target, indegree.get(edge.target) + 1);
    outgoing.get(edge.source).push(edge.target);
  });
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const layer = new Map(queue.map((id) => [id, 0]));
  const visited = new Set();
  while (queue.length) {
    const id = queue.shift();
    visited.add(id);
    outgoing.get(id).forEach((target) => {
      layer.set(target, Math.max(layer.get(target) ?? 0, (layer.get(id) ?? 0) + 1));
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    });
  }
  nodes.filter((node) => !visited.has(node.id)).forEach((node) => {
    layer.set(node.id, Math.max(0, ...layer.values()) + 1);
  });
  const layers = [];
  nodes.forEach((node) => {
    const index = layer.get(node.id) ?? 0;
    if (!layers[index]) layers[index] = [];
    layers[index].push(node);
  });
  return layers.filter(Boolean);
}
