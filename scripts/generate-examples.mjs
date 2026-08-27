import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { componentById, defaults } from '../src/core/components.js';
import { PROJECT_VERSION, validateProjectForWorkspace } from '../src/core/project.js';
import { compilePipelineToPyTorch, compilePipelineToTensorFlow } from '../src/core/compiler.js';
import { executeBrowserGraph } from '../src/core/browserRuntime.js';
import { teachingDatasetById, teachingDatasets } from '../src/core/teachingDatasets.js';
import { exampleMetadata } from '../src/core/exampleProjects.js';
import {
  validateExampleTeachingContract,
  validateInputShapeAgainstDataset,
  validateNoPostLabelMutationMetadata,
} from '../src/core/exampleQuality.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(__dirname, '../examples');
const FIXED_SAVED_AT = '2026-08-06T00:00:00.000Z';
const CHECK_ONLY = process.argv.includes('--check');

const makeNode = (id, componentId, position, parameters = {}) => {
  const manifest = componentById.get(componentId);
  if (!manifest) throw new Error(`Unknown component ${componentId}`);
  return {
    id,
    type: 'pipelineNode',
    position,
    data: {
      label: manifest.name,
      manifest,
      parameters: { ...defaults(manifest), ...parameters },
      status: 'idle',
    },
  };
};

const makeEdge = (id, source, sourceHandle, target, targetHandle) => ({
  id,
  source,
  sourceHandle,
  target,
  targetHandle,
  type: 'deletable',
});

const X = 40;
const STEP = 520;
const topRow = (index) => ({ x: X + index * STEP, y: 80 });
const midRow = (index) => ({ x: X + index * STEP, y: 660 });
const bottomRow = (index) => ({ x: X + index * STEP, y: 1240 });
const forkTop = (index) => ({ x: X + index * STEP, y: 120 });
const forkBottom = (index) => ({ x: X + index * STEP, y: 700 });

const buildProject = (name, nodes, edges, data = null) => ({
  format: 'VOLK-ML',
  version: PROJECT_VERSION,
  name,
  savedAt: FIXED_SAVED_AT,
  language: { primary: 'en', secondary: 'zh' },
  workspace: { libraryMode: 'detailed', leftWidth: 300, rightWidth: 384, viewMode: 'canvas' },
  graph: { nodes, edges },
  customComponents: [],
  data,
  trainedModel: null,
});

const assertPythonSyntax = (code, label) => {
  const python = ['python3', 'python'].find((candidate) => spawnSync(candidate, ['--version'], { encoding: 'utf-8' }).status === 0) ?? 'python3';
  const result = spawnSync(python, ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], { input: code, encoding: 'utf-8' });
  if (result.status !== 0) throw new Error(`${label} generated invalid Python:\n${result.stderr}`);
};

// Local KNN probe helper for the k-sensitivity teaching check. This mirrors the
// runtime ranking semantics (squared Euclidean on normalized features).
function knnProbeChanges(model, probe) {
  const normalize = (values) => values.map((value, feature) => (
    (value - model.normalization.means[feature]) / model.normalization.stds[feature]
  ));
  const normalized = normalize(probe);
  const ranked = model.train
    .map((sample) => ({
      label: sample.y,
      distance: sample.x.reduce((sum, value, feature) => sum + (value - normalized[feature]) ** 2, 0),
    }))
    .sort((a, b) => a.distance - b.distance);
  const topK = (k) => ranked.slice(0, k).map((neighbor) => neighbor.label).join(',');
  return topK(1) !== topK(5);
}

const linearPipeline = (prefix, dataset) => {
  const nodes = [
    makeNode(`${prefix}-data`, 'tabular_data_node', midRow(0)),
    makeNode(`${prefix}-split`, 'train_test_split_node', midRow(1), { train_ratio: dataset.trainRatio }),
    makeNode(`${prefix}-linear`, 'linear_regression_node', midRow(2), { learning_rate: 0.05 }),
    makeNode(`${prefix}-train`, 'gradient_descent_node', midRow(3), { epochs: 300 }),
    makeNode(`${prefix}-evaluate`, 'evaluate_node', forkTop(4)),
    makeNode(`${prefix}-predict`, 'predictor_node', forkBottom(4)),
  ];
  const edges = [
    makeEdge(`${prefix}-data-split`, `${prefix}-data`, 'dataset', `${prefix}-split`, 'dataset'),
    makeEdge(`${prefix}-split-linear`, `${prefix}-split`, 'split', `${prefix}-linear`, 'split'),
    makeEdge(`${prefix}-linear-train`, `${prefix}-linear`, 'model', `${prefix}-train`, 'model'),
    makeEdge(`${prefix}-train-evaluate`, `${prefix}-train`, 'trained_model', `${prefix}-evaluate`, 'trained_model'),
    makeEdge(`${prefix}-train-predict`, `${prefix}-train`, 'trained_model', `${prefix}-predict`, 'trained_model'),
  ];
  return { nodes, edges };
};

