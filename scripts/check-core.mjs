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
import { profileBrowserDataset } from '../src/core/browserExecutionContract.js';
import { createCustomComposite, flattenCustomComposites } from '../src/core/customComposites.js';
import { assessConnection, knownPortTypes } from '../src/core/connections.js';
import {
  CANVAS_AGENT_API_VERSION,
  CANVAS_AGENT_GLOBAL,
  CanvasAgentError,
  canvasExecutionInputSignature,
  connectAgentNodes,
  createAgentNode,
  createCanvasAgentApi,
  createCanvasAgentSnapshot,
  disconnectAgentEdge,
  invalidateAgentNodeStatuses,
  installCanvasAgentBridge,
  removeAgentNode,
  selectAgentNode,
  updateAgentNode,
  validateAgentDataset,
} from '../src/core/canvasAgent.js';
import { analyzeProject } from '../src/core/explanation.js';
import { safeProjectFilename } from '../src/core/localProjects.js';
import {
  compileLossExpression,
  lossExpressionFunctions,
  parseLossExpression,
} from '../src/core/lossExpression.js';
import {
  leastSquaresFit,
  meanSquaredError,
  regressionPointsFromDataset,
  uniformlySamplePoints,
} from '../src/core/linearRegressionPlayground.js';
import { migrateProject, PROJECT_VERSION, projectContentSignature, validateProjectForWorkspace } from '../src/core/project.js';
import { estimateExecutionPlan } from '../src/core/runtimeTiers.js';
import { tutorialByOp } from '../src/core/tutorials.js';
import {
  activationValue,
  architectureLayout,
  componentLibraryTree,
  concatenateVisualData,
  descentVisualGeometry,
  mseLandscapeValue,
  stageForManifest,
  visualKindForManifest,
} from '../src/core/visualLanguage.js';
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

