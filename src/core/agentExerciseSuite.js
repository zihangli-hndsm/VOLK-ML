const exerciseIrisRows = [
  [5.1, 3.5, 1.4, 0.2, 'setosa'], [4.9, 3.0, 1.4, 0.2, 'setosa'],
  [4.7, 3.2, 1.3, 0.2, 'setosa'], [4.6, 3.1, 1.5, 0.2, 'setosa'],
  [5.0, 3.6, 1.4, 0.2, 'setosa'], [5.4, 3.9, 1.7, 0.4, 'setosa'],
  [7.0, 3.2, 4.7, 1.4, 'versicolor'], [6.4, 3.2, 4.5, 1.5, 'versicolor'],
  [6.9, 3.1, 4.9, 1.5, 'versicolor'], [5.5, 2.3, 4.0, 1.3, 'versicolor'],
  [6.5, 2.8, 4.6, 1.5, 'versicolor'], [5.7, 2.8, 4.5, 1.3, 'versicolor'],
  [6.3, 3.3, 6.0, 2.5, 'virginica'], [5.8, 2.7, 5.1, 1.9, 'virginica'],
  [7.1, 3.0, 5.9, 2.1, 'virginica'], [6.3, 2.9, 5.6, 1.8, 'virginica'],
  [6.5, 3.0, 5.8, 2.2, 'virginica'], [7.6, 3.0, 6.6, 2.1, 'virginica'],
].map(([sepal_length, sepal_width, petal_length, petal_width, species]) => ({
  sepal_length, sepal_width, petal_length, petal_width, species,
}));

const exerciseWineRows = Array.from({ length: 24 }, (_, index) => {
  const alcohol = 8.4 + index * 0.11;
  const sulphates = 0.42 + (index % 5) * 0.06;
  const acidity = 5.8 + (index % 4) * 0.35;
  return {
    alcohol: Number(alcohol.toFixed(2)),
    sulphates: Number(sulphates.toFixed(2)),
    acidity: Number(acidity.toFixed(2)),
    quality: Number((1.4 + alcohol * 0.42 + sulphates * 1.7 - acidity * 0.09).toFixed(3)),
  };
});

const exerciseMlpRows = Array.from({ length: 60 }, (_, index) => {
  const positive = index % 2 === 0;
  const offset = Math.floor(index / 2) * 0.015;
  return { feature_a: (positive ? 3 : -3) + offset, feature_b: (positive ? 2 : -2) - offset, label: positive ? 'positive' : 'negative' };
});

const exerciseMlpRegressionRows = Array.from({ length: 80 }, (_, index) => {
  const feature_a = (index % 10) - 5;
  const feature_b = Math.floor(index / 10) - 4;
  return { feature_a, feature_b, target: 1.5 * feature_a - 2 * feature_b + 0.5 };
});

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectCode(operation, expectedCode) {
  try {
    await operation();
  } catch (error) {
    check(error?.code === expectedCode, `Expected ${expectedCode}, received ${error?.code ?? error?.message}`);
    return;
  }
  throw new Error(`Expected ${expectedCode}, but the operation succeeded.`);
}

function emptyProject(project) {
  return {
    ...project,
    graph: { nodes: [], edges: [] },
    customComponents: [],
    data: null,
    trainedModel: null,
  };
}

async function add(canvas, componentId, id, parameters = {}) {
  await canvas.addNode({ componentId, id, position: { x: 100, y: 100 }, parameters });
  return id;
}

async function connect(canvas, source, sourceHandle, target, targetHandle) {
  return canvas.connect({ source, sourceHandle, target, targetHandle });
}

function publishResult(target, result) {
  target.__VOLK_ML_AGENT_TEST_RESULT__ = result;
  let output = target.document.getElementById('volk-ml-agent-test-result');
  if (!output) {
    output = target.document.createElement('output');
    output.id = 'volk-ml-agent-test-result';
    output.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:99999;max-width:420px;padding:10px 14px;border-radius:10px;background:#0f172a;color:#f8fafc;font:12px ui-monospace,monospace;box-shadow:0 8px 20px #0004';
    target.document.body.append(output);
  }
  const detail = result.error ? ` 鈥?${result.error.code}: ${result.error.message}` : '';
  output.textContent = `Canvas Agent exercises: ${result.status} (${result.cases.length} cases)${detail}`;
}

async function testRegistry(canvas, components) {
  for (const component of components) {
    const id = `coverage-${component.id}`;
    await add(canvas, component.id, id);
    const node = canvas.getState().canvas.nodes.find((item) => item.id === id);
    check(node?.componentId === component.id, `${component.id} did not create through the Agent API.`);
    for (const property of component.properties) {
      await canvas.updateNode(id, { parameters: { [property.key]: property.default } });
    }
    await canvas.removeNode(id);
  }
}

