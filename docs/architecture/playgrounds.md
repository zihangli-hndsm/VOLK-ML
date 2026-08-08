# Playgrounds

VOLK-ML Playgrounds are interactive, deterministic concept labs. They serve three consumers with one code path: the human UI, teaching-video demo scripts, and the in-page Canvas Agent.

## Unified visualization runtime

Since the PR B refactor, both models run on one **unified playground runtime** instead of two independent session reducers:

```text
Model / Dataset
        ↓
Semantic state + trace events
        ↓
Visualization Script (JSON preset)
        ↓
Primitive Materializer (binds $model/$data/$controls/$trace/$metrics)
        ↓
JSON primitives[]
        ↓
Unified stage (renderer by primitive type)
```

`src/core/playground/playgroundRuntime.js` owns the session: controls, timeline, status, semantic traces and visual state. The UI, the Canvas Agent (`canvas.playground`) and `src/core/playground/visualization/scriptRuntime.js` all dispatch the same JSON actions through `dispatchRuntimeAction()`. Model-specific behavior lives in the model adapters (`src/core/playground/model/`), which never import React/DOM/SVG and never touch the session reducer.

The old descriptors in `src/core/playgrounds/linearRegression.js` and `src/core/playgrounds/knn.js` are metadata only (id, title, controls, actions, scenarios, source validation); `src/core/playgrounds/session.js` is a thin compatibility wrapper over the unified runtime, so the registry, Agent API and existing contract tests keep working.

Since the PR B follow-up, **Visualization Scripts own visualization composition**:

- Model adapters output a stable semantic state (`deriveScene`) and never produce primitives (`buildPrimitives` was removed from the contract).
- `script.primitives` is the single source of truth: a primitive exists in the snapshot only if the script declares it, and `visualState[id] !== false` controls visibility.
- Primitives may declare a visibility condition `when: '$controls.showResiduals'`; the materializer skips primitives whose condition is false, so show/hide decisions stay in the script, never in the adapter.
- `primitiveMaterializer.js` resolves each declaration's binding props (`$model.points`, `$controls.showNeighborOrder`, `mean($data.values)`, ...) into renderer props; bindings are recursive and JSON-safe. `visualState.highlight` stamps `props.highlighted` on the target primitive and `visualState.overrides` patches primitive props (used by `annotate` steps).
- Transforms are type-safe: array transforms fail with `SCRIPT_BINDING_TYPE_MISMATCH` instead of native errors, and the whitelist only contains single-argument transforms (`filterByEvent` was removed until DSL v2).
- `$data` always describes the dataset the model actually uses: workspace sources keep the full workspace context, teaching/fallback sources are reconstructed from the normalized source points (`buildDataState`).
- Loading a script whose `model.adapter` does not match the session is rejected with `SCRIPT_MODEL_MISMATCH`.
- Script-mode capabilities come from `scriptState` (seekable from step 0 even when the model timeline is empty), and `SCRIPT_PLAY` on a completed script restarts from the baseline.
- `playgroundHost` routes `play`/`pause`/`step`/`seek`/`reset` to `SCRIPT_*` actions whenever an active Visualization Script exists, and to the model actions otherwise — the UI and the Canvas Agent control exactly the same timeline.
- The validator rejects `show`/`hide`/`highlight` targets that are not declared primitives (`SCRIPT_UNKNOWN_PRIMITIVE_REFERENCE`) and requires exactly one annotation primitive for `annotate` steps (`SCRIPT_ANNOTATION_TARGET_MISSING` / `SCRIPT_ANNOTATION_TARGET_AMBIGUOUS`).
- KNN teaching/fallback `$data` rows include the `label` target column and the schema declares it, so `$data.targetColumn` always exists in `$data.rows`.
- Script contract errors are centralized in `visualization/scriptErrors.js` (`SCRIPT_ERROR_CODES`) and pass through the Canvas Agent with their stable codes instead of `OPERATION_FAILED`.

## Project language policy

`applyProject(rawProject, { languagePolicy })` supports:

