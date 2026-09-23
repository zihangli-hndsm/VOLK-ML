import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { componentById } from '../src/core/components.js';
import { createAgentNode, connectAgentNodes } from '../src/core/canvasAgent.js';
import { createCustomComposite } from '../src/core/customComposites.js';
import {
  createBuildDatasetContext,
  planBuildGoal,
  createGraphProposal,
} from '../src/core/buildAgent/index.js';
import { exerciseDatasets } from '../src/core/buildAgent/exerciseFixtures.js';
import { PROJECT_VERSION } from '../src/core/project.js';
import {
  adaptBuildAgentGraphProposal,
  assessWorkspaceGraphProposal,
  createVolkProjectGraphProposal,
  createWorkspaceGraphProposalFromCandidate,
  graphIdentityV1,
  graphPresentationFingerprintV1,
  graphSemanticFingerprintV1,
  validateWorkspaceGraphProposal,
} from '../src/core/graph/index.js';

function clone(value) {
  return structuredClone(value);
}

function expectDiagnostic(result, code) {
  assert.equal(result.ok, false, `Expected structured failure ${code}.`);
  assert.equal(result.diagnostics[0]?.code, code, `Expected ${code}, got ${result.diagnostics[0]?.code}.`);
}

function bareProject(nodes, edges = [], customComponents = []) {
  return {
    format: 'VOLK-ML',
    version: PROJECT_VERSION,
    name: 'Graph Interop Fixture',
    customComponents,
    graph: { nodes, edges },
    data: null,
    trainedModel: null,
  };
}

function makeRelus() {
  let nodes = [];
  nodes = [...nodes, createAgentNode({
    nodes,
    manifest: componentById.get('relu_node'),
    request: { id: 'relu-a', position: { x: 10, y: 20 } },
  })];
  nodes = [...nodes, createAgentNode({
    nodes,
    manifest: componentById.get('relu_node'),
    request: { id: 'relu-b', position: { x: 180, y: 20 } },
  })];
  const edge = { id: 'relu-a-b', source: 'relu-a', sourceHandle: 'output', target: 'relu-b', targetHandle: 'input', type: 'deletable' };
  return { nodes, edge };
}

const dataset = exerciseDatasets.mlpClassification;
const context = createBuildDatasetContext(dataset);
const planResult = planBuildGoal({
  version: 1,
  goalId: 'graph-interop-mlp',
  task: 'classification',
  modelFamily: 'mlp',
  architecture: 'explicit-mlp',
  dataset: null,
  executionExpectation: 'browser-local',
  parameters: { hiddenUnits: 6 },
}, context);
assert.equal(planResult.kind, 'plan');
const buildProposal = createGraphProposal({ plan: planResult.plan, dataset, datasetContext: context });

const originalIdentity = graphIdentityV1(buildProposal.graph);
const reordered = clone(buildProposal.graph);
reordered.nodes.reverse();
reordered.edges.reverse();
assert.deepEqual(graphIdentityV1(reordered), originalIdentity, 'Node/edge order and object key order must not change identity.');

const presentationMutation = clone(buildProposal.graph);
const presentationNode = presentationMutation.nodes.find((node) => node.id === 'build-relu');
presentationNode.data.label = { en: 'Different label', zh: '不同标签' };
presentationNode.data.status = 'running';
assert.equal(graphSemanticFingerprintV1(presentationMutation), originalIdentity.semanticFingerprint);
assert.equal(graphPresentationFingerprintV1(presentationMutation), originalIdentity.presentationFingerprint);

const moved = clone(buildProposal.graph);
moved.nodes.find((node) => node.id === 'build-relu').position.x += 8;
assert.equal(graphSemanticFingerprintV1(moved), originalIdentity.semanticFingerprint, 'Layout edits must not change semantic identity.');
assert.notEqual(graphPresentationFingerprintV1(moved), originalIdentity.presentationFingerprint, 'Layout edits must change presentation identity.');