const knnPipeline = (prefix, dataset) => {
  const nodes = [
    makeNode(`${prefix}-data`, 'tabular_data_node', midRow(0)),
    makeNode(`${prefix}-knn`, 'knn_node', midRow(1), { k_value: 5, train_ratio: dataset.trainRatio }),
    makeNode(`${prefix}-evaluate`, 'evaluate_classification_node', forkTop(3)),
    makeNode(`${prefix}-predict`, 'predictor_node', forkBottom(3)),
  ];
  const edges = [
    makeEdge(`${prefix}-data-knn`, `${prefix}-data`, 'dataset', `${prefix}-knn`, 'dataset'),
    makeEdge(`${prefix}-knn-evaluate`, `${prefix}-knn`, 'trained_model', `${prefix}-evaluate`, 'trained_model'),
    makeEdge(`${prefix}-knn-predict`, `${prefix}-knn`, 'trained_model', `${prefix}-predict`, 'trained_model'),
  ];
  return { nodes, edges };
};

const mlpClassificationPipeline = (prefix, dataset, { units = [16, 8], epochs = 150, batchSize = 32, learningRate = 0.005, optimizer = 'adam' }) => {
  const featureCount = dataset.featureColumns.length;
  const optimizerNode = optimizer === 'sgd'
    ? makeNode(`${prefix}-optimizer`, 'sgd_optimizer_node', bottomRow(7), { learning_rate: learningRate, momentum: 0.6 })
    : makeNode(`${prefix}-optimizer`, 'adam_optimizer_node', bottomRow(7), { learning_rate: learningRate });
  const nodes = [
    makeNode(`${prefix}-data`, 'tabular_data_node', midRow(0)),
    makeNode(`${prefix}-split`, 'train_test_split_node', midRow(1), { train_ratio: dataset.trainRatio }),
    makeNode(`${prefix}-input`, 'tensor_input_node', topRow(0), { shape: String(featureCount), dtype: 'float32' }),
    makeNode(`${prefix}-hidden1`, 'dense_node', topRow(1), { input_features: featureCount, units: units[0], use_bias: true }),
    makeNode(`${prefix}-relu1`, 'relu_node', topRow(2)),
    makeNode(`${prefix}-hidden2`, 'dense_node', topRow(3), { input_features: units[0], units: units[1], use_bias: true }),
    makeNode(`${prefix}-relu2`, 'relu_node', topRow(4)),
    makeNode(`${prefix}-head`, 'dense_node', topRow(5), { input_features: units[1], units: 2, use_bias: true }),
    makeNode(`${prefix}-softmax`, 'softmax_node', topRow(6)),
    makeNode(`${prefix}-output`, 'model_output_node', topRow(7)),
    makeNode(`${prefix}-loss`, 'cross_entropy_loss_node', bottomRow(6)),
    optimizerNode,
    makeNode(`${prefix}-trainer`, 'supervised_trainer_node', midRow(7), { epochs, batch_size: batchSize, shuffle: true }),
    makeNode(`${prefix}-evaluate`, 'evaluate_classification_node', forkTop(9)),
    makeNode(`${prefix}-predict`, 'predictor_node', forkBottom(9)),
  ];
  const edges = [
    makeEdge(`${prefix}-data-split`, `${prefix}-data`, 'dataset', `${prefix}-split`, 'dataset'),
    makeEdge(`${prefix}-input-h1`, `${prefix}-input`, 'tensor', `${prefix}-hidden1`, 'input'),
    makeEdge(`${prefix}-h1-r1`, `${prefix}-hidden1`, 'output', `${prefix}-relu1`, 'input'),
    makeEdge(`${prefix}-r1-h2`, `${prefix}-relu1`, 'output', `${prefix}-hidden2`, 'input'),
    makeEdge(`${prefix}-h2-r2`, `${prefix}-hidden2`, 'output', `${prefix}-relu2`, 'input'),
    makeEdge(`${prefix}-r2-head`, `${prefix}-relu2`, 'output', `${prefix}-head`, 'input'),
    makeEdge(`${prefix}-head-softmax`, `${prefix}-head`, 'output', `${prefix}-softmax`, 'input'),
    makeEdge(`${prefix}-softmax-output`, `${prefix}-softmax`, 'output', `${prefix}-output`, 'input'),
    makeEdge(`${prefix}-split-trainer`, `${prefix}-split`, 'split', `${prefix}-trainer`, 'dataset'),
    makeEdge(`${prefix}-output-trainer`, `${prefix}-output`, 'model', `${prefix}-trainer`, 'model'),
    makeEdge(`${prefix}-loss-trainer`, `${prefix}-loss`, 'loss', `${prefix}-trainer`, 'loss'),
    makeEdge(`${prefix}-optimizer-trainer`, `${prefix}-optimizer`, 'optimizer', `${prefix}-trainer`, 'optimizer'),
    makeEdge(`${prefix}-trainer-evaluate`, `${prefix}-trainer`, 'trained_model', `${prefix}-evaluate`, 'trained_model'),
    makeEdge(`${prefix}-trainer-predict`, `${prefix}-trainer`, 'trained_model', `${prefix}-predict`, 'trained_model'),
  ];
  return { nodes, edges };
};

