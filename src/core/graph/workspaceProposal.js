import { componentById } from '../components.js';
import { validateProjectForWorkspace, migrateProject, PROJECT_VERSION } from '../project.js';
import { assessConnection } from '../connections.js';
import { createAgentNode, validateAgentDataset } from '../canvasAgent.js';
import { analyzeBrowserExecutionGraph } from '../browserExecutionContract.js';
import { compilePipelineToPyTorch, compilePipelineToTensorFlow } from '../compiler.js';
import { estimateExecutionPlan } from '../runtimeTiers.js';
import { validateGraphProposal } from '../buildAgent/graphProposal.js';
import { createBuildDatasetContext } from '../buildAgent/datasetContext.js';
import {
  canonicalGraphLayoutJsonV1,
  canonicalGraphSemanticsJsonV1,
  fingerprintJsonV1,
  graphIdentityV1,
  MAX_GRAPH_COMPONENT_DEFINITIONS,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_JSON_CODE_UNITS,
  MAX_GRAPH_NODES,
} from './identity.js';
import {
  materializeTorchExportDocument,
  validateTorchExportDocument,
} from './torchExportAdapter.js';

export const WORKSPACE_GRAPH_PROPOSAL_VERSION = 1;
export const WORKSPACE_GRAPH_PROPOSAL_TYPE = 'WorkspaceGraphProposalV1';
export const GRAPH_SOURCE_VERSION = 2;
export const GRAPH_CONVERSION_REPORT_VERSION = 2;
export const TORCH_EXPORT_SOURCE_VERSION = 4;
export const TORCH_EXPORT_CONVERSION_REPORT_VERSION = 4;

const FIDELITIES = ['exact', 'structural', 'partial', 'unsupported'];
const SOURCE_KINDS = ['planner', 'import'];
const SOURCE_PRODUCERS = [
  'build-agent', 'volk-project', 'human-import', 'external-agent', 'onnx-adapter',
  'torch-export-adapter', 'torch-fx-adapter', 'tensorflow-adapter', 'keras-adapter', 'unknown-import',
];
const SOURCE_FORMATS = [
  'volk-model-design-plan-v1', 'volk-graph-candidate-v1', 'volk-project', 'ONNX', 'torch.export', 'torch.fx', 'TensorFlow', 'Keras', 'unknown-import',
];
const OFFICIAL_PRODUCERS = new Set([
  'build-agent', 'volk-project', 'onnx-adapter', 'torch-export-adapter', 'torch-fx-adapter', 'tensorflow-adapter', 'keras-adapter',
]);
const IMPLEMENTED_VERIFIED_PRODUCERS = new Set(['build-agent', 'volk-project']);
const RESERVED_ADAPTER_PRODUCERS = new Set(['onnx-adapter', 'torch-fx-adapter', 'tensorflow-adapter', 'keras-adapter']);
const CONVERSION_VERIFICATIONS = ['producer-declared', 'volk-verified'];
const PROVENANCE_LOCATIONS = ['generated', 'local-project', 'local-file', 'inline', 'unknown'];
const FRAMEWORKS = ['pytorch', 'tensorflow'];
const TIERS = ['L0', 'L1', 'L2', 'L3'];
const STATUSES = ['idle', 'running', 'succeeded', 'failed'];
const ROOT_FIELDS = [
  'type', 'version', 'proposalId', 'source', 'graph', 'graphIdentity', 'conversion',
  'capabilitySnapshot', 'assessment', 'authority', 'requiresUserAcceptance',
];
const MANIFEST_FIELDS = [
  'schemaVersion', 'id', 'op', 'kind', 'name', 'description', 'category', 'inputs', 'outputs',
  'properties', 'runtime', 'compatibility', 'composition', 'customComposite', 'visualStage', 'color',
];

export class GraphProposalError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GraphProposalError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new GraphProposalError(code, message, details);
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
}

function rejectUnknown(value, allowed, path) {
  if (!isRecord(value)) fail('GRAPH_PROPOSAL_INVALID', 'Expected a plain object.', { path });
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) fail('GRAPH_PROPOSAL_INVALID', 'Unexpected field.', { path, field: unknown });
}

function boundedText(value, path, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail('GRAPH_PROPOSAL_INVALID', 'Expected bounded non-empty text.', { path, max });
  }
  return value.trim();
}

function boundedList(value, path, { max = 32, itemMax = 96, unique = true } = {}) {
  if (!Array.isArray(value) || value.length > max) fail('GRAPH_PROPOSAL_INVALID', 'Expected a bounded list.', { path, max });
  const entries = value.map((item, index) => boundedText(item, `${path}[${index}]`, itemMax));
  if (unique && new Set(entries).size !== entries.length) fail('GRAPH_PROPOSAL_INVALID', 'List entries must be unique.', { path });
  return entries;
}

function safeResultError(error, fallback = 'GRAPH_PROPOSAL_INVALID') {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,95}$/.test(error.code) ? error.code : fallback;
  const details = {};
  for (const key of ['path', 'nodeId', 'componentId', 'propertyKey', 'reason', 'field']) {
    const value = error?.details?.[key];
    if (typeof value === 'string' && value.length <= 160) details[key] = value;
  }
  return { code, ...(Object.keys(details).length ? { details } : {}) };
}

function localizedPresentation(value, path) {
  if (typeof value === 'string' && value.length <= 256) return;
  if (!isRecord(value) || !Object.keys(value).length || Object.values(value).some((text) => typeof text !== 'string' || text.length > 256)) {
    fail('GRAPH_PROPOSAL_INVALID', 'Presentation label is invalid.', { path });
  }
}

function rejectManifestShape(manifest, path, ancestors = new WeakSet()) {
  rejectUnknown(manifest, MANIFEST_FIELDS, path);
  if (ancestors.has(manifest)) fail('GRAPH_PROPOSAL_INVALID', 'Component manifest is cyclic.', { path });
  ancestors.add(manifest);
  for (const field of ['name', 'description']) {
    if (manifest[field] !== undefined) localizedPresentation(manifest[field], `${path}.${field}`);
  }
  if (manifest.properties !== undefined) {
    if (!Array.isArray(manifest.properties) || manifest.properties.length > 128) fail('GRAPH_PROPOSAL_INVALID', 'Component properties exceed their bound.', { path });
    manifest.properties.forEach((property, index) => {
      const propertyPath = `${path}.properties[${index}]`;
      rejectUnknown(property, ['key', 'label', 'type', 'default', 'min', 'max', 'step', 'options'], propertyPath);
      if (property.label !== undefined) localizedPresentation(property.label, `${propertyPath}.label`);
    });
  }
  for (const field of ['inputs', 'outputs']) {
    if (manifest[field] !== undefined) {
      if (!Array.isArray(manifest[field]) || manifest[field].length > 128) fail('GRAPH_PROPOSAL_INVALID', 'Component ports exceed their bound.', { path });
      manifest[field].forEach((port, index) => rejectUnknown(port, ['name', 'type'], `${path}.${field}[${index}]`));
    }
  }
  if (manifest.runtime !== undefined) rejectUnknown(manifest.runtime, ['minimumTier', 'browserBackend'], `${path}.runtime`);
  if (manifest.compatibility !== undefined) rejectUnknown(manifest.compatibility, ['pytorch', 'tensorflow'], `${path}.compatibility`);
  if (manifest.composition !== undefined && manifest.composition !== null) {
    const compositionPath = `${path}.composition`;
    rejectUnknown(manifest.composition, ['nodes', 'edges', 'inputs', 'outputs'], compositionPath);
    const { nodes = [], edges = [] } = manifest.composition;
    if (!Array.isArray(nodes) || nodes.length > 256 || !Array.isArray(edges) || edges.length > 512) {
      fail('GRAPH_PROPOSAL_INVALID', 'Composite expansion exceeds its bound.', { path: compositionPath });
    }
    nodes.forEach((node, index) => {
      const childPath = `${compositionPath}.nodes[${index}]`;
      rejectUnknown(node, ['key', 'componentId', 'manifest', 'parameters', 'position'], childPath);
      if (node.position !== undefined) rejectUnknown(node.position, ['x', 'y'], `${childPath}.position`);
      if (node.manifest !== undefined) rejectManifestShape(node.manifest, `${childPath}.manifest`, ancestors);
    });
    edges.forEach((edge, index) => rejectUnknown(edge, ['source', 'sourceHandle', 'target', 'targetHandle'], `${compositionPath}.edges[${index}]`));
  }
  ancestors.delete(manifest);
}

