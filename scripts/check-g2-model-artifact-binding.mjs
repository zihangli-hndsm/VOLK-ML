import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { componentById } from '../src/core/components.js';
import { fingerprintJsonV1 } from '../src/core/graph/identity.js';
import { PROJECT_VERSION, migrateProject, validateProjectForWorkspace } from '../src/core/project.js';
import { createLocalModelReference, validateLocalModelReferences } from '../src/core/localModelReferences.js';
import { G2_ATTENTION_EXPORT_MANIFEST } from '../src/core/playground/importedAttention/profileManifest.js';
import {
  createModelArtifactBindingV1,
  validateModelArtifactBindingV1,
} from '../src/core/playground/importedAttention/modelArtifactBinding.js';
import {
  G2_ATTENTION_PROFILE_ID,
  G2_ATTENTION_PROFILE_SHA256,
  G2_ATTENTION_LEGACY_SHA256S,
} from '../src/core/playground/importedAttention/profile.js';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

const manifestWithoutDigest = { ...G2_ATTENTION_EXPORT_MANIFEST };
delete manifestWithoutDigest.manifestSha256;
assert.equal(digest(manifestWithoutDigest), G2_ATTENTION_EXPORT_MANIFEST.manifestSha256, 'The pinned exporter manifest digest covers its canonical contents.');
assert.equal(G2_ATTENTION_EXPORT_MANIFEST.schema, 'ModelArtifactBindingManifestV1');
assert.equal(G2_ATTENTION_EXPORT_MANIFEST.bindingKind, 'operator-correspondence');
assert.equal(G2_ATTENTION_EXPORT_MANIFEST.fullModelRepresented, false);
assert.equal(G2_ATTENTION_EXPORT_MANIFEST.artifact.sha256, G2_ATTENTION_PROFILE_SHA256);
assert.deepEqual(G2_ATTENTION_EXPORT_MANIFEST.outputContract.attentionTensors.map(({ tensor }) => tensor.name), ['attention_layer_0', 'attention_layer_1']);
assert.deepEqual(G2_ATTENTION_EXPORT_MANIFEST.outputContract.attentionTensors.map(({ tensor }) => tensor.onnxMetadataShape), [
  [1, 2, 'sequence', null],
  [1, 2, 'sequence', null],
]);
assert.deepEqual(G2_ATTENTION_EXPORT_MANIFEST.outputContract.attentionTensors.map(({ tensor }) => tensor.runtimeShape), [
  [1, 2, 6, 6],
  [1, 2, 6, 6],
]);
assert.equal(G2_ATTENTION_EXPORT_MANIFEST.outputContract.missingSemantics.buildNodeDoesNotProduceArtifactTensor, true);
assert.equal(G2_ATTENTION_EXPORT_MANIFEST.anchorContract.buildOutputTensor, 'context-only');

const registered = componentById.get('multihead_attention_node');
const graphFor = ({ nodeId = 'attention-anchor-17', position = { x: 10, y: 20 }, parameters = { embed_dim: 128, num_heads: 2, dropout: 0 } } = {}) => ({
  nodes: [{ id: nodeId, position, data: { manifest: structuredClone(registered), parameters: { ...parameters } } }],
  edges: [],
  componentDefinitions: [],
});
const projectSessionId = 'project-session-binding-test-001';
const reference = createLocalModelReference({ profileId: G2_ATTENTION_PROFILE_ID, sha256: G2_ATTENTION_PROFILE_SHA256 });
assert.deepEqual(Object.keys(reference).sort(), ['manifestId', 'profileId', 'sha256']);
assert.equal(reference.manifestId, G2_ATTENTION_EXPORT_MANIFEST.manifestId);
assert.equal(validateLocalModelReferences([reference]), true);
assert.equal(validateLocalModelReferences([{
  profileId: G2_ATTENTION_PROFILE_ID,
  sha256: G2_ATTENTION_PROFILE_SHA256,
  manifestId: 'forged-export-manifest',
}]), false);
assert.equal(validateLocalModelReferences([createLocalModelReference({
  profileId: G2_ATTENTION_PROFILE_ID,
  sha256: G2_ATTENTION_LEGACY_SHA256S[0],
})]), true, 'The exact old profile alias remains a hash-only standalone reference.');

assert.equal(PROJECT_VERSION, 10);
const migratedV9 = migrateProject({
  format: 'VOLK-ML',
  version: 9,
  name: 'G2 v9 reference migration',
  graph: { nodes: [], edges: [] },
  localModelReferences: [{ profileId: G2_ATTENTION_PROFILE_ID, sha256: G2_ATTENTION_PROFILE_SHA256 }],
});
assert.deepEqual(migratedV9.localModelReferences, [reference], 'Version 9 exact current artifacts gain only the registered manifest identity.');
assert.deepEqual(validateProjectForWorkspace(migratedV9).localModelReferences, [reference]);
assert.throws(() => validateProjectForWorkspace({
  ...migratedV9,
  localModelReferences: [{ profileId: G2_ATTENTION_PROFILE_ID, sha256: G2_ATTENTION_PROFILE_SHA256, manifestId: 'unregistered' }],
}), 'invalidProject');

