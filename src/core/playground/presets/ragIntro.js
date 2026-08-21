export const ragIntro = {
  version: 1,
  id: 'rag.intro',
  model: { adapter: 'rag-grounding' },
  data: { source: 'rag-example' },
  controls: ['topK', 'embeddingDimensions', 'showScores'],
  layout: { stage: ['ranked-results'], side: ['grounded-answer', 'metric-card'] },
  primitives: [
    { id: 'ranked-results', type: 'ranked-results', props: { items: '$model.rankedResults' } },
    { id: 'grounded-answer', type: 'grounded-answer', props: { text: '$model.groundedAnswer.text', sourceIds: '$model.groundedAnswer.sourceIds', query: '$model.groundedAnswer.query' } },
    { id: 'metric-card', type: 'metric-card', props: { metrics: '$metrics' } },
  ],
  steps: [],
};