const mlpRegressionPipeline = (prefix, dataset, { units = [12, 8], epochs = 200, batchSize = 32, learningRate = 0.005, lossNode = 'mse_loss_node', lossParameters = {}, optimizer = 'adam' }) => {
  const featureCount = dataset.featureColumns.length;
  const optimizerNode = optimizer === 'sgd'
    ? makeNode(`${prefix}-optimizer`, 'sgd_optimizer_node', bottomRow(6), { learning_rate: learningRate, momentum: 0.6 })
    : makeNode(`${prefix}-optimizer`, 'adam_optimizer_node', bottomRow(6), { learning_rate: learningRate });
  const nodes = [
    makeNode(`${prefix}-data`, 'tabular_data_node', midRow(0)),
    makeNode(`${prefix}-split`, 'train_test_split_node', midRow(1), { train_ratio: dataset.trainRatio }),
    makeNode(`${prefix}-input`, 'tensor_input_node', topRow(0), { shape: String(featureCount), dtype: 'float32' }),
    makeNode(`${prefix}-hidden1`, 'dense_node', topRow(1), { input_features: featureCount, units: units[0], use_bias: true }),
    makeNode(`${prefix}-tanh1`, 'tanh_node', topRow(2)),
    makeNode(`${prefix}-hidden2`, 'dense_node', topRow(3), { input_features: units[0], units: units[1], use_bias: true }),
    makeNode(`${prefix}-tanh2`, 'tanh_node', topRow(4)),
    makeNode(`${prefix}-head`, 'dense_node', topRow(5), { input_features: units[1], units: 1, use_bias: true }),
    makeNode(`${prefix}-output`, 'model_output_node', topRow(6)),
    makeNode(`${prefix}-loss`, lossNode, bottomRow(5), lossParameters),
    optimizerNode,
    makeNode(`${prefix}-trainer`, 'supervised_trainer_node', midRow(6), { epochs, batch_size: batchSize, shuffle: true }),
    makeNode(`${prefix}-evaluate`, 'evaluate_node', midRow(7)),
  ];
  const edges = [
    makeEdge(`${prefix}-data-split`, `${prefix}-data`, 'dataset', `${prefix}-split`, 'dataset'),
    makeEdge(`${prefix}-input-h1`, `${prefix}-input`, 'tensor', `${prefix}-hidden1`, 'input'),
    makeEdge(`${prefix}-h1-t1`, `${prefix}-hidden1`, 'output', `${prefix}-tanh1`, 'input'),
    makeEdge(`${prefix}-t1-h2`, `${prefix}-tanh1`, 'output', `${prefix}-hidden2`, 'input'),
    makeEdge(`${prefix}-h2-t2`, `${prefix}-hidden2`, 'output', `${prefix}-tanh2`, 'input'),
    makeEdge(`${prefix}-t2-head`, `${prefix}-tanh2`, 'output', `${prefix}-head`, 'input'),
    makeEdge(`${prefix}-head-output`, `${prefix}-head`, 'output', `${prefix}-output`, 'input'),
    makeEdge(`${prefix}-split-trainer`, `${prefix}-split`, 'split', `${prefix}-trainer`, 'dataset'),
    makeEdge(`${prefix}-output-trainer`, `${prefix}-output`, 'model', `${prefix}-trainer`, 'model'),
    makeEdge(`${prefix}-loss-trainer`, `${prefix}-loss`, 'loss', `${prefix}-trainer`, 'loss'),
    makeEdge(`${prefix}-optimizer-trainer`, `${prefix}-optimizer`, 'optimizer', `${prefix}-trainer`, 'optimizer'),
    makeEdge(`${prefix}-trainer-evaluate`, `${prefix}-trainer`, 'trained_model', `${prefix}-evaluate`, 'trained_model'),
  ];
  return { nodes, edges };
};

