import { summarizeAgentComponent } from './canvasAgent.js';
import { compilePipelineToPyTorch, compilePipelineToTensorFlow } from './compiler.js';
import { createBuildDatasetContext, projectBuildDatasetContext } from './buildAgent/datasetContext.js';
import { graphIdentityV1 } from './graph/identity.js';
import {
  revalidateGraphPatchProposal,
  GRAPH_PATCH_PROPOSAL_TYPE,
} from './graph/graphPatchProposal.js';
import {
  createDatasetBoundCapabilityAssessment,
  createGraphCapabilitySnapshot,
  ONNX_SOURCE_VERSION,
  revalidateWorkspaceGraphProposal,
  TORCH_EXPORT_SOURCE_VERSION,
} from './graph/workspaceProposal.js';
import { graphPatchBaseFromProject, prepareWorkspaceGraphPatchApply } from './graph/workspacePatchApply.js';
import { prepareWorkspaceGraphApply } from './graph/workspaceApply.js';
import { PROJECT_VERSION } from './project.js';

export const AGENT_APPLICATION_API_VERSION = 1;
export const AGENT_APPLICATION_GLOBAL = '__VOLK_ML_AGENT_APPLICATION__';
export const AGENT_APPLICATION_METHODS = Object.freeze([
  'inspectWorkspace',
  'listComponents',
  'listCapabilities',
  'submitGraphProposal',
  'submitGraphPatchProposal',
  'inspectProposal',
  'inspectResults',
  'exportGraph',
  'run',
]);

const MAX_REQUEST_CODE_UNITS = 1_100_000;
const MAX_RESPONSE_CODE_UNITS = 1_500_000;
const MAX_JSON_DEPTH = 48;
const MAX_JSON_VALUES = 60_000;
const MAX_COMPONENTS = 512;
const MAX_HISTORY = 12;
const MAX_SOURCE_CODE_UNITS = 300_000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const SAFE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,79}$/;
const EMPTY_PARAMS = new Set([
  'inspectWorkspace', 'listComponents', 'listCapabilities', 'inspectProposal', 'inspectResults', 'run',
]);

export class AgentApplicationApiError extends Error {
  constructor(code, details = undefined) {
    super(code);
    this.name = 'AgentApplicationApiError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, details) {
  throw new AgentApplicationApiError(code, details);
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function assertJsonValue(value, code, limits = {}) {
  const maxCodeUnits = limits.maxCodeUnits ?? MAX_REQUEST_CODE_UNITS;
  let visited = 0;
  let codeUnits = 0;
  const ancestors = new WeakSet();
  const visit = (current, depth) => {
    visited += 1;
    if (visited > MAX_JSON_VALUES || depth > MAX_JSON_DEPTH) fail(code, { reason: 'json-bound' });
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'string') {
      codeUnits += current.length;
      if (codeUnits > maxCodeUnits) fail(code, { reason: 'size-bound' });
      return;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) fail(code, { reason: 'non-finite-number' });
      return;
    }
    if (!current || typeof current !== 'object' || ancestors.has(current)) fail(code, { reason: 'non-json-value' });
    if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype) fail(code, { reason: 'non-plain-object' });
    ancestors.add(current);
    if (Array.isArray(current)) {
      if (Object.keys(current).length !== current.length) fail(code, { reason: 'extended-array' });
      current.forEach((item) => visit(item, depth + 1));
    } else {
      for (const [key, item] of Object.entries(current)) {
        codeUnits += key.length;
        if (codeUnits > maxCodeUnits) fail(code, { reason: 'size-bound' });
        visit(item, depth + 1);
      }
    }
    ancestors.delete(current);
  };
  visit(value, 0);
  let serialized;
  try { serialized = JSON.stringify(value); } catch { fail(code, { reason: 'serialization-failed' }); }
  if (serialized.length > maxCodeUnits) fail(code, { reason: 'size-bound' });
  return serialized;
}

function detached(value) {
  return JSON.parse(JSON.stringify(value));
}

function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeTree);
  return Object.freeze(value);
}

function rejectUnknownFields(value, allowed, code, label) {
  if (!isRecord(value)) fail(code, { field: label, reason: 'object-required' });
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) fail(code, { field: label, reason: 'unknown-field', fields: unknown.slice(0, 12) });
}

