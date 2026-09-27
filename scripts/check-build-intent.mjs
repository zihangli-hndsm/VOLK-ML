import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { exerciseDatasets } from '../src/core/buildAgent/exerciseFixtures.js';
import {
  BUILD_INTENT_CONTRACT_VERSION,
  classifyUnsupportedBuildIntent,
  classifyBuildIntentLayerCount,
  createBuildDatasetContext,
  createGraphProposal,
  createLlmBuildIntentInterpreter,
  planBuildGoal,
  projectBuildIntentRequest,
  validateBuildIntentDecision,
} from '../src/core/buildAgent/index.js';
import { createProviderGateway } from '../src/core/ai/providerRegistry.js';
import { adaptBuildAgentGraphProposal } from '../src/core/graph/workspaceProposal.js';

const dataset = {
  ...structuredClone(exerciseDatasets.wine),
  name: 'private-dataset-name-sentinel',
  fileContents: 'private-file-content-sentinel',
  rows: exerciseDatasets.wine.rows.map((row, index) => ({
    ...row,
    secretColumn: `raw-cell-sentinel-${index}`,
  })),
};
const context = createBuildDatasetContext(dataset);
const requestId = 'build-intent-test-001';
const prompt = 'Use linear regression to predict wine quality from the numeric features.';
const validGoal = {
  task: 'regression',
  modelFamily: 'linear-regression',
  architecture: null,
  dataset: null,
  executionExpectation: 'browser-local',
  parameters: null,
};
const goalDecision = { version: BUILD_INTENT_CONTRACT_VERSION, kind: 'goal', goal: validGoal, code: null };

function expectCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code, `Expected ${code}.`);
}

const projected = projectBuildIntentRequest({ requestId, request: prompt, datasetContext: context });
assert.equal(projected.version, 1);
assert.equal(projected.requestId, requestId);
assert.equal(projected.request, prompt);
assert.equal(projected.dataset.sourceKind, 'workspace-dataset');
assert.equal(Object.hasOwn(projected.dataset, 'datasetFingerprint'), false);
assert.equal(Object.hasOwn(projected.dataset, 'rows'), false);
assert.equal(Object.hasOwn(projected.dataset, 'rawValues'), false);
for (const privateValue of ['private-dataset-name-sentinel', 'private-file-content-sentinel', 'raw-cell-sentinel']) {
  assert.equal(JSON.stringify(projected).includes(privateValue), false, `Projection leaked ${privateValue}.`);
}
expectCode(() => projectBuildIntentRequest({ requestId, request: 'build a model\n1,2,3', datasetContext: context }), 'BUILD_INTENT_REQUEST_INVALID');
expectCode(() => projectBuildIntentRequest({ requestId, request: prompt, datasetContext: { ...context, rows: [] } }), 'BUILD_DATASET_CONTEXT_INVALID');

assert.equal(classifyBuildIntentLayerCount('Build a two-layer MLP', null)?.kind, 'clarification');
assert.equal(classifyBuildIntentLayerCount('Build a two-layer MLP', { code: 'mlp-layer-count', choice: 'two-dense-total' }), null);
assert.equal(classifyBuildIntentLayerCount('Build an MLP with two hidden layers', null)?.kind, 'unsupported');
assert.equal(classifyBuildIntentLayerCount('Build an MLP with three hidden layers', null)?.kind, 'unsupported');
assert.equal(classifyBuildIntentLayerCount('Build a three-layer MLP', null)?.kind, 'unsupported');
assert.equal(classifyBuildIntentLayerCount('Build an MLP with six hidden layers', null)?.kind, 'unsupported');
assert.equal(classifyBuildIntentLayerCount('Build a six-layer MLP', null)?.kind, 'unsupported');
assert.equal(classifyBuildIntentLayerCount('Build an MLP with 12 layers', null)?.kind, 'unsupported');
assert.equal(classifyBuildIntentLayerCount('Build a 100000-layer MLP', null)?.kind, 'unsupported');
assert.equal(classifyBuildIntentLayerCount('Build a one hundred thousand layer MLP', null)?.kind, 'unsupported');
assert.equal(classifyBuildIntentLayerCount('构建一个具有六个隐藏层的 MLP', null)?.kind, 'unsupported');
assert.equal(classifyBuildIntentLayerCount('构建一个 8 层 MLP', null)?.kind, 'unsupported');
assert.equal(classifyBuildIntentLayerCount('构建一个一万层 MLP', null)?.kind, 'unsupported');
assert.equal(classifyBuildIntentLayerCount('构建一个两层 MLP', null)?.kind, 'clarification');
assert.equal(classifyBuildIntentLayerCount('构建一个两层 MLP，共两层全连接层：一层隐藏层和输出层', null), null);
assert.equal(classifyBuildIntentLayerCount('Build an MLP with two Dense layers total: one hidden plus output', null), null);
assert.equal(classifyBuildIntentLayerCount('Build an MLP with two Dense layers', null)?.kind, 'clarification');
assert.equal(classifyUnsupportedBuildIntent('Build a random forest model.')?.code, 'unsupported-model');
assert.equal(classifyUnsupportedBuildIntent('Build an MLP with hidden size 129.')?.code, 'unsupported-parameters');
assert.equal(classifyUnsupportedBuildIntent('Build an MLP with hidden size 100000.')?.code, 'unsupported-parameters');
assert.equal(classifyUnsupportedBuildIntent('Build an MLP with hidden size 32.5.')?.code, 'unsupported-parameters');
assert.equal(classifyUnsupportedBuildIntent('Build an MLP with hidden size -1.')?.code, 'unsupported-parameters');
assert.equal(classifyUnsupportedBuildIntent('Build an MLP with hidden size 32 and hidden size 16.')?.code, 'unsupported-parameters');
assert.equal(classifyUnsupportedBuildIntent('构建一个 MLP，隐藏单元数为 256。')?.code, 'unsupported-parameters');
assert.equal(classifyUnsupportedBuildIntent(prompt), null);

