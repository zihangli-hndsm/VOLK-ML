import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compilePipelineToPyTorch, compilePipelineToTensorFlow } from '../src/core/compiler.js';
import { componentById } from '../src/core/components.js';
import { updateAgentNode } from '../src/core/canvasAgent.js';
import { exerciseDatasets } from '../src/core/buildAgent/exerciseFixtures.js';
import { PROJECT_VERSION, validateProjectForWorkspace } from '../src/core/project.js';
import {
  commitWorkspaceGraphApply,
  prepareWorkspaceGraphApply,
} from '../src/core/graph/workspaceApply.js';
import {
  createTorchExportGraphProposal,
  createWorkspaceGraphProposalFromCandidate,
  revalidateWorkspaceGraphProposal,
  TORCH_EXPORT_CONVERSION_REPORT_VERSION,
  TORCH_EXPORT_SOURCE_VERSION,
  validateWorkspaceGraphProposal,
} from '../src/core/graph/workspaceProposal.js';
import {
  materializeTorchExportDocument,
  MAX_TORCH_EXPORT_DOCUMENT_CODE_UNITS,
  validateTorchExportDocument,
} from '../src/core/graph/torchExportAdapter.js';
import { artifactFingerprintJsonV1, sha256Hex } from '../src/core/graph/artifactFingerprint.js';
import {
  canonicalGraphLayoutJsonV1,
  canonicalGraphSemanticsJsonV1,
  fingerprintJsonV1,
  graphIdentityV1,
} from '../src/core/graph/identity.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/torch-export/linear-relu.json', import.meta.url), 'utf8'));
const clone = (value) => structuredClone(value);

function seal(document) {
  delete document.documentFingerprint;
  document.documentFingerprint = artifactFingerprintJsonV1(document);
  return document;
}

function expectDocumentFailure(document, code) {
  assert.throws(() => validateTorchExportDocument(document), (error) => error?.code === code, 'Expected ' + code);
}

function expectProposalDiagnostic(result, code) {
  assert.equal(result.valid, false, `Expected invalid proposal ${code}.`);
  assert.equal(result.diagnostics[0]?.code, code, `Expected ${code}, got ${result.diagnostics[0]?.code}.`);
}

function resignProposal(proposal, { refreshGraphIdentity = false } = {}) {
  if (refreshGraphIdentity) proposal.graphIdentity = graphIdentityV1(proposal.graph);
  delete proposal.proposalId;
  const { proposalId: _proposalId, graph: _graph, ...envelope } = proposal;
  proposal.proposalId = fingerprintJsonV1(envelope, 'workspace-proposal');
  return proposal;
}

assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256 implementation matches the standard test vector.');
assert.equal(fixture.documentFingerprint, artifactFingerprintJsonV1(Object.fromEntries(Object.entries(fixture).filter(([key]) => key !== 'documentFingerprint'))));
assert.match(fixture.documentFingerprint, /^sha256:[a-f0-9]{64}$/);
assert.equal(fixture.type, 'TorchExportDocumentV1');
assert.equal(fixture.version, 1);
assert.equal(fixture.model.identifier, 'reference-mlp-8-32-4');
assert.equal(fixture.extractor.schemaVersion, 1);
assert.equal(fixture.exporter.torchVersion, '2.5.1');
assert.equal(JSON.stringify(fixture).includes('SENTINEL-PARAMETER-VALUE'), false);
assert.ok(fixture.state.parameters.every((entry) => !Object.hasOwn(entry, 'data') && !Object.hasOwn(entry, 'value')),
  'The normalized document includes metadata only, never tensor values or reversible value payloads.');

const normalized = validateTorchExportDocument(fixture);
assert.equal(normalized.documentFingerprint, fixture.documentFingerprint);
assert.equal(normalized.graph.nodes.length, 3);

const unsupportedDocumentVersion = clone(fixture);
unsupportedDocumentVersion.type = 'TorchExportDocumentV2';
unsupportedDocumentVersion.version = 2;
seal(unsupportedDocumentVersion);
expectDocumentFailure(unsupportedDocumentVersion, 'TORCH_EXPORT_DOCUMENT_VERSION_UNSUPPORTED');

const unsupportedExtractorVersion = clone(fixture);
unsupportedExtractorVersion.extractor.schemaVersion = 2;
seal(unsupportedExtractorVersion);
expectDocumentFailure(unsupportedExtractorVersion, 'TORCH_EXPORT_DOCUMENT_VERSION_UNSUPPORTED');

