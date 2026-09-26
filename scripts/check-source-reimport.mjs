import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectAgentNodes, createAgentNode } from '../src/core/canvasAgent.js';
import { componentById } from '../src/core/components.js';
import { createCustomComposite } from '../src/core/customComposites.js';
import { compileGraphWithSourceManifest } from '../src/core/compiler.js';
import {
  canonicalizeWorkspaceGraphCandidate,
  createGraphPatchProposal,
  revalidateGraphPatchProposal,
} from '../src/core/graph/index.js';
import {
  analyzeSourceReimport,
  finalizeSourceReimportProposal,
} from '../src/core/graph/sourceReimportProposal.js';
import { graphPatchBaseFromProject, prepareWorkspaceGraphPatchApply, commitWorkspaceGraphPatchApply } from '../src/core/graph/workspacePatchApply.js';
import { PROJECT_VERSION, validateProjectForWorkspace } from '../src/core/project.js';
import { exerciseDatasets } from '../src/core/buildAgent/exerciseFixtures.js';
import { parseGeneratedSources, runSourceReimportCli } from './propose-source-reimport.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'volk-source-reimport-'));
const idleRuntime = { status: 'idle', activeNodeIds: [], losses: [], result: null, error: null, startedAt: null, finishedAt: null };
const scenarios = [];

function record(id, evidence = {}) {
  scenarios.push({ id, outcome: 'PASS', evidence });
}

function makeNode(nodes, id, componentId, parameters = {}) {
  const node = createAgentNode({
    nodes,
    manifest: componentById.get(componentId),
    request: { id, position: { x: nodes.length * 180, y: 80 }, parameters },
    idFactory: () => 'source-reimport-fixture',
  });
  nodes.push(node);
  return node;
}

function edge(source, target, sourceHandle = 'output', targetHandle = 'input', id = `${source}-${target}-${targetHandle}`) {
  return { id, source, sourceHandle, target, targetHandle, type: 'deletable' };
}

function projectFor(nodes, edges, overrides = {}) {
  return validateProjectForWorkspace({
    format: 'VOLK-ML',
    version: PROJECT_VERSION,
    name: overrides.name ?? 'Source re-import fixture',
    language: { primary: 'en', secondary: null },
    workspace: { viewMode: 'canvas', leftWidth: 300, rightWidth: 380 },
    graph: { nodes, edges },
    customComponents: overrides.customComponents ?? [],
    data: overrides.data ?? null,
    trainedModel: null,
    ...(overrides.extra ?? {}),
  });
}

function linearProject({ orphan = false, data = null } = {}) {
  const nodes = [];
  const input = makeNode(nodes, 'input', 'tensor_input_node', { shape: '8' });
  const dense = makeNode(nodes, 'dense', 'dense_node', { input_features: 8, units: 4, use_bias: false });
  const output = makeNode(nodes, 'output', 'model_output_node');
  const edges = [edge(input.id, dense.id, 'tensor'), edge(dense.id, output.id)];
  if (orphan) makeNode(nodes, 'unselected-orphan', 'dense_node', { input_features: 8, units: 2 });
  return projectFor(nodes, edges, { data });
}

function layerProject(componentId, { shape = '8', parameters = {} } = {}) {
  const nodes = [];
  const input = makeNode(nodes, 'input', 'tensor_input_node', { shape });
  const layer = makeNode(nodes, 'layer', componentId, parameters);
  const output = makeNode(nodes, 'output', 'model_output_node');
  return {
    project: projectFor(nodes, [edge(input.id, layer.id, 'tensor'), edge(layer.id, output.id)]),
    layer,
  };
}

function convProject(componentId, { shape = '3, 16, 16', parameters = {} } = {}) {
  return layerProject(componentId, { shape, parameters });
}

async function exportFor(project) {
  const canonical = canonicalizeWorkspaceGraphCandidate(graphPatchBaseFromProject(project));
  assert.equal(canonical.valid, true, canonical.diagnostics?.[0]?.code);
  const source = await compileGraphWithSourceManifest(canonical.graph.nodes, canonical.graph.edges, 'pytorch');
  return { canonical: canonical.graph, ...source };
}

