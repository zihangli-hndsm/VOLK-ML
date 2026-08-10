const agentExamples = Object.freeze({
  'knn-classification': Object.freeze({
    placeholderKey: 'playground.agent.placeholder.knn',
    items: Object.freeze([
      { id: 'explain-prediction', promptKey: 'playground.agent.example.knn.explainPrediction' },
      { id: 'compare-k', promptKey: 'playground.agent.example.knn.compareK' },
      { id: 'k-effect', promptKey: 'playground.agent.example.knn.kEffect' },
      { id: 'introduce-knn', promptKey: 'playground.agent.example.knn.introduce' },
    ]),
  }),
  'linear-regression': Object.freeze({
    placeholderKey: 'playground.agent.placeholder.linearRegression',
    items: Object.freeze([
      { id: 'fit-line', promptKey: 'playground.agent.example.linearRegression.fitLine' },
      { id: 'high-learning-rate', promptKey: 'playground.agent.example.linearRegression.highLearningRate' },
      { id: 'compare-learning-rate', promptKey: 'playground.agent.example.linearRegression.compareLearningRate' },
      { id: 'loss-training', promptKey: 'playground.agent.example.linearRegression.lossTraining' },
    ]),
  }),
  'mlp-classification': Object.freeze({
    placeholderKey: 'playground.agent.placeholder.mlp',
    items: Object.freeze([
      { id: 'explain-prediction', promptKey: 'playground.agent.example.mlp.explainPrediction' },
      { id: 'compare-hidden-units', promptKey: 'playground.agent.example.mlp.compareHiddenUnits' },
      { id: 'show-training', promptKey: 'playground.agent.example.mlp.showTraining' },
      { id: 'compare-learning-rate', promptKey: 'playground.agent.example.mlp.compareLearningRate' },
    ]),
  }),
});

export function getAgentExamples(playgroundId) {
  return agentExamples[playgroundId] ?? { placeholderKey: 'playground.agent.placeholder', items: [] };
}

export function listAgentExamplePlaygroundIds() {
  return Object.keys(agentExamples);
}

