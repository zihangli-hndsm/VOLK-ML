import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  COMPONENT_SCHEMA_VERSION,
  componentById,
  defaults,
  expandComposite,
  pluginRegistry,
} from '../src/core/components.js';
import {
  compilePipelineToPyTorch,
  compilePipelineToTensorFlow,
  graphToIR,
} from '../src/core/compiler.js';
import { executeBrowserGraph, predictWithModel } from '../src/core/browserRuntime.js';
import { migrateProject, PROJECT_VERSION } from '../src/core/project.js';
import { estimateExecutionPlan } from '../src/core/runtimeTiers.js';
import { tutorialByOp } from '../src/core/tutorials.js';
import { resolveMessage } from '../src/i18n.js';
import { languages, messages } from '../src/locales/ui.js';
import {
  PLATFORM_API_VERSION,
  createLocalPlatformServices,
  validatePlatformServices,
} from '../src/platform/services.js';

const makeNode = (id, componentId, parameters = {}) => {
  const manifest = componentById.get(componentId);
  assert.ok(manifest, `Unknown test component ${componentId}`);
  return {
    id,
    type: 'pipelineNode',
    position: { x: 0, y: 0 },
    data: {
      manifest,
      label: manifest.name,
      parameters: { ...defaults(manifest), ...parameters },
      status: 'idle',
    },
  };
};

const makeEdge = (source, sourceHandle, target, targetHandle) => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});

const assertPythonSyntax = (code, label) => {
  const result = spawnSync(
    'python3',
    ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'],
    { input: code, encoding: 'utf-8' },
  );
  assert.equal(result.status, 0, `${label} generated invalid Python:\n${result.stderr}`);
};

assert.equal(new Set(pluginRegistry.map((manifest) => manifest.id)).size, pluginRegistry.length, 'Component IDs must be unique');
for (const manifest of pluginRegistry) {
  assert.equal(manifest.schemaVersion, COMPONENT_SCHEMA_VERSION, `${manifest.id} schema version`);
  assert.ok(manifest.op && manifest.kind && manifest.category, `${manifest.id} semantic metadata`);
  assert.ok(messages[`category.${manifest.category}`], `${manifest.id} localized category`);
  assert.ok(['L0', 'L1', 'L2', 'L3'].includes(manifest.runtime.minimumTier), `${manifest.id} execution tier`);
  assert.ok(['exact', 'adapted', 'approximate', 'unsupported'].includes(manifest.compatibility.pytorch), `${manifest.id} PyTorch compatibility`);
  assert.ok(['exact', 'adapted', 'approximate', 'unsupported'].includes(manifest.compatibility.tensorflow), `${manifest.id} TensorFlow compatibility`);
  assert.ok(
    manifest.runtime.browserBackend !== 'none'
      || manifest.compatibility.pytorch !== 'unsupported'
      || manifest.compatibility.tensorflow !== 'unsupported',
    `${manifest.id} must have at least one usable execution or export path`,
  );
  const tutorial = tutorialByOp[manifest.op];
  assert.ok(tutorial, `${manifest.id} beginner tutorial`);
  assert.ok(tutorial.formula && tutorial.visual, `${manifest.id} tutorial formula and visual`);
  for (const language of languages) {
    assert.ok(manifest.name[language.code], `${manifest.id} ${language.code} name`);
    assert.ok(manifest.description[language.code], `${manifest.id} ${language.code} description`);
    for (const property of manifest.properties) assert.ok(property.label[language.code], `${manifest.id}.${property.key} ${language.code} label`);
    assert.ok(tutorial.intuition[language.code], `${manifest.id} ${language.code} tutorial intuition`);
    assert.ok(tutorial.principle[language.code], `${manifest.id} ${language.code} tutorial principle`);
    assert.ok(tutorial.formula[language.code], `${manifest.id} ${language.code} tutorial formula`);
    assert.ok(tutorial.example[language.code], `${manifest.id} ${language.code} tutorial example`);
  }
  assert.equal(new Set(manifest.inputs.map((port) => port.name)).size, manifest.inputs.length, `${manifest.id} input ports`);
  assert.equal(new Set(manifest.outputs.map((port) => port.name)).size, manifest.outputs.length, `${manifest.id} output ports`);

  if (manifest.composition) {
    const internal = new Map(manifest.composition.nodes.map((node) => [node.key, componentById.get(node.componentId)]));
    assert.equal(internal.size, manifest.composition.nodes.length, `${manifest.id} composite keys`);
    for (const [key, child] of internal) assert.ok(child, `${manifest.id} child ${key}`);
    for (const edge of manifest.composition.edges) {
      assert.ok(internal.get(edge.source)?.outputs.some((port) => port.name === edge.sourceHandle), `${manifest.id} source mapping`);
      assert.ok(internal.get(edge.target)?.inputs.some((port) => port.name === edge.targetHandle), `${manifest.id} target mapping`);
    }
    for (const [port, targets] of Object.entries(manifest.composition.inputs)) {
      assert.ok(manifest.inputs.some((input) => input.name === port), `${manifest.id} external input ${port}`);
      for (const target of targets) assert.ok(internal.get(target.node)?.inputs.some((input) => input.name === target.port), `${manifest.id} input target`);
    }
    for (const [port, source] of Object.entries(manifest.composition.outputs)) {
      assert.ok(manifest.outputs.some((output) => output.name === port), `${manifest.id} external output ${port}`);
      assert.ok(internal.get(source.node)?.outputs.some((output) => output.name === source.port), `${manifest.id} output source`);
    }
  }
}