async function testIrisKnn(canvas) {
  await canvas.setDataset({
    name: 'UCI Iris exercise subset',
    task: 'classification',
    rows: exerciseIrisRows,
    featureColumns: ['sepal_length', 'sepal_width', 'petal_length', 'petal_width'],
    targetColumn: 'species',
  });
  await add(canvas, 'tabular_data_node', 'iris-data');
  await add(canvas, 'knn_node', 'iris-knn', { k_value: 3, train_ratio: 0.8 });
  await add(canvas, 'evaluate_classification_node', 'iris-evaluate');
  await add(canvas, 'predictor_node', 'iris-predictor');
  await connect(canvas, 'iris-data', 'dataset', 'iris-knn', 'dataset');
  await connect(canvas, 'iris-knn', 'trained_model', 'iris-evaluate', 'trained_model');
  await connect(canvas, 'iris-knn', 'trained_model', 'iris-predictor', 'trained_model');
  await expectCode(
    () => connect(canvas, 'iris-data', 'dataset', 'iris-evaluate', 'trained_model'),
    'INVALID_CONNECTION',
  );
  await canvas.run();
  const state = canvas.getState();
  check(state.execution.runtime.status === 'succeeded', 'Iris KNN did not finish successfully.');
  check(state.execution.runtime.result?.metrics?.accuracy >= 0.65, 'Iris KNN accuracy is below the accepted exercise baseline.');
  await expectCode(() => canvas.updateNode('iris-knn', { parameters: { k_value: 4 } }), 'INVALID_PARAMETER');
  await canvas.updateNode('iris-knn', { position: { x: 360, y: 180 } });
  check(canvas.getState().execution.runtime.status === 'succeeded', 'Layout-only updates must preserve a completed run.');
}

async function testWineRegression(canvas) {
  await canvas.setDataset({
    name: 'Wine quality regression exercise subset',
    task: 'regression',
    rows: exerciseWineRows,
    featureColumns: ['alcohol', 'sulphates', 'acidity'],
    targetColumn: 'quality',
  });
  await add(canvas, 'tabular_data_node', 'wine-data');
  await add(canvas, 'train_test_split_node', 'wine-split', { train_ratio: 0.8 });
  await add(canvas, 'linear_regression_node', 'wine-linear', { learning_rate: 0.05 });
  await add(canvas, 'gradient_descent_node', 'wine-train', { epochs: 200 });
  await add(canvas, 'evaluate_node', 'wine-evaluate');
  await connect(canvas, 'wine-data', 'dataset', 'wine-split', 'dataset');
  await connect(canvas, 'wine-split', 'split', 'wine-linear', 'split');
  await connect(canvas, 'wine-linear', 'model', 'wine-train', 'model');
  await connect(canvas, 'wine-train', 'trained_model', 'wine-evaluate', 'trained_model');
  await canvas.run();
  const state = canvas.getState();
  check(state.execution.runtime.status === 'succeeded', 'Wine regression did not finish successfully.');
  check(state.execution.runtime.result?.metrics?.r2 >= 0.98, 'Wine regression R虏 is below the accepted exercise baseline.');
}

async function testBrowserMlp(canvas) {
  await canvas.setDataset({
    name: 'Small MLP classification exercise', task: 'classification', rows: exerciseMlpRows,
    featureColumns: ['feature_a', 'feature_b'], targetColumn: 'label',
  });
  await add(canvas, 'tabular_data_node', 'mlp-data');
  await add(canvas, 'train_test_split_node', 'mlp-split', { train_ratio: 0.8 });
  await add(canvas, 'tensor_input_node', 'mlp-input', { shape: '2', dtype: 'float32' });
  await add(canvas, 'dense_node', 'mlp-hidden', { input_features: 2, units: 6, use_bias: true });
  await add(canvas, 'relu_node', 'mlp-relu');
  await add(canvas, 'dense_node', 'mlp-head', { input_features: 6, units: 2, use_bias: true });
  await add(canvas, 'softmax_node', 'mlp-softmax');
  await add(canvas, 'model_output_node', 'mlp-output');
  await add(canvas, 'cross_entropy_loss_node', 'mlp-loss');
  await add(canvas, 'sgd_optimizer_node', 'mlp-optimizer', { learning_rate: 0.08, momentum: 0 });
  await add(canvas, 'supervised_trainer_node', 'mlp-trainer', { epochs: 120, batch_size: 16, shuffle: true });
  await add(canvas, 'evaluate_classification_node', 'mlp-evaluate');
  await connect(canvas, 'mlp-data', 'dataset', 'mlp-split', 'dataset');
  await connect(canvas, 'mlp-input', 'tensor', 'mlp-hidden', 'input');
  await connect(canvas, 'mlp-hidden', 'output', 'mlp-relu', 'input');
  await connect(canvas, 'mlp-relu', 'output', 'mlp-head', 'input');
  await connect(canvas, 'mlp-head', 'output', 'mlp-softmax', 'input');
  await connect(canvas, 'mlp-softmax', 'output', 'mlp-output', 'input');
  await connect(canvas, 'mlp-split', 'split', 'mlp-trainer', 'dataset');
  await connect(canvas, 'mlp-output', 'model', 'mlp-trainer', 'model');
  await connect(canvas, 'mlp-loss', 'loss', 'mlp-trainer', 'loss');
  await connect(canvas, 'mlp-optimizer', 'optimizer', 'mlp-trainer', 'optimizer');
  await connect(canvas, 'mlp-trainer', 'trained_model', 'mlp-evaluate', 'trained_model');
  await canvas.run();
  const state = canvas.getState();
  check(state.execution.recommendation.canRunHere, 'Small MLP should be recommended for browser execution.');
  check(state.execution.runtime.status === 'succeeded', 'Small MLP did not finish successfully.');
  check(state.execution.runtime.result?.metrics?.accuracy >= 0.9, 'Small MLP accuracy is below the accepted exercise baseline.');
}

