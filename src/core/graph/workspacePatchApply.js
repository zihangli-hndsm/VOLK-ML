import { validateProjectForWorkspace } from '../project.js';
import {
  canonicalGraphSemanticsJsonV1,
  projectGraphSemanticsV1,
} from './identity.js';
import {
  revalidateGraphPatchProposal,
  validateGraphPatchProposal,
} from './graphPatchProposal.js';
import { canonicalizeWorkspaceGraphCandidate } from './workspaceProposal.js';

export const GRAPH_PATCH_APPLY_DIAGNOSTICS = Object.freeze({
  BUSY: 'GRAPH_PATCH_APPLY_WORKSPACE_BUSY',
  PROJECT_INVALID: 'GRAPH_PATCH_APPLY_PROJECT_INVALID',
  DEFINITION_COLLISION: 'GRAPH_PATCH_APPLY_COMPONENT_DEFINITION_COLLISION',
  WORKSPACE_CHANGED: 'GRAPH_PATCH_APPLY_WORKSPACE_CHANGED',
  PREPARATION_INVALID: 'GRAPH_PATCH_APPLY_PREPARATION_INVALID',
});

const idleRuntime = () => ({
  status: 'idle',
  activeNodeIds: [],
  losses: [],
  result: null,
  error: null,
  startedAt: null,
  finishedAt: null,
});

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function workspaceSnapshotIdentity(project, runtime) {
  const { savedAt: _savedAt, ...withoutSaveTime } = project;
  const patchGraph = graphPatchBaseFromProject(withoutSaveTime);
  return stableJson({
    project: { ...withoutSaveTime, graph: { nodes: patchGraph.nodes, edges: patchGraph.edges } },
    runtime,
  });
}

function diagnostic(code, details = undefined) {
  return { ok: false, diagnostics: [{ code, ...(details ? { details } : {}) }] };
}

export function graphPatchBaseFromProject(project) {
  return {
    nodes: project.graph.nodes.map((node) => ({
      id: node.id,
      ...(node.type === undefined ? {} : { type: node.type }),
      position: { x: node.position.x, y: node.position.y },
      data: {
        ...(node.data.label === undefined ? {} : { label: node.data.label }),
        manifest: node.data.manifest,
        parameters: node.data.parameters,
        ...(node.data.status === undefined ? {} : { status: node.data.status }),
      },
    })),
    edges: project.graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
      ...(edge.type === undefined ? {} : { type: edge.type }),
    })),
    componentDefinitions: project.customComponents,
  };
}

function mergePatchDefinitions(currentDefinitions, graphDefinitions) {
  const next = structuredClone(currentDefinitions);
  const byId = new Map(next.map((definition) => [definition.id, definition]));
  for (const definition of graphDefinitions) {
    const current = byId.get(definition.id);
    if (current) {
      if (stableJson(current) !== stableJson(definition)) {
        return diagnostic(GRAPH_PATCH_APPLY_DIAGNOSTICS.DEFINITION_COLLISION, { componentId: definition.id });
      }
      continue;
    }
    const detached = structuredClone(definition);
    next.push(detached);
    byId.set(detached.id, detached);
  }
  return { ok: true, definitions: next };
}

function nodeName(node) {
  return node?.data?.label ?? node?.data?.manifest?.name ?? node?.data?.manifest?.id ?? node?.id;
}

function endpoint(edge) {
  return {
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
  };
}

