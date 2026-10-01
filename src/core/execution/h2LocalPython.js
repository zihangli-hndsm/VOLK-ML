import { componentById, defaults, pluginRegistry } from '../components.js';
import { compilePipelineToPyTorch, graphToIR } from '../compiler.js';
import { sha256Utf8 } from '../sourceExportManifest.js';

export const H2_LOCAL_PYTHON_PROFILE_V1 = 'h2-tabular-sequential-v1';
export const H2_LOCAL_PYTHON_REQUEST_V2 = 'volk.h2.request.v2';
export const H2_LOCAL_PYTHON_RESPONSE_V1 = 'volk.h2.response.v1';
export const H2_LOCAL_PYTHON_RESULT_V2 = 'volk.h2.result.v2';
export const H2_LOCAL_PYTHON_COMPILER_VERSION = 'volk-ir-v2-h2-local-python-v1';
export const H2_LOCAL_PYTHON_LIMITS = Object.freeze({
  rows: 4096,
  features: 64,
  nodes: 128,
  edges: 256,
  requestBytes: 20 * 1024 * 1024,
  responseBytes: 256 * 1024,
  epochs: 100,
  batchSize: 256,
  hiddenLayers: 3,
  hiddenWidth: 128,
  parameters: 8192,
  durationMs: 120_000,
});

const GRAPH_KEYS = ['schemaVersion', 'nodes', 'edges'];
const GRAPH_NODE_KEYS = ['nodeId', 'componentId', 'parameters'];
const GRAPH_EDGE_KEYS = ['edgeId', 'sourceNodeId', 'sourcePort', 'targetNodeId', 'targetPort'];
const REQUEST_KEYS = ['schemaVersion', 'sessionId', 'authorization', 'identity', 'graph', 'dataset', 'split', 'training', 'profile'];
const REQUEST_DRAFT_KEYS = REQUEST_KEYS.filter((key) => key !== 'authorization');
const IDENTITY_KEYS = ['projectId', 'graphFingerprint', 'datasetFingerprint', 'splitFingerprint', 'registryFingerprint', 'compilerVersion', 'normalizedRequestFingerprint'];
const AUTHORIZATION_KEYS = ['authorizationId', 'requestFingerprint', 'expiresAt', 'nonce'];
const DATASET_KEYS = ['featureNames', 'targetName', 'task', 'classLabels', 'classVocabulary', 'rows'];
const ROW_KEYS = ['features', 'target'];
const SPLIT_KEYS = ['algorithm', 'seed', 'trainRatio', 'trainIndices', 'testIndices'];
const TRAINING_KEYS = ['seed', 'epochs', 'batchSize', 'shuffle'];
const ALLOWED_OPS = new Set([
  'tensor_input', 'model_output', 'dense', 'relu', 'sigmoid', 'tanh', 'softmax', 'dropout',
  'train_test_split', 'supervised_trainer', 'mse_loss', 'cross_entropy_loss', 'sgd_optimizer', 'adam_optimizer',
]);

function fail(code) {
  throw Object.assign(new TypeError(code), { code });
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype);
}

function exactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function assertJson(value, depth = 0, budget = { values: 0 }) {
  budget.values += 1;
  if (depth > 24 || budget.values > 600_000) fail('H2_REQUEST_JSON_INVALID');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('H2_REQUEST_NUMBER_INVALID');
    return;
  }
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) fail('H2_REQUEST_JSON_INVALID');
    value.forEach((item) => assertJson(item, depth + 1, budget));
    return;
  }
  if (!isRecord(value)) fail('H2_REQUEST_JSON_INVALID');
  Object.values(value).forEach((item) => assertJson(item, depth + 1, budget));
}

function canonicalH2Value(value) {
  if (Array.isArray(value)) return value.map(canonicalH2Value);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalH2Value(value[key])]));
}

function stableH2Json(value) {
  assertJson(value);
  const serialized = JSON.stringify(canonicalH2Value(value));
  if (new TextEncoder().encode(serialized).byteLength > H2_LOCAL_PYTHON_LIMITS.requestBytes) fail('H2_REQUEST_TOO_LARGE');
  return serialized;
}

const equalH2Json = (left, right) => stableH2Json(left) === stableH2Json(right);

function assertExact(value, keys, code) {
  if (!exactKeys(value, keys)) fail(code);
}

function assertId(value, max = 128) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f]/.test(value)) fail('H2_REQUEST_ID_INVALID');
}

function normalizeParameters(manifest, value) {
  if (!isRecord(value)) fail('H2_GRAPH_PARAMETERS_INVALID');
  const allowed = new Set(manifest.properties.map((property) => property.key));
  if (Object.keys(value).some((key) => !allowed.has(key))) fail('H2_GRAPH_PARAMETER_UNREGISTERED');
  const normalized = { ...defaults(manifest), ...value };
  for (const property of manifest.properties) {
    const current = normalized[property.key];
    if (property.type === 'number' || property.type === 'slider') {
      if (!Number.isFinite(current) || current < property.min || current > property.max) fail('H2_GRAPH_PARAMETER_INVALID');
    } else if (property.type === 'boolean') {
      if (typeof current !== 'boolean') fail('H2_GRAPH_PARAMETER_INVALID');
    } else if (property.type === 'select') {
      if (!property.options.includes(current)) fail('H2_GRAPH_PARAMETER_INVALID');
    } else if (property.type === 'text') {
      if (typeof current !== 'string' || current.length > 128) fail('H2_GRAPH_PARAMETER_INVALID');
    } else fail('H2_GRAPH_PARAMETER_TYPE_UNSUPPORTED');
  }
  return normalized;
}

