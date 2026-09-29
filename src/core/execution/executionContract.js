import { artifactFingerprintJsonV1 } from '../graph/artifactFingerprint.js';
import { G2_ATTENTION_ACCEPTED_SHA256S, G2_ATTENTION_PROFILE_ID } from '../playground/importedAttention/profile.js';

export const EXECUTION_REQUEST_VERSION = 1;
export const EXECUTION_RESULT_VERSION = 1;
export const EXECUTION_CAPABILITY_STATUSES = Object.freeze(['supported', 'unsupported', 'not-assessed']);
export const EXECUTION_PROVENANCE = Object.freeze([
  'live-local',
  'live-webgpu',
  'live-cloud',
  'replayed-real-run',
  'pedagogical-simulation',
]);

export const EXECUTION_PROVIDER_PROFILES = Object.freeze({
  'browser-cpu': Object.freeze({
    status: 'supported',
    reason: null,
    adapterId: 'volk-browser-runtime',
    provenance: 'live-local',
    identityKind: 'graph',
    modes: Object.freeze(['fit']),
  }),
  'browser-webgpu': Object.freeze({
    status: 'supported',
    reason: null,
    adapterId: 'volk-browser-webgpu-mlp',
    provenance: 'live-webgpu',
    identityKind: 'graph',
    modes: Object.freeze(['inference']),
  }),
  'local-onnxruntime-cpu': Object.freeze({
    status: 'supported',
    reason: null,
    adapterId: 'onnxruntime-cpu',
    provenance: 'live-local',
    identityKind: 'artifact',
    profileId: G2_ATTENTION_PROFILE_ID,
    artifactSha256s: G2_ATTENTION_ACCEPTED_SHA256S,
    modes: Object.freeze(['compare']),
  }),
});

const REQUEST_KEYS = Object.freeze([
  'schemaVersion', 'requestId', 'projectSessionId', 'graphIdentity', 'artifactIdentity',
  'inputIdentity', 'configIdentity', 'providerId', 'adapterId', 'budget', 'mode', 'approval',
]);
const RESULT_KEYS = Object.freeze([
  'schemaVersion', 'requestId', 'runId', 'status', 'projectSessionId', 'graphIdentity',
  'artifactIdentity', 'inputIdentity', 'configIdentity', 'providerId', 'adapterId',
  'providerVersion', 'startedAt', 'finishedAt', 'output', 'diagnostics', 'provenance',
  'cancellationDisposition',
]);
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SEMANTIC_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SHA256_ID = /^sha256:[a-f0-9]{64}$/;
const REASON_CODE = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
const EXECUTION_MODES = new Set(['fit', 'compare', 'inference']);
const EXECUTION_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timed-out', 'stale']);
const CANCELLATION_DISPOSITIONS = new Set(['none', 'client-discarded', 'worker-stopped']);
const MAX_BUDGET = Object.freeze({ durationMs: 120_000, inputBytes: 20 * 1024 * 1024, outputBytes: 256 * 1024 });
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_DIAGNOSTICS = 8;

function executionProviderProfile(providerId) {
  return typeof providerId === 'string' && Object.hasOwn(EXECUTION_PROVIDER_PROFILES, providerId)
    ? EXECUTION_PROVIDER_PROFILES[providerId]
    : null;
}

function capabilityResult(providerId, status, reason = null, adapterId = null) {
  const safeProviderId = typeof providerId === 'string' && providerId.length <= 128 ? providerId : null;
  return Object.freeze({ providerId: safeProviderId, status, reason, ...(adapterId ? { adapterId } : {}) });
}

/** Reports only explicitly registered H0 adapter capabilities; unknown providers are not assessed. */
export function getExecutionCapabilityV1(providerId) {
  const profile = executionProviderProfile(providerId);
  if (!profile) return capabilityResult(providerId, 'not-assessed', 'EXECUTION_PROVIDER_NOT_REGISTERED');
  return Object.freeze({
    providerId,
    status: profile.status,
    reason: profile.reason,
    adapterId: profile.adapterId,
    identityKind: profile.identityKind,
    ...(profile.profileId ? { profileId: profile.profileId } : {}),
    ...(profile.artifactSha256s ? { artifactSha256s: profile.artifactSha256s } : {}),
    modes: profile.modes,
  });
}