function validatedRequest(value) {
  assertJsonValue(value, 'REQUEST_INVALID');
  rejectUnknownFields(value, ['apiVersion', 'requestId', 'method', 'params'], 'REQUEST_INVALID', 'request');
  if (value.apiVersion !== AGENT_APPLICATION_API_VERSION) fail('API_VERSION_UNSUPPORTED', { supportedVersion: AGENT_APPLICATION_API_VERSION });
  if (typeof value.requestId !== 'string' || !REQUEST_ID_PATTERN.test(value.requestId)) fail('REQUEST_ID_INVALID');
  if (!AGENT_APPLICATION_METHODS.includes(value.method)) fail('METHOD_UNSUPPORTED');
  if (!isRecord(value.params)) fail('REQUEST_INVALID', { field: 'params', reason: 'object-required' });
  if (EMPTY_PARAMS.has(value.method) && Object.keys(value.params).length) fail('REQUEST_INVALID', { field: 'params', reason: 'unknown-field' });
  if (value.method === 'submitGraphProposal' || value.method === 'submitGraphPatchProposal') {
    rejectUnknownFields(value.params, ['proposal'], 'REQUEST_INVALID', 'params');
    if (!Object.hasOwn(value.params, 'proposal')) fail('REQUEST_INVALID', { field: 'params.proposal', reason: 'required' });
  }
  if (value.method === 'exportGraph') {
    rejectUnknownFields(value.params, ['framework'], 'REQUEST_INVALID', 'params');
    if (!['pytorch', 'tensorflow'].includes(value.params.framework)) fail('FRAMEWORK_UNSUPPORTED');
  }
  return value;
}

function graphFromProject(project) {
  if (!project?.graph) fail('WORKSPACE_UNAVAILABLE');
  return {
    nodes: project.graph.nodes,
    edges: project.graph.edges,
    componentDefinitions: project.customComponents ?? [],
  };
}

export function createAgentApplicationResultBinding({ nodes, edges, customComponents = [], dataset }) {
  const graph = { nodes, edges, componentDefinitions: customComponents };
  return {
    graphSemanticFingerprint: graphIdentityV1(graph).semanticFingerprint,
    datasetFingerprint: dataset ? createBuildDatasetContext(dataset).datasetFingerprint : null,
  };
}

function graphSummary(graph) {
  const identity = graphIdentityV1(graph);
  return {
    identity,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      componentId: node.data.manifest.id,
      operation: node.data.manifest.op,
      kind: node.data.manifest.kind,
      parameters: safeParameters(node),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
    })),
    componentDefinitionIds: graph.componentDefinitions.map((definition) => definition.id).sort(),
  };
}

function safeParameterValue(value, property) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (property?.type === 'select' && typeof value === 'string' && Array.isArray(property.options)) {
    return property.options.includes(value) ? value : undefined;
  }
  return undefined;
}

