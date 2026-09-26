import { componentById } from './components.js';

export const SOURCE_EXPORT_MANIFEST_TYPE = 'VolkSourceExportManifestV1';
export const SOURCE_EXPORT_MANIFEST_VERSION = 1;
export const SOURCE_EXPORT_COMPILER_CONTRACT_VERSION = 1;

export const SOURCE_EXPORT_LIMITS = Object.freeze({
  maxGraphNodes: 2_048,
  maxGraphEdges: 4_096,
  maxGraphCodeUnits: 2_000_000,
  maxSourceBytes: 600_000,
  maxManifestCodeUnits: 900_000,
  maxMappings: 4_000,
  maxIdentityDepth: 48,
  maxIdentityValues: 100_000,
});

export class SourceExportManifestError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'SourceExportManifestError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, details) {
  throw new SourceExportManifestError(code, details);
}

function assertJsonSafe(value, limits = SOURCE_EXPORT_LIMITS) {
  let values = 0;
  let codeUnits = 0;
  const ancestors = new WeakSet();
  const visit = (current, depth) => {
    values += 1;
    if (values > limits.maxIdentityValues || depth > limits.maxIdentityDepth) fail('SOURCE_EXPORT_GRAPH_BOUND');
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'string') {
      codeUnits += current.length;
      if (codeUnits > limits.maxGraphCodeUnits) fail('SOURCE_EXPORT_GRAPH_BOUND');
      return;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) fail('SOURCE_EXPORT_GRAPH_INVALID');
      return;
    }
    if (!current || typeof current !== 'object' || ancestors.has(current)) fail('SOURCE_EXPORT_GRAPH_INVALID');
    if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype) fail('SOURCE_EXPORT_GRAPH_INVALID');
    ancestors.add(current);
    if (Array.isArray(current)) {
      if (Object.keys(current).length !== current.length) fail('SOURCE_EXPORT_GRAPH_INVALID');
      current.forEach((item) => visit(item, depth + 1));
    } else {
      Object.entries(current).forEach(([key, child]) => {
        codeUnits += key.length;
        if (codeUnits > limits.maxGraphCodeUnits) fail('SOURCE_EXPORT_GRAPH_BOUND');
        visit(child, depth + 1);
      });
    }
    ancestors.delete(current);
  };
  visit(value, 0);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

export function stableSourceJson(value) {
  assertJsonSafe(value);
  const serialized = JSON.stringify(canonicalValue(value));
  if (serialized.length > SOURCE_EXPORT_LIMITS.maxGraphCodeUnits) fail('SOURCE_EXPORT_GRAPH_BOUND');
  return serialized;
}

function semanticManifest(manifest, depth = 0, ancestors = new WeakSet()) {
  if (depth > SOURCE_EXPORT_LIMITS.maxIdentityDepth || !manifest || typeof manifest !== 'object' || Array.isArray(manifest) || ancestors.has(manifest)) {
    fail('SOURCE_EXPORT_GRAPH_INVALID');
  }
  ancestors.add(manifest);
  const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  const ports = (values) => (Array.isArray(values) ? values : []).map((port) => ({ name: port.name, type: port.type }))
    .sort((left, right) => compare(`${left.name}\0${left.type}`, `${right.name}\0${right.type}`));
  const properties = (Array.isArray(manifest.properties) ? manifest.properties : []).map(({ label: _label, ...property }) => property)
    .sort((left, right) => compare(String(left.key), String(right.key)));
  const composition = manifest.composition && Array.isArray(manifest.composition.nodes) && Array.isArray(manifest.composition.edges)
    ? {
      nodes: manifest.composition.nodes.map((node) => ({
        key: node.key,
        componentId: node.componentId,
        manifest: node.manifest || componentById.get(node.componentId)
          ? semanticManifest(node.manifest ?? componentById.get(node.componentId), depth + 1, ancestors)
          : null,
        parameters: node.parameters ?? {},
      })),
      edges: manifest.composition.edges.map((edge) => ({
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        target: edge.target,
        targetHandle: edge.targetHandle,
      })),
      inputs: manifest.composition.inputs ?? {},
      outputs: manifest.composition.outputs ?? {},
    }
    : null;
  ancestors.delete(manifest);
  return {
    schemaVersion: manifest.schemaVersion ?? null,
    id: manifest.id,
    op: manifest.op,
    kind: manifest.kind,
    customComposite: manifest.customComposite === true,
    inputs: ports(manifest.inputs),
    outputs: ports(manifest.outputs),
    properties,
    runtime: manifest.runtime ?? null,
    compatibility: manifest.compatibility ?? null,
    composition,
  };
}

