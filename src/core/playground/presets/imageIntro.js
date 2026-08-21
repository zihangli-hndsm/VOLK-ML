export const imageIntro = {
  version: 1,
  id: 'image.intro',
  model: { adapter: 'image-cnn' },
  data: { source: 'image-example' },
  controls: ['trainingSteps', 'learningRate', 'showFeatureMap'],
  layout: {
    stage: ['image-grid', 'attention-matrix'],
    side: ['metric-card'],
  },
  primitives: [
    { id: 'image-grid', type: 'image-grid', props: { images: '$model.imageSamples', columns: '$model.imageGrid.columns' } },
    { id: 'attention-matrix', type: 'attention-matrix', when: '$controls.showFeatureMap', props: { rows: '$model.featureMap.rows', columns: '$model.featureMap.columns', cells: '$model.featureMap.cells' } },
    { id: 'metric-card', type: 'metric-card', props: { metrics: '$metrics' } },
  ],
  steps: [],
};
