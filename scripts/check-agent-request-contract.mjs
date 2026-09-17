import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGENT_REQUEST_CONTRACT_VERSION,
  AGENT_TASK_MODES,
  AGENT_OUTPUT_SETS,
  createAgentRequest,
  validateAgentRequest,
  projectAgentSemanticContext,
  classifyAgentFailure,
  runBoundedTask,
} from '../src/core/ai/agentRequestContract.js';
import { providerStructuredOutputCapability, createProviderGateway, normalizeStrictJsonSchema } from '../src/core/ai/providerRegistry.js';
import { classifyAiError, createAiDiagnostic } from '../src/core/ai/diagnostics.js';
import { LEARNING_ANSWER_SCHEMA, validateLearningAnswer, createLearningAssistant } from '../src/core/exploration/learningAssistant.js';
import { createExplorationAiInterpreter, explorationGuidanceResponseSchema } from '../src/core/exploration/explorationAiInterpreter.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { getWorldRecipePreset } from '../src/core/exploration/worldRecipePresets.js';

const semantic = {
  currentInquiry: 'episode-1',
  currentQuestion: 'What changes?',
  world: { id: 'world-1', task: 'regression', generator: { recipe: { version: 1 }, realization: { fingerprint: 'recipe-fp' } }, observations: [{ x: 1, y: 2 }] },
  experiment: { activeExperimentId: 'experiment-1', modelFamily: 'linear-regression' },
  comparison: { enabled: true, diff: { changed: ['sample'], unchanged: ['world'] } },
  recentSemanticEvents: [{ id: 'evt-1', type: 'comparison.completed', rawPointer: { x: 2 } }],
  pointer: { clientX: 12, clientY: 10 },
};

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

function providerPayload(protocol, text) {
  return protocol === 'openai-responses'
    ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }
    : { choices: [{ message: { content: text } }] };
}

function assertEveryStrictObjectPropertyIsRequired(schema, path = '$') {
  if (Array.isArray(schema)) {
    schema.forEach((value, index) => assertEveryStrictObjectPropertyIsRequired(value, `${path}[${index}]`));
    return;
  }
  if (!schema || typeof schema !== 'object') return;
  if (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    for (const [key, value] of Object.entries(schema.properties)) {
      assert.ok(required.has(key), `${path}.properties.${key} is required by the strict schema`);
      assertEveryStrictObjectPropertyIsRequired(value, `${path}.properties.${key}`);
    }
  }
  for (const [key, value] of Object.entries(schema)) {
    if (key !== 'properties') assertEveryStrictObjectPropertyIsRequired(value, `${path}.${key}`);
  }
}

async function callActualProvider({ protocol, taskMode, taskInput, text, responseSchema }) {
  let body = null;
  let calls = 0;
  const gateway = createProviderGateway({ fetchImpl: async (_endpoint, options) => {
    calls += 1;
    body = JSON.parse(options.body);
    return jsonResponse(providerPayload(protocol, text));
  } });
  const config = protocol === 'openai-responses'
    ? { protocol, model: 'fixture-model', apiKey: 'fixture-secret' }
    : { protocol, endpoint: 'https://fixture.invalid/v1/chat/completions', model: 'fixture-model', apiKey: 'fixture-secret' };
  const result = await gateway.complete({
    config,
    system: 'bounded fixture instruction',
    messages: [{ role: 'user', content: 'semantic request' }],
    responseMode: 'json',
    responseSchema,
    taskMode,
    taskContext: semantic,
    taskInput,
    requestId: `${taskMode}-${protocol}`,
  });
  return { result, body, calls, gateway };
}

for (const taskMode of Object.values(AGENT_TASK_MODES)) {
  const request = createAgentRequest({ taskMode, requestId: `${taskMode}-request`, context: semantic, input: { question: 'Bounded question', dom: '<button>' } });
  assert.equal(request.version, AGENT_REQUEST_CONTRACT_VERSION);
  assert.equal(request.task.outputSet, AGENT_OUTPUT_SETS[taskMode]);
  assert.equal(validateAgentRequest(request).valid, true);
  assert.equal(JSON.stringify(request).includes('clientX'), false, 'pointer state never enters a task request');
  assert.equal(JSON.stringify(request).includes('<button>'), false, 'DOM state never enters a task request');
}
assert.equal(validateAgentRequest({ ...createAgentRequest({ taskMode: AGENT_TASK_MODES.ASK, requestId: 'strict', context: {} }), opaque: true }).valid, false, 'unknown contract fields are rejected');
assert.equal(projectAgentSemanticContext(semantic).world.recipeVersion, 1, 'World edit context carries recipe version only');
assert.equal(validateAgentRequest({ ...createAgentRequest({ taskMode: AGENT_TASK_MODES.ASK, requestId: 'cross-output', context: {} }), task: { version: 1, mode: AGENT_TASK_MODES.ASK, outputSet: AGENT_OUTPUT_SETS[AGENT_TASK_MODES.WORLD_EDIT] } }).valid, false, 'cross-mode output sets are rejected');