function componentSemantics(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    id: manifest.id,
    op: manifest.op,
    kind: manifest.kind,
    inputs: manifest.inputs,
    outputs: manifest.outputs,
    properties: manifest.properties.map(({ label: _label, ...property }) => property),
    runtime: manifest.runtime,
    compatibility: manifest.compatibility,
    composition: null,
  };
}

async function registryFingerprint() {
  const semantics = [...pluginRegistry]
    .filter((manifest) => ALLOWED_OPS.has(manifest.op))
    .map(componentSemantics)
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return sha256Utf8(stableH2Json(semantics));
}

function normalizedGraph(graph) {
  assertExact(graph, GRAPH_KEYS, 'H2_GRAPH_SCHEMA_INVALID');
  if (graph.schemaVersion !== 'volk.h2.graph.v1' || !Array.isArray(graph.nodes) || graph.nodes.length < 2
    || graph.nodes.length > H2_LOCAL_PYTHON_LIMITS.nodes || !Array.isArray(graph.edges)
    || graph.edges.length < 1 || graph.edges.length > H2_LOCAL_PYTHON_LIMITS.edges) fail('H2_GRAPH_SCHEMA_INVALID');
  const ids = new Set();
  const nodes = graph.nodes.map((node) => {
    assertExact(node, GRAPH_NODE_KEYS, 'H2_GRAPH_NODE_SCHEMA_INVALID');
    assertId(node.nodeId);
    if (ids.has(node.nodeId)) fail('H2_GRAPH_NODE_ID_DUPLICATE');
    ids.add(node.nodeId);
    assertId(node.componentId);
    const manifest = componentById.get(node.componentId);
    if (!manifest || manifest.composition || !ALLOWED_OPS.has(manifest.op)) fail('H2_GRAPH_COMPONENT_UNSUPPORTED');
    return {
      projection: { nodeId: node.nodeId, componentId: manifest.id, parameters: normalizeParameters(manifest, node.parameters) },
      manifest,
    };
  });
  const nodeById = new Map(nodes.map((item) => [item.projection.nodeId, item]));
  const edgeIds = new Set();
  const targetSlots = new Set();
  const edges = graph.edges.map((edge) => {
    assertExact(edge, GRAPH_EDGE_KEYS, 'H2_GRAPH_EDGE_SCHEMA_INVALID');
    for (const key of GRAPH_EDGE_KEYS) assertId(edge[key]);
    if (edgeIds.has(edge.edgeId)) fail('H2_GRAPH_EDGE_ID_DUPLICATE');
    edgeIds.add(edge.edgeId);
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    if (!source || !target) fail('H2_GRAPH_EDGE_ENDPOINT_INVALID');
    const output = source.manifest.outputs.find((port) => port.name === edge.sourcePort);
    const input = target.manifest.inputs.find((port) => port.name === edge.targetPort);
    if (!output || !input || output.type !== input.type) fail('H2_GRAPH_PORT_INVALID');
    const slot = `${edge.targetNodeId}\0${edge.targetPort}`;
    if (targetSlots.has(slot)) fail('H2_GRAPH_INPUT_MULTIPLE');
    targetSlots.add(slot);
    return { edgeId: edge.edgeId, sourceNodeId: edge.sourceNodeId, sourcePort: edge.sourcePort, targetNodeId: edge.targetNodeId, targetPort: edge.targetPort };
  });
  for (const { projection, manifest } of nodes) {
    for (const input of manifest.inputs) {
      if (manifest.op === 'train_test_split') continue;
      if (!targetSlots.has(`${projection.nodeId}\0${input.name}`)) fail('H2_GRAPH_INPUT_MISSING');
    }
  }
  return {
    projection: { schemaVersion: 'volk.h2.graph.v1', nodes: nodes.map((item) => item.projection), edges },
    nodes,
    edges,
  };
}

function lcgIndices(length, ratio) {
  let state = 2026 >>> 0;
  const indices = Array.from({ length }, (_, index) => index);
  for (let index = length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const target = state % (index + 1);
    [indices[index], indices[target]] = [indices[target], indices[index]];
  }
  const cut = Math.max(1, Math.min(length - 1, Math.floor(length * ratio)));
  return { trainIndices: indices.slice(0, cut), testIndices: indices.slice(cut) };
}

