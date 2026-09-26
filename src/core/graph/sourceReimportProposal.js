import { defaults } from '../components.js';
import { compileGraphWithSourceManifest, validateSourceExportManifest } from '../compiler.js';
import {
  assertSourceExportManifestBounded,
  sha256Utf8,
  SOURCE_EXPORT_LIMITS,
} from '../sourceExportManifest.js';
import { validateProjectForWorkspace } from '../project.js';
import { graphPatchBaseFromProject } from './workspacePatchApply.js';
import { createGraphPatchProposal, dryRunGraphPatch } from './graphPatchProposal.js';
import { canonicalizeWorkspaceGraphCandidate } from './workspaceProposal.js';

export const SOURCE_REIMPORT_VERSION = 1;
export const SOURCE_REIMPORT_LIMITS = Object.freeze({
  maxProjectCodeUnits: 32_000_000,
  maxSourceBytes: SOURCE_EXPORT_LIMITS.maxSourceBytes,
  maxOperations: 64,
  maxAstNodes: 25_000,
  maxAstDepth: 128,
  maxAstStringBytes: 2_000_000,
});

export class SourceReimportError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'SourceReimportError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, details = undefined) {
  throw new SourceReimportError(code, details);
}

function safeDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const allowed = new Set(['nodeId', 'edgeId', 'componentId', 'propertyKey', 'reason', 'max', 'path']);
  const result = Object.fromEntries(Object.entries(details).filter(([key, value]) => (
    allowed.has(key) && (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
      || (typeof value === 'string' && value.length <= 120))
  )));
  return Object.keys(result).length ? result : undefined;
}

function failResult(error, fallback = 'SOURCE_REIMPORT_INTERNAL_ERROR') {
  const code = /^[A-Z][A-Z0-9_]{2,95}$/.test(error?.code ?? '') ? error.code : fallback;
  const details = safeDetails(error?.details ?? (error?.name ? { reason: error.name } : undefined));
  return { ok: false, diagnostics: [{ code, ...(details ? { details } : {}) }] };
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype);
}

function boundedSource(value, field) {
  if (typeof value !== 'string') fail('SOURCE_REIMPORT_INPUT_INVALID', { path: field });
  const bytes = new TextEncoder().encode(value).length;
  if (bytes > SOURCE_REIMPORT_LIMITS.maxSourceBytes) {
    fail('SOURCE_REIMPORT_SOURCE_BOUND', { path: field, max: SOURCE_REIMPORT_LIMITS.maxSourceBytes });
  }
}

function cloneAndValidateAst(value) {
  let nodes = 0;
  let stringBytes = 0;
  const ancestors = new WeakSet();
  const visit = (current, depth) => {
    if (depth > SOURCE_REIMPORT_LIMITS.maxAstDepth) fail('SOURCE_REIMPORT_AST_DEPTH');
    if (current === null || typeof current === 'boolean' || typeof current === 'number') {
      if (typeof current === 'number' && !Number.isFinite(current)) fail('SOURCE_REIMPORT_AST_INVALID');
      return current;
    }
    if (typeof current === 'string') {
      stringBytes += new TextEncoder().encode(current).length;
      if (stringBytes > SOURCE_REIMPORT_LIMITS.maxAstStringBytes) fail('SOURCE_REIMPORT_AST_BOUND');
      return current;
    }
    if (!current || typeof current !== 'object' || ancestors.has(current)) fail('SOURCE_REIMPORT_AST_INVALID');
    if (!Array.isArray(current) && !isRecord(current)) fail('SOURCE_REIMPORT_AST_INVALID');
    ancestors.add(current);
    let result;
    if (Array.isArray(current)) {
      nodes += current.length;
      if (nodes > SOURCE_REIMPORT_LIMITS.maxAstNodes) fail('SOURCE_REIMPORT_AST_NODE_BOUND');
      result = current.map((item) => visit(item, depth + 1));
    } else {
      nodes += 1;
      if (nodes > SOURCE_REIMPORT_LIMITS.maxAstNodes) fail('SOURCE_REIMPORT_AST_NODE_BOUND');
      const keys = Object.keys(current);
      if (current.type !== undefined && (typeof current.type !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(current.type))) {
        fail('SOURCE_REIMPORT_AST_INVALID');
      }
      if (current.type === undefined && keys.some((key) => !['startLine', 'startColumnByte', 'endLine', 'endColumnByte'].includes(key))) {
        fail('SOURCE_REIMPORT_AST_INVALID');
      }
      result = Object.fromEntries(keys.map((key) => {
        if (key.length > 80) fail('SOURCE_REIMPORT_AST_INVALID');
        return [key, visit(current[key], depth + 1)];
      }));
    }
    ancestors.delete(current);
    return result;
  };
  return visit(value, 0);
}

