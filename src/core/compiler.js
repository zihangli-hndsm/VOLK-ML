import { componentById } from './components.js';
import { flattenCustomComposites } from './customComposites.js';
import { compileLossExpression, LossExpressionError } from './lossExpression.js';

const architectureKinds = new Set(['source', 'layer', 'merge', 'sink', 'composite']);

const safeName = (value) => `n_${String(value).replace(/[^a-zA-Z0-9_]/g, '_')}`;
const pythonBoolean = (value) => value ? 'True' : 'False';
const pythonShape = (value) => {
  const parts = String(value ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return '(1,)';
  return `(${parts.join(', ')}${parts.length === 1 ? ',' : ''})`;
};
const tensorflowPadding = (value) => value === 'same' ? 'same' : 'valid';
const pytorchPadding = (value, kernelSize) => value === 'same' ? Math.floor(Number(kernelSize) / 2) : 0;

function selectCompilationGraph(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingSources = new Map(nodes.map((node) => [node.id, []]));
  const neighbors = new Map(nodes.map((node) => [node.id, []]));
  edges.forEach((edge) => {
    if (nodeById.has(edge.source) && nodeById.has(edge.target)) {
      incomingSources.get(edge.target).push(edge.source);
      neighbors.get(edge.source).push(edge.target);
      neighbors.get(edge.target).push(edge.source);
    }
  });
  const connectedIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const connectedOutputs = nodes.filter(
    (node) => node.data.manifest.op === 'model_output'
      && incomingSources.get(node.id).length > 0,
  );
  const connectedTrainers = nodes.filter(
    (node) => node.data.manifest.op === 'supervised_trainer'
      && incomingSources.get(node.id).length > 0,
  );
  const connectedTabular = nodes.some(
    (node) => connectedIds.has(node.id) && node.data.manifest.op === 'tabular_data',
  );
  let activeIds;

  if (connectedTrainers.length > 1) {
    const error = new Error('error.multipleTrainers');
    error.translationKey = 'error.multipleTrainers';
    throw error;
  }

  if (connectedTrainers.length) {
    activeIds = new Set();
    const pending = [connectedTrainers[0].id];
    while (pending.length) {
      const id = pending.pop();
      if (activeIds.has(id)) continue;
      activeIds.add(id);
      incomingSources.get(id)?.forEach((source) => pending.push(source));
    }
  } else if (connectedOutputs.length) {
    activeIds = new Set();
    const pending = connectedOutputs.map((node) => node.id);
    while (pending.length) {
      const id = pending.pop();
      if (activeIds.has(id)) continue;
      activeIds.add(id);
      incomingSources.get(id)?.forEach((source) => pending.push(source));
    }
    nodes.filter((node) => ['loss', 'optimizer'].includes(node.data.manifest.kind))
      .forEach((node) => activeIds.add(node.id));
  } else if (connectedTabular) {
    activeIds = new Set();
    const pending = nodes
      .filter((node) => connectedIds.has(node.id) && node.data.manifest.op === 'tabular_data')
      .map((node) => node.id);
    while (pending.length) {
      const id = pending.pop();
      if (activeIds.has(id)) continue;
      activeIds.add(id);
      neighbors.get(id)?.forEach((neighbor) => pending.push(neighbor));
    }
  } else {
    activeIds = connectedIds.size ? connectedIds : new Set(nodes.map((node) => node.id));
  }

  const selectedNodes = nodes.filter((node) => activeIds.has(node.id));
  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const selectedEdges = edges.filter(
    (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target),
  );
  return { nodes: selectedNodes, edges: selectedEdges };
}

export function graphToIR(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));

  edges.forEach((edge) => {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return;
    incoming.get(edge.target).push({
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    });
    outgoing.get(edge.source).push(edge.target);
    indegree.set(edge.target, indegree.get(edge.target) + 1);
  });

  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const orderedIds = [];
  while (queue.length) {
    const id = queue.shift();
    orderedIds.push(id);
    outgoing.get(id).forEach((target) => {
      const next = indegree.get(target) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    });
  }
  if (orderedIds.length !== nodes.length) {
    const error = new Error('error.pipelineCycle');
    error.translationKey = 'error.pipelineCycle';
    throw error;
  }

  return {
    version: 2,
    nodes: orderedIds.map((id) => {
      const node = nodeById.get(id);
      return {
        id,
        op: node.data.manifest.op,
        componentId: node.data.manifest.id,
        kind: node.data.manifest.kind,
        parameters: node.data.parameters ?? {},
        inputs: incoming.get(id),
      };
    }),
  };
}

