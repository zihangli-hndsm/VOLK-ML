# Playgrounds

## Learner Test Design (Phase 12)

The Explore surface may hold a bounded, session-local `TestDesign` beside learner hypotheses. A design records one supported intervention, optional held-constant factors, selected observable outcomes, and the learner's prediction. Saving a design is detached and does not change the World, Dataset, Experiment, Evidence, project JSON, or hypothesis status.

Only an explicit Run action executes the existing runtime sequence `DUPLICATE_EXPERIMENT → intervention → RUN → SET_COMPARE`. The host preflights that sequence on a detached session, rejects stale baselines and unsupported factors, then commits the same existing JSON actions to the live session. Comparison labels are descriptive (`single-factor`, `confounded`, `observational`, or `insufficient`) and are derived from registered semantic paths; they are not causal conclusions.

Outcome references use existing stable `evidence-instance-*` identifiers. Test Design state is presentation/session state and is intentionally excluded from project persistence, Experiment fingerprints, Agent authority, mastery, confidence, and automatic hypothesis status changes.

Execution-window Evidence is retained as temporal provenance only. It becomes an outcome reference only when its existing `evidenceRefs` directly names one of the learner-selected observable IDs; detector reason codes, timing, or matching conditions never establish that relationship. Comparison classification consumes the canonical `semanticFactorPaths` and `semanticFactorCount` emitted by `compareExperiments`, so multiple raw leaf paths may still represent one learner-facing factor.

Competing Hypotheses and Discrimination Plans are detached learning records. They reference real learner Hypotheses and an existing Test Design, preserve the learner's predictions, and present factual prediction divergence or overlap. They do not add an executor, truth score, winner, automatic status mutation, or `caused_by` edge.

The learner interpretation surface appears when existing Hypotheses and
Evidence instances are available. The learner explicitly selects stable
Evidence IDs, chooses a judgment, and may attach an existing Test Design.
Saving is a detached session record. Revising a Hypothesis creates a new child
identity while preserving the old statement and records the learner's
interpretation as lineage. The surface does not execute a Test Design, change
Hypothesis status, edit Evidence, or ask LUMI to explain a result.

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

Since Phase 1.1, the same reducer also owns canonical World transactions,
grouped World Undo/Redo history, and non-semantic Workspace view state.
`APPLY_WORLD_TRANSACTION` applies a model-independent atomic operation group to
`Experiment.world`, then calls an adapter's optional `applyWorld()` boundary.
Linear Regression implements that boundary; unsupported adapters reject World
editing rather than receiving model-specific transaction branches in the
runtime. `SET_WORKSPACE_VIEW` never changes Experiment semantics.

Public World-edit capabilities come from
`src/core/exploration/operationRegistry.js`, not from a model-specific action
list. Human controls, the Playground Agent, and legacy Linear Regression
actions all enter the same atomic transaction path. The adapter receives the
accepted canonical World through `applyWorld()` only after split validity has
been checked; it recomputes model state but does not own World mutation
semantics. See `docs/architecture/exploration-semantics.md` for the exact
first-split normalization and comparison-factor contracts.

### 2D Data Workspace and data-first Experiment Lab (Phase 1.2)

`DataWorkspace.jsx` is a reusable Data Lab surface over `snapshot.world` and
`snapshot.capabilities`. The internal `data-lab` session is model-optional: it
opens from the current workspace dataset (or the registered teaching sample),
supports Point, Brush, Spray, Select/Move, Erase, Train/Test authoring, precise
coordinate entry, Fit view, and visible Undo/Redo, then offers compatible model
descriptors from the registry. Model attachment keeps the same World and only
adds model controls, semantic state, and visualization playback. The Data Lab
remains the outer session after attachment: World actions are validated against
the Data Lab descriptor, while model-specific actions emitted by the attached
model's script are validated against that model's descriptor.

Projection semantics are centralized in
`src/core/exploration/projection.js`. Scatter, distribution, hit testing,
erase, selection, and axis labels all use named feature values. New-row tools
are available only when the two-dimensional projection is complete; a
multi-feature projection cannot invent hidden feature values. Distribution
bars distinguish train and test with both shape/pattern and labels, not color
alone.

Linear Regression defaults back to the registered `linear-trend` teaching
dataset when no workspace dataset is supplied. Fallback points are only used
when that teaching dataset is unavailable. The Workspace deliberately does
not add an Experiment Bar, generators, Scenario execution, persistence, or
editable KNN/MLP Worlds in this phase.

The shared Experiment Lab shell renders this Data Lab beside a peer Model Lab
tab over the same runtime session. Data Lab projection changes are validated
`SET_WORKSPACE_VIEW` updates and do not alter World semantics. Numeric feature
interventions use the registered `SET_FEATURE_VALUES` and
`TRANSFORM_FEATURE_VALUES` operations, with grouped Undo and deterministic
seeded noise. `RUN` and `RESET_LEARNING` preserve the current World; restoring
the open-time baseline is an explicit `RESTORE_ORIGINAL_DATA` action. Script
restart is named `Restart explanation` in the UI and preserves learner World
edits, history, and projection state.

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
- The UI uses one scheduler decision for both modes: a playing Visualization Script dispatches `SCRIPT_STEP`; when no script is actively playing, model `PLAY` dispatches finite `STEP` actions until the model timeline completes. Operation metadata (`playback.revealCountControl`) maps sparse teaching reveals onto sampled model progress, so a three-step linear-regression explanation can expose the full declared training trajectory without conflating the script and model timelines.
- Timeline patches use a defined-value merge: `undefined` means the adapter did not supply that field and the previous value is preserved; an explicit value replaces it. This keeps playback speed valid when `START_TRAINING` returns only `step` and `totalSteps`.
- The Training Microscope owns a separate `TRAINING_STEP` action and
  `trainingMicroscope.canStep` capability. Its first action initializes the
  model trajectory and advances exactly once; later actions advance exactly
  once even when a Visualization Script is loaded. The main timeline remains
  responsible for `SCRIPT_STEP`.
- The browser scheduler cancels its timer generation before rescheduling, catches rejected dispatches, pauses automatic playback, and renders a localized failure with the action, script step, operation and reason. It does not retry a failed action; the last valid semantic snapshot remains authoritative.

### Phase 2 Experiment Bar and controlled comparison