const graph = graphFor();
const binding = createModelArtifactBindingV1({
  projectSessionId,
  graph,
  selectedNodeId: 'attention-anchor-17',
  layerIndex: 0,
  reference,
});
assert.equal(binding.schema, 'ModelArtifactBindingV1');
assert.equal(binding.bindingKind, 'operator-correspondence');
assert.equal(binding.fullModelRepresented, false);
assert.equal(binding.selectedAnchor.nodeId, 'attention-anchor-17');
assert.equal(binding.selectedAnchor.buildOutput.semantic, 'context-only');
assert.equal(binding.mapping.operator.opType, 'Attention');
assert.equal(binding.mapping.operator.nodeName, 'node__symbolic_multi_out__3');
assert.equal(binding.mapping.tensor.name, 'attention_layer_0');
assert.equal(binding.mapping.tensor.semantic, 'post-softmax-attention-probabilities');
assert.equal(binding.runtimeIdentity.provider, 'CPUExecutionProvider');
assert.equal(binding.authority.artifactAttentionIsBuildOutput, false);
assert.equal(JSON.stringify(binding).includes('this movie was good'), false, 'The binding contains identity metadata, not learner text or token IDs.');
assert.equal(JSON.stringify(binding).includes('model.safetensors'), false, 'The binding never includes checkpoint or ONNX bytes.');
assert.equal(validateModelArtifactBindingV1(binding, {
  projectSessionId,
  graph,
  selectedNodeId: 'attention-anchor-17',
  layerIndex: 0,
  reference,
}).bindingId, binding.bindingId);

const layoutOnly = graphFor({ position: { x: 200, y: 500 } });
assert.equal(createModelArtifactBindingV1({ projectSessionId, graph: layoutOnly, selectedNodeId: 'attention-anchor-17', layerIndex: 0, reference }).bindingId, binding.bindingId,
  'Layout-only movement follows semantic graph identity and does not stale the binding.');

function expectRejected(mutatedBinding, context = {}) {
  assert.throws(() => validateModelArtifactBindingV1(mutatedBinding, {
    projectSessionId,
    graph,
    selectedNodeId: 'attention-anchor-17',
    layerIndex: 0,
    reference,
    ...context,
  }), (error) => error?.code === 'G2_MODEL_ARTIFACT_BINDING_INVALID');
}

const tamperCases = [
  (value) => { value.selectedAnchor.nodeId = 'other-node'; },
  (value) => { value.selectedAnchor.componentId = 'dense_node'; },
  (value) => { value.mapping.componentId = 'dense_node'; },
  (value) => { value.mapping.tensor.name = 'logits'; },
  (value) => { value.mapping.layerIndex = 1; },
  (value) => { value.mapping.tensor.heads = 12; },
  (value) => { value.mapping.tensor.runtimeShape = [1, 2, 6, 5]; },
  (value) => { value.mapping.tensor.onnxMetadataShape = [1, 2, 6, 6]; },
  (value) => { value.inputContract.tokenizer.revision = 'latest'; },
  (value) => { value.inputContract.preprocessing.changedContentTokenPosition = 3; },
  (value) => { value.artifact.sourceRevision = 'un-pinned'; },
  (value) => { value.artifact.profileId = 'other-profile'; },
  (value) => { value.artifact.sha256 = 'a'.repeat(64); },
  (value) => { value.outputContract.attentionTensors.reverse(); },
  (value) => { value.fullModelRepresented = true; },
  (value) => { value.authority.artifactAttentionIsBuildOutput = true; },
];
for (const mutate of tamperCases) {
  const forged = structuredClone(binding);
  mutate(forged);
  forged.bindingId = fingerprintJsonV1(Object.fromEntries(Object.entries(forged).filter(([key]) => key !== 'bindingId')), 'artifact-binding');
  expectRejected(forged);
}

assert.throws(() => validateModelArtifactBindingV1(binding, {
  projectSessionId: 'project-session-replaced-002', graph, selectedNodeId: 'attention-anchor-17', layerIndex: 0, reference,
}), (error) => error?.code === 'G2_MODEL_ARTIFACT_BINDING_INVALID', 'A binding is session-scoped.');
assert.throws(() => validateModelArtifactBindingV1(binding, {
  projectSessionId,
  graph: graphFor({ parameters: { embed_dim: 128, num_heads: 4, dropout: 0 } }),
  selectedNodeId: 'attention-anchor-17', layerIndex: 0, reference,
}), (error) => error?.code === 'G2_MODEL_ARTIFACT_BINDING_INVALID', 'A live graph semantic change stales the binding.');
assert.throws(() => validateModelArtifactBindingV1(binding, {
  projectSessionId,
  graph,
  selectedNodeId: 'different-selected-node',
  layerIndex: 0,
  reference,
}), (error) => error?.code === 'G2_MODEL_ARTIFACT_BINDING_INVALID', 'Binding cannot silently follow a different UI selection.');
assert.throws(() => createModelArtifactBindingV1({
  projectSessionId, graph, selectedNodeId: 'attention-anchor-17', layerIndex: 0,
  reference: createLocalModelReference({ profileId: G2_ATTENTION_PROFILE_ID, sha256: G2_ATTENTION_LEGACY_SHA256S[0] }),
}), (error) => error?.code === 'G2_MODEL_ARTIFACT_BINDING_INVALID', 'The legacy artifact has no operator correspondence manifest.');

console.log('G2 model-artifact binding contract checks passed.');