/** Classify a canonical before/after pair; the graph and operation replay own diff truth. */
export function deriveGraphPatchDiff(baseGraph, resultGraph, operations = []) {
  const beforeNodes = new Map(baseGraph.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(resultGraph.nodes.map((node) => [node.id, node]));
  const beforeSemanticNodes = new Map(projectGraphSemanticsV1(baseGraph).nodes.map((node) => [node.id, node]));
  const afterSemanticNodes = new Map(projectGraphSemanticsV1(resultGraph).nodes.map((node) => [node.id, node]));
  const beforeEdges = new Map(baseGraph.edges.map((edge) => [edge.id, edge]));
  const afterEdges = new Map(resultGraph.edges.map((edge) => [edge.id, edge]));
  const nodes = { existing: [], removed: [], changed: [], added: [] };
  const edges = { existing: [], removed: [], changed: [], added: [] };

  for (const id of [...new Set([...beforeNodes.keys(), ...afterNodes.keys()])].sort()) {
    const before = beforeNodes.get(id);
    const after = afterNodes.get(id);
    if (!before) {
      nodes.added.push({ id, label: nodeName(after) });
      continue;
    }
    if (!after) {
      nodes.removed.push({ id, label: nodeName(before) });
      continue;
    }
    const semanticChanged = stableJson(beforeSemanticNodes.get(id)) !== stableJson(afterSemanticNodes.get(id));
    const moved = stableJson(before.position) !== stableJson(after.position);
    if (!semanticChanged && !moved) {
      nodes.existing.push({ id, label: nodeName(after) });
      continue;
    }
    const beforeParameters = before.data?.parameters ?? {};
    const afterParameters = after.data?.parameters ?? {};
    const parameterChanges = [...new Set([...Object.keys(beforeParameters), ...Object.keys(afterParameters)])]
      .sort()
      .filter((key) => stableJson(beforeParameters[key]) !== stableJson(afterParameters[key]))
      .map((key) => ({
        key,
        hasBefore: Object.hasOwn(beforeParameters, key),
        before: beforeParameters[key],
        hasAfter: Object.hasOwn(afterParameters, key),
        after: afterParameters[key],
      }));
    nodes.changed.push({
      id,
      label: nodeName(after),
      parameterChanges,
      moved,
      beforePosition: before.position,
      afterPosition: after.position,
      semanticChanged,
    });
  }

  for (const id of [...new Set([...beforeEdges.keys(), ...afterEdges.keys()])].sort()) {
    const before = beforeEdges.get(id);
    const after = afterEdges.get(id);
    if (!before) edges.added.push({ id, afterEndpoint: endpoint(after) });
    else if (!after) edges.removed.push({ id, beforeEndpoint: endpoint(before) });
    else if (stableJson(endpoint(before)) !== stableJson(endpoint(after))) {
      edges.changed.push({ id, beforeEndpoint: endpoint(before), afterEndpoint: endpoint(after) });
    } else edges.existing.push({ id, endpoint: endpoint(after) });
  }

  return {
    nodes,
    edges,
    operations: structuredClone(operations),
  };
}

function normalizePatchNode(node, baseById, semanticChanged) {
  const { selected: _selected, dragging: _dragging, ...rest } = node;
  const baseNode = baseById.get(node.id);
  return {
    ...rest,
    type: 'pipelineNode',
    data: {
      ...node.data,
      status: semanticChanged || !baseNode ? 'idle' : (baseNode.data?.status ?? 'idle'),
    },
  };
}

function normalizePatchEdge(edge) {
  const { selected: _selected, ...rest } = edge;
  return { ...rest, type: 'deletable' };
}

/**
 * Prepare a detached patch against the current canonical project and runtime.
 * This accepts occupied graphs; it never mutates the input proposal or project.
 */
export function prepareWorkspaceGraphPatchApply(proposal, { currentProject, runtime } = {}) {
  if (!isRecord(currentProject) || !isRecord(currentProject.graph)
    || !Array.isArray(currentProject.graph.nodes) || !Array.isArray(currentProject.graph.edges)
    || !Array.isArray(currentProject.customComponents)) {
    return diagnostic(GRAPH_PATCH_APPLY_DIAGNOSTICS.PROJECT_INVALID);
  }
  if (runtime?.status === 'running') return diagnostic(GRAPH_PATCH_APPLY_DIAGNOSTICS.BUSY);

  const checked = validateGraphPatchProposal(proposal);
  if (!checked.valid) return { ok: false, diagnostics: checked.diagnostics };

  let validatedCurrentProject;
  try {
    validatedCurrentProject = validateProjectForWorkspace(currentProject);
  } catch (error) {
    return diagnostic(GRAPH_PATCH_APPLY_DIAGNOSTICS.PROJECT_INVALID, {
      reason: typeof error?.code === 'string' ? error.code : 'current-project-invalid',
    });
  }

  const currentCandidate = canonicalizeWorkspaceGraphCandidate(graphPatchBaseFromProject(validatedCurrentProject));
  if (!currentCandidate.valid) return { ok: false, diagnostics: currentCandidate.diagnostics };
  const currentBaseGraph = currentCandidate.graph;
  const revalidated = revalidateGraphPatchProposal(checked.proposal, { currentBaseGraph });
  if (!revalidated.valid) return { ok: false, diagnostics: revalidated.diagnostics };

  const definitions = mergePatchDefinitions(
    validatedCurrentProject.customComponents,
    revalidated.resultGraph.componentDefinitions,
  );
  if (!definitions.ok) return definitions;

  let semanticChanged;
  try {
    semanticChanged = canonicalGraphSemanticsJsonV1(currentBaseGraph)
      !== canonicalGraphSemanticsJsonV1(revalidated.resultGraph);
  } catch (error) {
    return diagnostic(GRAPH_PATCH_APPLY_DIAGNOSTICS.PROJECT_INVALID, {
      reason: typeof error?.code === 'string' ? error.code : 'graph-identity-invalid',
      ...(typeof error?.details?.path === 'string' ? { path: error.details.path } : {}),
    });
  }

  const baseById = new Map(currentBaseGraph.nodes.map((node) => [node.id, node]));
  const graph = {
    nodes: revalidated.resultGraph.nodes.map((node) => normalizePatchNode(node, baseById, semanticChanged)),
    edges: revalidated.resultGraph.edges.map(normalizePatchEdge),
  };
  let nextProject;
  try {
    nextProject = validateProjectForWorkspace({
      ...validatedCurrentProject,
      graph,
      customComponents: definitions.definitions,
      trainedModel: semanticChanged ? null : validatedCurrentProject.trainedModel,
    });
  } catch (error) {
    return diagnostic(GRAPH_PATCH_APPLY_DIAGNOSTICS.PROJECT_INVALID, {
      reason: typeof error?.code === 'string' ? error.code : 'candidate-project-invalid',
    });
  }

  return {
    ok: true,
    preparation: {
      proposal: checked.proposal,
      nextProject: structuredClone(nextProject),
      baseGraph: structuredClone(currentBaseGraph),
      resultGraph: structuredClone(revalidated.resultGraph),
      diff: deriveGraphPatchDiff(currentBaseGraph, revalidated.resultGraph, checked.proposal.operations),
      semanticChanged,
      runtime: structuredClone(semanticChanged ? idleRuntime() : (runtime ?? idleRuntime())),
      expectedWorkspaceIdentity: workspaceSnapshotIdentity(validatedCurrentProject, runtime ?? null),
    },
  };
}

/** Re-prepare against the latest snapshot; the app owns one synchronous commit. */
export function commitWorkspaceGraphPatchApply(preparation, { currentProject, runtime } = {}) {
  const prepared = preparation?.preparation;
  if (!preparation?.ok || !isRecord(prepared) || !isRecord(prepared.nextProject)
    || !prepared.proposal || typeof prepared.expectedWorkspaceIdentity !== 'string') {
    return diagnostic(GRAPH_PATCH_APPLY_DIAGNOSTICS.PREPARATION_INVALID);
  }

  const latest = prepareWorkspaceGraphPatchApply(prepared.proposal, { currentProject, runtime });
  if (!latest.ok) return latest;
  if (latest.preparation.expectedWorkspaceIdentity !== prepared.expectedWorkspaceIdentity) {
    return diagnostic(GRAPH_PATCH_APPLY_DIAGNOSTICS.WORKSPACE_CHANGED);
  }

  return {
    ok: true,
    project: structuredClone(latest.preparation.nextProject),
    graph: structuredClone(latest.preparation.resultGraph),
    diff: structuredClone(latest.preparation.diff),
    semanticChanged: latest.preparation.semanticChanged,
    runtime: structuredClone(latest.preparation.runtime),
    selectedNodeId: null,
  };
}