const checkedGoal = validateBuildIntentDecision(goalDecision, requestId, prompt);
assert.equal(checkedGoal.goal.goalId, requestId);
const checkedMlp = validateBuildIntentDecision({
  version: 1,
  kind: 'goal',
  code: null,
  goal: { task: 'regression', modelFamily: 'mlp', architecture: null, dataset: null, executionExpectation: 'browser-local', parameters: { hiddenUnits: 32, trainRatio: null, epochs: null, batchSize: null } },
}, `${requestId}-mlp`, 'Build a two-layer MLP to predict wine quality.');
assert.deepEqual(checkedMlp.goal.parameters, { hiddenUnits: 32 });
const explicitEnglishMlp = 'Build an MLP with hidden size 32.';
const explicitChineseMlp = '构建一个 MLP，隐藏单元数为 32。';
for (const [suffix, request] of [['english', explicitEnglishMlp], ['chinese', explicitChineseMlp]]) {
  const matchDecision = {
    version: 1, kind: 'goal', code: null,
    goal: { task: 'regression', modelFamily: 'mlp', architecture: null, dataset: null, executionExpectation: 'browser-local', parameters: { hiddenUnits: 32, trainRatio: null, epochs: null, batchSize: null } },
  };
  assert.equal(validateBuildIntentDecision(matchDecision, requestId + '-explicit-' + suffix, request).goal.parameters.hiddenUnits, 32);
  const mismatched = structuredClone(matchDecision);
  mismatched.goal.parameters.hiddenUnits = 6;
  expectCode(() => validateBuildIntentDecision(mismatched, requestId + '-mismatch-' + suffix, request), 'BUILD_INTENT_RESPONSE_INVALID');
  const omitted = structuredClone(matchDecision);
  omitted.goal.parameters = null;
  expectCode(() => validateBuildIntentDecision(omitted, requestId + '-omitted-' + suffix, request), 'BUILD_INTENT_RESPONSE_INVALID');
}
const omittedWidth = validateBuildIntentDecision({
  version: 1, kind: 'goal', code: null,
  goal: { task: 'regression', modelFamily: 'mlp', architecture: null, dataset: null, executionExpectation: 'browser-local', parameters: { hiddenUnits: 6, trainRatio: null, epochs: null, batchSize: null } },
}, requestId + '-default-width', 'Build an MLP.');
assert.equal(omittedWidth.goal.parameters.hiddenUnits, 6, 'Unspecified width may use the registered local default/proposal.');
expectCode(() => validateBuildIntentDecision({
  version: 1, kind: 'goal', code: null,
  goal: { task: 'regression', modelFamily: 'mlp', architecture: null, dataset: null, executionExpectation: 'browser-local', parameters: { hiddenUnits: 129, trainRatio: null, epochs: null, batchSize: null } },
}, requestId + '-out-of-range-width', 'Build an MLP.'), 'BUILD_CONTRACT_INVALID');
expectCode(() => validateBuildIntentDecision({
  version: 1, kind: 'goal', code: null,
  goal: { task: 'regression', modelFamily: 'mlp', architecture: null, dataset: null, executionExpectation: 'browser-local', parameters: { hiddenUnits: 32, trainRatio: 0.8, epochs: null, batchSize: null } },
}, requestId + '-split-mismatch', 'Build an MLP with train ratio 0.7.'), 'BUILD_INTENT_RESPONSE_INVALID');
expectCode(() => validateBuildIntentDecision({
  version: 1, kind: 'goal', code: null,
  goal: { task: 'regression', modelFamily: 'mlp', architecture: null, dataset: null, executionExpectation: 'browser-local', parameters: { hiddenUnits: 32, trainRatio: null, epochs: 250, batchSize: null } },
}, requestId + '-epoch-mismatch', '构建一个 MLP，训练轮数为 120。'), 'BUILD_INTENT_RESPONSE_INVALID');
const mlpPlan = planBuildGoal(checkedMlp.goal, context);
assert.equal(mlpPlan.kind, 'plan');
assert.equal(mlpPlan.plan.training.hiddenUnits, 32);
expectCode(() => validateBuildIntentDecision({ ...goalDecision, version: 2 }, requestId, prompt), 'BUILD_INTENT_VERSION_UNSUPPORTED');
expectCode(() => validateBuildIntentDecision({ ...goalDecision, extra: 'injection' }, requestId, prompt), 'BUILD_INTENT_RESPONSE_INVALID');
expectCode(() => validateBuildIntentDecision({ ...goalDecision, goal: { ...validGoal, modelFamily: 'mlp', architecture: 'explicit-mlp' } }, requestId, prompt), 'BUILD_INTENT_RESPONSE_INVALID');
expectCode(() => validateBuildIntentDecision({ ...goalDecision, goal: { ...validGoal, modelFamily: 'mlp', architecture: null } }, requestId, prompt), 'BUILD_INTENT_RESPONSE_INVALID');
expectCode(() => validateBuildIntentDecision({ ...goalDecision, goal: { ...validGoal, parameters: { hiddenUnits: 6, untrusted: true } } }, requestId, prompt), 'BUILD_INTENT_RESPONSE_INVALID');

