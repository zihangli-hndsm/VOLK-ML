import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSourceReimport, finalizeSourceReimportProposal } from '../src/core/graph/sourceReimportProposal.js';
import { materializeTorchExportDocument, validateTorchExportDocument } from '../src/core/graph/torchExportAdapter.js';
import { createTorchExportGraphProposal } from '../src/core/graph/workspaceProposal.js';
import { commitWorkspaceGraphPatchApply, prepareWorkspaceGraphPatchApply } from '../src/core/graph/workspacePatchApply.js';
import { compileGraphWithSourceManifest, validateSourceExportManifest } from '../src/core/compiler.js';
import { graphSemanticFingerprintV1 } from '../src/core/graph/identity.js';
import { parseGeneratedSources } from './propose-source-reimport.mjs';
import { compareSemanticGraphs, evaluateSemanticRoundTrip } from './semantic-roundtrip-core.mjs';
import {
  createBranchAddRoundTripProject,
  createConv2dRoundTripProject,
  createLinearRoundTripProject,
  createMultipleInputRoundTripProject,
} from './semantic-roundtrip-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = path.join(root, 'scripts', 'semantic-roundtrip-python-worker.py');
const python = process.env.VOLK_E3_PYTHON;
const tempRoot = process.env.VOLK_E3_TMPDIR;
const MAX_WORKER_STDIO = 800_000;
const WORKER_TIMEOUT_MS = 60_000;
const cases = [];

function requireRuntimeConfiguration() {
  if (typeof python !== 'string' || !python || !existsSync(python) || !statSync(python).isFile()) {
    throw new Error('E3_RUNTIME_REQUIRED: Set VOLK_E3_PYTHON to an existing local CPU PyTorch interpreter.');
  }
  if (typeof tempRoot !== 'string' || !path.isAbsolute(tempRoot) || !existsSync(tempRoot) || !statSync(tempRoot).isDirectory()) {
    throw new Error('E3_TEMP_REQUIRED: Set VOLK_E3_TMPDIR to an existing temporary directory (D: for this acceptance run).');
  }
  process.env.VOLK_REIMPORT_PYTHON = python;
  process.env.PYTHONDONTWRITEBYTECODE = '1';
  process.env.TEMP = tempRoot;
  process.env.TMP = tempRoot;
  process.env.TMPDIR = tempRoot;
  const probe = spawnSync(python, ['-c', 'import json,platform,torch;print(json.dumps({"pythonVersion":platform.python_version(),"torchVersion":str(torch.__version__),"cuda":torch.version.cuda}))'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 16_000,
    env: workerEnvironment(),
  });
  if (probe.error || probe.status !== 0) throw new Error('E3_RUNTIME_REQUIRED: The configured interpreter must import its already-installed PyTorch package.');
  let runtime;
  try { runtime = JSON.parse(probe.stdout.trim()); } catch { throw new Error('E3_RUNTIME_PROBE_INVALID'); }
  if (!runtime.pythonVersion || !runtime.torchVersion) throw new Error('E3_RUNTIME_PROBE_INVALID');
  return runtime;
}

function workerEnvironment() {
  return {
    ...process.env,
    TEMP: tempRoot,
    TMP: tempRoot,
    TMPDIR: tempRoot,
    VOLK_E3_TMPDIR: tempRoot,
    PYTHONDONTWRITEBYTECODE: '1',
    CUDA_VISIBLE_DEVICES: '',
    OMP_NUM_THREADS: '1',
    MKL_NUM_THREADS: '1',
    OPENBLAS_NUM_THREADS: '1',
    TORCHINDUCTOR_CACHE_DIR: path.join(tempRoot, 'inductor'),
    TORCH_HOME: path.join(tempRoot, 'torch-home'),
    XDG_CACHE_HOME: path.join(tempRoot, 'xdg-cache'),
  };
}

