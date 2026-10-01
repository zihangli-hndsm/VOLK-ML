import assert from 'node:assert/strict';
import { componentById, defaults } from '../src/core/components.js';
import {
  H2_LOCAL_PYTHON_COMPILER_VERSION,
  h2DatasetExecutionIdentityV1,
  projectH2LocalPythonRequestV2,
  validateH2LocalPythonRequestV2,
} from '../src/core/execution/h2LocalPython.js';
import { parseSupervisorOutput } from './h2-local-python/server.mjs';
import { h2ClassificationDropoutFixture, h2RegressionFixture } from './h2-local-python/test-fixtures.mjs';

function node(id, componentId, parameters = {}) {
  const manifest = componentById.get(componentId);
  return {
    id,
    position: { x: 12, y: 45 },
    data: { manifest, parameters: { ...defaults(manifest), ...parameters }, status: 'idle', selected: false },
  };
}

function edge(id, source, sourceHandle, target, targetHandle) {
  return { id, source, sourceHandle, target, targetHandle, selected: false, animated: false };
}

function regressionGraph({ reverseNodeLayout = false } = {}) {
  const nodes = [
    node('input', 'tensor_input_node', { shape: '2', dtype: 'float32' }),
    node('hidden', 'dense_node', { input_features: 2, units: 3, use_bias: true }),
    node('activation', 'tanh_node'),
    node('output-layer', 'dense_node', { input_features: 3, units: 1, use_bias: true }),
    node('model-output', 'model_output_node'),
    node('split', 'train_test_split_node', { train_ratio: 0.75 }),
    node('loss', 'mse_loss_node'),
    node('optimizer', 'adam_optimizer_node', { learning_rate: 0.015 }),
    node('trainer', 'supervised_trainer_node', { epochs: 5, batch_size: 3, shuffle: true }),
  ];
  const edges = [
    edge('e1', 'input', 'tensor', 'hidden', 'input'),
    edge('e2', 'hidden', 'output', 'activation', 'input'),
    edge('e3', 'activation', 'output', 'output-layer', 'input'),
    edge('e4', 'output-layer', 'output', 'model-output', 'input'),
    edge('e5', 'split', 'split', 'trainer', 'dataset'),
    edge('e6', 'model-output', 'model', 'trainer', 'model'),
    edge('e7', 'loss', 'loss', 'trainer', 'loss'),
    edge('e8', 'optimizer', 'optimizer', 'trainer', 'optimizer'),
  ];
  return { nodes: reverseNodeLayout ? nodes.map((item, index) => ({ ...item, position: { x: 900 - index, y: -index } })) : nodes, edges };
}

const dataset = {
  task: 'regression',
  featureColumns: ['x0', 'x1'],
  targetColumn: 'target',
  rows: [
    { x0: -1, x1: 0.5, target: -0.7 },
    { x0: -0.5, x1: -0.2, target: -0.8 },
    { x0: 0, x1: 0.3, target: -0.06 },
    { x0: 0.2, x1: -0.8, target: 0.72 },
    { x0: 0.5, x1: 0.9, target: -0.13 },
    { x0: 0.8, x1: -0.1, target: 0.76 },
    { x0: 1, x1: 0.4, target: 0.44 },
    { x0: 1.3, x1: -0.6, target: 1.62 },
  ],
};

const baseGraph = regressionGraph();
const request = await projectH2LocalPythonRequestV2({ sessionId: 'h2-check-session', ...baseGraph, dataset });
const validated = await validateH2LocalPythonRequestV2(request, { requireAuthorization: false });
assert.equal(request.schemaVersion, 'volk.h2.request.v2');
assert.equal(request.profile, 'h2-tabular-sequential-v1');
assert.equal(request.identity.compilerVersion, H2_LOCAL_PYTHON_COMPILER_VERSION);
assert.equal(request.identity.projectId, request.sessionId);
assert.equal(request.split.seed, 2026);
assert.deepEqual(request.split.trainIndices, [4, 6, 2, 5, 0, 7]);
assert.deepEqual(request.split.testIndices, [3, 1]);
assert.equal(validated.source.includes('weighted_loss += float(loss.detach()) * batch_rows'), true,
  'the canonical compiler emits sample-weighted H2 epoch losses');
