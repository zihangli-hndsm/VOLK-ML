import assert from 'node:assert/strict';
import { componentById, defaults } from '../src/core/components.js';
import { createProviderGateway } from '../src/core/ai/providerRegistry.js';
import { createAgentApplicationResultBinding } from '../src/core/agentApplicationApi.js';
import {
  GRAPH_EXPLANATION_DEPTHS,
  GRAPH_EXPLANATION_TECHNICALITY_PREFERENCES,
  analyzeProject,
  askExplanationAgent,
  buildGraphExplanationRequestV1,
  buildLocalDepthContent,
  currentGraphRunEvidenceV1,
  depthForDeclaredTechnicality,
  graphExplanationContextFingerprint,
  validateGraphExplanationResponseV1,
} from '../src/core/explanation.js';

function node(id, componentId, parameters = {}, extra = {}) {
  const manifest = componentById.get(componentId);
  assert.ok(manifest, `test component is registered: ${componentId}`);
  return {
    id,
    type: 'pipelineNode',
    position: { x: 20, y: 30 },
    data: { manifest, label: manifest.name, parameters: { ...defaults(manifest), ...parameters }, ...extra },
  };
}

function edge(source, sourceHandle, target, targetHandle, id = 'edge-private-id') {
  return { id, source, sourceHandle, target, targetHandle };
}

const baseNodes = [
  node('private-node-a', 'tabular_data_node'),
  node('private-node-b', 'train_test_split_node', { train_ratio: 0.8 }),
  node('private-node-c', 'linear_regression_node', { learning_rate: 0.01 }),
  node('private-node-d', 'evaluate_node'),
];
const baseEdges = [
  edge('private-node-a', 'dataset', 'private-node-b', 'dataset'),
  edge('private-node-b', 'split', 'private-node-c', 'split', 'another-private-edge-id'),
  edge('private-node-c', 'model', 'private-node-d', 'model'),
];
const runEvidence = {
  isCurrent: true,
  modelType: 'linear_regression',
  metrics: { rmse: 1.25, r2: 0.72, privateMetric: 99, sourceText: 'must not leave the client' },
};
const localDataset = {
  name: 'G1 sample dataset',
  rows: [{ feature: 0, target: 1 }, { feature: 1, target: 3 }, { feature: 2, target: 5 }],
  featureColumns: ['feature'],
  targetColumn: 'target',
  task: 'regression',
};
const localResultBinding = createAgentApplicationResultBinding({ nodes: baseNodes, edges: baseEdges, dataset: localDataset });
const boundRunEvidence = currentGraphRunEvidenceV1({
  nodes: baseNodes,
  edges: baseEdges,
  dataset: localDataset,
  model: { type: 'linear_regression', metrics: { rmse: 0.25 } },
  runtime: { status: 'succeeded' },
  resultBinding: localResultBinding,
});
assert.equal(boundRunEvidence?.isCurrent, true, 'a successful Run bound to the current graph and dataset is eligible evidence');
assert.equal(currentGraphRunEvidenceV1({
  nodes: baseNodes,
  edges: baseEdges,
  dataset: localDataset,
  model: { type: 'linear_regression', metrics: { rmse: 0.25 } },
  runtime: { status: 'succeeded' },
  resultBinding: { ...localResultBinding, datasetFingerprint: 'stale-dataset' },
}), null, 'dataset changes stale Run evidence');
assert.equal(currentGraphRunEvidenceV1({
  nodes: baseNodes.map((item) => ({ ...item, position: { x: 800, y: -100 } })),
  edges: baseEdges,
  dataset: localDataset,
  model: { type: 'linear_regression', metrics: { rmse: 0.25 } },
  runtime: { status: 'succeeded' },
  resultBinding: localResultBinding,
})?.isCurrent, true, 'presentation-only position changes do not stale Run evidence');
const graphBeforeLocalReading = structuredClone(baseNodes);
const edgesBeforeLocalReading = structuredClone(baseEdges);

