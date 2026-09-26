import assert from 'node:assert/strict';
import { componentById, defaults } from '../src/core/components.js';
import {
  compileGraphWithSourceManifest,
  compilePipelineToPyTorch,
  compilePipelineToTensorFlow,
  validateSourceExportManifest,
} from '../src/core/compiler.js';
import {
  assertSourceExportManifestBounded,
  sha256Utf8,
  SourceExportManifestError,
  stableSourceJson,
} from '../src/core/sourceExportManifest.js';

const makeNode = (id, componentId, parameters = {}) => {
  const manifest = componentById.get(componentId);
  assert.ok(manifest, `Unknown component: ${componentId}`);
  return {
    id,
    type: 'pipelineNode',
    position: { x: 0, y: 0 },
    selected: false,
    data: { manifest, label: manifest.name, parameters: { ...defaults(manifest), ...parameters }, status: 'idle' },
  };
};
const makeEdge = (source, sourceHandle, target, targetHandle) => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});
function expectManifestError(manifest, code, label) {
  assert.throws(
    () => assertSourceExportManifestBounded(manifest),
    (error) => error instanceof SourceExportManifestError && error.code === code,
    label,
  );
}
async function expectValidationError({ nodes, edges, framework, code, manifest }, expectedCode, label) {
  await assert.rejects(
    validateSourceExportManifest({ nodes, edges, framework, code, manifest }),
    (error) => error instanceof SourceExportManifestError && error.code === expectedCode,
    label,
  );
}
const architectureNodes = [
  makeNode('input', 'tensor_input_node', { shape: '32' }),
  makeNode('dense', 'dense_node', { input_features: 32, units: 10 }),
  makeNode('relu', 'relu_node'),
  makeNode('output', 'model_output_node'),
  makeNode('loss', 'cross_entropy_loss_node'),
  makeNode('optimizer', 'adam_optimizer_node'),
];
const architectureEdges = [
  makeEdge('input', 'tensor', 'dense', 'input'),
  makeEdge('dense', 'output', 'relu', 'input'),
  makeEdge('relu', 'output', 'output', 'input'),
];

