// Deterministic token-sequence fixtures for the first Phase 9 sequence slice.
// The labels are intentionally simple so the learner can inspect attention
// weights without requiring a tokenizer, network service, or hidden corpus.

function sample(id, label, tokens, membership) {
  return {
    id,
    label,
    membership,
    payload: { kind: 'sequence', tokens: [...tokens] },
  };
}

export function createSequenceAttentionSource() {
  return {
    kind: 'example',
    domain: 'sequence',
    task: 'classification',
    name: 'Deterministic token attention examples',
    fingerprint: 'sequence-attention:sentiment-v1',
    samples: [
      sample('positive-train-1', 'positive', ['bright', 'clear', 'signal'], 'train'),
      sample('positive-train-2', 'positive', ['clear', 'useful', 'signal'], 'train'),
      sample('negative-train-1', 'negative', ['noisy', 'weak', 'signal'], 'train'),
      sample('negative-train-2', 'negative', ['noisy', 'unclear', 'signal'], 'train'),
      sample('positive-test-1', 'positive', ['bright', 'useful', 'signal'], 'test'),
      sample('negative-test-1', 'negative', ['weak', 'unclear', 'signal'], 'test'),
    ],
  };
}
