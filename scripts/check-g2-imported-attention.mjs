import assert from 'node:assert/strict';
import { messages } from '../src/locales/ui.js';
import {
  G2_ATTENTION_API_VERSION,
  G2_ATTENTION_PROFILE_ID,
  G2_ATTENTION_PROFILE_SHA256,
  G2_INPUT_IDS_A,
  G2_INPUT_IDS_B,
  deriveImportedAttentionEvidence,
  validateImportedAttentionCompareResponse,
  validateImportedAttentionImportResponse,
} from '../src/core/playground/importedAttention/profile.js';
import { commitImportedAttentionComparison, createImportedAttentionEventStore } from '../src/core/playground/importedAttention/semanticEvents.js';
import { validateProjectForWorkspace, PROJECT_VERSION } from '../src/core/project.js';
import { createLocalModelReference, validateLocalModelReferences } from '../src/core/localModelReferences.js';

const modelHash = `sha256:${G2_ATTENTION_PROFILE_SHA256}`;
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
    profileId: G2_ATTENTION_PROFILE_ID,
    modelHash,
    requestId,
    inputIdsA,
    inputIdsB,
    sampleA,
    sampleB,
  };
};

assert.equal(PROJECT_VERSION, 9, 'The local artifact hash reference has its own project migration.');
assert.deepEqual(G2_INPUT_IDS_A.map((id, index) => id === G2_INPUT_IDS_B[index]), [true, true, true, true, false, true]);
assert.equal(validateLocalModelReferences([createLocalModelReference({ profileId: G2_ATTENTION_PROFILE_ID, sha256: G2_ATTENTION_PROFILE_SHA256 })]), true);
assert.equal(validateLocalModelReferences([{ profileId: G2_ATTENTION_PROFILE_ID, sha256: G2_ATTENTION_PROFILE_SHA256, filename: 'private-name.onnx' }]), false);
assert.equal(validateLocalModelReferences([{ profileId: G2_ATTENTION_PROFILE_ID, sha256: '0'.repeat(64) }]), false);

const oldProject = validateProjectForWorkspace({ format: 'VOLK-ML', version: 8, name: 'Old project', graph: { nodes: [], edges: [] } });
assert.deepEqual(oldProject.localModelReferences, [], 'Version 8 projects migrate with no local artifact references.');
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
  inputIdsA: [...G2_INPUT_IDS_A],
  inputIdsB: [...G2_INPUT_IDS_B],
});
const evidence = deriveImportedAttentionEvidence(validated);
assert.equal(evidence.attentionChanged, true);
assert.equal(evidence.inputTokenPositionChanged, 4);
assert.throws(() => validateImportedAttentionCompareResponse({ ...strong, requestId: 'g2-stale-000000' }, {
  requestId: strong.requestId,
  modelHash,
  inputIdsA: [...G2_INPUT_IDS_A],
  inputIdsB: [...G2_INPUT_IDS_B],
}), /g2.responseInvalid/);
assert.throws(() => validateImportedAttentionCompareResponse({ ...strong, profileId: 'unsupported' }, {
  requestId: strong.requestId,
  modelHash,
  inputIdsA: [...G2_INPUT_IDS_A],
  inputIdsB: [...G2_INPUT_IDS_B],
}), /g2.responseInvalid/);
assert.throws(() => validateImportedAttentionCompareResponse({ ...strong, inputIdsB: [...G2_INPUT_IDS_A] }, {
  requestId: strong.requestId,
  modelHash,
  inputIdsA: [...G2_INPUT_IDS_A],
  inputIdsB: [...G2_INPUT_IDS_B],
}), /g2.responseInvalid/);

const eventStore = createImportedAttentionEventStore();
const committed = commitImportedAttentionComparison(eventStore, strong);
assert.equal(committed.evidence.attentionChanged, true);
assert.deepEqual(committed.semanticEvents.events.map((event) => event.type), ['comparison.completed', 'observation.detected']);
assert.equal(committed.semanticEvents.evidenceInstances.length, 1);
assert.equal(committed.semanticEvents.evidenceInstances[0].available, true);
assert.equal(JSON.stringify(committed.semanticEvents).includes('this movie'), false, 'Event history never retains the displayed text sample.');
assert.equal(JSON.stringify(oldProject).includes('model.safetensors'), false, 'Project migration contains no model bytes or local paths.');

const weakStore = createImportedAttentionEventStore();
const weak = responseFor({ changed: false, requestId: 'g2-request-0002' });
const weakCommit = commitImportedAttentionComparison(weakStore, weak);
assert.equal(weakCommit.evidence.attentionChanged, false);
assert.deepEqual(weakCommit.semanticEvents.events.map((event) => event.type), ['comparison.completed']);
assert.equal(weakCommit.semanticEvents.evidenceInstances.length, 0, 'No detector evidence is created when the measured attention does not change.');

const g2Keys = Object.keys(messages).filter((key) => key.startsWith('g2.'));
assert.ok(g2Keys.length >= 35);
for (const key of g2Keys) {
  assert.equal(typeof messages[key].en, 'string', `${key} has English fallback.`);
  assert.equal(typeof messages[key].zh, 'string', `${key} has Chinese localization.`);
}

console.log(`PASS G2 contracts: ${g2Keys.length} bilingual strings; bounded profile, strict model reference, event/evidence ordering, weak evidence gating, and v8→v9 project migration.`);