The runtime keeps one active semantic Experiment and a bounded workspace of
JSON-safe experiment records. Each record has an identity, learner-facing
name, parent/baseline lineage, the existing Experiment semantic bundle, and the
small runtime state needed to restore the World, controls, model result,
timeline, traces, and existing Undo boundary. `DUPLICATE_EXPERIMENT` deep
clones the exact current runtime record and gives it a new identity; its World,
source, model/data state, Experiment baseline, and script baseline are all
captured from that same duplication-time state. Later actions continue to
dispatch through the same unified runtime, so World and model mutations affect
only the active record. `SWITCH_EXPERIMENT` restores the full record while
leaving presentation-only state such as hover, temporary selection, dialog
visibility, and browser viewport outside the Experiment contract.

`SET_COMPARE` exposes one active record and one comparison target. The semantic
diff uses World/Dataset, train-test relationship, model configuration, learning
configuration, evaluation configuration, and randomness policy. Learned Linear
Regression weight/bias are result fields, not model factors. Comparison Clarity
is `identical` for zero changed factors, `high` for one, and `mixed` for more
than one. Result rows are shown only when both records have truthful runtime
metrics/results. Duplicate experiments retain the current deterministic seed;
the UI reports that relationship as Matched or Unspecified. `REPEAT_EXPERIMENT`
is the bounded manual repeat entry point: it reruns the current World/model
under the existing seed policy without creating a new trial system.
Switching between A/B roles also swaps the comparison target, so the runtime
never exposes a self-comparison. When Compare is enabled for compatible 2D
Worlds, Data Lab uses a union of both projected bounds as a shared view frame;
the frame is comparison/view state and never part of the semantic Experiment
diff. The Experiment Bar's Undo setting change is intentionally distinct from
Data Lab World Undo.

Experiment lineage has one canonical source: `experiment.lineage`. Workspace
and Agent summaries derive `parentExperimentId` and `baselineExperimentId`
from that semantic lineage, so a branch such as A -> B -> C remains consistent
across all inspection surfaces.

The Agent's `inspectContext()` exposes the same `experimentWorkspace` summary
used by the human Experiment Bar, including identities, ancestry, active
comparison, semantic diff, clarity, result availability, and Repeat seed
policy. Experiment snapshots are runtime-only; they are intentionally not
inserted into project JSON in Phase 2, so existing project persistence and
version migrations remain unchanged.

### Phase 3 World Builder generators

Phase 3 keeps the finite-observation World contract while adding an explicit
`world.mode` distinction: `sample` means the current observations are the
World, while `generated` means the observations are one realization of the
active `world.generator.spec`. The generator is deliberately small and
explicit: `uniform`, `gaussian`, and `two-cluster` input shapes; a separate
linear latent relation (`slope` and `bias`); additive Gaussian-like noise;
bounded train/test sample counts; and deterministic outlier count. Learned
model weight/bias fields are never reused as generator relation parameters.

`src/core/exploration/generator.js` owns normalization, browser-safe limits,
and seeded deterministic generation. The same normalized specification and
seed produce the same observations and stable split/index IDs; no direct
`Math.random()` path is used. Generated observations carry `generated` or
`generated-outlier` provenance. `SET_WORLD_GENERATOR`,
`SET_GENERATOR_PARAMETER`, `SET_GENERATOR_SEED`, `REGENERATE_WORLD`, and
`FREEZE_AS_SAMPLES` are registered World operations, so World Builder UI and
Agent dispatch share the same transaction, Undo, validation, and model-result
refresh boundary.

Manual edits remain ordinary World operations. Editing a generated point marks
that point `manual` and the active generator `modified`; it does not silently
claim that the realization is untouched. `FREEZE_AS_SAMPLES` preserves current
observations and historical generator metadata but changes active semantics to
the finite sample World. Train and test generators live under the same shared
relation/noise/randomness policy, with separate input shapes and sample counts
for controlled distribution-shift experiments.

Comparison keeps `world` as one Phase 2 top-level factor. Its nested
`details.worldGenerator` identifies changed or held-constant primitives such
as input distribution, test input distribution, relation, noise, sample count,
outliers, and seed policy without turning each parameter into a separate
clarity factor. The Data Lab World Builder exposes the same distinction with
Generated World / Sample World / Modified after generation badges, while the
existing direct drawing, move, erase, precise edit, membership, and World
Undo/Redo tools remain available.

The normalized generator schema is canonical and split-oriented:

```js
{
  version,
  relation: { type: 'linear', slope, bias },
  noise: { type: 'gaussian-additive', amount },
  train: { input: { type, params }, samples },
  test: { input: { type, params }, samples },
  outliers: { type: 'count', count },
}
```

Legacy top-level `input` and `sampling.samples` fields are accepted only as
normalization aliases. They are not returned as independent mutable values.
The generator state separates the desired specification from the realization
currently shown on screen:

```js
generator: {
  active,
  status: 'clean' | 'dirty' | 'modified',
  spec,       // desired next realization
  seed,       // desired/current World seed
  realization: { spec, seed } | null,
}
```

`REGENERATE_WORLD` is the only operation that updates `realization` and makes
the generated World clean. Parameter or seed edits preserve the observations
and old realization while marking the generator dirty. Manual point edits
preserve each point's generation metadata and mark the point `manual`; this
represents “generated, then manually changed” without erasing provenance.
`FREEZE_AS_SAMPLES` keeps the observations and historical realization for
inspection but disables generator authority and returns `world.mode` to
`sample`. Configuring a Sample World creates a generator draft; it never
claims that existing samples were produced by that draft.

The World seed is the single authority for an active realization. Runtime
session seed, `world.randomness.seed`, `experiment.randomness.seed`, desired
generator seed, and (after regeneration) realization seed agree. A dirty seed
edit intentionally keeps the old realization seed until regeneration. The
same generator operations are exposed through `inspectContext()` and used by
the World Builder UI and Agent, including separate train/test distribution
parameters. Comparison keeps World as one Phase 2 factor while exposing
nested train input, test input, relation, noise, counts, outliers, and seed
details; shared A/B bounds remain a union frame rather than per-World auto-fit.
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
- Runtime contract closure: initial session controls are validated against the Playground descriptor at the session boundary (no bypass through `open({ controls })`), so every live session's controls conform to `controlSchemas`. The strict dry run validates decision-region resolution on every materialized snapshot with exact zero/negative/fractional handling (no truthiness fallback); the LR `learningRate` descriptor max was raised to 5 so the high-learning-rate teaching scenario is contract-conforming.
- Dynamic script baseline: `SCRIPT_LOAD` captures `scriptBaseline` (controls, model state, data, source, seed **and traces**); `SCRIPT_RESET`/`SCRIPT_SEEK`/replay return to it, while the regular `RESET` returns to the open-time `sessionBaseline`. Error codes: `SCRIPT_BINDING_UNRESOLVED`, `SCRIPT_PRIMITIVE_CONTRACT_VIOLATION`, `SCRIPT_TRACE_PAYLOAD_INVALID`.
- Descriptor `scenarios` are now `{ id, titleKey, presetId }` references; `runScenario()` and UI preset playback both execute the preset through the Script Runtime (same actions, same traces).
- Script state (`scriptState: { status, step, totalSteps }`) is separate from the model timeline, so a 7-step script is never conflated with 20 training steps.
- `RESET`/script `reset`/`seek`/replay all return to the session **baseline** (initial controls + source + seed), so `fresh first-N == full-run-then-seek-N == reset-then-N`.

