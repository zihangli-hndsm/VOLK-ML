import assert from 'node:assert/strict';
import { createAgentApplicationApi, createAgentApplicationResultBinding, AGENT_APPLICATION_API_VERSION } from '../src/core/agentApplicationApi.js';
import { installAgentApplicationBridge } from '../src/core/agentApplicationBridge.js';
import { pluginRegistry } from '../src/core/components.js';
import { exerciseDatasets } from '../src/core/buildAgent/exerciseFixtures.js';
import { createBuildDatasetContext, createGraphProposal, planBuildGoal } from '../src/core/buildAgent/index.js';
import { adaptBuildAgentGraphProposal } from '../src/core/graph/workspaceProposal.js';
import { createGraphPatchProposal } from '../src/core/graph/graphPatchProposal.js';
import { graphPatchBaseFromProject } from '../src/core/graph/workspacePatchApply.js';
import { PROJECT_VERSION, validateProjectForWorkspace } from '../src/core/project.js';

const clone = (value) => structuredClone(value);
const runtimeIdle = () => ({ status: 'idle', activeNodeIds: [], losses: [], result: null, error: null, startedAt: null, finishedAt: null });
const dataset = clone(exerciseDatasets.wine);
dataset.name = 'private-dataset-name-sentinel';
dataset.fileContents = 'private-dataset-source-sentinel';
dataset.rows[0].privateCell = 'private-row-cell-sentinel';

function buildProposal(sourceDataset) {
  const datasetContext = createBuildDatasetContext(sourceDataset);
  const planned = planBuildGoal({
    version: 1,
    goalId: 'agent-application-api-test',
    task: 'regression',
    modelFamily: 'linear-regression',
    architecture: 'baseline',
    dataset: null,
    executionExpectation: 'browser-local',
    parameters: null,
  }, datasetContext);
  assert.equal(planned.kind, 'plan');
  const native = createGraphProposal({ plan: planned.plan, dataset: sourceDataset, datasetContext });
  const adapted = adaptBuildAgentGraphProposal(native);
  assert.equal(adapted.ok, true, adapted.diagnostics?.[0]?.code);
  return clone(adapted.proposal);
}

function makeProject({ graph = { nodes: [], edges: [] }, customComponents = [], data = dataset } = {}) {
  return validateProjectForWorkspace({
    format: 'VOLK-ML',
    version: PROJECT_VERSION,
    name: 'Local API fixture',
    language: { primary: 'en', secondary: null },
    workspace: { libraryMode: 'compact', leftWidth: 300, rightWidth: 400, viewMode: 'canvas' },
    graph,
    customComponents,
    data,
    trainedModel: null,
  });
}

const proposal = buildProposal(dataset);
const project = makeProject();
const originalProjectJson = JSON.stringify(project);
const context = {
  project,
  nodes: proposal.graph.nodes,
  edges: proposal.graph.edges,
  dataset,
  runtime: runtimeIdle(),
  resultBinding: null,
  currentProposal: null,
  proposalHistory: [],
  components: pluginRegistry,
};
let stagedProposal = null;
let submitCount = 0;
const api = createAgentApplicationApi({
  getContext: () => context,
  submitProposal: (value) => {
    submitCount += 1;
    stagedProposal = clone(value);
    context.currentProposal = stagedProposal;
    return { ok: true, proposalId: value.proposalId };
  },
});
const request = (method, params = {}, requestId = 'api-test-1') => api.request({
  apiVersion: AGENT_APPLICATION_API_VERSION,
  requestId,
  method,
  params,
});

const inspected = await request('inspectWorkspace');
assert.equal(inspected.ok, true);
const serializedInspection = JSON.stringify(inspected);
assert.equal(inspected.result.privacy.datasetRowsIncluded, false);
assert.equal(inspected.result.privacy.datasetCellsIncluded, false);
assert.equal(inspected.result.privacy.viewStateIncluded, false);
assert.equal(serializedInspection.includes('private-dataset-name-sentinel'), false);
assert.equal(serializedInspection.includes('private-dataset-source-sentinel'), false);
assert.equal(serializedInspection.includes('private-row-cell-sentinel'), false);
assert.equal(Object.hasOwn(inspected.result.workspace.dataset, 'datasetFingerprint'), false);
assert.equal(Object.hasOwn(inspected.result.workspace, 'selectedNodeId'), false);
assert.equal(Object.hasOwn(inspected.result.workspace, 'viewMode'), false);
assert.ok(Object.isFrozen(inspected) && Object.isFrozen(inspected.result.workspace.graph.nodes));

