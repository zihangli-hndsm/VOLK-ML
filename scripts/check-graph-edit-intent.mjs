import assert from 'node:assert/strict';
import { componentById } from '../src/core/components.js';
import { createAgentNode } from '../src/core/canvasAgent.js';
import { createCustomComposite } from '../src/core/customComposites.js';
import {
  compileGraphEditPlan,
  createGraphEditContext,
  createLlmGraphEditIntentInterpreter,
  GRAPH_EDIT_INTENT_VERSION,
  GRAPH_EDIT_MAX_STEPS,
  resolveGraphEditLocally,
  validateGraphEditIntentPlan,
} from '../src/core/graph/graphEditIntent.js';
import { graphIdentityV1 } from '../src/core/graph/identity.js';
import { validateGraphPatchProposal } from '../src/core/graph/graphPatchProposal.js';

const clone = (value) => structuredClone(value);
const node = (componentId, id, x, y, label = null) => {
  const created = createAgentNode({ nodes: [], manifest: componentById.get(componentId), request: { id, position: { x, y } }, idFactory: () => 'fixture' });
  return label ? { ...created, data: { ...created.data, label } } : created;
};

function makeProject() {
  const data = node('tabular_data_node', 'private-node-data', 40, 40, 'Private Data Label');
  const split = node('train_test_split_node', 'split-node-raw', 250, 40, 'Split A');
  const regression = node('linear_regression_node', 'regression-node-raw', 470, 40, 'Regressor A');
  const input = node('tensor_input_node', 'input-node-raw', 40, 280, 'Input A');
  const dense = node('dense_node', 'dense-node-raw', 250, 280, 'Dense A');
  const output = node('model_output_node', 'output-node-raw', 470, 280, 'Output A');
  return {
    format: 'VOLK-ML', version: 8, name: 'Private Project Name', customComponents: [],
    graph: {
      nodes: [data, split, regression, input, dense, output],
      edges: [
        { id: 'private-edge-one', source: data.id, sourceHandle: 'dataset', target: split.id, targetHandle: 'dataset', type: 'deletable' },
        { id: 'private-edge-two', source: split.id, sourceHandle: 'split', target: regression.id, targetHandle: 'split', type: 'deletable' },
        { id: 'private-edge-three', source: input.id, sourceHandle: 'tensor', target: dense.id, targetHandle: 'input', type: 'deletable' },
        { id: 'private-edge-four', source: dense.id, sourceHandle: 'output', target: output.id, targetHandle: 'input', type: 'deletable' },
      ],
    },
  };
}

function planFor(context, steps, requestId = 'local-graph-edit-1', source = 'local') {
  return {
    version: GRAPH_EDIT_INTENT_VERSION,
    requestId,
    kind: 'plan',
    steps,
    code: null,
    source,
    contextIdentity: context.contextIdentity,
    projectSignature: context.projectSignature,
  };
}

const project = makeProject();
const projectBefore = JSON.stringify(project);
const context = createGraphEditContext(project);
assert.equal(context.projection.topologyCoverage, 'complete');
const wire = JSON.stringify(context.projection);
for (const privateValue of ['private-node-data', 'split-node-raw', 'private-edge-one', 'Private Project Name', 'Private Data Label']) {
  assert.equal(wire.includes(privateValue), false, `Provider projection excludes ${privateValue}.`);
}
assert.match(wire, /semanticFingerprint/);
assert.match(wire, /presentationFingerprint/);
assert.equal(context.projection.nodes.length, project.graph.nodes.length);
assert.equal(context.projection.edges.length, project.graph.edges.length);

const nodeRef = (id) => context.nodeRefById.get(id);
const edgeRef = (id) => context.edgeRefById.get(id);
const componentRef = (id) => context.componentRefById.get(id);
const denseRef = nodeRef('dense-node-raw');
const inputRef = nodeRef('input-node-raw');
const outputRef = nodeRef('output-node-raw');
const splitRef = nodeRef('split-node-raw');