## TeachingPlan and deterministic composer (PR E.1 / E.1.1 / E.1.2)

PR E.1 introduces the intermediate **TeachingPlan** layer between a teaching
goal and a Visualization Script:

```text
goal
-> inspectContext
-> Teaching Planner
-> TeachingPlan
-> Composer
-> Visualization Script
-> validateScript
-> dryRunScript
-> load
```

- `src/core/playground/agent/teachingPlan.js` defines the JSON-safe
  TeachingPlan v1 schema: `{ version: 1, id, playgroundId, goal, phases }`.
  A plan describes teaching intent (`explain-process` / `compare-control` /
  `what-if`), never renderer implementation. Since PR E.1.1 phases are
  **typed and semantically meaningful**:

  ```js
  { id, kind: 'observe' | 'set-control' | 'run' | 'reveal' | 'capture' | 'restore' | 'summarize', ... }
  ```

  The invariant is: **changing `TeachingPlan.phases` changes the composed
  script**. `diagnose` is deliberately not advertised: it is rejected with
  `TEACHING_GOAL_UNSUPPORTED` until its semantics are implemented.
- `src/core/playground/agent/teachingGoalParser.js` is the lexical layer
  (PR E.1.1): `text -> parseTeachingGoalText -> structured goal candidate`.
  It recognizes explicit `key=value` syntax (two values for one control, or a
  compare hint, imply compare-control; one value implies what-if) and
  learning-rate aliases. It never decides model execution behavior; every
  candidate is checked against `controlSchemas` by the planner, so an
  explicit request for an unavailable control (e.g. `k=1 和 k=15` on LR)
  fails with `TEACHING_CONTROL_INVALID` instead of silently becoming an
  explain-process.
- `src/core/playground/agent/teachingPlanner.js` is the schema-grounded
  planner (PR E.1.1). It consumes `inspectContext()`: control existence and
  values come from `controlSchemas` (min/max/options), run objectives come
  from the declarative `runObjective` on the control schema, operations come
  from `context.model.operations` by their declarative `intent`, and reveal
  counts come from the operation's `playback.revealCountControl`. Pairwise
  comparison is the v1 cardinality: exactly two values, no silent defaults
  (previously the planner invented `15`). Since PR E.1.2 the Planner is
  genuinely `inspectContext()`-only: it no longer imports the internal
  primitive registry and derives placement/bindings from `context.primitives`
  directly, so it runs from a serialized context. A declared `runObjective`
  is a real contract: if no operation with the matching `intent` exists, the
  plan fails with `TEACHING_PLAN_INVALID` (reason `unresolvable run
  objective`) instead of silently weakening the plan. Comparison capture IDs
  are internal (`baseline` / `left` / `right`), never derived from user
  values, so string/select values can never collide with the baseline.
- `src/core/playground/agent/teachingComposer.js` is the Composer
  (PR E.1.1): it **iterates/compiles `plan.phases`**; it never regenerates
  the sequence from `plan.goal.type`. Primitive selection is generic: a
  primitive is materializable when every required prop has a compatible
  binding, placement comes from the declarative `placement` metadata
  (`stage` / `side`) in `visualization/schemas.js`, and visibility conditions
  come from the declarative `whenControl` metadata. Run operations are looked
  up by `intent` (`predict` / `fit`) - never by names like `traceFit` or
  `tracePredict` - and reveal steps come from `reveal` phases whose counts
  the planner resolved from `playback.revealCountControl`. There are no
  KNN/LR-shaped primitive families and no hardcoded control names in the
  Composer.
- `validatePlanAgainstContext(plan, context)` (PR E.1.1) rejects a plan
  before composition when its `playgroundId` does not match the context, or
  when any referenced control / evidence field / run objective no longer
  exists. A plan created for KNN can never be silently reinterpreted in an LR
  context. PR E.1.2 extends it to the untrusted-input boundary: every
  `set-control` phase value is revalidated against the current
  `controlSchemas` with the single shared Teaching-level validator
  (`validateTeachingControlValue`), which never silently coerces values:
  numeric controls require an actual finite number within `[min, max]`,
  boolean controls require an actual boolean, and select controls must be a
  declared option. Select controls without declared options (e.g. KNN
  `xFeature`/`yFeature`) are rejected as not safely plannable until dynamic
  option metadata exists. `composeScript(plan)` always revalidates because
  externally supplied plans are untrusted.
- Pre-expansion resource guard (PR E.1.2):
  `estimateCompiledStepCost(plan)` computes the compiled Visualization
  Script step cost without materializing steps (`observe`/`set-control`/
  `run`/`capture`/`restore`/`summarize` = 1, `reveal` = `phase.count`).
  `validatePlanAgainstContext` rejects a plan whose raw phase count or
  estimated compiled steps exceed `context.resourceLimits.maxSteps` with
  `TEACHING_PLAN_INVALID` (reason `resource limit`) **before**
  `compilePhases()` runs, so an untrusted plan can never allocate an
  arbitrarily large script.
- Visibility semantics (PR E.1.2): `reference-line.whenControl =
  'showBestFit'` and `residual-lines.whenControl = 'showResiduals'` were
  added to the primitive schema (alongside `decision-region.whenControl =
  'showDecisionRegions'`), matching the existing preset conditional
  semantics. The Composer only uses the declarative `whenControl` metadata,
  and the real Primitive Materializer honors the `when` bindings for composed
  scripts.
- `plan()` validation (PR E.1.2): the deterministic Planner runs the same
  context/resource validation as the Composer before returning, so
  `plan()` succeeds only when the plan is structurally valid, all control
  values are valid, all objectives resolve, and the plan fits the step
  budget. `composeScript()` still revalidates because its input is
  untrusted.
