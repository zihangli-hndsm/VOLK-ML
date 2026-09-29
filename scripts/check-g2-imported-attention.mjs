import assert from 'node:assert/strict';
import { messages } from '../src/locales/ui.js';
import {
  G2_ATTENTION_API_VERSION,
  G2_ATTENTION_LEGACY_SHA256S,
  G2_ATTENTION_PROFILE_ID,
  G2_ATTENTION_PROFILE_SHA256,
  G2_INPUT_IDS_A,
  G2_INPUT_IDS_B,
  deriveImportedAttentionEvidence,
  validateImportedAttentionCompareResponse,
  validateImportedAttentionImportResponse,
} from '../src/core/playground/importedAttention/profile.js';
import { commitImportedAttentionExecution, createImportedAttentionEventStore } from '../src/core/playground/importedAttention/semanticEvents.js';
import { createG2ExecutionRequestV1, createG2ExecutionResultV1, g2CurrentExecutionIdentityV1 } from '../src/core/playground/importedAttention/executionAdapter.js';
import { createExecutionResultV1 } from '../src/core/execution/executionContract.js';
import { validateProjectForWorkspace, PROJECT_VERSION } from '../src/core/project.js';
import { createLocalModelReference, validateLocalModelReferences } from '../src/core/localModelReferences.js';
import { g2LocalModelCacheKey } from '../src/core/localModelCache.js';
import './check-g2-model-artifact-binding.mjs';

const modelHash = `sha256:${G2_ATTENTION_PROFILE_SHA256}`;
const startedAt = '2026-09-28T00:00:00.000Z';
assert.throws(() => createG2ExecutionRequestV1({
  projectSessionId: 'g2-project-session-001',
  modelHash,
  requestId: 'g2-invalid-binding-request-0001',
  providerVersion: '1.30.0',
  approvedAt: startedAt,
  artifactBindingId: 'unverified-build-mapping',
}), (error) => error?.code === 'G2_ARTIFACT_BINDING_INVALID', 'The execution contract accepts only bounded identities minted by the artifact-binding runtime.');
function executionForComparison(comparison) {
  const request = createG2ExecutionRequestV1({
    projectSessionId: 'g2-project-session-001',
    modelHash: comparison.modelHash,
    requestId: comparison.requestId,
    providerVersion: '1.30.0',
    approvedAt: startedAt,
  });
  const executionResult = createG2ExecutionResultV1({
    request,
    comparison,
    providerVersion: '1.30.0',
    startedAt,
    finishedAt: '2026-09-28T00:00:01.000Z',
  });
  const current = g2CurrentExecutionIdentityV1({
    projectSessionId: 'g2-project-session-001',
    modelHash: comparison.modelHash,
    providerVersion: '1.30.0',
  });
  return { request, executionResult, current };
}
function commitComparison(store, comparison) {
  const execution = executionForComparison(comparison);
  return { ...execution, ...commitImportedAttentionExecution(store, execution.executionResult, execution.request, execution.current) };
}
const flatRow = (index) => Array.from({ length: 6 }, (_, column) => column === index ? 1 : 0);
const uniform = () => Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 1 / 6));
const probabilities = () => [Array.from({ length: 2 }, uniform), Array.from({ length: 2 }, uniform)];
const responseFor = ({ inputIdsA = [...G2_INPUT_IDS_A], inputIdsB = [...G2_INPUT_IDS_B], changed = true, requestId = 'g2-request-0001' } = {}) => {
  const sampleA = { logits: [0.4, 0.8], attentionProbabilities: probabilities() };
  const sampleB = { logits: [0.2, 1.1], attentionProbabilities: probabilities() };
  if (changed) {
    sampleA.attentionProbabilities[0][0][0] = flatRow(0);
    sampleB.attentionProbabilities[0][0][0] = [0, 0.5, 0.1, 0.1, 0.2, 0.1];
  }
  return {
    apiVersion: G2_ATTENTION_API_VERSION,
    providerVersion: '1.30.0',
    profileId: G2_ATTENTION_PROFILE_ID,
    modelHash,
    requestId,
    inputIdsA,
    inputIdsB,
    sampleA,
    sampleB,
  };
};

