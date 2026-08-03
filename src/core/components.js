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
const codeProperty = (key, en, zh, defaultValue) => ({
  key, label: text(en, zh), type: 'code', default: defaultValue,
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

const passThrough = (
  id,
  op,
  en,
  zh,
  descriptionEn,
  descriptionZh,
  category = 'Activations',
  properties = [],
  compatibility,
) => component({
  id, op, name: text(en, zh), description: text(descriptionEn, descriptionZh), category, properties, compatibility,
  minimumTier: ['relu', 'sigmoid', 'tanh', 'softmax'].includes(op) ? 'L0' : 'L1',
  browserBackend: ['relu', 'sigmoid', 'tanh', 'softmax'].includes(op) ? 'cpu' : 'none',
});

const regressionComponents = [
  component({
    id: 'tabular_data_node', op: 'tabular_data', kind: 'data',
    name: text('Tabular Data', '琛ㄦ牸鏁版嵁'),
    description: text('Provides the CSV or JSON dataset configured in the Data workspace.', '鎻愪緵鍦ㄦ暟鎹伐浣滃尯閰嶇疆鐨?CSV 鎴?JSON 鏁版嵁闆嗐€?),
    category: 'Data', inputs: [], outputs: [output('dataset', 'Table')], properties: [],
    minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'train_test_split_node', op: 'train_test_split', kind: 'data',
    name: text('Train/Test Split', '璁粌/娴嬭瘯闆嗗垝鍒?),
    description: text('Cleans numeric rows and creates a deterministic train/test split.', '娓呯悊鏁板€艰骞剁‘瀹氭€у垝鍒嗚缁冮泦涓庢祴璇曢泦銆?),
    category: 'Data', inputs: [input('dataset', 'Table')], outputs: [output('split', 'DatasetSplit')],
    properties: [sliderProperty('train_ratio', 'Training Ratio', '璁粌闆嗘瘮渚?, 0.8, 0.5, 0.9, 0.05)],
    minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'linear_regression_node', op: 'linear_regression', kind: 'model',
    name: text('Linear Regression', '绾挎€у洖褰?),
    description: text('Fits a linear model to predict continuous values.', '鎷熷悎绾挎€фā鍨嬫潵棰勬祴杩炵画鏁板€笺€?),
    category: 'Models', inputs: [input('split', 'DatasetSplit')], outputs: [output('model', 'ModelSpec')],
    properties: [sliderProperty('learning_rate', 'Learning Rate', '瀛︿範鐜?, 0.01, 0.001, 0.2, 0.001)],
    minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'knn_node', op: 'knn_classifier', kind: 'model',
    name: text('K-Nearest Neighbors', 'K-杩戦偦绠楁硶'),
    description: text('Classifies samples by voting among nearby examples.', '閫氳繃闄勮繎鏍锋湰鎶曠エ瀵规暟鎹繘琛屽垎绫汇€?),
    category: 'Classification',
    inputs: [input('dataset', 'Table')],
    outputs: [output('trained_model', 'TrainedModel')],
    properties: [
      numberProperty('k_value', 'Number of Neighbors (K)', '閭诲眳鏁伴噺 (K)', 3, 1, 99, 2),
      sliderProperty('train_ratio', 'Training Ratio', '璁粌闆嗘瘮渚?, 0.8, 0.5, 0.9, 0.05),
    ],
    minimumTier: 'L0',
    browserBackend: 'cpu',
    compatibility: { pytorch: 'unsupported', tensorflow: 'unsupported' },
  }),
  component({
    id: 'gradient_descent_node', op: 'gradient_descent', kind: 'training',
    name: text('Gradient Descent', '姊害涓嬮檷'),
    description: text('Trains the connected browser model with iterative gradient descent.', '浣跨敤杩唬姊害涓嬮檷璁粌宸茶繛鎺ョ殑娴忚鍣ㄦā鍨嬨€?),
    category: 'Training', inputs: [input('model', 'ModelSpec')], outputs: [output('trained_model', 'TrainedModel')],
    properties: [sliderProperty('epochs', 'Training Epochs', '璁粌杞暟', 100, 10, 500, 10)],
    minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'evaluate_node', op: 'evaluate_regression', kind: 'evaluation',
    name: text('Evaluate Regression', '鍥炲綊璇勪及'),
    description: text('Computes RMSE and R虏 on the connected test set.', '鍦ㄨ繛鎺ョ殑娴嬭瘯闆嗕笂璁＄畻 RMSE 鍜?R虏銆?),
    category: 'Evaluation', inputs: [input('trained_model', 'TrainedModel')], outputs: [output('metrics', 'Metrics')],
    properties: [], minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'evaluate_classification_node', op: 'evaluate_classification', kind: 'evaluation',
    name: text('Evaluate Classification', '鍒嗙被璇勪及'),
    description: text('Computes accuracy and macro F1 on a connected classifier test set.', '鍦ㄨ繛鎺ョ殑鍒嗙被鍣ㄦ祴璇曢泦涓婅绠楀噯纭巼鍜屽畯骞冲潎 F1銆?),
    category: 'Evaluation', inputs: [input('trained_model', 'TrainedModel')], outputs: [output('metrics', 'Metrics')],
    properties: [], minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'predictor_node', op: 'interactive_predictor', kind: 'inference',
    name: text('Interactive Predictor', '浜や簰棰勬祴鍣?),
    description: text('Creates an input form for trying the connected trained model.', '涓鸿繛鎺ョ殑宸茶缁冩ā鍨嬪垱寤轰氦浜掕緭鍏ヨ〃鍗曘€?),
    category: 'Evaluation', inputs: [input('trained_model', 'TrainedModel')], outputs: [output('prediction', 'Prediction')],
    properties: [], minimumTier: 'L0', browserBackend: 'cpu',
  }),
];

const architectureComponents = [
  component({
    id: 'tensor_input_node', op: 'tensor_input', kind: 'source',
    name: text('Tensor Input', '寮犻噺杈撳叆'),
    description: text('Declares a model input shape and dtype.', '澹版槑妯″瀷鐨勮緭鍏ュ舰鐘跺拰鏁版嵁绫诲瀷銆?),
    category: 'Core', inputs: [], outputs: [output('tensor')],
    properties: [
      stringProperty('shape', 'Shape', '褰㈢姸', '32'),
      selectProperty('dtype', 'Data Type', '鏁版嵁绫诲瀷', 'float32', ['float32', 'float16', 'int32']),
    ],
    minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'model_output_node', op: 'model_output', kind: 'sink',
    name: text('Model Output', '妯″瀷杈撳嚭'),
    description: text('Marks a tensor as a model output.', '灏嗗紶閲忔爣璁颁负妯″瀷杈撳嚭銆?),
    category: 'Core', inputs: [input('input')], outputs: [output('model', 'ModelSpec')], properties: [],
    minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'dense_node', op: 'dense',
    name: text('Dense / Linear', '鍏ㄨ繛鎺?/ 绾挎€у眰'),
    description: text('Applies a learned affine transformation.', '搴旂敤鍙涔犵殑浠垮皠鍙樻崲銆?),
    category: 'Layers',
    properties: [
      numberProperty('input_features', 'Input Features', '杈撳叆鐗瑰緛鏁?, 32),
      numberProperty('units', 'Output Units', '杈撳嚭鍗曞厓鏁?, 64),
      booleanProperty('use_bias', 'Use Bias', '浣跨敤鍋忕疆', true),
    ],
    minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'conv2d_node', op: 'conv2d',
    name: text('Conv2D', '浜岀淮鍗风Н'),
    description: text('Applies a 2D convolution to image-like tensors.', '瀵瑰浘鍍忕被寮犻噺搴旂敤浜岀淮鍗风Н銆?),
    category: 'Layers',
    properties: [
      numberProperty('input_channels', 'Input Channels', '杈撳叆閫氶亾鏁?, 3),
      numberProperty('filters', 'Output Channels', '杈撳嚭閫氶亾鏁?, 32),
      numberProperty('kernel_size', 'Kernel Size', '鍗风Н鏍稿ぇ灏?, 3, 1, 15),
      numberProperty('stride', 'Stride', '姝ュ箙', 1, 1, 8),
      selectProperty('padding', 'Padding', '濉厖', 'same', ['same', 'valid']),
      booleanProperty('use_bias', 'Use Bias', '浣跨敤鍋忕疆', true),
    ],
    compatibility: { pytorch: 'adapted', tensorflow: 'adapted' },
  }),
  component({
    id: 'max_pool2d_node', op: 'max_pool2d',
    name: text('MaxPool2D', '浜岀淮鏈€澶ф睜鍖?),
    description: text('Downsamples spatial dimensions with maximum pooling.', '浣跨敤鏈€澶ф睜鍖栫缉灏忕┖闂寸淮搴︺€?),
    category: 'Layers',
    properties: [
      numberProperty('pool_size', 'Pool Size', '姹犲寲澶у皬', 2, 1, 8),
      numberProperty('stride', 'Stride', '姝ュ箙', 2, 1, 8),
    ],
  }),
  passThrough('flatten_node', 'flatten', 'Flatten', '灞曞钩', 'Flattens all non-batch dimensions.', '灞曞钩鎵规缁翠互澶栫殑鎵€鏈夌淮搴︺€?, 'Shape'),
  passThrough('reshape_node', 'reshape', 'Reshape', '閲嶅褰㈢姸', 'Changes tensor shape without changing values.', '鍦ㄤ笉鏀瑰彉鏁板€肩殑鎯呭喌涓嬩慨鏀瑰紶閲忓舰鐘躲€?, 'Shape', [
    stringProperty('shape', 'Target Shape', '鐩爣褰㈢姸', '32'),
  ]),
  passThrough('relu_node', 'relu', 'ReLU', 'ReLU', 'Applies rectified linear activation.', '搴旂敤淇绾挎€ф縺娲汇€?),
  passThrough('gelu_node', 'gelu', 'GELU', 'GELU', 'Applies Gaussian error linear activation.', '搴旂敤楂樻柉璇樊绾挎€ф縺娲汇€?),
  passThrough('sigmoid_node', 'sigmoid', 'Sigmoid', 'Sigmoid', 'Maps values to the range from zero to one.', '灏嗘暟鍊兼槧灏勫埌闆跺埌涓€銆?),
  passThrough('tanh_node', 'tanh', 'Tanh', 'Tanh', 'Applies hyperbolic tangent activation.', '搴旂敤鍙屾洸姝ｅ垏婵€娲汇€?),
  passThrough('softmax_node', 'softmax', 'Softmax', 'Softmax', 'Normalizes logits into probabilities.', '灏?logits 褰掍竴鍖栦负姒傜巼銆?, 'Activations', [
    numberProperty('axis', 'Axis', '杞?, -1, -8, 8),
  ]),
  passThrough('dropout_node', 'dropout', 'Dropout', 'Dropout', 'Randomly drops activations during training.', '璁粌鏃堕殢鏈轰涪寮冩縺娲诲€笺€?, 'Regularization', [
    sliderProperty('rate', 'Dropout Rate', '涓㈠純鐜?, 0.2, 0, 0.9, 0.05),
  ]),
  passThrough('batch_norm1d_node', 'batch_norm1d', 'BatchNorm1D', '涓€缁存壒褰掍竴鍖?, 'Normalizes vector or sequence features by batch statistics.', '浣跨敤鎵规缁熻閲忓綊涓€鍖栧悜閲忔垨搴忓垪鐗瑰緛銆?, 'Normalization', [
    numberProperty('features', 'Features', '鐗瑰緛鏁?, 64),
    sliderProperty('momentum', 'Momentum', '鍔ㄩ噺', 0.1, 0.01, 0.99, 0.01),
  ], { pytorch: 'exact', tensorflow: 'adapted' }),
  passThrough('batch_norm2d_node', 'batch_norm2d', 'BatchNorm2D', '浜岀淮鎵瑰綊涓€鍖?, 'Normalizes image channels by batch statistics.', '浣跨敤鎵规缁熻閲忓綊涓€鍖栧浘鍍忛€氶亾銆?, 'Normalization', [
    numberProperty('channels', 'Channels', '閫氶亾鏁?, 32),
    sliderProperty('momentum', 'Momentum', '鍔ㄩ噺', 0.1, 0.01, 0.99, 0.01),
  ], { pytorch: 'exact', tensorflow: 'adapted' }),
  passThrough('layer_norm_node', 'layer_norm', 'LayerNorm', '灞傚綊涓€鍖?, 'Normalizes values over the last dimensions.', '鍦ㄦ渶鍚庤嫢骞茬淮搴︿笂褰掍竴鍖栨暟鍊笺€?, 'Normalization', [
    stringProperty('normalized_shape', 'Normalized Shape', '褰掍竴鍖栧舰鐘?, '64'),
  ], { pytorch: 'exact', tensorflow: 'adapted' }),
  component({
    id: 'embedding_node', op: 'embedding',
    name: text('Embedding', '宓屽叆灞?),
    description: text('Maps integer token IDs to dense vectors.', '灏嗘暣鏁?token ID 鏄犲皠涓虹瀵嗗悜閲忋€?),
    category: 'Sequence', properties: [
      numberProperty('vocab_size', 'Vocabulary Size', '璇嶈〃澶у皬', 10000, 2, 1000000),
      numberProperty('embedding_dim', 'Embedding Dimension', '宓屽叆缁村害', 128, 1, 4096),
    ],
  }),
  component({
    id: 'lstm_node', op: 'lstm',
    name: text('LSTM', 'LSTM'),
    description: text('Processes sequences with long short-term memory cells.', '浣跨敤闀跨煭鏈熻蹇嗗崟鍏冨鐞嗗簭鍒椼€?),
    category: 'Sequence', properties: [
      numberProperty('input_size', 'Input Size', '杈撳叆缁村害', 128),
      numberProperty('hidden_size', 'Hidden Size', '闅愯棌缁村害', 256),
      numberProperty('layers', 'Layers', '灞傛暟', 1, 1, 16),
      booleanProperty('bidirectional', 'Bidirectional', '鍙屽悜', false),
    ],
    compatibility: { pytorch: 'exact', tensorflow: 'adapted' },
  }),
  component({
    id: 'gru_node', op: 'gru',
    name: text('GRU', 'GRU'),
    description: text('Processes sequences with gated recurrent units.', '浣跨敤闂ㄦ帶寰幆鍗曞厓澶勭悊搴忓垪銆?),
    category: 'Sequence', properties: [
      numberProperty('input_size', 'Input Size', '杈撳叆缁村害', 128),
      numberProperty('hidden_size', 'Hidden Size', '闅愯棌缁村害', 256),
      numberProperty('layers', 'Layers', '灞傛暟', 1, 1, 16),
      booleanProperty('bidirectional', 'Bidirectional', '鍙屽悜', false),
    ],
    compatibility: { pytorch: 'exact', tensorflow: 'adapted' },
  }),
  component({
    id: 'multihead_attention_node', op: 'multihead_attention',
    name: text('Multi-Head Attention', '澶氬ご娉ㄦ剰鍔?),
    description: text('Applies self-attention across a sequence.', '鍦ㄥ簭鍒椾笂搴旂敤鑷敞鎰忓姏銆?),
    category: 'Sequence', properties: [
      numberProperty('embed_dim', 'Embedding Dimension', '宓屽叆缁村害', 128),
      numberProperty('num_heads', 'Attention Heads', '娉ㄦ剰鍔涘ご鏁?, 4, 1, 64),
      sliderProperty('dropout', 'Dropout Rate', '涓㈠純鐜?, 0.1, 0, 0.9, 0.05),
    ],
    compatibility: { pytorch: 'exact', tensorflow: 'adapted' },
  }),
  component({
    id: 'add_node', op: 'add', kind: 'merge',
    name: text('Add', '鐩稿姞'),
    description: text('Adds two tensors element by element.', '灏嗕袱涓紶閲忛€愬厓绱犵浉鍔犮€?),
    category: 'Merge', inputs: [input('a'), input('b')], outputs: [output('output')], properties: [],
  }),
  component({
    id: 'concatenate_node', op: 'concatenate', kind: 'merge',
    name: text('Concatenate', '鎷兼帴'),
    description: text('Concatenates two tensors along an axis.', '娌挎寚瀹氳酱鎷兼帴涓や釜寮犻噺銆?),
    category: 'Merge', inputs: [input('a'), input('b')], outputs: [output('output')],
    properties: [numberProperty('axis', 'Axis', '杞?, -1, -8, 8)],
  }),
  component({
    id: 'mse_loss_node', op: 'mse_loss', kind: 'loss',
    name: text('Mean Squared Error', '鍧囨柟璇樊'),
    description: text('Configures mean squared error loss.', '閰嶇疆鍧囨柟璇樊鎹熷け銆?),
    category: 'Losses', inputs: [], outputs: [output('loss', 'LossSpec')], properties: [],
    minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'cross_entropy_loss_node', op: 'cross_entropy_loss', kind: 'loss',
    name: text('Cross Entropy Loss', '浜ゅ弶鐔垫崯澶?),
    description: text('Configures multiclass cross entropy loss.', '閰嶇疆澶氱被鍒氦鍙夌喌鎹熷け銆?),
    category: 'Losses', inputs: [], outputs: [output('loss', 'LossSpec')], properties: [],
    minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'binary_cross_entropy_loss_node', op: 'binary_cross_entropy_loss', kind: 'loss',
    name: text('Binary Cross Entropy', '浜屽厓浜ゅ弶鐔?),
    description: text('Configures binary cross entropy loss.', '閰嶇疆浜屽厓浜ゅ弶鐔垫崯澶便€?),
    category: 'Losses', inputs: [], outputs: [output('loss', 'LossSpec')], properties: [],
    minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'custom_loss_node', op: 'custom_loss', kind: 'loss',
    name: text('Custom Loss', '鑷畾涔夋崯澶卞嚱鏁?),
    description: text('Defines a safe framework-neutral loss expression using prediction and target.', '浣跨敤 prediction 鍜?target 瀹氫箟瀹夊叏銆佹鏋舵棤鍏崇殑鎹熷け琛ㄨ揪寮忋€?),
    category: 'Losses', inputs: [], outputs: [output('loss', 'LossSpec')],
    properties: [codeProperty(
      'expression',
      'Expression (prediction, target)',
      '琛ㄨ揪寮忥紙prediction銆乼arget锛?,
      'mean(square(prediction - target))',
    )],
    minimumTier: 'L2',
  }),
  component({
    id: 'sgd_optimizer_node', op: 'sgd_optimizer', kind: 'optimizer',
    name: text('SGD Optimizer', 'SGD 浼樺寲鍣?),
    description: text('Configures stochastic gradient descent.', '閰嶇疆闅忔満姊害涓嬮檷銆?),
    category: 'Optimizers', inputs: [], outputs: [output('optimizer', 'OptimizerSpec')],
    properties: [
      sliderProperty('learning_rate', 'Learning Rate', '瀛︿範鐜?, 0.01, 0.0001, 0.5, 0.0001),
      sliderProperty('momentum', 'Momentum', '鍔ㄩ噺', 0, 0, 0.99, 0.01),
    ],
    minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'adam_optimizer_node', op: 'adam_optimizer', kind: 'optimizer',
    name: text('Adam Optimizer', 'Adam 浼樺寲鍣?),
    description: text('Configures the Adam optimizer.', '閰嶇疆 Adam 浼樺寲鍣ㄣ€?),
    category: 'Optimizers', inputs: [], outputs: [output('optimizer', 'OptimizerSpec')],
    properties: [sliderProperty('learning_rate', 'Learning Rate', '瀛︿範鐜?, 0.001, 0.00001, 0.1, 0.00001)],
    minimumTier: 'L0', browserBackend: 'cpu',
  }),
  component({
    id: 'adamw_optimizer_node', op: 'adamw_optimizer', kind: 'optimizer',
    name: text('AdamW Optimizer', 'AdamW 浼樺寲鍣?),
    description: text('Configures AdamW with decoupled weight decay.', '閰嶇疆甯﹁В鑰︽潈閲嶈“鍑忕殑 AdamW銆?),
    category: 'Optimizers', inputs: [], outputs: [output('optimizer', 'OptimizerSpec')],
    properties: [
      sliderProperty('learning_rate', 'Learning Rate', '瀛︿範鐜?, 0.001, 0.00001, 0.1, 0.00001),
      sliderProperty('weight_decay', 'Weight Decay', '鏉冮噸琛板噺', 0.01, 0, 0.2, 0.001),
    ],
  }),
  component({
    id: 'supervised_trainer_node', op: 'supervised_trainer', kind: 'training',
    name: text('Supervised Trainer', '鐩戠潱璁粌鍣?),
    description: text('Binds split data, a model, a loss, and an optimizer into an exportable training loop.', '鎶婂垝鍒嗗悗鐨勬暟鎹€佹ā鍨嬨€佹崯澶卞嚱鏁板拰浼樺寲鍣ㄧ粍鍚堟垚鍙鍑虹殑璁粌寰幆銆?),
    category: 'Training',
    inputs: [
      input('dataset', 'DatasetSplit'),
      input('model', 'ModelSpec'),
      input('loss', 'LossSpec'),
      input('optimizer', 'OptimizerSpec'),
    ],
    outputs: [output('trained_model', 'TrainedModel')],
    properties: [
      numberProperty('epochs', 'Epochs', '璁粌杞暟', 20, 1, 10000),
      numberProperty('batch_size', 'Batch Size', '鎵规澶у皬', 32, 1, 8192),
      booleanProperty('shuffle', 'Shuffle Training Data', '鎵撲贡璁粌鏁版嵁', true),
    ],
    minimumTier: 'L0', browserBackend: 'cpu',
  }),
];

const compositionNode = (key, componentId, parameters = {}) => ({ key, componentId, parameters });
const compositionEdge = (source, sourceHandle, target, targetHandle) => ({ source, sourceHandle, target, targetHandle });

const compositeComponents = [
  component({
    id: 'mlp_block_node', op: 'mlp_block',
    name: text('MLP Block', 'MLP 妯″潡'),
    description: text('Dense, activation, and dropout packaged as an expandable subgraph.', '鐢卞叏杩炴帴銆佹縺娲诲拰 Dropout 缁勬垚鐨勫彲灞曞紑瀛愬浘銆?),
    category: 'Composite',
    properties: [
      numberProperty('input_features', 'Input Features', '杈撳叆鐗瑰緛鏁?, 32),
      numberProperty('hidden_units', 'Hidden Units', '闅愯棌鍗曞厓鏁?, 64),
      sliderProperty('dropout', 'Dropout Rate', '涓㈠純鐜?, 0.2, 0, 0.9, 0.05),
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
    name: text('Conv Block', '鍗风Н妯″潡'),
    description: text('Conv2D, BatchNorm, ReLU, and pooling as an expandable subgraph.', '鐢变簩缁村嵎绉€佹壒褰掍竴鍖栥€丷eLU 鍜屾睜鍖栫粍鎴愮殑鍙睍寮€瀛愬浘銆?),
    category: 'Composite',
    properties: [
      numberProperty('input_channels', 'Input Channels', '杈撳叆閫氶亾鏁?, 3),
      numberProperty('filters', 'Output Channels', '杈撳嚭閫氶亾鏁?, 32),
      numberProperty('kernel_size', 'Kernel Size', '鍗风Н鏍稿ぇ灏?, 3, 1, 15),
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
    name: text('Residual MLP Block', '娈嬪樊 MLP 妯″潡'),
    description: text('Two dense layers with an expandable residual connection.', '甯﹀彲灞曞紑娈嬪樊杩炴帴鐨勪袱灞傚叏杩炴帴妯″潡銆?),
    category: 'Composite',
    properties: [numberProperty('features', 'Features', '鐗瑰緛鏁?, 64)],
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
    const manifest = spec.manifest ?? componentById.get(spec.componentId);
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
        x: node.position.x + (spec.position?.x ?? (index % 3) * 270),
        y: node.position.y + (spec.position?.y ?? Math.floor(index / 3) * 210),
      },
      data: {
        label: manifest.name,
        manifest,
        compositionKey: spec.key,
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

