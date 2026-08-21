import assert from 'node:assert/strict';
import { probeProviderConnection } from '../src/core/ai/connectionProbe.js';
import { classifyAiError, createAiDiagnostic, diagnosticText } from '../src/core/ai/diagnostics.js';

const config = { protocol: 'openai-responses', vendorId: 'openai', endpoint: 'https://api.openai.com/v1/responses', model: 'gpt-5.6', apiKey: 'secret' };
assert.equal(classifyAiError({ code: 'AI_PROVIDER_REQUEST_FAILED', details: { status: 401, providerMessage: 'authorization: Bearer secret' } }), 'AI_AUTH_FAILED');
assert.equal(classifyAiError({ code: 'AI_PROVIDER_REQUEST_FAILED', details: { status: 429 } }), 'AI_RATE_LIMITED');
const diagnostic = createAiDiagnostic({ error: { code: 'AI_PROVIDER_REQUEST_FAILED', details: { status: 401, providerMessage: 'authorization: Bearer secret-token' } }, config, stage: 'network', fallbackUsed: true });
assert.equal(diagnostic.providerMessage.includes('secret-token'), false, 'diagnostics redact provider secrets');
assert.equal(diagnosticText(diagnostic).includes('secret-token'), false, 'copyable diagnostics remain redacted');

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