function validateGraphShape(graph) {
  rejectUnknown(graph, ['blueprintId', 'nodes', 'edges', 'componentDefinitions'], 'graph');
  if (graph.blueprintId !== undefined) boundedText(graph.blueprintId, 'graph.blueprintId', 120);
  if (!Array.isArray(graph.nodes) || graph.nodes.length > MAX_GRAPH_NODES) fail('GRAPH_PROPOSAL_INVALID', 'Graph node count is out of bounds.', { maxNodes: MAX_GRAPH_NODES });
  if (!Array.isArray(graph.edges) || graph.edges.length > MAX_GRAPH_EDGES) fail('GRAPH_PROPOSAL_INVALID', 'Graph edge count is out of bounds.', { maxEdges: MAX_GRAPH_EDGES });
  if (!Array.isArray(graph.componentDefinitions) || graph.componentDefinitions.length > MAX_GRAPH_COMPONENT_DEFINITIONS) {
    fail('GRAPH_PROPOSAL_INVALID', 'Graph component definitions are out of bounds.', { maxDefinitions: MAX_GRAPH_COMPONENT_DEFINITIONS });
  }
  graph.componentDefinitions.forEach((manifest, index) => rejectManifestShape(manifest, `graph.componentDefinitions[${index}]`));
  graph.nodes.forEach((node, index) => {
    const path = `graph.nodes[${index}]`;
    rejectUnknown(node, ['id', 'type', 'position', 'data'], path);
    boundedText(node.id, `${path}.id`, 120);
    rejectUnknown(node.position, ['x', 'y'], `${path}.position`);
    if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) fail('GRAPH_PROPOSAL_INVALID', 'Node position is invalid.', { path });
    rejectUnknown(node.data, ['label', 'manifest', 'parameters', 'status'], `${path}.data`);
    localizedPresentation(node.data.label, `${path}.data.label`);
    if (node.data.status !== undefined && (typeof node.data.status !== 'string' || node.data.status.length > 32)) {
      fail('GRAPH_PROPOSAL_INVALID', 'Node runtime status is invalid.', { path });
    }
    rejectManifestShape(node.data.manifest, `${path}.data.manifest`);
    if (!isRecord(node.data.parameters)) fail('GRAPH_PROPOSAL_INVALID', 'Node parameters must be a plain object.', { path });
  });
  graph.edges.forEach((edge, index) => {
    const path = `graph.edges[${index}]`;
    rejectUnknown(edge, ['id', 'source', 'sourceHandle', 'target', 'targetHandle', 'type'], path);
    for (const field of ['id', 'source', 'sourceHandle', 'target', 'targetHandle']) boundedText(edge[field], `${path}.${field}`, 120);
    if (edge.type !== undefined && edge.type !== 'deletable') fail('GRAPH_PROPOSAL_INVALID', 'Unsupported graph edge presentation type.', { path });
  });
  return graph;
}

function normalizeOptionalNestedCustomManifests(manifest) {
  const normalized = structuredClone(manifest);
  const visit = (current, seen = new WeakSet()) => {
    if (!isRecord(current) || seen.has(current)) return;
    seen.add(current);
    for (const spec of current.composition?.nodes ?? []) {
      if (spec.manifest === undefined) {
        delete spec.manifest;
      } else if (spec.manifest?.customComposite === true) {
        visit(spec.manifest, seen);
      }
    }
  };
  visit(normalized);
  return normalized;
}

function normalizeGraphCustomManifests(graph) {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        manifest: normalizeOptionalNestedCustomManifests(node.data.manifest),
      },
    })),
    componentDefinitions: graph.componentDefinitions.map(normalizeOptionalNestedCustomManifests),
  };
}

function normalizeProjectCustomManifests(project) {
  return {
    ...project,
    customComponents: Array.isArray(project.customComponents)
      ? project.customComponents.map(normalizeOptionalNestedCustomManifests)
      : project.customComponents,
    graph: {
      ...project.graph,
      nodes: Array.isArray(project.graph?.nodes) ? project.graph.nodes.map((node) => (
        node?.data?.manifest
          ? { ...node, data: { ...node.data, manifest: normalizeOptionalNestedCustomManifests(node.data.manifest) } }
          : node
      )) : project.graph?.nodes,
    },
  };
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJsonValue(value[key])]));
}

function canonicalJsonString(value) {
  return JSON.stringify(canonicalJsonValue(value));
}

function componentContractJson(manifest, definitions) {
  return canonicalGraphSemanticsJsonV1({
    nodes: [{ id: 'component-contract', data: { manifest, parameters: {} } }],
    edges: [],
    componentDefinitions: definitions,
  });
}

function assertManifestAgainstRegistry(manifest, definitions, path) {
  if (!isRecord(manifest) || typeof manifest.id !== 'string') return;
  const registered = componentById.get(manifest.id);
  if (!registered) return;
  if (manifest.customComposite === true) {
    fail('GRAPH_COMPONENT_BUILTIN_SHADOWED', 'A custom definition cannot shadow a registered built-in component.', { componentId: manifest.id, path });
  }
  try {
    if (componentContractJson(manifest, definitions) !== componentContractJson(registered, definitions)) {
      fail('GRAPH_COMPONENT_REGISTRY_MISMATCH', 'Embedded built-in component contract differs from the current registry.', { componentId: manifest.id, path });
    }
  } catch (error) {
    if (error instanceof GraphProposalError) throw error;
    fail('GRAPH_COMPONENT_REGISTRY_MISMATCH', 'Embedded built-in component contract is invalid under the current registry.', { componentId: manifest.id, path });
  }
}

function assertNestedManifestsAgainstRegistry(manifest, definitions, path, seen = new WeakSet()) {
  if (!isRecord(manifest) || seen.has(manifest)) return;
  seen.add(manifest);
  assertManifestAgainstRegistry(manifest, definitions, path);
  for (const [index, child] of (manifest.composition?.nodes ?? []).entries()) {
    if (child.manifest) {
      assertNestedManifestsAgainstRegistry(child.manifest, definitions, `${path}.composition.nodes[${index}].manifest`, seen);
    }
  }
}

function assertNoBuiltinShadowing(graph) {
  const definitions = Array.isArray(graph.componentDefinitions) ? graph.componentDefinitions : [];
  const definitionsById = new Map();
  for (const [index, definition] of definitions.entries()) {
    const path = `graph.componentDefinitions[${index}]`;
    if (!isRecord(definition) || typeof definition.id !== 'string' || !definition.id) continue;
    if (componentById.has(definition.id)) {
      fail('GRAPH_COMPONENT_BUILTIN_SHADOWED', 'Custom component definitions cannot reuse built-in component IDs.', { componentId: definition.id, path });
    }
    if (definitionsById.has(definition.id)) fail('GRAPH_COMPONENT_DEFINITION_DUPLICATE', 'Custom component definition IDs must be unique.', { componentId: definition.id, path });
    definitionsById.set(definition.id, definition);
    assertNestedManifestsAgainstRegistry(definition, definitions, path);
  }

  for (const [index, node] of (graph.nodes ?? []).entries()) {
    const manifest = node?.data?.manifest;
    const path = `graph.nodes[${index}].data.manifest`;
    assertNestedManifestsAgainstRegistry(manifest, definitions, path);
    if (!manifest?.customComposite) continue;
    const definition = definitionsById.get(manifest.id);
    if (!definition) fail('GRAPH_COMPONENT_DEFINITION_MISSING', 'Custom composite nodes must carry their referenced canonical definition.', { componentId: manifest.id, path });
    // A folded instance is a validated snapshot, not the catalogue template.
    // The canonical project validator below independently validates its
    // expanded child graph while the definition remains available for lookup.
  }
}

