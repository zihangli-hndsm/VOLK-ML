export const COMPONENT_SCHEMA_VERSION = 2;

const text = (en, zh) => ({ en, zh });
const input = (name, type = 'Tensor') => ({ name, type });
const output = (name, type = 'Tensor') => ({ name, type });
const numberProperty = (key, en, zh, defaultValue, min = 1, max = 4096, step = 1) => ({
  key, label: text(en, zh), type: 'number', default: defaultValue, min, max, step,
});
const sliderProperty = (key, en, zh, defaultValue, min, max, step) => ({
  key, label: text(en, zh), type: 'slider', default: defaultValue, min, max, step,
});
const selectProperty = (key, en, zh, defaultValue, options) => ({
  key, label: text(en, zh), type: 'select', default: defaultValue, options,
});
const booleanProperty = (key, en, zh, defaultValue) => ({
  key, label: text(en, zh), type: 'boolean', default: defaultValue,
});
const stringProperty = (key, en, zh, defaultValue) => ({
  key, label: text(en, zh), type: 'text', default: defaultValue,
});

function component({
  id, op, kind = 'layer', name, description, category, inputs = [input('input')],
  outputs = [output('output')], properties = [], minimumTier = 'L1',
  browserBackend = 'none', compatibility = { pytorch: 'exact', tensorflow: 'exact' },
  composition = null,
}) {
  return {
    schemaVersion: COMPONENT_SCHEMA_VERSION,
    id,
    op,
    kind: composition ? 'composite' : kind,
    name,
    description,
    category,
    inputs,
    outputs,
    properties,
    runtime: { minimumTier, browserBackend },
    compatibility,
    composition,
  };
}

const passThrough = (id, op, en, zh, descriptionEn, descriptionZh, category = 'Activations', properties = []) => component({
  id, op, name: text(en, zh), description: text(descriptionEn, descriptionZh), category, properties,
});

const regressionComponents = [
  component({
    id: 'tabular_data_node', op: 'tabular_data', kind: 'data',
    name: text('Tabular Data', '表格数据'),
    description: text('Provides the CSV or JSON dataset configured in the Data workspace.', '提供在数据工作区配置的 CSV 或 JSON 数据集。'),
    category: 'Data', inputs: [], outputs: [output('dataset', 'Table')], properties: [],
    minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'train_test_split_node', op: 'train_test_split', kind: 'data',
    name: text('Train/Test Split', '训练/测试集划分'),
    description: text('Cleans numeric rows and creates a deterministic train/test split.', '清理数值行并确定性划分训练集与测试集。'),
    category: 'Data', inputs: [input('dataset', 'Table')], outputs: [output('split', 'DatasetSplit')],
    properties: [sliderProperty('train_ratio', 'Training Ratio', '训练集比例', 0.8, 0.5, 0.9, 0.05)],
    minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'linear_regression_node', op: 'linear_regression', kind: 'model',
    name: text('Linear Regression', '线性回归'),
    description: text('Fits a linear model to predict continuous values.', '拟合线性模型来预测连续数值。'),
    category: 'Models', inputs: [input('split', 'DatasetSplit')], outputs: [output('model', 'ModelSpec')],
    properties: [sliderProperty('learning_rate', 'Learning Rate', '学习率', 0.01, 0.001, 0.2, 0.001)],
    minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'knn_node', op: 'knn_classifier', kind: 'model',
    name: text('K-Nearest Neighbors', 'K-近邻算法'),
    description: text('Classifies samples by voting among nearby examples.', '通过附近样本投票对数据进行分类。'),
    category: 'Classification',
    inputs: [input('dataset', 'Table')],
    outputs: [output('model', 'ModelSpec'), output('boundary', 'Mesh')],
    properties: [numberProperty('k_value', 'Number of Neighbors (K)', '邻居数量 (K)', 3, 1, 99, 2)],
    minimumTier: 'L2',
    browserBackend: 'none',
    compatibility: { pytorch: 'unsupported', tensorflow: 'unsupported' },
  }),
  component({
    id: 'gradient_descent_node', op: 'gradient_descent', kind: 'training',
    name: text('Gradient Descent', '梯度下降'),
    description: text('Trains the connected browser model with iterative gradient descent.', '使用迭代梯度下降训练已连接的浏览器模型。'),
    category: 'Training', inputs: [input('model', 'ModelSpec')], outputs: [output('trained_model', 'TrainedModel')],
    properties: [sliderProperty('epochs', 'Training Epochs', '训练轮数', 100, 10, 500, 10)],
    minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'evaluate_node', op: 'evaluate_regression', kind: 'evaluation',
    name: text('Evaluate Regression', '回归评估'),
    description: text('Computes RMSE and R² on the connected test set.', '在连接的测试集上计算 RMSE 和 R²。'),
    category: 'Evaluation', inputs: [input('trained_model', 'TrainedModel')], outputs: [output('metrics', 'Metrics')],
    properties: [], minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'predictor_node', op: 'interactive_predictor', kind: 'inference',
    name: text('Interactive Predictor', '交互预测器'),
    description: text('Creates an input form for trying the connected trained model.', '为连接的已训练模型创建交互输入表单。'),
    category: 'Evaluation', inputs: [input('trained_model', 'TrainedModel')], outputs: [output('prediction', 'Prediction')],
    properties: [], minimumTier: 'L0', browserBackend: 'cpu',
  }),
];