assert.equal(validated.source.includes('generator=shuffle_generator if True else None'), true,
  'the H2 training profile uses the dedicated deterministic DataLoader generator');
assert.equal(validated.source.includes('load_tabular_data()'), true,
  'canonical source binds data through the fixed worker loader and does not embed rows');
assert.equal(validated.source.includes('-0.7'), false, 'raw data values never enter compiler output');
assert.equal(JSON.stringify(request).includes('position'), false, 'layout and presentation state are excluded from the request');
const supervisorResultContext = {
  cancelled: false, timedOut: false, childPid: null, setupFailed: false,
  supervisorExitCode: 1, jobMemoryLimitExceeded: false,
};
const malformedWorkerOutput = parseSupervisorOutput(Buffer.from('not-json'), Buffer.alloc(0), validated, {}, supervisorResultContext);
assert.equal(malformedWorkerOutput.status, 502);
assert.equal(malformedWorkerOutput.value.error.code, 'H2_WORKER_RESPONSE_INVALID',
  'malformed worker output remains distinct when there is no verified Job Object memory-limit event');
const unverifiedMemoryExit = parseSupervisorOutput(Buffer.alloc(0), Buffer.from(''), validated, {}, {
  ...supervisorResultContext, supervisorExitCode: 80,
});
assert.equal(unverifiedMemoryExit.value.error.code, 'H2_WORKER_RESPONSE_INVALID',
  'the supervisor exit code alone cannot classify empty output as a memory limit');
const verifiedMemoryExit = parseSupervisorOutput(Buffer.alloc(0), Buffer.from('H2_JOB_MEMORY_LIMIT_EXCEEDED'), validated, {}, {
  ...supervisorResultContext, supervisorExitCode: 80, jobMemoryLimitExceeded: true,
});
assert.equal(verifiedMemoryExit.status, 502);
assert.deepEqual(verifiedMemoryExit.value, {
  schemaVersion: 'volk.h2.response.v1', status: 'failed',
  error: { code: 'H2_PROCESS_MEMORY_LIMIT_EXCEEDED', message: 'H2_PROCESS_MEMORY_LIMIT_EXCEEDED' },
  lifecycle: { cancellationRequested: false, processTerminated: true, resultDiscarded: true },
}, 'only paired supervisor exit evidence plus the Job Object event produces the stable bounded resource diagnostic');

const numericStrings = structuredClone(h2RegressionFixture());
numericStrings.dataset.rows[0] = { ...numericStrings.dataset.rows[0], x0: ' -1.0 ', target: ' -0.7 ' };
const numericStringRequest = await projectH2LocalPythonRequestV2(numericStrings);
assert.equal(numericStringRequest.dataset.rows[0].features[0], -1, 'non-empty numeric text preserves established numeric parsing semantics');
assert.equal(numericStringRequest.dataset.rows[0].target, -0.7, 'non-empty numeric regression targets preserve established parsing semantics');

for (const value of [null, '', ' \t ', false]) {
  const invalidFeature = structuredClone(h2RegressionFixture());
  invalidFeature.dataset.rows[0].x0 = value;
  await assert.rejects(projectH2LocalPythonRequestV2(invalidFeature),
    (error) => error.code === 'H2_DATASET_NUMERIC_VALUE_INVALID',
    `invalid/missing numeric feature ${JSON.stringify(value)} is rejected rather than coerced to zero`);
  const invalidTarget = structuredClone(h2RegressionFixture());
  invalidTarget.dataset.rows[0].target = value;
  await assert.rejects(projectH2LocalPythonRequestV2(invalidTarget),
    (error) => error.code === 'H2_DATASET_NUMERIC_VALUE_INVALID',
    `invalid/missing regression target ${JSON.stringify(value)} is rejected rather than coerced to zero`);
}

const malformedInputShape = structuredClone(baseGraph);
malformedInputShape.nodes[0].data.parameters.shape = '2,3';
await assert.rejects(projectH2LocalPythonRequestV2({ sessionId: 'h2-check-session', ...malformedInputShape, dataset }),
  (error) => error.code === 'H2_GRAPH_INPUT_SHAPE_INVALID',
  'the entire Tensor Input shape must be rank one and match the dataset feature count');
