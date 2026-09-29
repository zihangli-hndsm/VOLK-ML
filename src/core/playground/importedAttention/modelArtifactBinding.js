import { componentById } from '../../components.js';
import { graphSemanticFingerprintV1, fingerprintJsonV1 } from '../../graph/identity.js';
import { G2_ATTENTION_PROFILE_ID, G2_ATTENTION_PROFILE_SHA256 } from './profile.js';
import { G2_ATTENTION_EXPORT_MANIFEST } from './profileManifest.js';

export const MODEL_ARTIFACT_BINDING_SCHEMA = 'ModelArtifactBindingV1';

const ANCHOR_COMPONENT_ID = 'multihead_attention_node';
const EXPECTED_PARAMETERS = Object.freeze({ embed_dim: 128, num_heads: 2, dropout: 0 });
const BINDING_FIELDS = Object.freeze([
  'schema', 'bindingId', 'bindingKind', 'fullModelRepresented', 'projectSessionId',
  'graphIdentity', 'selectedAnchor', 'artifact', 'manifestIdentity', 'mapping',
  'inputContract', 'outputContract', 'runtimeIdentity', 'authority',
]);

function fail() {
  throw Object.assign(new TypeError('The selected project cannot be bound to this registered G2 artifact mapping.'), {
    code: 'G2_MODEL_ARTIFACT_BINDING_INVALID',
  });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonical(value));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function semanticComponentContract(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
  return {
    schemaVersion: manifest.schemaVersion,
    id: manifest.id,
    op: manifest.op,
    kind: manifest.kind,
    inputs: manifest.inputs,
    outputs: manifest.outputs,
    properties: Array.isArray(manifest.properties)
      ? manifest.properties.map(({ label: _presentationLabel, ...property }) => property)
      : manifest.properties,
    runtime: manifest.runtime,
    compatibility: manifest.compatibility,
    composition: manifest.composition ?? null,
  };
}

function validProjectSessionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function resolveAnchor(graph, selectedNodeId) {
  const registered = componentById.get(ANCHOR_COMPONENT_ID);
  const node = graph?.nodes?.find((item) => item?.id === selectedNodeId);
  if (!registered || !node || typeof selectedNodeId !== 'string' || !selectedNodeId || selectedNodeId.length > 160) fail();
  const manifest = node.data?.manifest;
  if (manifest?.id !== ANCHOR_COMPONENT_ID || manifest?.op !== 'multihead_attention') fail();
  if (stableJson(semanticComponentContract(manifest)) !== stableJson(semanticComponentContract(registered))) fail();
  const parameters = node.data?.parameters;
  if (stableJson(parameters) !== stableJson(EXPECTED_PARAMETERS)) fail();
  const outputs = registered.outputs;
  if (!Array.isArray(outputs) || outputs.length !== 1 || outputs[0]?.name !== 'output' || outputs[0]?.type !== 'Tensor') fail();
  return {
    nodeId: selectedNodeId,
    componentId: registered.id,
    op: registered.op,
    componentContractFingerprint: fingerprintJsonV1(semanticComponentContract(registered), 'g2-component'),
    parameters: cloneJson(EXPECTED_PARAMETERS),
    buildOutput: { port: 'output', type: 'Tensor', semantic: 'context-only' },
  };
}

function exactCurrentReference(reference) {
  return Boolean(reference
    && reference.profileId === G2_ATTENTION_PROFILE_ID
    && reference.sha256 === G2_ATTENTION_PROFILE_SHA256
    && reference.manifestId === G2_ATTENTION_EXPORT_MANIFEST.manifestId);
}

function createUnsignedBinding({ projectSessionId, graph, selectedNodeId, layerIndex, reference }) {
  if (!validProjectSessionId(projectSessionId) || !graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)
    || !Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex >= G2_ATTENTION_EXPORT_MANIFEST.outputContract.attentionTensors.length
    || !exactCurrentReference(reference)) fail();
  const anchor = resolveAnchor(graph, selectedNodeId);
  const graphFingerprint = graphSemanticFingerprintV1({
    nodes: graph.nodes,
    edges: graph.edges,
    componentDefinitions: graph.componentDefinitions ?? [],
  });
  const selectedMapping = G2_ATTENTION_EXPORT_MANIFEST.outputContract.attentionTensors[layerIndex];
  return {
    schema: MODEL_ARTIFACT_BINDING_SCHEMA,
    bindingKind: 'operator-correspondence',
    fullModelRepresented: false,
    projectSessionId,
    graphIdentity: { version: 1, semanticFingerprint: graphFingerprint },
    selectedAnchor: anchor,
    artifact: cloneJson(G2_ATTENTION_EXPORT_MANIFEST.artifact),
    manifestIdentity: {
      manifestId: G2_ATTENTION_EXPORT_MANIFEST.manifestId,
      manifestSha256: G2_ATTENTION_EXPORT_MANIFEST.manifestSha256,
    },
    mapping: {
      confidence: G2_ATTENTION_EXPORT_MANIFEST.anchorContract.mappingConfidence,
      componentId: anchor.componentId,
      nodeId: anchor.nodeId,
      layerIndex,
      operator: cloneJson(selectedMapping.operator),
      tensor: cloneJson(selectedMapping.tensor),
      allExporterDeclaredAttentionTensors: cloneJson(G2_ATTENTION_EXPORT_MANIFEST.outputContract.attentionTensors),
    },
    inputContract: cloneJson(G2_ATTENTION_EXPORT_MANIFEST.inputContract),
    outputContract: {
      logits: cloneJson(G2_ATTENTION_EXPORT_MANIFEST.outputContract.logits),
      attentionTensors: cloneJson(G2_ATTENTION_EXPORT_MANIFEST.outputContract.attentionTensors),
      missingSemantics: cloneJson(G2_ATTENTION_EXPORT_MANIFEST.outputContract.missingSemantics),
    },
    runtimeIdentity: {
      profileId: G2_ATTENTION_PROFILE_ID,
      apiVersion: 'g2-local-v2',
      adapterId: 'onnxruntime-cpu',
      provider: 'CPUExecutionProvider',
      providerVersion: G2_ATTENTION_EXPORT_MANIFEST.exporter.onnxruntime,
      storage: 'local-only',
    },
    authority: {
      experimentTruth: 'validated-local-runtime-only',
      bindingRole: 'selected-build-operator-anchor-only',
      buildOutputTensor: 'context-only',
      artifactAttentionIsBuildOutput: false,
    },
  };
}

function withBindingId(unsigned) {
  return {
    ...unsigned,
    bindingId: fingerprintJsonV1(unsigned, 'artifact-binding'),
  };
}

export function createModelArtifactBindingV1(input) {
  return deepFreeze(withBindingId(createUnsignedBinding(input)));
}

export function validateModelArtifactBindingV1(binding, current) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)
    || stableJson(Object.keys(binding).sort()) !== stableJson([...BINDING_FIELDS].sort())) fail();
  const expected = createModelArtifactBindingV1({
    projectSessionId: current?.projectSessionId,
    graph: current?.graph,
    selectedNodeId: current?.selectedNodeId,
    layerIndex: current?.layerIndex,
    reference: current?.reference,
  });
  if (stableJson(binding) !== stableJson(expected)) fail();
  return expected;
}

export function tryCreateModelArtifactBindingV1(input) {
  try {
    return { binding: createModelArtifactBindingV1(input), error: null };
  } catch (error) {
    return { binding: null, error: error?.code === 'G2_MODEL_ARTIFACT_BINDING_INVALID' ? error.code : 'G2_MODEL_ARTIFACT_BINDING_INVALID' };
  }
}
