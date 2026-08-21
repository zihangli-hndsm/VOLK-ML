import { getProviderProtocol } from './providerRegistry.js';
import { getProviderPreset, providerPresetForProtocol } from './providerPresets.js';

export function defaultAiConfig(protocolId = 'openai-responses') {
  const protocol = getProviderProtocol(protocolId) ?? getProviderProtocol('openai-responses');
  const preset = protocol.id === 'openai-responses' ? providerPresetForProtocol(protocol.id) : null;
  return {
    protocol: protocol.id,
    vendorId: preset?.vendorId ?? null,
    presetId: preset?.vendorId ?? null,
    displayName: '',
    endpoint: '',
    model: protocol.defaultModel,
    apiKey: '',
  };
}

export function normalizeAiConfig(config) {
  if (!config) return null;
  const protocolId = config.protocol ?? config.providerId ?? 'openai-compatible';
  const protocol = getProviderProtocol(protocolId);
  // The generic OpenAI-compatible protocol is intentionally ambiguous. A
  // legacy/custom config without an explicit vendor must stay custom rather
  // than being silently relabeled as a catalog provider.
  const preset = config.vendorId
    ? getProviderPreset(config.vendorId)
    : protocolId === 'openai-responses' ? providerPresetForProtocol(protocolId) : null;
  if (!protocol) return null;
  return {
    protocol: protocol.id,
    vendorId: String(config.vendorId ?? preset?.vendorId ?? '').trim() || null,
    presetId: String(config.presetId ?? preset?.vendorId ?? '').trim() || null,
    displayName: String(config.displayName ?? '').trim(),
    endpoint: String(config.endpoint ?? '').trim(),
    model: String(config.model ?? protocol.defaultModel).trim(),
    apiKey: String(config.apiKey ?? ''),
  };
}

export function isAiConfigured(config) {
  const normalized = normalizeAiConfig(config);
  return Boolean(normalized?.apiKey.trim() && normalized.model);
}

export function changeAiProtocol(config, protocolId) {
  return { ...defaultAiConfig(protocolId), displayName: String(config?.displayName ?? '').trim() };
}

export function clearAiKey(config) {
  const normalized = normalizeAiConfig(config) ?? defaultAiConfig();
  return { ...normalized, apiKey: '' };
}

export function endpointSafety(endpoint) {
  const value = String(endpoint ?? '').trim();
  if (!value) return { kind: 'default', safe: true };
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol === 'https:' || local && url.protocol === 'http:') return { kind: local ? 'local' : 'https', safe: true };
    return { kind: 'insecure', safe: false };
  } catch {
    return { kind: 'invalid', safe: false };
  }
}