assert.deepEqual(GRAPH_EXPLANATION_DEPTHS, ['phenomenon', 'evidence', 'mechanism', 'representation', 'math', 'code']);
assert.deepEqual(GRAPH_EXPLANATION_TECHNICALITY_PREFERENCES, ['big-picture', 'how-it-works', 'technical-detail']);
assert.equal(depthForDeclaredTechnicality('big-picture'), 'phenomenon', 'big-picture preference selects Phenomenon by default');
assert.equal(depthForDeclaredTechnicality('how-it-works'), 'mechanism', 'how-it-works preference selects Mechanism by default');
assert.equal(depthForDeclaredTechnicality('technical-detail'), 'math', 'technical-detail preference selects Math by default');
assert.throws(() => depthForDeclaredTechnicality('expert'), /GRAPH_EXPLANATION_TECHNICALITY_UNSUPPORTED/);
for (const depth of GRAPH_EXPLANATION_DEPTHS) {
  const content = buildLocalDepthContent({ nodes: baseNodes, edges: baseEdges, depth, runEvidence });
  assert.ok(content.analysis.nodeCount === baseNodes.length, `${depth} reads the canonical graph`);
}
assert.equal(buildLocalDepthContent({ nodes: baseNodes, edges: baseEdges, depth: 'math' }).lessons.length > 0, true);
assert.equal(buildLocalDepthContent({ nodes: baseNodes, edges: baseEdges, depth: 'evidence', runEvidence }).runEvidence.metrics.rmse, 1.25);
assert.equal(buildLocalDepthContent({ nodes: baseNodes, edges: baseEdges, depth: 'evidence', runEvidence: { ...runEvidence, isCurrent: false } }).runEvidence, null);
assert.deepEqual(baseNodes, graphBeforeLocalReading, 'local depths, including Code compilation, cannot mutate the graph');
assert.deepEqual(baseEdges, edgesBeforeLocalReading, 'local depths cannot mutate graph connections');
assert.throws(() => buildLocalDepthContent({ nodes: baseNodes, edges: baseEdges, depth: 'mastered' }), /GRAPH_EXPLANATION_DEPTH_UNSUPPORTED/);

const requestOptions = {
  nodes: baseNodes,
  edges: baseEdges,
  depth: 'evidence',
  question: 'Why does this result have this value?',
  language: 'en',
  runEvidence,
  requestId: 'g1-request-001',
};
const request = buildGraphExplanationRequestV1(requestOptions);
const viewOnlyRequest = buildGraphExplanationRequestV1({
  ...requestOptions,
  requestId: 'g1-view-only',
  nodes: baseNodes.map((item, index) => ({ ...structuredClone(item), position: { x: index * 500, y: index * -20 } })),
  edges: baseEdges.map((item, index) => ({ ...item, id: `view-edge-${index}` })),
});
assert.equal(graphExplanationContextFingerprint(viewOnlyRequest), graphExplanationContextFingerprint(request), 'view changes and new correlation IDs do not stale semantic explanations');
const otherDepthRequest = buildGraphExplanationRequestV1({ ...requestOptions, depth: 'mechanism', requestId: 'g1-other-depth' });
assert.notEqual(graphExplanationContextFingerprint(otherDepthRequest), graphExplanationContextFingerprint(request), 'depth changes stale an in-flight explanation');
const otherQuestionRequest = buildGraphExplanationRequestV1({ ...requestOptions, question: 'What is the mechanism?', requestId: 'g1-other-question' });
assert.notEqual(graphExplanationContextFingerprint(otherQuestionRequest), graphExplanationContextFingerprint(request), 'question changes stale an in-flight explanation');
assert.deepEqual(Object.keys(request), ['schemaVersion', 'requestId', 'depth', 'language', 'question', 'graph', 'facts', 'currentRun']);
assert.deepEqual(Object.keys(request.graph.nodes[0]), ['alias', 'operation', 'kind', 'settings']);
assert.deepEqual(request.graph.nodes.map((item) => item.operation), ['tabular_data', 'train_test_split', 'linear_regression', 'evaluate_regression'], 'registered steps follow graph flow order');
assert.ok(request.graph.nodes.every((item) => /^N\d+$/.test(item.alias)), 'request node identity is request-scoped alias only');
assert.ok(request.graph.connections.every((item) => /^E\d+$/.test(item.alias)), 'connections use request-scoped aliases');
assert.equal(request.facts.find((fact) => fact.id === 'run.metric.privateMetric'), undefined, 'unknown metrics are excluded');
assert.equal(request.facts.find((fact) => fact.id === 'run.metric.rmse').value, 1.25);
assert.equal(request.graph.nodes.some((item) => Object.hasOwn(item, 'id') || Object.hasOwn(item, 'position') || Object.hasOwn(item, 'label')), false);
const serializedRequest = JSON.stringify(request);
for (const privateValue of ['private-node-a', 'private-node-b', 'private-node-c', 'private-node-d', 'private-edge-id', 'another-private-edge-id', 'must not leave the client']) {
  assert.equal(serializedRequest.includes(privateValue), false, `request omits ${privateValue}`);
}
assert.throws(() => buildGraphExplanationRequestV1({ ...requestOptions, question: 'q'.repeat(501) }), /GRAPH_EXPLANATION_QUESTION_INVALID/);
assert.throws(() => buildGraphExplanationRequestV1({ ...requestOptions, depth: 'unknown' }), /GRAPH_EXPLANATION_DEPTH_UNSUPPORTED/);

