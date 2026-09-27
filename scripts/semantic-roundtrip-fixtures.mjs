import { connectAgentNodes, createAgentNode } from '../src/core/canvasAgent.js';
import { componentById } from '../src/core/components.js';
import { PROJECT_VERSION, validateProjectForWorkspace } from '../src/core/project.js';

function addNode(nodes, id, componentId, parameters = {}, position = {}) {
  const manifest = componentById.get(componentId);
  if (!manifest) throw new Error(`Missing registered fixture component ${componentId}.`);
  const node = createAgentNode({
    nodes,
    manifest,
    request: {
      id,
      position: { x: 120 + nodes.length * 180 + (position.offset ?? 0), y: 100 + (position.offset ?? 0) },
      parameters,
    },
  });
  nodes.push(node);
  return node;
}

function addEdge(nodes, edges, id, source, target, sourceHandle = 'output', targetHandle = 'input') {
  return connectAgentNodes(nodes, edges, { id, source: source.id, sourceHandle, target: target.id, targetHandle });
}

function projectFor(nodes, edges, name) {
  return validateProjectForWorkspace({
    format: 'VOLK-ML',
    version: PROJECT_VERSION,
    name,
    language: { primary: 'en', secondary: null },
    workspace: { viewMode: 'canvas', leftWidth: 300, rightWidth: 380 },
    graph: { nodes, edges },
    customComponents: [],
    data: null,
    trainedModel: null,
  });
}

/** Build a bounded canonical linear feature model from registered components. */
export function createLinearRoundTripProject({
  caseId = 'fixture',
  inputFeatures = 4,
  inputDtype = 'float32',
  layers = [{ operation: 'dense', units: 3, useBias: true }],
  orphan = false,
  positionOffset = 0,
  multipleOutputs = false,
  invalidDenseInputFeatures = false,
} = {}) {
  const prefix = caseId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const nodes = [];
  let edges = [];
  const input = addNode(nodes, `${prefix}_input`, 'tensor_input_node', {
    shape: String(inputFeatures),
    dtype: inputDtype,
  }, { offset: positionOffset });
  let previous = input;
  let currentFeatures = inputFeatures;
  let denseCount = 0;
  for (const [index, spec] of layers.entries()) {
    let componentId;
    let parameters = {};
    if (spec.operation === 'dense') {
      componentId = 'dense_node';
      parameters = {
        input_features: invalidDenseInputFeatures && denseCount === 0 ? inputFeatures + 1 : currentFeatures,
        units: spec.units,
        use_bias: spec.useBias,
      };
      currentFeatures = spec.units;
      denseCount += 1;
    } else if (spec.operation === 'softmax') {
      componentId = 'softmax_node';
      parameters = { axis: spec.axis };
    } else if (spec.operation === 'flatten') {
      componentId = 'flatten_node';
    } else if (spec.operation === 'reshape') {
      componentId = 'reshape_node';
      parameters = { shape: String(spec.shape ?? currentFeatures) };
    } else {
      componentId = ({ relu: 'relu_node', sigmoid: 'sigmoid_node', tanh: 'tanh_node', gelu: 'gelu_node' })[spec.operation];
    }
    if (!componentId) throw new Error(`Unsupported test fixture operation ${spec.operation}.`);
    const node = addNode(nodes, `${prefix}_layer_${index}`, componentId, parameters, { offset: positionOffset });
    edges = addEdge(nodes, edges, `${prefix}_edge_${index}`, previous, node, previous === input ? 'tensor' : 'output');
    previous = node;
  }
  const output = addNode(nodes, `${prefix}_output`, 'model_output_node', {}, { offset: positionOffset });
  edges = addEdge(nodes, edges, `${prefix}_edge_output`, previous, output, previous === input ? 'tensor' : 'output');
  if (multipleOutputs) {
    const secondOutput = addNode(nodes, `${prefix}_output_2`, 'model_output_node', {}, { offset: positionOffset });
    edges = addEdge(nodes, edges, `${prefix}_edge_output_2`, previous, secondOutput, previous === input ? 'tensor' : 'output');
  }
  if (orphan) {
    addNode(nodes, `${prefix}_orphan`, 'dense_node', { input_features: inputFeatures, units: 2, use_bias: true }, { offset: positionOffset });
  }
  return projectFor(nodes, edges, `E3 ${caseId}`);
}

