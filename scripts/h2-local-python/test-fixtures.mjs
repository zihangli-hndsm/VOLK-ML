import { componentById, defaults } from '../../src/core/components.js';

function node(id, componentId, parameters = {}) {
  const manifest = componentById.get(componentId);
  return {
    id,
    position: { x: 0, y: 0 },
    data: { manifest, parameters: { ...defaults(manifest), ...parameters } },
  };
}

function edge(id, source, sourceHandle, target, targetHandle) {
  return { id, source, sourceHandle, target, targetHandle };
}

function sharedTrainingNodes({ dense, hiddenActivation, dropout, outputUnits, task, trainRatio, epochs, batchSize, optimizer }) {
  const nodes = [
    node('input', 'tensor_input_node', { shape: '2', dtype: 'float32' }),
    node('hidden', 'dense_node', { input_features: 2, units: dense, use_bias: true }),
    ...(hiddenActivation ? [node('hidden-activation', `${hiddenActivation}_node`)] : []),
    ...(dropout === null ? [] : [node('dropout', 'dropout_node', { rate: dropout })]),
    node('output-layer', 'dense_node', { input_features: dense, units: outputUnits, use_bias: true }),
    node('model-output', 'model_output_node'),
    node('split', 'train_test_split_node', { train_ratio: trainRatio }),
    node('loss', task === 'classification' ? 'cross_entropy_loss_node' : 'mse_loss_node'),
    node('optimizer', optimizer.op === 'sgd_optimizer_node' ? 'sgd_optimizer_node' : 'adam_optimizer_node', optimizer.parameters),
    node('trainer', 'supervised_trainer_node', { epochs, batch_size: batchSize, shuffle: true }),
  ];
  const route = ['input', 'hidden', ...(hiddenActivation ? ['hidden-activation'] : []), ...(dropout === null ? [] : ['dropout']), 'output-layer', 'model-output'];
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const edges = [];
  route.slice(1).forEach((target, index) => {
    const source = route[index];
    const sourceHandle = byId.get(source).data.manifest.outputs[0].name;
    const targetHandle = byId.get(target).data.manifest.inputs[0].name;
    edges.push(edge(`architecture-${index}`, source, sourceHandle, target, targetHandle));
  });
  edges.push(
    edge('trainer-dataset', 'split', 'split', 'trainer', 'dataset'),
    edge('trainer-model', 'model-output', 'model', 'trainer', 'model'),
    edge('trainer-loss', 'loss', 'loss', 'trainer', 'loss'),
    edge('trainer-optimizer', 'optimizer', 'optimizer', 'trainer', 'optimizer'),
  );
  return { nodes, edges };
}

export function h2RegressionFixture() {
  const graph = sharedTrainingNodes({
    dense: 3,
    hiddenActivation: 'tanh',
    dropout: null,
    outputUnits: 1,
    task: 'regression',
    trainRatio: 0.75,
    epochs: 5,
    batchSize: 3,
    optimizer: { op: 'adam_optimizer_node', parameters: { learning_rate: 0.015 } },
  });
  return {
    ...graph,
    sessionId: 'h2-regression-fixture-session',
    dataset: {
      task: 'regression',
      featureColumns: ['x0', 'x1'],
      targetColumn: 'target',
      rows: [
        { x0: -1.0, x1: 0.5, target: -0.7 },
        { x0: -0.5, x1: -0.2, target: -0.8 },
        { x0: 0.0, x1: 0.3, target: -0.06 },
        { x0: 0.2, x1: -0.8, target: 0.72 },
        { x0: 0.5, x1: 0.9, target: -0.13 },
        { x0: 0.8, x1: -0.1, target: 0.76 },
        { x0: 1.0, x1: 0.4, target: 0.44 },
        { x0: 1.3, x1: -0.6, target: 1.62 },
      ],
    },
  };
}

export function h2ClassificationDropoutFixture() {
  const graph = sharedTrainingNodes({
    dense: 3,
    hiddenActivation: 'relu',
    dropout: 0.25,
    outputUnits: 2,
    task: 'classification',
    trainRatio: 0.75,
    epochs: 4,
    batchSize: 3,
    optimizer: { op: 'sgd_optimizer_node', parameters: { learning_rate: 0.04, momentum: 0.2 } },
  });
  return {
    ...graph,
    sessionId: 'h2-classification-fixture-session',
    dataset: {
      task: 'classification',
      featureColumns: ['x0', 'x1'],
      targetColumn: 'label',
      rows: [
        { x0: -1.2, x1: -0.8, label: 0 },
        { x0: -0.9, x1: -1.1, label: 0 },
        { x0: -0.6, x1: -0.4, label: 0 },
        { x0: -0.2, x1: -0.7, label: 0 },
        { x0: 0.3, x1: 0.8, label: 1 },
        { x0: 0.7, x1: 0.4, label: 1 },
        { x0: 1.0, x1: 1.2, label: 1 },
        { x0: 1.3, x1: 0.6, label: 1 },
      ],
    },
  };
}
