import { assessConnection } from '../connections.js';
import {
  canonicalGraphLayoutJsonV1,
  canonicalGraphSemanticsJsonV1,
  fingerprintJsonV1,
  graphIdentityV1,
  MAX_GRAPH_COMPONENT_DEFINITIONS,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_NODES,
} from './identity.js';
import {
  canonicalizeWorkspaceGraphCandidate,
  createGraphCapabilitySnapshot,
} from './workspaceProposal.js';

export const GRAPH_PATCH_PROPOSAL_TYPE = 'GraphPatchProposalV1';
export const GRAPH_PATCH_PROPOSAL_VERSION = 1;
export const MAX_GRAPH_PATCH_OPERATIONS = 64;

const SOURCE_PRODUCERS = ['local-agent', 'external-agent', 'human', 'adapter', 'project-transform'];
const SOURCE_LOCATIONS = ['generated', 'local-project', 'local-file', 'inline', 'unknown'];
const ROOT_FIELDS = [
  'type', 'version', 'proposalId', 'source', 'baseGraph', 'baseGraphIdentity',
  'baseGraphFingerprint', 'operations', 'expectedResultGraphIdentity',
  'expectedResultFingerprint', 'rationale', 'validation', 'capabilitySnapshot',
  'authority', 'requiresUserAcceptance',
];
const GRAPH_IDENTITY_FIELDS = ['version', 'semanticFingerprint', 'presentationFingerprint'];
const VALIDATION_FIELDS = [
  'version', 'status', 'baseGraph', 'operationReplay', 'resultGraph',
  'capabilitySnapshot', 'operationCount', 'revalidateBeforeApply',
];

export class GraphPatchProposalError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GraphPatchProposalError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new GraphPatchProposalError(code, message, details);
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype);
}

function rejectUnknown(value, allowed, path) {
  if (!isRecord(value)) fail('GRAPH_PATCH_INVALID', 'Expected a plain object.', { path });
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) fail('GRAPH_PATCH_INVALID', 'Unexpected field.', { path, field: unknown });
}

function boundedText(value, path, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail('GRAPH_PATCH_INVALID', 'Expected bounded non-empty text.', { path, max });
  }
  return value.trim();
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

function stableJsonString(value) {
  return JSON.stringify(stableJson(value));
}

function safeDetails(details) {
  if (!isRecord(details)) return undefined;
  const allowed = new Set([
    'path', 'field', 'reason', 'nodeId', 'edgeId', 'componentId', 'operationIndex',
    'sourceType', 'targetType', 'max', 'maxNodes', 'maxEdges', 'maxDefinitions',
    'maxOperations',
  ]);
  const entries = Object.entries(details).filter(([key, value]) => (
    allowed.has(key)
    && (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
      || (typeof value === 'string' && value.length <= 160))
  ));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function failureResult(error) {
  const code = /^[A-Z][A-Z0-9_]{2,95}$/.test(error?.code ?? '')
    ? error.code
    : 'GRAPH_PATCH_INVALID';
  const details = safeDetails(error?.details);
  return { code, ...(details ? { details } : {}) };
}

function canonicalCandidate(graph, path) {
  const result = canonicalizeWorkspaceGraphCandidate(graph);
  if (!result.valid) {
    const issue = result.diagnostics?.[0] ?? {};
    fail(issue.code ?? 'GRAPH_PATCH_GRAPH_INVALID', 'Graph failed canonical project validation.', {
      ...(issue.details ?? {}),
      path: issue.details?.path ?? path,
    });
  }
  return result;
}

function validateGraphIdentity(actual, expected, path) {
  rejectUnknown(actual, GRAPH_IDENTITY_FIELDS, path);
  if (actual.version !== 1) fail('GRAPH_PATCH_IDENTITY_VERSION_UNSUPPORTED', 'Graph identity version is unsupported.', { path });
  if (
    actual.semanticFingerprint !== expected.semanticFingerprint
    || actual.presentationFingerprint !== expected.presentationFingerprint
  ) fail('GRAPH_PATCH_GRAPH_IDENTITY_MISMATCH', 'Graph identity differs from the recomputed graph.', { path });
}

function graphPatchFingerprint(identity, scope) {
  return fingerprintJsonV1(identity, scope === 'base' ? 'graph-patch-base' : 'graph-patch-result');
}

function validateRationale(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || value !== value.trim()) {
    fail('GRAPH_PATCH_RATIONALE_INVALID', 'Rationale must not include surrounding whitespace.');
  }
  return value;
}

