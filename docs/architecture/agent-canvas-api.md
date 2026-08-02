# Canvas Agent API

The Canvas Agent API lets trusted code inspect and operate a VOLK-ML workspace after the React editor has mounted. Version 1 is exposed as an in-page JavaScript capability:

```js
const bridge = globalThis.__VOLK_ML_AGENT__;
const instances = bridge.listInstances();
const canvas = await bridge.open(instances[0].id);
```

`open()` without an ID opens the only mounted instance. It rejects an ambiguous or unknown instance instead of choosing silently.

## Security and hosting boundary

The bridge is not an HTTP API. It opens no socket, contains no credentials, and grants no cloud account, collaboration, billing, or remote-compute authority. Code that can execute in the page can already reach browser application state, so a shell that relays commands from an external Agent must supply its own authentication, authorization, origin isolation, user consent, and audit policy.

Do not expose the bridge directly to arbitrary cross-origin messages. A remote transport or MCP server should validate its caller and translate only the commands it intends to allow.

## State inspection

`canvas.getState()` returns a detached, serializable snapshot:

```js
{
  apiVersion: 1,
  instanceId: 'canvas-...',
  project: {
    name: 'Sample Project',
    dirty: false,
  },
  canvas: {
    nodes: [],
    edges: [],
    selectedNodeId: null,
  },
  dataset: {
    name: 'Example data',
    task: 'regression',
    rowCount: 120,
    featureColumns: ['x'],
    targetColumn: 'y',
  },
  execution: {
    runtime: {
      status: 'idle', // idle | running | succeeded | failed
      startedAt: null,
      finishedAt: null,
      activeNodeIds: [],
      losses: [],
      result: null,
      error: null,
    },
    recommendation: { /* execution-tier estimate */ },
  },
}
```

`canvas.listComponents()` returns detached summaries of the current basic and composite component registry, including IDs, localized metadata, typed ports, property schemas, execution tier, browser backend, and framework compatibility.

`canvas.subscribe(listener)` calls `listener(snapshot)` after workspace state changes and returns an unsubscribe function. Subscribers must treat every snapshot as immutable.

## Commands

All mutations return promises. An accepted mutation is visible through `getState()` before its promise resolves.

### Graph elements

```js
const { nodeId } = await canvas.addNode({
  componentId: 'tensor_input_node',
  id: 'optional-stable-id',
  position: { x: 100, y: 200 },
  parameters: { shape: '32' },
});

await canvas.updateNode(nodeId, {
  position: { x: 160, y: 220 },
  parameters: { dtype: 'float16' },
});

const { edgeId } = await canvas.connect({
  source: nodeId,
  sourceHandle: 'tensor',
  target: 'dense-id',
  targetHandle: 'input',
});

await canvas.disconnect(edgeId);
await canvas.removeNode(nodeId);
await canvas.selectNode('dense-id'); // null clears selection
```

Node creation resolves the component from the live registry and applies manifest defaults. Updates validate property names, types, ranges, and choices. Connections use the same nominal port-type, one-edge-per-input, duplicate-edge, self-edge, and cycle checks as interactive canvas connections. Removing a node also removes its incident edges.

### Project and dataset

```js
await canvas.renameProject('Experiment 12');
await canvas.setDataset(datasetOrNull);
await canvas.loadProject(projectJson);

const project = canvas.getProject();
await canvas.downloadProject();
```

`loadProject()` uses the canonical importer, including project-version migrations and manifest resolution. `getProject()` and `downloadProject()` use the canonical serializer; there is no Agent-only file format. `downloadProject()` triggers the browser's normal download flow with the sanitized project name.

Dataset replacement accepts the same tabular dataset shape used by project files: non-empty, JSON-safe row objects, feature-column names, and a target-column name. The adapter derives normalized column metadata from the supplied rows before exposing the dataset to the editor. Callers may set `task` to `regression` or `classification`; when omitted, a numeric target defaults to regression and a text target to classification. BigInt, non-finite numbers, circular values, sparse arrays, and non-plain objects are rejected before workspace state changes. It does not upload data.

### Execution and source export

```js
await canvas.run();
const runtime = canvas.getState().execution.runtime;

const source = await canvas.exportCode('tensorflow');
await canvas.exportCode('pytorch', { download: true });
```

`run()` invokes the shared browser execution path and updates node status plus runtime timestamps, active node IDs, losses, result summary, and serialized error details. It is limited to supported L0 browser pipelines. A Supervised Trainer and other L1-L3 graphs remain available for inspection and source export but are not presented as locally executable.

`exportCode(framework)` accepts `pytorch` or `tensorflow` and returns generated Python. `{ download: true }` also downloads the source file.

Mutating commands reject with `INSTANCE_BUSY` while a browser run is active. Inspection and state subscription remain available.

## Errors and versioning

Failures reject with `CanvasAgentError`. Its stable `code` identifies the class of failure; `details` contains serializable context. Current codes include invalid arguments, unknown or duplicate nodes/edges/components, invalid parameters or datasets, rejected connections, busy instances, unavailable operations, and ambiguous/unknown instances.

Consumers must check `bridge.apiVersion` or `canvas.apiVersion`. Changing a required command, payload, snapshot-field meaning, or error-code meaning requires incrementing `CANVAS_AGENT_API_VERSION` and documenting migration behavior. Additive optional fields may be introduced within the same version.

## Implementation boundary

- `src/core/canvasAgent.js` owns pure graph operations, snapshot construction, API validation, and the global bridge.
- `src/main.jsx` adapts the mounted React workspace, canonical project lifecycle, browser runner, and compiler to that contract.
- `scripts/check-core.mjs` verifies graph-command invariants, snapshot detachment, API forwarding, instance discovery, and bridge teardown.

Keep Agent operations at this boundary rather than scripting React Flow DOM elements. That preserves stable IDs, project portability, and the same semantic validation for human and Agent edits.
