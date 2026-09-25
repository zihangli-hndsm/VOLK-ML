import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { componentById } from '../src/core/components.js';
import { createAgentNode } from '../src/core/canvasAgent.js';
import { createCustomComposite } from '../src/core/customComposites.js';
import {
  createGraphPatchProposal,
  dryRunGraphPatch,
  fingerprintJsonV1,
  graphIdentityV1,
  graphSemanticFingerprintV1,
  graphPresentationFingerprintV1,
  MAX_GRAPH_PATCH_OPERATIONS,
  revalidateGraphPatchProposal,
  validateGraphPatchProposal,
} from '../src/core/graph/index.js';

const clone = (value) => structuredClone(value);
const source = {
  producer: 'external-agent',
  provenance: { artifactId: 'c1-fixture', revision: '1', location: 'inline' },
};
const rationale = 'Show the proposed topology change before a later learner-confirmed handoff.';

function node(manifestId, id, position, nodes = []) {
  return createAgentNode({
    nodes,
    manifest: componentById.get(manifestId),
    request: { id, position },
    idFactory: () => 'fixed',
  });
}

function fixtureGraph() {
  const nodes = [
    node('relu_node', 'relu-a', { x: 10, y: 20 }),
    node('relu_node', 'relu-b', { x: 180, y: 20 }),
    node('dense_node', 'dense-a', { x: 10, y: 180 }),
    node('relu_node', 'relu-c', { x: 360, y: 20 }),
  ];
  return {
    nodes,
    edges: [{
      id: 'edge-old',
      source: 'relu-a',
      sourceHandle: 'output',
      target: 'relu-b',
      targetHandle: 'input',
      type: 'deletable',
    }],
    componentDefinitions: [],
  };
}

function resign(proposal) {
  const { proposalId: _proposalId, ...envelope } = proposal;
  proposal.proposalId = fingerprintJsonV1(envelope, 'graph-patch-proposal');
  return proposal;
}

function expectCode(result, code) {
  assert.equal(result.ok ?? result.valid, false, 'Expected a structured patch failure.');
  assert.equal(result.diagnostics?.[0]?.code, code, 'Expected ' + code + ', got ' + result.diagnostics?.[0]?.code + '.');
}