const cnnArchitecture = () => {
  const nodes = [
    makeNode('cnn-input', 'tensor_input_node', midRow(0), { shape: '784', dtype: 'float32' }),
    makeNode('cnn-reshape', 'reshape_node', midRow(1), { shape: '1,28,28' }),
    makeNode('cnn-block', 'conv_block_node', midRow(2), { input_channels: 1, filters: 8, kernel_size: 3 }),
    makeNode('cnn-flatten', 'flatten_node', midRow(3)),
    makeNode('cnn-head', 'dense_node', midRow(4), { input_features: 128, units: 2, use_bias: true }),
    makeNode('cnn-output', 'model_output_node', midRow(5)),
  ];
  const edges = [
    makeEdge('cnn-input-reshape', 'cnn-input', 'tensor', 'cnn-reshape', 'input'),
    makeEdge('cnn-reshape-block', 'cnn-reshape', 'output', 'cnn-block', 'input'),
    makeEdge('cnn-block-flatten', 'cnn-block', 'output', 'cnn-flatten', 'input'),
    makeEdge('cnn-flatten-head', 'cnn-flatten', 'output', 'cnn-head', 'input'),
    makeEdge('cnn-head-output', 'cnn-head', 'output', 'cnn-output', 'input'),
  ];
  return { nodes, edges };
};

const embeddingArchitecture = () => {
  const nodes = [
    makeNode('emb-user', 'tensor_input_node', { x: X, y: 80 }, { shape: '1', dtype: 'int32' }),
    makeNode('emb-movie', 'tensor_input_node', { x: X, y: 480 }, { shape: '1', dtype: 'int32' }),
    makeNode('emb-user-embed', 'embedding_node', { x: X + STEP, y: 80 }, { vocab_size: 1000, embedding_dim: 32 }),
    makeNode('emb-movie-embed', 'embedding_node', { x: X + STEP, y: 480 }, { vocab_size: 2000, embedding_dim: 32 }),
    makeNode('emb-concat', 'concatenate_node', { x: X + 2 * STEP, y: 300 }, { axis: -1 }),
    makeNode('emb-head', 'dense_node', { x: X + 3 * STEP, y: 300 }, { input_features: 64, units: 1, use_bias: true }),
    makeNode('emb-output', 'model_output_node', { x: X + 4 * STEP, y: 300 }),
  ];
  const edges = [
    makeEdge('emb-user-embed', 'emb-user', 'tensor', 'emb-user-embed', 'input'),
    makeEdge('emb-movie-embed', 'emb-movie', 'tensor', 'emb-movie-embed', 'input'),
    makeEdge('emb-embed-a', 'emb-user-embed', 'output', 'emb-concat', 'a'),
    makeEdge('emb-embed-b', 'emb-movie-embed', 'output', 'emb-concat', 'b'),
    makeEdge('emb-concat-head', 'emb-concat', 'output', 'emb-head', 'input'),
    makeEdge('emb-head-output', 'emb-head', 'output', 'emb-output', 'input'),
  ];
  return { nodes, edges };
};