- Capture semantics (PR E.1): `capture` / `restoreCapture` are first-class
  script step operations. A capture stores a JSON-safe snapshot of controls,
  model state, data state, timeline, a trace checkpoint and the derived
  semantic snapshot (scene/metrics/observation/formula); restore returns to
  it, including the timeline and trace history, so branch B begins from the
  same experiment baseline as branch A except for the intentionally changed
  controls. Comparison plans (e.g. k=1 vs k=15) capture a baseline, run the
  first configuration to **completed evidence** (e.g. KNN reveal count = k,
  so each capture carries real voting/prediction rather than `revealed=0`),
  capture the result, restore the baseline, run the second configuration and
  capture that result. Capture/restore never corrupts `sessionBaseline`,
  `scriptBaseline` or `scriptState`, and replay is deterministic for the same
  seed. `SCRIPT_CAPTURE_MISSING` is a stable script error code.
- The Agent exposes `plan(goal)` and `composeScript(plan)` on
  `canvas.playground` (additive; `apiVersion` stays 1). `composeScript`
  validates and strict-dry-runs the composed script before returning it; the
  caller loads it with the existing `loadScript()`.

The primary acceptance path is:

```text
"Compare k=1 and k=15 and explain what changes."
-> inspectContext -> TeachingPlan(compare-control, values [1, 15])
-> compose script -> capture baseline -> run k=1 -> capture left
-> restore baseline -> run k=15 -> capture right
-> validateScript -> strict dry run -> deterministic replay
```

## Goal taxonomy and goal fidelity (PR E.2 / E.2.1)

PR E.2 moves the intelligence layer from "the generated script is valid" to
"the generated script actually satisfies the user's teaching goal":

```text
User Goal
-> normalized Teaching Goal
-> Teaching Planner
-> TeachingPlan
-> Composer
-> Visualization Script
-> Goal Fidelity Evaluation
-> validator
-> strict dry run
-> execute
```

- `src/core/playground/agent/teachingTaxonomy.js` defines the bounded
  pedagogical objective vocabulary: `introduce`, `compare`,
  `explain_prediction`, `show_training`, `show_error`, `show_parameter_effect`,
  `show_generalization`, `show_feature_effect`, `show_failure_case`. Since PR
  E.2.1 the taxonomy owns only the vocabulary: support is derived from the
  model's **declared teaching capability contract** (model adapters expose
  `teachingCapabilities` through `inspectContext()`), so the taxonomy never
  hardcodes KNN/LR field names. Structural objectives (compare /
  show_parameter_effect) need a plannable control; introduce is always
  available; `fit + training field` alone never implies show_failure_case and
  `predict intent` alone never implies explainable predictions - there must
  be an actual declared evidence contract (including the failure signal).
- Normalized goals carry a semantic `objective` alongside the E.1 mechanical
  goal family: `{ type: 'compare-control', objective: 'compare', control,
  values }`, `{ type: 'explain-process', objective: 'explain_prediction' }`,
  etc. The Composer never depends on natural-language wording. Unsupported
  objectives (e.g. `show_generalization` anywhere, `explain_prediction` on
  LR, `show_failure_case` on KNN) reject with `TEACHING_GOAL_UNSUPPORTED`
  instead of silently degrading to a generic explanation.
- `src/core/playground/agent/teachingFidelity.js` implements the Goal
  Requirement / Fidelity Contract: a normalized goal becomes explicit
  machine-readable requirements (required control assignments, operation
  intents with minimum counts, reveal playback counts, capture ids, and three
  explicit evidence classes since PR E.2.1):
  - `visualEvidence` - the Script declaration actually binds this semantic
    path through a concrete `primitive.props` binding (e.g.
    `$model.training.lossHistory`). A primitive that could theoretically bind
    it via `compatibleBindings` is insufficient.
  - `runtimeEvidence` - the replayed semantic state actually contains the
    result (e.g. `metrics.predictedLabel`, `training.parameterHistory`),
    checked on required captures or the final snapshot.
  - `traceEvidence` - the required semantic event actually occurred, with
    optional payload predicates: `{ trace: 'training.completed', where:
    { stoppedReason: ['learning-rate-too-high'] } }`. Runtime fidelity for
    `show_failure_case` fails when `training.completed` exists but
    `stoppedReason` is absent or reports ordinary success - "training
    happened" is not "failure happened".
  `evaluateGoalFidelity({ plan, script, context, execution })` returns
  `{ valid, checks, missing }`. Requirement evidence for
  explain_prediction/show_training/show_failure_case comes from the model's
  declared `teachingCapabilities`; compare/show_parameter_effect use generic
  structural rules.
- `composeScript(plan)` now runs validate TeachingPlan -> compose -> validate
  Script -> strict dry run -> goal fidelity, and returns
  `{ mode: 'composed', plan, script, fidelity, dryRun }`. If fidelity fails,
  it throws `TEACHING_GOAL_FIDELITY_FAILED` with the structured missing
  requirements. `mode: 'composed'` distinguishes the real Composer path from
  preset fallback/generation paths.
- Acceptance cases: compare k=1 vs k=15 proves set k=1, set k=15, predict
  branch A/B, completed left/right captures (mutation negatives fail while
  staying syntactically valid); learning rate too high derives a value above
  the baseline inside `controlSchemas` and proves fit invocation, training
  playback, loss evidence and parameter-movement evidence (a residuals-only
  script fails); explain KNN prediction normalizes to `explain_prediction`
  and proves query, neighbor ranking, reveal, voting and predicted-label
  evidence through the context-advertised predict operation and semantic
  fields.
- PR E.2.1 makes the fidelity outcome-truthful: the lexical parser emits a
  semantic probe (`direction: 'increase'`) for qualitative "learning rate too
  high" requests - never a numeric constant - and the Planner derives the
  probe from current controls + controlSchemas (baseline 0.05 -> >0.05, 1.5
  -> >1.5, 3 -> >3, 5 -> reject when no higher legal value exists).
  Parameter movement is verified through real runtime/trace evidence
  (`training.parameterHistory` / `gradient.computed`), not by pretending
  `loss-curve` visualizes parameter history. Mutation tests cover a
  successfully-completed training run with no stoppedReason (fails), a
  schema-compatible binding change away from the required visual path
  (fails), and runtime-only evidence surviving the removal of non-visual
  primitives (passes).
- PR E closure aligns the failure capability with runtime evidence:
  `show_failure_case` currently targets the **learning-rate-too-high**
  stopped regime only, because that regime provides inspectable loss and
  gradient evidence (loss.measured + gradient.computed +
  training.parameterHistory). The raw early non-finite `diverged` stop reason
  remains valid runtime behavior but is not advertised by the current
  capability until a future visualization/fidelity contract can explain that
  path truthfully; a `diverged` execution therefore fails
  `show_failure_case` fidelity (documented by an explicit negative fixture).

## Toolkit expansion + MLP playground (PR F.1)

PR F.1 adds the first general-neural-visualization primitives and an MLP
playground as the decisive test that the unified architecture holds without
model branches.

