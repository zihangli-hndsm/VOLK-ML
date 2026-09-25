import { componentById } from '../components.js';
import { connectAgentNodes, createAgentNode } from '../canvasAgent.js';
import { artifactFingerprintJsonV1 } from './artifactFingerprint.js';

export const ONNX_DOCUMENT_TYPE = 'VolkOnnxDocumentV1';
export const ONNX_DOCUMENT_VERSION = 1;
export const ONNX_SUPPORTED_OPSET = 13;
export const MAX_ONNX_DOCUMENT_CODE_UNITS = 500_000;
export const MAX_ONNX_OPERATORS = 64;
export const MAX_ONNX_INITIALIZERS = 128;
const MAX_DIMENSION = 1_000_000;
const MAX_TENSOR_ELEMENTS = 65_536;
const MODEL_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const VALUE_NAME = /^[A-Za-z0-9_.:/-]{1,96}$/;
const SUPPORTED_DTYPES = new Set(['float16', 'float32']);

export class OnnxDocumentError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OnnxDocumentError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, path) {
  throw new OnnxDocumentError(code, message, path ? { path } : {});
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
}

function exactObject(value, fields, path) {
  if (!isRecord(value)) fail('ONNX_DOCUMENT_INVALID', 'Expected a plain object.', path);
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    fail('ONNX_DOCUMENT_INVALID', 'Object fields do not match the normalized ONNX contract.', path);
  }
}

function boundedString(value, path, pattern, max) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || !pattern.test(value)) {
    fail('ONNX_DOCUMENT_INVALID', 'Text value is outside the normalized ONNX contract.', path);
  }
  return value;
}

function boundedInteger(value, path, { min = 0, max = MAX_DIMENSION } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail('ONNX_DOCUMENT_INVALID', 'Integer is outside the normalized ONNX bound.', path);
  }
  return value;
}

function validateDimension(dimension, path, { allowBatchSymbol = false } = {}) {
  if (!isRecord(dimension)) fail('ONNX_SHAPE_INVALID', 'Dimension must be a tagged object.', path);
  if (dimension.kind === 'static') {
    exactObject(dimension, ['kind', 'value'], path);
    boundedInteger(dimension.value, path + '.value', { min: 1 });
    return dimension;
  }
  if (dimension.kind === 'symbol' && allowBatchSymbol) {
    exactObject(dimension, ['kind', 'name'], path);
    boundedString(dimension.name, path + '.name', /^[A-Za-z][A-Za-z0-9_-]{0,63}$/, 64);
    return dimension;
  }
  fail('ONNX_SHAPE_UNSUPPORTED', 'Only positive static dimensions and one leading batch symbol are supported.', path);
}

