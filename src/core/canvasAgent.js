import { assessConnection } from './connections.js';
import { defaults } from './components.js';

export const CANVAS_AGENT_API_VERSION = 1;
export const CANVAS_AGENT_GLOBAL = '__VOLK_ML_AGENT__';
const bridgeRegistryByTarget = new WeakMap();

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

function jsonSafeDetails(value, ancestors = new WeakSet()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (['undefined', 'function', 'symbol'].includes(typeof value)) return String(value);
  if (ancestors.has(value)) return '[Circular]';
  ancestors.add(value);
  let normalized;
  if (Array.isArray(value)) {
    normalized = value.map((item) => jsonSafeDetails(item, ancestors));
  } else if ([Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    normalized = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonSafeDetails(item, ancestors)]),
    );
  } else {
    normalized = String(value);
  }
  ancestors.delete(value);
  return normalized;
}

function assertJsonSafe(value, code, label, path = '$', ancestors = new WeakSet()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    fail(code, `${label} contains a non-finite number at ${path}.`, { path });
  }
  if (typeof value !== 'object') fail(code, `${label} contains a non-JSON value at ${path}.`, { path, type: typeof value });
  if (ancestors.has(value)) fail(code, `${label} contains a circular value at ${path}.`, { path });
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    fail(code, `${label} contains a non-plain object at ${path}.`, { path });
  }
  if (Object.getOwnPropertySymbols(value).length) fail(code, `${label} contains symbol keys at ${path}.`, { path });
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) fail(code, `${label} contains an array hole at ${path}[${index}].`, { path: `${path}[${index}]` });
      assertJsonSafe(value[index], code, label, `${path}[${index}]`, ancestors);
    }
  } else {
    Object.entries(value).forEach(([key, child]) => assertJsonSafe(child, code, label, `${path}.${key}`, ancestors));
  }
  ancestors.delete(value);
}

function normalizeAdapterError(error, operation) {
  if (error instanceof CanvasAgentError) {
    error.details = jsonSafeDetails(error.details);
    return error;
  }
  return new CanvasAgentError('OPERATION_FAILED', error?.message ?? String(error), {
    operation,
    causeName: error?.name ?? 'Error',
    causeCode: error?.code,
    translationKey: error?.translationKey,
    translationParams: jsonSafeDetails(error?.translationParams),
  });
}

function invokeAdapter(operation, callback) {
  try { return callback(); } catch (error) { throw normalizeAdapterError(error, operation); }
}

async function invokeAdapterAsync(operation, callback) {
  try { return await callback(); } catch (error) { throw normalizeAdapterError(error, operation); }
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
    if (Number.isFinite(property.step) && property.step > 0) {
      const base = Number.isFinite(property.min) ? property.min : 0;
      const steps = (value - base) / property.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) {
        fail('INVALID_PARAMETER', `${property.key} does not align with its step.`, { key: property.key, value, step: property.step, base });
      }
    }
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
  assertJsonSafe(dataset, 'INVALID_DATASET', 'Dataset');
  const featureColumns = dataset.featureColumns.map((column) => column.trim());
  if (new Set(featureColumns).size !== featureColumns.length || featureColumns.includes(targetColumn)) {
    fail('INVALID_DATASET', 'Dataset feature and target columns must be unique.', { featureColumns, targetColumn });
  }
  const missingColumn = [...featureColumns, targetColumn]
    .find((column) => !dataset.rows.some((row) => Object.hasOwn(row, column)));
  if (missingColumn) fail('INVALID_DATASET', `Dataset column is missing from every row: ${missingColumn}.`, { column: missingColumn });
  const columnNames = [...new Set(dataset.rows.flatMap((row) => Object.keys(row)))];
  const columns = columnNames.map((name) => {
    const present = dataset.rows
      .map((row) => row[name])
      .filter((value) => value !== '' && value !== null && value !== undefined);
    const numericCount = present.filter((value) => Number.isFinite(Number(value))).length;
    return {
      name,
      type: present.length > 0 && numericCount === present.length ? 'number' : 'text',
      missing: dataset.rows.length - present.length,
    };
  });
  const targetType = columns.find((column) => column.name === targetColumn)?.type;
  const task = ['regression', 'classification'].includes(dataset.task)
    ? dataset.task
    : targetType === 'number' ? 'regression' : 'classification';
  return copy({ ...dataset, columns, featureColumns, targetColumn, task });
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
  return nodes.map((item) => {
    if (item.id !== nodeId) return item;
    const parameters = mergeParameters(item.data.manifest, item.data.parameters, patch.parameters);
    const parametersChanged = Object.keys(patch.parameters ?? {})
      .some((key) => !Object.is(parameters[key], item.data.parameters[key]));
    return {
      ...item,
      position: patch.position ? validatePosition(patch.position, item.position) : item.position,
      data: {
        ...item.data,
        parameters,
        status: parametersChanged ? 'idle' : item.data.status,
      },
    };
  });
}

export function removeAgentNode(nodes, edges, nodeId) {
  if (!nodes.some((node) => node.id === nodeId)) fail('NODE_NOT_FOUND', `Node not found: ${nodeId}.`, { nodeId });
  return {
    nodes: nodes.filter((node) => node.id !== nodeId),
    edges: edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
  };
}