function pytorchLayerInit(node) {
  const p = node.parameters;
  const name = safeName(node.id);
  const layer = `self.${name}`;
  switch (node.op) {
    case 'dense': return `${layer} = nn.Linear(${p.input_features}, ${p.units}, bias=${pythonBoolean(p.use_bias)})`;
    case 'conv2d': return `${layer} = nn.Conv2d(${p.input_channels}, ${p.filters}, kernel_size=${p.kernel_size}, stride=${p.stride}, padding=${pytorchPadding(p.padding, p.kernel_size)}, bias=${pythonBoolean(p.use_bias)})`;
    case 'max_pool2d': return `${layer} = nn.MaxPool2d(kernel_size=${p.pool_size}, stride=${p.stride})`;
    case 'relu': return `${layer} = nn.ReLU()`;
    case 'gelu': return `${layer} = nn.GELU()`;
    case 'sigmoid': return `${layer} = nn.Sigmoid()`;
    case 'tanh': return `${layer} = nn.Tanh()`;
    case 'softmax': return `${layer} = nn.Softmax(dim=${p.axis})`;
    case 'dropout': return `${layer} = nn.Dropout(p=${p.rate})`;
    case 'batch_norm1d': return `${layer} = nn.BatchNorm1d(${p.features}, momentum=${p.momentum})`;
    case 'batch_norm2d': return `${layer} = nn.BatchNorm2d(${p.channels}, momentum=${p.momentum})`;
    case 'layer_norm': return `${layer} = nn.LayerNorm(${pythonShape(p.normalized_shape)})`;
    case 'embedding': return `${layer} = nn.Embedding(${p.vocab_size}, ${p.embedding_dim})`;
    case 'lstm': return `${layer} = nn.LSTM(${p.input_size}, ${p.hidden_size}, num_layers=${p.layers}, bidirectional=${pythonBoolean(p.bidirectional)}, batch_first=True)`;
    case 'gru': return `${layer} = nn.GRU(${p.input_size}, ${p.hidden_size}, num_layers=${p.layers}, bidirectional=${pythonBoolean(p.bidirectional)}, batch_first=True)`;
    case 'multihead_attention': return `${layer} = nn.MultiheadAttention(${p.embed_dim}, ${p.num_heads}, dropout=${p.dropout}, batch_first=True)`;
    case 'mlp_block': return `${layer} = nn.Sequential(nn.Linear(${p.input_features}, ${p.hidden_units}), nn.ReLU(), nn.Dropout(${p.dropout}))`;
    case 'conv_block': return `${layer} = nn.Sequential(nn.Conv2d(${p.input_channels}, ${p.filters}, ${p.kernel_size}, padding=${Math.floor(Number(p.kernel_size) / 2)}), nn.BatchNorm2d(${p.filters}), nn.ReLU(), nn.MaxPool2d(2))`;
    case 'residual_mlp_block': return `${layer} = ResidualMLPBlock(${p.features})`;
    default: return null;
  }
}

