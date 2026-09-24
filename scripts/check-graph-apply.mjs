import assert from 'node:assert/strict';
import { compilePipelineToPyTorch } from '../src/core/compiler.js';
import { executeBrowserGraph } from '../src/core/browserRuntime.js';
import { CANVAS_AGENT_API_VERSION, createAgentNode, connectAgentNodes, removeAgentNode, updateAgentNode } from '../src/core/canvasAgent.js';
import { componentById, expandComposite } from '../src/core/components.js';
import { createCustomComposite, rebuildCompositeInstance } from '../src/core/customComposites.js';
import { PROJECT_VERSION, projectContentSignature, validateProjectForWorkspace } from '../src/core/project.js';
import {
  adaptBuildAgentGraphProposal,
  createVolkProjectGraphProposal,
  createWorkspaceGraphProposalFromCandidate,
  GRAPH_SOURCE_VERSION,
} from '../src/core/graph/index.js';
import { createBuildDatasetContext, createGraphProposal, planBuildGoal } from '../src/core/buildAgent/index.js';
import { exerciseDatasets } from '../src/core/buildAgent/exerciseFixtures.js';
import { commitWorkspaceGraphApply, prepareWorkspaceGraphApply } from '../src/core/graph/workspaceApply.js';

const clone = (value) => structuredClone(value);

function makeProject({
  name = 'Current project',
  graph = { nodes: [], edges: [] },
  customComponents = [],
  data = clone(exerciseDatasets.wine),
  trainedModel = null,
} = {}) {
  return validateProjectForWorkspace({
    format: 'VOLK-ML',
    version: PROJECT_VERSION,
    name,
    language: { primary: 'zh', secondary: 'en' },
    workspace: { libraryMode: 'compact', leftWidth: 333, rightWidth: 444, viewMode: 'canvas' },
    graph,
    customComponents,
    data,
    trainedModel,
  });
}

function buildAgentProposal(dataset = clone(exerciseDatasets.wine)) {
  const datasetContext = createBuildDatasetContext(dataset);
  const planResult = planBuildGoal({
    version: 1,
    goalId: 'graph-apply-linear-fixture',
    task: 'regression',
    modelFamily: 'linear-regression',
    architecture: 'baseline',
    dataset: null,
    executionExpectation: 'browser-local',
    parameters: null,
  }, datasetContext);
  assert.equal(planResult.kind, 'plan', planResult.code ?? planResult.kind);
  const nativeProposal = createGraphProposal({ plan: planResult.plan, dataset, datasetContext });
  const adapted = adaptBuildAgentGraphProposal(nativeProposal);
  assert.equal(adapted.ok, true, adapted.diagnostics?.[0]?.code);
  return { dataset, nativeProposal, proposal: JSON.parse(JSON.stringify(adapted.proposal)) };
}

function externalProposalFrom(graph) {
  const candidateGraph = clone(graph);
  delete candidateGraph.blueprintId;
  const result = createWorkspaceGraphProposalFromCandidate({
    graph: candidateGraph,
    source: {
      version: GRAPH_SOURCE_VERSION,
      kind: 'planner',
      producer: 'external-agent',
      format: 'volk-graph-candidate-v1',
      provenance: { artifactId: 'graph-apply-external', revision: 'fixture-1', location: 'inline' },
    },
    conversion: {
      version: 2,
      fidelity: 'exact',
      exactFor: ['graph-semantics', 'graph-layout'],
      preserved: ['graph'],
      approximated: [],
      missing: [],
      unsupported: [],
      warnings: [],
      omitted: [],
    },
  });
  assert.equal(result.ok, true, result.diagnostics?.[0]?.code);
  return JSON.parse(JSON.stringify(result.proposal));
}

