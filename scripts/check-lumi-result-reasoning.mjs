import assert from 'node:assert/strict';
import {
  beginLumiRun,
  createLocalLumiResultReasoning,
  createLlmLumiResultReasoningPolicy,
  createLumiResultReasoningContext,
  projectLumiResultReasoningRequest,
  settleLumiRun,
  validateLumiResultReasoningResponse,
} from '../src/core/buildAgent/lumiResultReasoning.js';
const graph = {
  nodes: [
    { id: 'raw-node-id-secret', position: { x: 10, y: 20 }, data: { label: 'private graph label sentinel', manifest: { id: 'private-component-id', op: 'linear_regression', kind: 'model', properties: [
      { key: 'learning_rate', type: 'slider' },
      { key: 'expression', type: 'code' },
      { key: 'dtype', type: 'select', options: ['float32', 'int32'] },
      { key: 'shape', type: 'text' },
    ] }, parameters: { learning_rate: 0.05, expression: 'private-code-secret', dtype: 'float32', shape: '32, 8' } } },
    { id: 'second-node-id-secret', position: { x: 400, y: 20 }, data: { label: 'another private label', manifest: { id: 'trainer', op: 'gradient_descent', kind: 'training' }, parameters: { epochs: 10 } } },
  ],
  edges: [{ id: 'raw-edge-id-secret', source: 'raw-node-id-secret', sourceHandle: 'model', target: 'second-node-id-secret', targetHandle: 'model' }],
  customComponents: [],
};
const dataset = {
  name: 'private-dataset-name-sentinel',
  task: 'regression',
  featureColumns: ['feature_name_allowed'],
  targetColumn: 'target_name_allowed',
  rows: [{ feature_name_allowed: 'raw-cell-sentinel', target_name_allowed: 1234.56789 }],
};
const binding = { graphSemanticFingerprint: 'graph-semantic-v1-1234567890abcdef-a', datasetFingerprint: 'dataset-v1-1234567890abcdef-a' };
const runtime = {
  status: 'succeeded',
  result: { type: 'linear-regression', sourceNodeId: 'raw-source-node-secret', metrics: { rmse: 1.23456789, r2: 0.75 } },
  losses: [3, 2, 1],
  finishedAt: '2026-01-01T00:00:00.000Z',
};

let history = beginLumiRun([], { attemptId: 'attempt-1', binding, startedAt: '2026-01-01T00:00:00.000Z' });
history = settleLumiRun(history, 'attempt-1', { status: 'succeeded', model: runtime.result, losses: runtime.losses, finishedAt: runtime.finishedAt });
const evaluated = createLumiResultReasoningContext({ history, graph, dataset, runtime, resultBinding: binding, currentBinding: binding });
assert.equal(evaluated.current, true, 'A successful Run with matching semantic bindings is current.');
assert.equal(evaluated.context.currentRun.metrics.rmse, 1.23456789, 'Actual local metrics are retained in the local context.');
assert.equal(evaluated.context.currentRun.lossSummary.direction, 'decreased', 'Local loss trend is derived from the actual loss trace.');

const movedGraph = structuredClone(graph);
movedGraph.nodes[0].position.x = 900;
movedGraph.nodes[1].data.selected = true;
const movedProjection = createLumiResultReasoningContext({ history, graph: movedGraph, dataset, runtime, resultBinding: binding, currentBinding: binding });
assert.deepEqual(movedProjection.context.graph, evaluated.context.graph, 'Presentation-only graph movement/selection is excluded from semantic projection.');
assert.equal(movedProjection.current, true, 'Presentation changes do not make the semantic Run stale.');

const request = projectLumiResultReasoningRequest({ requestId: 'request-1', language: 'en', context: evaluated.context });
const requestJson = JSON.stringify(request);
for (const forbidden of ['raw-node-id-secret', 'raw-edge-id-secret', 'raw-source-node-secret', 'private graph label sentinel', 'private-dataset-name-sentinel', 'raw-cell-sentinel', '1234.56789', 'private-code-secret']) {
  assert.equal(requestJson.includes(forbidden), false, `Provider request excludes ${forbidden}.`);
}
assert.equal(request.inquiry.dataset.featureColumns[0].name, 'feature_name_allowed', 'Explicitly consented dataset column names are represented.');
assert.equal(request.inquiry.currentRun.metrics.rmse, runtime.result.metrics.rmse, 'The current semantic output values are projected for the opted-in policy.');
assert.deepEqual(request.inquiry.graph.nodes[0].properties, [
  { key: 'dtype', value: 'float32' },
  { key: 'learning_rate', value: 0.05 },
], 'Only typed numeric/boolean settings and declared enum selections enter the graph summary.');
assert.equal(request.inquiry.runHistory.length, 1, 'Bounded session history is included.');