function workerRequest({ caseId, source, sourceSha256, inputFeatureShapes, inputDtype = 'float32', dynamicBatch = true, batchMax = 256, sharedParameterFixture = false, viewTestModel = false }) {
  const dynamic = { enabled: dynamicBatch, min: 1, max: batchMax };
  if (sharedParameterFixture) {
    return {
      type: 'VolkSemanticRoundTripWorkerRequestV1',
      mode: 'trusted-shared-parameter-test-model',
      caseId,
      inputFeatureShapes: [[4]],
      inputDtype: 'float32',
      dynamicBatch: dynamic,
    };
  }
  if (viewTestModel) {
    return {
      type: 'VolkSemanticRoundTripWorkerRequestV1',
      mode: 'trusted-view-test-model',
      caseId,
      inputFeatureShapes: [[4]],
      inputDtype: 'float32',
      dynamicBatch: { enabled: false, min: 1, max: batchMax },
    };
  }
  return {
    type: 'VolkSemanticRoundTripWorkerRequestV1',
    mode: 'canonical-source',
    caseId,
    inputFeatureShapes,
    inputDtype,
    dynamicBatch: dynamic,
    source,
    sourceSha256,
  };
}

function runWorker(request) {
  const startedAt = Date.now();
  const child = spawnSync(python, [workerPath], {
    cwd: root,
    input: JSON.stringify(request),
    encoding: 'utf8',
    timeout: WORKER_TIMEOUT_MS,
    maxBuffer: MAX_WORKER_STDIO,
    env: workerEnvironment(),
  });
  const elapsedMs = Date.now() - startedAt;
  if (child.error || child.status === null) {
    return {
      type: 'VolkSemanticRoundTripWorkerResultV1',
      caseId: request.caseId,
      stage: child.error?.code === 'ETIMEDOUT' ? 'timeout' : 'worker',
      status: 'unverified',
      reasonCode: child.error?.code === 'ETIMEDOUT' ? 'E3_WORKER_TIMEOUT' : 'E3_WORKER_UNAVAILABLE',
      elapsedMs,
    };
  }
  let result;
  try { result = JSON.parse(child.stdout.trim()); } catch {
    return {
      type: 'VolkSemanticRoundTripWorkerResultV1',
      caseId: request.caseId,
      stage: 'worker-output',
      status: 'failed',
      reasonCode: 'E3_WORKER_OUTPUT_INVALID',
      exitCode: child.status,
      elapsedMs,
    };
  }
  return { ...result, exitCode: child.status, elapsedMs };
}

function inputShapesFromGraph(graph) {
  return graph.nodes.filter((node) => node.data.manifest.op === 'tensor_input')
    .map((node) => String(node.data.parameters.shape).split(',').map((value) => Number(value.trim())));
}

function inputDtypeFromGraph(graph) {
  return graph.nodes.find((node) => node.data.manifest.op === 'tensor_input')?.data.parameters.dtype ?? 'float32';
}

function selectedGraphFromManifest(graph, manifest) {
  const selectedIds = new Set(manifest.selection.includedWorkspaceNodeIds);
  return {
    nodes: graph.nodes.filter((node) => selectedIds.has(node.id)),
    edges: graph.edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target)),
    componentDefinitions: [],
  };
}

function resultBase(caseId, expected, details = {}) {
  return { caseId, expected, ...details };
}