assert.equal(PROJECT_VERSION, 10, 'The operator-manifest reference has its own project migration.');
assert.deepEqual(G2_INPUT_IDS_A.map((id, index) => id === G2_INPUT_IDS_B[index]), [true, true, true, true, false, true]);
assert.equal(validateLocalModelReferences([createLocalModelReference({ profileId: G2_ATTENTION_PROFILE_ID, sha256: G2_ATTENTION_PROFILE_SHA256 })]), true);
const legacyReference = createLocalModelReference({ profileId: G2_ATTENTION_PROFILE_ID, sha256: G2_ATTENTION_LEGACY_SHA256S[0] });
assert.equal(validateLocalModelReferences([legacyReference]), true, 'Only the explicitly registered exact-byte legacy alias remains importable.');
assert.equal(validateLocalModelReferences([{ profileId: G2_ATTENTION_PROFILE_ID, sha256: G2_ATTENTION_PROFILE_SHA256, filename: 'private-name.onnx' }]), false);
assert.equal(validateLocalModelReferences([{ profileId: G2_ATTENTION_PROFILE_ID, sha256: '0'.repeat(64) }]), false);
assert.equal(g2LocalModelCacheKey(createLocalModelReference({ profileId: G2_ATTENTION_PROFILE_ID, sha256: G2_ATTENTION_PROFILE_SHA256 })), `${G2_ATTENTION_PROFILE_ID}:${G2_ATTENTION_PROFILE_SHA256}`, 'Local model cache is content-addressed only for the registered profile hash.');
assert.equal(g2LocalModelCacheKey(legacyReference), `${G2_ATTENTION_PROFILE_ID}:${G2_ATTENTION_LEGACY_SHA256S[0]}`, 'Legacy cache keys retain their exact artifact identity.');
assert.throws(() => g2LocalModelCacheKey({ profileId: G2_ATTENTION_PROFILE_ID, sha256: G2_ATTENTION_PROFILE_SHA256 }), /g2.modelProfileMismatch/, 'The current artifact requires its registered manifest identity even for a cache reference.');
assert.throws(() => g2LocalModelCacheKey({ profileId: G2_ATTENTION_PROFILE_ID, sha256: '0'.repeat(64) }), /g2.modelProfileMismatch/);
assert.throws(() => g2LocalModelCacheKey({ profileId: G2_ATTENTION_PROFILE_ID, sha256: G2_ATTENTION_PROFILE_SHA256, filename: 'private.onnx' }), /g2.modelProfileMismatch/);

const oldProject = validateProjectForWorkspace({ format: 'VOLK-ML', version: 8, name: 'Old project', graph: { nodes: [], edges: [] } });
assert.deepEqual(oldProject.localModelReferences, [], 'Version 8 projects migrate with no local artifact references.');
const v9Project = validateProjectForWorkspace({
  format: 'VOLK-ML', version: 9, name: 'G2 v9 project', graph: { nodes: [], edges: [] },
  localModelReferences: [{ profileId: G2_ATTENTION_PROFILE_ID, sha256: G2_ATTENTION_PROFILE_SHA256 }],
});
assert.equal(v9Project.version, 10);
assert.deepEqual(v9Project.localModelReferences, [createLocalModelReference({ profileId: G2_ATTENTION_PROFILE_ID, sha256: G2_ATTENTION_PROFILE_SHA256 })], 'Version 9 current-profile references migrate to the registered exporter manifest.');
assert.throws(() => validateProjectForWorkspace({
  ...oldProject,
  localModelReferences: [{ profileId: G2_ATTENTION_PROFILE_ID, sha256: 'a'.repeat(64) }],
}), 'invalidProject');

