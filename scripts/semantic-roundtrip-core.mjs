import { componentById, defaults } from '../src/core/components.js';

export const SEMANTIC_ROUNDTRIP_VERSION = 1;

const MAX_NODES = 64;
const MAX_EDGES = 128;
const B2_OPERATIONS = new Set([
  'tensor_input', 'dense', 'relu', 'sigmoid', 'tanh', 'softmax', 'model_output',
]);
const TORCH_TARGET_TO_OPERATION = Object.freeze({
  'aten.linear.default': 'dense',
  'aten.relu.default': 'relu',
  'aten.sigmoid.default': 'sigmoid',
  'aten.tanh.default': 'tanh',
  'aten.softmax.int': 'softmax',
});

export class SemanticRoundTripError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SemanticRoundTripError';
    this.code = code;
  }
}

function fail(code) {
  throw new SemanticRoundTripError(code);
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function finiteParameters(node) {
  const manifest = node?.data?.manifest;
  const component = manifest && componentById.get(manifest.id);
  if (!manifest || !component || component.op !== manifest.op) fail('E3_COMPONENT_UNREGISTERED');
  const base = defaults(component);
  const values = node.data?.parameters;
  if (!isRecord(values)) fail('E3_PARAMETERS_INVALID');
  return { ...base, ...values };
}

function parseFeatureShape(value) {
  if (typeof value !== 'string' || !value.trim()) fail('E3_FEATURE_SHAPE_UNOBSERVED');
  const dimensions = value.split(',').map((part) => part.trim());
  if (dimensions.some((part) => !/^\d+$/.test(part))) fail('E3_FEATURE_SHAPE_UNSUPPORTED');
  const shape = dimensions.map(Number);
  if (!shape.length || shape.some((dimension) => !Number.isSafeInteger(dimension) || dimension < 1 || dimension > 1_000_000)) {
    fail('E3_FEATURE_SHAPE_UNSUPPORTED');
  }
  return shape;
}

function normalizedParameters(node, rank) {
  const operation = node.data.manifest.op;
  const parameters = finiteParameters(node);
  if (operation === 'tensor_input') {
    if (!['float16', 'float32'].includes(parameters.dtype)) fail('E3_DTYPE_UNSUPPORTED');
    return { featureShape: parseFeatureShape(parameters.shape), dtype: parameters.dtype };
  }
  if (operation === 'dense') {
    if (!Number.isSafeInteger(parameters.input_features) || parameters.input_features < 1
      || !Number.isSafeInteger(parameters.units) || parameters.units < 1 || typeof parameters.use_bias !== 'boolean') {
      fail('E3_CONSTRUCTOR_PARAMETERS_UNOBSERVED');
    }
    return {
      input_features: parameters.input_features,
      units: parameters.units,
      use_bias: parameters.use_bias,
    };
  }
  if (operation === 'softmax') {
    const axis = parameters.axis;
    return { axis: rank === 2 && (axis === 1 || axis === -1) ? 'last-feature-axis' : axis };
  }
  if (['relu', 'sigmoid', 'tanh', 'model_output'].includes(operation)) return {};
  // Preserve unknown semantics so an unknown node can never disappear from comparison.
  return parameters;
}

function normalizedGraph(graph) {
  if (!isRecord(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) fail('E3_GRAPH_INVALID');
  if (graph.nodes.length > MAX_NODES || graph.edges.length > MAX_EDGES) fail('E3_GRAPH_BOUND');
  const nodeById = new Map();
  graph.nodes.forEach((node) => {
    if (!node || typeof node.id !== 'string' || !node.id || nodeById.has(node.id)) fail('E3_NODE_ID_INVALID');
    if (!node.data?.manifest || typeof node.data.manifest.id !== 'string' || typeof node.data.manifest.op !== 'string') {
      fail('E3_COMPONENT_UNREGISTERED');
    }
    nodeById.set(node.id, node);
  });

  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));
  const edgeKeys = new Set();
  const validatedEdges = graph.edges.map((edge) => {
    if (!edge || !nodeById.has(edge.source) || !nodeById.has(edge.target)
      || typeof edge.sourceHandle !== 'string' || typeof edge.targetHandle !== 'string') fail('E3_EDGE_ENDPOINT_INVALID');
    const key = `${edge.source}\0${edge.sourceHandle}\0${edge.target}\0${edge.targetHandle}`;
    if (edgeKeys.has(key)) fail('E3_EDGE_DUPLICATE');
    edgeKeys.add(key);
    const sourceManifest = nodeById.get(edge.source).data.manifest;
    const targetManifest = nodeById.get(edge.target).data.manifest;
    const sourcePort = sourceManifest.outputs?.find((port) => port.name === edge.sourceHandle);
    const targetPort = targetManifest.inputs?.find((port) => port.name === edge.targetHandle);
    if (!sourcePort || !targetPort || sourcePort.type !== targetPort.type) fail('E3_TYPED_PORT_INVALID');
    indegree.set(edge.target, indegree.get(edge.target) + 1);
    outgoing.get(edge.source).push(edge);
    return {
      sourceId: edge.source,
      sourceHandle: edge.sourceHandle,
      targetId: edge.target,
      targetHandle: edge.targetHandle,
    };
  });

  const ready = graph.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const orderedIds = [];
  while (ready.length) {
    const id = ready.shift();
    orderedIds.push(id);
    for (const edge of outgoing.get(id)) {
      const next = indegree.get(edge.target) - 1;
      indegree.set(edge.target, next);
      if (next === 0) ready.push(edge.target);
    }
  }
  if (orderedIds.length !== graph.nodes.length) fail('E3_GRAPH_CYCLE');

  const ordinalById = new Map(orderedIds.map((id, ordinal) => [id, ordinal]));
  const graphInput = graph.nodes.find((node) => node.data.manifest.op === 'tensor_input');
  const graphInputParameters = graphInput ? finiteParameters(graphInput) : null;
  const tensorRank = graphInputParameters ? parseFeatureShape(graphInputParameters.shape).length + 1 : null;
  const ordered = orderedIds.map((id, ordinal) => {
    const node = nodeById.get(id);
    const operation = node.data.manifest.op;
    return {
      ordinal,
      componentId: node.data.manifest.id,
      operation,
      parameters: normalizedParameters(node, tensorRank),
      incoming: validatedEdges.filter((edge) => edge.targetId === id).map((edge) => ({
        from: ordinalById.get(edge.sourceId),
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })).sort((left, right) => left.from - right.from
        || left.sourceHandle.localeCompare(right.sourceHandle)
        || left.targetHandle.localeCompare(right.targetHandle)),
      incomingCount: validatedEdges.filter((edge) => edge.targetId === id).length,
      outgoingCount: outgoing.get(id).length,
      sourceParameters: finiteParameters(node),
    };
  });
  const inputNodes = ordered.filter((node) => node.operation === 'tensor_input');
  const outputNodes = ordered.filter((node) => node.operation === 'model_output');
  const unsupportedOperations = ordered.filter((node) => !B2_OPERATIONS.has(node.operation))
    .map((node) => ({ ordinal: node.ordinal, operation: node.operation, componentId: node.componentId }));
  const structurallyB2Supported = inputNodes.length === 1 && outputNodes.length === 1
    && ordered[0]?.operation === 'tensor_input' && ordered.at(-1)?.operation === 'model_output'
    && ordered.every((node, index) => node.incomingCount === (index === 0 ? 0 : 1)
      && node.outgoingCount === (index === ordered.length - 1 ? 0 : 1))
    && ordered.some((node) => node.operation === 'dense')
    && unsupportedOperations.length === 0;

  const input = inputNodes[0];
  const dtype = input?.sourceParameters.dtype;
  const featureShape = input ? parseFeatureShape(input.sourceParameters.shape) : null;
  const shapeTrace = [];
  if (structurallyB2Supported) {
    if (featureShape.length !== 1) fail('E3_B2_FEATURE_RANK_UNSUPPORTED');
    let currentFeatures = [...featureShape];
    for (const node of ordered) {
      if (node.operation === 'dense') {
        const inputFeatures = node.sourceParameters.input_features;
        if (currentFeatures.at(-1) !== inputFeatures) fail('E3_DENSE_SHAPE_INCOMPATIBLE');
        currentFeatures = [...currentFeatures.slice(0, -1), node.sourceParameters.units];
      }
      shapeTrace.push({ operation: node.operation, rank: 2, featureShape: [...currentFeatures] });
    }
  }
  const topology = {
    inputArity: inputNodes.length,
    outputArity: outputNodes.length,
    nodes: ordered.map((node) => ({
      ordinal: node.ordinal,
      operation: node.operation,
      componentId: node.componentId,
      incoming: node.incoming,
    })),
    edges: validatedEdges.map((edge) => ({
      from: ordinalById.get(edge.sourceId),
      sourceHandle: edge.sourceHandle,
      to: ordinalById.get(edge.targetId),
      targetHandle: edge.targetHandle,
    })).sort((left, right) => left.from - right.from || left.to - right.to
      || left.sourceHandle.localeCompare(right.sourceHandle) || left.targetHandle.localeCompare(right.targetHandle)),
  };
  return {
    topology,
    operations: ordered.map(({ operation, componentId }) => ({ operation, componentId })),
    parameters: ordered.map(({ operation, parameters }) => ({ operation, parameters })),
    dtype,
    shapeTrace,
    batch: { representation: 'implicit-batch', graphBMetadata: 'not-carried' },
    unsupportedOperations,
    structurallyB2Supported,
  };
}