async function runCanonicalRoundTrip(project, { caseId, dynamicBatch = true, batchMax = 256 } = {}) {
  const startedAt = Date.now();
  const fullGraph = project.graph;
  const bundle = await compileGraphWithSourceManifest(fullGraph.nodes, fullGraph.edges, 'pytorch');
  const sourceValidation = await validateSourceExportManifest({
    nodes: fullGraph.nodes,
    edges: fullGraph.edges,
    framework: 'pytorch',
    code: bundle.code,
    manifest: bundle.manifest,
  });
  assert.equal(sourceValidation.valid, true, sourceValidation.reason);
  const selectedGraph = selectedGraphFromManifest(fullGraph, bundle.manifest);
  const sourceSha256 = bundle.manifest.source.sha256;
  const selectedGraphFingerprint = graphSemanticFingerprintV1(selectedGraph);
  const request = workerRequest({
    caseId,
    source: bundle.code,
    sourceSha256: createHash('sha256').update(Buffer.from(bundle.code, 'utf8')).digest('hex'),
    inputFeatureShapes: inputShapesFromGraph(selectedGraph),
    inputDtype: inputDtypeFromGraph(selectedGraph),
    dynamicBatch,
    batchMax,
  });
  const worker = runWorker(request);
  const common = {
    caseId,
    elapsedMs: Date.now() - startedAt,
    e1: {
      workspaceGraphSha256: bundle.manifest.workspace.semanticGraphSha256,
      selectedGraphSha256: bundle.manifest.selection.semanticGraphSha256,
      sourceSha256,
      selectedGraphFingerprint,
      includedWorkspaceNodeIds: bundle.manifest.selection.includedWorkspaceNodeIds,
      excludedWorkspaceNodeIds: bundle.manifest.selection.excludedWorkspaceNodeIds,
    },
    worker: {
      status: worker.status,
      stage: worker.stage,
      reasonCode: worker.reasonCode ?? null,
      elapsedMs: worker.elapsedMs,
      exitCode: worker.exitCode,
      runtime: worker.runtime ?? null,
      forwardStatus: worker.forwardStatus ?? null,
      forwardErrorType: worker.forwardErrorType ?? null,
      parameterDtypes: worker.parameterDtypes ?? [],
      exportedOperatorTargets: worker.exportedOperatorTargets ?? [],
      origin: worker.origin ?? null,
    },
  };
  if (worker.status !== 'exported' || !worker.document) {
    return {
      ...common,
      status: worker.status === 'unsupported' ? 'unsupported' : 'unverified',
      rejection: { stage: worker.stage, code: worker.reasonCode },
      exportedOperatorTargets: worker.exportedOperatorTargets ?? [],
    };
  }

  let document;
  try {
    document = validateTorchExportDocument(worker.document);
  } catch (error) {
    return {
      ...common,
      status: 'unsupported',
      documentFingerprint: worker.document.documentFingerprint ?? null,
      exportedOperatorTargets: worker.exportedOperatorTargets ?? [],
      documentOperatorTargets: worker.document.graph.nodes.map((node) => node.target),
      rejection: { stage: 'b2-document-validation', code: error?.code ?? 'TORCH_EXPORT_DOCUMENT_INVALID' },
    };
  }
  const proposalResult = createTorchExportGraphProposal(document);
  if (!proposalResult.ok) {
    return {
      ...common,
      status: 'unsupported',
      documentFingerprint: document.documentFingerprint,
      exportedOperatorTargets: worker.exportedOperatorTargets ?? [],
      documentOperatorTargets: document.graph.nodes.map((node) => node.target),
      rejection: { stage: 'b2-proposal', code: proposalResult.diagnostics?.[0]?.code ?? 'TORCH_EXPORT_PROPOSAL_INVALID' },
    };
  }
  const graphB = materializeTorchExportDocument(document);
  const evaluation = evaluateSemanticRoundTrip({
    graphA: selectedGraph,
    graphB,
    document,
    workerObservation: {
      parameterDtypes: worker.parameterDtypes,
      forwardStatus: worker.forwardStatus,
      device: worker.runtime?.device,
    },
  });
  return {
    ...common,
    status: evaluation.status,
    metrics: evaluation.metrics,
    losses: evaluation.losses ?? [],
    observations: evaluation.observations ?? {},
    documentFingerprint: document.documentFingerprint,
    b2ProposalId: proposalResult.proposal.proposalId,
  };
}

function assertPositive(result, caseId) {
  assert.equal(result.status, 'structural-match-with-losses', `${caseId}: ${JSON.stringify(result.rejection ?? result.metrics)}`);
  for (const [metricName, metricValue] of Object.entries(result.metrics)) {
    if (['batchConstraints'].includes(metricName)) continue;
    assert.equal(metricValue.status, 'match', `${caseId}.${metricName}`);
  }
  assert.ok(result.losses.includes('batch_extent_and_range_not_carried'));
  assert.ok(result.losses.includes('trained_parameter_values_not_carried'));
  cases.push(resultBase(caseId, 'structural-match-with-losses', result));
}

function assertUnsupported(result, caseId, expectedStage = undefined) {
  assert.equal(result.status, 'unsupported', `${caseId} should fail closed: ${JSON.stringify(result)}`);
  if (expectedStage) assert.equal(result.rejection?.stage, expectedStage, `${caseId} rejection stage`);
  cases.push(resultBase(caseId, 'unsupported', result));
}

