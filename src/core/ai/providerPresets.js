// Phase 10A: provider/model choices are maintainable data, not UI branches.
// Presets never contain secrets and remain advisory; custom configuration is
// always available when a catalog entry becomes stale.

export const PROVIDER_PRESET_VERSION = 1;
export const PROVIDER_CATALOG_VERIFIED_AT = '2026-08-21';

const model = (id, labelKey, tier, requestProfile = {}) => Object.freeze({
  id,
  labelKey,
  tier,
  status: 'verified',
  requestProfile: Object.freeze({ ...requestProfile }),
});

const PRESETS = Object.freeze([
  Object.freeze({
    vendorId: 'openai',
    labelKey: 'ai.provider.openai',
    protocolId: 'openai-responses',
    endpoint: 'https://api.openai.com/v1/responses',
    verifiedAt: PROVIDER_CATALOG_VERIFIED_AT,
    capabilities: Object.freeze({ structuredOutput: true, temperature: false, topP: false, topK: false }),
    models: Object.freeze([
      model('gpt-5.6', 'ai.model.gpt56', 'frontier', { structuredOutput: true, temperature: false }),
      model('gpt-5.6-sol', 'ai.model.gpt56Sol', 'frontier', { structuredOutput: true, temperature: false }),
      model('gpt-5.6-terra', 'ai.model.gpt56Terra', 'frontier', { structuredOutput: true, temperature: false }),
      model('gpt-5.6-luna', 'ai.model.gpt56Luna', 'frontier', { structuredOutput: true, temperature: false }),
    ]),
  }),
  Object.freeze({
    vendorId: 'deepseek',
    labelKey: 'ai.provider.deepseek',
    protocolId: 'openai-compatible',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    verifiedAt: PROVIDER_CATALOG_VERIFIED_AT,
    capabilities: Object.freeze({ structuredOutput: 'fallback', temperature: true }),
    models: Object.freeze([
      model('deepseek-v4-flash', 'ai.model.deepseekV4Flash', 'fast', { structuredOutput: 'fallback' }),
      model('deepseek-v4-pro', 'ai.model.deepseekV4Pro', 'frontier', { structuredOutput: 'fallback' }),
    ]),
  }),
  Object.freeze({
    vendorId: 'anthropic',
    labelKey: 'ai.provider.anthropic',
    protocolId: 'anthropic-compatible',
    endpoint: 'https://api.anthropic.com/v1/messages',
    verifiedAt: PROVIDER_CATALOG_VERIFIED_AT,
    capabilities: Object.freeze({ structuredOutput: 'prompt-json', temperature: true }),
    models: Object.freeze([
      model('claude-opus-4-8', 'ai.model.claudeOpus48', 'frontier'),
      model('claude-sonnet-4-6', 'ai.model.claudeSonnet46', 'balanced'),
      model('claude-haiku-4-5-20251001', 'ai.model.claudeHaiku45', 'fast'),
    ]),
  }),
  Object.freeze({
    vendorId: 'google-gemini',
    labelKey: 'ai.provider.gemini',
    protocolId: 'gemini-compatible',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    verifiedAt: PROVIDER_CATALOG_VERIFIED_AT,
    capabilities: Object.freeze({ structuredOutput: 'json-mime', temperature: false, topP: false, topK: false }),
    models: Object.freeze([
      model('gemini-3.7-flash', 'ai.model.gemini37Flash', 'fast', { structuredOutput: 'json-mime', temperature: false, topP: false, topK: false }),
      model('gemini-3.5-flash-lite', 'ai.model.gemini35FlashLite', 'fast', { structuredOutput: 'json-mime', temperature: false, topP: false, topK: false }),
      model('gemini-3.1-pro-preview', 'ai.model.gemini31ProPreview', 'frontier', { structuredOutput: 'json-mime', temperature: false, topP: false, topK: false }),
    ]),
  }),
]);

const clone = (value) => structuredClone(value);

export function listProviderPresets() {
  return PRESETS.map(clone);
}

export function getProviderPreset(vendorId) {
  const preset = PRESETS.find((item) => item.vendorId === vendorId);
  return preset ? clone(preset) : null;
}

export function getModelPreset(vendorId, modelId) {
  const preset = PRESETS.find((item) => item.vendorId === vendorId);
  const selected = preset?.models.find((item) => item.id === modelId);
  return selected ? clone({ ...selected, vendorId, protocolId: preset.protocolId }) : null;
}

export function providerPresetForProtocol(protocolId) {
  const preset = PRESETS.find((item) => item.protocolId === protocolId);
  return preset ? clone(preset) : null;
}

export function isRecommendedModel(modelId) {
  return PRESETS.some((preset) => preset.models.some((item) => item.id === modelId));
}

export const PROVIDER_PRESETS = PRESETS;
