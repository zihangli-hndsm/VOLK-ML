import { normalizeVolkApiUrl } from './config.js';

function cloudError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

export function createVolkCloudClient({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 3000 } = {}) {
  const apiUrl = normalizeVolkApiUrl(baseUrl);
  if (typeof fetchImpl !== 'function') throw cloudError('VOLK_CLOUD_FETCH_UNAVAILABLE');
  return Object.freeze({
    apiUrl,
    async health() {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const response = await fetchImpl(`${apiUrl}/health`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller?.signal,
        });
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        if (!response.ok) throw cloudError('VOLK_CLOUD_HEALTH_FAILED', { status: response.status });
        return body;
      } catch (error) {
        if (error?.code) throw error;
        throw cloudError('VOLK_CLOUD_HEALTH_UNREACHABLE');
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  });
}

export function createVolkCloudClientForConfig(config, options = {}) {
  if (!config?.apiUrl) return null;
  return createVolkCloudClient({ ...options, baseUrl: config.apiUrl });
}