const fractionalWidth = structuredClone(baseGraph);
fractionalWidth.nodes.find((item) => item.id === 'hidden').data.parameters.units = 3.5;
await assert.rejects(projectH2LocalPythonRequestV2({ sessionId: 'h2-check-session', ...fractionalWidth, dataset }),
  (error) => error.code === 'H2_GRAPH_LAYER_DIMENSION_INVALID',
  'Dense units must be supported integers');
const disconnectedWidths = structuredClone(baseGraph);
disconnectedWidths.nodes.find((item) => item.id === 'output-layer').data.parameters.input_features = 7;
await assert.rejects(projectH2LocalPythonRequestV2({ sessionId: 'h2-check-session', ...disconnectedWidths, dataset }),
  (error) => error.code === 'H2_GRAPH_LAYER_DIMENSION_MISMATCH',
  'each Dense input dimension must equal its connected predecessor output');

const wideHiddenWidth = 124;
const wideHiddenFixture = structuredClone(h2RegressionFixture());
const wideFeatureColumns = Array.from({ length: 64 }, (_, index) => `feature-${index}`);
wideHiddenFixture.nodes.find((item) => item.id === 'input').data.parameters.shape = '64';
wideHiddenFixture.nodes.find((item) => item.id === 'hidden').data.parameters = {
  input_features: 64, units: wideHiddenWidth, use_bias: true,
};
wideHiddenFixture.nodes.find((item) => item.id === 'output-layer').data.parameters = {
  input_features: wideHiddenWidth, units: 1, use_bias: true,
};
wideHiddenFixture.dataset = {
  task: 'regression', featureColumns: wideFeatureColumns, targetColumn: 'target',
  rows: wideHiddenFixture.dataset.rows.map((row) => ({
    ...Object.fromEntries(wideFeatureColumns.map((column, index) => [column, (index + Number(row.x0)) / 64])),
    target: row.target,
  })),
};
const wideHiddenParameters = 64 * wideHiddenWidth + wideHiddenWidth + wideHiddenWidth + 1;
assert.equal(wideHiddenParameters, 8185, 'the accepted wide-hidden fixture remains within the 8192-parameter budget');
const wideHiddenRequest = await projectH2LocalPythonRequestV2(wideHiddenFixture);
assert.equal(wideHiddenRequest.graph.nodes.find((item) => item.nodeId === 'output-layer').parameters.input_features, 124,
  'a downstream Dense may take the preceding in-profile 124-unit layer as input');
const wrongWideHiddenInput = structuredClone(wideHiddenFixture);
wrongWideHiddenInput.nodes.find((item) => item.id === 'output-layer').data.parameters.input_features = 123;
await assert.rejects(projectH2LocalPythonRequestV2(wrongWideHiddenInput),
  (error) => error.code === 'H2_GRAPH_LAYER_DIMENSION_MISMATCH',
  'a downstream width below the supported maximum is still rejected when it mismatches the prior layer');

const dropoutFixture = h2ClassificationDropoutFixture();
const dropoutDraft = await projectH2LocalPythonRequestV2(dropoutFixture);
const dropoutValidated = await validateH2LocalPythonRequestV2(dropoutDraft, { requireAuthorization: false });
assert.match(dropoutValidated.source, /nn\.Dropout\(p=0\.25\)/, 'the accepted dropout graph reaches the canonical model source');
assert.match(dropoutValidated.source, /model\.train\(\)/, 'compiled training enables Dropout during optimization');
assert.match(dropoutValidated.source, /nn\.CrossEntropyLoss\(\)/, 'the categorical profile compiles a classification objective');
assert.deepEqual(dropoutDraft.dataset.classVocabulary, [0, 1]);
assert.deepEqual(dropoutDraft.dataset.rows.map((row) => row.target), [0, 0, 0, 0, 1, 1, 1, 1]);
const renamedClasses = structuredClone(dropoutFixture);
renamedClasses.dataset.rows = renamedClasses.dataset.rows.map((row) => ({
  ...row,
  label: `renamed-${row.label}`,
}));
const renamedDraft = await projectH2LocalPythonRequestV2(renamedClasses);
const renamedAgain = await projectH2LocalPythonRequestV2(structuredClone(renamedClasses));
assert.deepEqual(renamedDraft.dataset.classVocabulary, ['renamed-0', 'renamed-1']);
assert.deepEqual(renamedDraft.dataset.classVocabulary, renamedAgain.dataset.classVocabulary, 'class mapping order is deterministic');
assert.deepEqual(renamedDraft.dataset.rows.map((row) => row.target), dropoutDraft.dataset.rows.map((row) => row.target),
  'renaming labels preserves deterministic integer class indices while retaining source vocabulary');