function graphFacts(graph, dataset) {
  const byId = new Map(graph.nodes.map((item) => [item.projection.nodeId, item]));
  const incoming = new Map(graph.nodes.map(({ projection }) => [projection.nodeId, []]));
  graph.edges.forEach((edge) => incoming.get(edge.targetNodeId).push(edge));
  const trainer = graph.nodes.find(({ manifest }) => manifest.op === 'supervised_trainer');
  const splitNode = graph.nodes.find(({ manifest }) => manifest.op === 'train_test_split');
  const loss = graph.nodes.find(({ manifest }) => manifest.kind === 'loss');
  const optimizer = graph.nodes.find(({ manifest }) => manifest.kind === 'optimizer');
  if (!trainer || !splitNode || !loss || !optimizer
    || graph.nodes.filter(({ manifest }) => manifest.op === 'supervised_trainer').length !== 1
    || graph.nodes.filter(({ manifest }) => manifest.op === 'train_test_split').length !== 1
    || graph.nodes.filter(({ manifest }) => manifest.kind === 'loss').length !== 1
    || graph.nodes.filter(({ manifest }) => manifest.kind === 'optimizer').length !== 1) fail('H2_GRAPH_TOPOLOGY_INVALID');
  const trainerInputs = incoming.get(trainer.projection.nodeId);
  const trainerPort = (port) => trainerInputs.find((edge) => edge.targetPort === port);
  const trainerEdges = ['dataset', 'model', 'loss', 'optimizer'].map(trainerPort);
  if (trainerEdges.some((edge) => !edge)) fail('H2_GRAPH_TRAINER_INPUTS_INVALID');
  if (byId.get(trainerEdges[0].sourceNodeId)?.manifest.op !== 'train_test_split'
    || trainerEdges[0].sourceNodeId !== splitNode.projection.nodeId
    || byId.get(trainerEdges[1].sourceNodeId)?.manifest.op !== 'model_output'
    || trainerEdges[2].sourceNodeId !== loss.projection.nodeId
    || trainerEdges[3].sourceNodeId !== optimizer.projection.nodeId) fail('H2_GRAPH_TRAINER_INPUTS_INVALID');
  if (!dataset || !Array.isArray(dataset.featureNames) || dataset.featureNames.length < 1
    || dataset.featureNames.length > H2_LOCAL_PYTHON_LIMITS.features) fail('H2_DATASET_SCHEMA_INVALID');
  const inputNodes = graph.nodes.filter(({ manifest }) => manifest.op === 'tensor_input');
  const outputNodes = graph.nodes.filter(({ manifest }) => manifest.op === 'model_output');
  if (inputNodes.length !== 1 || outputNodes.length !== 1) fail('H2_GRAPH_ARCHITECTURE_INVALID');
  const input = inputNodes[0];
  const output = outputNodes[0];
  const architecture = [];
  let cursor = output.projection.nodeId;
  const seen = new Set();
  while (cursor !== input.projection.nodeId) {
    if (seen.has(cursor)) fail('H2_GRAPH_CYCLE');
    seen.add(cursor);
    const edges = incoming.get(cursor);
    if (!edges || edges.length !== 1) fail('H2_GRAPH_ARCHITECTURE_INVALID');
    const current = byId.get(cursor);
    if (!current) fail('H2_GRAPH_ARCHITECTURE_INVALID');
    architecture.unshift(current);
    cursor = edges[0].sourceNodeId;
  }
  const layers = architecture.filter((item) => item.manifest.kind === 'layer');
  if (!layers.length || layers.some((item) => !['dense', 'relu', 'sigmoid', 'tanh', 'softmax', 'dropout'].includes(item.manifest.op))) {
    fail('H2_GRAPH_OPERATION_UNSUPPORTED');
  }
  const softmaxNodes = architecture.filter((item) => item.manifest.op === 'softmax');
  if (softmaxNodes.length > 1 || (softmaxNodes.length === 1 && softmaxNodes[0] !== architecture.at(-2))) {
    fail('H2_GRAPH_SOFTMAX_POSITION_INVALID');
  }
  const denseNodes = architecture.filter((item) => item.manifest.op === 'dense');
  if (denseNodes.length < 1 || denseNodes.length > H2_LOCAL_PYTHON_LIMITS.hiddenLayers + 1) fail('H2_GRAPH_LAYER_LIMIT');
  const declaredInputWidth = input.projection.parameters.shape;
  if (typeof declaredInputWidth !== 'string' || !/^[1-9][0-9]*$/.test(declaredInputWidth)
    || Number(declaredInputWidth) !== dataset.featureNames.length) fail('H2_GRAPH_INPUT_SHAPE_INVALID');
  let expectedInputFeatures = dataset.featureNames.length;
  for (let denseIndex = 0; denseIndex < denseNodes.length; denseIndex += 1) {
    const dense = denseNodes[denseIndex];
    const { input_features: inputFeatures, units } = dense.projection.parameters;
    const maxInputFeatures = denseIndex === 0 ? H2_LOCAL_PYTHON_LIMITS.features : H2_LOCAL_PYTHON_LIMITS.hiddenWidth;
    if (!Number.isInteger(inputFeatures) || inputFeatures < 1 || inputFeatures > maxInputFeatures
      || !Number.isInteger(units) || units < 1 || units > H2_LOCAL_PYTHON_LIMITS.hiddenWidth) fail('H2_GRAPH_LAYER_DIMENSION_INVALID');
    if (inputFeatures !== expectedInputFeatures) fail('H2_GRAPH_LAYER_DIMENSION_MISMATCH');
    expectedInputFeatures = units;
  }
  const hiddenDense = denseNodes.slice(0, -1);
  if (hiddenDense.some((item) => item.projection.parameters.units > H2_LOCAL_PYTHON_LIMITS.hiddenWidth)) fail('H2_GRAPH_WIDTH_LIMIT');
  const actualDenseParameters = denseNodes.reduce((sum, item) => sum
    + item.projection.parameters.input_features * item.projection.parameters.units
    + (item.projection.parameters.use_bias ? item.projection.parameters.units : 0), 0);
  if (actualDenseParameters > H2_LOCAL_PYTHON_LIMITS.parameters) fail('H2_GRAPH_PARAMETER_LIMIT');
  if (input.projection.parameters.dtype !== 'float32') fail('H2_GRAPH_INPUT_SHAPE_INVALID');
  const expectedOps = new Set([...layers.map((item) => item.manifest.op), 'tensor_input', 'model_output', 'train_test_split', 'supervised_trainer', loss.manifest.op, optimizer.manifest.op]);
  if (graph.nodes.some(({ manifest }) => !expectedOps.has(manifest.op))) fail('H2_GRAPH_OPERATION_UNSUPPORTED');
  const splitRatio = splitNode.projection.parameters.train_ratio;
  const training = trainer.projection.parameters;
  if (!Number.isInteger(training.epochs) || training.epochs < 1 || training.epochs > H2_LOCAL_PYTHON_LIMITS.epochs
    || !Number.isInteger(training.batch_size) || training.batch_size < 1 || training.batch_size > H2_LOCAL_PYTHON_LIMITS.batchSize
    || typeof training.shuffle !== 'boolean') fail('H2_TRAINING_CONFIG_INVALID');
  if (dataset.task === 'classification') {
    if (loss.manifest.op !== 'cross_entropy_loss' || dataset.classLabels.length < 2 || dataset.classLabels.length > 32
      || denseNodes.at(-1).projection.parameters.units !== dataset.classLabels.length) fail('H2_TASK_LOSS_INVALID');
  } else if (dataset.task === 'regression') {
    if (loss.manifest.op !== 'mse_loss' || denseNodes.at(-1).projection.parameters.units !== 1
      || architecture.some((item) => item.manifest.op === 'softmax')) fail('H2_TASK_LOSS_INVALID');
  } else fail('H2_DATASET_TASK_INVALID');
  if (architecture.at(-1)?.manifest.op === 'softmax' && dataset.task !== 'classification') fail('H2_GRAPH_OUTPUT_INVALID');
  if (optimizer.manifest.op === 'adam_optimizer' && !Number.isFinite(optimizer.projection.parameters.learning_rate)) fail('H2_OPTIMIZER_INVALID');
  return { trainer, splitNode, loss, optimizer, input, output, architecture, denseNodes, trainRatio: splitRatio, training };
}