const baseGraph = fixtureGraph();
const baseBefore = JSON.stringify(baseGraph);
const dense = baseGraph.nodes.find((entry) => entry.id === 'dense-a');
const numericProperty = dense.data.manifest.properties.find((property) => ['number', 'slider'].includes(property.type));
assert.ok(numericProperty, 'Fixture dense component exposes a numeric property.');
const step = numericProperty.step ?? 1;
let nextValue = numericProperty.default + step;
if (Number.isFinite(numericProperty.max) && nextValue > numericProperty.max) nextValue = numericProperty.default - step;
assert.ok(!Number.isFinite(numericProperty.min) || nextValue >= numericProperty.min);
const addedDense = node('dense_node', 'dense-b', { x: 520, y: 180 }, baseGraph.nodes);
const operations = [
  { op: 'MOVE_NODE', nodeId: 'relu-a', position: { x: 30, y: 40 } },
  {
    op: 'UPDATE_PARAMETERS',
    nodeId: 'dense-a',
    parameters: { ...dense.data.parameters, [numericProperty.key]: nextValue },
  },
  { op: 'DISCONNECT', edgeId: 'edge-old' },
  {
    op: 'CONNECT',
    edge: {
      id: 'edge-new',
      source: 'relu-a',
      sourceHandle: 'output',
      target: 'relu-b',
      targetHandle: 'input',
      type: 'deletable',
    },
  },
  { op: 'ADD_NODE', node: addedDense, componentDefinitions: [] },
  { op: 'REMOVE_NODE', nodeId: 'relu-c' },
];
const operationsBefore = JSON.stringify(operations);
const result = createGraphPatchProposal({ baseGraph, operations, source, rationale });
assert.equal(result.ok, true, JSON.stringify(result.diagnostics?.[0]));
assert.equal(JSON.stringify(baseGraph), baseBefore, 'Proposal creation must not mutate the base graph.');
assert.equal(JSON.stringify(operations), operationsBefore, 'Proposal creation must not mutate caller operations.');
assert.equal(result.proposal.type, 'GraphPatchProposalV1');
assert.equal(result.proposal.version, 1);
assert.equal(result.proposal.authority, 'detached-proposal');
assert.equal(result.proposal.requiresUserAcceptance, true);
assert.equal(result.proposal.rationale, rationale);
assert.deepEqual(result.proposal.baseGraphIdentity, graphIdentityV1(result.proposal.baseGraph));
assert.deepEqual(result.proposal.expectedResultGraphIdentity, graphIdentityV1(result.resultGraph));
assert.equal(
  result.proposal.baseGraphFingerprint,
  fingerprintJsonV1(result.proposal.baseGraphIdentity, 'graph-patch-base'),
);
assert.equal(
  result.proposal.expectedResultFingerprint,
  fingerprintJsonV1(result.proposal.expectedResultGraphIdentity, 'graph-patch-result'),
);
assert.deepEqual(result.proposal.validation, {
  version: 1,
  status: 'validated',
  baseGraph: 'canonical-project-contract',
  operationReplay: 'ordered-detached-replay',
  resultGraph: 'canonical-project-contract',
  capabilitySnapshot: 'recomputed-current-registry',
  operationCount: operations.length,
  revalidateBeforeApply: true,
});
assert.equal(result.resultGraph.nodes.some((entry) => entry.id === 'relu-c'), false);
assert.equal(result.resultGraph.nodes.some((entry) => entry.id === 'dense-b'), true);
assert.deepEqual(result.resultGraph.edges.map((edge) => edge.id), ['edge-new']);

const roundTrip = validateGraphPatchProposal(JSON.parse(JSON.stringify(result.proposal)));
assert.equal(roundTrip.valid, true, roundTrip.diagnostics?.[0]?.code);
assert.deepEqual(roundTrip.resultGraph, result.resultGraph);
assert.deepEqual(revalidateGraphPatchProposal(result.proposal).graphIdentity, result.resultGraphIdentity);
assert.equal(revalidateGraphPatchProposal(result.proposal, { currentBaseGraph: baseGraph }).valid, true);
const movedCurrentBase = clone(baseGraph);
movedCurrentBase.nodes.find((entry) => entry.id === 'relu-a').position.x += 1;
expectCode(revalidateGraphPatchProposal(result.proposal, { currentBaseGraph: movedCurrentBase }), 'GRAPH_PATCH_BASE_STALE');
const semanticallyChangedCurrentBase = clone(baseGraph);
semanticallyChangedCurrentBase.nodes.find((entry) => entry.id === 'dense-a').data.parameters[numericProperty.key] = nextValue;
expectCode(revalidateGraphPatchProposal(result.proposal, { currentBaseGraph: semanticallyChangedCurrentBase }), 'GRAPH_PATCH_BASE_STALE');
assert.equal(
  createGraphPatchProposal({ baseGraph, operations, source, rationale }).proposal.proposalId,
  result.proposal.proposalId,
  'Identical base, operation order, source and recomputed claims must be deterministic.',
);

const layoutOnly = dryRunGraphPatch(baseGraph, [
  { op: 'MOVE_NODE', nodeId: 'relu-a', position: { x: 11, y: 20 } },
]);
assert.equal(layoutOnly.ok, true);
assert.equal(layoutOnly.graphIdentity.semanticFingerprint, graphSemanticFingerprintV1(baseGraph));
assert.notEqual(layoutOnly.graphIdentity.presentationFingerprint, graphPresentationFingerprintV1(baseGraph));
assert.notEqual(
  fingerprintJsonV1(layoutOnly.graphIdentity, 'graph-patch-base'),
  result.proposal.baseGraphFingerprint,
  'The explicit base fingerprint includes layout identity and changes after MOVE_NODE.',
);

