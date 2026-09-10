// Provider-reported token metadata only. This module never estimates usage
// from prompts, responses, model names, or request sizes.

export const PROVIDER_USAGE_VERSION = 1;
export const MAX_USAGE_TOKENS = 1_000_000_000;

const integer = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0
  ? Math.min(MAX_USAGE_TOKENS, Math.floor(Number(value)))
  : null;

const sumKnown = (values) => {
  const known = values.map(integer).filter((value) => value !== null);
  return known.length ? Math.min(MAX_USAGE_TOKENS, known.reduce((total, value) => total + value, 0)) : null;
};

export function unavailableProviderUsage() {
  return Object.freeze({
    version: PROVIDER_USAGE_VERSION,
    reported: false,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    reasoningTokens: null,
    totalTokens: null,
  });
}

export function normalizeProviderUsage(raw, { protocol = null } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return unavailableProviderUsage();
  if (raw.version === PROVIDER_USAGE_VERSION && Object.prototype.hasOwnProperty.call(raw, 'reported')) {
    if (!raw.reported) return unavailableProviderUsage();
    const inputTokens = integer(raw.inputTokens);
    const outputTokens = integer(raw.outputTokens);
    const cachedTokens = integer(raw.cachedTokens);
    const reasoningTokens = integer(raw.reasoningTokens);
    const totalTokens = integer(raw.totalTokens);
    if (![inputTokens, outputTokens, cachedTokens, reasoningTokens, totalTokens].some((value) => value !== null)) return unavailableProviderUsage();
    return Object.freeze({ version: PROVIDER_USAGE_VERSION, reported: true, inputTokens, outputTokens, cachedTokens, reasoningTokens, totalTokens });
  }
  const isResponses = protocol === 'openai-responses';
  const isGemini = protocol === 'gemini-compatible';
  const inputTokens = integer(isGemini ? raw.promptTokenCount : (isResponses ? raw.input_tokens : (raw.prompt_tokens ?? raw.input_tokens)));
  const outputTokens = integer(isGemini ? raw.candidatesTokenCount : (isResponses ? raw.output_tokens : (raw.completion_tokens ?? raw.output_tokens)));
  const totalTokens = integer(isGemini ? raw.totalTokenCount : raw.total_tokens);
  const cachedTokens = isGemini
    ? integer(raw.cachedContentTokenCount)
    : isResponses
      ? integer(raw.input_tokens_details?.cached_tokens)
      : sumKnown([raw.prompt_tokens_details?.cached_tokens, raw.cache_read_input_tokens, raw.cache_creation_input_tokens, raw.cached_tokens]);
  const reasoningTokens = isGemini
    ? integer(raw.thoughtsTokenCount)
    : isResponses
      ? integer(raw.output_tokens_details?.reasoning_tokens)
      : integer(raw.completion_tokens_details?.reasoning_tokens ?? raw.reasoning_tokens);
  const reported = [inputTokens, outputTokens, cachedTokens, reasoningTokens, totalTokens].some((value) => value !== null);
  if (!reported) return unavailableProviderUsage();
  return Object.freeze({
    version: PROVIDER_USAGE_VERSION,
    reported: true,
    inputTokens,
    outputTokens,
    cachedTokens,
    reasoningTokens,
    totalTokens,
  });
}

export function summarizeProviderUsage(records = []) {
  const normalized = Array.isArray(records) ? records : [];
  const usageRecords = normalized.map((record) => record?.usage ?? record).filter(Boolean);
  const reportedRecords = usageRecords.filter((record) => record?.reported === true);
  const sumField = (field) => sumKnown(reportedRecords.map((record) => record?.[field]));
  return Object.freeze({
    version: PROVIDER_USAGE_VERSION,
    requestCount: Math.min(MAX_USAGE_TOKENS, normalized.length),
    reportedUsageCalls: Math.min(MAX_USAGE_TOKENS, reportedRecords.length),
    callsWithoutUsage: Math.min(MAX_USAGE_TOKENS, Math.max(0, normalized.length - reportedRecords.length)),
    inputTokens: sumField('inputTokens'),
    outputTokens: sumField('outputTokens'),
    cachedTokens: sumField('cachedTokens'),
    reasoningTokens: sumField('reasoningTokens'),
    totalTokens: sumField('totalTokens'),
  });
}

export function sanitizeProviderUsageSummary(summary) {
  const safe = summary && typeof summary === 'object' ? summary : {};
  const bounded = (value) => integer(value);
  return Object.freeze({
    version: PROVIDER_USAGE_VERSION,
    requestCount: bounded(safe.requestCount) ?? 0,
    reportedUsageCalls: bounded(safe.reportedUsageCalls) ?? 0,
    callsWithoutUsage: bounded(safe.callsWithoutUsage) ?? 0,
    inputTokens: bounded(safe.inputTokens),
    outputTokens: bounded(safe.outputTokens),
    cachedTokens: bounded(safe.cachedTokens),
    reasoningTokens: bounded(safe.reasoningTokens),
    totalTokens: bounded(safe.totalTokens),
  });
}

export function sanitizeProviderUsageRecord(record, { requestId = null, protocol = null, model = null, status = 'completed' } = {}) {
  const usage = record?.reported === true ? normalizeProviderUsage(record) : unavailableProviderUsage();
  return Object.freeze({
    version: PROVIDER_USAGE_VERSION,
    requestId: requestId ? String(requestId).slice(0, 80) : null,
    protocol: protocol ? String(protocol).slice(0, 80) : null,
    model: model ? String(model).slice(0, 120) : null,
    status: ['started', 'received', 'completed', 'failed', 'cancelled', 'aborted', 'timeout'].includes(status) ? status : 'failed',
    ...usage,
  });
}
