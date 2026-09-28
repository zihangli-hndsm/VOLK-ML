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

async function parseResponse(response) {
  let value;
  try {
    value = await response.json();
  } catch {
    throw runtimeError('responseInvalid');
  }
  if (!response.ok) {
    const code = value?.error?.code;
    throw runtimeError(code === 'MODEL_PROFILE_MISMATCH' ? 'modelProfileMismatch' : 'runtimeUnavailable');
  }
  return value;
}

export function createLocalAttentionClient({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cryptoApi = globalThis.crypto,
} = {}) {
  const request = async (url, init, signal, validateResponse) => {
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
      const response = await fetchImpl(url, { ...init, signal: controller.signal, mode: 'cors', credentials: 'omit' });
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
    async health({ signal } = {}) {
      return request(`${baseUrl}/health`, { headers: { Accept: 'application/json' } }, signal, (value) => {
        if (value?.apiVersion !== G2_ATTENTION_API_VERSION || value?.profileId !== G2_ATTENTION_PROFILE_ID
          || value?.provider !== 'CPUExecutionProvider' || value?.status !== 'ok') {
          throw runtimeError('responseInvalid');
        }
        return Object.freeze({ available: true, modelLoaded: value.modelLoaded === true, modelHash: value.modelHash ?? null });
      });
    },

    async importModel(file, { signal } = {}) {
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
      });
    },

    async compare({ modelHash, inputIdsA = G2_INPUT_IDS_A, inputIdsB = G2_INPUT_IDS_B, signal } = {}) {
      const id = requestId();
      return request(`${baseUrl}/v1/compare`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiVersion: G2_ATTENTION_API_VERSION,
          requestId: id,
          modelHash,
          inputIdsA,
          inputIdsB,
        }),
      }, signal, (value) => validateImportedAttentionCompareResponse(value, {
        requestId: id,
        modelHash,
        inputIdsA,
        inputIdsB,
      }));
    },
  });
}

export const localAttentionClient = createLocalAttentionClient();