assert.equal(providerStructuredOutputCapability({ protocol: 'openai-responses', model: 'm', apiKey: 'k' }), 'schema');
assert.equal(providerStructuredOutputCapability({ protocol: 'openai-compatible', model: 'm', apiKey: 'k' }), 'json-only');
assert.equal(providerStructuredOutputCapability({ vendorId: 'anthropic', protocol: 'anthropic-compatible', model: 'm', apiKey: 'k' }), 'prompt-json');
assert.equal(providerStructuredOutputCapability({ protocol: 'openai-responses', endpoint: 'https://unknown.invalid/v1/responses', model: 'm', apiKey: 'k' }), 'json-only', 'unknown endpoints are not assumed to support native strict schemas');

let body = null;
const gateway = createProviderGateway({ fetchImpl: async (_url, options) => {
  body = JSON.parse(options.body);
  return { ok: true, status: 200, async json() { return { choices: [{ message: { content: '{"answer":"ok"}' } }] }; } };
} });
await gateway.complete({
  config: { protocol: 'openai-compatible', endpoint: 'https://fixture.invalid/v1/chat/completions', model: 'fixture', apiKey: 'secret' },
  taskMode: AGENT_TASK_MODES.ASK,
  taskContext: semantic,
  taskInput: { question: 'Why?' },
  requestId: 'contract-request',
  responseMode: 'json',
  messages: [{ role: 'user', content: 'Return the answer.' }],
});
assert.match(body.messages[0].content, /semantic task contract v1/);
assert.match(body.messages[0].content, /taskMode=ask/);
assert.match(body.messages[0].content, /Task rules:/);
assert.match(body.messages[0].content, /Valid output example:/);
assert.equal(JSON.stringify(body).includes('secret'), false, 'credentials never enter provider payload');

const providerModeFixtures = {
  [AGENT_TASK_MODES.ASK]: {
    input: { question: 'Explain the evidence.' },
    text: JSON.stringify({ answer: 'The bounded fixture answer.', tryExperiment: null, depth: null }),
    schema: LEARNING_ANSWER_SCHEMA,
  },
  [AGENT_TASK_MODES.EXPERIMENT_DESIGN]: {
    input: { question: 'What comparison should I make?' },
    text: JSON.stringify({ kind: 'clarification', topic: null, explanation: null, depth: null, intent: null, requestedChange: null, requestedHolds: [], design: null, experimentDesign: null, reason: 'Clarify one bounded comparison.', ambiguity: null }),
    schema: { name: 'experiment-fixture', schema: explorationGuidanceResponseSchema({ availableDepths: ['evidence'], taskMode: AGENT_TASK_MODES.EXPERIMENT_DESIGN }) },
  },
  [AGENT_TASK_MODES.WORLD_EDIT]: {
    input: { requestedChange: 'increase noise', mode: 'edit', patchVersion: 1 },
    text: JSON.stringify({ kind: 'world-design', topic: null, explanation: null, depth: null, intent: null, requestedChange: null, requestedHolds: [], design: { mode: 'edit', recipe: null, patch: { version: 1, changes: [{ type: 'SET_NOISE', split: 'train', kind: 'position', amount: 0.1 }] } }, experimentDesign: null, reason: null, ambiguity: null }),
    schema: { name: 'world-fixture', schema: explorationGuidanceResponseSchema({ availableDepths: ['evidence'], taskMode: AGENT_TASK_MODES.WORLD_EDIT }) },
  },
};
for (const protocol of ['openai-compatible', 'openai-responses']) {
  for (const taskMode of Object.values(AGENT_TASK_MODES)) {
    const fixture = providerModeFixtures[taskMode];
    const actual = await callActualProvider({ protocol, taskMode, taskInput: fixture.input, text: fixture.text, responseSchema: fixture.schema });
    assert.equal(actual.calls, 1, `${protocol}/${taskMode} uses one bounded provider call`);
    const serialized = JSON.stringify(actual.body);
    assert.match(serialized, new RegExp(`taskMode=${taskMode}`));
    assert.match(serialized, /Task rules:/);
    assert.match(serialized, /Valid output example:/);
    if (protocol === 'openai-responses') {
      assert.equal(actual.body.text?.format?.type, 'json_schema', `${taskMode} uses native strict schema on the known schema-capable path`);
      assert.equal(actual.body.text?.format?.strict, true);
      assert.deepEqual(actual.body.text.format.schema, normalizeStrictJsonSchema(fixture.schema.schema));
      assertEveryStrictObjectPropertyIsRequired(actual.body.text.format.schema, `${taskMode}.strictSchema`);
    } else {
      assert.deepEqual(actual.body.response_format, { type: 'json_object' }, `${taskMode} uses JSON mode on the JSON-only path`);
    }
    assert.equal(actual.result.text, fixture.text);
  }
}
let unknownEndpointBody = null;
const unknownEndpointGateway = createProviderGateway({ fetchImpl: async (_url, options) => {
  unknownEndpointBody = JSON.parse(options.body);
  return jsonResponse(providerPayload('openai-responses', providerModeFixtures[AGENT_TASK_MODES.ASK].text));
} });
await unknownEndpointGateway.complete({
  config: { protocol: 'openai-responses', endpoint: 'https://unknown.invalid/v1/responses', model: 'fixture', apiKey: 'fixture-secret' },
  taskMode: AGENT_TASK_MODES.ASK,
  taskContext: semantic,
  taskInput: { question: 'Unknown endpoint' },
  requestId: 'unknown-endpoint',
  responseMode: 'json',
  responseSchema: providerModeFixtures[AGENT_TASK_MODES.ASK].schema,
});
assert.equal(unknownEndpointBody.text, undefined, 'unknown endpoint is not forced into native strict schema mode');
assert.match(unknownEndpointBody.instructions, /Valid output example:/);