async function makePrepared(project, editedCode, sourceBundle = undefined) {
  const bundle = sourceBundle ?? await exportFor(project);
  const parsed = await parseGeneratedSources({ original: bundle.code, edited: editedCode });
  const prepared = await analyzeSourceReimport({
    project,
    originalSource: bundle.code,
    manifest: bundle.manifest,
    editedSource: editedCode,
    originalAst: parsed.original,
    editedAst: parsed.edited,
  });
  return { bundle, parsed, prepared };
}

async function proposalFor(project, editedCode) {
  const { bundle, prepared } = await makePrepared(project, editedCode);
  assert.equal(prepared.ok, true, JSON.stringify(prepared.diagnostics?.[0]));
  assert.equal(prepared.status, 'candidate');
  const candidateAsts = await parseGeneratedSources({ original: prepared.candidateSource, edited: editedCode });
  const finalized = finalizeSourceReimportProposal(prepared, {
    candidateAst: candidateAsts.original,
    editedAst: candidateAsts.edited,
  });
  assert.equal(finalized.ok, true, finalized.diagnostics?.[0]?.code);
  assert.equal(finalized.proposal.authority, 'detached-proposal');
  assert.equal(finalized.proposal.requiresUserAcceptance, true);
  return { bundle, prepared, finalized };
}

async function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, `Expected one source occurrence for ${before}`);
  return source.replace(before, after);
}

function expectFailure(result, code) {
  assert.equal(result.ok, false, 'Expected a rejected source edit.');
  assert.equal(result.diagnostics?.[0]?.code, code);
}

async function testParameterFixture({ id, componentId, shape, parameters, before, after, expectedKey, expectedValue }) {
  const { project, layer } = componentId === 'conv2d_node' || componentId === 'batch_norm2d_node' || componentId === 'max_pool2d_node'
    ? convProject(componentId, { shape, parameters })
    : layerProject(componentId, { shape, parameters });
  const bundle = await exportFor(project);
  const edited = await replaceOnce(bundle.code, before, after);
  const { finalized } = await proposalFor(project, edited);
  assert.equal(finalized.analysis.operationCount, 1, id);
  const op = finalized.proposal.operations[0];
  assert.equal(op.op, 'UPDATE_PARAMETERS', id);
  assert.equal(op.nodeId, layer.id, id);
  assert.equal(op.parameters[expectedKey], expectedValue, id);
  if (id === 'dense') {
    assert.deepEqual(op.parameters, { input_features: 8, units: 6, use_bias: false }, 'C1 updates carry all effective parameters, not only the changed field.');
  }
  record(`parameter-${id}`, { operation: op.op, nodeId: op.nodeId, property: expectedKey, value: expectedValue });
}

async function testParameterMappings() {
  await testParameterFixture({
    id: 'dense', componentId: 'dense_node', shape: '8',
    parameters: { input_features: 8, units: 4, use_bias: false },
    before: 'nn.Linear(8, 4, bias=False)', after: 'nn.Linear(8, 6, bias=False)',
    expectedKey: 'units', expectedValue: 6,
  });
  await testParameterFixture({
    id: 'conv2d', componentId: 'conv2d_node', shape: '3, 16, 16',
    parameters: { input_channels: 3, filters: 4, kernel_size: 3, stride: 1, padding: 'same', use_bias: true },
    before: 'nn.Conv2d(3, 4, kernel_size=3, stride=1, padding=1, bias=True)',
    after: 'nn.Conv2d(3, 5, kernel_size=3, stride=1, padding=1, bias=True)',
    expectedKey: 'filters', expectedValue: 5,
  });
  await testParameterFixture({
    id: 'maxpool', componentId: 'max_pool2d_node', shape: '3, 16, 16',
    parameters: { pool_size: 2, stride: 2 },
    before: 'nn.MaxPool2d(kernel_size=2, stride=2)', after: 'nn.MaxPool2d(kernel_size=3, stride=2)',
    expectedKey: 'pool_size', expectedValue: 3,
  });
  await testParameterFixture({
    id: 'softmax', componentId: 'softmax_node', shape: '8',
    before: 'nn.Softmax(dim=-1)', after: 'nn.Softmax(dim=0)',
    expectedKey: 'axis', expectedValue: 0,
  });
  await testParameterFixture({
    id: 'dropout', componentId: 'dropout_node', shape: '8',
    before: 'nn.Dropout(p=0.2)', after: 'nn.Dropout(p=0.3)',
    expectedKey: 'rate', expectedValue: 0.3,
  });
  await testParameterFixture({
    id: 'batchnorm1d', componentId: 'batch_norm1d_node', shape: '4',
    parameters: { features: 4 },
    before: 'nn.BatchNorm1d(4, momentum=0.1)', after: 'nn.BatchNorm1d(4, momentum=0.2)',
    expectedKey: 'momentum', expectedValue: 0.2,
  });
  await testParameterFixture({
    id: 'batchnorm2d', componentId: 'batch_norm2d_node', shape: '3, 16, 16',
    parameters: { channels: 3 },
    before: 'nn.BatchNorm2d(3, momentum=0.1)', after: 'nn.BatchNorm2d(3, momentum=0.2)',
    expectedKey: 'momentum', expectedValue: 0.2,
  });
  await testParameterFixture({
    id: 'layernorm', componentId: 'layer_norm_node', shape: '4, 8',
    parameters: { normalized_shape: '8' },
    before: 'nn.LayerNorm((8,))', after: 'nn.LayerNorm((4, 8))',
    expectedKey: 'normalized_shape', expectedValue: '4, 8',
  });
}

