import { componentById } from '../components.js';
import { createAgentNode, connectAgentNodes } from '../canvasAgent.js';
import { BUILD_BLUEPRINT_IDS } from './modelDesignPlan.js';
import { assertJsonSafe, cloneJson, failBuildAgent } from './contracts.js';

const BLUEPRINTS = Object.freeze({
  [BUILD_BLUEPRINT_IDS.regressionLinear]: {
    id: BUILD_BLUEPRINT_IDS.regressionLinear,
    task: 'regression', modelFamily: 'linear-regression', architecture: 'baseline',
  },
  [BUILD_BLUEPRINT_IDS.classificationKnn]: {
    id: BUILD_BLUEPRINT_IDS.classificationKnn,
    task: 'classification', modelFamily: 'knn', architecture: 'baseline',
  },
  [BUILD_BLUEPRINT_IDS.regressionMlp]: {
    id: BUILD_BLUEPRINT_IDS.regressionMlp,
    task: 'regression', modelFamily: 'mlp', architecture: 'explicit-mlp',
  },
  [BUILD_BLUEPRINT_IDS.classificationMlp]: {
    id: BUILD_BLUEPRINT_IDS.classificationMlp,
    task: 'classification', modelFamily: 'mlp', architecture: 'explicit-mlp',
  },
});

function add(nodes, componentId, id, x, y, parameters = {}) {
  const manifest = componentById.get(componentId);
  if (!manifest) failBuildAgent('BUILD_BLUEPRINT_INVALID', `Unknown component ${componentId}.`, { componentId });
  return [...nodes, createAgentNode({
    nodes,
    manifest,
    request: { id, position: { x, y }, parameters },
  })];
}

function link(nodes, edges, id, source, sourceHandle, target, targetHandle) {
  return connectAgentNodes(nodes, edges, { id, source, sourceHandle, target, targetHandle });
}

function baseContext(plan, datasetContext) {
  const featureCount = plan.dataset.featureCount ?? datasetContext?.featureColumns?.length;
  if (!Number.isInteger(featureCount) || featureCount < 1) failBuildAgent('BUILD_BLUEPRINT_INVALID', 'A feature count is required.');
  return {
    featureCount,
    classCount: plan.dataset.classCount ?? datasetContext?.classCount ?? null,
    training: plan.training ?? {},
  };
}

function linearBlueprint(plan, datasetContext) {
  const { training } = baseContext(plan, datasetContext);
  let nodes = [];
  nodes = add(nodes, 'tabular_data_node', 'build-data', 80, 180);
  nodes = add(nodes, 'train_test_split_node', 'build-split', 300, 180, { train_ratio: training.trainRatio ?? 0.8 });
  nodes = add(nodes, 'linear_regression_node', 'build-linear', 520, 180, { learning_rate: 0.05 });
  nodes = add(nodes, 'gradient_descent_node', 'build-trainer', 740, 180, { epochs: training.epochs ?? 200 });
  nodes = add(nodes, 'evaluate_node', 'build-evaluate', 960, 130);
  nodes = add(nodes, 'predictor_node', 'build-predictor', 960, 250);
  let edges = [];
  edges = link(nodes, edges, 'build-edge-data-split', 'build-data', 'dataset', 'build-split', 'dataset');
  edges = link(nodes, edges, 'build-edge-split-linear', 'build-split', 'split', 'build-linear', 'split');
  edges = link(nodes, edges, 'build-edge-linear-trainer', 'build-linear', 'model', 'build-trainer', 'model');
  edges = link(nodes, edges, 'build-edge-trainer-evaluate', 'build-trainer', 'trained_model', 'build-evaluate', 'trained_model');
  edges = link(nodes, edges, 'build-edge-trainer-predictor', 'build-trainer', 'trained_model', 'build-predictor', 'trained_model');
  return { nodes, edges };
}

function knnBlueprint(plan, datasetContext) {
  const { training } = baseContext(plan, datasetContext);
  let nodes = [];
  nodes = add(nodes, 'tabular_data_node', 'build-data', 80, 180);
  nodes = add(nodes, 'knn_node', 'build-knn', 360, 180, { k_value: 3, train_ratio: training.trainRatio ?? 0.8 });
  nodes = add(nodes, 'evaluate_classification_node', 'build-evaluate', 640, 120);
  nodes = add(nodes, 'predictor_node', 'build-predictor', 640, 250);
  let edges = [];
  edges = link(nodes, edges, 'build-edge-data-knn', 'build-data', 'dataset', 'build-knn', 'dataset');
  edges = link(nodes, edges, 'build-edge-knn-evaluate', 'build-knn', 'trained_model', 'build-evaluate', 'trained_model');
  edges = link(nodes, edges, 'build-edge-knn-predictor', 'build-knn', 'trained_model', 'build-predictor', 'trained_model');
  return { nodes, edges };
}

