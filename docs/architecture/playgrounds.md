# Playgrounds

VOLK-ML Playgrounds are interactive, deterministic concept labs. They serve three consumers with one code path: the human UI, teaching-video demo scripts, and the in-page Canvas Agent.

## Architecture

```text
Component Tutorial
        ↓
Available Playground (registry lookup)
        ↓
Playground Dialog
```

Every playground separates pure mathematics from rendering:

```text
Pure mathematical engine
        ↓
Serializable semantic scene
        ↓
React/SVG renderer
```

The math layer never touches React, DOM, SVG, browser size, or translation. The renderer never re-implements model math; it only draws the derived scene.

## Descriptor contract

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
  validateSource(source),
  createInitialState({ source, controls, seed }),
  reduce(session, action),
  deriveScene(session),
}
```

`playgroundsFor({ manifest, dataset })` decides availability: a playground is available when the component's `op` is in `supportedOps`. The dataset argument is kept for source validation at open time; it does not widen availability.

## Session lifecycle

`src/core/playgrounds/session.js` owns the generic session:

```js
createPlaygroundSession(playground, { source, controls, seed })
dispatchPlaygroundAction(session, action)
derivePlaygroundSnapshot(session)
```

- Actions are plain JSON objects: verifiable, copyable, free of functions/DOM/React references, and deterministic for the same input.
- Random data must use an explicit seed.
- `RESET` rebuilds from the session's captured source snapshot; reducers never mutate their input session.
- A playground session is temporary UI/agent state. It is not written to project JSON and does not change `PROJECT_VERSION`.

The snapshot is a detached semantic object:

```js
{
  apiVersion: 1,
  sessionId,
  playgroundId,
  status, // ready | playing | paused | completed
  source: { kind, name, fingerprint, stale },
  controls: {},
  timeline: { step, totalSteps, speed },
  scenario: { id, stepIndex } | null,
  scene: {},       // model-specific semantic structure
  metrics: {},
  observation: { titleKey, bodyKey, params },
  formula: { key, params, highlight },
  capabilities: { canPlay, canPause, canStep, canSeek, canReset, canEditData },
}
```

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

`src/components/playgrounds/` contains the generic shell and per-playground views:

- `PlaygroundDialog` hosts the session and playback timer.
- `PlaygroundShell` provides the shared layout (header, stage, controls, observation, metrics, timeline, formula).
- `PlaygroundStage` renders the active view from `viewRegistry.jsx`.
- `LinearRegressionView` and `KnnView` draw only the semantic scene.

Animation expresses semantic change (neighbor reveal, gradient steps) rather than decoration, respects `prefers-reduced-motion` via the playback model, and all controls are keyboard-accessible. Canvas nodes stay static; only playgrounds animate.

## Adding a third playground

1. Create `src/core/playgrounds/<name>.js` with a descriptor (`validateSource`, `createInitialState`, `reduce`, `deriveScene`, controls, actions, scenarios).
2. Register it in `src/core/playgrounds/registry.js`.
3. Add its view component and map it in `src/components/playgrounds/viewRegistry.jsx`.
4. Add localized keys in `src/locales/ui.js` (title, description, controls, observations, scenario narration).
5. Add focused assertions in `scripts/check-core.mjs` (registry/session/math equivalence) and verify the UI builds.

No changes to `TutorialDialog` are needed: it queries `playgroundsFor()` generically.

## Shared math

- Linear regression math lives in `src/core/linearRegressionPlayground.js` (sampling, ranges, MSE, least squares, gradient) and `src/core/linearRegressionMath.js` (standardized z-score trainer). The browser runtime and the playground both train through `createLinearRegressionTrainer()` / `stepLinearRegressionTrainer()`, so their traces cannot drift apart. Training always happens in standardized feature/target space and parameters are converted back to raw coordinates for display; a fixed learning rate therefore cannot diverge on large-magnitude data.
- KNN math lives in `src/core/knnMath.js` (normalization, distance, neighbor ranking, voting, prediction, `refitKnnFromSplit`, `computeTestAccuracy`, `buildProjectionVector`) and is shared verbatim with the browser runtime. The distance metric is squared Euclidean to preserve runtime ranking semantics; do not change it without updating both consumers and tests.

## KNN playground semantics

- On open, the KNN playground builds its fit through the same shared `fitKnn()` in `src/core/knnMath.js` that the browser runtime uses: stratified train/test split (`deterministicShuffle` + `stratifiedSplit`, default seed `DEFAULT_KNN_SEED = 2026`), normalization from the train set only, and `k` clamped to the training size. The split uses the session seed when one is provided, otherwise the shared default, so the same dataset/k/trainRatio produces identical train/test/normalization/accuracy in the runtime and the playground.
- `trainRatio` comes from the source (`source.trainRatio`, default 0.8). `playgroundHost` records it for workspace datasets (`dataset.trainRatio ?? 0.8`) and teaching datasets (`teaching.trainRatio ?? 0.8`).
- Editing training points is a what-if operation: the raw train set is refitted with `refitKnnFromSplit()`, normalization and normalized train samples are rebuilt, and the unchanged test set is re-evaluated. Test points are not editable.
- Multidimensional datasets are shown as a 2D slice: hidden features are fixed at the training mean (`z-score 0` in the normalized view) via `buildProjectionVector()`. `metrics.runtimeAccuracy` is the fitted model's accuracy on the full test vectors; `metrics.currentViewAccuracy` is the slice model's accuracy for the current projection and normalization mode. For two visible features with normalization on, the two are equal.
- The `normalize` control is a distance-view comparison, not a model switch: with it off, prediction and `currentViewAccuracy` are explicitly what-if results and are labeled as such in the UI.
