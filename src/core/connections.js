function resolvePort(manifest, direction, handleId) {
  const ports = direction === 'output' ? manifest.outputs : manifest.inputs;
  return ports.find((port) => port.name === handleId) ?? (ports.length === 1 ? ports[0] : null);
}

function createsCycle(sourceId, targetId, edges) {
  const outgoing = new Map();
  edges.forEach((edge) => {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge.target);
  });
  const pending = [targetId];
  const visited = new Set();
  while (pending.length) {
    const nodeId = pending.pop();
    if (nodeId === sourceId) return true;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    (outgoing.get(nodeId) ?? []).forEach((next) => pending.push(next));
  }
  return false;
}

export function assessConnection(connection, nodes, edges) {
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  if (!source || !target) return { valid: false, reason: 'missingNode' };
  if (source.id === target.id) return { valid: false, reason: 'self' };
  const sourcePort = resolvePort(source.data.manifest, 'output', connection.sourceHandle);
  const targetPort = resolvePort(target.data.manifest, 'input', connection.targetHandle);
  if (!sourcePort || !targetPort) return { valid: false, reason: 'missingPort' };
  if (sourcePort.type !== targetPort.type) {
    return {
      valid: false,
      reason: 'type',
      sourceType: sourcePort.type,
      targetType: targetPort.type,
    };
  }
  if (edges.some((edge) => (
    edge.target === target.id
    && (
      edge.targetHandle === targetPort.name
      || (!edge.targetHandle && target.data.manifest.inputs.length === 1)
    )
  ))) {
    return { valid: false, reason: 'occupied', sourceType: sourcePort.type, targetType: targetPort.type };
  }
  if (createsCycle(source.id, target.id, edges)) {
    return { valid: false, reason: 'cycle', sourceType: sourcePort.type, targetType: targetPort.type };
  }
  return { valid: true, reason: null, sourceType: sourcePort.type, targetType: targetPort.type };
}

export const knownPortTypes = [
  'Tensor',
  'Table',
  'DatasetSplit',
  'ModelSpec',
  'TrainedModel',
  'LossSpec',
  'OptimizerSpec',
  'Metrics',
  'Prediction',
];