function volkProjectProposalFrom(graph, { name = 'Imported source project', data = clone(exerciseDatasets.iris), customComponents = [] } = {}) {
  const result = createVolkProjectGraphProposal({
    format: 'VOLK-ML',
    version: PROJECT_VERSION,
    name,
    graph: { nodes: clone(graph.nodes), edges: clone(graph.edges) },
    customComponents: clone(customComponents),
    data: clone(data),
    trainedModel: null,
  });
  assert.equal(result.ok, true, result.diagnostics?.[0]?.code);
  return JSON.parse(JSON.stringify(result.proposal));
}

const runtimeIdle = () => ({ status: 'idle', activeNodeIds: [], losses: [], result: null, error: null, startedAt: null, finishedAt: null });
const runtimeFailed = () => ({ status: 'failed', activeNodeIds: [], losses: [4, 2], result: null, error: { code: 'PREVIOUS_RUN_FAILED' }, startedAt: 'start', finishedAt: 'finish' });

function projectSignature(project) {
  const { savedAt: _savedAt, ...persisted } = project;
  return projectContentSignature(persisted);
}

function expectAtomicFailure(proposal, currentProject, runtime, expectedCode) {
  const projectBefore = clone(currentProject);
  const runtimeBefore = clone(runtime);
  const identityBefore = projectSignature(currentProject);
  const preparation = prepareWorkspaceGraphApply(proposal, { currentProject, runtime });
  assert.equal(preparation.ok, false, `Expected ${expectedCode} to block preparation.`);
  assert.equal(preparation.diagnostics[0]?.code, expectedCode);
  assert.equal(projectSignature(currentProject), identityBefore, `${expectedCode} must not mutate project state.`);
  assert.deepEqual(currentProject, projectBefore, `${expectedCode} must preserve every project field.`);
  assert.deepEqual(runtime, runtimeBefore, `${expectedCode} must preserve runtime state.`);
  return preparation;
}

const build = buildAgentProposal();
const buildProject = makeProject({ data: build.dataset });
const expectedBuild = prepareWorkspaceGraphApply(build.proposal, { currentProject: buildProject, runtime: runtimeIdle() });
assert.equal(expectedBuild.ok, true, expectedBuild.diagnostics?.[0]?.code);
assert.equal(expectedBuild.preparation.datasetBoundCapabilities.browserExecution.status, 'available');

// A JSON round trip is the same source-neutral handoff and never mutates input.
const buildRoundTrip = JSON.parse(JSON.stringify(build.proposal));
const beforeBuild = clone(build.proposal);
assert.deepEqual(prepareWorkspaceGraphApply(buildRoundTrip, { currentProject: buildProject, runtime: runtimeIdle() }), expectedBuild);
assert.deepEqual(build.proposal, beforeBuild);

// The local Build Agent API chain and each producer family use the same Apply boundary.
const external = externalProposalFrom(build.proposal.graph);
const volk = volkProjectProposalFrom(build.proposal.graph, { name: 'Source name must not import', data: clone(exerciseDatasets.iris) });
for (const proposal of [build.proposal, external, volk]) {
  const current = makeProject({ data: clone(exerciseDatasets.wine) });
  const prepared = prepareWorkspaceGraphApply(JSON.parse(JSON.stringify(proposal)), { currentProject: current, runtime: runtimeFailed() });
  assert.equal(prepared.ok, true, `${proposal.source.producer}: ${prepared.diagnostics?.[0]?.code}`);
  const before = clone(current);
  const committed = commitWorkspaceGraphApply(prepared, { currentProject: current, runtime: runtimeFailed() });
  assert.equal(committed.ok, true, `${proposal.source.producer}: ${committed.diagnostics?.[0]?.code}`);
  assert.deepEqual(committed.project.data, before.data, 'Source datasets are never imported.');
  assert.equal(committed.project.name, before.name, 'Source project names are never imported.');
  assert.deepEqual(committed.project.language, before.language);
  assert.deepEqual(committed.project.workspace, before.workspace);
  assert.equal(committed.project.trainedModel, null);
  assert.equal(committed.runtime.status, 'idle');
  assert.deepEqual(committed.runtime.losses, []);
  assert.equal(committed.selectedNodeId, null);
  assert.equal(projectSignature(committed.project), projectSignature(prepared.preparation.nextProject));
  assert.deepEqual(validateProjectForWorkspace(JSON.parse(JSON.stringify(committed.project))).graph, committed.project.graph);
  assert.equal(committed.project.graph.nodes.every((node) => node.data.status === 'idle'), true);
  assert.equal(committed.project.graph.edges.every((edge) => edge.type === 'deletable'), true);
  assert.equal(committed.project.graph.nodes.length, proposal.graph.nodes.length);
  assert.equal(committed.project.graph.edges.length, proposal.graph.edges.length);
  assert.equal('proposal' in committed.project, false, 'Proposal lifecycle data never enters the project serializer.');
}

