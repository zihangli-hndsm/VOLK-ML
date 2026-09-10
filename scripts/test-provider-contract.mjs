import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TEACHING_DIALOGUE_RESPONSE_SCHEMA,
  createTeachingDialogueProvider,
  decideTeachingDialogue,
  isTeachingDialoguePilotEnabled,
  localTeachingDialoguePolicy,
  teachingDialoguePrompt,
  validateTeachingDialogueResponse,
} from '../src/core/exploration/teachingDialoguePilot.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createProviderGateway } from '../src/core/ai/providerRegistry.js';
import { normalizeProviderUsage } from '../src/core/ai/providerUsage.js';
import {
  createProviderFixtureContext,
  createProviderLiveReport,
  PROVIDER_LIVE_TIMEOUT_MS,
  jsonResponse,
  openAiCompatiblePayload,
  providerResponseFor,
  responsePayload,
  safeErrorReport,
} from './provider-test-support.mjs';

const SECRET_SENTINEL = 'provider-contract-secret-sentinel';
const CONFIG = Object.freeze({ protocol: 'openai-compatible', endpoint: 'https://fixture.invalid/v1/chat/completions', model: 'fixture-model', apiKey: SECRET_SENTINEL });

function createAdapterProvider({ responseText, usage = null, status = 200, fetchBehavior = 'response', onRequest = null } = {}) {
  let calls = 0;
  const fetchImpl = async (_endpoint, options = {}) => {
    calls += 1;
    onRequest?.(options, calls);
    if (fetchBehavior === 'network') throw new Error('fixture network failure');
    if (fetchBehavior === 'timeout') return new Promise(() => {});
    if (fetchBehavior === 'status') return jsonResponse({ error: { message: 'fixture provider failure' } }, status);
    return jsonResponse(openAiCompatiblePayload(responseText, usage), status);
  };
  const gateway = createProviderGateway({ fetchImpl });
  const provider = createTeachingDialogueProvider({ gateway, config: CONFIG });
  return { provider, gateway, getCalls: () => calls };
}

async function expectFallback(provider, context, expectedReason, options = {}) {
  const result = await decideTeachingDialogue({ provider, context, session: {}, timeoutMs: options.timeoutMs ?? 40, signal: options.signal ?? null });
  assert.equal(result.origin, 'fallback');
  assert.equal(result.fallbackReason, expectedReason);
  assert.equal(JSON.stringify(result).includes(SECRET_SENTINEL), false);
  return result;
}