const staleBase = clone(result.proposal);
staleBase.baseGraph.nodes.find((entry) => entry.id === 'relu-a').position.x += 1;
expectCode(validateGraphPatchProposal(staleBase), 'GRAPH_PATCH_GRAPH_IDENTITY_MISMATCH');

const changedOperation = clone(result.proposal);
changedOperation.operations[0].position.x += 1;
expectCode(validateGraphPatchProposal(changedOperation), 'GRAPH_PATCH_GRAPH_IDENTITY_MISMATCH');

const tamperedProposalId = clone(result.proposal);
tamperedProposalId.proposalId = 'forged-id';
expectCode(validateGraphPatchProposal(tamperedProposalId), 'GRAPH_PATCH_IDENTITY_MISMATCH');

const tamperedCapabilities = clone(result.proposal);
tamperedCapabilities.capabilitySnapshot.executionTier.canRunHere = !tamperedCapabilities.capabilitySnapshot.executionTier.canRunHere;
resign(tamperedCapabilities);
expectCode(validateGraphPatchProposal(tamperedCapabilities), 'GRAPH_PATCH_CAPABILITY_SNAPSHOT_MISMATCH');

const missingAcceptance = clone(result.proposal);
missingAcceptance.requiresUserAcceptance = false;
expectCode(validateGraphPatchProposal(missingAcceptance), 'GRAPH_PATCH_AUTHORITY_INVALID');

const wrongAuthority = clone(result.proposal);
wrongAuthority.authority = 'detached-patch-proposal';
expectCode(validateGraphPatchProposal(wrongAuthority), 'GRAPH_PATCH_AUTHORITY_INVALID');

const tamperedRationale = clone(result.proposal);
tamperedRationale.rationale += ' Changed.';
expectCode(validateGraphPatchProposal(tamperedRationale), 'GRAPH_PATCH_IDENTITY_MISMATCH');
const oversizedRationale = clone(result.proposal);
oversizedRationale.rationale = 'r'.repeat(501);
expectCode(validateGraphPatchProposal(oversizedRationale), 'GRAPH_PATCH_RATIONALE_INVALID');

const tamperedBaseFingerprint = clone(result.proposal);
tamperedBaseFingerprint.baseGraphFingerprint = 'forged-base-fingerprint';
resign(tamperedBaseFingerprint);
expectCode(validateGraphPatchProposal(tamperedBaseFingerprint), 'GRAPH_PATCH_FINGERPRINT_MISMATCH');

const tamperedResultFingerprint = clone(result.proposal);
tamperedResultFingerprint.expectedResultFingerprint = 'forged-result-fingerprint';
resign(tamperedResultFingerprint);
expectCode(validateGraphPatchProposal(tamperedResultFingerprint), 'GRAPH_PATCH_FINGERPRINT_MISMATCH');

const tamperedValidation = clone(result.proposal);
tamperedValidation.validation.operationCount += 1;
resign(tamperedValidation);
expectCode(validateGraphPatchProposal(tamperedValidation), 'GRAPH_PATCH_VALIDATION_MISMATCH');

const unknownValidationField = clone(result.proposal);
unknownValidationField.validation.unreviewed = true;
resign(unknownValidationField);
expectCode(validateGraphPatchProposal(unknownValidationField), 'GRAPH_PATCH_INVALID');

const invalidSource = clone(result.proposal);
invalidSource.source.provenance.artifactId = 'C:\\local\\model.json';
expectCode(validateGraphPatchProposal(invalidSource), 'GRAPH_PATCH_SOURCE_INVALID');

const unknownRoot = clone(result.proposal);
unknownRoot.unrecognized = true;
expectCode(validateGraphPatchProposal(unknownRoot), 'GRAPH_PATCH_INVALID');

