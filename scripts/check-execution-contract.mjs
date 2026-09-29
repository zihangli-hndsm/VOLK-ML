import assert from 'node:assert/strict';
import {
  acceptExecutionResultV1,
  assessExecutionCapabilityV1,
  createExecutionRequestV1,
  createExecutionResultV1,
  EXECUTION_CAPABILITY_STATUSES,
  executionIdentityDigestV1,
  executionRequestDigestV1,
  getExecutionCapabilityV1,
  validateExecutionRequestV1,
  validateExecutionResultV1,
} from '../src/core/execution/executionContract.js';
import { G2_ATTENTION_PROFILE_ID, G2_ATTENTION_PROFILE_SHA256 } from '../src/core/playground/importedAttention/profile.js';

const now = '2026-09-28T00:00:00.000Z';
const digest = (value) => executionIdentityDigestV1(value);
const browserRequest = () => createExecutionRequestV1({
  requestId: 'exec-browser-001',
  projectSessionId: 'project-session-001',
  graphIdentity: { kind: 'graph', fingerprint: 'graph-semantic-v1-abcdef-4' },
  inputIdentity: digest({ rows: 3, values: [1, 2, 3] }),
  configIdentity: digest({ provider: 'browser-cpu', seed: 1 }),
  providerId: 'browser-cpu',
  mode: 'fit',
  budget: { maxDurationMs: 120_000, maxInputBytes: 2_000_000, maxOutputBytes: 128_000 },
  approvedAt: now,
});
const request = browserRequest();
assert.equal(validateExecutionRequestV1(request), true);
const browserCapability = getExecutionCapabilityV1('browser-cpu');
assert.deepEqual(EXECUTION_CAPABILITY_STATUSES, ['supported', 'unsupported', 'not-assessed']);
assert.equal(browserCapability.status, 'supported');
assert.ok(EXECUTION_CAPABILITY_STATUSES.includes(browserCapability.status));
assert.equal(assessExecutionCapabilityV1({
  providerId: 'browser-cpu',
  graphIdentity: request.graphIdentity,
  mode: 'fit',
}).status, 'supported', 'Browser CPU advertises its graph-fit capability.');
assert.deepEqual(getExecutionCapabilityV1('future-provider'), {
  providerId: 'future-provider', status: 'not-assessed', reason: 'EXECUTION_PROVIDER_NOT_REGISTERED',
});
assert.match(executionRequestDigestV1(request), /^sha256:[a-f0-9]{64}$/);
assert.equal(request.approval.requestDigest, executionRequestDigestV1(request), 'Explicit approval binds the exact request digest.');

const result = createExecutionResultV1({
  request,
  runId: 'run-browser-001',
  status: 'succeeded',
  providerVersion: 'browser-runtime-v1',
  startedAt: now,
  finishedAt: '2026-09-28T00:00:01.000Z',
  output: { modelType: 'linear_regression', metrics: { rmse: 0.25 } },
});
assert.equal(validateExecutionResultV1(result, request), true);
assert.deepEqual(acceptExecutionResultV1(result, request, {
  projectSessionId: request.projectSessionId,
  graphIdentity: request.graphIdentity.fingerprint,
  inputIdentity: request.inputIdentity,
  configIdentity: request.configIdentity,
}), { accepted: true, output: result.output });