- Four model-independent primitives joined the toolkit
  (`src/core/playground/visualization/primitives.js` + `schemas.js` +
  `typeContracts.js`):
  - `parameter-trajectory` (stage): draws `{step, value}` points; binds
    `$model.training.parameterTrajectory` (LR and MLP scenes expose the
    derived field).
  - `network-graph` (stage): layered graph of `{id, layer, label?, value?}`
    nodes and `{source, target, weight?}` edges; binds
    `$model.network.nodes` / `$model.network.edges`.
  - `matrix-grid` (stage): weight matrix of `{row, column, value, label?}`
    cells; binds `$model.matrix.rows/columns/cells`.
  - `histogram` (side): bins of `{start, end, count}`; binds
    `$model.histogram.bins`.
  Every primitive is typed (deep contract validation), placement-declared,
  SSR-smoke-tested and degrades gracefully with empty props.
- `src/core/playground/model/mlpMath.js` is the pure deterministic MLP
  mathematics: seeded XOR data generation, seeded parameter initialization
  (weights in [-1, 1] so full-batch gradients stay learnable), tanh hidden
  layer with sigmoid output and binary cross-entropy, full-batch
  backpropagation, and the same honest failure semantics as LR
  (`learning-rate-too-high` / `diverged`).
- `src/core/playground/model/mlpAdapter.js` registers the `mlp` adapter:
  semantic schema (`scatterPoints`, `axes`, `decisionRegions`, `training`
  with `lossHistory`/`parameterHistory`/`parameterTrajectory`, `network`,
  `matrix`, `histogram`, `metrics`, `observation`), script operations
  `traceFit` (intent `fit`, reveal count = trainingSteps) and `tracePredict`
  (intent `predict`, hidden-unit reveal count = hiddenUnits), trace events
  with payload schemas, and declarative teaching capabilities
  (`show_training` + `explain_prediction`). `show_failure_case` is honestly
  unsupported on MLP and rejected with `TEACHING_GOAL_UNSUPPORTED`.
- The adapter validates and applies canonical two-dimensional binary
  classification Worlds. Applying a World rebuilds explicit train/test
  samples, train-fitted normalization, label mapping and seeded initial
  parameters, then clears old training and prediction playback. Invalid
  Worlds fail before live Experiment or model state changes.
- `mlp-classification` playground: deterministic XOR source, controls
  (`hiddenUnits`, `learningRate`, `trainingSteps`, `queryX`, `queryY`,
  `showDecisionRegions`) and the `mlp.intro` preset. The preset trains,
  reveals loss/parameter trajectory epochs, then reveals hidden activations
  for a prediction.
- The unified layers stay model-agnostic: `playgroundRuntime.js`,
  `primitiveMaterializer.js`, `teachingComposer.js`, `teachingFidelity.js`,
  `PlaygroundStage.jsx` and `rendererRegistry.jsx` contain no `mlp` branch
  (source-level contract test). The generic goal -> plan -> compose ->
  fidelity pipeline serves MLP `explain_prediction`, `show_training`,
  `compare hiddenUnits` and `what-if learningRate` unchanged.
- The MLP learns XOR to 100% accuracy deterministically (same seed +
  controls -> identical replay); the render smoke replays the MLP preset
  (20 snapshots) and SSR-renders all four new primitives.

## MLP playback consistency (PR F.1.1)

PR F.1.1 makes every MLP replay step semantically time-consistent. At any
playback step the timeline, active parameters, loss/metrics, network graph,
matrix, histogram, decision region and prediction behavior all describe the
same neural-network parameter state; the UI never combines evidence from
different training epochs.

- `trainMlp()` history entries now carry a JSON-safe detached snapshot of the
  full `params` each state adopts. Normal completion keeps
  `history[last].params === result.params`; the finite loss-increasing update
  of the `learning-rate-too-high` policy is recorded **and adopted** as the
  final visible parameters (consistent with the LR teaching behavior), so
  `parameters.updated` always describes a state the model actually adopts;
  the non-finite `diverged` path retains the last finite parameters.
- Training playback is real: `START_TRAINING` keeps the active model at the
  baseline parameters at timeline step 0, and every `STEP`/`SEEK` updates
  `modelState.params`, `training.currentStep` and `timeline.step` from the
  same trajectory. Seeking to zero restores the baseline. Decision regions
  are refreshed from the active parameters whenever they change, so a stale
  initial grid can never sit next to a trained network.
- Prediction explanation never leaks the final output: input nodes are
  visible immediately, hidden nodes only as they are revealed, and the output
  node stays `null` (with `metrics.predictedLabel` hidden) until the final
  hidden activation is revealed. The teaching sequence is genuinely
  input -> hidden activations -> output.
- `prediction.emitted` is model-neutral: its payload schema gained an
  optional `hiddenUnits`; KNN emits `{ label, k }` and MLP emits
  `{ label, hiddenUnits }` - no adapter branch in trace validation.
- The MLP source contract matches F.1 capability: `validateSource` requires
  the deterministic two-dimensional `x1`/`x2` example representation and
  rejects incompatible feature names with `INVALID_PLAYGROUND_SOURCE`
  (generic workspace-dataset feature mapping is later dataset work).
- `mlp.intro` is internally consistent: it configures `trainingSteps = 12`
  before training and reveals exactly those 12 epochs before prediction.

## Agent playground UI + script tooling (PR F.2)

PR F.2 exposes the Agent-Customizable Playground architecture to users. The
user-facing loop is complete:

```text
User teaching request
-> Agent plan
-> TeachingPlan
-> Composer
-> Visualization Script
-> preview / inspect
-> run
-> revise
-> export / import
```

- **Agent panel** (`src/components/playground/PlaygroundAgentPanel.jsx`):
  "Ask Agent" input -> `agent.plan(goal)` -> `agent.composeScript(plan)` ->
  preview. Nothing runs unseen: the generated TeachingPlan / Script enters a
  preview state first with tabs **Overview / Teaching Plan / Visualization
  Script / Fidelity** (raw JSON read-only; no executable content), and only
  the explicit **Run** button loads and plays it through the existing Script
  Runtime. The preview shows goal, objective, phases, controls changed,
  operations, captures, primitives, step count and fidelity evidence
  (grouped: controls / operations / visual / runtime / trace, each
  checked).
- **Script tooling**: **Copy JSON** (exact declaration), **Download JSON**
  (`volk-ml-playground-script.json`), **Load JSON** (file input goes through
  `validateScript` -> model/playground compatibility -> strict dry run before
  it can replace the active script; failures surface the stable `SCRIPT_*`
  code plus a message).
