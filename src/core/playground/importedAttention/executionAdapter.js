import {
  createExecutionRequestV1,
  createExecutionResultV1,
  executionIdentityDigestV1,
} from '../../execution/executionContract.js';
import {
  G2_ATTENTION_API_VERSION,
  G2_ATTENTION_PROFILE_ID,
  G2_INPUT_IDS_A,
  G2_INPUT_IDS_B,
  isG2AttentionArtifactSha256,
} from './profile.js';

export function createG2ExecutionRequestV1({ projectSessionId, modelHash, requestId, providerVersion, approvedAt, artifactBindingId = null } = {}) {
  if (typeof modelHash !== 'string' || !modelHash.startsWith('sha256:')
    || !isG2AttentionArtifactSha256(modelHash.slice('sha256:'.length))) {
    throw Object.assign(new TypeError('G2 artifact identity is invalid.'), { code: 'EXECUTION_ARTIFACT_IDENTITY_INVALID' });
  }
  if (artifactBindingId !== null
    && (typeof artifactBindingId !== 'string' || artifactBindingId.length > 128
      || !/^artifact-binding-v1-[a-f0-9]{16}-[a-f0-9]{1,8}$/.test(artifactBindingId))) {
    throw Object.assign(new TypeError('G2 artifact correspondence identity is invalid.'), { code: 'G2_ARTIFACT_BINDING_INVALID' });
  }
  const sha256 = modelHash.slice('sha256:'.length);
  const inputIdentity = executionIdentityDigestV1({
    profileId: G2_ATTENTION_PROFILE_ID,
    sequenceLength: G2_INPUT_IDS_A.length,
    inputIdsA: [...G2_INPUT_IDS_A],
    inputIdsB: [...G2_INPUT_IDS_B],
  });
  const configIdentity = executionIdentityDigestV1({
    adapterId: 'onnxruntime-cpu',
    apiVersion: G2_ATTENTION_API_VERSION,
    profileId: G2_ATTENTION_PROFILE_ID,
    provider: 'CPUExecutionProvider',
    providerVersion,
    artifactMapping: artifactBindingId
      ? { kind: 'operator-correspondence', bindingId: artifactBindingId }
      : { kind: 'standalone-not-mapped-to-build' },
  });
  return createExecutionRequestV1({
    requestId,
    projectSessionId,
    artifactIdentity: { kind: 'artifact', profileId: G2_ATTENTION_PROFILE_ID, sha256 },
    inputIdentity,
    configIdentity,
    providerId: 'local-onnxruntime-cpu',
    mode: 'compare',
    budget: { maxDurationMs: 30_000, maxInputBytes: 16_384, maxOutputBytes: 32_768 },
    approvedAt,
  });
}

export function g2CurrentExecutionIdentityV1({ projectSessionId, modelHash, providerVersion, artifactBindingId = null } = {}) {
  const request = createG2ExecutionRequestV1({
    projectSessionId,
    modelHash,
    requestId: 'g2-identity-probe-0001',
    providerVersion,
    artifactBindingId,
    approvedAt: '2026-01-01T00:00:00.000Z',
  });
  return {
    projectSessionId,
    artifactIdentity: `${request.artifactIdentity.profileId}:${request.artifactIdentity.sha256}`,
    inputIdentity: request.inputIdentity,
    configIdentity: request.configIdentity,
  };
}

export function createG2ExecutionResultV1({ request, comparison, providerVersion, startedAt, finishedAt } = {}) {
  return createExecutionResultV1({
    request,
    runId: comparison?.requestId,
    status: 'succeeded',
    providerVersion,
    startedAt,
    finishedAt,
    output: comparison,
  });
}
