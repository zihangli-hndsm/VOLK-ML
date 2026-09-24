import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createTorchExportGraphProposal } from '../src/core/graph/workspaceProposal.js';
import { validateTorchExportDocument } from '../src/core/graph/torchExportAdapter.js';

const python = process.env.PYTHON ?? 'python';
const extractor = path.resolve('tools/torch_export/extract_torch_export.py');
const fixturePath = path.resolve('fixtures/torch-export/linear-relu.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

const pythonFingerprint = spawnSync(python, ['-c', [
  'import importlib.util, json, sys',
  'path, fixture = sys.argv[1:]',
  'spec = importlib.util.spec_from_file_location("torch_export_extractor", path)',
  'module = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(module)',
  'document = json.load(open(fixture, encoding="utf-8"))',
  'document.pop("documentFingerprint")',
  'print(module.artifact_fingerprint_v1(document))',
].join('\n'), extractor, fixturePath], { encoding: 'utf8' });
if (pythonFingerprint.error?.code === 'ENOENT') {
  console.log('SKIP extractor runtime and cross-language digest: Python was not found.');
  process.exit(0);
}
assert.equal(pythonFingerprint.status, 0, pythonFingerprint.stderr);
assert.equal(pythonFingerprint.stdout.trim(), fixture.documentFingerprint, 'Python and browser canonical SHA-256 fingerprints match.');
assert.equal(validateTorchExportDocument(fixture).documentFingerprint, fixture.documentFingerprint);

const trustGuard = spawnSync(python, [extractor, '--input', 'not-loaded.pt2', '--output', 'unused.json', '--model-id', 'trust-check'], { encoding: 'utf8' });
assert.equal(trustGuard.status, 2, 'The CLI must refuse .pt2 loading without --trusted-pt2.');
assert.match(trustGuard.stderr, /--trusted-pt2/);
console.log('PASS extractor contract: metadata fingerprint agrees across Python/JavaScript and CLI trust guard is enforced.');

const metadataSeam = spawnSync(python, ['-c', [
  'import importlib.util, json, sys',
  'from types import SimpleNamespace as NS',
  'extractor_path, = sys.argv[1:]',
  'spec = importlib.util.spec_from_file_location("torch_export_extractor", extractor_path)',
  'module = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(module)',
  'class FakeTensor:',
  '    dtype = "torch.float32"',
  '    requires_grad = True',
  '    sentinel_value = 0.314159',
  '    sentinel_text = "SENTINEL-PARAMETER-VALUE"',
  '    def __init__(self, shape): self.shape = shape',
  '    def detach(self): raise AssertionError("parameter values must not be read")',
  '    def numpy(self): raise AssertionError("parameter bytes must not be serialized")',
  'class FakeNode:',
  '    def __init__(self, name, op, target=None, args=(), value=None):',
  '        self.name, self.op, self.target, self.args, self.kwargs = name, op, target, args, {}',
  '        self.meta = {"val": value} if value is not None else {}',
  'class FakeGraph: pass',
  'x = FakeNode("x", "placeholder", value=FakeTensor((2, 8)))',
  'w0 = FakeNode("first_weight", "placeholder", value=FakeTensor((32, 8)))',
  'b0 = FakeNode("first_bias", "placeholder", value=FakeTensor((32,)))',
  'w1 = FakeNode("second_weight", "placeholder", value=FakeTensor((4, 32)))',
  'b1 = FakeNode("second_bias", "placeholder", value=FakeTensor((4,)))',
  'n0 = FakeNode("linear1", "call_function", "aten.linear.default", (x, w0, b0), FakeTensor((2, 32)))',
  'n1 = FakeNode("relu", "call_function", "aten.relu.default", (n0,), FakeTensor((2, 32)))',
  'n2 = FakeNode("linear2", "call_function", "aten.linear.default", (n1, w1, b1), FakeTensor((2, 4)))',
  'out = FakeNode("output", "output", args=((n2,),), value=FakeTensor((2, 4)))',
  'nodes = [x, w0, b0, w1, b1, n0, n1, n2, out]',
  'inputs = []',
  'for name, kind, target in [("x", "USER_INPUT", None), ("first_weight", "PARAMETER", "first.weight"), ("first_bias", "PARAMETER", "first.bias"), ("second_weight", "PARAMETER", "second.weight"), ("second_bias", "PARAMETER", "second.bias")]:',
  '    inputs.append(NS(arg=NS(name=name), kind=NS(name=kind), target=target))',
  'program = NS(graph_module=NS(graph=NS(nodes=nodes)), graph_signature=NS(input_specs=inputs, output_specs=[NS(kind=NS(name="USER_OUTPUT"))]), range_constraints={})',
  'fake_torch = NS(__version__="2.5.1", fx=NS(Node=FakeNode))',
  'document = module._build_document(program, fake_torch, "reference-mlp-8-32-4")',
  'buffer = FakeNode("buffer", "placeholder", value=FakeTensor((8,)))',
  'buffer_program = NS(graph_module=NS(graph=NS(nodes=[x, w0, b0, w1, b1, buffer, n0, n1, n2, out])), graph_signature=NS(input_specs=inputs + [NS(arg=NS(name="buffer"), kind=NS(name="BUFFER"), target="layer.scale")], output_specs=[NS(kind=NS(name="USER_OUTPUT"))]), range_constraints={})',
  'constant = FakeNode("constant", "placeholder", value=FakeTensor((8,)))',
  'constant_program = NS(graph_module=NS(graph=NS(nodes=[x, w0, b0, w1, b1, constant, n0, n1, n2, out])), graph_signature=NS(input_specs=inputs + [NS(arg=NS(name="constant"), kind=NS(name="CONSTANT_TENSOR"), target="layer.constant")], output_specs=[NS(kind=NS(name="USER_OUTPUT"))]), range_constraints={})',
  'buffer_document = module._build_document(buffer_program, fake_torch, "reference-with-buffer")',
  'constant_document = module._build_document(constant_program, fake_torch, "reference-with-constant")',
  'unknown_inputs = [NS(arg=NS(name="x"), kind=NS(name="CUSTOM_STATE_KIND"), target=None)] + inputs[1:]',
  'unknown_program = NS(graph_module=NS(graph=NS(nodes=nodes)), graph_signature=NS(input_specs=unknown_inputs, output_specs=[NS(kind=NS(name="USER_OUTPUT"))]), range_constraints={})',
  'try:',
  '    module._build_document(unknown_program, fake_torch, "unknown-signature")',
  '    unknown_kind_error = "missing rejection"',
  'except module.ExtractionError as error:',
  '    unknown_kind_error = str(error)',
  'print(json.dumps({"document": document, "buffer": buffer_document, "constant": constant_document, "unknownKindError": unknown_kind_error}, separators=(",", ":")))',
].join('\n'), extractor], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
assert.equal(metadataSeam.status, 0, metadataSeam.stderr);
const extractedDocuments = JSON.parse(metadataSeam.stdout);
const extractedMetadataOnly = extractedDocuments.document;
const metadataOnlyText = JSON.stringify(extractedMetadataOnly);
assert.equal(metadataOnlyText.includes('SENTINEL'), false);
assert.equal(metadataOnlyText.includes('0.314159'), false);
assert.ok(extractedMetadataOnly.state.parameters.every((entry) => !Object.hasOwn(entry, 'data') && !Object.hasOwn(entry, 'value')));
assert.equal(extractedMetadataOnly.model.identifier, 'reference-mlp-8-32-4');
validateTorchExportDocument(extractedMetadataOnly);
const metadataOnlyProposal = createTorchExportGraphProposal(extractedMetadataOnly);
assert.equal(metadataOnlyProposal.ok, true, JSON.stringify(metadataOnlyProposal.diagnostics));
assert.equal(JSON.stringify(metadataOnlyProposal.proposal).includes('SENTINEL'), false);
assert.equal(JSON.stringify(metadataOnlyProposal.proposal).includes('0.314159'), false);
assert.equal(extractedDocuments.buffer.state.buffers[0].kind, 'BUFFER');
assert.equal(extractedDocuments.buffer.graph.inputs.at(-1).kind, 'BUFFER');
assert.equal(createTorchExportGraphProposal(extractedDocuments.buffer).diagnostics[0]?.code, 'TORCH_EXPORT_STATE_UNSUPPORTED');
assert.equal(extractedDocuments.constant.state.constants[0].kind, 'CONSTANT_TENSOR');
assert.equal(extractedDocuments.constant.graph.inputs.at(-1).kind, 'CONSTANT_TENSOR');
assert.equal(createTorchExportGraphProposal(extractedDocuments.constant).diagnostics[0]?.code, 'TORCH_EXPORT_STATE_UNSUPPORTED');
assert.match(extractedDocuments.unknownKindError, /CUSTOM_STATE_KIND/);
assert.ok(extractedDocuments.unknownKindError.length < 160, 'Unsupported signature errors remain bounded.');
console.log('PASS deterministic extractor seam: bounded ExportedProgram metadata produces a proposal without reading or serializing parameter values.');

const torchProbe = spawnSync(python, ['-c', 'import torch; print(torch.__version__)'], { encoding: 'utf8' });
if (torchProbe.status !== 0) {
  console.log('SKIP optional PyTorch integration: PyTorch is not installed; dependency installation is intentionally omitted.');
  process.exit(0);
}

const integration = spawnSync(python, ['-c', [
  'import json, sys, torch',
  'sys.path.insert(0, sys.argv[1])',
  'from extract_torch_export import extract_exported_program',
  'class ReferenceMLP(torch.nn.Module):',
  '    def __init__(self):',
  '        super().__init__()',
  '        self.first = torch.nn.Linear(8, 32)',
  '        self.second = torch.nn.Linear(32, 4)',
  '    def forward(self, x):',
  '        return self.second(torch.relu(self.first(x)))',
  'class Unsupported(torch.nn.Module):',
  '    def forward(self, x):',
  '        return torch.sin(x)',
  'model = ReferenceMLP().eval()',
  'with torch.no_grad():',
  '    model.first.weight.fill_(0.314159)',
  '    model.first.bias.fill_(0.271828)',
  'program = torch.export.export(model, (torch.zeros(2, 8),))',
  'metadata = extract_exported_program(program, model_identifier="reference-mlp-8-32-4")',
  'unsupported_program = torch.export.export(Unsupported().eval(), (torch.zeros(2, 8),))',
  'unsupported = extract_exported_program(unsupported_program, model_identifier="unsupported-sin")',
  'print(json.dumps({"metadata": metadata, "unsupported": unsupported}, separators=(",", ":")))',
].join('\n'), path.resolve('tools/torch_export')], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
assert.equal(integration.status, 0, integration.stderr);
const extracted = JSON.parse(integration.stdout);
const serializedMetadata = JSON.stringify(extracted.metadata);
assert.equal(serializedMetadata.includes('0.314159'), false, 'Extracted JSON excludes trained parameter values.');
assert.equal(serializedMetadata.includes('0.271828'), false, 'Extracted JSON excludes trained bias values.');
assert.equal(extracted.metadata.model.identifier, 'reference-mlp-8-32-4');
assert.ok(extracted.metadata.state.parameters.every((entry) => !Object.hasOwn(entry, 'data') && !Object.hasOwn(entry, 'value')));
assert.equal(extracted.metadata.graph.nodes.length, 3);
assert.deepEqual(extracted.metadata.graph.nodes.map((node) => node.target), [
  'aten.linear.default', 'aten.relu.default', 'aten.linear.default',
]);
const proposal = createTorchExportGraphProposal(extracted.metadata);
assert.equal(proposal.ok, true, JSON.stringify(proposal.diagnostics));
const serializedProposal = JSON.stringify(proposal.proposal);
assert.equal(serializedProposal.includes('0.314159'), false, 'Proposal source and graph exclude parameter values.');
assert.equal(serializedProposal.includes('0.271828'), false, 'Proposal source and graph exclude bias values.');
assert.equal(proposal.proposal.source.torchExportDocument.state.parameters.some((entry) => Object.hasOwn(entry, 'data')), false);

const unsupported = createTorchExportGraphProposal(extracted.unsupported);
assert.equal(unsupported.ok, false, 'An extracted-but-unmapped operator cannot produce a proposal.');
assert.equal(unsupported.diagnostics[0]?.code, 'TORCH_EXPORT_OPERATOR_UNSUPPORTED');
assert.equal('proposal' in unsupported, false);
console.log('PASS optional PyTorch integration: existing ExportedProgram → metadata-only MLP JSON → proposal, and bounded unsupported op rejects without proposal.');
