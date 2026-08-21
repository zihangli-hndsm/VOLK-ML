import { getModelPreset, getProviderPreset, providerPresetForProtocol } from './providerPresets.js';
import { createRequestTraceStore } from './diagnostics.js';

const PROTOCOLS = Object.freeze([
  Object.freeze({
    id: 'openai-responses',
    labelKey: 'ai.provider.openai',
    defaultEndpoint: 'https://api.openai.com/v1/responses',
    defaultModel: 'gpt-5.6',
  }),
  Object.freeze({
    id: 'openai-compatible',
    labelKey: 'ai.provider.openaiCompatible',
    defaultEndpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
  }),
  Object.freeze({
    id: 'anthropic-compatible',
    labelKey: 'ai.provider.anthropicCompatible',
    defaultEndpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-4-6',
  }),
  Object.freeze({
    id: 'gemini-compatible',
    labelKey: 'ai.provider.geminiCompatible',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    defaultModel: 'gemini-3.7-flash',
  }),
]);

const protocolMap = new Map(PROTOCOLS.map((protocol) => [protocol.id, protocol]));
const protocolAliases = new Map([['anthropic', 'anthropic-compatible']]);

export function listProviderProtocols() {
  return PROTOCOLS;
}

export function getProviderProtocol(protocolId) {
  return protocolMap.get(protocolId) ?? protocolMap.get(protocolAliases.get(protocolId)) ?? null;
}

function providerError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.details = {};
  return error;
}

function requireConfig(config) {
  const protocolId = config?.protocol ?? config?.providerId;
  const protocol = getProviderProtocol(protocolId);
  if (!protocol) throw providerError('AI_PROVIDER_UNSUPPORTED', 'The selected AI protocol is not supported.');
  const apiKey = String(config?.apiKey ?? '').trim();
  const model = String(config?.model ?? protocol.defaultModel).trim();
  if (!apiKey) throw providerError('AI_KEY_REQUIRED', 'Enter an API key to use the configured AI provider.');
  if (!model) throw providerError('AI_MODEL_REQUIRED', 'Enter a model name to use the configured AI provider.');
  return {
    protocol,
    apiKey,
    model,
    endpoint: String(config?.endpoint ?? '').trim(),
    displayName: String(config?.displayName ?? '').trim(),
    requestProfile: requestProfileFor(config, protocol, model),
  };
}

function requestProfileFor(config, protocol, model) {
  const preset = config?.vendorId
    ? getProviderPreset(config.vendorId)
    : protocol.id === 'gemini-compatible' ? providerPresetForProtocol(protocol.id) : null;
  const selected = config?.vendorId ? getModelPreset(config.vendorId, model) : null;
  return Object.freeze({
    temperature: selected?.requestProfile?.temperature ?? preset?.capabilities?.temperature ?? true,
    topP: selected?.requestProfile?.topP ?? preset?.capabilities?.topP ?? true,
    topK: selected?.requestProfile?.topK ?? preset?.capabilities?.topK ?? true,
    structuredOutput: selected?.requestProfile?.structuredOutput ?? preset?.capabilities?.structuredOutput ?? true,
  });
}

export function resolveProviderRequestProfile(config) {
  const protocol = getProviderProtocol(config?.protocol ?? config?.providerId);
  if (!protocol) return null;
  const model = String(config?.model ?? protocol.defaultModel).trim();
  return requestProfileFor(config, protocol, model);
}

function endpointFor(config) {
  const endpoint = config.endpoint || config.protocol.defaultEndpoint;
  return endpoint.includes('{model}')
    ? endpoint.replaceAll('{model}', encodeURIComponent(config.model))
    : endpoint;
}

async function readJson(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw providerError('AI_PROVIDER_RESPONSE_INVALID', 'The AI provider returned invalid JSON.');
  }
  if (!response?.ok) {
    const error = providerError('AI_PROVIDER_REQUEST_FAILED', `The AI provider request failed (HTTP ${response?.status ?? 'unknown'}).`);
    error.details = {
      status: Number(response?.status) || null,
      providerMessage: String(payload?.error?.message ?? payload?.message ?? '').slice(0, 400),
    };
    throw error;
  }
  return payload;
}

function rejectsJsonResponseFormat(error) {
  const status = error?.details?.status;
  const message = String(error?.details?.providerMessage ?? '').toLowerCase();
  return (status === 400 || status === 404 || status === 422)
    && /response[_ ]format|json[_ -]?object|structured output|unknown field|unsupported.*json|does not support.*json/.test(message);
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => typeof part === 'string' ? part : part?.text ?? '').join('');
}

export function textFromResponsesPayload(payload) {
  const status = payload?.status;
  if (status === 'failed') {
    const error = providerError('AI_PROVIDER_RESPONSE_FAILED', 'The OpenAI Responses request failed.');
    error.details = { status, providerMessage: String(payload?.error?.message ?? '').slice(0, 400) };
    throw error;
  }
  if (status === 'incomplete' || status === 'cancelled') {
    const error = providerError('AI_PROVIDER_RESPONSE_INCOMPLETE', 'The OpenAI Responses request did not complete.');
    error.details = { status, reason: String(payload?.incomplete_details?.reason ?? '').slice(0, 160) };
    throw error;
  }
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const text = output
    .filter((item) => item?.type === 'message')
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter((content) => content?.type === 'output_text' && typeof content.text === 'string')
    .map((content) => content.text)
    .join('');
  if (text) return text;
  const refusal = output
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .find((content) => content?.type === 'refusal');
  const error = providerError(refusal ? 'AI_PROVIDER_REFUSAL' : 'AI_PROVIDER_OUTPUT_MISSING', refusal
    ? 'The OpenAI Responses model refused the request.'
    : 'The OpenAI Responses response did not contain output text.');
  error.details = { status: status ?? null };
  throw error;
}