const nativeResponseGateway = createProviderGateway({ fetchImpl: async () => new Response(JSON.stringify(providerPayload('openai-responses', providerModeFixtures[AGENT_TASK_MODES.ASK].text)), { status: 200, headers: { 'content-type': 'application/json' } }) });
const nativeResponseResult = await nativeResponseGateway.complete({
  config: { protocol: 'openai-responses', model: 'fixture', apiKey: 'fixture-secret' },
  taskMode: AGENT_TASK_MODES.ASK,
  taskContext: semantic,
  taskInput: { question: 'native response' },
  requestId: 'native-response',
  responseMode: 'json',
  responseSchema: providerModeFixtures[AGENT_TASK_MODES.ASK].schema,
});
assert.equal(nativeResponseResult.text, providerModeFixtures[AGENT_TASK_MODES.ASK].text, 'native Fetch Response remains usable through the attempt facade');

let fallbackUsageCalls = 0;
const publishedUsageSummaries = [];
const fallbackUsageGateway = createProviderGateway({ fetchImpl: async (_url, options) => {
  fallbackUsageCalls += 1;
  const request = JSON.parse(options.body);
  if (fallbackUsageCalls === 1) {
    assert.deepEqual(request.response_format, { type: 'json_object' }, 'first physical request uses JSON mode before compatibility fallback');
    return jsonResponse({
      error: { message: 'response_format json_object is not supported' },
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    }, 400);
  }
  assert.equal(request.response_format, undefined, 'fallback physical request omits unsupported JSON mode');
  return jsonResponse({
    choices: [{ message: { content: providerModeFixtures[AGENT_TASK_MODES.ASK].text } }],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
  });
} });
const stopUsageSubscription = fallbackUsageGateway.subscribeUsage((summary) => publishedUsageSummaries.push(summary));
await fallbackUsageGateway.complete({
  config: { protocol: 'openai-compatible', endpoint: 'https://fixture.invalid/v1/chat/completions', model: 'fixture', apiKey: 'fixture-secret' },
  taskMode: AGENT_TASK_MODES.ASK,
  taskContext: semantic,
  taskInput: { question: 'Account for the JSON fallback.' },
  requestId: 'usage-fallback',
  responseMode: 'json',
  responseSchema: LEARNING_ANSWER_SCHEMA,
});
stopUsageSubscription();
const fallbackUsageSummary = fallbackUsageGateway.getUsageSummary();
assert.equal(fallbackUsageCalls, 2, 'compatibility fallback uses two physical provider requests');
assert.equal(fallbackUsageSummary.requestCount, 1, 'usage UI retains one logical learner request');
assert.equal(fallbackUsageGateway.getAttemptUsageRecords().length, 2, 'physical attempt accounting remains separately inspectable');
assert.equal(fallbackUsageSummary.reportedUsageCalls, 2, 'usage UI counts both physical provider reports');
assert.equal(fallbackUsageSummary.inputTokens, 8, 'usage UI aggregates physical input token reports');
assert.equal(fallbackUsageSummary.outputTokens, 3, 'usage UI aggregates physical output token reports');
assert.equal(fallbackUsageSummary.totalTokens, 11, 'usage UI aggregates physical total token reports');
assert.equal(publishedUsageSummaries.at(-1)?.totalTokens, 11, 'usage subscriptions receive physical-attempt totals');
assert.equal(publishedUsageSummaries.at(-1)?.requestCount, 1, 'usage subscriptions retain the logical request count');