function canonicalizeGraphWithProjectContract(graph, { allowBlueprintId = false } = {}) {
  validateGraphShape(graph);
  const normalizedGraph = normalizeGraphCustomManifests(graph);
  if (normalizedGraph.blueprintId !== undefined && !allowBlueprintId) {
    fail('GRAPH_PROPOSAL_INVALID', 'Source-neutral graphs cannot supply a Build Agent blueprint identity.');
  }
  assertNoBuiltinShadowing(normalizedGraph);
  const prepared = canonicalProjectGraph({
    format: 'VOLK-ML',
    version: PROJECT_VERSION,
    name: 'Detached Graph Candidate',
    customComponents: normalizedGraph.componentDefinitions,
    graph: { nodes: normalizedGraph.nodes, edges: normalizedGraph.edges },
    data: null,
    trainedModel: null,
  });
  if (!prepared.ok) {
    const diagnostic = prepared.diagnostics?.[0];
    fail(diagnostic?.code ?? 'GRAPH_PROJECT_VALIDATION_FAILED', 'Graph is invalid under the canonical VOLK project contract.', diagnostic?.details ?? {});
  }
  const canonical = structuredClone(prepared.graph);
  if (allowBlueprintId && normalizedGraph.blueprintId !== undefined) canonical.blueprintId = normalizedGraph.blueprintId;
  try {
    if (canonicalGraphSemanticsJsonV1(canonical) !== canonicalGraphSemanticsJsonV1(normalizedGraph)) {
      fail('GRAPH_CANONICALIZATION_MISMATCH', 'Graph semantics differ from current canonical component and project contracts.');
    }
    if (canonicalGraphLayoutJsonV1(canonical) !== canonicalGraphLayoutJsonV1(normalizedGraph)) {
      fail('GRAPH_LAYOUT_CANONICALIZATION_MISMATCH', 'Graph layout differs from the canonical detached graph.');
    }
  } catch (error) {
    if (error instanceof GraphProposalError) throw error;
    fail('GRAPH_PROJECT_VALIDATION_FAILED', 'Graph cannot be compared with the current canonical project contract.', {
      reason: error?.code ?? error?.name ?? 'canonicalization',
      ...(typeof error?.details?.path === 'string' ? { path: error.details.path } : {}),
    });
  }
  return canonical;
}

function validateGraphIdentity(graph, actual) {
  rejectUnknown(actual, ['version', 'semanticFingerprint', 'presentationFingerprint'], 'graphIdentity');
  if (actual.version !== 1) fail('GRAPH_IDENTITY_VERSION_UNSUPPORTED', 'Graph identity version is unsupported.');
  const expected = graphIdentityV1(graph);
  if (
    actual.semanticFingerprint !== expected.semanticFingerprint
    || actual.presentationFingerprint !== expected.presentationFingerprint
  ) fail('GRAPH_IDENTITY_MISMATCH', 'Graph identity does not match its detached graph.');
  return expected;
}

function validateProvenance(provenance) {
  rejectUnknown(provenance, ['artifactId', 'revision', 'fingerprint', 'references', 'location'], 'source.provenance');
  if (!Object.keys(provenance).length) fail('GRAPH_PROVENANCE_INVALID', 'Source provenance must contain at least one bounded reference.');
  if (provenance.artifactId !== undefined) boundedText(provenance.artifactId, 'source.provenance.artifactId', 160);
  if (provenance.revision !== undefined) boundedText(provenance.revision, 'source.provenance.revision', 96);
  if (provenance.fingerprint !== undefined) boundedText(provenance.fingerprint, 'source.provenance.fingerprint', 160);
  if (provenance.references !== undefined) boundedList(provenance.references, 'source.provenance.references', { max: 16, itemMax: 120 });
  if (provenance.location !== undefined && !PROVENANCE_LOCATIONS.includes(provenance.location)) {
    fail('GRAPH_PROVENANCE_INVALID', 'Source provenance location is unsupported.', { path: 'source.provenance.location' });
  }
}

function validateSource(source) {
  if (!isRecord(source) || !SOURCE_KINDS.includes(source.kind)) {
    fail('GRAPH_PROVENANCE_INVALID', 'Proposal source kind is unsupported.');
  }
  if (!SOURCE_PRODUCERS.includes(source.producer)) fail('GRAPH_PROVENANCE_INVALID', 'Proposal source producer is unsupported.');
  if (!SOURCE_FORMATS.includes(source.format)) fail('GRAPH_PROVENANCE_INVALID', 'Proposal source format is unsupported.');
  const expectedSourceVersion = source.producer === 'torch-export-adapter' ? TORCH_EXPORT_SOURCE_VERSION : GRAPH_SOURCE_VERSION;
  if (source.version !== expectedSourceVersion) fail('GRAPH_PROVENANCE_VERSION_UNSUPPORTED', 'Graph source contract version is unsupported.');
  validateProvenance(source.provenance);

  if (source.kind === 'planner') {
    if (source.producer === 'external-agent' && source.format === 'volk-graph-candidate-v1') {
      rejectUnknown(source, ['version', 'kind', 'producer', 'format', 'provenance'], 'source');
      return;
    }
    rejectUnknown(source, [
      'version', 'kind', 'producer', 'format', 'provenance', 'sourceProposalId', 'planId', 'blueprintId', 'datasetBinding', 'buildAgentProposal', 'rationale', 'limitations', 'diagnostics',
    ], 'source');
    if (source.producer !== 'build-agent' || source.format !== 'volk-model-design-plan-v1') {
      fail('GRAPH_PROVENANCE_INVALID', 'Build Agent source producer and format do not match the implemented adapter.');
    }
    for (const field of ['sourceProposalId', 'planId', 'blueprintId']) boundedText(source[field], `source.${field}`, 160);
    if (!isRecord(source.buildAgentProposal)) fail('GRAPH_SOURCE_EVIDENCE_INVALID', 'Build Agent proposals require the validated source proposal as evidence.');
    rejectUnknown(source.datasetBinding, ['fingerprint', 'featureColumns', 'targetColumn'], 'source.datasetBinding');
    boundedText(source.datasetBinding.fingerprint, 'source.datasetBinding.fingerprint', 160);
    boundedList(source.datasetBinding.featureColumns, 'source.datasetBinding.featureColumns', { max: 64, itemMax: 120 });
    boundedText(source.datasetBinding.targetColumn, 'source.datasetBinding.targetColumn', 120);
    boundedList(source.rationale, 'source.rationale', { max: 16 });
    boundedList(source.limitations, 'source.limitations', { max: 16 });
    boundedList(source.diagnostics, 'source.diagnostics', { max: 32 });
    if (
      source.provenance.artifactId !== source.sourceProposalId
      || source.provenance.revision !== source.planId
      || source.provenance.fingerprint !== source.datasetBinding.fingerprint
      || !source.provenance.references?.includes(source.blueprintId)
    ) fail('GRAPH_PROVENANCE_INVALID', 'Build Agent provenance does not match its preserved plan and dataset binding.');
    return;
  }

  if (source.kind !== 'import') fail('GRAPH_PROVENANCE_INVALID', 'Import source kind is unsupported.');
  if (source.producer === 'torch-export-adapter') {
    rejectUnknown(source, ['version', 'kind', 'producer', 'format', 'provenance', 'torchExportDocument'], 'source');
    if (source.format !== 'torch.export') fail('GRAPH_PROVENANCE_INVALID', 'Torch Export source producer and format do not match the implemented adapter.');
    let document;
    try { document = validateTorchExportDocument(source.torchExportDocument); } catch {
      fail('GRAPH_SOURCE_EVIDENCE_INVALID', 'Embedded Torch Export document failed its strict adapter validator.');
    }
    if (
      source.provenance.artifactId !== 'torch-export-document'
      || source.provenance.fingerprint !== document.documentFingerprint
      || source.provenance.location !== 'local-file'
    ) fail('GRAPH_PROVENANCE_INVALID', 'Torch Export provenance does not match its embedded normalized document.');
    return;
  }
  if (source.producer === 'volk-project') {
    rejectUnknown(source, ['version', 'kind', 'producer', 'format', 'provenance', 'projectVersion', 'projectEvidence'], 'source');
    if (source.producer !== 'volk-project' || source.format !== 'volk-project') {
      fail('GRAPH_PROVENANCE_INVALID', 'VOLK project source producer and format do not match the implemented adapter.');
    }
    if (!Number.isInteger(source.projectVersion) || source.projectVersion < 1 || source.projectVersion > PROJECT_VERSION) {
      fail('GRAPH_PROVENANCE_INVALID', 'VOLK project source version is invalid.');
    }
    if (source.provenance.artifactId !== 'local-volk-project' || source.provenance.revision !== String(source.projectVersion)) {
      fail('GRAPH_PROVENANCE_INVALID', 'VOLK project provenance does not match its migrated project version.');
    }
    if (!isRecord(source.projectEvidence)) fail('GRAPH_SOURCE_EVIDENCE_INVALID', 'VOLK project proposals require graph-only source evidence.');
    rejectUnknown(source.projectEvidence, ['format', 'version', 'customComponents', 'graph'], 'source.projectEvidence');
    if (source.projectEvidence.format !== 'VOLK-ML' || source.projectEvidence.version !== source.projectVersion) {
      fail('GRAPH_SOURCE_EVIDENCE_INVALID', 'VOLK project evidence identity does not match its source contract.');
    }
    return;
  }

  rejectUnknown(source, ['version', 'kind', 'producer', 'format', 'provenance'], 'source');
  const importerFormats = {
    'human-import': ['ONNX', 'torch.export', 'torch.fx', 'TensorFlow', 'Keras', 'unknown-import'],
    'external-agent': ['ONNX', 'torch.export', 'torch.fx', 'TensorFlow', 'Keras', 'unknown-import'],
    'onnx-adapter': ['ONNX'],
    'torch-export-adapter': ['torch.export'],
    'torch-fx-adapter': ['torch.fx'],
    'tensorflow-adapter': ['TensorFlow'],
    'keras-adapter': ['Keras'],
    'unknown-import': ['unknown-import'],
  };
  if (!importerFormats[source.producer]?.includes(source.format)) {
    fail('GRAPH_PROVENANCE_INVALID', 'Import source kind, producer, and format are incompatible.');
  }
}