function normalizeDataset(dataset) {
  assertExact(dataset, DATASET_KEYS, 'H2_DATASET_SCHEMA_INVALID');
  if (!Array.isArray(dataset.featureNames) || dataset.featureNames.length < 1 || dataset.featureNames.length > H2_LOCAL_PYTHON_LIMITS.features
    || new Set(dataset.featureNames).size !== dataset.featureNames.length
    || dataset.featureNames.some((name) => typeof name !== 'string' || !name || name.length > 128)
    || typeof dataset.targetName !== 'string' || !dataset.targetName || dataset.targetName.length > 128
    || !['classification', 'regression'].includes(dataset.task)
    || !Array.isArray(dataset.classLabels) || dataset.classLabels.length > 32
    || dataset.classLabels.some((label) => !Number.isInteger(label) || label < 0 || label > 31)
    || new Set(dataset.classLabels).size !== dataset.classLabels.length
    || !Array.isArray(dataset.classVocabulary) || dataset.classVocabulary.length > 32
    || dataset.classVocabulary.some((value) => !(typeof value === 'string' && value.trim().length > 0 && value.length <= 128)
      && !(typeof value === 'number' && Number.isFinite(value)))
    || new Set(dataset.classVocabulary.map((value) => stableH2Json(value))).size !== dataset.classVocabulary.length
    || !Array.isArray(dataset.rows) || dataset.rows.length < 2 || dataset.rows.length > H2_LOCAL_PYTHON_LIMITS.rows) fail('H2_DATASET_SCHEMA_INVALID');
  if (dataset.task === 'classification' && (dataset.classLabels.length < 2
    || dataset.classLabels.some((label, index) => label !== index)
    || dataset.classVocabulary.length !== dataset.classLabels.length)) fail('H2_DATASET_CLASS_LABELS_INVALID');
  if (dataset.task === 'regression' && (dataset.classLabels.length !== 0 || dataset.classVocabulary.length !== 0)) fail('H2_DATASET_CLASS_LABELS_INVALID');
  const rows = dataset.rows.map((row) => {
    assertExact(row, ROW_KEYS, 'H2_DATASET_ROW_INVALID');
    if (!Array.isArray(row.features) || row.features.length !== dataset.featureNames.length) fail('H2_DATASET_ROW_INVALID');
    if (row.features.some((value) => typeof value !== 'number' || !Number.isFinite(value))
      || typeof row.target !== 'number' || !Number.isFinite(row.target)) fail('H2_DATASET_NUMERIC_VALUE_INVALID');
    if (dataset.task === 'classification' && (!Number.isInteger(row.target) || row.target < 0 || row.target >= dataset.classLabels.length)) fail('H2_DATASET_TARGET_INVALID');
    return { features: row.features, target: row.target };
  });
  return {
    featureNames: dataset.featureNames,
    targetName: dataset.targetName,
    task: dataset.task,
    classLabels: dataset.classLabels,
    classVocabulary: dataset.classVocabulary,
    rows,
  };
}

function numericDatasetValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  fail('H2_DATASET_NUMERIC_VALUE_INVALID');
}

function categoricalDatasetValue(value) {
  if (typeof value === 'string' && value.trim().length > 0 && value.length <= 128) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  fail('H2_DATASET_CLASS_VALUE_INVALID');
}

function categoryKey(value) {
  return stableH2Json(value);
}

function targetSemantics(dataset) {
  return {
    task: dataset.task,
    targetName: dataset.targetName,
    classMapping: dataset.classVocabulary.map((sourceValue, classIndex) => ({ sourceValue, classIndex })),
  };
}

