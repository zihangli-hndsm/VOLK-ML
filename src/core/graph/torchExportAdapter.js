import { componentById } from '../components.js';
import { connectAgentNodes, createAgentNode } from '../canvasAgent.js';
import { artifactFingerprintJsonV1 } from './artifactFingerprint.js';

export const TORCH_EXPORT_DOCUMENT_TYPE = 'TorchExportDocumentV1';
export const TORCH_EXPORT_DOCUMENT_VERSION = 1;
export const MAX_TORCH_EXPORT_DOCUMENT_CODE_UNITS = 500_000;
export const MAX_TORCH_EXPORT_OPS = 64;
export const MAX_TORCH_EXPORT_INPUTS_AND_STATE = 128;
export const MAX_TORCH_EXPORT_TENSOR_ELEMENTS = 65_536;
const MAX_DIMENSION = 1_000_000;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const TARGET = /^[A-Za-z][A-Za-z0-9_.]{0,127}$/;
const TORCH_VERSION = /^[0-9][A-Za-z0-9.+-]{0,31}$/;
const SHA256_FINGERPRINT = /^sha256:[a-f0-9]{64}$/;
const SUPPORTED_DTYPES = new Set(['float16', 'float32']);

export class TorchExportDocumentError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TorchExportDocumentError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, path) {
  throw new TorchExportDocumentError(code, message, path ? { path } : {});
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
}

function exactObject(value, fields, path) {
  if (!isRecord(value)) fail('TORCH_EXPORT_DOCUMENT_INVALID', 'Expected an object.', path);
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    fail('TORCH_EXPORT_DOCUMENT_INVALID', 'Object fields do not match the contract.', path);
  }
}

function boundedString(value, path, pattern, max = 128) {
  if (typeof value !== 'string' || !value || value.length > max || !pattern.test(value)) {
    fail('TORCH_EXPORT_DOCUMENT_INVALID', 'Text value is outside the contract.', path);
  }
  return value;
}

function boundedArray(value, path, max) {
  if (!Array.isArray(value) || value.length > max) fail('TORCH_EXPORT_DOCUMENT_INVALID', 'Array exceeds its contract bound.', path);
  return value;
}

function boundedInteger(value, path, { min = 0, max = MAX_DIMENSION } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail('TORCH_EXPORT_DOCUMENT_INVALID', 'Integer is outside the contract bound.', path);
  }
  return value;
}

function validateDtype(dtype, path) {
  if (!SUPPORTED_DTYPES.has(dtype)) fail('TORCH_EXPORT_DTYPE_UNSUPPORTED', 'Only float16 and float32 tensors are supported.', path);
  return dtype;
}

function validateDimension(dimension, path, { allowSymbol = false } = {}) {
  if (!isRecord(dimension)) fail('TORCH_EXPORT_DOCUMENT_INVALID', 'Tensor dimension must be an object.', path);
  if (dimension.kind === 'static') {
    exactObject(dimension, ['kind', 'value'], path);
    boundedInteger(dimension.value, path + '.value', { min: 1 });
    return dimension;
  }
  if (dimension.kind === 'symbol' && allowSymbol) {
    exactObject(dimension, ['kind', 'name'], path);
    boundedString(dimension.name, path + '.name', IDENTIFIER, 64);
    return dimension;
  }
  fail('TORCH_EXPORT_SHAPE_UNSUPPORTED', 'Only static dimensions and the declared batch symbol are supported.', path);
}

