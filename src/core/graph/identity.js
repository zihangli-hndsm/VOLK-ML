import { componentById } from '../components.js';

export const GRAPH_IDENTITY_VERSION = 1;
export const MAX_GRAPH_NODES = 256;
export const MAX_GRAPH_EDGES = 512;
export const MAX_GRAPH_COMPONENT_DEFINITIONS = 64;
export const MAX_GRAPH_JSON_CODE_UNITS = 1_000_000;

const MAX_GRAPH_VALUES = 50_000;
const MAX_GRAPH_DEPTH = 40;
const FNV64_OFFSET = 14_695_981_039_346_656_037n;
const FNV64_PRIME = 1_099_511_628_211n;
const FNV64_MASK = 18_446_744_073_709_551_615n;

export class GraphIdentityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GraphIdentityError';
    this.code = code;
    this.details = details;
  }
}

function invalid(message, details = {}) {
  throw new GraphIdentityError('GRAPH_IDENTITY_INVALID', message, details);
}

function assertBoundedJson(value, path = '$', depth = 0, ancestors = new WeakSet(), budget = { values: 0, codeUnits: 0 }) {
  budget.values += 1;
  if (budget.values > MAX_GRAPH_VALUES || depth > MAX_GRAPH_DEPTH) {
    invalid('Graph value exceeds the identity traversal bounds.', { path });
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    budget.codeUnits += value.length;
    if (budget.codeUnits > MAX_GRAPH_JSON_CODE_UNITS) invalid('Graph value exceeds the identity size bound.', { path });
    return;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    invalid('Graph contains a non-finite number.', { path });
  }
  if (!value || typeof value !== 'object' || ancestors.has(value)) invalid('Graph contains a non-JSON value.', { path });
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) invalid('Graph contains a non-plain object.', { path });
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) invalid('Graph contains a sparse or extended array.', { path });
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) invalid('Graph contains a sparse array.', { path, index });
      assertBoundedJson(value[index], `${path}[${index}]`, depth + 1, ancestors, budget);
    }
  } else {
    for (const [key, child] of Object.entries(value)) {
      budget.codeUnits += key.length;
      if (budget.codeUnits > MAX_GRAPH_JSON_CODE_UNITS) invalid('Graph value exceeds the identity size bound.', { path });
      assertBoundedJson(child, `${path}.${key}`, depth + 1, ancestors, budget);
    }
  }
  ancestors.delete(value);
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJsonValue(value[key])]));
}

function stableStringify(value) {
  assertBoundedJson(value);
  const serialized = JSON.stringify(canonicalJsonValue(value));
  if (serialized.length > MAX_GRAPH_JSON_CODE_UNITS) invalid('Canonical graph value exceeds the identity size bound.');
  return serialized;
}

function fingerprintSerialized(serialized, namespace) {
  let hash = FNV64_OFFSET;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }
  return `${namespace}-v${GRAPH_IDENTITY_VERSION}-${hash.toString(16).padStart(16, '0')}-${serialized.length.toString(16)}`;
}

/** Stable, bounded, non-cryptographic JSON identity for local graph envelopes. */
export function fingerprintJsonV1(value, namespace = 'graph-envelope') {
  if (typeof namespace !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(namespace)) invalid('Fingerprint namespace is invalid.');
  return fingerprintSerialized(stableStringify(value), namespace);
}

function sortedByKey(values, key) {
  return [...values].sort((left, right) => left[key] < right[key] ? -1 : left[key] > right[key] ? 1 : 0);
}

function portContract(ports, path) {
  if (!Array.isArray(ports)) invalid('Component port contract is invalid.', { path });
  const result = ports.map((port) => {
    if (!port || typeof port.name !== 'string' || !port.name || typeof port.type !== 'string' || !port.type) {
      invalid('Component port contract is invalid.', { path });
    }
    return { name: port.name, type: port.type };
  });
  return result.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : left.type < right.type ? -1 : left.type > right.type ? 1 : 0);
}