const staleGraphBinding = { ...binding, graphSemanticFingerprint: 'graph-semantic-v1-abcdef0123456789-b' };
const stale = createLumiResultReasoningContext({ history, graph, dataset, runtime, resultBinding: binding, currentBinding: staleGraphBinding });
assert.equal(stale.current, false, 'A changed graph binding makes the old successful Run historical.');
assert.equal(stale.context.currentRun, null, 'Stale output values are not projected as current result facts.');
assert.equal(createLocalLumiResultReasoning(stale.context).kind, 'unavailable', 'A stale result is not locally interpreted as current.');

let changed = beginLumiRun(history, { attemptId: 'attempt-2', binding, startedAt: '2026-01-02T00:00:00.000Z' });
changed = settleLumiRun(changed, 'attempt-2', { status: 'failed', errorCode: 'INVALID_GRAPH', finishedAt: '2026-01-02T00:00:01.000Z' });
assert.equal(changed.length, 2, 'Failed Runs are included in session history.');
assert.equal(changed.at(-1).metrics && Object.keys(changed.at(-1).metrics).length, 0, 'Failed Runs retain no metrics or output values.');
assert.equal(changed.at(-1).errorCode, 'INVALID_GRAPH', 'Failed Runs retain only a bounded safe code.');
assert.equal(changed.at(-1).isCurrent, false, 'Failed Runs cannot be the current result.');
for (let index = 3; index <= 11; index += 1) {
  changed = beginLumiRun(changed, { attemptId: `attempt-${index}`, binding });
  changed = settleLumiRun(changed, `attempt-${index}`, { status: 'failed', errorCode: 'RUN_FAILED' });
}
assert.equal(changed.length, 8, 'Run history is bounded to the most recent eight attempts.');

const local = createLocalLumiResultReasoning(evaluated.context);
assert.equal(local.source, 'local', 'Local fallback works without a provider.');
assert(local.statements.some((statement) => statement.localKey === 'lumiResult.local.loss.decreased'), 'Local interpretation follows the actual observed loss direction.');
assert(local.suggestions.every((item) => ['inspect-loss', 'review-graph-layout'].includes(item.id) && item.authority === 'suggestion-only' && item.requiresLearnerAcceptance === true), 'Local suggestions use the fixed vocabulary and require learner acceptance.');

const allowedFactIds = evaluated.context.facts.map((fact) => fact.factId);
const response = {
  contract: 'LumiResultReasoningV1', version: 1, requestId: 'request-1', kind: 'reasoning',
  statements: [{ kind: 'observation', text: 'The recorded training loss decreased across this Run.', factIds: ['fact.loss.first', 'fact.loss.last'] }],
  suggestions: [{ id: 'inspect-loss', authority: 'suggestion-only', requiresLearnerAcceptance: true }], understanding: 'not-assessed',
};
const checked = validateLumiResultReasoningResponse(response, { requestId: 'request-1', allowedFactIds });
assert.equal(checked.source, 'provider', 'A correctly versioned and fact-grounded response is accepted.');
assert.equal(checked.suggestions[0].id, 'inspect-loss', 'Only a finite typed suggestion is accepted.');
assert.equal(checked.suggestions[0].requiresLearnerAcceptance, true, 'A typed suggestion cannot self-execute.');
for (const [candidate, code] of [
  [{ ...response, version: 2 }, 'LUMI_RESULT_VERSION_UNSUPPORTED'],
  [{ ...response, requestId: 'stale-id' }, 'LUMI_RESULT_RESPONSE_STALE'],
  [{ ...response, statements: [{ ...response.statements[0], factIds: ['fact.metric.not-supplied'] }] }, 'LUMI_RESULT_RESPONSE_UNGROUNDED'],
  [{ ...response, statements: [{ ...response.statements[0], text: 'The RMSE is 99.' }] }, 'LUMI_RESULT_RESPONSE_UNGROUNDED'],
  [{ ...response, statements: [{ ...response.statements[0], text: 'This proves the learner understands.' }] }, 'LUMI_RESULT_RESPONSE_UNGROUNDED'],
  [{ ...response, understanding: 'mastered' }, 'LUMI_RESULT_RESPONSE_INVALID'],
  [{ ...response, suggestions: [{ id: 'execute-run', authority: 'suggestion-only', requiresLearnerAcceptance: true }] }, 'LUMI_RESULT_RESPONSE_INVALID'],
  [{ ...response, suggestions: [{ id: 'review-graph-layout', authority: 'execute', requiresLearnerAcceptance: true }] }, 'LUMI_RESULT_RESPONSE_INVALID'],
  [{ ...response, mutation: { run: true } }, 'LUMI_RESULT_RESPONSE_INVALID'],
]) {
  assert.throws(() => validateLumiResultReasoningResponse(candidate, { requestId: 'request-1', allowedFactIds }), (error) => error.code === code);
}