assert.throws(() => createExecutionRequestV1({
  ...request,
  artifactIdentity: { kind: 'artifact', profileId: G2_ATTENTION_PROFILE_ID, sha256: G2_ATTENTION_PROFILE_SHA256 },
}), /EXECUTION_IDENTITY_EXCLUSIVE/);
const artifactIdentity = { kind: 'artifact', profileId: G2_ATTENTION_PROFILE_ID, sha256: G2_ATTENTION_PROFILE_SHA256 };
const commonRequest = {
  requestId: 'exec-capability-case-001',
  projectSessionId: 'project-session-001',
  inputIdentity: digest({ input: 'registered' }),
  configIdentity: digest({ config: 'registered' }),
  budget: { maxDurationMs: 30_000, maxInputBytes: 16_000, maxOutputBytes: 32_000 },
  approvedAt: now,
};
const browserArtifactCapability = assessExecutionCapabilityV1({
  providerId: 'browser-cpu', artifactIdentity, mode: 'fit',
});
assert.equal(browserArtifactCapability.status, 'unsupported');
assert.equal(browserArtifactCapability.reason, 'EXECUTION_IDENTITY_PROVIDER_MISMATCH');
assert.throws(() => createExecutionRequestV1({
  ...commonRequest, artifactIdentity, providerId: 'browser-cpu', mode: 'fit',
}), /EXECUTION_IDENTITY_PROVIDER_MISMATCH/, 'Browser CPU rejects artifact execution.');
const onnxGraphCapability = assessExecutionCapabilityV1({
  providerId: 'local-onnxruntime-cpu', graphIdentity: request.graphIdentity, mode: 'compare',
});
assert.equal(onnxGraphCapability.status, 'unsupported');
assert.equal(onnxGraphCapability.reason, 'EXECUTION_IDENTITY_PROVIDER_MISMATCH');
assert.throws(() => createExecutionRequestV1({
  ...commonRequest, graphIdentity: request.graphIdentity, providerId: 'local-onnxruntime-cpu', mode: 'compare',
}), /EXECUTION_IDENTITY_PROVIDER_MISMATCH/, 'ONNX Runtime rejects graph execution.');
assert.throws(() => createExecutionRequestV1({
  ...commonRequest,
  artifactIdentity: { kind: 'artifact', profileId: 'unregistered-profile', sha256: G2_ATTENTION_PROFILE_SHA256 },
  providerId: 'local-onnxruntime-cpu', mode: 'compare',
}), /EXECUTION_ARTIFACT_PROFILE_UNSUPPORTED/);
assert.throws(() => createExecutionRequestV1({
  ...commonRequest,
  artifactIdentity: { ...artifactIdentity, sha256: 'b'.repeat(64) },
  providerId: 'local-onnxruntime-cpu', mode: 'compare',
}), /EXECUTION_ARTIFACT_HASH_UNSUPPORTED/);
assert.equal(assessExecutionCapabilityV1({
  providerId: 'local-onnxruntime-cpu', artifactIdentity, mode: 'compare',
}).status, 'supported', 'The registered G2 profile and exact pinned artifact are executable.');
assert.throws(() => validateExecutionRequestV1({ ...request, unexpected: true }), /EXECUTION_REQUEST_SCHEMA_INVALID/);
assert.throws(() => validateExecutionRequestV1({ ...request, approval: { ...request.approval, requestDigest: `sha256:${'0'.repeat(64)}` } }), /EXECUTION_APPROVAL_INVALID/);
assert.throws(() => createExecutionResultV1({
  request,
  runId: 'run-wrong-provenance',
  status: 'succeeded',
  providerVersion: 'browser-runtime-v1',
  startedAt: now,
  finishedAt: '2026-09-28T00:00:01.000Z',
  output: { modelType: 'linear_regression' },
  provenance: 'pedagogical-simulation',
}), /EXECUTION_RESULT_PROVENANCE_INVALID/, 'A registered live adapter cannot mislabel its output as a simulation.');
const smallOutputRequest = createExecutionRequestV1({
  requestId: 'exec-small-output-001',
  projectSessionId: 'project-session-001',
  graphIdentity: { kind: 'graph', fingerprint: 'graph-semantic-v1-abcdef-4' },
  inputIdentity: digest({ rows: 3 }),
  configIdentity: digest({ provider: 'browser-cpu' }),
  providerId: 'browser-cpu',
  mode: 'fit',
  budget: { maxDurationMs: 1000, maxInputBytes: 1000, maxOutputBytes: 24 },
  approvedAt: now,
});
assert.throws(() => createExecutionResultV1({
  request: smallOutputRequest,
  runId: 'run-unicode-over-budget',
  status: 'succeeded',
  providerVersion: 'browser-runtime-v1',
  startedAt: now,
  finishedAt: '2026-09-28T00:00:01.000Z',
  output: { message: '界'.repeat(8) },
}), /EXECUTION_APPROVAL_INVALID|EXECUTION_JSON_TOO_LARGE/, 'Output budgets count UTF-8 bytes, not JavaScript code units.');
assert.throws(() => createExecutionRequestV1({
  requestId: 'over-budget',
  projectSessionId: 'project-session-001',
  artifactIdentity,
  inputIdentity: digest({ inputs: [1] }),
  configIdentity: digest({ profile: 'v1' }),
  providerId: 'local-onnxruntime-cpu',
  mode: 'compare',
  budget: { maxDurationMs: 120_001, maxInputBytes: 1_000, maxOutputBytes: 1_000 },
  approvedAt: now,
}), /EXECUTION_BUDGET_INVALID/);

