import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { componentById, defaults } from '../src/core/components.js';
import { PROJECT_VERSION, validateProjectForWorkspace } from '../src/core/project.js';
import { compilePipelineToPyTorch, compilePipelineToTensorFlow } from '../src/core/compiler.js';
import { executeBrowserGraph } from '../src/core/browserRuntime.js';
import { sampleDatasets } from '../src/core/sampleDatasets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(__dirname, '../examples');

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

const buildProject = (name, nodes, edges, data = null) => ({
  format: 'VOLK-ML',
  version: PROJECT_VERSION,
  name,
  savedAt: new Date().toISOString(),
  language: { primary: 'en', secondary: 'zh' },
  workspace: { libraryMode: 'detailed', leftWidth: 300, rightWidth: 384, viewMode: 'canvas' },
  graph: { nodes, edges },
  customComponents: [],
  data,
  trainedModel: null,
});

const sampleByName = (name) => {
  const item = sampleDatasets.find((entry) => entry.dataset.name === name);
  if (!item) throw new Error(`Missing sample dataset ${name}`);
  return item.dataset;
};

const X = 40;
const STEP = 340;
const row = (index) => ({ x: X + index * STEP, y: 180 });
const side = (index) => ({ x: X + index * STEP + 90, y: 400 });

const housePriceDataset = () => {
  const rows = Array.from({ length: 90 }, (_, index) => {
    const area = 45 + (index % 30) * 6;
    const bedrooms = 1 + (index % 4);
    const age = index % 25;
    const price = 30 + area * 1.6 + bedrooms * 12 - age * 0.5 + Math.sin(index * 2.1) * 4;
    return {
      area_sqm: Number(area.toFixed(1)),
      bedrooms,
      age_years: age,
      price: Number(price.toFixed(2)),
    };
  });
  return {
    name: 'House Prices',
    task: 'regression',
    rows,
    columns: [
      { name: 'area_sqm', type: 'number', missing: 0 },
      { name: 'bedrooms', type: 'number', missing: 0 },
      { name: 'age_years', type: 'number', missing: 0 },
      { name: 'price', type: 'number', missing: 0 },
    ],
    featureColumns: ['area_sqm', 'bedrooms', 'age_years'],
    targetColumn: 'price',
    trainRatio: 0.8,
  };
};

const diabetesDataset = () => {
  const rows = Array.from({ length: 80 }, (_, index) => {
    const glucose = 70 + (index % 40) * 4;
    const bmi = 18 + (index % 20) * 1.1;
    const age = 25 + (index % 45);
    const risk = glucose > 190 || bmi > 32;
    const label = risk ? 'diabetic' : 'healthy';
    return {
      age: age,
      bmi: Number(bmi.toFixed(1)),
      glucose: glucose,
      blood_pressure: Number((70 + (index % 25) + (risk ? 8 : 0)).toFixed(1)),
      insulin: Number((10 + (index % 60) + (risk ? 40 : 0)).toFixed(1)),
      skin_thickness: Number((10 + (index % 25) + (risk ? 10 : 0)).toFixed(1)),
      label,
    };
  });
  return {
    name: 'Diabetes Risk',
    task: 'classification',
    rows,
    columns: [
      { name: 'age', type: 'number', missing: 0 },
      { name: 'bmi', type: 'number', missing: 0 },
      { name: 'glucose', type: 'number', missing: 0 },
      { name: 'blood_pressure', type: 'number', missing: 0 },
      { name: 'insulin', type: 'number', missing: 0 },
      { name: 'skin_thickness', type: 'number', missing: 0 },
      { name: 'label', type: 'text', missing: 0 },
    ],
    featureColumns: ['age', 'bmi', 'glucose', 'blood_pressure', 'insulin', 'skin_thickness'],
    targetColumn: 'label',
    trainRatio: 0.8,
  };
};

const examples = [];