const graphA = materializeTorchExportDocument(fixture);
const graphB = materializeTorchExportDocument(fixture);
assert.deepEqual(graphA, graphB, 'Materialization must be deterministic, including ids and layout.');
assert.deepEqual(graphA.nodes.map((node) => node.id), [
  'torch-input-0', 'torch-op-000', 'torch-op-001', 'torch-op-002', 'torch-output-0',
]);
assert.deepEqual(graphA.nodes.filter((node) => node.data.manifest.id === 'dense_node').map((node) => ({
  input: node.data.parameters.input_features,
  units: node.data.parameters.units,
  bias: node.data.parameters.use_bias,
})), [
  { input: 8, units: 32, bias: true },
  { input: 32, units: 4, bias: true },
]);
assert.equal(graphA.nodes.find((node) => node.data.manifest.id === 'relu_node').data.manifest.id, 'relu_node');
assert.equal(graphA.nodes[0].data.parameters.shape, '8', 'Dynamic batch is implicit; feature dimension remains explicit.');
assert.equal(graphA.edges.length, 4);
assert.deepEqual(canonicalGraphSemanticsJsonV1(graphA), canonicalGraphSemanticsJsonV1(materializeTorchExportDocument(fixture)));
assert.deepEqual(canonicalGraphLayoutJsonV1(graphA), canonicalGraphLayoutJsonV1(materializeTorchExportDocument(fixture)));

const proposalResult = createTorchExportGraphProposal(fixture);
assert.equal(proposalResult.ok, true, JSON.stringify(proposalResult.diagnostics));
const proposal = proposalResult.proposal;
assert.equal(proposal.source.version, TORCH_EXPORT_SOURCE_VERSION);
assert.equal(proposal.source.producer, 'torch-export-adapter');
assert.equal(proposal.conversion.version, TORCH_EXPORT_CONVERSION_REPORT_VERSION);
assert.equal(proposal.conversion.verification, 'adapter-verified');
assert.ok(proposal.conversion.approximated.includes('high-level-module-structure'));
assert.ok(proposal.conversion.missing.includes('original-python-structure'));
assert.ok(proposal.conversion.missing.includes('trained-parameter-values'));
assert.deepEqual(proposal.conversion.omitted, proposal.conversion.missing);
assert.equal(validateWorkspaceGraphProposal(proposal).valid, true);
assert.equal(revalidateWorkspaceGraphProposal(proposal).valid, true);
assert.equal(proposal.authority, 'detached-proposal');
assert.equal(proposal.requiresUserAcceptance, true);
assert.equal(JSON.stringify(proposal).includes('SENTINEL-PARAMETER-VALUE'), false);
assert.ok(proposal.source.torchExportDocument.state.parameters.every((entry) => !Object.hasOwn(entry, 'data') && !Object.hasOwn(entry, 'value')),
  'The embedded source evidence also contains metadata only.');

const forbiddenWeightPayload = clone(fixture);
forbiddenWeightPayload.state.parameters[0].data = 'SENTINEL-PARAMETER-VALUE-0.314159';
seal(forbiddenWeightPayload);
expectDocumentFailure(forbiddenWeightPayload, 'TORCH_EXPORT_DOCUMENT_INVALID');
assert.equal(createTorchExportGraphProposal(forbiddenWeightPayload).ok, false, 'No proposal is created from tensor values or value-like fields.');

const noBias = clone(fixture);
noBias.graph.inputs = noBias.graph.inputs.filter((input) => input.id !== 'p1');
noBias.graph.nodes[0].args[2] = null;
noBias.state.parameters = noBias.state.parameters.filter((parameter) => parameter.id !== 'p1');
seal(noBias);
assert.equal(materializeTorchExportDocument(noBias).nodes[1].data.parameters.use_bias, false);