function safeParameters(node) {
  const schema = node.data.manifest.properties ?? [];
  const result = {};
  for (const property of schema.slice(0, 40)) {
    const key = property?.key;
    if (typeof key !== 'string' || !Object.hasOwn(node.data.parameters ?? {}, key)) continue;
    const value = safeParameterValue(node.data.parameters[key], property);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function safeComponentProperty(property) {
  if (!property || typeof property.key !== 'string' || typeof property.type !== 'string') return null;
  const safe = { key: property.key, type: property.type };
  if (['number', 'slider'].includes(property.type)) {
    for (const key of ['default', 'min', 'max', 'step']) {
      if (Number.isFinite(property[key])) safe[key] = property[key];
    }
  } else if (property.type === 'boolean') {
    if (typeof property.default === 'boolean') safe.default = property.default;
  } else if (property.type === 'select') {
    safe.options = Array.isArray(property.options)
      ? property.options.filter((option) => typeof option === 'string').slice(0, 32)
      : [];
    if (typeof property.default === 'string' && safe.options.includes(property.default)) safe.default = property.default;
  }
  return safe;
}

function safeComponentSummary(manifest) {
  const summary = summarizeAgentComponent(manifest);
  return {
    ...summary,
    properties: (manifest.properties ?? []).slice(0, 40).map(safeComponentProperty).filter(Boolean),
  };
}

function datasetProjection(dataset, getDatasetIdentity) {
  if (!dataset) return null;
  const context = createBuildDatasetContext(dataset);
  return {
    identity: getDatasetIdentity(context.datasetFingerprint),
    ...projectBuildDatasetContext(context),
  };
}

function boundedHistory(history) {
  return (Array.isArray(history) ? history : []).slice(-MAX_HISTORY).map((item) => ({
    proposalId: item.proposalId,
    type: item.type,
    status: item.status,
  }));
}

function proposalKind(proposal) {
  return proposal?.type === GRAPH_PATCH_PROPOSAL_TYPE ? 'graph-patch' : 'graph';
}

function proposalCheck(proposal, context) {
  const currentProject = context.project;
  const currentBaseGraph = graphPatchBaseFromProject(currentProject);
  if (proposal?.type === GRAPH_PATCH_PROPOSAL_TYPE) {
    return revalidateGraphPatchProposal(proposal, { currentBaseGraph });
  }
  return revalidateWorkspaceGraphProposal(proposal, {
    currentDataset: context.dataset ?? null,
    targetGraph: currentBaseGraph,
  });
}

function diagnosticCodes(result) {
  const diagnostics = result?.diagnostics ?? [];
  return diagnostics.slice(0, 8).map((diagnostic) => diagnostic?.code)
    .filter((code) => typeof code === 'string' && SAFE_ERROR_CODE_PATTERN.test(code));
}

function summarizeProposal(context) {
  const proposal = context.currentProposal;
  if (!proposal) return { current: null, history: boundedHistory(context.proposalHistory) };
  const checked = proposalCheck(proposal, context);
  const prepared = checked.valid
    ? (proposal?.type === GRAPH_PATCH_PROPOSAL_TYPE ? prepareWorkspaceGraphPatchApply : prepareWorkspaceGraphApply)(proposal, {
      currentProject: context.project,
      runtime: context.runtime,
    })
    : checked;
  const codes = checked.valid ? diagnosticCodes(prepared) : diagnosticCodes(checked);
  const stale = codes.some((code) => /STALE|CHANGED/.test(code));
  return {
    current: {
      proposalId: proposal.proposalId,
      type: proposalKind(proposal),
      status: !checked.valid || !prepared.ok ? (stale ? 'stale' : 'blocked') : 'staged',
      eligibility: checked.valid && prepared.ok ? 'ready-for-human-apply' : 'blocked',
      diagnosticCodes: codes,
    },
    history: boundedHistory(context.proposalHistory),
  };
}

function safeMetrics(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(key) && (typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))))
    .slice(0, 32));
}

function resultProjection(context) {
  const graph = graphFromProject(context.project);
  const currentIdentity = graphIdentityV1(graph).semanticFingerprint;
  const expected = context.resultBinding;
  const currentDatasetFingerprint = context.dataset ? createBuildDatasetContext(context.dataset).datasetFingerprint : null;
  const matchesBinding = Boolean(expected
    && expected.graphSemanticFingerprint === currentIdentity
    && expected.datasetFingerprint === currentDatasetFingerprint);
  const hasResult = context.runtime?.status === 'succeeded'
    && Boolean(context.runtime?.result)
    && matchesBinding;
  const status = ['idle', 'running', 'succeeded', 'failed'].includes(context.runtime?.status)
    ? context.runtime.status
    : 'idle';
  const metrics = hasResult ? safeMetrics(context.runtime.result.metrics) : {};
  const losses = hasResult && Array.isArray(context.runtime.losses)
    ? context.runtime.losses.filter((value) => Number.isFinite(value)).slice(-100)
    : [];
  return {
    provenance: 'browser-local',
    status,
    current: hasResult,
    freshness: hasResult ? 'current' : expected ? 'stale' : 'none',
    graphSemanticFingerprint: currentIdentity,
    datasetIdentity: context.dataset ? context.datasetIdentity ?? null : null,
    result: hasResult ? {
      modelType: typeof context.runtime.result.type === 'string' ? context.runtime.result.type.slice(0, 80) : null,
      sourceNodeId: typeof context.runtime.result.sourceNodeId === 'string' ? context.runtime.result.sourceNodeId.slice(0, 96) : null,
      metrics,
      lossHistory: { count: context.runtime.losses?.length ?? 0, recentValues: losses },
      finishedAt: typeof context.runtime.finishedAt === 'string' ? context.runtime.finishedAt.slice(0, 40) : null,
    } : null,
    failureCode: status === 'failed' && SAFE_ERROR_CODE_PATTERN.test(context.runtime?.error?.code ?? '')
      ? context.runtime.error.code
      : null,
    understanding: 'not-assessed',
  };
}