- **Script provenance**: the host tracks where the active script came from -
  `preset` / `generated` / `composed` / `revised` / `imported` - and exposes
  it on every host-derived snapshot (`snapshot.provenance`). The toolbar UI
  visibly distinguishes Preset / Composed by Agent / Imported Script, and
  `mode: 'composed'` (plus goal-fidelity status) is preserved for Agent
  compositions.
- **`reviseScript`** (`src/core/playground/agent/scriptRevision.js`, exposed
  as `agent.reviseScript({ plan, script, request })`): a bounded, typed
  revision vocabulary - `shorten {maxSteps}`, `remove_visual
  {primitiveTypes}`, `keep_visuals {primitiveTypes}`, `focus_result`,
  `change_comparison_values {control, values}`. Every revision goes through
  validate -> strict dry run -> goal fidelity; a revision that would destroy
  the requested teaching goal is rejected with
  `TEACHING_GOAL_FIDELITY_FAILED` (never a silently misleading script).
  There is no free-form natural-language mutation.
- **Playground picker**: the header offers a registry-driven selector
  (`listPlaygrounds()`), so KNN / Linear Regression / MLP all open from the
  normal Playground UI without hardcoded per-model pages; a newly registered
  playground is discoverable through registry metadata.
- **`mlp.intro` is self-contained**: it configures `hiddenUnits = 3` (and
  `trainingSteps = 12`) before training, so changing controls before
  `RUN_SCENARIO` cannot make the intro incomplete (regression-tested).
- Workspace-dataset integration for MLP is intentionally deferred to F.3:
  F.2 keeps the clean F.1 adapter architecture rather than bolting on a new
  abstraction.

### Preview / active state machine (PR F.2.1)

The Agent panel now exposes the bounded revision vocabulary in the UI
(`shorten` with a max-steps input, `focus_result`, `keep_visuals` /
`remove_visual` over the primitive types present in the preview, and
`change_comparison_values` for compare-control plans only - all driven by
`preview.script.primitives` / `preview.plan.goal`, never a hardcoded list).
A revision replaces the **preview** only; the runtime is untouched until the
user explicitly presses Run (provenance `revised`). Failed revisions surface
the error separately and keep the previous valid preview intact.

The panel keeps two explicit badges: **Preview** (composed / revised /
imported) and **Active** (`snapshot.provenance`), so the UI always
distinguishes what is being inspected from what is loaded in the runtime.
Import means validate -> strict dry run -> **preview the imported
declaration**; the user still presses Run to load it, so the preview and the
runtime can never disagree. Imported previews have no TeachingPlan and show
"Goal fidelity: not available" (structural validation + strict dry run +
model compatibility decide run eligibility), while composed/revised teaching
scripts additionally require goal fidelity. The state machine lives in the
pure helpers `src/components/playground/agentPreviewState.js`
(`previewProvenance` / `previewRunnable` / `previewFidelityStatus` /
`compositionPreview` / `revisionPreview` / `importedPreview` /
`revisionErrorPreview`) and is contract-tested in check-core.

### MLP workspace dataset integration (PR F.3)

PR F.3 wires MLP to compatible workspace datasets through the existing
Dataset Adapter / source contract, without hardcoding column names:

- The MLP adapter is feature-name agnostic: samples are full feature vectors
  in `featureColumns` order (`inputSize = featureColumns.length`), and binary
  labels get a deterministic sorted mapping (e.g. `['setosa',
  'versicolor']` -> 0/1) stored in the model state. No `x1`/`x2` or label
  literal remains in `mlpAdapter.js` (source-level assertion).
- Compatible workspace datasets (binary classification, at least two numeric
  features) flow through `resolveSource` and the shared dataset layer:
  stratified train/test split, training-set z-score normalization, explicit
  `xFeature`/`yFeature` selection (dynamic options from
  `scene.featureOptions`), and a 2D projection that fixes hidden features at
  the normalized mean (0) - mirroring KNN. Incompatible multi-class datasets
  reject with `INVALID_PLAYGROUND_SOURCE`; regression/non-numeric datasets
  fall back to the deterministic XOR example.
- `computeMlpDecisionRegions` is generic over feature columns and
  normalization; its defaults keep the XOR example byte-compatible, and the
  workspace view computes cells in normalized space.
- The XOR example path is unchanged: all-data training (no split), identity
  normalization (view == raw features), `x1`/`x2` axes - every F.1/F.1.1 test
  stays green. The scene additionally exposes `featureOptions`,
  `projection` and `ranges` for the 2D view and query sliders.

### Workspace label and feature semantics (PR F.3.1)

PR F.3.1 closes workspace-data semantic correctness:

- The external prediction label space is always the dataset's original binary
  labels: `predictMlp(params, x, labels = ['a', 'b'])` returns a
  `classIndex` plus the decoded `label` (default keeps XOR `a`/`b`), and the
  adapter passes `modelState.labelMapping.labels` everywhere - training/test
  accuracy, `metrics.predictedLabel`, `prediction.emitted`, prediction
  observations and decision-region cells. There is exactly one binary
  decision (`probability < 0.5 -> class 0`) and one label mapping.
- `computeMlpDecisionRegions` accepts the same optional `labels` contract;
  its default remains XOR `a`/`b`.
- Workspace inputs resolve through the existing Dataset Adapter semantics:
  declared `featureColumns` are authoritative (`featureColumns` intersect
  valid numeric columns, the target column is excluded - unrelated numeric
  columns like id/timestamp never enter the model), and classification
  targets are normalized to stable semantic strings before the binary
  mapping (`0` -> `"0"`, `true` -> `"true"`). Numeric binary targets no
  longer fall back to the XOR example. More than two distinct classes still
  reject with `INVALID_PLAYGROUND_SOURCE`.

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

`src/components/playground/` contains the toolbar (Model / Dataset / Preset / Agent), the unified stage, inspector, timeline and primitive renderers. The stage only knows `primitives[]` — it resolves each primitive through `rendererRegistry.jsx` and never imports model math. Playback is driven by the shared host scheduler: with a loaded preset the timeline drives `SCRIPT_*` actions, otherwise it drives model `STEP` actions; the UI does not special-case a model (a static test forbids model names and `START_TRAINING`/`START_NEIGHBOR_REVEAL` in the UI directory). Runtime scheduler tests cover action translation and finite progress; browser integration acceptance separately covers React timers, subscribers, rerenders and rejected dispatch handling.

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

