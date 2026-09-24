import { validateProjectForWorkspace } from '../project.js';
import {
  revalidateWorkspaceGraphProposal,
  validateWorkspaceGraphProposal,
} from './workspaceProposal.js';

export const GRAPH_APPLY_DIAGNOSTICS = Object.freeze({
  BUSY: 'GRAPH_APPLY_WORKSPACE_BUSY',
  DATASET_REQUIRED: 'GRAPH_APPLY_DATASET_REQUIRED',
  TARGET_OCCUPIED: 'TARGET_WORKSPACE_NOT_EMPTY',
  DEFINITION_COLLISION: 'GRAPH_APPLY_COMPONENT_DEFINITION_COLLISION',
  PROJECT_INVALID: 'GRAPH_APPLY_PROJECT_INVALID',
  WORKSPACE_CHANGED: 'GRAPH_APPLY_WORKSPACE_CHANGED',
  PREPARATION_INVALID: 'GRAPH_APPLY_PREPARATION_INVALID',
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

function workspaceSnapshotIdentity(project, runtime) {
  const { savedAt: _savedAt, ...withoutSaveTime } = project;
  return JSON.stringify(stableValue({ project: withoutSaveTime, runtime }));
}

function definitionIdentity(definition) {
  return JSON.stringify(stableValue(definition));
}

function diagnostic(code, details = undefined) {
  return { ok: false, diagnostics: [{ code, ...(details ? { details } : {}) }] };
}

function resetProposalNode(node) {
  const { selected: _selected, dragging: _dragging, ...rest } = node;
  return {
    ...rest,
    type: 'pipelineNode',
    data: { ...node.data, status: 'idle' },
  };
}

function resetProposalEdge(edge) {
  const { selected: _selected, ...rest } = edge;
  return { ...rest, type: 'deletable' };
}

function mergeRequiredDefinitions(currentDefinitions, requiredDefinitions) {
  const next = structuredClone(currentDefinitions);
  const byId = new Map(next.map((definition) => [definition.id, definition]));
  for (const definition of requiredDefinitions) {
    const current = byId.get(definition.id);
    if (current) {
      if (definitionIdentity(current) !== definitionIdentity(definition)) {
        return diagnostic(GRAPH_APPLY_DIAGNOSTICS.DEFINITION_COLLISION, { componentId: definition.id });
      }
      continue;
    }
    const detached = structuredClone(definition);
    next.push(detached);
    byId.set(detached.id, detached);
  }
  return { ok: true, definitions: next };
}

/**
 * Prepare a detached proposal against one current serialized project snapshot.
 * This function never mutates the project, proposal, dataset, or runtime.
 */
export function prepareWorkspaceGraphApply(proposal, { currentProject, runtime } = {}) {
  if (!isRecord(currentProject) || !isRecord(currentProject.graph)
    || !Array.isArray(currentProject.graph.nodes) || !Array.isArray(currentProject.graph.edges)
    || !Array.isArray(currentProject.customComponents)) {
    return diagnostic(GRAPH_APPLY_DIAGNOSTICS.PROJECT_INVALID);
  }
  if (runtime?.status === 'running') return diagnostic(GRAPH_APPLY_DIAGNOSTICS.BUSY);

  const checked = validateWorkspaceGraphProposal(proposal);
  if (!checked.valid) return { ok: false, diagnostics: checked.diagnostics };
  const detachedProposal = checked.proposal;
  if (detachedProposal.source.producer === 'build-agent' && !currentProject.data) {
    return diagnostic(GRAPH_APPLY_DIAGNOSTICS.DATASET_REQUIRED);
  }

  let validatedCurrentProject;
  try {
    validatedCurrentProject = validateProjectForWorkspace(currentProject);
  } catch (error) {
    return diagnostic(GRAPH_APPLY_DIAGNOSTICS.PROJECT_INVALID, {
      reason: typeof error?.code === 'string' ? error.code : 'current-project-invalid',
    });
  }

  const revalidated = revalidateWorkspaceGraphProposal(detachedProposal, {
    ...(validatedCurrentProject.data ? { currentDataset: validatedCurrentProject.data } : {}),
    targetGraph: validatedCurrentProject.graph,
  });
  if (!revalidated.valid) return { ok: false, diagnostics: revalidated.diagnostics };
  if (revalidated.assessment?.status !== 'eligible') {
    return diagnostic(GRAPH_APPLY_DIAGNOSTICS.TARGET_OCCUPIED, revalidated.assessment?.targetWorkspace);
  }

  const definitions = mergeRequiredDefinitions(
    validatedCurrentProject.customComponents,
    revalidated.canonicalGraph.componentDefinitions,
  );
  if (!definitions.ok) return definitions;

  const graph = {
    nodes: revalidated.canonicalGraph.nodes.map(resetProposalNode),
    edges: revalidated.canonicalGraph.edges.map(resetProposalEdge),
  };
  let nextProject;
  try {
    nextProject = validateProjectForWorkspace({
      ...validatedCurrentProject,
      graph,
      customComponents: definitions.definitions,
      trainedModel: null,
    });
  } catch (error) {
    return diagnostic(GRAPH_APPLY_DIAGNOSTICS.PROJECT_INVALID, {
      reason: typeof error?.code === 'string' ? error.code : 'candidate-project-invalid',
    });
  }

  return {
    ok: true,
    preparation: {
      proposal: detachedProposal,
      nextProject: structuredClone(nextProject),
      canonicalGraph: structuredClone(revalidated.canonicalGraph),
      datasetBoundCapabilities: structuredClone(revalidated.datasetBoundCapabilities ?? null),
      expectedWorkspaceIdentity: workspaceSnapshotIdentity(validatedCurrentProject, runtime ?? null),
    },
  };
}

/**
 * Re-prepare against the latest snapshot immediately before the app commits.
 * The returned project is detached; the caller owns one synchronous UI commit.
 */
export function commitWorkspaceGraphApply(preparation, { currentProject, runtime } = {}) {
  const prepared = preparation?.preparation;
  if (!preparation?.ok || !isRecord(prepared) || !isRecord(prepared.nextProject)
    || !prepared.proposal || typeof prepared.expectedWorkspaceIdentity !== 'string') {
    return diagnostic(GRAPH_APPLY_DIAGNOSTICS.PREPARATION_INVALID);
  }

  const latest = prepareWorkspaceGraphApply(prepared.proposal, { currentProject, runtime });
  if (!latest.ok) return latest;
  if (latest.preparation.expectedWorkspaceIdentity !== prepared.expectedWorkspaceIdentity) {
    return diagnostic(GRAPH_APPLY_DIAGNOSTICS.WORKSPACE_CHANGED);
  }

  return {
    ok: true,
    project: structuredClone(latest.preparation.nextProject),
    canonicalGraph: structuredClone(latest.preparation.canonicalGraph),
    datasetBoundCapabilities: structuredClone(latest.preparation.datasetBoundCapabilities),
    runtime: idleRuntime(),
    selectedNodeId: null,
  };
}