export function createBranchAddRoundTripProject({ caseId = 'branch-add', inputDtype = 'float32' } = {}) {
  const nodes = [];
  let edges = [];
  const input = addNode(nodes, `${caseId}_input`, 'tensor_input_node', { shape: '4', dtype: inputDtype });
  const left = addNode(nodes, `${caseId}_left`, 'dense_node', { input_features: 4, units: 4, use_bias: true });
  const right = addNode(nodes, `${caseId}_right`, 'dense_node', { input_features: 4, units: 4, use_bias: true });
  const add = addNode(nodes, `${caseId}_add`, 'add_node');
  const output = addNode(nodes, `${caseId}_output`, 'model_output_node');
  edges = addEdge(nodes, edges, `${caseId}_edge_left`, input, left, 'tensor');
  edges = addEdge(nodes, edges, `${caseId}_edge_right`, input, right, 'tensor');
  edges = addEdge(nodes, edges, `${caseId}_edge_add_a`, left, add, 'output', 'a');
  edges = addEdge(nodes, edges, `${caseId}_edge_add_b`, right, add, 'output', 'b');
  edges = addEdge(nodes, edges, `${caseId}_edge_output`, add, output);
  return projectFor(nodes, edges, `E3 ${caseId}`);
}

export function createMultipleInputRoundTripProject({ caseId = 'multiple-inputs' } = {}) {
  const nodes = [];
  let edges = [];
  const inputA = addNode(nodes, `${caseId}_input_a`, 'tensor_input_node', { shape: '4', dtype: 'float32' });
  const inputB = addNode(nodes, `${caseId}_input_b`, 'tensor_input_node', { shape: '4', dtype: 'float32' });
  const left = addNode(nodes, `${caseId}_left`, 'dense_node', { input_features: 4, units: 4, use_bias: true });
  const right = addNode(nodes, `${caseId}_right`, 'dense_node', { input_features: 4, units: 4, use_bias: true });
  const add = addNode(nodes, `${caseId}_add`, 'add_node');
  const output = addNode(nodes, `${caseId}_output`, 'model_output_node');
  edges = addEdge(nodes, edges, `${caseId}_edge_left`, inputA, left, 'tensor');
  edges = addEdge(nodes, edges, `${caseId}_edge_right`, inputB, right, 'tensor');
  edges = addEdge(nodes, edges, `${caseId}_edge_add_a`, left, add, 'output', 'a');
  edges = addEdge(nodes, edges, `${caseId}_edge_add_b`, right, add, 'output', 'b');
  edges = addEdge(nodes, edges, `${caseId}_edge_output`, add, output);
  return projectFor(nodes, edges, `E3 ${caseId}`);
}

export function createConv2dRoundTripProject({ caseId = 'conv2d' } = {}) {
  const nodes = [];
  let edges = [];
  const input = addNode(nodes, `${caseId}_input`, 'tensor_input_node', { shape: '3, 8, 8', dtype: 'float32' });
  const conv = addNode(nodes, `${caseId}_conv`, 'conv2d_node', {
    input_channels: 3, filters: 4, kernel_size: 3, stride: 1, padding: 'same', use_bias: true,
  });
  const flatten = addNode(nodes, `${caseId}_flatten`, 'flatten_node');
  const dense = addNode(nodes, `${caseId}_dense`, 'dense_node', { input_features: 256, units: 2, use_bias: true });
  const output = addNode(nodes, `${caseId}_output`, 'model_output_node');
  edges = addEdge(nodes, edges, `${caseId}_edge_conv`, input, conv, 'tensor');
  edges = addEdge(nodes, edges, `${caseId}_edge_flatten`, conv, flatten);
  edges = addEdge(nodes, edges, `${caseId}_edge_dense`, flatten, dense);
  edges = addEdge(nodes, edges, `${caseId}_edge_output`, dense, output);
  return projectFor(nodes, edges, `E3 ${caseId}`);
}