assert.notEqual(renamedDraft.identity.datasetFingerprint, dropoutDraft.identity.datasetFingerprint,
  'source-label vocabulary is included in dataset identity');
assert.notEqual(renamedDraft.identity.normalizedRequestFingerprint, dropoutDraft.identity.normalizedRequestFingerprint,
  'source-label vocabulary is included in normalized request identity');

const largeFeatureColumns = Array.from({ length: 64 }, (_, index) => `f${index}`);
const largeDataset = {
  task: 'regression', featureColumns: largeFeatureColumns, targetColumn: 'target',
  rows: Array.from({ length: 1200 }, (_, rowIndex) => ({
    ...Object.fromEntries(largeFeatureColumns.map((column, featureIndex) => [
      column, (rowIndex * 1_000_003 + featureIndex * 97_409 + 0.123456789) / 123.4567,
    ])),
    target: (rowIndex * 2_000_001 + 0.987654321) / 127.1234,
  })),
};
assert.ok(JSON.stringify(largeDataset).length > 500_000, 'the large H2 fixture exceeds the legacy generic artifact-fingerprint bound.');
const largeInputIdentity = await h2DatasetExecutionIdentityV1(largeDataset);
assert.match(largeInputIdentity, /^sha256:[a-f0-9]{64}$/, 'H2 execution identity supports its larger bounded semantic dataset.');

const movedRequest = await projectH2LocalPythonRequestV2({
  sessionId: 'h2-check-session', ...regressionGraph({ reverseNodeLayout: true }), dataset,
});
assert.deepEqual(movedRequest, request, 'changing view/layout does not alter H2 semantic identity');

const validAuthorization = {
  authorizationId: 'auth-check',
  requestFingerprint: request.identity.normalizedRequestFingerprint,
  expiresAt: new Date(Date.now() + 30_000).toISOString(),
  nonce: '0123456789abcdef0123456789abcdef',
};
await validateH2LocalPythonRequestV2({ ...request, authorization: validAuthorization });

await assert.rejects(
  validateH2LocalPythonRequestV2({ ...request, graph: { ...request.graph, layout: [] } }, { requireAuthorization: false }),
  (error) => error.code === 'H2_GRAPH_SCHEMA_INVALID',
  'closed graph schema rejects presentation state',
);
await assert.rejects(
  validateH2LocalPythonRequestV2({ ...request, graph: { ...request.graph, nodes: request.graph.nodes.map((item, index) => index ? item : ({ ...item, parameters: { ...item.parameters, arbitrary_python: 'raise Exception()' } })) } }, { requireAuthorization: false }),
  (error) => error.code === 'H2_GRAPH_PARAMETER_UNREGISTERED',
  'component parameters are checked against the live registry',
);
await assert.rejects(
  validateH2LocalPythonRequestV2({ ...request, authorization: { ...validAuthorization, requestFingerprint: '0'.repeat(64) } }),
  (error) => error.code === 'H2_AUTHORIZATION_INVALID',
  'approval cannot be detached from the normalized request',
);

const unsupportedNodeGraph = regressionGraph();
unsupportedNodeGraph.nodes.push(node('unsupported', 'conv2d_node'));
await assert.rejects(
  projectH2LocalPythonRequestV2({ sessionId: 'h2-check-session', ...unsupportedNodeGraph, dataset }),
  (error) => error.code === 'H2_GRAPH_COMPONENT_UNSUPPORTED',
  'unsupported and disconnected operations fail closed before execution',
);

process.stdout.write('H2 local Python contract, canonical graph, identity, and compiler checks passed.\n');