function validationFacts(materialized) {
  return {
    version: 1,
    status: 'validated',
    baseGraph: 'canonical-project-contract',
    operationReplay: 'ordered-detached-replay',
    resultGraph: 'canonical-project-contract',
    capabilitySnapshot: 'recomputed-current-registry',
    operationCount: materialized.operations.length,
    revalidateBeforeApply: true,
  };
}

function validateValidationFacts(actual, expected) {
  rejectUnknown(actual, VALIDATION_FIELDS, 'validation');
  if (stableJsonString(actual) !== stableJsonString(expected)) {
    fail('GRAPH_PATCH_VALIDATION_MISMATCH', 'Proposal-time validation facts differ from recomputed checks.');
  }
}

function validateOpaqueReference(value, path, max = 160) {
  const text = boundedText(value, path, max);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text)) {
    fail('GRAPH_PATCH_SOURCE_INVALID', 'Provenance references must be opaque identifiers, not paths or prose.', { path });
  }
}

function validateSource(source) {
  rejectUnknown(source, ['producer', 'provenance'], 'source');
  if (!SOURCE_PRODUCERS.includes(source.producer)) {
    fail('GRAPH_PATCH_SOURCE_INVALID', 'Proposal source producer is unsupported.');
  }
  rejectUnknown(source.provenance, [
    'artifactId', 'revision', 'fingerprint', 'references', 'location',
  ], 'source.provenance');
  const provenance = source.provenance;
  if (!['artifactId', 'revision', 'fingerprint', 'references'].some((field) => provenance[field] !== undefined)) {
    fail('GRAPH_PATCH_SOURCE_INVALID', 'Proposal provenance must include a bounded reference.');
  }
  for (const field of ['artifactId', 'revision', 'fingerprint']) {
    if (provenance[field] !== undefined) validateOpaqueReference(provenance[field], 'source.provenance.' + field, field === 'revision' ? 96 : 160);
  }
  if (provenance.references !== undefined) {
    if (!Array.isArray(provenance.references) || provenance.references.length > 16) {
      fail('GRAPH_PATCH_SOURCE_INVALID', 'Provenance references exceed their bound.', { path: 'source.provenance.references' });
    }
    provenance.references.forEach((reference, index) => (
      validateOpaqueReference(reference, 'source.provenance.references[' + index + ']', 120)
    ));
    if (new Set(provenance.references).size !== provenance.references.length) {
      fail('GRAPH_PATCH_SOURCE_INVALID', 'Provenance references must be unique.', { path: 'source.provenance.references' });
    }
  }
  if (provenance.location !== undefined && !SOURCE_LOCATIONS.includes(provenance.location)) {
    fail('GRAPH_PATCH_SOURCE_INVALID', 'Provenance location is unsupported.', { path: 'source.provenance.location' });
  }
}

function exactPosition(value, path) {
  rejectUnknown(value, ['x', 'y'], path);
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    fail('GRAPH_PATCH_OPERATION_INVALID', 'Node position must contain finite coordinates.', { path });
  }
}