const unknownOperationField = clone(result.proposal);
unknownOperationField.operations[0].silentMutation = true;
expectCode(validateGraphPatchProposal(unknownOperationField), 'GRAPH_PATCH_INVALID');

const unsupportedVersion = clone(result.proposal);
unsupportedVersion.version = 2;
expectCode(validateGraphPatchProposal(unsupportedVersion), 'GRAPH_PATCH_VERSION_UNSUPPORTED');

const unsupportedReplace = clone(result.proposal);
unsupportedReplace.operations = [{ op: 'REPLACE_SUBGRAPH' }];
expectCode(validateGraphPatchProposal(unsupportedReplace), 'GRAPH_PATCH_OPERATION_UNSUPPORTED');

const tamperedResultIdentity = clone(result.proposal);
tamperedResultIdentity.expectedResultGraphIdentity.presentationFingerprint = 'graph-layout-v1-forged';
resign(tamperedResultIdentity);
expectCode(validateGraphPatchProposal(tamperedResultIdentity), 'GRAPH_PATCH_GRAPH_IDENTITY_MISMATCH');

const tooManyOperations = Array.from({ length: MAX_GRAPH_PATCH_OPERATIONS + 1 }, () => ({
  op: 'MOVE_NODE',
  nodeId: 'relu-a',
  position: { x: 10, y: 20 },
}));
expectCode(dryRunGraphPatch(baseGraph, tooManyOperations), 'GRAPH_PATCH_OPERATIONS_OUT_OF_BOUNDS');

expectCode(dryRunGraphPatch(baseGraph, [
  { op: 'REMOVE_NODE', nodeId: 'relu-a' },
]), 'GRAPH_PATCH_NODE_HAS_EDGES');

expectCode(dryRunGraphPatch(baseGraph, [
  { op: 'DISCONNECT', edgeId: 'missing-edge' },
]), 'GRAPH_PATCH_EDGE_NOT_FOUND');

expectCode(dryRunGraphPatch(baseGraph, [
  {
    op: 'CONNECT',
    edge: {
      id: 'edge-invalid',
      source: 'relu-a',
      sourceHandle: 'not-an-output',
      target: 'relu-b',
      targetHandle: 'input',
      type: 'deletable',
    },
  },
]), 'GRAPH_PATCH_EDGE_PORT_INVALID');

expectCode(dryRunGraphPatch(baseGraph, [
  {
    op: 'CONNECT',
    edge: {
      id: 'edge-cycle',
      source: 'relu-b',
      sourceHandle: 'output',
      target: 'relu-a',
      targetHandle: 'input',
      type: 'deletable',
    },
  },
]), 'GRAPH_PATCH_EDGE_CYCLE');

expectCode(dryRunGraphPatch(baseGraph, [
  {
    op: 'CONNECT',
    edge: {
      id: 'edge-old',
      source: 'relu-a',
      sourceHandle: 'output',
      target: 'relu-c',
      targetHandle: 'input',
      type: 'deletable',
    },
  },
]), 'GRAPH_PATCH_DUPLICATE_EDGE_ID');

expectCode(dryRunGraphPatch(baseGraph, [
  { op: 'ADD_NODE', node: baseGraph.nodes[0], componentDefinitions: [] },
]), 'GRAPH_PATCH_DUPLICATE_NODE_ID');

expectCode(dryRunGraphPatch(baseGraph, [
  { op: 'MOVE_NODE', nodeId: 'missing-node', position: { x: 0, y: 0 } },
]), 'GRAPH_PATCH_NODE_NOT_FOUND');

expectCode(dryRunGraphPatch(baseGraph, [
  { op: 'UPDATE_PARAMETERS', nodeId: 'dense-a', parameters: { [numericProperty.key]: 'not-a-number' } },
]), 'GRAPH_PROPERTY_INVALID');