const originalSerialized = JSON.stringify(evaluated.context);
let seenRequest = null;
const fakeGateway = {
  async complete({ messages }) {
    seenRequest = JSON.parse(messages.find((message) => message.role === 'user').content);
    return { text: JSON.stringify(response) };
  },
};
const policy = createLlmLumiResultReasoningPolicy({ gateway: fakeGateway, timeoutMs: 500 });
const providerResult = await policy.decide({ context: evaluated.context, requestId: 'request-1', config: { protocol: 'openai-compatible', endpoint: 'http://127.0.0.1:9999', model: 'fixture', apiKey: 'not-sent-in-body' }, consent: true });
assert.equal(providerResult.source, 'provider', 'Provider adapter returns a validated typed result.');
assert.equal(seenRequest.requestId, 'request-1', 'Provider request carries the correlation identity.');
assert.equal(JSON.stringify(seenRequest).includes('raw-cell-sentinel'), false, 'Provider request does not contain raw dataset cells.');
assert.equal(JSON.stringify(seenRequest).includes('not-sent-in-body'), false, 'Provider request body does not contain API credentials.');
assert.equal(JSON.stringify(evaluated.context), originalSerialized, 'Provider reasoning cannot mutate local result facts.');

const malformedPolicy = createLlmLumiResultReasoningPolicy({ gateway: { complete: async () => ({ text: '{malformed' }) }, timeoutMs: 500 });
await assert.rejects(() => malformedPolicy.decide({ context: evaluated.context, requestId: 'request-1', config: { protocol: 'openai-compatible', endpoint: 'http://127.0.0.1:9999', model: 'fixture', apiKey: 'key' }, consent: true }), (error) => error.code === 'LUMI_RESULT_RESPONSE_INVALID');
const offlinePolicy = createLlmLumiResultReasoningPolicy({ gateway: { complete: async () => { throw Object.assign(new Error('offline'), { code: 'AI_PROVIDER_UNAVAILABLE' }); } }, timeoutMs: 500 });
await assert.rejects(() => offlinePolicy.decide({ context: evaluated.context, requestId: 'request-1', config: { protocol: 'openai-compatible', endpoint: 'http://127.0.0.1:9999', model: 'fixture', apiKey: 'key' }, consent: true }), (error) => error.code === 'AI_PROVIDER_UNAVAILABLE');
const timeoutPolicy = createLlmLumiResultReasoningPolicy({ gateway: { complete: async () => new Promise(() => {}) }, timeoutMs: 10 });
await assert.rejects(() => timeoutPolicy.decide({ context: evaluated.context, requestId: 'request-1', config: { protocol: 'openai-compatible', endpoint: 'http://127.0.0.1:9999', model: 'fixture', apiKey: 'key' }, consent: true }), (error) => error.code === 'AI_REQUEST_TIMEOUT');

console.log('LUMI Result Reasoning contracts, current-result gating, privacy projection, fallback, timeout, and response validation passed.');