function validateSourceSpecificEvidence(source, canonicalGraph) {
  if (source.producer === 'build-agent') {
    let evidence;
    try {
      evidence = validateGraphProposal(source.buildAgentProposal);
    } catch {
      fail('GRAPH_SOURCE_EVIDENCE_INVALID', 'Embedded Build Agent source proposal failed its native validator.');
    }
    const binding = source.datasetBinding;
    const matches = evidence.proposalId === source.sourceProposalId
      && evidence.planId === source.planId
      && evidence.blueprintId === source.blueprintId
      && evidence.datasetFingerprint === binding.fingerprint
      && canonicalJsonString(evidence.datasetSelection.featureColumns) === canonicalJsonString(binding.featureColumns)
      && evidence.datasetSelection.targetColumn === binding.targetColumn
      && canonicalJsonString(evidence.modelDesignPlan.rationale) === canonicalJsonString(source.rationale)
      && canonicalJsonString(evidence.modelDesignPlan.limitations) === canonicalJsonString(source.limitations)
      && canonicalJsonString(buildAgentDiagnostics(evidence)) === canonicalJsonString(source.diagnostics)
      && evidence.graph.blueprintId === source.blueprintId
      && canonicalGraphSemanticsJsonV1(evidence.graph) === canonicalGraphSemanticsJsonV1(canonicalGraph)
      && canonicalGraphLayoutJsonV1(evidence.graph) === canonicalGraphLayoutJsonV1(canonicalGraph);
    if (!matches) fail('GRAPH_SOURCE_EVIDENCE_INVALID', 'Build Agent source evidence does not bind to the detached graph and preserved plan facts.');
    return;
  }

  if (source.producer === 'volk-project') {
    const evidence = source.projectEvidence;
    const customComponents = evidence.customComponents ?? [];
    if (!Array.isArray(evidence.graph?.nodes) || !Array.isArray(evidence.graph?.edges) || !Array.isArray(customComponents)) {
      fail('GRAPH_SOURCE_EVIDENCE_INVALID', 'VOLK project graph evidence is malformed.');
    }
    rejectUnknown(evidence.graph, ['nodes', 'edges'], 'source.projectEvidence.graph');
    const sourceGraph = { nodes: evidence.graph.nodes, edges: evidence.graph.edges, componentDefinitions: customComponents };
    validateGraphShape(sourceGraph);
    let prepared;
    try {
      prepared = canonicalProjectGraph({
        format: evidence.format,
        version: evidence.version,
        name: 'Detached VOLK Project Evidence',
        customComponents,
        graph: evidence.graph,
        data: null,
        trainedModel: null,
      });
    } catch {
      fail('GRAPH_SOURCE_EVIDENCE_INVALID', 'VOLK project graph evidence failed canonical project validation.');
    }
    if (!prepared.ok
      || canonicalGraphSemanticsJsonV1(prepared.graph) !== canonicalGraphSemanticsJsonV1(canonicalGraph)
      || canonicalGraphLayoutJsonV1(prepared.graph) !== canonicalGraphLayoutJsonV1(canonicalGraph)) {
      fail('GRAPH_SOURCE_EVIDENCE_INVALID', 'VOLK project evidence does not bind to the detached graph.');
    }
    return;
  }

  if (source.producer === 'torch-export-adapter') {
    let rematerialized;
    try {
      rematerialized = materializeTorchExportDocument(source.torchExportDocument);
    } catch {
      fail('GRAPH_SOURCE_EVIDENCE_INVALID', 'Torch Export source evidence could not be deterministically rematerialized.');
    }
    if (
      canonicalGraphSemanticsJsonV1(rematerialized) !== canonicalGraphSemanticsJsonV1(canonicalGraph)
      || canonicalGraphLayoutJsonV1(rematerialized) !== canonicalGraphLayoutJsonV1(canonicalGraph)
    ) fail('GRAPH_SOURCE_EVIDENCE_INVALID', 'Torch Export evidence does not bind to the detached graph.');
  }
}

function validateConversion(conversion, { requireVerification = true, sourceProducer = null } = {}) {
  rejectUnknown(conversion, [
    'version', 'fidelity', 'verification', 'exactFor', 'preserved', 'approximated', 'missing', 'unsupported', 'warnings', 'omitted',
  ], 'conversion');
  const torchExport = sourceProducer === 'torch-export-adapter';
  const expectedVersion = torchExport ? TORCH_EXPORT_CONVERSION_REPORT_VERSION : GRAPH_CONVERSION_REPORT_VERSION;
  if (conversion.version !== expectedVersion) {
    fail('GRAPH_CONVERSION_VERSION_UNSUPPORTED', 'Graph conversion report version is unsupported.');
  }
  if (!FIDELITIES.includes(conversion.fidelity)) fail('GRAPH_CONVERSION_INVALID', 'Conversion fidelity is unsupported.');
  const supportedVerifications = torchExport ? ['adapter-verified'] : CONVERSION_VERIFICATIONS;
  if (requireVerification && !supportedVerifications.includes(conversion.verification)) {
    fail('GRAPH_CONVERSION_VERIFICATION_INVALID', 'Conversion verification is unsupported or missing.');
  }
  if (!requireVerification && conversion.verification !== undefined) {
    fail('GRAPH_CONVERSION_VERIFICATION_INVALID', 'Candidate producers cannot self-assign conversion verification.');
  }
  const codeList = (value, path) => {
    const entries = boundedList(value, path, { max: 32, itemMax: 96 });
    if (entries.some((entry) => !/^[a-z][A-Za-z0-9._-]{0,95}$/.test(entry))) {
      fail('GRAPH_CONVERSION_INVALID', 'Conversion report entries must be machine-readable keys.', { path });
    }
    return entries;
  };
  codeList(conversion.exactFor, 'conversion.exactFor');
  codeList(conversion.preserved, 'conversion.preserved');
  codeList(conversion.approximated, 'conversion.approximated');
  const missing = codeList(conversion.missing, 'conversion.missing');
  const omitted = codeList(conversion.omitted, 'conversion.omitted');
  if (JSON.stringify(missing) !== JSON.stringify(omitted)) {
    fail('GRAPH_CONVERSION_INVALID', 'The legacy omitted list must exactly mirror missing.');
  }
  codeList(conversion.unsupported, 'conversion.unsupported');
  codeList(conversion.warnings, 'conversion.warnings');
  if (conversion.fidelity === 'exact' && (conversion.approximated.length || missing.length || conversion.unsupported.length)) {
    fail('GRAPH_CONVERSION_INVALID', 'Exact conversion cannot declare approximated, missing, or unsupported semantics.');
  }
}

