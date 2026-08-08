import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
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
  buildRegressionTrainingHistory,
  fallbackRegressionPoints,
  gradientDescentStep,
  leastSquaresFit,
  meanSquaredError,
  regressionGradient,
  regressionPointsFromDataset,
  uniformlySamplePoints,
} from '../src/core/linearRegressionPlayground.js';
import {
  createLinearRegressionTrainer,
  normalizeLinearParameters,
  stepLinearRegressionTrainer,
} from '../src/core/linearRegressionMath.js';
import { getPlayground, listPlaygrounds, playgroundsFor } from '../src/core/playgrounds/registry.js';
import {
  createPlaygroundSession,
  derivePlaygroundSnapshot,
  dispatchPlaygroundAction,
  validateControlValue,
} from '../src/core/playgrounds/session.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createPlaygroundAgentApi } from '../src/core/playgroundAgent.js';
import { listModelAdapters } from '../src/core/playground/model/modelRegistry.js';
import { validateTraceEvent } from '../src/core/playground/trace/traceTypes.js';
import { validatePrimitive } from '../src/core/playground/visualization/primitives.js';
import { listPresets, getPreset } from '../src/core/playground/visualization/presetRegistry.js';
import { validateScript } from '../src/core/playground/visualization/scriptValidator.js';
import { createScriptRuntime } from '../src/core/playground/visualization/scriptRuntime.js';
import { dryRunScript } from '../src/core/playground/agent/dryRun.js';
import { planTeachingGoal } from '../src/core/playground/agent/teachingPlanner.js';
import { composeScriptFromPlan } from '../src/core/playground/agent/teachingComposer.js';
import {
  estimateCompiledStepCost,
  findOperationByIntent,
  TEACHING_PHASE_KINDS,
  validatePlanAgainstContext,
  validateTeachingPlan,
  validateTeachingControlValue,
} from '../src/core/playground/agent/teachingPlan.js';
import { parseTeachingGoalText } from '../src/core/playground/agent/teachingGoalParser.js';
import { materializePrimitives } from '../src/core/playground/visualization/primitiveMaterializer.js';
import {
  evaluateGoalFidelity,
  replayScriptForFidelity,
} from '../src/core/playground/agent/teachingFidelity.js';
import {
  getSupportedTeachingObjectives,
  TEACHING_OBJECTIVES,
} from '../src/core/playground/agent/teachingTaxonomy.js';
import { BINDING_TRANSFORMS, createBindingContext, resolveValue } from '../src/core/playground/visualization/bindings.js';
import { SCRIPT_ERROR_CODES } from '../src/core/playground/visualization/scriptErrors.js';
import { resolveLanguagePreference } from '../src/core/languagePolicy.js';
import { getModelAdapter } from '../src/core/playground/model/modelRegistry.js';
import { getPrimitiveSchema, listPrimitiveSchemas, validatePrimitiveContract } from '../src/core/playground/visualization/schemas.js';
import { PRIMITIVE_TYPES } from '../src/core/playground/visualization/primitives.js';
import { TRACE_EVENTS, TRACE_PAYLOAD_SCHEMAS } from '../src/core/playground/trace/traceTypes.js';
import { RESOURCE_LIMITS } from '../src/core/playground/visualization/scriptValidator.js';
import { validateType } from '../src/core/playground/visualization/typeContracts.js';
import { validateTracePayload } from '../src/core/playground/trace/traceTypes.js';
import {
  buildProjectionVector,
  computeTestAccuracy,
  DEFAULT_KNN_SEED,
  predictKnn,
  rankNeighbors,
  refitKnnFromSplit,
  voteNeighbors,
} from '../src/core/knnMath.js';
import { migrateProject, PROJECT_VERSION, projectContentSignature, validateProjectForWorkspace } from '../src/core/project.js';
import { estimateExecutionPlan } from '../src/core/runtimeTiers.js';
import { tutorialByOp } from '../src/core/tutorials.js';
import { exampleMetadata } from '../src/core/exampleProjects.js';
import { teachingDatasetById } from '../src/core/teachingDatasets.js';
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
  const python = ['python3', 'python'].find((candidate) => spawnSync(candidate, ['--version'], { encoding: 'utf-8' }).status === 0) ?? 'python3';
  const result = spawnSync(
    python,
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
assert.equal(fakeAgentApi.capabilities?.playground, 1, 'canvas agent advertises the playground capability');
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
  playground: { apiVersion: 1, marker: 'pg' },
} });
assert.equal(secondAgentApi.playground?.marker, 'pg', 'canvas agent exposes the optional playground namespace');
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
assert.equal(resolveMessage('playground.formula.knn', 'zh', { k: '5', nearest: '1.732' }), 'd² = Σ(xᵢ − qᵢ)² · k = 5 · 最近邻距离 = 1.732');
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
}, architectureNodes, architectureEdges).reason, 'occupied', 'one input accepts one incoming edge');
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
    makeNode('orphan-invalid-loss', 'custom_loss_node', { expression: 'eval(prediction)' }),
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
const emptyGraphAnalysis = analyzeBrowserExecutionGraph({
  nodes: regressionGraphNodes,
  edges: [],
  dataset: regressionDataset,
});
assert.equal(emptyGraphAnalysis.valid, false);
assert.deepEqual(emptyGraphAnalysis.nodeIds, [], 'graph-level validation failures do not attribute every node');
const missingDatasetAnalysis = analyzeBrowserExecutionGraph({
  nodes: regressionGraphNodes,
  edges: regressionGraphEdges,
});
assert.equal(missingDatasetAnalysis.valid, false);
assert.deepEqual(missingDatasetAnalysis.nodeIds, [], 'dataset-level validation failures do not highlight a component');
const wrongEvaluatorAnalysis = analyzeBrowserExecutionGraph({
  nodes: [...regressionGraphNodes, makeNode('reg-eval-class', 'evaluate_classification_node')],
  edges: [...regressionGraphEdges, makeEdge('reg-train', 'trained_model', 'reg-eval-class', 'trained_model')],
  dataset: regressionDataset,
});
assert.equal(wrongEvaluatorAnalysis.valid, false);
assert.deepEqual(wrongEvaluatorAnalysis.nodeIds, ['reg-eval-class'], 'a wrong evaluator highlights only the evaluator component');
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