// 1. House price regression (L0 runnable)
{
  const nodes = [
    makeNode('hp-data', 'tabular_data_node', row(0)),
    makeNode('hp-split', 'train_test_split_node', row(1), { train_ratio: 0.8 }),
    makeNode('hp-linear', 'linear_regression_node', row(2), { learning_rate: 0.05 }),
    makeNode('hp-train', 'gradient_descent_node', row(3), { epochs: 250 }),
    makeNode('hp-evaluate', 'evaluate_node', row(4)),
    makeNode('hp-predict', 'predictor_node', row(5)),
  ];
  const edges = [
    makeEdge('hp-data-split', 'hp-data', 'dataset', 'hp-split', 'dataset'),
    makeEdge('hp-split-linear', 'hp-split', 'split', 'hp-linear', 'split'),
    makeEdge('hp-linear-train', 'hp-linear', 'model', 'hp-train', 'model'),
    makeEdge('hp-train-evaluate', 'hp-train', 'trained_model', 'hp-evaluate', 'trained_model'),
    makeEdge('hp-train-predict', 'hp-train', 'trained_model', 'hp-predict', 'trained_model'),
  ];
  examples.push({ slug: 'house-price-regression', name: 'House Price Prediction', nodes, edges, data: housePriceDataset(), runnable: true });
}

// 2. Iris KNN classification (L0 runnable)
{
  const nodes = [
    makeNode('iris-data', 'tabular_data_node', row(0)),
    makeNode('iris-knn', 'knn_node', row(1), { k_value: 3, train_ratio: 0.8 }),
    makeNode('iris-evaluate', 'evaluate_classification_node', row(2)),
    makeNode('iris-predict', 'predictor_node', row(3)),
  ];
  const edges = [
    makeEdge('iris-data-knn', 'iris-data', 'dataset', 'iris-knn', 'dataset'),
    makeEdge('iris-knn-evaluate', 'iris-knn', 'trained_model', 'iris-evaluate', 'trained_model'),
    makeEdge('iris-knn-predict', 'iris-knn', 'trained_model', 'iris-predict', 'trained_model'),
  ];
  examples.push({ slug: 'iris-knn-classification', name: 'Iris Flower Classification (KNN)', nodes, edges, data: sampleByName('Iris Flowers'), runnable: true, exportable: false });
}

// 3. Spam detection with a small MLP (L0 runnable)
{
  const nodes = [
    makeNode('spam-data', 'tabular_data_node', row(0)),
    makeNode('spam-split', 'train_test_split_node', row(1), { train_ratio: 0.8 }),
    makeNode('spam-input', 'tensor_input_node', side(1), { shape: '2', dtype: 'float32' }),
    makeNode('spam-hidden', 'dense_node', side(2), { input_features: 2, units: 6, use_bias: true }),
    makeNode('spam-relu', 'relu_node', side(3)),
    makeNode('spam-head', 'dense_node', side(4), { input_features: 6, units: 2, use_bias: true }),
    makeNode('spam-softmax', 'softmax_node', side(5)),
    makeNode('spam-output', 'model_output_node', side(6)),
    makeNode('spam-loss', 'cross_entropy_loss_node', { x: X + 4 * STEP, y: 500 }),
    makeNode('spam-optimizer', 'sgd_optimizer_node', { x: X + 5 * STEP, y: 500 }, { learning_rate: 0.08, momentum: 0 }),
    makeNode('spam-trainer', 'supervised_trainer_node', row(4), { epochs: 120, batch_size: 16, shuffle: true }),
    makeNode('spam-evaluate', 'evaluate_classification_node', row(5)),
    makeNode('spam-predict', 'predictor_node', row(6)),
  ];
  const edges = [
    makeEdge('spam-data-split', 'spam-data', 'dataset', 'spam-split', 'dataset'),
    makeEdge('spam-input-hidden', 'spam-input', 'tensor', 'spam-hidden', 'input'),
    makeEdge('spam-hidden-relu', 'spam-hidden', 'output', 'spam-relu', 'input'),
    makeEdge('spam-relu-head', 'spam-relu', 'output', 'spam-head', 'input'),
    makeEdge('spam-head-softmax', 'spam-head', 'output', 'spam-softmax', 'input'),
    makeEdge('spam-softmax-output', 'spam-softmax', 'output', 'spam-output', 'input'),
    makeEdge('spam-split-trainer', 'spam-split', 'split', 'spam-trainer', 'dataset'),
    makeEdge('spam-output-trainer', 'spam-output', 'model', 'spam-trainer', 'model'),
    makeEdge('spam-loss-trainer', 'spam-loss', 'loss', 'spam-trainer', 'loss'),
    makeEdge('spam-optimizer-trainer', 'spam-optimizer', 'optimizer', 'spam-trainer', 'optimizer'),
    makeEdge('spam-trainer-evaluate', 'spam-trainer', 'trained_model', 'spam-evaluate', 'trained_model'),
    makeEdge('spam-trainer-predict', 'spam-trainer', 'trained_model', 'spam-predict', 'trained_model'),
  ];
  examples.push({ slug: 'spam-mlp-classification', name: 'Spam Detection (MLP)', nodes, edges, data: sampleByName('Email Spam'), runnable: true });
}