`src/core/playgrounds/session.js` exposes `createPlaygroundSession` / `dispatchPlaygroundAction` / `derivePlaygroundSnapshot`, delegating to the unified runtime. Actions are plain JSON objects; `RESET` rebuilds from the captured source snapshot; dispatch never mutates its input session. Phase 0 additionally exposes a detached semantic `world`/`experiment` snapshot in the runtime and Agent inspection context. These snapshots are still temporary UI/agent state (never written to project JSON, never change `PROJECT_VERSION`); see `docs/architecture/exploration-semantics.md` for the World/Experiment contract.

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

### Presentation Mode (Phase G.1)

Presentation Mode is a local UI view over the same playground snapshot and Script Runtime. It hides authoring/debug surfaces, preserves the canonical `640×360` stage aspect ratio, and exposes only Restart, Play/Pause and Exit Presentation controls plus the optional script-declared annotation/formula content. The stage uses the measured presentation content area and is fitted as the largest 16:9 rectangle that satisfies available width, available height after teaching content, and the `1280px` maximum width; the SVG itself is never stretched or cropped. Entering or exiting the mode never dispatches a runtime action and never persists state into the Visualization Script. Keyboard handling is scoped to the focused presentation root: Space toggles playback, `R` restarts, and Escape exits; editable controls are not intercepted.

### Generic Motion System (Phase G.2)

The Stage owns a model-independent visual motion layer. It keeps the previous and current already-valid primitive snapshots, interpolates visual props between them, and passes the current frame to the existing primitive renderer registry. Runtime state changes immediately and remains authoritative; motion never dispatches actions or creates semantic intermediate model states. Motion durations come from one centralized policy and are clamped to the active script step duration after playback speed, with `prefers-reduced-motion` producing an immediate visual settle. Stable semantic identities (`id`, `pointId`, `step`, matrix coordinates, and edge endpoints) control array matching so enter/exit fades and numeric interpolation do not depend on array order.


### Presentation Motion Coverage (Phase G.2.1)

Presentation Mode creates one motion frame from the semantic primitive snapshot, then routes its `stage` and `teaching` slots to the Stage and annotation/formula surfaces. The same duration, easing policy, and reduced-motion behavior apply to both surfaces; final frames return exact semantic props. The motion layer remains generic and does not alter Script Runtime semantics, model adapters, or the Visualization Script schema.

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

### Concept Graph & Causal Exploration Map

`src/core/ui/conceptGraph.js` derives a bounded Concept Map from the existing
Inquiry concept registry, Journey path, connected Evidence, active concept,
and session-only illumination state. Registry `prerequisites` and
`relatedConceptIds` are the only relationship sources currently projected;
the graph vocabulary may represent `caused_by` or `observed_with` for an
explicit future semantic source, but this projection never creates either
relationship automatically. In particular, a visual edge is not a causal
claim.

`ConceptMap` is a presentation surface. Selecting a Journey concept or
frontier node only changes local UI focus and reveals the existing path,
connected Evidence, neighboring concepts, and any current experiment marker.
LUMI marks the current concept and frontier without choosing the learner's
next step. Concept state remains `unexplored`, `active`, or explicitly
`illuminated`; no mastery, knowledge database, Agent plan, runtime action,
project field, or persistence contract is added.

### Phase 11 learner hypothesis surface

The Explore details region also contains a session-only `HypothesisPanel`.
When the existing LUMI attention projection has both an Evidence target and a
Concept target, the panel offers a composer; the learner must write and submit
the statement before a Hypothesis exists. The panel then shows its status,
linked Concepts, and only explicitly attached existing Evidence. Start testing,
attach Evidence, and mark supported/rejected are local learner actions and do
not execute an Experiment. The existing Experiment controls remain the only
runtime execution path.

`ConceptMap` receives the same bounded Hypothesis projection and renders
Hypothesis nodes plus neutral Concept/Evidence links. Selecting one changes
presentation focus only. Hypothesis colors do not override the LUMI contract:
purple is possibility, cyan is observed Evidence, orange is active testing,
and green remains exclusive to an explicitly illuminated Concept. No numerical
confidence or causal arrow is shown, and the state is reset when the unified
Playground session resets or closes.

### Concept Graph truth-boundary hardening

Concept Map edge presentation follows the relation metadata exported by
`src/core/ui/conceptGraph.js`: prerequisite edges retain an arrow, while
related and observed-with edges use a symmetric connector. Internal ordering
is retained only for deterministic identity and deduplication.

The local Concept Map selection is focus only. `deriveConceptGraph()` first
derives membership from semantic inputs and only then accepts a requested
selection if its ID is already present. Stale selections therefore clear
without creating ghost nodes, neighbors, or Evidence focus.

## LUMI semantic presentation layer

`src/core/ui/lumiSemantics.js` and `src/components/playground/Lumi.jsx` provide
the controlled presentation vocabulary for the learner-facing guide. LUMI has
bounded presence levels (`hidden`, `ambient`, `contextual`, `event`) and modes
(`idle`, `observe`, `guide`, `intervene`, `illuminate`, `explore`). It consumes the normal
Playground snapshot and never owns World, Experiment, evidence, or Agent state.

The visual mascot assets live under `src/assets/lumi/` and are selected only by
the normalized semantic mode. The four vector assets keep LUMI's deep Navy body,
Cyan eyes/wings, warm core, orbit/node motif, and translucent wings recognizable
without introducing a new visual dependency. `idle` uses slow ambient float;
`observe` adds a small Cyan focus orientation; `guide` remains contextual;
`intervene` emits one bounded Orange pulse when a meaningful World/model
intervention is committed; and `illuminate` uses the existing explicit
`active` → `illuminated` transition to play a one-shot contact/confirmation
sequence. These effects are CSS-only and have a reduced-motion equivalent.

Semantic colors are centralized in `src/index.css`: Navy is structure, Cyan is
observation and focus, Orange is intervention, Purple is an unexplored concept,
and Green is an illuminated concept. The tokens are applied only at touched
surfaces; the existing canvas stage palette remains authoritative for canvas
glyphs.

Concept state is a session presentation projection with three explicit states:
`unexplored`, `active`, and `illuminated`. Inquiry candidates and grounded
concept signals can make a concept active, but neither model accuracy nor an
animation can infer illumination. The current UI offers an explicit learner
confirmation for the transition to `illuminated`; it is not persisted in the
World, Experiment fingerprint, project JSON, or a second runtime store.

The LUMI guidance surface reuses Observation Detector notices, Learner Inquiry
candidates, and existing guided exploration recipes. It separates “What I
noticed”, “Why it may matter”, and “Try next”; it does not fabricate evidence,
turn hypotheses into facts, or authorize actions. Large Concept Map rendering
and automatic mastery detection remain future work.

### LUMI exploration interaction