function validateShape(shape, path, { allowBatchSymbol = false } = {}) {
  boundedArray(shape, path, 8);
  if (shape.length !== 2) fail('TORCH_EXPORT_SHAPE_UNSUPPORTED', 'Only rank-two tensors are supported.', path);
  return shape.map((dimension, index) => validateDimension(dimension, path + '[' + index + ']', {
    allowSymbol: allowBatchSymbol && index === 0,
  }));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function shapeElementCount(shape, path) {
  return shape.reduce((count, dimension, index) => {
    if (dimension.kind !== 'static') fail('TORCH_EXPORT_SHAPE_UNSUPPORTED', 'Parameter shapes must be static.', path + '[' + index + ']');
    const next = count * dimension.value;
    if (!Number.isSafeInteger(next) || next > MAX_TORCH_EXPORT_TENSOR_ELEMENTS) {
      fail('TORCH_EXPORT_STATE_LIMIT', 'Tensor metadata exceeds the element bound.', path);
    }
    return next;
  }, 1);
}

function validateTensorMetadata(entry, expectedKind, path) {
  exactObject(entry, ['id', 'target', 'name', 'kind', 'dtype', 'shape', 'requiresGrad'], path);
  boundedString(entry.id, path + '.id', IDENTIFIER, 64);
  boundedString(entry.target, path + '.target', TARGET, 128);
  boundedString(entry.name, path + '.name', IDENTIFIER, 64);
  if (entry.kind !== expectedKind) fail('TORCH_EXPORT_STATE_INVALID', 'Tensor metadata kind does not match its collection.', path + '.kind');
  validateDtype(entry.dtype, path + '.dtype');
  boundedArray(entry.shape, path + '.shape', 8);
  if (entry.shape.length !== 1 && entry.shape.length !== 2) fail('TORCH_EXPORT_SHAPE_UNSUPPORTED', 'State metadata must be rank one or two.', path + '.shape');
  entry.shape.forEach((dimension, index) => validateDimension(dimension, path + '.shape[' + index + ']'));
  shapeElementCount(entry.shape, path + '.shape');
  if (typeof entry.requiresGrad !== 'boolean') fail('TORCH_EXPORT_STATE_INVALID', 'requiresGrad must be a boolean metadata value.', path + '.requiresGrad');
  return entry;
}

function validateSpec(spec, path, options) {
  exactObject(spec, ['dtype', 'shape'], path);
  validateDtype(spec.dtype, path + '.dtype');
  if (options.allowParameterRank) {
    boundedArray(spec.shape, path + '.shape', 2);
    if (spec.shape.length !== 1 && spec.shape.length !== 2) {
      fail('TORCH_EXPORT_SHAPE_UNSUPPORTED', 'Parameter tensors must have rank one or two.', path + '.shape');
    }
    spec.shape.forEach((dimension, index) => validateDimension(dimension, path + '.shape[' + index + ']'));
    return spec.shape;
  }
  return validateShape(spec.shape, path + '.shape', options);
}

function validateInput(input, path) {
  exactObject(input, ['id', 'name', 'kind', 'target', 'spec'], path);
  boundedString(input.id, path + '.id', IDENTIFIER, 64);
  boundedString(input.name, path + '.name', IDENTIFIER, 64);
  if (input.kind === 'BUFFER' || input.kind === 'CONSTANT_TENSOR') {
    fail('TORCH_EXPORT_STATE_UNSUPPORTED', 'Buffer and constant tensor inputs are identified but not imported.', path + '.kind');
  }
  if (!['USER_INPUT', 'PARAMETER'].includes(input.kind)) fail('TORCH_EXPORT_INPUT_UNSUPPORTED', 'Graph-signature input kind is unsupported.', path + '.kind');
  if (input.kind === 'USER_INPUT') {
    if (input.target !== null) fail('TORCH_EXPORT_DOCUMENT_INVALID', 'User input target must be null.', path + '.target');
  } else {
    boundedString(input.target, path + '.target', TARGET, 128);
  }
  validateSpec(input.spec, path + '.spec', {
    allowBatchSymbol: input.kind === 'USER_INPUT',
    allowParameterRank: input.kind === 'PARAMETER',
  });
  return input;
}

function validateOperand(value, path) {
  if (value === null) return value;
  if (!isRecord(value)) fail('TORCH_EXPORT_ARGUMENT_INVALID', 'Operator argument is not a typed operand.', path);
  if (value.kind === 'input' || value.kind === 'node') {
    exactObject(value, ['kind', 'id'], path);
    boundedString(value.id, path + '.id', IDENTIFIER, 64);
    return value;
  }
  if (value.kind === 'scalar') {
    exactObject(value, ['kind', 'dtype', 'value'], path);
    if (value.dtype !== 'int64' || !Number.isSafeInteger(value.value)) {
      fail('TORCH_EXPORT_ARGUMENT_INVALID', 'Only safe int64 scalar arguments are supported.', path);
    }
    return value;
  }
  fail('TORCH_EXPORT_ARGUMENT_INVALID', 'Operand kind is unsupported.', path);
}

function validateNode(node, index, path) {
  exactObject(node, ['id', 'target', 'args', 'kwargs', 'metadata'], path);
  if (node.id !== 'n' + index) fail('TORCH_EXPORT_GRAPH_INVALID', 'Operator IDs must be contiguous and topological.', path + '.id');
  boundedString(node.target, path + '.target', TARGET, 128);
  boundedArray(node.args, path + '.args', 4);
  node.args.forEach((operand, operandIndex) => validateOperand(operand, path + '.args[' + operandIndex + ']'));
  exactObject(node.kwargs, [], path + '.kwargs');
  exactObject(node.metadata, ['dtype', 'shape', 'layout'], path + '.metadata');
  validateDtype(node.metadata.dtype, path + '.metadata.dtype');
  validateShape(node.metadata.shape, path + '.metadata.shape', { allowBatchSymbol: true });
  if (node.metadata.layout !== 'strided') fail('TORCH_EXPORT_LAYOUT_UNSUPPORTED', 'Only strided tensor layout is supported.', path + '.metadata.layout');
  if (!['aten.linear.default', 'aten.relu.default', 'aten.sigmoid.default', 'aten.tanh.default', 'aten.softmax.int'].includes(node.target)) {
    fail('TORCH_EXPORT_OPERATOR_UNSUPPORTED', 'ATen overload is not in the supported allowlist.', path + '.target');
  }
  const componentId = componentIdForTarget(node.target);
  if (!componentId || !componentById.has(componentId)) {
    fail('TORCH_EXPORT_COMPONENT_UNAVAILABLE', 'ATen mapping has no registered VOLK component.', path + '.target');
  }
  return node;
}

function validateOutput(output, path) {
  exactObject(output, ['kind', 'value', 'spec'], path);
  if (output.kind !== 'USER_OUTPUT') fail('TORCH_EXPORT_OUTPUT_UNSUPPORTED', 'Exactly one USER_OUTPUT is supported.', path + '.kind');
  validateOperand(output.value, path + '.value');
  validateSpec(output.spec, path + '.spec', { allowBatchSymbol: true });
}

function validateDocumentShape(document) {
  exactObject(document, ['type', 'version', 'exporter', 'model', 'extractor', 'graph', 'state', 'documentFingerprint'], '$');
  if (document.type !== TORCH_EXPORT_DOCUMENT_TYPE || document.version !== TORCH_EXPORT_DOCUMENT_VERSION) {
    fail('TORCH_EXPORT_DOCUMENT_VERSION_UNSUPPORTED', 'Torch Export document version is unsupported.', '$.version');
  }
  exactObject(document.exporter, ['name', 'torchVersion'], '$.exporter');
  if (document.exporter.name !== 'torch.export') fail('TORCH_EXPORT_DOCUMENT_INVALID', 'Exporter name must be torch.export.', '$.exporter.name');
  boundedString(document.exporter.torchVersion, '$.exporter.torchVersion', TORCH_VERSION, 32);
  exactObject(document.model, ['identifier'], '$.model');
  boundedString(document.model.identifier, '$.model.identifier', IDENTIFIER, 64);
  exactObject(document.extractor, ['schemaVersion'], '$.extractor');
  if (document.extractor.schemaVersion !== 1) fail('TORCH_EXPORT_DOCUMENT_VERSION_UNSUPPORTED', 'Torch Export extractor schema version is unsupported.', '$.extractor.schemaVersion');
  exactObject(document.graph, ['inputs', 'nodes', 'outputs', 'rangeConstraints'], '$.graph');
  boundedArray(document.graph.inputs, '$.graph.inputs', MAX_TORCH_EXPORT_INPUTS_AND_STATE);
  boundedArray(document.graph.nodes, '$.graph.nodes', MAX_TORCH_EXPORT_OPS);
  if (document.graph.nodes.length === 0) fail('TORCH_EXPORT_GRAPH_INVALID', 'At least one supported operator is required.', '$.graph.nodes');
  if (!Array.isArray(document.graph.outputs) || document.graph.outputs.length !== 1) {
    fail('TORCH_EXPORT_OUTPUT_UNSUPPORTED', 'Exactly one user output is required.', '$.graph.outputs');
  }
  boundedArray(document.graph.rangeConstraints, '$.graph.rangeConstraints', 1);
  document.graph.inputs = document.graph.inputs.map((input, index) => validateInput(input, '$.graph.inputs[' + index + ']'));
  document.graph.nodes.forEach((node, index) => validateNode(node, index, '$.graph.nodes[' + index + ']'));
  validateOutput(document.graph.outputs[0], '$.graph.outputs[0]');
  document.graph.rangeConstraints.forEach((constraint, index) => {
    const path = '$.graph.rangeConstraints[' + index + ']';
    exactObject(constraint, ['symbol', 'min', 'max'], path);
    boundedString(constraint.symbol, path + '.symbol', IDENTIFIER, 64);
    boundedInteger(constraint.min, path + '.min', { min: 1 });
    boundedInteger(constraint.max, path + '.max', { min: 1 });
    if (constraint.max < constraint.min) fail('TORCH_EXPORT_SHAPE_INVALID', 'Batch range maximum must not be below minimum.', path);
  });
  exactObject(document.state, ['parameters', 'buffers', 'constants'], '$.state');
  boundedArray(document.state.parameters, '$.state.parameters', MAX_TORCH_EXPORT_INPUTS_AND_STATE);
  boundedArray(document.state.buffers, '$.state.buffers', MAX_TORCH_EXPORT_INPUTS_AND_STATE);
  boundedArray(document.state.constants, '$.state.constants', MAX_TORCH_EXPORT_INPUTS_AND_STATE);
  const ids = new Set();
  const targets = new Set();
  for (const [collection, kind] of [['parameters', 'PARAMETER'], ['buffers', 'BUFFER'], ['constants', 'CONSTANT_TENSOR']]) {
    for (const [index, entry] of document.state[collection].entries()) {
      const path = '$.state.' + collection + '[' + index + ']';
      validateTensorMetadata(entry, kind, path);
      if (ids.has(entry.id) || targets.has(entry.target)) fail('TORCH_EXPORT_STATE_INVALID', 'State metadata IDs and targets must be unique.', path);
      ids.add(entry.id);
      targets.add(entry.target);
    }
  }
  const stateEntryCount = document.state.parameters.length + document.state.buffers.length + document.state.constants.length;
  if (document.graph.inputs.length + stateEntryCount > MAX_TORCH_EXPORT_INPUTS_AND_STATE) {
    fail('TORCH_EXPORT_DOCUMENT_LIMIT', 'Input and state entry count exceeds the document bound.', '$.graph.inputs');
  }
  boundedString(document.documentFingerprint, '$.documentFingerprint', SHA256_FINGERPRINT, 71);
}

function resolveShapeSymbol(shape, path) {
  const symbols = shape.flatMap((dimension) => dimension.kind === 'symbol' ? [dimension.name] : []);
  if (symbols.length > 1) fail('TORCH_EXPORT_SHAPE_UNSUPPORTED', 'A tensor may contain at most one batch symbol.', path);
  return symbols[0] ?? null;
}

function validateLineage(document) {
  if (document.state.buffers.length || document.state.constants.length) {
    fail('TORCH_EXPORT_STATE_UNSUPPORTED', 'Buffer and constant tensor metadata are identified but not imported.', '$.state');
  }
  const inputsById = new Map(document.graph.inputs.map((input) => [input.id, input]));
  if (inputsById.size !== document.graph.inputs.length) fail('TORCH_EXPORT_GRAPH_INVALID', 'Input IDs must be unique.', '$.graph.inputs');
  const userInputs = document.graph.inputs.filter((input) => input.kind === 'USER_INPUT');
  if (userInputs.length !== 1) fail('TORCH_EXPORT_GRAPH_INVALID', 'Exactly one tensor user input is supported.', '$.graph.inputs');
  const userInput = userInputs[0];
  const batchSymbol = resolveShapeSymbol(userInput.spec.shape, '$.graph.inputs.' + userInput.id);
  if (userInput.spec.shape[1].kind !== 'static') fail('TORCH_EXPORT_SHAPE_UNSUPPORTED', 'The feature dimension must be static.', '$.graph.inputs.' + userInput.id + '.spec.shape[1]');
  const constraints = document.graph.rangeConstraints;
  if (batchSymbol === null) {
    if (constraints.length) fail('TORCH_EXPORT_SHAPE_INVALID', 'Static-batch documents cannot declare symbolic constraints.', '$.graph.rangeConstraints');
  } else if (constraints.length !== 1 || constraints[0].symbol !== batchSymbol) {
    fail('TORCH_EXPORT_SHAPE_INVALID', 'The batch symbol must have exactly one matching finite range.', '$.graph.rangeConstraints');
  }
  for (const input of document.graph.inputs) {
    if (input.kind === 'PARAMETER') {
      if (input.spec.shape.some((dimension) => dimension.kind !== 'static')) fail('TORCH_EXPORT_SHAPE_UNSUPPORTED', 'Parameter dimensions must be static.', '$.graph.inputs.' + input.id);
    } else if (input.id !== userInput.id) {
      fail('TORCH_EXPORT_GRAPH_INVALID', 'Only the primary user tensor input is supported.', '$.graph.inputs.' + input.id);
    }
  }
  const parametersById = new Map(document.state.parameters.map((parameter) => [parameter.id, parameter]));
  if (parametersById.size !== document.state.parameters.length) fail('TORCH_EXPORT_STATE_INVALID', 'Parameter state IDs must be unique.', '$.state.parameters');
  const parameterInputs = document.graph.inputs.filter((input) => input.kind === 'PARAMETER');
  if (parameterInputs.length !== parametersById.size) fail('TORCH_EXPORT_STATE_INVALID', 'Every parameter must have one matching graph input.', '$.graph.inputs');
  for (const input of parameterInputs) {
    const parameter = parametersById.get(input.id);
    if (!parameter || parameter.target !== input.target || parameter.name !== input.name || parameter.dtype !== input.spec.dtype
      || !sameJson(parameter.shape, input.spec.shape)) {
      fail('TORCH_EXPORT_STATE_INVALID', 'Parameter graph input does not match its state record.', '$.graph.inputs.' + input.id);
    }
  }
  let current = { kind: 'input', id: userInput.id };
  let currentSpec = userInput.spec;
  let linearCount = 0;
  const usedParameters = new Set();
  const nodeIds = new Set();
  for (const [index, node] of document.graph.nodes.entries()) {
    const path = '$.graph.nodes[' + index + ']';
    if (nodeIds.has(node.id)) fail('TORCH_EXPORT_GRAPH_INVALID', 'Operator IDs must be unique.', path);
    nodeIds.add(node.id);
    const args = node.args;
    const tensorArg = args[0];
    if (!tensorArg || tensorArg.kind !== current.kind || tensorArg.id !== current.id) {
      fail('TORCH_EXPORT_GRAPH_INVALID', 'Operators must form one ordered, single-use tensor chain.', path + '.args[0]');
    }
    let expectedSpec;
    if (node.target === 'aten.linear.default') {
      if (args.length !== 3 || !args[1] || args[1].kind !== 'input' || args[2] !== null && (!args[2] || args[2].kind !== 'input')) {
        fail('TORCH_EXPORT_ARGUMENT_INVALID', 'Linear requires input, weight, and optional bias references.', path + '.args');
      }
      if (args[1].id === userInput.id || args[1].id === args[0].id) fail('TORCH_EXPORT_ARGUMENT_INVALID', 'Linear weight must reference parameter state.', path + '.args[1]');
      const weightInput = inputsById.get(args[1].id);
      const weight = parametersById.get(args[1].id);
      if (!weightInput || weightInput.kind !== 'PARAMETER' || !weight || weight.shape.length !== 2) {
        fail('TORCH_EXPORT_ARGUMENT_INVALID', 'Linear weight must resolve to a rank-two parameter.', path + '.args[1]');
      }
      if (usedParameters.has(weight.id)) fail('TORCH_EXPORT_STATE_INVALID', 'Shared parameters are not supported.', path + '.args[1]');
      usedParameters.add(weight.id);
      let bias = null;
      if (args[2] !== null) {
        const biasInput = inputsById.get(args[2].id);
        bias = parametersById.get(args[2].id);
        if (!biasInput || biasInput.kind !== 'PARAMETER' || !bias || bias.shape.length !== 1) {
          fail('TORCH_EXPORT_ARGUMENT_INVALID', 'Linear bias must resolve to a rank-one parameter.', path + '.args[2]');
        }
        if (usedParameters.has(bias.id)) fail('TORCH_EXPORT_STATE_INVALID', 'Shared parameters are not supported.', path + '.args[2]');
        usedParameters.add(bias.id);
      }
      const inFeatures = weight.shape[1].value;
      const outFeatures = weight.shape[0].value;
      const denseManifest = componentById.get('dense_node');
      const denseProperties = new Map((denseManifest?.properties ?? []).map((property) => [property.key, property]));
      for (const [key, value] of [['input_features', inFeatures], ['units', outFeatures]]) {
        const property = denseProperties.get(key);
        if (!property || value < property.min || value > property.max) {
          fail('TORCH_EXPORT_COMPONENT_LIMIT', 'Linear dimensions exceed the registered Dense component contract.', path + '.args[1]');
        }
      }
      if (currentSpec.shape.length !== 2 || currentSpec.shape[1].kind !== 'static' || currentSpec.shape[1].value !== inFeatures
        || currentSpec.dtype !== weight.dtype || node.metadata.dtype !== currentSpec.dtype
        || weightInput.spec.dtype !== currentSpec.dtype) {
        fail('TORCH_EXPORT_SHAPE_INVALID', 'Linear input, weight, and output feature dimensions or dtypes disagree.', path);
      }
      if (bias && (bias.shape[0].value !== outFeatures || bias.dtype !== weight.dtype)) {
        fail('TORCH_EXPORT_SHAPE_INVALID', 'Linear bias shape or dtype does not match the weight.', path + '.args[2]');
      }
      if (bias && inputsById.get(bias.id)?.spec.dtype !== weight.dtype) fail('TORCH_EXPORT_SHAPE_INVALID', 'Linear bias graph input dtype differs from the weight.', path + '.args[2]');
      expectedSpec = {
        dtype: currentSpec.dtype,
        shape: [currentSpec.shape[0], { kind: 'static', value: outFeatures }],
      };
      linearCount += 1;
    } else if (node.target === 'aten.softmax.int') {
      if ((args.length !== 2 && args.length !== 3) || args[1]?.kind !== 'scalar'
        || ![-1, 1].includes(args[1].value) || (args.length === 3 && args[2] !== null)) {
        fail('TORCH_EXPORT_ARGUMENT_INVALID', 'Softmax supports only the last axis and the input dtype.', path + '.args');
      }
      expectedSpec = currentSpec;
    } else {
      if (args.length !== 1) fail('TORCH_EXPORT_ARGUMENT_INVALID', 'Activation operators accept one tensor argument.', path + '.args');
      expectedSpec = currentSpec;
    }
    if (node.metadata.dtype !== expectedSpec.dtype || !sameJson(node.metadata.shape, expectedSpec.shape)) {
      fail('TORCH_EXPORT_SHAPE_INVALID', 'Operator metadata differs from the inferred tensor result.', path + '.metadata');
    }
    current = { kind: 'node', id: node.id };
    currentSpec = expectedSpec;
  }
  if (linearCount === 0) fail('TORCH_EXPORT_GRAPH_INVALID', 'At least one Linear operator is required.', '$.graph.nodes');
  if (usedParameters.size !== parametersById.size) fail('TORCH_EXPORT_STATE_INVALID', 'Every parameter must be consumed exactly once.', '$.state.parameters');
  const output = document.graph.outputs[0];
  if (!output.value || output.value.kind !== current.kind || output.value.id !== current.id || !sameJson(output.spec, currentSpec)) {
    fail('TORCH_EXPORT_OUTPUT_UNSUPPORTED', 'Output must match the final inferred chain tensor.', '$.graph.outputs[0]');
  }
}

function canonicalDocumentContent(document) {
  const { documentFingerprint: _fingerprint, ...content } = document;
  return content;
}

function assertDocumentSize(document) {
  let serialized;
  try { serialized = JSON.stringify(document); } catch { fail('TORCH_EXPORT_DOCUMENT_INVALID', 'Document is not JSON serializable.', '$'); }
  if (serialized.length > MAX_TORCH_EXPORT_DOCUMENT_CODE_UNITS) {
    fail('TORCH_EXPORT_DOCUMENT_LIMIT', 'Torch Export document exceeds the size bound.', '$');
  }
}

/** Validate, clone, and return a strict normalized TorchExportDocumentV1. */
export function validateTorchExportDocument(value) {
  if (!isRecord(value)) fail('TORCH_EXPORT_DOCUMENT_INVALID', 'Document root must be a plain object.', '$');
  assertDocumentSize(value);
  let document;
  try { document = structuredClone(value); } catch { fail('TORCH_EXPORT_DOCUMENT_INVALID', 'Document cannot be cloned as JSON data.', '$'); }
  validateDocumentShape(document);
  validateLineage(document);
  const expectedFingerprint = artifactFingerprintJsonV1(canonicalDocumentContent(document));
  if (document.documentFingerprint !== expectedFingerprint) {
    fail('TORCH_EXPORT_FINGERPRINT_MISMATCH', 'Document fingerprint does not match its normalized content.', '$.documentFingerprint');
  }
  return document;
}

function componentIdForTarget(target) {
  return ({
    'aten.linear.default': 'dense_node',
    'aten.relu.default': 'relu_node',
    'aten.sigmoid.default': 'sigmoid_node',
    'aten.tanh.default': 'tanh_node',
    'aten.softmax.int': 'softmax_node',
  })[target];
}

function nodeParameters(node, document) {
  if (node.target !== 'aten.linear.default') return node.target === 'aten.softmax.int' ? { axis: -1 } : {};
  const weight = document.state.parameters.find((item) => item.id === node.args[1].id);
  return {
    input_features: weight.shape[1].value,
    units: weight.shape[0].value,
    use_bias: node.args[2] !== null,
  };
}

/** Deterministically materialize the validated source document as a VOLK graph. */
export function materializeTorchExportDocument(value) {
  const document = validateTorchExportDocument(value);
  const nodes = [];
  let edges = [];
  const inputNode = createAgentNode({
    nodes,
    manifest: componentById.get('tensor_input_node'),
    request: {
      id: 'torch-input-0',
      position: { x: 120, y: 220 },
      parameters: {
        shape: String(document.graph.inputs.find((input) => input.kind === 'USER_INPUT').spec.shape[1].value),
        dtype: document.graph.inputs.find((input) => input.kind === 'USER_INPUT').spec.dtype,
      },
    },
  });
  nodes.push(inputNode);
  let prior = { node: inputNode, handle: 'tensor' };
  let edgeIndex = 0;
  for (const [index, sourceNode] of document.graph.nodes.entries()) {
    const manifest = componentById.get(componentIdForTarget(sourceNode.target));
    if (!manifest) fail('TORCH_EXPORT_COMPONENT_UNAVAILABLE', 'Required registered VOLK component is unavailable.', '$.graph.nodes[' + index + ']');
    const node = createAgentNode({
      nodes,
      manifest,
      request: {
        id: 'torch-op-' + String(index).padStart(3, '0'),
        position: { x: 420 + index * 300, y: 220 },
        parameters: nodeParameters(sourceNode, document),
      },
    });
    nodes.push(node);
    edges = connectAgentNodes(nodes, edges, {
      id: 'torch-edge-' + String(edgeIndex++).padStart(3, '0'),
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
      id: 'torch-output-0',
      position: { x: 420 + document.graph.nodes.length * 300, y: 220 },
    },
  });
  nodes.push(outputNode);
  edges = connectAgentNodes(nodes, edges, {
    id: 'torch-edge-' + String(edgeIndex).padStart(3, '0'),
    source: prior.node.id,
    sourceHandle: prior.handle,
    target: outputNode.id,
    targetHandle: 'input',
  });
  return { nodes, edges, componentDefinitions: [] };
}