// 4. Energy demand MLP with a custom loss (export)
{
  const nodes = [
    makeNode('en-data', 'tabular_data_node', row(0)),
    makeNode('en-split', 'train_test_split_node', row(1), { train_ratio: 0.8 }),
    makeNode('en-input', 'tensor_input_node', side(1), { shape: '2', dtype: 'float32' }),
    makeNode('en-hidden', 'dense_node', side(2), { input_features: 2, units: 8, use_bias: true }),
    makeNode('en-head', 'dense_node', side(3), { input_features: 8, units: 1, use_bias: true }),
    makeNode('en-output', 'model_output_node', side(4)),
    makeNode('en-loss', 'custom_loss_node', { x: X + 4 * STEP, y: 500 }, { expression: 'mean(square(prediction - target))' }),
    makeNode('en-optimizer', 'adamw_optimizer_node', { x: X + 5 * STEP, y: 500 }, { learning_rate: 0.001, weight_decay: 0.01 }),
    makeNode('en-trainer', 'supervised_trainer_node', row(4), { epochs: 200, batch_size: 16, shuffle: true }),
    makeNode('en-evaluate', 'evaluate_node', row(5)),
  ];
  const edges = [
    makeEdge('en-data-split', 'en-data', 'dataset', 'en-split', 'dataset'),
    makeEdge('en-input-hidden', 'en-input', 'tensor', 'en-hidden', 'input'),
    makeEdge('en-hidden-head', 'en-hidden', 'output', 'en-head', 'input'),
    makeEdge('en-head-output', 'en-head', 'output', 'en-output', 'input'),
    makeEdge('en-split-trainer', 'en-split', 'split', 'en-trainer', 'dataset'),
    makeEdge('en-output-trainer', 'en-output', 'model', 'en-trainer', 'model'),
    makeEdge('en-loss-trainer', 'en-loss', 'loss', 'en-trainer', 'loss'),
    makeEdge('en-optimizer-trainer', 'en-optimizer', 'optimizer', 'en-trainer', 'optimizer'),
    makeEdge('en-trainer-evaluate', 'en-trainer', 'trained_model', 'en-evaluate', 'trained_model'),
  ];
  examples.push({ slug: 'energy-demand-mlp', name: 'Energy Demand Forecasting (MLP + Custom Loss)', nodes, edges, data: sampleByName('Energy Demand'), runnable: false });
}

