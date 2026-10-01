import {
  H2_LOCAL_PYTHON_PROFILE_V1,
  H2_LOCAL_PYTHON_RESPONSE_V1,
  attachH2LocalPythonAuthorizationV1,
  validateH2LocalPythonResultV1,
  validateH2LocalPythonRequestV1,
} from '../core/execution/h2LocalPython.js';

const configuredUrl = import.meta.env.VITE_VOLK_H2_LOCAL_PYTHON_URL ?? '';
const MAX_RESPONSE_BYTES = 256 * 1024;

function clientError(code) {
  return Object.assign(new Error(code), { code });
}

function localBaseUrl() {
  if (!configuredUrl) throw clientError('H2_COMPANION_UNCONFIGURED');
  let parsed;
  try { parsed = new URL(configuredUrl); } catch { throw clientError('H2_COMPANION_URL_INVALID'); }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1'
    || parsed.port !== '8766' || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw clientError('H2_COMPANION_URL_UNSUPPORTED');
  }
  return parsed.origin;
}

async function readJson(response) {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) throw clientError('H2_RESPONSE_TOO_LARGE');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw clientError('H2_RESPONSE_TOO_LARGE');
  try { return JSON.parse(text); } catch { throw clientError('H2_RESPONSE_MALFORMED'); }
}

async function requestJson(url, body, signal) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (signal?.aborted) throw clientError(signal.reason === 'deadline' ? 'H2_DEADLINE_EXCEEDED' : 'H2_CANCELLED');
    throw clientError('H2_COMPANION_OFFLINE');
  }
  const result = await readJson(response);
  if (!response.ok) {
    const code = typeof result?.error?.code === 'string' && /^H2_[A-Z0-9_]{1,48}$/.test(result.error.code)
      ? result.error.code : 'H2_POLICY_RESPONSE_INVALID';
    throw clientError(code);
  }
  return result;
}

export function isH2LocalPythonConfigured() {
  return Boolean(configuredUrl);
}

export async function checkH2LocalPythonHealth({ signal } = {}) {
  let url;
  try { url = new URL('/v1/h2/health', localBaseUrl()); } catch (error) { return { available: false, reason: error.code ?? 'H2_COMPANION_URL_INVALID' }; }
  try {
    const response = await fetch(url, { signal, cache: 'no-store' });
    const body = await readJson(response);
    if (!response.ok || body.schemaVersion !== 'volk.h2.health.v1' || body.profile !== H2_LOCAL_PYTHON_PROFILE_V1
      || typeof body.available !== 'boolean') return { available: false, reason: 'H2_HEALTH_RESPONSE_INVALID' };
    return { available: body.available, reason: body.reason ?? null };
  } catch (error) {
    return { available: false, reason: error.code ?? 'H2_COMPANION_OFFLINE' };
  }
}

export async function runH2LocalPythonFit(request, { signal } = {}) {
  const base = localBaseUrl();
  if (request?.identity?.normalizedRequestFingerprint === undefined) throw clientError('H2_REQUEST_IDENTITY_INVALID');
  const authorizationEnvelope = await requestJson(new URL('/v1/h2/authorize', base), request, signal);
  if (authorizationEnvelope?.schemaVersion !== 'volk.h2.authorization.v1'
    || !authorizationEnvelope.authorization || Object.keys(authorizationEnvelope.authorization).sort().join(',')
      !== 'authorizationId,expiresAt,nonce,requestFingerprint'
    || authorizationEnvelope.authorization.requestFingerprint !== request.identity.normalizedRequestFingerprint
    || !Number.isFinite(Date.parse(authorizationEnvelope.authorization.expiresAt))
    || Date.parse(authorizationEnvelope.authorization.expiresAt) <= Date.now()
    || typeof authorizationEnvelope.authorization.authorizationId !== 'string'
    || typeof authorizationEnvelope.authorization.nonce !== 'string'
    || authorizationEnvelope.authorization.nonce.length < 16) throw clientError('H2_AUTHORIZATION_INVALID');
  const signedRequest = attachH2LocalPythonAuthorizationV1(request, authorizationEnvelope.authorization);
  const validatedRequest = await validateH2LocalPythonRequestV1(signedRequest, { compile: false });
  const response = await requestJson(new URL('/v1/h2/fit', base), signedRequest, signal);
  if (response.schemaVersion === H2_LOCAL_PYTHON_RESPONSE_V1 && response.status === 'failed') {
    throw clientError(response.error?.code ?? 'H2_POLICY_RESPONSE_INVALID');
  }
  try { validateH2LocalPythonResultV1(response, validatedRequest); } catch { throw clientError('H2_POLICY_RESPONSE_INVALID'); }
  return { request: signedRequest, validated: validatedRequest, result: response };
}