- `'project'` (default): Import, autosave Restore and Agent `loadProject` keep the existing behavior — a project that carries a saved language preference restores it.
- `'preserve-current'`: bundled Examples ignore the project's `language` field entirely, so loading an example never changes the user's UI preference. The pure decision lives in `src/core/languagePolicy.js` (`resolveLanguagePreference`).

User preference owns language; example content owns the example. No `PROJECT_VERSION` change or migration is part of this policy.

## Agent generated visualization scripts (PR C)

- `src/core/playground/agent/dryRun.js` replays a script on a detached session clone (after structural validation and binding resolution) and returns `{ valid, estimatedSteps, estimatedPrimitiveUpdates, decisionGridCost, warnings }`. The live session is never mutated; any step that throws makes the dry run invalid.
- `src/core/playground/agent/scriptGenerator.js` is a preset-first, rule-based generator: exact preset → parameterized preset (goal keywords map to presets and control parameters) → generated minimal script. No LLM is required; an external generator (future LLM adapter) can be injected at the host and its output still passes the same validator + dry run.
- `playgroundHost` / `canvas.playground` expose `getCapabilities`, `listPresets`, `loadPreset`, `loadScript`, `validateScript`, `getScript`, `exportScript`, `dryRunScript` and `generateScript`. `generateScript` loads the accepted script and falls back to the closest preset (`fallback: true`) if validation or the dry run fails.

## Agent context and semantic contracts (PR D)

- `inspectContext()` (PR D) gives the Agent a stable, machine-readable world model: playground/model/data/controls/traces/primitives/bindings/resourceLimits/currentState, all sourced from schemas.
- Model adapters declare `semanticSchema` (fields must exist in the derived semantic state — contract tested), typed `scriptOperations` (`args` + `producesTrace`) with `scriptOperationActions` translators, and every trace event has a `TRACE_PAYLOAD_SCHEMAS` entry.
- `visualization/schemas.js` + `typeContracts.js` are the single source for primitive contracts: deep semantic types (`array<point2d>` validates element shapes), canonical `compatibleBindings` (every `$model.*` path exists in an adapter `semanticSchema` and resolves in the semantic state), shared by `inspectContext`, the strict dry run and tests.
- The dry run is strict: unresolved required bindings → `SCRIPT_BINDING_UNRESOLVED`; every script step is replayed on a detached clone and each snapshot is materialized and validated against the primitive contract (`SCRIPT_PRIMITIVE_CONTRACT_VIOLATION`); decision-grid resolution is enforced from resolved props (`SCRIPT_TOO_COMPLEX` beyond `maxDecisionResolution`); optional unresolved bindings become deduplicated warnings; estimates include `stepCount`/`primitiveCount`/`decisionGridCells`/`pointCount`/`traceEvents`.
- Trace payload schemas are explicit about required vs optional fields, and `validateTracePayload` is run against every emitted event from LR/KNN scenarios.
- Operation schemas distinguish `alwaysProducesTrace` / `mayProduceTrace` (emitted directly by the invocation) from `enablesTrace` (prepared for later STEP/reveal playback); runtime contract tests verify the immediate trace delta against the schema for representative states (including divergence and already-revealed KNN).
- `inspectContext()` exposes `controlSchemas` from the Playground descriptors; `typeContracts.js` validates composite semantic types structurally; the decision-region resource limit is type-specific and rejects non-positive/fractional resolutions.
- Dynamic script baseline: `SCRIPT_LOAD` captures `scriptBaseline` (controls, model state, data, source, seed **and traces**); `SCRIPT_RESET`/`SCRIPT_SEEK`/replay return to it, while the regular `RESET` returns to the open-time `sessionBaseline`. Error codes: `SCRIPT_BINDING_UNRESOLVED`, `SCRIPT_PRIMITIVE_CONTRACT_VIOLATION`, `SCRIPT_TRACE_PAYLOAD_INVALID`.
- Descriptor `scenarios` are now `{ id, titleKey, presetId }` references; `runScenario()` and UI preset playback both execute the preset through the Script Runtime (same actions, same traces).
- Script state (`scriptState: { status, step, totalSteps }`) is separate from the model timeline, so a 7-step script is never conflated with 20 training steps.
- `RESET`/script `reset`/`seek`/replay all return to the session **baseline** (initial controls + source + seed), so `fresh first-N == full-run-then-seek-N == reset-then-N`.

