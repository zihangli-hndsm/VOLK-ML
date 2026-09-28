export const G2_ATTENTION_API_VERSION = 'g2-local-v1';
export const G2_ATTENTION_PROFILE_ID = 'bert-tiny-sst2-attention-v25-cpu-v1';
export const G2_ATTENTION_PROFILE_SHA256 = '3ef55e4c13475e2b6cf4aec1f5002130412e9d58659e9e0943aeae863eba9cb1';
export const G2_ATTENTION_LEGACY_SHA256S = Object.freeze([
  '19b18790c5cc466d086ec473e91566bc3e852a74878fbae68f78d483a45c6cef',
]);
export const G2_ATTENTION_ACCEPTED_SHA256S = Object.freeze([
  G2_ATTENTION_PROFILE_SHA256,
  ...G2_ATTENTION_LEGACY_SHA256S,
]);
export const G2_ATTENTION_MAX_MODEL_BYTES = 20 * 1024 * 1024;
export const G2_ATTENTION_SEQUENCE_LENGTH = 6;
export const G2_ATTENTION_HEADS = 2;
export const G2_ATTENTION_LAYERS = 2;
export const G2_INPUT_IDS_A = Object.freeze([101, 2023, 3185, 2001, 2204, 102]);
export const G2_INPUT_IDS_B = Object.freeze([101, 2023, 3185, 2001, 2919, 102]);

const exactKeys = (value, expected) => (
  Boolean(value && typeof value === 'object' && !Array.isArray(value))
  && Object.keys(value).length === expected.length
  && expected.every((key) => Object.hasOwn(value, key))
);

export function isG2AttentionArtifactSha256(value) {
  return G2_ATTENTION_ACCEPTED_SHA256S.includes(value);
}

export function validateImportedAttentionModel(file) {
  if (!file || typeof file.size !== 'number' || file.size < 1 || file.size > G2_ATTENTION_MAX_MODEL_BYTES) {
    throw Object.assign(new Error('g2.modelSizeInvalid'), { translationKey: 'g2.error.modelSizeInvalid' });
  }
  if (typeof file.name !== 'string' || !file.name.toLowerCase().endsWith('.onnx')) {
    throw Object.assign(new Error('g2.modelFileTypeInvalid'), { translationKey: 'g2.error.modelFileTypeInvalid' });
  }
}