function mlpBlueprint(plan, datasetContext) {
  const { featureCount, classCount, training } = baseContext(plan, datasetContext);
  const classification = plan.task === 'classification';
  if (classification && (!Number.isInteger(classCount) || classCount < 2)) failBuildAgent('BUILD_BLUEPRINT_INVALID', 'MLP classification requires classCount.');
  const hiddenUnits = training.hiddenUnits ?? 6;
  const outputUnits = classification ? classCount : 1;
  let nodes = [];
  nodes = add(nodes, 'tabular_data_node', 'build-data', 40, 220);
  nodes = add(nodes, 'train_test_split_node', 'build-split', 230, 220, { train_ratio: training.trainRatio ?? 0.8 });
  nodes = add(nodes, 'tensor_input_node', 'build-input', 230, 40, { shape: String(featureCount), dtype: 'float32' });
  nodes = add(nodes, 'dense_node', 'build-hidden', 460, 40, { input_features: featureCount, units: hiddenUnits, use_bias: true });
  nodes = add(nodes, 'relu_node', 'build-relu', 680, 40);
  nodes = add(nodes, 'dense_node', 'build-head', 900, 40, { input_features: hiddenUnits, units: outputUnits, use_bias: true });
  if (classification) nodes = add(nodes, 'softmax_node', 'build-softmax', 1120, 40, { axis: -1 });
  nodes = add(nodes, 'model_output_node', 'build-output', classification ? 1340 : 1120, 40);
  nodes = add(nodes, classification ? 'cross_entropy_loss_node' : 'mse_loss_node', 'build-loss', 660, 300);
  nodes = add(nodes, 'sgd_optimizer_node', 'build-optimizer', 880, 300, { learning_rate: classification ? 0.08 : 0.05, momentum: classification ? 0 : 0.6 });
  nodes = add(nodes, 'supervised_trainer_node', 'build-trainer', 1120, 220, { epochs: training.epochs ?? (classification ? 120 : 250), batch_size: training.batchSize ?? (classification ? 16 : 10), shuffle: training.shuffle ?? true });
  nodes = add(nodes, classification ? 'evaluate_classification_node' : 'evaluate_node', 'build-evaluate', 1390, 180);
  nodes = add(nodes, 'predictor_node', 'build-predictor', 1390, 300);
  let edges = [];
  edges = link(nodes, edges, 'build-edge-data-split', 'build-data', 'dataset', 'build-split', 'dataset');
  edges = link(nodes, edges, 'build-edge-input-hidden', 'build-input', 'tensor', 'build-hidden', 'input');
  edges = link(nodes, edges, 'build-edge-hidden-relu', 'build-hidden', 'output', 'build-relu', 'input');
  edges = link(nodes, edges, 'build-edge-relu-head', 'build-relu', 'output', 'build-head', 'input');
  if (classification) {
    edges = link(nodes, edges, 'build-edge-head-softmax', 'build-head', 'output', 'build-softmax', 'input');
    edges = link(nodes, edges, 'build-edge-softmax-output', 'build-softmax', 'output', 'build-output', 'input');
  } else {
    edges = link(nodes, edges, 'build-edge-head-output', 'build-head', 'output', 'build-output', 'input');
  }
  edges = link(nodes, edges, 'build-edge-split-trainer', 'build-split', 'split', 'build-trainer', 'dataset');
  edges = link(nodes, edges, 'build-edge-output-trainer', 'build-output', 'model', 'build-trainer', 'model');
  edges = link(nodes, edges, 'build-edge-loss-trainer', 'build-loss', 'loss', 'build-trainer', 'loss');
  edges = link(nodes, edges, 'build-edge-optimizer-trainer', 'build-optimizer', 'optimizer', 'build-trainer', 'optimizer');
  edges = link(nodes, edges, 'build-edge-trainer-evaluate', 'build-trainer', 'trained_model', 'build-evaluate', 'trained_model');
  edges = link(nodes, edges, 'build-edge-trainer-predictor', 'build-trainer', 'trained_model', 'build-predictor', 'trained_model');
  return { nodes, edges };
}

export const BUILD_BLUEPRINTS = BLUEPRINTS;

export function listBuildBlueprints() {
  return Object.values(BLUEPRINTS).map((blueprint) => cloneJson(blueprint));
}

export function materializeBuildBlueprint({ blueprintId, plan, datasetContext }) {
  const blueprint = BLUEPRINTS[blueprintId];
  if (!blueprint || !plan || plan.blueprintId !== blueprintId) failBuildAgent('BUILD_BLUEPRINT_INVALID', 'Blueprint and plan do not match.', { blueprintId });
  if (plan.task !== blueprint.task || plan.modelFamily !== blueprint.modelFamily) failBuildAgent('BUILD_BLUEPRINT_INVALID', 'Plan task or model family does not match blueprint.', { blueprintId });
  const graph = blueprint.modelFamily === 'linear-regression'
    ? linearBlueprint(plan, datasetContext)
    : blueprint.modelFamily === 'knn'
      ? knnBlueprint(plan, datasetContext)
      : mlpBlueprint(plan, datasetContext);
  const result = { blueprintId, nodes: graph.nodes, edges: graph.edges };
  assertJsonSafe(result, 'BUILD_BLUEPRINT_INVALID');
  return structuredClone(result);
}
