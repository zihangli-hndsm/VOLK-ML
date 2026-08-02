import { assessConnection } from './connections.js';
import { defaults } from './components.js';

export const CANVAS_AGENT_API_VERSION = 1;
export const CANVAS_AGENT_GLOBAL = '__VOLK_ML_AGENT__';

export class CanvasAgentError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CanvasAgentError';
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => {
  throw new CanvasAgentError(code, message, details);
};

function copy(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function validatePosition(position, fallback) {
  const next = position ?? fallback;
  if (!Number.isFinite(next?.x) || !Number.isFinite(next?.y)) {
    fail('INVALID_POSITION', 'Node position needs finite x and y coordinates.', { position });
  }
  return { x: next.x, y: next.y };
}

function validateParameter(property, value) {
  if (['number', 'slider'].includes(property.type)) {
    if (!Number.isFinite(value)) fail('INVALID_PARAMETER', `${property.key} needs a finite number.`, { key: property.key, value });
    if (Number.isFinite(property.min) && value < property.min) fail('INVALID_PARAMETER', `${property.key} is below its minimum.`, { key: property.key, value, min: property.min });
    if (Number.isFinite(property.max) && value > property.max) fail('INVALID_PARAMETER', `${property.key} is above its maximum.`, { key: property.key, value, max: property.max });
  } else if (property.type === 'boolean') {
    if (typeof value !== 'boolean') fail('INVALID_PARAMETER', `${property.key} needs a boolean.`, { key: property.key, value });
  } else if (property.type === 'select') {
    if (!property.options.includes(value)) fail('INVALID_PARAMETER', `${property.key} is not an available option.`, { key: property.key, value, options: property.options });
  } else if (typeof value !== 'string') {
    fail('INVALID_PARAMETER', `${property.key} needs text.`, { key: property.key, value });
  }
  return value;
}

function mergeParameters(manifest, current, patch = {}) {
  const propertyByKey = new Map(manifest.properties.map((property) => [property.key, property]));
  Object.entries(patch).forEach(([key, value]) => {
    const property = propertyByKey.get(key);
    if (!property) fail('UNKNOWN_PARAMETER', `Unknown parameter: ${key}.`, { componentId: manifest.id, key });
    validateParameter(property, value);
  });
  return { ...current, ...patch };
}

export function validateAgentDataset(dataset) {
  if (dataset === null) return null;
  const validRows = Array.isArray(dataset?.rows)
    && dataset.rows.length > 0
    && dataset.rows.every((row) => row && typeof row === 'object' && !Array.isArray(row));
  const validFeatures = Array.isArray(dataset?.featureColumns)
    && dataset.featureColumns.length > 0
    && dataset.featureColumns.every((column) => typeof column === 'string' && column.trim());
  const targetColumn = typeof dataset?.targetColumn === 'string' ? dataset.targetColumn.trim() : '';
  if (!validRows || !validFeatures || !targetColumn) {
    fail('INVALID_DATASET', 'Dataset needs non-empty object rows, featureColumns, and targetColumn.');
  }
  const featureColumns = dataset.featureColumns.map((column) => column.trim());
  if (new Set(featureColumns).size !== featureColumns.length || featureColumns.includes(targetColumn)) {
    fail('INVALID_DATASET', 'Dataset feature and target columns must be unique.', { featureColumns, targetColumn });
  }
  const missingColumn = [...featureColumns, targetColumn]
    .find((column) => !dataset.rows.some((row) => Object.hasOwn(row, column)));
  if (missingColumn) fail('INVALID_DATASET', `Dataset column is missing from every row: ${missingColumn}.`, { column: missingColumn });
  return copy({ ...dataset, featureColumns, targetColumn });
}

export function createAgentNode({ nodes, manifest, request = {}, idFactory = () => crypto.randomUUID() }) {
  if (!manifest) fail('UNKNOWN_COMPONENT', `Unknown component: ${request.componentId}.`, { componentId: request.componentId });
  const id = String(request.id ?? `${manifest.id}-${idFactory()}`).trim();
  if (!id) fail('INVALID_NODE_ID', 'Node id cannot be empty.');
  if (nodes.some((node) => node.id === id)) fail('DUPLICATE_NODE_ID', `Node already exists: ${id}.`, { nodeId: id });
  const fallback = { x: 120 + nodes.length * 110, y: 90 + nodes.length * 90 };
  return {
    id,
    type: 'pipelineNode',
    position: validatePosition(request.position, fallback),
    data: {
      label: manifest.name,
      manifest,
      parameters: mergeParameters(manifest, defaults(manifest), request.parameters),
      status: 'idle',
    },
  };
}

export function updateAgentNode(nodes, nodeId, patch = {}) {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) fail('NODE_NOT_FOUND', `Node not found: ${nodeId}.`, { nodeId });
  const allowed = new Set(['position', 'parameters']);
  const unknown = Object.keys(patch).find((key) => !allowed.has(key));
  if (unknown) fail('INVALID_NODE_PATCH', `Unsupported node field: ${unknown}.`, { field: unknown });
  return nodes.map((item) => item.id === nodeId ? {
    ...item,
    position: patch.position ? validatePosition(patch.position, item.position) : item.position,
    data: {
      ...item.data,
      parameters: mergeParameters(item.data.manifest, item.data.parameters, patch.parameters),
      status: 'idle',
    },
  } : item);
}