async function testBrowserMlpRegression(canvas) {
  await canvas.setDataset({
    name: 'Small MLP regression exercise', task: 'regression', rows: exerciseMlpRegressionRows,
    featureColumns: ['feature_a', 'feature_b'], targetColumn: 'target',
  });
  await add(canvas, 'tabular_data_node', 'mlp-reg-data');
  await add(canvas, 'train_test_split_node', 'mlp-reg-split', { train_ratio: 0.8 });
  await add(canvas, 'tensor_input_node', 'mlp-reg-input', { shape: '2', dtype: 'float32' });
  await add(canvas, 'dense_node', 'mlp-reg-head', { input_features: 2, units: 1, use_bias: true });
  await add(canvas, 'model_output_node', 'mlp-reg-output');
  await add(canvas, 'mse_loss_node', 'mlp-reg-loss');
  await add(canvas, 'sgd_optimizer_node', 'mlp-reg-optimizer', { learning_rate: 0.05, momentum: 0.6 });
  await add(canvas, 'supervised_trainer_node', 'mlp-reg-trainer', { epochs: 250, batch_size: 10, shuffle: true });
  await add(canvas, 'evaluate_node', 'mlp-reg-evaluate');
  await connect(canvas, 'mlp-reg-data', 'dataset', 'mlp-reg-split', 'dataset');
  await connect(canvas, 'mlp-reg-input', 'tensor', 'mlp-reg-head', 'input');
  await connect(canvas, 'mlp-reg-head', 'output', 'mlp-reg-output', 'input');
  await connect(canvas, 'mlp-reg-split', 'split', 'mlp-reg-trainer', 'dataset');
  await connect(canvas, 'mlp-reg-output', 'model', 'mlp-reg-trainer', 'model');
  await connect(canvas, 'mlp-reg-loss', 'loss', 'mlp-reg-trainer', 'loss');
  await connect(canvas, 'mlp-reg-optimizer', 'optimizer', 'mlp-reg-trainer', 'optimizer');
  await connect(canvas, 'mlp-reg-trainer', 'trained_model', 'mlp-reg-evaluate', 'trained_model');
  await canvas.run();
  const state = canvas.getState();
  check(state.execution.recommendation.canRunHere, 'Small MLP regression should be recommended for browser execution.');
  check(state.execution.runtime.status === 'succeeded', 'Small MLP regression did not finish successfully.');
  check(state.execution.runtime.result?.metrics?.r2 >= 0.98, 'Small MLP regression R虏 is below the accepted exercise baseline.');
}

export async function runCanvasAgentExerciseSuite(target = window) {
  const result = { status: 'running', cases: [] };
  publishResult(target, result);
  const record = async (name, test) => {
    await test();
    result.cases.push({ name, status: 'passed' });
    publishResult(target, result);
  };
  let canvas;
  let originalProject;
  try {
    const bridge = target.__VOLK_ML_AGENT__;
    check(bridge?.apiVersion === 1, 'Canvas Agent bridge version 1 is required.');
    const instances = bridge.listInstances();
    check(instances.length === 1, 'The exercise suite requires exactly one mounted canvas.');
    canvas = await bridge.open(instances[0].id);
    originalProject = canvas.getProject();
    const components = canvas.listComponents();
    await record('bridge and registry discovery', async () => {
      check(components.length > 0, 'No registered components were returned.');
      check(new Set(components.map((component) => component.id)).size === components.length, 'Component registry contains duplicate IDs.');
    });
    await record('all registered components create with default parameters', async () => {
      await canvas.loadProject(emptyProject(originalProject));
      await testRegistry(canvas, components);
    });
    await record('Iris KNN API exercise', async () => {
      await canvas.loadProject(emptyProject(originalProject));
      await testIrisKnn(canvas);
    });
    await record('Wine regression API exercise', async () => {
      await canvas.loadProject(emptyProject(originalProject));
      await testWineRegression(canvas);
    });
    await record('small MLP API exercise', async () => {
      await canvas.loadProject(emptyProject(originalProject));
      await testBrowserMlp(canvas);
    });
    await record('small MLP regression API exercise', async () => {
      await canvas.loadProject(emptyProject(originalProject));
      await testBrowserMlpRegression(canvas);
    });
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    result.error = { code: error?.code ?? 'EXERCISE_FAILED', message: error?.message ?? String(error) };
  } finally {
    if (canvas && originalProject) {
      try { await canvas.loadProject(originalProject); } catch (error) {
        result.restoreError = { code: error?.code ?? 'RESTORE_FAILED', message: error?.message ?? String(error) };
        result.status = 'failed';
      }
    }
    publishResult(target, result);
  }
  return result;
}

