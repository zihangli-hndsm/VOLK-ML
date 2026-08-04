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
import { analyzeBrowserExecutionGraph, profileBrowserDataset } from '../src/core/browserExecutionContract.js';
import { createCustomComposite, flattenCustomComposites, rebuildCompositeInstance } from '../src/core/customComposites.js';
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
  select
Node: async (nodeId) => ({ nodeId }),
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

assert.equal(resolveMessage(tutorialByOp.model_output.formula, 'zh'), 'model(x) = 选定的输出张量');
assert.equal(resolveMessage(tutorialByOp.cross_entropy_loss.formula, 'zh'), 'L = −log p(正确类别)');
assert.equal(resolveMessage(tutorialByOp.cross_entropy_loss.formula, 'en'), 'L = −log p(correct class)');
assert.equal(resolveMessage('playground.equation', 'zh', { weight: '2.00', operator: '−', bias: '1.00' }), 'ŷ = 2.00x − 1.00');
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
for (const type of knownPortTypes) assert.ok(messages[`portType.${type}`], `${type} port role is localized`);
const libraryTree = componentLibraryTree(pluginRegistry);
assert.deepEqual(libraryTree.map((group) => group.id), ['data', 'model', 'training', 'output']);
assert.equal(libraryTree.reduce((count, group) => count + group.count, 0), pluginRegistry.length);
assert.equal(safeProjectFilename('My Visual Project'), 'my-visual-project.volkml.json');
assert.deepEqual(lossExpressionFunctions, ['mean', 'sum', 'abs', 'square', 'sqrt', 'log', 'exp', 'clip']);
assert.ok(parseLossExpression('mean(square(prediction - target))'));
assert.throws(() => parseLossExpression('mean(square(target))'), /prediction/, 'custom loss must depend on prediction');
assert.throws(() => parseLossExpression('1'), /prediction/, 'numeric custom loss must depend on prediction');
assert.equal(
  compileLossExpression('mean(square(prediction - target))', 'pytorch'),
  'torch.mean(torch.square((prediction - target)))',
);
assert.equal(
  compileLossExpression('mean(abs(prediction - target)) + clip(0.1, 0, 1)', 'tensorflow'),
  '(tf.reduce_mean(tf.abs((prediction - target))) + tf.clip_by_value(0.1, 0, 1))',
);
assert.equal(
  compileLossExpression('-prediction ** 2', 'pytorch'),
  '(-(prediction ** 2))',
  'a leading unary sign applies after exponentiation',
);
assert.equal(
  compileLossExpression('prediction ** -2', 'tensorflow'),
  '(prediction ** (-2))',
  'a signed exponent remains valid',
);
assert.throws(() => parseLossExpression('prediction.__class__'), /unexpected/);
assert.throws(() => parseLossExpression('system(prediction)'), /function/);
const densePlaygroundPoints = Array.from({ length: 101 }, (_, x) => ({ x, y: 2 * x + 1 }));
const sampledPlaygroundPoints = uniformlySamplePoints(densePlaygroundPoints, 11);
assert.equal(sampledPlaygroundPoints.length, 11);
assert.deepEqual(sampledPlaygroundPoints[0], { x: 0, y: 1 });
assert.deepEqual(sampledPlaygroundPoints.at(-1), { x: 100, y: 201 });
assert.deepEqual(leastSquaresFit(densePlaygroundPoints), { weight: 2, bias: 1 });
assert.equal(meanSquaredError(densePlaygroundPoints, 2, 1), 0);
const playgroundDataset = regressionPointsFromDataset({
  task: 'regression',
  featureColumns: ['feature'],
  targetColumn: 'target',
  rows: densePlaygroundPoints.map((point) => ({ feature: point.x, target: point.y })),
}, 20);
assert.equal(playgroundDataset.usingDataset, true);
assert.equal(playgroundDataset.points.length, 20);
assert.equal(playgroundDataset.total, 101);
assert.notEqual(
  projectContentSignature({
    name: 'Model state',
    graph: { nodes: [], edges: [] },
    customComponents: [],
    data: null,
    trainedModel: { weights: [1] },
  }),
  projectContentSignature({
    name: 'Model state',
    graph: { nodes: [], edges: [] },
    customComponents: [],
    data: null,
    trainedModel: { weights: [2] },
  }),
  'trained model changes invalidate the downloaded project signature',
);

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
assert.equal(assessConnection({
  source: 'input', sourceHandle: 'tensor', target: 'dense', targetHandle: 'input',
}, architectureNodes, []).valid, true, 'matching semantic port types connect');
assert.equal(assessConnection({
  source: 'loss', sourceHandle: 'loss', target: 'dense', targetHandle: 'input',
}, architectureNodes, []).reason, 'type', 'different semantic port roles remain incompatible');
assert.equal(assessConnection({
  source: 'input', sourceHandle: 'tensor', target: 'dense', targetHandle: 'input',
}, architectureNodes, architectur
eEdges).reason, 'occupied', 'one input accepts one incoming edge');
assert.equal(assessConnection({
  source: 'relu', sourceHandle: 'output', target: 'input', targetHandle: 'tensor',
}, architectureNodes, architectureEdges).reason, 'missingPort');
assert.equal(assessConnection({
  source: 'output', sourceHandle: 'model', target: 'dense', targetHandle: 'input',
}, architectureNodes, architectureEdges).reason, 'type');
assert.equal(assessConnection({
  source: 'relu', sourceHandle: 'output', target: 'dense', targetHandle: 'input',
}, architectureNodes, architectureEdges.filter((edge) => edge.target !== 'dense')).reason, 'cycle', 'cycles are rejected before compilation');
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