// ---- Playground framework ----
{
  const lrPlayground = getPlayground('linear-regression');
  const knnPlayground = getPlayground('knn-classification');
  const lrSource = {
    kind: 'example',
    name: 'Example',
    fingerprint: 'lr-test',
    points: fallbackRegressionPoints.map((point, index) => ({ id: `e${index}`, x: point.x, y: point.y })),
    feature: 'x',
    target: 'y',
  };

  // Registry
  const playgroundIds = listPlaygrounds().map((playground) => playground.id);
  assert.equal(new Set(playgroundIds).size, playgroundIds.length, 'playground IDs are unique');
  assert.ok(playgroundIds.includes('linear-regression') && playgroundIds.includes('knn-classification'));
  for (const playground of listPlaygrounds()) {
    assert.ok(Number.isInteger(playground.version) && playground.version >= 1, `${playground.id} has a version`);
    assert.ok(playground.titleKey && playground.descriptionKey, `${playground.id} has localized keys`);
    assert.ok(playground.actions.length > 0, `${playground.id} declares actions`);
    assert.ok(playground.controls.length > 0, `${playground.id} declares controls`);
    for (const control of playground.controls) {
      assert.ok(control.key && ['number', 'boolean', 'select'].includes(control.type), `${playground.id} control schema`);
    }
    for (const key of [playground.titleKey, playground.descriptionKey]) {
      assert.ok(messages[key]?.en && messages[key]?.zh, `${key} is localized in both languages`);
    }
  }
  assert.deepEqual(playgroundsFor({ manifest: { op: 'linear_regression' } }).map((item) => item.id), ['linear-regression']);
  assert.deepEqual(playgroundsFor({ manifest: { op: 'knn_classifier' } }).map((item) => item.id), ['knn-classification']);
  assert.equal(playgroundsFor({ manifest: { op: 'dense' } }).length, 0, 'non-matching models expose no playground');
  assert.equal(
    playgroundsFor({ manifest: { op: 'knn_classifier' }, dataset: { task: 'regression' } }).length,
    1,
    'a dataset task alone does not widen playground availability',
  );

  // Session basics: cloneable snapshots, immutable inputs, deterministic replay.
  const baseSession = createPlaygroundSession(lrPlayground, { source: lrSource, seed: 7 });
  const baseClone = structuredClone(baseSession);
  dispatchPlaygroundAction(baseSession, { type: 'SET_CONTROL', key: 'bias', value: 3 });
  assert.deepEqual(baseSession, baseClone, 'dispatch does not mutate its input session');
  assert.doesNotThrow(() => structuredClone(derivePlaygroundSnapshot(baseSession)), 'playground snapshots are structured-cloneable');
  assert.throws(
    () => dispatchPlaygroundAction(baseSession, { type: 'NOT_AN_ACTION' }),
    (error) => error.code === 'INVALID_PLAYGROUND_ACTION',
  );
  assert.throws(
    () => dispatchPlaygroundAction(baseSession, { type: 'SET_CONTROL', key: 'missing', value: 1 }),
    (error) => error.code === 'INVALID_PLAYGROUND_CONTROL',
  );
  assert.throws(
    () => dispatchPlaygroundAction(baseSession, { type: 'SET_CONTROL', key: 'weight', value: 'abc' }),
    (error) => error.code === 'INVALID_PLAYGROUND_CONTROL',
  );
  const seededA = dispatchPlaygroundAction(
    createPlaygroundSession(lrPlayground, { source: lrSource, seed: 3, sessionId: 'deterministic' }),
    { type: 'START_TRAINING' },
  );
  const seededB = dispatchPlaygroundAction(
    createPlaygroundSession(lrPlayground, { source: lrSource, seed: 3, sessionId: 'deterministic' }),
    { type: 'START_TRAINING' },
  );
  assert.deepEqual(derivePlaygroundSnapshot(seededA), derivePlaygroundSnapshot(seededB), 'same seed and actions replay identically');
  const trained = dispatchPlaygroundAction(baseSession, { type: 'START_TRAINING' });
  const stepped = dispatchPlaygroundAction(dispatchPlaygroundAction(trained, { type: 'STEP' }), { type: 'STEP' });
  assert.equal(stepped.timeline.step, 2, 'STEP advances the timeline');
  const resetSession = dispatchPlaygroundAction(stepped, { type: 'RESET' });
  assert.equal(resetSession.modelState.training.totalSteps, 0, 'RESET replays from the initial state');

  // Linear regression math.
  const lrPoints = fallbackRegressionPoints.map((point) => ({ x: point.x, y: point.y }));
  const fit = leastSquaresFit(lrPoints);
  assert.ok(Math.abs(fit.weight - 1.959) < 0.05 && Math.abs(fit.bias - 0.935) < 0.05, 'least-squares fit remains correct');
  const epsilon = 1e-6;
  const lossAt = (weight, bias) => meanSquaredError(lrPoints, weight, bias);
  const analytic = regressionGradient(lrPoints, 0, 0);
  const numericWeight = (lossAt(epsilon, 0) - lossAt(0, 0)) / epsilon;
  const numericBias = (lossAt(0, epsilon) - lossAt(0, 0)) / epsilon;
  assert.ok(Math.sign(analytic.weight) === Math.sign(numericWeight), 'weight gradient direction matches finite differences');
  assert.ok(Math.sign(analytic.bias) === Math.sign(numericBias), 'bias gradient direction matches finite differences');
  const descent = gradientDescentStep(lrPoints, 0, 0, 0.01);
  assert.ok(
    meanSquaredError(lrPoints, descent.weight, descent.bias) <= lossAt(0, 0),
    'one small gradient step does not increase the loss',
  );
  const history = buildRegressionTrainingHistory(lrPoints, { weight: 0, bias: 0, learningRate: 0.05, steps: 20 });
  assert.equal(history.length, 20, 'training history length matches the step count');
  assert.ok(history.at(-1).loss < history[0].loss, 'training history loss decreases');
  assert.ok(uniformlySamplePoints(lrPoints, 80).length <= 80, 'dataset sampling is bounded');

  // PR A: the playground trace uses the same standardized trainer as the runtime.
  {
    const sharedTrainer = createLinearRegressionTrainer(lrPoints.map((point) => ({ x: point.x, y: point.y })));
    const directRaw = [];
    let current = { weights: [0], bias: 0 };
    for (let step = 0; step < 5; step += 1) {
      const next = stepLinearRegressionTrainer(sharedTrainer, { ...current, learningRate: 0.01 });
      directRaw.push(next.rawParameters);
      current = next.normalizedParameters;
    }
    const yMean = lrPoints.reduce((sum, point) => sum + point.y, 0) / lrPoints.length;
    const paritySession = dispatchPlaygroundAction(
      createPlaygroundSession(lrPlayground, {
        source: lrSource,
        controls: { weight: 0, bias: yMean, learningRate: 0.01, trainingSteps: 5 },
        sessionId: 'lr-parity',
      }),
      { type: 'START_TRAINING' },
    );
    const parityStepped = dispatchPlaygroundAction(paritySession, { type: 'SEEK', step: 5 });
    assert.equal(parityStepped.modelState.training.history.length, 5, 'training history length matches the requested steps');
    assert.ok(
      Math.abs(parityStepped.modelState.weight - directRaw[4].weights[0]) < 1e-9
      && Math.abs(parityStepped.modelState.bias - directRaw[4].bias) < 1e-9,
      'playground trace parameters match the shared runtime trainer step by step',
    );
  }
  // PR A: training starts from the currently displayed raw parameters.
  {
    const start = createPlaygroundSession(lrPlayground, {
      source: lrSource,
      controls: { weight: 2, bias: 100, learningRate: 0.01, trainingSteps: 5 },
      sessionId: 'lr-from-current',
    });
    const started = dispatchPlaygroundAction(start, { type: 'START_TRAINING' });
    const first = dispatchPlaygroundAction(started, { type: 'STEP' });
    const trainer = createLinearRegressionTrainer(lrPoints.map((point) => ({ x: point.x, y: point.y })));
    const normalizedStart = normalizeLinearParameters({ weights: [2], bias: 100, normalization: trainer.normalization });
    const directFirst = stepLinearRegressionTrainer(trainer, { weights: normalizedStart.weights, bias: normalizedStart.bias, learningRate: 0.01 });
    assert.ok(
      Math.abs(first.modelState.weight - directFirst.rawParameters.weights[0]) < 1e-9
      && Math.abs(first.modelState.bias - directFirst.rawParameters.bias) < 1e-9,
      'the first training step is based on the user-set weight/bias, not a fresh (0,0) start',
    );
    assert.notEqual(first.modelState.weight, 0, 'training did not restart from a zero weight');
  }
  // PR A: large-magnitude data stays finite and converges with a fixed learning rate.
  {
    const largePoints = Array.from({ length: 400 }, (_, index) => ({
      x: 50 + (index % 161),
      y: 2 * (50 + (index % 161)) + 120 + (index % 5),
    }));
    const largeSource = {
      kind: 'example', name: 'Large', fingerprint: 'lr-large',
      points: largePoints.map((point, index) => ({ id: `l${index}`, x: point.x, y: point.y })),
      feature: 'x', target: 'y',
    };
    const largeTrained = dispatchPlaygroundAction(
      createPlaygroundSession(lrPlayground, { source: largeSource, controls: { learningRate: 0.05, trainingSteps: 20 } }),
      { type: 'START_TRAINING' },
    );
    assert.equal(largeTrained.modelState.training.stopReason, null, 'large-scale training does not trigger the stop guard');
    assert.equal(largeTrained.modelState.training.history.length, 20, 'large-scale training completes every step');
    assert.ok(largeTrained.modelState.training.history.every((entry) => (
      Number.isFinite(entry.loss) && Number.isFinite(entry.weight) && Number.isFinite(entry.bias)
    )), 'large-scale training history stays finite');
    assert.ok(
      largeTrained.modelState.training.history.at(-1).loss < largeTrained.modelState.training.history[0].loss,
      'large-scale data converges in standardized space',
    );
  }
  // PR A: a learning rate that makes the loss grow stops with an explicit reason.
  {
    const overshootSource = {
      kind: 'example', name: 'Overshoot', fingerprint: 'lr-overshoot',
      points: [{ id: 'o0', x: 0, y: 0 }, { id: 'o1', x: 1, y: 10 }],
      feature: 'x', target: 'y',
    };
    const highLr = dispatchPlaygroundAction(
      createPlaygroundSession(lrPlayground, { source: overshootSource, controls: { learningRate: 1.5, trainingSteps: 20 } }),
      { type: 'START_TRAINING' },
    );
    assert.equal(highLr.modelState.training.stopReason, 'learning-rate-too-high', 'loss growth stops training with a clear reason');
    assert.ok(highLr.modelState.training.history.length < 20, 'training stops before the requested step count');
    const highLrStep = dispatchPlaygroundAction(dispatchPlaygroundAction(highLr, { type: 'STEP' }), { type: 'STEP' });
    assert.equal(
      derivePlaygroundSnapshot(highLrStep).observation.titleKey,
      'playground.lr.observation.lrTooHigh',
      'the UI shows the learning-rate-too-high observation',
    );
    const lowLr = dispatchPlaygroundAction(
      createPlaygroundSession(lrPlayground, { source: overshootSource, controls: { learningRate: 0.05, trainingSteps: 10 } }),
      { type: 'START_TRAINING' },
    );
    assert.equal(lowLr.modelState.training.history.length, 10, 'a sane learning rate completes all steps');
    assert.ok(lowLr.modelState.training.history.at(-1).loss < lowLr.modelState.training.history[0].loss, 'a sane learning rate decreases loss');
  }
  // PR A: deterministic replay including point edits, and RESET reproduction.
  {
    const lrScript = [
      { type: 'SET_CONTROL', key: 'weight', value: 1.2 },
      { type: 'ADD_POINT', x: 2.5, y: 4 },
      { type: 'START_TRAINING' },
      { type: 'STEP' },
    ];
    const replayLr = (seed) => lrScript.reduce(
      (session, action) => dispatchPlaygroundAction(session, action),
      createPlaygroundSession(lrPlayground, { source: lrSource, seed, sessionId: 'lr-replay' }),
    );
    assert.deepEqual(
      derivePlaygroundSnapshot(replayLr(5)),
      derivePlaygroundSnapshot(replayLr(5)),
      'linear regression actions replay deterministically',
    );
    const resetThenReplay = (seed) => {
      let run = dispatchPlaygroundAction(replayLr(seed), { type: 'RESET' });
      for (const action of lrScript) run = dispatchPlaygroundAction(run, action);
      return run;
    };
    assert.deepEqual(
      derivePlaygroundSnapshot(resetThenReplay(5)),
      derivePlaygroundSnapshot(resetThenReplay(5)),
      'RESET then replay is deterministic',
    );
  }

  // KNN shared math and playground equivalence.
  const knnPoints = Array.from({ length: 60 }, (_, index) => ({
    id: `k${index}`,
    features: { a: (index % 6) - 3 + (index % 2), b: Math.floor(index / 6) - 5 },
    label: index % 2 === 0 ? 'red' : 'blue',
  }));
  const knnSource = { kind: 'example', name: 'Example', fingerprint: 'knn-test', points: knnPoints, featureColumns: ['a', 'b'] };
  const knnBase = createPlaygroundSession(knnPlayground, { source: knnSource, controls: { k: 5 } });
  assert.ok(knnBase.controls.k >= 1 && knnBase.controls.k <= 20, 'k respects bounds');
  const regionsOff = derivePlaygroundSnapshot(knnBase);
  assert.equal(regionsOff.scene.decisionRegions.cells.length, 0, 'decision regions are off by default');
  const regionsOn = derivePlaygroundSnapshot(dispatchPlaygroundAction(knnBase, { type: 'SET_CONTROL', key: 'showDecisionRegions', value: true }));
  assert.ok(regionsOn.scene.decisionRegions.cells.length <= 48 * 48, 'decision region count respects the resolution cap');

  // PR A: the playground fit uses the train split only and displays it distinctly.
  assert.ok(knnBase.modelState.fit.trainRows >= 1 && knnBase.modelState.fit.testRows >= 1, 'knn playground has a train/test split');
  assert.equal(knnBase.modelState.fit.trainRows, knnBase.modelState.rawTrain.length, 'fit train rows match the raw train rows');
  const splitScene = derivePlaygroundSnapshot(knnBase).scene;
  assert.ok(splitScene.points.every((point) => point.subset === 'train' || point.subset === 'test'), 'every displayed point is labeled train or test');
  assert.equal(splitScene.points.filter((point) => point.subset === 'test').length, knnBase.modelState.fit.testRows, 'test points are displayed distinctly');

  // PR A: changing k recomputes the test accuracy from the same fit state.
  for (const k of [1, 5, 20]) {
    const kSession = dispatchPlaygroundAction(knnBase, { type: 'SET_CONTROL', key: 'k', value: k });
    const recomputed = computeTestAccuracy(
      { ...knnBase.modelState.fit, k: kSession.modelState.fit.k },
      knnBase.modelState.test,
      knnBase.modelState.featureColumns,
    );
    assert.equal(
      derivePlaygroundSnapshot(kSession).metrics.runtimeAccuracy,
      recomputed,
      `test accuracy matches a recomputation at k=${k}`,
    );
  }

  // PR A follow-up: KNN runtime/playground parity through the real browser
  // runtime construction (split, normalization, k, prediction, accuracy).
  {
    const parityRows = Array.from({ length: 80 }, (_, index) => {
      const group = index % 2;
      const offset = Math.floor(index / 2);
      return {
        f0: Number(((group === 0 ? -2 : 2) + Math.sin(offset * 0.9) * 0.8 + (offset % 3) * 0.05).toFixed(3)),
        f1: Number(((group === 0 ? -2 : 2) + Math.cos(offset * 0.7) * 0.8 - (offset % 2) * 0.05).toFixed(3)),
        f2: Number(((group === 0 ? -0.5 : 0.5) + Math.sin(offset * 1.4) * 0.5).toFixed(3)),
        label: group === 0 ? 'a' : 'b',
      };
    });
    const parityDataset = {
      name: 'Parity KNN', task: 'classification',
      rows: parityRows,
      columns: [
        { name: 'f0', type: 'number', missing: 0 },
        { name: 'f1', type: 'number', missing: 0 },
        { name: 'f2', type: 'number', missing: 0 },
        { name: 'label', type: 'string', missing: 0 },
      ],
      featureColumns: ['f0', 'f1', 'f2'], targetColumn: 'label',
    };
    const runRuntimeKnn = async (k, trainRatio) => {
      const nodes = [
        makeNode('par-data', 'tabular_data_node'),
        makeNode('par-knn', 'knn_node', { k_value: k, train_ratio: trainRatio }),
        makeNode('par-eval', 'evaluate_classification_node'),
      ];
      const edges = [
        makeEdge('par-data', 'dataset', 'par-knn', 'dataset'),
        makeEdge('par-knn', 'trained_model', 'par-eval', 'trained_model'),
      ];
      return executeBrowserGraph({ nodes, edges, dataset: parityDataset });
    };
    const paritySource = (trainRatio) => ({
      kind: 'example', name: 'Parity', fingerprint: 'knn-parity',
      points: parityRows.map((row, index) => ({
        id: index,
        features: { f0: row.f0, f1: row.f1, f2: row.f2 },
        label: row.label,
      })),
      featureColumns: ['f0', 'f1', 'f2'],
      trainRatio,
      total: parityRows.length,
    });
    const revealQuery = (session, x, y, steps) => {
      let probe = dispatchPlaygroundAction(session, { type: 'SET_CONTROL', key: 'queryX', value: x });
      probe = dispatchPlaygroundAction(probe, { type: 'SET_CONTROL', key: 'queryY', value: y });
      probe = dispatchPlaygroundAction(probe, { type: 'START_NEIGHBOR_REVEAL' });
      for (let step = 0; step < steps; step += 1) probe = dispatchPlaygroundAction(probe, { type: 'STEP' });
      return derivePlaygroundSnapshot(probe);
    };
    for (const trainRatio of [0.6, 0.75, 0.8]) {
      for (const k of [1, 5, 20]) {
        const runtimeModel = await runRuntimeKnn(k, trainRatio);
        const playground = createPlaygroundSession(knnPlayground, {
          source: paritySource(trainRatio),
          controls: { k },
          seed: DEFAULT_KNN_SEED,
        });
        const playgroundFit = playground.modelState.fit;
        // A: split parity
        assert.deepEqual(
          runtimeModel.train.map((sample) => sample.index),
          playground.modelState.rawTrain.map((point) => point.id),
          `train split ids match the runtime at k=${k} ratio=${trainRatio}`,
        );
        assert.deepEqual(
          runtimeModel.test.map((sample) => sample.index),
          playground.modelState.test.map((point) => point.id),
          `test split ids match the runtime at k=${k} ratio=${trainRatio}`,
        );
        // B: normalization parity
        assert.ok(
          runtimeModel.normalization.means.every((value, feature) => (
            Math.abs(value - playgroundFit.normalization.means[feature]) < 1e-12
          ))
          && runtimeModel.normalization.stds.every((value, feature) => (
            Math.abs(value - playgroundFit.normalization.stds[feature]) < 1e-12
          )),
          `normalization parity at k=${k} ratio=${trainRatio}`,
        );
        // E: clamped k parity
        assert.equal(runtimeModel.k, playgroundFit.k, `clamped k parity at k=${k} ratio=${trainRatio}`);
        // D: accuracy parity from the real runtime evaluation
        assert.ok(
          Math.abs(runtimeModel.metrics.accuracy - derivePlaygroundSnapshot(playground).metrics.runtimeAccuracy) < 1e-12,
          `accuracy parity at k=${k} ratio=${trainRatio}`,
        );
        // C: prediction parity at three queries (ordinary, boundary, train point)
        const queries = [
          [0, 0],
          [1.8, -1.8],
          [parityRows[0].f0, parityRows[0].f1],
        ];
        queries.forEach(([x, y], queryIndex) => {
          const runtimePrediction = predictWithModel(runtimeModel, [x, y, runtimeModel.normalization.means[2]]);
          const revealed = revealQuery(playground, x, y, playgroundFit.k);
          assert.equal(
            revealed.scene.voting.predictedLabel,
            runtimePrediction,
            `query ${queryIndex + 1} prediction parity at k=${k} ratio=${trainRatio}`,
          );
        });
      }
    }
  }
  const tieTrain = [
    { id: 0, x: [1, 0], y: 'a' },
    { id: 1, x: [-1, 0], y: 'b' },
  ];
  const tieNeighbors = rankNeighbors(tieTrain, [0, 0], 2);
  assert.deepEqual(tieNeighbors.map((neighbor) => neighbor.label), ['a', 'b'], 'equal distances keep training order');
  const tieVote = voteNeighbors(tieNeighbors);
  assert.equal(tieVote.tie, true, 'equal vote counts register a tie');
  assert.equal(tieVote.tieBreakReason, 'label', 'stable label order breaks the tie');

  // PR A: editing a training point refits normalization and both views use it.
  {
    const movedId = knnBase.modelState.rawTrain[0].id;
    const moved = dispatchPlaygroundAction(knnBase, { type: 'MOVE_TRAINING_POINT', pointId: movedId, x: 100, y: 100 });
    assert.notDeepEqual(
      moved.modelState.fit.normalization.means,
      knnBase.modelState.fit.normalization.means,
      'editing a training point refits the normalization statistics',
    );
    const xi = moved.modelState.featureColumns.indexOf(moved.modelState.xFeature);
    const yi = moved.modelState.featureColumns.indexOf(moved.modelState.yFeature);
    const movedNormalized = moved.modelState.fit.normalizedTrain.find((sample) => sample.id === movedId);
    assert.ok(
      Math.abs(movedNormalized.x[xi] - (100 - moved.modelState.fit.normalization.means[xi]) / moved.modelState.fit.normalization.stds[xi]) < 1e-9
      && Math.abs(movedNormalized.x[yi] - (100 - moved.modelState.fit.normalization.means[yi]) / moved.modelState.fit.normalization.stds[yi]) < 1e-9,
      'normalized train reflects the edited point',
    );
    for (const normalize of [true, false]) {
      let probe = dispatchPlaygroundAction(moved, { type: 'SET_CONTROL', key: 'normalize', value: normalize });
      probe = dispatchPlaygroundAction(probe, { type: 'SET_CONTROL', key: 'queryX', value: 100 });
      probe = dispatchPlaygroundAction(probe, { type: 'SET_CONTROL', key: 'queryY', value: 100 });
      probe = dispatchPlaygroundAction(probe, { type: 'START_NEIGHBOR_REVEAL' });
      probe = dispatchPlaygroundAction(probe, { type: 'STEP' });
      const probeScene = derivePlaygroundSnapshot(probe).scene;
      assert.equal(probeScene.neighbors[0]?.pointId, movedId, `both normalized and raw views use the edited point (normalize=${normalize})`);
    }
  }

  // PR A: refit bounds k by the train size and evaluates on the unchanged test set.
  {
    const refit = refitKnnFromSplit({
      rawTrain: knnBase.modelState.rawTrain.slice(0, 8),
      test: knnBase.modelState.test,
      k: 20,
      featureColumns: knnBase.modelState.featureColumns,
    });
    assert.equal(refit.k, 8, 'refit bounds k by the train size');
    assert.equal(refit.trainRows, 8, 'refit reports the new train rows');
    assert.equal(refit.testRows, knnBase.modelState.test.length, 'refit keeps the unchanged test set');
    assert.equal(typeof refit.testAccuracy, 'number', 'refit computes test accuracy');
  }

  // PR A: multidimensional data projects hidden features at the training mean.
  {
    const multiPoints = Array.from({ length: 40 }, (_, index) => {
      const group = index % 2;
      const offset = Math.floor(index / 2);
      return {
        id: `m${index}`,
        features: {
          a: Number(((group === 0 ? 2 : 5) + Math.sin(offset * 1.1) * 0.4).toFixed(3)),
          b: Number(((group === 0 ? 2 : 5) + Math.cos(offset * 0.8) * 0.4).toFixed(3)),
          c: Number(((group === 0 ? 1 : 3) + Math.sin(offset * 1.7) * 0.3).toFixed(3)),
          d: Number(((group === 0 ? 0.5 : 2) + Math.cos(offset * 1.3) * 0.3).toFixed(3)),
        },
        label: group === 0 ? 'setosa' : 'versicolor',
      };
    });
    const multiSource = { kind: 'example', name: 'Multi', fingerprint: 'multi-test', points: multiPoints, featureColumns: ['a', 'b', 'c', 'd'] };
    const multi = createPlaygroundSession(knnPlayground, { source: multiSource, controls: { xFeature: 'c', yFeature: 'd', k: 5 } });
    const multiScene = derivePlaygroundSnapshot(multi).scene;
    assert.equal(multiScene.projection.enabled, true, 'multidimensional data enables the 2D slice projection');
    assert.equal(multiScene.query.vector[0], 0, 'hidden feature a is fixed at z-score 0');
    assert.equal(multiScene.query.vector[1], 0, 'hidden feature b is fixed at z-score 0');
    const explicitVector = buildProjectionVector({
      xFeature: 'c',
      yFeature: 'd',
      x: multiScene.query.normalizedX,
      y: multiScene.query.normalizedY,
      featureColumns: multi.modelState.featureColumns,
      normalization: multi.modelState.fit.normalization,
      fixedValues: Object.fromEntries(multi.modelState.featureColumns.map((feature) => [feature, 0])),
    });
    assert.deepEqual(explicitVector, multiScene.query.vector, 'buildProjectionVector produces the scene query vector');
    const fit = multi.modelState.fit;
    const manualNeighbors = rankNeighbors(fit.normalizedTrain, multiScene.query.vector, fit.k);
    assert.deepEqual(
      multiScene.neighbors.map((neighbor) => neighbor.pointId),
      manualNeighbors.map((neighbor) => neighbor.pointId),
      'the slice query prediction equals ranking on the explicit full vector',
    );
    let revealedMulti = dispatchPlaygroundAction(multi, { type: 'START_NEIGHBOR_REVEAL' });
    for (let index = 0; index < fit.k; index += 1) revealedMulti = dispatchPlaygroundAction(revealedMulti, { type: 'STEP' });
    const revealedScene = derivePlaygroundSnapshot(revealedMulti).scene;
    assert.equal(
      revealedScene.voting.predictedLabel,
      voteNeighbors(manualNeighbors).predictedLabel,
      'the slice vote equals the explicit full-vector prediction',
    );
  }

  // PR A: deterministic replay for KNN edits.
  {
    const knnScript = [
      { type: 'SET_CONTROL', key: 'k', value: 3 },
      { type: 'ADD_TRAINING_POINT', x: 1.5, y: -1.2, label: 'red' },
      { type: 'MOVE_TRAINING_POINT', pointId: knnBase.modelState.rawTrain[0].id, x: 0.7, y: 0.3 },
      { type: 'START_NEIGHBOR_REVEAL' },
      { type: 'STEP' },
      { type: 'STEP' },
    ];
    const replayKnn = (seed) => knnScript.reduce(
      (session, action) => dispatchPlaygroundAction(session, action),
      createPlaygroundSession(knnPlayground, { source: knnSource, seed, sessionId: 'knn-replay' }),
    );
    assert.deepEqual(
      derivePlaygroundSnapshot(replayKnn(11)),
      derivePlaygroundSnapshot(replayKnn(11)),
      'knn actions replay deterministically',
    );
  }

  // Playground Agent API.
  let hostDataset = null;
  const host = createPlaygroundHost({ getDataset: () => hostDataset });
  const playgroundAgent = createPlaygroundAgentApi(host);
  assert.equal(playgroundAgent.apiVersion, 1, 'playground agent API version is 1');
  assert.ok(playgroundAgent.list().some((item) => item.id === 'linear-regression'), 'agent lists playgrounds');
  assert.throws(() => playgroundAgent.getState(), (error) => error.code === 'PLAYGROUND_NOT_OPEN');
  await assert.rejects(
    playgroundAgent.open({ playgroundId: 'missing' }),
    (error) => error.code === 'PLAYGROUND_NOT_FOUND',
  );
  const opened = await playgroundAgent.open({ playgroundId: 'linear-regression' });
  assert.equal(opened.playgroundId, 'linear-regression');
  await assert.rejects(
    playgroundAgent.open({ playgroundId: 'knn-classification' }),
    (error) => error.code === 'PLAYGROUND_ALREADY_OPEN',
  );
  await playgroundAgent.dispatch({ type: 'SET_CONTROL', key: 'weight', value: 0.5 });
  assert.equal(playgroundAgent.getState().controls.weight, 0.5, 'agent dispatch updates the shared session');
  const detached = structuredClone(playgroundAgent.getState());
  detached.controls.weight = 99;
  assert.equal(playgroundAgent.getState().controls.weight, 0.5, 'agent snapshots are detached');
  let subscribed = null;
  const unsubscribe = playgroundAgent.subscribe((snapshot) => { subscribed = snapshot; });
  await playgroundAgent.dispatch({ type: 'SET_CONTROL', key: 'bias', value: 2 });
  assert.equal(subscribed?.controls.bias, 2, 'subscribers receive updates');
  unsubscribe();
  await playgroundAgent.runScenario('intro');
  assert.equal(playgroundAgent.getState().status, 'completed', 'runScenario completes');
  // Source staleness and refresh.
  assert.equal(playgroundAgent.getState().source.kind, 'example');
  hostDataset = {
    name: 'Regression',
    task: 'regression',
    rows: Array.from({ length: 20 }, (_, index) => ({ x: index, y: 2 * index + 1 })),
    columns: [
      { name: 'x', type: 'number', missing: 0 },
      { name: 'y', type: 'number', missing: 0 },
    ],
    featureColumns: ['x'],
    targetColumn: 'y',
  };
  host.markSourceStale();
  assert.equal(playgroundAgent.getState().source.stale, true, 'workspace changes mark the source stale');
  await playgroundAgent.refreshSource();
  const refreshed = playgroundAgent.getState();
  assert.equal(refreshed.source.kind, 'workspace-dataset', 'refreshSource reads the current workspace dataset');
  assert.equal(refreshed.source.stale, false, 'refreshSource clears the stale flag');
  await playgroundAgent.close();
  assert.throws(() => playgroundAgent.getState(), (error) => error.code === 'PLAYGROUND_NOT_OPEN');
  await assert.rejects(playgroundAgent.step(), (error) => error.code === 'PLAYGROUND_NOT_OPEN');

  // PR A: workspace classification sources keep every numeric feature for the
  // multidimensional projection, instead of being truncated to two features.
  {
    const irisHost = createPlaygroundHost({ getDataset: () => ({
      name: 'Iris', task: 'classification',
      rows: Array.from({ length: 20 }, (_, index) => ({
        sepal_length: 4 + (index % 3), sepal_width: 2 + (index % 2),
        petal_length: 1 + (index % 5), petal_width: 0.5 + (index % 3),
        species: index % 2 === 0 ? 'setosa' : 'versicolor',
      })),
      columns: [
        { name: 'sepal_length', type: 'number', missing: 0 },
        { name: 'sepal_width', type: 'number', missing: 0 },
        { name: 'petal_length', type: 'number', missing: 0 },
        { name: 'petal_width', type: 'number', missing: 0 },
        { name: 'species', type: 'string', missing: 0 },
      ],
      featureColumns: ['sepal_length', 'sepal_width', 'petal_length', 'petal_width'],
      targetColumn: 'species',
    }) });
    const irisAgent = createPlaygroundAgentApi(irisHost);
    const irisOpened = await irisAgent.open({ playgroundId: 'knn-classification' });
    assert.equal(irisOpened.scene.featureOptions.length, 4, 'workspace classification sources keep every numeric feature for projection');
    await irisAgent.close();
  }

  // PR B: unified visualization playground.
  {
    // 1. One session reducer: descriptors no longer implement model logic.
    assert.equal(typeof lrPlayground.createInitialState, 'undefined', 'LR descriptor no longer has its own initializer');
    assert.equal(typeof lrPlayground.reduce, 'undefined', 'LR descriptor no longer has its own reducer');
    assert.equal(typeof knnPlayground.deriveScene, 'undefined', 'KNN descriptor no longer derives its own scene');
    const adapterIds = listModelAdapters().map((adapter) => adapter.id);
    assert.deepEqual(new Set(adapterIds).size, adapterIds.length, 'model adapter ids are unique');
    assert.ok(adapterIds.includes('linear-regression') && adapterIds.includes('knn'), 'both model adapters are registered');
    for (const adapter of listModelAdapters()) {
      assert.ok(adapter.defaultVisualizationPreset, `${adapter.id} declares a default preset`);
      for (const capability of ['fit', 'predict', 'evaluate']) {
        assert.ok(adapter.capabilities[capability], `${adapter.id} adapter capability ${capability}`);
      }
    }

    // 2. Model adapters must not import React.
    for (const file of ['linearRegressionAdapter.js', 'knnAdapter.js']) {
      const source = readFileSync(new URL(`../src/core/playground/model/${file}`, import.meta.url), 'utf-8');
      assert.ok(!/from\s+['"]react['"]/.test(source) && !/from\s+['"]react-dom['"]/.test(source), `${file} must not import React`);
    }

    // 2b. UI renderers must not import model mathematics.
    const uiFiles = [
      ...readdirSync(new URL('../src/components/playground/', import.meta.url)).filter((name) => name.endsWith('.jsx')).map((name) => name),
      ...readdirSync(new URL('../src/components/playground/renderers/', import.meta.url)).filter((name) => name.endsWith('.jsx')).map((name) => `renderers/${name}`),
    ];
    for (const file of uiFiles) {
      const source = readFileSync(new URL(`../src/components/playground/${file}`, import.meta.url), 'utf-8');
      assert.ok(!/from\s+['"]\.\.\/\.\.\/core\/(playground\/|knnMath|linearRegression)/.test(source), `${file} must not import model math`);
    }

    // 3. Every preset is a valid, JSON-safe declaration; serialize ->
    // deserialize -> replay produces the identical trace.
    assert.deepEqual(listPresets().map((preset) => preset.id), ['linear-regression.intuition', 'knn.intro']);
    for (const preset of listPresets()) {
      const declaration = getPreset(preset.id);
      assert.doesNotThrow(() => validateScript(declaration), `${preset.id} validates`);
      assert.doesNotThrow(() => structuredClone(declaration), `${preset.id} is JSON-safe`);
      assert.equal(declaration.version, 1, `${preset.id} schema version`);
      assert.ok(declaration.primitives.every((primitive) => primitive.props && typeof primitive.props === 'object'), `${preset.id} primitives declare props`);
    }

    const runPreset = (playground, source, presetId, seed) => {
      let session = createPlaygroundSession(playground, { source, seed, sessionId: 'prb-replay' });
      const driver = {
        dispatch: (action) => { session = dispatchPlaygroundAction(session, action); },
        getState: () => derivePlaygroundSnapshot(session),
        getAdapterId: () => session.adapterId,
        resetToBaseline: () => { session = dispatchPlaygroundAction(session, { type: 'RESET' }); },
        subscribe: () => () => {},
      };
      const runtime = createScriptRuntime(driver).load(structuredClone(getPreset(presetId)));
      runtime.initialize();
      const total = getPreset(presetId).steps.length;
      for (let index = 0; index < total; index += 1) runtime.step();
      return { runtime, snapshot: derivePlaygroundSnapshot(session) };
    };

    const lrRunA = runPreset(lrPlayground, lrSource, 'linear-regression.intuition', 7);
    const lrRunB = runPreset(lrPlayground, lrSource, 'linear-regression.intuition', 7);
    assert.deepEqual(lrRunA.snapshot.traces, lrRunB.snapshot.traces, 'same preset + seed + data replays to the same trace');
    assert.equal(lrRunA.runtime.getStatus().status, 'completed', 'LR preset completes');
    assert.ok(lrRunA.snapshot.traces.every((event) => validateTraceEvent(event)), 'LR trace events are valid');
    assert.ok(lrRunA.snapshot.primitives.every((primitive) => validatePrimitive(primitive)), 'LR primitives are valid');
    assert.equal(lrRunA.snapshot.primitives.length, lrRunB.snapshot.primitives.length, 'preset replay produces the same primitive set');
    assert.ok(
      lrRunA.snapshot.traces.some((event) => event.type === 'training.completed'),
      'LR preset emits training.completed',
    );
    assert.ok(
      Math.abs(lrRunA.snapshot.controls.weight - lrRunA.snapshot.scene.bestFitLine.weight) < 1e-9,
      'LR preset ends at the least-squares optimum',
    );

    const knnSource2 = {
      kind: 'example', name: 'Example', fingerprint: 'knn-prb',
      points: Array.from({ length: 60 }, (_, index) => ({
        id: `k${index}`,
        features: { a: (index % 6) - 3 + (index % 2), b: Math.floor(index / 6) - 5 },
        label: index % 2 === 0 ? 'red' : 'blue',
      })),
      featureColumns: ['a', 'b'],
    };
    const knnRunA = runPreset(knnPlayground, knnSource2, 'knn.intro', 3);
    const knnRunB = runPreset(knnPlayground, knnSource2, 'knn.intro', 3);
    assert.deepEqual(knnRunA.snapshot.traces, knnRunB.snapshot.traces, 'KNN preset replays deterministically');
    assert.equal(knnRunA.runtime.getStatus().status, 'completed', 'KNN preset completes');
    assert.ok(knnRunA.snapshot.traces.every((event) => validateTraceEvent(event)), 'KNN trace events are valid');
    assert.ok(knnRunA.snapshot.traces.some((event) => event.type === 'prediction.emitted'), 'KNN preset emits a prediction');
    assert.ok(knnRunA.snapshot.primitives.some((primitive) => primitive.type === 'neighbor-links'), 'KNN stage receives neighbor primitives');
    assert.equal(knnRunA.snapshot.controls.showNeighborOrder, true, 'KNN preset enables neighbor order');
    assert.equal(knnRunA.snapshot.controls.showDecisionRegions, true, 'KNN preset enables decision regions');

    // 4. Script validator rejects dangerous or unknown declarations.
    const validPreset = structuredClone(getPreset('linear-regression.intuition'));
    const expectScriptError = (mutate, code) => {
      const script = structuredClone(validPreset);
      mutate(script);
      assert.throws(() => validateScript(script), (error) => error.code === code, `validator rejects with ${code}`);
    };
    expectScriptError((script) => { script.model.adapter = 'missing'; }, 'SCRIPT_UNKNOWN_MODEL');
    expectScriptError((script) => { script.primitives[0].type = 'alien-chart'; }, 'SCRIPT_UNKNOWN_PRIMITIVE');
    expectScriptError((script) => { script.steps[1].invoke = { operation: 'evalCode', args: {} }; }, 'SCRIPT_UNSUPPORTED_OPERATION');
    expectScriptError((script) => { script.steps[2].annotate = { text: '$controls.k * evil()' }; }, 'SCRIPT_INVALID_BINDING');
    expectScriptError((script) => { script.steps[3].consume = { event: 'knn.exploded', count: 1 }; }, 'INVALID_SCRIPT');
    expectScriptError((script) => { script.steps[1].wait = 1; script.steps[1].narrationKey = 'x'.repeat(1); script.steps[1].extra = true; }, 'INVALID_SCRIPT');
    expectScriptError((script) => { script.steps[0].annotate = { text: 'eval("alert(1)")' }; }, 'INVALID_SCRIPT');
    expectScriptError((script) => { script.steps = Array.from({ length: 250 }, (_, index) => ({ id: `s${index}`, wait: true })); }, 'SCRIPT_TOO_COMPLEX');
    expectScriptError((script) => { script.steps[1].id = script.steps[0].id; }, 'INVALID_SCRIPT');
    expectScriptError((script) => { script.steps[0].invoke = null; }, 'SCRIPT_UNSUPPORTED_OPERATION');
    const nonJson = structuredClone(validPreset);
    nonJson.steps[0].annotate = { text: () => 'nope' };
    assert.throws(() => validateScript(nonJson), (error) => error.code === 'INVALID_SCRIPT', 'validator rejects non-JSON values');

    // PR B follow-up: script-driven runtime.
    {
      const makeDriver = (getSession, setSession) => ({
        dispatch: (action) => setSession(dispatchPlaygroundAction(getSession(), action)),
        getState: () => derivePlaygroundSnapshot(getSession()),
        getAdapterId: () => getSession().adapterId,
        resetToBaseline: () => setSession(dispatchPlaygroundAction(getSession(), { type: 'RESET' })),
        subscribe: () => () => {},
      });
      const fingerprint = (snapshot) => {
        const { sessionId, ...rest } = snapshot;
        return rest;
      };
      const runPresetSteps = (playground, source, presetId, seed, count) => {
        let session = createPlaygroundSession(playground, { source, seed, sessionId: 'prb-followup' });
        const driver = makeDriver(() => session, (next) => { session = next; });
        const runtime = createScriptRuntime(driver).load(structuredClone(getPreset(presetId)));
        runtime.initialize();
        for (let index = 0; index < count; index += 1) runtime.step();
        return { fingerprint: fingerprint(derivePlaygroundSnapshot(session)), session };
      };

      // Replay invariance: fresh first-N == full-run-then-seek-N ==
      // full-run-then-reset-then-N for N in {0, 1, middle, total}.
      for (const [playground, source, presetId, seed, total, probes] of [
        [lrPlayground, lrSource, 'linear-regression.intuition', 7, 7, [0, 1, 3, 7]],
        [knnPlayground, knnSource2, 'knn.intro', 3, 11, [0, 1, 3, 6, 11]],
      ]) {
        for (const n of probes) {
          const fresh = runPresetSteps(playground, source, presetId, seed, n);
          const full = runPresetSteps(playground, source, presetId, seed, total);
          const seeked = (() => {
            let session = createPlaygroundSession(playground, { source, seed, sessionId: 'prb-followup' });
            const driver = makeDriver(() => session, (next) => { session = next; });
            const runtime = createScriptRuntime(driver).load(structuredClone(getPreset(presetId)));
            runtime.initialize();
            for (let index = 0; index < total; index += 1) runtime.step();
            runtime.seek(n);
            return fingerprint(derivePlaygroundSnapshot(session));
          })();
          const resetReplay = (() => {
            let session = createPlaygroundSession(playground, { source, seed, sessionId: 'prb-followup' });
            const driver = makeDriver(() => session, (next) => { session = next; });
            const runtime = createScriptRuntime(driver).load(structuredClone(getPreset(presetId)));
            runtime.initialize();
            for (let index = 0; index < total; index += 1) runtime.step();
            runtime.reset();
            for (let index = 0; index < n; index += 1) runtime.step();
            return fingerprint(derivePlaygroundSnapshot(session));
          })();
          assert.deepEqual(fresh.fingerprint, seeked, `${presetId} fresh step ${n} == seek(${n})`);
          assert.deepEqual(fresh.fingerprint, resetReplay, `${presetId} fresh step ${n} == reset+${n} steps`);
        }
      }

      // Composition: the script owns which primitives exist.
      const withLoss = structuredClone(getPreset('linear-regression.intuition'));
      const withoutLoss = structuredClone(withLoss);
      withoutLoss.id = 'lr-no-loss';
      withoutLoss.primitives = withoutLoss.primitives.filter((primitive) => primitive.id !== 'loss-curve');
      withoutLoss.layout.stage = withoutLoss.layout.stage.filter((id) => id !== 'loss-curve');
      assert.doesNotThrow(() => validateScript(withoutLoss));
      const withLossRun = runPresetSteps(lrPlayground, lrSource, 'linear-regression.intuition', 7, 7);
      assert.ok(withLossRun.session.script.primitives.some((primitive) => primitive.type === 'loss-curve'));
      // NOTE: runPresetSteps loads by preset id; load the custom declaration instead.
      let customSession = createPlaygroundSession(lrPlayground, { source: lrSource, seed: 7, sessionId: 'prb-followup' });
      const customDriver = makeDriver(() => customSession, (next) => { customSession = next; });
      const customRuntime = createScriptRuntime(customDriver).load(withoutLoss);
      customRuntime.initialize();
      for (let index = 0; index < withoutLoss.steps.length; index += 1) customRuntime.step();
      const noLossSnapshot = derivePlaygroundSnapshot(customSession);
      assert.ok(noLossSnapshot.primitives.some((primitive) => primitive.type === 'scatter'), 'script A still shows scatter');
      assert.ok(!noLossSnapshot.primitives.some((primitive) => primitive.type === 'loss-curve'), 'script without loss-curve omits it');
      assert.ok(withLossRun.session.script.primitives.some((primitive) => primitive.type === 'loss-curve'), 'script with loss-curve declares it');

      // Same model state, different scripts -> primitives differ exactly by
      // the declared residual primitive.
      const minimalScript = (id, includeResiduals) => ({
        version: 1,
        id,
        model: { adapter: 'linear-regression' },
        data: { source: 'workspace-or-default' },
        controls: [],
        layout: {
          stage: includeResiduals ? ['scatter', 'regression-line', 'residual-lines'] : ['scatter', 'regression-line'],
          side: [],
        },
        primitives: [
          { id: 'scatter', type: 'scatter', props: { points: '$model.scatterPoints', axes: '$model.axes' } },
          { id: 'regression-line', type: 'regression-line', props: { line: '$model.line', ranges: '$model.ranges' } },
          ...(includeResiduals ? [{ id: 'residual-lines', type: 'residual-lines', props: { points: '$model.residualPoints' } }] : []),
        ],
        steps: [{ id: 'wait', wait: true, durationMs: 100 }],
      });
      const runCustomScript = (script) => {
        let session = createPlaygroundSession(lrPlayground, { source: lrSource, seed: 7, sessionId: 'prb-followup' });
        const driver = makeDriver(() => session, (next) => { session = next; });
        const runtime = createScriptRuntime(driver).load(script);
        runtime.initialize();
        runtime.step();
        return derivePlaygroundSnapshot(session);
      };
      const snapA = runCustomScript(minimalScript('script-a', false));
      const snapB = runCustomScript(minimalScript('script-b', true));
      assert.deepEqual(snapA.scene, snapB.scene, 'same model state across scripts');
      assert.deepEqual(
        snapB.primitives.map((primitive) => primitive.id),
        [...snapA.primitives.map((primitive) => primitive.id), 'residual-lines'],
        'primitives differ exactly by the residual declaration',
      );

      // Bindings: every declared prefix resolves; transforms work; nested
      // props resolve recursively.
      const bindingContext = createBindingContext({
        model: { points: [{ x: 1 }, { x: 3 }] },
        data: { values: [1, 2, 3] },
        controls: { k: 5 },
        trace: [{ type: 'a' }, { type: 'b' }],
        metrics: { mse: 2 },
      });
      assert.equal(resolveValue('$model.points', bindingContext).length, 2, '$model resolves');
      assert.equal(resolveValue('$data.values', bindingContext).length, 3, '$data resolves');
      assert.equal(resolveValue('$controls.k', bindingContext), 5, '$controls resolves');
      assert.equal(resolveValue('$metrics.mse', bindingContext), 2, '$metrics resolves');
      assert.equal(resolveValue('$trace', bindingContext).length, 2, '$trace resolves');
      assert.equal(resolveValue('mean($data.values)', bindingContext), 2, 'transform mean() resolves');
      assert.equal(resolveValue('max($data.values)', bindingContext), 3, 'transform max() resolves');
      const nested = resolveValue(
        { axes: { x: '$model.points' }, list: ['$controls.k', '$metrics.mse'], literal: 7 },
        bindingContext,
      );
      assert.equal(nested.axes.x.length, 2, 'nested object bindings resolve');
      assert.deepEqual(nested.list, [5, 2], 'array bindings resolve');
      assert.equal(nested.literal, 7, 'literals pass through');

      // Layout integrity: unknown primitive reference and duplicates.
      const layoutBad = structuredClone(validPreset);
      layoutBad.layout.stage.push('ghost');
      assert.throws(() => validateScript(layoutBad), (error) => error.code === 'SCRIPT_UNKNOWN_PRIMITIVE_REFERENCE', 'unknown layout id rejected');
      const layoutDup = structuredClone(validPreset);
      layoutDup.layout.side = ['formula', 'formula'];
      assert.throws(() => validateScript(layoutDup), (error) => error.code === 'INVALID_SCRIPT', 'duplicate layout id rejected');

      // KNN tracePredict alone initializes the reveal state and emits the
      // query trace events without relying on a later STEP.
      const predictOnly = {
        version: 1,
        id: 'knn-predict-only',
        model: { adapter: 'knn' },
        data: { source: 'workspace-or-default' },
        controls: [],
        layout: { stage: [], side: [] },
        primitives: [],
        steps: [{ id: 'predict', invoke: { operation: 'tracePredict', args: {} }, durationMs: 100 }],
      };
      let predictSession = createPlaygroundSession(knnPlayground, { source: knnSource2, seed: 3, sessionId: 'prb-followup' });
      const predictDriver = makeDriver(() => predictSession, (next) => { predictSession = next; });
      const predictRuntime = createScriptRuntime(predictDriver).load(predictOnly);
      predictRuntime.initialize();
      predictRuntime.step();
      const predictSnapshot = derivePlaygroundSnapshot(predictSession);
      assert.ok(predictSnapshot.traces.some((event) => event.type === 'query.received'), 'tracePredict emits query.received');
      assert.ok(predictSnapshot.traces.some((event) => event.type === 'knn.distancesComputed'), 'tracePredict emits knn.distancesComputed');
      assert.equal(predictSnapshot.metrics.revealed, 0, 'tracePredict initializes the reveal state');

      // Validator/runtime parity: every allowed operation has runtime
      // semantics (no silent no-op).
      const opScript = (steps, primitives = [], layout = { stage: [], side: [] }) => ({
        version: 1,
        id: 'op-parity',
        model: { adapter: 'linear-regression' },
        data: { source: 'workspace-or-default' },
        controls: [],
        layout,
        primitives,
        steps,
      });
      const runOps = (script) => {
        let session = createPlaygroundSession(lrPlayground, { source: lrSource, seed: 7, sessionId: 'prb-followup' });
        const driver = makeDriver(() => session, (next) => { session = next; });
        const runtime = createScriptRuntime(driver).load(script);
        runtime.initialize();
        for (let index = 0; index < script.steps.length; index += 1) runtime.step();
        return derivePlaygroundSnapshot(session);
      };
      const setControlSnap = runOps(opScript([{ id: 's', setControl: { weight: 1.5 } }]));
      assert.equal(setControlSnap.controls.weight, 1.5, 'setControl has runtime semantics');
      const invokeSnap = runOps(opScript([{ id: 't', invoke: { operation: 'traceFit', args: {} } }]));
      assert.ok(invokeSnap.traces.some((event) => event.type === 'training.completed'), 'invoke has runtime semantics');
      const revealSnap = runOps(opScript([
        { id: 't', invoke: { operation: 'traceFit', args: {} } },
        { id: 'r', reveal: true },
      ]));
      assert.equal(revealSnap.timeline.step, 1, 'reveal has runtime semantics');
      const hideSnap = runOps(
        opScript(
          [{ id: 'h', hide: 'scatter' }],
          [{ id: 'scatter', type: 'scatter', props: { points: '$model.scatterPoints', axes: '$model.axes' } }],
          { stage: ['scatter'], side: [] },
        ),
      );
      assert.equal(hideSnap.visualState.scatter, false, 'hide has runtime semantics');
      assert.ok(!hideSnap.primitives.some((primitive) => primitive.id === 'scatter'), 'hidden primitive is not materialized');
      const showSnap = runOps(
        opScript(
          [{ id: 's', show: 'scatter' }],
          [{ id: 'scatter', type: 'scatter', props: { points: '$model.scatterPoints', axes: '$model.axes' } }],
          { stage: ['scatter'], side: [] },
        ),
      );
      assert.ok(showSnap.primitives.some((primitive) => primitive.id === 'scatter'), 'show has runtime semantics');
      const highlightSnap = runOps(
        opScript(
          [{ id: 'h', highlight: 'scatter' }],
          [{ id: 'scatter', type: 'scatter', props: { points: '$model.scatterPoints', axes: '$model.axes' } }],
          { stage: ['scatter'], side: [] },
        ),
      );
      assert.equal(highlightSnap.visualState.highlight, 'scatter', 'highlight has runtime semantics');
      const annotateSnap = runOps(
        opScript(
          [{ id: 'a', annotate: { titleKey: 'test.title', bodyKey: 'test.body', params: { weight: '$controls.weight' } } }],
          [{ id: 'annotation', type: 'annotation', props: { observation: '$model.observation' } }],
          { stage: [], side: ['annotation'] },
        ),
      );
      const annotationPrimitive = annotateSnap.primitives.find((primitive) => primitive.type === 'annotation');
      assert.deepEqual(
        annotationPrimitive.props.observation,
        { titleKey: 'test.title', bodyKey: 'test.body', params: { weight: 0 } },
        'annotate changes the annotation primitive props',
      );
      const waitSnap = runOps(opScript([{ id: 'w', wait: true, durationMs: 100 }]));
      assert.equal(waitSnap.scriptState.step, 1, 'wait advances script state');
      assert.equal(waitSnap.timeline.step, 0, 'wait does not move the model timeline');
      const resetSnap = runOps(opScript([
        { id: 'set', setControl: { weight: 5 } },
        { id: 'r', reset: true },
      ]));
      assert.equal(resetSnap.controls.weight, 0, 'reset returns to the baseline controls');

      // runScenario and direct preset execution share the exact path.
      const sharedDataset = {
        name: 'R', task: 'regression',
        rows: [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }, { x: 3, y: 7 }, { x: 4, y: 9 }],
        columns: [
          { name: 'x', type: 'number', missing: 0 },
          { name: 'y', type: 'number', missing: 0 },
        ],
        featureColumns: ['x'], targetColumn: 'y',
      };
      const scenarioHost = createPlaygroundHost({ getDataset: () => sharedDataset });
      const scenarioAgent = createPlaygroundAgentApi(scenarioHost);
      await scenarioAgent.open({ playgroundId: 'linear-regression' });
      await scenarioAgent.runScenario('intro');
      const viaScenario = scenarioAgent.getState();
      const sharedSample = regressionPointsFromDataset(sharedDataset);
      const sharedSource = {
        kind: 'workspace-dataset', name: 'R', fingerprint: 'shared',
        points: sharedSample.points.map((point, index) => ({ id: `d${index}`, x: point.x, y: point.y })),
        feature: 'x', target: 'y', total: sharedSample.total, usingDataset: true,
      };
      const presetFull = runPresetSteps(lrPlayground, sharedSource, 'linear-regression.intuition', undefined, 7);
      assert.deepEqual(viaScenario.traces, presetFull.fingerprint.traces, 'runScenario traces == preset execution traces');
      assert.deepEqual(viaScenario.primitives, presetFull.fingerprint.primitives, 'runScenario primitives == preset execution primitives');
      await scenarioAgent.close();

      // UI must never special-case a model.
      for (const file of uiFiles) {
        const source = readFileSync(new URL(`../src/components/playground/${file}`, import.meta.url), 'utf-8');
        for (const forbidden of ['linear-regression', 'knn', 'START_TRAINING', 'START_NEIGHBOR_REVEAL']) {
          assert.ok(!source.includes(forbidden), `${file} must not contain model-specific "${forbidden}"`);
        }
      }
    }

    // PR B final follow-up: render contracts, visibility, visual semantics,
    // $data parity, model mismatch, script capabilities and restart.
    {
      const makeDriver = (getSession, setSession) => ({
        dispatch: (action) => setSession(dispatchPlaygroundAction(getSession(), action)),
        getState: () => derivePlaygroundSnapshot(getSession()),
        getAdapterId: () => getSession().adapterId,
        resetToBaseline: () => setSession(dispatchPlaygroundAction(getSession(), { type: 'RESET' })),
        subscribe: () => () => {},
      });
      const runN = (playground, source, presetId, seed, n) => {
        let session = createPlaygroundSession(playground, { source, seed, sessionId: 'prb-final' });
        const driver = makeDriver(() => session, (next) => { session = next; });
        const runtime = createScriptRuntime(driver).load(structuredClone(getPreset(presetId)));
        runtime.initialize();
        for (let index = 0; index < n; index += 1) runtime.step();
        return derivePlaygroundSnapshot(session);
      };
      const assertPrimitiveContract = (snapshot, label) => {
        for (const primitive of snapshot.primitives) {
          if (primitive.type === 'scatter') {
            assert.ok(Array.isArray(primitive.props.points), `${label} scatter points array`);
          }
          if (primitive.type === 'regression-line' || primitive.type === 'reference-line') {
            const { start, end } = primitive.props.line ?? {};
            assert.ok(
              Number.isFinite(start?.x) && Number.isFinite(start?.y)
              && Number.isFinite(end?.x) && Number.isFinite(end?.y),
              `${label} ${primitive.type} line endpoints finite`,
            );
          }
          if (primitive.type === 'neighbor-links') {
            assert.ok(
              Array.isArray(primitive.props.neighbors)
              && Array.isArray(primitive.props.points)
              && primitive.props.query && typeof primitive.props.query === 'object',
              `${label} neighbor-links contract`,
            );
          }
          if (primitive.type === 'loss-curve') {
            assert.ok(Array.isArray(primitive.props.lossHistory), `${label} loss-curve contract`);
          }
        }
      };

      // P0 render contract: LR opens without line-shape crashes; every line
      // primitive has finite endpoints; smoke contract for both models.
      const lrInitial = derivePlaygroundSnapshot(createPlaygroundSession(lrPlayground, { source: lrSource, seed: 7, sessionId: 'prb-final' }));
      assertPrimitiveContract(lrInitial, 'LR initial');
      const lrFull = runN(lrPlayground, lrSource, 'linear-regression.intuition', 7, 7);
      assertPrimitiveContract(lrFull, 'LR completed');
      const knnInitial = derivePlaygroundSnapshot(createPlaygroundSession(knnPlayground, { source: knnSource2, seed: 3, sessionId: 'prb-final' }));
      assertPrimitiveContract(knnInitial, 'KNN initial');

      // Visibility sequence: `when` controls primitive existence.
      const lrStep0 = runN(lrPlayground, lrSource, 'linear-regression.intuition', 7, 0);
      assert.ok(lrStep0.primitives.some((primitive) => primitive.type === 'scatter'), 'LR step 0 has scatter');
      assert.ok(lrStep0.primitives.some((primitive) => primitive.type === 'regression-line'), 'LR step 0 has regression-line');
      assert.ok(!lrStep0.primitives.some((primitive) => primitive.type === 'residual-lines'), 'LR step 0 hides residual-lines');
      assert.ok(!lrStep0.primitives.some((primitive) => primitive.type === 'reference-line'), 'LR step 0 hides reference-line');
      const lrAfterResiduals = runN(lrPlayground, lrSource, 'linear-regression.intuition', 7, 2);
      assert.ok(lrAfterResiduals.primitives.some((primitive) => primitive.type === 'residual-lines'), 'LR residual step reveals residual-lines');
      assert.ok(!lrAfterResiduals.primitives.some((primitive) => primitive.type === 'reference-line'), 'LR residual step still hides reference-line');
      assert.ok(lrFull.primitives.some((primitive) => primitive.type === 'reference-line'), 'LR final reveals reference-line');
      const knnBeforeRegions = runN(knnPlayground, knnSource2, 'knn.intro', 3, 5);
      const knnAfterRegions = runN(knnPlayground, knnSource2, 'knn.intro', 3, 6);
      assert.ok(!knnBeforeRegions.primitives.some((primitive) => primitive.type === 'decision-region'), 'KNN hides decision-region before regions step');
      assert.ok(knnAfterRegions.primitives.some((primitive) => primitive.type === 'decision-region'), 'KNN reveals decision-region after regions step');

      // highlight: materializer stamps the target primitive and renderers consume it.
      let highlightSession = createPlaygroundSession(lrPlayground, { source: lrSource, seed: 7, sessionId: 'prb-final' });
      const highlightDriver = makeDriver(() => highlightSession, (next) => { highlightSession = next; });
      const highlightRuntime = createScriptRuntime(highlightDriver).load({
        version: 1,
        id: 'highlight-test',
        model: { adapter: 'linear-regression' },
        data: { source: 'workspace-or-default' },
        controls: [],
        layout: { stage: ['scatter', 'regression-line'], side: [] },
        primitives: [
          { id: 'scatter', type: 'scatter', props: { points: '$model.scatterPoints', axes: '$model.axes' } },
          { id: 'regression-line', type: 'regression-line', props: { line: '$model.line', ranges: '$model.ranges' } },
        ],
        steps: [{ id: 'h', highlight: 'regression-line', durationMs: 100 }],
      });
      highlightRuntime.initialize();
      highlightRuntime.step();
      const highlightSnapshot = derivePlaygroundSnapshot(highlightSession);
      assert.equal(
        highlightSnapshot.primitives.find((primitive) => primitive.id === 'regression-line').props.highlighted,
        true,
        'highlighted target primitive carries props.highlighted=true',
      );
      assert.ok(
        !highlightSnapshot.primitives.find((primitive) => primitive.id === 'scatter').props.highlighted,
        'non-target primitive is not highlighted',
      );
      const rendererSources = uiFiles
        .filter((file) => file.startsWith('renderers/'))
        .map((file) => readFileSync(new URL(`../src/components/playground/${file}`, import.meta.url), 'utf-8'))
        .join('\n');
      assert.ok(rendererSources.includes('props.highlighted'), 'at least one renderer consumes props.highlighted');

      // $data parity: $data must describe the model's actual source.
      const lrFallbackData = lrInitial.dataState;
      assert.equal(lrFallbackData.task, 'regression', 'LR fallback $data.task is regression');
      assert.equal(lrFallbackData.rows.length, lrInitial.scene.scatterPoints.length, 'LR fallback $data.rows == model points');
      const workspaceMismatch = createPlaygroundSession(lrPlayground, {
        source: lrSource,
        seed: 7,
        sessionId: 'prb-final',
        dataset: classificationDataset,
      });
      assert.equal(
        derivePlaygroundSnapshot(workspaceMismatch).dataState.task,
        'regression',
        'LR fallback ignores an incompatible workspace classification dataset',
      );
      const knnWorkspaceSource = {
        kind: 'workspace-dataset',
        name: 'Class', fingerprint: 'knn-workspace',
        points: classificationDataset.rows.map((row, index) => ({
          id: index,
          features: { feature_a: row.feature_a, feature_b: row.feature_b },
          label: row.label,
        })),
        featureColumns: ['feature_a', 'feature_b'],
        trainRatio: 0.8,
        total: classificationDataset.rows.length,
        usingDataset: true,
      };
      const knnWorkspaceSession = createPlaygroundSession(knnPlayground, {
        source: knnWorkspaceSource,
        seed: 3,
        sessionId: 'prb-final',
        dataset: classificationDataset,
      });
      const knnWorkspaceData = derivePlaygroundSnapshot(knnWorkspaceSession).dataState;
      assert.equal(knnWorkspaceData.task, 'classification', 'KNN workspace $data.task is classification');
      assert.equal(knnWorkspaceData.rows.length, classificationDataset.rows.length, 'KNN workspace $data rows come from the workspace dataset');
      assert.deepEqual(knnWorkspaceData.featureColumns, ['feature_a', 'feature_b'], 'KNN workspace $data features come from the workspace dataset');

      // SCRIPT_MODEL_MISMATCH in both directions.
      const lrSession = createPlaygroundSession(lrPlayground, { source: lrSource, seed: 7, sessionId: 'prb-final' });
      assert.throws(
        () => dispatchPlaygroundAction(lrSession, { type: 'SCRIPT_LOAD', script: getPreset('knn.intro') }),
        (error) => error.code === 'SCRIPT_MODEL_MISMATCH' && error.details.expected === 'linear-regression',
        'LR session rejects a KNN script',
      );
      const knnSession = createPlaygroundSession(knnPlayground, { source: knnSource2, seed: 3, sessionId: 'prb-final' });
      assert.throws(
        () => dispatchPlaygroundAction(knnSession, { type: 'SCRIPT_LOAD', script: getPreset('linear-regression.intuition') }),
        (error) => error.code === 'SCRIPT_MODEL_MISMATCH' && error.details.expected === 'knn',
        'KNN session rejects an LR script',
      );

      // Script capabilities are independent of the model timeline.
      assert.equal(lrInitial.scriptState.totalSteps, 7, 'LR script has 7 steps');
      assert.equal(lrInitial.scene.training.totalSteps, 0, 'LR model timeline starts at 0');
      assert.equal(lrInitial.capabilities.canSeek, true, 'script canSeek from step 0');
      assert.equal(lrInitial.capabilities.canStep, true, 'script canStep from step 0');
      assert.equal(lrInitial.capabilities.canPlay, true, 'script canPlay from step 0');
      assert.equal(lrFull.capabilities.canStep, false, 'completed script canStep is false');
      assert.equal(lrFull.capabilities.canSeek, true, 'completed script canSeek stays true');
      assert.equal(lrFull.capabilities.canPlay, true, 'completed script canPlay is true (restartable)');

      // SCRIPT_PLAY on a completed script restarts from the beginning.
      let restartSession = createPlaygroundSession(lrPlayground, { source: lrSource, seed: 7, sessionId: 'prb-final' });
      const restartDriver = makeDriver(() => restartSession, (next) => { restartSession = next; });
      const restartRuntime = createScriptRuntime(restartDriver).load(structuredClone(getPreset('linear-regression.intuition')));
      restartRuntime.initialize();
      for (let index = 0; index < 7; index += 1) restartRuntime.step();
      assert.equal(derivePlaygroundSnapshot(restartSession).scriptState.step, 7, 'script completed');
      restartRuntime.play();
      assert.equal(derivePlaygroundSnapshot(restartSession).scriptState.step, 0, 'play restarts a completed script');
      assert.equal(derivePlaygroundSnapshot(restartSession).scriptState.status, 'playing', 'restart is playing');
      restartRuntime.step();
      assert.equal(derivePlaygroundSnapshot(restartSession).scriptState.step, 1, 'restarted script steps');

      // Binding validator: transforms are collected and validated; unknown
      // transforms are rejected; type mismatches fail with a stable error.
      const transformScript = structuredClone(validPreset);
      transformScript.id = 'transform-ok';
      transformScript.primitives = [{
        id: 'metric-card',
        type: 'metric-card',
        props: {
          metrics: {
            a: 'mean($data.values)',
            b: 'max($data.values)',
            c: 'extent($data.values)',
            d: 'formatNumber($data.values)',
            e: 'take($trace)',
          },
        },
      }];
      transformScript.layout = { stage: [], side: ['metric-card'] };
      transformScript.steps = [{ id: 'w', wait: true, durationMs: 100 }];
      assert.doesNotThrow(() => validateScript(transformScript), 'valid transforms pass the validator');
      const unknownTransform = structuredClone(transformScript);
      unknownTransform.primitives[0].props.metrics.x = 'unknownTransform($data.values)';
      assert.throws(() => validateScript(unknownTransform), (error) => error.code === 'SCRIPT_INVALID_BINDING', 'unknown transform is rejected');
      assert.ok(!('filterByEvent' in BINDING_TRANSFORMS), 'filterByEvent is removed from the transform whitelist');
      const typeMismatchContext = createBindingContext({ model: {}, data: {}, controls: { k: 5 }, trace: [], metrics: {} });
      assert.throws(
        () => resolveValue('mean($controls.k)', typeMismatchContext),
        (error) => error.code === 'SCRIPT_BINDING_TYPE_MISMATCH',
        'type mismatched transforms fail with a stable SCRIPT error',
      );
    }

    // PR B interface cleanup: Agent playback parity, validator targets,
    // $data target completeness, SCRIPT error passthrough, language policy.
    {
      const stripSessionId = (snapshot) => {
        const { sessionId, ...rest } = snapshot;
        return rest;
      };
      const makeHost = () => createPlaygroundHost({ getDataset: () => null });

      // Agent play/step/seek/reset must control the active (script) timeline.
      const hostA = makeHost();
      const agentA = createPlaygroundAgentApi(hostA);
      await agentA.open({ playgroundId: 'linear-regression' });
      assert.equal(agentA.getState().scriptState.step, 0, 'LR initial scriptState 0/7');
      assert.equal(agentA.getState().scriptState.totalSteps, 7, 'LR initial script total 7');
      await agentA.step();
      assert.equal(agentA.getState().scriptState.step, 1, 'agent.step() advances the script timeline');
      await agentA.seek(3);
      assert.equal(agentA.getState().scriptState.step, 3, 'agent.seek(3) seeks the script timeline');
      const hostB = makeHost();
      const agentB = createPlaygroundAgentApi(hostB);
      await agentB.open({ playgroundId: 'linear-regression' });
      await agentB.dispatch({ type: 'SCRIPT_SEEK', step: 3 });
      assert.deepEqual(
        stripSessionId(agentA.getState()),
        stripSessionId(agentB.getState()),
        'agent.seek() snapshot equals direct SCRIPT_SEEK snapshot',
      );
      await agentA.reset();
      const resetSnap = agentA.getState();
      assert.equal(resetSnap.scriptState.step, 0, 'agent.reset() returns to baseline script step');
      assert.equal(resetSnap.controls.weight, 0, 'agent.reset() returns to baseline controls');
      await agentA.runScenario('intro');
      assert.equal(agentA.getState().scriptState.status, 'completed', 'agent runScenario completes');
      await agentA.play();
      assert.equal(agentA.getState().scriptState.step, 0, 'agent.play() restarts a completed script');
      assert.equal(agentA.getState().scriptState.status, 'playing', 'restarted script is playing');
      await agentA.close();

      // No-script fallback: host.step() must route to the model timeline.
      const emptyScript = {
        version: 1,
        id: 'empty',
        model: { adapter: 'knn' },
        data: { source: 'workspace-or-default' },
        controls: [],
        layout: { stage: [], side: [] },
        primitives: [],
        steps: [],
      };
      const hostC = makeHost();
      const agentC = createPlaygroundAgentApi(hostC);
      await agentC.open({ playgroundId: 'knn-classification' });
      await agentC.dispatch({ type: 'SCRIPT_LOAD', script: emptyScript });
      assert.equal(agentC.getState().scriptState.totalSteps, 0, 'empty script has no active timeline');
      await agentC.step();
      assert.equal(agentC.getState().metrics.revealed, 1, 'no-script host.step() routes to model STEP');
      assert.equal(agentC.getState().scriptState.totalSteps, 0, 'script timeline untouched in no-script mode');
      await agentC.close();

      // Validator: show/hide/highlight must reference real primitives.
      const targetScript = (steps, primitives = []) => ({
        version: 1,
        id: 'target-check',
        model: { adapter: 'linear-regression' },
        data: { source: 'workspace-or-default' },
        controls: [],
        layout: { stage: primitives.map((primitive) => primitive.id), side: [] },
        primitives,
        steps,
      });
      const scatterPrimitive = { id: 'scatter', type: 'scatter', props: { points: '$model.scatterPoints', axes: '$model.axes' } };
      for (const operation of ['show', 'hide', 'highlight']) {
        assert.throws(
          () => validateScript(targetScript([{ id: 'x', [operation]: 'ghost' }], [scatterPrimitive])),
          (error) => error.code === 'SCRIPT_UNKNOWN_PRIMITIVE_REFERENCE'
            && error.details.operation === operation
            && error.details.primitiveId === 'ghost'
            && error.details.stepId === 'x',
          `${operation} ghost is rejected`,
        );
      }
      const annotateNoTarget = {
        version: 1,
        id: 'annotate-no-target',
        model: { adapter: 'linear-regression' },
        data: { source: 'workspace-or-default' },
        controls: [],
        layout: { stage: [], side: [] },
        primitives: [],
        steps: [{ id: 'x', annotate: { titleKey: 'a', bodyKey: 'b' } }],
      };
      assert.throws(() => validateScript(annotateNoTarget), (error) => error.code === 'SCRIPT_ANNOTATION_TARGET_MISSING', 'annotate without target is rejected');
      const annotateAmbiguous = {
        ...annotateNoTarget,
        primitives: [
          { id: 'a1', type: 'annotation' },
          { id: 'a2', type: 'annotation' },
        ],
        layout: { stage: [], side: ['a1', 'a2'] },
      };
      assert.throws(() => validateScript(annotateAmbiguous), (error) => error.code === 'SCRIPT_ANNOTATION_TARGET_AMBIGUOUS', 'multiple annotation primitives are rejected');

      // KNN fallback $data must contain the declared target column.
      const knnData = derivePlaygroundSnapshot(createPlaygroundSession(knnPlayground, {
        source: knnSource2,
        seed: 3,
        sessionId: 'prb-cleanup',
      })).dataState;
      assert.equal(knnData.task, 'classification', 'KNN fallback $data.task');
      assert.equal(knnData.targetColumn, 'label', 'KNN fallback $data.targetColumn');
      assert.ok(knnData.rows.every((row) => row[knnData.targetColumn] !== undefined), 'every KNN $data row contains the target');
      assert.deepEqual(
        [...new Set(knnData.rows.map((row) => row.label))].sort(),
        [...new Set(knnSource2.points.map((point) => point.label))].sort(),
        'KNN $data labels match the model source labels',
      );

      // SCRIPT contract errors pass through the Agent without OPERATION_FAILED.
      const mismatchHost = makeHost();
      const mismatchAgent = createPlaygroundAgentApi(mismatchHost);
      await mismatchAgent.open({ playgroundId: 'linear-regression' });
      await assert.rejects(
        mismatchAgent.dispatch({ type: 'SCRIPT_LOAD', script: getPreset('knn.intro') }),
        (error) => error.code === 'SCRIPT_MODEL_MISMATCH' && error.details.expected === 'linear-regression',
        'agent surfaces SCRIPT_MODEL_MISMATCH instead of OPERATION_FAILED',
      );
      assert.ok(SCRIPT_ERROR_CODES.includes('SCRIPT_MODEL_MISMATCH'), 'script error codes are centralized');
      await mismatchAgent.close();

      // Language policy: examples preserve the current UI preference while
      // explicit imports keep restoring the project language.
      const languageCase = (currentPrimary, currentSecondary, projectPrimary, projectSecondary, policy) => (
        resolveLanguagePreference({
          projectPrimary,
          projectSecondary,
          currentPrimary,
          currentSecondary,
          policy,
        })
      );
      assert.deepEqual(
        languageCase('en', null, 'zh', 'en', 'preserve-current'),
        { primary: 'en', secondary: null, apply: false },
        'English-only user keeps English when loading an example',
      );
      assert.deepEqual(
        languageCase('zh', null, 'en', 'zh', 'preserve-current'),
        { primary: 'zh', secondary: null, apply: false },
        'Chinese-only user keeps Chinese when loading an example',
      );
      assert.deepEqual(
        languageCase('en', 'zh', 'zh', 'en', 'preserve-current'),
        { primary: 'en', secondary: 'zh', apply: false },
        'bilingual user keeps their order when loading an example',
      );
      assert.deepEqual(
        languageCase('en', null, 'zh', 'en', 'project'),
        { primary: 'zh', secondary: 'en', apply: true },
        'explicit project import restores the project language',
      );
      assert.deepEqual(
        languageCase('en', 'zh', undefined, undefined, 'project'),
        { primary: 'en', secondary: 'zh', apply: false },
        'a project without language keeps the current preference',
      );
      const mainSource = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf-8');
      assert.ok(mainSource.includes("languagePolicy: 'preserve-current'"), 'examples load with preserve-current');
      assert.ok(mainSource.includes('applyProject(JSON.parse(await file.text()))'), 'import keeps the default project policy');

      // INVALID_SCRIPT is part of the script error contract and passes
      // through the Agent.
      assert.ok(SCRIPT_ERROR_CODES.includes('INVALID_SCRIPT'), 'INVALID_SCRIPT is a centralized script error code');
      const invalidHost = makeHost();
      const invalidAgent = createPlaygroundAgentApi(invalidHost);
      await invalidAgent.open({ playgroundId: 'linear-regression' });
      await assert.rejects(
        invalidAgent.dispatch({ type: 'SCRIPT_LOAD', script: { version: 99, model: { adapter: 'linear-regression' } } }),
        (error) => error.code === 'INVALID_SCRIPT',
        'agent surfaces INVALID_SCRIPT for malformed scripts',
      );
      await invalidAgent.close();

      // Playground renderer failures must stay inside an Error Boundary.
      const boundarySource = readFileSync(new URL('../src/components/playground/PlaygroundErrorBoundary.jsx', import.meta.url), 'utf-8');
      assert.ok(boundarySource.includes('getDerivedStateFromError'), 'Error Boundary uses getDerivedStateFromError');
      assert.ok(boundarySource.includes("t('playground.errorReset')") && boundarySource.includes("t('playground.errorClose')"), 'Error Boundary offers Reset and Close');
      const dialogSource = readFileSync(new URL('../src/components/playgrounds/PlaygroundDialog.jsx', import.meta.url), 'utf-8');
      assert.ok(dialogSource.includes('PlaygroundErrorBoundary'), 'PlaygroundDialog wraps the playground in an Error Boundary');
    }

    // PR C: Agent generated visualization scripts (no real LLM; preset-first).
    {
      const hostC = createPlaygroundHost({ getDataset: () => null });
      const agentC = createPlaygroundAgentApi(hostC);

      // Capabilities and presets are introspectable.
      const capabilities = agentC.getCapabilities();
      assert.equal(capabilities.apiVersion, 1, 'agent capabilities version');
      assert.ok(capabilities.models.some((model) => model.id === 'linear-regression' && model.operations.includes('traceFit')), 'LR capabilities expose operations');
      assert.ok(capabilities.models.some((model) => model.id === 'knn' && model.operations.includes('tracePredict')), 'KNN capabilities expose operations');
      assert.deepEqual(agentC.listPresets().map((preset) => preset.id), ['linear-regression.intuition', 'knn.intro'], 'agent lists presets');
      assert.ok(capabilities.primitives.includes('scatter') && capabilities.primitives.includes('vote-bars'), 'agent lists primitives');

      await agentC.open({ playgroundId: 'knn-classification' });

      // loadPreset applies parameters on top of a preset.
      const loaded = await agentC.loadPreset({ presetId: 'knn.intro', parameters: { k: 3 } });
      assert.equal(loaded.script.id, 'knn.intro', 'loadPreset loads the preset');
      assert.equal(loaded.controls.k, 3, 'loadPreset applies parameters');

      // validateScript is a non-throwing query.
      assert.deepEqual(agentC.validateScript(structuredClone(getPreset('knn.intro'))), { valid: true }, 'agent validates a good script');
      assert.deepEqual(agentC.validateScript({ version: 999, model: { adapter: 'knn' } }), { valid: false, code: 'INVALID_SCRIPT', details: { reason: 'version' } }, 'agent rejects a malformed script');

      // loadScript/getScript/exportScript roundtrip.
      const scriptToLoad = structuredClone(getPreset('knn.intro'));
      await agentC.loadScript(scriptToLoad);
      assert.equal(agentC.getState().script.id, 'knn.intro', 'loadScript activates the script');
      assert.deepEqual(agentC.getScript(), scriptToLoad, 'getScript returns the active script');
      assert.deepEqual(agentC.exportScript(), scriptToLoad, 'exportScript exports a JSON-safe copy');
      await assert.rejects(
        agentC.loadScript({ version: 999, model: { adapter: 'knn' } }),
        (error) => error.code === 'INVALID_SCRIPT',
        'loadScript rejects malformed scripts with the stable code',
      );

      // generateScript: preset-first, parameterized and generated modes.
      const kGoal = await agentC.generateScript({ goal: 'k=1 和 k=15 的区别' });
      assert.equal(kGoal.mode, 'parameterized', 'k comparison goal parameterizes the KNN preset');
      assert.equal(kGoal.dryRun.valid, true, 'parameterized script passes the dry run');
      assert.deepEqual(kGoal.script.steps[0].setControl, { k: 1 }, 'k goal sets the k parameter');
      assert.equal(agentC.getState().script.id, kGoal.script.id, 'generateScript loads the accepted script');

      const introGoal = await agentC.generateScript({ goal: '入门' });
      assert.equal(introGoal.mode, 'preset', 'intro goal selects an exact preset');
      assert.equal(introGoal.script.id, 'knn.intro', 'intro goal picks the KNN preset');

      await agentC.close();
      await agentC.open({ playgroundId: 'linear-regression' });
      const lrGoal = await agentC.generateScript({ goal: '学习率太高会发生什么' });
      assert.equal(lrGoal.mode, 'parameterized', 'learning-rate goal parameterizes the LR preset');
      assert.equal(lrGoal.dryRun.valid, true, 'LR parameterized script passes the dry run');
      assert.deepEqual(lrGoal.script.steps[0].setControl, { showResiduals: true, showBestFit: true }, 'LR parameter step is applied');

      await agentC.close();
      // Fallback (C7): a failing injected generator falls back to the preset.
      const failingHost = createPlaygroundHost({
        getDataset: () => null,
        scriptGenerator: () => ({ script: { version: 999, model: { adapter: 'linear-regression' } } }),
      });
      const failingAgent = createPlaygroundAgentApi(failingHost);
      await failingAgent.open({ playgroundId: 'linear-regression' });
      const fallback = await failingAgent.generateScript({ goal: 'anything' });
      assert.equal(fallback.mode, 'preset', 'invalid generation falls back to a preset');
      assert.equal(fallback.fallback, true, 'fallback is marked');
      assert.equal(fallback.dryRun.valid, true, 'fallback preset passes the dry run');
      assert.equal(failingAgent.getState().script.id, fallback.script.id, 'fallback script is loaded');
      await failingAgent.close();

      // Dry-run failure without a structural validator error still falls back.
      const replayBreakingHost = createPlaygroundHost({
        getDataset: () => null,
        scriptGenerator: () => ({
          script: {
            version: 1,
            id: 'replay-break',
            model: { adapter: 'linear-regression' },
            data: { source: 'workspace-or-default' },
            controls: [],
            layout: { stage: [], side: [] },
            primitives: [],
            steps: [{ id: 'm', invoke: { operation: 'moveQuery', args: { x: 'abc' } } }],
          },
        }),
      });
      const replayAgent = createPlaygroundAgentApi(replayBreakingHost);
      await replayAgent.open({ playgroundId: 'linear-regression' });
      const replayFallback = await replayAgent.generateScript({ goal: 'bad replay' });
      assert.equal(replayFallback.mode, 'preset', 'a replay-breaking generated script falls back');
      assert.equal(replayFallback.fallback, true, 'dry-run failure triggers fallback');
      await replayAgent.close();

      // Mock generator success: a valid custom script is accepted and loaded.
      const customScript = {
        version: 1,
        id: 'mock-generated',
        model: { adapter: 'linear-regression' },
        data: { source: 'workspace-or-default' },
        controls: [],
        layout: { stage: ['scatter', 'regression-line'], side: [] },
        primitives: [
          { id: 'scatter', type: 'scatter', props: { points: '$model.scatterPoints', axes: '$model.axes' } },
          { id: 'regression-line', type: 'regression-line', props: { line: '$model.line', ranges: '$model.ranges' } },
        ],
        steps: [{ id: 'w', wait: true, durationMs: 100 }],
      };
      const mockHost = createPlaygroundHost({
        getDataset: () => null,
        scriptGenerator: () => ({ script: customScript, rationale: 'mock' }),
      });
      const mockAgent = createPlaygroundAgentApi(mockHost);
      await mockAgent.open({ playgroundId: 'linear-regression' });
      const accepted = await mockAgent.generateScript({ goal: 'custom' });
      assert.equal(accepted.mode, 'generated', 'valid mock generation is accepted');
      assert.equal(accepted.dryRun.valid, true, 'mock generation passes the dry run');
      assert.equal(mockAgent.getState().script.id, 'mock-generated', 'mock script is loaded');
      await mockAgent.close();

      // Agent-facing dryRunScript result shape.
      await agentC.open({ playgroundId: 'linear-regression' });
      const dryRunResult = agentC.dryRunScript(structuredClone(getPreset('linear-regression.intuition')));
      assert.equal(dryRunResult.valid, true, 'dryRunScript reports valid');
      assert.ok(dryRunResult.estimatedSteps > 0 && dryRunResult.estimatedPrimitiveUpdates > 0, 'dryRunScript estimates work');
      await agentC.close();
    }

    // PR D: agent context and semantic contracts.
    {
      // Semantic schemas must match the semantic state adapters produce.
      const lrAdapter = getModelAdapter('linear-regression');
      const knnAdapter = getModelAdapter('knn');
      for (const [adapter, playground, source] of [
        [lrAdapter, lrPlayground, lrSource],
        [knnAdapter, knnPlayground, knnSource2],
      ]) {
        assert.ok(adapter.semanticSchema && Object.keys(adapter.semanticSchema).length > 0, `${adapter.id} declares a semantic schema`);
        const session = createPlaygroundSession(playground, { source, seed: 7, sessionId: 'prd-schema' });
        const derived = adapter.deriveScene(session.modelState, { controls: session.controls, source: session.sourceData });
        const modelContext = {
          ...derived.scene,
          metrics: derived.metrics ?? {},
          formula: derived.formula ?? null,
          observation: derived.observation ?? null,
        };
        for (const field of Object.keys(adapter.semanticSchema)) {
          assert.ok(field in modelContext, `${adapter.id} semantic schema field ${field} exists in the semantic state`);
        }
        for (const [operation, schema] of Object.entries(adapter.scriptOperations)) {
          assert.ok(schema.args && typeof schema.args === 'object', `${adapter.id}.${operation} declares args`);
          assert.ok(Array.isArray(schema.effects), `${adapter.id}.${operation} declares effects`);
          for (const bucket of ['alwaysProducesTrace', 'mayProduceTrace', 'enablesTrace']) {
            assert.ok(Array.isArray(schema[bucket]), `${adapter.id}.${operation} declares ${bucket}`);
            assert.ok(schema[bucket].every((type) => TRACE_EVENTS[adapter.id].includes(type)), `${adapter.id}.${operation} ${bucket} traces are known`);
          }
          assert.equal(typeof adapter.scriptOperationActions[operation], 'function', `${adapter.id}.${operation} has a translator`);
        }
      }

      // Primitive schemas: every type has one; required props have compatible
      // bindings in the presets.
      assert.deepEqual(Object.keys(getPrimitiveSchema('scatter')?.props ?? {}), ['points', 'axes'], 'scatter schema');
      assert.ok(PRIMITIVE_TYPES.every((type) => getPrimitiveSchema(type)), 'every primitive type has a schema');
      for (const presetId of ['linear-regression.intuition', 'knn.intro']) {
        const preset = getPreset(presetId);
        for (const declaration of preset.primitives) {
          const schema = getPrimitiveSchema(declaration.type);
          for (const [prop, propSchema] of Object.entries(schema.props)) {
            if (!propSchema.required) continue;
            const binding = declaration.props?.[prop];
            assert.ok(typeof binding === 'string', `${presetId} ${declaration.id} required prop ${prop} uses a binding`);
            assert.ok(
              (schema.compatibleBindings[prop] ?? []).includes(binding),
              `${presetId} ${declaration.id}.${prop} binding ${binding} is compatible`,
            );
          }
        }
      }

      // Trace payload schemas cover every declared event.
      for (const [adapterId, events] of Object.entries(TRACE_EVENTS)) {
        for (const event of events) {
          assert.ok(TRACE_PAYLOAD_SCHEMAS[event], `${adapterId} trace ${event} has a payload schema`);
        }
      }

      // inspectContext answers the PR D acceptance questions from schemas.
      const contextHost = createPlaygroundHost({ getDataset: () => null });
      const contextAgent = createPlaygroundAgentApi(contextHost);
      await contextAgent.open({ playgroundId: 'knn-classification' });
      const context = contextAgent.inspectContext();
      assert.equal(context.version, 1, 'inspectContext version');
      assert.equal(context.playground.modelAdapter, 'knn', 'inspectContext identifies the model adapter');
      assert.equal(context.playground.task, 'classification', 'inspectContext identifies the task');
      assert.ok(context.model.operations.tracePredict, 'inspectContext exposes operation schemas');
      assert.ok(context.model.semanticFields.includes('displayPoints'), 'inspectContext exposes semantic fields');
      assert.ok(context.data.featureColumns.includes('x1'), 'inspectContext exposes data features');
      assert.equal(context.data.targetColumn, 'label', 'inspectContext exposes the target column');
      assert.ok(context.data.rowCount > 0 && context.data.statistics.x1, 'inspectContext exposes data statistics');
      assert.ok(context.primitives.some((primitive) => primitive.type === 'neighbor-links' && primitive.props.neighbors), 'inspectContext exposes primitive schemas');
      assert.ok(context.bindings.some((binding) => binding.prefix === '$model' && binding.fields.includes('neighbors')), 'inspectContext exposes bindings');
      assert.equal(context.resourceLimits.maxSteps, RESOURCE_LIMITS.maxSteps, 'inspectContext exposes resource limits');
      assert.ok(context.traces.includes('knn.distancesComputed') && context.traceSchemas['knn.neighborSelected'], 'inspectContext exposes trace schemas');
      await contextAgent.close();

      // Dynamic script baseline: SCRIPT_LOAD captures the current semantic
      // state; SCRIPT_RESET returns to it while RESET returns to the open state.
      let baselineSession = createPlaygroundSession(knnPlayground, { source: knnSource2, seed: 3, sessionId: 'prd-baseline' });
      baselineSession = dispatchPlaygroundAction(baselineSession, { type: 'SET_CONTROL', key: 'showDecisionRegions', value: true });
      baselineSession = dispatchPlaygroundAction(baselineSession, { type: 'SCRIPT_LOAD', script: getPreset('knn.intro') });
      baselineSession = dispatchPlaygroundAction(baselineSession, { type: 'SCRIPT_STEP' });
      assert.equal(baselineSession.controls.showDecisionRegions, true, 'edit survives into the script baseline');
      const scriptReset = dispatchPlaygroundAction(baselineSession, { type: 'SCRIPT_RESET' });
      assert.equal(scriptReset.controls.showDecisionRegions, true, 'SCRIPT_RESET returns to the script baseline');
      const modelReset = dispatchPlaygroundAction(scriptReset, { type: 'RESET' });
      assert.equal(modelReset.controls.showDecisionRegions, false, 'RESET returns to the open session baseline');

      // Strict dry run: unresolved required bindings and resolved grid cost.
      const unresolvedScript = {
        version: 1,
        id: 'unresolved',
        model: { adapter: 'knn' },
        data: { source: 'workspace-or-default' },
        controls: [],
        layout: { stage: ['scatter'], side: [] },
        primitives: [{ id: 'scatter', type: 'scatter', props: { points: '$model.missingField', axes: '$model.axes' } }],
        steps: [{ id: 'w', wait: true, durationMs: 100 }],
      };
      const unresolvedHost = createPlaygroundHost({ getDataset: () => null });
      const unresolvedAgent = createPlaygroundAgentApi(unresolvedHost);
      await unresolvedAgent.open({ playgroundId: 'knn-classification' });
      const unresolved = unresolvedAgent.dryRunScript(unresolvedScript);
      assert.equal(unresolved.valid, false, 'unresolved required binding fails the dry run');
      assert.equal(unresolved.code, 'SCRIPT_BINDING_UNRESOLVED', 'unresolved binding has a stable code');
      const gridScript = {
        version: 1,
        id: 'grid',
        model: { adapter: 'knn' },
        data: { source: 'workspace-or-default' },
        controls: [],
        layout: { stage: ['decision-region'], side: [] },
        primitives: [{
          id: 'decision-region',
          type: 'decision-region',
          when: '$controls.showDecisionRegions',
          props: { cells: '$model.decisionRegions.cells', resolution: 12 },
        }],
        steps: [{ id: 's', setControl: { showDecisionRegions: true } }, { id: 'w', wait: true, durationMs: 100 }],
      };
      const gridResult = unresolvedAgent.dryRunScript(gridScript);
      assert.equal(gridResult.valid, true, 'grid script passes the dry run');
      assert.equal(gridResult.decisionGridCost, 144, 'decisionGridCost uses the resolved resolution');
      await unresolvedAgent.close();
    }

    // PR D.1: close semantic contract gaps.
    {
      const modelContextFor = (adapter, playground, source) => {
        const session = createPlaygroundSession(playground, { source, seed: 7, sessionId: 'prd1' });
        const derived = adapter.deriveScene(session.modelState, { controls: session.controls, source: session.sourceData });
        return {
          ...derived.scene,
          metrics: derived.metrics ?? {},
          formula: derived.formula ?? null,
          observation: derived.observation ?? null,
        };
      };
      const lrContext = modelContextFor(getModelAdapter('linear-regression'), lrPlayground, lrSource);
      const knnContext = modelContextFor(getModelAdapter('knn'), knnPlayground, knnSource2);

      // 1. Deep primitive type validation.
      assert.equal(validateType([{ x: 1, y: 2 }], 'array<point2d>'), true, 'valid point2d elements pass');
      assert.equal(validateType([123, 'invalid'], 'array<point2d>'), false, 'invalid point2d elements fail');
      assert.equal(validateType([{ x: 1 }], 'array<point2d>'), false, 'point2d without y fails');
      assert.equal(validateType([{ pointId: 'p', distance: 1, label: 'a' }], 'array<neighbor>'), true, 'valid neighbor passes');
      assert.equal(validateType([{ distance: 1 }], 'array<neighbor>'), false, 'neighbor without pointId fails');
      assert.equal(validateType([{ x: 1, y: 2, label: 'a' }], 'array<classifiedPoint2d>'), true, 'valid classified point passes');
      const badContract = validatePrimitiveContract({
        id: 'scatter',
        type: 'scatter',
        props: { points: [123, 'invalid'], axes: { x: 'a', y: 'b' } },
      });
      assert.equal(badContract.valid, false, 'deep primitive contract rejects malformed elements');
      assert.equal(badContract.code, 'SCRIPT_PRIMITIVE_CONTRACT_VIOLATION', 'deep contract failure has a stable code');

      // 2. semanticSchema <-> compatibleBindings consistency.
      const resolvePath = (obj, parts) => parts.reduce((current, key) => (current == null ? undefined : current[key]), obj);
      for (const schema of listPrimitiveSchemas()) {
        for (const bindings of Object.values(schema.compatibleBindings ?? {})) {
          for (const binding of bindings) {
            if (!binding.startsWith('$model.')) continue;
            const parts = binding.replace('$model.', '').split('.');
            const matches = [
              ['linear-regression', lrContext],
              ['knn', knnContext],
            ].filter(([, context]) => parts[0] in context);
            assert.ok(matches.length > 0, `${binding} first segment exists in a semantic schema`);
            for (const [adapterId, context] of matches) {
              assert.ok(resolvePath(context, parts) !== undefined, `${binding} resolves in the ${adapterId} semantic state`);
            }
          }
        }
      }
      assert.ok(!getPrimitiveSchema('scatter').compatibleBindings.points.includes('$model.points'), 'no stale $model.points alias');
      assert.ok(!getPrimitiveSchema('residual-lines').compatibleBindings.points.includes('$model.residuals'), 'no stale $model.residuals alias');
      assert.ok(!getPrimitiveSchema('query-point').compatibleBindings.query.includes('$model.query'), 'no stale $model.query alias');
      assert.equal(resolvePath(lrContext, ['training', 'missing']), undefined, 'nested semantic gaps resolve to undefined');

      // 3. scriptBaseline restores traces together with the semantic state.
      let baselineSession = createPlaygroundSession(knnPlayground, { source: knnSource2, seed: 3, sessionId: 'prd1-baseline' });
      baselineSession = dispatchPlaygroundAction(baselineSession, { type: 'ADD_TRAINING_POINT', x: 2.5, y: -1.5, label: 'red' });
      const editedTraces = baselineSession.traces.slice();
      baselineSession = dispatchPlaygroundAction(baselineSession, { type: 'SCRIPT_LOAD', script: getPreset('knn.intro') });
      baselineSession = dispatchPlaygroundAction(baselineSession, { type: 'SCRIPT_STEP' });
      baselineSession = dispatchPlaygroundAction(baselineSession, { type: 'SCRIPT_RESET' });
      assert.deepEqual(baselineSession.traces, editedTraces, 'SCRIPT_RESET restores the trace baseline captured at SCRIPT_LOAD');
      assert.ok(
        baselineSession.modelState.rawTrain.some((point) => point.features.a === 2.5 && point.features.b === -1.5),
        'semantic state matches the edited script baseline',
      );

      // 4. Resource limits: literal and resolved decision resolution enforced.
      const bigGrid = {
        version: 1,
        id: 'big-grid',
        model: { adapter: 'knn' },
        data: { source: 'workspace-or-default' },
        controls: [],
        layout: { stage: ['decision-region'], side: [] },
        primitives: [{
          id: 'decision-region',
          type: 'decision-region',
          props: { cells: '$model.decisionRegions.cells', resolution: 1000 },
        }],
        steps: [{ id: 'w', wait: true, durationMs: 100 }],
      };
      assert.throws(() => validateScript(bigGrid), (error) => error.code === 'SCRIPT_TOO_COMPLEX', 'literal resolution over the limit is rejected');
      let resolvedSession = createPlaygroundSession(knnPlayground, { source: knnSource2, seed: 3, sessionId: 'prd1-res' });
      resolvedSession = { ...resolvedSession, dataState: { ...resolvedSession.dataState, resolutionValue: 1000 } };
      const resolvedGrid = {
        version: 1,
        id: 'resolved-grid',
        model: { adapter: 'knn' },
        data: { source: 'workspace-or-default' },
        controls: [],
        layout: { stage: ['decision-region'], side: [] },
        primitives: [{
          id: 'decision-region',
          type: 'decision-region',
          props: { cells: '$model.decisionRegions.cells', resolution: '$data.resolutionValue' },
        }],
        steps: [{ id: 's', setControl: { showDecisionRegions: true } }, { id: 'w', wait: true, durationMs: 100 }],
      };
      const resolvedResource = dryRunScript({ script: resolvedGrid, session: resolvedSession });
      assert.equal(resolvedResource.valid, false, 'resolved resolution over the limit fails the dry run');
      assert.equal(resolvedResource.code, 'SCRIPT_TOO_COMPLEX', 'resource failure has a stable code');

      // 5. Optional unresolved bindings warn but stay valid.
      const optionalWarnHost = createPlaygroundHost({ getDataset: () => null });
      const optionalWarnAgent = createPlaygroundAgentApi(optionalWarnHost);
      await optionalWarnAgent.open({ playgroundId: 'knn-classification' });
      const optionalWarnScript = {
        version: 1,
        id: 'optional-warn',
        model: { adapter: 'knn' },
        data: { source: 'workspace-or-default' },
        controls: [],
        layout: { stage: ['scatter'], side: [] },
        primitives: [{
          id: 'scatter',
          type: 'scatter',
          props: { points: '$model.displayPoints', axes: '$model.missingAxes' },
        }],
        steps: [{ id: 'w', wait: true, durationMs: 100 }],
      };
      const optionalWarn = optionalWarnAgent.dryRunScript(optionalWarnScript);
      assert.equal(optionalWarn.valid, true, 'optional unresolved binding keeps the dry run valid');
      assert.ok(optionalWarn.warnings.some((warning) => warning.includes('missingAxes')), 'optional unresolved binding produces a warning');
      await optionalWarnAgent.close();

      // 6. Runtime trace payloads match their required/optional schemas.
      const runPresetSnapshots = (playground, source, presetId, seed) => {
        let session = createPlaygroundSession(playground, { source, seed, sessionId: 'prd1-trace' });
        const driver = {
          dispatch: (action) => { session = dispatchPlaygroundAction(session, action); },
          getState: () => derivePlaygroundSnapshot(session),
          getAdapterId: () => session.adapterId,
          resetToBaseline: () => { session = dispatchPlaygroundAction(session, { type: 'RESET' }); },
          subscribe: () => () => {},
        };
        const runtime = createScriptRuntime(driver).load(structuredClone(getPreset(presetId)));
        runtime.initialize();
        const total = getPreset(presetId).steps.length;
        for (let index = 0; index < total; index += 1) runtime.step();
        return derivePlaygroundSnapshot(session).traces;
      };
      const emittedTraces = [
        ...runPresetSnapshots(lrPlayground, lrSource, 'linear-regression.intuition', 7),
        ...runPresetSnapshots(knnPlayground, knnSource2, 'knn.intro', 3),
      ];
      for (const event of emittedTraces) {
        const traceCheck = validateTracePayload(event);
        assert.equal(traceCheck.valid, true, `trace ${event.type} payload matches its schema`);
      }

      // 7. inspectContext is internally consistent with every schema source.
      const schemaHost = createPlaygroundHost({ getDataset: () => null });
      const schemaAgent = createPlaygroundAgentApi(schemaHost);
      await schemaAgent.open({ playgroundId: 'knn-classification' });
      const schemaContext = schemaAgent.inspectContext();
      const knnSchemaAdapter = getModelAdapter('knn');
      assert.deepEqual(schemaContext.model.semanticFields, Object.keys(knnSchemaAdapter.semanticSchema), 'inspectContext semantic fields match the schema');
      assert.deepEqual(schemaContext.model.operations, knnSchemaAdapter.scriptOperations, 'inspectContext operations match the schemas');
      assert.deepEqual(schemaContext.traces, TRACE_EVENTS['knn'], 'inspectContext traces match the registry');
      assert.deepEqual(Object.keys(schemaContext.traceSchemas), TRACE_EVENTS['knn'], 'inspectContext trace schemas match the registry');
      assert.deepEqual(schemaContext.resourceLimits, RESOURCE_LIMITS, 'inspectContext resource limits match the enforced limits');
      assert.deepEqual(schemaContext.primitives, listPrimitiveSchemas(), 'inspectContext primitive schemas match the registry');
      const capabilitySchemas = schemaAgent.getCapabilities().models.find((model) => model.id === 'knn').operationSchemas;
      assert.deepEqual(capabilitySchemas, knnSchemaAdapter.scriptOperations, 'getCapabilities operation schemas match the adapters');
      await schemaAgent.close();
    }

    // PR D.2: final agent contract fidelity cleanup.
    {
      const runOperation = (session, operationName, args = {}) => {
        const adapter = getModelAdapter(session.adapterId);
        const before = session.traces.slice();
        const action = adapter.scriptOperationActions[operationName](args);
        const next = dispatchPlaygroundAction(session, action);
        const delta = next.traces.slice(before.length).map((event) => event.type);
        return { next, delta, schema: adapter.scriptOperations[operationName] };
      };
      const assertImmediateTraceContract = (session, operationName, args = {}) => {
        const { delta, schema } = runOperation(session, operationName, args);
        const permitted = new Set([...(schema.alwaysProducesTrace ?? []), ...(schema.mayProduceTrace ?? [])]);
        assert.ok(delta.every((type) => permitted.has(type)), `${operationName} immediate delta ${delta.join(',')} ⊆ always∪may`);
        for (const type of schema.alwaysProducesTrace ?? []) {
          assert.ok(delta.includes(type), `${operationName} always event ${type} is actually observed`);
        }
        for (const type of schema.enablesTrace ?? []) {
          assert.ok(TRACE_EVENTS[session.adapterId].includes(type), `${operationName} enablesTrace ${type} is known`);
        }
        return delta;
      };

      // LR traceFit: immediate events come from START_TRAINING only; STEP-only
      // events stay in enablesTrace.
      const lrFitSession = createPlaygroundSession(lrPlayground, { source: lrSource, seed: 7, sessionId: 'prd2' });
      const lrFitDelta = assertImmediateTraceContract(lrFitSession, 'traceFit');
      assert.ok(!lrFitDelta.includes('prediction.updated') && !lrFitDelta.includes('residuals.computed'), 'traceFit does not emit STEP-only events');
      // Divergence path: observed delta still obeys always/may.
      const lrDivergeSession = createPlaygroundSession(lrPlayground, {
        source: lrSource,
        seed: 7,
        sessionId: 'prd2-div',
        controls: { learningRate: 1.5, trainingSteps: 5 },
      });
      const lrDivergeDelta = assertImmediateTraceContract(lrDivergeSession, 'traceFit');
      assert.ok(!lrDivergeDelta.includes('parameters.updated'), 'diverged traceFit may skip parameters.updated');

      // KNN tracePredict: neighbor/vote/prediction are enabled, not immediate.
      const knnPredictSession = createPlaygroundSession(knnPlayground, { source: knnSource2, seed: 3, sessionId: 'prd2' });
      const knnPredictDelta = assertImmediateTraceContract(knnPredictSession, 'tracePredict');
      assert.deepEqual(knnPredictDelta, ['query.received', 'knn.distancesComputed'], 'tracePredict emits exactly the query traces');
      // KNN moveQuery with a fresh reveal state emits only query traces...
      const knnMoveFresh = assertImmediateTraceContract(knnPredictSession, 'moveQuery', { x: 0, y: 0 });
      assert.deepEqual(knnMoveFresh, ['query.received', 'knn.distancesComputed'], 'fresh moveQuery emits only query traces');
      // ...but with an active reveal state it may emit neighbor/vote immediately.
      let revealedSession = dispatchPlaygroundAction(knnPredictSession, { type: 'START_NEIGHBOR_REVEAL' });
      revealedSession = dispatchPlaygroundAction(revealedSession, { type: 'STEP' });
      const knnMoveRevealed = assertImmediateTraceContract(revealedSession, 'moveQuery', { x: 0, y: 0 });
      assert.ok(knnMoveRevealed.includes('knn.neighborSelected'), 'moveQuery may emit neighbor events when already revealed');

      // controlSchemas match the Playground descriptors and cover current values.
      for (const [playground, source] of [[lrPlayground, lrSource], [knnPlayground, knnSource2]]) {
        const controlHost = createPlaygroundHost({ getDataset: () => null });
        const controlAgent = createPlaygroundAgentApi(controlHost);
        await controlAgent.open({ playgroundId: playground.id });
        const controlContext = controlAgent.inspectContext();
        const descriptors = getPlayground(playground.id).controls;
        assert.deepEqual(controlContext.controlSchemas, descriptors, `${playground.id} controlSchemas match the descriptors`);
        for (const key of Object.keys(controlContext.controls)) {
          assert.ok(controlContext.controlSchemas.some((schema) => schema.key === key), `${playground.id} current control ${key} has a schema`);
        }
        for (const schema of controlContext.controlSchemas) {
          assert.ok(schema.key in controlContext.controls, `${playground.id} schema key ${schema.key} is a real control`);
        }
        await controlAgent.close();
      }

      // Composite type contracts reject malformed records.
      assert.equal(validateType({}, 'line2d'), false, 'empty line2d fails');
      assert.equal(validateType({}, 'axes2d'), false, 'empty axes2d fails');
      assert.equal(validateType({ xMin: 0 }, 'ranges2d'), false, 'partial ranges2d fails');
      assert.equal(validateType({ resolution: 48, cells: [123] }, 'decisionRegion'), false, 'decisionRegion with malformed cells fails');
      assert.equal(validateType({ counts: 'bad' }, 'voteState'), false, 'voteState with non-object counts fails');
      assert.equal(validateType({ start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, weight: 1, bias: 0 }, 'line2d'), true, 'valid line2d passes');
      const badLineContract = validatePrimitiveContract({
        id: 'line',
        type: 'regression-line',
        props: { line: {}, ranges: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 } },
      });
      assert.equal(badLineContract.valid, false, 'regression-line with empty line fails the primitive contract');

      // decision-region resource validation is type-specific.
      const nonRegionWithResolution = {
        version: 1,
        id: 'non-region',
        model: { adapter: 'knn' },
        data: { source: 'workspace-or-default' },
        controls: [],
        layout: { stage: ['scatter'], side: [] },
        primitives: [{ id: 'scatter', type: 'scatter', props: { points: '$model.displayPoints', resolution: 1000 } }],
        steps: [{ id: 'w', wait: true, durationMs: 100 }],
      };
      assert.doesNotThrow(() => validateScript(nonRegionWithResolution), 'non-decision-region primitives ignore the resolution limit');
      const zeroResolution = {
        version: 1,
        id: 'zero-res',
        model: { adapter: 'knn' },
        data: { source: 'workspace-or-default' },
        controls: [],
        layout: { stage: ['decision-region'], side: [] },
        primitives: [{ id: 'decision-region', type: 'decision-region', props: { cells: '$model.decisionRegions.cells', resolution: 0 } }],
        steps: [{ id: 'w', wait: true, durationMs: 100 }],
      };
      assert.throws(() => validateScript(zeroResolution), (error) => error.code === 'SCRIPT_TOO_COMPLEX', 'non-positive decision resolution is rejected');
      const fractionalResolution = structuredClone(zeroResolution);
      fractionalResolution.primitives[0].props.resolution = 2.5;
      assert.throws(() => validateScript(fractionalResolution), (error) => error.code === 'SCRIPT_TOO_COMPLEX', 'fractional decision resolution is rejected');
    }

    // PR D.3: final runtime contract closure.
    {
      const resolutionScript = (value, extraSteps = []) => {
        let session = createPlaygroundSession(knnPlayground, { source: knnSource2, seed: 3, sessionId: 'prd3' });
        if (value !== undefined) session = { ...session, dataState: { ...session.dataState, resValue: value } };
        return {
          script: {
            version: 1,
            id: `res-${String(value)}`,
            model: { adapter: 'knn' },
            data: { source: 'workspace-or-default' },
            controls: [],
            layout: { stage: ['decision-region'], side: [] },
            primitives: [{
              id: 'decision-region',
              type: 'decision-region',
              when: '$controls.showDecisionRegions',
              props: {
                cells: '$model.decisionRegions.cells',
                ...(value !== undefined ? { resolution: '$data.resValue' } : {}),
              },
            }],
            steps: [
              { id: 'on', setControl: { showDecisionRegions: true }, durationMs: 100 },
              ...extraSteps,
            ],
          },
          session,
        };
      };

      // Resolved resolution 0/-1/2.5/above-max must fail, not fall back to 48.
      for (const value of [0, -1, 2.5, 1000]) {
        const fixture = resolutionScript(value);
        const result = dryRunScript(fixture);
        assert.equal(result.valid, false, `resolved resolution ${value} fails the dry run`);
        assert.equal(result.code, 'SCRIPT_TOO_COMPLEX', `resolved resolution ${value} has a stable code`);
      }

      // An unsafe intermediate step cannot be hidden by a later safe one:
      // cells.length is 2304 while regions are enabled, then disabled.
      const intermediate = resolutionScript(undefined, [
        { id: 'off', setControl: { showDecisionRegions: false }, durationMs: 100 },
      ]);
      intermediate.script.primitives[0].props.resolution = '$model.decisionRegions.cells.length';
      const intermediateResult = dryRunScript(intermediate);
      assert.equal(intermediateResult.valid, false, 'unsafe intermediate resolution fails the dry run');
      assert.equal(intermediateResult.code, 'SCRIPT_TOO_COMPLEX', 'intermediate resource failure has a stable code');

      // Resolution omitted -> renderer/runtime default 48.
      const omitted = resolutionScript(undefined);
      const omittedResult = dryRunScript(omitted);
      assert.equal(omittedResult.valid, true, 'omitted resolution passes');
      assert.equal(omittedResult.decisionGridCells, 48 * 48, 'omitted resolution uses the default grid size');

      // Initial control overrides must obey the Playground descriptor.
      const controlHost = createPlaygroundHost({ getDataset: () => null });
      const controlAgent = createPlaygroundAgentApi(controlHost);
      for (const [request, playgroundId] of [
        [{ playgroundId: 'linear-regression', controls: { learningRate: 6 } }, 'linear-regression'],
        [{ playgroundId: 'linear-regression', controls: { unknownControl: 1 } }, 'linear-regression'],
        [{ playgroundId: 'linear-regression', controls: { weight: -101 } }, 'linear-regression'],
        [{ playgroundId: 'linear-regression', controls: { weight: 101 } }, 'linear-regression'],
        [{ playgroundId: 'knn-classification', controls: { distanceMetric: 'manhattan' } }, 'knn-classification'],
      ]) {
        await assert.rejects(
          controlAgent.open(request),
          (error) => error.code === 'INVALID_PLAYGROUND_CONTROL',
          `${playgroundId} rejects out-of-contract initial control ${JSON.stringify(request.controls)}`,
        );
      }
      const validOpen = await controlAgent.open({ playgroundId: 'knn-classification', controls: { k: 7 } });
      assert.equal(validOpen.controls.k, 7, 'a valid override is applied');
      const controlContext = controlAgent.inspectContext();
      for (const schema of controlContext.controlSchemas) {
        assert.doesNotThrow(
          () => validateControlValue(schema, controlContext.controls[schema.key]),
          `every live control ${schema.key} conforms to its schema`,
        );
      }
      await controlAgent.close();

      // Adapter-produced defaults also conform to their descriptors.
      for (const [playground, source] of [[lrPlayground, lrSource], [knnPlayground, knnSource2]]) {
        const defaultSession = createPlaygroundSession(playground, { source, seed: 7, sessionId: 'prd3-defaults' });
        for (const control of getPlayground(playground.id).controls) {
          assert.doesNotThrow(
            () => validateControlValue(control, defaultSession.controls[control.key]),
            `${playground.id} default control ${control.key} conforms`,
          );
        }
      }
    }

    // PR E.1: TeachingPlan + deterministic composer.
    {
      // The planner consumes inspectContext(); the k control schema comes
      // from the Playground descriptor, never from hardcoded knowledge.
      const host = createPlaygroundHost({ getDataset: () => null });
      await host.open({ playgroundId: 'knn-classification' });
      const knnContext = host.inspectContext();
      const kSchema = knnContext.controlSchemas.find((schema) => schema.key === 'k');
      assert.ok(kSchema && kSchema.min === 1 && kSchema.max === 20, 'k control schema comes from the descriptor');

      // TeachingPlan v1: JSON-safe, deterministic, declarative.
      const plan = planTeachingGoal({ goal: 'k=1 和 k=15 的区别', context: knnContext });
      assert.equal(plan.version, 1, 'TeachingPlan schema version');
      assert.equal(plan.goal.type, 'compare-control', 'k comparison maps to compare-control');
      assert.deepEqual(plan.goal.values, [1, 15], 'comparison values are parsed from the goal');
      assert.doesNotThrow(() => structuredClone(plan), 'TeachingPlan is JSON-safe');
      assert.doesNotThrow(() => validateTeachingPlan(structuredClone(plan)), 'TeachingPlan round-trips through its validator');

      // Unsupported / invalid goals are rejected with stable errors.
      assert.throws(
        () => planTeachingGoal({ goal: '', context: knnContext }),
        (error) => error.code === 'TEACHING_GOAL_UNSUPPORTED',
        'empty goals are rejected',
      );
      assert.throws(
        () => planTeachingGoal({ goal: { type: 'generate-video' }, context: knnContext }),
        (error) => error.code === 'TEACHING_GOAL_UNSUPPORTED',
        'unsupported goal types are rejected',
      );
      assert.throws(
        () => planTeachingGoal({ goal: { type: 'compare-control', control: 'nonexistent', values: [1, 5] }, context: knnContext }),
        (error) => error.code === 'TEACHING_CONTROL_INVALID',
        'undeclared controls are rejected',
      );
      assert.throws(
        () => planTeachingGoal({ goal: 'k=25 和 k=30 的区别', context: knnContext }),
        (error) => error.code === 'TEACHING_VALUE_OUT_OF_RANGE',
        'comparison values above the schema max are rejected',
      );
      assert.throws(
        () => planTeachingGoal({ goal: 'k=0 和 k=5 的区别', context: knnContext }),
        (error) => error.code === 'TEACHING_VALUE_OUT_OF_RANGE',
        'comparison values below the schema min are rejected',
      );

      // Explicit unsupported requests fail instead of silently changing
      // intent: LR has no k control, so "k=1 和 k=15" is rejected rather
      // than being reinterpreted as a generic process explanation.
      await host.close();
      await host.open({ playgroundId: 'linear-regression' });
      const lrContext = host.inspectContext();
      assert.throws(
        () => planTeachingGoal({ goal: 'k=1 和 k=15 的区别', context: lrContext }),
        (error) => error.code === 'TEACHING_CONTROL_INVALID',
        'an explicit request for an unavailable control is rejected',
      );
      const lrSchema = lrContext.controlSchemas.find((schema) => schema.key === 'learningRate');
      const lrWhatIf = planTeachingGoal({ goal: '学习率太高会发生什么', context: lrContext });
      assert.equal(lrWhatIf.goal.type, 'what-if', 'learning-rate goal maps to what-if');
      assert.ok(
        lrWhatIf.goal.value >= lrSchema.min && lrWhatIf.goal.value <= lrSchema.max,
        'what-if value conforms to the control schema',
      );

      // Composer only emits declared primitives, canonical bindings and
      // declared operations (no model-specific renderer knowledge).
      const lrWhatIfScript = composeScriptFromPlan({ plan: lrWhatIf, context: lrContext });
      const declaredPrimitiveTypes = new Set(listPrimitiveSchemas().map((schema) => schema.type));
      const checkComposedScript = (script, context) => {
        for (const primitive of script.primitives) {
          assert.ok(declaredPrimitiveTypes.has(primitive.type), `composer only emits declared primitives (${primitive.type})`);
          const schema = getPrimitiveSchema(primitive.type);
          for (const [prop, binding] of Object.entries(primitive.props ?? {})) {
            assert.ok(schema.props[prop], `composer binds a declared prop ${primitive.type}.${prop}`);
            assert.ok(
              (schema.compatibleBindings[prop] ?? []).includes(binding),
              `${primitive.type}.${prop} uses a canonical compatible binding`,
            );
          }
        }
        for (const step of script.steps) {
          if (step.invoke) {
            assert.ok(context.model.operations[step.invoke.operation], `composer only invokes declared operations (${step.invoke.operation})`);
          }
        }
        assert.doesNotThrow(() => validateScript(script), 'composed script passes the validator');
      };
      checkComposedScript(lrWhatIfScript, lrContext);
      const lrDryRun = dryRunScript({
        script: lrWhatIfScript,
        session: createPlaygroundSession(lrPlayground, { source: lrSource, seed: 3, sessionId: 'e1-lr-whatif' }),
      });
      assert.equal(lrDryRun.valid, true, 'LR what-if script passes the strict dry run');
      assert.equal(lrDryRun.warnings.length, 0, 'LR what-if script resolves every binding without warnings');
      await host.close();

      // Capture semantics: deterministic replay, semantic captures and
      // baseline restoration without corrupting session/script baselines.
      await host.open({ playgroundId: 'knn-classification' });
      const knnCompareContext = host.inspectContext();
      const knnPlan = planTeachingGoal({
        goal: { type: 'compare-control', control: 'k', values: [1, 15] },
        context: knnCompareContext,
      });
      const knnScript = composeScriptFromPlan({ plan: knnPlan, context: knnCompareContext });
      checkComposedScript(knnScript, knnCompareContext);
      assert.ok(
        knnScript.steps.some((step) => step.capture?.id === 'baseline')
        && knnScript.steps.some((step) => step.restoreCapture?.id === 'baseline'),
        'comparison script captures and restores a baseline',
      );

      const replayComparison = (seed) => {
        let session = createPlaygroundSession(knnPlayground, { source: knnSource2, seed, sessionId: 'e1-replay' });
        session = dispatchPlaygroundAction(session, { type: 'SCRIPT_LOAD', script: structuredClone(knnScript) });
        const total = session.scriptState.totalSteps;
        const snapshots = [];
        for (let index = 0; index < total; index += 1) {
          session = dispatchPlaygroundAction(session, { type: 'SCRIPT_STEP' });
          snapshots.push(derivePlaygroundSnapshot(session));
        }
        return { session, snapshots };
      };
      const replayA = replayComparison(11);
      const replayB = replayComparison(11);
      assert.deepEqual(
        replayA.snapshots.map((snapshot) => snapshot.controls),
        replayB.snapshots.map((snapshot) => snapshot.controls),
        'capture replay is deterministic for the same seed',
      );
      assert.deepEqual(replayA.snapshots.at(-1).scene, replayB.snapshots.at(-1).scene, 'final scenes replay identically');
      const capturesA = replayA.session.captures;
      assert.equal(capturesA.baseline.controls.k, 5, 'baseline captures the pre-comparison k');
      assert.equal(capturesA.left.controls.k, 1, 'left capture stores k=1');
      assert.equal(capturesA.right.controls.k, 15, 'right capture stores k=15');
      assert.ok(capturesA.left.scene?.voting && capturesA.right.scene?.voting, 'captures store semantic scene data');
      assert.notDeepEqual(capturesA.left.scene, capturesA.right.scene, 'left and right captures differ semantically');
      // PR E.1.1: captures must be *completed* comparable states, not
      // revealed=0 shells. Each capture carries prediction/voting evidence
      // for the requested k, with the neighbor set sized by k.
      assert.ok(
        capturesA.left.semantic?.scene?.voting?.predictedLabel
        && Object.keys(capturesA.left.semantic.scene.voting.counts ?? {}).length > 0,
        'left capture has completed voting evidence',
      );
      assert.ok(
        capturesA.right.semantic?.scene?.voting?.predictedLabel
        && Object.keys(capturesA.right.semantic.scene.voting.counts ?? {}).length > 0,
        'right capture has completed voting evidence',
      );
      assert.equal(capturesA.left.scene.neighbors.length, 1, 'left capture represents the k=1 neighbor result');
      assert.equal(capturesA.right.scene.neighbors.length, 15, 'right capture represents the k=15 neighbor result');
      assert.ok(
        capturesA.left.timeline && Number.isInteger(capturesA.left.traceCount)
        && capturesA.left.semantic.metrics,
        'captures preserve timeline, trace checkpoint and semantic metrics',
      );
      assert.doesNotThrow(() => structuredClone(capturesA), 'captures are JSON-safe');
      assert.equal(replayA.session.scriptBaseline.controls.k, 5, 'scriptBaseline stays at SCRIPT_LOAD time');
      assert.equal(replayA.session.baseline.controls.k, 5, 'sessionBaseline stays at open time');

      // PR E.1.1 branch isolation: fresh baseline -> branch B must equal
      // branch A -> restore baseline -> branch B for semantically relevant
      // state (semantic snapshot, controls, timeline, model state).
      {
        const whatIfPlan = planTeachingGoal({ goal: { type: 'what-if', control: 'k', value: 15 }, context: knnCompareContext });
        const whatIfScript = composeScriptFromPlan({ plan: whatIfPlan, context: knnCompareContext });
        const whatIfReplay = (seed) => {
          let session = createPlaygroundSession(knnPlayground, { source: knnSource2, seed, sessionId: 'e11-branch' });
          session = dispatchPlaygroundAction(session, { type: 'SCRIPT_LOAD', script: structuredClone(whatIfScript) });
          const total = session.scriptState.totalSteps;
          for (let index = 0; index < total; index += 1) session = dispatchPlaygroundAction(session, { type: 'SCRIPT_STEP' });
          return session;
        };
        const freshBranchB = whatIfReplay(11).captures.result;
        assert.deepEqual(freshBranchB.semantic, capturesA.right.semantic, 'branch B semantic snapshot matches the fresh baseline run');
        assert.deepEqual(freshBranchB.controls, capturesA.right.controls, 'branch B controls match the fresh baseline run');
        assert.deepEqual(freshBranchB.timeline, capturesA.right.timeline, 'branch B timeline matches the fresh baseline run');
        assert.deepEqual(freshBranchB.modelState, capturesA.right.modelState, 'branch B model state matches the fresh baseline run');
      }

      // Strict dry run passes with zero unresolved optional bindings.
      const dryAgent = createPlaygroundAgentApi(host);
      const dryResult = dryAgent.dryRunScript(structuredClone(knnScript));
      assert.equal(dryResult.valid, true, 'composed comparison script passes the strict dry run');
      assert.equal(dryResult.warnings.length, 0, 'composed comparison script has no unresolved optional bindings');

      // Agent plan -> composeScript -> loadScript end-to-end, with stable
      // teaching error codes passing through the Agent normalization.
      const agentPlan = await dryAgent.plan('k=1 和 k=15 的区别');
      assert.equal(agentPlan.goal.type, 'compare-control', 'agent plan works');
      const agentComposed = await dryAgent.composeScript(agentPlan);
      assert.equal(agentComposed.dryRun.valid, true, 'agent composeScript dry-runs the composed script');
      await dryAgent.loadScript(agentComposed.script);
      const agentTotal = dryAgent.getState().scriptState.totalSteps;
      for (let index = 0; index < agentTotal; index += 1) await dryAgent.step();
      assert.equal(dryAgent.getState().scriptState.status, 'completed', 'agent replayed the composed script');
      await assert.rejects(
        dryAgent.plan({ type: 'compare-control', control: 'k', values: [25, 30] }),
        (error) => error.code === 'TEACHING_VALUE_OUT_OF_RANGE',
        'agent surfaces teaching errors with stable codes',
      );
      await host.close();

      // PR E.1.1: TeachingPlan phases drive composition; text parsing is
      // separate; explicit impossible requests fail; no model-shaped
      // templates remain in the Composer.
      {
        const e11Host = createPlaygroundHost({ getDataset: () => null });
        await e11Host.open({ playgroundId: 'knn-classification' });
        const e11KnnContext = e11Host.inspectContext();

        // Typed phase contract: every phase has a known kind, and the
        // compare plan carries the full semantic sequence (no goal.type
        // regeneration in the Composer).
        const e11Plan = planTeachingGoal({ goal: { type: 'compare-control', control: 'k', values: [1, 15] }, context: e11KnnContext });
        assert.ok(
          e11Plan.phases.length > 0 && e11Plan.phases.every((phase) => TEACHING_PHASE_KINDS.includes(phase.kind)),
          'TeachingPlan phases use the typed phase vocabulary',
        );
        const revealPhases = e11Plan.phases.filter((phase) => phase.kind === 'reveal');
        assert.deepEqual(
          revealPhases.map((phase) => phase.count),
          [1, 15],
          'reveal counts are resolved from the control values via operation playback metadata',
        );

        // Phase mutation changes the composed script; goal.type alone does not.
        const e11Script = composeScriptFromPlan({ plan: e11Plan, context: e11KnnContext });
        const noRevealPlan = { ...e11Plan, phases: e11Plan.phases.filter((phase) => phase.kind !== 'reveal') };
        const noRevealScript = composeScriptFromPlan({ plan: noRevealPlan, context: e11KnnContext });
        assert.notEqual(e11Script.steps.length, noRevealScript.steps.length, 'removing reveal phases changes the composed script');
        const reorderedPlan = { ...e11Plan, phases: [...e11Plan.phases.slice(1), e11Plan.phases[0]] };
        const reorderedScript = composeScriptFromPlan({ plan: reorderedPlan, context: e11KnnContext });
        assert.notDeepEqual(e11Script.steps, reorderedScript.steps, 'reordering phases changes the composed script');
        const twinPlan = { ...e11Plan, goal: { type: 'what-if', control: 'k', value: 1 } };
        const twinScript = composeScriptFromPlan({ plan: twinPlan, context: e11KnnContext });
        assert.deepEqual(e11Script.steps, twinScript.steps, 'the Composer is driven by phases, not by goal.type');

        // Text parsing is lexical and produces structured candidates only.
        assert.deepEqual(
          parseTeachingGoalText('k=1 和 k=15 的区别'),
          { type: 'compare-control', objective: 'compare', control: 'k', values: [1, 15] },
          'text parser produces a structured compare candidate',
        );
        assert.deepEqual(
          parseTeachingGoalText('k=15'),
          { type: 'what-if', objective: 'show_parameter_effect', control: 'k', value: 15 },
          'a single assignment is a what-if candidate',
        );
        assert.deepEqual(
          parseTeachingGoalText('学习率太高'),
          { type: 'what-if', objective: 'show_failure_case', control: 'learningRate', direction: 'increase' },
          'learning-rate aliases produce a semantic probe, not a numeric constant',
        );
        assert.equal(parseTeachingGoalText('解释这个模型如何工作'), null, 'generic text stays generic');
        assert.throws(() => parseTeachingGoalText(''), (error) => error.code === 'TEACHING_GOAL_UNSUPPORTED', 'empty text is rejected');

        // Explicit unsupported requests are rejected, not reinterpreted.
        await e11Host.close();
        await e11Host.open({ playgroundId: 'linear-regression' });
        const e11LrContext = e11Host.inspectContext();
        assert.throws(
          () => planTeachingGoal({ goal: 'k=1 和 k=15 的区别', context: e11LrContext }),
          (error) => error.code === 'TEACHING_CONTROL_INVALID',
          'LR + k comparison rejects instead of becoming explain-process',
        );
        await e11Host.close();
        await e11Host.open({ playgroundId: 'knn-classification' });
        const e11KnnContext2 = e11Host.inspectContext();
        assert.throws(
          () => planTeachingGoal({ goal: '学习率太高会发生什么', context: e11KnnContext2 }),
          (error) => error.code === 'TEACHING_GOAL_UNSUPPORTED' && error.details?.objective === 'show_failure_case',
          'KNN + learning-rate what-if rejects (failure-case objective unsupported in context)',
        );
        assert.throws(
          () => planTeachingGoal({ goal: { type: 'diagnose' }, context: e11KnnContext2 }),
          (error) => error.code === 'TEACHING_GOAL_UNSUPPORTED',
          'diagnose is not advertised: structured diagnose is rejected',
        );
        assert.throws(
          () => planTeachingGoal({ goal: '诊断一下这个模型', context: e11KnnContext2 }),
          (error) => error.code === 'TEACHING_GOAL_UNSUPPORTED',
          'diagnose is not advertised: diagnose text is rejected',
        );

        // Pairwise comparison cardinality is explicit.
        assert.throws(
          () => planTeachingGoal({ goal: { type: 'compare-control', control: 'k', values: [1, 5, 15] }, context: e11KnnContext2 }),
          (error) => error.code === 'TEACHING_PLAN_INVALID',
          'three-value comparisons are rejected (pairwise v1 contract)',
        );
        assert.throws(
          () => planTeachingGoal({ goal: '比较 k=1', context: e11KnnContext2 }),
          (error) => error.code === 'TEACHING_PLAN_INVALID',
          'single-value compare goals are rejected',
        );

        // Cross-playground and stale plans fail before composition.
        const e11CrossPlan = planTeachingGoal({ goal: { type: 'compare-control', control: 'k', values: [1, 15] }, context: e11KnnContext2 });
        assert.throws(
          () => composeScriptFromPlan({ plan: e11CrossPlan, context: e11LrContext }),
          (error) => error.code === 'TEACHING_PLAN_INVALID' && error.details?.reason === 'playground mismatch',
          'a KNN plan is rejected in an LR context before composition',
        );
        const staleContext = structuredClone(e11KnnContext2);
        staleContext.controlSchemas = staleContext.controlSchemas.filter((schema) => schema.key !== 'k');
        assert.throws(
          () => composeScriptFromPlan({ plan: e11CrossPlan, context: staleContext }),
          (error) => error.code === 'TEACHING_CONTROL_INVALID',
          'a plan referencing a removed control is rejected',
        );

        // Operation discovery is intent-based, never name-based.
        assert.equal(
          findOperationByIntent(e11KnnContext2, 'predict'),
          'tracePredict',
          'KNN predict intent resolves to the operation that prepares reveal playback',
        );
        assert.equal(
          findOperationByIntent(e11LrContext, 'fit'),
          'traceFit',
          'LR fit intent resolves to traceFit',
        );

        // Primitive placement is declarative and drives the layout.
        for (const schema of listPrimitiveSchemas()) {
          if (schema.placement) {
            assert.ok(['stage', 'side'].includes(schema.placement), `${schema.type} placement is stage or side`);
          }
        }
        assert.ok(
          e11Script.layout.stage.includes('scatter') && e11Script.layout.side.includes('annotation'),
          'composed layout comes from placement metadata',
        );
        assert.ok(
          e11Script.primitives.every((primitive) => (
            getPrimitiveSchema(primitive.type)?.placement === 'stage'
            || getPrimitiveSchema(primitive.type)?.placement === 'side'
          )),
          'every composed primitive has a placement',
        );

        // Cross-product: LR compare weight, LR compare learningRate, KNN
        // what-if k, explain-process on both models all compose + dry run.
        const lrWhatIfReplay = (() => {
          const plan = planTeachingGoal({ goal: { type: 'what-if', control: 'learningRate', value: 2 }, context: e11LrContext });
          const script = composeScriptFromPlan({ plan, context: e11LrContext });
          assert.doesNotThrow(() => validateScript(script), 'LR what-if script validates');
          const dry = dryRunScript({ script, session: createPlaygroundSession(lrPlayground, { source: lrSource, seed: 3, sessionId: 'e11-lr-whatif' }) });
          assert.equal(dry.valid && dry.warnings.length === 0, true, 'LR what-if script passes the strict dry run');
          return { plan, script };
        })();
        const lrWeightPlan = planTeachingGoal({ goal: { type: 'compare-control', control: 'weight', values: [1, 3] }, context: e11LrContext });
        assert.ok(lrWeightPlan.phases.every((phase) => phase.kind !== 'run'), 'LR weight comparison needs no run phase');
        const lrWeightScript = composeScriptFromPlan({ plan: lrWeightPlan, context: e11LrContext });
        const lrWeightDry = dryRunScript({ script: lrWeightScript, session: createPlaygroundSession(lrPlayground, { source: lrSource, seed: 3, sessionId: 'e11-lr-weight' }) });
        assert.equal(lrWeightDry.valid && lrWeightDry.warnings.length === 0, true, 'LR compare weight passes the strict dry run');
        const lrLrPlan = planTeachingGoal({ goal: { type: 'compare-control', control: 'learningRate', values: [0.05, 2] }, context: e11LrContext });
        const lrLrScript = composeScriptFromPlan({ plan: lrLrPlan, context: e11LrContext });
        const lrLrDry = dryRunScript({ script: lrLrScript, session: createPlaygroundSession(lrPlayground, { source: lrSource, seed: 3, sessionId: 'e11-lr-lr' }) });
        assert.equal(lrLrDry.valid && lrLrDry.warnings.length === 0, true, 'LR compare learningRate passes the strict dry run');
        const knnWhatIfPlan = planTeachingGoal({ goal: { type: 'what-if', control: 'k', value: 15 }, context: e11KnnContext2 });
        const knnWhatIfScript = composeScriptFromPlan({ plan: knnWhatIfPlan, context: e11KnnContext2 });
        const knnWhatIfDry = dryRunScript({ script: knnWhatIfScript, session: createPlaygroundSession(knnPlayground, { source: knnSource2, seed: 11, sessionId: 'e11-knn-whatif' }) });
        assert.equal(knnWhatIfDry.valid && knnWhatIfDry.warnings.length === 0, true, 'KNN what-if k passes the strict dry run');
        for (const [playground, source] of [[lrPlayground, lrSource], [knnPlayground, knnSource2]]) {
          const ctx = playground.id === 'linear-regression' ? e11LrContext : e11KnnContext2;
          const plan = planTeachingGoal({ goal: '解释这个模型如何工作', context: ctx });
          assert.equal(plan.goal.type, 'explain-process', `${playground.id} generic goal stays explain-process`);
          const script = composeScriptFromPlan({ plan, context: ctx });
          const dry = dryRunScript({ script, session: createPlaygroundSession(playground, { source, seed: 3, sessionId: `e11-explain-${playground.id}` }) });
          assert.equal(dry.valid && dry.warnings.length === 0, true, `${playground.id} explain-process passes the strict dry run`);
        }

        // Completed KNN comparison evidence at the Agent level too.
        const e11Agent = createPlaygroundAgentApi(e11Host);
        const e11AgentPlan = await e11Agent.plan('k=1 和 k=15 的区别');
        const e11AgentComposed = await e11Agent.composeScript(e11AgentPlan);
        assert.equal(e11AgentComposed.dryRun.valid, true, 'agent composed KNN comparison passes the dry run');
        await e11Agent.loadScript(e11AgentComposed.script);
        const e11AgentTotal = e11Agent.getState().scriptState.totalSteps;
        for (let index = 0; index < e11AgentTotal; index += 1) await e11Agent.step();
        assert.equal(e11Agent.getState().scriptState.status, 'completed', 'agent replayed the KNN comparison');
        await e11Host.close();

        // validatePlanAgainstContext is a first-class guard.
        assert.doesNotThrow(
          () => validatePlanAgainstContext(e11CrossPlan, e11KnnContext2),
          'a matching plan validates against its context',
        );
      }

      // PR E.1.2: final TeachingPlan contract closure.
      {
        const e12Host = createPlaygroundHost({ getDataset: () => null });
        await e12Host.open({ playgroundId: 'knn-classification' });
        const e12KnnContext = e12Host.inspectContext();
        const maxSteps = e12KnnContext.resourceLimits.maxSteps;
        assert.ok(Number.isInteger(maxSteps) && maxSteps > 0, 'inspectContext exposes the step resource budget');

        // 1. Pre-expansion resource guard: the compiled step cost is computed
        // without materializing steps, and over-budget plans are rejected
        // before compilePhases ever runs.
        const syntheticPlan = (phases) => ({
          version: 1,
          id: 'synthetic-e12',
          playgroundId: 'knn-classification',
          goal: { type: 'explain-process' },
          phases,
        });
        const revealPlan = (count) => syntheticPlan([
          { id: 'observe', kind: 'observe', evidence: ['metrics', 'observation'] },
          { id: 'reveal', kind: 'reveal', count },
        ]);
        assert.equal(
          estimateCompiledStepCost(revealPlan(1_000_000_000)),
          1_000_000_001,
          'estimateCompiledStepCost counts reveal phases without expanding them',
        );
        assert.equal(estimateCompiledStepCost(revealPlan(maxSteps)), maxSteps + 1, 'estimate reports the exact compiled cost');
        assert.doesNotThrow(
          () => validatePlanAgainstContext(revealPlan(maxSteps - 1), e12KnnContext),
          'a plan whose compiled cost fits the budget passes the resource guard',
        );
        assert.throws(
          () => validatePlanAgainstContext(revealPlan(maxSteps), e12KnnContext),
          (error) => error.code === 'TEACHING_PLAN_INVALID' && error.details?.reason === 'resource limit',
          'a plan whose compiled cost exceeds maxSteps is rejected before expansion',
        );
        assert.throws(
          () => composeScriptFromPlan({ plan: revealPlan(1_000_000_000), context: e12KnnContext }),
          (error) => error.code === 'TEACHING_PLAN_INVALID' && error.details?.reason === 'resource limit',
          'an over-budget reveal is rejected by composeScriptFromPlan without expansion',
        );
        const manySmallPhases = Array.from({ length: maxSteps + 1 }, (_, index) => ({
          id: `observe-${index}`,
          kind: 'observe',
          evidence: ['metrics', 'observation'],
        }));
        assert.throws(
          () => validatePlanAgainstContext(syntheticPlan(manySmallPhases), e12KnnContext),
          (error) => error.code === 'TEACHING_PLAN_INVALID' && error.details?.reason === 'resource limit',
          'many small phases exceeding maxSteps are rejected by the raw phase budget',
        );
        assert.doesNotThrow(
          () => composeScriptFromPlan({
            plan: planTeachingGoal({ goal: 'k=1 和 k=15 的区别', context: e12KnnContext }),
            context: e12KnnContext,
          }),
          'normal KNN comparison passes the resource guard',
        );

        // 2. Untrusted structured plans revalidate every set-control value
        // against the current controlSchemas (no silent coercion).
        const whatIfSynthetic = (control, value, playgroundId) => ({
          version: 1,
          id: 'synthetic-whatif',
          playgroundId,
          goal: { type: 'what-if', control, value },
          phases: [
            { id: 'set', kind: 'set-control', control, value },
            { id: 'capture', kind: 'capture', captureId: 'result', evidence: ['metrics', 'observation'] },
          ],
        });
        await e12Host.close();
        await e12Host.open({ playgroundId: 'linear-regression' });
        const e12LrContext = e12Host.inspectContext();
        await e12Host.close();
        await e12Host.open({ playgroundId: 'knn-classification' });
        const e12KnnContext2 = e12Host.inspectContext();
        assert.throws(
          () => composeScriptFromPlan({ plan: whatIfSynthetic('k', 999, 'knn-classification'), context: e12KnnContext2 }),
          (error) => error.code === 'TEACHING_VALUE_OUT_OF_RANGE',
          'k=999 fails TeachingPlan/context validation',
        );
        assert.throws(
          () => composeScriptFromPlan({ plan: whatIfSynthetic('learningRate', -1, 'linear-regression'), context: e12LrContext }),
          (error) => error.code === 'TEACHING_VALUE_OUT_OF_RANGE',
          'learningRate=-1 fails TeachingPlan/context validation',
        );
        assert.throws(
          () => composeScriptFromPlan({ plan: whatIfSynthetic('showNeighborOrder', 'yes', 'knn-classification'), context: e12KnnContext2 }),
          (error) => error.code === 'TEACHING_CONTROL_INVALID',
          'boolean controls require an actual boolean, not coercion',
        );
        assert.throws(
          () => composeScriptFromPlan({ plan: whatIfSynthetic('distanceMetric', 'manhattan', 'knn-classification'), context: e12KnnContext2 }),
          (error) => error.code === 'TEACHING_VALUE_OUT_OF_RANGE',
          'distanceMetric=manhattan fails against the declared options',
        );
        assert.throws(
          () => composeScriptFromPlan({ plan: whatIfSynthetic('xFeature', 'does-not-exist', 'knn-classification'), context: e12KnnContext2 }),
          (error) => error.code === 'TEACHING_CONTROL_INVALID',
          'select controls without declared options are not safely plannable',
        );
        assert.throws(
          () => validateTeachingControlValue({ key: 'k', type: 'number', min: 1, max: 20 }, '5'),
          (error) => error.code === 'TEACHING_VALUE_OUT_OF_RANGE',
          'numeric strings are not coerced by the shared validator',
        );
        assert.throws(
          () => validateTeachingControlValue({ key: 'flag', type: 'boolean' }, 1),
          (error) => error.code === 'TEACHING_CONTROL_INVALID',
          'numeric booleans are not coerced by the shared validator',
        );

        // 3. Primitive visibility semantics live in the schema and are honored
        // by the real Primitive Materializer for composed LR scripts.
        await e12Host.close();
        await e12Host.open({ playgroundId: 'linear-regression' });
        const e12LrContext2 = e12Host.inspectContext();
        const e12LrPlan = planTeachingGoal({ goal: { type: 'what-if', control: 'learningRate', value: 2 }, context: e12LrContext2 });
        const e12LrScript = composeScriptFromPlan({ plan: e12LrPlan, context: e12LrContext2 });
        assert.equal(
          e12LrScript.primitives.find((primitive) => primitive.type === 'reference-line')?.when,
          '$controls.showBestFit',
          'composed reference-line is gated by the schema whenControl',
        );
        assert.equal(
          e12LrScript.primitives.find((primitive) => primitive.type === 'residual-lines')?.when,
          '$controls.showResiduals',
          'composed residual-lines is gated by the schema whenControl',
        );
        const e12LrSession = createPlaygroundSession(lrPlayground, { source: lrSource, seed: 3, sessionId: 'e12-lr' });
        const lrAdapter = getModelAdapter('linear-regression');
        const e12LrDerived = lrAdapter.deriveScene(e12LrSession.modelState, { controls: e12LrSession.controls, source: e12LrSession.sourceData });
        const e12LrSemantic = {
          ...e12LrDerived.scene,
          metrics: e12LrDerived.metrics ?? {},
          formula: e12LrDerived.formula ?? null,
          observation: e12LrDerived.observation ?? null,
        };
        const materializeLr = (controls) => materializePrimitives({
          script: e12LrScript,
          semanticState: e12LrSemantic,
          traces: e12LrSession.traces,
          controls,
          metrics: e12LrSemantic.metrics,
          visualState: {},
          dataState: e12LrSession.dataState,
        }).map((primitive) => primitive.type);
        assert.ok(
          !materializeLr({ ...e12LrSession.controls, showResiduals: false, showBestFit: false })
            .some((type) => type === 'residual-lines' || type === 'reference-line'),
          'LR residual/reference primitives are hidden when their controls are false',
        );
        const withResiduals = materializeLr({ ...e12LrSession.controls, showResiduals: true, showBestFit: false });
        assert.ok(withResiduals.includes('residual-lines'), 'residual-lines materializes when showResiduals is true');
        assert.ok(!withResiduals.includes('reference-line'), 'reference-line stays hidden when showBestFit is false');
        const withBestFit = materializeLr({ ...e12LrSession.controls, showResiduals: false, showBestFit: true });
        assert.ok(withBestFit.includes('reference-line'), 'reference-line materializes when showBestFit is true');
        assert.ok(!withBestFit.includes('residual-lines'), 'residual-lines stays hidden when showResiduals is false');
        for (const [presetId, expected] of [
          ['linear-regression.intuition', [['reference-line', 'showBestFit'], ['residual-lines', 'showResiduals']]],
          ['knn.intro', [['decision-region', 'showDecisionRegions']]],
        ]) {
          const preset = getPreset(presetId);
          for (const [type, control] of expected) {
            const declaration = preset.primitives.find((primitive) => primitive.type === type);
            assert.equal(declaration.when, `$controls.${control}`, `${presetId} ${type} conditional matches the schema`);
            assert.equal(getPrimitiveSchema(type).whenControl, control, `${type} schema declares whenControl ${control}`);
          }
        }

        // 4. The Planner is genuinely inspectContext-only.
        const plannerSource = readFileSync(new URL('../src/core/playground/agent/teachingPlanner.js', import.meta.url), 'utf-8');
        assert.ok(
          !plannerSource.includes("visualization/schemas.js"),
          'the Planner does not import the internal primitive registry',
        );
        await e12Host.close();
        await e12Host.open({ playgroundId: 'knn-classification' });
        const clonedContext = structuredClone(e12Host.inspectContext());
        const clonedPlan = planTeachingGoal({ goal: 'k=1 和 k=15 的区别', context: clonedContext });
        assert.equal(clonedPlan.goal.type, 'compare-control', 'planning works from a serialized inspectContext');
        assert.doesNotThrow(
          () => validateScript(composeScriptFromPlan({ plan: clonedPlan, context: clonedContext })),
          'composition works from a serialized inspectContext',
        );

        // 5. Comparison capture IDs are internal (baseline/left/right) and can
        // never collide with user/control values.
        const collisionContext = structuredClone(e12KnnContext);
        collisionContext.controlSchemas = [
          ...collisionContext.controlSchemas.filter((schema) => schema.key !== 'k'),
          { key: 'mode', type: 'select', options: ['baseline', 'left', 'right', 'other'] },
        ];
        collisionContext.controls = { ...collisionContext.controls, mode: 'other' };
        const collisionPlan = planTeachingGoal({
          goal: { type: 'compare-control', control: 'mode', values: ['baseline', 'left'] },
          context: collisionContext,
        });
        assert.deepEqual(
          collisionPlan.phases.filter((phase) => phase.kind === 'capture').map((phase) => phase.captureId),
          ['baseline', 'left', 'right'],
          'comparison capture IDs are internal baseline/left/right',
        );
        assert.deepEqual(collisionPlan.goal.values, ['baseline', 'left'], 'compared values stay in plan.goal.values');
        const collisionScript = composeScriptFromPlan({ plan: collisionPlan, context: collisionContext });
        assert.deepEqual(
          collisionScript.steps.filter((step) => step.capture).map((step) => step.capture.id),
          ['baseline', 'left', 'right'],
          'composed capture step ids cannot collide with user values',
        );

        // 6. A declared runObjective is a real contract: the operation must
        // resolve, otherwise the plan fails instead of being weakened.
        const staleOpContext = structuredClone(e12KnnContext);
        for (const [operationName, operation] of Object.entries(staleOpContext.model.operations)) {
          if (operation.intent === 'predict') delete staleOpContext.model.operations[operationName];
        }
        assert.throws(
          () => planTeachingGoal({ goal: { type: 'compare-control', control: 'k', values: [1, 15] }, context: staleOpContext }),
          (error) => error.code === 'TEACHING_PLAN_INVALID' && error.details?.reason === 'unresolvable run objective',
          'a control declaring runObjective requires a matching operation in the context',
        );

        // 7. plan() runs the same context/resource validation before returning.
        const bigKContext = structuredClone(e12KnnContext);
        bigKContext.controlSchemas = bigKContext.controlSchemas.map((schema) => (
          schema.key === 'k' ? { ...schema, max: 1000 } : schema
        ));
        assert.throws(
          () => planTeachingGoal({ goal: { type: 'compare-control', control: 'k', values: [1, 500] }, context: bigKContext }),
          (error) => error.code === 'TEACHING_PLAN_INVALID' && error.details?.reason === 'resource limit',
          'plan() rejects a comparison whose valid values would expand beyond maxSteps',
        );
        await e12Host.close();
      }

      // PR E.2: goal taxonomy + goal fidelity.
      {
        // 1. Bounded taxonomy exposed through inspectContext, with a
        // capability-grounded supported set (no model-id maps).
        const e2Host = createPlaygroundHost({ getDataset: () => null });
        await e2Host.open({ playgroundId: 'knn-classification' });
        const e2KnnContext = e2Host.inspectContext();
        assert.deepEqual(e2KnnContext.teaching.objectives, TEACHING_OBJECTIVES, 'inspectContext exposes the full objective taxonomy');
        assert.deepEqual(
          e2KnnContext.teaching.supportedObjectives,
          ['introduce', 'compare', 'show_parameter_effect', 'explain_prediction'],
          'KNN supported objectives are derived from predict intent + evidence',
        );
        assert.deepEqual(
          getSupportedTeachingObjectives(e2KnnContext),
          e2KnnContext.teaching.supportedObjectives,
          'getSupportedTeachingObjectives matches inspectContext',
        );
        await e2Host.close();
        await e2Host.open({ playgroundId: 'linear-regression' });
        const e2LrContext = e2Host.inspectContext();
        assert.deepEqual(
          e2LrContext.teaching.supportedObjectives,
          ['introduce', 'compare', 'show_parameter_effect', 'show_training', 'show_failure_case'],
          'LR supported objectives are derived from fit intent + training evidence',
        );
        assert.ok(
          !e2KnnContext.teaching.supportedObjectives.includes('show_failure_case')
          && !e2LrContext.teaching.supportedObjectives.includes('explain_prediction'),
          'unsupported objectives stay out of the supported set',
        );

        // 2. Normalized semantic objectives ride alongside E.1 goal families.
        const e2ComparePlan = planTeachingGoal({ goal: 'k=1 和 k=15 的区别', context: e2KnnContext });
        assert.equal(e2ComparePlan.goal.type, 'compare-control', 'compare-control goal family is preserved');
        assert.equal(e2ComparePlan.goal.objective, 'compare', 'compare-control normalizes to the compare objective');
        const e2KnnExplain = planTeachingGoal({ goal: '解释这个模型如何工作', context: e2KnnContext });
        assert.equal(e2KnnExplain.goal.objective, 'explain_prediction', 'KNN explain-process normalizes to explain_prediction');
        const e2LrExplain = planTeachingGoal({ goal: '解释这个模型如何工作', context: e2LrContext });
        assert.equal(e2LrExplain.goal.objective, 'show_training', 'LR explain-process normalizes to show_training');
        const e2WhatIf = planTeachingGoal({ goal: { type: 'what-if', control: 'k', value: 15 }, context: e2KnnContext });
        assert.equal(e2WhatIf.goal.objective, 'show_parameter_effect', 'what-if normalizes to show_parameter_effect');
        const e2Failure = planTeachingGoal({ goal: '学习率太高会发生什么', context: e2LrContext });
        assert.equal(e2Failure.goal.objective, 'show_failure_case', 'learning-rate-too-high normalizes to show_failure_case');
        const e2Intro = planTeachingGoal({ goal: '介绍一下这个模型', context: e2KnnContext });
        assert.equal(e2Intro.goal.objective, 'introduce', 'introduce hints normalize to the introduce objective');

        // 3. Unsupported objectives reject explicitly (never silently
        // reinterpreted as explain-process).
        assert.throws(
          () => planTeachingGoal({ goal: { type: 'what-if', objective: 'show_generalization', control: 'k', value: 5 }, context: e2KnnContext }),
          (error) => error.code === 'TEACHING_GOAL_UNSUPPORTED',
          'show_generalization is rejected',
        );
        assert.throws(
          () => planTeachingGoal({ goal: { type: 'what-if', objective: 'show_feature_effect', control: 'k', value: 5 }, context: e2KnnContext }),
          (error) => error.code === 'TEACHING_GOAL_UNSUPPORTED',
          'show_feature_effect is rejected',
        );
        assert.throws(
          () => planTeachingGoal({ goal: { type: 'explain-process', objective: 'explain_prediction' }, context: e2LrContext }),
          (error) => error.code === 'TEACHING_GOAL_UNSUPPORTED',
          'explain_prediction on LR is rejected (no predict operation)',
        );
        assert.throws(
          () => planTeachingGoal({ goal: 'Explain this KNN prediction', context: e2LrContext }),
          (error) => error.code === 'TEACHING_GOAL_UNSUPPORTED',
          'explain-prediction text on LR is rejected',
        );
        assert.throws(
          () => planTeachingGoal({ goal: { type: 'what-if', objective: 'show_failure_case', control: 'k', value: 15 }, context: e2KnnContext }),
          (error) => error.code === 'TEACHING_GOAL_UNSUPPORTED',
          'show_failure_case on KNN is rejected (no fit/training evidence)',
        );

        // 4. Acceptance case 1: compare k=1 vs k=15 - positive and mutation
        // negatives. The fidelity contract proves the full experiment.
        await e2Host.close();
        await e2Host.open({ playgroundId: 'knn-classification' });
        const e2Agent = createPlaygroundAgentApi(e2Host);
        const e2CompareAgentPlan = await e2Agent.plan('Compare k=1 and k=15');
        const e2CompareComposed = await e2Agent.composeScript(e2CompareAgentPlan);
        assert.equal(e2CompareComposed.mode, 'composed', 'composeScript marks the real Composer path');
        assert.equal(e2CompareComposed.fidelity.valid, true, 'compare fidelity passes');
        assert.equal(e2CompareComposed.dryRun.valid, true, 'compare dry run passes');
        const e2CompareChecks = new Set(e2CompareComposed.fidelity.checks.map((check) => check.requirement));
        for (const required of [
          'control:k=1',
          'control:k=15',
          'operation:predict>=2',
          'reveals>=2',
          'capture:left',
          'capture:right',
          'trace:prediction.emitted',
        ]) {
          assert.ok(e2CompareChecks.has(required), `compare fidelity proves ${required}`);
        }
        assert.ok(
          e2CompareComposed.fidelity.checks.some((check) => (
            check.requirement.startsWith('runtimeEvidence:left:metrics.predictedLabel') && check.satisfied
          )),
          'left capture holds completed prediction evidence',
        );
        assert.ok(
          e2CompareComposed.fidelity.checks.some((check) => (
            check.requirement.startsWith('runtimeEvidence:right:metrics.predictedLabel') && check.satisfied
          )),
          'right capture holds completed prediction evidence',
        );
        const e2CompareBase = composeScriptFromPlan({ plan: e2CompareAgentPlan, context: e2KnnContext });
        const mutateSteps = (mutator) => {
          const mutated = structuredClone(e2CompareBase);
          mutated.steps = mutator(mutated.steps);
          return mutated;
        };
        const e2MutatedFixtures = [
          {
            name: 'missing k=15 assignment',
            script: mutateSteps((steps) => steps.filter((step) => !(step.setControl && step.setControl.k === 15))),
            missing: 'control:k=15',
          },
          {
            name: 'missing second predict run',
            script: mutateSteps((steps) => {
              const invokes = steps.filter((step) => step.invoke);
              const removeId = invokes[1]?.id;
              return steps.filter((step) => step.id !== removeId);
            }),
            missing: 'operation:predict>=2',
          },
          {
            name: 'missing second reveal',
            script: mutateSteps((steps) => steps.filter((step) => !(step.reveal && step.id.startsWith('reveal-right')))),
            missing: 'reveals>=2',
          },
          {
            name: 'missing right capture',
            script: mutateSteps((steps) => steps.filter((step) => !(step.capture && step.capture.id === 'right'))),
            missing: 'capture:right',
          },
          {
            name: 'missing evidence primitive',
            script: (() => {
              const mutated = structuredClone(e2CompareBase);
              mutated.primitives = mutated.primitives.filter((primitive) => primitive.type !== 'vote-bars');
              mutated.layout.stage = mutated.layout.stage.filter((id) => id !== 'vote-bars');
              return mutated;
            })(),
            missing: 'visual:voting',
          },
        ];
        for (const fixture of e2MutatedFixtures) {
          assert.doesNotThrow(() => validateScript(fixture.script), `${fixture.name} stays structurally valid`);
          const report = evaluateGoalFidelity({ plan: e2CompareAgentPlan, script: fixture.script, context: e2KnnContext });
          assert.equal(report.valid, false, `${fixture.name} fails goal fidelity`);
          assert.ok(report.missing.includes(fixture.missing), `${fixture.name} reports the missing requirement`);
        }

        // 5. Acceptance case 2: learning rate too high. The planner derives a
        // legal value above the baseline; a residuals-only script fails.
        const e2LrAgentHost = createPlaygroundHost({ getDataset: () => null });
        const e2LrAgent = createPlaygroundAgentApi(e2LrAgentHost);
        await e2LrAgentHost.open({ playgroundId: 'linear-regression' });
        const e2LrPlan = await e2LrAgent.plan('Show what happens when learning rate is too high');
        assert.equal(e2LrPlan.goal.objective, 'show_failure_case', 'learning-rate-too-high normalizes to show_failure_case');
        const e2LrBaseline = e2LrAgentHost.inspectContext().controls.learningRate;
        const e2LrSchema = e2LrAgentHost.inspectContext().controlSchemas.find((schema) => schema.key === 'learningRate');
        assert.ok(
          e2LrPlan.goal.value > e2LrBaseline && e2LrPlan.goal.value >= e2LrSchema.min && e2LrPlan.goal.value <= e2LrSchema.max,
          'the derived learning rate is above the baseline and inside controlSchemas',
        );
        const e2LrComposed = await e2LrAgent.composeScript(e2LrPlan);
        assert.equal(e2LrComposed.fidelity.valid, true, 'learning-rate-too-high fidelity passes');
        const e2LrChecks = new Set(e2LrComposed.fidelity.checks.map((check) => check.requirement));
        for (const required of ['operation:fit>=1', 'reveals>=1', 'capture:result', 'trace:loss.measured']) {
          assert.ok(e2LrChecks.has(required), `learning-rate fidelity proves ${required}`);
        }
        assert.ok(
          e2LrComposed.fidelity.checks.some((check) => check.requirement.startsWith('runtimeEvidence:result:training.parameterHistory') && check.satisfied),
          'parameter movement is verified from training history evidence',
        );
        const e2LrContext2 = e2LrAgentHost.inspectContext();
        const e2WeakScript = {
          version: 1,
          id: 'weak-lr',
          model: { adapter: 'linear-regression' },
          data: { source: 'workspace-or-default' },
          controls: [],
          layout: { stage: ['scatter'], side: [] },
          primitives: [{ id: 'scatter', type: 'scatter', props: { points: '$model.scatterPoints', axes: '$model.axes' } }],
          steps: [{ id: 'w', wait: true, durationMs: 100 }],
        };
        assert.doesNotThrow(() => validateScript(e2WeakScript), 'residuals-only script stays structurally valid');
        const e2WeakReport = evaluateGoalFidelity({ plan: e2LrPlan, script: e2WeakScript, context: e2LrContext2 });
        assert.equal(e2WeakReport.valid, false, 'a script that only shows residuals fails the learning-rate goal');
        const e2DerivedValuePlan = planTeachingGoal({
          goal: { type: 'what-if', objective: 'show_failure_case', control: 'learningRate' },
          context: e2LrContext2,
        });
        assert.ok(
          e2DerivedValuePlan.goal.value > e2LrBaseline && e2DerivedValuePlan.goal.value <= e2LrSchema.max,
          'a structured failure goal without a value derives one inside the schema',
        );
        await e2LrAgentHost.close();

        // 6. Acceptance case 3: explain KNN prediction. The generic evaluator
        // must contain no model-id switch.
        const e2ExplainPlan = await e2Agent.plan('Explain this KNN prediction');
        assert.equal(e2ExplainPlan.goal.objective, 'explain_prediction', 'explain-prediction text normalizes');
        const e2ExplainComposed = await e2Agent.composeScript(e2ExplainPlan);
        assert.equal(e2ExplainComposed.fidelity.valid, true, 'explain KNN prediction fidelity passes');
        assert.ok(
          e2ExplainComposed.fidelity.checks.some((check) => check.requirement === 'trace:prediction.emitted' && check.satisfied),
          'explain fidelity proves a prediction was emitted',
        );
        const e2FidelitySource = readFileSync(new URL('../src/core/playground/agent/teachingFidelity.js', import.meta.url), 'utf-8');
        assert.ok(
          !e2FidelitySource.includes("playgroundId === 'knn-classification'") && !e2FidelitySource.includes('knn-classification'),
          'the generic fidelity evaluator contains no model-id switch',
        );
        const e2TaxonomySource = readFileSync(new URL('../src/core/playground/agent/teachingTaxonomy.js', import.meta.url), 'utf-8');
        assert.ok(
          !e2TaxonomySource.includes('knn-classification') && !e2TaxonomySource.includes('linear-regression'),
          'the taxonomy support rules contain no model objective maps',
        );

        // 7. composeScript() rejects fidelity failures with the stable code
        // instead of returning a technically valid script.
        const e2Mismatched = { ...e2WhatIf, goal: { ...e2WhatIf.goal, objective: 'compare' } };
        await assert.rejects(
          e2Agent.composeScript(e2Mismatched),
          (error) => error.code === 'TEACHING_GOAL_FIDELITY_FAILED',
          'a plan whose script cannot satisfy its objective is rejected',
        );
        await e2Host.close();
      }

      // PR E.2.1: outcome-truthful fidelity.
      {
        const e21Host = createPlaygroundHost({ getDataset: () => null });
        await e21Host.open({ playgroundId: 'linear-regression' });
        const e21LrContext = e21Host.inspectContext();
        await e21Host.close();
        await e21Host.open({ playgroundId: 'knn-classification' });
        const e21KnnContext = e21Host.inspectContext();

        // 1. show_failure_case must prove an actual failure outcome. The
        // declared capability carries a training.completed stoppedReason
        // predicate; a completed run without one fails fidelity.
        const e21FailurePlan = planTeachingGoal({ goal: '学习率太高会发生什么', context: e21LrContext });
        assert.equal(e21FailurePlan.goal.objective, 'show_failure_case');
        const e21FailureScript = composeScriptFromPlan({ plan: e21FailurePlan, context: e21LrContext });
        const e21LrSession = createPlaygroundSession(lrPlayground, { source: lrSource, seed: 3, sessionId: 'e21-lr' });
        const e21Execution = replayScriptForFidelity({ script: e21FailureScript, session: e21LrSession });
        const e21Fidelity = evaluateGoalFidelity({ plan: e21FailurePlan, script: e21FailureScript, context: e21LrContext, execution: e21Execution });
        assert.equal(e21Fidelity.valid, true, 'the real failure run passes fidelity');
        const predicateRequirement = 'trace:training.completed{"stoppedReason":["learning-rate-too-high"]}';
        assert.ok(
          e21Fidelity.checks.some((check) => check.requirement === predicateRequirement && check.satisfied),
          'fidelity proves the stoppedReason predicate',
        );
        // Mutation: same plan/script, but the runtime reports ordinary
        // successful completion (training happened, failure did not).
        const successExecution = {
          captures: {
            result: {
              semantic: {
                scene: { training: { lossHistory: [1, 2], parameterHistory: [{ weight: 1, bias: 1 }] } },
                metrics: { mse: 1 },
                observation: { titleKey: 'x', bodyKey: 'y', params: {} },
                formula: null,
              },
            },
          },
          traces: [
            { type: 'loss.measured', payload: { step: 1, loss: 1 } },
            { type: 'gradient.computed', payload: { step: 1, magnitude: 1 } },
            { type: 'training.completed', payload: { steps: 20, requestedSteps: 20 } },
          ],
          finalSnapshot: null,
        };
        const successReport = evaluateGoalFidelity({
          plan: e21FailurePlan,
          script: e21FailureScript,
          context: e21LrContext,
          execution: successExecution,
        });
        assert.equal(successReport.valid, false, 'ordinary successful training fails the failure-case goal');
        assert.ok(
          successReport.missing.includes(predicateRequirement),
          'the missing stoppedReason predicate is reported',
        );
        // The early non-finite `diverged` stop reason is valid runtime
        // behavior but is intentionally not a supported pedagogical outcome
        // of show_failure_case: it emits no loss.measured/gradient.computed,
        // so the declared inspectable failure contract cannot be satisfied.
        const divergedExecution = {
          captures: {
            result: {
              semantic: {
                scene: { training: { lossHistory: [], parameterHistory: [] } },
                metrics: { mse: null },
                observation: { titleKey: 'x', bodyKey: 'y', params: {} },
                formula: null,
              },
            },
          },
          traces: [
            { type: 'training.completed', payload: { steps: 0, requestedSteps: 20, stoppedReason: 'diverged' } },
          ],
          finalSnapshot: null,
        };
        const divergedReport = evaluateGoalFidelity({
          plan: e21FailurePlan,
          script: e21FailureScript,
          context: e21LrContext,
          execution: divergedExecution,
        });
        assert.equal(divergedReport.valid, false, 'the diverged stop reason fails show_failure_case fidelity');
        assert.ok(
          divergedReport.missing.includes(predicateRequirement),
          'diverged does not satisfy the learning-rate-too-high predicate',
        );
        assert.ok(
          divergedReport.missing.some((item) => item === 'trace:loss.measured' || item === 'trace:gradient.computed'),
          'diverged lacks the inspectable loss/gradient evidence',
        );

        // 2. The text parser emits a semantic probe, never a numeric
        // constant; the Planner derives the probe from current state + schema.
        const e21Parsed = parseTeachingGoalText('学习率太高');
        assert.equal(e21Parsed.value, undefined, 'the parser emits no numeric value');
        assert.equal(e21Parsed.direction, 'increase', 'the parser emits a directional probe');
        const e21LrSchema = e21LrContext.controlSchemas.find((schema) => schema.key === 'learningRate');
        const withBaseline = (baseline) => {
          const context = structuredClone(e21LrContext);
          context.controls = { ...context.controls, learningRate: baseline };
          return context;
        };
        const derivedPlans = [0.05, 1.5, 3].map((baseline) => ({
          baseline,
          plan: planTeachingGoal({ goal: { type: 'what-if', objective: 'show_failure_case', control: 'learningRate' }, context: withBaseline(baseline) }),
        }));
        for (const { baseline, plan } of derivedPlans) {
          assert.ok(
            plan.goal.value > baseline && plan.goal.value <= e21LrSchema.max,
            `baseline ${baseline} derives a higher legal probe (${plan.goal.value})`,
          );
        }
        assert.notEqual(derivedPlans[0].plan.goal.value, derivedPlans[1].plan.goal.value, 'the same goal derives different values under different states');
        assert.throws(
          () => planTeachingGoal({ goal: { type: 'what-if', objective: 'show_failure_case', control: 'learningRate' }, context: withBaseline(5) }),
          (error) => error.code === 'TEACHING_PLAN_INVALID',
          'baseline at schema max rejects (no higher legal probe)',
        );
        assert.throws(
          () => planTeachingGoal({ goal: { type: 'what-if', objective: 'show_failure_case', control: 'learningRate', direction: 'decrease' }, context: e21LrContext }),
          (error) => error.code === 'TEACHING_PLAN_INVALID',
          'unsupported probe directions are rejected',
        );

        // 3. Evidence classes are explicit and non-conflated. visualEvidence
        // checks concrete primitive.props bindings.
        const e21ShowTrainingPlan = planTeachingGoal({ goal: '解释这个模型如何工作', context: e21LrContext });
        assert.equal(e21ShowTrainingPlan.goal.objective, 'show_training');
        const e21ShowTrainingScript = composeScriptFromPlan({ plan: e21ShowTrainingPlan, context: e21LrContext });
        const e21VisualMutation = structuredClone(e21ShowTrainingScript);
        e21VisualMutation.primitives = e21VisualMutation.primitives.map((primitive) => (
          (primitive.type === 'regression-line' || primitive.type === 'reference-line')
            ? { ...primitive, props: { ...primitive.props, line: '$model.bestFitLine' } }
            : primitive
        ));
        assert.doesNotThrow(() => validateScript(e21VisualMutation), 'the visual-binding mutation stays structurally valid');
        const e21VisualReport = evaluateGoalFidelity({ plan: e21ShowTrainingPlan, script: e21VisualMutation, context: e21LrContext });
        assert.equal(e21VisualReport.valid, false, 'changing a binding away from the required path fails visual fidelity');
        assert.ok(e21VisualReport.missing.includes('visual:line'), 'visual:line is reported as missing');

        // Runtime-only evidence is not tied to a visualization primitive.
        const e21ExplainPlan = planTeachingGoal({ goal: 'Explain this KNN prediction', context: e21KnnContext });
        const e21ExplainScript = composeScriptFromPlan({ plan: e21ExplainPlan, context: e21KnnContext });
        const e21NoMetricCard = structuredClone(e21ExplainScript);
        e21NoMetricCard.primitives = e21NoMetricCard.primitives.filter((primitive) => primitive.type !== 'metric-card');
        e21NoMetricCard.layout.side = e21NoMetricCard.layout.side.filter((id) => id !== 'metric-card');
        assert.doesNotThrow(() => validateScript(e21NoMetricCard), 'removing metric-card stays structurally valid');
        const e21KnnSession = createPlaygroundSession(knnPlayground, { source: knnSource2, seed: 11, sessionId: 'e21-knn' });
        const e21NoMetricReport = evaluateGoalFidelity({
          plan: e21ExplainPlan,
          script: e21NoMetricCard,
          context: e21KnnContext,
          execution: replayScriptForFidelity({ script: e21ExplainScript, session: e21KnnSession }),
        });
        assert.equal(e21NoMetricReport.valid, true, 'removing a non-visual primitive does not fail runtime-only evidence');
        // But if the same field were declared visualEvidence, the Script would
        // fail - proving the classes are not conflated.
        const e21VisualDeclaredContext = structuredClone(e21KnnContext);
        e21VisualDeclaredContext.teachingCapabilities.explain_prediction.visualEvidence = ['metrics.predictedLabel'];
        const e21VisualDeclaredReport = evaluateGoalFidelity({
          plan: e21ExplainPlan,
          script: e21NoMetricCard,
          context: e21VisualDeclaredContext,
          execution: replayScriptForFidelity({ script: e21ExplainScript, session: e21KnnSession }),
        });
        assert.equal(e21VisualDeclaredReport.valid, false, 'a declared visual field must actually be bound');
        assert.ok(e21VisualDeclaredReport.missing.includes('visual:metrics.predictedLabel'), 'visual:metrics.predictedLabel is reported');
        // Removing loss-curve fails visual:training.lossHistory while the
        // runtime parameter-movement evidence still passes.
        const e21NoLossCurve = structuredClone(e21ShowTrainingScript);
        e21NoLossCurve.primitives = e21NoLossCurve.primitives.filter((primitive) => primitive.type !== 'loss-curve');
        e21NoLossCurve.layout.stage = e21NoLossCurve.layout.stage.filter((id) => id !== 'loss-curve');
        const e21NoLossReport = evaluateGoalFidelity({
          plan: e21ShowTrainingPlan,
          script: e21NoLossCurve,
          context: e21LrContext,
          execution: replayScriptForFidelity({ script: e21ShowTrainingScript, session: e21LrSession }),
        });
        assert.ok(e21NoLossReport.missing.includes('visual:training.lossHistory'), 'loss-curve removal fails visual evidence');
        assert.ok(
          !e21NoLossReport.missing.some((item) => item.startsWith('runtimeEvidence:final:training.parameterHistory')),
          'runtime parameter-movement evidence survives loss-curve removal',
        );

        // 4. Capability declarations are the source of support truth.
        assert.ok(
          e21KnnContext.teaching.capabilities.explain_prediction
          && e21LrContext.teaching.capabilities.show_failure_case?.traceEvidence.some((entry) => (
            entry && entry.trace === 'training.completed' && entry.where?.stoppedReason
          )),
          'adapters declare teaching capabilities including the failure signal',
        );
        const e21NoCapLr = structuredClone(e21LrContext);
        e21NoCapLr.teachingCapabilities = {};
        assert.ok(
          !getSupportedTeachingObjectives(e21NoCapLr).includes('show_failure_case')
          && !getSupportedTeachingObjectives(e21NoCapLr).includes('show_training'),
          'fit + training fields alone do not imply show_failure_case/show_training',
        );
        const e21NoCapKnn = structuredClone(e21KnnContext);
        e21NoCapKnn.teachingCapabilities = {};
        assert.ok(
          !getSupportedTeachingObjectives(e21NoCapKnn).includes('explain_prediction'),
          'predict intent alone does not imply explainable predictions',
        );
        const e21TaxonomySource = readFileSync(new URL('../src/core/playground/agent/teachingTaxonomy.js', import.meta.url), 'utf-8');
        assert.ok(
          !e21TaxonomySource.includes('neighbors') && !e21TaxonomySource.includes('voting'),
          'the taxonomy does not hardcode KNN field names',
        );
        await e21Host.close();
      }

      // LR and KNN existing presets remain unchanged.
      assert.doesNotThrow(() => validateScript(getPreset('knn.intro')), 'knn.intro still validates');
      assert.doesNotThrow(() => validateScript(getPreset('linear-regression.intuition')), 'LR intuition preset still validates');
    }
  }
}

// Every bundled teaching example must load, run when marked runnable, and export when marked exportable.
{
  const examplesUrl = new URL('../examples/', import.meta.url);
  const exampleFiles = readdirSync(examplesUrl).filter((name) => name.endsWith('.volkml.json')).sort();
  assert.equal(exampleFiles.length, exampleMetadata.length, 'every metadata entry has a generated file and vice versa');
  for (const meta of exampleMetadata) {
    const project = validateProjectForWorkspace(JSON.parse(readFileSync(new URL(meta.file, examplesUrl), 'utf-8')));
    const { nodes, edges } = project.graph;
    if (meta.datasetId) {
      assert.ok(teachingDatasetById(meta.datasetId), `${meta.id} references an existing teaching dataset`);
    }
    if (meta.exportable) {
      assertPythonSyntax(compilePipelineToPyTorch(nodes, edges).code, `${meta.id} PyTorch`);
      assertPythonSyntax(compilePipelineToTensorFlow(nodes, edges).code, `${meta.id} TensorFlow`);
    }
    if (meta.runnable) {
      const model = await executeBrowserGraph({ nodes, edges, dataset: project.data });
      assert.ok(model, `${meta.id} should train in the browser`);
    }
  }
  console.log(`Validated ${pluginRegistry.length} usable components and tutorials, every architecture compiler mapping, both browser pipelines, platform services, localization, execution tiers, and ${exampleMetadata.length} teaching examples.`);
}

