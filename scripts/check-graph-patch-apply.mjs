import assert from 'node:assert/strict';
import { componentById, expandComposite } from '../src/core/components.js';
import { createAgentNode } from '../src/core/canvasAgent.js';
import { createCustomComposite, rebuildCompositeInstance } from '../src/core/customComposites.js';
import { exerciseDatasets } from '../src/core/buildAgent/exerciseFixtures.js';
import { PROJECT_VERSION, validateProjectForWorkspace } from '../src/core/project.js';
import {
  createGraphPatchProposal,
  GRAPH_PATCH_PROPOSAL_TYPE,
  validateGraphPatchProposal,
} from '../src/core/graph/graphPatchProposal.js';
import {
  commitWorkspaceGraphPatchApply,
  deriveGraphPatchDiff,
  prepareWorkspaceGraphPatchApply,
} from '../src/core/graph/workspacePatchApply.js';

const clone = (value) => structuredClone(value);
const source = { producer: 'external-agent', provenance: { artifactId: 'c2-pure-fixture', revision: '1', location: 'inline' } };
const runtimeIdle = () => ({ status: 'idle', activeNodeIds: [], losses: [], result: null, error: null, startedAt: null, finishedAt: null });

function makeProject({
  name = 'Occupied graph fixture',
  nodes,
  edges,
  customComponents = [],
  data = clone(exerciseDatasets.iris),
  trainedModel = null,
}) {
  return validateProjectForWorkspace({
    format: 'VOLK-ML',
    version: PROJECT_VERSION,
    name,
    savedAt: '2026-09-25T00:00:00.000Z',
    language: { primary: 'zh', secondary: 'en' },
    workspace: { libraryMode: 'compact', leftWidth: 333, rightWidth: 444, viewMode: 'canvas' },
    graph: { nodes, edges },
    customComponents,
    data,
    trainedModel,
  });
}

function agentNode(componentId, id, position, parameters) {
  return createAgentNode({
    nodes: [],
    manifest: componentById.get(componentId),
    request: { id, position, ...(parameters ? { parameters } : {}) },
  });
}

function baseGraphFor(project) {
  return { nodes: clone(project.graph.nodes), edges: clone(project.graph.edges), componentDefinitions: clone(project.customComponents) };
}

function createMixedPatch(project) {
  const baseGraph = baseGraphFor(project);
  const dense = baseGraph.nodes.find((node) => node.id === 'dense-a');
  const property = dense.data.manifest.properties.find((candidate) => ['number', 'slider'].includes(candidate.type));
  assert.ok(property, 'The fixture Dense node has a numeric parameter.');
  const before = dense.data.parameters[property.key] ?? property.default;
  const step = property.step ?? 1;
  let after = before + step;
  if (Number.isFinite(property.max) && after > property.max) after = before - step;
  const addedNode = createAgentNode({
    nodes: baseGraph.nodes,
    manifest: componentById.get('relu_node'),
    request: { id: 'relu-added', position: { x: 780, y: 400 } },
  });
  const created = createGraphPatchProposal({
    baseGraph,
    operations: [
      { op: 'MOVE_NODE', nodeId: 'dense-a', position: { x: dense.position.x + 30, y: dense.position.y + 12 } },
      { op: 'UPDATE_PARAMETERS', nodeId: 'dense-a', parameters: { ...dense.data.parameters, [property.key]: after } },
      { op: 'DISCONNECT', edgeId: 'edge-old' },
      { op: 'CONNECT', edge: { id: 'edge-new', source: 'dense-a', sourceHandle: 'output', target: 'relu-a', targetHandle: 'input', type: 'deletable' } },
      { op: 'DISCONNECT', edgeId: 'edge-swap' },
      { op: 'CONNECT', edge: { id: 'edge-swap', source: 'swap-b', sourceHandle: 'output', target: 'swap-a', targetHandle: 'input', type: 'deletable' } },
      { op: 'ADD_NODE', node: addedNode, componentDefinitions: [] },
      { op: 'REMOVE_NODE', nodeId: 'relu-remove' },
    ],
    source,
    rationale: 'Review all patch changes against the occupied canonical graph before acceptance.',
  });
  assert.equal(created.ok, true, created.diagnostics?.[0]?.code);
  return { proposal: created.proposal, parameter: property.key, before, after };
}