`src/core/ui/lumiInteraction.js` projects bounded `LumiTarget` values for
existing `evidence`, `concept`, and `experiment` objects. The
`LumiAttentionRail` consumes the current snapshot and transient control-change
metadata to show cyan evidence attention, an evidence-to-concept connection,
orange intervention focus, or a purple exploratory frontier. It is a
presentation projection: it does not dispatch runtime actions, create
evidence, execute an experiment, infer mastery, or change Agent authority.
The Distribution Shift showcase makes the intended Observe → Intervene →
Understand sequence visible while the existing explicit learner action remains
the only path to illumination.

### LUMI exploration journey timeline

`src/core/ui/lumiJourney.js` projects the session-local journey from the
existing semantic event log. Human `experiment.factor-changed` and
`world.intervened` records become intervention nodes; deterministic
`observation.detected` records become evidence nodes; existing inquiry support
links become Evidence → Concept connections. Explicit illumination is the only
presentation marker kept locally for the session, and `clearJourney()` removes
that marker without touching runtime state.

`LumiJourneyTimeline` is a learner-facing projection, not an event bus, memory
store, explanation engine, or Agent surface. LUMI marks the current node, past
nodes remain visually quiet, and unconnected existing concepts appear as a
purple frontier without being recommended. No journey field enters World,
Experiment, Evidence, Undo/Redo, project JSON, or cross-session persistence.

### Concept Graph & Causal Exploration Map

`src/core/ui/conceptGraph.js` derives a bounded Concept Map from the existing
Inquiry concept registry, Journey path, connected Evidence, active concept,
and session-only illumination state. Registry `prerequisites` and
`relatedConceptIds` are the only relationship sources currently projected;
the graph vocabulary may represent `caused_by` or `observed_with` for an
explicit future semantic source, but this projection never creates either
relationship automatically. In particular, a visual edge is not a causal
claim.

`ConceptMap` is a presentation surface. Selecting a Journey concept or
frontier node only changes local UI focus and reveals the existing path,
connected Evidence, neighboring concepts, and any current experiment marker.
LUMI marks the current concept and frontier without choosing the learner's
next step. Concept state remains `unexplored`, `active`, or explicitly
`illuminated`; no mastery, knowledge database, Agent plan, runtime action,
project field, or persistence contract is added.

## Phase 4 guided exploration contracts

`src/core/exploration/observables.js` is the shared semantic boundary for
learner UI, deterministic observation detection, and `host.inspectContext()`.
It exposes JSON-safe raw observables and derived observables with explicit
availability; unavailable evidence is `available: false` and never coerced to
zero. The initial registry covers World train/test counts and x-ranges,
generator noise, generated outliers, Linear Regression slope/bias, train/test
MSE, learning step, comparison clarity, generalization gap, factual coverage
mismatch, slope/error ratios, and repeat spreads.

`src/core/exploration/observationDetectors.js` consumes only those semantic
observables and comparison/repeat evidence. Its named conservative thresholds
are centralized in `OBSERVATION_THRESHOLDS`. Detector output is structured
(`id`, severity, message key, evidence, related observable ids, and related
experiment ids), deterministic, bounded, and factual. The hard rule is
evidence-not-cause: notices state what changed or what support is covered;
they do not claim that a factor caused model failure.

Repeat is an execution result, not a World mutation. Generated Worlds use
explicit `baseSeed + trialIndex` seeds, generate temporary realizations from
the unchanged desired specification, run the registered model adapter, and
return JSON-safe per-trial and aggregate slope/bias/train-MSE/test-MSE
evidence. The semantic bounds are 2–20 trials, with 5 as the default. Sample
Worlds use a fixed-world deterministic policy rather than injected randomness.
Repeat evidence lives in runtime experiment state and is not written to
project JSON; the active World, Experiment identity, and A/B workspace remain
unchanged.

`guidedExploration.js` registers the curated Things to Try prompts, two open
recipes (train/test support and outlier), and semantic affordance ids. Guided
Explore is ephemeral presentation state: selecting a prompt only highlights
visible affordances and explains an approach; starting a recipe applies its
explicit setup through normal World operations. There is no progress, score,
lock, or forced path. Evidence notices are dismissible, capped, localized,
keyboard-accessible, and progressively disclosed. The same observables,
detectors, repeat evidence, and guidance capabilities are included in Agent
inspection parity. Phase 4 intentionally does not add natural-language Agent
planning or other Phase 5 behavior.

### Experimental browser AI goal interpretation

The Playground Agent keeps its deterministic path authoritative: user language is optionally interpreted by a replaceable provider adapter into a typed `TeachingGoal`, then the existing schema-grounded Planner, TeachingPlan, Composer, validation, strict dry run, and Goal Fidelity pipeline produces the preview. The LLM never generates a Visualization Script or mutates the active runtime. The current browser provider path is for private experimentation only: credentials live only in volatile page memory and are sent directly to the selected provider when a request is made. VOLK-ML does not intentionally persist them to browser storage, project files, exports, URLs, or application logs; production deployment will move credential handling behind a server-side proxy. A single bounded repair call is allowed for invalid typed output, and the local lexical parser remains available.

Agent examples are declarative metadata keyed by the playground descriptor, so KNN, Linear Regression, and MLP expose task-appropriate prompts without model-specific branches in the generic Agent panel.

### Explore learning surface

The ordinary Linear Regression Explore entry starts from a deterministic
generated World using the registered linear generator. The compact Data Lab
surface exposes `Sample again` without opening Full World Tools. It duplicates
the current Experiment, resamples the same generator-backed World, and keeps
the new Dataset in the active branch. The optional comparison therefore
reports `observationProcess` as changed while World, model, learning, and
evaluation conditions remain held; the sample status and question are
presentation state derived from the existing semantic events and comparison.

The default MLP teaching source is a small, deterministic, two-dimensional
XOR World with separated binary labels and no default label corruption. Noise
remains available through the underlying data-generation capability rather
than being silently introduced into the first teaching view. The
Representation depth uses the existing `network-graph` primitive, so its
hidden layer changes with the live `hiddenUnits` control. The Mechanism depth
uses the existing `loss-curve` primitive and real adapter history: before
training it shows an honest empty state, after a training step it shows the
recorded history, and changing a learning condition clears stale history.
Mechanism and Representation are intentionally separate projections; neither
adds a second model state or reasoning authority.

### Human deletion confirmation

Canvas deletion from node/edge buttons and Delete/Backspace requests a centralized pending deletion model before graph state changes. React Flow's default delete key is disabled, editable fields are ignored, and the confirmation modal reports connected-edge consequences with i18n text. Programmatic Canvas Agent `removeNode()` / `disconnect()` operations remain immediate API calls and do not open the human confirmation modal.

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
