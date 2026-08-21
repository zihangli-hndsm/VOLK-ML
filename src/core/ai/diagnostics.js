export const AI_DIAGNOSTIC_CODES = Object.freeze([
  'AI_CONFIG_MISSING',
  'AI_ENDPOINT_INVALID',
  'AI_AUTH_FAILED',
  'AI_MODEL_NOT_FOUND',
  'AI_RATE_LIMITED',
  'AI_NETWORK_OR_CORS',
  'AI_TIMEOUT',
  'AI_RESPONSE_INVALID',
  'AI_OUTPUT_MISSING',
  'AI_STRUCTURED_OUTPUT_UNSUPPORTED',
  'AI_INTERPRETER_INVALID',
  'AI_PLANNER_FAILED',
  'AI_FIDELITY_FAILED',
]);

const DIAGNOSTIC_STAGES = new Set([
  'configuration',
  'network',
  'request-started',
  'provider-response',
  'parse',
  'interpreter-validation',
  'fallback',
  'authentication',
  'model',
  'basic-text',
  'structured-output',
  'interpreter',
  'completed',
  'failed',
]);

function boundedText(value, max = 280, knownSecret = '') {
  const secret = String(knownSecret ?? '');
  return String(value ?? '')
    .replace(secret && secret.length >= 4 ? new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : /$^/g, '[redacted]')
    .replace(/authorization\s*:\s*bearer\s+\S+/gi, 'authorization: [redacted]')
    .replace(/(api[_ -]?key|token|secret)\s*[:=]\s*\S+/gi, '$1: [redacted]')
    .slice(0, max);
}

export function sanitizeEndpoint(endpoint) {
  try {
    const url = new URL(String(endpoint ?? ''));
    return `${url.origin}${url.pathname}`.slice(0, 240);
  } catch {
    return null;
  }
}

export function classifyAiError(error) {
  const status = Number(error?.details?.status) || null;
  const providerMessage = String(error?.details?.providerMessage ?? error?.message ?? '').toLowerCase();
  if (error?.code === 'AI_KEY_REQUIRED' || status === 401 || status === 403) return 'AI_AUTH_FAILED';
  if (status === 404 || /model.*(not found|does not exist|unavailable)/.test(providerMessage)) return 'AI_MODEL_NOT_FOUND';
  if (status === 429) return 'AI_RATE_LIMITED';
  if (error?.code === 'AI_PROVIDER_RESPONSE_INVALID') return 'AI_RESPONSE_INVALID';
  if (error?.code === 'AI_PROVIDER_OUTPUT_MISSING') return 'AI_OUTPUT_MISSING';
  if (error?.code === 'AI_PROVIDER_REFUSAL') return 'AI_OUTPUT_MISSING';
  if (error?.code === 'AI_PROVIDER_RESPONSE_INCOMPLETE') return 'AI_TIMEOUT';
  if (error?.code === 'AI_INVALID_EXPLORATION_INTERPRETATION') return 'AI_INTERPRETER_INVALID';
  if (/structured|response[_ -]?format|json[_ -]?object/.test(providerMessage)) return 'AI_STRUCTURED_OUTPUT_UNSUPPORTED';
  if (error?.code === 'AI_PROVIDER_REQUEST_FAILED') return 'AI_NETWORK_OR_CORS';
  if (error?.code === 'AI_PROVIDER_UNAVAILABLE' || error?.code === 'AI_PROVIDER_UNSUPPORTED') return 'AI_NETWORK_OR_CORS';
  return AI_DIAGNOSTIC_CODES.includes(error?.code) ? error.code : 'AI_NETWORK_OR_CORS';
}

export function createAiDiagnostic({ error, config = {}, stage = 'failed', fallbackUsed = false, latencyMs = null, requestId = null } = {}) {
  const normalizedStage = DIAGNOSTIC_STAGES.has(stage) ? stage : 'failed';
  return Object.freeze({
    version: 1,
    stage: normalizedStage,
    errorCode: classifyAiError(error),
    protocol: String(config?.protocol ?? '').slice(0, 80) || null,
    vendor: String(config?.vendorId ?? config?.displayName ?? '').slice(0, 80) || null,
    model: String(config?.model ?? '').slice(0, 120) || null,
    endpoint: sanitizeEndpoint(config?.endpoint),
    httpStatus: Number(error?.details?.status) || null,
    providerMessage: boundedText(error?.details?.providerMessage ?? error?.message, 280, config?.apiKey),
    fallbackUsed: Boolean(fallbackUsed),
    latencyMs: Number.isFinite(latencyMs) ? Math.max(0, Math.round(latencyMs)) : null,
    requestId: requestId ? String(requestId).slice(0, 80) : null,
  });
}

export function createRequestTraceStore(maxEntries = 8) {
  let entries = [];
  return Object.freeze({
    append(entry) {
      const next = {
        version: 1,
        id: String(entry?.id ?? `ai-request-${Date.now()}`).slice(0, 80),
        stage: DIAGNOSTIC_STAGES.has(entry?.stage) ? entry.stage : 'failed',
        at: Number.isFinite(entry?.at) ? entry.at : Date.now(),
        protocol: String(entry?.protocol ?? '').slice(0, 80) || null,
        model: String(entry?.model ?? '').slice(0, 120) || null,
        status: String(entry?.status ?? '').slice(0, 40) || null,
      };
      entries = [...entries, next].slice(-Math.max(1, Math.min(16, maxEntries)));
      return structuredClone(next);
    },
    snapshot() {
      return structuredClone(entries);
    },
    reset() {
      entries = [];
    },
  });
}

export function diagnosticText(diagnostic) {
  if (!diagnostic) return '';
  return [
    `stage=${diagnostic.stage}`,
    `code=${diagnostic.errorCode}`,
    diagnostic.protocol ? `protocol=${diagnostic.protocol}` : null,
    diagnostic.vendor ? `vendor=${diagnostic.vendor}` : null,
    diagnostic.model ? `model=${diagnostic.model}` : null,
    diagnostic.endpoint ? `endpoint=${diagnostic.endpoint}` : null,
    diagnostic.httpStatus ? `httpStatus=${diagnostic.httpStatus}` : null,
    diagnostic.providerMessage ? `message=${diagnostic.providerMessage}` : null,
    `fallbackUsed=${diagnostic.fallbackUsed}`,
  ].filter(Boolean).join('\n');
}