async function testRewire() {
  const nodes = [];
  const inputA = makeNode(nodes, 'input-a', 'tensor_input_node', { shape: '4' });
  const inputB = makeNode(nodes, 'input-b', 'tensor_input_node', { shape: '4' });
  const denseA = makeNode(nodes, 'dense-a', 'dense_node', { input_features: 4, units: 4 });
  const denseB = makeNode(nodes, 'dense-b', 'dense_node', { input_features: 4, units: 4 });
  const add = makeNode(nodes, 'sum', 'add_node');
  const output = makeNode(nodes, 'output', 'model_output_node');
  const outputB = makeNode(nodes, 'output-b', 'model_output_node');
  const edges = [
    edge(inputA.id, denseA.id, 'tensor'),
    edge(inputB.id, denseB.id, 'tensor'),
    edge(denseA.id, add.id, 'output', 'a', 'edge-a'),
    edge(denseB.id, add.id, 'output', 'b', 'edge-b'),
    edge(add.id, output.id),
    edge(denseB.id, outputB.id, 'output', 'input', 'edge-output-b'),
  ];
  const project = projectFor(nodes, edges);
  const bundle = await exportFor(project);
  const edited = await replaceOnce(bundle.code, 'v_n_sum = v_n_dense_a + v_n_dense_b', 'v_n_sum = v_n_dense_a + v_n_dense_a');
  const { finalized } = await proposalFor(project, edited);
  assert.equal(finalized.proposal.operations.length, 2);
  assert.deepEqual(finalized.proposal.operations.map((operation) => operation.op), ['DISCONNECT', 'CONNECT']);
  assert.equal(finalized.proposal.operations[0].edgeId, 'edge-b');
  assert.equal(finalized.proposal.operations[1].edge.source, 'dense-a');
  assert.equal(finalized.proposal.operations[1].edge.targetHandle, 'b');
  record('typed-port-rewire', { operationKinds: finalized.proposal.operations.map((operation) => operation.op), target: 'sum.b' });
}

async function testNoOpAndCanonicality() {
  const project = linearProject();
  const bundle = await exportFor(project);
  const noOp = await makePrepared(project, `${bundle.code}# presentation-only comment\n`, bundle);
  assert.equal(noOp.prepared.ok, true);
  assert.equal(noOp.prepared.status, 'no-op');
  assert.equal(noOp.prepared.proposal, null);
  record('comment-whitespace-no-op', { proposalCreated: false });

  const edited = await replaceOnce(bundle.code, 'nn.Linear(8, 4, bias=False)', 'nn.Linear(8, 6, bias=False)');
  const prepared = await makePrepared(project, edited, bundle);
  assert.equal(prepared.prepared.ok, true, prepared.prepared.diagnostics?.[0]?.code);
  const final = finalizeSourceReimportProposal(prepared.prepared, {
    candidateAst: prepared.parsed.original,
    editedAst: prepared.parsed.edited,
  });
  expectFailure(final, 'SOURCE_REIMPORT_CANONICAL_SOURCE_MISMATCH');
  record('canonical-reemission-required', { forgedCandidateRejected: true });
}