function addDeterministicMutationCases(project) {
  const graphA = project.graph;
  const activation = createLinearRoundTripProject({
    caseId: 'mutation-activation',
    inputFeatures: 4,
    layers: [
      { operation: 'dense', units: 6, useBias: true },
      { operation: 'sigmoid' },
      { operation: 'dense', units: 3, useBias: true },
    ],
  });
  const width = createLinearRoundTripProject({
    caseId: 'mutation-width',
    inputFeatures: 4,
    layers: [
      { operation: 'dense', units: 6, useBias: true },
      { operation: 'relu' },
      { operation: 'dense', units: 5, useBias: true },
    ],
  });
  const bias = createLinearRoundTripProject({
    caseId: 'mutation-bias',
    inputFeatures: 4,
    layers: [
      { operation: 'dense', units: 6, useBias: true },
      { operation: 'relu' },
      { operation: 'dense', units: 3, useBias: false },
    ],
  });
  for (const [caseId, other, fields] of [
    ['mutation-activation-same-count', activation.graph, ['operations']],
    ['mutation-width-and-shape', width.graph, ['constructorParameters', 'shapes']],
    ['mutation-bias-only', bias.graph, ['constructorParameters']],
  ]) {
    const comparison = compareSemanticGraphs(graphA, other);
    assert.equal(comparison.status, 'mismatch', caseId);
    for (const field of fields) assert.equal(comparison.metrics[field].status, 'mismatch', `${caseId}.${field}`);
    cases.push(resultBase(caseId, 'mismatch', { status: comparison.status, metrics: comparison.metrics }));
  }
  const badConnectivity = structuredClone(graphA);
  badConnectivity.edges[0].targetHandle = 'not-a-registered-port';
  const connectionResult = compareSemanticGraphs(graphA, badConnectivity);
  assert.equal(connectionResult.status, 'unsupported');
  cases.push(resultBase('mutation-typed-connectivity', 'unsupported', { status: connectionResult.status, reason: connectionResult.reason }));
  const dtype = createLinearRoundTripProject({ caseId: 'mutation-dtype', inputDtype: 'float16', layers: [{ operation: 'dense', units: 3, useBias: true }] });
  const dtypeResult = compareSemanticGraphs(graphA, dtype.graph);
  assert.equal(dtypeResult.metrics.dtype.status, 'mismatch');
  cases.push(resultBase('mutation-dtype', 'mismatch', { status: dtypeResult.status, metrics: dtypeResult.metrics }));
}