// UPDATE_PARAMETERS is schema-bound and preserves every unrequested override.
const dense = project.graph.nodes.find((entry) => entry.id === 'dense-node-raw');
const update = compileGraphEditPlan({
  project,
  context,
  requestId: 'local-graph-edit-1',
  plan: planFor(context, [{ op: 'UPDATE_PARAMETERS', nodeRef: denseRef, changes: [{ key: 'units', value: 96 }] }]),
});
assert.equal(update.ok, true, JSON.stringify(update.diagnostics?.[0]));
assert.equal(update.proposal.operations[0].op, 'UPDATE_PARAMETERS');
assert.equal(update.proposal.operations[0].parameters.units, 96);
assert.equal(update.proposal.operations[0].parameters.use_bias, dense.data.parameters.use_bias);
assert.deepEqual(project.graph.nodes.find((entry) => entry.id === 'dense-node-raw').data.parameters, dense.data.parameters);

const invalidParameter = compileGraphEditPlan({
  project,
  context,
  plan: planFor(context, [{ op: 'UPDATE_PARAMETERS', nodeRef: denseRef, changes: [{ key: 'units', value: 96.5 }] }]),
});
assert.equal(invalidParameter.ok, false, 'Step-invalid numeric values are rejected locally before C1 staging.');

// ADD_NODE plus typed CONNECT steps become deterministic canonical C1 ops.
const addAndConnect = compileGraphEditPlan({
  project,
  context,
  requestId: 'local-graph-edit-add',
  plan: planFor(context, [
    { op: 'ADD_NODE', componentRef: componentRef('dense_node'), resultRef: 'new_layer' },
    { op: 'DISCONNECT', edgeRef: edgeRef('private-edge-four') },
    { op: 'CONNECT', sourceRef: denseRef, sourcePort: 'output', targetRef: 'new_layer', targetPort: 'input' },
    { op: 'CONNECT', sourceRef: 'new_layer', sourcePort: 'output', targetRef: outputRef, targetPort: 'input' },
  ], 'local-graph-edit-add'),
});
assert.equal(addAndConnect.ok, true, addAndConnect.diagnostics?.[0]?.code);
assert.deepEqual(addAndConnect.proposal.operations.map((operation) => operation.op), ['ADD_NODE', 'DISCONNECT', 'CONNECT', 'CONNECT']);
assert.equal(addAndConnect.resultGraph.nodes.filter((entry) => entry.data.manifest.id === 'dense_node').length, 2);
assert.equal(validateGraphPatchProposal(addAndConnect.proposal).valid, true);

// Existing custom composites are referenced by their current exact local definition; no manifest is provider-authored.
const denseTwo = node('relu_node', 'relu-node-for-composite', 700, 280, 'Relu A');
const compositeEdge = { id: 'internal-edge', source: dense.id, sourceHandle: 'output', target: denseTwo.id, targetHandle: 'input', type: 'deletable' };
const customDefinition = createCustomComposite({ selectedNodes: [dense, denseTwo], edges: [...project.graph.edges, compositeEdge], name: 'Private Custom Block', color: '#0f766e' }).manifest;
const customProject = { ...project, customComponents: [customDefinition] };
const customContext = createGraphEditContext(customProject);
const customRef = customContext.componentRefById.get(customDefinition.id);
assert.ok(customRef);
const customAdd = compileGraphEditPlan({
  project: customProject,
  context: customContext,
  requestId: 'local-custom-add',
  plan: planFor(customContext, [{ op: 'ADD_NODE', componentRef: customRef, resultRef: 'new_block' }], 'local-custom-add'),
});
assert.equal(customAdd.ok, true, customAdd.diagnostics?.[0]?.code);
assert.deepEqual(JSON.parse(JSON.stringify(customAdd.proposal.operations[0].componentDefinitions)), JSON.parse(JSON.stringify([customDefinition])));

// REMOVE_NODE inserts explicit prior disconnects, as required by C1 ordering.
const removeSplit = compileGraphEditPlan({
  project,
  context,
  requestId: 'local-remove',
  plan: planFor(context, [{ op: 'REMOVE_NODE', nodeRef: splitRef }], 'local-remove'),
});
assert.equal(removeSplit.ok, true, removeSplit.diagnostics?.[0]?.code);
assert.deepEqual(removeSplit.proposal.operations.map((operation) => operation.op), ['DISCONNECT', 'DISCONNECT', 'REMOVE_NODE']);
assert.equal(removeSplit.resultGraph.nodes.some((entry) => entry.id === 'split-node-raw'), false);