function validateOperations(operations, baseGraph) {
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > MAX_GRAPH_PATCH_OPERATIONS) {
    fail('GRAPH_PATCH_OPERATIONS_OUT_OF_BOUNDS', 'Patch operation count is out of bounds.', {
      maxOperations: MAX_GRAPH_PATCH_OPERATIONS,
    });
  }
  const availableDefinitions = new Map(baseGraph.componentDefinitions.map((definition) => [definition.id, definition]));
  return operations.map((operation, index) => {
    const path = 'operations[' + index + ']';
    if (!isRecord(operation) || typeof operation.op !== 'string') {
      fail('GRAPH_PATCH_OPERATION_INVALID', 'Patch operation requires a string op.', { path, operationIndex: index });
    }
    if (operation.op === 'REPLACE_SUBGRAPH') {
      fail('GRAPH_PATCH_OPERATION_UNSUPPORTED', 'REPLACE_SUBGRAPH is reserved for a later contract version.', { path, operationIndex: index });
    }
    const requireNodeId = () => boundedText(operation.nodeId, path + '.nodeId');
    switch (operation.op) {
      case 'ADD_NODE': {
        rejectUnknown(operation, ['op', 'node', 'componentDefinitions'], path);
        if (!isRecord(operation.node)) fail('GRAPH_PATCH_OPERATION_INVALID', 'ADD_NODE requires one canonical graph node.', { path });
        if (!Array.isArray(operation.componentDefinitions)
          || operation.componentDefinitions.length > MAX_GRAPH_COMPONENT_DEFINITIONS) {
          fail('GRAPH_PATCH_OPERATION_INVALID', 'ADD_NODE component definitions are out of bounds.', { path });
        }
        const providedDefinitions = operation.componentDefinitions;
        const providedIds = new Set();
        providedDefinitions.forEach((definition) => {
          if (typeof definition?.id !== 'string' || !definition.id.trim()
            || providedIds.has(definition.id) || availableDefinitions.has(definition.id)) {
            fail('GRAPH_PATCH_COMPONENT_DEFINITION_DUPLICATE', 'ADD_NODE definitions must have new unique IDs.', {
              componentId: definition?.id,
              path,
            });
          }
          providedIds.add(definition.id);
        });
        const combinedDefinitions = [...availableDefinitions.values(), ...structuredClone(providedDefinitions)];
        const rootManifest = operation.node.data?.manifest;
        if (rootManifest?.customComposite === true
          && !combinedDefinitions.some((definition) => definition.id === rootManifest.id)) {
          fail('GRAPH_COMPONENT_DEFINITION_MISSING', 'ADD_NODE custom composites must reference an available canonical definition.', {
            componentId: rootManifest.id,
            path,
          });
        }
        const requiredDefinitions = referencedCustomDefinitions({
          nodes: [operation.node],
          componentDefinitions: combinedDefinitions,
        });
        const requiredIds = new Set(requiredDefinitions.map((definition) => definition.id));
        const unusedDefinition = providedDefinitions.find((definition) => !requiredIds.has(definition.id));
        if (unusedDefinition) {
          fail('GRAPH_PATCH_COMPONENT_DEFINITION_UNUSED', 'ADD_NODE may carry only definitions required by the added node.', {
            componentId: unusedDefinition.id,
            path,
          });
        }
        const candidate = canonicalCandidate({
          nodes: [operation.node],
          edges: [],
          componentDefinitions: requiredDefinitions,
        }, path + '.node');
        const normalizedDefinitions = candidate.graph.componentDefinitions;
        normalizedDefinitions.forEach((definition) => {
          if (!availableDefinitions.has(definition.id)) availableDefinitions.set(definition.id, definition);
        });
        return {
          op: operation.op,
          node: candidate.graph.nodes[0],
          componentDefinitions: normalizedDefinitions.filter((definition) => providedIds.has(definition.id)),
        };
      }
      case 'REMOVE_NODE':
        rejectUnknown(operation, ['op', 'nodeId'], path);
        return { op: operation.op, nodeId: requireNodeId() };
      case 'UPDATE_PARAMETERS':
        rejectUnknown(operation, ['op', 'nodeId', 'parameters'], path);
        if (!isRecord(operation.parameters)) {
          fail('GRAPH_PATCH_OPERATION_INVALID', 'UPDATE_PARAMETERS requires a parameter override object.', { path });
        }
        fingerprintJsonV1(operation.parameters, 'graph-patch-parameters');
        return { op: operation.op, nodeId: requireNodeId(), parameters: structuredClone(operation.parameters) };
      case 'CONNECT': {
        rejectUnknown(operation, ['op', 'edge'], path);
        if (!isRecord(operation.edge)) fail('GRAPH_PATCH_OPERATION_INVALID', 'CONNECT requires a complete edge.', { path });
        rejectUnknown(operation.edge, ['id', 'source', 'sourceHandle', 'target', 'targetHandle', 'type'], path + '.edge');
        for (const field of ['id', 'source', 'sourceHandle', 'target', 'targetHandle']) {
          boundedText(operation.edge[field], path + '.edge.' + field);
        }
        if (operation.edge.type !== 'deletable') {
          fail('GRAPH_PATCH_OPERATION_INVALID', 'CONNECT edge type must be deletable.', { path });
        }
        return structuredClone(operation);
      }
      case 'DISCONNECT':
        rejectUnknown(operation, ['op', 'edgeId'], path);
        return { op: operation.op, edgeId: boundedText(operation.edgeId, path + '.edgeId') };
      case 'MOVE_NODE': {
        rejectUnknown(operation, ['op', 'nodeId', 'position'], path);
        exactPosition(operation.position, path + '.position');
        return {
          op: operation.op,
          nodeId: requireNodeId(),
          position: { x: operation.position.x, y: operation.position.y },
        };
      }
      default:
        fail('GRAPH_PATCH_OPERATION_UNSUPPORTED', 'Patch operation is not supported in GraphPatchProposalV1.', {
          path,
          operationIndex: index,
        });
    }
  });
}

