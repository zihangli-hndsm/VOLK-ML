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

`canvas.capabilities` is an additive capability map. Version 1 advertises `{ playground: 1 }` when the mounted editor provides the optional playground namespace.

## Playground namespace (optional)

`canvas.playground` is an optional, additive namespace. Its presence does not change any required Canvas command or snapshot field, and the Canvas API version stays 1. The namespace has its own version: `canvas.playground.apiVersion === 1`.

```js
const playground = canvas.playground;
playground.list(); // descriptors: id, version, controls, actions, scenarios

await playground.open({ playgroundId: 'knn-classification', source: { kind: 'workspace-dataset' }, controls: { k: 5 } });

const state = playground.getState(); // detached semantic snapshot
await playground.dispatch({ type: 'MOVE_QUERY_POINT', x: 0.4, y: -0.2 });
await playground.play();
await playground.pause();
await playground.step();
await playground.seek(10);
await playground.reset();
await playground.runScenario('intro');
await playground.refreshSource();
await playground.close();

const unsubscribe = playground.subscribe((snapshot) => console.log(snapshot));
```

### Script operations (PR C)

The playground namespace also exposes Visualization Script operations. These are additive; `apiVersion` stays 1.

```js
playground.getCapabilities(); // models/capabilities/operations, presets, primitives
playground.listPresets();     // [{ id, model, controls, layout }]

await playground.loadPreset({ presetId: 'knn.intro', parameters: { k: 3 } });
await playground.loadScript(script);            // validates + activates (throws SCRIPT_* on failure)
playground.validateScript(script);              // { valid: true } | { valid: false, code, details }
playground.getScript();                         // active declaration (JSON-safe copy)
playground.exportScript();                      // same as getScript, for copy/download
playground.dryRunScript(script);                // { valid, estimatedSteps, estimatedPrimitiveUpdates, decisionGridCost, warnings }
await playground.generateScript({ goal, constraints }); // preset-first, returns { mode, script, rationale, dryRun, snapshot, fallback? }
playground.inspectContext();                    // full machine-readable world model (PR D)
await playground.plan(goal);                    // TeachingPlan (PR E.1): deterministic, schema-grounded
await playground.composeScript(plan);           // TeachingPlan -> Visualization Script (PR E.1)
```

- `inspectContext()` returns the Agent's world model: playground id/adapter/task, model capabilities + operation schemas + semantic schema, data context (features, target, row count, statistics, projection), controls, trace event list + payload schemas, primitive schemas, bindable prefixes, resource limits and current state. These answers come from schemas, not hardcoded prompts.
- Each model adapter declares `semanticSchema` (matching `deriveScene`), `scriptOperations` as typed operation schemas (`args`, `effects`, `alwaysProducesTrace`, `mayProduceTrace`, `enablesTrace`) with `scriptOperationActions` translators. `alwaysProducesTrace`/`mayProduceTrace` describe events emitted directly by the invocation; `enablesTrace` describes events produced by later STEP/reveal/playback (runtime delta tests verify immediate events against the schema).
- `inspectContext()` also exposes `controlSchemas` (from the Playground descriptor: key/type/min/max/step/options) alongside the current `controls`, so an Agent can plan parameter experiments without guessing constraints.
- Initial control overrides in `open({ controls })` are validated against the same Playground descriptor used by `SET_CONTROL` (unknown keys or out-of-range values reject with `INVALID_PLAYGROUND_CONTROL`), so `controlSchemas` describe every public control-setting path.
- Primitive contracts use deep semantic types (`typeContracts.js`): `array<point2d>` validates element shapes and composite types (`line2d`, `ranges2d`, `axes2d`, `decisionRegion`, `voteState`, `trainingState`, `projection`, `normalization`, `formula`, `observation`, `metrics`) validate the fields renderers/runtime consume. `compatibleBindings` are canonical: every advertised `$model.*` path's first segment exists in an adapter `semanticSchema` and resolves in the runtime semantic state (contract-tested in both directions).
- Decision-region resource validation is type-specific: the `maxDecisionResolution` limit applies only to `decision-region` primitives and rejects non-positive/fractional resolutions.
- The strict dry run validates resolved resources on **every** materialized snapshot (initial, each replayed step, final): a resolved decision-region resolution of `0`/negative/fractional/above-max fails even if a later step returns to a safe value. An absent resolution uses the renderer default (48); truthiness is never used for the default.
- `dryRunScript` is strict: unresolved required bindings fail with `SCRIPT_BINDING_UNRESOLVED` (optional unresolved bindings become deduplicated warnings), every step is materialized and checked against the primitive contract (`SCRIPT_PRIMITIVE_CONTRACT_VIOLATION`), decision-grid resolution is enforced against `maxDecisionResolution` from resolved props (`SCRIPT_TOO_COMPLEX`), and estimates include `stepCount`, `primitiveCount`, `decisionGridCells`, `pointCount` and `traceEvents`.
- Script reset semantics: `SCRIPT_RESET`/`SCRIPT_SEEK`/replay return to the `scriptBaseline` captured at `SCRIPT_LOAD` — including the trace history, so semantic state and traces always describe the same baseline. The regular `RESET` always returns to the open-time `sessionBaseline`.

