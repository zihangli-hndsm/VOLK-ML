import assert from 'node:assert/strict';
import { graphSemanticFingerprintV1 } from '../src/core/graph/identity.js';
import { compareSemanticGraphs, evaluateSemanticRoundTrip } from './semantic-roundtrip-core.mjs';
import { createLinearRoundTripProject } from './semantic-roundtrip-fixtures.mjs';

const baseline = createLinearRoundTripProject({
  caseId: 'comparator-base',
  inputFeatures: 4,
  layers: [
    { operation: 'dense', units: 6, useBias: true },
    { operation: 'relu' },
    { operation: 'dense', units: 3, useBias: true },
  ],
});

const renamed = createLinearRoundTripProject({
  caseId: 'comparator-renamed',
  inputFeatures: 4,
  positionOffset: 700,
  layers: [
    { operation: 'dense', units: 6, useBias: true },
    { operation: 'relu' },
    { operation: 'dense', units: 3, useBias: true },
  ],
});
assert.equal(compareSemanticGraphs(baseline.graph, renamed.graph).status, 'structural-match',
  'New graph IDs and layout do not change the E3 cross-format semantic projection.');
assert.notEqual(graphSemanticFingerprintV1(baseline.graph), graphSemanticFingerprintV1(renamed.graph),
  'Canonical graph identity retains IDs; E3 normalization does not redefine core identity.');

const activationChanged = createLinearRoundTripProject({
  caseId: 'comparator-activation',
  inputFeatures: 4,
  layers: [
    { operation: 'dense', units: 6, useBias: true },
    { operation: 'sigmoid' },
    { operation: 'dense', units: 3, useBias: true },
  ],
});
const activationResult = compareSemanticGraphs(baseline.graph, activationChanged.graph);
assert.equal(activationResult.status, 'mismatch', 'An operation change cannot pass by node/edge counts alone.');
assert.equal(activationResult.metrics.operations.status, 'mismatch');
assert.deepEqual(baseline.graph.nodes.length, activationChanged.graph.nodes.length);
assert.deepEqual(baseline.graph.edges.length, activationChanged.graph.edges.length);

const widthChanged = createLinearRoundTripProject({
  caseId: 'comparator-width',
  inputFeatures: 4,
  layers: [
    { operation: 'dense', units: 6, useBias: true },
    { operation: 'relu' },
    { operation: 'dense', units: 5, useBias: true },
  ],
});
const widthResult = compareSemanticGraphs(baseline.graph, widthChanged.graph);
assert.equal(widthResult.status, 'mismatch');
assert.equal(widthResult.metrics.constructorParameters.status, 'mismatch');
assert.equal(widthResult.metrics.shapes.status, 'mismatch');

const biasChanged = createLinearRoundTripProject({
  caseId: 'comparator-bias',
  inputFeatures: 4,
  layers: [
    { operation: 'dense', units: 6, useBias: true },
    { operation: 'relu' },
    { operation: 'dense', units: 3, useBias: false },
  ],
});
assert.equal(compareSemanticGraphs(baseline.graph, biasChanged.graph).metrics.constructorParameters.status, 'mismatch',
  'Dense bias is a constructor semantic even when node counts and shapes are unchanged.');

const softmaxMinusOne = createLinearRoundTripProject({
  caseId: 'comparator-softmax-minus-one',
  layers: [{ operation: 'dense', units: 3, useBias: true }, { operation: 'softmax', axis: -1 }],
});
const softmaxAxisOne = createLinearRoundTripProject({
  caseId: 'comparator-softmax-axis-one',
  layers: [{ operation: 'dense', units: 3, useBias: true }, { operation: 'softmax', axis: 1 }],
});
assert.equal(compareSemanticGraphs(softmaxMinusOne.graph, softmaxAxisOne.graph).status, 'structural-match',
  'Softmax axis 1 and -1 normalize only under the proven rank-two B2 contract.');

