// JSON-safe Visualization Script for the Linear Regression intro. The preset
// is a declaration only: the script runtime turns each step into the same
// playground actions the UI and the Agent use.
export const linearRegressionIntro = {
  version: 1,
  id: 'linear-regression.intuition',
  model: { adapter: 'linear-regression' },
  data: { source: 'workspace-or-default' },
  controls: ['weight', 'bias', 'learningRate', 'trainingSteps', 'showResiduals', 'showBestFit'],
  layout: {
    stage: ['scatter', 'regression-line', 'reference-line', 'residual-lines', 'loss-curve'],
    side: ['formula', 'metric-card', 'annotation'],
  },
  primitives: [
    { id: 'scatter', type: 'scatter', props: { points: '$model.scatterPoints', axes: '$model.axes' } },
    { id: 'regression-line', type: 'regression-line', props: { line: '$model.line', ranges: '$model.ranges' } },
    { id: 'reference-line', type: 'reference-line', when: '$controls.showBestFit', props: { line: '$model.bestFitLine', ranges: '$model.ranges' } },
    { id: 'residual-lines', type: 'residual-lines', when: '$controls.showResiduals', props: { points: '$model.residualPoints' } },
    { id: 'loss-curve', type: 'loss-curve', props: { lossHistory: '$model.training.lossHistory', currentStep: '$model.training.currentStep' } },
    { id: 'formula', type: 'formula', props: { formula: '$model.formula' } },
    { id: 'metric-card', type: 'metric-card', props: { metrics: '$metrics' } },
    { id: 'annotation', type: 'annotation', props: { observation: '$model.observation' } },
  ],
  steps: [
    { id: 'start', setControl: { weight: 0, bias: 0 }, narrationKey: 'playground.lr.scenario.introStart', durationMs: 500 },
    { id: 'residuals', setControl: { showResiduals: true }, narrationKey: 'playground.lr.scenario.introResiduals', durationMs: 800 },
    { id: 'train', invoke: { operation: 'traceFit', args: {} }, narrationKey: 'playground.lr.scenario.introTrain', durationMs: 600 },
    { id: 'step1', reveal: true, narrationKey: 'playground.lr.scenario.introStep1', durationMs: 700 },
    { id: 'step2', reveal: true, narrationKey: 'playground.lr.scenario.introStep2', durationMs: 700 },
    { id: 'step3', reveal: true, narrationKey: 'playground.lr.scenario.introStep3', durationMs: 700 },
    { id: 'bestFit', setControl: { showBestFit: true }, invoke: { operation: 'setBestFit', args: {} }, narrationKey: 'playground.lr.scenario.introBestFit', durationMs: 800 },
  ],
};