/** Classifies whether a specific semantic request is executable by its registered adapter. */
export function assessExecutionCapabilityV1({ providerId, graphIdentity = null, artifactIdentity = null, mode } = {}) {
  const profile = executionProviderProfile(providerId);
  if (!profile) return capabilityResult(providerId, 'not-assessed', 'EXECUTION_PROVIDER_NOT_REGISTERED');
  if (profile.status !== 'supported') return capabilityResult(providerId, profile.status, profile.reason, profile.adapterId);
  if (Boolean(graphIdentity) === Boolean(artifactIdentity)) {
    return capabilityResult(providerId, 'unsupported', 'EXECUTION_IDENTITY_EXCLUSIVE', profile.adapterId);
  }
  const identityKind = graphIdentity ? 'graph' : 'artifact';
  if (identityKind !== profile.identityKind) {
    return capabilityResult(providerId, 'unsupported', 'EXECUTION_IDENTITY_PROVIDER_MISMATCH', profile.adapterId);
  }
  if (graphIdentity && (!exactKeys(graphIdentity, ['kind', 'fingerprint']) || graphIdentity.kind !== 'graph'
    || typeof graphIdentity.fingerprint !== 'string' || !SEMANTIC_ID.test(graphIdentity.fingerprint))) {
    return capabilityResult(providerId, 'unsupported', 'EXECUTION_GRAPH_IDENTITY_INVALID', profile.adapterId);
  }
  if (artifactIdentity && (!exactKeys(artifactIdentity, ['kind', 'profileId', 'sha256']) || artifactIdentity.kind !== 'artifact'
    || typeof artifactIdentity.profileId !== 'string' || typeof artifactIdentity.sha256 !== 'string')) {
    return capabilityResult(providerId, 'unsupported', 'EXECUTION_ARTIFACT_IDENTITY_INVALID', profile.adapterId);
  }
  if (!profile.modes.includes(mode)) {
    return capabilityResult(providerId, 'unsupported', 'EXECUTION_MODE_UNSUPPORTED', profile.adapterId);
  }
  if (artifactIdentity) {
    if (artifactIdentity.profileId !== profile.profileId) {
      return capabilityResult(providerId, 'unsupported', 'EXECUTION_ARTIFACT_PROFILE_UNSUPPORTED', profile.adapterId);
    }
    if (!profile.artifactSha256s.includes(artifactIdentity.sha256)) {
      return capabilityResult(providerId, 'unsupported', 'EXECUTION_ARTIFACT_HASH_UNSUPPORTED', profile.adapterId);
    }
  }
  return capabilityResult(providerId, 'supported', null, profile.adapterId);
}

function fail(code) {
  throw Object.assign(new TypeError(code), { code });
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype);
}

function exactKeys(value, required) {
  return isRecord(value)
    && Object.keys(value).length === required.length
    && required.every((key) => Object.hasOwn(value, key));
}

function boundedIdentity(value, label, { digest = false } = {}) {
  if (typeof value !== 'string' || value.length > 256
    || !(digest ? SHA256_ID.test(value) : SEMANTIC_ID.test(value))) fail(`EXECUTION_${label.toUpperCase()}_INVALID`);
  return value;
}

function canonicalJson(value, budget = { bytes: 0 }, depth = 0) {
  if (depth > 24) fail('EXECUTION_JSON_DEPTH_EXCEEDED');
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    budget.bytes += new TextEncoder().encode(value).byteLength;
    if (budget.bytes > MAX_RESULT_BYTES) fail('EXECUTION_JSON_TOO_LARGE');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('EXECUTION_JSON_NUMBER_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) fail('EXECUTION_JSON_ARRAY_INVALID');
    const entries = value.map((item) => canonicalJson(item, budget, depth + 1));
    budget.bytes += entries.length;
    if (budget.bytes > MAX_RESULT_BYTES) fail('EXECUTION_JSON_TOO_LARGE');
    return `[${entries.join(',')}]`;
  }
  if (!isRecord(value)) fail('EXECUTION_JSON_VALUE_INVALID');
  const entries = Object.keys(value).sort().map((key) => {
    budget.bytes += new TextEncoder().encode(key).byteLength;
    return `${JSON.stringify(key)}:${canonicalJson(value[key], budget, depth + 1)}`;
  });
  if (budget.bytes > MAX_RESULT_BYTES) fail('EXECUTION_JSON_TOO_LARGE');
  return `{${entries.join(',')}}`;
}

function copyJson(value, maxBytes = MAX_RESULT_BYTES) {
  const serialized = canonicalJson(value);
  if (new TextEncoder().encode(serialized).byteLength > maxBytes) fail('EXECUTION_JSON_TOO_LARGE');
  return JSON.parse(serialized);
}

function requestWithoutApproval(request) {
  const { approval: _approval, ...unsigned } = request;
  return unsigned;
}

export function executionRequestDigestV1(request) {
  if (!isRecord(request)) fail('EXECUTION_REQUEST_INVALID');
  return artifactFingerprintJsonV1(requestWithoutApproval(request));
}