const listed = await request('listComponents');
assert.equal(listed.ok, true);
assert.equal(listed.result.components.length, pluginRegistry.length);
assert.equal(JSON.stringify(listed).includes('private-row-cell-sentinel'), false);
const customLossManifest = pluginRegistry.find((manifest) => manifest.id === 'custom_loss_node');
const privateLossNode = {
  id: 'private-custom-loss',
  position: { x: 0, y: 0 },
  type: 'pipelineNode',
  data: {
    manifest: customLossManifest,
    label: customLossManifest.name,
    parameters: { expression: 'private-loss-expression-sentinel' },
    status: 'idle',
  },
};
context.project = makeProject({ graph: { nodes: [privateLossNode], edges: [] } });
context.nodes = [privateLossNode];
context.edges = [];
const privateInspection = await request('inspectWorkspace', {}, 'privacy-graph-1');
assert.equal(privateInspection.ok, true);
assert.equal(JSON.stringify(privateInspection).includes('private-loss-expression-sentinel'), false);
assert.deepEqual(privateInspection.result.workspace.graph.nodes[0].parameters, {});
const customLossSummary = listed.result.components.find((manifest) => manifest.id === 'custom_loss_node');
assert.deepEqual(customLossSummary.properties, [{ key: 'expression', type: 'code' }]);
assert.equal(JSON.stringify(listed).includes('mean(square(prediction - target))'), false);
context.project = project;
context.nodes = proposal.graph.nodes;
context.edges = proposal.graph.edges;

const capabilities = await request('listCapabilities');
assert.equal(capabilities.ok, true);
assert.equal(capabilities.result.authority.submitProposal, 'preview-only');
assert.equal(capabilities.result.authority.learnerApplyRequired, true);
assert.equal(capabilities.result.authority.directWorkspaceMutation, false);
assert.equal(capabilities.result.authority.directExecution, false);
assert.equal(capabilities.result.authority.artifactDownload, false);
assert.deepEqual(capabilities.result.methods.includes('run'), true);

const staged = await request('submitGraphProposal', { proposal }, 'proposal-stage-1');
assert.equal(staged.ok, true, staged.error?.code);
assert.equal(staged.result.status, 'staged');
assert.equal(staged.result.learnerApplyRequired, true);
assert.equal(submitCount, 1);
assert.equal(JSON.stringify(project), originalProjectJson, 'Staging a proposal must not mutate the current project.');
const stagedStatus = await request('inspectProposal');
assert.equal(stagedStatus.ok, true);
assert.equal(stagedStatus.result.current.status, 'staged');
assert.equal(stagedStatus.result.current.eligibility, 'ready-for-human-apply');
assert.equal(JSON.stringify(stagedStatus).includes('private-row-cell-sentinel'), false);

const changedDataset = clone(dataset);
changedDataset.rows[0].quality += 0.5;
context.dataset = changedDataset;
const staleProposal = await request('inspectProposal');
assert.equal(staleProposal.ok, true);
assert.equal(staleProposal.result.current.status, 'stale');
assert.ok(staleProposal.result.current.diagnosticCodes.includes('BUILD_DATASET_STALE'));
context.dataset = dataset;

const invalidSubmission = await request('submitGraphProposal', { proposal: { ...proposal, injectedRuntimeMutation: true } }, 'proposal-bad-1');
assert.equal(invalidSubmission.ok, false);
assert.equal(invalidSubmission.error.code, 'GRAPH_PROPOSAL_INVALID');
assert.equal(submitCount, 1, 'Rejected proposals must not reach the application staging callback.');

const patchBaseProject = makeProject({
  graph: { nodes: clone(proposal.graph.nodes), edges: clone(proposal.graph.edges) },
  customComponents: clone(proposal.graph.componentDefinitions),
});
context.project = patchBaseProject;
const patchBase = graphPatchBaseFromProject(patchBaseProject);
const firstNode = patchBase.nodes[0];
const patchResult = createGraphPatchProposal({
  baseGraph: patchBase,
  operations: [{ op: 'MOVE_NODE', nodeId: firstNode.id, position: { x: firstNode.position.x + 24, y: firstNode.position.y + 12 } }],
  source: { producer: 'external-agent', provenance: { artifactId: 'agent-app-api-patch', revision: '1', location: 'inline' } },
  rationale: 'Verify patch proposal staging through the bounded application API.',
});
assert.equal(patchResult.ok, true, patchResult.diagnostics?.[0]?.code);
const stagedPatch = await request('submitGraphPatchProposal', { proposal: patchResult.proposal }, 'patch-stage-1');
assert.equal(stagedPatch.ok, true, stagedPatch.error?.code);
assert.equal(stagedPatch.result.kind, 'graph-patch');
assert.equal(submitCount, 2);
const wrongMethod = await request('submitGraphProposal', { proposal: patchResult.proposal }, 'patch-wrong-method');
assert.equal(wrongMethod.ok, false);
assert.equal(wrongMethod.error.code, 'PROPOSAL_METHOD_MISMATCH');
assert.equal(submitCount, 2);