function stripClaimedFingerprints(request) {
  const { authorization: _authorization, ...draft } = request;
  const { graphFingerprint: _graph, datasetFingerprint: _dataset, splitFingerprint: _split,
    registryFingerprint: _registry, normalizedRequestFingerprint: _request, ...identity } = draft.identity;
  return { ...draft, identity };
}

function makeSplit(rows, ratio) {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) fail('H2_SPLIT_RATIO_INVALID');
  const { trainIndices, testIndices } = lcgIndices(rows.length, ratio);
  return { algorithm: 'volk-lcg32-fisher-yates-v1', seed: 2026, trainRatio: ratio, trainIndices, testIndices };
}

function validateSplit(split, expected) {
  assertExact(split, SPLIT_KEYS, 'H2_SPLIT_SCHEMA_INVALID');
  if (split.algorithm !== expected.algorithm || split.seed !== 2026 || split.trainRatio !== expected.trainRatio
    || !equalH2Json(split.trainIndices, expected.trainIndices)
    || !equalH2Json(split.testIndices, expected.testIndices)) fail('H2_SPLIT_IDENTITY_INVALID');
}

function requestConfig(request) {
  return {
    task: request.dataset.task,
    classLabels: request.dataset.classLabels,
    classVocabulary: request.dataset.classVocabulary,
    split: request.split,
    training: request.training,
    profile: request.profile,
  };
}

function normalizedBody({ sessionId, identity, graph, dataset, split, training, profile }) {
  return { schemaVersion: H2_LOCAL_PYTHON_REQUEST_V2, sessionId, identity, graph, dataset, split, training, profile };
}

async function computeIdentity(body, normalizedGraphValue) {
  const registry = await registryFingerprint();
  const graphFingerprint = await sha256Utf8(stableH2Json(normalizedGraphValue));
  const datasetFingerprint = await sha256Utf8(stableH2Json(body.dataset));
  const splitFingerprint = await sha256Utf8(stableH2Json({
    datasetFingerprint, algorithm: body.split.algorithm, seed: body.split.seed, trainRatio: body.split.trainRatio,
    trainIndices: body.split.trainIndices, testIndices: body.split.testIndices,
  }));
  const provisionalIdentity = {
    projectId: body.sessionId,
    graphFingerprint,
    datasetFingerprint,
    splitFingerprint,
    registryFingerprint: registry,
    compilerVersion: H2_LOCAL_PYTHON_COMPILER_VERSION,
    normalizedRequestFingerprint: '',
  };
  const provisional = normalizedBody({ ...body, identity: provisionalIdentity });
  const normalizedRequestFingerprint = await sha256Utf8(stableH2Json(stripClaimedFingerprints(provisional)));
  return { ...provisionalIdentity, normalizedRequestFingerprint };
}

/** Builds only the strict semantic request; layout, selection, and runtime UI state are excluded. */
export async function projectH2LocalPythonRequestV2({ sessionId, nodes, edges, dataset } = {}) {
  assertId(sessionId);
  if (!Array.isArray(nodes) || !Array.isArray(edges) || !dataset) fail('H2_REQUEST_INPUT_INVALID');
  const graph = {
    schemaVersion: 'volk.h2.graph.v1',
    nodes: nodes.map((node) => ({
      nodeId: node.id,
      componentId: node.data?.manifest?.id,
      parameters: node.data?.parameters ?? {},
    })),
    edges: edges.map((edge) => ({
      edgeId: edge.id,
      sourceNodeId: edge.source,
      sourcePort: edge.sourceHandle,
      targetNodeId: edge.target,
      targetPort: edge.targetHandle,
    })),
  };
  const normalized = normalizedGraph(graph);
  const wireDataset = datasetForWire(dataset);
  const facts = graphFacts(normalized, wireDataset);
  if (wireDataset.rows.length < 2) fail('H2_DATASET_TOO_SMALL');
  const split = makeSplit(wireDataset.rows, facts.trainRatio);
  const training = { seed: 2026, epochs: facts.training.epochs, batchSize: facts.training.batch_size, shuffle: facts.training.shuffle };
  const bare = {
    schemaVersion: H2_LOCAL_PYTHON_REQUEST_V2,
    sessionId,
    identity: {},
    graph: normalized.projection,
    dataset: wireDataset,
    split,
    training,
    profile: H2_LOCAL_PYTHON_PROFILE_V1,
  };
  const identity = await computeIdentity(bare, normalized.projection);
  const request = { ...bare, identity };
  const bytes = new TextEncoder().encode(stableH2Json(request)).byteLength;
  if (bytes > H2_LOCAL_PYTHON_LIMITS.requestBytes) fail('H2_REQUEST_TOO_LARGE');
  return request;
}

function datasetForWire(dataset) {
  if (!dataset || !Array.isArray(dataset.featureColumns) || !Array.isArray(dataset.rows)) fail('H2_DATASET_SCHEMA_INVALID');
  const featureNames = dataset.featureColumns;
  const rawTargetValues = dataset.rows.map((row) => row?.[dataset.targetColumn]);
  let classLabels = [];
  let classVocabulary = [];
  let labelMap = null;
  if (dataset.task === 'classification') {
    const values = rawTargetValues.map(categoricalDatasetValue);
    classVocabulary = [...new Map(values.map((value) => [categoryKey(value), value])).entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([, value]) => value);
    if (classVocabulary.length < 2 || classVocabulary.length > 32) fail('H2_DATASET_CLASS_LABELS_INVALID');
    classLabels = classVocabulary.map((_, index) => index);
    labelMap = new Map(classVocabulary.map((value, index) => [categoryKey(value), index]));
  }
  const rows = dataset.rows.map((row) => {
    const features = featureNames.map((column) => numericDatasetValue(row?.[column]));
    const rawTarget = row?.[dataset.targetColumn];
    return {
      features,
      target: dataset.task === 'classification'
        ? labelMap.get(categoryKey(categoricalDatasetValue(rawTarget)))
        : numericDatasetValue(rawTarget),
    };
  });
  return normalizeDataset({ featureNames, targetName: dataset.targetColumn, task: dataset.task, classLabels, classVocabulary, rows });
}

