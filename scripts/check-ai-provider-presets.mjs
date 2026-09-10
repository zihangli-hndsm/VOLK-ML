import assert from 'node:assert/strict';
import { defaultAiConfig, normalizeAiConfig } from '../src/core/ai/aiSettings.js';
import { getModelPreset, listProviderPresets, providerPresetForProtocol } from '../src/core/ai/providerPresets.js';
import { createProviderGateway, resolveProviderRequestProfile } from '../src/core/ai/providerRegistry.js';

const presets = listProviderPresets();
assert.deepEqual(presets.map((item) => item.vendorId), ['openai', 'deepseek', 'anthropic', 'google-gemini']);
assert.equal(providerPresetForProtocol('openai-responses').vendorId, 'openai');
assert.equal(getModelPreset('openai', 'gpt-5.6').protocolId, 'openai-responses');
assert.equal(getModelPreset('deepseek', 'deepseek-v4-flash').protocolId, 'openai-compatible');
assert.equal(defaultAiConfig().protocol, 'openai-responses', 'fresh configuration uses native OpenAI Responses');
assert.equal(normalizeAiConfig({ protocol: 'openai-compatible', model: 'legacy-model', endpoint: 'https://example.test/v1/chat/completions', apiKey: 'key' }).vendorId, null, 'legacy custom compatible config remains custom');
assert.equal(presets.every((preset) => preset.models.every((item) => item.status === 'verified')), true);
assert.equal(JSON.stringify(presets).includes('apiKey'), false, 'presets never contain secrets');

const geminiBodies = [];
const geminiGateway = createProviderGateway({
  fetchImpl: async (_url, options) => {
    geminiBodies.push(JSON.parse(options.body));
    return { ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: 'OK' }] } }] }; } };
  },
});
const geminiConfig = {
  vendorId: 'google-gemini',
  protocol: 'gemini-compatible',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
  model: 'gemini-3.7-flash',
  apiKey: 'configured-secret',
};
const deepseekBodies = [];
const deepseekGateway = createProviderGateway({
  fetchImpl: async (_url, options) => {
    deepseekBodies.push(JSON.parse(options.body));
    return { ok: true, status: 200, async json() { return { choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 } }; } };
  },
});
const deepseekConfig = {
  vendorId: 'deepseek',
  protocol: 'openai-compatible',
  endpoint: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-v4-flash',
  apiKey: 'configured-secret',
};
assert.equal(resolveProviderRequestProfile(deepseekConfig).thinking, 'disabled');
const deepseekResult = await deepseekGateway.complete({ config: deepseekConfig, system: 'Return OK.', messages: [{ role: 'user', content: 'OK' }] });
assert.deepEqual(deepseekBodies[0].thinking, { type: 'disabled' }, 'DeepSeek requests explicitly disable hidden thinking for the constrained live policy');
assert.deepEqual(deepseekResult.usage.totalTokens, 18, 'DeepSeek OpenAI-compatible usage is normalized from provider metadata');
await deepseekGateway.complete({ config: { ...deepseekConfig, vendorId: null }, system: 'Return OK.', messages: [{ role: 'user', content: 'OK' }] });
assert.equal(deepseekBodies[1].thinking, undefined, 'custom OpenAI-compatible requests do not inherit DeepSeek controls');
let rejectedThinkingCalls = 0;
const rejectingDeepseekGateway = createProviderGateway({
  fetchImpl: async (_url, options) => {
    rejectedThinkingCalls += 1;
    assert.deepEqual(JSON.parse(options.body).thinking, { type: 'disabled' });
    return { ok: false, status: 422, async json() { return { error: { message: 'thinking control unsupported' } }; } };
  },
});
await assert.rejects(
  rejectingDeepseekGateway.complete({ config: deepseekConfig, system: 'Return JSON.', messages: [{ role: 'user', content: 'OK' }], responseMode: 'json' }),
  (error) => error.code === 'AI_PROVIDER_REQUEST_FAILED',
);
assert.equal(rejectedThinkingCalls, 1, 'unsupported optional thinking control fails safely without retry or repair');
assert.deepEqual(resolveProviderRequestProfile(geminiConfig), {
  structuredOutput: 'json-mime', temperature: false, topP: false, topK: false,
});
await geminiGateway.complete({ config: geminiConfig, system: 'Return OK.', messages: [{ role: 'user', content: 'OK' }] });
assert.equal(geminiBodies.length, 1);
assert.deepEqual(geminiBodies[0].generationConfig, {}, 'Gemini Flash request omits unsupported sampling fields');
await geminiGateway.complete({ config: geminiConfig, system: 'Return JSON.', messages: [{ role: 'user', content: 'OK' }], responseMode: 'json', responseSchema: { name: 'test', schema: { type: 'object', properties: {}, additionalProperties: false } } });
assert.deepEqual(geminiBodies[1].generationConfig, { responseMimeType: 'application/json' }, 'Gemini structured request only adds its supported JSON mode');

console.log('AI provider preset checks passed: explicit protocols, model catalog metadata, legacy compatibility, and no secret material.');
