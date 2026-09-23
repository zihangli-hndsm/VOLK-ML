import { exerciseDatasets } from './buildAgent/exerciseFixtures.js';
import { createBuildDatasetContext } from './buildAgent/datasetContext.js';
import { materializeBuildBlueprint } from './buildAgent/graphBlueprints.js';

const { iris: irisDataset, wine: wineDataset, mlpClassification, mlpRegression } = exerciseDatasets;

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

async function loadBlueprint(canvas, dataset, plan) {
  const datasetContext = createBuildDatasetContext(dataset);
  const graph = materializeBuildBlueprint({ blueprintId: plan.blueprintId, plan, datasetContext });
  await canvas.loadProject({ ...canvas.getProject(), graph, data: dataset, trainedModel: null });
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
  const detail = result.error ? ` — ${result.error.code}: ${result.error.message}` : '';
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
  await loadBlueprint(canvas, irisDataset, {
    blueprintId: 'tabular-classification-knn-v1', task: 'classification', modelFamily: 'knn',
    dataset: { featureCount: 4, classCount: 3 }, training: { trainRatio: 0.8 },
  });
  await expectCode(
    () => connect(canvas, 'build-data', 'dataset', 'build-evaluate', 'trained_model'),
    'INVALID_CONNECTION',
  );
  await canvas.run();
  const state = canvas.getState();
  check(state.execution.runtime.status === 'succeeded', 'Iris KNN did not finish successfully.');
  check(state.execution.runtime.result?.metrics?.accuracy >= 0.65, 'Iris KNN accuracy is below the accepted exercise baseline.');
  await expectCode(() => canvas.updateNode('build-knn', { parameters: { k_value: 4 } }), 'INVALID_PARAMETER');
  await canvas.updateNode('build-knn', { position: { x: 360, y: 180 } });
  check(canvas.getState().execution.runtime.status === 'succeeded', 'Layout-only updates must preserve a completed run.');
}

async function testWineRegression(canvas) {
  await loadBlueprint(canvas, wineDataset, {
    blueprintId: 'tabular-regression-linear-v1', task: 'regression', modelFamily: 'linear-regression',
    dataset: { featureCount: 3, classCount: null }, training: { trainRatio: 0.8, epochs: 200 },
  });
  await canvas.run();
  const state = canvas.getState();
  check(state.execution.runtime.status === 'succeeded', 'Wine regression did not finish successfully.');
  check(state.execution.runtime.result?.metrics?.r2 >= 0.98, 'Wine regression R² is below the accepted exercise baseline.');
}

async function testBrowserMlp(canvas) {
  await loadBlueprint(canvas, mlpClassification, {
    blueprintId: 'tabular-classification-mlp-v1', task: 'classification', modelFamily: 'mlp',
    dataset: { featureCount: 2, classCount: 2 }, training: { trainRatio: 0.8, epochs: 120, batchSize: 16, shuffle: true, hiddenUnits: 6 },
  });
  await canvas.run();
  const state = canvas.getState();
  check(state.execution.recommendation.canRunHere, 'Small MLP should be recommended for browser execution.');
  check(state.execution.runtime.status === 'succeeded', 'Small MLP did not finish successfully.');
  check(state.execution.runtime.result?.metrics?.accuracy >= 0.9, 'Small MLP accuracy is below the accepted exercise baseline.');
}

async function testBrowserMlpRegression(canvas) {
  await loadBlueprint(canvas, mlpRegression, {
    blueprintId: 'tabular-regression-mlp-v1', task: 'regression', modelFamily: 'mlp',
    dataset: { featureCount: 2, classCount: null }, training: { trainRatio: 0.8, epochs: 250, batchSize: 10, shuffle: true, hiddenUnits: 6 },
  });
  await canvas.run();
  const state = canvas.getState();
  check(state.execution.recommendation.canRunHere, 'Small MLP regression should be recommended for browser execution.');
  check(state.execution.runtime.status === 'succeeded', 'Small MLP regression did not finish successfully.');
  check(state.execution.runtime.result?.metrics?.r2 >= 0.98, 'Small MLP regression R² is below the accepted exercise baseline.');
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