function validateCapabilitySnapshot(snapshot) {
  rejectUnknown(snapshot, ['components', 'compilers', 'browserExecution', 'executionTier'], 'capabilitySnapshot');
  if (!Array.isArray(snapshot.components) || snapshot.components.length > MAX_GRAPH_NODES) {
    fail('GRAPH_CAPABILITY_INVALID', 'Component capability list is out of bounds.');
  }
  const componentIds = new Set();
  snapshot.components.forEach((component, index) => {
    const path = `capabilitySnapshot.components[${index}]`;
    rejectUnknown(component, ['componentId', 'operation', 'kind', 'minimumTier', 'browserBackend', 'pytorch', 'tensorflow'], path);
    const id = boundedText(component.componentId, `${path}.componentId`, 120);
    if (componentIds.has(id)) fail('GRAPH_CAPABILITY_INVALID', 'Component capability IDs must be unique.', { path });
    componentIds.add(id);
    boundedText(component.operation, `${path}.operation`, 120);
    boundedText(component.kind, `${path}.kind`, 64);
    if (!TIERS.includes(component.minimumTier) || !['cpu', 'none'].includes(component.browserBackend)) fail('GRAPH_CAPABILITY_INVALID', 'Component runtime capability is invalid.', { path });
    for (const framework of FRAMEWORKS) if (!['exact', 'adapted', 'approximate', 'unsupported'].includes(component[framework])) {
      fail('GRAPH_CAPABILITY_INVALID', 'Component framework capability is invalid.', { path, framework });
    }
  });
  rejectUnknown(snapshot.compilers, FRAMEWORKS, 'capabilitySnapshot.compilers');
  for (const framework of FRAMEWORKS) {
    const compiler = snapshot.compilers[framework];
    rejectUnknown(compiler, ['status', 'fidelity'], `capabilitySnapshot.compilers.${framework}`);
    if (!['supported', 'unsupported'].includes(compiler.status) || !FIDELITIES.includes(compiler.fidelity)) {
      fail('GRAPH_CAPABILITY_INVALID', 'Compiler capability is invalid.', { framework });
    }
  }
  rejectUnknown(snapshot.browserExecution, ['status', 'reason'], 'capabilitySnapshot.browserExecution');
  if (!['not-assessed', 'available', 'unavailable'].includes(snapshot.browserExecution.status)) fail('GRAPH_CAPABILITY_INVALID', 'Browser capability status is invalid.');
  if (snapshot.browserExecution.reason !== null && (typeof snapshot.browserExecution.reason !== 'string' || snapshot.browserExecution.reason.length > 120)) {
    fail('GRAPH_CAPABILITY_INVALID', 'Browser capability reason is invalid.');
  }
  rejectUnknown(snapshot.executionTier, ['recommendedTier', 'canRunHere', 'browserBackendComplete', 'reasons'], 'capabilitySnapshot.executionTier');
  if (!TIERS.includes(snapshot.executionTier.recommendedTier) || typeof snapshot.executionTier.canRunHere !== 'boolean' || typeof snapshot.executionTier.browserBackendComplete !== 'boolean') {
    fail('GRAPH_CAPABILITY_INVALID', 'Execution tier snapshot is invalid.');
  }
  boundedList(snapshot.executionTier.reasons, 'capabilitySnapshot.executionTier.reasons', { max: 32 });
}

function validateAssessment(assessment) {
  rejectUnknown(assessment, ['status', 'reasons', 'targetWorkspace'], 'assessment');
  if (!['eligible', 'blocked'].includes(assessment.status)) fail('GRAPH_ASSESSMENT_INVALID', 'Assessment status is invalid.');
  const reasons = boundedList(assessment.reasons, 'assessment.reasons', { max: 8 });
  rejectUnknown(assessment.targetWorkspace, ['nodeCount', 'edgeCount'], 'assessment.targetWorkspace');
  for (const field of ['nodeCount', 'edgeCount']) {
    if (!Number.isInteger(assessment.targetWorkspace[field]) || assessment.targetWorkspace[field] < 0 || assessment.targetWorkspace[field] > (field === 'nodeCount' ? MAX_GRAPH_NODES : MAX_GRAPH_EDGES)) {
      fail('GRAPH_ASSESSMENT_INVALID', 'Assessment workspace count is invalid.', { field });
    }
  }
  const empty = assessment.targetWorkspace.nodeCount === 0 && assessment.targetWorkspace.edgeCount === 0;
  if ((assessment.status === 'eligible') !== (empty && reasons.length === 0)) fail('GRAPH_ASSESSMENT_INVALID', 'Assessment does not match the non-destructive empty-workspace policy.');
  if (!empty && !reasons.includes('TARGET_WORKSPACE_NOT_EMPTY')) fail('GRAPH_ASSESSMENT_INVALID', 'Non-empty target assessment must be blocked.');
}

function proposalIdentity(proposal) {
  const { proposalId: _proposalId, graph: _graph, ...envelope } = proposal;
  return fingerprintJsonV1(envelope, 'workspace-proposal');
}

function validateInternal(value) {
  rejectUnknown(value, ROOT_FIELDS, 'proposal');
  if (value.type !== WORKSPACE_GRAPH_PROPOSAL_TYPE || value.version !== WORKSPACE_GRAPH_PROPOSAL_VERSION) {
    fail('GRAPH_PROPOSAL_VERSION_UNSUPPORTED', 'Workspace graph proposal version is unsupported.');
  }
  boundedText(value.proposalId, 'proposal.proposalId', 160);
  validateSource(value.source);
  if (RESERVED_ADAPTER_PRODUCERS.has(value.source.producer)) {
    fail('GRAPH_PROVENANCE_INVALID', 'Reserved source adapters cannot produce proposals until their validated adapters are implemented.');
  }
  validateGraphShape(value.graph);
  if (value.graph.blueprintId !== undefined) {
    if (value.source.producer !== 'build-agent' || value.graph.blueprintId !== value.source.blueprintId) {
      fail('GRAPH_PROVENANCE_INVALID', 'Blueprint identity is valid only when it matches the adapted Build Agent source.');
    }
  } else if (value.source.producer === 'build-agent') {
    fail('GRAPH_PROVENANCE_INVALID', 'Build Agent source evidence requires its registered blueprint identity on the graph.');
  }
  const canonicalGraph = canonicalizeGraphWithProjectContract(value.graph, { allowBlueprintId: value.source.producer === 'build-agent' });
  validateGraphIdentity(value.graph, value.graphIdentity);
  validateSourceSpecificEvidence(value.source, canonicalGraph);
  validateConversion(value.conversion, { sourceProducer: value.source.producer });
  if (value.source.producer === 'torch-export-adapter'
    && canonicalJsonString(value.conversion) !== canonicalJsonString(torchExportConversion)) {
    fail('GRAPH_CONVERSION_INVALID', 'Torch Export conversion details must match the registered metadata-only adapter report.');
  }
  const expectedVerification = value.source.producer === 'torch-export-adapter'
    ? 'adapter-verified'
    : IMPLEMENTED_VERIFIED_PRODUCERS.has(value.source.producer) ? 'volk-verified' : 'producer-declared';
  if (value.conversion.verification !== expectedVerification) {
    fail('GRAPH_CONVERSION_VERIFICATION_INVALID', 'Conversion verification does not match its source producer.');
  }
  validateCapabilitySnapshot(value.capabilitySnapshot);
  if (canonicalJsonString(value.capabilitySnapshot) !== canonicalJsonString(createGraphCapabilitySnapshotForCanonicalGraph(canonicalGraph))) {
    fail('GRAPH_CAPABILITY_SNAPSHOT_MISMATCH', 'Capability snapshot differs from current graph-only capabilities.');
  }
  validateAssessment(value.assessment);
  if (value.authority !== 'detached-proposal' || value.requiresUserAcceptance !== true) {
    fail('GRAPH_PROPOSAL_AUTHORITY_INVALID', 'Workspace graph proposals require detached user confirmation.');
  }
  const expectedId = proposalIdentity(value);
  if (value.proposalId !== expectedId) fail('GRAPH_PROPOSAL_IDENTITY_MISMATCH', 'Proposal envelope identity does not match its contents.');
  return value;
}