function fixtureProject() {
  const nodes = [
    agentNode('dense_node', 'dense-a', { x: 10, y: 20 }, { units: 8 }),
    agentNode('relu_node', 'relu-a', { x: 230, y: 20 }),
    agentNode('relu_node', 'relu-remove', { x: 480, y: 20 }),
    agentNode('relu_node', 'swap-a', { x: 10, y: 220 }),
    agentNode('relu_node', 'swap-b', { x: 230, y: 220 }),
    agentNode('relu_node', 'keep-a', { x: 480, y: 220 }),
    agentNode('relu_node', 'keep-b', { x: 700, y: 220 }),
  ].map((node) => ({ ...node, data: { ...node.data, status: 'success' } }));
  const edges = [
    { id: 'edge-old', source: 'dense-a', sourceHandle: 'output', target: 'relu-a', targetHandle: 'input', type: 'deletable' },
    { id: 'edge-swap', source: 'swap-a', sourceHandle: 'output', target: 'swap-b', targetHandle: 'input', type: 'deletable' },
    { id: 'edge-keep', source: 'keep-a', sourceHandle: 'output', target: 'keep-b', targetHandle: 'input', type: 'deletable' },
  ];
  return makeProject({ nodes, edges });
}

function code(result) {
  return result.diagnostics?.[0]?.code;
}

const project = fixtureProject();
const { proposal, parameter, before, after } = createMixedPatch(project);
assert.equal(proposal.type, GRAPH_PATCH_PROPOSAL_TYPE);
const proposalBefore = JSON.stringify(proposal);
const projectBefore = JSON.stringify(project);
const runtime = { ...runtimeIdle(), status: 'completed', result: { runId: 'kept-before-apply' }, finishedAt: 'finished' };
const prepared = prepareWorkspaceGraphPatchApply(proposal, { currentProject: project, runtime });
assert.equal(prepared.ok, true, code(prepared));
assert.equal(JSON.stringify(project), projectBefore, 'Preparation leaves the occupied canonical project byte-for-byte unchanged.');
assert.equal(JSON.stringify(proposal), proposalBefore, 'Preparation leaves the detached proposal unchanged.');
assert.equal(prepared.preparation.semanticChanged, true);
assert.equal(prepared.preparation.nextProject.name, project.name);
assert.deepEqual(prepared.preparation.nextProject.data, project.data);
assert.deepEqual(prepared.preparation.nextProject.language, project.language);
assert.deepEqual(prepared.preparation.nextProject.workspace, project.workspace);
assert.equal(prepared.preparation.nextProject.trainedModel, null);
assert.deepEqual(prepared.preparation.runtime, runtimeIdle());
assert.ok(prepared.preparation.nextProject.graph.nodes.every((node) => node.data.status === 'idle'));

const diff = prepared.preparation.diff;
assert.deepEqual(diff.nodes.existing.map((item) => item.id), ['keep-a', 'keep-b', 'relu-a', 'swap-a', 'swap-b']);
assert.deepEqual(diff.nodes.removed.map((item) => item.id), ['relu-remove']);
assert.deepEqual(diff.nodes.added.map((item) => item.id), ['relu-added']);
assert.deepEqual(diff.nodes.changed.map((item) => item.id), ['dense-a']);
assert.equal(diff.nodes.changed[0].parameterChanges[0].key, parameter);
assert.equal(diff.nodes.changed[0].parameterChanges[0].before, before);
assert.equal(diff.nodes.changed[0].parameterChanges[0].after, after);
assert.equal(diff.nodes.changed[0].moved, true);
assert.deepEqual(diff.edges.existing.map((item) => item.id), ['edge-keep']);
assert.deepEqual(diff.edges.removed.map((item) => item.id), ['edge-old']);
assert.deepEqual(diff.edges.added.map((item) => item.id), ['edge-new']);
assert.deepEqual(diff.edges.changed.map((item) => item.id), ['edge-swap']);
assert.deepEqual(diff.operations.map((item) => item.op), proposal.operations.map((item) => item.op));
assert.deepEqual(deriveGraphPatchDiff(proposal.baseGraph, validateGraphPatchProposal(proposal).resultGraph, proposal.operations), diff);

