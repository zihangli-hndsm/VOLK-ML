import {
  G2_ATTENTION_MAX_MODEL_BYTES,
  G2_ATTENTION_PROFILE_ID,
  isG2AttentionArtifactSha256,
  sha256Hex,
} from './playground/importedAttention/profile.js';
import { G2_ATTENTION_EXPORT_MANIFEST } from './playground/importedAttention/profileManifest.js';

export const G2_LOCAL_MODEL_CACHE_DATABASE = 'volk-g2-local-model-cache-v1';
export const G2_LOCAL_MODEL_CACHE_STORE = 'artifacts';

function cacheError(code) {
  return Object.assign(new Error(`g2.${code}`), { translationKey: `g2.error.${code}` });
}

function validateReference(reference) {
  const keys = reference && typeof reference === 'object' && !Array.isArray(reference)
    ? Object.keys(reference)
    : [];
  const hasBaseIdentity = keys.includes('profileId') && keys.includes('sha256');
  const hasKnownManifest = keys.length === 3 && keys.includes('manifestId')
    && reference?.manifestId === G2_ATTENTION_EXPORT_MANIFEST.manifestId
    && reference?.sha256 === G2_ATTENTION_EXPORT_MANIFEST.artifact.sha256;
  const hasLegacyIdentity = keys.length === 2
    && reference?.sha256 !== G2_ATTENTION_EXPORT_MANIFEST.artifact.sha256;
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)
    || !hasBaseIdentity || (!hasLegacyIdentity && !hasKnownManifest)
    || reference.profileId !== G2_ATTENTION_PROFILE_ID || !isG2AttentionArtifactSha256(reference.sha256)) {
    throw cacheError('modelProfileMismatch');
  }
}

export function g2LocalModelCacheKey(reference) {
  validateReference(reference);
  return `${reference.profileId}:${reference.sha256}`;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(cacheError('modelCacheUnavailable'));
  });
}

function transactionResult(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(cacheError('modelCacheUnavailable'));
    transaction.onerror = () => reject(cacheError('modelCacheUnavailable'));
  });
}

function openCache() {
  if (!globalThis.indexedDB) return Promise.reject(cacheError('modelCacheUnavailable'));
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(G2_LOCAL_MODEL_CACHE_DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(G2_LOCAL_MODEL_CACHE_STORE)) {
        database.createObjectStore(G2_LOCAL_MODEL_CACHE_STORE);
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(cacheError('modelCacheUnavailable'));
    request.onblocked = () => reject(cacheError('modelCacheUnavailable'));
  });
}

async function readRecord(reference) {
  const database = await openCache();
  try {
    const transaction = database.transaction(G2_LOCAL_MODEL_CACHE_STORE, 'readonly');
    const complete = transactionResult(transaction);
    const record = await requestResult(
      transaction.objectStore(G2_LOCAL_MODEL_CACHE_STORE).get(g2LocalModelCacheKey(reference)),
    );
    await complete;
    return record;
  } finally {
    database.close();
  }
}

export async function deleteG2LocalModelArtifact(reference) {
  const key = g2LocalModelCacheKey(reference);
  const database = await openCache();
  try {
    const transaction = database.transaction(G2_LOCAL_MODEL_CACHE_STORE, 'readwrite');
    const complete = transactionResult(transaction);
    transaction.objectStore(G2_LOCAL_MODEL_CACHE_STORE).delete(key);
    await complete;
  } finally {
    database.close();
  }
}

export async function clearG2LocalModelCache() {
  const database = await openCache();
  try {
    const transaction = database.transaction(G2_LOCAL_MODEL_CACHE_STORE, 'readwrite');
    const complete = transactionResult(transaction);
    transaction.objectStore(G2_LOCAL_MODEL_CACHE_STORE).clear();
    await complete;
  } catch (error) {
    if (error?.translationKey) throw error;
    throw cacheError('modelCacheUnavailable');
  } finally {
    database.close();
  }
}

export async function saveG2LocalModelArtifact(file, reference) {
  const key = g2LocalModelCacheKey(reference);
  if (!file || typeof file.arrayBuffer !== 'function' || !Number.isInteger(file.size)
    || file.size < 1 || file.size > G2_ATTENTION_MAX_MODEL_BYTES) {
    throw cacheError('modelSizeInvalid');
  }
  const bytes = await file.arrayBuffer();
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== file.size
    || await sha256Hex(bytes) !== reference.sha256) {
    throw cacheError('modelProfileMismatch');
  }
  const database = await openCache();
  try {
    const transaction = database.transaction(G2_LOCAL_MODEL_CACHE_STORE, 'readwrite');
    const complete = transactionResult(transaction);
    const store = transaction.objectStore(G2_LOCAL_MODEL_CACHE_STORE);
    store.clear();
    store.put({
      profileId: reference.profileId,
      sha256: reference.sha256,
      bytes: new Blob([bytes], { type: 'application/octet-stream' }),
    }, key);
    await complete;
  } catch (error) {
    if (error?.translationKey) throw error;
    throw cacheError('modelCacheUnavailable');
  } finally {
    database.close();
  }
}

export async function loadG2LocalModelArtifact(reference) {
  const record = await readRecord(reference);
  if (record === undefined) return null;
  const validShape = record && typeof record === 'object'
    && !Array.isArray(record)
    && Object.keys(record).length === 3
    && record.profileId === reference.profileId
    && record.sha256 === reference.sha256
    && typeof Blob !== 'undefined'
    && record.bytes instanceof Blob
    && record.bytes.size > 0
    && record.bytes.size <= G2_ATTENTION_MAX_MODEL_BYTES;
  if (!validShape) {
    try { await deleteG2LocalModelArtifact(reference); } catch {}
    throw cacheError('modelCacheCorrupt');
  }

  let bytes;
  try {
    bytes = await record.bytes.arrayBuffer();
  } catch {
    try { await deleteG2LocalModelArtifact(reference); } catch {}
    throw cacheError('modelCacheCorrupt');
  }
  if (bytes.byteLength !== record.bytes.size || await sha256Hex(bytes) !== reference.sha256) {
    try { await deleteG2LocalModelArtifact(reference); } catch {}
    throw cacheError('modelCacheCorrupt');
  }
  return Object.freeze({
    name: 'cached-g2-model.onnx',
    size: bytes.byteLength,
    async arrayBuffer() { return bytes.slice(0); },
  });
}