export function validateWorkspaceGraphProposal(value) {
  try {
    validateInternal(value);
    return { valid: true, proposal: structuredClone(value) };
  } catch (error) {
    return { valid: false, diagnostics: [safeResultError(error)] };
  }
}

/** Validate and return a detached, current-registry canonical graph candidate. */
export function canonicalizeWorkspaceGraphCandidate(graph) {
  try {
    const canonicalGraph = canonicalizeGraphWithProjectContract(graph);
    return { valid: true, graph: structuredClone(canonicalGraph), graphIdentity: graphIdentityV1(canonicalGraph) };
  } catch (error) {
    return { valid: false, diagnostics: [safeResultError(error)] };
  }
}

function collectManifests(graph) {
  const unique = new Map();
  graph.nodes.forEach((node) => unique.set(node.data.manifest.id, node.data.manifest));
  graph.componentDefinitions.forEach((manifest) => unique.set(manifest.id, manifest));
  const manifests = [...unique.values()];
  return manifests.map((manifest) => ({
    componentId: manifest.id,
    operation: manifest.op,
    kind: manifest.kind,
    minimumTier: manifest.runtime.minimumTier,
    browserBackend: manifest.runtime.browserBackend,
    pytorch: manifest.compatibility.pytorch,
    tensorflow: manifest.compatibility.tensorflow,
  })).sort((left, right) => left.componentId < right.componentId ? -1 : left.componentId > right.componentId ? 1 : 0);
}

function safeCompile(nodes, edges, framework) {
  try {
    const result = framework === 'pytorch'
      ? compilePipelineToPyTorch(nodes, edges)
      : compilePipelineToTensorFlow(nodes, edges);
    const qualityOrder = ['exact', 'adapted', 'approximate', 'unsupported'];
    const worstQuality = result.report.reduce((worst, entry) => (
      qualityOrder.indexOf(entry.quality) > qualityOrder.indexOf(worst) ? entry.quality : worst
    ), 'exact');
    return { status: 'supported', fidelity: worstQuality };
  } catch {
    return { status: 'unsupported', fidelity: 'unsupported' };
  }
}

function createGraphCapabilitySnapshotForCanonicalGraph(graph) {
  let tier;
  try {
    tier = estimateExecutionPlan(graph.nodes, null, { edges: graph.edges });
  } catch {
    tier = { recommendedTier: 'L3', canRunHere: false, browserBackendComplete: false, reasons: ['CAPABILITY_ASSESSMENT_FAILED'] };
  }
  return {
    components: collectManifests(graph),
    compilers: {
      pytorch: safeCompile(graph.nodes, graph.edges, 'pytorch'),
      tensorflow: safeCompile(graph.nodes, graph.edges, 'tensorflow'),
    },
    browserExecution: { status: 'not-assessed', reason: 'CURRENT_DATASET_REQUIRED' },
    executionTier: {
      recommendedTier: tier.recommendedTier,
      canRunHere: tier.canRunHere,
      browserBackendComplete: tier.browserBackendComplete,
      reasons: tier.reasons ?? [],
    },
  };
}

/** Validate graph semantics against the current registry before exposing capabilities. */
export function createGraphCapabilitySnapshot(graph) {
  const canonicalGraph = canonicalizeGraphWithProjectContract(graph);
  return createGraphCapabilitySnapshotForCanonicalGraph(canonicalGraph);
}

/** Assess browser runnability only against an explicitly supplied current dataset. */
function createDatasetBoundCapabilityAssessmentForCanonicalGraph(graph, dataset) {
  const normalizedDataset = validateAgentDataset(dataset);
  const browser = analyzeBrowserExecutionGraph({ nodes: graph.nodes, edges: graph.edges, dataset: normalizedDataset });
  let tier;
  try {
    tier = estimateExecutionPlan(graph.nodes, normalizedDataset, { edges: graph.edges });
  } catch {
    tier = { recommendedTier: 'L3', canRunHere: false, browserBackendComplete: false, reasons: ['CAPABILITY_ASSESSMENT_FAILED'] };
  }
  return {
    browserExecution: {
      status: browser.valid ? 'available' : 'unavailable',
      reason: browser.valid ? null : browser.reason ?? 'BROWSER_PREFLIGHT_FAILED',
    },
    executionTier: {
      recommendedTier: tier.recommendedTier,
      canRunHere: tier.canRunHere,
      browserBackendComplete: tier.browserBackendComplete,
      reasons: tier.reasons ?? [],
    },
  };
}

/** Validate graph semantics before exposing dataset-bound runnability. */
export function createDatasetBoundCapabilityAssessment(graph, dataset) {
  const canonicalGraph = canonicalizeGraphWithProjectContract(graph);
  return createDatasetBoundCapabilityAssessmentForCanonicalGraph(canonicalGraph, dataset);
}

function workspaceAssessment(targetGraph = { nodes: [], edges: [] }) {
  if (!isRecord(targetGraph) || !Array.isArray(targetGraph.nodes) || !Array.isArray(targetGraph.edges)) {
    fail('GRAPH_ASSESSMENT_INVALID', 'Target workspace requires nodes and edges arrays.');
  }
  if (targetGraph.nodes.length > MAX_GRAPH_NODES || targetGraph.edges.length > MAX_GRAPH_EDGES) {
    fail('GRAPH_ASSESSMENT_INVALID', 'Target workspace graph exceeds assessment bounds.');
  }
  const empty = targetGraph.nodes.length === 0 && targetGraph.edges.length === 0;
  return {
    status: empty ? 'eligible' : 'blocked',
    reasons: empty ? [] : ['TARGET_WORKSPACE_NOT_EMPTY'],
    targetWorkspace: { nodeCount: targetGraph.nodes.length, edgeCount: targetGraph.edges.length },
  };
}

function createProposal({ graph, source, conversion, targetGraph = { nodes: [], edges: [] } }) {
  const detachedGraph = canonicalizeGraphWithProjectContract(graph, { allowBlueprintId: source.producer === 'build-agent' });
  const base = {
    type: WORKSPACE_GRAPH_PROPOSAL_TYPE,
    version: WORKSPACE_GRAPH_PROPOSAL_VERSION,
    source,
    graph: detachedGraph,
    graphIdentity: graphIdentityV1(detachedGraph),
    conversion,
    capabilitySnapshot: createGraphCapabilitySnapshotForCanonicalGraph(detachedGraph),
    assessment: workspaceAssessment(targetGraph),
    authority: 'detached-proposal',
    requiresUserAcceptance: true,
  };
  const proposal = { ...base, proposalId: proposalIdentity(base) };
  const checked = validateWorkspaceGraphProposal(proposal);
  if (!checked.valid) {
    const diagnostic = checked.diagnostics[0];
    fail(diagnostic.code, 'Constructed graph proposal failed validation.', diagnostic.details ?? {});
  }
  return checked.proposal;
}

export function assessWorkspaceGraphProposal(proposal, targetGraph = { nodes: [], edges: [] }) {
  const checked = validateWorkspaceGraphProposal(proposal);
  if (!checked.valid) return checked;
  try {
    return { valid: true, assessment: workspaceAssessment(targetGraph) };
  } catch (error) {
    return { valid: false, diagnostics: [safeResultError(error)] };
  }
}