for (const [target, componentId, args] of [
  ['aten.sigmoid.default', 'sigmoid_node', [{ kind: 'node', id: 'n0' }]],
  ['aten.tanh.default', 'tanh_node', [{ kind: 'node', id: 'n0' }]],
  ['aten.softmax.int', 'softmax_node', [
    { kind: 'node', id: 'n0' },
    { kind: 'scalar', dtype: 'int64', value: -1 },
    null,
  ]],
]) {
  const variant = clone(fixture);
  variant.graph.nodes[1].target = target;
  variant.graph.nodes[1].args = args;
  seal(variant);
  const materialized = materializeTorchExportDocument(variant);
  assert.equal(materialized.nodes[2].data.manifest.id, componentId);
  if (target === 'aten.softmax.int') assert.equal(materialized.nodes[2].data.parameters.axis, -1);
}

for (const mutator of [
  (document) => { document.unexpected = true; },
  (document) => { document.graph.nodes[0].kwargs.extra = true; },
]) {
  const invalid = seal(clone(fixture));
  mutator(invalid);
  expectDocumentFailure(invalid, 'TORCH_EXPORT_DOCUMENT_INVALID');
}

const fingerprintTamper = clone(fixture);
fingerprintTamper.exporter.torchVersion = '2.5.2';
expectDocumentFailure(fingerprintTamper, 'TORCH_EXPORT_FINGERPRINT_MISMATCH');

const oversized = clone(fixture);
oversized.exporter.torchVersion = 'x'.repeat(MAX_TORCH_EXPORT_DOCUMENT_CODE_UNITS + 1);
expectDocumentFailure(oversized, 'TORCH_EXPORT_DOCUMENT_LIMIT');

const unsupported = seal(clone(fixture));
unsupported.graph.nodes[1].target = 'aten.sin.default';
expectDocumentFailure(unsupported, 'TORCH_EXPORT_OPERATOR_UNSUPPORTED');

const wrongLinearArgs = seal(clone(fixture));
wrongLinearArgs.graph.nodes[0].args[1] = { kind: 'input', id: 'i0' };
expectDocumentFailure(wrongLinearArgs, 'TORCH_EXPORT_ARGUMENT_INVALID');

const badBiasShape = seal(clone(fixture));
badBiasShape.graph.inputs.find((input) => input.id === 'p1').spec.shape[0].value = 31;
badBiasShape.state.parameters.find((parameter) => parameter.id === 'p1').shape[0].value = 31;
expectDocumentFailure(badBiasShape, 'TORCH_EXPORT_SHAPE_INVALID');

const badWeightShape = seal(clone(fixture));
badWeightShape.state.parameters.find((parameter) => parameter.id === 'p0').shape[0].value = 31;
expectDocumentFailure(badWeightShape, 'TORCH_EXPORT_STATE_INVALID');

const denseLimit = clone(fixture);
denseLimit.graph.inputs[0].spec.shape[1].value = 4097;
denseLimit.graph.inputs.find((input) => input.id === 'p0').spec.shape = [
  { kind: 'static', value: 1 }, { kind: 'static', value: 4097 },
];
denseLimit.state.parameters.find((parameter) => parameter.id === 'p0').shape = clone(denseLimit.graph.inputs.find((input) => input.id === 'p0').spec.shape);
denseLimit.state.parameters.find((parameter) => parameter.id === 'p1').shape = [{ kind: 'static', value: 1 }];
denseLimit.graph.inputs.find((input) => input.id === 'p1').spec.shape = [{ kind: 'static', value: 1 }];
denseLimit.graph.nodes[0].metadata.shape[1].value = 1;
denseLimit.graph.nodes[1].metadata.shape[1].value = 1;
denseLimit.graph.nodes[2].args[0] = { kind: 'node', id: 'n1' };
denseLimit.graph.nodes[2].args[1] = { kind: 'input', id: 'p2' };
seal(denseLimit);
expectDocumentFailure(denseLimit, 'TORCH_EXPORT_COMPONENT_LIMIT');

const missingBatchRange = seal(clone(fixture));
missingBatchRange.graph.rangeConstraints = [];
expectDocumentFailure(missingBatchRange, 'TORCH_EXPORT_SHAPE_INVALID');

const wrongBatchSymbol = seal(clone(fixture));
wrongBatchSymbol.graph.nodes[1].metadata.shape[0].name = 'otherBatch';
expectDocumentFailure(wrongBatchSymbol, 'TORCH_EXPORT_SHAPE_INVALID');

const featureSymbol = seal(clone(fixture));
featureSymbol.graph.inputs[0].spec.shape[1] = { kind: 'symbol', name: 'feature' };
expectDocumentFailure(featureSymbol, 'TORCH_EXPORT_SHAPE_UNSUPPORTED');