const sentimentArchitecture = () => {
  const nodes = [
    makeNode('senti-input', 'tensor_input_node', midRow(0), { shape: '12', dtype: 'int32' }),
    makeNode('senti-embed', 'embedding_node', midRow(1), { vocab_size: 5000, embedding_dim: 32 }),
    makeNode('senti-lstm', 'lstm_node', midRow(2), { input_size: 32, hidden_size: 16, layers: 1, bidirectional: false }),
    makeNode('senti-drop', 'dropout_node', midRow(3), { rate: 0.2 }),
    makeNode('senti-head', 'dense_node', midRow(4), { input_features: 16, units: 1, use_bias: true }),
    makeNode('senti-sigmoid', 'sigmoid_node', midRow(5)),
    makeNode('senti-output', 'model_output_node', midRow(6)),
  ];
  const edges = [
    makeEdge('senti-input-embed', 'senti-input', 'tensor', 'senti-embed', 'input'),
    makeEdge('senti-embed-lstm', 'senti-embed', 'output', 'senti-lstm', 'input'),
    makeEdge('senti-lstm-drop', 'senti-lstm', 'output', 'senti-drop', 'input'),
    makeEdge('senti-drop-head', 'senti-drop', 'output', 'senti-head', 'input'),
    makeEdge('senti-head-sigmoid', 'senti-head', 'output', 'senti-sigmoid', 'input'),
    makeEdge('senti-sigmoid-output', 'senti-sigmoid', 'output', 'senti-output', 'input'),
  ];
  return { nodes, edges };
};

const definitions = [
  { id: 'linear-trend-concept', datasetId: 'linear-trend', build: ({ dataset }) => linearPipeline('trend', dataset) },
  { id: 'house-price-applied', datasetId: 'house-price', build: ({ dataset }) => linearPipeline('hp', dataset) },
  { id: 'knn-neighborhood-concept', datasetId: 'knn-neighborhood', build: ({ dataset }) => knnPipeline('moons', dataset) },
  { id: 'iris-applied', datasetId: 'iris', build: ({ dataset }) => knnPipeline('iris', dataset) },
  { id: 'xor-mlp-concept', datasetId: 'xor-mlp-concept', build: ({ dataset }) => mlpClassificationPipeline('xor', dataset, { units: [12, 12], epochs: 500, batchSize: 16, learningRate: 0.05, optimizer: 'sgd' }) },
  { id: 'spam-applied-mlp', datasetId: 'spam', build: ({ dataset }) => mlpClassificationPipeline('spam', dataset, { units: [24, 12], epochs: 400, batchSize: 32, learningRate: 0.05, optimizer: 'sgd' }) },
  { id: 'energy-demand-mlp', datasetId: 'energy', build: ({ dataset }) => mlpRegressionPipeline('en', dataset, { units: [12, 8], epochs: 250, batchSize: 32, learningRate: 0.05, optimizer: 'sgd' }) },
  { id: 'peak-demand-custom-loss', datasetId: 'energy', build: ({ dataset }) => mlpRegressionPipeline('peak', dataset, { units: [12, 8], epochs: 250, batchSize: 32, learningRate: 0.05, optimizer: 'sgd', lossNode: 'custom_loss_node', lossParameters: { expression: 'mean(square(prediction - target) * (1 + exp(clip(target - prediction, 0, 8))))' } }) },
  { id: 'diabetes-risk-mlp', datasetId: 'diabetes', build: ({ dataset }) => {
    const nodes = [
      makeNode('dia-data', 'tabular_data_node', midRow(0)),
      makeNode('dia-split', 'train_test_split_node', midRow(1), { train_ratio: dataset.trainRatio }),
      makeNode('dia-input', 'tensor_input_node', topRow(0), { shape: String(dataset.featureColumns.length), dtype: 'float32' }),
      makeNode('dia-block', 'mlp_block_node', topRow(1), { input_features: dataset.featureColumns.length, hidden_units: 12, dropout: 0.1 }),
      makeNode('dia-residual', 'residual_mlp_block_node', topRow(2), { features: 12 }),
      makeNode('dia-norm', 'layer_norm_node', topRow(3), { normalized_shape: '12' }),
      makeNode('dia-gelu', 'gelu_node', topRow(4)),
      makeNode('dia-head', 'dense_node', topRow(5), { input_features: 12, units: 1, use_bias: true }),
      makeNode('dia-sigmoid', 'sigmoid_node', topRow(6)),
      makeNode('dia-output', 'model_output_node', topRow(7)),
      makeNode('dia-loss', 'binary_cross_entropy_loss_node', bottomRow(6)),
      makeNode('dia-optimizer', 'adam_optimizer_node', bottomRow(7), { learning_rate: 0.005 }),
      makeNode('dia-trainer', 'supervised_trainer_node', midRow(7), { epochs: 200, batch_size: 32, shuffle: true }),
      makeNode('dia-evaluate', 'evaluate_classification_node', midRow(8)),
    ];
    const edges = [
      makeEdge('dia-data-split', 'dia-data', 'dataset', 'dia-split', 'dataset'),
      makeEdge('dia-input-block', 'dia-input', 'tensor', 'dia-block', 'input'),
      makeEdge('dia-block-residual', 'dia-block', 'output', 'dia-residual', 'input'),
      makeEdge('dia-residual-norm', 'dia-residual', 'output', 'dia-norm', 'input'),
      makeEdge('dia-norm-gelu', 'dia-norm', 'output', 'dia-gelu', 'input'),
      makeEdge('dia-gelu-head', 'dia-gelu', 'output', 'dia-head', 'input'),
      makeEdge('dia-head-sigmoid', 'dia-head', 'output', 'dia-sigmoid', 'input'),
      makeEdge('dia-sigmoid-output', 'dia-sigmoid', 'output', 'dia-output', 'input'),
      makeEdge('dia-split-trainer', 'dia-split', 'split', 'dia-trainer', 'dataset'),
      makeEdge('dia-output-trainer', 'dia-output', 'model', 'dia-trainer', 'model'),
      makeEdge('dia-loss-trainer', 'dia-loss', 'loss', 'dia-trainer', 'loss'),
      makeEdge('dia-optimizer-trainer', 'dia-optimizer', 'optimizer', 'dia-trainer', 'optimizer'),
      makeEdge('dia-trainer-evaluate', 'dia-trainer', 'trained_model', 'dia-evaluate', 'trained_model'),
    ];
    return { nodes, edges };
  } },
  { id: 'shape-cnn', build: cnnArchitecture },
  { id: 'user-item-embedding', build: embeddingArchitecture },
  { id: 'sentiment-lstm', build: sentimentArchitecture },
];