function responsesInput(messages) {
  return messages.map((message) => ({
    role: message.role,
    content: [{ type: 'input_text', text: String(message.content ?? '') }],
  }));
}

function responsesTextOptions(responseSchema) {
  if (!responseSchema) return {};
  const schema = responseSchema.schema ?? responseSchema;
  const name = responseSchema.name ?? 'volk_ml_structured_output';
  return {
    text: {
      format: {
        type: 'json_schema',
        name,
        schema,
        strict: true,
      },
    },
  };
}

const adapters = Object.freeze({
  'openai-responses': Object.freeze({
    async complete({ fetchImpl, endpoint, apiKey, model, system, messages, responseSchema }) {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          instructions: system,
          input: responsesInput(messages),
          store: false,
          ...responsesTextOptions(responseSchema),
        }),
      });
      return textFromResponsesPayload(await readJson(response));
    },
  }),
  'openai-compatible': Object.freeze({
    async complete({ fetchImpl, endpoint, apiKey, model, system, messages, responseMode, requestProfile }) {
      const sampling = {};
      if (requestProfile?.temperature !== false) sampling.temperature = 0;
      const request = (includeJsonMode) => fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          ...sampling,
          ...(includeJsonMode ? { response_format: { type: 'json_object' } } : {}),
          messages: [{ role: 'system', content: system }, ...messages],
        }),
      });
      let payload;
      try {
        payload = await readJson(await request(responseMode === 'json'));
      } catch (error) {
        if (responseMode === 'json' && rejectsJsonResponseFormat(error)) {
          payload = await readJson(await request(false));
        } else {
          throw error;
        }
      }
      return textFromContent(payload?.choices?.[0]?.message?.content ?? payload?.output_text);
    },
  }),
  'anthropic-compatible': Object.freeze({
    async complete({ fetchImpl, endpoint, apiKey, model, system, messages, requestProfile }) {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 1200, ...(requestProfile?.temperature !== false ? { temperature: 0 } : {}), system, messages }),
      });
      const payload = await readJson(response);
      return textFromContent(payload?.content);
    },
  }),
  'gemini-compatible': Object.freeze({
    async complete({ fetchImpl, endpoint, apiKey, model, system, messages, responseMode, requestProfile }) {
      const generationConfig = {
        ...(requestProfile?.temperature !== false ? { temperature: 0 } : {}),
        ...(requestProfile?.topP !== false ? { topP: 1 } : {}),
        ...(requestProfile?.topK !== false ? { topK: 1 } : {}),
        ...(responseMode === 'json' ? { responseMimeType: 'application/json' } : {}),
      };
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: String(message.content ?? '') }],
          })),
          generationConfig,
        }),
      });
      const payload = await readJson(response);
      return textFromContent(payload?.candidates?.[0]?.content?.parts);
    },
  }),
});

export function createProviderGateway({ fetchImpl = globalThis.fetch, adapterRegistry = adapters, traceStore = createRequestTraceStore() } = {}) {
  return Object.freeze({
    async complete({ config, system = '', messages = [], responseMode = 'text', responseSchema = null }) {
      if (typeof fetchImpl !== 'function') throw providerError('AI_PROVIDER_UNAVAILABLE', 'No browser fetch implementation is available.');
      const resolved = requireConfig(config);
      const adapter = adapterRegistry[resolved.protocol.id];
      if (!adapter) throw providerError('AI_PROVIDER_UNSUPPORTED', 'The selected AI protocol is not supported.');
      const requestId = globalThis.crypto?.randomUUID?.() ?? `ai-request-${Date.now()}`;
      traceStore.append({ id: requestId, stage: 'request-started', protocol: resolved.protocol.id, model: resolved.model, status: 'started' });
      let text;
      try {
        text = await adapter.complete({
          fetchImpl,
          endpoint: endpointFor(resolved),
          apiKey: resolved.apiKey,
          model: resolved.model,
          system: String(system ?? ''),
          messages: messages.map((message) => ({ role: message.role, content: String(message.content ?? '') })),
          responseMode,
          responseSchema,
          requestProfile: resolved.requestProfile,
        });
        traceStore.append({ id: requestId, stage: 'provider-response', protocol: resolved.protocol.id, model: resolved.model, status: 'received' });
        traceStore.append({ id: requestId, stage: 'parse', protocol: resolved.protocol.id, model: resolved.model, status: responseMode === 'json' ? 'structured' : 'text' });
      } catch (error) {
        traceStore.append({ id: requestId, stage: 'failed', protocol: resolved.protocol.id, model: resolved.model, status: error?.code ?? 'failed' });
        if (error?.code?.startsWith('AI_')) throw error;
        throw providerError('AI_PROVIDER_UNAVAILABLE', 'The AI provider request was unavailable.');
      }
      traceStore.append({ id: requestId, stage: 'completed', protocol: resolved.protocol.id, model: resolved.model, status: 'completed' });
      return {
        text: String(text ?? ''),
        provider: resolved.displayName || resolved.protocol.id,
        protocol: resolved.protocol.id,
        model: resolved.model,
      };
    },
    recordTrace(entry) { return traceStore.append(entry); },
    getRequestTrace() { return traceStore.snapshot(); },
  });
}

export { adapters as providerAdapters };
