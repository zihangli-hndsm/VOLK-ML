import { getModelPreset, getProviderPreset, providerPresetForProtocol } from './providerPresets.js';
import { createRequestTraceStore } from './diagnostics.js';
import { normalizeProviderUsage, sanitizeProviderUsageRecord, summarizeProviderUsage, unavailableProviderUsage } from './providerUsage.js';

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
  const thinking = selected?.requestProfile?.thinking ?? preset?.capabilities?.thinking ?? null;
  return Object.freeze({
    temperature: selected?.requestProfile?.temperature ?? preset?.capabilities?.temperature ?? true,
    topP: selected?.requestProfile?.topP ?? preset?.capabilities?.topP ?? true,
    topK: selected?.requestProfile?.topK ?? preset?.capabilities?.topK ?? true,
    structuredOutput: selected?.requestProfile?.structuredOutput ?? preset?.capabilities?.structuredOutput ?? true,
    ...(thinking ? { thinking } : {}),
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

async function readJson(response, protocol = null) {
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
      usage: normalizeProviderUsage(payload?.usage, { protocol }),
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

function textFromContent(content, { reasoningOnly = false } = {}) {
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => typeof part === 'string' ? part : part?.text ?? '').join('')
      : '';
  if (text.trim()) return text;
  const error = providerError('AI_PROVIDER_RESPONSE_EMPTY', 'The AI provider response did not contain final content.');
  error.details = { shape: reasoningOnly ? 'reasoning-only' : 'content-empty' };
  throw error;
}

export function textFromResponsesPayload(payload) {
  const status = payload?.status;
  if (status === 'failed') {
    const error = providerError('AI_PROVIDER_RESPONSE_FAILED', 'The OpenAI Responses request failed.');
    error.details = { status, providerMessage: String(payload?.error?.message ?? '').slice(0, 400), usage: normalizeProviderUsage(payload?.usage, { protocol: 'openai-responses' }) };
    throw error;
  }
  if (status === 'incomplete' || status === 'cancelled') {
    const error = providerError('AI_PROVIDER_RESPONSE_INCOMPLETE', 'The OpenAI Responses request did not complete.');
    error.details = { status, reason: String(payload?.incomplete_details?.reason ?? '').slice(0, 160), usage: normalizeProviderUsage(payload?.usage, { protocol: 'openai-responses' }) };
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
  error.details = { status: status ?? null, usage: normalizeProviderUsage(payload?.usage, { protocol: 'openai-responses' }) };
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
    async complete({ fetchImpl, endpoint, apiKey, model, system, messages, responseSchema, signal }) {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        signal,
        body: JSON.stringify({
          model,
          instructions: system,
          input: responsesInput(messages),
          store: false,
          ...responsesTextOptions(responseSchema),
        }),
      });
      const payload = await readJson(response, 'openai-responses');
      return { text: textFromResponsesPayload(payload), usage: normalizeProviderUsage(payload?.usage, { protocol: 'openai-responses' }) };
    },
  }),
  'openai-compatible': Object.freeze({
    async complete({ fetchImpl, endpoint, apiKey, model, system, messages, responseMode, requestProfile, signal }) {
      const sampling = {};
      if (requestProfile?.temperature !== false) sampling.temperature = 0;
      const request = (includeJsonMode) => fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        signal,
        body: JSON.stringify({
          model,
          ...sampling,
          ...(requestProfile?.thinking === 'disabled' ? { thinking: { type: 'disabled' } } : {}),
          ...(includeJsonMode ? { response_format: { type: 'json_object' } } : {}),
          messages: [{ role: 'system', content: system }, ...messages],
        }),
      });
      let payload;
      try {
        payload = await readJson(await request(responseMode === 'json'), 'openai-compatible');
      } catch (error) {
        if (responseMode === 'json' && rejectsJsonResponseFormat(error)) {
          payload = await readJson(await request(false), 'openai-compatible');
        } else {
          throw error;
        }
      }
      const message = payload?.choices?.[0]?.message;
      const content = message?.content || payload?.output_text;
      return { text: textFromContent(content, { reasoningOnly: !content && typeof message?.reasoning_content === 'string' && message.reasoning_content.trim().length > 0 }), usage: normalizeProviderUsage(payload?.usage, { protocol: 'openai-compatible' }) };
    },
  }),
  'anthropic-compatible': Object.freeze({
    async complete({ fetchImpl, endpoint, apiKey, model, system, messages, requestProfile, signal }) {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal,
        body: JSON.stringify({ model, max_tokens: 1200, ...(requestProfile?.temperature !== false ? { temperature: 0 } : {}), system, messages }),
      });
      const payload = await readJson(response, 'anthropic-compatible');
      return { text: textFromContent(payload?.content), usage: normalizeProviderUsage(payload?.usage, { protocol: 'anthropic-compatible' }) };
    },
  }),
  'gemini-compatible': Object.freeze({
    async complete({ fetchImpl, endpoint, apiKey, model, system, messages, responseMode, requestProfile, signal }) {
      const generationConfig = {
        ...(requestProfile?.temperature !== false ? { temperature: 0 } : {}),
        ...(requestProfile?.topP !== false ? { topP: 1 } : {}),
        ...(requestProfile?.topK !== false ? { topK: 1 } : {}),
        ...(responseMode === 'json' ? { responseMimeType: 'application/json' } : {}),
      };
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: String(message.content ?? '') }],
          })),
          generationConfig,
        }),
      });
      const payload = await readJson(response, 'gemini-compatible');
      return { text: textFromContent(payload?.candidates?.[0]?.content?.parts), usage: normalizeProviderUsage(payload?.usageMetadata, { protocol: 'gemini-compatible' }) };
    },
  }),
});