for (const framework of ['pytorch', 'tensorflow']) {
  const plain = framework === 'pytorch'
    ? compilePipelineToPyTorch(architectureNodes, architectureEdges)
    : compilePipelineToTensorFlow(architectureNodes, architectureEdges);
  const withManifest = await compileGraphWithSourceManifest(architectureNodes, architectureEdges, framework);
  assert.equal(withManifest.code, plain.code, `${framework} provenance leaves the canonical plain-source output unchanged`);
  assert.equal(withManifest.manifest.source.byteLength, new TextEncoder().encode(plain.code).length);
  assert.match(withManifest.manifest.source.sha256, /^[a-f0-9]{64}$/);
  assert.match(withManifest.manifest.workspace.semanticGraphSha256, /^[a-f0-9]{64}$/);
  assert.match(withManifest.manifest.selection.semanticGraphSha256, /^[a-f0-9]{64}$/);
  assert.equal(withManifest.manifest.framework, framework);
  assert.equal(withManifest.manifest.selection.rule, 'model-output-dependencies');
  assert.deepEqual(withManifest.manifest.selection.excludedWorkspaceNodeIds, []);
  assert.equal(withManifest.manifest.nodeMappings.some((item) => item.workspaceNodeId === 'dense'), true);
  assert.equal(withManifest.manifest.edgeMappings.filter((item) => item.kind === 'workspace-edge').length, 3, JSON.stringify(withManifest.manifest.edgeMappings));

  const bytes = new TextEncoder().encode(plain.code);
  const text = new TextDecoder().decode(bytes);
  for (const mapping of withManifest.manifest.nodeMappings) {
    for (const construct of mapping.constructs) {
      const snippet = new TextDecoder().decode(bytes.slice(construct.span.startByte, construct.span.endByte));
      assert.ok(snippet.length > 0);
      assert.ok(construct.span.endByte <= bytes.length);
      assert.ok(construct.span.endLine >= construct.span.startLine);
    }
  }
  assert.equal(text, plain.code);
  assert.deepEqual(await validateSourceExportManifest({
    nodes: architectureNodes, edges: architectureEdges, framework, code: plain.code, manifest: withManifest.manifest,
  }), { valid: true, sourceSha256: withManifest.manifest.source.sha256 });
  assert.equal((await validateSourceExportManifest({
    nodes: architectureNodes, edges: architectureEdges, framework, code: `${plain.code}# edit\n`, manifest: withManifest.manifest,
  })).valid, false);

  const viewOnlyNodes = architectureNodes.map((node, index) => ({
    ...node,
    position: { x: 99 + index, y: 300 },
    selected: true,
    data: { ...node.data, status: 'succeeded', label: { en: 'Presentation-only copy', zh: '展示文案' } },
  }));
  const viewOnly = await compileGraphWithSourceManifest(viewOnlyNodes, architectureEdges.map((edge) => ({ ...edge, selected: true, style: { stroke: 'red' } })), framework);
  assert.equal(viewOnly.manifest.workspace.semanticGraphSha256, withManifest.manifest.workspace.semanticGraphSha256);
  assert.equal(viewOnly.manifest.selection.semanticGraphSha256, withManifest.manifest.selection.semanticGraphSha256);
  assert.equal(viewOnly.manifest.source.sha256, withManifest.manifest.source.sha256);

  const changedWorldNodes = architectureNodes.map((node) => node.id === 'dense'
    ? { ...node, data: { ...node.data, parameters: { ...node.data.parameters, units: 11 } } }
    : node);
  const changed = await compileGraphWithSourceManifest(changedWorldNodes, architectureEdges, framework);
  assert.notEqual(changed.manifest.workspace.semanticGraphSha256, withManifest.manifest.workspace.semanticGraphSha256);
  assert.notEqual(changed.manifest.source.sha256, withManifest.manifest.source.sha256);

  const withOrphan = await compileGraphWithSourceManifest([
    ...architectureNodes,
    makeNode('unselected-orphan', 'dense_node', { input_features: 32, units: 4 }),
  ], architectureEdges, framework);
  assert.notEqual(withOrphan.manifest.workspace.semanticGraphSha256, withManifest.manifest.workspace.semanticGraphSha256);
  assert.equal(withOrphan.manifest.selection.semanticGraphSha256, withManifest.manifest.selection.semanticGraphSha256);
  assert.ok(withOrphan.manifest.selection.excludedWorkspaceNodeIds.includes('unselected-orphan'));
}

