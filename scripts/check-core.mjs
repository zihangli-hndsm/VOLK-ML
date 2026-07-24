import assert from 'node:assert/strict';
import {
  COMPONENT_SCHEMA_VERSION,
  componentById,
  defaults,
  expandComposite,
  pluginRegistry,
} from '../src/core/components.js';
import {
  compilePipelineToPyTorch,
  compilePipelineToTensorFlow,
  graphToIR,
} from '../src/core/compiler.js';
import { estimateExecutionPlan } from '../src/core/runtimeTiers.js';
import { languages, messages } from '../src/locales/ui.js';

const makeNode = (id, componentId, parameters = {}) => {
  const manifest = componentById.get(componentId);
  assert.ok(manifest, `Unknown test component ${componentId}`);
  return {
    id,
    type: 'pipelineNode',
    position: { x: 0, y: 0 },
    data: {
      manifest,
      label: manifest.name,
      parameters: { ...defaults(manifest), ...parameters },
      status: 'idle',
    },
  };
};

const makeEdge = (source, sourceHandle, target, targetHandle) => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});

assert.equal(new Set(pluginRegistry.map((manifest) => manifest.id)).size, pluginRegistry.length, 'Component IDs must be unique');
for (const manifest of pluginRegistry) {
  assert.equal(manifest.schemaVersion, COMPONENT_SCHEMA_VERSION, `${manifest.id} schema version`);
  assert.ok(manifest.op && manifest.kind && manifest.category, `${manifest.id} semantic metadata`);
  assert.ok(messages[`category.${manifest.category}`], `${manifest.id} localized category`);
  assert.ok(['L0', 'L1', 'L2', 'L3'].includes(manifest.runtime.minimumTier), `${manifest.id} execution tier`);
  assert.ok(['exact', 'adapted', 'approximate', 'unsupported'].includes(manifest.compatibility.pytorch), `${manifest.id} PyTorch compatibility`);
  assert.ok(['exact', 'adapted', 'approximate', 'unsupported'].includes(manifest.compatibility.tensorflow), `${manifest.id} TensorFlow compatibility`);
  for (const language of languages) {
    assert.ok(manifest.name[language.code], `${manifest.id} ${language.code} name`);
    assert.ok(manifest.description[language.code], `${manifest.id} ${language.code} description`);
    for (const property of manifest.properties) assert.ok(property.label[language.code], `${manifest.id}.${property.key} ${language.code} label`);
  }
  assert.equal(new Set(manifest.inputs.map((port) => port.name)).size, manifest.inputs.length, `${manifest.id} input ports`);
  assert.equal(new Set(manifest.outputs.map((port) => port.name)).size, manifest.outputs.length, `${manifest.id} output ports`);

  if (manifest.composition) {
    const internal = new Map(manifest.composition.nodes.map((node) => [node.key, componentById.get(node.componentId)]));
    assert.equal(internal.size, manifest.composition.nodes.length, `${manifest.id} composite keys`);
    for (const [key, child] of internal) assert.ok(child, `${manifest.id} child ${key}`);
    for (const edge of manifest.composition.edges) {
      assert.ok(internal.get(edge.source)?.outputs.some((port) => port.name === edge.sourceHandle), `${manifest.id} source mapping`);
      assert.ok(internal.get(edge.target)?.inputs.some((port) => port.name === edge.targetHandle), `${manifest.id} target mapping`);
    }
    for (const [port, targets] of Object.entries(manifest.composition.inputs)) {
      assert.ok(manifest.inputs.some((input) => input.name === port), `${manifest.id} external input ${port}`);
      for (const target of targets) assert.ok(internal.get(target.node)?.inputs.some((input) => input.name === target.port), `${manifest.id} input target`);
    }
    for (const [port, source] of Object.entries(manifest.composition.outputs)) {
      assert.ok(manifest.outputs.some((output) => output.name === port), `${manifest.id} external output ${port}`);
      assert.ok(internal.get(source.node)?.outputs.some((output) => output.name === source.port), `${manifest.id} output source`);
    }
  }
}

for (const [key, translations] of Object.entries(messages)) {
  for (const language of languages) assert.ok(translations[language.code], `${key} is missing ${language.code}`);
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
const ir = graphToIR(architectureNodes, architectureEdges);
assert.equal(ir.version, 2);
assert.deepEqual(ir.nodes.filter((node) => ['input', 'dense', 'relu', 'output'].includes(node.id)).map((node) => node.id), ['input', 'dense', 'relu', 'output']);

const pytorch = compilePipelineToPyTorch(architectureNodes, architectureEdges);
const tensorflow = compilePipelineToTensorFlow(architectureNodes, architectureEdges);
assert.match(pytorch.code, /class VOLKModel/);
assert.match(pytorch.code, /nn\.Linear\(32, 10/);
assert.match(pytorch.code, /nn\.CrossEntropyLoss/);
assert.match(tensorflow.code, /keras\.Model/);
assert.match(tensorflow.code, /layers\.Dense\(10/);
assert.match(tensorflow.code, /SparseCategoricalCrossentropy/);

const composite = makeNode('block', 'mlp_block_node', { input_features: 16, hidden_units: 24, dropout: 0.3 });
const expansion = expandComposite(composite);
assert.equal(expansion.nodes.length, 3);
assert.equal(expansion.edges.length, 2);
assert.equal(expansion.inputs.input.length, 1);
assert.ok(expansion.outputs.output.nodeId);
assert.equal(expansion.nodes[0].data.parameters.units, 24);

const browserNodes = [
  makeNode('data', 'tabular_data_node'),
  makeNode('split', 'train_test_split_node'),
  makeNode('linear', 'linear_regression_node'),
  makeNode('train', 'gradient_descent_node'),
];
assert.deepEqual(estimateExecutionPlan(browserNodes, null).recommendedTier, 'L0');
assert.equal(estimateExecutionPlan(browserNodes, null).canRunHere, true);
assert.equal(estimateExecutionPlan(architectureNodes, null).recommendedTier, 'L1');
assert.equal(estimateExecutionPlan(architectureNodes, null).canRunHere, false);
const largeEmbedding = makeNode('embedding', 'embedding_node', { vocab_size: 1_000_000, embedding_dim: 1024 });
assert.equal(estimateExecutionPlan([largeEmbedding], null).recommendedTier, 'L3');

console.log(`Validated ${pluginRegistry.length} components, two compiler backends, composites, localization, and execution tiers.`);