const committed = commitWorkspaceGraphPatchApply(prepared, { currentProject: project, runtime });
assert.equal(committed.ok, true, code(committed));
assert.equal(committed.project.graph.nodes.some((node) => node.id === 'relu-added'), true);
assert.equal(committed.project.graph.nodes.some((node) => node.id === 'relu-remove'), false);
assert.equal(committed.project.graph.nodes.find((node) => node.id === 'dense-a').data.parameters[parameter], after);
assert.equal(committed.project.graph.nodes.find((node) => node.id === 'dense-a').position.x, 40);
assert.equal(committed.project.trainedModel, null);
assert.deepEqual(committed.runtime, runtimeIdle());
assert.equal(committed.selectedNodeId, null);
assert.equal(JSON.stringify(project), projectBefore, 'Commit returns a detached canonical project instead of mutating the input.');
const duplicate = commitWorkspaceGraphPatchApply(prepared, { currentProject: committed.project, runtime: committed.runtime });
assert.equal(duplicate.ok, false, 'A duplicate Apply cannot replay onto the already changed graph.');
assert.equal(code(duplicate), 'GRAPH_PATCH_BASE_STALE');

for (const mutate of [
  (next) => { next.graph.nodes.find((node) => node.id === 'dense-a').position.x += 1; },
  (next) => { next.graph.nodes.find((node) => node.id === 'dense-a').data.parameters.units = 10; },
  (next) => { next.graph.edges.find((edge) => edge.id === 'edge-old').id = 'edge-renamed'; },
]) {
  const stale = clone(project);
  mutate(stale);
  const failed = prepareWorkspaceGraphPatchApply(proposal, { currentProject: stale, runtime });
  assert.equal(failed.ok, false);
  assert.equal(code(failed), 'GRAPH_PATCH_BASE_STALE');
}

const tampered = clone(proposal);
tampered.rationale += ' tampered';
const invalidBefore = JSON.stringify(project);
const invalid = prepareWorkspaceGraphPatchApply(tampered, { currentProject: project, runtime });
assert.equal(invalid.ok, false);
assert.equal(code(invalid), 'GRAPH_PATCH_IDENTITY_MISMATCH');
assert.equal(JSON.stringify(project), invalidBefore, 'Invalid proposals cannot mutate current project state.');

const unsupported = createGraphPatchProposal({
  baseGraph: baseGraphFor(project),
  operations: [{ op: 'REPLACE_SUBGRAPH', nodes: [], edges: [] }],
  source,
  rationale: 'Unsupported operations must be rejected before staging.',
});
assert.equal(unsupported.ok, false);
assert.equal(unsupported.diagnostics[0].code, 'GRAPH_PATCH_OPERATION_UNSUPPORTED');

const busyRuntime = { ...runtime, status: 'running' };
const busy = prepareWorkspaceGraphPatchApply(proposal, { currentProject: project, runtime: busyRuntime });
assert.equal(busy.ok, false);
assert.equal(code(busy), 'GRAPH_PATCH_APPLY_WORKSPACE_BUSY');
assert.equal(JSON.stringify(project), projectBefore);

const invalidProject = clone(project);
invalidProject.customComponents = [{ id: 'invalid-definition' }];
const invalidCurrent = prepareWorkspaceGraphPatchApply(proposal, { currentProject: invalidProject, runtime: runtimeIdle() });
assert.equal(invalidCurrent.ok, false);
assert.equal(code(invalidCurrent), 'GRAPH_PATCH_APPLY_PROJECT_INVALID');