const architectureComponents = [
  component({
    id: 'tensor_input_node', op: 'tensor_input', kind: 'source',
    name: text('Tensor Input', '张量输入'),
    description: text('Declares a model input shape and dtype.', '声明模型的输入形状和数据类型。'),
    category: 'Core', inputs: [], outputs: [output('tensor')],
    properties: [
      stringProperty('shape', 'Shape', '形状', '32'),
      selectProperty('dtype', 'Data Type', '数据类型', 'float32', ['float32', 'float16', 'int32']),
    ],
  }),
  component({
    id: 'model_output_node', op: 'model_output', kind: 'sink',
    name: text('Model Output', '模型输出'),
    description: text('Marks a tensor as a model output.', '将张量标记为模型输出。'),
    category: 'Core', inputs: [input('input')], outputs: [output('model', 'ModelSpec')], properties: [],
  }),
  component({
    id: 'dense_node', op: 'dense',
    name: text('Dense / Linear', '全连接 / 线性层'),
    description: text('Applies a learned affine transformation.', '应用可学习的仿射变换。'),
    category: 'Layers',
    properties: [
      numberProperty('input_features', 'Input Features', '输入特征数', 32),
      numberProperty('units', 'Output Units', '输出单元数', 64),
      booleanProperty('use_bias', 'Use Bias', '使用偏置', true),
    ],
  }),
  component({
    id: 'conv2d_node', op: 'conv2d',
    name: text('Conv2D', '二维卷积'),
    description: text('Applies a 2D convolution to image-like tensors.', '对图像类张量应用二维卷积。'),
    category: 'Layers',
    properties: [
      numberProperty('input_channels', 'Input Channels', '输入通道数', 3),
      numberProperty('filters', 'Output Channels', '输出通道数', 32),
      numberProperty('kernel_size', 'Kernel Size', '卷积核大小', 3, 1, 15),
      numberProperty('stride', 'Stride', '步幅', 1, 1, 8),
      selectProperty('padding', 'Padding', '填充', 'same', ['same', 'valid']),
      booleanProperty('use_bias', 'Use Bias', '使用偏置', true),
    ],
    compatibility: { pytorch: 'exact', tensorflow: 'adapted' },
  }),
  component({
    id: 'max_pool2d_node', op: 'max_pool2d',
    name: text('MaxPool2D', '二维最大池化'),
    description: text('Downsamples spatial dimensions with maximum pooling.', '使用最大池化缩小空间维度。'),
    category: 'Layers',
    properties: [
      numberProperty('pool_size', 'Pool Size', '池化大小', 2, 1, 8),
      numberProperty('stride', 'Stride', '步幅', 2, 1, 8),
    ],
  }),
  passThrough('flatten_node', 'flatten', 'Flatten', '展平', 'Flattens all non-batch dimensions.', '展平批次维以外的所有维度。', 'Shape'),
  passThrough('reshape_node', 'reshape', 'Reshape', '重塑形状', 'Changes tensor shape without changing values.', '在不改变数值的情况下修改张量形状。', 'Shape', [
    stringProperty('shape', 'Target Shape', '目标形状', '32'),
  ]),
  passThrough('relu_node', 'relu', 'ReLU', 'ReLU', 'Applies rectified linear activation.', '应用修正线性激活。'),
  passThrough('gelu_node', 'gelu', 'GELU', 'GELU', 'Applies Gaussian error linear activation.', '应用高斯误差线性激活。'),
  passThrough('sigmoid_node', 'sigmoid', 'Sigmoid', 'Sigmoid', 'Maps values to the range from zero to one.', '将数值映射到零到一。'),
  passThrough('tanh_node', 'tanh', 'Tanh', 'Tanh', 'Applies hyperbolic tangent activation.', '应用双曲正切激活。'),
  passThrough('softmax_node', 'softmax', 'Softmax', 'Softmax', 'Normalizes logits into probabilities.', '将 logits 归一化为概率。', 'Activations', [
    numberProperty('axis', 'Axis', '轴', -1, -8, 8),
  ]),
  passThrough('dropout_node', 'dropout', 'Dropout', 'Dropout', 'Randomly drops activations during training.', '训练时随机丢弃激活值。', 'Regularization', [
    sliderProperty('rate', 'Dropout Rate', '丢弃率', 0.2, 0, 0.9, 0.05),
  ]),
  passThrough('batch_norm1d_node', 'batch_norm1d', 'BatchNorm1D', '一维批归一化', 'Normalizes vector or sequence features by batch statistics.', '使用批次统计量归一化向量或序列特征。', 'Normalization', [
    numberProperty('features', 'Features', '特征数', 64),
    sliderProperty('momentum', 'Momentum', '动量', 0.1, 0.01, 0.99, 0.01),
  ]),
  passThrough('batch_norm2d_node', 'batch_norm2d', 'BatchNorm2D', '二维批归一化', 'Normalizes image channels by batch statistics.', '使用批次统计量归一化图像通道。', 'Normalization', [
    numberProperty('channels', 'Channels', '通道数', 32),
    sliderProperty('momentum', 'Momentum', '动量', 0.1, 0.01, 0.99, 0.01),
  ]),
  passThrough('layer_norm_node', 'layer_norm', 'LayerNorm', '层归一化', 'Normalizes values over the last dimensions.', '在最后若干维度上归一化数值。', 'Normalization', [
    stringProperty('normalized_shape', 'Normalized Shape', '归一化形状', '64'),
  ]),
  component({
    id: 'embedding_node', op: 'embedding',
    name: text('Embedding', '嵌入层'),
    description: text('Maps integer token IDs to dense vectors.', '将整数 token ID 映射为稠密向量。'),
    category: 'Sequence', properties: [
      numberProperty('vocab_size', 'Vocabulary Size', '词表大小', 10000, 2, 1000000),
      numberProperty('embedding_dim', 'Embedding Dimension', '嵌入维度', 128, 1, 4096),
    ],
  }),
  component({
    id: 'lstm_node', op: 'lstm',
    name: text('LSTM', 'LSTM'),
    description: text('Processes sequences with long short-term memory cells.', '使用长短期记忆单元处理序列。'),
    category: 'Sequence', properties: [
      numberProperty('input_size', 'Input Size', '输入维度', 128),
      numberProperty('hidden_size', 'Hidden Size', '隐藏维度', 256),
      numberProperty('layers', 'Layers', '层数', 1, 1, 16),
      booleanProperty('bidirectional', 'Bidirectional', '双向', false),
    ],
    compatibility: { pytorch: 'exact', tensorflow: 'adapted' },
  }),
  component({
    id: 'gru_node', op: 'gru',
    name: text('GRU', 'GRU'),
    description: text('Processes sequences with gated recurrent units.', '使用门控循环单元处理序列。'),
    category: 'Sequence', properties: [
      numberProperty('input_size', 'Input Size', '输入维度', 128),
      numberProperty('hidden_size', 'Hidden Size', '隐藏维度', 256),
      numberProperty('layers', 'Layers', '层数', 1, 1, 16),
      booleanProperty('bidirectional', 'Bidirectional', '双向', false),
    ],
    compatibility: { pytorch: 'exact', tensorflow: 'adapted' },
  }),
  component({
    id: 'multihead_attention_node', op: 'multihead_attention',
    name: text('Multi-Head Attention', '多头注意力'),
    description: text('Applies self-attention across a sequence.', '在序列上应用自注意力。'),
    category: 'Sequence', properties: [
      numberProperty('embed_dim', 'Embedding Dimension', '嵌入维度', 128),
      numberProperty('num_heads', 'Attention Heads', '注意力头数', 4, 1, 64),
      sliderProperty('dropout', 'Dropout Rate', '丢弃率', 0.1, 0, 0.9, 0.05),
    ],
    compatibility: { pytorch: 'exact', tensorflow: 'adapted' },
  }),
  component({
    id: 'add_node', op: 'add', kind: 'merge',
    name: text('Add', '相加'),
    description: text('Adds two tensors element by element.', '将两个张量逐元素相加。'),
    category: 'Merge', inputs: [input('a'), input('b')], outputs: [output('output')], properties: [],
  }),
  component({
    id: 'concatenate_node', op: 'concatenate', kind: 'merge',
    name: text('Concatenate', '拼接'),
    description: text('Concatenates two tensors along an axis.', '沿指定轴拼接两个张量。'),
    category: 'Merge', inputs: [input('a'), input('b')], outputs: [output('output')],
    properties: [numberProperty('axis', 'Axis', '轴', -1, -8, 8)],
  }),
  component({
    id: 'mse_loss_node', op: 'mse_loss', kind: 'loss',
    name: text('Mean Squared Error', '均方误差'),
    description: text('Configures mean squared error loss.', '配置均方误差损失。'),
    category: 'Losses', inputs: [], outputs: [output('loss', 'LossSpec')], properties: [],
  }),
  component({
    id: 'cross_entropy_loss_node', op: 'cross_entropy_loss', kind: 'loss',
    name: text('Cross Entropy Loss', '交叉熵损失'),
    description: text('Configures multiclass cross entropy loss.', '配置多类别交叉熵损失。'),
    category: 'Losses', inputs: [], outputs: [output('loss', 'LossSpec')], properties: [],
  }),
  component({
    id: 'binary_cross_entropy_loss_node', op: 'binary_cross_entropy_loss', kind: 'loss',
    name: text('Binary Cross Entropy', '二元交叉熵'),
    description: text('Configures binary cross entropy loss.', '配置二元交叉熵损失。'),
    category: 'Losses', inputs: [], outputs: [output('loss', 'LossSpec')], properties: [],
  }),
  component({
    id: 'sgd_optimizer_node', op: 'sgd_optimizer', kind: 'optimizer',
    name: text('SGD Optimizer', 'SGD 优化器'),
    description: text('Configures stochastic gradient descent.', '配置随机梯度下降。'),
    category: 'Optimizers', inputs: [], outputs: [output('optimizer', 'OptimizerSpec')],
    properties: [
      sliderProperty('learning_rate', 'Learning Rate', '学习率', 0.01, 0.0001, 0.5, 0.0001),
      sliderProperty('momentum', 'Momentum', '动量', 0, 0, 0.99, 0.01),
    ],
  }),
  component({
    id: 'adam_optimizer_node', op: 'adam_optimizer', kind: 'optimizer',
    name: text('Adam Optimizer', 'Adam 优化器'),
    description: text('Configures the Adam optimizer.', '配置 Adam 优化器。'),
    category: 'Optimizers', inputs: [], outputs: [output('optimizer', 'OptimizerSpec')],
    properties: [sliderProperty('learning_rate', 'Learning Rate', '学习率', 0.001, 0.00001, 0.1, 0.00001)],
  }),
  component({
    id: 'adamw_optimizer_node', op: 'adamw_optimizer', kind: 'optimizer',
    name: text('AdamW Optimizer', 'AdamW 优化器'),
    description: text('Configures AdamW with decoupled weight decay.', '配置带解耦权重衰减的 AdamW。'),
    category: 'Optimizers', inputs: [], outputs: [output('optimizer', 'OptimizerSpec')],
    properties: [
      sliderProperty('learning_rate', 'Learning Rate', '学习率', 0.001, 0.00001, 0.1, 0.00001),
      sliderProperty('weight_decay', 'Weight Decay', '权重衰减', 0.01, 0, 0.2, 0.001),
    ],
  }),
];