export function selectAgentNode(nodes, nodeId) {
  if (nodeId !== null && !nodes.some((node) => node.id === nodeId)) {
    fail('NODE_NOT_FOUND', `Node not found: ${nodeId}.`, { nodeId });
  }
  return nodes.map((node) => ({ ...node, selected: node.id === nodeId }));
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
      recommendation: copy(executionPlan),
      runtime: {
        status: runtime?.status ?? 'idle',
        activeNodeIds: copy(runtime?.activeNodeIds ?? []),
        losses: copy(runtime?.losses ?? []),
        result: copy(runtime?.result ?? null),
        error: copy(runtime?.error ?? null),
        startedAt: runtime?.startedAt ?? null,
        finishedAt: runtime?.finishedAt ?? null,
      },
    },
  };
}

export function canvasExecutionInputSignature(nodes, edges, dataset) {
  return JSON.stringify({
    nodes: nodes.map((node) => ({
      id: node.id,
      componentId: node.data.manifest.id,
      parameters: node.data.parameters,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
    })),
    dataset,
  });
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
    getState: () => invokeAdapter('getState', () => copy(adapter.getState())),
    listComponents: () => invokeAdapter('listComponents', () => copy(adapter.listComponents())),
    addNode: (request) => invokeAdapterAsync('addNode', async () => copy(await adapter.addNode(copy(request)))),
    updateNode: (nodeId, patch) => invokeAdapterAsync('updateNode', async () => copy(await adapter.updateNode(nodeId, copy(patch)))),
    removeNode: (nodeId) => invokeAdapterAsync('removeNode', async () => copy(await adapter.removeNode(nodeId))),
    connect: (request) => invokeAdapterAsync('connect', async () => copy(await adapter.connect(copy(request)))),
    disconnect: (edgeId) => invokeAdapterAsync('disconnect', async () => copy(await adapter.disconnect(edgeId))),
    selectNode: (nodeId) => invokeAdapterAsync('selectNode', async () => copy(await adapter.selectNode(nodeId))),
    renameProject: (name) => invokeAdapterAsync('renameProject', async () => copy(await adapter.renameProject(name))),
    setDataset: (dataset) => invokeAdapterAsync('setDataset', async () => copy(await adapter.setDataset(copy(dataset)))),
    loadProject: (project) => invokeAdapterAsync('loadProject', async () => {
      assertJsonSafe(project, 'INVALID_PROJECT', 'Project');
      return copy(await adapter.loadProject(copy(project)));
    }),
    getProject: () => invokeAdapter('getProject', () => copy(adapter.getProject())),
    run: () => invokeAdapterAsync('run', async () => copy(await adapter.run())),
    exportCode: (framework, options) => invokeAdapterAsync('exportCode', async () => copy(await adapter.exportCode(framework, copy(options)))),
    downloadProject: () => invokeAdapterAsync('downloadProject', async () => copy(await adapter.downloadProject())),
    subscribe(listener) {
      if (typeof listener !== 'function') fail('INVALID_LISTENER', 'subscribe() needs a function.');
      return invokeAdapter('subscribe', () => adapter.subscribe((state) => listener(copy(state))));
    },
  });
}

export function installCanvasAgentBridge(api, target = globalThis) {
  let registry = bridgeRegistryByTarget.get(target);
  if (!registry) {
    const apis = new Map();
    const previous = target[CANVAS_AGENT_GLOBAL];
    const bridge = Object.freeze({
      apiVersion: CANVAS_AGENT_API_VERSION,
      listInstances: () => [...apis.keys()].map((id) => ({ id })),
      async open(instanceId) {
        if (instanceId === undefined) {
          if (apis.size > 1) fail('INSTANCE_AMBIGUOUS', 'More than one canvas instance is mounted.', { instanceIds: [...apis.keys()] });
          const only = apis.values().next().value;
          if (only) return only;
        } else if (apis.has(instanceId)) {
          return apis.get(instanceId);
        }
        fail('INSTANCE_NOT_FOUND', `Canvas instance not found: ${instanceId ?? ''}.`, { instanceId });
      },
    });
    registry = { apis, bridge, previous };
    bridgeRegistryByTarget.set(target, registry);
    target[CANVAS_AGENT_GLOBAL] = bridge;
  }
  if (registry.apis.has(api.instanceId)) {
    fail('DUPLICATE_INSTANCE', `Canvas instance is already mounted: ${api.instanceId}.`, { instanceId: api.instanceId });
  }
  registry.apis.set(api.instanceId, api);
  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    if (registry.apis.get(api.instanceId) === api) registry.apis.delete(api.instanceId);
    if (registry.apis.size) return;
    bridgeRegistryByTarget.delete(target);
    if (target[CANVAS_AGENT_GLOBAL] !== registry.bridge) return;
    if (registry.previous === undefined) delete target[CANVAS_AGENT_GLOBAL];
    else target[CANVAS_AGENT_GLOBAL] = registry.previous;
  };
}