function validateIdentityUnion(request) {
  const graph = request.graphIdentity;
  const artifact = request.artifactIdentity;
  if (Boolean(graph) === Boolean(artifact)) fail('EXECUTION_IDENTITY_EXCLUSIVE');
  if (graph) {
    if (!exactKeys(graph, ['kind', 'fingerprint']) || graph.kind !== 'graph') fail('EXECUTION_GRAPH_IDENTITY_INVALID');
    boundedIdentity(graph.fingerprint, 'graph_identity');
  }
  if (artifact) {
    if (!exactKeys(artifact, ['kind', 'profileId', 'sha256']) || artifact.kind !== 'artifact') fail('EXECUTION_ARTIFACT_IDENTITY_INVALID');
    boundedIdentity(artifact.profileId, 'artifact_profile');
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) fail('EXECUTION_ARTIFACT_HASH_INVALID');
  }
}

export function validateExecutionRequestV1(request) {
  if (!isRecord(request) || request.schemaVersion !== EXECUTION_REQUEST_VERSION) fail('EXECUTION_REQUEST_VERSION_UNSUPPORTED');
  if (!exactKeys(request, REQUEST_KEYS)) fail('EXECUTION_REQUEST_SCHEMA_INVALID');
  if (!REQUEST_ID.test(request.requestId) || !REQUEST_ID.test(request.projectSessionId)) fail('EXECUTION_REQUEST_ID_INVALID');
  validateIdentityUnion(request);
  boundedIdentity(request.inputIdentity, 'input_identity', { digest: true });
  boundedIdentity(request.configIdentity, 'config_identity', { digest: true });
  const provider = executionProviderProfile(request.providerId);
  if (!provider || request.adapterId !== provider.adapterId) fail('EXECUTION_PROVIDER_UNSUPPORTED');
  if (!EXECUTION_MODES.has(request.mode)) fail('EXECUTION_MODE_UNSUPPORTED');
  const capability = assessExecutionCapabilityV1({
    providerId: request.providerId,
    graphIdentity: request.graphIdentity,
    artifactIdentity: request.artifactIdentity,
    mode: request.mode,
  });
  if (capability.status !== 'supported') fail(capability.reason ?? 'EXECUTION_CAPABILITY_UNAVAILABLE');
  if (!exactKeys(request.budget, ['maxDurationMs', 'maxInputBytes', 'maxOutputBytes'])) fail('EXECUTION_BUDGET_INVALID');
  for (const [key, ceiling] of Object.entries(MAX_BUDGET)) {
    const value = request.budget[`max${key[0].toUpperCase()}${key.slice(1)}`];
    if (!Number.isInteger(value) || value < 1 || value > ceiling) fail('EXECUTION_BUDGET_INVALID');
  }
  if (request.budget.maxOutputBytes > MAX_RESULT_BYTES) fail('EXECUTION_BUDGET_INVALID');
  if (!exactKeys(request.approval, ['kind', 'approvedAt', 'requestDigest'])
    || request.approval.kind !== 'explicit-user-action'
    || typeof request.approval.approvedAt !== 'string'
    || !Number.isFinite(Date.parse(request.approval.approvedAt))
    || !SHA256_ID.test(request.approval.requestDigest)
    || request.approval.requestDigest !== executionRequestDigestV1(request)) fail('EXECUTION_APPROVAL_INVALID');
  return true;
}

export function createExecutionRequestV1({
  requestId,
  projectSessionId,
  graphIdentity = null,
  artifactIdentity = null,
  inputIdentity,
  configIdentity,
  providerId,
  mode,
  budget,
  approvedAt = new Date().toISOString(),
} = {}) {
  const provider = executionProviderProfile(providerId);
  const base = {
    schemaVersion: EXECUTION_REQUEST_VERSION,
    requestId,
    projectSessionId,
    graphIdentity: graphIdentity ? copyJson(graphIdentity, 1024) : null,
    artifactIdentity: artifactIdentity ? copyJson(artifactIdentity, 1024) : null,
    inputIdentity,
    configIdentity,
    providerId,
    adapterId: provider?.adapterId ?? null,
    budget: copyJson(budget, 1024),
    mode,
  };
  const request = {
    ...base,
    approval: {
      kind: 'explicit-user-action',
      approvedAt,
      requestDigest: artifactFingerprintJsonV1(base),
    },
  };
  validateExecutionRequestV1(request);
  return Object.freeze(request);
}

function resultIdentityFromRequest(request) {
  return {
    projectSessionId: request.projectSessionId,
    graphIdentity: request.graphIdentity,
    artifactIdentity: request.artifactIdentity,
    inputIdentity: request.inputIdentity,
    configIdentity: request.configIdentity,
  };
}