export async function h2DatasetExecutionIdentityV1(dataset) {
  return `sha256:${await sha256Utf8(stableH2Json(datasetForWire(dataset)))}`;
}

/** Revalidates/recomputes the closed request at the companion trust boundary. */
export async function validateH2LocalPythonRequestV2(request, { requireAuthorization = true, compile = true } = {}) {
  assertJson(request);
  const requestByteLength = new TextEncoder().encode(stableH2Json(request)).byteLength;
  if (requestByteLength > H2_LOCAL_PYTHON_LIMITS.requestBytes) fail('H2_REQUEST_TOO_LARGE');
  const keys = requireAuthorization ? REQUEST_KEYS : REQUEST_DRAFT_KEYS;
  assertExact(request, keys, 'H2_REQUEST_SCHEMA_INVALID');
  if (request.schemaVersion !== H2_LOCAL_PYTHON_REQUEST_V2 || request.profile !== H2_LOCAL_PYTHON_PROFILE_V1) fail('H2_REQUEST_VERSION_UNSUPPORTED');
  assertId(request.sessionId);
  if (!exactKeys(request.identity, IDENTITY_KEYS)) fail('H2_IDENTITY_SCHEMA_INVALID');
  assertId(request.identity.projectId);
  const graph = normalizedGraph(request.graph);
  if (!equalH2Json(graph.projection, request.graph)) fail('H2_GRAPH_NOT_NORMALIZED');
  const dataset = normalizeDataset(request.dataset);
  const facts = graphFacts(graph, dataset);
  const expectedSplit = makeSplit(dataset.rows, facts.trainRatio);
  validateSplit(request.split, expectedSplit);
  assertExact(request.training, TRAINING_KEYS, 'H2_TRAINING_SCHEMA_INVALID');
  if (request.training.seed !== 2026 || request.training.epochs !== facts.training.epochs
    || request.training.batchSize !== facts.training.batch_size || request.training.shuffle !== facts.training.shuffle) fail('H2_TRAINING_CONFIG_INVALID');
  const bare = normalizedBody({ ...request, authorization: undefined });
  const recomputedIdentity = await computeIdentity(bare, graph.projection);
  if (!equalH2Json(request.identity, recomputedIdentity)) fail('H2_IDENTITY_MISMATCH');
  if (requireAuthorization) {
    assertExact(request.authorization, AUTHORIZATION_KEYS, 'H2_AUTHORIZATION_SCHEMA_INVALID');
    assertId(request.authorization.authorizationId);
    assertId(request.authorization.nonce);
    if (request.authorization.nonce.length < 16) fail('H2_AUTHORIZATION_INVALID');
    if (request.authorization.requestFingerprint !== recomputedIdentity.normalizedRequestFingerprint
      || !Number.isFinite(Date.parse(request.authorization.expiresAt))) fail('H2_AUTHORIZATION_INVALID');
  }
  const runtimeNodes = graph.nodes.map(({ projection, manifest }) => ({
    id: projection.nodeId,
    position: { x: 0, y: 0 },
    data: { manifest, parameters: projection.parameters },
  }));
  const runtimeEdges = graph.edges.map((edge) => ({
    id: edge.edgeId, source: edge.sourceNodeId, sourceHandle: edge.sourcePort,
    target: edge.targetNodeId, targetHandle: edge.targetPort,
  }));
  const ir = graphToIR(runtimeNodes, runtimeEdges);
  const trainIndices = request.split.trainIndices;
  const compiled = compile ? compilePipelineToPyTorch(runtimeNodes, runtimeEdges, {
    trainingProfile: 'h2-local-python-v1',
    trainIndices,
  }) : { code: null, ir };
  if (compiled.ir.nodes.length !== ir.nodes.length) fail('H2_COMPILER_GRAPH_MISMATCH');
  return {
    request: { ...request, dataset, graph: graph.projection },
    identity: recomputedIdentity,
    runtimeNodes,
    runtimeEdges,
    ir: compiled.ir,
    source: compiled.code,
    denseNodes: facts.denseNodes.map((item) => ({ nodeId: item.projection.nodeId, parameters: item.projection.parameters })),
    facts,
    configFingerprint: await sha256Utf8(stableH2Json(requestConfig(request))),
  };
}

function validateIsoDateTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && value.includes('T');
}