const semanticMutations = [
  (graph) => { graph.nodes.find((node) => node.id === 'build-hidden').data.parameters.units += 1; },
  (graph) => { graph.nodes.find((node) => node.id === 'build-relu').data.manifest.op = 'sigmoid'; },
  (graph) => { graph.nodes.find((node) => node.id === 'build-hidden').data.manifest.runtime.browserBackend = 'webgpu'; },
  (graph) => { graph.nodes.find((node) => node.id === 'build-hidden').data.manifest.properties.find((property) => property.key === 'units').min += 1; },
  (graph) => { graph.nodes.find((node) => node.id === 'build-relu').data.manifest.inputs[0].type = 'Metrics'; },
  (graph) => { graph.edges.find((edge) => edge.id === 'build-edge-hidden-relu').target = 'build-head'; },
];
for (const mutate of semanticMutations) {
  const changed = clone(buildProposal.graph);
  mutate(changed);
  assert.notEqual(graphSemanticFingerprintV1(changed), originalIdentity.semanticFingerprint, 'Semantic edits must change the semantic fingerprint.');
}

const adaptedResult = adaptBuildAgentGraphProposal(buildProposal);
assert.equal(adaptedResult.ok, true, adaptedResult.diagnostics?.[0]?.code);
const adapted = adaptedResult.proposal;
assert.equal(adapted.source.kind, 'planner');
assert.equal(adapted.source.version, 1);
assert.equal(adapted.source.producer, 'build-agent');
assert.equal(adapted.source.format, 'volk-model-design-plan-v1');
assert.equal(adapted.source.sourceProposalId, buildProposal.proposalId);
assert.equal(adapted.source.planId, buildProposal.planId);
assert.equal(adapted.source.datasetBinding.fingerprint, buildProposal.datasetFingerprint);
assert.deepEqual(adapted.graph.nodes.map((node) => node.id), buildProposal.graph.nodes.map((node) => node.id));
assert.deepEqual(adapted.graph.edges, buildProposal.graph.edges);
assert.equal(adapted.conversion.fidelity, 'exact');
assert.equal(adapted.conversion.omitted.length, 0);
for (const lossField of ['approximated', 'missing', 'unsupported', 'warnings']) {
  assert.deepEqual(adapted.conversion[lossField], [], `Exact Build Agent conversion must have no ${lossField}.`);
}
assert.deepEqual(adapted.source.rationale, planResult.plan.rationale);
assert.deepEqual(adapted.source.limitations, planResult.plan.limitations);
assert.equal(adapted.assessment.status, 'eligible');
assert.ok(adapted.capabilitySnapshot.components.length > 0);
assert.ok(['supported', 'unsupported'].includes(adapted.capabilitySnapshot.compilers.pytorch.status));
assert.equal(validateWorkspaceGraphProposal(adapted).valid, true);
assert.equal(validateWorkspaceGraphProposal(JSON.parse(JSON.stringify(adapted))).valid, true, 'Build Agent proposal must round-trip as JSON.');