const compositionNode = (key, componentId, parameters = {}) => ({ key, componentId, parameters });
const compositionEdge = (source, sourceHandle, target, targetHandle) => ({ source, sourceHandle, target, targetHandle });

const compositeComponents = [
  component({
    id: 'mlp_block_node', op: 'mlp_block',
    name: text('MLP Block', 'MLP 模块'),
    description: text('Dense, activation, and dropout packaged as an expandable subgraph.', '由全连接、激活和 Dropout 组成的可展开子图。'),
    category: 'Composite',
    properties: [
      numberProperty('input_features', 'Input Features', '输入特征数', 32),
      numberProperty('hidden_units', 'Hidden Units', '隐藏单元数', 64),
      sliderProperty('dropout', 'Dropout Rate', '丢弃率', 0.2, 0, 0.9, 0.05),
    ],
    composition: {
      nodes: [
        compositionNode('dense', 'dense_node', { input_features: '$input_features', units: '$hidden_units' }),
        compositionNode('activation', 'relu_node'),
        compositionNode('dropout', 'dropout_node', { rate: '$dropout' }),
      ],
      edges: [
        compositionEdge('dense', 'output', 'activation', 'input'),
        compositionEdge('activation', 'output', 'dropout', 'input'),
      ],
      inputs: { input: [{ node: 'dense', port: 'input' }] },
      outputs: { output: { node: 'dropout', port: 'output' } },
    },
  }),
  component({
    id: 'conv_block_node', op: 'conv_block',
    name: text('Conv Block', '卷积模块'),
    description: text('Conv2D, BatchNorm, ReLU, and pooling as an expandable subgraph.', '由二维卷积、批归一化、ReLU 和池化组成的可展开子图。'),
    category: 'Composite',
    properties: [
      numberProperty('input_channels', 'Input Channels', '输入通道数', 3),
      numberProperty('filters', 'Output Channels', '输出通道数', 32),
      numberProperty('kernel_size', 'Kernel Size', '卷积核大小', 3, 1, 15),
    ],
    composition: {
      nodes: [
        compositionNode('conv', 'conv2d_node', { input_channels: '$input_channels', filters: '$filters', kernel_size: '$kernel_size' }),
        compositionNode('norm', 'batch_norm2d_node', { channels: '$filters' }),
        compositionNode('activation', 'relu_node'),
        compositionNode('pool', 'max_pool2d_node'),
      ],
      edges: [
        compositionEdge('conv', 'output', 'norm', 'input'),
        compositionEdge('norm', 'output', 'activation', 'input'),
        compositionEdge('activation', 'output', 'pool', 'input'),
      ],
      inputs: { input: [{ node: 'conv', port: 'input' }] },
      outputs: { output: { node: 'pool', port: 'output' } },
    },
    compatibility: { pytorch: 'exact', tensorflow: 'adapted' },
  }),
  component({
    id: 'residual_mlp_block_node', op: 'residual_mlp_block',
    name: text('Residual MLP Block', '残差 MLP 模块'),
    description: text('Two dense layers with an expandable residual connection.', '带可展开残差连接的两层全连接模块。'),
    category: 'Composite',
    properties: [numberProperty('features', 'Features', '特征数', 64)],
    composition: {
      nodes: [
        compositionNode('dense1', 'dense_node', { input_features: '$features', units: '$features' }),
        compositionNode('activation', 'relu_node'),
        compositionNode('dense2', 'dense_node', { input_features: '$features', units: '$features' }),
        compositionNode('add', 'add_node'),
      ],
      edges: [
        compositionEdge('dense1', 'output', 'activation', 'input'),
        compositionEdge('activation', 'output', 'dense2', 'input'),
        compositionEdge('dense2', 'output', 'add', 'a'),
      ],
      inputs: {
        input: [{ node: 'dense1', port: 'input' }, { node: 'add', port: 'b' }],
      },
      outputs: { output: { node: 'add', port: 'output' } },
    },
  }),
];