function tensorflowLayerInit(node) {
  const p = node.parameters;
  const name = safeName(node.id);
  switch (node.op) {
    case 'dense': return `${name} = layers.Dense(${p.units}, use_bias=${pythonBoolean(p.use_bias)})`;
    case 'conv2d': return `${name} = layers.Conv2D(${p.filters}, ${p.kernel_size}, strides=${p.stride}, padding="${tensorflowPadding(p.padding)}", use_bias=${pythonBoolean(p.use_bias)})`;
    case 'max_pool2d': return `${name} = layers.MaxPooling2D(pool_size=${p.pool_size}, strides=${p.stride})`;
    case 'relu': return `${name} = layers.ReLU()`;
    case 'gelu': return `${name} = layers.Activation("gelu")`;
    case 'sigmoid': return `${name} = layers.Activation("sigmoid")`;
    case 'tanh': return `${name} = layers.Activation("tanh")`;
    case 'softmax': return `${name} = layers.Softmax(axis=${p.axis})`;
    case 'dropout': return `${name} = layers.Dropout(${p.rate})`;
    case 'batch_norm1d':
    case 'batch_norm2d': return `${name} = layers.BatchNormalization(momentum=${1 - Number(p.momentum)})`;
    case 'layer_norm': return `${name} = layers.LayerNormalization()`;
    case 'embedding': return `${name} = layers.Embedding(${p.vocab_size}, ${p.embedding_dim})`;
    case 'lstm':
    case 'gru': {
      const recurrent = () => (
        `${p.bidirectional ? 'layers.Bidirectional(' : ''}layers.${node.op === 'lstm' ? 'LSTM' : 'GRU'}(${p.hidden_size}, return_sequences=True)${p.bidirectional ? ')' : ''}`
      );
      const layersCount = Math.max(1, Number(p.layers) || 1);
      return layersCount === 1
        ? `${name} = ${recurrent()}`
        : `${name} = keras.Sequential([${Array.from({ length: layersCount }, recurrent).join(', ')}])`;
    }
    case 'multihead_attention': return `${name} = layers.MultiHeadAttention(num_heads=${p.num_heads}, key_dim=${Math.max(1, Math.floor(Number(p.embed_dim) / Number(p.num_heads)))}, dropout=${p.dropout})`;
    case 'mlp_block': return `${name} = keras.Sequential([layers.Dense(${p.hidden_units}), layers.ReLU(), layers.Dropout(${p.dropout})])`;
    case 'conv_block': return `${name} = keras.Sequential([layers.Conv2D(${p.filters}, ${p.kernel_size}, padding="same"), layers.BatchNormalization(), layers.ReLU(), layers.MaxPooling2D(2)])`;
    case 'residual_mlp_block': return `${name} = ResidualMLPBlock(${p.features})`;
    default: return null;
  }
}

function connectedInputVariables(node, variableByNode) {
  return Object.fromEntries(node.inputs.map((connection) => [
    connection.targetHandle,
    variableByNode.get(connection.source),
  ]));
}

function pytorchForwardExpression(node, inputs) {
  const name = `self.${safeName(node.id)}`;
  const first = inputs.input ?? Object.values(inputs)[0] ?? 'x';
  switch (node.op) {
    case 'tensor_input': return safeName(node.id);
    case 'model_output': return first;
    case 'flatten': return `torch.flatten(${first}, start_dim=1)`;
    case 'reshape': return `${first}.reshape(${first}.shape[0], *${pythonShape(node.parameters.shape)})`;
    case 'lstm':
    case 'gru': return `${name}(${first})[0]`;
    case 'multihead_attention': return `${name}(${first}, ${first}, ${first})[0]`;
    case 'add': return `${inputs.a} + ${inputs.b}`;
    case 'concatenate': return `torch.cat([${inputs.a}, ${inputs.b}], dim=${node.parameters.axis})`;
    default: return pytorchLayerInit(node) ? `${name}(${first})` : first;
  }
}

function tensorflowForwardExpression(node, inputs) {
  const name = safeName(node.id);
  const first = inputs.input ?? Object.values(inputs)[0] ?? 'inputs';
  switch (node.op) {
    case 'tensor_input': return name;
    case 'model_output': return first;
    case 'flatten': return `layers.Flatten()(${first})`;
    case 'reshape': return `layers.Reshape(${pythonShape(node.parameters.shape)})(${first})`;
    case 'multihead_attention': return `${name}(${first}, ${first})`;
    case 'add': return `layers.Add()([${inputs.a}, ${inputs.b}])`;
    case 'concatenate': return `layers.Concatenate(axis=${node.parameters.axis})([${inputs.a}, ${inputs.b}])`;
    default: return tensorflowLayerInit(node) ? `${name}(${first})` : first;
  }
}

function binaryOutputUsesProbabilities(ir) {
  const nodeById = new Map(ir.nodes.map((node) => [node.id, node]));
  return ir.nodes
    .filter((node) => node.op === 'model_output')
    .some((node) => node.inputs.some((connection) => nodeById.get(connection.source)?.op === 'sigmoid'));
}

function compilerError(key, params = {}) {
  const error = new Error(key);
  error.translationKey = key;
  error.translationParams = params;
  return error;
}