async function main() {
  const context = createProviderFixtureContext();
  const canonical = responsePayload(providerResponseFor(context, { move: 'ELICIT_PREDICTION' }));
  let requestBody = null;
  const canonicalProvider = createAdapterProvider({
    responseText: JSON.stringify(canonical),
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { reasoning_tokens: 3 } },
    onRequest: (options) => { requestBody = JSON.parse(options.body); },
  });
  const canonicalResult = await decideTeachingDialogue({ provider: canonicalProvider.provider, context, session: {}, timeoutMs: 100 });
  assert.equal(canonicalResult.origin, 'provider', 'canonical response passes the real gateway, adapter, parser, and validator path');
  assert.equal(validateTeachingDialogueResponse(canonicalResult, { context })?.move, 'ELICIT_PREDICTION');
  assert.equal(canonicalProvider.getCalls(), 1, 'canonical contract performs one network attempt');
  assert.equal(requestBody.response_format.type, 'json_object', 'request construction requests JSON mode');
  assert.equal(requestBody.model, CONFIG.model);
  assert.equal(requestBody.thinking, undefined, 'generic OpenAI-compatible requests do not send provider-specific thinking controls');
  assert.equal(JSON.stringify(requestBody).includes(SECRET_SENTINEL), false, 'request body does not contain credentials');
  assert.deepEqual(canonicalProvider.gateway.getUsageSummary(), { version: 1, requestCount: 1, reportedUsageCalls: 1, callsWithoutUsage: 0, inputTokens: 11, outputTokens: 7, cachedTokens: 2, reasoningTokens: 3, totalTokens: 18 }, 'provider-reported usage is normalized without estimating');
  assert.equal(canonicalProvider.gateway.getRequestTrace().at(-1).usage.totalTokens, 18, 'completed request trace carries sanitized usage');

  const missingUsageGateway = createProviderGateway({
    fetchImpl: async () => jsonResponse(openAiCompatiblePayload('OK')),
  });
  await missingUsageGateway.complete({ config: CONFIG, system: 'bounded', messages: [{ role: 'user', content: 'hello' }] });
  assert.deepEqual(missingUsageGateway.getUsageSummary(), { version: 1, requestCount: 1, reportedUsageCalls: 0, callsWithoutUsage: 1, inputTokens: null, outputTokens: null, cachedTokens: null, reasoningTokens: null, totalTokens: null }, 'omitted provider usage remains explicitly unavailable');

  let retryAttempt = 0;
  const retryGateway = createProviderGateway({
    fetchImpl: async (_endpoint, options) => {
      retryAttempt += 1;
      if (retryAttempt === 1) return jsonResponse({ error: { message: 'response_format unsupported' }, usage: { prompt_tokens: 3, total_tokens: 3 } }, 400);
      return jsonResponse(openAiCompatiblePayload('OK', { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 }), 200);
    },
  });
  await retryGateway.complete({ config: { ...CONFIG, model: 'retry-model' }, system: 'bounded', messages: [{ role: 'user', content: 'hello' }], responseMode: 'json' });
  assert.deepEqual(retryGateway.getUsageSummary(), { version: 1, requestCount: 1, reportedUsageCalls: 1, callsWithoutUsage: 0, inputTokens: 9, outputTokens: 2, cachedTokens: null, reasoningTokens: null, totalTokens: 11 }, 'JSON-mode fallback counts only the final logical request usage');

  const cancelledGateway = createProviderGateway({
    fetchImpl: async (_endpoint, { signal }) => new Promise((resolve, reject) => signal?.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }, { once: true })),
  });
  const cancellation = new AbortController();
  const cancelledRequest = cancelledGateway.complete({ config: CONFIG, system: 'bounded', messages: [{ role: 'user', content: 'hello' }], signal: cancellation.signal });
  cancellation.abort();
  await assert.rejects(cancelledRequest);
  assert.equal(cancelledGateway.getUsageSummary().callsWithoutUsage, 1, 'cancelled requests without provider metadata remain unavailable');
  assert.equal(normalizeProviderUsage({ prompt_tokens: 9_999_999_999, completion_tokens: -1, total_tokens: 'not-a-number' }, { protocol: 'openai-compatible' }).inputTokens, 1_000_000_000, 'usage values are bounded');

  const malformed = createAdapterProvider({ responseText: 'not-json' });
  await expectFallback(malformed.provider, context, 'malformed');
  assert.equal(malformed.getCalls(), 1);

  const reasoningOnlyGateway = createProviderGateway({
    fetchImpl: async () => jsonResponse({ choices: [{ message: { reasoning_content: 'private reasoning must never become learner content', content: '' } }] }, 200),
  });
  const reasoningOnly = createTeachingDialogueProvider({ gateway: reasoningOnlyGateway, config: CONFIG });
  const reasoningFallback = await expectFallback(reasoningOnly, context, 'provider-response');
  assert.equal(JSON.stringify(reasoningFallback).includes('private reasoning'), false, 'reasoning-only payloads stay out of learner-visible fallback');

  const missingContentGateway = createProviderGateway({
    fetchImpl: async () => jsonResponse({ choices: [{ message: { role: 'assistant' } }] }, 200),
  });
  const missingContent = createTeachingDialogueProvider({ gateway: missingContentGateway, config: CONFIG });
  await expectFallback(missingContent, context, 'provider-response');

  const textField = createAdapterProvider({ responseText: JSON.stringify({ ...canonical, content: { key: 'episode.one.teachingDialogue.hint', params: {}, text: 'must be rejected' } }) });
  await expectFallback(textField.provider, context, 'malformed');
  const prompt = teachingDialoguePrompt(context);
  assert.match(prompt, /content\.text/);
  assert.match(prompt, /episode\.one\.teachingDialogue\.hint/);
  assert.match(prompt, /Never add content\.text/);

  for (const invalidResponse of [
    { ...canonical, move: 7 },
    { ...canonical, move: 'OFFER_HINT', grounding: 'none', evidenceRefs: [], expectedReplyKind: 'none', content: { key: 'episode.one.teachingDialogue.evidence', params: {} } },
    { ...canonical, move: 'ELICIT_PREDICTION', expectedReplyKind: 'none', content: { key: 'episode.one.teachingDialogue.prediction', params: {} } },
    { ...responsePayload(providerResponseFor(context, { move: 'EXPLAIN_WITH_EVIDENCE', grounding: 'evidence', evidenceRefs: ['episode-1-sampling-variability:evidenced'] })), evidenceRefs: ['forged-evidence'] },
    { ...canonical, questionRef: 'stale-question' },
  ]) {
    const invalid = createAdapterProvider({ responseText: JSON.stringify(invalidResponse) });
    await expectFallback(invalid.provider, context, 'semantic');
    assert.equal(invalid.getCalls(), 1, 'invalid output is rejected without retry or field substitution');
  }

  for (const [status, reason] of [[401, 'provider-4xx'], [429, 'provider-4xx'], [503, 'provider-5xx']]) {
    const rejected = createAdapterProvider({ fetchBehavior: 'status', status });
    await expectFallback(rejected.provider, context, reason);
    assert.equal(rejected.getCalls(), 1, `HTTP ${status} is not retried by the contract runner`);
  }
  const network = createAdapterProvider({ fetchBehavior: 'network' });
  await expectFallback(network.provider, context, 'transport');
  const timeout = createAdapterProvider({ fetchBehavior: 'timeout' });
  await expectFallback(timeout.provider, context, 'timeout', { timeoutMs: 1 });
  assert.deepEqual(timeout.gateway.getUsageSummary().callsWithoutUsage, 1, 'timed-out logical requests remain counted as not reported without inventing usage');
  const abortController = new AbortController();
  const cancelled = createAdapterProvider({ fetchBehavior: 'timeout' });
  const cancelledPromise = expectFallback(cancelled.provider, context, 'aborted', { timeoutMs: 1000, signal: abortController.signal });
  abortController.abort();
  await cancelledPromise;
  assert.deepEqual(cancelled.gateway.getUsageSummary().callsWithoutUsage, 1, 'cancelled logical requests remain counted as not reported');

  assert.equal(isTeachingDialoguePilotEnabled({}), false, 'flag-off remains disabled by default');
  assert.equal(isTeachingDialoguePilotEnabled({ VITE_VOLK_TEACHING_DIALOGUE_PILOT: '0' }), false);
  const flagOffHost = createPlaygroundHost({ getDataset: () => null });
  await flagOffHost.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
  assert.equal(flagOffHost.getState().teachingDialogue, null, 'flag-off host does not create a provider session');

  let release;
  const busyHost = createPlaygroundHost({
    getDataset: () => null,
    teachingDialoguePilotEnabled: true,
    teachingDialoguePolicy: async () => new Promise((resolve) => { release = resolve; }),
  });
  await busyHost.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
  await busyHost.optInTeachingDialogue();
  const beforeBusy = busyHost.getState();
  const oldRequest = busyHost.requestTeachingDialogue({ requestId: 'old-request' });
  await busyHost.recordTeachingDialogueTurn({ kind: 'reason', text: 'The learner supplied a newer reason.' });
  release(localTeachingDialoguePolicy({ context: busyHost.getTeachingDialogueContext({ requestId: 'old-request' }), session: {} }));
  assert.equal(await oldRequest, null, 'old provider output cannot overwrite newer inquiry state');
  const afterBusy = busyHost.getState();
  assert.deepEqual(afterBusy.experiment, beforeBusy.experiment, 'busy safety does not mutate the experiment');
  assert.deepEqual(afterBusy.semanticEvents, beforeBusy.semanticEvents, 'policy requests do not create semantic events');

  if (fs.existsSync('dist')) {
    const production = fs.readdirSync('dist', { recursive: true }).filter((file) => String(file).endsWith('.js')).map((file) => fs.readFileSync(`dist/${file}`, 'utf8')).join('\n');
    assert.doesNotMatch(production, /test:provider:contract|VOLK_PROVIDER_API_KEY|allow-live/, 'production build does not expose test entrypoints or credentials');
  }
  const failedMatrixReport = createProviderLiveReport({
    mode: 'full',
    revision: 'fixture-revision',
    head: 'fixture-head',
    requestedCases: ['fixture-case'],
    skippedCases: [],
    result: { failed: 1, rows: [{ caseId: 'fixture-case', run: 1, status: 'failed', origin: 'fallback', failureReasons: ['stale-result'] }] },
    networkAttempts: 1,
  });
  assert.deepEqual(failedMatrixReport.executedCases, ['fixture-case']);
  assert.deepEqual(failedMatrixReport.failedCaseIds, ['fixture-case']);
  assert.equal(failedMatrixReport.safeReasons['stale-result'], 1, 'matrix failure reasons are retained as safe categories');
  assert.deepEqual(failedMatrixReport.caseResults, [{ caseId: 'fixture-case', run: 1, status: 'failed', origin: 'fallback', failureCategories: ['stale-result'] }]);
  assert.deepEqual(failedMatrixReport.tokenUsage, { version: 1, requestCount: 0, reportedUsageCalls: 0, callsWithoutUsage: 0, inputTokens: null, outputTokens: null, cachedTokens: null, reasoningTokens: null, totalTokens: null }, 'live report keeps usage unavailable when no provider usage summary is supplied');
  assert.equal(failedMatrixReport.repairCalls, 0);
  const noCallReport = createProviderLiveReport({ mode: 'smoke', revision: 'fixture-revision', requestedCases: ['fixture-case'], skippedCases: ['other-case'], result: null, networkAttempts: 0 });
  assert.equal(noCallReport.status, 'NOT VERIFIED');
  assert.equal(noCallReport.providerCalls, 0);
  assert.deepEqual(noCallReport.executedCases, []);
  assert.deepEqual(noCallReport.caseResults, []);
  assert.equal(noCallReport.liveBoundaryStatus, 'NOT VERIFIED');
  assert.equal(noCallReport.qualityReviewStatus, 'NOT VERIFIED');
  assert.equal(noCallReport.tokenUsage.callsWithoutUsage, 0);
  assert.equal(PROVIDER_LIVE_TIMEOUT_MS, 20_000, 'live matrix budget is explicit, bounded, and separate from the production learner timeout');
  const report = { version: 1, status: 'passed', mode: 'contract', externalRequests: 0, canonicalCalls: canonicalProvider.getCalls(), schema: TEACHING_DIALOGUE_RESPONSE_SCHEMA.name, safeChecks: ['valid', 'malformed', 'invalid-type', 'cross-field', 'stale-reference', 'provider-errors', 'timeout', 'cancel', 'flag-off', 'busy-stale', 'production-absence'] };
  assert.equal(JSON.stringify(report).includes(SECRET_SENTINEL), false);
  console.log(JSON.stringify(report));
}

main().catch((error) => {
  console.error(JSON.stringify({ version: 1, status: 'failed', mode: 'contract', error: safeErrorReport(error) }));
  process.exitCode = 1;
});
