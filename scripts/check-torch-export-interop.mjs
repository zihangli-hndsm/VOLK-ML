import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  document.documentFingerprint = fingerprintJsonV1(document, 'torch-export-doc');
  return document;
}

function expectDocumentFailure(document, code) {
  assert.throws(() => validateTorchExportDocument(document), (error) => error?.code === code, 'Expected ' + code);
}

const normalized = validateTorchExportDocument(fixture);
assert.equal(normalized.documentFingerprint, fixture.documentFingerprint);
assert.equal(normalized.graph.nodes.length, 2);

const graphA = materializeTorchExportDocument(fixture);
const graphB = materializeTorchExportDocument(fixture);
assert.deepEqual(graphA, graphB, 'Materialization must be deterministic, including ids and layout.');
assert.deepEqual(graphA.nodes.map((node) => node.id), ['torch-input-0', 'torch-op-000', 'torch-op-001', 'torch-output-0']);
assert.equal(graphA.nodes[0].data.parameters.shape, '2', 'Dynamic batch is implicit; feature dimension remains explicit.');
assert.equal(graphA.nodes[1].data.parameters.input_features, 2);
assert.equal(graphA.nodes[1].data.parameters.units, 2);
assert.equal(graphA.nodes[1].data.parameters.use_bias, true);
assert.equal(graphA.edges.length, 3);
assert.equal(canonicalGraphSemanticsJsonV1(graphA), canonicalGraphSemanticsJsonV1(materializeTorchExportDocument(fixture)));
assert.equal(canonicalGraphLayoutJsonV1(graphA), canonicalGraphLayoutJsonV1(materializeTorchExportDocument(fixture)));

const created = createTorchExportGraphProposal(fixture);
assert.equal(created.ok, true, JSON.stringify(created.diagnostics));
assert.equal(created.proposal.source.version, TORCH_EXPORT_SOURCE_VERSION);
assert.equal(created.proposal.source.producer, 'torch-export-adapter');
assert.equal(created.proposal.conversion.version, TORCH_EXPORT_CONVERSION_REPORT_VERSION);
assert.equal(created.proposal.conversion.verification, 'adapter-verified');
assert.ok(created.proposal.conversion.missing.includes('trained-parameter-values'));
assert.equal(validateWorkspaceGraphProposal(created.proposal).valid, true);
assert.equal(revalidateWorkspaceGraphProposal(created.proposal).valid, true);
assert.equal(created.proposal.authority, 'detached-proposal');
assert.equal(created.proposal.requiresUserAcceptance, true);

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
fingerprintTamper.exporter.torchVersion = '2.5.1';
expectDocumentFailure(fingerprintTamper, 'TORCH_EXPORT_FINGERPRINT_MISMATCH');

const oversized = clone(fixture);
oversized.exporter.torchVersion = 'x'.repeat(MAX_TORCH_EXPORT_DOCUMENT_CODE_UNITS + 1);
expectDocumentFailure(oversized, 'TORCH_EXPORT_DOCUMENT_LIMIT');

const unsupported = seal(clone(fixture));
unsupported.graph.nodes[1].target = 'aten.add.Tensor';
expectDocumentFailure(unsupported, 'TORCH_EXPORT_OPERATOR_UNSUPPORTED');

const wrongLinearArgs = seal(clone(fixture));
wrongLinearArgs.graph.nodes[0].args[1] = { kind: 'input', id: 'i0' };
expectDocumentFailure(wrongLinearArgs, 'TORCH_EXPORT_ARGUMENT_INVALID');

const badBiasShape = seal(clone(fixture));
badBiasShape.graph.inputs.find((input) => input.id === 'p1').spec.shape[0].value = 3;
badBiasShape.state.parameters.find((parameter) => parameter.id === 'p1').shape[0].value = 3;
badBiasShape.state.parameters.find((parameter) => parameter.id === 'p1').data = 'AAAAAAAAAAAAAAAA';
expectDocumentFailure(badBiasShape, 'TORCH_EXPORT_SHAPE_INVALID');