const malformedAnswer = validateLearningAnswer({ answer: 'valid body', tryExperiment: { design: { goal: 'unknown' } }, depth: null });
assert.equal(malformedAnswer.tryExperiment, null, 'invalid optional suggestion is unavailable, not executable');
assert.equal(malformedAnswer.suggestionUnavailable, true);
assert.deepEqual(validateLearningAnswer({ answer: 'legacy body' }), { version: 1, answer: 'legacy body', tryExperiment: null, depth: null });
assert.throws(() => validateLearningAnswer({ answer: 'bad operation', tryExperiment: { operation: 'RUN' }, depth: null }), /AI_LEARNING_ANSWER_INVALID/);

assert.equal(classifyAgentFailure({ code: 'AI_LEARNING_ANSWER_INVALID' }), 'answer-validation');
assert.equal(classifyAgentFailure({ code: 'AI_PROVIDER_RESPONSE_INVALID' }), 'parse');
assert.equal(classifyAgentFailure({ code: 'AI_PROVIDER_REQUEST_FAILED', details: { status: 422 } }), 'http');
assert.equal(classifyAgentFailure({ code: 'AI_PROVIDER_UNAVAILABLE' }), 'network');
assert.equal(classifyAgentFailure({ code: 'AI_REQUEST_CANCELLED' }), 'cancel');
assert.equal(classifyAiError({ code: 'AI_LEARNING_ANSWER_INVALID' }), 'AI_ANSWER_INVALID');
assert.equal(classifyAiError(new Error('synthetic unknown')), 'AI_UNKNOWN_FAILURE', 'unknown errors have an explicit unknown diagnostic');
assert.equal(createAiDiagnostic({ error: { code: 'AI_LEARNING_ANSWER_INVALID', details: { fieldPath: 'tryExperiment', cause: 'shape' } }, stage: 'interpreter-validation' }).fieldPath, 'tryExperiment');

let attempts = 0;
const repaired = await runBoundedTask({
  taskMode: AGENT_TASK_MODES.ASK,
  requestId: 'repair-request',
  execute: async () => { attempts += 1; if (attempts === 1) { const error = new Error('invalid'); error.code = 'AI_LEARNING_ANSWER_INVALID'; throw error; } return 'ok'; },
  validate: (value) => value,
});
assert.equal(repaired.value, 'ok');
assert.equal(attempts, 2, 'one business-validation repair is allowed');
attempts = 0;
await assert.rejects(() => runBoundedTask({ execute: async () => { attempts += 1; const error = new Error('offline'); error.code = 'AI_PROVIDER_UNAVAILABLE'; throw error; } }), /offline/);
assert.equal(attempts, 1, 'network failures are never repaired');
attempts = 0;
await assert.rejects(() => runBoundedTask({ execute: async () => { attempts += 1; throw new Error('synthetic unknown'); } }), /synthetic unknown/);
assert.equal(attempts, 1, 'unknown/internal failures are never treated as repairable output validation');

let cancellationCalls = 0;
const cancellationGateway = createProviderGateway({ fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
  cancellationCalls += 1;
  signal?.addEventListener('abort', () => { const error = new Error('fixture abort'); error.name = 'AbortError'; reject(error); }, { once: true });
}) });
const cancellationController = new AbortController();
const cancellationRequest = cancellationGateway.complete({
  config: { protocol: 'openai-compatible', endpoint: 'https://fixture.invalid/v1/chat/completions', model: 'fixture', apiKey: 'fixture-secret' },
  taskMode: AGENT_TASK_MODES.ASK,
  taskContext: semantic,
  taskInput: { question: 'cancel me' },
  requestId: 'cancel-request',
  responseMode: 'json',
  responseSchema: providerModeFixtures[AGENT_TASK_MODES.ASK].schema,
  signal: cancellationController.signal,
});
cancellationController.abort();
await assert.rejects(cancellationRequest, (error) => error.code === 'AI_REQUEST_CANCELLED' && error.details?.cause === 'request-aborted');
assert.equal(cancellationCalls, 1, 'active cancellation reaches the adapter exactly once');
assert.equal(classifyAiError({ code: 'AI_REQUEST_CANCELLED' }), 'AI_CANCELLED');

async function captureGatewayFailure({ protocol = 'openai-compatible', fetchImpl }) {
  let calls = 0;
  const failureGateway = createProviderGateway({ fetchImpl: async (...args) => { calls += 1; return fetchImpl(...args); } });
  const config = protocol === 'openai-responses'
    ? { protocol, model: 'fixture', apiKey: 'fixture-secret' }
    : { protocol, endpoint: 'https://fixture.invalid/v1/chat/completions', model: 'fixture', apiKey: 'fixture-secret' };
  let error = null;
  try { await failureGateway.complete({ config, system: 'full learner prompt fixture-secret', messages: [{ role: 'user', content: 'opaque prompt fixture-secret' }] }); } catch (caught) { error = caught; }
  return { error, calls, gateway: failureGateway };
}