const futureGraph = clone(buildProposal.graph);
delete futureGraph.blueprintId;
futureGraph.componentDefinitions = [];
const futureGraphBefore = JSON.stringify(futureGraph);
const futureConversion = clone(adapted.conversion);
const futureSourceShapes = [
  { version: 1, kind: 'planner', producer: 'external-agent', format: 'volk-graph-candidate-v1', provenance: { artifactId: 'external-plan', revision: 'request-rev-3', location: 'inline' } },
  { version: 1, kind: 'import', producer: 'torch-export-adapter', format: 'torch.export', provenance: { artifactId: 'torch-export-candidate', location: 'local-file' } },
  { version: 1, kind: 'import', producer: 'torch-fx-adapter', format: 'torch.fx', provenance: { artifactId: 'torch-fx-candidate', references: ['request-01'], location: 'inline' } },
  { version: 1, kind: 'import', producer: 'onnx-adapter', format: 'ONNX', provenance: { artifactId: 'onnx-candidate', revision: 'opset-1' } },
  { version: 1, kind: 'import', producer: 'tensorflow-adapter', format: 'TensorFlow', provenance: { artifactId: 'tensorflow-candidate', revision: 'graph-rev-2' } },
  { version: 1, kind: 'import', producer: 'keras-adapter', format: 'Keras', provenance: { artifactId: 'keras-candidate', fingerprint: 'artifact-hash-02' } },
  { version: 1, kind: 'import', producer: 'human-import', format: 'Keras', provenance: { artifactId: 'human-candidate', location: 'local-file' } },
  { version: 1, kind: 'import', producer: 'external-agent', format: 'torch.fx', provenance: { artifactId: 'external-candidate', references: ['request-02'], location: 'inline' } },
  { version: 1, kind: 'import', producer: 'unknown-import', format: 'unknown-import', provenance: { artifactId: 'unclassified-candidate', location: 'unknown' } },
];
for (const source of futureSourceShapes) {
  const candidateResult = createWorkspaceGraphProposalFromCandidate({
    graph: futureGraph,
    source,
    conversion: futureConversion,
  });
  assert.equal(candidateResult.ok, true, `Future source ${source.kind}/${source.format} should use the generic candidate boundary: ${candidateResult.diagnostics?.[0]?.code}`);
  assert.equal(graphSemanticFingerprintV1(candidateResult.proposal.graph), graphSemanticFingerprintV1(futureGraph), 'Generic source metadata must not change graph semantics.');
  assert.notEqual(candidateResult.proposal.graph, futureGraph, 'Generic proposals must detach the candidate graph.');
  assert.equal(validateWorkspaceGraphProposal(JSON.parse(JSON.stringify(candidateResult.proposal))).valid, true, 'Future-source candidate must round-trip as JSON.');
}
assert.equal(JSON.stringify(futureGraph), futureGraphBefore, 'Generic proposal creation must not mutate its candidate graph.');
const genericCandidate = (graph = futureGraph, source = futureSourceShapes[0], conversion = futureConversion) => (
  createWorkspaceGraphProposalFromCandidate({ graph, source, conversion })
);
expectDiagnostic(genericCandidate(futureGraph, { ...futureSourceShapes[0], kind: 'provider-x' }), 'GRAPH_PROVENANCE_INVALID');
expectDiagnostic(genericCandidate(futureGraph, { ...futureSourceShapes[0], producer: 'provider-x' }), 'GRAPH_PROVENANCE_INVALID');
expectDiagnostic(genericCandidate(futureGraph, { ...futureSourceShapes[0], format: 'provider-format' }), 'GRAPH_PROVENANCE_INVALID');
expectDiagnostic(genericCandidate(futureGraph, { ...futureSourceShapes[0], provenance: { ...futureSourceShapes[0].provenance, secret: 'not-allowed' } }), 'GRAPH_PROPOSAL_INVALID');
expectDiagnostic(genericCandidate(futureGraph, { ...futureSourceShapes[0], provenance: { artifactId: 'a'.repeat(161) } }), 'GRAPH_PROPOSAL_INVALID');
expectDiagnostic(genericCandidate(futureGraph, { ...futureSourceShapes[0], provenance: { references: Array.from({ length: 17 }, (_, index) => `ref-${index}`) } }), 'GRAPH_PROPOSAL_INVALID');
expectDiagnostic(genericCandidate(futureGraph, futureSourceShapes[0], { ...futureConversion, missing: ['graph.edge'], omitted: [] }), 'GRAPH_CONVERSION_INVALID');
expectDiagnostic(genericCandidate(futureGraph, futureSourceShapes[0], { ...futureConversion, approximated: ['bad key'] }), 'GRAPH_CONVERSION_INVALID');
expectDiagnostic(genericCandidate(futureGraph, futureSourceShapes[0], { ...futureConversion, version: 9 }), 'GRAPH_CONVERSION_VERSION_UNSUPPORTED');
expectDiagnostic(genericCandidate(futureGraph, futureSourceShapes[0], { ...futureConversion, fidelity: 'lossless-ish' }), 'GRAPH_CONVERSION_INVALID');
for (const listField of ['exactFor', 'preserved', 'approximated', 'missing', 'omitted', 'unsupported', 'warnings']) {
  expectDiagnostic(genericCandidate(futureGraph, futureSourceShapes[0], {
    ...futureConversion,
    [listField]: Array.from({ length: 33 }, (_, index) => `bounded-${index}`),
  }), 'GRAPH_PROPOSAL_INVALID');
}