// Build Agent proposals require the currently bound dataset; freshness and selection remain distinct from occupancy.
expectAtomicFailure(build.proposal, makeProject({ data: null }), runtimeIdle(), 'GRAPH_APPLY_DATASET_REQUIRED');
const staleDataset = clone(build.dataset);
staleDataset.rows[0].quality += 0.25;
expectAtomicFailure(build.proposal, makeProject({ data: staleDataset }), runtimeIdle(), 'BUILD_DATASET_STALE');
const changedSelectionDataset = clone(build.dataset);
changedSelectionDataset.featureColumns = ['alcohol', 'acidity'];
expectAtomicFailure(build.proposal, makeProject({ data: changedSelectionDataset }), runtimeIdle(), 'BUILD_PROPOSAL_DATASET_SELECTION_INVALID');
const occupiedNode = createAgentNode({ nodes: [], manifest: componentById.get('relu_node'), request: { id: 'occupied-target', position: { x: 40, y: 40 } } });
expectAtomicFailure(build.proposal, makeProject({ graph: { nodes: [occupiedNode], edges: [] }, data: build.dataset }), runtimeIdle(), 'TARGET_WORKSPACE_NOT_EMPTY');
const lockedRuntime = { ...runtimeFailed(), status: 'running' };
expectAtomicFailure(build.proposal, buildProject, lockedRuntime, 'GRAPH_APPLY_WORKSPACE_BUSY');

// Recheck at commit catches races without replacing an occupied graph or applying against stale data.
const firstPreparation = prepareWorkspaceGraphApply(build.proposal, { currentProject: buildProject, runtime: runtimeIdle() });
assert.equal(firstPreparation.ok, true);
const occupiedDuringPreview = makeProject({ graph: { nodes: [occupiedNode], edges: [] }, data: build.dataset });
const occupiedCommit = commitWorkspaceGraphApply(firstPreparation, { currentProject: occupiedDuringPreview, runtime: runtimeIdle() });
assert.equal(occupiedCommit.ok, false);
assert.equal(occupiedCommit.diagnostics[0]?.code, 'TARGET_WORKSPACE_NOT_EMPTY');
assert.equal(occupiedDuringPreview.graph.nodes[0].id, occupiedNode.id);
const staleDuringPreview = makeProject({ data: staleDataset });
const staleCommit = commitWorkspaceGraphApply(firstPreparation, { currentProject: staleDuringPreview, runtime: runtimeIdle() });
assert.equal(staleCommit.ok, false);
assert.equal(staleCommit.diagnostics[0]?.code, 'BUILD_DATASET_STALE');

// Registry mismatches and malformed custom definitions fail before the project is touched.
const registryMismatch = clone(build.proposal);
registryMismatch.graph.nodes.find((node) => node.data.manifest.id === 'linear_regression_node').data.manifest.op = 'forged-operation';
expectAtomicFailure(registryMismatch, buildProject, runtimeIdle(), 'GRAPH_COMPONENT_REGISTRY_MISMATCH');

