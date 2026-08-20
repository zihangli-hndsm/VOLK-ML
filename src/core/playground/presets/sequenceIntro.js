export const sequenceIntro = {
  version: 1,
  id: 'sequence.intro',
  model: { adapter: 'sequence-attention' },
  data: { source: 'sequence-example' },
  controls: ['trainingSteps', 'attentionTemperature', 'showAttention'],
  layout: {
    stage: ['token-sequence', 'attention-matrix'],
    side: ['metric-card'],
  },
  primitives: [
    { id: 'token-sequence', type: 'token-sequence', props: { tokens: '$model.tokens', highlights: '$model.highlightedTokenIndexes' } },
    { id: 'attention-matrix', type: 'attention-matrix', when: '$controls.showAttention', props: { rows: '$model.attention.rows', columns: '$model.attention.columns', cells: '$model.attention.cells' } },
    { id: 'metric-card', type: 'metric-card', props: { metrics: '$metrics' } },
  ],
  steps: [],
};