const metadataById = new Map(exampleMetadata.map((item) => [item.id, item]));

const failures = [];
const fail = (example, field, actual, expected) => {
  failures.push({ example, field, actual, expected });
};

function validateExample(definition, project) {
  const meta = metadataById.get(definition.id);
  const dataset = project.data;
  const contract = meta.teachingContract ?? {};
  const teaching = definition.datasetId ? teachingDatasetById(definition.datasetId) : null;
  if (definition.datasetId && !teaching) fail(definition.id, 'datasetId', definition.datasetId, 'must exist in teachingDatasets');
  if (meta.role === 'architecture-sketch' && !meta.limitationsKey) fail(definition.id, 'limitationsKey', null, 'required for architecture-sketch');
  if (meta.limitationsKey && !meta.limitationsKey) fail(definition.id, 'limitationsKey', null, 'required when limitations declared');
  if (teaching && teaching.role !== meta.role && meta.role !== 'architecture-sketch') {
    fail(definition.id, 'role', teaching.role, meta.role);
  }
  if (teaching && teaching.pedagogy.concept === 'feature-interactions') {
    const mutationFailures = validateNoPostLabelMutationMetadata(teaching);
    mutationFailures.forEach((item) => fail(definition.id, item.field, item.actual, item.expected));
  }
  const contractFailures = validateExampleTeachingContract(meta, project, null);
  contractFailures.forEach((item) => fail(definition.id, item.field, item.actual, item.expected));
  validateInputShapeAgainstDataset(project.graph.nodes, dataset).forEach((item) => fail(definition.id, item.field, item.actual, item.expected));
}

function runLinearBaseline(dataset) {
  const { nodes, edges } = linearPipeline('baseline', dataset);
  return executeBrowserGraph({ nodes, edges, dataset });
}