function requireNode(graph, nodeId, index) {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) fail('GRAPH_PATCH_NODE_NOT_FOUND', 'Patch operation references a missing node.', {
    nodeId,
    operationIndex: index,
  });
  return node;
}

function connectionFailure(reason, operationIndex, edge) {
  const codes = {
    missingNode: 'GRAPH_PATCH_EDGE_NODE_MISSING',
    self: 'GRAPH_PATCH_EDGE_SELF',
    missingPort: 'GRAPH_PATCH_EDGE_PORT_INVALID',
    type: 'GRAPH_PATCH_EDGE_PORT_TYPE_MISMATCH',
    occupied: 'GRAPH_PATCH_EDGE_INPUT_OCCUPIED',
    cycle: 'GRAPH_PATCH_EDGE_CYCLE',
  };
  fail(codes[reason] ?? 'GRAPH_PATCH_EDGE_INVALID', 'CONNECT is invalid under current graph connection rules.', {
    edgeId: edge.id,
    reason,
    operationIndex,
  });
}

function connect(graph, edge, operationIndex) {
  if (graph.edges.some((candidate) => candidate.id === edge.id)) {
    fail('GRAPH_PATCH_DUPLICATE_EDGE_ID', 'CONNECT edge ID already exists.', { edgeId: edge.id, operationIndex });
  }
  const source = graph.nodes.find((candidate) => candidate.id === edge.source);
  const target = graph.nodes.find((candidate) => candidate.id === edge.target);
  if (!source || !target) connectionFailure('missingNode', operationIndex, edge);
  if (!source.data.manifest.outputs.some((port) => port.name === edge.sourceHandle)
    || !target.data.manifest.inputs.some((port) => port.name === edge.targetHandle)) {
    connectionFailure('missingPort', operationIndex, edge);
  }
  const assessment = assessConnection(edge, graph.nodes, graph.edges);
  if (!assessment.valid) connectionFailure(assessment.reason, operationIndex, edge);
  graph.edges.push(structuredClone(edge));
}