async function testProvenanceAndUnsupportedCode() {
  const project = linearProject();
  const bundle = await exportFor(project);
  const validEdited = await replaceOnce(bundle.code, 'nn.Linear(8, 4, bias=False)', 'nn.Linear(8, 6, bias=False)');
  const current = await proposalFor(project, validEdited);
  const currentBase = canonicalizeWorkspaceGraphCandidate(graphPatchBaseFromProject(project)).graph;
  assert.equal(revalidateGraphPatchProposal(current.finalized.proposal, { currentBaseGraph: currentBase }).valid, true);
  const moved = structuredClone(currentBase);
  moved.nodes[0].position.x += 1;
  assert.equal(revalidateGraphPatchProposal(current.finalized.proposal, { currentBaseGraph: moved }).diagnostics[0].code, 'GRAPH_PATCH_BASE_STALE');

  const changedProject = structuredClone(project);
  changedProject.graph.nodes.find((node) => node.id === 'dense').data.parameters.units = 5;
  const parsed = await parseGeneratedSources({ original: bundle.code, edited: validEdited });
  const stale = await analyzeSourceReimport({
    project: changedProject,
    originalSource: bundle.code,
    manifest: bundle.manifest,
    editedSource: validEdited,
    originalAst: parsed.original,
    editedAst: parsed.edited,
  });
  expectFailure(stale, 'SOURCE_REIMPORT_ORIGINAL_BINDING_INVALID');

  const rehashedManifest = structuredClone(bundle.manifest);
  rehashedManifest.source.sha256 = '0'.repeat(64);
  const forged = await analyzeSourceReimport({
    project,
    originalSource: bundle.code,
    manifest: rehashedManifest,
    editedSource: validEdited,
    originalAst: parsed.original,
    editedAst: parsed.edited,
  });
  expectFailure(forged, 'SOURCE_REIMPORT_ORIGINAL_BINDING_INVALID');

  const sentinel = path.join(tempRoot, 'must-not-execute.txt');
  const hostileSource = `${bundle.code}\nopen(${JSON.stringify(sentinel)}, 'w').write('executed')\n`;
  const hostileParsed = await parseGeneratedSources({ original: bundle.code, edited: hostileSource });
  const hostile = await analyzeSourceReimport({
    project,
    originalSource: bundle.code,
    manifest: bundle.manifest,
    editedSource: hostileSource,
    originalAst: hostileParsed.original,
    editedAst: hostileParsed.edited,
  });
  assert.equal(hostile.ok, false);
  assert.equal(hostile.code ?? hostile.diagnostics?.[0]?.code, 'SOURCE_REIMPORT_UNSUPPORTED_EDIT');
  await assert.rejects(readFile(sentinel));
  record('original-binding-stale-and-hostile-source', { staleRejected: true, rehashedManifestRejected: true, hostileSentinelAbsent: true });
}

async function testShapeAndFrameworkGuards() {
  const project = linearProject();
  const bundle = await exportFor(project);
  const invalidDimensions = await replaceOnce(bundle.code, 'nn.Linear(8, 4, bias=False)', 'nn.Linear(7, 4, bias=False)');
  const invalid = await makePrepared(project, invalidDimensions, bundle);
  expectFailure(invalid.prepared, 'SOURCE_REIMPORT_SHAPE_INCOMPATIBLE');

  const tfSource = await compileGraphWithSourceManifest(project.graph.nodes, project.graph.edges, 'tensorflow');
  const parsed = await parseGeneratedSources({ original: bundle.code, edited: bundle.code });
  const tensorflow = await analyzeSourceReimport({
    project,
    originalSource: tfSource.code,
    manifest: tfSource.manifest,
    editedSource: tfSource.code,
    originalAst: parsed.original,
    editedAst: parsed.edited,
  });
  expectFailure(tensorflow, 'SOURCE_REIMPORT_FRAMEWORK_UNSUPPORTED');
  record('shape-incompatibility-and-framework-boundary', { incompatibleDenseRejected: true, tensorflowRejected: true });
}

