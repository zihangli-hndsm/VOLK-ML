import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createProviderGateway } from '../src/core/ai/providerRegistry.js';
import { normalizeProviderUsage, summarizeProviderUsage } from '../src/core/ai/providerUsage.js';
import { messages } from '../src/locales/ui.js';

const config = { protocol: 'openai-compatible', endpoint: 'https://usage.fixture.invalid/v1/chat/completions', model: 'usage-model', apiKey: 'usage-secret' };
const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return payload; } });
const openAi = (usage = null) => ({ choices: [{ message: { content: 'OK' } }], ...(usage ? { usage } : {}) });

let calls = 0;
const gateway = createProviderGateway({
  fetchImpl: async (_endpoint, options) => {
    calls += 1;
    assert.equal(String(options.body).includes('usage-secret'), false, 'usage boundary never puts credentials in request bodies');
    return response(openAi({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { reasoning_tokens: 1 } }));
  },
});
const result = await gateway.complete({ config, system: 'private prompt', messages: [{ role: 'user', content: 'private response context' }] });
assert.equal(calls, 1);
assert.deepEqual(result.usage, { version: 1, requestId: result.usage.requestId, protocol: 'openai-compatible', model: 'usage-model', status: 'completed', reported: true, inputTokens: 10, outputTokens: 4, cachedTokens: 2, reasoningTokens: 1, totalTokens: 14 });
assert.deepEqual(gateway.getUsageSummary(), { version: 1, requestCount: 1, reportedUsageCalls: 1, callsWithoutUsage: 0, inputTokens: 10, outputTokens: 4, cachedTokens: 2, reasoningTokens: 1, totalTokens: 14 });
assert.equal(JSON.stringify(gateway.getRequestTrace()).includes('private prompt'), false);
assert.equal(JSON.stringify(gateway.getRequestTrace()).includes('private response context'), false);
assert.equal(JSON.stringify(gateway.getRequestTrace()).includes('usage-secret'), false);

assert.deepEqual(normalizeProviderUsage({ input_tokens: 9, output_tokens: 3, total_tokens: 12, input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 2 } }, { protocol: 'openai-responses' }), { version: 1, reported: true, inputTokens: 9, outputTokens: 3, cachedTokens: 4, reasoningTokens: 2, totalTokens: 12 });
assert.deepEqual(normalizeProviderUsage({ promptTokenCount: 8, candidatesTokenCount: 2, totalTokenCount: 10, cachedContentTokenCount: 1, thoughtsTokenCount: 1 }, { protocol: 'gemini-compatible' }), { version: 1, reported: true, inputTokens: 8, outputTokens: 2, cachedTokens: 1, reasoningTokens: 1, totalTokens: 10 });
assert.deepEqual(normalizeProviderUsage({ input_tokens: 8, output_tokens: 2, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 }, { protocol: 'anthropic-compatible' }), { version: 1, reported: true, inputTokens: 8, outputTokens: 2, cachedTokens: 3, reasoningTokens: null, totalTokens: null });
assert.deepEqual(summarizeProviderUsage([{ usage: normalizeProviderUsage(null) }, { usage: normalizeProviderUsage({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }, { protocol: 'openai-compatible' }) }]), { version: 1, requestCount: 2, reportedUsageCalls: 1, callsWithoutUsage: 1, inputTokens: 3, outputTokens: 2, cachedTokens: null, reasoningTokens: null, totalTokens: 5 });

const failedUsageGateway = createProviderGateway({
  fetchImpl: async () => response({ error: { message: 'rate limited' }, usage: { prompt_tokens: 6, total_tokens: 6 } }, 429),
});
await assert.rejects(failedUsageGateway.complete({ config, system: 'bounded', messages: [{ role: 'user', content: 'hello' }] }));
assert.deepEqual(failedUsageGateway.getUsageSummary(), { version: 1, requestCount: 1, reportedUsageCalls: 1, callsWithoutUsage: 0, inputTokens: 6, outputTokens: null, cachedTokens: null, reasoningTokens: null, totalTokens: 6 }, 'authoritative usage on a failed provider response is retained without response text');

const usageKeys = ['ai.usage.title', 'ai.usage.description', 'ai.usage.session', 'ai.usage.requests', 'ai.usage.input', 'ai.usage.output', 'ai.usage.total', 'ai.usage.cached', 'ai.usage.reasoning', 'ai.usage.unavailable', 'ai.usage.notReported', 'ai.usage.authoritative'];
for (const key of usageKeys) {
  assert.ok(messages[key]?.en && messages[key]?.zh, `${key} has English and Chinese copy`);
}
const settingsSource = fs.readFileSync(new URL('../src/components/AiSettingsDialog.jsx', import.meta.url), 'utf8');
assert.match(settingsSource, /data-ai-usage/);
assert.match(settingsSource, /ai\.usage\.unavailable/);
assert.match(settingsSource, /ai\.usage\.notReported/);

console.log('AI usage checks passed: provider-reported normalization, unavailable/failure-safe accounting, privacy bounds, localized settings surface, and no external calls.');