const tamperedBuild = clone(buildProposal);
tamperedBuild.graph.nodes.find((node) => node.id === 'build-hidden').data.parameters.units += 1;
expectDiagnostic(adaptBuildAgentGraphProposal(tamperedBuild), 'BUILD_PROPOSAL_GRAPH_MISMATCH');

const projectUrl = new URL('../examples/linear-trend-concept.volkml.json', import.meta.url);
const project = JSON.parse(readFileSync(projectUrl, 'utf8'));
project.name = 'private-project-name-sentinel';
project.trainedModel = null;
project.data = {
  name: 'private-dataset-name-sentinel',
  task: 'regression',
  featureColumns: ['x'],
  targetColumn: 'y',
  rows: [{ x: 1, y: 2, privateNote: 'private-row-sentinel' }, { x: 2, y: 4 }, { x: 3, y: 6 }],
};
const projectBefore = JSON.stringify(project);
const projectResult = createVolkProjectGraphProposal(project);
assert.equal(projectResult.ok, true, projectResult.diagnostics?.[0]?.code);
const projectProposal = projectResult.proposal;
assert.equal(JSON.stringify(project), projectBefore, 'Project proposal creation must not mutate its source project.');
assert.equal(projectProposal.source.kind, 'import');
assert.equal(projectProposal.source.version, 1);
assert.equal(projectProposal.source.producer, 'volk-project');
assert.equal(projectProposal.source.format, 'volk-project');
assert.equal(projectProposal.conversion.fidelity, 'partial');
assert.ok(projectProposal.conversion.exactFor.includes('graph-semantics'));
assert.ok(projectProposal.conversion.omitted.includes('project.dataset'));
assert.deepEqual(projectProposal.conversion.missing, projectProposal.conversion.omitted, 'Legacy omitted is a documented alias of missing.');
for (const missingLayer of ['project.dataset', 'project.trainedModel', 'project.language', 'project.workspace']) {
  assert.ok(projectProposal.conversion.missing.includes(missingLayer), `Partial project conversion must name missing layer ${missingLayer}.`);
}
const serializedProjectProposal = JSON.stringify(projectProposal);
for (const sentinel of ['private-project-name-sentinel', 'private-dataset-name-sentinel', 'private-row-sentinel']) {
  assert.equal(serializedProjectProposal.includes(sentinel), false, `Proposal must omit ${sentinel}.`);
}
assert.equal(validateWorkspaceGraphProposal(JSON.parse(serializedProjectProposal)).valid, true);
assert.equal(validateWorkspaceGraphProposal(JSON.parse(JSON.stringify(projectProposal))).valid, true, 'VOLK project proposal must round-trip as JSON.');
expectDiagnostic(genericCandidate(futureGraph, projectProposal.source), 'GRAPH_PROVENANCE_INVALID');
expectDiagnostic(genericCandidate(futureGraph, adapted.source), 'GRAPH_PROVENANCE_INVALID');

const emptyAssessment = assessWorkspaceGraphProposal(projectProposal, { nodes: [], edges: [] });
assert.equal(emptyAssessment.valid, true);
assert.equal(emptyAssessment.assessment.status, 'eligible');
const occupiedTarget = { nodes: [{ id: 'existing' }], edges: [] };
const targetBefore = JSON.stringify(occupiedTarget);
const occupiedAssessment = assessWorkspaceGraphProposal(projectProposal, occupiedTarget);
assert.equal(occupiedAssessment.assessment.status, 'blocked');
assert.deepEqual(occupiedAssessment.assessment.reasons, ['TARGET_WORKSPACE_NOT_EMPTY']);
assert.equal(JSON.stringify(occupiedTarget), targetBefore, 'Workspace assessment must be pure.');
assert.equal(JSON.stringify(projectProposal), serializedProjectProposal, 'Workspace assessment must not alter proposal identity or evidence.');