validateImportedAttentionImportResponse({
  apiVersion: G2_ATTENTION_API_VERSION,
  profileId: G2_ATTENTION_PROFILE_ID,
  modelHash,
  requestId: 'g2-request-0001',
}, { requestId: 'g2-request-0001', sha256: G2_ATTENTION_PROFILE_SHA256 });
validateImportedAttentionImportResponse({
  apiVersion: G2_ATTENTION_API_VERSION,
  profileId: G2_ATTENTION_PROFILE_ID,
  modelHash: `sha256:${G2_ATTENTION_LEGACY_SHA256S[0]}`,
  requestId: 'g2-legacy-import-0001',
}, { requestId: 'g2-legacy-import-0001', sha256: G2_ATTENTION_LEGACY_SHA256S[0] });
assert.throws(() => validateImportedAttentionImportResponse({
  apiVersion: G2_ATTENTION_API_VERSION,
  profileId: G2_ATTENTION_PROFILE_ID,
  modelHash,
  requestId: 'g2-old-response',
}, { requestId: 'g2-request-0001', sha256: G2_ATTENTION_PROFILE_SHA256 }), /g2.responseInvalid/);

const strong = responseFor();
const validated = validateImportedAttentionCompareResponse(strong, {
  requestId: strong.requestId,
  modelHash,
  providerVersion: '1.30.0',
  inputIdsA: [...G2_INPUT_IDS_A],
  inputIdsB: [...G2_INPUT_IDS_B],
});
const evidence = deriveImportedAttentionEvidence(validated);
assert.equal(evidence.attentionChanged, true);
assert.equal(evidence.inputTokenPositionChanged, 4);
assert.throws(() => validateImportedAttentionCompareResponse({ ...strong, providerVersion: '1.29.9' }, {
  requestId: strong.requestId,
  modelHash,
  providerVersion: '1.30.0',
  inputIdsA: [...G2_INPUT_IDS_A],
  inputIdsB: [...G2_INPUT_IDS_B],
}), /g2.responseInvalid/, 'A comparison from a different runtime version cannot satisfy the execution identity.');
assert.throws(() => validateImportedAttentionCompareResponse({ ...strong, requestId: 'g2-stale-000000' }, {
  requestId: strong.requestId,
  modelHash,
  providerVersion: '1.30.0',
  inputIdsA: [...G2_INPUT_IDS_A],
  inputIdsB: [...G2_INPUT_IDS_B],
}), /g2.responseInvalid/);
assert.throws(() => validateImportedAttentionCompareResponse({ ...strong, profileId: 'unsupported' }, {
  requestId: strong.requestId,
  modelHash,
  providerVersion: '1.30.0',
  inputIdsA: [...G2_INPUT_IDS_A],
  inputIdsB: [...G2_INPUT_IDS_B],
}), /g2.responseInvalid/);
assert.throws(() => validateImportedAttentionCompareResponse({ ...strong, inputIdsB: [...G2_INPUT_IDS_A] }, {
  requestId: strong.requestId,
  modelHash,
  providerVersion: '1.30.0',
  inputIdsA: [...G2_INPUT_IDS_A],
  inputIdsB: [...G2_INPUT_IDS_B],
}), /g2.responseInvalid/);