const reluNodes = [
  node('relu_node', 'composite-relu-a', { x: 0, y: 0 }),
  node('relu_node', 'composite-relu-b', { x: 180, y: 0 }),
];
const compositeEdge = [{
  id: 'composite-internal-edge',
  source: 'composite-relu-a',
  sourceHandle: 'output',
  target: 'composite-relu-b',
  targetHandle: 'input',
  type: 'deletable',
}];
const composite = createCustomComposite({
  selectedNodes: reluNodes,
  edges: compositeEdge,
  name: 'C1 Composite',
  color: '#456789',
});
const emptyGraph = { nodes: [], edges: [], componentDefinitions: [] };
const addComposite = {
  op: 'ADD_NODE',
  node: composite.instance,
  componentDefinitions: [composite.manifest],
};
const compositePatch = createGraphPatchProposal({
  baseGraph: emptyGraph,
  operations: [addComposite],
  source,
  rationale,
});
assert.equal(compositePatch.ok, true, compositePatch.diagnostics?.[0]?.code);
assert.equal(compositePatch.resultGraph.componentDefinitions.length, 1);
const secondCompositeInstance = clone(composite.instance);
secondCompositeInstance.id = 'composite-instance-second';
const secondCompositePatch = dryRunGraphPatch(compositePatch.resultGraph, [{
  op: 'ADD_NODE',
  node: secondCompositeInstance,
  componentDefinitions: [],
}]);
assert.equal(secondCompositePatch.ok, true, secondCompositePatch.diagnostics?.[0]?.code);
assert.equal(secondCompositePatch.graph.nodes.length, 2);
assert.equal(secondCompositePatch.graph.componentDefinitions.length, 1, 'A second instance reuses the base canonical definition.');

const compositeDense = node('dense_node', 'composite-dense-a', { x: 0, y: 0 });
const compositeRelu = node('relu_node', 'composite-dense-relu-b', { x: 180, y: 0 }, [compositeDense]);
const denseComposite = createCustomComposite({
  selectedNodes: [compositeDense, compositeRelu],
  edges: [{
    id: 'composite-dense-relu-edge',
    source: compositeDense.id,
    sourceHandle: 'output',
    target: compositeRelu.id,
    targetHandle: 'input',
    type: 'deletable',
  }],
  name: 'C1 Dense-ReLU',
  color: '#456789',
});
const denseCompositePatch = createGraphPatchProposal({
  baseGraph: emptyGraph,
  operations: [{
    op: 'ADD_NODE',
    node: denseComposite.instance,
    componentDefinitions: [denseComposite.manifest],
  }],
  source,
  rationale,
});
assert.equal(denseCompositePatch.ok, true, denseCompositePatch.diagnostics?.[0]?.code);
const divergentCompositeInstance = clone(denseComposite.instance);
divergentCompositeInstance.id = 'dense-relu-instance-divergent';
const denseChildSpec = divergentCompositeInstance.data.manifest.composition.nodes.find((entry) => entry.componentId === 'dense_node');
const catalogueDenseUnits = denseComposite.manifest.composition.nodes.find((entry) => entry.componentId === 'dense_node').parameters.units;
denseChildSpec.parameters.units = catalogueDenseUnits + 1;
const divergentCompositePatch = dryRunGraphPatch(denseCompositePatch.resultGraph, [{
  op: 'ADD_NODE',
  node: divergentCompositeInstance,
  componentDefinitions: [],
}]);
assert.equal(divergentCompositePatch.ok, true, divergentCompositePatch.diagnostics?.[0]?.code);
assert.equal(
  divergentCompositePatch.graph.nodes.find((entry) => entry.id === divergentCompositeInstance.id)
    .data.manifest.composition.nodes.find((entry) => entry.componentId === 'dense_node').parameters.units,
  catalogueDenseUnits + 1,
  'Adding another folded instance preserves valid instance-specific semantics.',
);
assert.equal(
  divergentCompositePatch.graph.componentDefinitions[0].composition.nodes.find((entry) => entry.componentId === 'dense_node').parameters.units,
  catalogueDenseUnits,
  'Reusing the catalogue does not overwrite its template with an instance snapshot.',
);
const nestedRelu = node('relu_node', 'nested-composite-relu', { x: 360, y: 0 }, [denseComposite.instance]);
const nestedComposite = createCustomComposite({
  selectedNodes: [denseComposite.instance, nestedRelu],
  edges: [{
    id: 'nested-composite-edge',
    source: denseComposite.instance.id,
    sourceHandle: denseComposite.manifest.outputs[0].name,
    target: nestedRelu.id,
    targetHandle: 'input',
    type: 'deletable',
  }],
  name: 'C1 Nested Dense-ReLU',
  color: '#7654a8',
});
const nestedCompositePatch = dryRunGraphPatch(emptyGraph, [{
  op: 'ADD_NODE',
  node: nestedComposite.instance,
  componentDefinitions: [denseComposite.manifest, nestedComposite.manifest],
}]);
assert.equal(nestedCompositePatch.ok, true, nestedCompositePatch.diagnostics?.[0]?.code);
const incompleteNestedNode = clone(nestedComposite.instance);
const incompleteNestedDefinition = clone(nestedComposite.manifest);
for (const manifest of [incompleteNestedNode.data.manifest, incompleteNestedDefinition]) {
  manifest.composition.nodes.find((entry) => entry.componentId === denseComposite.manifest.id).manifest = undefined;
}
const missingNestedPatch = dryRunGraphPatch(emptyGraph, [{
  op: 'ADD_NODE',
  node: incompleteNestedNode,
  componentDefinitions: [incompleteNestedDefinition],
}]);
assert.equal(missingNestedPatch.ok, false, 'Missing nested custom definitions must be rejected.');
const malformedNestedNode = clone(nestedComposite.instance);
malformedNestedNode.data.manifest.composition.nodes
  .find((entry) => entry.componentId === denseComposite.manifest.id)
  .manifest.composition.nodes.find((entry) => entry.componentId === 'dense_node')
  .parameters.units = 'not-a-number';