/**
 * Revalidate an unchanged detached proposal against the current registry and,
 * only when explicitly supplied, a current local dataset/workspace.
 */
export function revalidateWorkspaceGraphProposal(proposal, options = {}) {
  try {
    rejectUnknown(options, ['currentDataset', 'targetGraph'], 'options');
    const checked = validateWorkspaceGraphProposal(proposal);
    if (!checked.valid) return checked;
    const canonicalGraph = canonicalizeGraphWithProjectContract(
      checked.proposal.graph,
      { allowBlueprintId: checked.proposal.source.producer === 'build-agent' },
    );
    const result = {
      valid: true,
      proposal: checked.proposal,
      canonicalGraph: structuredClone(canonicalGraph),
      graphIdentity: graphIdentityV1(canonicalGraph),
      capabilitySnapshot: createGraphCapabilitySnapshotForCanonicalGraph(canonicalGraph),
    };

    if (options.currentDataset !== undefined) {
      result.datasetBoundCapabilities = createDatasetBoundCapabilityAssessmentForCanonicalGraph(canonicalGraph, options.currentDataset);
      if (checked.proposal.source.producer === 'build-agent') {
        const binding = checked.proposal.source.datasetBinding;
        const current = createBuildDatasetContext(options.currentDataset);
        const availableFeatures = new Set(current.featureColumns.map((column) => column.name));
        const selectionStillAvailable = binding.featureColumns.every((feature) => availableFeatures.has(feature))
          && current.targetColumn.name === binding.targetColumn;
        if (!selectionStillAvailable || current.datasetFingerprint !== binding.fingerprint) {
          return {
            ...result,
            valid: false,
            diagnostics: [{ code: !selectionStillAvailable ? 'BUILD_PROPOSAL_DATASET_SELECTION_INVALID' : 'BUILD_DATASET_STALE' }],
          };
        }
      }
    }

    if (options.targetGraph !== undefined) result.assessment = workspaceAssessment(options.targetGraph);
    return result;
  } catch (error) {
    return { valid: false, diagnostics: [safeResultError(error)] };
  }
}

function projectGraphFailure(code, details = {}) {
  return { ok: false, diagnostics: [{ code, ...details }] };
}

function preflightProjectGraph(project) {
  const customComponents = Array.isArray(project.customComponents) ? project.customComponents : [];
  const customById = new Map(customComponents.filter((manifest) => typeof manifest?.id === 'string').map((manifest) => [manifest.id, manifest]));
  const nodes = [];
  const nodeIds = new Set();
  for (const [index, node] of (project.graph?.nodes ?? []).entries()) {
    if (!node || typeof node !== 'object' || Array.isArray(node) || typeof node.id !== 'string' || !node.id.trim() || nodeIds.has(node.id)) {
      return projectGraphFailure('GRAPH_NODE_INVALID', { path: `graph.nodes[${index}]` });
    }
    const embedded = node.data?.manifest;
    const manifestId = embedded?.id;
    const manifest = embedded?.customComposite === true
      ? embedded
      : componentById.get(manifestId) ?? customById.get(manifestId);
    if (!manifest) return projectGraphFailure('GRAPH_COMPONENT_UNKNOWN', { nodeId: node.id, componentId: typeof manifestId === 'string' ? manifestId.slice(0, 120) : null });
    let canonicalNode;
    try {
      canonicalNode = createAgentNode({
        nodes,
        manifest,
        request: { id: node.id, position: node.position, parameters: node.data?.parameters ?? {} },
      });
    } catch (error) {
      if (['UNKNOWN_PARAMETER', 'INVALID_PARAMETER'].includes(error?.code)) {
        return projectGraphFailure('GRAPH_PROPERTY_INVALID', {
          nodeId: node.id,
          componentId: manifest.id,
          ...(typeof error?.details?.key === 'string' ? { propertyKey: error.details.key.slice(0, 120) } : {}),
        });
      }
      return projectGraphFailure('GRAPH_NODE_INVALID', { path: `graph.nodes[${index}]`, nodeId: node.id });
    }
    canonicalNode.type = 'pipelineNode';
    canonicalNode.data.status = 'idle';
    nodes.push(canonicalNode);
    nodeIds.add(node.id);
  }

  const edges = [];
  const edgeIds = new Set();
  for (const [index, edge] of (project.graph?.edges ?? []).entries()) {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge) || typeof edge.id !== 'string' || !edge.id.trim() || edgeIds.has(edge.id)) {
      return projectGraphFailure('GRAPH_EDGE_INVALID', { path: `graph.edges[${index}]` });
    }
    const source = nodes.find((node) => node.id === edge.source);
    const target = nodes.find((node) => node.id === edge.target);
    if (!source || !target) return projectGraphFailure('GRAPH_CONNECTION_INVALID', { edgeId: edge.id, reason: 'missingNode' });
    if (
      !source.data.manifest.outputs.some((port) => port.name === edge.sourceHandle)
      || !target.data.manifest.inputs.some((port) => port.name === edge.targetHandle)
    ) return projectGraphFailure('GRAPH_PORT_INVALID', { edgeId: edge.id, reason: 'missingPort' });
    const connection = assessConnection(edge, nodes, edges);
    if (!connection.valid) {
      const details = { edgeId: edge.id, reason: connection.reason };
      if (connection.reason === 'missingPort' || connection.reason === 'type') return projectGraphFailure('GRAPH_PORT_INVALID', details);
      if (connection.reason === 'cycle') return projectGraphFailure('GRAPH_CYCLE_INVALID', details);
      return projectGraphFailure('GRAPH_CONNECTION_INVALID', details);
    }
    edges.push({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
      type: 'deletable',
    });
    edgeIds.add(edge.id);
  }
  return { ok: true, graph: { nodes, edges }, customComponents };
}

