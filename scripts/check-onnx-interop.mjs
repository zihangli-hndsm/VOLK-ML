import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ONNX_DOCUMENT_TYPE,
  ONNX_SOURCE_VERSION,
  createGraphCapabilitySnapshot,
  createOnnxGraphProposal,
  fingerprintJsonV1,
  graphIdentityV1,
  revalidateWorkspaceGraphProposal,
  validateWorkspaceGraphProposal,
} from '../src/core/graph/index.js';
import {
  materializeOnnxDocument,
  validateOnnxDocument,
} from '../src/core/graph/onnxAdapter.js';
import { artifactFingerprintJsonV1 } from '../src/core/graph/artifactFingerprint.js';

const python = process.env.ONNX_PYTHON ?? process.env.PYTHON ?? 'python';
const pythonConfigured = Boolean(process.env.ONNX_PYTHON || process.env.PYTHON);
const pythonEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
const probe = spawnSync(python, ['-c', 'import onnx, numpy; print(onnx.__version__)'], { encoding: 'utf8', env: pythonEnv });
if (probe.error?.code === 'ENOENT') {
  if (pythonConfigured) assert.equal(probe.status, 0, 'Configured ONNX_PYTHON/PYTHON must run the real ONNX regression.');
  console.log('SKIP ONNX ModelProto integration: Python was not found and PYTHON is not configured.');
  process.exit(0);
}
if (probe.status !== 0) {
  if (pythonConfigured) assert.equal(probe.status, 0, `Configured ONNX_PYTHON/PYTHON must provide ONNX and NumPy: ${probe.stderr}`);
  console.log('SKIP ONNX ModelProto integration: optional ONNX/NumPy runtime is not installed.');
  process.exit(0);
}

const root = process.cwd();
const emitDocuments = [
  'import json, sys',
  'from pathlib import Path',
  'root = Path(sys.argv[1])',
  'sys.path.insert(0, str(root / "tests"))',
  'sys.path.insert(0, str(root / "tools" / "onnx"))',
  'import onnx',
  'from onnx import helper, TensorProto',
  'from onnx_model_fixtures import make_model',
  'from extract_onnx import extract_model, OnnxExtractionError',
  'documents = {name: extract_model(make_model(name), model_identifier=name.replace("-", "_")) for name in ("gemm-mlp", "matmul-add-mlp", "flatten", "reshape", "sigmoid-mlp", "gemm-transb0")}',
  'errors = {}',
  'multiple_outputs = make_model("gemm-mlp")',
  'multiple_outputs.graph.output.add().CopyFrom(helper.make_tensor_value_info("x", TensorProto.FLOAT, ["batch", 4]))',
  'custom_domain = make_model("gemm-mlp")',
  'custom_import = custom_domain.opset_import.add(); custom_import.domain = "vendor"; custom_import.version = 1',
  'external = make_model("gemm-mlp")',
  'external.graph.initializer[0].data_location = TensorProto.EXTERNAL; external.graph.initializer[0].external_data.add(key="location", value="external.bin")',
  'subgraph = make_model("gemm-mlp")',
  'subgraph_attribute = subgraph.graph.node[0].attribute.add(); subgraph_attribute.name = "body"; subgraph_attribute.type = onnx.AttributeProto.GRAPH; subgraph_attribute.g.CopyFrom(helper.make_graph([], "nested", [], []))',
  'for name, model in (("opset28", make_model("gemm-mlp", 28)), ("unsupported", make_model("unsupported-op")), ("multipleOutputs", multiple_outputs), ("customDomain", custom_domain), ("external", external), ("subgraph", subgraph)):',
  '    try: extract_model(model, model_identifier="negative_case")',
  '    except OnnxExtractionError as exc: errors[name] = exc.code',
  '    else: raise AssertionError(name + " unexpectedly extracted")',
  'print(json.dumps({"documents": documents, "errors": errors}, separators=(",", ":")))',
].join('\n');
const generated = spawnSync(python, ['-c', emitDocuments, root], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, env: pythonEnv });
assert.equal(generated.status, 0, `Real ONNX ModelProto extraction must pass: ${generated.stderr}`);
const { documents, errors } = JSON.parse(generated.stdout.trim());
assert.deepEqual(errors, {
  opset28: 'ONNX_OPSET_UNSUPPORTED',
  unsupported: 'ONNX_OPERATOR_UNSUPPORTED',
  multipleOutputs: 'ONNX_OUTPUT_UNSUPPORTED',
  customDomain: 'ONNX_DOMAIN_UNSUPPORTED',
  external: 'ONNX_EXTERNAL_DATA_UNSUPPORTED',
  subgraph: 'ONNX_ATTRIBUTE_UNSUPPORTED',
});

const cliDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-onnx-extractor-'));
try {
  const modelPath = path.join(cliDirectory, 'model.onnx');
  const documentPath = path.join(cliDirectory, 'normalized.json');
  const writeModel = spawnSync(python, ['-c', [
    'from pathlib import Path',
    'import sys',
    'sys.path.insert(0, str(Path.cwd() / "tests"))',
    'from onnx_model_fixtures import make_model',
    'import onnx',
    'onnx.save(make_model("gemm-mlp"), sys.argv[1])',
  ].join('\n'), modelPath], { encoding: 'utf8', cwd: root, env: pythonEnv });
  assert.equal(writeModel.status, 0, `Serialize a real ONNX ModelProto for the local CLI: ${writeModel.stderr}`);
  const extractorPath = path.join(root, 'tools', 'onnx', 'extract_onnx.py');
  const cli = spawnSync(python, [extractorPath, '--input', modelPath, '--output', documentPath, '--model-id', 'cli_fixture'], { encoding: 'utf8', cwd: root, env: pythonEnv });
  assert.equal(cli.status, 0, `Local ModelProto CLI extraction succeeds: ${cli.stderr}`);
  const cliDocument = JSON.parse(fs.readFileSync(documentPath, 'utf8'));
  assert.equal(validateOnnxDocument(cliDocument).documentFingerprint, cliDocument.documentFingerprint);
  const noOverwrite = spawnSync(python, [extractorPath, '--input', modelPath, '--output', documentPath, '--model-id', 'cli_fixture'], { encoding: 'utf8', cwd: root, env: pythonEnv });
  assert.equal(noOverwrite.status, 2, 'CLI refuses to replace an existing normalized document by default.');
  const overwrite = spawnSync(python, [extractorPath, '--input', modelPath, '--output', documentPath, '--model-id', 'cli_fixture', '--overwrite'], { encoding: 'utf8', cwd: root, env: pythonEnv });
  assert.equal(overwrite.status, 0, `Explicit CLI overwrite succeeds: ${overwrite.stderr}`);
} finally {
  fs.rmSync(cliDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

for (const [name, document] of Object.entries(documents)) {
  assert.equal(document.type, ONNX_DOCUMENT_TYPE);
  assert.equal(document.onnx.opsetVersion, 13);
  assert.equal(validateOnnxDocument(document).documentFingerprint, document.documentFingerprint);
  const graph = materializeOnnxDocument(document);
  assert.equal(graph.nodes[0].data.manifest.id, 'tensor_input_node');
  assert.equal(graph.nodes.at(-1).data.manifest.id, 'model_output_node');
  assert.equal(JSON.stringify(document).includes('123456.75'), false, `${name} never carries learned weight values`);
  assert.equal(JSON.stringify(document).includes('trainedWeights'), false);
  assert.equal(graph.nodes.some((node) => node.data.parameters?.use_bias === true), ['gemm-mlp', 'matmul-add-mlp', 'sigmoid-mlp'].includes(name));
}

const gemm = documents['gemm-mlp'];
const gemmGraph = materializeOnnxDocument(gemm);
assert.deepEqual(gemmGraph.nodes.map((node) => node.data.manifest.id), [
  'tensor_input_node', 'dense_node', 'relu_node', 'dense_node', 'softmax_node', 'model_output_node',
]);
assert.deepEqual(gemmGraph.nodes[1].data.parameters, { input_features: 4, units: 3, use_bias: true });
assert.deepEqual(gemmGraph.nodes[4].data.parameters, { axis: -1 });

const matmul = documents['matmul-add-mlp'];
const matmulGraph = materializeOnnxDocument(matmul);
assert.deepEqual(matmulGraph.nodes.map((node) => node.data.manifest.id), [
  'tensor_input_node', 'dense_node', 'tanh_node', 'dense_node', 'model_output_node',
], 'MatMul+Add is materialized as one affine Dense node, not a value-bearing Add primitive.');
assert.deepEqual(matmulGraph.nodes[1].data.parameters, { input_features: 4, units: 3, use_bias: true });
assert.equal(materializeOnnxDocument(documents['sigmoid-mlp']).nodes[2].data.manifest.id, 'sigmoid_node');
assert.deepEqual(materializeOnnxDocument(documents['gemm-transb0']).nodes[1].data.parameters, { input_features: 4, units: 2, use_bias: false });

assert.equal(documents.flatten.graph.initializers[0].role, 'parameter');
assert.deepEqual(documents.reshape.graph.initializers.find((item) => item.role === 'shape').shapeValues, [0, 4]);
assert.equal(materrializeReshapeUsesNoWeights(documents.reshape), true);

function materrializeReshapeUsesNoWeights(document) {
  const graph = materializeOnnxDocument(document);
  return graph.nodes.some((node) => node.data.manifest.id === 'reshape_node' && node.data.parameters.shape === '4')
    && !Object.hasOwn(document.graph.initializers.find((item) => item.role === 'parameter'), 'values');
}

const proposalResult = createOnnxGraphProposal(gemm);
assert.equal(proposalResult.ok, true, JSON.stringify(proposalResult.diagnostics));
const proposal = proposalResult.proposal;
assert.equal(proposal.source.version, ONNX_SOURCE_VERSION);
assert.equal(proposal.source.producer, 'onnx-adapter');
assert.equal(proposal.source.format, 'ONNX');
assert.equal(proposal.conversion.verification, 'adapter-verified');
assert.equal(proposal.requiresUserAcceptance, true);
assert.equal(validateWorkspaceGraphProposal(proposal).valid, true);
assert.equal(revalidateWorkspaceGraphProposal(proposal).valid, true);
assert.equal(JSON.stringify(proposal).includes('123456.75'), false, 'The graph proposal embeds metadata only, never ONNX tensor values.');

function clone(value) { return structuredClone(value); }
function reseal(document) {
  document.documentFingerprint = artifactFingerprintJsonV1(Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'documentFingerprint')));
  return document;
}
function resealProposalIdentity(value) {
  const { proposalId: _proposalId, graph: _graph, ...envelope } = value;
  value.proposalId = fingerprintJsonV1(envelope, 'workspace-proposal');
  return value;
}
function expectDocumentError(document, code) {
  assert.throws(() => validateOnnxDocument(document), (error) => error.code === code, `Expected ${code}.`);
}

