export const DEFAULT_VOLK_API_URL = 'http://127.0.0.1:8000';

export const CLOUD_CONFIGURATION = Object.freeze({
  NOT_CONFIGURED: 'not-configured',
  CONFIGURED: 'configured',
});

function runtimeEnv() {
  return typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
}

function configuredApiUrl() {
  const configured = runtimeEnv().VITE_VOLK_API_URL;
  return typeof configured === 'string' && configured.trim() ? configured.trim() : null;
}

export function normalizeVolkApiUrl(value = configuredApiUrl()) {
  const candidate = String(value ?? '').trim() || DEFAULT_VOLK_API_URL;
  return candidate.replace(/\/+$/, '');
}

export function getVolkApiUrl() {
  return resolveVolkCloudConfig().apiUrl;
}

export function resolveVolkCloudConfig({ mode = runtimeEnv().MODE, apiUrl = configuredApiUrl() } = {}) {
  const normalizedMode = mode === 'production' ? 'production' : 'development';
  if (typeof apiUrl === 'string' && apiUrl.trim()) {
    return Object.freeze({
      mode: normalizedMode,
      status: CLOUD_CONFIGURATION.CONFIGURED,
      configured: true,
      apiUrl: normalizeVolkApiUrl(apiUrl),
    });
  }
  if (normalizedMode === 'development') {
    return Object.freeze({
      mode: normalizedMode,
      status: CLOUD_CONFIGURATION.NOT_CONFIGURED,
      configured: false,
      apiUrl: DEFAULT_VOLK_API_URL,
    });
  }
  return Object.freeze({
    mode: normalizedMode,
    status: CLOUD_CONFIGURATION.NOT_CONFIGURED,
    configured: false,
    apiUrl: null,
  });
}