const planned = planBuildGoal(checkedGoal.goal, context);
assert.equal(planned.kind, 'plan');
const detached = createGraphProposal({ plan: planned.plan, dataset, datasetContext: context });
const adapted = adaptBuildAgentGraphProposal(detached, { targetGraph: { nodes: [], edges: [] } });
assert.equal(adapted.ok, true);
assert.equal(adapted.proposal.source.producer, 'build-agent');
assert.equal(adapted.proposal.source.buildAgentProposal.requiresLearnerAcceptance, true);
assert.equal(adapted.proposal.source.buildAgentProposal.authority, 'detached-proposal');
assert.equal(adapted.proposal.graph.nodes.length > 0, true);

async function withServer(handler, run) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  try { return await run(`http://127.0.0.1:${address.port}/v1/chat/completions`, server); }
  finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

function chatResponse(content) {
  return JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] });
}

async function serveChatContent(content, run, { delayMs = 0 } = {}) {
  return withServer(async (req, res) => {
    req.resume();
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(chatResponse(content));
  }, run);
}

async function expectInterpreterFailure(content, code, options = {}) {
  let calls = 0;
  await serveChatContent(content, async (endpoint) => {
    const interpreter = createLlmBuildIntentInterpreter({ gateway: createProviderGateway() });
    await assert.rejects(interpreter.interpret({
      request: prompt,
      requestId: `${requestId}-${code}`,
      datasetContext: context,
      config: { protocol: 'openai-compatible', endpoint, model: 'fixture-model', apiKey: 'local-test-secret' },
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    }), (error) => error?.code === code);
  }, { delayMs: options.delayMs });
  return calls;
}

let unsupportedDepthCalls = 0;
await withServer(async (req, res) => {
  unsupportedDepthCalls += 1;
  req.resume();
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(chatResponse(goalDecision));
}, async (endpoint) => {
  const interpreter = createLlmBuildIntentInterpreter({ gateway: createProviderGateway() });
  const result = await interpreter.interpret({
    request: 'Build an MLP with six hidden layers and hidden size 32.',
    requestId: requestId + '-unsupported-depth',
    datasetContext: context,
    config: { protocol: 'openai-compatible', endpoint, model: 'fixture-model', apiKey: 'local-test-secret' },
  });
  assert.equal(result.kind, 'unsupported');
  assert.equal(result.code, 'unsupported-architecture');
  const outOfRange = await interpreter.interpret({
    request: 'Build an MLP with hidden size 129.',
    requestId: requestId + '-unsupported-width',
    datasetContext: context,
    config: { protocol: 'openai-compatible', endpoint, model: 'fixture-model', apiKey: 'local-test-secret' },
  });
  assert.equal(outOfRange.kind, 'unsupported');
  assert.equal(outOfRange.code, 'unsupported-parameters');
});
assert.equal(unsupportedDepthCalls, 0, 'Unsupported depth and width must be rejected before the provider boundary.');