const trainerNodes = [
  makeNode('trainer-data', 'tabular_data_node'),
  makeNode('trainer-split', 'train_test_split_node', { train_ratio: 0.75 }),
  makeNode('trainer-input', 'tensor_input_node', { shape: '2' }),
  makeNode('trainer-dense', 'dense_node', { input_features: 2, units: 1 }),
  makeNode('trainer-output', 'model_output_node'),
  makeNode('trainer-loss', 'custom_loss_node', { expression: 'mean(abs(prediction - target))' }),
  makeNode('trainer-optimizer', 'adam_optimizer_node', { learning_rate: 0.002 }),
  makeNode('trainer', 'supervised_trainer_node', { epochs: 12, batch_size: 8, shuffle: false }),
];
const trainerEdges = [
  makeEdge('trainer-data', 'dataset', 'trainer-split', 'dataset'),
  makeEdge('trainer-input', 'tensor', 'trainer-dense', 'input'),
  makeEdge('trainer-dense', 'output', 'trainer-output', 'input'),
  makeEdge('trainer-split', 'split', 'trainer', 'dataset'),
  makeEdge('trainer-output', 'model', 'trainer', 'model'),
  makeEdge('trainer-loss', 'loss', 'trainer', 'loss'),
  makeEdge('trainer-optimizer', 'optimizer', 'trainer', 'optimizer'),
];
const legacyTabularNodes = [
  makeNode('legacy-data', 'tabular_data_node'),
  makeNode('legacy-split', 'train_test_split_node'),
  makeNode('legacy-model', 'linear_regression_node'),
  makeNode('legacy-trainer', 'gradient_descent_node', { epochs: 50 }),
  makeNode('legacy-evaluate', 'evaluate_node'),
  makeNode('legacy-predict', 'predictor_node'),
];
const legacyTabularEdges = [
  makeEdge('legacy-data', 'dataset', 'legacy-split', 'dataset'),
  makeEdge('legacy-split', 'split', 'legacy-model', 'split'),
  makeEdge('legacy-model', 'model', 'legacy-trainer', 'model'),
  makeEdge('legacy-trainer', 'trained_model', 'legacy-evaluate', 'trained_model'),
  makeEdge('legacy-trainer', 'trained_model', 'legacy-predict', 'trained_model'),
];
for (const [label, graphNodes, graphEdges] of [
  ['supervised-trainer', trainerNodes, trainerEdges],
  ['legacy-tabular', legacyTabularNodes, legacyTabularEdges],
]) {
  for (const framework of ['pytorch', 'tensorflow']) {
    const plain = framework === 'pytorch'
      ? compilePipelineToPyTorch(graphNodes, graphEdges)
      : compilePipelineToTensorFlow(graphNodes, graphEdges);
    const mapped = await compileGraphWithSourceManifest(graphNodes, graphEdges, framework);
    assert.equal(mapped.code, plain.code, `${label}/${framework} plain export remains canonical`);
    assert.ok(mapped.manifest.nodeMappings.length > 0);
    assert.ok(mapped.manifest.compilerConstructs.length > 0);
    assert.ok(mapped.manifest.edgeMappings.length > 0);
    assert.equal((await validateSourceExportManifest({
      nodes: graphNodes, edges: graphEdges, framework, code: mapped.code, manifest: mapped.manifest,
    })).valid, true);
  }
}
assert.ok((await compileGraphWithSourceManifest(trainerNodes, trainerEdges, 'pytorch'))
  .manifest.nodeMappings.some((item) => item.workspaceNodeId === 'trainer' && item.componentId === 'supervised_trainer_node'));
assert.ok((await compileGraphWithSourceManifest(legacyTabularNodes, legacyTabularEdges, 'tensorflow'))
  .manifest.nodeMappings.some((item) => item.workspaceNodeId === 'legacy-model' && item.componentId === 'linear_regression_node'));