export function removeAgentNode(nodes, edges, nodeId) {
  if (!nodes.some((node) => node.id === nodeId)) fail('NODE_NOT_FOUND', `Node not found: ${nodeId}.`, { nodeId });
  return {
    nodes: nodes.filter((node) => node.id !== nodeId),
    edges: edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
  };
}

export function connectAgentNodes(nodes, edges, request, idFactory = () => crypto.randomUUID()) {
  const connection = {
    source: request?.source,
    sourceHandle: request?.sourceHandle,
    target: request?.target,
    targetHandle: request?.targetHandle,
  };
  const assessment = assessConnection(connection, nodes, edges);
  if (!assessment.valid) {
    fail('INVALID_CONNECTION', `Connection rejected: ${assessment.reason}.`, {
      reason: assessment.reason,
      sourceType: assessment.sourceType,
      targetType: assessment.targetType,
      connection,
    });
  }
  const id = String(request.id ?? `agent-edge-${idFactory()}`).trim();
  if (!id) fail('INVALID_EDGE_ID', 'Edge id cannot be empty.');
  if (edges.some((edge) => edge.id === id)) fail('DUPLICATE_EDGE_ID', `Edge already exists: ${id}.`, { edgeId: id });
  return [...edges, { id, ...connection, type: 'deletable' }];
}

export function disconnectAgentEdge(edges, edgeId) {
  if (!edges.some((edge) => edge.id === edgeId)) fail('EDGE_NOT_FOUND', `Edge not found: ${edgeId}.`, { edgeId });
  return edges.filter((edge) => edge.id !== edgeId);
}

export function summarizeAgentComponent(manifest) {
  return {
    id: manifest.id,
    op: manifest.op,
    kind: manifest.kind,
    category: manifest.category,
    name: copy(manifest.name),
    description: copy(manifest.description),
    inputs: copy(manifest.inputs),
    outputs: copy(manifest.outputs),
    properties: copy(manifest.properties),
    runtime: copy(manifest.runtime),
    compatibility: copy(manifest.compatibility),
    customComposite: Boolean(manifest.customComposite),
  };
}

