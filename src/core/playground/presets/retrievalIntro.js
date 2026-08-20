export const retrievalIntro = {
  version: 1,
  id: 'retrieval.intro',
  model: { adapter: 'retrieval-ranking' },
  data: { source: 'retrieval-example' },
  controls: ['topK', 'showScores'],
  layout: { stage: ['ranked-results'], side: ['metric-card'] },
  primitives: [
    { id: 'ranked-results', type: 'ranked-results', props: { items: '$model.rankedResults' } },
    { id: 'metric-card', type: 'metric-card', props: { metrics: '$metrics' } },
  ],
  steps: [],
};