const zeroMinimum = seal(clone(fixture));
zeroMinimum.graph.rangeConstraints[0].min = 0;
expectDocumentFailure(zeroMinimum, 'TORCH_EXPORT_DOCUMENT_INVALID');

const extraOutput = seal(clone(fixture));
extraOutput.graph.outputs.push(clone(extraOutput.graph.outputs[0]));
expectDocumentFailure(extraOutput, 'TORCH_EXPORT_OUTPUT_UNSUPPORTED');

for (const [kind, stateCollection, code] of [
  ['BUFFER', 'buffers', 'TORCH_EXPORT_STATE_UNSUPPORTED'],
  ['CONSTANT_TENSOR', 'constants', 'TORCH_EXPORT_STATE_UNSUPPORTED'],
  ['UNRECOGNIZED_STATE', null, 'TORCH_EXPORT_INPUT_UNSUPPORTED'],
]) {
  const stateKind = clone(fixture);
  const entry = { id: 'x0', name: 'state0', kind, target: 'model.state', spec: { dtype: 'float32', shape: [{ kind: 'static', value: 8 }] } };
  stateKind.graph.inputs.push(entry);
  if (stateCollection) stateKind.state[stateCollection].push({ id: 'x0', target: 'model.state', name: 'state0', kind, dtype: 'float32', shape: clone(entry.spec.shape), requiresGrad: false });
  seal(stateKind);
  expectDocumentFailure(stateKind, code);
}

const branch = seal(clone(fixture));
branch.graph.nodes.push({
  id: 'n3',
  target: 'aten.tanh.default',
  args: [{ kind: 'node', id: 'n0' }],
  kwargs: {},
  metadata: clone(branch.graph.nodes[0].metadata),
});
branch.graph.outputs[0].value = { kind: 'node', id: 'n3' };
branch.graph.outputs[0].spec = clone(branch.graph.nodes[0].metadata);
delete branch.graph.outputs[0].spec.layout;
expectDocumentFailure(branch, 'TORCH_EXPORT_GRAPH_INVALID');

const activationTamper = clone(proposal);
activationTamper.graph.nodes.find((node) => node.data.manifest.id === 'relu_node').data.manifest = clone(componentById.get('tanh_node'));
resignProposal(activationTamper, { refreshGraphIdentity: true });
expectProposalDiagnostic(validateWorkspaceGraphProposal(activationTamper), 'GRAPH_SOURCE_EVIDENCE_INVALID');

const denseParameterTamper = clone(proposal);
denseParameterTamper.graph.nodes.find((node) => node.id === 'torch-op-000').data.parameters.units = 33;
resignProposal(denseParameterTamper, { refreshGraphIdentity: true });
expectProposalDiagnostic(validateWorkspaceGraphProposal(denseParameterTamper), 'GRAPH_SOURCE_EVIDENCE_INVALID');

const edgeTamper = clone(proposal);
edgeTamper.graph.edges.pop();
resignProposal(edgeTamper, { refreshGraphIdentity: true });
expectProposalDiagnostic(validateWorkspaceGraphProposal(edgeTamper), 'GRAPH_SOURCE_EVIDENCE_INVALID');

const sourceEvidenceTamper = clone(proposal);
sourceEvidenceTamper.source.torchExportDocument.documentFingerprint = 'sha256:' + '0'.repeat(64);
resignProposal(sourceEvidenceTamper);
expectProposalDiagnostic(validateWorkspaceGraphProposal(sourceEvidenceTamper), 'GRAPH_SOURCE_EVIDENCE_INVALID');

const conversionTamper = clone(proposal);
conversionTamper.conversion.missing = conversionTamper.conversion.missing.filter((value) => value !== 'trained-parameter-values');
resignProposal(conversionTamper);
expectProposalDiagnostic(validateWorkspaceGraphProposal(conversionTamper), 'GRAPH_CONVERSION_INVALID');

const genericTorch = createWorkspaceGraphProposalFromCandidate({
  graph: graphA,
  source: clone(proposal.source),
  conversion: {
    version: TORCH_EXPORT_CONVERSION_REPORT_VERSION,
    fidelity: 'structural',
    exactFor: [],
    preserved: [],
    approximated: [],
    missing: [],
    unsupported: [],
    warnings: [],
    omitted: [],
  },
});
assert.equal(genericTorch.ok, false, 'Generic candidate API cannot impersonate an implemented official adapter.');