const nestedTemplate = {
  ...componentById.get('mlp_block_node'),
  id: 'test.nested-mlp-template',
  op: 'composite',
  kind: 'composite',
  customComposite: true,
};
const outerManifest = {
  schemaVersion: 1,
  id: 'test.shared-nested-composite',
  op: 'composite',
  kind: 'composite',
  customComposite: true,
  name: { en: 'Shared nested block', zh: '共享嵌套模块' },
  description: { en: 'Test-only graph fixture.', zh: '测试图夹具。' },
  category: 'Composite',
  inputs: [{ name: 'input', type: 'Tensor' }],
  outputs: [{ name: 'output', type: 'Tensor' }],
  properties: [],
  compatibility: { pytorch: 'exact', tensorflow: 'exact' },
  composition: {
    nodes: [
      { key: 'left', componentId: nestedTemplate.id, manifest: nestedTemplate, parameters: { input_features: 32, hidden_units: 16, dropout: 0.1 } },
      { key: 'right', componentId: nestedTemplate.id, manifest: nestedTemplate, parameters: { input_features: 32, hidden_units: 16, dropout: 0.1 } },
      { key: 'sum', componentId: 'add_node', parameters: {} },
    ],
    edges: [
      { source: 'left', sourceHandle: 'output', target: 'sum', targetHandle: 'a' },
      { source: 'right', sourceHandle: 'output', target: 'sum', targetHandle: 'b' },
    ],
    inputs: { input: [{ node: 'left', port: 'input' }, { node: 'right', port: 'input' }] },
    outputs: { output: { node: 'sum', port: 'output' } },
  },
};
const nestedNodes = [
  makeNode('nested-input', 'tensor_input_node', { shape: '32' }),
  { ...makeNode('folded-instance', 'mlp_block_node'), data: { ...makeNode('folded-instance', 'mlp_block_node').data, manifest: outerManifest } },
  makeNode('nested-output', 'model_output_node'),
];
const nestedEdges = [
  makeEdge('nested-input', 'tensor', 'folded-instance', 'input'),
  makeEdge('folded-instance', 'output', 'nested-output', 'input'),
];
let nestedA;
for (const framework of ['pytorch', 'tensorflow']) {
  const first = await compileGraphWithSourceManifest(nestedNodes, nestedEdges, framework);
  const second = await compileGraphWithSourceManifest(nestedNodes, nestedEdges, framework);
  assert.equal(first.code, second.code);
  assert.equal(stableSourceJson(first.manifest), stableSourceJson(second.manifest));
  assert.equal(new Set(first.manifest.selection.expandedNodeIds).size, first.manifest.selection.expandedNodeIds.length);
  const nestedDenseMappings = first.manifest.nodeMappings.filter((item) => (
    item.workspaceNodeId === 'folded-instance' && item.componentId === 'dense_node'
  ));
  assert.equal(nestedDenseMappings.length, 2, 'nested child key collisions remain distinct in origin mappings');
  assert.notDeepEqual(nestedDenseMappings[0].compositionPath, nestedDenseMappings[1].compositionPath);
  const sharedInputMappings = first.manifest.edgeMappings.filter((edge) => edge.workspaceEdgeId === nestedEdges[0].id);
  assert.equal(sharedInputMappings.length, 2, 'a shared boundary input maps to both nested branches');
  assert.equal(new Set(sharedInputMappings.map((edge) => edge.targetNodeId)).size, 2);
  assert.ok(first.manifest.nodeMappings.every((item) => item.workspaceNodeId !== 'mlp_block_node'), 'catalogue templates are not mistaken for the folded workspace instance');
  if (framework === 'pytorch') nestedA = first;
}

const malformedManifestFixtures = [
  ['null node mapping', (manifest) => { manifest.nodeMappings = [null]; }, 'SOURCE_EXPORT_MANIFEST_INVALID'],
  ['null node construct', (manifest) => { manifest.nodeMappings[0].constructs[0] = null; }, 'SOURCE_EXPORT_MANIFEST_INVALID'],
  ['null node span', (manifest) => { manifest.nodeMappings[0].constructs[0].span = null; }, 'SOURCE_EXPORT_SPAN_INVALID'],
  ['null edge mapping', (manifest) => { manifest.edgeMappings = [null]; }, 'SOURCE_EXPORT_MANIFEST_INVALID'],
  ['null edge construct', (manifest) => { manifest.edgeMappings[0].constructs[0] = null; }, 'SOURCE_EXPORT_MANIFEST_INVALID'],
  ['null compiler construct', (manifest) => { manifest.compilerConstructs[0] = null; }, 'SOURCE_EXPORT_MANIFEST_INVALID'],
  ['empty node identity', (manifest) => { manifest.nodeMappings[0].workspaceNodeId = ''; }, 'SOURCE_EXPORT_MANIFEST_INVALID'],
  ['empty edge identity', (manifest) => { manifest.edgeMappings[0].id = ''; }, 'SOURCE_EXPORT_MANIFEST_INVALID'],
  ['invalid workspace hash', (manifest) => { manifest.workspace.semanticGraphSha256 = 'not-a-sha256'; }, 'SOURCE_EXPORT_MANIFEST_INVALID'],
  ['unsupported compiler contract', (manifest) => { manifest.compiler.contractVersion += 1; }, 'SOURCE_EXPORT_MANIFEST_INVALID'],
  ['unsupported framework', (manifest) => { manifest.framework = 'unsupported'; }, 'SOURCE_EXPORT_MANIFEST_INVALID'],
];
for (const framework of ['pytorch', 'tensorflow']) {
  const baseline = await compileGraphWithSourceManifest(nestedNodes, nestedEdges, framework);
  for (const [label, mutate, errorCode] of malformedManifestFixtures) {
    const malformedManifest = structuredClone(baseline.manifest);
    mutate(malformedManifest);
    expectManifestError(malformedManifest, errorCode, `${framework}: ${label} has a stable bounded diagnostic`);
    await expectValidationError({
      nodes: nestedNodes,
      edges: nestedEdges,
      framework,
      code: baseline.code,
      manifest: malformedManifest,
    }, errorCode, `${framework}: ${label} is rejected by manifest validation`);
  }
}