/** Compiler-semantic projection: no layout, viewport, localized copy, status, selection, or dataset rows. */
export function sourceGraphProjectionV1(nodes, edges, { includeOrigins = false } = {}) {
  if (!Array.isArray(nodes) || !Array.isArray(edges)
    || nodes.length > SOURCE_EXPORT_LIMITS.maxGraphNodes
    || edges.length > SOURCE_EXPORT_LIMITS.maxGraphEdges) fail('SOURCE_EXPORT_GRAPH_BOUND');
  const projectedNodes = nodes.map((node) => {
    if (!node || typeof node.id !== 'string' || !node.id || !node.data?.manifest?.id || !node.data?.manifest?.op) {
      fail('SOURCE_EXPORT_GRAPH_INVALID');
    }
    return {
      id: node.id,
      component: semanticManifest(node.data.manifest),
      parameters: node.data.parameters ?? {},
      ...(includeOrigins ? {
        runtimeOwnerId: node.data.runtimeOwnerId ?? node.id,
        compositionPath: node.data.runtimeCompositionPath ?? [],
      } : {}),
    };
  });
  const projectedEdges = edges.map((edge) => {
    if (!edge || typeof edge.id !== 'string' || !edge.id || typeof edge.source !== 'string'
      || typeof edge.sourceHandle !== 'string' || typeof edge.target !== 'string'
      || typeof edge.targetHandle !== 'string') fail('SOURCE_EXPORT_GRAPH_INVALID');
    return {
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
      ...(includeOrigins ? { origin: edge.runtimeSourceExportOrigin ?? null } : {}),
    };
  });
  const projection = {
    nodes: projectedNodes,
    edges: projectedEdges,
    nodeOrder: projectedNodes.map((node) => node.id),
    edgeOrder: projectedEdges.map((edge) => edge.id),
  };
  assertJsonSafe(projection);
  return projection;
}

export async function sha256Utf8(value) {
  if (typeof value !== 'string') fail('SOURCE_EXPORT_HASH_INPUT_INVALID');
  const encoded = new TextEncoder().encode(value);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.digest) fail('SOURCE_EXPORT_CRYPTO_UNAVAILABLE');
  const digest = await subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertManifestString(value, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) fail('SOURCE_EXPORT_MANIFEST_INVALID');
}

function assertStringArray(value, { unique = false } = {}) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item)) {
    fail('SOURCE_EXPORT_MANIFEST_INVALID');
  }
  if (unique && new Set(value).size !== value.length) fail('SOURCE_EXPORT_MANIFEST_INVALID');
}

function assertSpan(span, sourceBytes) {
  if (!isRecord(span) || !Number.isSafeInteger(span.startByte) || !Number.isSafeInteger(span.endByte)
    || span.startByte < 0 || span.endByte <= span.startByte || span.endByte > sourceBytes
    || !Number.isSafeInteger(span.startLine) || span.startLine < 1
    || !Number.isSafeInteger(span.endLine) || span.endLine < span.startLine) {
    fail('SOURCE_EXPORT_SPAN_INVALID');
  }
}