const forgedConversion = clone(proposal);
forgedConversion.conversion.verification = 'volk-verified';
expectProposalDiagnostic(validateWorkspaceGraphProposal(forgedConversion), 'GRAPH_CONVERSION_VERIFICATION_INVALID');

const currentProject = validateProjectForWorkspace({
  format: 'VOLK-ML',
  version: PROJECT_VERSION,
  name: 'Torch Export Apply fixture',
  language: { primary: 'en', secondary: 'zh' },
  workspace: { libraryMode: 'compact', leftWidth: 320, rightWidth: 360, viewMode: 'canvas' },
  graph: { nodes: [], edges: [] },
  customComponents: [],
  data: clone(exerciseDatasets.mlpClassification),
  trainedModel: null,
});
const originalData = clone(currentProject.data);
const idleRuntime = { status: 'idle', activeNodeIds: [], losses: [], result: null, error: null, startedAt: null, finishedAt: null };
const roundTrippedProposal = JSON.parse(JSON.stringify(proposal));
assert.equal(validateWorkspaceGraphProposal(roundTrippedProposal).valid, true, 'JSON round-trip preserves the formal proposal contract.');
const prepared = prepareWorkspaceGraphApply(roundTrippedProposal, { currentProject, runtime: idleRuntime });
assert.equal(prepared.ok, true, prepared.diagnostics?.[0]?.code);
const committed = commitWorkspaceGraphApply(prepared, { currentProject, runtime: idleRuntime });
assert.equal(committed.ok, true, committed.diagnostics?.[0]?.code);
assert.deepEqual(committed.project.data, originalData, 'A dataset survives graph-only Apply byte-for-byte semantically.');
assert.equal(committed.project.trainedModel, null);
assert.equal(committed.runtime.status, 'idle');
assert.deepEqual(committed.runtime.losses, []);
assert.equal(committed.runtime.result, null);
const appliedOps = committed.project.graph.nodes.map((node) => node.data.manifest.op);
assert.ok(!appliedOps.some((op) => ['supervised_trainer', 'loss_spec', 'optimizer_spec', 'evaluator', 'evaluation'].includes(op)),
  'Apply creates only the exported architecture and never fabricates training/evaluation components.');
assert.deepEqual(appliedOps, ['tensor_input', 'dense', 'relu', 'dense', 'model_output']);
const editedArchitecture = updateAgentNode(committed.project.graph.nodes, 'torch-op-000', { parameters: { units: 16 } });
const editedFirstDense = editedArchitecture.find((node) => node.id === 'torch-op-000');
const editedSecondDense = updateAgentNode(editedArchitecture, 'torch-op-002', { parameters: { input_features: 16, units: 3 } })
  .find((node) => node.id === 'torch-op-002');
assert.equal(editedFirstDense.data.parameters.units, 16, 'The first imported Dense remains editable through normal graph editing.');
assert.deepEqual({ input: editedSecondDense.data.parameters.input_features, units: editedSecondDense.data.parameters.units }, { input: 16, units: 3 });
const projectRoundTrip = validateProjectForWorkspace(JSON.parse(JSON.stringify(committed.project)));
assert.deepEqual(projectRoundTrip.data, originalData, 'Serialized graph round-trip retains the existing dataset.');
assert.deepEqual(projectRoundTrip.graph, committed.project.graph);

const torchSource = compilePipelineToPyTorch(committed.project.graph.nodes, committed.project.graph.edges).code;
const tensorflowSource = compilePipelineToTensorFlow(committed.project.graph.nodes, committed.project.graph.edges).code;
assert.match(torchSource, /nn\.Linear\(8, 32, bias=True\)/);
assert.match(torchSource, /nn\.Linear\(32, 4, bias=True\)/);
assert.match(torchSource, /nn\.ReLU\(\)/);
assert.match(tensorflowSource, /layers\.Dense\(32, use_bias=True\)/);
assert.match(tensorflowSource, /layers\.Dense\(4, use_bias=True\)/);
assert.match(tensorflowSource, /layers\.ReLU\(\)/);

console.log('Torch Export B2 checks passed: metadata-only source, cross-runtime SHA-256 identity, reference MLP, source/report mutation rejection, graph-only Apply preservation, and PyTorch/TensorFlow mappings.');