const unknownField = clone(gemm);
unknownField.graph.initializers[0].values = [123456.75];
reseal(unknownField);
expectDocumentError(unknownField, 'ONNX_DOCUMENT_INVALID');

const badOpset = clone(gemm);
badOpset.onnx.opsetVersion = 28;
reseal(badOpset);
expectDocumentError(badOpset, 'ONNX_OPSET_UNSUPPORTED');

const badGemmAttributes = clone(gemm);
badGemmAttributes.graph.nodes[0].attributes.alpha = 0.5;
reseal(badGemmAttributes);
expectDocumentError(badGemmAttributes, 'ONNX_GEMM_SEMANTICS_UNSUPPORTED');

const badSoftmaxAxis = clone(gemm);
badSoftmaxAxis.graph.nodes[3].attributes.axis = 0;
reseal(badSoftmaxAxis);
expectDocumentError(badSoftmaxAxis, 'ONNX_SOFTMAX_AXIS_UNSUPPORTED');

const futureReference = clone(gemm);
futureReference.graph.nodes[0].inputs[0] = futureReference.graph.output.name;
reseal(futureReference);
expectDocumentError(futureReference, 'ONNX_GRAPH_INVALID');

const fanout = clone(gemm);
const hidden = clone(gemm.graph.nodes[0]);
fanout.graph.nodes.push({
  id: 'n4', op: 'Relu', inputs: ['h'], output: 'branch', attributes: {}, metadata: clone(hidden.metadata),
});
reseal(fanout);
expectDocumentError(fanout, 'ONNX_GRAPH_FANOUT_UNSUPPORTED');