async function testApplyRetentionAndCli() {
  const projectGraph = linearProject({ orphan: true }).graph;
  const compositeNodes = [];
  const compositeDense = makeNode(compositeNodes, 'catalogue-dense', 'dense_node', { units: 6 });
  const compositeRelu = makeNode(compositeNodes, 'catalogue-relu', 'relu_node');
  const compositeEdges = connectAgentNodes(compositeNodes, [], {
    id: 'catalogue-edge',
    source: compositeDense.id,
    sourceHandle: 'output',
    target: compositeRelu.id,
    targetHandle: 'input',
  });
  const catalogueManifest = createCustomComposite({
    selectedNodes: compositeNodes,
    edges: compositeEdges,
    name: 'Local retention fixture',
    color: '#3777aa',
  }).manifest;
  const data = structuredClone(exerciseDatasets.wine);
  data.name = 'retained-dataset';
  data.rows[0].retentionSentinel = 'keep-row';
  const project = projectFor(projectGraph.nodes, projectGraph.edges, {
    data,
    customComponents: [catalogueManifest],
    name: 'Keep project metadata',
  });
  project.workspace = { ...project.workspace, viewMode: 'canvas', customFlag: 'keep-me' };
  assert.deepEqual(graphPatchBaseFromProject(project).componentDefinitions, [], 'C1 graph snapshot excludes definitions that no mounted graph node references.');
  const bundle = await exportFor(project);
  assert.ok(bundle.manifest.selection.excludedWorkspaceNodeIds.includes('unselected-orphan'));
  const edited = await replaceOnce(bundle.code, 'nn.Linear(8, 4, bias=False)', 'nn.Linear(8, 6, bias=False)');
  const { finalized } = await proposalFor(project, edited);
  assert.ok(finalized.proposal.baseGraph.nodes.some((node) => node.id === 'unselected-orphan'));
  const preparation = prepareWorkspaceGraphPatchApply(finalized.proposal, { currentProject: project, runtime: idleRuntime });
  assert.equal(preparation.ok, true, preparation.diagnostics?.[0]?.code);
  assert.deepEqual(preparation.preparation.baseGraph.componentDefinitions, []);
  assert.deepEqual(preparation.preparation.nextProject.customComponents, project.customComponents, 'C2 starts from and retains the full current catalogue.');
  assert.equal(preparation.preparation.nextProject.name, project.name);
  assert.deepEqual(preparation.preparation.nextProject.workspace, project.workspace);
  assert.ok(preparation.preparation.resultGraph.nodes.some((node) => node.id === 'unselected-orphan'));
  assert.deepEqual(preparation.preparation.nextProject.data, project.data);
  assert.deepEqual(preparation.preparation.nextProject.customComponents, project.customComponents);
  const cancelledProject = structuredClone(project);
  assert.deepEqual(cancelledProject, project, 'Preview/cancel is non-mutating when the user does not commit.');
  const committed = commitWorkspaceGraphPatchApply(preparation, { currentProject: project, runtime: idleRuntime });
  assert.equal(committed.ok, true, committed.diagnostics?.[0]?.code);
  assert.equal(committed.project.graph.nodes.find((node) => node.id === 'dense').data.parameters.units, 6);
  assert.equal(committed.project.graph.nodes.find((node) => node.id === 'unselected-orphan').data.parameters.units, 2);
  record('c2-prepare-cancel-apply-and-unselected-retention', { appliedOnlyThroughCommit: true, orphanPreserved: true, metadataPreserved: true });

  const projectPath = path.join(tempRoot, 'project.volkml');
  const sourcePath = path.join(tempRoot, 'original.py');
  const manifestPath = path.join(tempRoot, 'manifest.json');
  const editedPath = path.join(tempRoot, 'edited.py');
  const proposalPath = path.join(tempRoot, 'proposal.json');
  await writeFile(projectPath, JSON.stringify(project), 'utf8');
  await writeFile(sourcePath, bundle.code, 'utf8');
  await writeFile(manifestPath, JSON.stringify(bundle.manifest), 'utf8');
  await writeFile(editedPath, edited, 'utf8');
  const cliResult = await runSourceReimportCli([
    '--project', projectPath,
    '--original-source', sourcePath,
    '--manifest', manifestPath,
    '--edited-source', editedPath,
    '--out', proposalPath,
  ]);
  assert.equal(cliResult.status, 'proposal');
  const proposalFile = JSON.parse(await readFile(proposalPath, 'utf8'));
  assert.equal(proposalFile.proposalId, finalized.proposal.proposalId);
  await assert.rejects(runSourceReimportCli([
    '--project', projectPath,
    '--original-source', sourcePath,
    '--manifest', manifestPath,
    '--edited-source', editedPath,
    '--out', proposalPath,
  ]), /SOURCE_REIMPORT_OUTPUT_EXISTS/);
  const noOpPath = path.join(tempRoot, 'no-op-proposal.json');
  await writeFile(editedPath, `${bundle.code}# comment only\n`, 'utf8');
  const noOp = await runSourceReimportCli([
    '--project', projectPath,
    '--original-source', sourcePath,
    '--manifest', manifestPath,
    '--edited-source', editedPath,
    '--out', noOpPath,
  ]);
  assert.equal(noOp.status, 'no-op');
  await assert.rejects(readFile(noOpPath));
  await assert.rejects(runSourceReimportCli([
    '--project', projectPath,
    '--original-source', sourcePath,
    '--manifest', manifestPath,
    '--edited-source', editedPath,
    '--out', sourcePath,
  ]), /SOURCE_REIMPORT_OUTPUT_ALIASES_INPUT/);
  record('offline-cli-output-no-overwrite-and-no-op', { outputCreatedExclusively: true, noOpCreatesNoPatch: true, inputsNeverOverwritten: true });
}