let mismatchedParameterCalls = 0;
const mismatchedWidthDecision = {
  version: 1, kind: 'goal', code: null,
  goal: { task: 'regression', modelFamily: 'mlp', architecture: null, dataset: null, executionExpectation: 'browser-local', parameters: { hiddenUnits: 6, trainRatio: null, epochs: null, batchSize: null } },
};
await withServer(async (req, res) => {
  mismatchedParameterCalls += 1;
  req.resume();
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(chatResponse(mismatchedWidthDecision));
}, async (endpoint) => {
  const interpreter = createLlmBuildIntentInterpreter({ gateway: createProviderGateway() });
  await assert.rejects(interpreter.interpret({
    request: 'Build an MLP with hidden size 32.',
    requestId: requestId + '-provider-mismatch',
    datasetContext: context,
    config: { protocol: 'openai-compatible', endpoint, model: 'fixture-model', apiKey: 'local-test-secret' },
  }), (error) => error?.code === 'BUILD_INTENT_RESPONSE_INVALID');
});
assert.equal(mismatchedParameterCalls, 2, 'One bounded repair may be requested, but a repeated parameter mismatch must remain a failure.');

let received = null;
await withServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  received = { method: req.method, authorization: req.headers.authorization, body: JSON.parse(body) };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(goalDecision) } }], usage: { prompt_tokens: 17, completion_tokens: 20, total_tokens: 37 } }));
}, async (endpoint) => {
  const interpreter = createLlmBuildIntentInterpreter({ gateway: createProviderGateway() });
  const result = await interpreter.interpret({
    request: prompt,
    requestId,
    datasetContext: context,
    config: { protocol: 'openai-compatible', endpoint, model: 'fixture-model', apiKey: 'local-test-secret' },
  });
  assert.equal(result.kind, 'goal');
  assert.equal(result.source, 'provider');
  assert.equal(result.goal.goalId, requestId);
  assert.equal(result.attempts, 1);
});
assert.equal(received.method, 'POST');
assert.equal(received.authorization, 'Bearer local-test-secret');
assert.equal(JSON.stringify(received.body).includes('local-test-secret'), false);
assert.equal(JSON.stringify(received.body).includes('raw-cell-sentinel'), false);
assert.equal(JSON.stringify(received.body).includes('private-file-content-sentinel'), false);
assert.equal(JSON.stringify(received.body).includes(context.datasetFingerprint), false);
assert.equal(received.body.messages.some((message) => String(message.content).includes('datasetContext')), true);

await expectInterpreterFailure('{malformed', 'BUILD_INTENT_RESPONSE_INVALID');
await expectInterpreterFailure({ ...goalDecision, version: 99 }, 'BUILD_INTENT_VERSION_UNSUPPORTED');
await expectInterpreterFailure(goalDecision, 'AI_REQUEST_TIMEOUT', { timeoutMs: 30, delayMs: 250 });
const cancellation = new AbortController();
const cancelledRun = serveChatContent(goalDecision, async (endpoint) => {
  const interpreter = createLlmBuildIntentInterpreter({ gateway: createProviderGateway() });
  const pending = interpreter.interpret({
    request: prompt,
    requestId: `${requestId}-cancelled`,
    datasetContext: context,
    config: { protocol: 'openai-compatible', endpoint, model: 'fixture-model', apiKey: 'local-test-secret' },
    signal: cancellation.signal,
  });
  setTimeout(() => cancellation.abort(), 30);
  await assert.rejects(pending, (error) => error?.code === 'AI_REQUEST_CANCELLED');
}, { delayMs: 250 });
await cancelledRun;

const failingWorkspace = { graph: { nodes: [], edges: [] }, dataset: structuredClone(dataset), evidence: null };
const beforeFailure = structuredClone(failingWorkspace);
const offlineInterpreter = createLlmBuildIntentInterpreter({ gateway: createProviderGateway({ fetchImpl: async () => { throw new Error('offline'); } }) });
await assert.rejects(offlineInterpreter.interpret({
  request: prompt,
  requestId: `${requestId}-offline`,
  datasetContext: context,
  config: { protocol: 'openai-compatible', endpoint: 'http://127.0.0.1:9/unavailable', model: 'fixture-model', apiKey: 'local-test-secret' },
}), (error) => error?.code === 'AI_PROVIDER_UNAVAILABLE');
assert.deepEqual(failingWorkspace, beforeFailure, 'Provider failure must not mutate local workspace or Evidence.');

console.log('Build Intent v1 contract, privacy, planning, real HTTP gateway, and offline containment checks passed.');