context.currentProposal = null;
context.runtime = {
  status: 'succeeded',
  activeNodeIds: [],
  losses: [4, 2, 1],
  result: { type: 'linear-regression', sourceNodeId: 'pipeline-linear', metrics: { rmse: 0.25, r2: 0.9, raw: 'filtered' } },
  error: null,
  startedAt: '2026-09-25T00:00:00.000Z',
  finishedAt: '2026-09-25T00:00:01.000Z',
};
context.resultBinding = createAgentApplicationResultBinding({
  nodes: context.nodes,
  edges: context.edges,
  customComponents: context.project.customComponents,
  dataset: context.dataset,
});
const results = await request('inspectResults');
assert.equal(results.ok, true);
assert.equal(results.result.current, true);
assert.equal(results.result.provenance, 'browser-local');
assert.equal(results.result.understanding, 'not-assessed');
assert.deepEqual(results.result.result.metrics, { rmse: 0.25, r2: 0.9 });
assert.equal(JSON.stringify(results).includes('private-row-cell-sentinel'), false);

context.resultBinding = { ...context.resultBinding, graphSemanticFingerprint: 'stale-graph' };
const staleResults = await request('inspectResults');
assert.equal(staleResults.result.current, false);
assert.equal(staleResults.result.result, null);

context.resultBinding = createAgentApplicationResultBinding({
  nodes: context.nodes,
  edges: context.edges,
  customComponents: context.project.customComponents,
  dataset: context.dataset,
});
const artifact = await request('exportGraph', { framework: 'pytorch' });
assert.equal(artifact.ok, true, artifact.error?.code);
assert.equal(artifact.result.executed, false);
assert.equal(artifact.result.downloaded, false);
assert.equal(artifact.result.provenance, 'local-compiler');
assert.ok(artifact.result.code.includes('Generated by VOLK-ML IR'));
assert.ok(artifact.result.code.length < 300_000);
assert.equal(JSON.stringify(artifact).includes('private-row-cell-sentinel'), false);

const beforeRun = JSON.stringify({ project: context.project, runtime: context.runtime, proposal: context.currentProposal });
const runResult = await request('run');
assert.equal(runResult.ok, false);
assert.equal(runResult.error.code, 'USER_CONFIRMATION_REQUIRED');
assert.equal(JSON.stringify({ project: context.project, runtime: context.runtime, proposal: context.currentProposal }), beforeRun);

const unsupportedVersion = await api.request({ apiVersion: 99, requestId: 'version-test', method: 'inspectWorkspace', params: {} });
assert.equal(unsupportedVersion.ok, false);
assert.equal(unsupportedVersion.error.code, 'API_VERSION_UNSUPPORTED');
const unknownField = await api.request({ apiVersion: 1, requestId: 'unknown-field', method: 'inspectWorkspace', params: {}, screenshot: 'no' });
assert.equal(unknownField.ok, false);
assert.equal(unknownField.error.code, 'REQUEST_INVALID');
const malformedMethodParams = await request('inspectWorkspace', { rawUiState: {} });
assert.equal(malformedMethodParams.ok, false);
assert.equal(malformedMethodParams.error.code, 'REQUEST_INVALID');

const globalTarget = { ["__VOLK_ML_AGENT_APPLICATION__"]: 'previous-bridge' };
const uninstall = installAgentApplicationBridge(api, globalTarget);
assert.equal(globalTarget.__VOLK_ML_AGENT_APPLICATION__.apiVersion, 1);
assert.equal((await globalTarget.__VOLK_ML_AGENT_APPLICATION__.request({ apiVersion: 1, requestId: 'bridge-test', method: 'inspectWorkspace', params: {} })).ok, true);
uninstall();
assert.equal(globalTarget.__VOLK_ML_AGENT_APPLICATION__, 'previous-bridge');

console.log('Agent Application API v1 checks passed.');