function normalizedAst(value) {
  if (Array.isArray(value)) return value.map(normalizedAst);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).filter((key) => key !== 'location').sort()
    .map((key) => [key, normalizedAst(value[key])]));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function equal(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function ast(type, fields = {}) {
  return { type, ...fields };
}

function requireType(value, type, code = 'SOURCE_REIMPORT_AST_UNSUPPORTED') {
  if (!isRecord(value) || value.type !== type) fail(code);
  return value;
}

function findUnique(values, predicate, code) {
  const matches = values.filter(predicate);
  if (matches.length !== 1) fail(code);
  return matches[0];
}

function safeName(value) {
  return `n_${String(value).replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

const LAYER_INIT_OPS = new Set([
  'dense', 'conv2d', 'max_pool2d', 'relu', 'gelu', 'sigmoid', 'tanh', 'softmax', 'dropout',
  'batch_norm1d', 'batch_norm2d', 'layer_norm', 'embedding', 'lstm', 'gru',
  'multihead_attention', 'mlp_block', 'conv_block', 'residual_mlp_block',
]);

const PARAMETER_CONSTRUCTORS = Object.freeze({
  dense: { name: 'Linear', positional: ['input_features', 'units'], keywords: { bias: 'use_bias' } },
  conv2d: {
    name: 'Conv2d', positional: ['input_channels', 'filters'],
    keywords: { kernel_size: 'kernel_size', stride: 'stride', padding: 'padding', bias: 'use_bias' },
  },
  max_pool2d: { name: 'MaxPool2d', positional: [], keywords: { kernel_size: 'pool_size', stride: 'stride' } },
  softmax: { name: 'Softmax', positional: [], keywords: { dim: 'axis' } },
  dropout: { name: 'Dropout', positional: [], keywords: { p: 'rate' } },
  batch_norm1d: { name: 'BatchNorm1d', positional: ['features'], keywords: { momentum: 'momentum' } },
  batch_norm2d: { name: 'BatchNorm2d', positional: ['channels'], keywords: { momentum: 'momentum' } },
  layer_norm: { name: 'LayerNorm', positional: ['normalized_shape'], keywords: {} },
});

function isIdentifier(value) {
  return isRecord(value) && value.type === 'Name' && typeof value.id === 'string';
}

function isAttribute(value, baseName, attribute) {
  return isRecord(value) && value.type === 'Attribute' && value.attr === attribute
    && isIdentifier(value.value) && value.value.id === baseName;
}

function isCall(value, functionPredicate) {
  return isRecord(value) && value.type === 'Call' && functionPredicate(value.func)
    && Array.isArray(value.args) && Array.isArray(value.keywords);
}

function astLiteral(value) {
  if (!isRecord(value)) fail('SOURCE_REIMPORT_LITERAL_UNSUPPORTED');
  if (value.type === 'Constant') {
    if (value.value === null || typeof value.value === 'boolean' || typeof value.value === 'string') return value.value;
    if (typeof value.value === 'number' && Number.isFinite(value.value)) return value.value;
    fail('SOURCE_REIMPORT_LITERAL_UNSUPPORTED');
  }
  if (value.type === 'UnaryOp' && ['USub', 'UAdd'].includes(value.op?.type)) {
    const operand = astLiteral(value.operand);
    if (typeof operand !== 'number') fail('SOURCE_REIMPORT_LITERAL_UNSUPPORTED');
    return value.op.type === 'USub' ? -operand : operand;
  }
  if (value.type === 'Tuple' || value.type === 'List') {
    if (!Array.isArray(value.elts)) fail('SOURCE_REIMPORT_LITERAL_UNSUPPORTED');
    return value.elts.map(astLiteral);
  }
  fail('SOURCE_REIMPORT_LITERAL_UNSUPPORTED');
}

function exactConstructorCall(value, constructorName) {
  return isCall(value, (func) => isAttribute(func, 'nn', constructorName));
}

function decodeConstructorParameters(node, call) {
  const mapping = PARAMETER_CONSTRUCTORS[node.data.manifest.op];
  if (!mapping || !exactConstructorCall(call, mapping.name)) fail('SOURCE_REIMPORT_PARAMETER_MAPPING_UNSUPPORTED', { nodeId: node.id });
  if (call.args.length !== mapping.positional.length) fail('SOURCE_REIMPORT_PARAMETER_CONSTRUCT_INVALID', { nodeId: node.id });
  const parameters = {};
  mapping.positional.forEach((key, index) => { parameters[key] = astLiteral(call.args[index]); });
  const seen = new Set();
  for (const keyword of call.keywords) {
    if (typeof keyword.arg !== 'string' || !Object.hasOwn(mapping.keywords, keyword.arg) || seen.has(keyword.arg)) {
      fail('SOURCE_REIMPORT_PARAMETER_CONSTRUCT_INVALID', { nodeId: node.id });
    }
    seen.add(keyword.arg);
    parameters[mapping.keywords[keyword.arg]] = astLiteral(keyword.value);
  }
  for (const constructorKeyword of Object.keys(mapping.keywords)) {
    if (!seen.has(constructorKeyword)) fail('SOURCE_REIMPORT_PARAMETER_CONSTRUCT_INVALID', { nodeId: node.id });
  }
  if (node.data.manifest.op === 'conv2d') {
    const kernel = parameters.kernel_size;
    const paddingValue = parameters.padding;
    if (!Number.isInteger(kernel) || !Number.isInteger(paddingValue)) fail('SOURCE_REIMPORT_PARAMETER_CONSTRUCT_INVALID', { nodeId: node.id });
    const candidates = [];
    if (paddingValue === Math.floor(kernel / 2)) candidates.push('same');
    if (paddingValue === 0) candidates.push('valid');
    const currentPadding = node.data.parameters.padding;
    const currentExpected = currentPadding === 'same' ? Math.floor(kernel / 2) : currentPadding === 'valid' ? 0 : null;
    if (currentExpected === paddingValue) parameters.padding = currentPadding;
    else if (candidates.length === 1) parameters.padding = candidates[0];
    else fail('SOURCE_REIMPORT_PADDING_AMBIGUOUS', { nodeId: node.id });
  }
  if (node.data.manifest.op === 'layer_norm') {
    if (!Array.isArray(parameters.normalized_shape) || !parameters.normalized_shape.length
      || parameters.normalized_shape.some((dimension) => !Number.isSafeInteger(dimension) || dimension <= 0)) {
      fail('SOURCE_REIMPORT_PARAMETER_CONSTRUCT_INVALID', { nodeId: node.id });
    }
    parameters.normalized_shape = parameters.normalized_shape.join(', ');
  }
  return parameters;
}

function effectiveParameters(node) {
  return { ...defaults(node.data.manifest), ...(node.data.parameters ?? {}) };
}

function validateMappedParameterTypes(node, parameters) {
  const integerKeys = new Set([
    'input_features', 'units', 'input_channels', 'filters', 'kernel_size', 'stride', 'pool_size',
    'axis', 'features', 'channels',
  ]);
  const positiveDimensionKeys = new Set([
    'input_features', 'units', 'input_channels', 'filters', 'kernel_size', 'stride', 'pool_size',
    'features', 'channels',
  ]);
  for (const [key, value] of Object.entries(parameters)) {
    if (integerKeys.has(key) && !Number.isSafeInteger(value)) fail('SOURCE_REIMPORT_PARAMETER_TYPE_INVALID', { nodeId: node.id, propertyKey: key });
    if (positiveDimensionKeys.has(key) && value <= 0) fail('SOURCE_REIMPORT_SHAPE_INCOMPATIBLE', { nodeId: node.id, propertyKey: key });
  }
}

function findProjectNodeIdByAttribute(name, nameToId) {
  const id = nameToId.get(name);
  if (!id) fail('SOURCE_REIMPORT_NODE_ID_UNMAPPED');
  return id;
}

function getModuleParts(root) {
  requireType(root, 'Module');
  if (!Array.isArray(root.body)) fail('SOURCE_REIMPORT_AST_UNSUPPORTED');
  const model = findUnique(root.body, (entry) => entry?.type === 'ClassDef' && entry.name === 'VOLKModel', 'SOURCE_REIMPORT_MODEL_CLASS_INVALID');
  if (!Array.isArray(model.body)) fail('SOURCE_REIMPORT_MODEL_CLASS_INVALID');
  const init = findUnique(model.body, (entry) => entry?.type === 'FunctionDef' && entry.name === '__init__', 'SOURCE_REIMPORT_MODEL_INIT_INVALID');
  const forward = findUnique(model.body, (entry) => entry?.type === 'FunctionDef' && entry.name === 'forward', 'SOURCE_REIMPORT_MODEL_FORWARD_INVALID');
  if (model.body.length !== 2 || !Array.isArray(init.body) || !Array.isArray(forward.body)) fail('SOURCE_REIMPORT_MODEL_CLASS_INVALID');
  return { model, init, forward };
}

function assignmentTargetName(statement) {
  if (statement?.type !== 'Assign' || !Array.isArray(statement.targets) || statement.targets.length !== 1) return null;
  const target = statement.targets[0];
  if (!isIdentifier(target)) return null;
  return target.id;
}

function layerAssignmentId(statement, nameToNodeId) {
  if (statement?.type !== 'Assign' || !Array.isArray(statement.targets) || statement.targets.length !== 1) return null;
  const target = statement.targets[0];
  if (target?.type !== 'Attribute' || !isIdentifier(target.value) || target.value.id !== 'self') return null;
  if (!statement.value || statement.value.type !== 'Call') fail('SOURCE_REIMPORT_LAYER_INIT_INVALID');
  return findProjectNodeIdByAttribute(target.attr, nameToNodeId);
}

function lineMatches(span, statement) {
  return span.startLine === statement?.location?.startLine
    && span.endLine === statement?.location?.endLine;
}

function validateManifestNodeOrigins(baseGraph, manifest, forwardByNodeId, initByNodeId) {
  const nodeById = new Map(baseGraph.nodes.map((node) => [node.id, node]));
  const selectedIds = new Set(manifest.selection.includedWorkspaceNodeIds);
  const mappingsById = new Map();
  for (const mapping of manifest.nodeMappings) {
    if (!selectedIds.has(mapping.workspaceNodeId)) continue;
    if (mapping.compositionPath.length !== 0) fail('SOURCE_REIMPORT_COMPOSITE_UNSUPPORTED', { nodeId: mapping.workspaceNodeId });
    const node = nodeById.get(mapping.workspaceNodeId);
    if (!node || mapping.componentId !== node.data.manifest.id || mapping.operation !== node.data.manifest.op) {
      fail('SOURCE_REIMPORT_PROVENANCE_NODE_MISMATCH', { nodeId: mapping.workspaceNodeId });
    }
    if (!mappingsById.has(mapping.workspaceNodeId)) mappingsById.set(mapping.workspaceNodeId, []);
    mappingsById.get(mapping.workspaceNodeId).push(mapping);
  }
  for (const id of manifest.selection.includedWorkspaceNodeIds) {
    const node = nodeById.get(id);
    if (!node) fail('SOURCE_REIMPORT_PROVENANCE_NODE_MISMATCH', { nodeId: id });
    if (node.data.manifest.customComposite === true || !mappingsById.has(id)) fail('SOURCE_REIMPORT_COMPOSITE_UNSUPPORTED', { nodeId: id });
    const forward = forwardByNodeId.get(id);
    if (['source', 'layer', 'merge', 'sink'].includes(node.data.manifest.kind)) {
      if (!forward) fail('SOURCE_REIMPORT_PROVENANCE_NODE_MISMATCH', { nodeId: id });
      const constructs = mappingsById.get(id).flatMap((mapping) => mapping.constructs)
        .filter((construct) => construct.role === 'forward-operation');
      if (constructs.length !== 1 || !lineMatches(constructs[0].span, forward)) {
        fail('SOURCE_REIMPORT_PROVENANCE_SPAN_MISMATCH', { nodeId: id });
      }
    }
    const init = initByNodeId.get(id);
    const initConstructs = mappingsById.get(id).flatMap((mapping) => mapping.constructs)
      .filter((construct) => construct.role === 'layer-definition');
    if (init) {
      if (initConstructs.length !== 1 || !lineMatches(initConstructs[0].span, init)) {
        fail('SOURCE_REIMPORT_PROVENANCE_SPAN_MISMATCH', { nodeId: id });
      }
    } else if (initConstructs.length) {
      fail('SOURCE_REIMPORT_PROVENANCE_SPAN_MISMATCH', { nodeId: id });
    }
  }
}

function validateManifestEdgeOrigins(baseGraph, manifest, forwardByNodeId) {
  const selectedEdges = new Set(manifest.selection.includedWorkspaceEdgeIds);
  const graphEdges = new Map(baseGraph.edges.map((edge) => [edge.id, edge]));
  const mappedEdges = new Map();
  for (const mapping of manifest.edgeMappings) {
    if (mapping.kind !== 'workspace-edge' || !selectedEdges.has(mapping.workspaceEdgeId)) continue;
    if (!graphEdges.has(mapping.workspaceEdgeId)) fail('SOURCE_REIMPORT_PROVENANCE_EDGE_MISMATCH', { edgeId: mapping.workspaceEdgeId });
    if (!mappedEdges.has(mapping.workspaceEdgeId)) mappedEdges.set(mapping.workspaceEdgeId, []);
    mappedEdges.get(mapping.workspaceEdgeId).push(mapping);
  }
  for (const edgeId of selectedEdges) {
    const edge = graphEdges.get(edgeId);
    const mapping = mappedEdges.get(edgeId) ?? [];
    const targetForward = forwardByNodeId.get(edge.target);
    const constructs = mapping.flatMap((entry) => entry.constructs).filter((entry) => entry.role === 'forward-operation');
    if (mapping.length !== 1 || constructs.length !== 1 || !targetForward || !lineMatches(constructs[0].span, targetForward)) {
      fail('SOURCE_REIMPORT_PROVENANCE_SPAN_MISMATCH', { edgeId });
    }
  }
}

function createIdentityMaps(baseGraph, manifest) {
  const selected = new Set(manifest.selection.includedWorkspaceNodeIds);
  const workspaceNodes = baseGraph.nodes.filter((node) => selected.has(node.id));
  const nameToNodeId = new Map();
  const variableToNodeId = new Map();
  for (const node of workspaceNodes) {
    const safe = safeName(node.id);
    if (nameToNodeId.has(safe)) fail('SOURCE_REIMPORT_NODE_NAME_COLLISION', { nodeId: node.id });
    nameToNodeId.set(safe, node.id);
    variableToNodeId.set(`v_${safe}`, node.id);
    if (node.data.manifest.op === 'tensor_input') variableToNodeId.set(safe, node.id);
  }
  return { selected, workspaceNodes, nameToNodeId, variableToNodeId };
}

function extractLayerInitializers(initFunction, nameToNodeId, baseGraph) {
  const statements = initFunction.body;
  if (statements.length < 1) fail('SOURCE_REIMPORT_MODEL_INIT_INVALID');
  const superInit = ast('Expr', { value: ast('Call', {
    func: ast('Attribute', {
      value: ast('Call', { func: ast('Name', { id: 'super', ctx: ast('Load') }), args: [], keywords: [] }),
      attr: '__init__',
      ctx: ast('Load'),
    }),
    args: [], keywords: [],
  }) });
  if (!equal(normalizedAst(statements[0]), normalizedAst(superInit))) fail('SOURCE_REIMPORT_MODEL_INIT_INVALID');
  const nodeById = new Map(baseGraph.nodes.map((node) => [node.id, node]));
  const byNodeId = new Map();
  for (const statement of statements.slice(1)) {
    if (statement.type === 'Pass') continue;
    const nodeId = layerAssignmentId(statement, nameToNodeId);
    if (byNodeId.has(nodeId)) fail('SOURCE_REIMPORT_LAYER_INIT_INVALID', { nodeId });
    const node = nodeById.get(nodeId);
    if (!node || !LAYER_INIT_OPS.has(node.data.manifest.op)) fail('SOURCE_REIMPORT_LAYER_INIT_INVALID', { nodeId });
    byNodeId.set(nodeId, statement);
  }
  const expected = baseGraph.nodes.filter((node) => (
    nameToNodeId.has(safeName(node.id)) && LAYER_INIT_OPS.has(node.data.manifest.op)
  )).map((node) => node.id);
  if (byNodeId.size !== expected.length || expected.some((id) => !byNodeId.has(id))) {
    fail('SOURCE_REIMPORT_LAYER_INIT_INVALID');
  }
  return byNodeId;
}

function extractForwardAssignments(forwardFunction, nameToNodeId) {
  if (forwardFunction.body.length < 1) fail('SOURCE_REIMPORT_MODEL_FORWARD_INVALID');
  const assignments = forwardFunction.body.slice(0, -1);
  const finalStatement = forwardFunction.body.at(-1);
  if (finalStatement?.type !== 'Return') fail('SOURCE_REIMPORT_MODEL_FORWARD_INVALID');
  const byNodeId = new Map();
  for (const statement of assignments) {
    if (statement.type !== 'Assign') fail('SOURCE_REIMPORT_MODEL_FORWARD_INVALID');
    const target = assignmentTargetName(statement);
    if (!target?.startsWith('v_')) fail('SOURCE_REIMPORT_MODEL_FORWARD_INVALID');
    const safe = target.slice(2);
    const nodeId = findProjectNodeIdByAttribute(safe, nameToNodeId);
    if (byNodeId.has(nodeId)) fail('SOURCE_REIMPORT_MODEL_FORWARD_INVALID', { nodeId });
    byNodeId.set(nodeId, statement);
  }
  return { byNodeId, finalStatement };
}

function sourceReferences(expression, variableToNodeId) {
  const refs = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    if (value.type === 'Name' && variableToNodeId.has(value.id)) refs.push({ name: value.id, nodeId: variableToNodeId.get(value.id) });
    Object.entries(value).forEach(([key, child]) => { if (key !== 'location') visit(child); });
  };
  visit(expression);
  return refs;
}

function expressionSkeleton(expression, variableToNodeId) {
  const copy = cloneAndValidateAst(expression);
  const replace = (value) => {
    if (Array.isArray(value)) return value.map(replace);
    if (!isRecord(value)) return value;
    if (value.type === 'Name' && variableToNodeId.has(value.id)) {
      return { ...value, id: '<SOURCE_REFERENCE>', location: undefined };
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      key === 'location' ? undefined : replace(child),
    ]));
  };
  return normalizedAst(replace(copy));
}

function requiredReferenceCount(node) {
  const op = node.data.manifest.op;
  if (op === 'tensor_input') return 1;
  if (['add', 'concatenate'].includes(op)) return 2;
  if (op === 'reshape') return 2;
  if (op === 'multihead_attention') return 3;
  return 1;
}

function sourceNodeReferencesForInputs(node, edges) {
  const incoming = edges.filter((edge) => edge.target === node.id);
  const ports = node.data.manifest.inputs.map((port) => port.name);
  if (incoming.length !== ports.length || ports.some((port) => incoming.filter((edge) => edge.targetHandle === port).length !== 1)) {
    fail('SOURCE_REIMPORT_GRAPH_INCOMPLETE', { nodeId: node.id });
  }
  const byPort = new Map(incoming.map((edge) => [edge.targetHandle, edge.source]));
  return ports.map((port) => byPort.get(port));
}

function expectedReferenceIds(node, inputSourceIds) {
  const op = node.data.manifest.op;
  if (op === 'tensor_input') return [node.id];
  if (op === 'reshape') return [inputSourceIds[0], inputSourceIds[0]];
  if (op === 'multihead_attention') return [inputSourceIds[0], inputSourceIds[0], inputSourceIds[0]];
  if (['add', 'concatenate'].includes(op)) return inputSourceIds;
  return inputSourceIds.slice(0, 1);
}

function extractParameterChanges(baseGraph, originalInit, editedInit, nodeById) {
  const changes = new Map();
  for (const [nodeId, editedStatement] of editedInit) {
    const originalStatement = originalInit.get(nodeId);
    if (!originalStatement) fail('SOURCE_REIMPORT_PROVENANCE_NODE_MISMATCH', { nodeId });
    if (equal(normalizedAst(originalStatement), normalizedAst(editedStatement))) continue;
    const node = nodeById.get(nodeId);
    const mapping = PARAMETER_CONSTRUCTORS[node.data.manifest.op];
    if (!mapping) fail('SOURCE_REIMPORT_PARAMETER_MAPPING_UNSUPPORTED', { nodeId });
    const parameters = decodeConstructorParameters(node, editedStatement.value);
    validateMappedParameterTypes(node, parameters);
    const current = effectiveParameters(node);
    const differs = Object.entries(parameters).filter(([key, value]) => !Object.is(current[key], value));
    if (differs.length) changes.set(nodeId, Object.fromEntries(differs));
  }
  return changes;
}

function validateInputEdgesAndCollectRewires({ baseGraph, originalForward, editedForward, variableToNodeId, nodeById }) {
  const rewires = [];
  for (const [nodeId, editedStatement] of editedForward) {
    const node = nodeById.get(nodeId);
    const originalStatement = originalForward.get(nodeId);
    if (!node || !originalStatement) fail('SOURCE_REIMPORT_PROVENANCE_NODE_MISMATCH', { nodeId });
    const originalReferences = sourceReferences(originalStatement.value, variableToNodeId);
    const editedReferences = sourceReferences(editedStatement.value, variableToNodeId);
    const expectedSources = sourceNodeReferencesForInputs(node, baseGraph.edges);
    const expectedOriginal = expectedReferenceIds(node, expectedSources);
    if (originalReferences.length !== requiredReferenceCount(node)
      || originalReferences.some((reference, index) => reference.nodeId !== expectedOriginal[index])) {
      fail('SOURCE_REIMPORT_PROVENANCE_EDGE_MISMATCH', { nodeId });
    }
    if (node.data.manifest.op === 'tensor_input') {
      if (!equal(normalizedAst(originalStatement.value), normalizedAst(editedStatement.value))) {
        fail('SOURCE_REIMPORT_INPUT_SIGNATURE_UNSUPPORTED', { nodeId });
      }
      continue;
    }
    if (editedReferences.length !== requiredReferenceCount(node)
      || !equal(expressionSkeleton(originalStatement.value, variableToNodeId), expressionSkeleton(editedStatement.value, variableToNodeId))) {
      fail('SOURCE_REIMPORT_FORWARD_EDIT_UNSUPPORTED', { nodeId });
    }
    if (['reshape', 'multihead_attention'].includes(node.data.manifest.op)
      && editedReferences.some((reference) => reference.nodeId !== editedReferences[0].nodeId)) {
      fail('SOURCE_REIMPORT_FORWARD_EDIT_UNSUPPORTED', { nodeId });
    }
    const ports = node.data.manifest.inputs.map((port) => port.name);
    const changed = [];
    if (['add', 'concatenate'].includes(node.data.manifest.op)) {
      for (let index = 0; index < ports.length; index += 1) {
        if (editedReferences[index].nodeId !== expectedSources[index]) {
          changed.push({ targetHandle: ports[index], sourceNodeId: editedReferences[index].nodeId });
        }
      }
    } else if (editedReferences[0].nodeId !== expectedSources[0]) {
      changed.push({ targetHandle: ports[0], sourceNodeId: editedReferences[0].nodeId });
    }
    changed.forEach((entry) => rewires.push({ nodeId, ...entry }));
  }
  return rewires;
}

function staticShape(shapeText) {
  if (typeof shapeText !== 'string' || !shapeText.trim()) return null;
  const parts = shapeText.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.some((part) => !/^\d+$/.test(part))) return null;
  const shape = parts.map(Number);
  if (!shape.length || shape.some((dimension) => !Number.isSafeInteger(dimension) || dimension <= 0)) return null;
  return shape;
}

function shapeGuard(nodes, edges, order) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  edges.forEach((edge) => incoming.get(edge.target)?.push(edge));
  const shapes = new Map();
  const issues = [];
  const partial = new Set();
  const markUnknown = (node, reason) => {
    shapes.set(node.id, null);
    partial.add(reason);
  };
  const inputShape = (node) => staticShape(node.data.parameters?.shape);
  for (const id of order) {
    const node = nodeById.get(id);
    if (!node) continue;
    const op = node.data.manifest.op;
    const parameters = effectiveParameters(node);
    const connected = incoming.get(id) ?? [];
    const inputShapes = connected.map((edge) => shapes.get(edge.source) ?? null);
    if (op === 'tensor_input') {
      const shape = inputShape(node);
      if (!shape) partial.add('input-shape-not-static');
      shapes.set(id, shape);
      continue;
    }
    if (['loss', 'optimizer'].includes(node.data.manifest.kind)) continue;
    if (op === 'model_output') {
      shapes.set(id, inputShapes[0] ? [...inputShapes[0]] : null);
      if (!inputShapes[0]) partial.add('upstream-shape-unknown');
      continue;
    }
    const first = inputShapes[0] ?? null;
    if (op === 'dense') {
      if (first && (first.length < 1 || first.at(-1) !== parameters.input_features)) {
        issues.push({ code: 'SOURCE_REIMPORT_SHAPE_INCOMPATIBLE', nodeId: id, reason: 'dense-input-features' });
      }
      if (first) shapes.set(id, [...first.slice(0, -1), parameters.units]);
      else markUnknown(node, 'dense-input-shape-unknown');
      continue;
    }
    if (op === 'conv2d') {
      if (first && (first.length !== 3 || first[0] !== parameters.input_channels)) {
        issues.push({ code: 'SOURCE_REIMPORT_SHAPE_INCOMPATIBLE', nodeId: id, reason: 'conv2d-input-shape' });
        shapes.set(id, null);
        continue;
      }
      if (!first) { markUnknown(node, 'conv2d-input-shape-unknown'); continue; }
      const padding = parameters.padding === 'same' ? Math.floor(parameters.kernel_size / 2) : 0;
      const output = first.slice(1).map((dimension) => Math.floor((dimension + 2 * padding - parameters.kernel_size) / parameters.stride) + 1);
      if (output.some((dimension) => dimension <= 0)) {
        issues.push({ code: 'SOURCE_REIMPORT_SHAPE_INCOMPATIBLE', nodeId: id, reason: 'conv2d-empty-output' });
        shapes.set(id, null);
      } else shapes.set(id, [parameters.filters, ...output]);
      continue;
    }
    if (op === 'max_pool2d') {
      if (first && first.length !== 3) {
        issues.push({ code: 'SOURCE_REIMPORT_SHAPE_INCOMPATIBLE', nodeId: id, reason: 'maxpool-input-rank' });
        shapes.set(id, null);
        continue;
      }
      if (!first) { markUnknown(node, 'maxpool-input-shape-unknown'); continue; }
      const output = first.slice(1).map((dimension) => Math.floor((dimension - parameters.pool_size) / parameters.stride) + 1);
      if (output.some((dimension) => dimension <= 0)) {
        issues.push({ code: 'SOURCE_REIMPORT_SHAPE_INCOMPATIBLE', nodeId: id, reason: 'maxpool-empty-output' });
        shapes.set(id, null);
      } else shapes.set(id, [first[0], ...output]);
      continue;
    }
    if (op === 'batch_norm1d') {
      if (first && (first.length < 1 || first[0] !== parameters.features)) {
        issues.push({ code: 'SOURCE_REIMPORT_SHAPE_INCOMPATIBLE', nodeId: id, reason: 'batchnorm1d-features' });
      }
      shapes.set(id, first ? [...first] : null);
      if (!first) partial.add('batchnorm1d-input-shape-unknown');
      continue;
    }
    if (op === 'batch_norm2d') {
      if (first && (first.length !== 3 || first[0] !== parameters.channels)) {
        issues.push({ code: 'SOURCE_REIMPORT_SHAPE_INCOMPATIBLE', nodeId: id, reason: 'batchnorm2d-shape' });
      }
      shapes.set(id, first ? [...first] : null);
      if (!first) partial.add('batchnorm2d-input-shape-unknown');
      continue;
    }
    if (op === 'layer_norm') {
      const normalized = staticShape(parameters.normalized_shape);
      if (first && (!normalized || normalized.length > first.length
        || normalized.some((dimension, index) => dimension !== first[first.length - normalized.length + index]))) {
        issues.push({ code: 'SOURCE_REIMPORT_SHAPE_INCOMPATIBLE', nodeId: id, reason: 'layernorm-shape' });
      }
      shapes.set(id, first ? [...first] : null);
      if (!first) partial.add('layernorm-input-shape-unknown');
      continue;
    }
    if (op === 'softmax') {
      if (first) {
        const rank = first.length + 1;
        if (parameters.axis < -rank || parameters.axis >= rank) {
          issues.push({ code: 'SOURCE_REIMPORT_SHAPE_INCOMPATIBLE', nodeId: id, reason: 'softmax-axis' });
        }
      }
      shapes.set(id, first ? [...first] : null);
      if (!first) partial.add('softmax-input-shape-unknown');
      continue;
    }
    if (op === 'flatten') {
      if (first) shapes.set(id, [first.reduce((product, dimension) => product * dimension, 1)]);
      else markUnknown(node, 'flatten-input-shape-unknown');
      continue;
    }
    if (op === 'add') {
      const left = inputShapes[0];
      const right = inputShapes[1];
      if (left && right) {
        const rank = Math.max(left.length, right.length);
        const output = Array(rank);
        let compatible = true;
        for (let offset = 1; offset <= rank; offset += 1) {
          const a = left.at(-offset) ?? 1;
          const b = right.at(-offset) ?? 1;
          if (a !== b && a !== 1 && b !== 1) { compatible = false; break; }
          output[rank - offset] = Math.max(a, b);
        }
        if (!compatible) {
          issues.push({ code: 'SOURCE_REIMPORT_SHAPE_INCOMPATIBLE', nodeId: id, reason: 'add-input-shapes' });
          shapes.set(id, null);
        } else shapes.set(id, output);
      } else {
        shapes.set(id, left ? [...left] : right ? [...right] : null);
        partial.add('add-input-shape-unknown');
      }
      continue;
    }
    if (op === 'concatenate') {
      const left = inputShapes[0];
      const right = inputShapes[1];
      const tensorRank = (left?.length ?? right?.length ?? 0) + 1;
      let axis = parameters.axis;
      if (axis < 0) axis += tensorRank;
      const featureAxis = axis - 1;
      if (left && right && (axis < 0 || axis >= tensorRank || left.length !== right.length
        || left.some((dimension, index) => index !== featureAxis && dimension !== right[index]))) {
        issues.push({ code: 'SOURCE_REIMPORT_SHAPE_INCOMPATIBLE', nodeId: id, reason: 'concatenate-input-shapes' });
        shapes.set(id, null);
      } else if (left && right && featureAxis >= 0 && featureAxis < left.length) {
        const output = [...left];
        output[featureAxis] += right[featureAxis];
        shapes.set(id, output);
      } else {
        shapes.set(id, null);
        partial.add('concatenate-shape-unproven');
      }
      continue;
    }
    if (['relu', 'gelu', 'sigmoid', 'tanh', 'softmax', 'dropout'].includes(op)) {
      shapes.set(id, first ? [...first] : null);
      if (!first) partial.add(`${op}-input-shape-unknown`);
      continue;
    }
    // Recurrent, attention, reshape, and packed composite operators are deliberately
    // not shape-proved in v1. Their unchanged source may still round-trip exactly.
    shapes.set(id, null);
    partial.add(`${op}-shape-unproven`);
  }
  return {
    status: issues.length ? 'incompatible' : partial.size ? 'partially-proven' : 'proven-compatible',
    issues,
    partialReasons: [...partial].sort(),
  };
}

function assertSupportedGraph(baseGraph, manifest) {
  if (manifest.framework !== 'pytorch' || manifest.selection.rule !== 'model-output-dependencies') {
    fail('SOURCE_REIMPORT_GRAPH_CLASS_UNSUPPORTED');
  }
  const included = new Set(manifest.selection.includedWorkspaceNodeIds);
  const nodeById = new Map(baseGraph.nodes.map((node) => [node.id, node]));
  for (const id of included) {
    const node = nodeById.get(id);
    if (!node || node.data.manifest.customComposite === true) fail('SOURCE_REIMPORT_COMPOSITE_UNSUPPORTED', { nodeId: id });
  }
  if (manifest.unmapped.some((entry) => entry.kind === 'node' && included.has(entry.key))) {
    fail('SOURCE_REIMPORT_GRAPH_CLASS_UNSUPPORTED');
  }
  return nodeById;
}

function astModel(root, identityMaps, baseGraph) {
  const { init, forward } = getModuleParts(root);
  const initializers = extractLayerInitializers(init, identityMaps.nameToNodeId, baseGraph);
  const forwards = extractForwardAssignments(forward, identityMaps.nameToNodeId);
  return { initializers, forwards };
}

function collectOperations({
  baseGraph, manifest, originalAst, editedAst, identityMaps, nodeById,
}) {
  const originalModel = astModel(originalAst, identityMaps, baseGraph);
  const editedModel = astModel(editedAst, identityMaps, baseGraph);
  if (originalModel.forwards.byNodeId.size !== editedModel.forwards.byNodeId.size
    || [...originalModel.forwards.byNodeId.keys()].some((id) => !editedModel.forwards.byNodeId.has(id))) {
    fail('SOURCE_REIMPORT_NODE_TOPOLOGY_UNSUPPORTED');
  }
  if (originalModel.initializers.size !== editedModel.initializers.size
    || [...originalModel.initializers.keys()].some((id) => !editedModel.initializers.has(id))) {
    fail('SOURCE_REIMPORT_NODE_TOPOLOGY_UNSUPPORTED');
  }

  validateManifestNodeOrigins(baseGraph, manifest, originalModel.forwards.byNodeId, originalModel.initializers);
  const parameterChanges = extractParameterChanges(baseGraph, originalModel.initializers, editedModel.initializers, nodeById);
  const rewires = validateInputEdgesAndCollectRewires({
    baseGraph,
    originalForward: originalModel.forwards.byNodeId,
    editedForward: editedModel.forwards.byNodeId,
    variableToNodeId: identityMaps.variableToNodeId,
    nodeById,
  });
  return { parameterChanges, rewires, originalModel, editedModel };
}

function deterministicEdgeId(baseEdge, newSourceId, targetHandle, sourceHash, reserved) {
  const identity = `${sourceHash}\0${baseEdge.id}\0${newSourceId}\0${baseEdge.target}\0${targetHandle}`;
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const root = `source-reimport-${hash.toString(16).padStart(8, '0')}`;
  let result = root;
  let suffix = 1;
  while (reserved.has(result)) result = `${root}-${suffix++}`;
  reserved.add(result);
  return result;
}

function operationsForChanges({ baseGraph, parameterChanges, rewires, sourceHash }) {
  const nodeById = new Map(baseGraph.nodes.map((node) => [node.id, node]));
  const operations = [];
  for (const [nodeId, changes] of parameterChanges) {
    const node = nodeById.get(nodeId);
    const parameters = { ...defaults(node.data.manifest), ...(node.data.parameters ?? {}), ...changes };
    operations.push({ op: 'UPDATE_PARAMETERS', nodeId, parameters });
  }
  const reserved = new Set(baseGraph.edges.map((edge) => edge.id));
  for (const rewire of rewires) {
    const baseEdge = baseGraph.edges.find((edge) => edge.target === rewire.nodeId && edge.targetHandle === rewire.targetHandle);
    if (!baseEdge) fail('SOURCE_REIMPORT_GRAPH_INCOMPLETE', { nodeId: rewire.nodeId });
    const sourceNode = nodeById.get(rewire.sourceNodeId);
    if (!sourceNode) fail('SOURCE_REIMPORT_NODE_ID_UNMAPPED', { nodeId: rewire.sourceNodeId });
    const outputs = sourceNode.data.manifest.outputs;
    if (!Array.isArray(outputs) || outputs.length !== 1) fail('SOURCE_REIMPORT_SOURCE_PORT_AMBIGUOUS', { nodeId: sourceNode.id });
    operations.push({ op: 'DISCONNECT', edgeId: baseEdge.id });
    operations.push({
      op: 'CONNECT',
      edge: {
        id: deterministicEdgeId(baseEdge, sourceNode.id, rewire.targetHandle, sourceHash, reserved),
        source: sourceNode.id,
        sourceHandle: outputs[0].name,
        target: baseEdge.target,
        targetHandle: rewire.targetHandle,
        type: 'deletable',
      },
    });
  }
  if (operations.length > SOURCE_REIMPORT_LIMITS.maxOperations) fail('SOURCE_REIMPORT_OPERATION_BOUND');
  return operations;
}

function canonicalProjectCandidate(project, graph) {
  try {
    const candidate = validateProjectForWorkspace({
      ...project,
      graph: { nodes: graph.nodes, edges: graph.edges },
      customComponents: project.customComponents,
      trainedModel: null,
    });
    return candidate;
  } catch {
    fail('SOURCE_REIMPORT_CANDIDATE_PROJECT_INVALID');
  }
}

/** Analyze two provenance-bound generated PyTorch ASTs and produce a detached candidate only. */
export async function analyzeSourceReimport({
  project: inputProject,
  originalSource,
  manifest: inputManifest,
  editedSource,
  originalAst: inputOriginalAst,
  editedAst: inputEditedAst,
} = {}) {
  try {
    boundedSource(originalSource, 'originalSource');
    boundedSource(editedSource, 'editedSource');
    if (typeof inputProject !== 'object' || !inputProject || Array.isArray(inputProject)) fail('SOURCE_REIMPORT_PROJECT_INVALID');
    if (!isRecord(inputManifest)) fail('SOURCE_REIMPORT_MANIFEST_INVALID');
    assertSourceExportManifestBounded(inputManifest);
    if (inputManifest.framework !== 'pytorch') fail('SOURCE_REIMPORT_FRAMEWORK_UNSUPPORTED');

    let project;
    try { project = validateProjectForWorkspace(inputProject); } catch { fail('SOURCE_REIMPORT_PROJECT_INVALID'); }
    const canonicalBase = canonicalizeWorkspaceGraphCandidate(graphPatchBaseFromProject(project));
    if (!canonicalBase.valid) fail('SOURCE_REIMPORT_PROJECT_INVALID', { reason: canonicalBase.diagnostics?.[0]?.code });
    const baseGraph = canonicalBase.graph;
    const originalValidation = await validateSourceExportManifest({
      nodes: baseGraph.nodes,
      edges: baseGraph.edges,
      framework: 'pytorch',
      code: originalSource,
      manifest: inputManifest,
    });
    if (!originalValidation.valid) fail('SOURCE_REIMPORT_ORIGINAL_BINDING_INVALID', { reason: originalValidation.reason });
    const nodeById = assertSupportedGraph(baseGraph, inputManifest);
    const identityMaps = createIdentityMaps(baseGraph, inputManifest);
    const originalAst = cloneAndValidateAst(inputOriginalAst);
    const editedAst = cloneAndValidateAst(inputEditedAst);
    const { initializers: originalInitializers, forwards: originalForwards } = astModel(originalAst, identityMaps, baseGraph);
    validateManifestNodeOrigins(baseGraph, inputManifest, originalForwards.byNodeId, originalInitializers);
    validateManifestEdgeOrigins(baseGraph, inputManifest, originalForwards.byNodeId);
    if (!equal(normalizedAst(originalAst), normalizedAst(editedAst))) {
      const { parameterChanges, rewires } = collectOperations({
        baseGraph, manifest: inputManifest, originalAst, editedAst, identityMaps, nodeById,
      });
      const { forwards: editedForwards } = astModel(editedAst, identityMaps, baseGraph);
      const operations = operationsForChanges({
        baseGraph,
        parameterChanges,
        rewires,
        sourceHash: await sha256Utf8(editedSource),
      });
      if (!operations.length) fail('SOURCE_REIMPORT_UNSUPPORTED_EDIT');
      const dryRun = dryRunGraphPatch(baseGraph, operations);
      if (!dryRun.ok) fail('SOURCE_REIMPORT_PATCH_INVALID', { reason: dryRun.diagnostics?.[0]?.code });
      const candidateProject = canonicalProjectCandidate(project, dryRun.graph);
      const candidateExport = await compileGraphWithSourceManifest(
        candidateProject.graph.nodes,
        candidateProject.graph.edges,
        'pytorch',
      );
      const shape = shapeGuard(dryRun.graph.nodes, dryRun.graph.edges, candidateExport.manifest.selection.effectiveCompilationOrder);
      if (shape.issues.length) {
        fail(shape.issues[0].code, { nodeId: shape.issues[0].nodeId, reason: shape.issues[0].reason });
      }
      return {
        ok: true,
        status: 'candidate',
        candidateSource: candidateExport.code,
        candidateGraph: dryRun.graph,
        operations,
        shapeCompatibility: shape.status,
        shapeLimitations: shape.partialReasons,
        baseGraph,
        editedSourceSha256: await sha256Utf8(editedSource),
        originalSourceSha256: inputManifest.source.sha256,
        manifestSha256: await sha256Utf8(JSON.stringify(stable(inputManifest))),
        semanticGraphFingerprint: canonicalBase.graphIdentity.semanticFingerprint,
      };
    }
    return { ok: true, status: 'no-op', proposal: null, analysis: { operations: 0, shapeCompatibility: 'not-needed' } };
  } catch (error) {
    return failResult(error);
  }
}

/** Require the trusted worker's candidate AST to equal the edited AST before making C1 data. */
export function finalizeSourceReimportProposal(prepared, { candidateAst, editedAst } = {}) {
  try {
    if (!isRecord(prepared) || prepared.ok !== true || prepared.status !== 'candidate'
      || !Array.isArray(prepared.operations) || !isRecord(prepared.baseGraph)) fail('SOURCE_REIMPORT_CANDIDATE_INVALID');
    const canonicalAst = cloneAndValidateAst(candidateAst);
    const userAst = cloneAndValidateAst(editedAst);
    if (!equal(normalizedAst(canonicalAst), normalizedAst(userAst))) fail('SOURCE_REIMPORT_CANONICAL_SOURCE_MISMATCH');
    const shapeCompatibility = prepared.shapeCompatibility;
    const source = {
      producer: 'adapter',
      provenance: {
        artifactId: 'pytorch-source-reimport-v1',
        revision: String(SOURCE_REIMPORT_VERSION),
        fingerprint: `sha256:${prepared.editedSourceSha256}`,
        references: [
          `original:${prepared.originalSourceSha256}`,
          `manifest:${prepared.manifestSha256}`,
          `graph:${prepared.semanticGraphFingerprint}`,
        ],
        location: 'local-file',
      },
    };
    const rationale = `Controlled PyTorch source re-import; static shape check=${shapeCompatibility}; source parsed only, not executed or trained.`;
    const result = createGraphPatchProposal({
      baseGraph: prepared.baseGraph,
      operations: prepared.operations,
      source,
      rationale,
    });
    if (!result.ok) fail('SOURCE_REIMPORT_PATCH_INVALID', { reason: result.diagnostics?.[0]?.code });
    return {
      ok: true,
      status: 'proposal',
      proposal: result.proposal,
      analysis: {
        operationCount: prepared.operations.length,
        shapeCompatibility,
        shapeLimitations: [...prepared.shapeLimitations],
        sourceExecuted: false,
        trainingPerformed: false,
      },
    };
  } catch (error) {
    return failResult(error);
  }
}