export const pluginRegistry = [...regressionComponents, ...architectureComponents, ...compositeComponents];

export const componentById = new Map(pluginRegistry.map((manifest) => [manifest.id, manifest]));

export function defaults(manifest) {
  return Object.fromEntries(manifest.properties.map((property) => [property.key, property.default]));
}

function resolvedCompositionParameters(manifest, nodeParameters) {
  return Object.fromEntries(manifest.properties.map((property) => [property.key, nodeParameters[property.key] ?? property.default]));
}

export function expandComposite(node) {
  const composition = node.data.manifest.composition;
  if (!composition) return null;
  const parentParameters = resolvedCompositionParameters(node.data.manifest, node.data.parameters ?? {});
  const resolveParameter = (value) => (
    typeof value === 'string' && value.startsWith('$') ? parentParameters[value.slice(1)] : value
  );
  const idByKey = new Map();
  const nodes = composition.nodes.map((spec, index) => {
    const manifest = componentById.get(spec.componentId);
    if (!manifest) {
      const error = new Error('error.compositeExpansion');
      error.translationKey = 'error.compositeExpansion';
      throw error;
    }
    const id = `${node.id}-${spec.key}-${crypto.randomUUID()}`;
    idByKey.set(spec.key, id);
    return {
      id,
      type: 'pipelineNode',
      position: {
        x: node.position.x + (index % 3) * 270,
        y: node.position.y + Math.floor(index / 3) * 210,
      },
      data: {
        label: manifest.name,
        manifest,
        parameters: {
          ...defaults(manifest),
          ...Object.fromEntries(Object.entries(spec.parameters ?? {}).map(([key, value]) => [key, resolveParameter(value)])),
        },
        status: 'idle',
      },
    };
  });
  const edges = composition.edges.map((edge, index) => ({
    id: `${node.id}-internal-${index}-${crypto.randomUUID()}`,
    source: idByKey.get(edge.source),
    sourceHandle: edge.sourceHandle,
    target: idByKey.get(edge.target),
    targetHandle: edge.targetHandle,
    type: 'smoothstep',
  }));
  const inputs = Object.fromEntries(Object.entries(composition.inputs).map(([port, targets]) => [
    port,
    targets.map((target) => ({ nodeId: idByKey.get(target.node), port: target.port })),
  ]));
  const outputs = Object.fromEntries(Object.entries(composition.outputs).map(([port, source]) => [
    port,
    { nodeId: idByKey.get(source.node), port: source.port },
  ]));
  return { nodes, edges, inputs, outputs };
}