- `generateScript` is preset-first: exact preset → parameterized preset → generated minimal script. An external generator (e.g. a future LLM adapter) can be injected into the host (`createPlaygroundHost({ scriptGenerator })`); its output always passes the same validator and dry run before it is loaded.
- Every accepted script is validated, dry-run replayed on a detached session clone, and only then loaded. Any failure falls back to the closest matching preset (`fallback: true`).
- `plan(goal)` (PR E.1 / E.1.1 / E.1.2) converts a teaching goal into a JSON-safe **TeachingPlan v1**. Text goals go through the lexical parser first (`parseTeachingGoalText`), then the schema-grounded planner validates everything against the same `inspectContext()` the Agent reads: comparison values and what-if values are checked against `controlSchemas`, run objectives come from the control's declarative `runObjective`, operations come from `context.model.operations` by `intent`, and reveal counts come from `playback.revealCountControl`. An explicit request for an unavailable control (e.g. `k=1 和 k=15` on LR) rejects with `TEACHING_CONTROL_INVALID` instead of being reinterpreted. `diagnose` is rejected with `TEACHING_GOAL_UNSUPPORTED` (not implemented). Pairwise comparison is the v1 cardinality: exactly two values, no silent defaults. Since PR E.1.2, `plan()` runs the same context/resource validation as the Composer before returning, so a plan that would expand beyond `resourceLimits.maxSteps` is rejected at planning time. Stable codes: `TEACHING_GOAL_UNSUPPORTED`, `TEACHING_CONTROL_INVALID`, `TEACHING_VALUE_OUT_OF_RANGE`, `TEACHING_PLAN_INVALID`.
- `composeScript(plan)` (PR E.1.1 / E.1.2) implements the deterministic Composer: TeachingPlan -> Visualization Script. The Composer **iterates/compiles `plan.phases`** (typed `observe`/`set-control`/`run`/`reveal`/`capture`/`restore`/`summarize` phases); it never regenerates the sequence from `goal.type`. Primitives are discovered generically from the PR D primitive schemas (`compatibleBindings` + declarative `placement`/`whenControl`), run operations are looked up by `intent` (never by names like `traceFit`/`tracePredict`), and there are no model-shaped templates. The plan is validated against the current context before composition (`validatePlanAgainstContext`): playground mismatches, unknown/stale controls, out-of-range or non-coercible set-control values, unresolvable run objectives and over-budget phase expansion all fail early with stable `TEACHING_*` errors. Select controls without declared options are not safely plannable and reject. The composed script is validated and strict-dry-run against the live session before it is returned; the caller then `loadScript()`s it. Comparison plans use internal capture IDs (`baseline`/`left`/`right`) and capture semantic snapshots (controls, model state, timeline, trace checkpoint, scene/metrics/observation/formula), so k=1 vs k=15 experiments are deterministic, replayable, collision-safe, and each capture holds **completed** prediction/voting evidence rather than a reset state.
- Goal taxonomy + fidelity (PR E.2): `inspectContext()` now exposes `teaching.objectives` (the bounded pedagogical vocabulary) and `teaching.supportedObjectives` (capability-grounded: `introduce`, `compare`, `show_parameter_effect`, `explain_prediction` on KNN; plus `show_training`/`show_failure_case` on LR). Normalized goals carry a semantic `objective` alongside the E.1 goal family, and unsupported objectives reject with `TEACHING_GOAL_UNSUPPORTED` instead of being reinterpreted. `composeScript(plan)` additionally runs goal fidelity evaluation (static: required control assignments / operation intents / reveals / captures / evidence bindings; runtime: deterministic replay proof that required captures hold completed evidence and required trace events fired) and returns `{ mode: 'composed', plan, script, fidelity, dryRun }`. A technically valid script that fails the teaching goal throws `TEACHING_GOAL_FIDELITY_FAILED` with structured `missing` requirements.
- Teaching errors and `SCRIPT_CAPTURE_MISSING` pass through the Agent with their stable codes, exactly like the other Playground/`SCRIPT_*` contract errors.
- Script contract errors reject with stable `SCRIPT_*` codes (`SCRIPT_ERROR_CODES`, including `INVALID_SCRIPT`); they are never wrapped as `OPERATION_FAILED`.
- No LLM is called by default; scripts never contain executable content, DOM selectors, network calls or arbitrary expressions.

Behavior constraints:

