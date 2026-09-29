import {
  G2_ATTENTION_API_VERSION,
  G2_ATTENTION_MAX_MODEL_BYTES,
  G2_ATTENTION_PROFILE_ID,
  G2_ATTENTION_PROFILE_SHA256,
  G2_INPUT_IDS_A,
  G2_INPUT_IDS_B,
  isG2AttentionArtifactSha256,
  sha256Hex,
  validateImportedAttentionCompareResponse,
  validateImportedAttentionImportResponse,
  validateImportedAttentionModel,
} from '../../core/playground/importedAttention/profile.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8765';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const AUTH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

const ERROR_CODE_MAP = Object.freeze({
  AUTHORIZATION_REQUIRED: 'authorizationRequired',
  AUTHORIZATION_INVALID: 'authorizationInvalid',
  HOST_NOT_ALLOWED: 'connectionRejected',
  ORIGIN_NOT_ALLOWED: 'connectionRejected',
  API_VERSION_UNSUPPORTED: 'companionIncompatible',
  RUNNER_BUSY: 'runnerBusy',
  REQUEST_BODY_TIMEOUT: 'requestTimeout',
  INFERENCE_TIMEOUT: 'requestTimeout',
  REQUEST_SIZE_INVALID: 'modelSizeInvalid',
  MODEL_PROFILE_MISMATCH: 'modelProfileMismatch',
  PROVIDER_VERSION_MISMATCH: 'companionIncompatible',
});

function runtimeError(code) {
  const error = new Error(code);
  error.code = code;
  error.translationKey = `g2.error.${code}`;
  return error;
}

function callerAbortError(reason) {
  if (reason && typeof reason === 'object' && reason.name === 'AbortError') return reason;
  const error = new Error('Local model request was cancelled.');
  error.name = 'AbortError';
  if (reason !== undefined) error.cause = reason;
  return error;
}

function requestId() {
  return `g2-${globalThis.crypto.randomUUID()}`;
}

async function readBoundedJson(response) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw runtimeError('responseInvalid');
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let byteLength = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw runtimeError('responseInvalid');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock?.();
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw runtimeError('responseInvalid'); }
  }
  try {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_RESPONSE_BYTES) throw runtimeError('responseInvalid');
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error?.translationKey) throw error;
    throw runtimeError('responseInvalid');
  }
}

async function parseResponse(response) {
  const value = await readBoundedJson(response);
  if (!response.ok) {
    const code = value?.error?.code;
    throw runtimeError(ERROR_CODE_MAP[code] ?? 'runtimeUnavailable');
  }
  return value;
}

export function createLocalAttentionClient({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cryptoApi = globalThis.crypto,
} = {}) {
  const request = async (url, init, signal, validateResponse, token) => {
    if (typeof token !== 'string' || !AUTH_TOKEN_PATTERN.test(token)) throw runtimeError('authorizationRequired');
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort('timeout');
    }, timeoutMs);
    const abort = () => controller.abort(signal?.reason ?? 'aborted');
    let rejectOnAbort;
    const abortPromise = new Promise((_, reject) => { rejectOnAbort = reject; });
    const onRequestAbort = () => rejectOnAbort(controller.signal.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    controller.signal.addEventListener('abort', onRequestAbort, { once: true });
    if (controller.signal.aborted) onRequestAbort();

    const responseOperation = (async () => {
      const headers = new Headers(init.headers ?? {});
      headers.set('X-VOLK-Local-Authorization', token);
      const response = await fetchImpl(url, { ...init, headers, signal: controller.signal, mode: 'cors', credentials: 'omit' });
      const value = await parseResponse(response);
      return validateResponse(value);
    })();
    try {
      return await Promise.race([responseOperation, abortPromise]);
    } catch (error) {
      if (signal?.aborted) throw callerAbortError(signal.reason);
      if (timedOut) throw runtimeError('requestTimeout');
      if (error?.translationKey) throw error;
      if (controller.signal.aborted) throw runtimeError('requestTimeout');
      throw runtimeError('runtimeUnavailable');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', onRequestAbort);
    }
  };

  return Object.freeze({
    async health({ token, signal } = {}) {
      return request(`${baseUrl}/health`, { headers: { Accept: 'application/json' } }, signal, (value) => {
        if (value?.apiVersion !== G2_ATTENTION_API_VERSION || value?.profileId !== G2_ATTENTION_PROFILE_ID
          || value?.provider !== 'CPUExecutionProvider' || value?.adapterId !== 'onnxruntime-cpu'
          || value?.executionContractVersion !== 1 || typeof value?.providerVersion !== 'string'
          || !/^\d+\.\d+\.\d+$/.test(value.providerVersion) || value?.status !== 'ok'
          || value?.maxConcurrentRequests !== 1) {
          throw runtimeError('companionIncompatible');
        }
        return Object.freeze({
          available: true,
          modelLoaded: value.modelLoaded === true,
          modelHash: value.modelHash ?? null,
          apiVersion: value.apiVersion,
          profileId: value.profileId,
          provider: value.provider,
          providerVersion: value.providerVersion,
          adapterId: value.adapterId,
          executionContractVersion: value.executionContractVersion,
          maxConcurrentRequests: value.maxConcurrentRequests,
        });
      }, token);
    },

    async importModel(file, { token, signal } = {}) {
      validateImportedAttentionModel(file);
      if (!file.size || file.size > G2_ATTENTION_MAX_MODEL_BYTES) throw runtimeError('modelSizeInvalid');
      const bytes = await file.arrayBuffer();
      const digest = await sha256Hex(bytes, cryptoApi);
      if (!isG2AttentionArtifactSha256(digest)) throw runtimeError('modelProfileMismatch');
      const id = requestId();
      return request(`${baseUrl}/v1/model/import`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/octet-stream',
          'X-VOLK-API-Version': G2_ATTENTION_API_VERSION,
          'X-VOLK-Request-Id': id,
        },
        body: bytes,
      }, signal, (value) => {
        const validated = validateImportedAttentionImportResponse(value, { requestId: id, sha256: digest });
        return Object.freeze({ ...validated, modelHash: `sha256:${digest}` });
      }, token);
    },

    async compare({ modelHash, providerVersion, inputIdsA = G2_INPUT_IDS_A, inputIdsB = G2_INPUT_IDS_B, requestId: requestedId = null, token, signal } = {}) {
      const id = requestedId ?? requestId();
      if (typeof id !== 'string' || !/^g2-[A-Za-z0-9_-]{8,120}$/.test(id)
        || typeof providerVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(providerVersion)) throw runtimeError('responseInvalid');
      return request(`${baseUrl}/v1/compare`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiVersion: G2_ATTENTION_API_VERSION,
          providerVersion,
          requestId: id,
          modelHash,
          inputIdsA,
          inputIdsB,
        }),
      }, signal, (value) => validateImportedAttentionCompareResponse(value, {
        requestId: id,
        modelHash,
        providerVersion,
        inputIdsA,
        inputIdsB,
      }), token);
    },
  });
}

export const localAttentionClient = createLocalAttentionClient();
