export const ragIntro = {
  version: 1,
  id: 'rag.intro',
  model: { adapter: 'rag-grounding' },
  data: { source: 'rag-example' },
  controls: ['topK', 'showScores'],
  layout: { stage: ['ranked-results'], side: ['metric-card'] },
  primitives: [
    { id: 'ranked-results', type: 'ranked-results', props: { items: '$model.rankedResults' } },
    { id: 'metric-card', type: 'metric-card', props: { metrics: '$metrics' } },
  ],
  steps: [],
};