const eventStore = createImportedAttentionEventStore();
const committed = commitComparison(eventStore, strong);
assert.equal(committed.evidence.attentionChanged, true);
assert.deepEqual(committed.semanticEvents.events.map((event) => event.type), ['comparison.completed', 'observation.detected']);
assert.equal(committed.semanticEvents.evidenceInstances.length, 1);
assert.equal(committed.semanticEvents.evidenceInstances[0].available, true);
assert.equal(JSON.stringify(committed.semanticEvents).includes('this movie'), false, 'Event history never retains the displayed text sample.');
const repeatedRun = commitComparison(eventStore, { ...strong, requestId: 'g2-request-0002' });
assert.deepEqual(repeatedRun.semanticEvents.events.map((event) => event.type), ['comparison.completed', 'observation.detected', 'comparison.completed']);
assert.deepEqual(repeatedRun.semanticEvents.events[0].experimentIds, ['g2-a-g2-request-0001', 'g2-b-g2-request-0001']);
assert.deepEqual(repeatedRun.semanticEvents.events[2].experimentIds, ['g2-a-g2-request-0002', 'g2-b-g2-request-0002'], 'Every committed comparison has distinct per-run experiment identity.');
assert.equal(repeatedRun.semanticEvents.evidenceInstances.length, 1, 'Repeated runs of the same semantic condition do not duplicate Evidence.');
const repeatedLegacyRun = commitComparison(eventStore, {
  ...strong,
  requestId: 'g2-legacy-run-0001',
  modelHash: `sha256:${G2_ATTENTION_LEGACY_SHA256S[0]}`,
});
assert.equal(repeatedLegacyRun.semanticEvents.events.at(-1).type, 'comparison.completed');
assert.deepEqual(repeatedLegacyRun.semanticEvents.events.at(-1).experimentIds, ['g2-a-g2-legacy-run-0001', 'g2-b-g2-legacy-run-0001']);
assert.equal(repeatedLegacyRun.semanticEvents.evidenceInstances.length, 1, 'The exact legacy alias has the same condition-level Evidence identity.');
assert.equal(JSON.stringify(oldProject).includes('model.safetensors'), false, 'Project migration contains no model bytes or local paths.');

const weakStore = createImportedAttentionEventStore();
const weak = responseFor({ changed: false, requestId: 'g2-request-0002' });
const weakCommit = commitComparison(weakStore, weak);
assert.equal(weakCommit.evidence.attentionChanged, false);
assert.deepEqual(weakCommit.semanticEvents.events.map((event) => event.type), ['comparison.completed']);
assert.equal(weakCommit.semanticEvents.evidenceInstances.length, 0, 'No detector evidence is created when the measured attention does not change.');

const staleStore = createImportedAttentionEventStore();
const stale = executionForComparison(strong);
const staleCommit = commitImportedAttentionExecution(staleStore, stale.executionResult, stale.request, {
  ...g2CurrentExecutionIdentityV1({ projectSessionId: 'g2-other-session', modelHash, providerVersion: '1.30.0' }),
});
assert.equal(staleCommit.reason, 'stale', 'A successful but late result is discarded when its project session changed.');
assert.deepEqual(staleCommit.semanticEvents.events, [], 'Stale success cannot add semantic events or Evidence.');

const failedStore = createImportedAttentionEventStore();
const failedRequest = createG2ExecutionRequestV1({
  projectSessionId: 'g2-project-session-001', modelHash, requestId: 'g2-failed-request-001', providerVersion: '1.30.0', approvedAt: startedAt,
});
const failedResult = createExecutionResultV1({
  request: failedRequest, runId: 'g2-failed-request-001', status: 'timed-out', providerVersion: '1.30.0',
  startedAt, finishedAt: '2026-09-28T00:00:31.000Z', diagnostics: ['INFERENCE_TIMEOUT'], cancellationDisposition: 'client-discarded',
});
const failedCommit = commitImportedAttentionExecution(failedStore, failedResult, failedRequest, g2CurrentExecutionIdentityV1({
  projectSessionId: 'g2-project-session-001', modelHash, providerVersion: '1.30.0',
}));
assert.equal(failedCommit.reason, 'timed-out');
assert.deepEqual(failedCommit.semanticEvents.events, [], 'Timeout cannot reach the deterministic detector.');

const g2Keys = Object.keys(messages).filter((key) => key.startsWith('g2.'));
assert.ok(g2Keys.length >= 35);
for (const key of g2Keys) {
  assert.equal(typeof messages[key].en, 'string', `${key} has English fallback.`);
  assert.equal(typeof messages[key].zh, 'string', `${key} has Chinese localization.`);
}

console.log(`PASS G2 contracts: ${g2Keys.length} bilingual strings; bounded profile, strict model reference, event/evidence ordering, weak evidence gating, and v8→v10 project migration.`);