const badWeightShape = seal(clone(fixture));
badWeightShape.state.parameters.find((parameter) => parameter.id === 'p0').shape[0].value = 3;
expectDocumentFailure(badWeightShape, 'TORCH_EXPORT_STATE_INVALID');

const denseLimit = clone(fixture);
denseLimit.graph.inputs[0].spec.shape[1].value = 4097;
denseLimit.graph.inputs.find((input) => input.id === 'p0').spec.shape[1].value = 4097;
denseLimit.state.parameters.find((parameter) => parameter.id === 'p0').shape[1].value = 4097;
denseLimit.state.parameters.find((parameter) => parameter.id === 'p0').data = Buffer.alloc(2 * 4097 * 4).toString('base64');
seal(denseLimit);
expectDocumentFailure(denseLimit, 'TORCH_EXPORT_COMPONENT_LIMIT');

const badMetadata = seal(clone(fixture));
badMetadata.graph.nodes[0].metadata.dtype = 'float16';
expectDocumentFailure(badMetadata, 'TORCH_EXPORT_SHAPE_INVALID');

const badPayload = seal(clone(fixture));
badPayload.state.parameters[0].data = 'AAAA';
expectDocumentFailure(badPayload, 'TORCH_EXPORT_STATE_INVALID');

const badBase64 = seal(clone(fixture));
badBase64.state.parameters[0].data = 'AB==';
expectDocumentFailure(badBase64, 'TORCH_EXPORT_STATE_INVALID');

const nonFinitePayload = seal(clone(fixture));
nonFinitePayload.state.parameters[0].data = 'AACAfwAAAAAAAAAAAACAPw==';
expectDocumentFailure(nonFinitePayload, 'TORCH_EXPORT_STATE_INVALID');

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

const branch = seal(clone(fixture));
branch.graph.nodes.push({
  id: 'n2',
  target: 'aten.tanh.default',
  args: [{ kind: 'node', id: 'n0' }],
  kwargs: {},
  metadata: clone(branch.graph.nodes[0].metadata),
});
branch.graph.outputs[0].value = { kind: 'node', id: 'n2' };
branch.graph.outputs[0].spec = {
  dtype: branch.graph.nodes[0].metadata.dtype,
  shape: clone(branch.graph.nodes[0].metadata.shape),
};
expectDocumentFailure(branch, 'TORCH_EXPORT_GRAPH_INVALID');

const extraState = seal(clone(fixture));
extraState.state.buffers.push({});
expectDocumentFailure(extraState, 'TORCH_EXPORT_STATE_UNSUPPORTED');

const proposalTamper = clone(created.proposal);
proposalTamper.graph.nodes.find((node) => node.data.manifest.id === 'dense_node').data.parameters.units = 3;
proposalTamper.graphIdentity = graphIdentityV1(proposalTamper.graph);
delete proposalTamper.proposalId;
const { graph: _graph, proposalId: _proposalId, ...proposalEnvelope } = proposalTamper;
proposalTamper.proposalId = fingerprintJsonV1(proposalEnvelope, 'workspace-proposal');
const rejectedTamper = validateWorkspaceGraphProposal(proposalTamper);
assert.equal(rejectedTamper.valid, false);
assert.equal(rejectedTamper.diagnostics[0].code, 'GRAPH_SOURCE_EVIDENCE_INVALID');

const genericTorch = createWorkspaceGraphProposalFromCandidate({
  graph: graphA,
  source: clone(created.proposal.source),
  conversion: {
    version: 3,
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

const forgedConversion = clone(created.proposal);
forgedConversion.conversion.verification = 'volk-verified';
const forgedCheck = validateWorkspaceGraphProposal(forgedConversion);
assert.equal(forgedCheck.valid, false);
assert.equal(forgedCheck.diagnostics[0].code, 'GRAPH_CONVERSION_VERIFICATION_INVALID');

console.log('Torch Export B2 checks passed: strict document, allowlist, tensor/dimension validation, deterministic mapping, source-v3/report-v3 evidence binding, and generic-authority rejection.');