/** Strictly validates the bounded success result before it can enter Build model state. */
export function validateH2LocalPythonResultV2(result, validated) {
  const resultKeys = ['schemaVersion', 'status', 'runIdentity', 'parameters', 'epochLoss', 'metrics', 'provenance', 'lifecycle'];
  const runKeys = ['runId', 'sessionId', 'requestFingerprint', 'graphFingerprint', 'datasetFingerprint', 'splitFingerprint', 'configFingerprint', 'targetSemantics'];
  const parameterKeys = ['encoding', 'byteOrder', 'payloadBase64', 'tensors'];
  const provenanceKeys = ['provider', 'pythonVersion', 'pytorchVersion', 'numpyVersion', 'device', 'compilerVersion', 'profile', 'startedAt', 'finishedAt'];
  const lifecycleKeys = ['cancellationRequested', 'processTerminated', 'resultDiscarded'];
  assertExact(result, resultKeys, 'H2_RESULT_SCHEMA_INVALID');
  if (result.schemaVersion !== H2_LOCAL_PYTHON_RESULT_V2 || result.status !== 'succeeded') fail('H2_RESULT_VERSION_UNSUPPORTED');
  assertExact(result.runIdentity, runKeys, 'H2_RESULT_IDENTITY_INVALID');
  assertId(result.runIdentity.runId);
  const identity = validated.identity;
  if (result.runIdentity.sessionId !== validated.request.sessionId
    || result.runIdentity.requestFingerprint !== identity.normalizedRequestFingerprint
    || result.runIdentity.graphFingerprint !== identity.graphFingerprint
    || result.runIdentity.datasetFingerprint !== identity.datasetFingerprint
    || result.runIdentity.splitFingerprint !== identity.splitFingerprint
    || result.runIdentity.configFingerprint !== validated.configFingerprint
    || !equalH2Json(result.runIdentity.targetSemantics, targetSemantics(validated.request.dataset))) fail('H2_RESULT_IDENTITY_MISMATCH');
  assertExact(result.parameters, parameterKeys, 'H2_RESULT_PARAMETERS_INVALID');
  if (result.parameters.encoding !== 'volk.tensor-manifest.v1' || result.parameters.byteOrder !== 'little-endian'
    || typeof result.parameters.payloadBase64 !== 'string' || result.parameters.payloadBase64.length > 45_000
    || !Array.isArray(result.parameters.tensors) || result.parameters.tensors.length < 1 || result.parameters.tensors.length > 32) fail('H2_RESULT_PARAMETERS_INVALID');
  const expectedTensors = [];
  validated.denseNodes.forEach((node, index) => {
    const { input_features: inputFeatures, units, use_bias: useBias } = node.parameters;
    expectedTensors.push({ name: `layers.${index}.weight`, shape: [units, inputFeatures], length: units * inputFeatures * 4 });
    if (useBias) expectedTensors.push({ name: `layers.${index}.bias`, shape: [units], length: units * 4 });
  });
  if (expectedTensors.length !== result.parameters.tensors.length) fail('H2_RESULT_TENSOR_SET_INVALID');
  let offset = 0;
  result.parameters.tensors.forEach((tensor, index) => {
    const expected = expectedTensors[index];
    assertExact(tensor, ['name', 'dtype', 'shape', 'offset', 'length'], 'H2_RESULT_TENSOR_INVALID');
    if (tensor.name !== expected.name || tensor.dtype !== 'float32-le'
      || !equalH2Json(tensor.shape, expected.shape)
      || tensor.offset !== offset || tensor.length !== expected.length) fail('H2_RESULT_TENSOR_INVALID');
    offset += tensor.length;
  });
  if (offset > 32_768 || result.parameters.tensors.some((tensor) => tensor.length % 4 !== 0)) fail('H2_RESULT_TENSOR_INVALID');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.parameters.payloadBase64)) fail('H2_RESULT_BASE64_INVALID');
  const bytes = Uint8Array.from(atob(result.parameters.payloadBase64), (character) => character.charCodeAt(0));
  if (btoa(String.fromCharCode(...bytes)) !== result.parameters.payloadBase64 || bytes.byteLength !== offset) fail('H2_RESULT_BASE64_INVALID');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let position = 0; position < bytes.byteLength; position += 4) {
    if (!Number.isFinite(view.getFloat32(position, true))) fail('H2_RESULT_TENSOR_NON_FINITE');
  }
  if (!Array.isArray(result.epochLoss) || result.epochLoss.length !== validated.request.training.epochs
    || result.epochLoss.some((loss) => !Number.isFinite(loss))) fail('H2_RESULT_LOSS_INVALID');
  const metrics = result.metrics;
  if (!isRecord(metrics) || metrics.task !== validated.request.dataset.task
    || !Number.isInteger(metrics.heldOutRows) || metrics.heldOutRows !== validated.request.split.testIndices.length) fail('H2_RESULT_METRICS_INVALID');
  if (metrics.task === 'classification') {
    assertExact(metrics, ['task', 'heldOutRows', 'accuracy', 'macroF1'], 'H2_RESULT_METRICS_INVALID');
    if (![metrics.accuracy, metrics.macroF1].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) fail('H2_RESULT_METRICS_INVALID');
  } else {
    assertExact(metrics, ['task', 'heldOutRows', 'rmse', 'r2'], 'H2_RESULT_METRICS_INVALID');
    if (!Number.isFinite(metrics.rmse) || metrics.rmse < 0
      || !(Number.isFinite(metrics.r2) || (exactKeys(metrics.r2, ['status', 'reason'])
        && metrics.r2.status === 'unavailable' && metrics.r2.reason === 'zero-total-variance'))) fail('H2_RESULT_METRICS_INVALID');
  }
  assertExact(result.provenance, provenanceKeys, 'H2_RESULT_PROVENANCE_INVALID');
  if (result.provenance.provider !== 'local-python' || result.provenance.pythonVersion !== '3.12.10'
    || result.provenance.pytorchVersion !== '2.14.0+cpu' || result.provenance.numpyVersion !== '2.5.3'
    || result.provenance.device !== 'cpu' || result.provenance.compilerVersion !== H2_LOCAL_PYTHON_COMPILER_VERSION
    || result.provenance.profile !== H2_LOCAL_PYTHON_PROFILE_V1
    || !validateIsoDateTime(result.provenance.startedAt) || !validateIsoDateTime(result.provenance.finishedAt)
    || Date.parse(result.provenance.finishedAt) < Date.parse(result.provenance.startedAt)) fail('H2_RESULT_PROVENANCE_INVALID');
  assertExact(result.lifecycle, lifecycleKeys, 'H2_RESULT_LIFECYCLE_INVALID');
  if (Object.values(result.lifecycle).some((value) => typeof value !== 'boolean')
    || result.lifecycle.cancellationRequested || result.lifecycle.resultDiscarded
    || !result.lifecycle.processTerminated) fail('H2_RESULT_LIFECYCLE_INVALID');
  const resultBytes = new TextEncoder().encode(stableH2Json(result)).byteLength;
  if (resultBytes > H2_LOCAL_PYTHON_LIMITS.responseBytes) fail('H2_RESULT_TOO_LARGE');
  return true;
}