for (const changedCurrent of [
  { ...clone(project), name: 'Unrelated name change' },
  { ...clone(project), data: { ...clone(project.data), rows: project.data.rows.map((row, index) => index === 0 ? { ...row, sepal_length: row.sepal_length + 0.01 } : row) } },
]) {
  const changedCurrentJson = JSON.stringify(changedCurrent);
  const initiallyPrepared = prepareWorkspaceGraphPatchApply(proposal, { currentProject: project, runtime: runtimeIdle() });
  const changedCommit = commitWorkspaceGraphPatchApply(initiallyPrepared, { currentProject: changedCurrent, runtime: runtimeIdle() });
  assert.equal(changedCommit.ok, false);
  assert.equal(code(changedCommit), 'GRAPH_PATCH_APPLY_WORKSPACE_CHANGED');
  assert.equal(JSON.stringify(changedCurrent), changedCurrentJson, 'Commit does not mutate concurrent learner changes.');
}
const runtimeChangedPrepared = prepareWorkspaceGraphPatchApply(proposal, { currentProject: project, runtime: runtimeIdle() });
const runtimeChanged = commitWorkspaceGraphPatchApply(runtimeChangedPrepared, { currentProject: project, runtime: { ...runtimeIdle(), status: 'failed' } });
assert.equal(runtimeChanged.ok, false);
assert.equal(code(runtimeChanged), 'GRAPH_PATCH_APPLY_WORKSPACE_CHANGED');

const denseManifest = componentById.get('dense_node');
componentById.set('dense_node', { ...denseManifest, op: 'dense_registry_drift' });
try {
  const drifted = prepareWorkspaceGraphPatchApply(proposal, { currentProject: project, runtime: runtimeIdle() });
  assert.equal(drifted.ok, false, 'Apply revalidates against the live component registry.');
  assert.match(code(drifted), /GRAPH_(PATCH|COMPONENT|PROJECT)/);
} finally {
  componentById.set('dense_node', denseManifest);
}

const iris = clone(exerciseDatasets.iris);
const knn = agentNode('knn_node', 'trained-knn', { x: 90, y: 100 });
const featureColumns = iris.featureColumns;
const train = iris.rows.slice(0, 12).map((row) => ({ x: featureColumns.map((column) => row[column]), y: row[iris.targetColumn] }));
const trainedModel = {
  type: 'knn_classifier',
  sourceNodeId: knn.id,
  featureColumns: clone(featureColumns),
  targetColumn: iris.targetColumn,
  hasPredictor: false,
  lossHistory: [],
  metrics: { accuracy: 0.9 },
  trainedAt: '2026-09-25T01:00:00.000Z',
  trainRows: train.length,
  testRows: 0,
  train,
  k: knn.data.parameters.k_value,
  normalization: { means: [0, 0, 0, 0], stds: [1, 1, 1, 1] },
};
const modelProject = makeProject({ nodes: [knn], edges: [], data: iris, trainedModel });
const runtimeWithResult = { ...runtimeIdle(), status: 'completed', result: { type: 'knn', accuracy: 0.9 }, finishedAt: 'done' };
const layoutProposal = createGraphPatchProposal({
  baseGraph: baseGraphFor(modelProject),
  operations: [{ op: 'MOVE_NODE', nodeId: knn.id, position: { x: 120, y: 140 } }],
  source,
  rationale: 'Move the node without changing graph meaning or learned results.',
});
assert.equal(layoutProposal.ok, true, layoutProposal.diagnostics?.[0]?.code);
const layoutPrepared = prepareWorkspaceGraphPatchApply(layoutProposal.proposal, { currentProject: modelProject, runtime: runtimeWithResult });
assert.equal(layoutPrepared.ok, true, code(layoutPrepared));
assert.equal(layoutPrepared.preparation.semanticChanged, false);
assert.deepEqual(layoutPrepared.preparation.nextProject.trainedModel, trainedModel);
assert.deepEqual(layoutPrepared.preparation.runtime, runtimeWithResult);
assert.equal(layoutPrepared.preparation.nextProject.graph.nodes[0].data.status, knn.data.status ?? 'idle');
const layoutCommitted = commitWorkspaceGraphPatchApply(layoutPrepared, { currentProject: modelProject, runtime: runtimeWithResult });
assert.equal(layoutCommitted.ok, true, code(layoutCommitted));
assert.deepEqual(layoutCommitted.project.trainedModel, trainedModel);
assert.deepEqual(layoutCommitted.runtime, runtimeWithResult);