const transportFailure = await captureGatewayFailure({ fetchImpl: async () => { throw new Error('socket failed with full learner prompt fixture-secret'); } });
assert.equal(transportFailure.calls, 1);
assert.equal(classifyAiError(transportFailure.error), 'AI_NETWORK_OR_CORS');
const matrixStatuses = [[401, 'AI_AUTH_FAILED'], [403, 'AI_AUTH_FAILED'], [429, 'AI_RATE_LIMITED'], [503, 'AI_HTTP_FAILED']];
for (const [status, expected] of matrixStatuses) {
  const failed = await captureGatewayFailure({ fetchImpl: async () => jsonResponse({ error: { message: 'provider payload fixture-secret' } }, status) });
  assert.equal(failed.calls, 1, `HTTP ${status} uses one provider call`);
  assert.equal(classifyAiError(failed.error), expected, `HTTP ${status} diagnostic classification`);
}
const empty = await captureGatewayFailure({ fetchImpl: async () => jsonResponse({ choices: [{ message: { content: '' } }] }) });
assert.equal(classifyAiError(empty.error), 'AI_OUTPUT_MISSING');
const incomplete = await captureGatewayFailure({ protocol: 'openai-responses', fetchImpl: async () => jsonResponse({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }) });
assert.equal(classifyAiError(incomplete.error), 'AI_TIMEOUT');
const invalidJson = await captureGatewayFailure({ fetchImpl: async () => ({ ok: true, status: 200, async json() { throw new Error('malformed full prompt fixture-secret'); } }) });
assert.equal(classifyAiError(invalidJson.error), 'AI_RESPONSE_INVALID');
const unknownDiagnostic = createAiDiagnostic({ error: new Error('unknown internal failure full prompt fixture-secret'), config: { protocol: 'openai-compatible', apiKey: 'fixture-secret' }, stage: 'failed' });
assert.equal(unknownDiagnostic.errorCode, 'AI_UNKNOWN_FAILURE');
assert.equal(JSON.stringify(unknownDiagnostic).includes('full prompt'), false, 'safe diagnostics never retain prompts');
assert.equal(JSON.stringify(unknownDiagnostic).includes('fixture-secret'), false, 'safe diagnostics never retain credentials');
const truncatedDiagnostic = createAiDiagnostic({ error: { code: 'AI_PROVIDER_RESPONSE_INVALID', details: { responseLength: 25_001, truncated: true } }, stage: 'parse' });
assert.equal(truncatedDiagnostic.truncated, true, 'truncated provider output remains bounded diagnostic metadata');
assert.equal(truncatedDiagnostic.responseLength, 25_001);

const exploration = createExplorationAiInterpreter({ gateway: { complete: async () => ({ protocol: 'fixture', text: JSON.stringify({ kind: 'world-design', design: { mode: 'edit', recipe: null, patch: { version: 1, changes: [{ type: 'SET_NOISE', split: 'train', kind: 'position', amount: 0.1 }] } }, requestedHolds: [], ambiguity: null }) }) } });
await assert.rejects(() => exploration.interpret({ taskMode: AGENT_TASK_MODES.EXPERIMENT_DESIGN, request: 'edit World', context: { presentation: { availableDepths: [] } }, config: { protocol: 'openai-compatible', model: 'm', apiKey: 'k' } }), (error) => error.code === 'AI_INVALID_EXPLORATION_INTERPRETATION');
const worldInterpretation = await exploration.interpret({ taskMode: AGENT_TASK_MODES.WORLD_EDIT, request: 'edit World', context: { presentation: { availableDepths: [] } }, config: { protocol: 'openai-compatible', model: 'm', apiKey: 'k' } });
assert.equal(worldInterpretation.kind, 'world-design');

// Twelve executable business cases: each case sends a bounded task through a
// gateway spy, parses the provider text, validates the mode-specific result,
// and asserts the forbidden cross-boundary behavior.
const askCases = [
  { id: 'ask-normal', input: { question: 'Explain the evidence.' }, value: { answer: 'A bounded answer.', tryExperiment: null, depth: null }, expected: 'answer' },
  { id: 'ask-context-suggestion', input: { question: 'What should I test next?' }, value: { answer: 'Compare another sample.', tryExperiment: { question: 'Try more data.', design: { goal: 'more-same-distribution-data' } }, depth: null }, expected: 'suggestion' },
  { id: 'ask-ambiguous', input: { question: 'Maybe?' }, value: { answer: 'I need more context.', tryExperiment: '', depth: null }, expected: 'unavailable' },
  { id: 'ask-unsupported-operation', input: { question: 'Run it for me.' }, value: { answer: 'No automatic execution.', tryExperiment: { operation: 'RUN' }, depth: null }, expected: 'rejected' },
];
for (const item of askCases) {
  const actual = await callActualProvider({ protocol: 'openai-compatible', taskMode: AGENT_TASK_MODES.ASK, taskInput: item.input, text: JSON.stringify(item.value), responseSchema: providerModeFixtures[AGENT_TASK_MODES.ASK].schema });
  assert.equal(actual.calls, 1, `${item.id} uses one outgoing provider request`);
  if (item.expected === 'rejected') {
    assert.throws(() => validateLearningAnswer(JSON.parse(actual.result.text)), /AI_LEARNING_ANSWER_INVALID/);
  } else {
    const validated = validateLearningAnswer(JSON.parse(actual.result.text));
    assert.equal(validated.answer.length > 0, true, `${item.id} preserves the answer`);
    if (item.expected === 'suggestion') assert.equal(validated.tryExperiment.design.goal, 'more-same-distribution-data');
    if (item.expected === 'unavailable') assert.equal(validated.suggestionUnavailable, true);
  }
  assert.equal(JSON.stringify(actual.body).includes('clientX'), false, `${item.id} excludes pointer state`);
}