const dtypeChanged = createLinearRoundTripProject({
  caseId: 'comparator-dtype', inputDtype: 'float16',
  layers: [{ operation: 'dense', units: 3, useBias: true }],
});
assert.equal(compareSemanticGraphs(softmaxMinusOne.graph, dtypeChanged.graph).metrics.dtype.status, 'mismatch');

const badPort = structuredClone(baseline.graph);
badPort.edges[0].targetHandle = 'unknown-port';
assert.equal(compareSemanticGraphs(baseline.graph, badPort).status, 'unsupported',
  'Invalid typed handles do not become a vacuous topology match.');

const disconnected = structuredClone(baseline.graph);
const disconnectedActivation = disconnected.nodes.find((node) => node.data.manifest.op === 'relu');
const disconnectedEdge = disconnected.edges.findIndex((edge) => edge.target === disconnectedActivation.id);
assert.notEqual(disconnectedEdge, -1);
disconnected.edges.splice(disconnectedEdge, 1);
const disconnectedResult = compareSemanticGraphs(baseline.graph, disconnected);
assert.equal(disconnectedResult.status, 'unsupported');
assert.equal(disconnectedResult.reason, 'E3_TOPOLOGY_UNSUPPORTED');
assert.equal(disconnectedResult.metrics.topology.status, 'mismatch',
  'A disconnected registered node cannot pass as a round-trip match.');

const multipleOutputs = createLinearRoundTripProject({
  caseId: 'comparator-multiple-outputs',
  inputFeatures: 4,
  multipleOutputs: true,
  layers: [{ operation: 'dense', units: 3, useBias: true }],
});
const multipleOutputResult = compareSemanticGraphs(baseline.graph, multipleOutputs.graph);
assert.equal(multipleOutputResult.status, 'unsupported');
assert.equal(multipleOutputResult.reason, 'E3_TOPOLOGY_UNSUPPORTED');
assert.equal(multipleOutputResult.metrics.topology.status, 'mismatch');
assert.equal(multipleOutputResult.metrics.topology.actual.outputArity, 2,
  'An output-arity change must be observed explicitly, not hidden by node counts.');

const cyclic = structuredClone(baseline.graph);
const activation = cyclic.nodes.find((node) => node.data.manifest.op === 'relu');
cyclic.edges.push({
  id: 'comparator-cycle', source: activation.id, sourceHandle: 'output', target: activation.id, targetHandle: 'input',
});
assert.equal(compareSemanticGraphs(baseline.graph, cyclic).reason, 'E3_GRAPH_CYCLE');

const tooLarge = structuredClone(baseline.graph);
tooLarge.nodes = [...tooLarge.nodes, ...Array.from({ length: 60 }, (_, index) => ({
  ...structuredClone(baseline.graph.nodes[1]),
  id: `comparator-extra-${index}`,
}))];
assert.equal(compareSemanticGraphs(baseline.graph, tooLarge).reason, 'E3_GRAPH_BOUND');

const unknownOperation = structuredClone(baseline.graph);
const unknownNode = unknownOperation.nodes.find((node) => node.data.manifest.op === 'relu');
unknownNode.data.manifest = { ...unknownNode.data.manifest, id: 'unregistered-e3-operation', op: 'unknown-e3-operation' };
assert.equal(compareSemanticGraphs(baseline.graph, unknownOperation).status, 'unsupported',
  'Unknown operations are reported unsupported, never removed from the projection.');

const noObservedRuntime = evaluateSemanticRoundTrip({ graphA: baseline.graph, graphB: renamed.graph });
assert.equal(noObservedRuntime.status, 'unverified', 'Missing runtime evidence cannot pass as equivalence.');

console.log(JSON.stringify({
  task: 'E3 deterministic semantic comparator',
  outcome: 'PASS',
  assertions: [
    'ID/layout normalization with core identity unchanged',
    'same-count operation mutation rejected',
    'Dense width and bias mutations detected',
    'rank-two Softmax final-axis normalization',
    'dtype, typed-port, disconnected, output-arity, cycle, graph-bound, and unknown-op negatives',
    'missing runtime evidence is unverified',
  ],
}, null, 2));