async function runE2ControlledEdit(originalProject) {
  const sourceBundle = await compileGraphWithSourceManifest(originalProject.graph.nodes, originalProject.graph.edges, 'pytorch');
  const before = 'nn.Linear(6, 3, bias=True)';
  const after = 'nn.Linear(6, 5, bias=True)';
  assert.equal(sourceBundle.code.split(before).length - 1, 1, 'E2 controlled edit fixture has one unique final Dense constructor.');
  const editedSource = sourceBundle.code.replace(before, after);
  const parsed = await parseGeneratedSources({ original: sourceBundle.code, edited: editedSource });
  const analyzed = await analyzeSourceReimport({
    project: originalProject,
    originalSource: sourceBundle.code,
    manifest: sourceBundle.manifest,
    editedSource,
    originalAst: parsed.original,
    editedAst: parsed.edited,
  });
  assert.equal(analyzed.ok, true, analyzed.diagnostics?.[0]?.code);
  const candidateAsts = await parseGeneratedSources({ original: analyzed.candidateSource, edited: editedSource });
  const finalized = finalizeSourceReimportProposal(analyzed, {
    candidateAst: candidateAsts.original,
    editedAst: candidateAsts.edited,
  });
  assert.equal(finalized.ok, true, finalized.diagnostics?.[0]?.code);
  assert.deepEqual(finalized.proposal.operations.map((operation) => operation.op), ['UPDATE_PARAMETERS']);
  assert.equal(finalized.proposal.operations[0].parameters.units, 5);
  const runtime = { status: 'idle', activeNodeIds: [], losses: [], result: null, error: null, startedAt: null, finishedAt: null };
  const prepared = prepareWorkspaceGraphPatchApply(finalized.proposal, { currentProject: originalProject, runtime });
  assert.equal(prepared.ok, true, prepared.diagnostics?.[0]?.code);
  const committed = commitWorkspaceGraphPatchApply(prepared, { currentProject: originalProject, runtime });
  assert.equal(committed.ok, true, committed.diagnostics?.[0]?.code);
  const nextSource = await compileGraphWithSourceManifest(committed.project.graph.nodes, committed.project.graph.edges, 'pytorch');
  const nextE1 = await validateSourceExportManifest({
    nodes: committed.project.graph.nodes,
    edges: committed.project.graph.edges,
    framework: 'pytorch',
    code: nextSource.code,
    manifest: nextSource.manifest,
  });
  assert.equal(nextE1.valid, true, nextE1.reason);
  const expectedDelta = compareSemanticGraphs(
    selectedGraphFromManifest(originalProject.graph, sourceBundle.manifest),
    selectedGraphFromManifest(committed.project.graph, nextSource.manifest),
  );
  assert.equal(expectedDelta.status, 'mismatch');
  assert.equal(expectedDelta.metrics.constructorParameters.status, 'mismatch');
  assert.equal(expectedDelta.metrics.shapes.status, 'mismatch');
  const roundTrip = await runCanonicalRoundTrip(committed.project, { caseId: 'e2-edited-dense-width' });
  assertPositive(roundTrip, 'e2-edited-dense-width');
  cases.push(resultBase('e2-controlled-edit-relation', 'one UPDATE_PARAMETERS then A-prime/B-prime match', {
    status: 'PASS',
    sourceMutationExecuted: false,
    c1Operation: finalized.proposal.operations[0].op,
    proposalId: finalized.proposal.proposalId,
    c2Commit: committed.ok,
    originalSourceSha256: sourceBundle.manifest.source.sha256,
    newSourceSha256: nextSource.manifest.source.sha256,
    expectedOriginalToEditedDelta: expectedDelta.metrics,
    editedRoundTrip: roundTrip,
  }));
}

function runSharedParameterNegative() {
  const request = workerRequest({
    caseId: 'shared-parameter-negative',
    sharedParameterFixture: true,
    dynamicBatch: true,
  });
  const worker = runWorker(request);
  assert.equal(worker.status, 'exported', JSON.stringify(worker));
  let rejection;
  try { validateTorchExportDocument(worker.document); } catch (error) { rejection = error?.code; }
  assert.equal(rejection, 'TORCH_EXPORT_STATE_INVALID', `Shared-parameter fixture: ${rejection}`);
  cases.push(resultBase('shared-parameter-test-model-variant', 'unsupported', {
    status: 'unsupported',
    origin: worker.origin,
    stage: 'b2-document-validation',
    reasonCode: rejection,
    runtime: worker.runtime,
    parameterDtypes: worker.parameterDtypes,
    elapsedMs: worker.elapsedMs,
  }));
}

function gitRevision() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5_000, maxBuffer: 4_000 });
  if (result.status !== 0) return 'unavailable';
  return result.stdout.trim();
}