function assertManifestShape(manifest) {
  if (!isRecord(manifest) || manifest.type !== SOURCE_EXPORT_MANIFEST_TYPE
    || manifest.version !== SOURCE_EXPORT_MANIFEST_VERSION
    || !['pytorch', 'tensorflow'].includes(manifest.framework)
    || manifest.identityPolicy !== 'semantic-graph-v1'
    || manifest.presentationPolicy !== 'excluded'
    || !isRecord(manifest.compiler) || !isRecord(manifest.workspace)
    || !isRecord(manifest.selection) || !isRecord(manifest.source)
    || !Array.isArray(manifest.nodeMappings) || !Array.isArray(manifest.edgeMappings)
    || !Array.isArray(manifest.compilerConstructs) || !Array.isArray(manifest.unmapped)) {
    fail('SOURCE_EXPORT_MANIFEST_INVALID');
  }

  if (manifest.compiler.id !== 'volk-ml-canonical-python'
    || manifest.compiler.contractVersion !== SOURCE_EXPORT_COMPILER_CONTRACT_VERSION
    || !Number.isSafeInteger(manifest.compiler.irVersion) || manifest.compiler.irVersion < 1) {
    fail('SOURCE_EXPORT_MANIFEST_INVALID');
  }
  const isSha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!isSha256(manifest.workspace.semanticGraphSha256)
    || !isSha256(manifest.selection.semanticGraphSha256)
    || !isSha256(manifest.source.sha256)) fail('SOURCE_EXPORT_MANIFEST_INVALID');
  if (manifest.source.encoding !== 'utf-8' || !Number.isSafeInteger(manifest.source.byteLength)
    || manifest.source.byteLength < 0 || manifest.source.byteLength > SOURCE_EXPORT_LIMITS.maxSourceBytes) {
    fail('SOURCE_EXPORT_MANIFEST_INVALID');
  }
  const sourceBytes = manifest.source.byteLength;

  assertStringArray(manifest.workspace.nodeIds, { unique: true });
  assertStringArray(manifest.workspace.edgeIds, { unique: true });
  if (!['trainer-dependencies', 'model-output-dependencies', 'connected-tabular-graph', 'connected-graph-fallback', 'all-nodes-fallback'].includes(manifest.selection.rule)) {
    fail('SOURCE_EXPORT_MANIFEST_INVALID');
  }
  for (const field of [
    'expandedNodeIds', 'expandedEdgeIds', 'includedWorkspaceNodeIds', 'excludedWorkspaceNodeIds',
    'includedWorkspaceEdgeIds', 'excludedWorkspaceEdgeIds', 'effectiveCompilationOrder',
  ]) assertStringArray(manifest.selection[field], { unique: true });

  let mappingCount = manifest.compilerConstructs.length;
  if (mappingCount > SOURCE_EXPORT_LIMITS.maxMappings) fail('SOURCE_EXPORT_MANIFEST_BOUND');
  manifest.nodeMappings.forEach((item) => {
    if (!isRecord(item)) fail('SOURCE_EXPORT_MANIFEST_INVALID');
    assertManifestString(item.workspaceNodeId);
    assertManifestString(item.componentId);
    assertManifestString(item.operation);
    assertStringArray(item.compositionPath, { unique: false });
    if (!Array.isArray(item.constructs)) fail('SOURCE_EXPORT_MANIFEST_INVALID');
    mappingCount += item.constructs.length;
    if (mappingCount > SOURCE_EXPORT_LIMITS.maxMappings) fail('SOURCE_EXPORT_MANIFEST_BOUND');
    item.constructs.forEach((construct) => {
      if (!isRecord(construct)) fail('SOURCE_EXPORT_MANIFEST_INVALID');
      assertManifestString(construct.role);
      assertStringArray(construct.edgeRefs, { unique: false });
      assertSpan(construct.span, sourceBytes);
    });
  });
  manifest.edgeMappings.forEach((item) => {
    if (!isRecord(item)) fail('SOURCE_EXPORT_MANIFEST_INVALID');
    assertManifestString(item.id);
    assertManifestString(item.kind);
    assertManifestString(item.sourceNodeId);
    assertManifestString(item.sourceHandle);
    assertManifestString(item.targetNodeId);
    assertManifestString(item.targetHandle);
    if (item.kind === 'workspace-edge') {
      assertManifestString(item.workspaceEdgeId);
      if (item.id !== item.workspaceEdgeId) fail('SOURCE_EXPORT_MANIFEST_INVALID');
    } else if (item.kind === 'composite-edge') {
      assertManifestString(item.instanceNodeId);
      assertStringArray(item.compositionPath, { unique: false });
      if (!Number.isSafeInteger(item.edgeIndex) || item.edgeIndex < 0) fail('SOURCE_EXPORT_MANIFEST_INVALID');
      for (const key of ['sourceKey', 'sourceHandle', 'targetKey', 'targetHandle']) {
        if (item[key] !== undefined && item[key] !== null) assertManifestString(item[key]);
      }
    } else {
      fail('SOURCE_EXPORT_MANIFEST_INVALID');
    }
    if (!Array.isArray(item.constructs)) fail('SOURCE_EXPORT_MANIFEST_INVALID');
    mappingCount += item.constructs.length;
    if (mappingCount > SOURCE_EXPORT_LIMITS.maxMappings) fail('SOURCE_EXPORT_MANIFEST_BOUND');
    item.constructs.forEach((construct) => {
      if (!isRecord(construct)) fail('SOURCE_EXPORT_MANIFEST_INVALID');
      assertManifestString(construct.role);
      assertSpan(construct.span, sourceBytes);
    });
  });
  manifest.compilerConstructs.forEach((construct) => {
    if (!isRecord(construct)) fail('SOURCE_EXPORT_MANIFEST_INVALID');
    assertManifestString(construct.role);
    assertSpan(construct.span, sourceBytes);
  });
  manifest.unmapped.forEach((item) => {
    if (!isRecord(item) || !['node', 'edge'].includes(item.kind)) fail('SOURCE_EXPORT_MANIFEST_INVALID');
    if (item.kind === 'node') assertManifestString(item.key);
    else if (!isRecord(item.origin)) fail('SOURCE_EXPORT_MANIFEST_INVALID');
  });
  return sourceBytes;
}

export function assertSourceExportManifestBounded(manifest) {
  let serialized;
  try { serialized = JSON.stringify(manifest); } catch { fail('SOURCE_EXPORT_MANIFEST_INVALID'); }
  if (typeof serialized !== 'string' || serialized.length > SOURCE_EXPORT_LIMITS.maxManifestCodeUnits) {
    fail('SOURCE_EXPORT_MANIFEST_BOUND');
  }
  try {
    assertJsonSafe(manifest);
    assertManifestShape(manifest);
  } catch (error) {
    if (error instanceof SourceExportManifestError) throw error;
    fail('SOURCE_EXPORT_MANIFEST_INVALID');
  }
  return serialized;
}