const experimentContext = { presentation: { availableDepths: ['evidence', 'mechanism'] }, world: { task: 'regression' } };
const experimentCases = [
  { id: 'experiment-explanation', request: 'Explain the comparison.', value: { kind: 'explanation', topic: 'comparison', explanation: 'The samples differ.', depth: null, intent: null, requestedChange: null, requestedHolds: [], design: null, experimentDesign: null, reason: null, ambiguity: null }, expected: 'explanation' },
  { id: 'experiment-navigation', request: 'Show evidence.', value: { kind: 'navigation', topic: null, explanation: null, depth: 'evidence', intent: null, requestedChange: null, requestedHolds: [], design: null, experimentDesign: null, reason: null, ambiguity: null }, expected: 'navigation' },
  { id: 'experiment-proposal', request: 'Collect more data.', value: { kind: 'experiment', topic: null, explanation: null, depth: null, intent: 'more-data', requestedChange: 'increase sample size', requestedHolds: ['world-generating-process'], design: null, experimentDesign: null, reason: null, ambiguity: null }, expected: 'experiment' },
  { id: 'experiment-ambiguity', request: 'Do something surprising.', value: { kind: 'clarification', topic: null, explanation: null, depth: null, intent: null, requestedChange: null, requestedHolds: [], design: null, experimentDesign: null, reason: 'Need a bounded question.', ambiguity: 'ambiguous request' }, expected: 'clarification' },
];
for (const item of experimentCases) {
  const calls = [];
  const fixture = createExplorationAiInterpreter({ gateway: { complete: async (request) => { calls.push(request); return { protocol: 'fixture', text: JSON.stringify(item.value) }; }, recordTrace() {} } });
  const result = await fixture.interpret({ taskMode: AGENT_TASK_MODES.EXPERIMENT_DESIGN, request: item.request, context: experimentContext, config: { protocol: 'openai-compatible', model: 'fixture', apiKey: 'fixture-secret' }, requestId: item.id });
  assert.equal(result.kind, item.expected, item.id);
  assert.equal(calls.length, item.expected === 'rejected' ? 2 : 1, `${item.id} uses only the bounded validation-repair budget`);
  assert.equal(calls[0].taskMode, AGENT_TASK_MODES.EXPERIMENT_DESIGN);
  assert.equal(calls[0].taskInput.question, item.request);
  assert.match(calls[0].messages[0].content, /Allowed outcome kinds for this task: explanation, navigation, experiment, clarification/);
  assert.equal(/Valid output example:.*world-design/s.test(calls[0].messages[0].content), false, 'experiment production prompts do not advertise world-edit outcomes');
  if (item.expected === 'experiment') {
    const host = createPlaygroundHost({ getDataset: () => null });
    await host.open({ playgroundId: 'linear-regression', seed: 7101 });
    const before = host.getState().experiment;
    const proposal = host.proposeExploration({ taskMode: AGENT_TASK_MODES.EXPERIMENT_DESIGN, request: item.request, intent: result.intent, requestContextId: host.getState().experiment.id });
    assert.ok(['proposal', 'clarification'].includes(proposal.kind), `${item.id} is planner-owned`);
    assert.deepEqual(host.getState().experiment, before, `${item.id} cannot mutate Experiment during proposal`);
    await host.close();
  }
}
let experimentModeRejectCalls = 0;
const experimentModeReject = createExplorationAiInterpreter({ gateway: { complete: async () => { experimentModeRejectCalls += 1; return { text: JSON.stringify({ kind: 'world-design', topic: null, explanation: null, depth: null, intent: null, requestedChange: null, requestedHolds: [], design: { mode: 'edit', recipe: null, patch: { version: 1, changes: [{ type: 'SET_NOISE', split: 'train', kind: 'position', amount: 0.1 }] } }, experimentDesign: null, reason: null, ambiguity: null }) }; } } });
await assert.rejects(() => experimentModeReject.interpret({ taskMode: AGENT_TASK_MODES.EXPERIMENT_DESIGN, request: 'edit World', context: experimentContext, config: { protocol: 'openai-compatible', model: 'fixture', apiKey: 'fixture-secret' } }), (error) => error.code === 'AI_INVALID_EXPLORATION_INTERPRETATION');
assert.equal(experimentModeRejectCalls, 2, 'cross-mode experiment output uses only one bounded validation repair');