/** Adds the one-use authorization envelope issued by the local coordinator. */
export function attachH2LocalPythonAuthorizationV1(request, authorization) {
  if (!isRecord(request) || !isRecord(authorization)) fail('H2_AUTHORIZATION_INVALID');
  return { ...request, authorization };
}

/** Converts a validated fitted tensor manifest to the app's existing serializable MLP model shape. */
export function h2ResultToBrowserMlpV1({ validated, result, dataset, trainedAt = new Date().toISOString() } = {}) {
  if (!validated || !result || result.schemaVersion !== H2_LOCAL_PYTHON_RESULT_V2
    || result.status !== 'succeeded' || !dataset) fail('H2_RESULT_INVALID');
  const descriptors = result.parameters?.tensors;
  const base64 = result.parameters?.payloadBase64;
  if (!Array.isArray(descriptors) || typeof base64 !== 'string') fail('H2_RESULT_PARAMETERS_INVALID');
  const raw = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let expectedOffset = 0;
  const tensors = new Map();
  descriptors.forEach((descriptor) => {
    if (descriptor.dtype !== 'float32-le' || descriptor.offset !== expectedOffset || descriptor.length % 4 !== 0
      || descriptor.offset + descriptor.length > raw.length) fail('H2_RESULT_PARAMETERS_INVALID');
    const values = Array.from({ length: descriptor.length / 4 }, (_, index) => view.getFloat32(descriptor.offset + index * 4, true));
    if (values.some((value) => !Number.isFinite(value))) fail('H2_RESULT_PARAMETERS_INVALID');
    tensors.set(descriptor.name, { descriptor, values });
    expectedOffset += descriptor.length;
  });
  if (expectedOffset !== raw.length) fail('H2_RESULT_PARAMETERS_INVALID');
  const layers = [];
  const chain = validated.facts.architecture;
  for (const item of chain) {
    const { op } = item.manifest;
    if (op !== 'model_output' && op !== 'tensor_input') {
      if (op === 'dense') {
        const denseIndex = layers.filter((layer) => layer.op === 'dense').length;
        const parameters = item.projection.parameters;
        const weight = tensors.get(`layers.${denseIndex}.weight`);
        const bias = tensors.get(`layers.${denseIndex}.bias`);
        if (!weight || weight.descriptor.shape[0] !== parameters.units || weight.descriptor.shape[1] !== parameters.input_features
          || weight.values.length !== parameters.units * parameters.input_features) fail('H2_RESULT_PARAMETERS_INVALID');
        const weights = Array.from({ length: parameters.units }, (_, row) => weight.values.slice(row * parameters.input_features, (row + 1) * parameters.input_features));
        const biasValues = parameters.use_bias ? bias?.values : Array.from({ length: parameters.units }, () => 0);
        if (!biasValues || biasValues.length !== parameters.units) fail('H2_RESULT_PARAMETERS_INVALID');
        layers.push({ op, ...parameters, weights, bias: biasValues });
      } else layers.push({ op, ...item.projection.parameters });
    }
  }
  const trainer = validated.facts.trainer;
  const labels = dataset.task === 'classification' ? [...validated.request.dataset.classVocabulary] : [];
  const test = validated.request.split.testIndices.map((index) => ({
    index,
    x: dataset.featureColumns.map((column) => Number(dataset.rows[index][column])),
    y: dataset.rows[index][dataset.targetColumn],
  }));
  return {
    type: 'browser_mlp', sourceNodeId: trainer.projection.nodeId,
    modelNodeId: validated.facts.output.projection.nodeId,
    featureColumns: [...dataset.featureColumns], targetColumn: dataset.targetColumn,
    layers, normalization: { means: dataset.featureColumns.map(() => 0), stds: dataset.featureColumns.map(() => 1) },
    labels, task: dataset.task, test, trainRows: validated.request.split.trainIndices.length,
    testRows: test.length, metrics: result.metrics, lossHistory: result.epochLoss,
    epochs: validated.request.training.epochs,
    learningRate: validated.facts.optimizer.projection.parameters.learning_rate,
    trainedAt, hasPredictor: false,
    trainingSummary: {
      provider: 'local-python',
      profile: H2_LOCAL_PYTHON_PROFILE_V1,
      finalTrainingLoss: result.epochLoss.at(-1),
    },
  };
}
