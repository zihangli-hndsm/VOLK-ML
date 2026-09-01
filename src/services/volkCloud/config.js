export const DEFAULT_VOLK_API_URL = 'http://127.0.0.1:8000';

function configuredApiUrl() {
  const configured = typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env.VITE_VOLK_API_URL
    : undefined;
  return typeof configured === 'string' && configured.trim() ? configured.trim() : DEFAULT_VOLK_API_URL;
}

export function normalizeVolkApiUrl(value = configuredApiUrl()) {
  const candidate = String(value ?? '').trim() || DEFAULT_VOLK_API_URL;
  return candidate.replace(/\/+$/, '');
}

export function getVolkApiUrl() {
  return normalizeVolkApiUrl();
}