function referencedCustomDefinitions(graph, customComponents) {
  const byId = new Map(customComponents.filter((manifest) => typeof manifest?.id === 'string').map((manifest) => [manifest.id, manifest]));
  const definitions = new Map();
  const pending = graph.nodes.map((node) => node.data.manifest.id);
  while (pending.length && definitions.size < MAX_GRAPH_COMPONENT_DEFINITIONS) {
    const id = pending.pop();
    if (definitions.has(id)) continue;
    const manifest = byId.get(id) ?? graph.nodes.find((node) => node.data.manifest.id === id)?.data.manifest;
    if (!manifest?.customComposite) continue;
    definitions.set(id, manifest);
    for (const child of manifest.composition?.nodes ?? []) {
      if (byId.has(child.componentId) || child.manifest?.customComposite) pending.push(child.componentId);
    }
  }
  return [...definitions.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function canonicalProjectGraph(rawProject) {
  let migrated;
  try {
    migrated = migrateProject(rawProject);
  } catch {
    return projectGraphFailure('VOLK_PROJECT_INVALID');
  }
  try {
    migrated = normalizeProjectCustomManifests(migrated);
  } catch {
    return projectGraphFailure('VOLK_PROJECT_INVALID');
  }
  const preflight = preflightProjectGraph(migrated);
  if (!preflight.ok) return preflight;
  const componentDefinitions = referencedCustomDefinitions(preflight.graph, preflight.customComponents);
  const graph = { ...preflight.graph, componentDefinitions };
  try {
    const canonical = validateProjectForWorkspace({
      ...migrated,
      graph: { nodes: graph.nodes, edges: graph.edges },
      customComponents: preflight.customComponents,
    });
    let dataset = null;
    if (canonical.data !== null && canonical.data !== undefined) dataset = validateAgentDataset(canonical.data);
    // Preserve project graph semantics, but use current registry manifests,
    // registered defaults, and presentation/runtime-neutral node state.
    return {
      ok: true,
      graph,
      dataset,
      projectVersion: canonical.version,
    };
  } catch {
    return projectGraphFailure('VOLK_PROJECT_INVALID');
  }
}

const projectConversion = Object.freeze({
  version: GRAPH_CONVERSION_REPORT_VERSION,
  fidelity: 'partial',
  verification: 'volk-verified',
  exactFor: ['graph-semantics', 'graph-layout', 'referenced-custom-component-definitions'],
  preserved: ['graph.nodes', 'graph.edges', 'referenced-custom-component-definitions'],
  approximated: [],
  missing: ['project.name', 'project.dataset', 'project.trainedModel', 'project.language', 'project.workspace'],
  unsupported: [],
  warnings: [],
  omitted: ['project.name', 'project.dataset', 'project.trainedModel', 'project.language', 'project.workspace'],
});

const torchExportConversion = Object.freeze({
  version: TORCH_EXPORT_CONVERSION_REPORT_VERSION,
  fidelity: 'structural',
  verification: 'adapter-verified',
  exactFor: ['supported-operator-topology', 'activation-semantics', 'feature-dimensions', 'uniform-float-dtype'],
  preserved: ['operator-order', 'feature-dimensions', 'input-dtype', 'bias-presence'],
  approximated: ['high-level-module-structure'],
  missing: ['original-python-structure', 'trained-parameter-values', 'batch-range-constraints'],
  unsupported: [],
  warnings: ['trained-weights-not-imported'],
  omitted: ['original-python-structure', 'trained-parameter-values', 'batch-range-constraints'],
});

/**
 * Create a detached proposal from a bounded metadata-only TorchExportDocumentV2. The source
 * document remains embedded so proposal validation can rematerialize and bind
 * both graph semantics and layout before B1 preview/Apply.
 */
export function createTorchExportGraphProposal(rawDocument, options = {}) {
  try {
    rejectUnknown(options, ['targetGraph'], 'options');
    const document = validateTorchExportDocument(rawDocument);
    const graph = materializeTorchExportDocument(document);
    const proposal = createProposal({
      graph,
      source: {
        version: TORCH_EXPORT_SOURCE_VERSION,
        kind: 'import',
        producer: 'torch-export-adapter',
        format: 'torch.export',
        provenance: {
          artifactId: 'torch-export-document',
          fingerprint: document.documentFingerprint,
          location: 'local-file',
        },
        torchExportDocument: document,
      },
      conversion: torchExportConversion,
      targetGraph: options.targetGraph,
    });
    return { ok: true, proposal };
  } catch (error) {
    return projectGraphFailure(error?.code ?? 'GRAPH_PROPOSAL_INVALID', safeResultError(error).details ?? {});
  }
}

export function createVolkProjectGraphProposal(rawProject, options = {}) {
  const prepared = canonicalProjectGraph(rawProject);
  if (!prepared.ok) return prepared;
  try {
    const proposal = createProposal({
      graph: prepared.graph,
      source: {
        version: GRAPH_SOURCE_VERSION,
        kind: 'import',
        producer: 'volk-project',
        format: 'volk-project',
        provenance: {
          artifactId: 'local-volk-project',
          revision: String(prepared.projectVersion),
          location: 'local-project',
        },
        projectVersion: prepared.projectVersion,
        projectEvidence: {
          format: 'VOLK-ML',
          version: prepared.projectVersion,
          customComponents: structuredClone(prepared.graph.componentDefinitions),
          graph: { nodes: structuredClone(prepared.graph.nodes), edges: structuredClone(prepared.graph.edges) },
        },
      },
      conversion: projectConversion,
      targetGraph: options.targetGraph,
    });
    return { ok: true, proposal };
  } catch (error) {
    return projectGraphFailure(error?.code ?? 'GRAPH_PROPOSAL_INVALID', safeResultError(error).details ?? {});
  }
}

/**
 * Create a detached proposal from a source-neutral canonical graph candidate.
 * This is the bounded handoff for future source adapters; it never accepts
 * dataset rows, applies a graph, or runs execution. The implemented Build Agent
 * and VOLK project producers retain their own stricter source adapters.
 */
export function createWorkspaceGraphProposalFromCandidate(candidate, options = {}) {
  try {
    rejectUnknown(candidate, ['graph', 'source', 'conversion'], 'candidate');
    rejectUnknown(options, ['targetGraph'], 'options');
    validateSource(candidate.source);
    if (OFFICIAL_PRODUCERS.has(candidate.source.producer)) {
      fail('GRAPH_PROVENANCE_INVALID', 'Implemented and reserved official producers must use their validated source adapters.');
    }
    validateConversion(candidate.conversion, { requireVerification: false });
    const conversion = { ...structuredClone(candidate.conversion), verification: 'producer-declared' };
    validateGraphShape(candidate.graph);
    assertNoBuiltinShadowing(candidate.graph);
    if (candidate.graph.blueprintId !== undefined) {
      fail('GRAPH_PROPOSAL_INVALID', 'Source-neutral graph candidates cannot supply a Build Agent blueprint identity.');
    }
    const prepared = canonicalProjectGraph({
      format: 'VOLK-ML',
      version: PROJECT_VERSION,
      name: 'Detached Graph Candidate',
      customComponents: candidate.graph.componentDefinitions,
      graph: { nodes: candidate.graph.nodes, edges: candidate.graph.edges },
      data: null,
      trainedModel: null,
    });
    if (!prepared.ok) return prepared;
    const proposal = createProposal({
      graph: prepared.graph,
      source: candidate.source,
      conversion,
      targetGraph: options.targetGraph,
    });
    return { ok: true, proposal };
  } catch (error) {
    return projectGraphFailure(error?.code ?? 'GRAPH_PROPOSAL_INVALID', safeResultError(error).details ?? {});
  }
}

function buildAgentDiagnostics(proposal) {
  const values = [
    ...proposal.application.reasons,
    ...(proposal.validation.browser.reason ? [proposal.validation.browser.reason] : []),
    ...proposal.validation.tier.reasons,
    ...FRAMEWORKS.flatMap((framework) => proposal.validation.source[framework].status === 'unsupported'
      ? [proposal.validation.source[framework].reason]
      : []),
  ];
  return [...new Set(values)].slice(0, 32);
}

const buildAgentConversion = Object.freeze({
  version: GRAPH_CONVERSION_REPORT_VERSION,
  fidelity: 'exact',
  verification: 'volk-verified',
  exactFor: ['graph-semantics', 'graph-layout', 'model-design-plan-identity', 'dataset-binding', 'rationale', 'limitations', 'diagnostics'],
  preserved: ['graph', 'planId', 'datasetBinding', 'rationale', 'limitations', 'diagnostics'],
  approximated: [],
  missing: [],
  unsupported: [],
  warnings: [],
  omitted: [],
});

export function adaptBuildAgentGraphProposal(rawProposal, options = {}) {
  let proposal;
  try {
    proposal = validateGraphProposal(rawProposal);
  } catch (error) {
    return projectGraphFailure(error?.code ?? 'BUILD_PROPOSAL_INVALID');
  }
  const graph = {
    ...structuredClone(proposal.graph),
    componentDefinitions: [],
  };
  try {
    const generic = createProposal({
      graph,
      source: {
        version: GRAPH_SOURCE_VERSION,
        kind: 'planner',
        producer: 'build-agent',
        format: 'volk-model-design-plan-v1',
        provenance: {
          artifactId: proposal.proposalId,
          revision: proposal.planId,
          fingerprint: proposal.datasetFingerprint,
          references: [proposal.blueprintId],
          location: 'generated',
        },
        sourceProposalId: proposal.proposalId,
        planId: proposal.planId,
        blueprintId: proposal.blueprintId,
        datasetBinding: {
          fingerprint: proposal.datasetFingerprint,
          featureColumns: [...proposal.datasetSelection.featureColumns],
          targetColumn: proposal.datasetSelection.targetColumn,
        },
        buildAgentProposal: structuredClone(proposal),
        rationale: [...proposal.modelDesignPlan.rationale],
        limitations: [...proposal.modelDesignPlan.limitations],
        diagnostics: buildAgentDiagnostics(proposal),
      },
      conversion: buildAgentConversion,
      targetGraph: options.targetGraph,
    });
    return { ok: true, proposal: generic };
  } catch (error) {
    return projectGraphFailure(error?.code ?? 'GRAPH_PROPOSAL_INVALID', safeResultError(error).details ?? {});
  }
}