const worldRecipe = getWorldRecipePreset('rings');
const worldCases = [
  { id: 'world-create', request: 'Create a ring World.', value: { kind: 'world-design', topic: null, explanation: null, depth: null, intent: null, requestedChange: null, requestedHolds: [], design: { mode: 'create', recipe: worldRecipe, patch: null }, experimentDesign: null, reason: null, ambiguity: null }, expected: 'create' },
  { id: 'world-edit', request: 'Increase position noise.', value: { kind: 'world-design', topic: null, explanation: null, depth: null, intent: null, requestedChange: null, requestedHolds: [], design: { mode: 'edit', recipe: null, patch: { version: 1, changes: [{ type: 'SET_NOISE', split: 'train', kind: 'position', amount: 0.1 }] } }, experimentDesign: null, reason: null, ambiguity: null }, expected: 'edit' },
  { id: 'world-current-recipe-version', request: 'Edit the current recipe.', value: { kind: 'world-design', topic: null, explanation: null, depth: null, intent: null, requestedChange: null, requestedHolds: [], design: { mode: 'edit', recipe: null, patch: { version: 1, changes: [{ type: 'SET_NOISE', split: 'test', kind: 'position', amount: 0.2 }] } }, experimentDesign: null, reason: null, ambiguity: null }, expected: 'recipe-version' },
  { id: 'world-unsupported-mode', request: 'Collect more samples instead.', value: { kind: 'experiment', topic: null, explanation: null, depth: null, intent: 'more-data', requestedChange: null, requestedHolds: [], design: null, experimentDesign: null, reason: null, ambiguity: null }, expected: 'rejected' },
];
for (const item of worldCases) {
  const calls = [];
  const fixture = createExplorationAiInterpreter({ gateway: { complete: async (request) => { calls.push(request); return { protocol: 'fixture', text: JSON.stringify(item.value) }; }, recordTrace() {} } });
  const context = { presentation: { availableDepths: ['evidence'] }, world: { task: 'classification', generator: { kind: 'world-recipe', recipe: structuredClone(worldRecipe) } } };
  if (item.expected === 'rejected') {
    await assert.rejects(() => fixture.interpret({ taskMode: AGENT_TASK_MODES.WORLD_EDIT, request: item.request, context, config: { protocol: 'openai-compatible', model: 'fixture', apiKey: 'fixture-secret' }, requestId: item.id }), (error) => error.code === 'AI_INVALID_EXPLORATION_INTERPRETATION');
  } else {
    const result = await fixture.interpret({ taskMode: AGENT_TASK_MODES.WORLD_EDIT, request: item.request, context, config: { protocol: 'openai-compatible', model: 'fixture', apiKey: 'fixture-secret' }, requestId: item.id });
    assert.equal(result.kind, 'world-design');
    assert.equal(result.design.mode, item.expected === 'create' ? 'create' : 'edit');
    if (item.expected !== 'create') assert.equal(result.design.patch.version, 1, `${item.id} preserves the current recipe version`);
  }
  assert.equal(calls.length, item.expected === 'rejected' ? 2 : 1, `${item.id} uses only the bounded validation-repair budget`);
  assert.equal(calls[0].taskMode, AGENT_TASK_MODES.WORLD_EDIT);
  assert.match(calls[0].messages[0].content, /Allowed outcome kinds for this task: world-design/);
  assert.equal(/Valid output example:.*kind":"experiment/s.test(calls[0].messages[0].content), false, 'world production prompts do not advertise experiment outcomes');
}

const worldHost = createPlaygroundHost({ getDataset: () => null });
await worldHost.open({ playgroundId: 'linear-regression', seed: 7101 });
const worldBefore = worldHost.getState();
assert.throws(() => worldHost.proposeExploration({
  taskMode: AGENT_TASK_MODES.WORLD_EDIT,
  request: 'Edit the current recipe.',
  worldDesign: { mode: 'create', recipe: worldRecipe, patch: null },
  requestContextId: 'stale-experiment-context',
}), /INVALID_PLAYGROUND_ACTION/);
assert.deepEqual(worldHost.getState().experiment, worldBefore.experiment, 'stale World proposal cannot mutate Experiment');
assert.deepEqual(worldHost.getState().world, worldBefore.world, 'stale World proposal cannot mutate World');
await worldHost.close();