const nestedValidationInput = {
  nodes: nestedNodes,
  edges: nestedEdges,
  framework: 'pytorch',
  code: nestedA.code,
};
const rejectedRematerialization = async (label, { manifest = structuredClone(nestedA.manifest), ...input } = {}) => {
  const result = await validateSourceExportManifest({ ...nestedValidationInput, ...input, manifest });
  assert.equal(result.valid, false, `${label} must not validate`);
  assert.equal(result.reason, 'SOURCE_EXPORT_REMATERIALIZATION_MISMATCH', `${label} has a stable rematerialization diagnostic`);
};
await rejectedRematerialization('changed node identity', {
  manifest: (() => { const value = structuredClone(nestedA.manifest); value.nodeMappings[0].workspaceNodeId = 'different-node'; return value; })(),
});
await rejectedRematerialization('changed edge identity', {
  manifest: (() => {
    const value = structuredClone(nestedA.manifest);
    value.edgeMappings[0].id = 'different-edge';
    value.edgeMappings[0].workspaceEdgeId = 'different-edge';
    return value;
  })(),
});
await rejectedRematerialization('changed source span', {
  manifest: (() => {
    const value = structuredClone(nestedA.manifest);
    value.nodeMappings[0].constructs[0].span.endLine += 1;
    return value;
  })(),
});
await rejectedRematerialization('changed workspace graph hash', {
  manifest: (() => { const value = structuredClone(nestedA.manifest); value.workspace.semanticGraphSha256 = '0'.repeat(64); return value; })(),
});
await rejectedRematerialization('changed selected graph hash', {
  manifest: (() => { const value = structuredClone(nestedA.manifest); value.selection.semanticGraphSha256 = '0'.repeat(64); return value; })(),
});
await rejectedRematerialization('changed compiler identity', {
  manifest: (() => { const value = structuredClone(nestedA.manifest); value.compiler.irVersion += 1; return value; })(),
});
await rejectedRematerialization('changed supported framework', { framework: 'tensorflow' });

const changedParameterNodes = structuredClone(nestedNodes);
changedParameterNodes.find((node) => node.id === 'folded-instance')
  .data.manifest.composition.nodes[0].parameters.input_features = 64;
await rejectedRematerialization('changed graph parameter', { nodes: changedParameterNodes });

const changedTopologyEdges = [
  architectureEdges[0],
  makeEdge('dense', 'output', 'output', 'input'),
];
const architectureBaseline = await compileGraphWithSourceManifest(architectureNodes, architectureEdges, 'pytorch');
const changedTopology = await validateSourceExportManifest({
  nodes: architectureNodes,
  edges: changedTopologyEdges,
  framework: 'pytorch',
  code: architectureBaseline.code,
  manifest: architectureBaseline.manifest,
});
assert.equal(changedTopology.valid, false, 'changed graph topology must not reuse the old manifest');
assert.equal(changedTopology.reason, 'SOURCE_EXPORT_REMATERIALIZATION_MISMATCH');

const tamperedSource = `${nestedA.code}# edited source with recomputed digest\n`;
const rehashedTamperedManifest = structuredClone(nestedA.manifest);
rehashedTamperedManifest.source.byteLength = new TextEncoder().encode(tamperedSource).length;
rehashedTamperedManifest.source.sha256 = await sha256Utf8(tamperedSource);
await rejectedRematerialization('edited source with a recomputed source hash', {
  code: tamperedSource,
  manifest: rehashedTamperedManifest,
});

const malformed = structuredClone(nestedA.manifest);
malformed.selection.expandedNodeIds.push('unbounded-claim');
await rejectedRematerialization('inconsistent expanded identity claim', { manifest: malformed });

console.log('Source export manifest and deterministic provenance checks passed.');