function propertyContract(properties, path) {
  if (!Array.isArray(properties)) invalid('Component property contract is invalid.', { path });
  const result = properties.map((property) => {
    if (!property || typeof property !== 'object' || Array.isArray(property) || typeof property.key !== 'string' || !property.key) {
      invalid('Component property contract is invalid.', { path });
    }
    const { label: _presentationLabel, ...semanticSchema } = property;
    return semanticSchema;
  });
  return sortedByKey(result, 'key');
}

function normalizedComposition(composition, manifestById, path, ancestors) {
  if (composition === null || composition === undefined) return null;
  if (!composition || typeof composition !== 'object' || !Array.isArray(composition.nodes) || !Array.isArray(composition.edges)) {
    invalid('Component composition contract is invalid.', { path });
  }
  const nodes = composition.nodes.map((node) => {
    if (!node || typeof node.key !== 'string' || !node.key || typeof node.componentId !== 'string' || !node.componentId) {
      invalid('Component composition node is invalid.', { path });
    }
    const childManifest = node.manifest ?? manifestById.get(node.componentId);
    return {
      key: node.key,
      componentId: node.componentId,
      component: childManifest ? componentContract(childManifest, manifestById, `${path}.${node.key}`, ancestors) : null,
      parameters: node.parameters ?? {},
    };
  });
  const edges = composition.edges.map((edge) => {
    if (
      !edge || typeof edge.source !== 'string' || typeof edge.sourceHandle !== 'string'
      || typeof edge.target !== 'string' || typeof edge.targetHandle !== 'string'
    ) invalid('Component composition edge is invalid.', { path });
    return { source: edge.source, sourceHandle: edge.sourceHandle, target: edge.target, targetHandle: edge.targetHandle };
  }).sort((left, right) => {
    const leftKey = `${left.source}\0${left.sourceHandle}\0${left.target}\0${left.targetHandle}`;
    const rightKey = `${right.source}\0${right.sourceHandle}\0${right.target}\0${right.targetHandle}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return {
    nodes: sortedByKey(nodes, 'key'),
    edges,
    inputs: composition.inputs ?? {},
    outputs: composition.outputs ?? {},
  };
}

function componentContract(manifest, manifestById, path, ancestors = new WeakSet()) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || ancestors.has(manifest)) {
    invalid('Component semantic contract is invalid or cyclic.', { path });
  }
  ancestors.add(manifest);
  const result = {
    schemaVersion: manifest.schemaVersion,
    id: manifest.id,
    op: manifest.op,
    kind: manifest.kind,
    customComposite: manifest.customComposite === true,
    inputs: portContract(manifest.inputs, `${path}.inputs`),
    outputs: portContract(manifest.outputs, `${path}.outputs`),
    properties: propertyContract(manifest.properties, `${path}.properties`),
    runtime: manifest.runtime,
    compatibility: manifest.compatibility,
    composition: normalizedComposition(manifest.composition, manifestById, `${path}.composition`, ancestors),
  };
  ancestors.delete(manifest);
  return result;
}

function graphParts(graph) {
  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    invalid('Graph requires nodes and edges arrays.');
  }
  if (graph.nodes.length > MAX_GRAPH_NODES || graph.edges.length > MAX_GRAPH_EDGES) {
    invalid('Graph exceeds the node or edge bound.', { maxNodes: MAX_GRAPH_NODES, maxEdges: MAX_GRAPH_EDGES });
  }
  const componentDefinitions = graph.componentDefinitions ?? [];
  if (!Array.isArray(componentDefinitions) || componentDefinitions.length > MAX_GRAPH_COMPONENT_DEFINITIONS) {
    invalid('Graph component definitions exceed their bound.', { maxDefinitions: MAX_GRAPH_COMPONENT_DEFINITIONS });
  }
  assertBoundedJson({ nodes: graph.nodes, edges: graph.edges, componentDefinitions });
  const manifestById = new Map(componentById);
  componentDefinitions.forEach((manifest) => {
    if (!manifest || typeof manifest.id !== 'string' || !manifest.id) invalid('Graph component definition has no identity.');
    manifestById.set(manifest.id, manifest);
  });
  return { componentDefinitions, manifestById };
}

/** Semantic graph projection: node layout and presentation/runtime state are excluded. */
export function projectGraphSemanticsV1(graph) {
  const { componentDefinitions, manifestById } = graphParts(graph);
  const nodes = graph.nodes.map((node) => {
    const manifest = node?.data?.manifest;
    if (
      !node || typeof node.id !== 'string' || !node.id
      || !manifest || typeof manifest.id !== 'string' || !manifest.id
      || typeof manifest.op !== 'string' || !manifest.op
      || !node.data.parameters || typeof node.data.parameters !== 'object' || Array.isArray(node.data.parameters)
    ) invalid('Graph node is missing semantic identity or parameters.');
    return {
      id: node.id,
      component: componentContract(manifest, manifestById, `nodes.${node.id}`),
      parameters: node.data.parameters,
    };
  });
  const edges = graph.edges.map((edge) => {
    if (
      !edge || typeof edge.id !== 'string' || !edge.id
      || typeof edge.source !== 'string' || !edge.source
      || typeof edge.sourceHandle !== 'string' || !edge.sourceHandle
      || typeof edge.target !== 'string' || !edge.target
      || typeof edge.targetHandle !== 'string' || !edge.targetHandle
    ) invalid('Graph edge is missing semantic identity or endpoint data.');
    return { id: edge.id, source: edge.source, sourceHandle: edge.sourceHandle, target: edge.target, targetHandle: edge.targetHandle };
  });
  const definitions = componentDefinitions.map((manifest) => componentContract(manifest, manifestById, `componentDefinitions.${manifest.id}`));
  return {
    nodes: sortedByKey(nodes, 'id'),
    edges: sortedByKey(edges, 'id'),
    componentDefinitions: sortedByKey(definitions, 'id'),
  };
}

/** Stable JSON form used where exact canonical semantic equality is required. */
export function canonicalGraphSemanticsJsonV1(graph) {
  return stableStringify(projectGraphSemanticsV1(graph));
}

function collectCompositionLayout(manifest, manifestById, path, output, ancestors = new WeakSet()) {
  if (!manifest?.composition || ancestors.has(manifest)) return;
  ancestors.add(manifest);
  for (const child of manifest.composition.nodes ?? []) {
    const childPath = `${path}/${child.key}`;
    if (child.position !== undefined) {
      if (!Number.isFinite(child.position?.x) || !Number.isFinite(child.position?.y)) invalid('Composite node position is invalid.', { path: childPath });
      output.push({ id: childPath, position: { x: child.position.x, y: child.position.y } });
    }
    const childManifest = child.manifest ?? manifestById.get(child.componentId);
    if (childManifest) collectCompositionLayout(childManifest, manifestById, childPath, output, ancestors);
  }
  ancestors.delete(manifest);
}

/** Layout identity is separate so node moves never imply a semantic graph change. */
export function canonicalGraphLayoutJsonV1(graph) {
  const { componentDefinitions, manifestById } = graphParts(graph);
  const nodes = graph.nodes.map((node) => {
    if (!node || typeof node.id !== 'string' || !node.id || !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) {
      invalid('Graph node position is invalid.');
    }
    return { id: node.id, position: { x: node.position.x, y: node.position.y } };
  });
  const compositionNodes = [];
  graph.nodes.forEach((node) => collectCompositionLayout(node.data?.manifest, manifestById, node.id, compositionNodes));
  componentDefinitions.forEach((manifest) => collectCompositionLayout(manifest, manifestById, `definition:${manifest.id}`, compositionNodes));
  return stableStringify({ nodes: sortedByKey(nodes, 'id'), compositionNodes: sortedByKey(compositionNodes, 'id') });
}

export function graphSemanticFingerprintV1(graph) {
  return fingerprintSerialized(canonicalGraphSemanticsJsonV1(graph), 'graph-semantic');
}

export function graphPresentationFingerprintV1(graph) {
  return fingerprintSerialized(canonicalGraphLayoutJsonV1(graph), 'graph-layout');
}

export function graphIdentityV1(graph) {
  return {
    version: GRAPH_IDENTITY_VERSION,
    semanticFingerprint: graphSemanticFingerprintV1(graph),
    presentationFingerprint: graphPresentationFingerprintV1(graph),
  };
}