## Layers

### Model adapters

Each model implements the adapter contract in `src/core/playground/model/`:

```js
{
  id: 'knn',
  capabilities: { fit, predict, evaluate, traceFit, tracePredict, decisionSurface },
  defaultVisualizationPreset,
  initialize({ source, controls, seed, recorder }),
  applyModelAction(modelState, action, { controls, recorder }),
  deriveScene(modelState, { controls, source }),  // semantic state only
  scriptOperations,                                // operation name -> JSON action
}
```

- Linear Regression reuses `linearRegressionMath.js` / `linearRegressionPlayground.js`.
- KNN reuses `knnMath.js` (`fitKnn`, `refitKnnFromSplit`, `computeTestAccuracy`, `buildProjectionVector`) and the browser runtime's split/fit semantics (`DEFAULT_KNN_SEED = 2026`).
- KNN's fit trace is lazy-learning honest: split → normalization statistics → store samples → ready; it never fabricates an optimization.
- `deriveScene` returns a stable semantic state (points, line, residuals, training, metrics, formula, observation, ranges for LR; display points/query, neighbors, voting, decision regions, projection, normalization for KNN). It never decides which visual primitives exist.
- `scriptOperations` translates script `invoke` operation names into the same JSON actions the UI uses (`traceFit` → `START_TRAINING`, `setBestFit` → `SET_BEST_FIT`, `tracePredict` → `START_NEIGHBOR_REVEAL`, `moveQuery` → `MOVE_QUERY_POINT`), so adding a model never requires changing the Script Runtime.

### Dataset adapter

`src/core/playground/data/datasetAdapter.js` provides `inspectDataset`, `createSplit`, `project2D`, `buildSlice` (hidden features fixed at the training mean), `featureStats` and `sampleRows`. The 2D projection always goes through `buildSlice({ xFeature, yFeature, fixedFeatureStrategy: 'mean' })`.

`createRuntimeSession` runs every source through `inspectDataset()` and stores the normalized context as `dataState: { schema, rows, task, featureColumns, targetColumn, trainRatio }`, so `$data.*` bindings in scripts are real (the workspace dataset is passed from `playgroundHost`).

### Semantic trace

`src/core/playground/trace/` defines JSON-safe, deterministic trace events (`data.loaded`, `split.created`, `normalization.fitted`, per-model training/query events, `evaluation.completed`). Event ids/steps/timestamps come from a session-local counter, never the wall clock, so the same script + seed + data replays to the identical trace.

### Visualization scripts and presets

Presets (`src/core/playground/presets/`, registered in `visualization/presetRegistry.js`) are JSON-safe declarations:

```js
{ version: 1, id, model: { adapter }, data: { source },
  controls: [...], layout: { stage: [...], side: [...] },
  primitives: [{ id, type }], steps: [...] }
```

`visualization/scriptValidator.js` rejects unknown models/primitives/operations, invalid bindings (including primitive props), executable strings, oversized scripts, unknown layout primitive references and duplicate layout ids (`SCRIPT_UNKNOWN_MODEL`, `SCRIPT_UNKNOWN_PRIMITIVE`, `SCRIPT_UNSUPPORTED_OPERATION`, `SCRIPT_INVALID_BINDING`, `SCRIPT_UNKNOWN_TRACE_EVENT`, `SCRIPT_TOO_COMPLEX`, `SCRIPT_UNKNOWN_PRIMITIVE_REFERENCE`, `INVALID_SCRIPT`). Every operation the validator accepts has runtime semantics: `invoke`, `setControl`, `show`, `hide`, `highlight`, `reveal`, `reset`, `annotate`, `wait` (`consume`/`update` were removed until PR C needs them).

`visualization/scriptRuntime.js` executes presets through the unified runtime's `SCRIPT_*` actions (`SCRIPT_LOAD/PLAY/PAUSE/STEP/SEEK/RESET`); seek and reset replay from the session baseline, so the same script + seed + data produces byte-identical traces and primitives.

### Unified UI