function validateShape(shape, path, { input = false } = {}) {
  if (!Array.isArray(shape) || shape.length < 2 || shape.length > 8) {
    fail('ONNX_SHAPE_UNSUPPORTED', 'Only rank-two through rank-eight tensors are supported.', path);
  }
  const normalized = shape.map((dimension, index) => validateDimension(dimension, `${path}[${index}]`, {
    allowBatchSymbol: index === 0,
  }));
  const symbols = normalized.flatMap((dimension) => dimension.kind === 'symbol' ? [dimension.name] : []);
  if (symbols.length > 1) fail('ONNX_SHAPE_UNSUPPORTED', 'At most one dynamic dimension is supported, and it must be the leading batch dimension.', path);
  if (!input && symbols.length && normalized[0].kind !== 'symbol') fail('ONNX_SHAPE_UNSUPPORTED', 'Dynamic dimensions must remain in the leading batch position.', path);
  return normalized;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function dimsEqual(left, right) {
  return sameJson(left, right);
}

function staticValue(dimension, path) {
  if (dimension?.kind !== 'static') fail('ONNX_SHAPE_UNSUPPORTED', 'Feature dimensions must be static.', path);
  return dimension.value;
}

function multiplyDimensions(dimensions, path) {
  return dimensions.reduce((product, dimension, index) => {
    const next = product * staticValue(dimension, `${path}[${index}]`);
    if (!Number.isSafeInteger(next) || next > MAX_DIMENSION) fail('ONNX_SHAPE_UNSUPPORTED', 'Flattened feature dimension exceeds the component bound.', path);
    return next;
  }, 1);
}

function validateMetadata(metadata, path) {
  exactObject(metadata, ['dtype', 'shape'], path);
  if (!SUPPORTED_DTYPES.has(metadata.dtype)) fail('ONNX_DTYPE_UNSUPPORTED', 'Only float16 and float32 tensor metadata is supported.', path + '.dtype');
  validateShape(metadata.shape, path + '.shape');
  return metadata;
}

function validateInitializer(initializer, path) {
  if (!isRecord(initializer)) fail('ONNX_DOCUMENT_INVALID', 'Initializer metadata must be an object.', path);
  if (initializer.role === 'parameter') {
    exactObject(initializer, ['name', 'dtype', 'shape', 'role'], path);
    if (!SUPPORTED_DTYPES.has(initializer.dtype)) fail('ONNX_DTYPE_UNSUPPORTED', 'Only float16 and float32 parameter metadata is supported.', path + '.dtype');
    if (!Array.isArray(initializer.shape) || ![1, 2].includes(initializer.shape.length)) {
      fail('ONNX_INITIALIZER_UNSUPPORTED', 'Learned parameter metadata must have rank one or two.', path + '.shape');
    }
    let count = 1;
    initializer.shape.forEach((dimension, index) => {
      boundedInteger(dimension, `${path}.shape[${index}]`, { min: 1 });
      count *= dimension;
      if (!Number.isSafeInteger(count) || count > MAX_TENSOR_ELEMENTS) {
        fail('ONNX_INITIALIZER_LIMIT', 'Parameter metadata exceeds the bounded tensor-element limit.', path + '.shape');
      }
    });
  } else if (initializer.role === 'shape') {
    exactObject(initializer, ['name', 'dtype', 'shape', 'role', 'shapeValues'], path);
    if (initializer.dtype !== 'int64' || !Array.isArray(initializer.shape) || initializer.shape.length !== 1) {
      fail('ONNX_RESHAPE_SHAPE_UNSUPPORTED', 'Reshape controls must be rank-one int64 metadata.', path);
    }
    boundedInteger(initializer.shape[0], path + '.shape[0]', { min: 1, max: 8 });
    if (!Array.isArray(initializer.shapeValues) || initializer.shapeValues.length !== initializer.shape[0]) {
      fail('ONNX_RESHAPE_SHAPE_UNSUPPORTED', 'Reshape control values do not match their declared vector shape.', path + '.shapeValues');
    }
    initializer.shapeValues.forEach((value, index) => {
      if (!Number.isSafeInteger(value) || value < -MAX_DIMENSION || value > MAX_DIMENSION) {
        fail('ONNX_RESHAPE_SHAPE_UNSUPPORTED', 'Reshape control values must be bounded integers.', `${path}.shapeValues[${index}]`);
      }
    });
  } else {
    fail('ONNX_INITIALIZER_UNSUPPORTED', 'Initializer role is unsupported.', path + '.role');
  }
  boundedString(initializer.name, path + '.name', VALUE_NAME, 96);
  return initializer;
}

function validateNode(node, index, path) {
  exactObject(node, ['id', 'op', 'inputs', 'output', 'attributes', 'metadata'], path);
  if (node.id !== `n${index}`) fail('ONNX_GRAPH_INVALID', 'Operator IDs must be contiguous and topological.', path + '.id');
  if (!['Gemm', 'MatMul', 'Add', 'Relu', 'Sigmoid', 'Tanh', 'Softmax', 'Flatten', 'Reshape'].includes(node.op)) {
    fail('ONNX_OPERATOR_UNSUPPORTED', 'Operator is outside the registered ONNX allowlist.', path + '.op');
  }
  if (!Array.isArray(node.inputs) || node.inputs.length < 1 || node.inputs.length > 3) {
    fail('ONNX_NODE_INVALID', 'Operator input count is outside the bounded contract.', path + '.inputs');
  }
  node.inputs.forEach((name, inputIndex) => {
    if (name !== null) boundedString(name, `${path}.inputs[${inputIndex}]`, VALUE_NAME, 96);
  });
  boundedString(node.output, path + '.output', VALUE_NAME, 96);
  if (!isRecord(node.attributes)) fail('ONNX_ATTRIBUTE_INVALID', 'Operator attributes must be a plain object.', path + '.attributes');
  validateMetadata(node.metadata, path + '.metadata');
  return node;
}

function validateRoot(document) {
  exactObject(document, ['type', 'version', 'model', 'onnx', 'extractor', 'graph', 'documentFingerprint'], '$');
  if (document.type !== ONNX_DOCUMENT_TYPE || document.version !== ONNX_DOCUMENT_VERSION) {
    fail('ONNX_DOCUMENT_VERSION_UNSUPPORTED', 'Normalized ONNX document version is unsupported.', '$.version');
  }
  exactObject(document.model, ['identifier'], '$.model');
  boundedString(document.model.identifier, '$.model.identifier', MODEL_ID, 64);
  exactObject(document.onnx, ['irVersion', 'opsetVersion'], '$.onnx');
  boundedInteger(document.onnx.irVersion, '$.onnx.irVersion', { min: 7, max: 14 });
  if (document.onnx.opsetVersion !== ONNX_SUPPORTED_OPSET) {
    fail('ONNX_OPSET_UNSUPPORTED', `Only ONNX opset ${ONNX_SUPPORTED_OPSET} is supported.`, '$.onnx.opsetVersion');
  }
  exactObject(document.extractor, ['schemaVersion', 'onnxVersion'], '$.extractor');
  if (document.extractor.schemaVersion !== 1) fail('ONNX_DOCUMENT_VERSION_UNSUPPORTED', 'ONNX extractor schema version is unsupported.', '$.extractor.schemaVersion');
  boundedString(document.extractor.onnxVersion, '$.extractor.onnxVersion', /^[0-9][A-Za-z0-9.+-]{0,31}$/, 32);
  exactObject(document.graph, ['input', 'initializers', 'nodes', 'output'], '$.graph');
  exactObject(document.graph.input, ['name', 'dtype', 'shape'], '$.graph.input');
  boundedString(document.graph.input.name, '$.graph.input.name', VALUE_NAME, 96);
  validateMetadata({ dtype: document.graph.input.dtype, shape: document.graph.input.shape }, '$.graph.input');
  exactObject(document.graph.output, ['name', 'dtype', 'shape'], '$.graph.output');
  boundedString(document.graph.output.name, '$.graph.output.name', VALUE_NAME, 96);
  validateMetadata({ dtype: document.graph.output.dtype, shape: document.graph.output.shape }, '$.graph.output');
  if (!Array.isArray(document.graph.initializers) || document.graph.initializers.length > MAX_ONNX_INITIALIZERS) {
    fail('ONNX_GRAPH_LIMIT', 'Initializer count exceeds the normalized document bound.', '$.graph.initializers');
  }
  if (!Array.isArray(document.graph.nodes) || document.graph.nodes.length < 1 || document.graph.nodes.length > MAX_ONNX_OPERATORS) {
    fail('ONNX_GRAPH_LIMIT', 'Operator count exceeds the normalized document bound.', '$.graph.nodes');
  }
  const initializerNames = new Set();
  document.graph.initializers.forEach((initializer, index) => {
    validateInitializer(initializer, `$.graph.initializers[${index}]`);
    if (initializerNames.has(initializer.name) || initializer.name === document.graph.input.name) {
      fail('ONNX_INITIALIZER_INVALID', 'Initializer names must be unique and distinct from graph inputs.', `$.graph.initializers[${index}].name`);
    }
    initializerNames.add(initializer.name);
  });
  document.graph.nodes.forEach((node, index) => validateNode(node, index, `$.graph.nodes[${index}]`));
  boundedString(document.documentFingerprint, '$.documentFingerprint', /^sha256:[a-f0-9]{64}$/, 71);
}

function validateAttributes(node, path) {
  const attributes = node.attributes;
  const allow = {
    Gemm: ['alpha', 'beta', 'transA', 'transB'],
    MatMul: [], Add: [], Relu: [], Sigmoid: [], Tanh: [],
    Softmax: ['axis'], Flatten: ['axis'], Reshape: [],
  }[node.op];
  if (Object.keys(attributes).some((key) => !allow.includes(key))) {
    fail('ONNX_ATTRIBUTE_UNSUPPORTED', 'Operator has an unsupported attribute.', path + '.attributes');
  }
  if (node.op === 'Gemm') {
    const alpha = attributes.alpha ?? 1;
    const beta = attributes.beta ?? 1;
    const transA = attributes.transA ?? 0;
    const transB = attributes.transB ?? 0;
    if (typeof alpha !== 'number' || !Number.isFinite(alpha) || alpha !== 1
      || typeof beta !== 'number' || !Number.isFinite(beta) || beta !== 1
      || transA !== 0 || ![0, 1].includes(transB)) {
      fail('ONNX_GEMM_SEMANTICS_UNSUPPORTED', 'Gemm is supported only with alpha=1, beta=1, transA=0, and transB=0 or 1.', path + '.attributes');
    }
  }
  if (node.op === 'Softmax' && attributes.axis !== undefined && !Number.isSafeInteger(attributes.axis)) {
    fail('ONNX_ATTRIBUTE_INVALID', 'Softmax axis must be an integer.', path + '.attributes.axis');
  }
  if (node.op === 'Flatten' && attributes.axis !== undefined && !Number.isSafeInteger(attributes.axis)) {
    fail('ONNX_ATTRIBUTE_INVALID', 'Flatten axis must be an integer.', path + '.attributes.axis');
  }
}

function assertDenseBounds(inputFeatures, units, path) {
  const properties = new Map((componentById.get('dense_node')?.properties ?? []).map((property) => [property.key, property]));
  for (const [key, value] of [['input_features', inputFeatures], ['units', units]]) {
    const property = properties.get(key);
    if (!property || value < property.min || value > property.max) {
      fail('ONNX_COMPONENT_LIMIT', 'Affine dimensions exceed the registered Dense component contract.', path);
    }
  }
}

function initializerMap(document) {
  return new Map(document.graph.initializers.map((item) => [item.name, item]));
}

function expectedDenseMetadata(inputSpec, units, path) {
  if (inputSpec.shape.length !== 2) fail('ONNX_AFFINE_SHAPE_UNSUPPORTED', 'Gemm and MatMul require rank-two input; add a faithful Flatten or Reshape first.', path);
  return { dtype: inputSpec.dtype, shape: [inputSpec.shape[0], { kind: 'static', value: units }] };
}

function assertDataMetadata(actual, expected, path) {
  if (actual.dtype !== expected.dtype || !dimsEqual(actual.shape, expected.shape)) {
    fail('ONNX_SHAPE_INVALID', 'Operator metadata does not match the deterministically inferred result.', path);
  }
}

function validateReshapeShape(inputShape, control, path) {
  const target = control.shapeValues;
  if (target.length < 2 || target.length > 8 || target.some((value) => value < -1)) {
    fail('ONNX_RESHAPE_SHAPE_UNSUPPORTED', 'Reshape target must be a bounded rank-two through rank-eight shape vector.', path);
  }
  const inferred = target.filter((value) => value === -1).length;
  if (inferred > 1) fail('ONNX_RESHAPE_SHAPE_UNSUPPORTED', 'Reshape target may contain at most one inferred dimension.', path);
  const batch = inputShape[0];
  if (batch.kind === 'symbol') {
    if (target[0] !== 0) fail('ONNX_RESHAPE_BATCH_UNSUPPORTED', 'A symbolic batch dimension must be copied explicitly with zero.', path);
  } else if (target[0] !== 0 && target[0] !== batch.value) {
    fail('ONNX_RESHAPE_BATCH_UNSUPPORTED', 'Reshape may not change the fixed leading batch dimension.', path);
  }
  const expected = [batch];
  const inputFeatures = multiplyDimensions(inputShape.slice(1), path + '.inputShape');
  const resolved = target.slice(1).map((value, index) => {
    if (value === 0) {
      if (index + 1 >= inputShape.length) fail('ONNX_RESHAPE_SHAPE_UNSUPPORTED', 'A zero target dimension has no corresponding input dimension.', path);
      return staticValue(inputShape[index + 1], path + '.inputShape');
    }
    return value;
  });
  const inferredIndex = resolved.indexOf(-1);
  if (inferredIndex >= 0) {
    const knownProduct = resolved.reduce((product, value) => value === -1 ? product : product * value, 1);
    if (knownProduct <= 0 || inputFeatures % knownProduct !== 0) {
      fail('ONNX_RESHAPE_SHAPE_UNSUPPORTED', 'Reshape inferred dimension is ambiguous or non-integral.', path);
    }
    resolved[inferredIndex] = inputFeatures / knownProduct;
  }
  if (resolved.some((value) => !Number.isSafeInteger(value) || value < 1 || value > MAX_DIMENSION)
    || multiplyDimensions(resolved.map((value) => ({ kind: 'static', value })), path) !== inputFeatures) {
    fail('ONNX_RESHAPE_SHAPE_UNSUPPORTED', 'Reshape must preserve every per-example element with a static target.', path);
  }
  expected.push(...resolved.map((value) => ({ kind: 'static', value })));
  return expected;
}

function validateLineage(document) {
  const graph = document.graph;
  const initializers = initializerMap(document);
  const available = new Map([[graph.input.name, { kind: 'data', metadata: { dtype: graph.input.dtype, shape: graph.input.shape } }]]);
  for (const [name, initializer] of initializers) available.set(name, { kind: 'initializer', initializer });
  const consumerCounts = new Map();
  const producerNames = new Set([graph.input.name, ...initializers.keys()]);
  const initializerUseCounts = new Map([...initializers.keys()].map((name) => [name, 0]));
  graph.nodes.forEach((node, index) => {
    const path = `$.graph.nodes[${index}]`;
    if (producerNames.has(node.output)) fail('ONNX_GRAPH_INVALID', 'Tensor names must have exactly one producer.', path + '.output');
    producerNames.add(node.output);
    node.inputs.forEach((inputName, inputIndex) => {
      if (inputName === null) return;
      if (!available.has(inputName)) fail('ONNX_GRAPH_INVALID', 'Graph must be topologically ordered and every value reference must resolve.', `${path}.inputs[${inputIndex}]`);
      consumerCounts.set(inputName, (consumerCounts.get(inputName) ?? 0) + 1);
    });
    available.set(node.output, { kind: 'data', metadata: node.metadata });
    validateAttributes(node, path);
  });
  if (!available.has(graph.output.name) || available.get(graph.output.name).kind !== 'data') {
    fail('ONNX_OUTPUT_UNSUPPORTED', 'Graph output must be produced by the single supported operator chain.', '$.graph.output.name');
  }
  consumerCounts.set(graph.output.name, (consumerCounts.get(graph.output.name) ?? 0) + 1);
  if ([...consumerCounts.values()].some((count) => count > 1)) fail('ONNX_GRAPH_FANOUT_UNSUPPORTED', 'Branching and shared tensor values are not supported.', '$.graph.nodes');

  let currentName = graph.input.name;
  let currentSpec = { dtype: graph.input.dtype, shape: graph.input.shape };
  const logicalLayers = [];
  let affineCount = 0;
  const consumedNodes = new Set();
  for (let index = 0; index < graph.nodes.length; index += 1) {
    if (consumedNodes.has(index)) continue;
    const node = graph.nodes[index];
    const path = `$.graph.nodes[${index}]`;
    const dataInput = node.inputs[0];
    if (dataInput !== currentName) fail('ONNX_GRAPH_INVALID', 'Operators must form one ordered, single-use input-to-output path.', `${path}.inputs[0]`);
    const addParameterUse = (name, expectedRole, namePath) => {
      const initializer = initializers.get(name);
      if (!initializer || initializer.role !== expectedRole) fail('ONNX_INITIALIZER_INVALID', 'Operator operand does not resolve to the required initializer role.', namePath);
      return initializer;
    };

    if (node.op === 'Gemm') {
      if (node.inputs.length !== 2 && node.inputs.length !== 3) fail('ONNX_GEMM_INPUT_UNSUPPORTED', 'Gemm requires A, B, and optional C in their standard slots.', path + '.inputs');
      const weight = addParameterUse(node.inputs[1], 'parameter', path + '.inputs[1]');
      const transB = node.attributes.transB ?? 0;
      if (weight.shape.length !== 2) fail('ONNX_AFFINE_SHAPE_UNSUPPORTED', 'Gemm B must be a rank-two initializer.', path + '.inputs[1]');
      const inputFeatures = transB ? weight.shape[1] : weight.shape[0];
      const units = transB ? weight.shape[0] : weight.shape[1];
      if (currentSpec.shape.length !== 2 || staticValue(currentSpec.shape[1], path) !== inputFeatures) fail('ONNX_SHAPE_INVALID', 'Gemm input feature count does not match B.', path);
      if (weight.dtype !== currentSpec.dtype) fail('ONNX_DTYPE_UNSUPPORTED', 'Gemm input and B parameter dtypes differ.', path);
      assertDenseBounds(inputFeatures, units, path);
      initializerUseCounts.set(weight.name, initializerUseCounts.get(weight.name) + 1);
      const biasName = node.inputs[2] ?? null;
      let useBias = false;
      if (biasName !== null) {
        const bias = addParameterUse(biasName, 'parameter', path + '.inputs[2]');
        if (![1, 2].includes(bias.shape.length)
          || !(bias.shape.length === 1 && bias.shape[0] === units || bias.shape.length === 2 && bias.shape[0] === 1 && bias.shape[1] === units)
          || bias.dtype !== currentSpec.dtype) {
          fail('ONNX_GEMM_BIAS_UNSUPPORTED', 'Gemm C must be a same-dtype vector or [1, units] bias.', path + '.inputs[2]');
        }
        useBias = true;
        initializerUseCounts.set(bias.name, initializerUseCounts.get(bias.name) + 1);
      }
      const expected = expectedDenseMetadata(currentSpec, units, path);
      assertDataMetadata(node.metadata, expected, path + '.metadata');
      logicalLayers.push({ op: 'dense', nodeIndex: index, output: node.output, inputFeatures, units, useBias });
      currentName = node.output;
      currentSpec = expected;
      affineCount += 1;
      continue;
    }

    if (node.op === 'MatMul') {
      if (node.inputs.length !== 2) fail('ONNX_MATMUL_INPUT_UNSUPPORTED', 'MatMul requires exactly two inputs.', path + '.inputs');
      const weight = addParameterUse(node.inputs[1], 'parameter', path + '.inputs[1]');
      if (weight.shape.length !== 2 || currentSpec.shape.length !== 2) fail('ONNX_AFFINE_SHAPE_UNSUPPORTED', 'MatMul requires rank-two input and weight tensors.', path);
      const inputFeatures = weight.shape[0];
      const units = weight.shape[1];
      if (staticValue(currentSpec.shape[1], path) !== inputFeatures || weight.dtype !== currentSpec.dtype) {
        fail('ONNX_SHAPE_INVALID', 'MatMul input and weight shape or dtype do not agree.', path);
      }
      assertDenseBounds(inputFeatures, units, path);
      initializerUseCounts.set(weight.name, initializerUseCounts.get(weight.name) + 1);
      let output = node.output;
      let expected = expectedDenseMetadata(currentSpec, units, path);
      assertDataMetadata(node.metadata, expected, path + '.metadata');
      let useBias = false;
      const next = graph.nodes[index + 1];
      if (next?.op === 'Add' && (next.inputs[0] === node.output || next.inputs[1] === node.output)) {
        const addIndex = index + 1;
        const addPath = `$.graph.nodes[${addIndex}]`;
        if (next.inputs.length !== 2) fail('ONNX_ADD_INPUT_UNSUPPORTED', 'Affine Add requires exactly two inputs.', addPath + '.inputs');
        const biasName = next.inputs[next.inputs[0] === node.output ? 1 : 0];
        const bias = addParameterUse(biasName, 'parameter', addPath + '.inputs');
        if (![1, 2].includes(bias.shape.length)
          || !(bias.shape.length === 1 && bias.shape[0] === units || bias.shape.length === 2 && bias.shape[0] === 1 && bias.shape[1] === units)
          || bias.dtype !== currentSpec.dtype) {
          fail('ONNX_ADD_BIAS_UNSUPPORTED', 'Affine Add must add a same-dtype vector or [1, units] initializer bias.', addPath + '.inputs');
        }
        if (consumerCounts.get(node.output) !== 1) fail('ONNX_GRAPH_FANOUT_UNSUPPORTED', 'MatMul output must be consumed only by its affine Add.', addPath);
        initializerUseCounts.set(bias.name, initializerUseCounts.get(bias.name) + 1);
        output = next.output;
        expected = { dtype: currentSpec.dtype, shape: [currentSpec.shape[0], { kind: 'static', value: units }] };
        assertDataMetadata(next.metadata, expected, addPath + '.metadata');
        useBias = true;
        consumedNodes.add(addIndex);
      }
      logicalLayers.push({ op: 'dense', nodeIndex: index, output, inputFeatures, units, useBias });
      currentName = output;
      currentSpec = expected;
      affineCount += 1;
      continue;
    }

    if (node.op === 'Add') fail('ONNX_ADD_PATTERN_UNSUPPORTED', 'Add is supported only as the bias half of a MatMul-plus-Add affine pattern.', path);

    if (node.op === 'Flatten') {
      const axis = node.attributes.axis ?? 1;
      if (axis !== 1) fail('ONNX_FLATTEN_AXIS_UNSUPPORTED', 'Only ONNX Flatten axis=1 matches VOLK Flatten semantics.', path + '.attributes.axis');
      const features = multiplyDimensions(currentSpec.shape.slice(1), path + '.inputShape');
      const expected = { dtype: currentSpec.dtype, shape: [currentSpec.shape[0], { kind: 'static', value: features }] };
      assertDataMetadata(node.metadata, expected, path + '.metadata');
      logicalLayers.push({ op: 'flatten', nodeIndex: index, output: node.output });
      currentName = node.output;
      currentSpec = expected;
      continue;
    }

    if (node.op === 'Reshape') {
      if (node.inputs.length !== 2) fail('ONNX_RESHAPE_INPUT_UNSUPPORTED', 'Reshape requires data and a static shape-control initializer.', path + '.inputs');
      const control = addParameterUse(node.inputs[1], 'shape', path + '.inputs[1]');
      const expectedShape = validateReshapeShape(currentSpec.shape, control, path + '.inputs[1]');
      const expected = { dtype: currentSpec.dtype, shape: expectedShape };
      assertDataMetadata(node.metadata, expected, path + '.metadata');
      initializerUseCounts.set(control.name, initializerUseCounts.get(control.name) + 1);
      logicalLayers.push({ op: 'reshape', nodeIndex: index, output: node.output, shape: expectedShape.slice(1).map((dimension) => dimension.value) });
      currentName = node.output;
      currentSpec = expected;
      continue;
    }

    if (['Relu', 'Sigmoid', 'Tanh', 'Softmax'].includes(node.op)) {
      const allowedInputs = 1;
      if (node.inputs.length !== allowedInputs) fail('ONNX_ACTIVATION_INPUT_UNSUPPORTED', 'Activation operators require exactly one data input.', path + '.inputs');
      let parameters = {};
      if (node.op === 'Softmax') {
        const axis = node.attributes.axis ?? -1;
        if (![-1, 1].includes(axis)) fail('ONNX_SOFTMAX_AXIS_UNSUPPORTED', 'Only class-axis Softmax over the last dimension is supported.', path + '.attributes.axis');
        parameters = { axis };
      }
      assertDataMetadata(node.metadata, currentSpec, path + '.metadata');
      logicalLayers.push({ op: node.op.toLowerCase(), nodeIndex: index, output: node.output, parameters });
      currentName = node.output;
      continue;
    }

    fail('ONNX_OPERATOR_UNSUPPORTED', 'Operator is outside the supported affine-chain contract.', path + '.op');
  }
  if (affineCount < 1) fail('ONNX_GRAPH_INVALID', 'At least one supported affine layer is required.', '$.graph.nodes');
  if (currentName !== graph.output.name) fail('ONNX_OUTPUT_UNSUPPORTED', 'Declared graph output does not match the final operator chain.', '$.graph.output.name');
  assertDataMetadata(graph.output, currentSpec, '$.graph.output');
  for (const [name, count] of initializerUseCounts) {
    if (count !== 1) fail('ONNX_INITIALIZER_USAGE_INVALID', 'Every initializer must be consumed exactly once; shared and unused parameters are unsupported.', '$.graph.initializers.' + name);
  }
  return logicalLayers;
}

function canonicalDocumentContent(document) {
  const { documentFingerprint: _fingerprint, ...content } = document;
  return content;
}

/** Validate, clone, fingerprint-check, and return a strict metadata-only ONNX V1 document. */
export function validateOnnxDocument(value) {
  if (!isRecord(value)) fail('ONNX_DOCUMENT_INVALID', 'Document root must be a plain object.', '$');
  let serialized;
  try { serialized = JSON.stringify(value); } catch { fail('ONNX_DOCUMENT_INVALID', 'Document is not JSON serializable.', '$'); }
  if (serialized.length > MAX_ONNX_DOCUMENT_CODE_UNITS) fail('ONNX_DOCUMENT_LIMIT', 'Normalized ONNX document exceeds the size bound.', '$');
  let document;
  try { document = structuredClone(value); } catch { fail('ONNX_DOCUMENT_INVALID', 'Document cannot be cloned as JSON data.', '$'); }
  validateRoot(document);
  const expectedFingerprint = artifactFingerprintJsonV1(canonicalDocumentContent(document));
  if (document.documentFingerprint !== expectedFingerprint) fail('ONNX_FINGERPRINT_MISMATCH', 'Normalized ONNX fingerprint does not match its semantic content.', '$.documentFingerprint');
  validateLineage(document);
  return document;
}

function componentIdForOnnxOp(op) {
  return ({
    dense: 'dense_node', flatten: 'flatten_node', reshape: 'reshape_node',
    relu: 'relu_node', sigmoid: 'sigmoid_node', tanh: 'tanh_node', softmax: 'softmax_node',
  })[op];
}

function logicalLayersForDocument(document) {
  return validateLineage(document);
}

/** Deterministically rematerialize only the validated graph structure and initializer shapes. */
export function materializeOnnxDocument(value) {
  const document = validateOnnxDocument(value);
  const layers = logicalLayersForDocument(document);
  const nodes = [];
  let edges = [];
  const input = document.graph.input;
  const inputNode = createAgentNode({
    nodes,
    manifest: componentById.get('tensor_input_node'),
    request: {
      id: 'onnx-input-0',
      position: { x: 120, y: 220 },
      parameters: {
        shape: input.shape.slice(1).map((dimension) => String(dimension.value)).join(','),
        dtype: input.dtype,
      },
    },
  });
  nodes.push(inputNode);
  let prior = { node: inputNode, handle: 'tensor' };
  let edgeIndex = 0;
  for (const [index, layer] of layers.entries()) {
    const componentId = componentIdForOnnxOp(layer.op);
    const manifest = componentById.get(componentId);
    if (!manifest) fail('ONNX_COMPONENT_UNAVAILABLE', 'Required registered VOLK component is unavailable.', `$.graph.nodes[${layer.nodeIndex}]`);
    const parameters = layer.op === 'dense'
      ? { input_features: layer.inputFeatures, units: layer.units, use_bias: layer.useBias }
      : layer.op === 'reshape'
        ? { shape: layer.shape.join(',') }
        : layer.parameters ?? {};
    const node = createAgentNode({
      nodes,
      manifest,
      request: {
        id: 'onnx-op-' + String(index).padStart(3, '0'),
        position: { x: 420 + index * 300, y: 220 },
        parameters,
      },
    });
    nodes.push(node);
    edges = connectAgentNodes(nodes, edges, {
      id: 'onnx-edge-' + String(edgeIndex++).padStart(3, '0'),
      source: prior.node.id,
      sourceHandle: prior.handle,
      target: node.id,
      targetHandle: 'input',
    });
    prior = { node, handle: 'output' };
  }
  const outputNode = createAgentNode({
    nodes,
    manifest: componentById.get('model_output_node'),
    request: {
      id: 'onnx-output-0',
      position: { x: 420 + layers.length * 300, y: 220 },
    },
  });
  nodes.push(outputNode);
  edges = connectAgentNodes(nodes, edges, {
    id: 'onnx-edge-' + String(edgeIndex).padStart(3, '0'),
    source: prior.node.id,
    sourceHandle: prior.handle,
    target: outputNode.id,
    targetHandle: 'input',
  });
  return { nodes, edges, componentDefinitions: [] };
}
