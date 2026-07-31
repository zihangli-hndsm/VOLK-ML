import { defaults, expandComposite } from './components.js';

const portFor = (manifest, direction, name) => (
  (direction === 'output' ? manifest.outputs : manifest.inputs).find((port) => port.name === name)
);

const uniquePortName = (used, base) => {
  let name = base.replace(/[^a-zA-Z0-9_]/g, '_');
  let suffix = 2;
  while (used.has(name)) {
    name = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(name);
  return name;
};

export function createCustomComposite({
  selectedNodes,
  edges,
  name,
  color,
}) {
  if (selectedNodes.length < 2) throw new Error('error.compositeSelection');
  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const internalEdges = edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target));
  if (!internalEdges.length) throw new Error('error.compositeSelection');
  const neighbors = new Map(selectedNodes.map((node) => [node.id, []]));
  internalEdges.forEach((edge) => {
    neighbors.get(edge.source).push(edge.target);
    neighbors.get(edge.target).push(edge.source);
  });
  const visited = new Set();
  const pending = [selectedNodes[0].id];
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    neighbors.get(id).forEach((neighbor) => pending.push(neighbor));
  }
  if (visited.size !== selectedNodes.length) throw new Error('error.compositeSelection');
  const incomingEdges = edges.filter((edge) => !selectedIds.has(edge.source) && selectedIds.has(edge.target));
  const outgoingEdges = edges.filter((edge) => selectedIds.has(edge.source) && !selectedIds.has(edge.target));
  const nodeById = new Map(selectedNodes.map((node) => [node.id, node]));
  const keyById = new Map(selectedNodes.map((node, index) => [node.id, `node_${index + 1}`]));
  const internallySatisfiedInputs = new Set(
    internalEdges.map((edge) => `${edge.target}:${edge.targetHandle}`),
  );
  const internallyConsumedOutputs = new Set(
    internalEdges.map((edge) => `${edge.source}:${edge.sourceHandle}`),
  );
  const usedInputs = new Set();
  const usedOutputs = new Set();
  const inputs = [];
  const outputs = [];
  const inputMappings = {};
  const outputMappings = {};
  const incomingPortByEdge = new Map();
  const outgoingPortByEdge = new Map();
  const inputPortByEndpoint = new Map();
  const outputPortByEndpoint = new Map();

  const exposeInput = (node, portName) => {
    const endpoint = `${node.id}:${portName}`;
    const existing = inputPortByEndpoint.get(endpoint);
    if (existing) return existing;
    const port = portFor(node.data.manifest, 'input', portName);
    const namePart = uniquePortName(usedInputs, `${keyById.get(node.id)}_${portName}`);
    inputs.push({ name: namePart, type: port?.type ?? 'Tensor' });
    inputMappings[namePart] = [{ node: keyById.get(node.id), port: portName }];
    inputPortByEndpoint.set(endpoint, namePart);
    return namePart;
  };
  const exposeOutput = (node, portName) => {
    const endpoint = `${node.id}:${portName}`;
    const existing = outputPortByEndpoint.get(endpoint);
    if (existing) return existing;
    const port = portFor(node.data.manifest, 'output', portName);
    const namePart = uniquePortName(usedOutputs, `${keyById.get(node.id)}_${portName}`);
    outputs.push({ name: namePart, type: port?.type ?? 'Tensor' });
    outputMappings[namePart] = { node: keyById.get(node.id), port: portName };
    outputPortByEndpoint.set(endpoint, namePart);
    return namePart;
  };

  selectedNodes.forEach((node) => {
    node.data.manifest.inputs.forEach((port) => {
      if (!internallySatisfiedInputs.has(`${node.id}:${port.name}`)) exposeInput(node, port.name);
    });
    node.data.manifest.outputs.forEach((port) => {
      if (!internallyConsumedOutputs.has(`${node.id}:${port.name}`)) exposeOutput(node, port.name);
    });
  });
  incomingEdges.forEach((edge) => {
    incomingPortByEdge.set(edge.id, exposeInput(nodeById.get(edge.target), edge.targetHandle));
  });
  outgoingEdges.forEach((edge) => {
    outgoingPortByEdge.set(edge.id, exposeOutput(nodeById.get(edge.source), edge.sourceHandle));
  });
  const minX = Math.min(...selectedNodes.map((node) => node.position.x));
  const minY = Math.min(...selectedNodes.map((node) => node.position.y));
  const tierOrder = ['L0', 'L1', 'L2', 'L3'];
  const qualityOrder = ['exact', 'adapted', 'approximate', 'unsupported'];
  const minimumTier = selectedNodes.reduce((highest, node) => (
    tierOrder.indexOf(node.data.manifest.runtime.minimumTier) > tierOrder.indexOf(highest)
      ? node.data.manifest.runtime.minimumTier
      : highest
  ), 'L0');
  const frameworkQuality = (framework) => selectedNodes.reduce((lowest, node) => {
    const quality = node.data.manifest.compatibility?.[framework] ?? 'unsupported';
    return qualityOrder.indexOf(quality) > qualityOrder.indexOf(lowest) ? quality : lowest;
  }, 'exact');
  const manifest = {
    schemaVersion: 2,
    id: `custom_${crypto.randomUUID()}`,
    op: `custom_composite_${Date.now()}`,
    kind: 'composite',
    customComposite: true,
    name: { en: name, zh: name },
    description: {
      en: 'A reusable composite created from selected components.',
      zh: '由所选组件创建的可复用复合组件。',
    },
    category: 'Composite',
    inputs,
    outputs,
    properties: [],
    runtime: {
      minimumTier,
      browserBackend: selectedNodes.every((node) => node.data.manifest.runtime.browserBackend === 'cpu')
        ? 'cpu'
        : 'none',
    },
    compatibility: {
      pytorch: frameworkQuality('pytorch'),
      tensorflow: frameworkQuality('tensorflow'),
    },
    color,
    composition: {
      nodes: selectedNodes.map((node) => ({
        key: keyById.get(node.id),
        componentId: node.data.manifest.id,
        manifest: node.data.manifest.customComposite ? node.data.manifest : undefined,
        parameters: { ...defaults(node.data.manifest), ...node.data.parameters },
        position: { x: node.position.x - minX, y: node.position.y - minY },
      })),
      edges: internalEdges.map((edge) => ({
        source: keyById.get(edge.source),
        sourceHandle: edge.sourceHandle,
        target: keyById.get(edge.target),
        targetHandle: edge.targetHandle,
      })),
      inputs: inputMappings,
      outputs: outputMappings,
    },
  };
  const id = `${manifest.id}-${crypto.randomUUID()}`;
  const instance = {
    id,
    type: 'pipelineNode',
    position: { x: minX, y: minY },
    data: { label: manifest.name, manifest, parameters: {}, status: 'idle' },
  };
  const nextEdges = [
    ...edges.filter((edge) => !selectedIds.has(edge.source) && !selectedIds.has(edge.target)),
    ...incomingEdges.map((edge) => ({
      ...edge,
      target: id,
      targetHandle: incomingPortByEdge.get(edge.id),
    })),
    ...outgoingEdges.map((edge) => ({
      ...edge,
      source: id,
      sourceHandle: outgoingPortByEdge.get(edge.id),
    })),
  ];
  return { manifest, instance, nextEdges };
}