const semanticProposal = createGraphPatchProposal({
  baseGraph: baseGraphFor(modelProject),
  operations: [{ op: 'UPDATE_PARAMETERS', nodeId: knn.id, parameters: { ...knn.data.parameters, k_value: knn.data.parameters.k_value + 2 } }],
  source,
  rationale: 'Change a model parameter and invalidate results trained under the old graph.',
});
assert.equal(semanticProposal.ok, true, semanticProposal.diagnostics?.[0]?.code);
const semanticPrepared = prepareWorkspaceGraphPatchApply(semanticProposal.proposal, { currentProject: modelProject, runtime: runtimeWithResult });
assert.equal(semanticPrepared.ok, true, code(semanticPrepared));
assert.equal(semanticPrepared.preparation.semanticChanged, true);
assert.equal(semanticPrepared.preparation.nextProject.trainedModel, null);
assert.deepEqual(semanticPrepared.preparation.runtime, runtimeIdle());

const dense = agentNode('dense_node', 'composite-dense', { x: 20, y: 30 }, { units: 6 });
const relu = agentNode('relu_node', 'composite-relu', { x: 240, y: 30 });
const composite = createCustomComposite({
  selectedNodes: [dense, relu],
  edges: [{ id: 'composite-edge', source: dense.id, sourceHandle: 'output', target: relu.id, targetHandle: 'input', type: 'deletable' }],
  name: 'Dense six then ReLU',
  color: '#3777aa',
});
const catalogueTemplate = clone(composite.manifest);
const expanded = expandComposite(composite.instance);
expanded.nodes.find((node) => node.data.manifest.id === 'dense_node').data.parameters.units = 7;
const rebuilt = rebuildCompositeInstance({
  origin: {
    id: composite.instance.id,
    label: composite.instance.data.label,
    manifest: composite.instance.data.manifest,
    parameters: composite.instance.data.parameters,
    position: composite.instance.position,
  },
  groupNodes: expanded.nodes,
  edges: expanded.edges,
});
const compositeInstance = {
  id: composite.instance.id,
  type: 'pipelineNode',
  position: rebuilt.position,
  data: { label: composite.instance.data.label, manifest: rebuilt.manifest, parameters: rebuilt.parameters, status: 'success' },
};
const compositeProject = makeProject({ nodes: [compositeInstance], edges: [], customComponents: [catalogueTemplate], data: null });
const secondInstance = clone(compositeInstance);
secondInstance.id = 'composite-second-instance';
secondInstance.position = { x: 400, y: 80 };
const compositePatch = createGraphPatchProposal({
  baseGraph: baseGraphFor(compositeProject),
  operations: [{ op: 'ADD_NODE', node: secondInstance, componentDefinitions: [] }],
  source,
  rationale: 'Reuse the existing catalogue template while preserving folded instance parameters.',
});
assert.equal(compositePatch.ok, true, compositePatch.diagnostics?.[0]?.code);
const compositePrepared = prepareWorkspaceGraphPatchApply(compositePatch.proposal, { currentProject: compositeProject, runtime: runtimeIdle() });
assert.equal(compositePrepared.ok, true, JSON.stringify(compositePrepared));
assert.equal(compositePrepared.preparation.nextProject.graph.nodes.length, 2);
assert.equal(compositePrepared.preparation.nextProject.customComponents.length, 1);
assert.equal(compositePrepared.preparation.nextProject.customComponents[0].composition.nodes.find((node) => node.componentId === 'dense_node').parameters.units, 6);
assert.ok(compositePrepared.preparation.nextProject.graph.nodes.every((node) => node.data.manifest.composition.nodes.find((child) => child.componentId === 'dense_node').parameters.units === 7));
assert.equal(validateProjectForWorkspace(compositePrepared.preparation.nextProject).graph.nodes.length, 2);

console.log('Graph Patch Apply checks passed: occupied canonical graph, all operation-derived diff classes, detached preparation/commit, stale project and runtime guards, live registry revalidation, custom composite template/instance preservation, and layout-only model/runtime preservation.');