// DISCONNECT and MOVE_NODE are supported; a move changes only presentation identity.
const disconnect = compileGraphEditPlan({
  project,
  context,
  requestId: 'local-disconnect',
  plan: planFor(context, [{ op: 'DISCONNECT', edgeRef: edgeRef('private-edge-four') }], 'local-disconnect'),
});
assert.equal(disconnect.ok, true);
assert.equal(disconnect.proposal.operations[0].op, 'DISCONNECT');
const move = compileGraphEditPlan({
  project,
  context,
  requestId: 'local-move',
  plan: planFor(context, [{ op: 'MOVE_NODE', nodeRef: denseRef, relation: 'right-of', anchorRef: inputRef }], 'local-move'),
});
assert.equal(move.ok, true, move.diagnostics?.[0]?.code);
assert.equal(move.semanticChanged, false);
assert.equal(move.proposal.operations[0].op, 'MOVE_NODE');
assert.equal(move.proposal.expectedResultGraphIdentity.semanticFingerprint, context.identity.semanticFingerprint);
assert.notEqual(move.proposal.expectedResultGraphIdentity.presentationFingerprint, context.identity.presentationFingerprint);

// Invalid ports, cycles, unknown component aliases, stale identities and REPLACE_SUBGRAPH never create proposals.
const invalidPort = compileGraphEditPlan({
  project,
  context,
  plan: planFor(context, [{ op: 'CONNECT', sourceRef: nodeRef('private-node-data'), sourcePort: 'dataset', targetRef: denseRef, targetPort: 'input' }]),
});
assert.equal(invalidPort.ok, false, 'C1 type validation rejects a Table-to-Tensor connection.');
const unsupportedReplace = validateGraphEditIntentPlan({
  version: 1, requestId: 'r', kind: 'plan', code: null, steps: [{ op: 'REPLACE_SUBGRAPH' }],
}, { requestId: 'r', context });
assert.equal(unsupportedReplace.valid, false);
assert.equal(unsupportedReplace.diagnostics[0].code, 'GRAPH_EDIT_OPERATION_UNSUPPORTED');
const unknownAlias = validateGraphEditIntentPlan({
  version: 1, requestId: 'r', kind: 'plan', code: null,
  steps: [{ op: 'REMOVE_NODE', nodeRef: 'raw-node-id' }],
}, { requestId: 'r', context });
assert.equal(unknownAlias.valid, false);
assert.equal(validateGraphEditIntentPlan({ version: 2 }, { requestId: 'r', context }).valid, false);
assert.equal(validateGraphEditIntentPlan({ version: 1, requestId: 'other', kind: 'plan', code: null, steps: [{ op: 'REMOVE_NODE', nodeRef: splitRef }] }, { requestId: 'r', context }).diagnostics[0].code, 'GRAPH_EDIT_INTENT_STALE');
const tooMany = validateGraphEditIntentPlan({
  version: 1, requestId: 'r', kind: 'plan', code: null,
  steps: Array.from({ length: GRAPH_EDIT_MAX_STEPS + 1 }, () => ({ op: 'DISCONNECT', edgeRef: edgeRef('private-edge-four') })),
}, { requestId: 'r', context });
assert.equal(tooMany.valid, false, 'Intent count cannot exceed the C1 patch bound.');