export function createCanvasAgentSnapshot({
  instanceId,
  project,
  nodes,
  edges,
  selectedNodeId,
  viewMode,
  runtime,
  executionPlan,
  dirty,
}) {
  return {
    apiVersion: CANVAS_AGENT_API_VERSION,
    instanceId,
    project: {
      format: project.format,
      version: project.version,
      name: project.name,
      savedAt: project.savedAt,
      dirty: Boolean(dirty),
      hasDataset: Boolean(project.data),
      hasTrainedModel: Boolean(project.trainedModel),
    },
    canvas: {
      viewMode,
      selectedNodeId: selectedNodeId ?? null,
      nodes: nodes.map((node) => ({
        id: node.id,
        componentId: node.data.manifest.id,
        op: node.data.manifest.op,
        kind: node.data.manifest.kind,
        position: copy(node.position),
        parameters: copy(node.data.parameters),
        status: node.data.status ?? 'idle',
        inputs: copy(node.data.manifest.inputs),
        outputs: copy(node.data.manifest.outputs),
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        target: edge.target,
        targetHandle: edge.targetHandle,
      })),
    },
    dataset: project.data ? {
      name: project.data.name ?? null,
      task: project.data.task ?? null,
      rowCount: Array.isArray(project.data.rows) ? project.data.rows.length : 0,
      featureColumns: copy(project.data.featureColumns ?? []),
      targetColumn: project.data.targetColumn ?? null,
    } : null,
    execution: {
      plan: copy(executionPlan),
      runtime: copy(runtime),
    },
  };
}

const requiredAdapterMethods = [
  'getState', 'listComponents', 'addNode', 'updateNode', 'removeNode', 'connect',
  'disconnect', 'selectNode', 'renameProject', 'setDataset', 'loadProject',
  'getProject', 'run', 'exportCode', 'downloadProject', 'subscribe',
];

export function createCanvasAgentApi(adapter) {
  requiredAdapterMethods.forEach((method) => {
    if (typeof adapter?.[method] !== 'function') fail('INVALID_ADAPTER', `Canvas Agent adapter is missing ${method}().`, { method });
  });
  return Object.freeze({
    apiVersion: CANVAS_AGENT_API_VERSION,
    instanceId: adapter.instanceId,
    getState: () => copy(adapter.getState()),
    listComponents: () => copy(adapter.listComponents()),
    addNode: async (request) => copy(await adapter.addNode(copy(request))),
    updateNode: async (nodeId, patch) => copy(await adapter.updateNode(nodeId, copy(patch))),
    removeNode: async (nodeId) => copy(await adapter.removeNode(nodeId)),
    connect: async (request) => copy(await adapter.connect(copy(request))),
    disconnect: async (edgeId) => copy(await adapter.disconnect(edgeId)),
    selectNode: async (nodeId) => copy(await adapter.selectNode(nodeId)),
    renameProject: async (name) => copy(await adapter.renameProject(name)),
    setDataset: async (dataset) => copy(await adapter.setDataset(copy(dataset))),
    loadProject: async (project) => copy(await adapter.loadProject(copy(project))),
    getProject: () => copy(adapter.getProject()),
    run: async () => copy(await adapter.run()),
    exportCode: async (framework, options) => copy(await adapter.exportCode(framework, copy(options))),
    downloadProject: async () => copy(await adapter.downloadProject()),
    subscribe(listener) {
      if (typeof listener !== 'function') fail('INVALID_LISTENER', 'subscribe() needs a function.');
      return adapter.subscribe((state) => listener(copy(state)));
    },
  });
}

export function installCanvasAgentBridge(api, target = globalThis) {
  const previous = target[CANVAS_AGENT_GLOBAL];
  const bridge = Object.freeze({
    apiVersion: CANVAS_AGENT_API_VERSION,
    listInstances: () => [{ id: api.instanceId }],
    async open(instanceId = api.instanceId) {
      if (instanceId !== api.instanceId) fail('INSTANCE_NOT_FOUND', `Canvas instance not found: ${instanceId}.`, { instanceId });
      return api;
    },
  });
  target[CANVAS_AGENT_GLOBAL] = bridge;
  return () => {
    if (target[CANVAS_AGENT_GLOBAL] !== bridge) return;
    if (previous === undefined) delete target[CANVAS_AGENT_GLOBAL];
    else target[CANVAS_AGENT_GLOBAL] = previous;
  };
}