const dense = createAgentNode({ nodes: [], manifest: componentById.get('dense_node'), request: { id: 'composite-dense', position: { x: 20, y: 30 }, parameters: { units: 6 } } });
const relu = createAgentNode({ nodes: [dense], manifest: componentById.get('relu_node'), request: { id: 'composite-relu', position: { x: 240, y: 30 } } });
const compositeEdges = connectAgentNodes([dense, relu], [], { id: 'composite-edge', source: dense.id, sourceHandle: 'output', target: relu.id, targetHandle: 'input' });
const createdComposite = createCustomComposite({ selectedNodes: [dense, relu], edges: compositeEdges, name: 'Dense six then ReLU', color: '#3777aa' });
const catalogueTemplate = clone(createdComposite.manifest);
const expanded = expandComposite(createdComposite.instance);
const expandedDense = expanded.nodes.find((node) => node.data.manifest.id === 'dense_node');
expandedDense.data.parameters.units = 7;
const rebuilt = rebuildCompositeInstance({
  origin: {
    id: createdComposite.instance.id,
    label: createdComposite.instance.data.label,
    manifest: createdComposite.instance.data.manifest,
    parameters: createdComposite.instance.data.parameters,
    position: createdComposite.instance.position,
  },
  groupNodes: expanded.nodes,
  edges: expanded.edges,
});
assert.equal(catalogueTemplate.composition.nodes.find((node) => node.componentId === 'dense_node').parameters.units, 6);
assert.equal(rebuilt.manifest.composition.nodes.find((node) => node.componentId === 'dense_node').parameters.units, 7);
const rebuiltInstance = {
  id: createdComposite.instance.id,
  type: 'pipelineNode',
  position: rebuilt.position,
  data: { label: createdComposite.instance.data.label, manifest: rebuilt.manifest, parameters: rebuilt.parameters, status: 'success' },
};
const compositeProposal = volkProjectProposalFrom({ nodes: [rebuiltInstance], edges: [], componentDefinitions: [catalogueTemplate] }, { data: null, customComponents: [catalogueTemplate] });
const compositeCurrent = makeProject({ data: null });
const compositePrepared = prepareWorkspaceGraphApply(compositeProposal, { currentProject: compositeCurrent, runtime: runtimeIdle() });
assert.equal(compositePrepared.ok, true, compositePrepared.diagnostics?.[0]?.code);
const compositeCommitted = commitWorkspaceGraphApply(compositePrepared, { currentProject: compositeCurrent, runtime: runtimeIdle() });
assert.equal(compositeCommitted.ok, true, compositeCommitted.diagnostics?.[0]?.code);
const appliedInstance = compositeCommitted.project.graph.nodes[0];
assert.equal(appliedInstance.data.manifest.composition.nodes.find((node) => node.componentId === 'dense_node').parameters.units, 7);
assert.equal(compositeCommitted.project.customComponents[0].composition.nodes.find((node) => node.componentId === 'dense_node').parameters.units, 6);
assert.equal(validateProjectForWorkspace(compositeCommitted.project).graph.nodes[0].data.manifest.composition.nodes.find((node) => node.componentId === 'dense_node').parameters.units, 7);
const conflictingTemplate = clone(catalogueTemplate);
conflictingTemplate.composition.nodes.find((node) => node.componentId === 'dense_node').parameters.units = 5;
expectAtomicFailure(compositeProposal, makeProject({ data: null, customComponents: [conflictingTemplate] }), runtimeIdle(), 'GRAPH_APPLY_COMPONENT_DEFINITION_COLLISION');
const malformedCustom = clone(compositeProposal);
malformedCustom.graph.componentDefinitions[0].composition.nodes.find((node) => node.componentId === 'dense_node').parameters.units = 'seven';
expectAtomicFailure(malformedCustom, compositeCurrent, runtimeIdle(), 'VOLK_PROJECT_INVALID');