// Local parsing is conservative for every major operation class and provides ambiguity rather than guessing.
assert.equal(resolveGraphEditLocally('set Dense A Output Units to 96', context, { requestId: 'offline-1' }).kind, 'plan');
assert.equal(resolveGraphEditLocally('remove Split A', context, { requestId: 'offline-2' }).steps[0].op, 'REMOVE_NODE');
assert.equal(resolveGraphEditLocally('add Dense / Linear', context, { requestId: 'offline-3' }).steps[0].op, 'ADD_NODE');
assert.equal(resolveGraphEditLocally('disconnect Input A to Dense A', context, { requestId: 'offline-4' }).steps[0].op, 'DISCONNECT');
const moveLocal = resolveGraphEditLocally('move Dense A right of Input A', context, { requestId: 'offline-5' });
assert.equal(moveLocal.steps[0].op, 'MOVE_NODE');
assert.equal(resolveGraphEditLocally('replace the subgraph', context, { requestId: 'offline-6' }).code, 'unsupported-replace-subgraph');
const duplicateProject = clone(project);
duplicateProject.graph.nodes.push({ ...clone(dense), id: 'dense-node-duplicate', position: { x: 800, y: 400 } });
const duplicateContext = createGraphEditContext(duplicateProject);
const ambiguous = resolveGraphEditLocally('remove Dense A', duplicateContext, { requestId: 'offline-7' });
assert.equal(ambiguous.kind, 'clarification');
assert.equal(ambiguous.code, 'ambiguous-target');
assert.equal(ambiguous.candidates.length, 2);
assert.ok(ambiguous.candidates.every((candidate) => candidate.kind === 'node'));
const selectedNodePlan = resolveGraphEditLocally('remove Dense A', duplicateContext, { requestId: 'offline-8', selection: ambiguous.candidates[1] });
assert.equal(selectedNodePlan.kind, 'plan');
assert.equal(selectedNodePlan.steps[0].nodeRef, ambiguous.candidates[1].ref, 'A selected node candidate must be consumed by REMOVE_NODE.');
const chineseDuplicateProject = clone(duplicateProject);
for (const entry of chineseDuplicateProject.graph.nodes.filter((item) => item.data.manifest.id === 'dense_node')) {
  entry.data.label = { en: 'Dense / Linear', zh: '全连接 / 线性层' };
}
const chineseDuplicateContext = createGraphEditContext(chineseDuplicateProject);
const chineseAmbiguous = resolveGraphEditLocally('删除 全连接 / 线性层', chineseDuplicateContext, { language: 'zh', requestId: 'offline-8-zh' });
assert.equal(chineseAmbiguous.kind, 'clarification', 'A localized component name containing “连接” is not mistaken for a CONNECT action.');
assert.equal(chineseAmbiguous.code, 'ambiguous-target');
assert.equal(chineseAmbiguous.candidates.length, 2);
assert.ok(chineseAmbiguous.candidates.every((candidate) => candidate.kind === 'node'));

const ambiguousEdges = resolveGraphEditLocally('disconnect a connection', context, { requestId: 'offline-9' });
assert.equal(ambiguousEdges.code, 'ambiguous-port');
assert.ok(ambiguousEdges.candidates.every((candidate) => candidate.kind === 'edge'));
const selectedEdgePlan = resolveGraphEditLocally('disconnect a connection', context, { requestId: 'offline-10', selection: ambiguousEdges.candidates[1] });
assert.equal(selectedEdgePlan.kind, 'plan');
assert.equal(selectedEdgePlan.steps[0].edgeRef, ambiguousEdges.candidates[1].ref, 'A selected edge candidate must be consumed by DISCONNECT.');

const componentChoice = resolveGraphEditLocally('add a component', context, { requestId: 'offline-11' });
assert.equal(componentChoice.kind, 'clarification');
assert.ok(componentChoice.candidates.length > 1 && componentChoice.candidates.every((candidate) => candidate.kind === 'component'));
const reluComponentRef = context.componentRefById.get('relu_node');
const reluCandidate = componentChoice.candidates.find((candidate) => candidate.ref === reluComponentRef);
assert.ok(reluCandidate, 'The bounded component chooser should include the registered ReLU component.');
const selectedComponentPlan = resolveGraphEditLocally('add a component', context, { requestId: 'offline-12', selection: reluCandidate });
assert.equal(selectedComponentPlan.kind, 'plan');
assert.equal(selectedComponentPlan.steps[0].componentRef, reluComponentRef, 'A selected component candidate must be consumed by ADD_NODE.');

const addNode = node('add_node', 'add-node-raw', 650, 360, 'Add A');
const portProject = clone(project);
portProject.graph.nodes.push(addNode);
const portContext = createGraphEditContext(portProject);
const ambiguousPorts = resolveGraphEditLocally('connect Dense A to Add A', portContext, { requestId: 'offline-13' });
assert.equal(ambiguousPorts.code, 'ambiguous-port');
assert.equal(ambiguousPorts.candidates.length, 2);
assert.ok(ambiguousPorts.candidates.every((candidate) => candidate.kind === 'port-pair' && candidate.operation === 'CONNECT'));
const selectedPortPlan = resolveGraphEditLocally('connect Dense A to Add A', portContext, { requestId: 'offline-14', selection: ambiguousPorts.candidates[1] });
assert.equal(selectedPortPlan.kind, 'plan');
assert.equal(selectedPortPlan.steps[0].targetPort, 'b', 'A selected port-pair candidate must be consumed by CONNECT.');
const rejectedPortChoice = resolveGraphEditLocally('connect Dense A to Add A', portContext, { requestId: 'offline-15', selection: { kind: 'port-pair', operation: 'CONNECT', sourceRef: ambiguousPorts.candidates[0].sourceRef, sourcePort: 'missing', targetRef: ambiguousPorts.candidates[0].targetRef, targetPort: 'a' } });
assert.equal(rejectedPortChoice.kind, 'clarification');
assert.equal(rejectedPortChoice.code, 'invalid-connection', 'An unoffered port-pair selection must not be silently accepted.');

