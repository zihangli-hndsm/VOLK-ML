import {
  G2_ATTENTION_PROFILE_ID,
  isG2AttentionArtifactSha256,
} from './playground/importedAttention/profile.js';

const LOCAL_MODEL_REFERENCE_KEYS = new Set(['profileId', 'sha256']);

export function createLocalModelReference({ profileId, sha256 } = {}) {
  if (profileId !== G2_ATTENTION_PROFILE_ID || !isG2AttentionArtifactSha256(sha256)) {
    throw new Error('LOCAL_MODEL_REFERENCE_INVALID');
  }
  return Object.freeze({ profileId, sha256 });
}

export function validateLocalModelReferences(value) {
  if (!Array.isArray(value) || value.length > 8) return false;
  const unique = new Set();
  for (const reference of value) {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return false;
    const keys = Object.keys(reference);
    if (keys.length !== LOCAL_MODEL_REFERENCE_KEYS.size || keys.some((key) => !LOCAL_MODEL_REFERENCE_KEYS.has(key))) return false;
    if (reference.profileId !== G2_ATTENTION_PROFILE_ID || !isG2AttentionArtifactSha256(reference.sha256)) return false;
    const identity = `${reference.profileId}:${reference.sha256}`;
    if (unique.has(identity)) return false;
    unique.add(identity);
  }
  return true;
}