export function flattenCustomComposites(nodes, edges) {
  let expandedNodes = nodes;
  let expandedEdges = edges;
  let remaining = expandedNodes.find((node) => node.data.manifest.customComposite);
  let expansionCount = 0;
  while (remaining) {
    expansionCount += 1;
    if (expansionCount > 100) {
      const error = new Error('error.compositeNesting');
      error.translationKey = 'error.compositeNesting';
      throw error;
    }
    const expansion = expandComposite(remaining);
    const runtimeOwnerId = remaining.data.runtimeOwnerId ?? remaining.id;
    const unrelated = expandedEdges.filter((edge) => edge.source !== remaining.id && edge.target !== remaining.id);
    const redirected = [];
    expandedEdges.filter((edge) => edge.target === remaining.id).forEach((edge) => {
      (expansion.inputs[edge.targetHandle] ?? []).forEach((target) => redirected.push({
        ...edge,
        id: `flatten-input-${crypto.randomUUID()}`,
        target: target.nodeId,
        targetHandle: target.port,
      }));
    });
    expandedEdges.filter((edge) => edge.source === remaining.id).forEach((edge) => {
      const source = expansion.outputs[edge.sourceHandle];
      if (source) redirected.push({
        ...edge,
        id: `flatten-output-${crypto.randomUUID()}`,
        source: source.nodeId,
        sourceHandle: source.port,
      });
    });
    expandedNodes = [
      ...expandedNodes.filter((node) => node.id !== remaining.id),
      ...expansion.nodes.map((node) => ({
        ...node,
        data: { ...node.data, runtimeOwnerId },
      })),
    ];
    expandedEdges = [...unrelated, ...expansion.edges, ...redirected];
    remaining = expandedNodes.find((node) => node.data.manifest.customComposite);
  }
  return { nodes: expandedNodes, edges: expandedEdges };
}