function metric(expected, actual) {
  return { status: same(expected, actual) ? 'match' : 'mismatch', expected, actual };
}

function invalidResult(code) {
  return {
    version: SEMANTIC_ROUNDTRIP_VERSION,
    status: 'unsupported',
    reason: code,
    metrics: {
      topology: { status: 'unobserved', reason: code },
      operations: { status: 'unobserved', reason: code },
      constructorParameters: { status: 'unobserved', reason: code },
      shapes: { status: 'unobserved', reason: code },
      dtype: { status: 'unobserved', reason: code },
    },
  };
}

/** ID- and layout-independent comparison for the bounded B2 chain only. */
export function compareSemanticGraphs(graphA, graphB) {
  let left;
  let right;
  try {
    left = normalizedGraph(graphA);
    right = normalizedGraph(graphB);
  } catch (error) {
    return invalidResult(error?.code ?? 'E3_GRAPH_INVALID');
  }
  if (left.unsupportedOperations.length || right.unsupportedOperations.length) {
    return {
      ...invalidResult('E3_OPERATION_UNSUPPORTED'),
      unsupported: {
        expected: left.unsupportedOperations,
        actual: right.unsupportedOperations,
      },
    };
  }
  if (!left.structurallyB2Supported || !right.structurallyB2Supported) {
    return {
      ...invalidResult('E3_TOPOLOGY_UNSUPPORTED'),
      metrics: {
        ...invalidResult('E3_TOPOLOGY_UNSUPPORTED').metrics,
        topology: metric(left.topology, right.topology),
      },
    };
  }
  const metrics = {
    topology: metric(left.topology, right.topology),
    operations: metric(left.operations, right.operations),
    constructorParameters: metric(left.parameters, right.parameters),
    shapes: metric(left.shapeTrace, right.shapeTrace),
    dtype: metric(left.dtype, right.dtype),
  };
  const status = Object.values(metrics).every((entry) => entry.status === 'match') ? 'structural-match' : 'mismatch';
  return { version: SEMANTIC_ROUNDTRIP_VERSION, status, metrics, losses: ['batch_extent_and_range_not_carried', 'trained_parameter_values_not_carried'] };
}

