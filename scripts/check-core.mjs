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
import {
  fitPresentationStage,
  getPresentationPlaybackAction,
  hasScriptPlayback,
} from '../src/components/playground/presentationMode.js';
import {
  clampMotionDuration,
  DEFAULT_MOTION_POLICY,
  interpolatePrimitiveList,
  resolveMotionConfig,
  stableMotionIdentity,
} from '../src/components/playground/motion.js';
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
  compositionPreview,
  importedPreview,
  previewFidelityStatus,
  previewProvenance,
  previewRunnable,
  revisionErrorPreview,
  revisionPreview,
} from '../src/components/playground/agentPreviewState.js';
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
import {
  computeMlpDecisionRegions,
  generateXorDataset,
  initMlpParameters,
  predictMlp,
  trainMlp,
} from '../src/core/playground/model/mlpMath.js';
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
  (error) => error.cod…84226 tokens truncated…((name) => [name, row[name]])),
            label: row.species,
          })),
          featureColumns: f3WorkspaceDataset.featureColumns,
          trainRatio: 0.8,
        };

        // 1. The MLP adapter is feature-name agnostic: no x1/x2 or label
        // hardcodes remain.
        const f3AdapterSource = readFileSync(new URL('../src/core/playground/model/mlpAdapter.js', import.meta.url), 'utf-8');
        assert.ok(
          !f3AdapterSource.includes("'x1'") && !f3AdapterSource.includes("'b'")
          && !f3AdapterSource.includes('=== 1 ?'),
          'mlpAdapter contains no hardcoded feature or label names',
        );

        // 2. Workspace datasets flow through the shared dataset contract:
        // stratified split, real normalization, feature options, projection.
        let f3Workspace = createPlaygroundSession(getPlayground('mlp-classification'), {
          source: f3WorkspaceSource,
          seed: 3,
          sessionId: 'f3-ws',
        });
        assert.equal(f3Workspace.modelState.trainSamples.length, 32, 'workspace data uses an 80/20 split');
        assert.equal(f3Workspace.modelState.testSamples.length, 8, 'workspace data keeps a test set');
        assert.ok(
          f3Workspace.modelState.normalization.means.some((mean) => mean !== 0),
          'workspace normalization is derived from training statistics',
        );
        assert.deepEqual(
          f3Workspace.modelState.labelMapping,
          { labels: ['setosa', 'versicolor'], toIndex: { setosa: 0, versicolor: 1 } },
          'binary labels get a stable sorted mapping',
        );
        const f3WorkspaceScene = derivePlaygroundSnapshot(f3Workspace).scene;
        assert.equal(f3WorkspaceScene.featureOptions.length, 4, 'scene exposes every numeric feature');
        assert.equal(f3WorkspaceScene.projection.enabled, true, 'multi-feature data enables the 2D projection');
        assert.equal(f3WorkspaceScene.axes.x, 'sepal_length', 'view axes use the dataset column names');
        f3Workspace = dispatchPlaygroundAction(f3Workspace, { type: 'SET_CONTROL', key: 'showDecisionRegions', value: true });
        f3Workspace = dispatchPlaygroundAction(f3Workspace, { type: 'START_TRAINING' });
        const f3WorkspaceHistory = f3Workspace.modelState.training.history;
        for (let index = 0; index < f3WorkspaceHistory.length; index += 1) {
          f3Workspace = dispatchPlaygroundAction(f3Workspace, { type: 'STEP' });
        }
        const f3TrainedScene = derivePlaygroundSnapshot(f3Workspace).scene;
        assert.ok(f3TrainedScene.training.lossHistory.length > 0, 'workspace training produces a loss history');
        assert.equal(typeof f3TrainedScene.metrics.testAccuracy, 'number', 'workspace training reports test accuracy');
        assert.deepEqual(
          f3Workspace.modelState.decisionRegions.cells,
          computeMlpDecisionRegions({
            params: f3Workspace.modelState.params,
            points: f3Workspace.modelState.points,
            featureColumns: f3Workspace.modelState.featureColumns,
            xFeature: f3Workspace.modelState.xFeature,
            yFeature: f3Workspace.modelState.yFeature,
            normalization: f3Workspace.modelState.normalization,
            labels: f3Workspace.modelState.labelMapping.labels,
            resolution: 48,
          }).cells,
          'workspace decision regions are computed in the normalized view',
        );

        // 3. XOR example keeps its exact F.1/F.1.1 semantics: all-data
        // training, identity normalization, x1/x2 view, default-compatible
        // decision regions.
        const f3XorSource = {
          kind: 'example', name: 'XOR', fingerprint: 'f3-xor',
          points: generateXorDataset({ seed: 3 }),
          featureColumns: ['x1', 'x2'],
        };
        let f3Xor = createPlaygroundSession(getPlayground('mlp-classification'), { source: f3XorSource, seed: 3, sessionId: 'f3-xor' });
        assert.equal(f3Xor.modelState.trainSamples.length, f3XorSource.points.length, 'XOR trains on all data without a split');
        assert.equal(f3Xor.modelState.testSamples.length, 0, 'XOR has no test set');
        assert.ok(
          f3Xor.modelState.normalization.means.every((mean) => mean === 0)
          && f3Xor.modelState.normalization.stds.every((std) => std === 1),
          'XOR uses identity normalization so its view equals the raw features',
        );
        f3Xor = dispatchPlaygroundAction(f3Xor, { type: 'SET_CONTROL', key: 'showDecisionRegions', value: true });
        f3Xor = dispatchPlaygroundAction(f3Xor, { type: 'START_TRAINING' });
        const f3XorHistory = f3Xor.modelState.training.history;
        for (let index = 0; index < f3XorHistory.length; index += 1) f3Xor = dispatchPlaygroundAction(f3Xor, { type: 'STEP' });
        assert.deepEqual(
          f3Xor.modelState.decisionRegions.cells,
          computeMlpDecisionRegions({ params: f3Xor.modelState.params, points: f3XorSource.points, resolution: 48 }).cells,
          'XOR decision regions stay byte-compatible with the default helper',
        );

        // 4. The registry-driven host integration resolves a compatible
        // workspace dataset and rejects multi-class datasets explicitly.
        const f3Host = createPlaygroundHost({ getDataset: () => f3WorkspaceDataset });
        const f3Agent = createPlaygroundAgentApi(f3Host);
        const f3Opened = await f3Agent.open({ playgroundId: 'mlp-classification' });
        assert.equal(f3Opened.source.kind, 'workspace-dataset', 'the host resolves the workspace dataset');
        const f3Explain = await f3Agent.plan('Explain this MLP prediction');
        const f3Composed = await f3Agent.composeScript(f3Explain);
        assert.equal(f3Composed.fidelity.valid, true, 'workspace explain_prediction passes goal fidelity');
        await f3Agent.close();
        const f3MultiClass = {
          name: 'three', task: 'classification',
          rows: Array.from({ length: 30 }, (_, index) => ({ a: index % 3, b: index % 2, species: `class${index % 3}` })),
          columns: [
            { name: 'a', type: 'number', missing: 0 },
            { name: 'b', type: 'number', missing: 0 },
          ],
          featureColumns: ['a', 'b'],
          targetColumn: 'species',
        };
        const f3MultiHost = createPlaygroundHost({ getDataset: () => f3MultiClass });
        const f3MultiAgent = createPlaygroundAgentApi(f3MultiHost);
        await assert.rejects(
          f3MultiAgent.open({ playgroundId: 'mlp-classification' }),
          (error) => error.code === 'INVALID_PLAYGROUND_SOURCE',
          'multi-class datasets are rejected for the binary MLP',
        );
      }

      // PR F.3.1: workspace label and feature semantics.
      {
        const f31Rows = [];
        for (let index = 0; index < 40; index += 1) {
          const group = index % 2;
          f31Rows.push({
            sepal_length: Number((group === 0 ? 2 : 6) + Math.sin(index * 1.3) * 0.4),
            sepal_width: Number((group === 0 ? 2 : 6) + Math.cos(index * 0.9) * 0.4),
            petal_length: Number((group === 0 ? 1 : 3) + Math.sin(index * 0.7) * 0.3),
            petal_width: Number((group === 0 ? 0.5 : 2) + Math.cos(index * 1.1) * 0.3),
            species: group === 0 ? 'setosa' : 'versicolor',
          });
        }
        const f31WorkspaceSource = {
          kind: 'workspace-dataset',
          name: 'two-clusters',
          fingerprint: 'f31-ws',
          points: f31Rows.map((row, index) => ({
            id: `d${index}`,
            features: Object.fromEntries(['sepal_length', 'sepal_width', 'petal_length', 'petal_width'].map((name) => [name, row[name]])),
            label: row.species,
          })),
          featureColumns: ['sepal_length', 'sepal_width', 'petal_length', 'petal_width'],
          trainRatio: 0.8,
        };

        // 1. External predictions stay in the original workspace label space.
        let f31Workspace = createPlaygroundSession(getPlayground('mlp-classification'), {
          source: f31WorkspaceSource,
          seed: 3,
          sessionId: 'f31-ws',
        });
        f31Workspace = dispatchPlaygroundAction(f31Workspace, { type: 'SET_CONTROL', key: 'showDecisionRegions', value: true });
        f31Workspace = dispatchPlaygroundAction(f31Workspace, { type: 'START_TRAINING' });
        const f31History = f31Workspace.modelState.training.history;
        for (let index = 0; index < f31History.length; index += 1) {
          f31Workspace = dispatchPlaygroundAction(f31Workspace, { type: 'STEP' });
        }
        const f31Trained = derivePlaygroundSnapshot(f31Workspace).scene;
        assert.ok(f31Trained.metrics.accuracy > 0.8, 'workspace training accuracy is materially above chance');
        assert.ok(f31Trained.metrics.testAccuracy > 0.8, 'workspace test accuracy is materially above chance');
        f31Workspace = dispatchPlaygroundAction(f31Workspace, { type: 'START_PREDICT' });
        for (let index = 0; index < f31Workspace.modelState.hiddenSize; index += 1) {
          f31Workspace = dispatchPlaygroundAction(f31Workspace, { type: 'STEP' });
        }
        const f31Predicted = derivePlaygroundSnapshot(f31Workspace).scene.metrics.predictedLabel;
        assert.ok(
          ['setosa', 'versicolor'].includes(f31Predicted),
          'metrics.predictedLabel is one of the original workspace labels',
        );
        const f31Emitted = f31Workspace.traces.find((trace) => trace.type === 'prediction.emitted');
        assert.ok(
          ['setosa', 'versicolor'].includes(f31Emitted.payload.label)
          && f31Emitted.payload.label !== 'a'
          && f31Emitted.payload.label !== 'b',
          'prediction.emitted carries the workspace label, never XOR a/b',
        );

        // 2. Decision-region cells use the workspace label space (semantic
        // assertion, not just helper equality).
        const f31RegionLabels = new Set(f31Workspace.modelState.decisionRegions.cells.map((cell) => cell.label));
        assert.ok(
          [...f31RegionLabels].every((label) => ['setosa', 'versicolor'].includes(label)),
          'every decision-region cell belongs to the workspace label space',
        );
        assert.deepEqual(
          f31Workspace.modelState.decisionRegions.cells,
          computeMlpDecisionRegions({
            params: f31Workspace.modelState.params,
            points: f31Workspace.modelState.points,
            featureColumns: f31Workspace.modelState.featureColumns,
            xFeature: f31Workspace.modelState.xFeature,
            yFeature: f31Workspace.modelState.yFeature,
            normalization: f31Workspace.modelState.normalization,
            labels: f31Workspace.modelState.labelMapping.labels,
            resolution: 48,
          }).cells,
          'runtime decision cells equal the labeled helper output',
        );

        // 3. Numeric binary targets (0/1) use the workspace source and get the
        // stable string mapping '0' -> 0, '1' -> 1.
        const f31NumericRows = Array.from({ length: 30 }, (_, index) => {
          const group = index % 2;
          return { a: Number(group === 0 ? 1 : 5 + Math.sin(index) * 0.2), b: Number(group === 0 ? 1 : 5 + Math.cos(index) * 0.2), target: group };
        });
        const f31NumericHost = createPlaygroundHost({ getDataset: () => ({
          name: 'numeric', task: 'classification', rows: f31NumericRows,
          columns: [
            { name: 'a', type: 'number', missing: 0 },
            { name: 'b', type: 'number', missing: 0 },
            { name: 'target', type: 'number', missing: 0 },
          ],
          featureColumns: ['a', 'b'],
          targetColumn: 'target',
        }) });
        const f31NumericAgent = createPlaygroundAgentApi(f31NumericHost);
        const f31NumericOpened = await f31NumericAgent.open({ playgroundId: 'mlp-classification' });
        assert.equal(f31NumericOpened.source.kind, 'workspace-dataset', 'numeric binary targets do not fall back to XOR');
        const f31NumericSession = createPlaygroundSession(getPlayground('mlp-classification'), {
          source: {
            kind: 'workspace-dataset', name: 'numeric', fingerprint: 'f31-num',
            points: f31NumericRows.map((row, index) => ({
              id: `d${index}`,
              features: { a: row.a, b: row.b },
              label: String(row.target),
            })),
            featureColumns: ['a', 'b'],
            trainRatio: 0.8,
          },
          seed: 3,
          sessionId: 'f31-num',
        });
        assert.deepEqual(
          f31NumericSession.modelState.labelMapping,
          { labels: ['0', '1'], toIndex: { '0': 0, '1': 1 } },
          'numeric targets normalize to stable semantic strings',
        );
        await f31NumericAgent.close();

        // 4. Declared featureColumns are authoritative: unrelated numeric
        // columns (id, unused_numeric) never enter the model.
        const f31AuthorityRows = Array.from({ length: 30 }, (_, index) => {
          const group = index % 2;
          return {
            id: index,
            feature_a: Number(group === 0 ? 1 : 5 + Math.sin(index) * 0.2),
            feature_b: Number(group === 0 ? 1 : 5 + Math.cos(index) * 0.2),
            unused_numeric: 999 + index,
            target: group,
          };
        });
        const f31AuthorityHost = createPlaygroundHost({ getDataset: () => ({
          name: 'authority', task: 'classification', rows: f31AuthorityRows,
          columns: ['id', 'feature_a', 'feature_b', 'unused_numeric']
            .map((name) => ({ name, type: 'number', missing: 0 }))
            .concat([{ name: 'target', type: 'number', missing: 0 }]),
          featureColumns: ['feature_a', 'feature_b'],
          targetColumn: 'target',
        }) });
        const f31AuthorityAgent = createPlaygroundAgentApi(f31AuthorityHost);
        const f31AuthorityOpened = await f31AuthorityAgent.open({ playgroundId: 'mlp-classification' });
        assert.equal(f31AuthorityOpened.source.kind, 'workspace-dataset', 'authoritative feature dataset is used');
        const f31AuthoritySession = createPlaygroundSession(getPlayground('mlp-classification'), {
          source: {
            kind: 'workspace-dataset', name: 'authority', fingerprint: 'f31-auth',
            points: f31AuthorityRows.map((row, index) => ({
              id: `d${index}`,
              features: { feature_a: row.feature_a, feature_b: row.feature_b },
              label: String(row.target),
            })),
            featureColumns: ['feature_a', 'feature_b'],
            trainRatio: 0.8,
          },
          seed: 3,
          sessionId: 'f31-auth',
        });
        assert.deepEqual(
          f31AuthoritySession.modelState.featureColumns,
          ['feature_a', 'feature_b'],
          'MLP input uses exactly the declared featureColumns',
        );
        assert.equal(f31AuthoritySession.modelState.params.W1[0].length, 2, 'inputSize matches the declared features');
        await f31AuthorityAgent.close();

        // 5. XOR defaults stay byte-compatible: predictMlp -> a/b and the
        // default decision-region helper -> a/b.
        const f31XorPoints = generateXorDataset({ seed: 3 });
        const f31XorSession = createPlaygroundSession(getPlayground('mlp-classification'), {
          source: { kind: 'example', name: 'XOR', fingerprint: 'f31-xor', points: f31XorPoints, featureColumns: ['x1', 'x2'] },
          seed: 3,
          sessionId: 'f31-xor',
        });
        const f31XorPrediction = predictMlp(f31XorSession.modelState.params, [1, -1]);
        assert.ok(['a', 'b'].includes(f31XorPrediction.label), 'default predictMlp keeps XOR a/b labels');
        const f31XorCells = computeMlpDecisionRegions({ params: f31XorSession.modelState.params, points: f31XorPoints }).cells;
        assert.ok(
          f31XorCells.every((cell) => ['a', 'b'].includes(cell.label)),
          'default decision-region helper keeps XOR a/b labels',
        );
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

