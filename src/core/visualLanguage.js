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
  if (manifest.customComposite) return 'custom_composite';
  return manifest.op ?? 'unknown';
}

export function activationValue(op, x) {
  if (op === 'relu') return Math.max(0, x);
  if (op === 'sigmoid') return 1 / (1 + Math.exp(-x));
  if (op === 'tanh') return Math.tanh(x);
  if (op === 'gelu') {
    return 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)));
  }
  throw new Error(`Unsupported activation: ${op}`);
}

export function mseLandscapeValue(normalizedParameter) {
  return normalizedParameter ** 2;
}

const libraryOrder = ['data', 'model', 'training', 'output', 'custom'];

export function componentLibraryTree(plugins) {
  const groups = new Map();
  plugins.forEach((plugin) => {
    const groupId = plugin.customComposite ? 'custom' : stageForManifest(plugin);
    if (!groups.has(groupId)) groups.set(groupId, new Map());
    const categories = groups.get(groupId);
    if (!categories.has(plugin.category)) categories.set(plugin.category, []);
    categories.get(plugin.category).push(plugin);
  });
  return libraryOrder.filter((id) => groups.has(id)).map((id) => {
    const categories = [...groups.get(id)].map(([category, categoryPlugins]) => ({
      id: category,
      plugins: categoryPlugins,
    }));
    return {
      id,
      labelKey: id === 'custom' ? 'library.custom' : `stage.${id}`,
      count: categories.reduce((count, category) => count + category.plugins.length, 0),
      categories,
    };
  });
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