`src/components/playground/` contains the toolbar (Model / Dataset / Preset / Agent), the unified stage, inspector, timeline and primitive renderers. The stage only knows `primitives[]` — it resolves each primitive through `rendererRegistry.jsx` and never imports model math. Playback is script-driven: with a loaded preset the timeline drives `SCRIPT_*` actions and never special-cases a model (a static test forbids model names and `START_TRAINING`/`START_NEIGHBOR_REVEAL` in the UI directory).

### Visual encoding and renderer resilience

- `src/components/playground/visualEncoding.js` owns the deterministic label→color mapping (`buildLabelColorMap`). Stage and Inspector build it from the scatter primitive's points, so a label renders with the same color across scatter points, neighbor links, vote bars and decision regions. Colors are UI-layer only: adapters emit semantic labels, scripts decide what to show, and no theme system exists yet.
- Renderers degrade gracefully on missing optional context (missing `colorByLabel`, malformed `voting`, missing arrays) instead of throwing, but never repair model math — bad model state is caught in the runtime/validator layer.
- `PlaygroundErrorBoundary` wraps the Playground (Stage/Inspector/Timeline/renderers) so a renderer exception shows a fallback panel with Reset and Close instead of white-screening the app. The fallback only depends on `onClose`/`onReset`/`t`, never on the possibly-corrupt snapshot.
- `scripts/check-playground-render.mjs` bundles `scripts/playground-render-smoke.jsx` with esbuild and runs React server rendering for every KNN/LR preset step (Stage + Inspector), asserting the first non-empty vote snapshot renders without exceptions; it is part of `npm run check`.

## Descriptor contract (compatibility)

Each playground is a descriptor in `src/core/playgrounds/`. The registry (`registry.js`) is the only source of playground metadata.

```js
{
  id: 'linear-regression',
  version: 1,
  titleKey: 'playground.linearRegression.title',
  descriptionKey: 'playground.linearRegression.description',
  supportedOps: ['linear_regression'],
  supportedTasks: ['regression'],
  sourceKinds: ['example', 'workspace-dataset'],
  controls: [{ key: 'weight', type: 'number', min: -100, max: 100, step: 0.01 }],
  actions: ['SET_CONTROL', 'ADD_POINT', 'START_TRAINING', 'STEP', 'SEEK', 'RESET', 'RUN_SCENARIO'],
  scenarios: [{ id: 'intro', titleKey: 'playground.scenario.intro', steps: [...] }],
  adapterId: 'linear-regression',
  validateSource(source),
}
```

`playgroundsFor({ manifest, dataset })` decides availability: a playground is available when the component's `op` is in `supportedOps`. The dataset argument is kept for source validation at open time; it does not widen availability.

`createInitialState`, `reduce` and `deriveScene` are no longer part of the descriptor contract — the unified runtime implements them once.

## Session lifecycle

`src/core/playgrounds/session.js` exposes `createPlaygroundSession` / `dispatchPlaygroundAction` / `derivePlaygroundSnapshot`, delegating to the unified runtime. Actions are plain JSON objects; `RESET` rebuilds from the captured source snapshot; dispatch never mutates its input session; sessions are temporary UI/agent state (never written to project JSON, never change `PROJECT_VERSION`).

The snapshot is a detached semantic object that keeps the historical scene/metrics/observation/formula/capabilities fields and adds `traces`, `script`, `visualState` and `primitives`.

## Source handling

- The source is captured as a snapshot when a playground opens.
- A `workspace-dataset` source records a fingerprint of the dataset used.
- When the workspace dataset changes later, the session marks `source.stale = true`.
- Only `refreshSource()` re-reads the workspace dataset and rebuilds the session.
- Playground edits never modify canvas nodes, topology, the project dataset, or the trained model. "Apply to canvas" is future work and must go through the existing Canvas Agent/UI commands and parameter validation.

## Scenarios

Scenarios are serializable action sequences with per-step narration keys:

```js
{
  id: 'intro',
  steps: [
    { action: { type: 'SET_CONTROL', key: 'k', value: 1 }, durationMs: 800, narrationKey: 'playground.knn.scenario.introK1' },
  ],
}
```