function documentShapeTrace(document) {
  const inputs = document?.graph?.inputs?.filter((input) => input.kind === 'USER_INPUT') ?? [];
  const outputs = document?.graph?.outputs ?? [];
  if (inputs.length !== 1 || outputs.length !== 1) fail('E3_DOCUMENT_ARITY_UNSUPPORTED');
  const shape = (spec) => {
    if (!Array.isArray(spec?.shape) || spec.shape.length !== 2) fail('E3_DOCUMENT_SHAPE_UNOBSERVED');
    const batchDimension = spec.shape[0];
    const featureDimension = spec.shape[1];
    if (!['static', 'symbol'].includes(batchDimension?.kind) || featureDimension?.kind !== 'static') fail('E3_DOCUMENT_SHAPE_UNSUPPORTED');
    return {
      rank: 2,
      featureShape: [featureDimension.value],
      dtype: spec.dtype,
      batch: batchDimension.kind === 'symbol' ? { kind: 'symbol', min: document.graph.rangeConstraints?.[0]?.min, max: document.graph.rangeConstraints?.[0]?.max }
        : { kind: 'static-example', value: batchDimension.value },
    };
  };
  return [
    { operation: 'tensor_input', ...shape(inputs[0].spec) },
    ...document.graph.nodes.map((node) => {
      const operation = TORCH_TARGET_TO_OPERATION[node.target];
      if (!operation) fail('E3_DOCUMENT_OPERATION_UNSUPPORTED');
      return { operation, ...shape(node.metadata) };
    }),
    { operation: 'model_output', ...shape(outputs[0].spec) },
  ];
}