function trainerContext(ir) {
  const nodes = ir.nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const trainer = nodes.find((node) => node.op === 'supervised_trainer');
  if (!trainer) {
    return {
      trainer: null,
      split: nodes.find((node) => node.op === 'train_test_split'),
      loss: nodes.find((node) => node.kind === 'loss'),
      optimizer: nodes.find((node) => node.kind === 'optimizer'),
    };
  }
  const sourceByInput = Object.fromEntries(trainer.inputs.map((connection) => [
    connection.targetHandle,
    nodeById.get(connection.source),
  ]));
  const missing = ['dataset', 'model', 'loss', 'optimizer'].filter((name) => !sourceByInput[name]);
  if (missing.length) throw compilerError('error.trainerInputsRequired', { inputs: missing.join(', ') });
  return {
    trainer,
    split: sourceByInput.dataset,
    model: sourceByInput.model,
    loss: sourceByInput.loss,
    optimizer: sourceByInput.optimizer,
  };
}

function customLossError(error) {
  if (!(error instanceof LossExpressionError)) return error;
  const key = {
    empty: 'error.customLossEmpty',
    unexpected: 'error.customLossUnexpected',
    identifier: 'error.customLossIdentifier',
    function: 'error.customLossFunction',
    arguments: 'error.customLossArguments',
  }[error.code] ?? 'error.customLossUnexpected';
  return compilerError(key, { token: error.token || '∅' });
}

function pytorchLossLines(loss, probabilityOutput) {
  if (loss?.op === 'custom_loss') {
    try {
      const expression = compileLossExpression(loss.parameters.expression, 'pytorch');
      return ['def custom_loss(prediction, target):', `    return torch.mean(${expression})`, '', 'criterion = custom_loss'];
    } catch (error) {
      throw customLossError(error);
    }
  }
  return [{
    mse_loss: 'criterion = nn.MSELoss()',
    cross_entropy_loss: 'criterion = nn.CrossEntropyLoss()',
    binary_cross_entropy_loss: probabilityOutput ? 'criterion = nn.BCELoss()' : 'criterion = nn.BCEWithLogitsLoss()',
  }[loss?.op] ?? 'criterion = nn.MSELoss()'];
}

function tensorflowLossDefinition(loss, probabilityOutput) {
  if (loss?.op === 'custom_loss') {
    try {
      const expression = compileLossExpression(loss.parameters.expression, 'tensorflow');
      return {
        lines: ['def custom_loss(target, prediction):', `    return tf.reduce_mean(${expression})`, ''],
        name: 'custom_loss',
      };
    } catch (error) {
      throw customLossError(error);
    }
  }
  return {
    lines: [],
    name: {
      mse_loss: '"mse"',
      cross_entropy_loss: 'keras.losses.SparseCategoricalCrossentropy(from_logits=True)',
      binary_cross_entropy_loss: `keras.losses.BinaryCrossentropy(from_logits=${pythonBoolean(!probabilityOutput)})`,
    }[loss?.op] ?? '"mse"',
  };
}

function optimizerExpression(optimizer, framework) {
  if (framework === 'pytorch') return {
    sgd_optimizer: `torch.optim.SGD(model.parameters(), lr=${optimizer?.parameters.learning_rate ?? 0.01}, momentum=${optimizer?.parameters.momentum ?? 0})`,
    adam_optimizer: `torch.optim.Adam(model.parameters(), lr=${optimizer?.parameters.learning_rate ?? 0.001})`,
    adamw_optimizer: `torch.optim.AdamW(model.parameters(), lr=${optimizer?.parameters.learning_rate ?? 0.001}, weight_decay=${optimizer?.parameters.weight_decay ?? 0.01})`,
  }[optimizer?.op] ?? 'torch.optim.Adam(model.parameters(), lr=0.001)';
  return {
    sgd_optimizer: `keras.optimizers.SGD(learning_rate=${optimizer?.parameters.learning_rate ?? 0.01}, momentum=${optimizer?.parameters.momentum ?? 0})`,
    adam_optimizer: `keras.optimizers.Adam(learning_rate=${optimizer?.parameters.learning_rate ?? 0.001})`,
    adamw_optimizer: `keras.optimizers.AdamW(learning_rate=${optimizer?.parameters.learning_rate ?? 0.001}, weight_decay=${optimizer?.parameters.weight_decay ?? 0.01})`,
  }[optimizer?.op] ?? 'keras.optimizers.Adam(learning_rate=0.001)';
}