const artifactRequest = createExecutionRequestV1({
  requestId: 'exec-g2-001',
  projectSessionId: 'project-session-g2',
  artifactIdentity,
  inputIdentity: digest({ pair: [1, 2] }),
  configIdentity: digest({ provider: 'onnxruntime-cpu', version: '1.30.0' }),
  providerId: 'local-onnxruntime-cpu',
  mode: 'compare',
  budget: { maxDurationMs: 30_000, maxInputBytes: 16_000, maxOutputBytes: 32_000 },
  approvedAt: now,
});
const artifactResult = createExecutionResultV1({
  request: artifactRequest,
  runId: 'run-g2-001',
  status: 'succeeded',
  providerVersion: '1.30.0',
  startedAt: now,
  finishedAt: '2026-09-28T00:00:01.000Z',
  output: { sampleA: { logits: [0.1, 0.9] } },
});
assert.equal(Object.hasOwn(artifactResult, 'graphFingerprint'), false, 'Artifact runs never fabricate a graph identity.');
assert.equal(artifactResult.graphIdentity, null);
assert.equal(artifactResult.provenance, 'live-local');
assert.equal(artifactResult.adapterId, 'onnxruntime-cpu');
assert.equal(acceptExecutionResultV1(artifactResult, artifactRequest, {
  projectSessionId: artifactRequest.projectSessionId,
  artifactIdentity: `${artifactRequest.artifactIdentity.profileId}:${artifactRequest.artifactIdentity.sha256}`,
  inputIdentity: artifactRequest.inputIdentity,
  configIdentity: artifactRequest.configIdentity,
}).accepted, true);

const mismatchedOnnxGraphRequest = {
  ...request,
  providerId: 'local-onnxruntime-cpu',
  adapterId: 'onnxruntime-cpu',
  mode: 'compare',
};
mismatchedOnnxGraphRequest.approval = {
  ...request.approval,
  requestDigest: executionRequestDigestV1(mismatchedOnnxGraphRequest),
};
assert.throws(() => acceptExecutionResultV1({
  ...result,
  providerId: mismatchedOnnxGraphRequest.providerId,
  adapterId: mismatchedOnnxGraphRequest.adapterId,
}, mismatchedOnnxGraphRequest, {
  projectSessionId: request.projectSessionId,
  graphIdentity: request.graphIdentity.fingerprint,
  inputIdentity: request.inputIdentity,
  configIdentity: request.configIdentity,
}), /EXECUTION_IDENTITY_PROVIDER_MISMATCH/, 'A claimed successful result cannot legitimize ONNX graph execution.');

const mismatchedBrowserArtifactRequest = {
  ...artifactRequest,
  providerId: 'browser-cpu',
  adapterId: 'volk-browser-runtime',
  mode: 'fit',
};
mismatchedBrowserArtifactRequest.approval = {
  ...artifactRequest.approval,
  requestDigest: executionRequestDigestV1(mismatchedBrowserArtifactRequest),
};
assert.throws(() => acceptExecutionResultV1({
  ...artifactResult,
  providerId: mismatchedBrowserArtifactRequest.providerId,
  adapterId: mismatchedBrowserArtifactRequest.adapterId,
}, mismatchedBrowserArtifactRequest, {
  projectSessionId: artifactRequest.projectSessionId,
  artifactIdentity: `${artifactRequest.artifactIdentity.profileId}:${artifactRequest.artifactIdentity.sha256}`,
  inputIdentity: artifactRequest.inputIdentity,
  configIdentity: artifactRequest.configIdentity,
}), /EXECUTION_IDENTITY_PROVIDER_MISMATCH/, 'A claimed successful result cannot legitimize Browser CPU artifact execution.');

for (const status of ['failed', 'cancelled', 'timed-out', 'stale']) {
  const failed = createExecutionResultV1({
    request,
    runId: `run-${status}`,
    status,
    providerVersion: 'browser-runtime-v1',
    startedAt: now,
    finishedAt: '2026-09-28T00:00:01.000Z',
    output: { impossible: true },
    cancellationDisposition: status === 'cancelled' ? 'client-discarded' : 'none',
    diagnostics: [status.toUpperCase()],
  });
  assert.equal(failed.output, null);
  assert.equal(acceptExecutionResultV1(failed, request, {
    projectSessionId: request.projectSessionId,
    graphIdentity: request.graphIdentity.fingerprint,
    inputIdentity: request.inputIdentity,
    configIdentity: request.configIdentity,
  }).accepted, false, `${status} results cannot reach a consumer.`);
}

assert.equal(acceptExecutionResultV1(result, request, {
  projectSessionId: 'new-session',
  graphIdentity: request.graphIdentity.fingerprint,
  inputIdentity: request.inputIdentity,
  configIdentity: request.configIdentity,
}).reason, 'stale', 'Late results from another project session are discarded.');
assert.throws(() => validateExecutionResultV1({ ...result, artifactIdentity: { kind: 'artifact', profileId: 'x', sha256: 'a'.repeat(64) } }, request), /EXECUTION_RESULT_SCHEMA_INVALID|EXECUTION_RESULT_IDENTITY_MISMATCH/);

console.log('PASS Execution Contract v1: explicit adapter capability states, graph/artifact provider binding, exact G2 profile/hash, digest-bound approval, budgets, canonical provenance, and fail-closed result acceptance.');