// 5. Diabetes risk with residual MLP blocks (export)
{
  const nodes = [
    makeNode('dia-data', 'tabular_data_node', row(0)),
    makeNode('dia-split', 'train_test_split_node', row(1), { train_ratio: 0.8 }),
    makeNode('dia-input', 'tensor_input_node', side(1), { shape: '6', dtype: 'float32' }),
    makeNode('dia-block', 'mlp_block_node', side(2), { input_features: 6, hidden_units: 12, dropout: 0.1 }),
    makeNode('dia-residual', 'residual_mlp_block_node', side(3), { features: 12 }),
    makeNode('dia-norm', 'layer_norm_node', side(4), { normalized_shape: '12' }),
    makeNode('dia-gelu', 'gelu_node', side(5)),
    makeNode('dia-head', 'dense_node', side(6), { input_features: 12, units: 1, use_bias: true }),
    makeNode('dia-sigmoid', 'sigmoid_node', side(7)),
    makeNode('dia-output', 'model_output_node', side(8)),
    makeNode('dia-loss', 'binary_cross_entropy_loss_node', { x: X + 7 * STEP, y: 520 }),
    makeNode('dia-optimizer', 'adam_optimizer_node', { x: X + 8 * STEP, y: 520 }, { learning_rate: 0.005 }),
    makeNode('dia-trainer', 'supervised_trainer_node', row(5), { epochs: 150, batch_size: 16, shuffle: true }),
    makeNode('dia-evaluate', 'evaluate_classification_node', row(6)),
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
  examples.push({ slug: 'diabetes-risk-mlp', name: 'Diabetes Risk Prediction (Residual MLP)', nodes, edges, data: diabetesDataset(), runnable: false });
}

// 6. Cat vs dog CNN architecture (export-only until image data support)
{
  const nodes = [
    makeNode('cnn-input', 'tensor_input_node', row(0), { shape: '784', dtype: 'float32' }),
    makeNode('cnn-reshape', 'reshape_node', row(1), { shape: '1,28,28' }),
    makeNode('cnn-block', 'conv_block_node', row(2), { input_channels: 1, filters: 8, kernel_size: 3 }),
    makeNode('cnn-flatten', 'flatten_node', row(3)),
    makeNode('cnn-head', 'dense_node', row(4), { input_features: 128, units: 2, use_bias: true }),
    makeNode('cnn-output', 'model_output_node', row(5)),
  ];
  const edges = [
    makeEdge('cnn-input-reshape', 'cnn-input', 'tensor', 'cnn-reshape', 'input'),
    makeEdge('cnn-reshape-block', 'cnn-reshape', 'output', 'cnn-block', 'input'),
    makeEdge('cnn-block-flatten', 'cnn-block', 'output', 'cnn-flatten', 'input'),
    makeEdge('cnn-flatten-head', 'cnn-flatten', 'output', 'cnn-head', 'input'),
    makeEdge('cnn-head-output', 'cnn-head', 'output', 'cnn-output', 'input'),
  ];
  examples.push({ slug: 'cat-dog-cnn', name: 'Cat vs Dog Image Classification (CNN)', nodes, edges, data: null, runnable: false });
}

// 7. Movie recommendation with embeddings (export-only)
{
  const nodes = [
    makeNode('mov-user', 'tensor_input_node', { x: X, y: 120 }, { shape: '1', dtype: 'int32' }),
    makeNode('mov-movie', 'tensor_input_node', { x: X, y: 360 }, { shape: '1', dtype: 'int32' }),
    makeNode('mov-user-embed', 'embedding_node', row(1), { vocab_size: 1000, embedding_dim: 32 }),
    makeNode('mov-movie-embed', 'embedding_node', { x: X + STEP, y: 360 }, { vocab_size: 2000, embedding_dim: 32 }),
    makeNode('mov-concat', 'concatenate_node', row(2), { axis: -1 }),
    makeNode('mov-head', 'dense_node', row(3), { input_features: 64, units: 1, use_bias: true }),
    makeNode('mov-output', 'model_output_node', row(4)),
  ];
  const edges = [
    makeEdge('mov-user-embed', 'mov-user', 'tensor', 'mov-user-embed', 'input'),
    makeEdge('mov-movie-embed', 'mov-movie', 'tensor', 'mov-movie-embed', 'input'),
    makeEdge('mov-embed-a', 'mov-user-embed', 'output', 'mov-concat', 'a'),
    makeEdge('mov-embed-b', 'mov-movie-embed', 'output', 'mov-concat', 'b'),
    makeEdge('mov-concat-head', 'mov-concat', 'output', 'mov-head', 'input'),
    makeEdge('mov-head-output', 'mov-head', 'output', 'mov-output', 'input'),
  ];
  examples.push({ slug: 'movie-recommendation', name: 'Movie Recommendation (Embedding)', nodes, edges, data: null, runnable: false });
}

// 8. Sentiment analysis with an LSTM (export-only)
{
  const nodes = [
    makeNode('senti-input', 'tensor_input_node', row(0), { shape: '12', dtype: 'int32' }),
    makeNode('senti-embed', 'embedding_node', row(1), { vocab_size: 5000, embedding_dim: 32 }),
    makeNode('senti-lstm', 'lstm_node', row(2), { input_size: 32, hidden_size: 16, layers: 1, bidirectional: false }),
    makeNode('senti-drop', 'dropout_node', row(3), { rate: 0.2 }),
    makeNode('senti-head', 'dense_node', row(4), { input_features: 16, units: 1, use_bias: true }),
    makeNode('senti-tanh', 'tanh_node', row(5)),
    makeNode('senti-output', 'model_output_node', row(6)),
  ];
  const edges = [
    makeEdge('senti-input-embed', 'senti-input', 'tensor', 'senti-embed', 'input'),
    makeEdge('senti-embed-lstm', 'senti-embed', 'output', 'senti-lstm', 'input'),
    makeEdge('senti-lstm-drop', 'senti-lstm', 'output', 'senti-drop', 'input'),
    makeEdge('senti-drop-head', 'senti-drop', 'output', 'senti-head', 'input'),
    makeEdge('senti-head-tanh', 'senti-head', 'output', 'senti-tanh', 'input'),
    makeEdge('senti-tanh-output', 'senti-tanh', 'output', 'senti-output', 'input'),
  ];
  examples.push({ slug: 'sentiment-lstm', name: 'Sentiment Analysis (LSTM)', nodes, edges, data: null, runnable: false });
}

const assertPythonSyntax = (code, label) => {
  const python = ['python3', 'python'].find((candidate) => spawnSync(candidate, ['--version'], { encoding: 'utf-8' }).status === 0) ?? 'python3';
  const result = spawnSync(python, ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], { input: code, encoding: 'utf-8' });
  if (result.status !== 0) throw new Error(`${label} generated invalid Python:\n${result.stderr}`);
};

mkdirSync(examplesDir, { recursive: true });
for (const example of examples) {
  const project = buildProject(example.name, example.nodes, example.edges, example.data);
  validateProjectForWorkspace(project);
  const file = path.join(examplesDir, `${example.slug}.volkml.json`);
  writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`);
  if (example.exportable !== false) {
    const pytorch = compilePipelineToPyTorch(example.nodes, example.edges);
    const tensorflow = compilePipelineToTensorFlow(example.nodes, example.edges);
    assertPythonSyntax(pytorch.code, `${example.slug} PyTorch`);
    assertPythonSyntax(tensorflow.code, `${example.slug} TensorFlow`);
  }
  if (example.runnable) {
    const result = await executeBrowserGraph({ nodes: example.nodes, edges: example.edges, dataset: example.data });
    if (!result) throw new Error(`${example.slug} did not produce a trained model.`);
    console.log(`${example.slug}: ${example.exportable === false ? 'export skipped (KNN is browser-only)' : 'export ok'}, run ok (${result.type})`);
  } else {
    console.log(`${example.slug}: export ok`);
  }
}
console.log(`Generated ${examples.length} examples in ${examplesDir}`);