function referencedCustomDefinitions(graph) {
  const definitionsById = new Map(graph.componentDefinitions.map((definition) => [definition.id, definition]));
  const selected = new Map();
  const pending = graph.nodes.map((node) => node.data.manifest.id);
  while (pending.length && selected.size < MAX_GRAPH_COMPONENT_DEFINITIONS) {
    const id = pending.pop();
    if (selected.has(id)) continue;
    const manifest = definitionsById.get(id)
      ?? graph.nodes.find((node) => node.data.manifest.id === id)?.data.manifest;
    if (!manifest?.customComposite) continue;
    selected.set(id, manifest);
    for (const child of manifest.composition?.nodes ?? []) {
      if (definitionsById.has(child.componentId) || child.manifest?.customComposite) pending.push(child.componentId);
    }
  }
  return [...selected.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function replayOperations(baseGraph, operations) {
  const graph = structuredClone(baseGraph);
  operations.forEach((operation, operationIndex) => {
    switch (operation.op) {
      case 'ADD_NODE': {
        if (graph.nodes.length >= MAX_GRAPH_NODES) {
          fail('GRAPH_PATCH_GRAPH_OUT_OF_BOUNDS', 'ADD_NODE would exceed the graph node limit.', {
            maxNodes: MAX_GRAPH_NODES,
            operationIndex,
          });
        }
        const nodeId = operation.node?.id;
        if (typeof nodeId !== 'string' || !nodeId.trim()) {
          fail('GRAPH_PATCH_OPERATION_INVALID', 'ADD_NODE requires a node identity.', { operationIndex });
        }
        if (graph.nodes.some((node) => node.id === nodeId)) {
          fail('GRAPH_PATCH_DUPLICATE_NODE_ID', 'ADD_NODE node ID already exists.', { nodeId, operationIndex });
        }
        if (graph.componentDefinitions.length + operation.componentDefinitions.length > MAX_GRAPH_COMPONENT_DEFINITIONS) {
          fail('GRAPH_PATCH_GRAPH_OUT_OF_BOUNDS', 'ADD_NODE would exceed the component definition limit.', {
            maxDefinitions: MAX_GRAPH_COMPONENT_DEFINITIONS,
            operationIndex,
          });
        }
        const existingDefinitionIds = new Set(graph.componentDefinitions.map((definition) => definition.id));
        for (const definition of operation.componentDefinitions) {
          if (typeof definition?.id !== 'string' || !definition.id.trim() || existingDefinitionIds.has(definition.id)) {
            fail('GRAPH_PATCH_COMPONENT_DEFINITION_DUPLICATE', 'ADD_NODE component definitions must have new unique IDs.', {
              componentId: definition?.id,
              operationIndex,
            });
          }
          existingDefinitionIds.add(definition.id);
          graph.componentDefinitions.push(structuredClone(definition));
        }
        graph.nodes.push(structuredClone(operation.node));
        const referencedIds = new Set(referencedCustomDefinitions(graph).map((definition) => definition.id));
        const unusedDefinition = operation.componentDefinitions.find((definition) => !referencedIds.has(definition.id));
        if (unusedDefinition) {
          fail('GRAPH_PATCH_COMPONENT_DEFINITION_UNUSED', 'ADD_NODE may carry only definitions required by the resulting graph.', {
            componentId: unusedDefinition.id,
            operationIndex,
          });
        }
        break;
      }
      case 'REMOVE_NODE': {
        const node = requireNode(graph, operation.nodeId, operationIndex);
        if (graph.edges.some((edge) => edge.source === node.id || edge.target === node.id)) {
          fail('GRAPH_PATCH_NODE_HAS_EDGES', 'Disconnect every incident edge before removing a node.', {
            nodeId: node.id,
            operationIndex,
          });
        }
        graph.nodes = graph.nodes.filter((candidate) => candidate.id !== node.id);
        break;
      }
      case 'UPDATE_PARAMETERS': {
        const node = requireNode(graph, operation.nodeId, operationIndex);
        node.data = { ...node.data, parameters: structuredClone(operation.parameters), status: 'idle' };
        break;
      }
      case 'CONNECT':
        if (graph.edges.length >= MAX_GRAPH_EDGES) {
          fail('GRAPH_PATCH_GRAPH_OUT_OF_BOUNDS', 'CONNECT would exceed the graph edge limit.', {
            maxEdges: MAX_GRAPH_EDGES,
            operationIndex,
          });
        }
        connect(graph, operation.edge, operationIndex);
        break;
      case 'DISCONNECT': {
        const edgeIndex = graph.edges.findIndex((edge) => edge.id === operation.edgeId);
        if (edgeIndex < 0) {
          fail('GRAPH_PATCH_EDGE_NOT_FOUND', 'DISCONNECT references a missing edge.', {
            edgeId: operation.edgeId,
            operationIndex,
          });
        }
        graph.edges.splice(edgeIndex, 1);
        break;
      }
      case 'MOVE_NODE': {
        const node = requireNode(graph, operation.nodeId, operationIndex);
        node.position = { ...operation.position };
        break;
      }
      default:
        fail('GRAPH_PATCH_OPERATION_UNSUPPORTED', 'Patch operation is not supported in GraphPatchProposalV1.', {
          operationIndex,
        });
    }
  });
  graph.componentDefinitions = referencedCustomDefinitions(graph);
  return graph;
}

function materializePatch(baseGraphInput, operationsInput) {
  const base = canonicalCandidate(baseGraphInput, 'baseGraph');
  const operations = validateOperations(operationsInput, base.graph);
  const baseIdentity = graphIdentityV1(base.graph);
  const resultCandidate = canonicalCandidate(replayOperations(base.graph, operations), 'resultGraph');
  const capabilitySnapshot = createGraphCapabilitySnapshot(resultCandidate.graph);
  const baseGraphFingerprint = graphPatchFingerprint(baseIdentity, 'base');
  const expectedResultFingerprint = graphPatchFingerprint(resultCandidate.graphIdentity, 'result');
  return {
    baseGraph: base.graph,
    baseGraphIdentity: baseIdentity,
    baseGraphFingerprint,
    operations,
    resultGraph: resultCandidate.graph,
    expectedResultGraphIdentity: resultCandidate.graphIdentity,
    expectedResultFingerprint,
    capabilitySnapshot,
  };
}

function proposalIdentity(proposal) {
  const { proposalId: _proposalId, ...envelope } = proposal;
  return fingerprintJsonV1(envelope, 'graph-patch-proposal');
}

function validateInternal(value) {
  fingerprintJsonV1(value, 'graph-patch-input');
  rejectUnknown(value, ROOT_FIELDS, 'proposal');
  if (value.type !== GRAPH_PATCH_PROPOSAL_TYPE || value.version !== GRAPH_PATCH_PROPOSAL_VERSION) {
    fail('GRAPH_PATCH_VERSION_UNSUPPORTED', 'Graph patch proposal type or version is unsupported.');
  }
  boundedText(value.proposalId, 'proposal.proposalId', 160);
  validateSource(value.source);
  validateRationale(value.rationale);
  if (value.authority !== 'detached-proposal' || value.requiresUserAcceptance !== true) {
    fail('GRAPH_PATCH_AUTHORITY_INVALID', 'Graph patch proposals require detached user acceptance.');
  }
  const materialized = materializePatch(value.baseGraph, value.operations);
  validateGraphIdentity(value.baseGraphIdentity, materialized.baseGraphIdentity, 'baseGraphIdentity');
  validateGraphIdentity(value.expectedResultGraphIdentity, materialized.expectedResultGraphIdentity, 'expectedResultGraphIdentity');
  if (value.baseGraphFingerprint !== materialized.baseGraphFingerprint) {
    fail('GRAPH_PATCH_FINGERPRINT_MISMATCH', 'Base graph fingerprint differs from the recomputed semantic and presentation identity.', {
      path: 'baseGraphFingerprint',
    });
  }
  if (value.expectedResultFingerprint !== materialized.expectedResultFingerprint) {
    fail('GRAPH_PATCH_FINGERPRINT_MISMATCH', 'Expected result fingerprint differs from the replayed semantic and presentation identity.', {
      path: 'expectedResultFingerprint',
    });
  }
  validateValidationFacts(value.validation, validationFacts(materialized));
  if (!isRecord(value.capabilitySnapshot)
    || stableJsonString(value.capabilitySnapshot) !== stableJsonString(materialized.capabilitySnapshot)) {
    fail('GRAPH_PATCH_CAPABILITY_SNAPSHOT_MISMATCH', 'Capabilities differ from current graph-only capabilities.');
  }
  if (value.proposalId !== proposalIdentity(value)) {
    fail('GRAPH_PATCH_IDENTITY_MISMATCH', 'Proposal identity does not match its contents.');
  }
  return { ...materialized, proposal: structuredClone(value) };
}

/** Replay a bounded patch into a detached graph. This never reads or mutates a workspace. */
export function dryRunGraphPatch(baseGraph, operations) {
  try {
    const result = materializePatch(baseGraph, operations);
    return {
      ok: true,
      graph: structuredClone(result.resultGraph),
      graphIdentity: structuredClone(result.expectedResultGraphIdentity),
      capabilitySnapshot: structuredClone(result.capabilitySnapshot),
    };
  } catch (error) {
    return { ok: false, diagnostics: [failureResult(error)] };
  }
}

/** Create a detached proposal whose ordered operations are replayed at validation time. */
export function createGraphPatchProposal({ baseGraph, operations, source, rationale } = {}) {
  try {
    validateSource(source);
    const boundedRationale = validateRationale(rationale);
    const materialized = materializePatch(baseGraph, operations);
    const validation = validationFacts(materialized);
    const proposalWithoutId = {
      type: GRAPH_PATCH_PROPOSAL_TYPE,
      version: GRAPH_PATCH_PROPOSAL_VERSION,
      source: structuredClone(source),
      rationale: boundedRationale,
      baseGraph: structuredClone(materialized.baseGraph),
      baseGraphIdentity: structuredClone(materialized.baseGraphIdentity),
      baseGraphFingerprint: materialized.baseGraphFingerprint,
      operations: structuredClone(materialized.operations),
      expectedResultGraphIdentity: structuredClone(materialized.expectedResultGraphIdentity),
      expectedResultFingerprint: materialized.expectedResultFingerprint,
      validation,
      capabilitySnapshot: structuredClone(materialized.capabilitySnapshot),
      authority: 'detached-proposal',
      requiresUserAcceptance: true,
    };
    const proposal = { ...proposalWithoutId, proposalId: proposalIdentity(proposalWithoutId) };
    const checked = validateGraphPatchProposal(proposal);
    if (!checked.valid) {
      const issue = checked.diagnostics[0];
      fail(issue.code, 'Constructed graph patch failed validation.', issue.details ?? {});
    }
    return {
      ok: true,
      proposal: checked.proposal,
      resultGraph: checked.resultGraph,
      resultGraphIdentity: checked.graphIdentity,
      capabilitySnapshot: checked.capabilitySnapshot,
    };
  } catch (error) {
    return { ok: false, diagnostics: [failureResult(error)] };
  }
}

/** Recompute the base, ordered result, live registry contract and capabilities. */
export function validateGraphPatchProposal(value) {
  try {
    const result = validateInternal(value);
    return {
      valid: true,
      proposal: result.proposal,
      resultGraph: structuredClone(result.resultGraph),
      graphIdentity: structuredClone(result.expectedResultGraphIdentity),
      capabilitySnapshot: structuredClone(result.capabilitySnapshot),
    };
  } catch (error) {
    return { valid: false, diagnostics: [failureResult(error)] };
  }
}

/** Revalidate current contracts and, when supplied, compare with the latest detached target graph. */
export function revalidateGraphPatchProposal(value, options = {}) {
  try {
    rejectUnknown(options, ['currentBaseGraph'], 'options');
    const checked = validateGraphPatchProposal(value);
    if (!checked.valid || options.currentBaseGraph === undefined) return checked;
    const currentBase = canonicalCandidate(options.currentBaseGraph, 'currentBaseGraph');
    const proposalBase = canonicalCandidate(checked.proposal.baseGraph, 'baseGraph');
    if (
      canonicalGraphSemanticsJsonV1(currentBase.graph) !== canonicalGraphSemanticsJsonV1(proposalBase.graph)
      || canonicalGraphLayoutJsonV1(currentBase.graph) !== canonicalGraphLayoutJsonV1(proposalBase.graph)
    ) {
      fail('GRAPH_PATCH_BASE_STALE', 'The current graph no longer matches the patch base.');
    }
    return checked;
  } catch (error) {
    return { valid: false, diagnostics: [failureResult(error)] };
  }
}
