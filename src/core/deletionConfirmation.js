export function createDeletionRequest({ nodes = [], edges = [], nodeIds = [], edgeIds = [] } = {}) {
  const nodeSet = new Set(nodeIds.filter((id) => nodes.some((node) => node.id === id)));
  const connectedEdgeIds = edges
    .filter((edge) => nodeSet.has(edge.source) || nodeSet.has(edge.target))
    .map((edge) => edge.id);
  const edgeSet = new Set([...edgeIds, ...connectedEdgeIds].filter((id) => edges.some((edge) => edge.id === id)));
  return { nodeIds: [...nodeSet], edgeIds: [...edgeSet] };
}

export function deletionSummary({ nodes = [], edges = [], pendingDeletion } = {}) {
  const nodeIds = new Set(pendingDeletion?.nodeIds ?? []);
  const edgeIds = new Set(pendingDeletion?.edgeIds ?? []);
  const deletedNodes = nodes.filter((node) => nodeIds.has(node.id));
  const deletedEdges = edges.filter((edge) => edgeIds.has(edge.id));
  return {
    nodeCount: deletedNodes.length,
    edgeCount: deletedEdges.length,
    nodeNames: deletedNodes.map((node) => node.data?.label ?? node.id),
    nodes: deletedNodes,
    edges: deletedEdges,
  };
}