export async function sha256Hex(bytes, cryptoApi = globalThis.crypto) {
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

const finiteVector = (value, size) => Array.isArray(value)
  && value.length === size
  && value.every((entry) => Number.isFinite(entry));

function attentionMatrixIsValid(matrix) {
  return Array.isArray(matrix)
    && matrix.length === G2_ATTENTION_HEADS
    && matrix.every((head) => Array.isArray(head)
      && head.length === G2_ATTENTION_SEQUENCE_LENGTH
      && head.every((row) => finiteVector(row, G2_ATTENTION_SEQUENCE_LENGTH)
        && row.every((value) => value >= -1e-5 && value <= 1.00001)
        && Math.abs(row.reduce((sum, value) => sum + value, 0) - 1) <= 1e-3));
}

function sampleIsValid(sample) {
  return exactKeys(sample, ['logits', 'attentionProbabilities'])
    && finiteVector(sample.logits, 2)
    && Array.isArray(sample.attentionProbabilities)
    && sample.attentionProbabilities.length === G2_ATTENTION_LAYERS
    && sample.attentionProbabilities.every(attentionMatrixIsValid);
}

export function validateImportedAttentionImportResponse(value, { requestId, sha256 } = {}) {
  if (!exactKeys(value, ['apiVersion', 'profileId', 'modelHash', 'requestId'])
    || value.apiVersion !== G2_ATTENTION_API_VERSION
    || value.profileId !== G2_ATTENTION_PROFILE_ID
    || !isG2AttentionArtifactSha256(sha256)
    || value.modelHash !== `sha256:${sha256}`
    || value.requestId !== requestId
  ) {
    throw Object.assign(new Error('g2.responseInvalid'), { translationKey: 'g2.error.responseInvalid' });
  }
  return Object.freeze({ profileId: value.profileId, sha256: sha256 });
}

export function validateImportedAttentionCompareResponse(value, { requestId, modelHash, inputIdsA, inputIdsB } = {}) {
  if (!exactKeys(value, ['apiVersion', 'profileId', 'modelHash', 'requestId', 'inputIdsA', 'inputIdsB', 'sampleA', 'sampleB'])
    || value.apiVersion !== G2_ATTENTION_API_VERSION
    || value.profileId !== G2_ATTENTION_PROFILE_ID
    || value.modelHash !== modelHash
    || value.requestId !== requestId
    || JSON.stringify(value.inputIdsA) !== JSON.stringify(inputIdsA)
    || JSON.stringify(value.inputIdsB) !== JSON.stringify(inputIdsB)
    || !sampleIsValid(value.sampleA)
    || !sampleIsValid(value.sampleB)) {
    throw Object.assign(new Error('g2.responseInvalid'), { translationKey: 'g2.error.responseInvalid' });
  }
  return value;
}

export function deriveImportedAttentionEvidence(comparison) {
  if (!comparison?.sampleA || !comparison?.sampleB) return null;
  const layerDeltas = comparison.sampleA.attentionProbabilities.map((headsA, layerIndex) => {
    let maxAbsoluteDelta = 0;
    for (let head = 0; head < G2_ATTENTION_HEADS; head += 1) {
      for (let row = 0; row < G2_ATTENTION_SEQUENCE_LENGTH; row += 1) {
        for (let column = 0; column < G2_ATTENTION_SEQUENCE_LENGTH; column += 1) {
          maxAbsoluteDelta = Math.max(maxAbsoluteDelta, Math.abs(
            headsA[head][row][column]
            - comparison.sampleB.attentionProbabilities[layerIndex][head][row][column],
          ));
        }
      }
    }
    return { layer: layerIndex, maxAbsoluteDelta };
  });
  const logitDeltas = comparison.sampleA.logits.map((value, index) => (
    comparison.sampleB.logits[index] - value
  ));
  return Object.freeze({
    inputTokenPositionChanged: 4,
    inputTokenIds: [comparison.inputIdsA[4], comparison.inputIdsB[4]],
    layerDeltas,
    logitDeltas,
    attentionChanged: layerDeltas.some((item) => item.maxAbsoluteDelta > 1e-6),
    predictionRankingChanged: Math.sign(comparison.sampleA.logits[1] - comparison.sampleA.logits[0])
      !== Math.sign(comparison.sampleB.logits[1] - comparison.sampleB.logits[0]),
  });
}

export function createImportedAttentionEvidenceDraft(evidence, { modelHash, experimentIds } = {}) {
  if (!evidence?.attentionChanged || typeof modelHash !== 'string' || !Array.isArray(experimentIds) || experimentIds.length !== 2) return null;
  const conditionFingerprint = `g2:${G2_ATTENTION_PROFILE_ID}:${evidence.inputTokenIds.join('-')}`.slice(0, 96);
  return {
    type: 'observation.detected',
    actor: 'human',
    experimentIds,
    semanticFactors: ['input-token-substitution'],
    semanticFactorPaths: ['input.token[4]'],
    operationTypes: ['LOCAL_ONNX_INFERENCE', 'COMPARE_EXPERIMENTS'],
    reasonCode: 'g2-attention-probabilities-changed',
    evidenceRefs: ['attention-layer-0', 'attention-layer-1', 'classifier-logits'],
    conditionFingerprint,
    observationDedupeKey: conditionFingerprint,
    messageKey: 'g2.evidence.attentionChanged',
    severity: 'informational',
    evidence: {
      profileId: G2_ATTENTION_PROFILE_ID,
      modelHash,
      inputTokenPositionChanged: evidence.inputTokenPositionChanged,
      inputTokenIds: evidence.inputTokenIds,
      layerDeltas: evidence.layerDeltas,
      logitDeltas: evidence.logitDeltas,
      predictionRankingChanged: evidence.predictionRankingChanged,
      source: 'local-onnx-runtime',
    },
  };
}