The UI animates through steps at `durationMs / speed`; the Agent `runScenario()` applies them deterministically. The same scenario powers both, which makes recorded teaching videos reproducible.

## Renderer boundary

`src/components/playground/` contains the unified UI:

- `UnifiedPlaygroundDialog` hosts the session and playback timer.
- `PlaygroundToolbar` shows Model / Dataset / Preset / Agent status.
- `PlaygroundStage` renders the `layout.stage` primitives through `rendererRegistry.jsx`; it never knows which model produced them.
- `PlaygroundInspector` shows controls plus the `layout.side` primitives (vote bars, metrics, observation).
- `PlaygroundTimeline` and the formula bar drive playback and narration.
- `renderers/` draw JSON props only; they never import model mathematics.

Animation expresses semantic change (neighbor reveal, gradient steps) rather than decoration, respects `prefers-reduced-motion` via the playback model, and all controls are keyboard-accessible. Canvas nodes stay static; only playgrounds animate.

## Adding a third playground

1. Create a model adapter in `src/core/playground/model/<name>Adapter.js` (initialize, applyModelAction, deriveScene, buildPrimitives) and register it in `modelRegistry.js`.
2. Create a metadata descriptor in `src/core/playgrounds/<name>.js` (id, titleKey, controls, actions, scenarios, validateSource, `adapterId`) and register it in `src/core/playgrounds/registry.js`.
3. Add a JSON preset in `src/core/playground/presets/` and register it in `visualization/presetRegistry.js`.
4. Add primitive renderers in `src/components/playground/renderers/` and map them in `rendererRegistry.jsx`.
5. Add localized keys in `src/locales/ui.js` and focused assertions in `scripts/check-core.mjs`.

No changes to `TutorialDialog` or the unified stage are needed: the tutorial queries `playgroundsFor()` generically and the stage only consumes primitives.

## Shared math

- Linear regression math lives in `src/core/linearRegressionPlayground.js` (sampling, ranges, MSE, least squares, gradient) and `src/core/linearRegressionMath.js` (standardized z-score trainer). The browser runtime and the playground both train through `createLinearRegressionTrainer()` / `stepLinearRegressionTrainer()`, so their traces cannot drift apart. Training always happens in standardized feature/target space and parameters are converted back to raw coordinates for display; a fixed learning rate therefore cannot diverge on large-magnitude data.
- KNN math lives in `src/core/knnMath.js` (normalization, distance, neighbor ranking, voting, prediction, `refitKnnFromSplit`, `computeTestAccuracy`, `buildProjectionVector`) and is shared verbatim with the browser runtime. The distance metric is squared Euclidean to preserve runtime ranking semantics; do not change it without updating both consumers and tests.

## KNN playground semantics

- On open, the KNN playground builds its fit through the same shared `fitKnn()` in `src/core/knnMath.js` that the browser runtime uses: stratified train/test split (`deterministicShuffle` + `stratifiedSplit`, default seed `DEFAULT_KNN_SEED = 2026`), normalization from the train set only, and `k` clamped to the training size. The split uses the session seed when one is provided, otherwise the shared default, so the same dataset/k/trainRatio produces identical train/test/normalization/accuracy in the runtime and the playground.
- `trainRatio` comes from the source (`source.trainRatio`, default 0.8). `playgroundHost` records it for workspace datasets (`dataset.trainRatio ?? 0.8`) and teaching datasets (`teaching.trainRatio ?? 0.8`).
- Editing training points is a what-if operation: the raw train set is refitted with `refitKnnFromSplit()`, normalization and normalized train samples are rebuilt, and the unchanged test set is re-evaluated. Test points are not editable.
- Multidimensional datasets are shown as a 2D slice: hidden features are fixed at the training mean (`z-score 0` in the normalized view) via `buildProjectionVector()`. `metrics.runtimeAccuracy` is the fitted model's accuracy on the full test vectors; `metrics.currentViewAccuracy` is the slice model's accuracy for the current projection and normalization mode. For two visible features with normalization on, the two are equal.
- The `normalize` control is a distance-view comparison, not a model switch: with it off, prediction and `currentViewAccuracy` are explicitly what-if results and are labeled as such in the UI.