const ambiguousReshape = clone(documents.reshape);
ambiguousReshape.graph.initializers.find((item) => item.role === 'shape').shapeValues = [0, -1, -1];
ambiguousReshape.graph.initializers.find((item) => item.role === 'shape').shape[0] = 3;
ambiguousReshape.graph.nodes[0].metadata.shape = clone(documents.reshape.graph.nodes[0].metadata.shape);
reseal(ambiguousReshape);
expectDocumentError(ambiguousReshape, 'ONNX_RESHAPE_SHAPE_UNSUPPORTED');

const dynamicReshape = clone(documents.reshape);
dynamicReshape.graph.nodes[0].inputs[1] = 'unresolved_dynamic_shape';
reseal(dynamicReshape);
expectDocumentError(dynamicReshape, 'ONNX_GRAPH_INVALID');

const tamperedGraph = clone(proposal);
tamperedGraph.graph.nodes[1].data.parameters.units = 99;
tamperedGraph.graphIdentity = graphIdentityV1(tamperedGraph.graph);
tamperedGraph.capabilitySnapshot = createGraphCapabilitySnapshot(tamperedGraph.graph);
resealProposalIdentity(tamperedGraph);
const tamperedGraphResult = validateWorkspaceGraphProposal(tamperedGraph);
assert.equal(tamperedGraphResult.valid, false, 'Source binding rejects a graph after its graph identity, capability snapshot, and proposal identity are recomputed.');
assert.equal(tamperedGraphResult.diagnostics[0]?.code, 'GRAPH_SOURCE_EVIDENCE_INVALID', 'The re-signed graph attack reaches and fails ONNX source-to-canonical binding.');

const resealedSourceMutation = clone(proposal);
const changedActivation = resealedSourceMutation.source.onnxDocument.graph.nodes.find((node) => node.op === 'Relu');
assert.ok(changedActivation, 'Attack fixture includes a valid-shape activation to mutate.');
changedActivation.op = 'Sigmoid';
reseal(resealedSourceMutation.source.onnxDocument);
resealedSourceMutation.source.provenance.fingerprint = resealedSourceMutation.source.onnxDocument.documentFingerprint;
resealProposalIdentity(resealedSourceMutation);
const resealedSourceResult = validateWorkspaceGraphProposal(resealedSourceMutation);
assert.equal(resealedSourceResult.valid, false, 'Recomputing normalized-document and proposal fingerprints does not detach ONNX source from its graph.');
assert.equal(resealedSourceResult.diagnostics[0]?.code, 'GRAPH_SOURCE_EVIDENCE_INVALID');

const changedConversion = clone(proposal);
changedConversion.conversion.approximated.push('invented-conversion-semantics');
resealProposalIdentity(changedConversion);
const changedConversionResult = validateWorkspaceGraphProposal(changedConversion);
assert.equal(changedConversionResult.valid, false, 'Recomputing proposal identity cannot authorize conversion-report changes.');
assert.equal(changedConversionResult.diagnostics[0]?.code, 'GRAPH_CONVERSION_INVALID');

console.log('PASS ONNX B3: real opset-13 ModelProto → metadata-only document → deterministic graph → source-bound proposal; Gemm, MatMul+Add, activations, Flatten/Reshape, and adversarial bounds verified.');