const proposalWithStatusChange = clone(projectProposal);
if (proposalWithStatusChange.graph.nodes.length) proposalWithStatusChange.graph.nodes[0].data.status = 'succeeded';
assert.equal(validateWorkspaceGraphProposal(proposalWithStatusChange).valid, true, 'Runtime status is presentation state, not graph truth.');
const proposalWithLayoutChange = clone(projectProposal);
proposalWithLayoutChange.graph.nodes[0].position.x += 4;
assert.equal(validateWorkspaceGraphProposal(proposalWithLayoutChange).diagnostics[0].code, 'GRAPH_IDENTITY_MISMATCH');
const proposalWithSemanticChange = clone(projectProposal);
proposalWithSemanticChange.graph.nodes[0].data.parameters = { ...proposalWithSemanticChange.graph.nodes[0].data.parameters, extra: true };
assert.equal(validateWorkspaceGraphProposal(proposalWithSemanticChange).valid, false);
const proposalWithSecret = clone(projectProposal);
proposalWithSecret.source.secret = 'should-not-be-accepted';
assert.equal(validateWorkspaceGraphProposal(proposalWithSecret).valid, false);

const unknownFixture = makeRelus();
unknownFixture.nodes[0].data.manifest = clone(unknownFixture.nodes[0].data.manifest);
unknownFixture.nodes[0].data.manifest.id = 'missing_component';
expectDiagnostic(createVolkProjectGraphProposal(bareProject(unknownFixture.nodes)), 'GRAPH_COMPONENT_UNKNOWN');
expectDiagnostic(genericCandidate({ nodes: unknownFixture.nodes, edges: [], componentDefinitions: [] }), 'GRAPH_COMPONENT_UNKNOWN');

const invalidPropertyNode = createAgentNode({
  nodes: [], manifest: componentById.get('dense_node'), request: { id: 'invalid-dense', position: { x: 0, y: 0 } },
});
invalidPropertyNode.data.parameters.units = 0;
expectDiagnostic(createVolkProjectGraphProposal(bareProject([invalidPropertyNode])), 'GRAPH_PROPERTY_INVALID');
expectDiagnostic(genericCandidate({ nodes: [invalidPropertyNode], edges: [], componentDefinitions: [] }), 'GRAPH_PROPERTY_INVALID');

const invalidPortFixture = makeRelus();
expectDiagnostic(createVolkProjectGraphProposal(bareProject(invalidPortFixture.nodes, [
  { ...invalidPortFixture.edge, sourceHandle: 'missing-port' },
])), 'GRAPH_PORT_INVALID');
expectDiagnostic(genericCandidate({
  nodes: invalidPortFixture.nodes,
  edges: [{ ...invalidPortFixture.edge, sourceHandle: 'missing-port' }],
  componentDefinitions: [],
}), 'GRAPH_PORT_INVALID');

const cycleFixture = makeRelus();
expectDiagnostic(createVolkProjectGraphProposal(bareProject(cycleFixture.nodes, [
  cycleFixture.edge,
  { id: 'relu-b-a', source: 'relu-b', sourceHandle: 'output', target: 'relu-a', targetHandle: 'input' },
])), 'GRAPH_CYCLE_INVALID');
expectDiagnostic(genericCandidate({
  nodes: cycleFixture.nodes,
  edges: [cycleFixture.edge, { id: 'relu-b-a', source: 'relu-b', sourceHandle: 'output', target: 'relu-a', targetHandle: 'input' }],
  componentDefinitions: [],
}), 'GRAPH_CYCLE_INVALID');

const customFixture = makeRelus();
const composite = createCustomComposite({ selectedNodes: customFixture.nodes, edges: [customFixture.edge], name: 'Fixture Composite', color: '#3777aa' });
const customProject = bareProject([composite.instance], [], [JSON.parse(JSON.stringify(composite.manifest))]);
const customResult = createVolkProjectGraphProposal(JSON.parse(JSON.stringify(customProject)));
assert.equal(customResult.ok, true, customResult.diagnostics?.[0]?.code);
assert.deepEqual(customResult.proposal.graph.componentDefinitions.map((manifest) => manifest.id), [composite.manifest.id]);
assert.equal(validateWorkspaceGraphProposal(customResult.proposal).valid, true);

console.log('Graph Interop B0 checks passed: identity, detached producers, fidelity, structured validation, capabilities, empty-workspace assessment, privacy, and no mutation.');