function tensorflowSplitLines(trainRatio) {
  return [
    'def volk_deterministic_indices(length, seed=2026):',
    '    indices = list(range(length))',
    '    for index in range(length - 1, 0, -1):',
    '        seed = (seed * 1664525 + 1013904223) % 4294967296',
    '        target = seed % (index + 1)',
    '        indices[index], indices[target] = indices[target], indices[index]',
    '    return indices',
    '',
    'indices = volk_deterministic_indices(len(X))',
    `split_index = max(1, min(len(indices) - 1, int(len(indices) * ${trainRatio})))`,
    'train_indices, test_indices = indices[:split_index], indices[split_index:]',
    'X_train, X_test = [X[index] for index in train_indices], [X[index] for index in test_indices]',
    'y_train, y_test = [y[index] for index in train_indices], [y[index] for index in test_indices]',
  ];
}

function trainingConfiguration(ir, framework) {
  const { trainer, split, loss, optimizer } = trainerContext(ir);
  const probabilityOutput = binaryOutputUsesProbabilities(ir);
  if (!trainer) {
    if (framework === 'pytorch') {
      return [
        ...pytorchLossLines(loss, probabilityOutput),
        `optimizer = ${optimizerExpression(optimizer, framework)}`,
        '',
        '# Connect your DataLoader and training loop here.',
      ];
    }
    const configuredLoss = tensorflowLossDefinition(loss, probabilityOutput);
    return [
      ...configuredLoss.lines,
      `model.compile(optimizer=${optimizerExpression(optimizer, framework)}, loss=${configuredLoss.name})`,
      '# Connect your tf.data pipeline and call model.fit(...) here.',
    ];
  }
  const inputs = ir.nodes.filter((node) => node.op === 'tensor_input');
  const outputs = ir.nodes.filter((node) => node.op === 'model_output');
  if (inputs.length !== 1 || outputs.length !== 1) throw compilerError('error.trainerSingleInputOutput');
  const epochs = trainer.parameters.epochs ?? 20;
  const batchSize = trainer.parameters.batch_size ?? 32;
  const trainRatio = split.parameters.train_ratio ?? 0.8;
  if (framework === 'pytorch') {
    const classification = loss?.op === 'cross_entropy_loss';
    return [
      'from torch.utils.data import DataLoader, TensorDataset, random_split',
      '',
      '# Replace this loader with the dataset saved in the VOLK-ML project JSON.',
      'X, y = load_tabular_data()',
      'features_tensor = torch.tensor(X, dtype=torch.float32)',
      classification
        ? 'target_tensor = torch.tensor(y, dtype=torch.long)'
        : 'target_tensor = torch.tensor(y, dtype=torch.float32).reshape(-1, 1)',
      'dataset = TensorDataset(features_tensor, target_tensor)',
      `train_size = int(len(dataset) * ${trainRatio})`,
      'train_set, test_set = random_split(dataset, [train_size, len(dataset) - train_size], generator=torch.Generator().manual_seed(2026))',
      `train_loader = DataLoader(train_set, batch_size=${batchSize}, shuffle=${pythonBoolean(trainer.parameters.shuffle ?? true)})`,
      '',
      ...pytorchLossLines(loss, probabilityOutput),
      `optimizer = ${optimizerExpression(optimizer, framework)}`,
      'loss_history = []',
      `for epoch in range(${epochs}):`,
      '    model.train()',
      '    for features, target in train_loader:',
      '        optimizer.zero_grad()',
      '        prediction = model(features)',
      '        loss = criterion(prediction, target)',
      '        loss.backward()',
      '        optimizer.step()',
      '    loss_history.append(float(loss.detach()))',
    ];
  }
  const configuredLoss = tensorflowLossDefinition(loss, probabilityOutput);
  return [
    '# Replace this loader with the dataset saved in the VOLK-ML project JSON.',
    'X, y = load_tabular_data()',
    ...tensorflowSplitLines(trainRatio),
    '',
    ...configuredLoss.lines,
    `model.compile(optimizer=${optimizerExpression(optimizer, framework)}, loss=${configuredLoss.name})`,
    `history = model.fit(X_train, y_train, epochs=${epochs}, batch_size=${batchSize}, shuffle=${pythonBoolean(trainer.parameters.shuffle ?? true)}, validation_data=(X_test, y_test))`,
  ];
}