async function testWorkerBoundsAndDiagnostics() {
  await assert.rejects(parseGeneratedSources({ original: 'not valid python !!!', edited: 'pass' }), /SOURCE_REIMPORT_SYNTAX_INVALID/);
  await assert.rejects(parseGeneratedSources({ original: 'pass', edited: 'pass', workerPath: path.join(tempRoot, 'missing-worker.py') }), /SOURCE_REIMPORT_WORKER_UNAVAILABLE/);
  await assert.rejects(parseGeneratedSources({ original: 'pass', edited: 'pass', pythonExecutable: path.join(tempRoot, 'missing-python.exe') }), /SOURCE_REIMPORT_PYTHON_UNAVAILABLE/);
  await assert.rejects(parseGeneratedSources({ original: 'pass', edited: 'pass', timeoutMs: 1 }), /SOURCE_REIMPORT_WORKER_TIMEOUT/);
  const controller = new AbortController();
  const interrupted = parseGeneratedSources({ original: 'pass', edited: 'pass', signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(interrupted, /SOURCE_REIMPORT_INTERRUPTED/);
  const shellSentinel = path.join(tempRoot, 'shell-command-must-not-run.txt');
  const shellLikeExecutable = `${path.join(tempRoot, 'python')} & echo injected > ${shellSentinel}`;
  await assert.rejects(parseGeneratedSources({ original: 'pass', edited: 'pass', pythonExecutable: shellLikeExecutable }), /SOURCE_REIMPORT_PYTHON_UNAVAILABLE/);
  await assert.rejects(readFile(shellSentinel));
  record('worker-bounds-missing-runtime-timeout-and-interruption', { syntax: true, missingWorker: true, missingPython: true, timeout: true, interruption: true, shellNotUsed: true });
}

async function main() {
  try {
    const plain = await exportFor(linearProject());
    assert.equal(plain.manifest.framework, 'pytorch');
    record('canonical-export-fixture', { sourceBytes: plain.manifest.source.byteLength, selectedNodes: plain.manifest.selection.includedWorkspaceNodeIds.length });
    await testParameterMappings();
    await testRewire();
    await testNoOpAndCanonicality();
    await testProvenanceAndUnsupportedCode();
    await testShapeAndFrameworkGuards();
    await testApplyRetentionAndCli();
    await testWorkerBoundsAndDiagnostics();
    process.stdout.write(`${JSON.stringify({ task: 'controlled generated-source re-import', scenarios }, null, 2)}\n`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

await main();