/** Adds checks against real ExportedProgram facts and records known B2 losses. */
export function evaluateSemanticRoundTrip({ graphA, graphB, document, workerObservation }) {
  const semantic = compareSemanticGraphs(graphA, graphB);
  if (semantic.status !== 'structural-match') return semantic;
  if (!document || !workerObservation) {
    return { ...semantic, status: 'unverified', reason: 'E3_RUNTIME_OBSERVATION_MISSING' };
  }
  let left;
  let actualDocShapes;
  try {
    left = normalizedGraph(graphA);
    actualDocShapes = documentShapeTrace(document);
  } catch (error) {
    return { ...semantic, status: 'unsupported', reason: error?.code ?? 'E3_DOCUMENT_INVALID' };
  }
  const docOperations = document.graph.nodes.map((node) => TORCH_TARGET_TO_OPERATION[node.target] ?? node.target);
  const expectedOperations = left.operations.filter(({ operation }) => !['tensor_input', 'model_output'].includes(operation))
    .map(({ operation }) => operation);
  const expectedDtype = left.dtype;
  const parameterDtypes = [...new Set(document.state.parameters.map((parameter) => parameter.dtype))].sort();
  const runtimeParameterDtypes = [...new Set(workerObservation.parameterDtypes ?? [])].sort();
  const dtypeActual = {
    input: document.graph.inputs.find((input) => input.kind === 'USER_INPUT')?.spec?.dtype ?? null,
    documentParameters: parameterDtypes,
    runtimeParameters: runtimeParameterDtypes,
  };
  const dtypeExpected = { input: expectedDtype, parameters: expectedDtype ? [expectedDtype] : [] };
  const shapeExpected = left.shapeTrace.map(({ operation, rank, featureShape }) => ({ operation, rank, featureShape }));
  const shapeActual = actualDocShapes.map(({ operation, rank, featureShape }) => ({ operation, rank, featureShape }));
  const metrics = {
    ...semantic.metrics,
    exportedOperations: metric(expectedOperations, docOperations),
    exportedShapes: metric(shapeExpected, shapeActual),
    exportedDtype: metric(dtypeExpected, {
      input: dtypeActual.input,
      parameters: [...new Set([...parameterDtypes, ...runtimeParameterDtypes])].sort(),
    }),
    batchConstraints: {
      status: 'not-preserved',
      expected: actualDocShapes[0]?.batch ?? null,
      actual: 'Graph B stores no batch dimension or range constraint.',
    },
  };
  const compared = ['topology', 'operations', 'constructorParameters', 'exportedOperations', 'shapes', 'exportedShapes', 'dtype', 'exportedDtype'];
  const status = compared.every((key) => metrics[key]?.status === 'match') ? 'structural-match-with-losses' : 'mismatch';
  return {
    version: SEMANTIC_ROUNDTRIP_VERSION,
    status,
    metrics,
    losses: ['batch_extent_and_range_not_carried', 'trained_parameter_values_not_carried'],
    observations: {
      documentFingerprint: document.documentFingerprint,
      torchVersion: document.exporter.torchVersion,
      exporterBatch: actualDocShapes[0]?.batch ?? null,
      forwardStatus: workerObservation.forwardStatus,
      device: workerObservation.device,
    },
  };
}
