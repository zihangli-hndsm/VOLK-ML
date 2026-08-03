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
for (const type of knownPortTypes) assert.ok(messages[`portType.${type}`], `${type} port role is localized`…5832 tokens truncated…andaloneLayerComposite.manifest.inputs[0].name;
const standaloneOutput = standaloneLayerComposite.manifest.outputs[0].name;
const connectedStandaloneNodes = [
  makeNode('standalone-source', 'tensor_input_node', { shape: '32' }),
  standaloneLayerComposite.instance,
  makeNode('standalone-sink', 'model_output_node'),
];
const connectedStandaloneEdges = [
  makeEdge('standalone-source', 'tensor', standaloneLayerComposite.instance.id, standaloneInput),
  makeEdge(standaloneLayerComposite.instance.id, standaloneOutput, 'standalone-sink', 'model'),
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
  name: { en: 'Invalid', zh: '鏃犳晥' },
  description: { en: 'Invalid fixture', zh: '鏃犳晥娴嬭瘯椤? },
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
      properties: [{ key: 'units', label: { en: 'Units', zh: '鍗曞厓' }, type: 'number', default: 'many' }],
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
const { test: omittedRegressionTest, ...persistedRegressionModel } = regressionModel;
assert.ok(omittedRegressionTest.length > 0);
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
assert.equal(estimateExecutionPlan(mlpGraphNodes, classificationDataset).canRunHere, true, 'small MLP is directly runnable in the browser');
assert.equal(mlpModel.type, 'browser_mlp');
assert.ok(mlpModel.metrics.accuracy >= 0.9, 'browser MLP classifies the separable exercise dataset');
assert.equal(predictWithModel(mlpModel, [3.1, 1.9]), 'positive');

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
const longMlpPlan = estimateExecutionPlan(
  mlpGraphNodes.map((node) => node.id === 'mlp-trainer' ? makeNode('mlp-trainer', 'supervised_trainer_node', { epochs: 10_000, batch_size: 16, shuffle: true }) : node),
  { ...classificationDataset, rows: Array.from({ length: 500 }, (_, index) => classificationDataset.rows[index % classificationDataset.rows.length]) },
);
assert.equal(longMlpPlan.recommendedTier, 'L1', 'total training work can escalate a small MLP above L0');
assert.throws(
  () => compilePipelineToPyTorch(classificationGraphNodes, classificationGraphEdges),
  (error) => error.translationKey === 'error.frameworkUnsupported',
  'KNN remains honestly marked as browser-only',
);

const localPlatform = validatePlatformServices(createLocalPlatformServices());
assert.equal(localPlatform.apiVersion, PLATFORM_API_VERSION);
assert.equal(localPlatform.projects.mode, 'indexeddb');
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