const agentInput = createAgentNode({
  nodes: [],
  manifest: componentById.get('tensor_input_node'),
  request: { id: 'agent-input', position: { x: 10, y: 20 }, parameters: { shape: '8' } },
});
const agentDense = createAgentNode({
  nodes: [agentInput],
  manifest: componentById.get('dense_node'),
  request: { id: 'agent-dense', position: { x: 300, y: 20 }, parameters: { input_features: 8, units: 4 } },
});
assert.equal(agentDense.data.parameters.units, 4);
assert.throws(
  () => createAgentNode({ nodes: [agentInput], manifest: componentById.get('dense_node'), request: { id: 'agent-input' } }),
  (error) => error.code === 'DUPLICATE_NODE_ID',
);
assert.throws(
  () => updateAgentNode([agentDense], agentDense.id, { parameters: { units: -1 } }),
  (error) => error.code === 'INVALID_PARAMETER',
);
assert.throws(
  () => updateAgentNode([agentDense], agentDense.id, { parameters: { units: 1.5 } }),
  (error) => error.code === 'INVALID_PARAMETER' && error.details.step === 1,
);
const movedAgentDense = updateAgentNode([agentDense], agentDense.id, { position: { x: 420, y: 80 }, parameters: { units: 16 } })[0];
assert.deepEqual(movedAgentDense.position, { x: 420, y: 80 });
assert.equal(movedAgentDense.data.parameters.units, 16);
const runningAgentDense = { ...agentDense, data: { ...agentDense.data, status: 'success' } };
const layoutOnlyAgentDense = updateAgentNode([runningAgentDense], runningAgentDense.id, { position: { x: 500, y: 120 } })[0];
assert.equal(layoutOnlyAgentDense.data.status, 'success', 'Layout-only Agent edits must preserve execution status');
assert.equal(updateAgentNode([runningAgentDense], runningAgentDense.id, { parameters: { units: 16 } })[0].data.status, 'idle');
assert.equal(invalidateAgentNodeStatuses([runningAgentDense])[0].data.status, 'idle');
const agentEdges = connectAgentNodes([agentInput, agentDense], [], {
  id: 'agent-link',
  source: agentInput.id,
  sourceHandle: 'tensor',
  target: agentDense.id,
  targetHandle: 'input',
});
const agentExecutionSignature = canvasExecutionInputSignature([agentInput, agentDense], agentEdges, null);
assert.equal(
  canvasExecutionInputSignature([{ ...agentInput, position: { x: 999, y: 999 } }, agentDense], agentEdges, null),
  agentExecutionSignature,
  'Layout changes must not invalidate an execution result',
);
assert.notEqual(
  canvasExecutionInputSignature([agentInput, movedAgentDense], agentEdges, null),
  agentExecutionSignature,
  'Parameter changes must invalidate an execution result',
);
assert.equal(agentEdges[0].id, 'agent-link');
assert.throws(
  () => connectAgentNodes([agentInput, agentDense], [], {
    source: agentInput.id,
    sourceHandle: 'bogus',
    target: agentDense.id,
    targetHandle: 'bogus',
  }),
  (error) => error.code === 'INVALID_CONNECTION',
  'Agent connections must require exact port handles',
);
assert.equal(disconnectAgentEdge(agentEdges, 'agent-link').length, 0);
assert.deepEqual(removeAgentNode([agentInput, agentDense], agentEdges, agentInput.id).edges, []);
assert.equal(selectAgentNode([agentInput, agentDense], agentDense.id)[1].selected, true);
assert.ok(selectAgentNode([agentInput, agentDense], null).every((node) => !node.selected));
assert.throws(
  () => selectAgentNode([agentInput], 'missing'),
  (error) => error.code === 'NODE_NOT_FOUND',
);
const validatedAgentDataset = validateAgentDataset({
  name: 'agent-data',
  rows: [{ feature: 1, target: 2 }],
  featureColumns: [' feature '],
  targetColumn: ' target ',
});
assert.deepEqual(validatedAgentDataset.featureColumns, ['feature']);
assert.equal(validatedAgentDataset.targetColumn, 'target');
assert.equal(validatedAgentDataset.task, 'regression');
assert.equal(validatedAgentDataset.name, 'agent-data');
assert.deepEqual(validatedAgentDataset.columns, [
  { name: 'feature', type: 'number', missing: 0 },
  { name: 'target', type: 'number', missing: 0 },
]);
assert.equal(validateAgentDataset({
  rows: [{ feature: 1, target: 'class-a' }],
  featureColumns: ['feature'],
  targetColumn: 'target',
}).task, 'classification');
assert.equal(validateAgentDataset({
  rows: [{ feature: 1, target: 2 }],
  featureColumns: ['feature'],
  targetColumn: 'target',
}).name, 'Agent Dataset');
assert.throws(
  () => validateAgentDataset({ rows: [{ feature: 1, target: 2 }], featureColumns: ['feature'], targetColumn: 'target', task: 'classification ' }),
  (error) => error.code === 'INVALID_DATASET',
);
assert.throws(
  () => validateAgentDataset({ rows: [{ feature: 1, target: 2 }], featureColumns: ['feature'], targetColumn: 'target', name: { text: 'bad' } }),
  (error) => error.code === 'INVALID_DATASET',
);
assert.throws(
  () => validateAgentDataset({ rows: [], featureColumns: ['feature'], targetColumn: 'target' }),
  (error) => error.code === 'INVALID_DATASET',
);
assert.throws(
  () => validateAgentDataset({ rows: [{ feature: 1 }], featureColumns: ['feature'], targetColumn: 'feature' }),
  (error) => error.code === 'INVALID_DATASET',
);
assert.throws(
  () => validateAgentDataset({ rows: [{ feature: 1n, target: 2 }], featureColumns: ['feature'], targetColumn: 'target' }),
  (error) => error.code === 'INVALID_DATASET',
);
const circularAgentRow = { feature: 1, target: 2 };
circularAgentRow.nested = circularAgentRow;
assert.throws(
  () => validateAgentDataset({ rows: [circularAgentRow], featureColumns: ['feature'], targetColumn: 'target' }),
  (error) => error.code === 'INVALID_DATASET',
);
const agentProject = {
  format: 'VOLK-ML',
  version: PROJECT_VERSION,
  name: 'Agent test',
  savedAt: '2026-08-02T00:00:00.000Z',
  graph: { nodes: [agentInput, agentDense], edges: agentEdges },
  customComponents: [],
  data: null,
  trainedModel: null,
};
const agentSnapshot = createCanvasAgentSnapshot({
  instanceId: 'test-instance',
  project: agentProject,
  nodes: agentProject.graph.nodes,
  edges: agentProject.graph.edges,
  selectedNodeId: agentDense.id,
  viewMode: 'canvas',
  runtime: { status: 'idle', losses: [], activeNodeIds: [] },
  executionPlan: { recommendedTier: 'L1', canRunHere: false },
  dirty: true,
});
assert.equal(agentSnapshot.apiVersion, CANVAS_AGENT_API_VERSION);
assert.equal(agentSnapshot.canvas.nodes[1].componentId, 'dense_node');
assert.equal(agentSnapshot.dataset, null);
assert.equal(agentSnapshot.execution.runtime.status, 'idle');
assert.equal(agentSnapshot.execution.runtime.result, null);
assert.equal(agentSnapshot.execution.recommendation.recommendedTier, 'L1');
const agentListeners = new Set();
const fakeAgentApi = createCanvasAgentApi({
  instanceId: 'test-instance',
  getState: () => agentSnapshot,
  listComponents: () => [],
  addNode: async (request) => {
    if (request?.invalidDetails) throw new CanvasAgentError('INVALID_PARAMETER', 'Invalid parameter fixture', { value: 1n });
    return { nodeId: 'new-node' };
  },
  updateNode: async (nodeId) => ({ nodeId }),
  removeNode: async (nodeId) => ({ nodeId }),
  connect: async () => ({ edgeId: 'new-edge' }),
  disconnect: async (edgeId) => ({ edgeId }),
  selectNode: async (nodeId) => ({ nodeId }),
  renameProject: async (name) => ({ name }),
  setDataset: async (dataset) => ({ hasDataset: Boolean(dataset) }),
  loadProject: async (project) => {
    if (project.name === 'fail') throw new Error('Invalid project fixture');
    return { name: project.name };
  },
  getProject: () => agentProject,
  run: async () => ({ type: 'linear_regression' }),
  exportCode: async (framework) => `# ${framework}`,
  downloadProject: async () => ({ filename: 'agent-test.volkml.json' }),
  subscribe(listener) { agentListeners.add(listener); return () => agentListeners.delete(listener); },
});
const agentTarget = {};
const uninstallAgentBridge = installCanvasAgentBridge(fakeAgentApi, agentTarget);
assert.deepEqual(agentTarget[CANVAS_AGENT_GLOBAL].listInstances(), [{ id: 'test-instance' }]);
assert.equal((await agentTarget[CANVAS_AGENT_GLOBAL].open()).instanceId, 'test-instance');
await assert.rejects(
  fakeAgentApi.loadProject({ name: 'fail' }),
  (error) => error instanceof CanvasAgentError
    && error.code === 'OPERATION_FAILED'
    && error.details.operation === 'loadProject',
);
assert.equal(await fakeAgentApi.exportCode('pytorch'), '# pytorch');
await assert.rejects(
  fakeAgentApi.addNode({ invalidDetails: true }),
  (error) => error.code === 'INVALID_PARAMETER'
    && error.details.value === '1'
    && JSON.stringify(error.details) === '{"value":"1"}',
);
const secondAgentApi = createCanvasAgentApi({ ...{
  instanceId: 'second-instance',
  getState: () => ({ ...agentSnapshot, instanceId: 'second-instance' }),
  listComponents: () => [],
  addNode: async () => ({ nodeId: 'new-node' }),
  updateNode: async (nodeId) => ({ nodeId }),
  removeNode: async (nodeId) => ({ nodeId }),
  connect: async () => ({ edgeId: 'new-edge' }),
  disconnect: async (edgeId) => ({ edgeId }),
  selectNode: async (nodeId) => ({ nodeId }),
  renameProject: async (name) => ({ name }),
  setDataset: async (dataset) => ({ hasDataset: Boolean(dataset) }),
  loadProject: async (project) => ({ name: project.name }),
  getProject: () => agentProject,
  run: async () => ({ type: 'linear_regression' }),
  exportCode: async (framework) => `# ${framework}`,
  downloadProject: async () => ({ filename: 'agent-test.volkml.json' }),
  subscribe: () => () => {},
} });
const sharedAgentBridge = agentTarget[CANVAS_AGENT_GLOBAL];
const uninstallSecondAgentBridge = installCanvasAgentBridge(secondAgentApi, agentTarget);
assert.equal(agentTarget[CANVAS_AGENT_GLOBAL], sharedAgentBridge, 'Mounted canvases must share one bridge');
assert.deepEqual(agentTarget[CANVAS_AGENT_GLOBAL].listInstances(), [{ id: 'test-instance' }, { id: 'second-instance' }]);
await assert.rejects(
  agentTarget[CANVAS_AGENT_GLOBAL].open(),
  (error) => error.code === 'INSTANCE_AMBIGUOUS',
);
assert.equal((await agentTarget[CANVAS_AGENT_GLOBAL].open('test-instance')).instanceId, 'test-instance');
const copiedAgentState = fakeAgentApi.getState();
copiedAgentState.canvas.nodes[0].position.x = 999;
assert.equal(agentSnapshot.canvas.nodes[0].position.x, 10, 'Agent snapshots must be detached from workspace state');
await assert.rejects(
  agentTarget[CANVAS_AGENT_GLOBAL].open('missing'),
  (error) => error.code === 'INSTANCE_NOT_FOUND',
);
uninstallAgentBridge();
assert.deepEqual(agentTarget[CANVAS_AGENT_GLOBAL].listInstances(), [{ id: 'second-instance' }]);
assert.equal((await agentTarget[CANVAS_AGENT_GLOBAL].open()).instanceId, 'second-instance');
uninstallSecondAgentBridge();
assert.equal(agentTarget[CANVAS_AGENT_GLOBAL], undefined);