for (const [key, translations] of Object.entries(messages)) {
  for (const language of languages) assert.ok(translations[language.code], `${key} is missing ${language.code}`);
}

assert.equal(resolveMessage(tutorialByOp.model_output.formula, 'zh'), 'model(x) = 选定的输出张量');
assert.equal(resolveMessage(tutorialByOp.cross_entropy_loss.formula, 'zh'), 'L = −log p(正确类别)');
assert.equal(resolveMessage(tutorialByOp.cross_entropy_loss.formula, 'en'), 'L = −log p(correct class)');

const architectureNodes = [
  makeNode('input', 'tensor_input_node', { shape: '32' }),
  makeNode('dense', 'dense_node', { input_features: 32, units: 10 }),
  makeNode('relu', 'relu_node'),
  makeNode('output', 'model_output_node'),
  makeNode('loss', 'cross_entropy_loss_node'),
  makeNode('optimizer', 'adam_optimizer_node'),
];
const architectureEdges = [
  makeEdge('input', 'tensor', 'dense', 'input'),
  makeEdge('dense', 'output', 'relu', 'input'),
  makeEdge('relu', 'output', 'output', 'input'),
];
const ir = graphToIR(architectureNodes, architectureEdges);
assert.equal(ir.version, 2);
assert.deepEqual(ir.nodes.filter((node) => ['input', 'dense', 'relu', 'output'].includes(node.id)).map((node) => node.id), ['input', 'dense', 'relu', 'output']);

