import assert from 'node:assert/strict';
import { probeProviderConnection } from '../src/core/ai/connectionProbe.js';
import { classifyAiError, createAiDiagnostic, diagnosticText } from '../src/core/ai/diagnostics.js';
import { createProviderGateway } from '../src/core/ai/providerRegistry.js';

const config = { protocol: 'openai-responses', vendorId: 'openai', endpoint: 'https://api.openai.com/v1/responses', model: 'gpt-5.6', apiKey: 'secret' };
assert.equal(classifyAiError({ code: 'AI_PROVIDER_REQUEST_FAILED', details: { status: 401, providerMessage: 'authorization: Bearer secret' } }), 'AI_AUTH_FAILED');
assert.equal(classifyAiError({ code: 'AI_PROVIDER_REQUEST_FAILED', details: { status: 429 } }), 'AI_RATE_LIMITED');
const diagnostic = createAiDiagnostic({ error: { code: 'AI_PROVIDER_REQUEST_FAILED', details: { status: 401, providerMessage: 'authorization: Bearer secret-token' } }, config, stage: 'network', fallbackUsed: true });
assert.equal(diagnostic.providerMessage.includes('secret-token'), false, 'diagnostics redact provider secrets');
assert.equal(diagnosticText(diagnostic).includes('secret-token'), false, 'copyable diagnostics remain redacted');
const configuredKey = 'volk-configured-key-123';
const exactSecretDiagnostic = createAiDiagnostic({ error: { code: 'AI_PROVIDER_REQUEST_FAILED', details: { status: 502, providerMessage: `upstream echoed ${configuredKey}` } }, config: { ...config, apiKey: configuredKey }, stage: 'provider-response' });
assert.equal(exactSecretDiagnostic.providerMessage.includes(configuredKey), false, 'the exact configured key is redacted by value');
assert.equal(diagnosticText(exactSecretDiagnostic).includes(configuredKey), false, 'copied exact-key diagnostics remain redacted');

const tracedGateway = createProviderGateway({
  fetchImpl: async (_url, options) => {
    assert.equal(String(options.body).includes(configuredKey), false, 'request bodies do not contain the configured key');
    return { ok: true, status: 200, async json() { return { choices: [{ message: { content: 'OK' } }] }; } };
  },
});
await tracedGateway.complete({ config: { protocol: 'openai-compatible', endpoint: 'https://example.test/v1/chat/completions', model: 'custom-model', apiKey: configuredKey }, system: 'bounded prompt', messages: [{ role: 'user', content: 'hello' }] });
const trace = tracedGateway.getRequestTrace();
assert.deepEqual(trace.map((item) => item.stage), ['request-started', 'provider-response', 'parse', 'completed'], 'provider trace records bounded lifecycle stages');
assert.equal(JSON.stringify(trace).includes('bounded prompt'), false, 'provider trace never stores prompts');
assert.equal(JSON.stringify(trace).includes(configuredKey), false, 'provider trace never stores API keys');

const successfulGateway = {
  async complete(request) {
    if (request.responseMode === 'json' && request.responseSchema?.name === 'volk_ml_connection_probe') return { text: '{"ok":true}' };
    if (request.responseMode === 'json') return { protocol: 'fake', text: JSON.stringify({ kind: 'explanation', topic: 'comparison' }) };
    return { text: 'OK' };
  },
};
const ready = await probeProviderConnection({ gateway: successfulGateway, config });
assert.equal(ready.status, 'ready', 'a successful staged probe reaches ready');
assert.deepEqual(ready.stages.map((item) => item.id), ['configuration', 'network', 'authentication', 'model', 'basic-text', 'structured-output', 'interpreter']);

const structuredFailure = await probeProviderConnection({ gateway: { async complete(request) { if (request.responseMode === 'text') return { text: 'OK' }; return { text: 'not-json' }; } }, config });
assert.equal(structuredFailure.status, 'failed');
assert.equal(structuredFailure.stages.find((item) => item.id === 'structured-output').code, 'AI_STRUCTURED_OUTPUT_UNSUPPORTED');

console.log('AI diagnostics checks passed: staged probing, structured-output failure classification, status mapping, and redacted diagnostics.');