function compileArchitecture(ir, framework) {
  const candidates = ir.nodes.filter((node) => architectureKinds.has(node.kind));
  if (!candidates.length) return null;
  const nodeById = new Map(candidates.map((node) => [node.id, node]));
  const outputs = candidates.filter((node) => node.op === 'model_output');
  if (!outputs.length) {
    const error = new Error('error.modelOutputRequired');
    error.translationKey = 'error.modelOutputRequired';
    throw error;
  }
  const activeIds = new Set();
  const pending = outputs.map((node) => node.id);
  while (pending.length) {
    const id = pending.pop();
    if (activeIds.has(id)) continue;
    activeIds.add(id);
    nodeById.get(id)?.inputs.forEach((connection) => {
      if (nodeById.has(connection.source)) pending.push(connection.source);
    });
  }
  const architecture = candidates.filter((node) => activeIds.has(node.id));
  const inputs = architecture.filter((node) => node.op === 'tensor_input');
  if (!inputs.length) {
    const error = new Error('error.modelInputRequired');
    error.translationKey = 'error.modelInputRequired';
    throw error;
  }
  const variableByNode = new Map();
  const outputCandidates = [];

  if (framework === 'pytorch') {
    const initLines = architecture.map(pytorchLayerInit).filter(Boolean).map((line) => `        ${line}`);
    const forwardArgs = inputs.map((node) => safeName(node.id)).join(', ');
    const forwardLines = [];
    architecture.forEach((node) => {
      const variable = `v_${safeName(node.id)}`;
      variableByNode.set(node.id, variable);
      const expression = pytorchForwardExpression(node, connectedInputVariables(node, variableByNode));
      forwardLines.push(`        ${variable} = ${expression}`);
      if (node.op === 'model_output') outputCandidates.push(variable);
    });
    const fallbackOutput = variableByNode.get(architecture.at(-1)?.id) ?? forwardArgs.split(', ')[0];
    return [
      'import torch',
      'import torch.nn as nn',
      '',
      'class ResidualMLPBlock(nn.Module):',
      '    def __init__(self, features):',
      '        super().__init__()',
      '        self.layers = nn.Sequential(nn.Linear(features, features), nn.ReLU(), nn.Linear(features, features))',
      '    def forward(self, x):',
      '        return x + self.layers(x)',
      '',
      'class VOLKModel(nn.Module):',
      '    def __init__(self):',
      '        super().__init__()',
      ...(initLines.length ? initLines : ['        pass']),
      '',
      `    def forward(self, ${forwardArgs}):`,
      ...forwardLines,
      `        return ${outputCandidates.length > 1 ? `(${outputCandidates.join(', ')})` : outputCandidates[0] ?? fallbackOutput}`,
      '',
      'model = VOLKModel()',
      ...trainingConfiguration(ir, framework),
    ].join('\n');
  }

  const initLines = architecture.map(tensorflowLayerInit).filter(Boolean);
  const forwardLines = [];
  inputs.forEach((node) => {
    const variable = safeName(node.id);
    variableByNode.set(node.id, variable);
  });
  architecture.forEach((node) => {
    if (node.op === 'tensor_input') return;
    const variable = `v_${safeName(node.id)}`;
    variableByNode.set(node.id, variable);
    forwardLines.push(`${variable} = ${tensorflowForwardExpression(node, connectedInputVariables(node, variableByNode))}`);
    if (node.op === 'model_output') outputCandidates.push(variable);
  });
  const inputLines = inputs.map((node) => `${safeName(node.id)} = keras.Input(shape=${pythonShape(node.parameters.shape)}, dtype="${node.parameters.dtype}", name="${safeName(node.id)}")`);
  const fallbackOutput = variableByNode.get(architecture.at(-1)?.id) ?? safeName(inputs[0].id);
  return [
    'import tensorflow as tf',
    'from tensorflow import keras',
    'from tensorflow.keras import layers',
    '',
    'class ResidualMLPBlock(layers.Layer):',
    '    def __init__(self, features):',
    '        super().__init__()',
    '        self.layers = keras.Sequential([layers.Dense(features), layers.ReLU(), layers.Dense(features)])',
    '    def call(self, inputs):',
    '        return inputs + self.layers(inputs)',
    '',
    ...initLines,
    ...inputLines,
    ...forwardLines,
    `model = keras.Model(inputs=[${inputs.map((node) => safeName(node.id)).join(', ')}], outputs=${outputCandidates.length > 1 ? `[${outputCandidates.join(', ')}]` : outputCandidates[0] ?? fallbackOutput})`,
    ...trainingConfiguration(ir, framework),
  ].join('\n');
}