const sourceNeutralProjection = (producer, xOffset) => buildGraphExplanationRequestV1({
  ...requestOptions,
  requestId: 'source-neutral',
  nodes: baseNodes.map((item, index) => ({
    ...structuredClone(item),
    id: `${producer}-node-${index}`,
    position: { x: xOffset + index * 10, y: xOffset - index * 3 },
    data: { ...structuredClone(item.data), producer, sourceMetadata: { importPath: 'private/path/model.py' } },
  })),
  edges: baseEdges.map((item, index) => ({
    ...item,
    id: `${producer}-edge-${index}`,
    source: `${producer}-node-${index}`,
    target: `${producer}-node-${index + 1}`,
  })),
});
const producerProjections = ['human', 'torch-export', 'onnx', 'lumi'].map((producer, index) => sourceNeutralProjection(producer, index * 100));
for (const projection of producerProjections.slice(1)) {
  assert.deepEqual(projection, producerProjections[0], 'producer metadata, canonical IDs, and layout do not affect explanation semantics');
}

const unregisteredManifest = {
  id: 'private-custom-composite', op: 'secret.operation', kind: 'custom-kind',
  name: { en: 'Customer entered name', zh: '用户输入名称' },
  description: { en: 'A customer supplied secret description', zh: '用户提供的秘密描述' },
  inputs: [], outputs: [], properties: [{ key: 'private-note', type: 'text' }],
};
const unregisteredNode = {
  id: 'secret-node-id', position: { x: 99, y: 99 }, type: 'pipelineNode',
  data: { manifest: unregisteredManifest, parameters: { 'private-note': 'private learner text' }, label: 'private UI label' },
};
const unknownRequest = buildGraphExplanationRequestV1({
  nodes: [...baseNodes, unregisteredNode], edges: baseEdges, depth: 'mechanism',
  question: 'Explain the graph', language: 'en', requestId: 'unknown-op',
});
assert.equal(unknownRequest.graph.nodes.find((item) => item.operation === 'unregistered')?.operation, 'unregistered');
for (const privateValue of ['Customer entered name', 'A customer supplied secret description', 'private learner text', 'private UI label', 'secret-node-id', 'private-custom-composite']) {
  assert.equal(JSON.stringify(unknownRequest).includes(privateValue), false, `unregistered user content is omitted: ${privateValue}`);
}

const goodReply = {
  schemaVersion: 1,
  requestId: request.requestId,
  depth: request.depth,
  explanation: 'The current run reports a finite RMSE.',
  factIds: ['run.metric.rmse'],
};
assert.deepEqual(validateGraphExplanationResponseV1(goodReply, request), goodReply);
for (const invalid of [
  { ...goodReply, requestId: 'stale-response' },
  { ...goodReply, depth: 'code' },
  { ...goodReply, schemaVersion: 2 },
  { ...goodReply, extra: true },
  { ...goodReply, factIds: ['graph.not-supplied'] },
  { ...goodReply, factIds: ['run.metric.rmse', 'run.metric.rmse'] },
  { ...goodReply, explanation: 'x'.repeat(1801) },
]) assert.throws(() => validateGraphExplanationResponseV1(invalid, request), /GRAPH_EXPLANATION_RESPONSE_INVALID/);

let capturedProviderBody = null;
const httpResponse = await askExplanationAgent({
  request,
  config: { protocol: 'openai-compatible', endpoint: 'https://provider.example/v1/chat/completions', model: 'g1-test', apiKey: 'g1-secret' },
  gateway: createProviderGateway({ fetchImpl: async (_url, options) => {
    capturedProviderBody = JSON.parse(options.body);
    const assistantReply = JSON.stringify({ ...goodReply, requestId: request.requestId });
    return { ok: true, json: async () => ({ choices: [{ message: { content: assistantReply } }] }) };
  } }),
});
assert.equal(httpResponse.explanation, goodReply.explanation, 'the real provider gateway returns a validated, correlated action');
const providerPrompt = capturedProviderBody.messages[1].content;
const requestMarker = 'Request: ';
const transportedProjection = JSON.parse(providerPrompt.slice(providerPrompt.lastIndexOf(requestMarker) + requestMarker.length));
assert.deepEqual(transportedProjection, request, 'the HTTP adapter transports the exact versioned semantic request projection');
assert.equal(JSON.stringify(capturedProviderBody).includes('g1-secret'), false, 'provider credentials never enter the request body');
for (const privateValue of ['private-node-a', 'private-edge-id', 'must not leave the client']) {
  assert.equal(JSON.stringify(capturedProviderBody).includes(privateValue), false, `provider transport omits ${privateValue}`);
}

const immutableNodes = structuredClone(baseNodes);
const immutableEdges = structuredClone(baseEdges);
const immutableModel = structuredClone(runEvidence);
await assert.rejects(askExplanationAgent({
  request,
  config: {},
  gateway: { complete: async () => { throw new Error('provider unavailable'); } },
}));
assert.deepEqual(baseNodes, immutableNodes, 'provider failure cannot mutate the workspace graph');
assert.deepEqual(baseEdges, immutableEdges, 'provider failure cannot mutate graph connections');
assert.deepEqual(runEvidence, immutableModel, 'provider failure cannot mutate deterministic local Run evidence');

console.log('Graph explanation depth checks passed.');