function summarizeCapabilities(context) {
  const graph = graphFromProject(context.project);
  const staticCapabilities = createGraphCapabilitySnapshot(graph);
  const datasetCapabilities = context.dataset
    ? createDatasetBoundCapabilityAssessment(graph, context.dataset)
    : { browserExecution: { status: 'unavailable', reason: 'DATASET_REQUIRED' }, executionTier: staticCapabilities.executionTier };
  return {
    graphIdentity: graphIdentityV1(graph).semanticFingerprint,
    compilers: staticCapabilities.compilers,
    browserExecution: datasetCapabilities.browserExecution,
    executionTier: {
      ...datasetCapabilities.executionTier,
      canRunHere: Boolean(context.executionPlan?.canRunHere),
    },
    imports: {
      volkProject: { status: 'available', format: 'VOLK-ML', projectVersion: PROJECT_VERSION },
      onnx: { status: 'available', adapterVersion: ONNX_SOURCE_VERSION },
      torchExport: { status: 'available', adapterVersion: TORCH_EXPORT_SOURCE_VERSION },
    },
    authority: {
      submitProposal: 'preview-only',
      learnerApplyRequired: true,
      directWorkspaceMutation: false,
      directExecution: false,
      artifactDownload: false,
    },
    methods: AGENT_APPLICATION_METHODS,
  };
}

function safeCompile(nodes, edges, framework) {
  try {
    return framework === 'pytorch'
      ? compilePipelineToPyTorch(nodes, edges)
      : compilePipelineToTensorFlow(nodes, edges);
  } catch (error) {
    const key = error?.translationKey;
    fail(key === 'error.frameworkUnsupported' ? 'EXPORT_UNSUPPORTED' : 'EXPORT_FAILED');
  }
}

function responseSuccess(requestId, result) {
  const response = { apiVersion: AGENT_APPLICATION_API_VERSION, requestId, ok: true, result };
  assertJsonValue(response, 'RESPONSE_INVALID', { maxCodeUnits: MAX_RESPONSE_CODE_UNITS });
  return freezeTree(detached(response));
}

function responseFailure(requestId, error) {
  const code = SAFE_ERROR_CODE_PATTERN.test(error?.code ?? '') ? error.code : 'API_INTERNAL_ERROR';
  const details = isRecord(error?.details) ? error.details : undefined;
  const response = {
    apiVersion: AGENT_APPLICATION_API_VERSION,
    requestId,
    ok: false,
    error: { code, ...(details ? { details } : {}) },
  };
  let serialized;
  try { serialized = assertJsonValue(response, 'RESPONSE_INVALID', { maxCodeUnits: MAX_RESPONSE_CODE_UNITS }); }
  catch { serialized = null; }
  if (!serialized) return Object.freeze({ apiVersion: AGENT_APPLICATION_API_VERSION, requestId, ok: false, error: Object.freeze({ code }) });
  return freezeTree(detached(response));
}

function parseRequestId(value) {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value) ? value : 'invalid-request';
}

/**
 * Create the narrow application-facing agent boundary. Dependencies are local
 * adapters; the returned API never exposes them or the underlying workspace.
 */