async function main() {
  const preflight = requireRuntimeConfiguration();
  const revision = gitRevision();
  const positives = [
    {
      id: 'linear-with-bias',
      project: createLinearRoundTripProject({ caseId: 'linear-with-bias', layers: [{ operation: 'dense', units: 3, useBias: true }] }),
    },
    {
      id: 'linear-without-bias',
      project: createLinearRoundTripProject({ caseId: 'linear-without-bias', layers: [{ operation: 'dense', units: 3, useBias: false }] }),
    },
    {
      id: 'linear-relu-linear',
      project: createLinearRoundTripProject({ caseId: 'linear-relu-linear', layers: [
        { operation: 'dense', units: 6, useBias: true }, { operation: 'relu' }, { operation: 'dense', units: 3, useBias: true },
      ] }),
    },
    {
      id: 'linear-sigmoid',
      project: createLinearRoundTripProject({ caseId: 'linear-sigmoid', layers: [
        { operation: 'dense', units: 3, useBias: true }, { operation: 'sigmoid' },
      ] }),
    },
    {
      id: 'linear-tanh',
      project: createLinearRoundTripProject({ caseId: 'linear-tanh', layers: [
        { operation: 'dense', units: 3, useBias: true }, { operation: 'tanh' },
      ] }),
    },
    {
      id: 'linear-softmax-minus-one',
      project: createLinearRoundTripProject({ caseId: 'linear-softmax-minus-one', layers: [
        { operation: 'dense', units: 3, useBias: true }, { operation: 'softmax', axis: -1 },
      ] }),
    },
    {
      id: 'linear-softmax-axis-one',
      project: createLinearRoundTripProject({ caseId: 'linear-softmax-axis-one', layers: [
        { operation: 'dense', units: 3, useBias: true }, { operation: 'softmax', axis: 1 },
      ] }),
    },
    {
      id: 'mixed-supported-operators-dynamic-batch',
      project: createLinearRoundTripProject({ caseId: 'mixed-supported-operators-dynamic-batch', layers: [
        { operation: 'dense', units: 6, useBias: true }, { operation: 'relu' },
        { operation: 'dense', units: 3, useBias: true }, { operation: 'sigmoid' },
        { operation: 'tanh' }, { operation: 'softmax', axis: -1 },
      ] }),
    },
    {
      id: 'renamed-ids-and-layout',
      project: createLinearRoundTripProject({ caseId: 'renamed-ids-and-layout', positionOffset: 900, layers: [
        { operation: 'dense', units: 6, useBias: true }, { operation: 'relu' },
        { operation: 'dense', units: 3, useBias: true }, { operation: 'sigmoid' },
      ] }),
    },
    {
      id: 'orphan-excluded-by-e1-selection',
      project: createLinearRoundTripProject({ caseId: 'orphan-excluded-by-e1-selection', orphan: true, layers: [
        { operation: 'dense', units: 6, useBias: true }, { operation: 'relu' }, { operation: 'dense', units: 3, useBias: true },
      ] }),
    },
  ];
  const positiveById = new Map();
  for (const item of positives) {
    const result = await runCanonicalRoundTrip(item.project, { caseId: item.id, dynamicBatch: true });
    assertPositive(result, item.id);
    positiveById.set(item.id, result);
  }
  const orphan = positiveById.get('orphan-excluded-by-e1-selection');
  assert.ok(orphan.e1.excludedWorkspaceNodeIds.length > 0, 'An orphan is reported as excluded rather than silently counted as round-tripped.');
  cases[cases.length - 1] = { ...cases.at(-1), scope: { excludedWorkspaceNodeIds: orphan.e1.excludedWorkspaceNodeIds } };

  const base = positives.find((item) => item.id === 'linear-relu-linear').project;
  addDeterministicMutationCases(base);

  const negatives = [
    { id: 'gelu-unsupported-at-b2', project: createLinearRoundTripProject({ caseId: 'gelu-unsupported-at-b2', layers: [
      { operation: 'dense', units: 3, useBias: true }, { operation: 'gelu' },
    ] }), stage: 'b2-document-validation', code: 'TORCH_EXPORT_OPERATOR_UNSUPPORTED' },
    { id: 'conv2d-flatten-rank-four', project: createConv2dRoundTripProject({ caseId: 'conv2d-flatten-rank-four' }), stage: 'extractor', code: 'E3_EXTRACTOR_RANK_UNSUPPORTED' },
    { id: 'canonical-flatten-aten-target', project: createLinearRoundTripProject({ caseId: 'canonical-flatten-aten-target', layers: [
      { operation: 'flatten' }, { operation: 'dense', units: 3, useBias: true },
    ] }), stage: 'b2-document-validation', code: 'TORCH_EXPORT_OPERATOR_UNSUPPORTED', documentTarget: 'aten.flatten.using_ints' },
    { id: 'canonical-reshape-aten-target', project: createLinearRoundTripProject({ caseId: 'canonical-reshape-aten-target', layers: [
      { operation: 'reshape', shape: '4' }, { operation: 'dense', units: 3, useBias: true },
    ] }), stage: 'extractor', code: 'E3_EXTRACTOR_ARGUMENT_UNSUPPORTED', dynamicBatch: false, exportedTarget: 'aten.reshape.default' },
    { id: 'branched-add', project: createBranchAddRoundTripProject({ caseId: 'branched-add' }), stage: 'b2-document-validation', code: 'TORCH_EXPORT_OPERATOR_UNSUPPORTED' },
    { id: 'multiple-inputs', project: createMultipleInputRoundTripProject({ caseId: 'multiple-inputs' }), stage: 'b2-document-validation', code: 'TORCH_EXPORT_OPERATOR_UNSUPPORTED' },
    { id: 'multiple-outputs', project: createLinearRoundTripProject({ caseId: 'multiple-outputs', multipleOutputs: true, layers: [{ operation: 'dense', units: 3, useBias: true }] }), stage: 'extractor', code: 'E3_EXTRACTOR_OUTPUT_ARITY_UNSUPPORTED' },
    { id: 'incompatible-dense-input-dimension', project: createLinearRoundTripProject({ caseId: 'incompatible-dense-input-dimension', invalidDenseInputFeatures: true, layers: [{ operation: 'dense', units: 3, useBias: true }] }), stage: 'runtime-or-b2', code: null },
    { id: 'float16-not-silently-cast', project: createLinearRoundTripProject({ caseId: 'float16-not-silently-cast', inputDtype: 'float16', layers: [{ operation: 'dense', units: 3, useBias: true }] }), stage: 'b2-document-validation', code: 'TORCH_EXPORT_SHAPE_INVALID' },
    { id: 'batch-range-excludes-example', project: createLinearRoundTripProject({ caseId: 'batch-range-excludes-example', layers: [{ operation: 'dense', units: 3, useBias: true }] }), stage: 'torch-export', code: 'E3_TORCH_EXPORT_REJECTED', batchMax: 1 },
  ];
  for (const negative of negatives) {
    const result = await runCanonicalRoundTrip(negative.project, {
      caseId: negative.id,
      dynamicBatch: negative.dynamicBatch ?? true,
      batchMax: negative.batchMax ?? 256,
    });
    assertUnsupported(result, negative.id);
    if (negative.stage !== 'runtime-or-b2') assert.equal(result.rejection?.stage, negative.stage, negative.id);
    if (negative.code) assert.equal(result.rejection?.code, negative.code, negative.id);
    if (negative.documentTarget) {
      assert.ok(result.documentOperatorTargets?.includes(negative.documentTarget),
        `${negative.id} must reach B2 with the exact exported document target.`);
    }
    if (negative.exportedTarget) {
      assert.ok(result.exportedOperatorTargets?.includes(negative.exportedTarget),
        `${negative.id} must report the exact target emitted by real torch.export.`);
    }
  }
  const viewWorker = runWorker(workerRequest({
    caseId: 'view-test-model-variant',
    viewTestModel: true,
    dynamicBatch: false,
  }));
  assert.equal(viewWorker.status, 'unsupported', JSON.stringify(viewWorker));
  assert.equal(viewWorker.stage, 'extractor');
  assert.equal(viewWorker.reasonCode, 'E3_EXTRACTOR_ARGUMENT_UNSUPPORTED');
  assert.equal(viewWorker.origin, 'trusted-test-model-variant-not-Graph-A');
  assert.ok(viewWorker.exportedOperatorTargets.includes('aten.view.default'),
    'The fixed trusted test model must emit the exact real Torch Export view target.');
  cases.push(resultBase('view-test-model-variant', 'unsupported', {
    status: viewWorker.status,
    stage: viewWorker.stage,
    reasonCode: viewWorker.reasonCode,
    origin: viewWorker.origin,
    exportedOperatorTargets: viewWorker.exportedOperatorTargets,
    runtime: viewWorker.runtime,
    elapsedMs: viewWorker.elapsedMs,
  }));
  runSharedParameterNegative();

  const e2Project = createLinearRoundTripProject({ caseId: 'e2-roundtrip-source', layers: [
    { operation: 'dense', units: 6, useBias: true }, { operation: 'relu' }, { operation: 'dense', units: 3, useBias: true },
  ] });
  await runE2ControlledEdit(e2Project);

  process.stdout.write(`${JSON.stringify({
    type: 'VolkSemanticRoundTripEvaluationV1',
    version: 1,
    baseRevision: revision,
    branch: process.env.GITHUB_HEAD_REF ?? undefined,
    runtime: { ...preflight, device: 'cpu', threads: 1 },
    status: 'PASS',
    cases,
  }, null, 2)}\n`);
}

await main();