async function verifyRunnable(definition, project, meta) {
  const runResult = await executeBrowserGraph({
    nodes: project.graph.nodes,
    edges: project.graph.edges,
    dataset: project.data,
  });
  if (!runResult) {
    fail(definition.id, 'browserRun', null, 'a trained model');
    return { runResult: null };
  }
  const contract = meta.teachingContract ?? {};
  const extra = {};
  if (contract.linearBaselineGap !== undefined) {
    const baseline = await runLinearBaseline(project.data);
    extra.linearBaselineR2 = baseline?.metrics?.r2 ?? null;
  }
  const failures = validateExampleTeachingContract(meta, project, runResult, extra);
  failures.forEach((item) => fail(definition.id, item.field, item.actual, item.expected));
  if (contract.residualNonZero && runResult.metrics?.r2 >= 0.9999) {
    fail(definition.id, 'residualNonZero', runResult.metrics.r2, '< 0.9999');
  }
  if (contract.kSensitivity && project.data) {
    const featureCount = project.data.featureColumns.length;
    const probe = project.data.featureColumns.map((column) => {
      const values = project.data.rows.map((row) => Number(row[column]));
      return (Math.min(...values) + Math.max(...values)) / 2;
    });
    const model = runResult;
    if (!knnProbeChanges(model, probe)) {
      fail(definition.id, 'kSensitivity', 'neighbors unchanged', 'k=1 vs k=5 neighbor sets differ on the midpoint probe');
    }
  }
  return { runResult, linearBaselineR2: extra.linearBaselineR2 ?? null };
}

async function main() {
  mkdirSync(examplesDir, { recursive: true });
  const outputs = [];
  for (const definition of definitions) {
    const meta = metadataById.get(definition.id);
    if (!meta) {
      fail(definition.id, 'metadata', null, 'example metadata must exist');
      continue;
    }
    const teaching = definition.datasetId ? teachingDatasetById(definition.datasetId) : null;
    if (definition.datasetId && !teaching) {
      fail(definition.id, 'datasetId', definition.datasetId, 'must exist in teachingDatasets');
      continue;
    }
    const data = teaching ? teaching.dataset : null;
    const { nodes, edges } = definition.build({ dataset: data });
    const project = buildProject(meta.titleKey, nodes, edges, data);
    try {
      validateProjectForWorkspace(project);
    } catch (error) {
      fail(definition.id, 'projectValidation', error.message, 'valid project');
      continue;
    }
    validateExample(definition, project);
    let runResult = null;
    if (meta.runnable) {
      const verified = await verifyRunnable(definition, project, meta);
      runResult = verified.runResult;
    }
    if (meta.exportable && meta.id !== 'knn-neighborhood-concept' && meta.id !== 'iris-applied') {
      try {
        const pytorch = compilePipelineToPyTorch(nodes, edges);
        const tensorflow = compilePipelineToTensorFlow(nodes, edges);
        assertPythonSyntax(pytorch.code, `${definition.id} PyTorch`);
        assertPythonSyntax(tensorflow.code, `${definition.id} TensorFlow`);
      } catch (error) {
        fail(definition.id, 'export', error.message, 'both frameworks parse');
      }
    }
    outputs.push({ meta, project, runResult });
  }

  if (failures.length) {
    console.error('Example quality failures:');
    for (const failure of failures) {
      console.error(`- ${failure.example}: ${failure.field} actual=${JSON.stringify(failure.actual)} expected=${JSON.stringify(failure.expected)}`);
    }
    process.exit(1);
  }

  if (CHECK_ONLY) {
    let outdated = false;
    for (const { meta, project } of outputs) {
      const file = path.join(examplesDir, meta.file);
      const expected = `${JSON.stringify(project, null, 2)}\n`;
      let existing = null;
      try {
        existing = readFileSync(file, 'utf-8');
      } catch {
        existing = null;
      }
      if (existing !== expected) {
        outdated = true;
        console.error(`- ${meta.file} is missing or out of date (run npm run generate:examples)`);
      }
    }
    if (outdated) process.exit(1);
    console.log(`Examples check passed: ${outputs.length} examples in sync.`);
    return;
  }

  const existingFiles = new Set(readdirSync(examplesDir).filter((name) => name.endsWith('.volkml.json')));
  for (const { meta, project } of outputs) {
    const file = path.join(examplesDir, meta.file);
    writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`);
    existingFiles.delete(meta.file);
  }
  for (const stale of existingFiles) {
    const stalePath = path.join(examplesDir, stale);
    try { readFileSync(stalePath); } catch { continue; }
    const kept = outputs.some(({ meta }) => meta.file === stale);
    if (!kept) {
      console.error(`- removing stale example ${stale}`);
      // Deletion is intentional for renamed examples; run via fs to keep this script self-contained.
      const { rmSync } = await import('node:fs');
      rmSync(stalePath, { force: true });
    }
  }
  console.log(`Generated ${outputs.length} examples in ${examplesDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