const pytorch = compilePipelineToPyTorch(architectureNodes, architectureEdges);
const tensorflow = compilePipelineToTensorFlow(architectureNodes, architectureEdges);
assert.match(pytorch.code, /class VOLKModel/);
assert.match(pytorch.code, /nn\.Linear\(32, 10/);
assert.match(pytorch.code, /nn\.CrossEntropyLoss/);
assert.match(tensorflow.code, /keras\.Model/);
assert.match(tensorflow.code, /layers\.Dense\(10/);
assert.match(tensorflow.code, /SparseCategoricalCrossentropy/);
assertPythonSyntax(pytorch.code, 'representative PyTorch architecture');
assertPythonSyntax(tensorflow.code, 'representative TensorFlow architecture');

const architectureExpectations = {
  dense_node: [/nn\.Linear/, /layers\.Dense/],
  conv2d_node: [/nn\.Conv2d/, /layers\.Conv2D/],
  max_pool2d_node: [/nn\.MaxPool2d/, /layers\.MaxPooling2D/],
  flatten_node: [/torch\.flatten/, /layers\.Flatten/],
  reshape_node: [/\.reshape/, /layers\.Reshape/],
  relu_node: [/nn\.ReLU/, /layers\.ReLU/],
  gelu_node: [/nn\.GELU/, /Activation\("gelu"\)/],
  sigmoid_node: [/nn\.Sigmoid/, /Activation\("sigmoid"\)/],
  tanh_node: [/nn\.Tanh/, /Activation\("tanh"\)/],
  softmax_node: [/nn\.Softmax/, /layers\.Softmax/],
  dropout_node: [/nn\.Dropout/, /layers\.Dropout/],
  batch_norm1d_node: [/nn\.BatchNorm1d/, /layers\.BatchNormalization/],
  batch_norm2d_node: [/nn\.BatchNorm2d/, /layers\.BatchNormalization/],
  layer_norm_node: [/nn\.LayerNorm/, /layers\.LayerNormalization/],
  embedding_node: [/nn\.Embedding/, /layers\.Embedding/],
  lstm_node: [/nn\.LSTM/, /layers\.LSTM/],
  gru_node: [/nn\.GRU/, /layers\.GRU/],
  multihead_attention_node: [/nn\.MultiheadAttention/, /layers\.MultiHeadAttention/],
  add_node: [/\+/, /layers\.Add/],
  concatenate_node: [/torch\.cat/, /layers\.Concatenate/],
  mlp_block_node: [/nn\.Sequential/, /keras\.Sequential/],
  conv_block_node: [/nn\.Conv2d/, /layers\.Conv2D/],
  residual_mlp_block_node: [/ResidualMLPBlock/, /ResidualMLPBlock/],
};

const makeArchitectureCase = (componentId) => {
  const manifest = componentById.get(componentId);
  const inputParameters = manifest.op === 'embedding'
    ? { shape: '12', dtype: 'int32' }
    : { shape: '32' };
  const parameters = ['lstm', 'gru'].includes(manifest.op)
    ? { layers: 2 }
    : {};
  const subject = makeNode('subject', componentId, parameters);
  const outputNode = makeNode('case-output', 'model_output_node');
  if (manifest.kind === 'merge') {
    return {
      nodes: [
        makeNode('case-input-a', 'tensor_input_node', inputParameters),
        makeNode('case-input-b', 'tensor_input_node', inputParameters),
        subject,
        outputNode,
      ],
      edges: [
        makeEdge('case-input-a', 'tensor', 'subject', 'a'),
        makeEdge('case-input-b', 'tensor', 'subject', 'b'),
        makeEdge('subject', 'output', 'case-output', 'input'),
      ],
    };
  }
  return {
    nodes: [
      makeNode('case-input', 'tensor_input_node', inputParameters),
      subject,
      outputNode,
    ],
    edges: [
      makeEdge('case-input', 'tensor', 'subject', manifest.inputs[0].name),
      makeEdge('subject', manifest.outputs[0].name, 'case-output', 'input'),
    ],
  };
};

for (const [componentId, [pytorchPattern, tensorflowPattern]] of Object.entries(architectureExpectations)) {
  const graph = makeArchitectureCase(componentId);
  const pytorchCase = compilePipelineToPyTorch(graph.nodes, graph.edges);
  const tensorflowCase = compilePipelineToTensorFlow(graph.nodes, graph.edges);
  assert.ok(
    pytorchCase.report.some((item) => item.componentId === componentId),
    `${componentId} appears in PyTorch compatibility report`,
  );
  assert.ok(
    tensorflowCase.report.some((item) => item.componentId === componentId),
    `${componentId} appears in TensorFlow compatibility report`,
  );
  assert.match(pytorchCase.code, pytorchPattern, `${componentId} PyTorch mapping`);
  assert.match(tensorflowCase.code, tensorflowPattern, `${componentId} TensorFlow mapping`);
  assertPythonSyntax(pytorchCase.code, `${componentId} PyTorch`);
  assertPythonSyntax(tensorflowCase.code, `${componentId} TensorFlow`);
}
const stackedLstm = makeArchitectureCase('lstm_node');
assert.equal(
  (compilePipelineToTensorFlow(stackedLstm.nodes, stackedLstm.edges).code.match(/layers\.LSTM/g) ?? []).length,
  2,
  'TensorFlow LSTM honors the configured layer count',
);

const orphan = makeNode('orphan', 'dense_node', { input_features: 999, units: 777 });
const pytorchWithoutOrphan = compilePipelineToPyTorch([...architectureNodes, orphan], architectureEdges);
const tensorflowWithoutOrphan = compilePipelineToTensorFlow([...architectureNodes, orphan], architectureEdges);
assert.doesNotMatch(pytorchWithoutOrphan.code, /n_orphan/);
assert.doesNotMatch(tensorflowWithoutOrphan.code, /n_orphan/);
assert.doesNotMatch(pytorchWithoutOrphan.code, /999, 777/);
assert.doesNotMatch(tensorflowWithoutOrphan.code, /Dense\(777/);
const unsupportedOrphan = makeNode('unsupported-orphan', 'knn_node');
assert.doesNotThrow(() => compilePipelineToPyTorch(
  [...architectureNodes, unsupportedOrphan],
  architectureEdges,
), 'an unconnected unsupported component must not block an active architecture');

const binaryNodes = [
  makeNode('binary-input', 'tensor_input_node', { shape: '32' }),
  makeNode('binary-dense', 'dense_node', { input_features: 32, units: 1 }),
  makeNode('binary-sigmoid', 'sigmoid_node'),
  makeNode('binary-output', 'model_output_node'),
  makeNode('binary-loss', 'binary_cross_entropy_loss_node'),
];
const binaryProbabilityEdges = [
  makeEdge('binary-input', 'tensor', 'binary-dense', 'input'),
  makeEdge('binary-dense', 'output', 'binary-sigmoid', 'input'),
  makeEdge('binary-sigmoid', 'output', 'binary-output', 'input'),
];
const binaryLogitEdges = [
  makeEdge('binary-input', 'tensor', 'binary-dense', 'input'),
  makeEdge('binary-dense', 'output', 'binary-output', 'input'),
];
assert.match(compilePipelineToPyTorch(binaryNodes, binaryProbabilityEdges).code, /criterion = nn\.BCELoss\(\)/);
assert.match(compilePipelineToTensorFlow(binaryNodes, binaryProbabilityEdges).code, /BinaryCrossentropy\(from_logits=False\)/);
assert.match(compilePipelineToPyTorch(binaryNodes, binaryLogitEdges).code, /criterion = nn\.BCEWithLogitsLoss\(\)/);
assert.match(compilePipelineToTensorFlow(binaryNodes, binaryLogitEdges).code, /BinaryCrossentropy\(from_logits=True\)/);

const trainingCases = [
  ['mse_loss_node', 'sgd_optimizer_node', /nn\.MSELoss/, /torch\.optim\.SGD/, /loss="mse"|loss="mse"/, /keras\.optimizers\.SGD/],
  ['cross_entropy_loss_node', 'adam_optimizer_node', /nn\.CrossEntropyLoss/, /torch\.optim\.Adam\(/, /SparseCategoricalCrossentropy/, /keras\.optimizers\.Adam\(/],
  ['binary_cross_entropy_loss_node', 'adamw_optimizer_node', /BCEWithLogitsLoss/, /torch\.optim\.AdamW/, /BinaryCrossentropy/, /keras\.optimizers\.AdamW/],
];
for (const [lossId, optimizerId, torchLoss, torchOptimizer, tfLoss, tfOptimizer] of trainingCases) {
  const configuredNodes = [
    ...architectureNodes.filter((node) => !['loss', 'optimizer'].includes(node.id)),
    makeNode('loss', lossId),
    makeNode('optimizer', optimizerId),
  ];
  const torchConfigured = compilePipelineToPyTorch(configuredNodes, architectureEdges);
  const tfConfigured = compilePipelineToTensorFlow(configuredNodes, architectureEdges);
  assert.match(torchConfigured.code, torchLoss, `${lossId} PyTorch configuration`);
  assert.match(torchConfigured.code, torchOptimizer, `${optimizerId} PyTorch configuration`);
  assert.match(tfConfigured.code, tfLoss, `${lossId} TensorFlow configuration`);
  assert.match(tfConfigured.code, tfOptimizer, `${optimizerId} TensorFlow configuration`);
  assertPythonSyntax(torchConfigured.code, `${lossId}/${optimizerId} PyTorch`);
  assertPythonSyntax(tfConfigured.code, `${lossId}/${optimizerId} TensorFlow`);
}

const composite = makeNode('block', 'mlp_block_node', { input_features: 16, hidden_units: 24, dropout: 0.3 });
const expansion = expandComposite(composite);
assert.equal(expansion.nodes.length, 3);
assert.equal(expansion.edges.length, 2);
assert.equal(expansion.inputs.input.length, 1);
assert.ok(expansion.outputs.output.nodeId);
assert.equal(expansion.nodes[0].data.parameters.units, 24);

const browserNodes = [
  makeNode('data', 'tabular_data_node'),
  makeNode('split', 'train_test_split_node'),
  makeNode('linear', 'linear_regression_node'),
  makeNode('train', 'gradient_descent_node'),
];
assert.deepEqual(estimateExecutionPlan(browserNodes, null).recommendedTier, 'L0');
assert.equal(estimateExecutionPlan(browserNodes, null).canRunHere, true);
assert.equal(estimateExecutionPlan(architectureNodes, null).recommendedTier, 'L1');
assert.equal(estimateExecutionPlan(architectureNodes, null).canRunHere, false);
const largeEmbedding = makeNode('embedding', 'embedding_node', { vocab_size: 1_000_000, embedding_dim: 1024 });
assert.equal(estimateExecutionPlan([largeEmbedding], null).recommendedTier, 'L3');

const regressionGraphNodes = [
  makeNode('reg-data', 'tabular_data_node'),
  makeNode('reg-split', 'train_test_split_node'),
  makeNode('reg-model', 'linear_regression_node'),
  makeNode('reg-train', 'gradient_descent_node', { epochs: 50 }),
  makeNode('reg-evaluate', 'evaluate_node'),
  makeNode('reg-predict', 'predictor_node'),
];
const regressionGraphEdges = [
  makeEdge('reg-data', 'dataset', 'reg-split', 'dataset'),
  makeEdge('reg-split', 'split', 'reg-model', 'split'),
  makeEdge('reg-model', 'model', 'reg-train', 'model'),
  makeEdge('reg-train', 'trained_model', 'reg-evaluate', 'trained_model'),
  makeEdge('reg-train', 'trained_model', 'reg-predict', 'trained_model'),
];
const regressionDataset = {
  name: 'regression-check',
  rows: Array.from({ length: 40 }, (_, index) => ({
    feature_a: index,
    feature_b: index % 7,
    target: 3 * index - 2 * (index % 7) + 5,
  })),
  columns: [
    { name: 'feature_a', type: 'number' },
    { name: 'feature_b', type: 'number' },
    { name: 'target', type: 'number' },
  ],
  featureColumns: ['feature_a', 'feature_b'],
  targetColumn: 'target',
  task: 'regression',
};
const regressionModel = await executeBrowserGraph({
  nodes: regressionGraphNodes,
  edges: regressionGraphEdges,
  dataset: regressionDataset,
});
assert.equal(regressionModel.type, 'linear_regression');
assert.ok(Number.isFinite(regressionModel.metrics.rmse), 'regression browser backend returns RMSE');
assert.ok(Number.isFinite(predictWithModel(regressionModel, [10, 3])), 'regression predictor returns a number');
const tabularWithArchitectureOrphan = compilePipelineToPyTorch(
  [
    ...regressionGraphNodes,
    makeNode('unused-input', 'tensor_input_node'),
    makeNode('unused-layer', 'dense_node'),
  ],
  [
    ...regressionGraphEdges,
    makeEdge('unused-input', 'tensor', 'unused-layer', 'input'),
  ],
);
assert.match(tabularWithArchitectureOrphan.code, /load_tabular_data/);
assert.doesNotMatch(tabularWithArchitectureOrphan.code, /class VOLKModel/);
assertPythonSyntax(tabularWithArchitectureOrphan.code, 'tabular pipeline with architecture orphan');

const legacyKnnProject = {
  format: 'VOLK-ML',
  version: 4,
  graph: {
    nodes: [
      makeNode('legacy-knn', 'knn_node'),
      makeNode('legacy-evaluate', 'evaluate_classification_node'),
    ],
    edges: [
      makeEdge('legacy-knn', 'model', 'legacy-evaluate', 'trained_model'),
      makeEdge('legacy-knn', 'boundary', 'legacy-preview', 'mesh'),
    ],
  },
};
const migratedKnnProject = migrateProject(legacyKnnProject);
assert.equal(migratedKnnProject.version, PROJECT_VERSION);
assert.equal(migratedKnnProject.graph.edges.length, 1);
assert.equal(migratedKnnProject.graph.edges[0].sourceHandle, 'trained_model');

const classificationGraphNodes = [
  makeNode('class-data', 'tabular_data_node'),
  makeNode('class-model', 'knn_node', { k_value: 3, train_ratio: 0.8 }),
  makeNode('class-evaluate', 'evaluate_classification_node'),
  makeNode('class-predict', 'predictor_node'),
];
const classificationGraphEdges = [
  makeEdge('class-data', 'dataset', 'class-model', 'dataset'),
  makeEdge('class-model', 'trained_model', 'class-evaluate', 'trained_model'),
  makeEdge('class-model', 'trained_model', 'class-predict', 'trained_model'),
];
const classificationDataset = {
  name: 'classification-check',
  rows: Array.from({ length: 60 }, (_, index) => {
    const positive = index % 2 === 0;
    const offset = Math.floor(index / 2) * 0.01;
    return {
      feature_a: (positive ? 3 : -3) + offset,
      feature_b: (positive ? 2 : -2) - offset,
      label: positive ? 'positive' : 'negative',
    };
  }),
  columns: [
    { name: 'feature_a', type: 'number' },
    { name: 'feature_b', type: 'number' },
    { name: 'label', type: 'text' },
  ],
  featureColumns: ['feature_a', 'feature_b'],
  targetColumn: 'label',
  task: 'classification',
};
const classificationModel = await executeBrowserGraph({
  nodes: classificationGraphNodes,
  edges: classificationGraphEdges,
  dataset: classificationDataset,
});
assert.equal(classificationModel.type, 'knn_classifier');
assert.ok(classificationModel.metrics.accuracy >= 0.9, 'KNN browser backend classifies the separable test set');
assert.equal(predictWithModel(classificationModel, [3.1, 1.9]), 'positive');

const imbalancedClassificationModel = await executeBrowserGraph({
  nodes: classificationGraphNodes,
  edges: classificationGraphEdges,
  dataset: {
    ...classificationDataset,
    name: 'imbalanced-classification-check',
    rows: [
      ...Array.from({ length: 9 }, (_, index) => ({
        feature_a: index,
        feature_b: index / 2,
        label: 'majority',
      })),
      { feature_a: 20, feature_b: 20, label: 'minority' },
    ],
  },
});
assert.equal(
  new Set(imbalancedClassificationModel.train.map((sample) => sample.y)).size,
  2,
  'stratified classification split keeps every class in training',
);
assert.throws(
  () => compilePipelineToPyTorch(classificationGraphNodes, classificationGraphEdges),
  (error) => error.translationKey === 'error.frameworkUnsupported',
  'KNN remains honestly marked as browser-only',
);

const localPlatform = validatePlatformServices(createLocalPlatformServices());
assert.equal(localPlatform.apiVersion, PLATFORM_API_VERSION);
assert.equal(localPlatform.compute.canExecuteInBrowser(estimateExecutionPlan(browserNodes, null)), true);
assert.equal(localPlatform.compute.canExecuteInBrowser(estimateExecutionPlan(architectureNodes, null)), false);
await assert.rejects(localPlatform.compute.submit({}), (error) => (
  error.code === 'PLATFORM_CAPABILITY_UNAVAILABLE'
  && error.capability === 'compute.submit'
));
assert.throws(
  () => validatePlatformServices({ apiVersion: PLATFORM_API_VERSION }),
  /missing account\.getCurrentUser/,
);

console.log(`Validated ${pluginRegistry.length} usable components and tutorials, every architecture compiler mapping, both browser pipelines, platform services, localization, and execution tiers.`);