export function createProviderGateway({ fetchImpl = globalThis.fetch, adapterRegistry = adapters, traceStore = createRequestTraceStore() } = {}) {
  let usageRecords = [];
  const usageListeners = new Set();
  const notifyUsage = () => {
    const summary = summarizeProviderUsage(usageRecords);
    for (const listener of usageListeners) {
      try { listener(summary); } catch { /* usage observers are informational only */ }
    }
  };
  const setUsageRecord = ({ requestId, protocol, model, status, usage }) => {
    const record = sanitizeProviderUsageRecord(usage, { requestId, protocol, model, status });
    const existing = usageRecords.findIndex((entry) => entry.requestId === record.requestId);
    usageRecords = existing >= 0
      ? usageRecords.map((entry, index) => index === existing ? record : entry)
      : [...usageRecords, record].slice(-64);
    notifyUsage();
    return record;
  };
  return Object.freeze({
    async complete({ config, system = '', messages = [], responseMode = 'text', responseSchema = null, signal = undefined }) {
      if (typeof fetchImpl !== 'function') throw providerError('AI_PROVIDER_UNAVAILABLE', 'No browser fetch implementation is available.');
      const resolved = requireConfig(config);
      const adapter = adapterRegistry[resolved.protocol.id];
      if (!adapter) throw providerError('AI_PROVIDER_UNSUPPORTED', 'The selected AI protocol is not supported.');
      const requestId = globalThis.crypto?.randomUUID?.() ?? `ai-request-${Date.now()}`;
      let usage = setUsageRecord({ requestId, protocol: resolved.protocol.id, model: resolved.model, status: 'started', usage: unavailableProviderUsage() });
      traceStore.append({ id: requestId, stage: 'request-started', protocol: resolved.protocol.id, model: resolved.model, status: 'started', usage });
      let settled = false;
      const onAbort = () => {
        if (!settled) usage = setUsageRecord({ requestId, protocol: resolved.protocol.id, model: resolved.model, status: 'aborted', usage });
      };
      signal?.addEventListener?.('abort', onAbort, { once: true });
      let result;
      try {
        const adapterResult = await adapter.complete({
          fetchImpl,
          endpoint: endpointFor(resolved),
          apiKey: resolved.apiKey,
          model: resolved.model,
          system: String(system ?? ''),
          messages: messages.map((message) => ({ role: message.role, content: String(message.content ?? '') })),
          responseMode,
          responseSchema,
          requestProfile: resolved.requestProfile,
          signal,
        });
        result = typeof adapterResult === 'string' ? { text: adapterResult, usage: unavailableProviderUsage() } : adapterResult;
        usage = setUsageRecord({ requestId, protocol: resolved.protocol.id, model: resolved.model, status: 'completed', usage: result?.usage });
        traceStore.append({ id: requestId, stage: 'provider-response', protocol: resolved.protocol.id, model: resolved.model, status: 'received', usage });
        traceStore.append({ id: requestId, stage: 'parse', protocol: resolved.protocol.id, model: resolved.model, status: responseMode === 'json' ? 'structured' : 'text' });
      } catch (error) {
        const status = signal?.aborted || error?.name === 'AbortError' ? 'aborted' : 'failed';
        usage = setUsageRecord({ requestId, protocol: resolved.protocol.id, model: resolved.model, status, usage: error?.details?.usage ?? usage });
        traceStore.append({ id: requestId, stage: 'failed', protocol: resolved.protocol.id, model: resolved.model, status: error?.code ?? 'failed', usage });
        settled = true;
        signal?.removeEventListener?.('abort', onAbort);
        if (error?.code?.startsWith('AI_')) throw error;
        throw providerError('AI_PROVIDER_UNAVAILABLE', 'The AI provider request was unavailable.');
      }
      settled = true;
      signal?.removeEventListener?.('abort', onAbort);
      traceStore.append({ id: requestId, stage: 'completed', protocol: resolved.protocol.id, model: resolved.model, status: 'completed', usage });
      return {
        text: String(result?.text ?? ''),
        provider: resolved.displayName || resolved.protocol.id,
        protocol: resolved.protocol.id,
        model: resolved.model,
        usage,
      };
    },
    recordTrace(entry) { return traceStore.append(entry); },
    getRequestTrace() { return traceStore.snapshot(); },
    getUsageSummary() { return summarizeProviderUsage(usageRecords); },
    getUsageRecords() { return structuredClone(usageRecords); },
    subscribeUsage(listener) {
      if (typeof listener !== 'function') return () => {};
      usageListeners.add(listener);
      return () => usageListeners.delete(listener);
    },
    resetUsage() {
      usageRecords = [];
      notifyUsage();
    },
  });
}

export { adapters as providerAdapters };
