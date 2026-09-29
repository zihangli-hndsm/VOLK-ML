import {
  G2_ATTENTION_PROFILE_ID,
  G2_ATTENTION_PROFILE_SHA256,
  isG2AttentionArtifactSha256,
} from './playground/importedAttention/profile.js';
import { G2_ATTENTION_EXPORT_MANIFEST } from './playground/importedAttention/profileManifest.js';

const LEGACY_LOCAL_MODEL_REFERENCE_KEYS = new Set(['profileId', 'sha256']);
const CURRENT_LOCAL_MODEL_REFERENCE_KEYS = new Set(['profileId', 'sha256', 'manifestId']);

export function createLocalModelReference({ profileId, sha256, manifestId } = {}) {
  if (profileId !== G2_ATTENTION_PROFILE_ID || !isG2AttentionArtifactSha256(sha256)) {
    throw new Error('LOCAL_MODEL_REFERENCE_INVALID');
  }
  if (sha256 === G2_ATTENTION_PROFILE_SHA256) {
    const resolvedManifestId = manifestId ?? G2_ATTENTION_EXPORT_MANIFEST.manifestId;
    if (resolvedManifestId !== G2_ATTENTION_EXPORT_MANIFEST.manifestId) throw new Error('LOCAL_MODEL_REFERENCE_INVALID');
    return Object.freeze({ profileId, sha256, manifestId: resolvedManifestId });
  }
  if (manifestId !== undefined) throw new Error('LOCAL_MODEL_REFERENCE_INVALID');
  return Object.freeze({ profileId, sha256 });
}

export function validateLocalModelReferences(value) {
  if (!Array.isArray(value) || value.length > 8) return false;
  const unique = new Set();
  for (const reference of value) {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return false;
    const keys = Object.keys(reference);
    if (reference.profileId !== G2_ATTENTION_PROFILE_ID || !isG2AttentionArtifactSha256(reference.sha256)) return false;
    const expectedKeys = reference.sha256 === G2_ATTENTION_PROFILE_SHA256
      ? CURRENT_LOCAL_MODEL_REFERENCE_KEYS
      : LEGACY_LOCAL_MODEL_REFERENCE_KEYS;
    if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) return false;
    if (reference.sha256 === G2_ATTENTION_PROFILE_SHA256
      && reference.manifestId !== G2_ATTENTION_EXPORT_MANIFEST.manifestId) return false;
    const identity = `${reference.profileId}:${reference.sha256}`;
    if (unique.has(identity)) return false;
    unique.add(identity);
  }
  return true;
}

export function migrateLocalModelReferencesToManifestV1(value) {
  if (!Array.isArray(value)) return value;
  return value.map((reference) => {
    if (reference?.profileId === G2_ATTENTION_PROFILE_ID
      && reference.sha256 === G2_ATTENTION_PROFILE_SHA256
      && Object.keys(reference).length === 2
      && Object.hasOwn(reference, 'profileId')
      && Object.hasOwn(reference, 'sha256')) {
      return { ...reference, manifestId: G2_ATTENTION_EXPORT_MANIFEST.manifestId };
    }
    return reference;
  });
}