const duplicateConnectProject = clone(project);
duplicateConnectProject.graph.nodes.push({ ...clone(dense), id: 'dense-node-duplicate', position: { x: 800, y: 400 } });
const duplicateConnectContext = createGraphEditContext(duplicateConnectProject);
const nodePairChoice = resolveGraphEditLocally('connect Input A to Dense A', duplicateConnectContext, { requestId: 'offline-16' });
assert.equal(nodePairChoice.code, 'ambiguous-target');
assert.ok(nodePairChoice.candidates.every((candidate) => candidate.kind === 'node-pair' && candidate.operation === 'CONNECT'));
const selectedPair = nodePairChoice.candidates.find((candidate) => candidate.sourceRef === duplicateConnectContext.nodeRefById.get('input-node-raw'));
assert.ok(selectedPair);
assert.equal(resolveGraphEditLocally('connect Input A to Dense A', duplicateConnectContext, { requestId: 'offline-17', selection: selectedPair }).kind, 'plan');

assert.equal(resolveGraphEditLocally('connect Private Data Label to Input A', context, { requestId: 'offline-18' }).code, 'invalid-connection');
const ambiguousProperties = resolveGraphEditLocally('set Dense A units or use bias to 96', context, { requestId: 'offline-19' });
assert.ok(ambiguousProperties.candidates.every((candidate) => candidate.kind === 'property'));
const selectedUnits = ambiguousProperties.candidates.find((candidate) => candidate.key === 'units');
assert.equal(resolveGraphEditLocally('set Dense A units or use bias to 96', context, { requestId: 'offline-20', selection: selectedUnits }).steps[0].changes[0].key, 'units');

// Provider boundary requires explicit opt-in, bounds and aliases the semantic projection, and rejects stale output.
let providerCalls = 0;
const provider = createLlmGraphEditIntentInterpreter({ gateway: { async complete(options) {
  providerCalls += 1;
  const message = JSON.parse(options.messages[0].content);
  assert.equal(message.contract, 'GraphEditIntentPlanV1');
  assert.equal(message.semanticGraphContext.topologyCoverage, 'complete');
  assert.equal(JSON.stringify(message).includes('private-node-data'), false);
  assert.equal(JSON.stringify(message).includes('Private Project Name'), false);
  return { text: JSON.stringify({ version: 1, requestId: 'provider-1', kind: 'plan', code: null, steps: [{ op: 'MOVE_NODE', nodeRef: denseRef, relation: 'right-of', anchorRef: inputRef }] }) };
} } });
await assert.rejects(() => provider.interpret({ request: 'move Dense A right of Input A', requestId: 'provider-1', project, config: { protocol: 'openai-compatible', apiKey: 'not-sent-in-context', model: 'fixture' }, consent: false }), (error) => error.code === 'GRAPH_EDIT_CONSENT_REQUIRED');
assert.equal(providerCalls, 0, 'Declined provider consent prevents every outbound call.');
const providerPlan = await provider.interpret({ request: 'move Dense A right of Input A', requestId: 'provider-1', project, config: { protocol: 'openai-compatible', apiKey: 'not-sent-in-context', model: 'fixture' }, consent: true });
assert.equal(providerCalls, 1);
assert.equal(providerPlan.source, 'provider');
assert.equal(providerPlan.kind, 'plan');
assert.equal(JSON.stringify(providerPlan).includes('not-sent-in-context'), false);
const stalePlan = { ...providerPlan, requestId: 'older-request' };
assert.equal(compileGraphEditPlan({ plan: stalePlan, project, context, requestId: 'provider-1' }).ok, false);

// A local plan requiring an invalid composite/connection is rejected before staging and neither graph nor input mutates.
assert.equal(JSON.stringify(project), projectBefore);
assert.deepEqual(graphIdentityV1(context.baseGraph), context.identity);

console.log('Graph Edit Intent checks passed: strict typed plans, privacy projection, all C1 v1 operations, custom composite reuse, deterministic patch construction, offline clarification, consent, and stale/unsupported rejection.');