const host = createPlaygroundHost({ getDataset: () => null });
await host.open({ playgroundId: 'linear-regression', seed: 7101 });
const before = host.getState();
const proposal = host.proposeExploration({ taskMode: AGENT_TASK_MODES.EXPERIMENT_DESIGN, request: 'test', intent: 'more-data' });
assert.ok(proposal.kind === 'proposal' || proposal.kind === 'clarification');
assert.deepEqual(host.getState().experiment, before.experiment, 'proposal cannot mutate Experiment state');
await host.close();

const providerConfig = { protocol: 'openai-compatible', endpoint: 'https://fixture.invalid/v1/chat/completions', model: 'fixture', apiKey: 'fixture-secret' };
let neverSignal = null;
const neverGateway = { complete: async ({ signal }) => { neverSignal = signal; return new Promise(() => {}); } };
const neverStarted = Date.now();
await assert.rejects(
  () => createLearningAssistant({ gateway: neverGateway, timeoutMs: 30 }).ask({ question: 'deadline', config: providerConfig, context: {} }),
  (error) => error.code === 'AI_REQUEST_TIMEOUT' && error.details?.reason === 'logical-deadline' && Number.isFinite(error.details?.elapsedMs),
);
assert.ok(Date.now() - neverStarted < 500, 'never-resolving provider is contained by the logical deadline');
assert.equal(neverSignal?.aborted, true, 'logical deadline aborts the provider signal');

let bodySignal = null;
const bodyStallGateway = createProviderGateway({ fetchImpl: async (_url, options) => {
  bodySignal = options.signal;
  return { ok: true, status: 200, async json() { return new Promise(() => {}); } };
} });
await assert.rejects(
  () => createLearningAssistant({ gateway: bodyStallGateway, timeoutMs: 30 }).ask({ question: 'body deadline', config: providerConfig, context: {} }),
  (error) => error.code === 'AI_REQUEST_TIMEOUT',
);
assert.equal(bodySignal?.aborted, true, 'body stall receives the logical abort signal');

let ignoredCalls = 0;
const abortIgnoringGateway = { complete: async () => { ignoredCalls += 1; await new Promise((resolve) => setTimeout(resolve, 80)); return { protocol: 'fixture', text: '{"answer":"late"}' }; } };
await assert.rejects(
  () => createLearningAssistant({ gateway: abortIgnoringGateway, timeoutMs: 20 }).ask({ question: 'ignore abort', config: providerConfig, context: {} }),
  (error) => error.code === 'AI_REQUEST_TIMEOUT',
);
assert.equal(ignoredCalls, 1, 'abort-ignoring provider cannot produce a late success or repair');

let repairStallCalls = 0;
const repairStallGateway = { complete: async () => {
  repairStallCalls += 1;
  if (repairStallCalls === 1) return { protocol: 'fixture', text: '{"answer":"bad","tryExperiment":{"operation":"RUN"}}' };
  return new Promise(() => {});
} };
await assert.rejects(
  () => createLearningAssistant({ gateway: repairStallGateway, timeoutMs: 35 }).ask({ question: 'repair deadline', config: providerConfig, context: {} }),
  (error) => error.code === 'AI_REQUEST_TIMEOUT' && error.details?.attempts === 2,
);
assert.equal(repairStallCalls, 2, 'repair shares the original logical deadline and attempt budget');

const surfaceSource = readFileSync(new URL('../src/components/playground/ExploreAgentSurface.jsx', import.meta.url), 'utf8');
assert.match(surfaceSource, /pendingExperimentTaskRef/);
assert.match(surfaceSource, /consumed/);
assert.match(surfaceSource, /if \(isCurrent\(\)\) setBusy\(false\)/, 'stale proposal finally cannot clear a newer request');
assert.match(surfaceSource, /queueExperimentTask/);
const browserHarnessSource = readFileSync(new URL('../src/dev/agentRequestContractHarness.jsx', import.meta.url), 'utf8');
const browserRunnerSource = readFileSync(new URL('./agent-request-cdp-browser.mjs', import.meta.url), 'utf8');
assert.match(browserHarnessSource, /ExploreAgentSurface/);
assert.match(browserHarnessSource, /createPlaygroundHost/);
assert.match(browserHarnessSource, /createPlaygroundAgentApi/);
assert.match(browserHarnessSource, /createProviderGateway/);
assert.match(browserRunnerSource, /\/v1\/chat\/completions/);
assert.match(browserRunnerSource, /access-control-allow-origin/);
assert.match(browserRunnerSource, /dimensionsAreDisjoint/);
assert.match(browserRunnerSource, /SET_NOISE/);
assert.match(browserRunnerSource, /mode switch suppresses stale response/);

console.log('Agent request contract checks passed: strict semantic projection, task modes/output sets, provider capability routing, Ask compatibility, bounded failure classification/repair, mode guards, and 12 business cases.');