function compileTabularPipeline(ir, framework) {
  const split = ir.nodes.find((node) => node.op === 'train_test_split');
  const linear = ir.nodes.find((node) => node.op === 'linear_regression');
  const trainer = ir.nodes.find((node) => node.op === 'gradient_descent');
  if (framework === 'pytorch') {
    return [
      'import torch',
      'from torch import nn',
      'from torch.utils.data import DataLoader, TensorDataset, random_split',
      '',
      '# Replace this loader with the dataset saved in the VOLK-ML project JSON.',
      'X, y = load_tabular_data()',
      'dataset = TensorDataset(torch.tensor(X, dtype=torch.float32), torch.tensor(y, dtype=torch.float32).unsqueeze(1))',
      `train_size = int(len(dataset) * ${split?.parameters.train_ratio ?? 0.8})`,
      'train_set, test_set = random_split(dataset, [train_size, len(dataset) - train_size], generator=torch.Generator().manual_seed(2026))',
      'model = nn.Linear(X.shape[1], 1)',
      `optimizer = torch.optim.SGD(model.parameters(), lr=${linear?.parameters.learning_rate ?? 0.01})`,
      'criterion = nn.MSELoss()',
      `for epoch in range(${trainer?.parameters.epochs ?? 100}):`,
      '    for features, target in DataLoader(train_set, batch_size=32, shuffle=True):',
      '        optimizer.zero_grad()',
      '        loss = criterion(model(features), target)',
      '        loss.backward()',
      '        optimizer.step()',
    ].join('\n');
  }
  return [
    'import tensorflow as tf',
    'from tensorflow import keras',
    '',
    '# Replace this loader with the dataset saved in the VOLK-ML project JSON.',
    'X, y = load_tabular_data()',
    ...tensorflowSplitLines(split?.parameters.train_ratio ?? 0.8),
    'model = keras.Sequential([keras.layers.Input(shape=(X.shape[1],)), keras.layers.Dense(1)])',
    `model.compile(optimizer=keras.optimizers.SGD(learning_rate=${linear?.parameters.learning_rate ?? 0.01}), loss="mse", metrics=[keras.metrics.RootMeanSquaredError()])`,
    `model.fit(X_train, y_train, epochs=${trainer?.parameters.epochs ?? 100}, batch_size=32, validation_data=(X_test, y_test))`,
  ].join('\n');
}

export function compatibilityReport(nodes, framework) {
  return nodes.map((node) => {
    const manifest = componentById.get(node.data.manifest.id) ?? node.data.manifest;
    return {
      nodeId: node.id,
      componentId: manifest.id,
      name: manifest.name,
      quality: manifest.compatibility?.[framework] ?? 'unsupported',
    };
  });
}

export function compileGraph(nodes, edges, framework) {
  if (!['pytorch', 'tensorflow'].includes(framework)) throw new Error(`Unsupported framework: ${framework}`);
  const flattened = flattenCustomComposites(nodes, edges);
  const selected = selectCompilationGraph(flattened.nodes, flattened.edges);
  const ir = graphToIR(selected.nodes, selected.edges);
  const report = compatibilityReport(selected.nodes, framework);
  if (report.some((item) => item.quality === 'unsupported')) {
    const error = new Error('error.frameworkUnsupported');
    error.translationKey = 'error.frameworkUnsupported';
    error.translationParams = {
      framework: framework === 'pytorch' ? 'PyTorch' : 'TensorFlow',
      components: report.filter((item) => item.quality === 'unsupported').map((item) => item.name.en).join(', '),
    };
    throw error;
  }
  const code = compileArchitecture(ir, framework) ?? compileTabularPipeline(ir, framework);
  return { code: `# Generated by VOLK-ML IR v${ir.version}\n# Review tensor shapes and dataset bindings before running.\n\n${code}\n`, ir, report };
}

export const compilePipelineToPyTorch = (nodes, edges) => compileGraph(nodes, edges, 'pytorch');
export const compilePipelineToTensorFlow = (nodes, edges) => compileGraph(nodes, edges, 'tensorflow');
