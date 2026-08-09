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
  ×Mzï{h‘éì¶»§q«^wÜšÜÜXÙK›[Ù[Ý]K™™X]\™PÛÛ[[œËBˆ™X]\™NˆŒÕÛÜšÜÜXÙK›[Ù[Ý]Kž™X]\™KBˆQ™X]\™NˆŒÕÛÜšÜÜXÙK›[Ù[Ý]KžQ™X]\™KBˆ›Ü›X[^˜][ÛŽˆŒÕÛÜšÜÜXÙK›[Ù[Ý]K››Ü›X[^˜][Û‹BˆX™[ÎˆŒÕÛÜšÜÜXÙK›[Ù[Ý]K›X™[X\[™Ë›X™[ËBˆ™\ÛÛ][ÛŽˆBˆJK˜Ù[ËBˆ	ÝÛÜšÜÜXÙHXÚ\Ú[Ûˆ™YÚ[ÛœÈ\™HÛÛ\]Y[ˆH›Ü›X[^™YšY]ÉËBˆ
NÃBƒBˆËÈËˆÔˆ^[\HÙY\È]È^XÝ‹ŒKÑ‹ŒKŒHÙ[X[XÜÎˆ[Y]CBˆËÈ˜Z[š[™ËY[]H›Ü›X[^˜][Û‹KÞˆšY]ËY˜][XÛÛ\]X›CBˆËÈXÚ\Ú[Ûˆ™YÚ[ÛœËƒBˆÛÛœÝŒÖÜ”ÛÝ\˜ÙHHÃBˆÚ[™ˆ	Ù^[\IË˜[YNˆ	ÖÔ‰Ëš[™Ù\œš[ˆ	ÙŒË^Ü‰ËBˆÚ[ÎˆÙ[™\˜]VÜ‘]\Ù]
ÈÙYYˆÈJKBˆ™X]\™PÛÛ[[œÎˆÉÞIË	Þ‰×KBˆNÃBˆ]ŒÖÜˆHÜ™X]T^YÜ›Ý[™Ù\ÜÚ[ÛŠÙ]^YÜ›Ý[™
	Û[XÛ\ÜÚYšXØ][Û‰ÊKÈÛÝ\˜ÙNˆŒÖÜ”ÛÝ\˜ÙKÙYYˆËÙ\ÜÚ[Û’Yˆ	ÙŒË^Ü‰ÈJNÃBˆ\ÜÙ\™\]X[
ŒÖÜ‹›[Ù[Ý]K˜Z[”Ø[\\Ë›[™ÝŒÖÜ”ÛÝ\˜ÙKœÚ[Ë›[™Ý	ÖÔˆ˜Z[œÈÛˆ[]HÚ]Ý]HÜ]	ÊNÃBˆ\ÜÙ\™\]X[
ŒÖÜ‹›[Ù[Ý]K\ÝØ[\\Ë›[™Ý	ÖÔˆ\È›È\ÝÙ]	ÊNÃBˆ\ÜÙ\›ÚÊBˆŒÖÜ‹›[Ù[Ý]K››Ü›X[^˜][Û‹›YX[œË™]™\žJ
YX[ŠHOˆYX[ˆOOH
CBˆ	‰ˆŒÖÜ‹›[Ù[Ý]K››Ü›X[^˜][Û‹œÝË™]™\žJ
Ý
HOˆÝOOHJKBˆ	ÖÔˆ\Ù\ÈY[]H›Ü›X[^˜][ÛˆÛÈ]ÈšY]È\]X[ÈH˜]È™X]\™\ÉËBˆ
NÃBˆŒÖÜˆH\Ü]Ú^YÜ›Ý[™XÝ[ÛŠŒÖÜ‹È\Nˆ	ÔÑUÐÓÓ•“Ó	ËÙ^Nˆ	ÜÚÝÑXÚ\Ú[Û”™YÚ[ÛœÉË˜[YNˆYHJNÃBˆŒÖÜˆH\Ü]Ú^YÜ›Ý[™XÝ[ÛŠŒÖÜ‹È\Nˆ	ÔÕT•ÕRS’S‘ÉÈJNÃBˆÛÛœÝŒÖÜ’\ÝÜžHHŒÖÜ‹›[Ù[Ý]K˜Z[š[™Ëš\ÝÜžNÃBˆ›Üˆ
][™^HÈ[™^ŒÖÜ’\ÝÜžK›[™ÝÈ[™^
ÏHJHŒÖÜˆH\Ü]Ú^YÜ›Ý[™XÝ[ÛŠŒÖÜ‹È\Nˆ	ÔÕT	ÈJNÃBˆ\ÜÙ\™Y\\]X[
BˆŒÖÜ‹›[Ù[Ý]K™XÚ\Ú[Û”™YÚ[ÛœË˜Ù[ËBˆÛÛ\]S[XÚ\Ú[Û”™YÚ[ÛœÊÈ\˜[\ÎˆŒÖÜ‹›[Ù[Ý]Kœ\˜[\ËÚ[ÎˆŒÖÜ”ÛÝ\˜ÙKœÚ[Ë™\ÛÛ][ÛŽˆJK˜Ù[ËBˆ	ÖÔˆXÚ\Ú[Ûˆ™YÚ[ÛœÈÝ^Hž]KXÛÛ\]X›HÚ]HY˜][[\‰ËBˆ
NÃBƒBˆËÈˆH™YÚ\ÝžKYš]™[ˆÜÝ[YÜ˜][Ûˆ™\ÛÛ™\ÈHÛÛ\]X›CBˆËÈÛÜšÜÜXÙH]\Ù][™™Z™XÝÈ][KXÛ\ÜÈ]\Ù]È^XÚ]KƒBˆÛÛœÝŒÒÜÝHÜ™X]T^YÜ›Ý[™ÜÝ
ÈÙ]]\Ù]ˆ

HOˆŒÕÛÜšÜÜXÙQ]\Ù]JNÃBˆÛÛœÝŒÐYÙ[HÜ™X]T^YÜ›Ý[™YÙ[\JŒÒÜÝ
NÃBˆÛÛœÝŒÓÜ[™YH]ØZ]ŒÐYÙ[›Ü[ŠÈ^YÜ›Ý[™Yˆ	Û[XÛ\ÜÚYšXØ][Û‰ÈJNÃBˆ\ÜÙ\™\]X[
ŒÓÜ[™YœÛÝ\˜ÙKšÚ[™	ÝÛÜšÜÜXÙKY]\Ù]	Ë	ÝHÜÝ™\ÛÛ™\ÈHÛÜšÜÜXÙH]\Ù]	ÊNÃBˆÛÛœÝŒÑ^Z[ˆH]ØZ]ŒÐYÙ[œ[Š	Ñ^Z[ˆ\ÈS™YXÝ[Û‰ÊNÃBˆÛÛœÝŒÐÛÛ\ÜÙYH]ØZ]ŒÐYÙ[˜ÛÛ\ÜÙTØÜš\
ŒÑ^Z[ŠNÃBˆ\ÜÙ\™\]X[
ŒÐÛÛ\ÜÙY™šY[]K˜[YYK	ÝÛÜšÜÜXÙH^Z[—Ü™YXÝ[Ûˆ\ÜÙ\ÈÛØ[šY[]IÊNÃBˆ]ØZ]ŒÐYÙ[˜ÛÜÙJ
NÃBˆÛÛœÝŒÓ][PÛ\ÜÈHÃBˆ˜[YNˆ	Ý™YIË\ÚÎˆ	ØÛ\ÜÚYšXØ][Û‰ËBˆ›ÝÜÎˆ\œ˜^K™œ›ÛJÈ[™ÝˆÌK
Ë[™^
HOˆ
ÈNˆ[™^	HËŽˆ[™^	H‹ÜXÚY\ÎˆÛ\ÜÉÚ[™^	HßXJJKBˆÛÛ[[œÎˆÃBˆÈ˜[YNˆ	ØIË\Nˆ	Û[X™\‰ËZ\ÜÚ[™ÎˆKBˆÈ˜[YNˆ	Ø‰Ë\Nˆ	Û[X™\‰ËZ\ÜÚ[™ÎˆKBˆKBˆ™X]\™PÛÛ[[œÎˆÉØIË	Ø‰×KBˆ\™Ù]ÛÛ[[Žˆ	ÜÜXÚY\ÉËBˆNÃBˆÛÛœÝŒÓ][RÜÝHÜ™X]T^YÜ›Ý[™ÜÝ
ÈÙ]]\Ù]ˆ

HOˆŒÓ][PÛ\ÜÈJNÃBˆÛÛœÝŒÓ][PYÙ[HÜ™X]T^YÜ›Ý[™YÙ[\JŒÓ][RÜÝ
NÃBˆ]ØZ]\ÜÙ\œ™Z™XÝÊBˆŒÓ][PYÙ[›Ü[ŠÈ^YÜ›Ý[™Yˆ	Û[XÛ\ÜÚYšXØ][Û‰ÈJKBˆ
\œ›ÜŠHOˆ\œ›Ü‹˜ÛÙHOOH	ÒS•SQÔVQÔ“ÕS‘ÔÓÕTÑIËBˆ	Û][KXÛ\ÜÈ]\Ù]È\™H™Z™XÝY›ÜˆHš[˜\žHS	ËBˆ
NÃBˆCBƒBˆËÈˆ‹ŒËŒNˆÛÜšÜÜXÙHX™[[™™X]\™HÙ[X[XÜËƒBˆÃBˆÛÛœÝŒÌT›ÝÜÈH×NÃBˆ›Üˆ
][™^HÈ[™^È[™^
ÏHJHÃBˆÛÛœÝÜ›Ý\H[™^	HŽÃBˆŒÌT›ÝÜËœ\Ú
ÃBˆÙ\[Û[™Ýˆ[X™\Š
Ü›Ý\OOHÈˆˆŠH
ÈX]œÚ[Š[™^
ˆKŒÊH
ˆ
KBˆÙ\[ÝÚYˆ[X™\Š
Ü›Ý\OOHÈˆˆŠH
ÈX]˜ÛÜÊ[™^
ˆŽJH
ˆ
KBˆ][Û[™Ýˆ[X™\Š
Ü›Ý\OOHÈHˆÊH
ÈX]œÚ[Š[™^
ˆÊH
ˆŒÊKBˆ][ÝÚYˆ[X™\Š
Ü›Ý\OOHÈHˆŠH
ÈX]˜ÛÜÊ[™^
ˆKŒJH
ˆŒÊKBˆÜXÚY\ÎˆÜ›Ý\OOHÈ	ÜÙ]ÜØIÈˆ	Ý™\œÚXÛÛÜ‰ËBˆJNÃBˆCBˆÛÛœÝŒÌUÛÜšÜÜXÙTÛÝ\˜ÙHHÃBˆÚ[™ˆ	ÝÛÜšÜÜXÙKY]\Ù]	ËBˆ˜[YNˆ	ÝÛËXÛ\Ý\œÉËBˆš[™Ù\œš[ˆ	ÙŒÌK]ÜÉËBˆÚ[ÎˆŒÌT›ÝÜË›X\

›ÝË[™^
HOˆ
ÃBˆYˆ	Ú[™^XBˆ™X]\™\ÎˆØš™XÝ™œ›ÛQ[šY\ÊÉÜÙ\[Û[™Ý	Ë	ÜÙ\[ÝÚY	Ë	Ü][Û[™Ý	Ë	Ü][ÝÚY	×K›X\

˜[YJHOˆÛ˜[YK›ÝÖÛ˜[YWWJJKBˆX™[ˆ›ÝËœÜXÚY\ËBˆJJKBˆ™X]\™PÛÛ[[œÎˆÉÜÙ\[Û[™Ý	Ë	ÜÙ\[ÝÚY	Ë	Ü][Û[™Ý	Ë	Ü][ÝÚY	×KBˆ˜Z[”˜][ÎˆŽBˆNÃBƒBˆËÈKˆ^\›˜[™YXÝ[ÛœÈÝ^H[ˆHÜšYÚ[˜[ÛÜšÜÜXÙHX™[ÜXÙKƒBˆ]ŒÌUÛÜšÜÜXÙHHÜ™X]T^YÜ›Ý[™Ù\ÜÚ[ÛŠÙ]^YÜ›Ý[™
	Û[XÛ\ÜÚYšXØ][Û‰ÊKÃBˆÛÝ\˜ÙNˆŒÌUÛÜšÜÜXÙTÛÝ\˜ÙKBˆÙYYˆËBˆÙ\ÜÚ[Û’Yˆ	ÙŒÌK]ÜÉËBˆJNÃBˆŒÌUÛÜšÜÜXÙHH\Ü]Ú^YÜ›Ý[™XÝ[ÛŠŒÌUÛÜšÜÜXÙKÈ\Nˆ	ÔÑUÐÓÓ•“Ó	ËÙ^Nˆ	ÜÚÝÑXÚ\Ú[Û”™YÚ[ÛœÉË˜[YNˆYHJNÃBˆŒÌUÛÜšÜÜXÙHH\Ü]Ú^YÜ›Ý[™XÝ[ÛŠŒÌUÛÜšÜÜXÙKÈ\Nˆ	ÔÕT•ÕRS’S‘ÉÈJNÃBˆÛÛœÝŒÌR\ÝÜžHHŒÌUÛÜšÜÜXÙK›[Ù[Ý]K˜Z[š[™Ëš\ÝÜžNÃBˆ›Üˆ
][™^HÈ[™^ŒÌR\ÝÜžK›[™ÝÈ[™^
ÏHJHÃBˆŒÌUÛÜšÜÜXÙHH\Ü]Ú^YÜ›Ý[™XÝ[ÛŠŒÌUÛÜšÜÜXÙKÈ\Nˆ	ÔÕT	ÈJNÃBˆCBˆÛÛœÝŒÌU˜Z[™YH\š]™T^YÜ›Ý[™Û˜\ÚÝ
ŒÌUÛÜšÜÜXÙJKœØÙ[™NÃBˆ\ÜÙ\›ÚÊŒÌU˜Z[™Y›Y]šXÜË˜XØÝ\˜XÞHˆŽ	ÝÛÜšÜÜXÙH˜Z[š[™ÈXØÝ\˜XÞH\ÈX]\šX[HX›Ý™HÚ[˜ÙIÊNÃBˆ\ÜÙ\›ÚÊŒÌU˜Z[™Y›Y]šXÜË\ÝXØÝ\˜XÞHˆŽ	ÝÛÜšÜÜXÙH\ÝXØÝ\˜XÞH\ÈX]\šX[HX›Ý™HÚ[˜ÙIÊNÃBˆŒÌUÛÜšÜÜXÙHH\Ü]Ú^YÜ›Ý[™XÝ[ÛŠŒÌUÛÜšÜÜXÙKÈ\Nˆ	ÔÕT•Ô‘QPÕ	ÈJNÃBˆ›Üˆ
][™^HÈ[™^ŒÌUÛÜšÜÜXÙK›[Ù[Ý]KšY[”Ú^™NÈ[™^
ÏHJHÃBˆŒÌUÛÜšÜÜXÙHH\Ü]Ú^YÜ›Ý[™XÝ[ÛŠŒÌUÛÜšÜÜXÙKÈ\Nˆ	ÔÕT	ÈJNÃBˆCBˆÛÛœÝŒÌT™YXÝYH\š]™T^YÜ›Ý[™Û˜\ÚÝ
ŒÌUÛÜšÜÜXÙJKœØÙ[™K›Y]šXÜËœ™YXÝYX™[ÃBˆ\ÜÙ\›ÚÊBˆÉÜÙ]ÜØIË	Ý™\œÚXÛÛÜ‰×Kš[˜ÛY\ÊŒÌT™YXÝY
KBˆ	ÛY]šXÜËœ™YXÝYX™[\ÈÛ™HÙˆHÜšYÚ[˜[ÛÜšÜÜXÙHX™[ÉËBˆ
NÃBˆÛÛœÝŒÌQ[Z]YHŒÌUÛÜšÜÜXÙK˜XÙ\Ë™š[™

˜XÙJHOˆ˜XÙK\HOOH	Ü™YXÝ[Û‹™[Z]Y	ÊNÃBˆ\ÜÙ\›ÚÊBˆÉÜÙ]ÜØIË	Ý™\œÚXÛÛÜ‰×Kš[˜ÛY\ÊŒÌQ[Z]Yœ^[ØY›X™[
CBˆ	‰ˆŒÌQ[Z]Yœ^[ØY›X™[OOH	ØIÃBˆ	‰ˆŒÌQ[Z]Yœ^[ØY›X™[OOH	Ø‰ËBˆ	Ü™YXÝ[Û‹™[Z]YØ\œšY\ÈHÛÜšÜÜXÙHX™[™]™\ˆÔˆKØ‰ËBˆ
NÃBƒBˆËÈ‹ˆXÚ\Ú[Û‹\™YÚ[ÛˆÙ[È\ÙHHÛÜšÜÜXÙHX™[ÜXÙH
Ù[X[XÃBˆËÈ\ÜÙ\[Û‹›Ý\Ý[\ˆ\]X[]JKƒBˆÛÛœÝŒÌT™YÚ[Û“X™[ÈH™]ÈÙ]
ŒÌUÛÜšÜÜXÙK›[Ù[Ý]K™XÚ\Ú[Û”™YÚ[ÛœË˜Ù[Ë›X\

Ù[
HOˆÙ[›X™[
JNÃBˆ\ÜÙ\›ÚÊBˆË‹‹™ŒÌT™YÚ[Û“X™[×K™]™\žJ
X™[
HOˆÉÜÙ]ÜØIË	Ý™\œÚXÛÛÜ‰×Kš[˜ÛY\ÊX™[
JKBˆ	Ù]™\žHXÚ\Ú[Û‹\™YÚ[ÛˆÙ[™[Û™ÜÈÈHÛÜšÜÜXÙHX™[ÜXÙIËBˆ
NÃBˆ\ÜÙ\™Y\\]X[
BˆŒÌUÛÜšÜÜXÙK›[Ù[Ý]K™XÚ\Ú[Û”™YÚ[ÛœË˜Ù[ËBˆÛÛ\]S[XÚ\Ú[Û”™YÚ[ÛœÊÃBˆ\˜[\ÎˆŒÌUÛÜšÜÜXÙK›[Ù[Ý]Kœ\˜[\ËBˆÚ[ÎˆŒÌUÛÜšÜÜXÙK›[Ù[Ý]KœÚ[ËBˆ™X]\™PÛÛ[[œÎˆŒÌUÛÜšÜÜXÙK›[Ù[Ý]K™™X]\™PÛÛ[[œËBˆ™X]\™NˆŒÌUÛÜšÜÜXÙK›[Ù[Ý]Kž™X]\™KBˆQ™X]\™NˆŒÌUÛÜšÜÜXÙK›[Ù[Ý]KžQ™X]\™KBˆ›Ü›X[^˜][ÛŽˆŒÌUÛÜšÜÜXÙK›[Ù[Ý]K››Ü›X[^˜][Û‹BˆX™[ÎˆŒÌUÛÜšÜÜXÙK›[Ù[Ý]K›X™[X\[™Ë›X™[ËBˆ™\ÛÛ][ÛŽˆBˆJK˜Ù[ËBˆ	Ü[[YHXÚ\Ú[ÛˆÙ[È\]X[HX™[Y[\ˆÝ]]	ËBˆ
NÃBƒBˆËÈËˆ[Y\šXÈš[˜\žH\™Ù]È
ÌJH\ÙHHÛÜšÜÜXÙHÛÝ\˜ÙH[™Ù]CBˆËÈÝX›HÝš[™ÈX\[™È	Ì	ÈOˆ	ÌIÈOˆKƒBˆÛÛœÝŒÌS[Y\šXÔ›ÝÜÈH\œ˜^K™œ›ÛJÈ[™ÝˆÌK
Ë[™^
HOˆÃBˆÛÛœÝÜ›Ý\H[™^	HŽÃBˆ™]\›ˆÈNˆ[X™\ŠÜ›Ý\OOHÈHˆH
ÈX]œÚ[Š[™^
H
ˆŒŠKŽˆ[X™\ŠÜ›Ý\OOHÈHˆH
ÈX]˜ÛÜÊ[™^
H
ˆŒŠK\™Ù]ˆÜ›Ý\NÃBˆJNÃBˆÛÛœÝŒÌS[Y\šXÒÜÝHÜ™X]T^YÜ›Ý[™ÜÝ
ÈÙ]]\Ù]ˆ

HOˆ
ÃBˆ˜[YNˆ	Û[Y\šXÉË\ÚÎˆ	ØÛ\ÜÚYšXØ][Û‰Ë›ÝÜÎˆŒÌS[Y\šXÔ›ÝÜËBˆÛÛ[[œÎˆÃBˆÈ˜[YNˆ	ØIË\Nˆ	Û[X™\‰ËZ\ÜÚ[™ÎˆKBˆÈ˜[YNˆ	Ø‰Ë\Nˆ	Û[X™\‰ËZ\ÜÚ[™ÎˆKBˆÈ˜[YNˆ	Ý\™Ù]	Ë\Nˆ	Û[X™\‰ËZ\ÜÚ[™ÎˆKBˆKBˆ™X]\™PÛÛ[[œÎˆÉØIË	Ø‰×KBˆ\™Ù]ÛÛ[[Žˆ	Ý\™Ù]	ËBˆJHJNÃBˆÛÛœÝŒÌS[Y\šXÐYÙ[HÜ™X]T^YÜ›Ý[™YÙ[\JŒÌS[Y\šXÒÜÝ
NÃBˆÛÛœÝŒÌS[Y\šXÓÜ[™YH]ØZ]ŒÌS[Y\šXÐYÙ[›Ü[ŠÈ^YÜ›Ý[™Yˆ	Û[XÛ\ÜÚYšXØ][Û‰ÈJNÃBˆ\ÜÙ\™\]X[
ŒÌS[Y\šXÓÜ[™YœÛÝ\˜ÙKšÚ[™	ÝÛÜšÜÜXÙKY]\Ù]	Ë	Û[Y\šXÈš[˜\žH\™Ù]ÈÈ›Ý˜[˜XÚÈÈÔ‰ÊNÃBˆÛÛœÝŒÌS[Y\šXÔÙ\ÜÚ[ÛˆHÜ™X]T^YÜ›Ý[™Ù\ÜÚ[ÛŠÙ]^YÜ›Ý[™
	Û[XÛ\ÜÚYšXØ][Û‰ÊKÃBˆÛÝ\˜ÙNˆÃBˆÚ[™ˆ	ÝÛÜšÜÜXÙKY]\Ù]	Ë˜[YNˆ	Û[Y\šXÉËš[™Ù\œš[ˆ	ÙŒÌK[[IËBˆÚ[ÎˆŒÌS[Y\šXÔ›ÝÜË›X\

›ÝË[™^
HOˆ
ÃBˆYˆ	Ú[™^XBˆ™X]\™\ÎˆÈNˆ›ÝË˜KŽˆ›ÝË˜ˆKBˆX™[ˆÝš[™Ê›ÝË\™Ù]
KBˆJJKBˆ™X]\™PÛÛ[[œÎˆÉØIË	Ø‰×KBˆ˜Z[”˜][ÎˆŽBˆKBˆÙYYˆËBˆÙ\ÜÚ[Û’Yˆ	ÙŒÌK[[IËBˆJNÃBˆ\ÜÙ\™Y\\]X[
BˆŒÌS[Y\šXÔÙ\ÜÚ[Û‹›[Ù[Ý]K›X™[X\[™ËBˆÈX™[ÎˆÉÌ	Ë	ÌI×KÒ[™^ˆÈ	Ì	Îˆ	ÌIÎˆHHKBˆ	Û[Y\šXÈ\™Ù]È›Ü›X[^™HÈÝX›HÙ[X[XÈÝš[™ÜÉËBˆ
NÃBˆ]ØZ]ŒÌS[Y\šXÐYÙ[˜ÛÜÙJ
NÃBƒBˆËÈˆXÛ\™Y™X]\™PÛÛ[[œÈ\™H]]Üš]]]™Nˆ[œ™[]Y[Y\šXÃBˆËÈÛÛ[[œÈ
Y[\ÙYÛ[Y\šXÊH™]™\ˆ[\ˆH[Ù[ƒBˆÛÛœÝŒÌP]]Üš]T›ÝÜÈH\œ˜^K™œ›ÛJÈ[™ÝˆÌK
Ë[™^
HOˆÃBˆÛÛœÝÜ›Ý\H[™^	HŽÃBˆ™]\›ˆÃBˆYˆ[™^Bˆ™X]\™WØNˆ[X™\ŠÜ›Ý\OOHÈHˆH
ÈX]œÚ[Š[™^
H
ˆŒŠKBˆ™X]\™WØŽˆ[X™\ŠÜ›Ý\OOHÈHˆH
ÈX]˜ÛÜÊ[™^
H
ˆŒŠKBˆ[\ÙYÛ[Y\šXÎˆNNH
È[™^Bˆ\™Ù]ˆÜ›Ý\BˆNÃBˆJNÃBˆÛÛœÝŒÌP]]Üš]RÜÝHÜ™X]T^YÜ›Ý[™ÜÝ
ÈÙ]]\Ù]ˆ

HOˆ
ÃBˆ˜[YNˆ	Ø]]Üš]IË\ÚÎˆ	ØÛ\ÜÚYšXØ][Û‰Ë›ÝÜÎˆŒÌP]]Üš]T›ÝÜËBˆÛÛ[[œÎˆÉÚY	Ë	Ù™X]\™WØIË	Ù™X]\™WØ‰Ë	Ý[\ÙYÛ[Y\šXÉ×CBˆ›X\

˜[YJHOˆ
È˜[YK\Nˆ	Û[X™\‰ËZ\ÜÚ[™ÎˆJJCBˆ˜ÛÛ˜Ø]
ÞÈ˜[YNˆ	Ý\™Ù]	Ë\Nˆ	Û[X™\‰ËZ\ÜÚ[™ÎˆWJKBˆ™X]\™PÛÛ[[œÎˆÉÙ™X]\™WØIË	Ù™X]\™WØ‰×KBˆ\™Ù]ÛÛ[[Žˆ	Ý\™Ù]	ËBˆJHJNÃBˆÛÛœÝŒÌP]]Üš]PYÙ[HÜ™X]T^YÜ›Ý[™YÙ[\JŒÌP]]Üš]RÜÝ
NÃBˆÛÛœÝŒÌP]]Üš]SÜ[™YH]ØZ]ŒÌP]]Üš]PYÙ[›Ü[ŠÈ^YÜ›Ý[™Yˆ	Û[XÛ\ÜÚYšXØ][Û‰ÈJNÃBˆ\ÜÙ\™\]X[
ŒÌP]]Üš]SÜ[™YœÛÝ\˜ÙKšÚ[™	ÝÛÜšÜÜXÙKY]\Ù]	Ë	Ø]]Üš]]]™H™X]\™H]\Ù]\È\ÙY	ÊNÃBˆÛÛœÝŒÌP]]Üš]TÙ\ÜÚ[ÛˆHÜ™X]T^YÜ›Ý[™Ù\ÜÚ[ÛŠÙ]^YÜ›Ý[™
	Û[XÛ\ÜÚYšXØ][Û‰ÊKÃBˆÛÝ\˜ÙNˆÃBˆÚ[™ˆ	ÝÛÜšÜÜXÙKY]\Ù]	Ë˜[YNˆ	Ø]]Üš]IËš[™Ù\œš[ˆ	ÙŒÌKX]]	ËBˆÚ[ÎˆŒÌP]]Üš]T›ÝÜË›X\

›ÝË[™^
HOˆ
ÃBˆYˆ	Ú[™^XBˆ™X]\™\ÎˆÈ™X]\™WØNˆ›ÝË™™X]\™WØK™X]\™WØŽˆ›ÝË™™X]\™WØˆKBˆX™[ˆÝš[™Ê›ÝË\™Ù]
KBˆJJKBˆ™X]\™PÛÛ[[œÎˆÉÙ™X]\™WØIË	Ù™X]\™WØ‰×KBˆ˜Z[”˜][ÎˆŽBˆKBˆÙYYˆËBˆÙ\ÜÚ[Û’Yˆ	ÙŒÌKX]]	ËBˆJNÃBˆ\ÜÙ\™Y\\]X[
BˆŒÌP]]Üš]TÙ\ÜÚ[Û‹›[Ù[Ý]K™™X]\™PÛÛ[[œËBˆÉÙ™X]\™WØIË	Ù™X]\™WØ‰×KBˆ	ÓS[œ]\Ù\È^XÝHHXÛ\™Y™X]\™PÛÛ[[œÉËBˆ
NÃBˆ\ÜÙ\™\]X[
ŒÌP]]Üš]TÙ\ÜÚ[Û‹›[Ù[Ý]Kœ\˜[\Ë•ÌVÌK›[™Ý‹	Ú[œ]Ú^™HX]Ú\ÈHXÛ\™Y™X]\™\ÉÊNÃBˆ]ØZ]ŒÌP]]Üš]PYÙ[˜ÛÜÙJ
NÃBƒBˆËÈKˆÔˆY˜][ÈÝ^Hž]KXÛÛ\]X›Nˆ™YXÝ[OˆKØˆ[™CBˆËÈY˜][XÚ\Ú[Û‹\™YÚ[Ûˆ[\ˆOˆKØ‹ƒBˆÛÛœÝŒÌVÜ”Ú[ÈHÙ[™\˜]VÜ‘]\Ù]
ÈÙYYˆÈJNÃBˆÛÛœÝŒÌVÜ”Ù\ÜÚ[ÛˆHÜ™X]T^YÜ›Ý[™Ù\ÜÚ[ÛŠÙ]^YÜ›Ý[™
	Û[XÛ\ÜÚYšXØ][Û‰ÊKÃBˆÛÝ\˜ÙNˆÈÚ[™ˆ	Ù^[\IË˜[YNˆ	ÖÔ‰Ëš[™Ù\œš[ˆ	ÙŒÌK^Ü‰ËÚ[ÎˆŒÌVÜ”Ú[Ë™X]\™PÛÛ[[œÎˆÉÞIË	Þ‰×HKBˆÙYYˆËBˆÙ\ÜÚ[Û’Yˆ	ÙŒÌK^Ü‰ËBˆJNÃBˆÛÛœÝŒÌVÜ”™YXÝ[ÛˆH™YXÝ[
ŒÌVÜ”Ù\ÜÚ[Û‹›[Ù[Ý]Kœ\˜[\ËÌKLWJNÃBˆ\ÜÙ\›ÚÊÉØIË	Ø‰×Kš[˜ÛY\ÊŒÌVÜ”™YXÝ[Û‹›X™[
K	ÙY˜][™YXÝ[ÙY\ÈÔˆKØˆX™[ÉÊNÃBˆÛÛœÝŒÌVÜÙ[ÈHÛÛ\]S[XÚ\Ú[Û”™YÚ[ÛœÊÈ\˜[\ÎˆŒÌVÜ”Ù\ÜÚ[Û‹›[Ù[Ý]Kœ\˜[\ËÚ[ÎˆŒÌVÜ”Ú[ÈJK˜Ù[ÎÃBˆ\ÜÙ\›ÚÊBˆŒÌVÜÙ[Ë™]™\žJ
Ù[
HOˆÉØIË	Ø‰×Kš[˜ÛY\ÊÙ[›X™[
JKBˆ	ÙY˜][XÚ\Ú[Û‹\™YÚ[Ûˆ[\ˆÙY\ÈÔˆKØˆX™[ÉËBˆ
NÃBˆCBƒBˆËÈˆ[™Ó“ˆ^\Ý[™È™\Ù]È™[XZ[ˆ[˜Ú[™ÙYƒBˆ\ÜÙ\™Ù\Ó›Ý›ÝÊ

HOˆ˜[Y]TØÜš\
Ù]™\Ù]
	ÚÛ›‹š[›ÉÊJK	ÚÛ›‹š[›ÈÝ[˜[Y]\ÉÊNÃBˆ\ÜÙ\™Ù\Ó›Ý›ÝÊ

HOˆ˜[Y]TØÜš\
Ù]™\Ù]
	Û[™X\‹\™YÜ™\ÜÚ[Û‹š[Z][Û‰ÊJK	Óˆ[Z][Ûˆ™\Ù]Ý[˜[Y]\ÉÊNÃBˆCBˆCBŸCBƒB‹ËÈ]™\žH[™YXXÚ[™È^[\H]\ÝØY[ˆÚ[ˆX\šÙY[›˜X›K[™^ÜÚ[ˆX\šÙY^ÜX›KƒBžÃBˆÛÛœÝ^[\\Õ\›H™]ÈT“
	Ë‹‹Ù^[\\ËÉË[\Ü›Y]K\›
NÃBˆÛÛœÝ^[\Qš[\ÈH™XY\”Þ[˜Ê^[\\Õ\›
K™š[\Š
˜[YJHOˆ˜[YK™[™ÕÚ]
	Ë›ÛÛ[šœÛÛ‰ÊJKœÛÜ

NÃBˆ\ÜÙ\™\]X[
^[\Qš[\Ë›[™Ý^[\SY]Y]K›[™Ý	Ù]™\žHY]Y]H[žH\ÈHÙ[™\˜]Yš[H[™šXÙH™\œØIÊNÃBˆ›Üˆ
ÛÛœÝY]HÙˆ^[\SY]Y]JHÃBˆÛÛœÝ›Ú™XÝH˜[Y]T›Ú™XÝ›Ü•ÛÜšÜÜXÙJ”ÓÓ‹œ\œÙJ™XYš[TÞ[˜Ê™]ÈT“
Y]K™š[K^[\\Õ\›
K	Ý]‹N	ÊJJNÃBˆÛÛœÝÈ›Ù\ËYÙ\ÈHH›Ú™XÝ™Ü˜\ÃBˆYˆ
Y]K™]\Ù]Y
HÃBˆ\ÜÙ\›ÚÊXXÚ[™Ñ]\Ù]žRY
Y]K™]\Ù]Y
K	ÛY]KšYH™Y™\™[˜Ù\È[ˆ^\Ý[™ÈXXÚ[™È]\Ù]
NÃBˆCBˆYˆ
Y]K™^ÜX›JHÃBˆ\ÜÙ\]Û”Þ[^
ÛÛ\[T\[[™UÔUÜ˜Ú
›Ù\ËYÙ\ÊK˜ÛÙK	ÛY]KšYHUÜ˜Ú
NÃBˆ\ÜÙ\]Û”Þ[^
ÛÛ\[T\[[™UÕ[œÛÜ‘›ÝÊ›Ù\ËYÙ\ÊK˜ÛÙK	ÛY]KšYH[œÛÜ‘›ÝØ
NÃBˆCBˆYˆ
Y]Kœ[›˜X›JHÃBˆÛÛœÝ[Ù[H]ØZ]^XÝ]Pœ›ÝÜÙ\‘Ü˜\
È›Ù\ËYÙ\Ë]\Ù]ˆ›Ú™XÝ™]HJNÃBˆ\ÜÙ\›ÚÊ[Ù[	ÛY]KšYHÚÝ[˜Z[ˆ[ˆHœ›ÝÜÙ\˜
NÃBˆCBˆCBˆÛÛœÛÛK›ÙÊ˜[Y]Y	ÜYÚ[”™YÚ\ÝžK›[™ÝH\ØX›HÛÛ\Û™[È[™]ÜšX[Ë]™\žH\˜Ú]XÝ\™HÛÛ\[\ˆX\[™Ë›Ýœ›ÝÜÙ\ˆ\[[™\Ë]›Ü›HÙ\šXÙ\ËØØ[^˜][Û‹^XÝ][ÛˆY\œË[™	Ù^[\SY]Y]K›[™ÝHXXÚ[™È^[\\Ë˜
NÃBŸCBƒB