const trainerNodes = [
  makeNode('trainer-data', 'tabular_data_node'),
  makeNode('trainer-split', 'train_test_split_node', { train_ratio: 0.75 }),
  makeNode('trainer-input', 'tensor_input_node', { shape: '2' }),
  makeNode('trainer-dense', 'dense_node', { input_features: 2, units: 1 }),
  makeNode('trainer-output', 'model_output_node'),
  makeNode('trainer-loss', 'custom_loss_node', { expression: 'mean(abs(prediction - target))' }),
  makeNode('trainer-optimizer', 'adam_optimizer_node', { learning_rate: 0.002 }),
  makeNode('trainer', 'supervised_trainer_node', { epochs: 12, batch_size: 8, shuffle: false }),
];
const trainerEdges = [
  makeEdge('trainer-data', 'dataset', 'trainer-split', 'dataset'),
  makeEdge('trainer-input', 'tensor', 'trainer-dense', 'input'),
  makeEdge('trainer-dense', 'output', 'trainer-output', 'input'),
  makeEdge('trainer-split', 'split', 'trainer', 'dataset'),
  makeEdge('trainer-output', 'model', 'trainer', 'model'),
  makeEdge('trainer-loss', 'loss', 'trainer', 'loss'),
  makeEdge('trainer-optimizer', 'optimizer', 'trainer', 'optimizer'),
];
assert.equal(assessConnection(
  trainerEdges[3],
  trainerNodes,
  trainerEdges.filter((edge) => edge !== trainerEdges[3]),
).valid, true, 'DatasetSplit connects to the trainer data input');
assert.equal(assessConnection({
  source: 'trainer-split', sourceHandle: 'split', target: 'trainer-input', targetHandle: 'input',
}, trainerNodes, trainerEdges).reason, 'missingPort', 'DatasetSplit does not bind directly to a symbolic Tensor Input');
const trainerTorch = compilePipelineToPyTorch(trainerNodes, trainerEdges);
const trainerTensorFlow = compilePipelineToTensorFlow(trainerNodes, trainerEdges);
assert.match(trainerTorch.code, /def custom_loss\(prediction, target\):\n    return torch\.mean\(torch\.mean\(torch\.abs/);
assert.match(trainerTorch.code, /DataLoader\(train_set, batch_size=8, shuffle=False\)/);
assert.match(trainerTorch.code, /model = model\.to\(dtype=torch\.float32\)/);
assert.match(trainerTorch.code, /features_tensor = torch\.tensor\(X, dtype=torch\.float32\)/);
assert.match(trainerTorch.code, /for epoch in range\(12\)/);
assert.match(trainerTensorFlow.code, /def custom_loss\(target, prediction\):\n    return tf\.reduce_mean\(tf\.reduce_mean\(tf\.abs/);
assert.match(trainerTensorFlow.code, /model\.fit\(X_train, y_train, epochs=12, batch_size=8, shuffle=False/);
assert.match(trainerTensorFlow.code, /def volk_deterministic_indices\(length, seed=2026\):/);
assert.match(trainerTensorFlow.code, /train_indices, test_indices = indices\[:split_index\], indices\[split_index:\]/);
assert.match(trainerTensorFlow.code, /X_train, X_test = X\[train_indices\], X\[test_indices\]/);
assert.match(trainerTensorFlow.code, /y_train, y_test = y\[train_indices\], y\[test_indices\]/);
assert.ok(trainerTorch.report.some((item) => item.componentId === 'supervised_trainer_node'));
assert.ok(trainerTensorFlow.report.some((item) => item.componentId === 'custom_loss_node'));
assertPythonSyntax(trainerTorch.code, 'Supervised Trainer PyTorch');
assertPythonSyntax(trainerTensorFlow.code, 'Supervised Trainer TensorFlow');
assert.doesNotThrow(
  () => compilePipelineToPyTorch([
    ...trainerNodes,
    makeNode('orphan-invalid-loss', '
custom_loss_node', { expression: 'eval(prediction)' }),
  ], trainerEdges),
  'an unconnected custom loss does not override the loss connected to the trainer',
);
assert.equal(estimateExecutionPlan(trainerNodes, null).recommendedTier, 'L2');
assert.equal(estimateExecutionPlan(trainerNodes, null).canRunHere, false);
const invalidLossNodes = trainerNodes.map((node) => node.id === 'trainer-loss'
  ? makeNode('trainer-loss', 'custom_loss_node', { expression: 'eval(prediction)' })
  : node);
assert.throws(
  () => compilePipelineToPyTorch(invalidLossNodes, trainerEdges),
  (error) => error.translationKey === 'error.customLossFunction',
  'custom loss rejects arbitrary function calls',
);
assert.throws(
  () => compilePipelineToTensorFlow(trainerNodes, trainerEdges.filter((edge) => edge.targetHandle !== 'optimizer')),
  (error) => error.translationKey === 'error.trainerInputsRequired',
  'trainer compilation requires each typed input',
);
assert.throws(
  () => compilePipelineToPyTorch(trainerNodes, trainerEdges.filter((edge) => edge.targetHandle !== 'model')),
  (error) => error.translationKey === 'error.trainerInputsRequired',
  'an incomplete trainer fails before legacy tabular fallback',
);
assert.throws(
  () => compilePipelineToPyTorch(
    [...trainerNodes, makeNode('legacy-model', 'linear_regression_node')],
    [
      ...trainerEdges.filter((edge) => edge.targetHandle !== 'model'),
      makeEdge('trainer-split', 'split', 'legacy-model', 'split'),
      makeEdge('legacy-model', 'model', 'trainer', 'model'),
    ],
  ),
  (error) => error.translationKey === 'error.trainerSingleInputOutput',
  'trainer rejects a type-valid non-architecture ModelSpec before tabular fallback',
);
const halfPrecisionTrainerNodes = trainerNodes.map((node) => node.id === 'trainer-input'
  ? makeNode('trainer-input', 'tensor_input_node', { shape: '2', dtype: 'float16' })
  : node);
const halfPrecisionTrainer = compilePipelineToPyTorch(halfPrecisionTrainerNodes, trainerEdges);
assert.match(halfPrecisionTrainer.code, /model = model\.to\(dtype=torch\.float16\)/);
assert.match(halfPrecisionTrainer.code, /target_tensor = torch\.tensor\(y, dtype=torch\.float16\)/);
const integerTrainerNodes = trainerNodes.map((node) => node.id === 'trainer-input'
  ? makeNode('trainer-input', 'tensor_input_node', { shape: '2', dtype: 'int32' })
  : node);
assert.throws(
  () => compilePipelineToTensorFlow(integerTrainerNodes, trainerEdges),
  (error) => error.translationKey === 'error.trainerUnsupportedDtype',
  'trainer rejects unsupported Tensor Input dtypes consistently across backends',
);
const secondTrainer = makeNode('trainer-two', 'supervised_trainer_node');
assert.throws(
  () => compilePipelineToPyTorch(
    [...trainerNodes, secondTrainer],
    [...trainerEdges, makeEdge('trainer-split', 'split', 'trainer-two', 'dataset')],
  ),
  (error) => error.translationKey === 'error.multipleTrainers',
  'two connected trainers are rejected as an ambiguous export target',
);

const composite = makeNode('block', 'mlp_block_node', { input_features: 16, hidden_units: 24, dropout: 0.3 });
const expansion = expandComposite(composite);
assert.equal(expansion.nodes.length, 3);
assert.equal(expansion.edges.length, 2);
assert.equal(expansion.inputs.input.length, 1);
assert.ok(expansion.outputs.output.nodeId);
assert.equal(expansion.nodes[0].data.parameters.units, 24);

const rebuiltComposite = rebuildCompositeInstance({
  origin: {
    id: composite.id,
    label: composite.data.label,
    manifest: composite.data.manifest,
    parameters: composite.data.parameters,
    position: composite.position,
  },
  groupNodes: expansion.nodes.filter((node) => node.data.compositionKey !== 'dropout'),
  edges: expansion.edges,
});
assert.equal(
  rebuiltComposite.manifest.composition.nodes.some((node) => node.key === 'dropout'),
  false,
  'folding after deleting a child persists the reduced composition',
);
assert.equal(
  rebuiltComposite.manifest.composition.edges.length,
  1,
  'folding after deleting a child persists the reduced internal links',
);
const metadataNode = {
  ...expansion.nodes[0],
  data: {
    ...expansion.nodes[0].data,
    manifest: {
      ...expansion.nodes[0].data.manifest,
      runtime: { ...expansion.nodes[0].data.manifest.runtime, minimumTier: 'L2', browserBackend: 'none' },
      compatibility: { pytorch: 'unsupported', tensorflow: 'adapted' },
    },
  },
};
const rebuiltMetadata = rebuildCompositeInstance({
  origin: {
    id: composite.id,
    label: composite.data.label,
    manifest: composite.data.manifest,
    parameters: composite.data.parameters,
    position: composite.position,
  },
  groupNodes: [metadataNode, expansion.nodes[1]],
  edges: expansion.edges.filter((edge) => edge.source === metadataNode.id || edge.target === metadataNode.id),
});
assert.equal(rebuiltMetadata.manifest.runtime.minimumTier, 'L2');
assert.equal(rebuiltMetadata.manifest.runtime.browserBackend, 'none');
assert.equal(rebuiltMetadata.manifest.compatibility.pytorch, 'unsupported');
const foldedBuiltinNode = {
  id: 'folded-builtin-instance',
  type: 'pipelineNode',
  position: rebuiltComposite.position,
  data: { manifest: rebuiltComposite.manifest, parameters: rebuiltComposite.parameters },
};
const validatedFoldedBuiltin = validateProjectForWorkspace({
  format: 'VOLK-ML', version: PROJECT_VERSION, name: 'folded builtin',
  graph: { nodes: [foldedBuiltinNode], edges: [] },
  customComponents: [], data: null, trainedModel: null,
});
assert.equal(validatedFoldedBuiltin.graph.nodes[0].data.manifest.customComposite, true);
assert.equal(
  validatedFoldedBuiltin.graph.nodes[0].data.manifest.composition.nodes.some((node) => node.key === 'dropout'),
  false,
  'embedded folded composite definitions survive project validation without the catalogue template',
);
assert.ok(
  rebuiltComposite.manifest.composition.nodes.some((node) => node.parameters.units === '$hidden_units'),
  'unchanged child parameters retain their parent property binding',
);
const changedDense = {
  ...expansion.nodes[0],
  data: { ...expansion.nodes[0].data, parameters: { ...expansion.nodes[0].data.parameters, units: 99 } },
};
const detachedBinding = rebuildCompositeInstance({
  origin: {
    id: composite.id, label: composite.data.label, manifest: composite.data.manifest,
    parameters: composite.data.parameters, position: composite.position,
  },
  groupNodes: [changedDense, expansion.nodes[1]],
  edges: expansion.edges.filter((edge) => edge.source === changedDense.id || edge.target === changedDense.id),
});
assert.equal(detachedBinding.manifest.composition.nodes.find((node) => node.key === 'dense').parameters.units, 99);
assert.equal(
  detachedBinding.manifest.properties.some((property) => property.key === 'hidden_units'),
  false,
  'diverging child parameters detach and remove their stale parent property control',
);

const browserNodes = [
  makeNode('data', 'tabular_data_node'),
  makeNode('split', 'train_test_split_node'),
  makeNode('linear', 'linear_regression_node'),
  makeNode('train', 'gradient_descent_node'),
];
assert.deepEqual(estimateExecutionPlan(browserNodes, null).recommendedTier, 'L0');
assert.equal(estimateExecutionPlan(browserNodes, null).canRunHere, false, 'a tier estimate without a connected graph and usable data is not executable');
assert.equal(estimateExecutionPlan(architectureNodes, null).recommendedTier, 'L0');
assert.equal(estimateExecutionPlan(architectureNodes, null).canRunHere, false, 'an architecture without a complete browser training graph cannot run');
assert.equal(
  estimateExecutionPlan([makeNode('oversized-dense', 'dense_node', { input_features: 1000, units: 101 })], null).recommendedTier,
  'L1',
  'a CPU-capable neural component still escalates when it exceeds the L0 parameter boundary',
);
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
const invalidRegressionAnalysis = analyzeBrowserExecutionGraph({
  nodes: regressionGraphNodes,
  edges: regressionGraphEdges.filter((edge) => edge.target !== 'reg-model'),
  dataset: regressionDataset,
});
assert.equal(invalidRegressionAnalysis.valid, false);
assert.deepEqual(invalidRegressionAnalysis.nodeIds, ['reg-model']);
const regressionModel = await executeBrowserGraph({
  nodes: regressionGraphNodes,
  edges: regressionGraphEdges,
  dataset: regressionDataset,
});
assert.equal(
  estimateExecutionPlan(regressionGraphNodes, regressionDataset, { edges: regressionGraphEdges }).canRunHere,
  true,
  'a complete regression execution contract is directly runnable',
);
assert.equal(regressionModel.type, 'linear_regression');
assert.ok(Number.isFinite(regressionModel.metrics.rmse), 'regression browser backend returns RMSE');
assert.ok(Number.isFinite(predictWithModel(regressionModel, [10, 3])), 'regression predictor returns a number');
assert.equal(architectureLayout(regressionGraphNodes, regressionGraphEdges).length, 5);
const regressionAnalysis = analyzeProject(regressionGraphNodes, regressionGraphEdges);
assert.equal(regressionAnalysis.nodeCount, regressionGraphNodes.length);
assert.equal(regressionAnalysis.edgeCount, regressionGraphEdges.length);
assert.equal(regressionAnalysis.missingInputs.length, 0);
assert.throws(() => createCustomComposite({
  selectedNodes: [
    regressionGraphNodes[0],
    regressionGraphNodes[1],
    makeNode('disconnected-custom-node', 'dense_node'),
  ],
  edges: regressionGraphEdges,
  name: 'Invalid disconnected group',
  color: '#2563eb',
}), /error\.compositeSelection/);

const standaloneLayerComposite = createCustomComposite({
  selectedNodes: [
    makeNode('standalone-dense', 'dense_node', { input_features: 32, units: 10 }),
    makeNode('standalone-relu', 'relu_node'),
  ],
  edges: [
    makeEdge('standalone-dense', 'output', 'standalone-relu', 'input'),
  ],
  name: 'Standalone hidden layer',
  color: '#2563eb',
});
assert.deepEqual(
  standaloneLayerComposite.manifest.inputs.map((port) => port.type),
  ['Tensor'],
  'an unconnected composite exposes child inputs not satisfied internally',
);
assert.deepEqual(
  standaloneLayerComposite.manifest.outputs.map((port) => port.type),
  ['Tensor'],
  'an unconnected composite exposes child outputs not consumed internally',
);
const standaloneInput = standaloneLayerComposite.manifest.inputs[0].name;
const standaloneOutput = standaloneLayerComposite.manifest.outputs[0].name;
const connectedStandaloneNodes = [
  makeNode('standalone-source', 'tensor_input_node', { shape: '32' }),
  standaloneLayerComposite.instance,
  makeNode('standalone-sink', 'model_output_node'),
];
const connectedStandaloneEdges = [
  makeEdge('standalone-source', 'tensor', standaloneLayerComposite.instance.id, standaloneInput),
  makeEdge(standaloneLayerCom
posite.instance.id, standaloneOutput, 'standalone-sink', 'model'),
];
const flattenedStandalone = flattenCustomComposites(
  connectedStandaloneNodes,
  connectedStandaloneEdges,
);
assert.equal(
  flattenedStandalone.edges.some((edge) => (
    edge.source === 'standalone-source'
    && edge.targetHandle === 'input'
  )),
  true,
  'flattening redirects a new external input to the first child',
);
assert.equal(
  flattenedStandalone.edges.some((edge) => (
    edge.target === 'standalone-sink'
    && edge.sourceHandle === 'output'
  )),
  true,
  'flattening redirects a new external output from the final child',
);

const customRegression = createCustomComposite({
  selectedNodes: regressionGraphNodes.filter((node) => ['reg-split', 'reg-model'].includes(node.id)),
  edges: regressionGraphEdges,
  name: 'Reusable regression core',
  color: '#2563eb',
});
assert.equal(customRegression.manifest.customComposite, true);
assert.equal(customRegression.manifest.inputs.length, 1);
assert.equal(customRegression.manifest.outputs.length, 1);
const customRegressionNodes = [
  ...regressionGraphNodes.filter((node) => !['reg-split', 'reg-model'].includes(node.id)),
  customRegression.instance,
];
const flattenedCustom = flattenCustomComposites(customRegressionNodes, customRegression.nextEdges);
assert.equal(flattenedCustom.nodes.length, regressionGraphNodes.length);
assert.equal(
  estimateExecutionPlan(customRegressionNodes, regressionDataset).recommendedTier,
  estimateExecutionPlan(regressionGraphNodes, regressionDataset).recommendedTier,
  'folding a custom composite does not change execution-tier guidance',
);
assert.match(
  compilePipelineToPyTorch(customRegressionNodes, customRegression.nextEdges).code,
  /load_tabular_data/,
);
const customRegressionModel = await executeBrowserGraph({
  nodes: customRegressionNodes,
  edges: customRegression.nextEdges,
  dataset: regressionDataset,
});
assert.equal(customRegressionModel.type, 'linear_regression');
const nestedCustomRegression = createCustomComposite({
  selectedNodes: [
    customRegression.instance,
    regressionGraphNodes.find((node) => node.id === 'reg-train'),
  ],
  edges: customRegression.nextEdges,
  name: 'Nested trainable regression',
  color: '#8b5cf6',
});
assert.ok(
  nestedCustomRegression.manifest.composition.nodes.some((node) => node.manifest?.customComposite),
  'nested custom definitions embed their child manifest',
);
const nestedCustomNodes = [
  ...customRegressionNodes.filter((node) => ![
    customRegression.instance.id,
    'reg-train',
  ].includes(node.id)),
  nestedCustomRegression.instance,
];
assert.equal(
  flattenCustomComposites(nestedCustomNodes, nestedCustomRegression.nextEdges)
    .nodes.some((node) => node.data.manifest.customComposite),
  false,
  'nested custom composites flatten recursively',
);
assert.match(
  compilePipelineToTensorFlow(nestedCustomNodes, nestedCustomRegression.nextEdges).code,
  /load_tabular_data/,
);
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
assert.equal(migratedKnnProject.name, 'Sample Project');
assert.deepEqual(migratedKnnProject.customComponents, []);
assert.equal(migratedKnnProject.graph.edges.length, 1);
assert.equal(migratedKnnProject.graph.edges[0].sourceHandle, 'trained_model');

assert.throws(
  () => validateProjectForWorkspace({
    format: 'VOLK-ML',
    version: PROJECT_VERSION,
    name: {},
    graph: { nodes: [], edges: [] },
    customComponents: [],
  }),
  (error) => error.translationKey === 'error.invalidProject',
  'workspace project validation must reject unsafe names before applying state',
);
assert.equal(validateProjectForWorkspace({
  ...agentProject,
  customComponents: [],
}).name, 'Agent test');
const malformedCustomManifest = {
  id: 'custom_invalid',
  name: { en: 'Invalid', zh: '无效' },
  description: { en: 'Invalid fixture', zh: '无效测试项' },
  inputs: [null],
  outputs: [],
  properties: [],
};
assert.throws(
  () => validateProjectForWorkspace({ ...agentProject, customComponents: [malformedCustomManifest] }),
  (error) => error.translationKey === 'error.invalidProject',
  'workspace project validation must inspect custom component ports',
);
assert.throws(
  () => validateProjectForWorkspace({
    ...agentProject,
    customComponents: [{
      ...malformedCustomManifest,
      inputs: [],
      properties: [{ key: 'units', label: { en: 'Units', zh: '单元' }, type: 'number', default: 'many' }],
    }],
  }),
  (error) => error.translationKey === 'error.invalidProject',
  'workspace project validation must inspect custom component properties',
);
assert.throws(
  () => validateProjectForWorkspace({
    ...agentProject,
    graph: {
      ...agentProject.graph,
      nodes: agentProject.graph.nodes.map((node) => node.id === agentDense.id
        ? { ...node, data: { ...node.data, parameters: { ...node.data.parameters, units: 1.5 } } }
        : node),
    },
  }),
  (error) => error.translationKey === 'error.invalidProject',
  'workspace project validation must apply manifest parameter steps',
);
const duplicateInputSource = { ...agentInput, id: 'agent-input-duplicate', position: { x: 10, y: 180 } };
assert.throws(
  () => validateProjectForWorkspace({
    ...agentProject,
    graph: {
      nodes: [...agentProject.graph.nodes, duplicateInputSource],
      edges: [
        ...agentProject.graph.edges,
        makeEdge(duplicateInputSource.id, 'tensor', agentDense.id, 'input'),
      ],
    },
  }),
  (error) => error.translationKey === 'error.invalidProject',
  'workspace project validation must enforce one incoming edge per input',
);
assert.throws(
  () => validateProjectForWorkspace({
    ...agentProject,
    graph: {
      ...agentProject.graph,
      edges: agentProject.graph.edges.map((edge) => ({ ...edge, sourceHandle: 'bogus' })),
    },
  }),
  (error) => error.translationKey === 'error.invalidProject',
  'workspace project validation must require exact persisted handles',
);
assert.equal(validateProjectForWorkspace({
  ...agentProject,
  customComponents: [customRegression.manifest],
}).customComponents.length, 1);
assert.throws(
  () => validateProjectForWorkspace({
    ...agentProject,
    customComponents: [{ ...customRegression.manifest, composition: null }],
  }),
  (error) => error.translationKey === 'error.invalidProject',
  'workspace project validation must inspect custom composite structure',
);
const duplicatedBoundaryManifest = structuredClone(customRegression.manifest);
const originalBoundaryInput = duplicatedBoundaryManifest.inputs[0];
duplicatedBoundaryManifest.inputs.push({ name: 'duplicate_input', type: originalBoundaryInput.type });
duplicatedBoundaryManifest.composition.inputs.duplicate_input = structuredClone(
  duplicatedBoundaryManifest.composition.inputs[originalBoundaryInput.name],
);
assert.throws(
  () => validateProjectForWorkspace({ ...agentProject, customComponents: [duplicatedBoundaryManifest] }),
  (error) => error.translationKey === 'error.invalidProject',
  'workspace project validation must reject duplicate composite boundary targets',
);
const catalogOnlyNestedManifest = structuredClone(customRegression.manifest);
catalogOnlyNestedManifest.id = 'custom_nested_catalog_only';
const parentWithCatalogOnlyChild = structuredClone(customRegression.manifest);
parentWithCatalogOnlyChild.id = 'custom_parent_catalog_only';
parentWithCatalogOnlyChild.composition.nodes[0].componentId = catalogOnlyNestedManifest.id;
delete parentWithCatalogOnlyChild.composition.nodes[0].manifest;
assert.throws(
  () => validateProjectForWorkspace({
    ...agentProject,
    customComponents: [catalogOnlyNestedManifest, parentWithCatalogOnlyChild],
  }),
  (error) => error.translationKey === 'error.invalidProject',
  'workspace project validation must require embedded nested custom manifests',
);
assert.throws(
  () => validateProjectForWorkspace({
    ...agentProject,
    customComponents: [{ ...customRegression.manifest, visualStage: 'bogus' }],
  }),
  (error) => error.translationKey === 'error.invalidProject',
  'workspace project validation must reject unknown custom visual stages',
);
assert.throws(
  () => validateProjectForWorkspace({ ...agentProject, trainedModel: { hasPredictor: true } }),
  (error) => error.translationKey === 'error.invalidProject',
  'workspace project validation must reject malformed trained models',
);
const persistedRegressionModel = regressionModel;
assert.equal(validateProjectForWorkspace({
  format: 'VOLK-ML',
  version: PROJECT_VERSION,
  name: 'Persisted regression model',
  graph: { nodes: regressionGraphNodes, edges: regressionGraphEdges },
  customComponents: [],
  data: regressionDataset,
  trainedModel: persistedRegressionModel,
}).trainedModel.type, 'linear_regression');
assert.throws(
  () => validateProjectForWorkspace({
    format: 'VOLK-ML',
    version: PROJECT_VERSION,
    name: 'Stale regression model',
    graph: { nodes: regressionGraphNodes, edges: regressionGraphEdges },
    customComponents: [],
    data: regressionDataset,
    trainedModel: { ...persistedRegressionModel, sourceNodeId: 'missing-training-node' },
  }),
  (error) => error.translationKey === 'error.invalidProject',
  'workspace project validation must bind trained models to graph nodes',
);

const legacySamplePositions = {
  'pipeline-data': [40, 180],
  'pipeline-split': [340, 180],
  'pipeline-linear': [650, 180],
  'pipeline-optimizer': [960, 180],
  'pipeline-evaluate': [1270, 70],
  'pipeline-predictor': [1270, 300],
};
const legacySampleProject = {
  format: 'VOLK-ML',
  version: 6,
  name: 'Sample Project',
  customComponents: [],
  graph: {
    nodes: Object.entries(legacySamplePositions).map(([id, [x, y]]) => ({ id, position: { x, y } })),
    edges: [],
  },
};
const migratedSampleProject = migrateProject(legacySampleProject);
assert.deepEqual(
  migratedSampleProject.graph.nodes.find((node) => node.id === 'pipeline-linear').position,
  { x: 920, y: 220 },
  'the untouched sample project receives wider component spacing',
);
const arrangedSampleProject = structuredClone(legacySampleProject);
arrangedSampleProject.graph.nodes[0].position.x = 41;
assert.equal(
  migrateProject(arrangedSampleProject).graph.nodes.find((node) => node.id === 'pipeline-linear').position.x,
  650,
  'a user-arranged sample graph keeps its positions',
);

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
    const offset = Ma
th.floor(index / 2) * 0.01;
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
assert.equal(
  estimateExecutionPlan(classificationGraphNodes, classificationDataset, { edges: classificationGraphEdges }).canRunHere,
  true,
  'a complete KNN classification contract is directly runnable',
);
assert.equal(
  estimateExecutionPlan(regressionGraphNodes, classificationDataset, { edges: regressionGraphEdges }).canRunHere,
  false,
  'linear regression is not advertised for a classification dataset',
);
const incompleteKnnNodes = [
  makeNode('incomplete-data', 'tabular_data_node'),
  makeNode('incomplete-knn', 'knn_node'),
  makeNode('incomplete-evaluate', 'evaluate_classification_node'),
];
const incompleteKnnEdges = [makeEdge('incomplete-knn', 'trained_model', 'incomplete-evaluate', 'trained_model')];
assert.equal(
  estimateExecutionPlan(incompleteKnnNodes, classificationDataset, { edges: incompleteKnnEdges }).canRunHere,
  false,
  'KNN requires its own connected Tabular Data input',
);

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
await assert.rejects(
  executeBrowserGraph({
    nodes: classificationGraphNodes,
    edges: classificationGraphEdges,
    dataset: {
      ...classificationDataset,
      name: 'singleton-classes-check',
      rows: [
        { feature_a: 0, feature_b: 0, label: 'first' },
        { feature_a: 1, feature_b: 1, label: 'second' },
        { feature_a: 2, feature_b: 2, label: 'third' },
      ],
    },
  }),
  (error) => error.translationKey === 'error.classificationTestRequired',
  'classification rejects a stratified split with no test samples',
);

const mlpGraphNodes = [
  makeNode('mlp-data', 'tabular_data_node'),
  makeNode('mlp-split', 'train_test_split_node', { train_ratio: 0.8 }),
  makeNode('mlp-input', 'tensor_input_node', { shape: '2', dtype: 'float32' }),
  makeNode('mlp-hidden', 'dense_node', { input_features: 2, units: 6, use_bias: true }),
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
const exportedBrowserMlpTorch = compilePipelineToPyTorch(mlpGraphNodes, mlpGraphEdges);
const exportedBrowserMlpTensorflow = compilePipelineToTensorFlow(mlpGraphNodes, mlpGraphEdges);
assert.match(exportedBrowserMlpTorch.code, /nn\.NLLLoss\(\)\(torch\.log\(prediction\.clamp_min\(1e-12\)\), target\)/, 'Softmax classification exports probability-aware PyTorch cross entropy');
assert.match(exportedBrowserMlpTensorflow.code, /SparseCategoricalCrossentropy\(from_logits=False\)/, 'Softmax classification exports probability-aware TensorFlow cross entropy');

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
  node.id === 'mlp-loss' ? makeNode(
'mlp-loss', 'binary_cross_entropy_loss_node') : node
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
const batchSoftmaxAxisNodes = mlpGraphNodes.map((node) => (
  node.id === 'mlp-softmax' ? makeNode('mlp-softmax', 'softmax_node', { axis: 0 }) : node
));
assert.equal(
  estimateExecutionPlan(batchSoftmaxAxisNodes, classificationDataset, { edges: mlpGraphEdges }).canRunHere,
  false,
  'tier guidance rejects batch-axis Softmax because browser MLPs execute one sample at a time',
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

console.
log(`Validated ${pluginRegistry.length} usable components and tutorials, every architecture compiler mapping, both browser pipelines, platform services, localization, and execution tiers.`);