export function createExecutionResultV1({
  request,
  runId,
  status,
  providerVersion,
  startedAt,
  finishedAt = new Date().toISOString(),
  output = null,
  diagnostics = [],
  provenance = null,
  cancellationDisposition = 'none',
} = {}) {
  validateExecutionRequestV1(request);
  const result = {
    schemaVersion: EXECUTION_RESULT_VERSION,
    requestId: request.requestId,
    runId,
    status,
    ...resultIdentityFromRequest(request),
    providerId: request.providerId,
    adapterId: request.adapterId,
    providerVersion,
    startedAt,
    finishedAt,
    output: status === 'succeeded' ? copyJson(output, request.budget.maxOutputBytes) : null,
    diagnostics: Array.isArray(diagnostics) ? diagnostics.slice(0, MAX_DIAGNOSTICS) : diagnostics,
    provenance: provenance ?? EXECUTION_PROVIDER_PROFILES[request.providerId].provenance,
    cancellationDisposition,
  };
  validateExecutionResultV1(result, request);
  return Object.freeze(result);
}

export function validateExecutionResultV1(result, request) {
  validateExecutionRequestV1(request);
  if (!isRecord(result) || result.schemaVersion !== EXECUTION_RESULT_VERSION) fail('EXECUTION_RESULT_VERSION_UNSUPPORTED');
  if (!exactKeys(result, RESULT_KEYS)) fail('EXECUTION_RESULT_SCHEMA_INVALID');
  if (result.requestId !== request.requestId || !REQUEST_ID.test(result.runId)) fail('EXECUTION_RESULT_CORRELATION_INVALID');
  if (!EXECUTION_STATUSES.has(result.status)) fail('EXECUTION_RESULT_STATUS_INVALID');
  if (result.projectSessionId !== request.projectSessionId
    || JSON.stringify(result.graphIdentity) !== JSON.stringify(request.graphIdentity)
    || JSON.stringify(result.artifactIdentity) !== JSON.stringify(request.artifactIdentity)
    || result.inputIdentity !== request.inputIdentity
    || result.configIdentity !== request.configIdentity
    || result.providerId !== request.providerId
    || result.adapterId !== request.adapterId) fail('EXECUTION_RESULT_IDENTITY_MISMATCH');
  if (typeof result.providerVersion !== 'string' || result.providerVersion.length < 1 || result.providerVersion.length > 96) fail('EXECUTION_RESULT_PROVIDER_INVALID');
  for (const time of [result.startedAt, result.finishedAt]) {
    if (typeof time !== 'string' || !Number.isFinite(Date.parse(time))) fail('EXECUTION_RESULT_TIME_INVALID');
  }
  if (Date.parse(result.finishedAt) < Date.parse(result.startedAt)) fail('EXECUTION_RESULT_TIME_INVALID');
  if (!Array.isArray(result.diagnostics) || result.diagnostics.length > MAX_DIAGNOSTICS
    || result.diagnostics.some((code) => typeof code !== 'string' || !REASON_CODE.test(code))) fail('EXECUTION_RESULT_DIAGNOSTICS_INVALID');
  if (!EXECUTION_PROVENANCE.includes(result.provenance)
    || result.provenance !== EXECUTION_PROVIDER_PROFILES[request.providerId].provenance) fail('EXECUTION_RESULT_PROVENANCE_INVALID');
  if (!CANCELLATION_DISPOSITIONS.has(result.cancellationDisposition)) fail('EXECUTION_RESULT_CANCELLATION_INVALID');
  if (result.status === 'succeeded') {
    const output = copyJson(result.output, Math.min(request.budget.maxOutputBytes, MAX_RESULT_BYTES));
    if (result.cancellationDisposition !== 'none' || output === null) fail('EXECUTION_RESULT_OUTPUT_INVALID');
  } else if (result.output !== null) fail('EXECUTION_RESULT_OUTPUT_INVALID');
  return true;
}

/** Validates an adapter result and current semantic identities before any consumer commits it. */
export function acceptExecutionResultV1(result, request, current = {}) {
  validateExecutionResultV1(result, request);
  if (result.status !== 'succeeded') return { accepted: false, reason: result.status };
  if (current.projectSessionId !== request.projectSessionId
    || (request.graphIdentity && current.graphIdentity !== request.graphIdentity.fingerprint)
    || (request.artifactIdentity && current.artifactIdentity !== `${request.artifactIdentity.profileId}:${request.artifactIdentity.sha256}`)
    || current.inputIdentity !== request.inputIdentity
    || current.configIdentity !== request.configIdentity) {
    return { accepted: false, reason: 'stale' };
  }
  return { accepted: true, output: result.output };
}

export function executionIdentityDigestV1(value) {
  return artifactFingerprintJsonV1(value);
}