export function createAgentApplicationApi({ getContext, submitProposal }) {
  if (typeof getContext !== 'function' || typeof submitProposal !== 'function') fail('API_ADAPTER_INVALID');
  let datasetCounter = 0;
  const datasetTokens = new Map();
  const getDatasetIdentity = (fingerprint) => {
    if (!datasetTokens.has(fingerprint)) {
      datasetCounter += 1;
      datasetTokens.set(fingerprint, `dataset-session-${datasetCounter}`);
      while (datasetTokens.size > 12) datasetTokens.delete(datasetTokens.keys().next().value);
    }
    return datasetTokens.get(fingerprint);
  };

  const dispatch = async (request) => {
    const context = getContext();
    if (!isRecord(context) || !context.project || !context.runtime) fail('WORKSPACE_UNAVAILABLE');
    if (request.method === 'inspectWorkspace') {
      const graph = graphFromProject(context.project);
      return {
        workspace: {
          graph: graphSummary(graph),
          dataset: datasetProjection(context.dataset, getDatasetIdentity),
          runtime: { status: ['idle', 'running', 'succeeded', 'failed'].includes(context.runtime.status) ? context.runtime.status : 'idle' },
          resultAvailable: resultProjection({ ...context, datasetIdentity: context.dataset ? getDatasetIdentity(createBuildDatasetContext(context.dataset).datasetFingerprint) : null }).current,
        },
        privacy: { datasetRowsIncluded: false, datasetCellsIncluded: false, viewStateIncluded: false },
      };
    }
    if (request.method === 'listComponents') {
      const components = (context.components ?? []).slice(0, MAX_COMPONENTS).map(safeComponentSummary);
      return { components, truncated: (context.components?.length ?? 0) > components.length };
    }
    if (request.method === 'listCapabilities') return summarizeCapabilities(context);
    if (request.method === 'submitGraphProposal' || request.method === 'submitGraphPatchProposal') {
      const candidate = request.params.proposal;
      const isPatch = request.method === 'submitGraphPatchProposal';
      if (isPatch !== (candidate?.type === GRAPH_PATCH_PROPOSAL_TYPE)) fail('PROPOSAL_METHOD_MISMATCH');
      const checked = isPatch ? revalidateGraphPatchProposal(candidate, { currentBaseGraph: graphPatchBaseFromProject(context.project) })
        : revalidateWorkspaceGraphProposal(candidate, {
          ...(context.dataset ? { currentDataset: context.dataset } : {}),
          targetGraph: graphPatchBaseFromProject(context.project),
        });
      if (!checked.valid) {
        const codes = diagnosticCodes(checked);
        fail(codes[0] ?? 'PROPOSAL_INVALID', { diagnosticCodes: codes });
      }
      const submitted = await submitProposal(checked.proposal);
      if (!submitted?.ok) {
        const codes = diagnosticCodes(submitted);
        fail(codes[0] ?? 'PROPOSAL_NOT_STAGED', { diagnosticCodes: codes });
      }
      return {
        proposalId: checked.proposal.proposalId,
        kind: proposalKind(checked.proposal),
        status: 'staged',
        authority: 'preview-only',
        learnerApplyRequired: true,
      };
    }
    if (request.method === 'inspectProposal') return summarizeProposal(context);
    if (request.method === 'inspectResults') {
      const datasetIdentity = context.dataset ? getDatasetIdentity(createBuildDatasetContext(context.dataset).datasetFingerprint) : null;
      return resultProjection({ ...context, datasetIdentity });
    }
    if (request.method === 'exportGraph') {
      const framework = request.params.framework;
      const compiled = safeCompile(context.nodes, context.edges, framework);
      if (compiled.code.length > MAX_SOURCE_CODE_UNITS) fail('EXPORT_TOO_LARGE', { maxCodeUnits: MAX_SOURCE_CODE_UNITS });
      const fidelity = compiled.report.reduce((worst, item) => {
        const order = ['exact', 'adapted', 'approximate', 'unsupported'];
        return order.indexOf(item.quality) > order.indexOf(worst) ? item.quality : worst;
      }, 'exact');
      return {
        artifactId: `source-${framework}-${graphIdentityV1(graphFromProject(context.project)).semanticFingerprint}`,
        framework,
        code: compiled.code,
        report: compiled.report.map((item) => ({ componentId: item.componentId, quality: item.quality })),
        fidelity,
        provenance: 'local-compiler',
        executed: false,
        downloaded: false,
      };
    }
    if (request.method === 'run') fail('USER_CONFIRMATION_REQUIRED', { requiredPath: 'run-control-in-build-workspace' });
    fail('METHOD_UNSUPPORTED');
  };

  return Object.freeze({
    apiVersion: AGENT_APPLICATION_API_VERSION,
    async request(envelope) {
      const requestId = parseRequestId(envelope?.requestId);
      try {
        const request = validatedRequest(envelope);
        const result = await dispatch(request);
        return responseSuccess(request.requestId, result);
      } catch (error) {
        return responseFailure(requestId, error);
      }
    },
  });
}