- `getState()` returns a detached, serializable snapshot with no React, DOM, SVG, or function references.
- `dispatch()` accepts only actions declared by the playground descriptor, plus the generic session actions.
- Playground mutations never change the canvas graph, project dataset, or trained model; agents use the existing `canvas.updateNode()` etc. for explicit graph changes.
- The source is captured at `open()`; later workspace dataset changes mark `source.stale = true`. Only `refreshSource()` re-reads workspace data.
- Playgrounds save no API keys and open no network connections.

Errors reject with stable codes in `details`; details are JSON-safe. Codes include:

```text
PLAYGROUND_NOT_FOUND
PLAYGROUND_NOT_AVAILABLE
PLAYGROUND_NOT_OPEN
PLAYGROUND_ALREADY_OPEN
INVALID_PLAYGROUND_SOURCE
INVALID_PLAYGROUND_CONTROL
INVALID_PLAYGROUND_ACTION
INVALID_PLAYGROUND_STEP
PLAYGROUND_SCENARIO_NOT_FOUND
PLAYGROUND_PRESET_NOT_FOUND
PLAYGROUND_SOURCE_STALE
```

Visualization Script contract errors use the `SCRIPT_*` codes defined in `src/core/playground/visualization/scriptErrors.js`.

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

Node creation resolves the component from the live registry and applies manifest defaults. Updates validate property names, types, ranges, numeric steps, and choices. Connections use the same nominal port-type, one-edge-per-input, duplicate-edge, self-edge, and cycle checks as interactive canvas connections. Removing a node also removes its incident edges.

Changing node position is layout-only and preserves a trained model and completed runtime result. Parameter or topology changes invalidate those artifacts before the command resolves.

### Project and dataset

```js
await canvas.renameProject('Experiment 12');
await canvas.setDataset(datasetOrNull);
await canvas.loadProject(projectJson);

const project = canvas.getProject();
await canvas.downloadProject();
```

`loadProject()` uses the canonical importer, including project-version migrations and manifest resolution. `getProject()` and `downloadProject()` use the canonical serializer; there is no Agent-only file format. `downloadProject()` triggers the browser's normal download flow with the sanitized project name.

Dataset replacement accepts the same tabular dataset shape used by project files: non-empty, JSON-safe row objects, feature-column names, and a target-column name. The adapter derives normalized column metadata from the supplied rows before exposing the dataset to the editor. Callers may set `task` to exactly `regression` or `classification`; only an omitted task is inferred, with a numeric target defaulting to regression and a text target to classification. An optional name must be text and defaults to `Agent Dataset`. BigInt, non-finite numbers, circular values, sparse arrays, and non-plain objects are rejected before workspace state changes. It does not upload data.

### Execution and source export

```js
await canvas.run();
const runtime = canvas.getState().execution.runtime;

const source = await canvas.exportCode('tensorflow');
await canvas.exportCode('pytorch', { download: true });
```

`run()` invokes the shared browser execution path and updates node status plus runtime timestamps, active node IDs, losses, result summary, and serialized error details. It is limited to supported L0 browser pipelines: linear regression, KNN classification, and the documented small sequential tabular MLP. A Supervised Trainer can run only with that browser MLP subset; other L1-L3 graphs remain available for inspection and source export but are not presented as locally executable.

The runner records a semantic signature of its graph parameters, topology, and dataset. If the interactive editor changes any of those inputs before execution finishes, the stale result is discarded with `WORKSPACE_CHANGED`; layout-only movement does not invalidate it.

`exportCode(framework)` accepts `pytorch` or `tensorflow` and returns generated Python. `{ download: true }` also downloads the source file.

Mutating commands reject with `INSTANCE_BUSY` while a browser run is active. Inspection and state subscription remain available.

## Errors and versioning

Failures reject with `CanvasAgentError`. Its stable `code` identifies the class of failure; `details` contains JSON-serializable context, with unsupported diagnostic values converted to strings at the API boundary. Current codes include invalid arguments, unknown or duplicate nodes/edges/components, invalid parameters or datasets, rejected connections, busy instances, unavailable operations, and ambiguous/unknown instances.

Consumers must check `bridge.apiVersion` or `canvas.apiVersion`. Changing a required command, payload, snapshot-field meaning, or error-code meaning requires incrementing `CANVAS_AGENT_API_VERSION` and documenting migration behavior. Additive optional fields may be introduced within the same version.

## Implementation boundary

- `src/core/canvasAgent.js` owns pure graph operations, snapshot construction, API validation, and the global bridge.
- `src/main.jsx` adapts the mounted React workspace, canonical project lifecycle, browser runner, and compiler to that contract.
- `scripts/check-core.mjs` verifies graph-command invariants, snapshot detachment, API forwarding, instance discovery, and bridge teardown.

Keep Agent operations at this boundary rather than scripting React Flow DOM elements. That preserves stable IDs, project portability, and the same semantic validation for human and Agent edits.
