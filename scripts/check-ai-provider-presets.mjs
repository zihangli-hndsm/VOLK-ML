import assert from 'node:assert/strict';
import { defaultAiConfig, normalizeAiConfig } from '../src/core/ai/aiSettings.js';
import { getModelPreset, listProviderPresets, providerPresetForProtocol } from '../src/core/ai/providerPresets.js';

const presets = listProviderPresets();
assert.deepEqual(presets.map((item) => item.vendorId), ['openai', 'deepseek', 'anthropic', 'google-gemini']);
assert.equal(providerPresetForProtocol('openai-responses').vendorId, 'openai');
assert.equal(getModelPreset('openai', 'gpt-5.6').protocolId, 'openai-responses');
assert.equal(getModelPreset('deepseek', 'deepseek-v4-flash').protocolId, 'openai-compatible');
assert.equal(defaultAiConfig().protocol, 'openai-responses', 'fresh configuration uses native OpenAI Responses');
assert.equal(normalizeAiConfig({ protocol: 'openai-compatible', model: 'legacy-model', endpoint: 'https://example.test/v1/chat/completions', apiKey: 'key' }).vendorId, null, 'legacy custom compatible config remains custom');
assert.equal(presets.every((preset) => preset.models.every((item) => item.status === 'verified')), true);
assert.equal(JSON.stringify(presets).includes('apiKey'), false, 'presets never contain secrets');

console.log('AI provider preset checks passed: explicit protocols, model catalog metadata, legacy compatibility, and no secret material.');