const malformedNestedPatch = dryRunGraphPatch(emptyGraph, [{
  op: 'ADD_NODE',
  node: malformedNestedNode,
  componentDefinitions: [denseComposite.manifest, nestedComposite.manifest],
}]);
assert.equal(malformedNestedPatch.ok, false, 'Malformed nested component definitions must be rejected.');
const missingCompositeDefinition = dryRunGraphPatch(emptyGraph, [{
  op: 'ADD_NODE',
  node: composite.instance,
  componentDefinitions: [],
}]);
expectCode(missingCompositeDefinition, 'GRAPH_COMPONENT_DEFINITION_MISSING');
const removeComposite = dryRunGraphPatch(compositePatch.resultGraph, [{
  op: 'REMOVE_NODE',
  nodeId: composite.instance.id,
}]);
assert.equal(removeComposite.ok, true, removeComposite.diagnostics?.[0]?.code);
assert.deepEqual(removeComposite.graph.componentDefinitions, [], 'Removing the last custom instance prunes its now-unreferenced definitions.');

const builtInShadow = clone(componentById.get('relu_node'));
builtInShadow.customComposite = true;
expectCode(dryRunGraphPatch(emptyGraph, [{
  op: 'ADD_NODE',
  node: {
    id: 'shadowed-relu',
    type: 'pipelineNode',
    position: { x: 0, y: 0 },
    data: { label: builtInShadow.name, manifest: builtInShadow, parameters: {}, status: 'idle' },
  },
  componentDefinitions: [builtInShadow],
}]), 'GRAPH_COMPONENT_BUILTIN_SHADOWED');

const patchModule = readFileSync(new URL('../src/core/graph/graphPatchProposal.js', import.meta.url), 'utf8');
assert.equal(/workspaceApply|prepareWorkspaceGraphApply|commitWorkspaceGraphApply/.test(patchModule), false);

console.log('Graph Patch C1 checks passed: detached replay, base/result identities, current capabilities, bounded operations, custom definitions, strict rejection, and no workspace Apply path.');