// Failed preparation preserves a previously trained model and runtime; success clears the runtime result.
const trainedModel = await executeBrowserGraph({ nodes: build.proposal.graph.nodes, edges: build.proposal.graph.edges, dataset: build.dataset });
const modelProject = makeProject({ graph: { nodes: build.proposal.graph.nodes, edges: build.proposal.graph.edges }, data: build.dataset, trainedModel });
const modelProjectBefore = clone(modelProject);
const runningBefore = { ...runtimeFailed(), status: 'running' };
const locked = prepareWorkspaceGraphApply(build.proposal, { currentProject: modelProject, runtime: runningBefore });
assert.equal(locked.ok, false);
assert.equal(locked.diagnostics[0]?.code, 'GRAPH_APPLY_WORKSPACE_BUSY');
assert.deepEqual(modelProject, modelProjectBefore);
assert.deepEqual(runningBefore.losses, [4, 2]);

const applyAfter = prepareWorkspaceGraphApply(build.proposal, { currentProject: buildProject, runtime: runtimeFailed() });
const applied = commitWorkspaceGraphApply(applyAfter, { currentProject: buildProject, runtime: runtimeFailed() });
assert.equal(applied.ok, true);
const graphNodes = applied.project.graph.nodes;
const graphEdges = applied.project.graph.edges;
const splitNode = graphNodes.find((node) => node.data.manifest.id === 'train_test_split_node');
assert.ok(splitNode, 'Applied ordinary graph is available to existing node operations.');
const movedAndEdited = updateAgentNode(graphNodes, splitNode.id, {
  position: { x: splitNode.position.x + 18, y: splitNode.position.y + 12 },
  parameters: { train_ratio: 0.75 },
});
assert.equal(movedAndEdited.find((node) => node.id === splitNode.id).data.parameters.train_ratio, 0.75);
assert.equal(movedAndEdited.find((node) => node.id === splitNode.id).position.x, splitNode.position.x + 18);
const extraSplit = createAgentNode({ nodes: movedAndEdited, manifest: componentById.get('train_test_split_node'), request: { id: 'connectivity-probe', position: { x: 350, y: 420 } } });
const expandedNodes = [...movedAndEdited, extraSplit];
const dataNode = expandedNodes.find((node) => node.data.manifest.id === 'tabular_data_node');
const connectedEdges = connectAgentNodes(expandedNodes, graphEdges, {
  id: 'connectivity-probe-edge',
  source: dataNode.id,
  sourceHandle: 'dataset',
  target: extraSplit.id,
  targetHandle: 'dataset',
});
assert.equal(connectedEdges.some((edge) => edge.id === 'connectivity-probe-edge'), true);
const deleted = removeAgentNode(expandedNodes, connectedEdges, extraSplit.id);
assert.equal(deleted.nodes.some((node) => node.id === extraSplit.id), false);
assert.equal(deleted.edges.some((edge) => edge.target === extraSplit.id), false);
assert.equal(validateProjectForWorkspace({ ...applied.project, graph: { nodes: deleted.nodes, edges: deleted.edges } }).graph.nodes.length, graphNodes.length);
assert.ok((await executeBrowserGraph({ nodes: deleted.nodes, edges: deleted.edges, dataset: build.dataset })).type, 'Applied graph remains runnable by the ordinary local runtime.');
assert.ok(compilePipelineToPyTorch(deleted.nodes, deleted.edges).code.length > 0, 'Applied graph remains exportable.');
const savedJson = JSON.stringify(applied.project);
assert.deepEqual(validateProjectForWorkspace(JSON.parse(savedJson)).graph, applied.project.graph, 'Applied graph remains saveable through the normal project serializer.');
assert.equal(CANVAS_AGENT_API_VERSION, 1, 'Graph Apply does not change the Canvas Agent contract version.');

console.log('Graph Apply checks passed: source-neutral Build Agent/external/VOLK flow, JSON round trips, read-only preparation, atomic stale/occupied/registry/custom-definition/runtime failures, B0.1 folded-instance preservation, and ordinary edit/connect/delete/run/export/save semantics.');