assert.equal(new Set(pluginRegistry.map((manifest) => manifest.id)).size, pluginRegistry.length, 'Component IDs must be unique');
for (const manifest of pluginRegistry) {
  assert.equal(manifest.schemaVersion, COMPONENT_SCHEMA_VERSION, `${manifest.id} schema version`);
  assert.ok(manifest.op && manifest.kind && manifest.category, `${manifest.id} semantic metadata`);
  assert.ok(messages[`category.${manifest.category}`], `${manifest.id} localized category`);
  assert.ok(['L0', 'L1', 'L2', 'L3'].includes(manifest.runtime.minimumTier), `${manifest.id} execution tier`);
  assert.ok(['exact', 'adapted', 'approximate', 'unsupported'].includes(manifest.compatibility.pytorch), `${manifest.id} PyTorch compatibility`);
  assert.ok(['exact', 'adapted', 'approximate', 'unsupported'].includes(manifest.compatibility.tensorflow), `${manifest.id} TensorFlow compatibility`);
  for (const property of manifest.properties) assert.ok(['number', 'slider', 'select', 'boolean', 'text', 'code'].includes(property.type), `${manifest.id}.${property.key} control type`);
  assert.ok(
    manifest.runtime.browserBackend !== 'none'
      || manifest.compatibility.pytorch !== 'unsupported'
      || manifest.compatibility.tensorflow !== 'unsupported',
    `${manifest.id} must have at least one usable execution or export path`,
  );
  const tutorial = tutorialByOp[manifest.op];
  assert.ok(tutorial, `${manifest.id} beginner tutorial`);
  assert.ok(tutorial.formula && tutorial.visual, `${manifest.id} tutorial formula and visual`);
  assert.equal(tutorial.visual, manifest.op, `${manifest.id} uses its own semantic animation`);
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

assert.equal(resolveMessage(tutorialByOp.model_output.formula, 'zh'), 'model(x) = 閫夊畾鐨勮緭鍑哄紶閲?);
assert.equal(resolveMessage(tutorialByOp.cross_entropy_loss.formula, 'zh'), 'L = 鈭抣og p(姝ｇ‘绫诲埆)');
assert.equal(resolveMessage(tutorialByOp.cross_entropy_loss.formula, 'en'), 'L = 鈭抣og p(correct class)');
assert.equal(resolveMessage('playground.equation', 'zh', { weight: '2.00', operator: '鈭?, bias: '1.00' }), '欧 = 2.00x 鈭?1.00');
assert.equal(stageForManifest(componentById.get('tabular_data_node')), 'data');
assert.equal(stageForManifest(componentById.get('dense_node')), 'model');
assert.equal(stageForManifest(componentById.get('adam_optimizer_node')), 'training');
assert.equal(stageForManifest(componentById.get('model_output_node')), 'output');
assert.equal(visualKindForManifest(componentById.get('dense_node')), 'dense');
assert.equal(visualKindForManifest(componentById.get('multihead_attention_node')), 'multihead_attention');
assert.equal(
  new Set(pluginRegistry.map((manifest) => visualKindForManifest(manifest))).size,
  pluginRegistry.length,
  'every registered operation has a distinct semantic visual identity',
);
assert.equal(activationValue('relu', 0), 0);
assert.equal(activationValue('tanh', 0), 0, 'tanh passes through the coordinate origin');
assert.equal(activationValue('sigmoid', 0), 0.5, 'sigmoid crosses 0.5 at x = 0');
assert.ok(activationValue('gelu', -1) < 0 && activationValue('gelu', 1) > 0, 'GELU keeps its smooth negative dip');
assert.ok(mseLandscapeValue(0) < mseLandscapeValue(-1));
assert.ok(mseLandscapeValue(0) < mseLandscapeValue(1), 'MSE landscape has its minimum at the center');
for (const operation of ['gradient_descent', 'sgd_optimizer', 'adam_optimizer', 'adamw_optimizer']) {
  const geometry = descentVisualGeometry(operation);
  assert.deepEqual(geometry.endpoint, geometry.minimum, `${operation} trajectory ends at the landscape minimum`);
}
assert.deepEqual(concatenateVisualData, {
  inputs: ['[a,b]', '[c,d]'],
  result: '[a,b,c,d]',
  axis: -1,
}, 'concatenate visual matches the default one-dimensional axis');
for (const type of knownPo…9864 tokens truncated…: true }),
  makeNode('mlp-relu', 'relu_node'),
  makeNode('mlp-head', 'dense_node', { input_features: 6, units: 2, use_bias: true }),
  makeNode('mlp-softmax', 'softmax_node'),
  makeNode('mlp-output', 'model_output_node'),
  makeNode('mlp-loss', 'cross_entropy_loss_node'),
  makeNode('mlp-optimizer', 'adam_optimizer_node', { learning_rate: 0.02 }),
  makeNode('mlp-trainer', 'supervised_trainer_node', { epochs: 120, batch_size: 16, shuffle: true }),
  makeNode('mlp-evaluate', 'evaluate_classification_node'),
  makeNode('mlp-predict', 'predictor_node'),
];
const mlpGraphEdges = [
  makeEdge('mlp-data', 'dataset', 'mlp-split', 'dataset'),
  makeEdge('mlp-input', 'tensor', 'mlp-hidden', 'input'),
  makeEdge('mlp-hidden', 'output', 'mlp-relu', 'input'),
  makeEdge('mlp-relu', 'output', 'mlp-head', 'input'),
  makeEdge('mlp-head', 'output', 'mlp-softmax', 'input'),
  makeEdge('mlp-softmax', 'output', 'mlp-output', 'input'),
  makeEdge('mlp-split', 'split', 'mlp-trainer', 'dataset'),
  makeEdge('mlp-output', 'model', 'mlp-trainer', 'model'),
  makeEdge('mlp-loss', 'loss', 'mlp-trainer', 'loss'),
  makeEdge('mlp-optimizer', 'optimizer', 'mlp-trainer', 'optimizer'),
  makeEdge('mlp-trainer', 'trained_model', 'mlp-evaluate', 'trained_model'),
  makeEdge('mlp-trainer', 'trained_model', 'mlp-predict', 'trained_model'),
];
const mlpModel = await executeBrowserGraph({ nodes: mlpGraphNodes, edges: mlpGraphEdges, dataset: classificationDataset });
assert.equal(estimateExecutionPlan(mlpGraphNodes, classificationDataset, { edges: mlpGraphEdges }).canRunHere, true, 'small MLP is directly runnable in the browser');
assert.equal(mlpModel.type, 'browser_mlp');
assert.ok(mlpModel.metrics.accuracy >= 0.9, 'browser MLP classifies the separable exercise dataset');
assert.equal(predictWithModel(mlpModel, [3.1, 1.9]), 'positive');
assert.equal(mlpModel.layers.some((layer) => layer.adam || layer.sgd), false, 'persisted MLP layers omit optimizer state');
const persistedMlpProject = validateProjectForWorkspace(JSON.parse(JSON.stringify({
  format: 'VOLK-ML', version: PROJECT_VERSION, name: 'Persisted browser MLP',
  graph: { nodes: mlpGraphNodes, edges: mlpGraphEdges }, customComponents: [],
  data: classificationDataset, trainedModel: mlpModel,
})));
assert.equal(persistedMlpProject.trainedModel.type, 'browser_mlp');
assert.equal(predictWithModel(persistedMlpProject.trainedModel, [3.1, 1.9]), 'positive', 'imported MLP remains usable for prediction');
assert.throws(
  () => validateProjectForWorkspace({
    format: 'VOLK-ML', version: PROJECT_VERSION, name: 'MLP without Dense layers',
    graph: { nodes: mlpGraphNodes, edges: mlpGraphEdges }, customComponents: [], data: classificationDataset,
    trainedModel: { ...mlpModel, layers: mlpModel.layers.filter((layer) => layer.op !== 'dense') },
  }),
  (error) => error.translationKey === 'error.invalidProject',
  'persisted MLPs require the same non-empty Dense architecture as the browser runtime',
);
assert.throws(
  () => validateProjectForWorkspace({
    format: 'VOLK-ML', version: PROJECT_VERSION, name: 'Malformed MLP test rows',
    graph: { nodes: mlpGraphNodes, edges: mlpGraphEdges }, customComponents: [],
    data: classificationDataset, trainedModel: { ...mlpModel, test: [{ x: [NaN, 0], y: 'positive' }] },
  }),
  (error) => error.translationKey === 'error.invalidProject',
  'persisted MLP test samples must remain finite and agree with the saved count',
);

const hiddenSoftmaxModel = await executeBrowserGraph({
  nodes: mlpGraphNodes.map((node) => node.id === 'mlp-relu' ? makeNode('mlp-relu', 'softmax_node') : node),
  edges: mlpGraphEdges,
  dataset: classificationDataset,
});
assert.ok(hiddenSoftmaxModel.metrics.accuracy >= 0.9, 'an intermediate Softmax propagates its full Jacobian-vector product');

const foldedMlpArchitecture = createCustomComposite({
  selectedNodes: mlpGraphNodes.filter((node) => ['mlp-input', 'mlp-hidden', 'mlp-relu', 'mlp-head', 'mlp-softmax', 'mlp-output'].includes(node.id)),
  edges: mlpGraphEdges,
  name: 'Folded browser MLP architecture',
  color: '#2563eb',
});
const foldedMlpNodes = [
  ...mlpGraphNodes.filter((node) => !['mlp-input', 'mlp-hidden', 'mlp-relu', 'mlp-head', 'mlp-softmax', 'mlp-output'].includes(node.id)),
  foldedMlpArchitecture.instance,
];
assert.equal(
  estimateExecutionPlan(foldedMlpNodes, classificationDataset, { edges: foldedMlpArchitecture.nextEdges }).canRunHere,
  true,
  'folded MLP nodes and edges share one flattened topology for tier guidance',
);
const foldedMlpModel = await executeBrowserGraph({
  nodes: foldedMlpNodes,
  edges: foldedMlpArchitecture.nextEdges,
  dataset: classificationDataset,
});
assert.equal(
  foldedMlpModel.modelNodeId,
  foldedMlpArchitecture.instance.id,
  'folded MLP persistence uses the stable top-level composite instance ID',
);
const persistedFoldedMlpProject = validateProjectForWorkspace(JSON.parse(JSON.stringify({
  format: 'VOLK-ML', version: PROJECT_VERSION, name: 'Persisted folded browser MLP',
  graph: { nodes: foldedMlpNodes, edges: foldedMlpArchitecture.nextEdges },
  customComponents: [foldedMlpArchitecture.manifest],
  data: classificationDataset, trainedModel: foldedMlpModel,
})));
assert.equal(persistedFoldedMlpProject.trainedModel.type, 'browser_mlp', 'folded MLP survives import validation');
const foldedTrainerSelection = new Set([
  'mlp-input', 'mlp-hidden', 'mlp-relu', 'mlp-head', 'mlp-softmax', 'mlp-output',
  'mlp-loss', 'mlp-optimizer', 'mlp-trainer',
]);
const foldedTrainer = createCustomComposite({
  selectedNodes: mlpGraphNodes.filter((node) => foldedTrainerSelection.has(node.id)),
  edges: mlpGraphEdges,
  name: 'Folded browser MLP Trainer',
  color: '#ea580c',
});
const foldedTrainerNodes = [
  ...mlpGraphNodes.filter((node) => !foldedTrainerSelection.has(node.id)),
  foldedTrainer.instance,
];
const foldedTrainerModel = await executeBrowserGraph({
  nodes: foldedTrainerNodes,
  edges: foldedTrainer.nextEdges,
  dataset: classificationDataset,
});
assert.equal(foldedTrainerModel.sourceNodeId, foldedTrainer.instance.id, 'folded Trainer persists its stable top-level owner ID');
const persistedFoldedTrainerProject = validateProjectForWorkspace(JSON.parse(JSON.stringify({
  format: 'VOLK-ML', version: PROJECT_VERSION, name: 'Persisted folded browser Trainer',
  graph: { nodes: foldedTrainerNodes, edges: foldedTrainer.nextEdges },
  customComponents: [foldedTrainer.manifest],
  data: classificationDataset, trainedModel: foldedTrainerModel,
})));
assert.equal(persistedFoldedTrainerProject.trainedModel.type, 'browser_mlp', 'folded Trainer survives import validation');

const secondMlpNodes = mlpGraphNodes.map((node) => ({ ...node, id: `second-${node.id}` }));
const secondMlpEdges = mlpGraphEdges.map((edge) => ({
  ...edge,
  id: `second-${edge.id}`,
  source: `second-${edge.source}`,
  target: `second-${edge.target}`,
}));
await assert.rejects(
  executeBrowserGraph({
    nodes: [...mlpGraphNodes, ...secondMlpNodes],
    edges: [...mlpGraphEdges, ...secondMlpEdges],
    dataset: classificationDataset,
  }),
  (error) => error.translationKey === 'error.multipleTrainingRoots',
  'browser execution rejects ambiguous canvases with multiple supervised Trainers',
);
await assert.rejects(
  executeBrowserGraph({
    nodes: [...mlpGraphNodes, ...classificationGraphNodes],
    edges: [...mlpGraphEdges, ...classificationGraphEdges],
    dataset: classificationDataset,
  }),
  (error) => error.translationKey === 'error.multipleTrainingRoots',
  'browser execution rejects mixed MLP and KNN training roots',
);
assert.equal(
  estimateExecutionPlan(
    [...mlpGraphNodes, ...secondMlpNodes],
    classificationDataset,
    { edges: [...mlpGraphEdges, ...secondMlpEdges] },
  ).canRunHere,
  false,
  'tier guidance does not advertise a multi-Trainer canvas as runnable',
);
assert.equal(
  estimateExecutionPlan(
    [...mlpGraphNodes, ...classificationGraphNodes],
    classificationDataset,
    { edges: [...mlpGraphEdges, ...classificationGraphEdges] },
  ).canRunHere,
  false,
  'tier guidance rejects mixed browser training roots',
);

const bceMlpNodes = mlpGraphNodes.map((node) => (
  node.id === 'mlp-loss' ? makeNode('mlp-loss', 'binary_cross_entropy_loss_node') : node
));
const bceMlpPlan = estimateExecutionPlan(bceMlpNodes, classificationDataset, { edges: mlpGraphEdges });
assert.equal(bceMlpPlan.canRunHere, false, 'binary cross entropy remains export-only until its browser backend exists');
assert.equal(bceMlpPlan.recommendedTier, 'L2');
const classificationMseNodes = mlpGraphNodes.map((node) => (
  node.id === 'mlp-loss' ? makeNode('mlp-loss', 'mse_loss_node') : node
));
assert.equal(
  estimateExecutionPlan(classificationMseNodes, classificationDataset, { edges: mlpGraphEdges }).canRunHere,
  false,
  'classification MLPs require cross entropy and a Softmax head before Run is enabled',
);
const wrongMlpEvaluatorNodes = [
  ...mlpGraphNodes,
  makeNode('mlp-wrong-evaluate', 'evaluate_node'),
];
const wrongMlpEvaluatorEdges = [
  ...mlpGraphEdges,
  makeEdge('mlp-trainer', 'trained_model', 'mlp-wrong-evaluate', 'trained_model'),
];
assert.equal(
  estimateExecutionPlan(wrongMlpEvaluatorNodes, classificationDataset, { edges: wrongMlpEvaluatorEdges }).canRunHere,
  false,
  'a classification MLP cannot be wired to a regression evaluator',
);
await assert.rejects(
  executeBrowserGraph({ nodes: wrongMlpEvaluatorNodes, edges: wrongMlpEvaluatorEdges, dataset: classificationDataset }),
  (error) => error.translationKey === 'error.wrongEvaluator',
  'the runtime shares the evaluator compatibility contract',
);

const emptyMlpNodes = mlpGraphNodes.filter((node) => !['mlp-hidden', 'mlp-relu', 'mlp-head', 'mlp-softmax'].includes(node.id));
const emptyMlpEdges = [
  ...mlpGraphEdges.filter((edge) => (
    !['mlp-hidden', 'mlp-relu', 'mlp-head', 'mlp-softmax'].includes(edge.source)
    && !['mlp-hidden', 'mlp-relu', 'mlp-head', 'mlp-softmax'].includes(edge.target)
  )),
  makeEdge('mlp-input', 'tensor', 'mlp-output', 'input'),
];
assert.equal(
  estimateExecutionPlan(emptyMlpNodes, classificationDataset, { edges: emptyMlpEdges }).canRunHere,
  false,
  'tier guidance requires at least one supported Dense layer in a browser MLP',
);
const mismatchedMlpNodes = mlpGraphNodes.map((node) => (
  node.id === 'mlp-hidden' ? makeNode('mlp-hidden', 'dense_node', { input_features: 3, units: 6, use_bias: true }) : node
));
assert.equal(
  estimateExecutionPlan(mismatchedMlpNodes, classificationDataset, { edges: mlpGraphEdges }).canRunHere,
  false,
  'tier guidance rejects Dense widths that do not match the preceding tensor',
);
const mismatchedMlpInputNodes = mlpGraphNodes.map((node) => (
  node.id === 'mlp-input' ? makeNode('mlp-input', 'tensor_input_node', { shape: '3', dtype: 'float32' }) : node
));
const mismatchedMlpInputPlan = estimateExecutionPlan(mismatchedMlpInputNodes, classificationDataset, { edges: mlpGraphEdges });
assert.equal(mismatchedMlpInputPlan.canRunHere, false, 'tier guidance rejects Tensor Input widths that do not match dataset features');
await assert.rejects(
  executeBrowserGraph({ nodes: mismatchedMlpInputNodes, edges: mlpGraphEdges, dataset: classificationDataset }),
  (error) => error.translationKey === 'error.browserMlpShape',
  'runtime rejects the same Tensor Input width mismatch during preflight',
);
const missingClassificationDataset = {
  ...classificationDataset,
  name: 'missing-values-check',
  rows: [
    { feature_a: 3, feature_b: 2, label: 'positive' },
    { feature_a: -3, feature_b: -2, label: 'negative' },
    { feature_a: '', feature_b: 2, label: 'positive' },
    { feature_a: 3, feature_b: '   ', label: 'negative' },
    { feature_a: 3, feature_b: 2, label: '   ' },
  ],
};
assert.equal(
  estimateExecutionPlan(mlpGraphNodes, missingClassificationDataset, { edges: mlpGraphEdges }).canRunHere,
  false,
  'tier guidance excludes empty and whitespace-only cells using runtime preprocessing rules',
);
await assert.rejects(
  executeBrowserGraph({ nodes: mlpGraphNodes, edges: mlpGraphEdges, dataset: missingClassificationDataset }),
  (error) => error.translationKey === 'error.tooFewRows',
  'runtime and preflight agree after missing cells leave fewer than three rows',
);
const unsupportedSoftmaxAxisNodes = mlpGraphNodes.map((node) => (
  node.id === 'mlp-softmax' ? makeNode('mlp-softmax', 'softmax_node', { axis: 1 }) : node
));
assert.equal(
  estimateExecutionPlan(unsupportedSoftmaxAxisNodes, classificationDataset, { edges: mlpGraphEdges }).canRunHere,
  false,
  'tier guidance does not advertise unsupported browser Softmax axes as runnable',
);
const wrongTypeMlpNodes = mlpGraphNodes.map((node) => (
  node.id === 'mlp-data' ? makeNode('mlp-data', 'tensor_input_node', { shape: '2', dtype: 'float32' }) : node
));
assert.equal(
  estimateExecutionPlan(wrongTypeMlpNodes, classificationDataset, { edges: mlpGraphEdges }).canRunHere,
  false,
  'the shared execution contract rejects manually supplied mismatched port types',
);
const highCardinalityProfile = profileBrowserDataset({
  ...classificationDataset,
  rows: Array.from({ length: 10_000 }, (_, index) => ({ feature_a: index, feature_b: index, label: `class-${index}` })),
});
assert.equal(highCardinalityProfile.classCount, 10_000, 'browser dataset profiling counts high-cardinality labels in one pass');
assert.equal(highCardinalityProfile.classificationSplitHasTest, false, 'singleton high-cardinality classes cannot produce a test split');

const mlpRegressionDataset = {
  name: 'mlp-regression-check', task: 'regression',
  rows: Array.from({ length: 80 }, (_, index) => {
    const feature_a = (index % 10) - 5;
    const feature_b = Math.floor(index / 10) - 4;
    return { feature_a, feature_b, target: 1.5 * feature_a - 2 * feature_b + 0.5 };
  }),
  columns: [{ name: 'feature_a', type: 'number' }, { name: 'feature_b', type: 'number' }, { name: 'target', type: 'number' }],
  featureColumns: ['feature_a', 'feature_b'], targetColumn: 'target',
};
const mlpRegressionNodes = [
  makeNode('mlp-reg-data', 'tabular_data_node'),
  makeNode('mlp-reg-split', 'train_test_split_node', { train_ratio: 0.8 }),
  makeNode('mlp-reg-input', 'tensor_input_node', { shape: '2', dtype: 'float32' }),
  makeNode('mlp-reg-head', 'dense_node', { input_features: 2, units: 1, use_bias: true }),
  makeNode('mlp-reg-output', 'model_output_node'),
  makeNode('mlp-reg-loss', 'mse_loss_node'),
  makeNode('mlp-reg-optimizer', 'sgd_optimizer_node', { learning_rate: 0.05, momentum: 0.6 }),
  makeNode('mlp-reg-trainer', 'supervised_trainer_node', { epochs: 250, batch_size: 10, shuffle: true }),
  makeNode('mlp-reg-evaluate', 'evaluate_node'),
];
const mlpRegressionEdges = [
  makeEdge('mlp-reg-data', 'dataset', 'mlp-reg-split', 'dataset'),
  makeEdge('mlp-reg-input', 'tensor', 'mlp-reg-head', 'input'),
  makeEdge('mlp-reg-head', 'output', 'mlp-reg-output', 'input'),
  makeEdge('mlp-reg-split', 'split', 'mlp-reg-trainer', 'dataset'),
  makeEdge('mlp-reg-output', 'model', 'mlp-reg-trainer', 'model'),
  makeEdge('mlp-reg-loss', 'loss', 'mlp-reg-trainer', 'loss'),
  makeEdge('mlp-reg-optimizer', 'optimizer', 'mlp-reg-trainer', 'optimizer'),
  makeEdge('mlp-reg-trainer', 'trained_model', 'mlp-reg-evaluate', 'trained_model'),
];
const mlpRegressionModel = await executeBrowserGraph({ nodes: mlpRegressionNodes, edges: mlpRegressionEdges, dataset: mlpRegressionDataset });
assert.equal(mlpRegressionModel.type, 'browser_mlp');
assert.ok(mlpRegressionModel.metrics.r2 >= 0.98, 'browser MLP regression learns the MSE exercise');
assert.ok(mlpRegressionModel.lossHistory.at(-1) < mlpRegressionModel.lossHistory[0], 'mini-batch SGD with momentum lowers MSE loss');
assert.throws(
  () => validateProjectForWorkspace({
    format: 'VOLK-ML', version: PROJECT_VERSION, name: 'Persisted Softmax regression MLP',
    graph: { nodes: mlpRegressionNodes, edges: mlpRegressionEdges }, customComponents: [], data: mlpRegressionDataset,
    trainedModel: { ...mlpRegressionModel, layers: [...mlpRegressionModel.layers, { op: 'softmax' }] },
  }),
  (error) => error.translationKey === 'error.invalidProject',
  'persisted regression MLPs reject a final Softmax that browser execution cannot support',
);
const divergentMlpRegressionNodes = mlpRegressionNodes.map((node) => {
  if (node.id === 'mlp-reg-optimizer') return makeNode('mlp-reg-optimizer', 'sgd_optimizer_node', { learning_rate: 0.5, momentum: 0.99 });
  if (node.id === 'mlp-reg-trainer') return makeNode('mlp-reg-trainer', 'supervised_trainer_node', { epochs: 40, batch_size: 1, shuffle: true });
  return node;
});
await assert.rejects(
  executeBrowserGraph({
    nodes: divergentMlpRegressionNodes,
    edges: mlpRegressionEdges,
    dataset: {
      ...mlpRegressionDataset,
      rows: mlpRegressionDataset.rows.map((row) => ({ ...row, target: row.target * 1_000 })),
    },
  }),
  (error) => error.translationKey === 'error.browserMlpDiverged',
  'browser MLP training stops instead of returning a model with non-finite state',
);
const softmaxRegressionNodes = [
  ...mlpRegressionNodes.slice(0, 5),
  makeNode('mlp-reg-softmax', 'softmax_node'),
  ...mlpRegressionNodes.slice(5),
];
const softmaxRegressionEdges = mlpRegressionEdges.flatMap((edge) => (
  edge.source === 'mlp-reg-head' && edge.target === 'mlp-reg-output'
    ? [
      makeEdge('mlp-reg-head', 'output', 'mlp-reg-softmax', 'input'),
      makeEdge('mlp-reg-softmax', 'output', 'mlp-reg-output', 'input'),
    ]
    : [edge]
));
assert.equal(
  estimateExecutionPlan(softmaxRegressionNodes, mlpRegressionDataset, { edges: softmaxRegressionEdges }).canRunHere,
  false,
  'a one-unit Softmax regression head is rejected before it can silently stop learning',
);
const longMlpPlan = estimateExecutionPlan(
  mlpGraphNodes.map((node) => node.id === 'mlp-trainer' ? makeNode('mlp-trainer', 'supervised_trainer_node', { epochs: 10_000, batch_size: 16, shuffle: true }) : node),
  { ...classificationDataset, rows: Array.from({ length: 500 }, (_, index) => classificationDataset.rows[index % classificationDataset.rows.length]) },
);
assert.equal(longMlpPlan.recommendedTier, 'L1', 'total training work can escalate a small MLP above L0');
const halfSplitPlan = estimateExecutionPlan(
  mlpGraphNodes.map((node) => node.id === 'mlp-split' ? makeNode('mlp-split', 'train_test_split_node', { train_ratio: 0.5 }) : node),
  classificationDataset,
  { edges: mlpGraphEdges },
);
const ninetySplitPlan = estimateExecutionPlan(
  mlpGraphNodes.map((node) => node.id === 'mlp-split' ? makeNode('mlp-split', 'train_test_split_node', { train_ratio: 0.9 }) : node),
  classificationDataset,
  { edges: mlpGraphEdges },
);
assert.ok(halfSplitPlan.trainingOperations < ninetySplitPlan.trainingOperations, 'tier estimates read the connected split training ratio');
assert.throws(
  () => compilePipelineToPyTorch(classificationGraphNodes, classificationGraphEdges),
  (error) => error.translationKey === 'error.frameworkUnsupported',
  'KNN remains honestly marked as browser-only',
);

const localPlatform = validatePlatformServices(createLocalPlatformServices());
assert.equal(localPlatform.apiVersion, PLATFORM_API_VERSION);
assert.equal(localPlatform.projects.mode, 'indexeddb');
assert.equal(
  localPlatform.compute.canExecuteInBrowser(estimateExecutionPlan(regressionGraphNodes, regressionDataset, { edges: regressionGraphEdges })),
  true,
);
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

