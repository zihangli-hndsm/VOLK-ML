// JSON-safe Visualization Script for the MLP intro. Trains the network,
// reveals the loss/parameter trajectory, then reveals the hidden-unit
// activations for a prediction.
export const mlpIntro = {
  version: 1,
  id: 'mlp.intro',
  model: { adapter: 'mlp' },
  data: { source: 'workspace-or-default' },
  controls: ['hiddenUnits', 'learningRate', 'trainingSteps', 'queryX', 'queryY', 'showDecisionRegions'],
  layout: {
    stage: ['scatter', 'decision-region', 'network-graph', 'matrix-grid', 'loss-curve', 'parameter-trajectory'],
    side: ['metric-card', 'annotation'],
  },
  primitives: [
    { id: 'scatter', type: 'scatter', props: { points: '$model.scatterPoints', axes: '$model.axes' } },
    { id: 'decision-region', type: 'decision-region', when: '$controls.showDecisionRegions', props: { cells: '$model.decisionRegions.cells', resolution: '$model.decisionRegions.resolution' } },
    { id: 'network-graph', type: 'network-graph', props: { nodes: '$model.network.nodes', edges: '$model.network.edges' } },
    { id: 'matrix-grid', type: 'matrix-grid', props: { rows: '$model.matrix.rows', columns: '$model.matrix.columns', cells: '$model.matrix.cells' } },
    { id: 'loss-curve', type: 'loss-curve', props: { lossHistory: '$model.training.lossHistory', currentStep: '$model.training.currentStep' } },
    { id: 'parameter-trajectory', type: 'parameter-trajectory', props: { points: '$model.training.parameterTrajectory' } },
    { id: 'metric-card', type: 'metric-card', props: { metrics: '$metrics' } },
    { id: 'annotation', type: 'annotation', props: { observation: '$model.observation' } },
  ],
  steps: [
    { id: 'regions', setControl: { showDecisionRegions: true }, narrationKey: 'playground.mlp.scenario.regions', durationMs: 400 },
    { id: 'train', invoke: { operation: 'traceFit', args: {} }, narrationKey: 'playground.mlp.scenario.train', durationMs: 500 },
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `epoch-${index + 1}`,
      reveal: true,
      narrationKey: 'playground.mlp.scenario.epoch',
      durationMs: 250,
    })),
    { id: 'predict', invoke: { operation: 'tracePredict', args: {} }, narrationKey: 'playground.mlp.scenario.predict', durationMs: 400 },
    { id: 'hidden-1', reveal: true, narrationKey: 'playground.mlp.scenario.hidden', durationMs: 350 },
    { id: 'hidden-2', reveal: true, narrationKey: 'playground.mlp.scenario.hidden', durationMs: 350 },
    { id: 'hidden-3', reveal: true, narrationKey: 'playground.mlp.scenario.hidden', durationMs: 350 },
    { id: 'summary', annotate: { titleKey: 'playground.mlp.observation.prediction', bodyKey: 'playground.mlp.observation.predictionBody', params: {} }, narrationKey: 'playground.mlp.scenario.summary', durationMs: 500 },
  ],
};
