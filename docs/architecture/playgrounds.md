# Playgrounds

VOLK-ML Playgrounds are interactive, deterministic concept labs. They serve three consumers with one code path: the human UI, teaching-video demo scripts, and the in-page Canvas Agent.

## Unified visualization runtime

Since the PR B refactor, both models run on one **unified playground runtime** instead of two independent session reducers:

```text
Model / Dataset
        â†“
Semantic state + trace events
        â†“
Visualization Script (JSON preset)
        â†“
Primitive Materializer (binds $model/$data/$controls/$trace/$metrics)
        â†“
JSON primitives[]
        â†“
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
- `playgroundHost` routes `play`/`pause`/`step`/`seek`/`reset` to `SCRIPT_*` actions whenever an active Visualization Script exists, and to the model actions otherwise â€” the UI and the Canvas Agent control exactly the same timeline.
- The validator rejects `show`/`hide`/`highlight` targets that are not declared primitives (`SCRIPT_UNKNOWN_PRIMITIVE_REFERENCE`) and requires exactly one annotation primitive for `annotate` steps (`SCRIPT_ANNOTATION_TARGET_MISSING` / `SCRIPT_ANNOTATION_TARGET_AMBIGUOUS`).
- KNN teaching/fallback `$data` rows include the `label` target column and the schema declares it, so `$data.targetColumn` always exists in `$data.rows`.
- Script contract errors are centralized in `visualization/scriptErrors.js` (`SCRIPT_ERROR_CODES`) and pass through the Canvas Agent with their stable codes instead of `OPERATION_FAILED`.

## Project language policy

`applyProject(rawProject, { languagePolicy })` supports:

- `'project'` (default): Import, autosave Restore and Agent `loadProject` keep the existing behavior â€” a project that carries a saved language preference restores it.
- `'preserve-current'`: bundled Examples ignore the project's `language` field entirely, so loading an example never changes the user's UI preference. The pure decision lives in `src/core/languagePolicy.js` (`resolveLanguagePreference`).

User preference owns language; example content owns the example. No `PROJECT_VERSION` change or migration is part of this policy.

## Agent generated visualization scripts (PR C)

- `src/core/playground/agent/dryRun.js` replays a script on a detached session clone (after structural validation and binding resolution) and returns `{ valid, estimatedSteps, estimatedPrimitiveUpdates, decisionGridCost, warnings }`. The live session is never mutated; any step that throws makes the dry run invalid.
- `src/core/playground/agent/scriptGenerator.js` is a preset-first, rule-based generator: exact preset â†’ parameterized preset (goal keywords map to presets and control parameters) â†’ generated minimal script. No LLM is required; an external generator (future LLM adapter) can be injected at the host and its output still passes the same validator + dry run.
- `playgroundHost` / `canvas.playground` expose `getCapabilities`, `listPresets`, `loadPreset`, `loadScript`, `validateScript`, `getScript`, `exportScript`, `dryRunScript` and `generateScript`. `generateScript` loads the accepted script and falls back to the closest preset (`fallback: true`) if validation or the dry run fails.

## Agent context and semantic contracts (PR D)

- `inspectContext()` (PR D) gives the Agent a stable, machine-readable world model: playground/model/data/controls/traces/primitives/bindings/resourceLimits/currentState, all sourced from schemas.
- Model adapters declare `semanticSchema` (fields must exist in the derived semantic state â€” contract tested), typed `scriptOperations` (`args` + `producesTrace`) with `scriptOperationActions` translators, and every trace event has a `TRACE_PAYLOAD_SCHEMAS` entry.
- `visualization/schemas.js` + `typeContracts.js` are the single source for primitive contracts: deep semantic types (`array<point2d>` validates element shapes), canonical `compatibleBindings` (every `$model.*` path exists in an adapter `semanticSchema` and resolves in the semantic state), shared by `inspectContext`, the strict dry run and tests.
- The dry run is strict: unresolved required bindings â†’ `SCRIPT_BINDING_UNRESOLVED`; every script step is replayed on a detached clone and each snapshot is materialized and validated against the primitive contract (`SCRIPT_PRIMITIVE_CONTRACT_VIOLATION`); decision-grid resolution is enforced from resolved props (`SCRIPT_TOO_COMPLEX` beyond `maxDecisionResolution`); optional unresolved bindings become deduplicated warnings; estimates include `stepCount`/`primitiveCount`/`decisionGridCells`/`pointCount`/`traceEvents`.
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
  explicit request for an unavailable control (e.g. `k=1 å’Œ k=15` on LR)
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
- `plan()` validation (PR E.1.2): the deterministic Planner ruëv¶‰ËkºwµçQ¥½¹…±±ä•áÁ½Í•Ì™•…ÑÕÉ•=ÁÑ¥½¹Í€°4(€ÁÉ½©•Ñ¥½¹€…¹É…¹•Í€™½ÈÑ¡”€ÉÙ¥•Ü…¹ÅÕ•ÉäÍ±¥‘•ÉÌ¸4(4(ŒŒŒ]½É­ÍÁ…”±…‰•°…¹™•…ÑÕÉ”Í•µ…¹Ñ¥Ì€¡AH¸Ì¸Ä¤4(4)AH¸Ì¸Ä±½Í•Ìİ½É­ÍÁ…”µ‘…Ñ„Í•µ…¹Ñ¥Œ½ÉÉ•Ñ¹•ÍÌè4(4(´Q¡”•áÑ•É¹…°ÁÉ•‘¥Ñ¥½¸±…‰•°ÍÁ…”¥Ì…±İ…åÌÑ¡”‘…Ñ…Í•ĞÌ½É¥¥¹…°‰¥¹…Éä4(€±…‰•±ÌèÁÉ•‘¥Ñ5±À¡Á…É…µÌ°à°±…‰•±Ì€ôl„œ°€ˆt¥€É•ÑÕÉ¹Ì„4(€±…ÍÍ%¹‘•á€Á±ÕÌÑ¡”‘•½‘•±…‰•±€€¡‘•™…Õ±Ğ­••ÁÌa=H…€½‰€¤°…¹Ñ¡”4(€…‘…ÁÑ•ÈÁ…ÍÍ•Ìµ½‘•±MÑ…Ñ”¹±…‰•±5…ÁÁ¥¹œ¹±…‰•±Í€•Ù•Éåİ¡•É”€´ÑÉ…¥¹¥¹œ½Ñ•ÍĞ4(€…ÕÉ…ä°µ•ÑÉ¥Ì¹ÁÉ•‘¥Ñ•‘1…‰•±€°ÁÉ•‘¥Ñ¥½¸¹•µ¥ÑÑ•‘€°ÁÉ•‘¥Ñ¥½¸4(€½‰Í•ÉÙ…Ñ¥½¹Ì…¹‘•¥Í¥½¸µÉ•¥½¸•±±Ì¸Q¡•É”¥Ì•á…Ñ±ä½¹”‰¥¹…Éä4(€‘•¥Í¥½¸€¡ÁÉ½‰…‰¥±¥Ñä€ğ€À¸Ô€´ø±…ÍÌ€Á€¤…¹½¹”±…‰•°µ…ÁÁ¥¹œ¸4(´½µÁÕÑ•5±Á•¥Í¥½¹I•¥½¹Í€…•ÁÑÌÑ¡”Í…µ”½ÁÑ¥½¹…°±…‰•±Í€½¹ÑÉ…Ğì4(€¥ÑÌ‘•™…Õ±ĞÉ•µ…¥¹Ìa=H…€½‰€¸4(´]½É­ÍÁ…”¥¹ÁÕÑÌÉ•Í½±Ù”Ñ¡É½Õ Ñ¡”•á¥ÍÑ¥¹œ…Ñ…Í•Ğ‘…ÁÑ•ÈÍ•µ…¹Ñ¥Ìè4(€‘•±…É•™•…ÑÕÉ•½±Õµ¹Í€…É”…ÕÑ¡½É¥Ñ…Ñ¥Ù”€¡™•…ÑÕÉ•½±Õµ¹Í€¥¹Ñ•ÉÍ•Ğ4(€Ù…±¥¹Õµ•É¥Œ½±Õµ¹Ì°Ñ¡”Ñ…É•Ğ½±Õµ¸¥Ì•á±Õ‘•€´Õ¹É•±…Ñ•¹Õµ•É¥Œ4(€½±Õµ¹Ì±¥­”¥½Ñ¥µ•ÍÑ…µÀ¹•Ù•È•¹Ñ•ÈÑ¡”µ½‘•°¤°…¹±…ÍÍ¥™¥…Ñ¥½¸4(€Ñ…É•ÑÌ…É”¹½Éµ…±¥é•Ñ¼ÍÑ…‰±”Í•µ…¹Ñ¥ŒÍÑÉ¥¹Ì‰•™½É”Ñ¡”‰¥¹…Éä4(€µ…ÁÁ¥¹œ€¡€Á€€´ø€ˆÀ‰€°ÑÉÕ•€€´ø€‰ÑÉÕ”‰€¤¸9Õµ•É¥Œ‰¥¹…ÉäÑ…É•ÑÌ¹¼4(€±½¹•È™…±°‰…¬Ñ¼Ñ¡”a=H•á…µÁ±”¸5½É”Ñ¡…¸Ñİ¼‘¥ÍÑ¥¹Ğ±…ÍÍ•ÌÍÑ¥±°4(€É•©•Ğİ¥Ñ %9Y1%}A1eI=U9}M=UI€¸4(4(ŒŒ1…å•ÉÌ4(4(ŒŒŒ5½‘•°…‘…ÁÑ•ÉÌ4(4)… µ½‘•°¥µÁ±•µ•¹ÑÌÑ¡”…‘…ÁÑ•È½¹ÑÉ…Ğ¥¸ÍÉŒ½½É”½Á±…åÉ½Õ¹½µ½‘•°½€è4(4)©Ì4)ì4(€¥è€­¹¸œ°4(€…Á…‰¥±¥Ñ¥•Ìèì™¥Ğ°ÁÉ•‘¥Ğ°•Ù…±Õ…Ñ”°ÑÉ…•¥Ğ°ÑÉ…•AÉ•‘¥Ğ°‘•¥Í¥½¹MÕÉ™…”ô°4(€‘•™…Õ±ÑY¥ÍÕ…±¥é…Ñ¥½¹AÉ•Í•Ğ°4(€¥¹¥Ñ¥…±¥é”¡ìÍ½ÕÉ”°½¹ÑÉ½±Ì°Í••°É•½É‘•Èô¤°4(€…ÁÁ±å5½‘•±Ñ¥½¸¡µ½‘•±MÑ…Ñ”°…Ñ¥½¸°ì½¹ÑÉ½±Ì°É•½É‘•Èô¤°4(€‘•É¥Ù•M•¹”¡µ½‘•±MÑ…Ñ”°ì½¹ÑÉ½±Ì°Í½ÕÉ”ô¤°€€¼¼Í•µ…¹Ñ¥ŒÍÑ…Ñ”½¹±ä4(€ÍÉ¥ÁÑ=Á•É…Ñ¥½¹Ì°€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼½Á•É…Ñ¥½¸¹…µ”€´ø)M=8…Ñ¥½¸4)ô4)€4(4(´1¥¹•…ÈI•É•ÍÍ¥½¸É•ÕÍ•Ì±¥¹•…ÉI•É•ÍÍ¥½¹5…Ñ ¹©Í€€¼±¥¹•…ÉI•É•ÍÍ¥½¹A±…åÉ½Õ¹¹©Í€¸4(´-98É•ÕÍ•Ì­¹¹5…Ñ ¹©Í€€¡™¥Ñ-¹¹€°É•™¥Ñ-¹¹É½µMÁ±¥Ñ€°½µÁÕÑ•Q•ÍÑÕÉ…å€°‰Õ¥±‘AÉ½©•Ñ¥½¹Y•Ñ½É€¤…¹Ñ¡”‰É½İÍ•ÈÉÕ¹Ñ¥µ”ÌÍÁ±¥Ğ½™¥ĞÍ•µ…¹Ñ¥Ì€¡U1Q}-99}M€ô€ÈÀÈÙ€¤¸4(´-98Ì™¥ĞÑÉ…”¥Ì±…éäµ±•…É¹¥¹œ¡½¹•ÍĞèÍÁ±¥ĞƒŠH¹½Éµ…±¥é…Ñ¥½¸ÍÑ…Ñ¥ÍÑ¥ÌƒŠHÍÑ½É”Í…µÁ±•ÌƒŠHÉ•…‘äì¥Ğ¹•Ù•È™…‰É¥…Ñ•Ì…¸½ÁÑ¥µ¥é…Ñ¥½¸¸4(´‘•É¥Ù•M•¹•€É•ÑÕÉ¹Ì„ÍÑ…‰±”Í•µ…¹Ñ¥ŒÍÑ…Ñ”€¡Á½¥¹ÑÌ°±¥¹”°É•Í¥‘Õ…±Ì°ÑÉ…¥¹¥¹œ°µ•ÑÉ¥Ì°™½ÉµÕ±„°½‰Í•ÉÙ…Ñ¥½¸°É…¹•Ì™½È1Hì‘¥ÍÁ±…äÁ½¥¹ÑÌ½ÅÕ•Éä°¹•¥¡‰½ÉÌ°Ù½Ñ¥¹œ°‘•¥Í¥½¸É•¥½¹Ì°ÁÉ½©•Ñ¥½¸°¹½Éµ…±¥é…Ñ¥½¸™½È-98¤¸%Ğ¹•Ù•È‘•¥‘•Ìİ¡¥ Ù¥ÍÕ…°ÁÉ¥µ¥Ñ¥Ù•Ì•á¥ÍĞ¸4(´ÍÉ¥ÁÑ=Á•É…Ñ¥½¹Í€ÑÉ…¹Í±…Ñ•ÌÍÉ¥ÁĞ¥¹Ù½­•€½Á•É…Ñ¥½¸¹…µ•Ì¥¹Ñ¼Ñ¡”Í…µ”)M=8…Ñ¥½¹ÌÑ¡”U$ÕÍ•Ì€¡ÑÉ…•¥Ñ€ƒŠHMQIQ}QI%9%9€°Í•Ñ	•ÍÑ¥Ñ€ƒŠHMQ}	MQ}%Q€°ÑÉ…•AÉ•‘¥Ñ€ƒŠHMQIQ}9%!	=I}IY1€°µ½Ù•EÕ•Éå€ƒŠH5=Y}EUIe}A=%9Q€¤°Í¼…‘‘¥¹œ„µ½‘•°¹•Ù•ÈÉ•ÅÕ¥É•Ì¡…¹¥¹œÑ¡”MÉ¥ÁĞIÕ¹Ñ¥µ”¸4(4(ŒŒŒ…Ñ…Í•Ğ…‘…ÁÑ•È4(4)ÍÉŒ½½É”½Á±…åÉ½Õ¹½‘…Ñ„½‘…Ñ…Í•Ñ‘…ÁÑ•È¹©Í€ÁÉ½Ù¥‘•Ì¥¹ÍÁ•Ñ…Ñ…Í•Ñ€°É•…Ñ•MÁ±¥Ñ€°ÁÉ½©•ĞÉ€°‰Õ¥±‘M±¥•€€¡¡¥‘‘•¸™•…ÑÕÉ•Ì™¥á•…ĞÑ¡”ÑÉ…¥¹¥¹œµ•…¸¤°™•…ÑÕÉ•MÑ…ÑÍ€…¹Í…µÁ±•I½İÍ€¸Q¡”€ÉÁÉ½©•Ñ¥½¸…±İ…åÌ½•ÌÑ¡É½Õ ‰Õ¥±‘M±¥”¡ìá•…ÑÕÉ”°å•…ÑÕÉ”°™¥á•‘•…ÑÕÉ•MÑÉ…Ñ•äè€µ•…¸œô¥€¸4(4)É•…Ñ•IÕ¹Ñ¥µ•M•ÍÍ¥½¹€ÉÕ¹Ì•Ù•ÉäÍ½ÕÉ”Ñ¡É½Õ ¥¹ÍÁ•Ñ…Ñ…Í•Ğ ¥€…¹ÍÑ½É•ÌÑ¡”¹½Éµ…±¥é•½¹Ñ•áĞ…Ì‘…Ñ…MÑ…Ñ”èìÍ¡•µ„°É½İÌ°Ñ…Í¬°™•…ÑÕÉ•½±Õµ¹Ì°Ñ…É•Ñ½±Õµ¸°ÑÉ…¥¹I…Ñ¥¼õ€°Í¼€‘‘…Ñ„¸©€‰¥¹‘¥¹Ì¥¸ÍÉ¥ÁÑÌ…É”É•…°€¡Ñ¡”İ½É­ÍÁ…”‘…Ñ…Í•Ğ¥ÌÁ…ÍÍ•™É½´Á±…åÉ½Õ¹‘!½ÍÑ€¤¸4(4(ŒŒŒM•µ…¹Ñ¥ŒÑÉ…”4(4)ÍÉŒ½½É”½Á±…åÉ½Õ¹½ÑÉ…”½€‘•™¥¹•Ì)M=8µÍ…™”°‘•Ñ•Éµ¥¹¥ÍÑ¥ŒÑÉ…”•Ù•¹ÑÌ€¡‘…Ñ„¹±½…‘•‘€°ÍÁ±¥Ğ¹É•…Ñ•‘€°¹½Éµ…±¥é…Ñ¥½¸¹™¥ÑÑ•‘€°Á•Èµµ½‘•°ÑÉ…¥¹¥¹œ½ÅÕ•Éä•Ù•¹ÑÌ°•Ù…±Õ…Ñ¥½¸¹½µÁ±•Ñ•‘€¤¸Ù•¹Ğ¥‘Ì½ÍÑ•ÁÌ½Ñ¥µ•ÍÑ…µÁÌ½µ”™É½´„Í•ÍÍ¥½¸µ±½…°½Õ¹Ñ•È°¹•Ù•ÈÑ¡”İ…±°±½¬°Í¼Ñ¡”Í…µ”ÍÉ¥ÁĞ€¬Í••€¬‘…Ñ„É•Á±…åÌÑ¼Ñ¡”¥‘•¹Ñ¥…°ÑÉ…”¸4(4(ŒŒŒY¥ÍÕ…±¥é…Ñ¥½¸ÍÉ¥ÁÑÌ…¹ÁÉ•Í•ÑÌ4(4)AÉ•Í•ÑÌ€¡ÍÉŒ½½É”½Á±…åÉ½Õ¹½ÁÉ•Í•ÑÌ½€°É•¥ÍÑ•É•¥¸Ù¥ÍÕ…±¥é…Ñ¥½¸½ÁÉ•Í•ÑI•¥ÍÑÉä¹©Í€¤…É”)M=8µÍ…™”‘•±…É…Ñ¥½¹Ìè4(4)©Ì4)ìÙ•ÉÍ¥½¸è€Ä°¥°µ½‘•°èì…‘…ÁÑ•Èô°‘…Ñ„èìÍ½ÕÉ”ô°4(€½¹ÑÉ½±Ìèl¸¸¹t°±…å½ÕĞèìÍÑ…”èl¸¸¹t°Í¥‘”èl¸¸¹tô°4(€ÁÉ¥µ¥Ñ¥Ù•Ìèmì¥°ÑåÁ”õt°ÍÑ•ÁÌèl¸¸¹tô4)€4(4)Ù¥ÍÕ…±¥é…Ñ¥½¸½ÍÉ¥ÁÑY…±¥‘…Ñ½È¹©Í€É•©•ÑÌÕ¹­¹½İ¸µ½‘•±Ì½ÁÉ¥µ¥Ñ¥Ù•Ì½½Á•É…Ñ¥½¹Ì°¥¹Ù…±¥‰¥¹‘¥¹Ì€¡¥¹±Õ‘¥¹œÁÉ¥µ¥Ñ¥Ù”ÁÉ½ÁÌ¤°•á•ÕÑ…‰±”ÍÑÉ¥¹Ì°½Ù•ÉÍ¥é•ÍÉ¥ÁÑÌ°Õ¹­¹½İ¸±…å½ÕĞÁÉ¥µ¥Ñ¥Ù”É•™•É•¹•Ì…¹‘ÕÁ±¥…Ñ”±…å½ÕĞ¥‘Ì€¡MI%AQ}U9-9=]9}5=1€°MI%AQ}U9-9=]9}AI%5%Q%Y€°MI%AQ}U9MUAA=IQ}=AIQ%=9€°MI%AQ}%9Y1%}	%9%9€°MI%AQ}U9-9=]9}QI}Y9Q€°MI%AQ}Q==}=5A1a€°MI%AQ}U9-9=]9}AI%5%Q%Y}II9€°%9Y1%}MI%AQ€¤¸Ù•Éä½Á•É…Ñ¥½¸Ñ¡”Ù…±¥‘…Ñ½È…•ÁÑÌ¡…ÌÉÕ¹Ñ¥µ”Í•µ…¹Ñ¥Ìè¥¹Ù½­•€°Í•Ñ½¹ÑÉ½±€°Í¡½İ€°¡¥‘•€°¡¥¡±¥¡Ñ€°É•Ù•…±€°É•Í•Ñ€°…¹¹½Ñ…Ñ•€°İ…¥Ñ€€¡½¹ÍÕµ•€½ÕÁ‘…Ñ•€İ•É”É•µ½Ù•Õ¹Ñ¥°AH¹••‘ÌÑ¡•´¤¸4(4)Ù¥ÍÕ…±¥é…Ñ¥½¸½ÍÉ¥ÁÑIÕ¹Ñ¥µ”¹©Í€•á•ÕÑ•ÌÁÉ•Í•ÑÌÑ¡É½Õ Ñ¡”Õ¹¥™¥•ÉÕ¹Ñ¥µ”ÌMI%AQ|©€…Ñ¥½¹Ì€¡MI%AQ}1=½A1d½AUM½MQ@½M,½IMQ€¤ìÍ••¬…¹É•Í•ĞÉ•Á±…ä™É½´Ñ¡”Í•ÍÍ¥½¸‰…Í•±¥¹”°Í¼Ñ¡”Í…µ”ÍÉ¥ÁĞ€¬Í••€¬‘…Ñ„ÁÉ½‘Õ•Ì‰åÑ”µ¥‘•¹Ñ¥…°ÑÉ…•Ì…¹ÁÉ¥µ¥Ñ¥Ù•Ì¸4(4(ŒŒŒU¹¥™¥•U$4(4)ÍÉŒ½½µÁ½¹•¹ÑÌ½Á±…åÉ½Õ¹½€½¹Ñ…¥¹ÌÑ¡”Ñ½½±‰…È€¡5½‘•°€¼…Ñ…Í•Ğ€¼AÉ•Í•Ğ€¼•¹Ğ¤°Ñ¡”Õ¹¥™¥•ÍÑ…”°¥¹ÍÁ•Ñ½È°Ñ¥µ•±¥¹”…¹ÁÉ¥µ¥Ñ¥Ù”É•¹‘•É•ÉÌ¸Q¡”ÍÑ…”½¹±ä­¹½İÌÁÉ¥µ¥Ñ¥Ù•Ímu€ƒŠP¥ĞÉ•Í½±Ù•Ì•… ÁÉ¥µ¥Ñ¥Ù”Ñ¡É½Õ É•¹‘•É•ÉI•¥ÍÑÉä¹©Íá€…¹¹•Ù•È¥µÁ½ÉÑÌµ½‘•°µ…Ñ ¸A±…å‰…¬¥ÌÍÉ¥ÁĞµ‘É¥Ù•¸èİ¥Ñ „±½…‘•ÁÉ•Í•ĞÑ¡”Ñ¥µ•±¥¹”‘É¥Ù•ÌMI%AQ|©€…Ñ¥½¹Ì…¹¹•Ù•ÈÍÁ•¥…°µ…Í•Ì„µ½‘•°€¡„ÍÑ…Ñ¥ŒÑ•ÍĞ™½É‰¥‘Ìµ½‘•°¹…µ•Ì…¹MQIQ}QI%9%9€½MQIQ}9%!	=I}IY1€¥¸Ñ¡”U$‘¥É•Ñ½Éä¤¸4(4(ŒŒŒY¥ÍÕ…°•¹½‘¥¹œ…¹É•¹‘•É•ÈÉ•Í¥±¥•¹”4(4(´ÍÉŒ½½µÁ½¹•¹ÑÌ½Á±…åÉ½Õ¹½Ù¥ÍÕ…±¹½‘¥¹œ¹©Í€½İ¹ÌÑ¡”‘•Ñ•Éµ¥¹¥ÍÑ¥Œ±…‰•³ŠI½±½Èµ…ÁÁ¥¹œ€¡‰Õ¥±‘1…‰•±½±½É5…Á€¤¸MÑ…”…¹%¹ÍÁ•Ñ½È‰Õ¥±¥Ğ™É½´Ñ¡”Í…ÑÑ•ÈÁÉ¥µ¥Ñ¥Ù”ÌÁ½¥¹ÑÌ°Í¼„±…‰•°É•¹‘•ÉÌİ¥Ñ Ñ¡”Í…µ”½±½È…É½ÍÌÍ…ÑÑ•ÈÁ½¥¹ÑÌ°¹•¥¡‰½È±¥¹­Ì°Ù½Ñ”‰…ÉÌ…¹‘•¥Í¥½¸É•¥½¹Ì¸½±½ÉÌ…É”U$µ±…å•È½¹±äè…‘…ÁÑ•ÉÌ•µ¥ĞÍ•µ…¹Ñ¥Œ±…‰•±Ì°ÍÉ¥ÁÑÌ‘•¥‘”İ¡…ĞÑ¼Í¡½Ü°…¹¹¼Ñ¡•µ”ÍåÍÑ•´•á¥ÍÑÌå•Ğ¸4(´I•¹‘•É•ÉÌ‘•É…‘”É…•™Õ±±ä½¸µ¥ÍÍ¥¹œ½ÁÑ¥½¹…°½¹Ñ•áĞ€¡µ¥ÍÍ¥¹œ½±½É	å1…‰•±€°µ…±™½Éµ•Ù½Ñ¥¹€°µ¥ÍÍ¥¹œ…ÉÉ…åÌ¤¥¹ÍÑ•…½˜Ñ¡É½İ¥¹œ°‰ÕĞ¹•Ù•ÈÉ•Á…¥Èµ½‘•°µ…Ñ ƒŠP‰…µ½‘•°ÍÑ…Ñ”¥Ì…Õ¡Ğ¥¸Ñ¡”ÉÕ¹Ñ¥µ”½Ù…±¥‘…Ñ½È±…å•È¸4(´A±…åÉ½Õ¹‘ÉÉ½É	½Õ¹‘…Éå€İÉ…ÁÌÑ¡”A±…åÉ½Õ¹€¡MÑ…”½%¹ÍÁ•Ñ½È½Q¥µ•±¥¹”½É•¹‘•É•ÉÌ¤Í¼„É•¹‘•É•È•á•ÁÑ¥½¸Í¡½İÌ„™…±±‰…¬Á…¹•°İ¥Ñ I•Í•Ğ…¹±½Í”¥¹ÍÑ•…½˜İ¡¥Ñ”µÍÉ••¹¥¹œÑ¡”…ÁÀ¸Q¡”™…±±‰…¬½¹±ä‘•Á•¹‘Ì½¸½¹±½Í•€½½¹I•Í•Ñ€½Ñ€°¹•Ù•È½¸Ñ¡”Á½ÍÍ¥‰±äµ½ÉÉÕÁĞÍ¹…ÁÍ¡½Ğ¸4(´ÍÉ¥ÁÑÌ½¡•¬µÁ±…åÉ½Õ¹µÉ•¹‘•È¹µ©Í€‰Õ¹‘±•ÌÍÉ¥ÁÑÌ½Á±…åÉ½Õ¹µÉ•¹‘•ÈµÍµ½­”¹©Íá€İ¥Ñ •Í‰Õ¥±…¹ÉÕ¹ÌI•…ĞÍ•ÉÙ•ÈÉ•¹‘•É¥¹œ™½È•Ù•Éä-98½1HÁÉ•Í•ĞÍÑ•À€¡MÑ…”€¬%¹ÍÁ•Ñ½È¤°…ÍÍ•ÉÑ¥¹œÑ¡”™¥ÉÍĞ¹½¸µ•µÁÑäÙ½Ñ”Í¹…ÁÍ¡½ĞÉ•¹‘•ÉÌİ¥Ñ¡½ÕĞ•á•ÁÑ¥½¹Ìì¥Ğ¥ÌÁ…ÉĞ½˜¹Á´ÉÕ¸¡•­€¸4(4(ŒŒ•ÍÉ¥ÁÑ½È½¹ÑÉ…Ğ€¡½µÁ…Ñ¥‰¥±¥Ñä¤4(4)… Á±…åÉ½Õ¹¥Ì„‘•ÍÉ¥ÁÑ½È¥¸ÍÉŒ½½É”½Á±…åÉ½Õ¹‘Ì½€¸Q¡”É•¥ÍÑÉä€¡É•¥ÍÑÉä¹©Í€¤¥ÌÑ¡”½¹±äÍ½ÕÉ”½˜Á±…åÉ½Õ¹µ•Ñ…‘…Ñ„¸4(4)©Ì4)ì4(€¥è€±¥¹•…ÈµÉ•É•ÍÍ¥½¸œ°4(€Ù•ÉÍ¥½¸è€Ä°4(€Ñ¥Ñ±•-•äè€Á±…åÉ½Õ¹¹±¥¹•…ÉI•É•ÍÍ¥½¸¹Ñ¥Ñ±”œ°4(€‘•ÍÉ¥ÁÑ¥½¹-•äè€Á±…åÉ½Õ¹¹±¥¹•…ÉI•É•ÍÍ¥½¸¹‘•ÍÉ¥ÁÑ¥½¸œ°4(€ÍÕÁÁ½ÉÑ•‘=ÁÌèl±¥¹•…É}É•É•ÍÍ¥½¸t°4(€ÍÕÁÁ½ÉÑ•‘Q…Í­ÌèlÉ•É•ÍÍ¥½¸t°4(€Í½ÕÉ•-¥¹‘Ìèl•á…µÁ±”œ°€İ½É­ÍÁ…”µ‘…Ñ…Í•Ğt°4(€½¹ÑÉ½±Ìèmì­•äè€İ•¥¡Ğœ°ÑåÁ”è€¹Õµ‰•Èœ°µ¥¸è€´ÄÀÀ°µ…àè€ÄÀÀ°ÍÑ•Àè€À¸ÀÄõt°4(€…Ñ¥½¹ÌèlMQ}=9QI=0œ°€}A=%9Pœ°€MQIQ}QI%9%9œ°€MQ@œ°€M,œ°€IMPœ°€IU9}M9I%<t°4(€Í•¹…É¥½Ìèmì¥è€¥¹ÑÉ¼œ°Ñ¥Ñ±•-•äè€Á±…åÉ½Õ¹¹Í•¹…É¥¼¹¥¹ÑÉ¼œ°ÍÑ•ÁÌèl¸¸¹tõt°4(€…‘…ÁÑ•É%è€±¥¹•…ÈµÉ•É•ÍÍ¥½¸œ°4(€Ù…±¥‘…Ñ•M½ÕÉ”¡Í½ÕÉ”¤°4)ô4)€4(4)Á±…åÉ½Õ¹‘Í½È¡ìµ…¹¥™•ÍĞ°‘…Ñ…Í•Ğô¥€‘•¥‘•Ì…Ù…¥±…‰¥±¥Ñäè„Á±…åÉ½Õ¹¥Ì…Ù…¥±…‰±”İ¡•¸Ñ¡”½µÁ½¹•¹ĞÌ½Á€¥Ì¥¸ÍÕÁÁ½ÉÑ•‘=ÁÍ€¸Q¡”‘…Ñ…Í•Ğ…ÉÕµ•¹Ğ¥Ì­•ÁĞ™½ÈÍ½ÕÉ”Ù…±¥‘…Ñ¥½¸…Ğ½Á•¸Ñ¥µ”ì¥Ğ‘½•Ì¹½Ğİ¥‘•¸…Ù…¥±…‰¥±¥Ñä¸4(4)É•…Ñ•%¹¥Ñ¥…±MÑ…Ñ•€°É•‘Õ•€…¹‘•É¥Ù•M•¹•€…É”¹¼±½¹•ÈÁ…ÉĞ½˜Ñ¡”‘•ÍÉ¥ÁÑ½È½¹ÑÉ…ĞƒŠPÑ¡”Õ¹¥™¥•ÉÕ¹Ñ¥µ”¥µÁ±•µ•¹ÑÌÑ¡•´½¹”¸4(4(ŒŒM•ÍÍ¥½¸±¥™•å±”4(4)ÍÉŒ½½É”½Á±…åÉ½Õ¹‘Ì½Í•ÍÍ¥½¸¹©Í€•áÁ½Í•ÌÉ•…Ñ•A±…åÉ½Õ¹‘M•ÍÍ¥½¹€€¼‘¥ÍÁ…Ñ¡A±…åÉ½Õ¹‘Ñ¥½¹€€¼‘•É¥Ù•A±…åÉ½Õ¹‘M¹…ÁÍ¡½Ñ€°‘•±•…Ñ¥¹œÑ¼Ñ¡”Õ¹¥™¥•ÉÕ¹Ñ¥µ”¸Ñ¥½¹Ì…É”Á±…¥¸)M=8½‰©•ÑÌìIMQ€É•‰Õ¥±‘Ì™É½´Ñ¡”…ÁÑÕÉ•Í½ÕÉ”Í¹…ÁÍ¡½Ğì‘¥ÍÁ…Ñ ¹•Ù•ÈµÕÑ…Ñ•Ì¥ÑÌ¥¹ÁÕĞÍ•ÍÍ¥½¸ìÍ•ÍÍ¥½¹Ì…É”Ñ•µÁ½É…ÉäU$½…•¹ĞÍÑ…Ñ”€¡¹•Ù•ÈİÉ¥ÑÑ•¸Ñ¼ÁÉ½©•Ğ)M=8°¹•Ù•È¡…¹”AI=)Q}YIM%=9€¤¸4(4)Q¡”Í¹…ÁÍ¡½Ğ¥Ì„‘•Ñ…¡•Í•µ…¹Ñ¥Œ½‰©•ĞÑ¡…Ğ­••ÁÌÑ¡”¡¥ÍÑ½É¥…°Í•¹”½µ•ÑÉ¥Ì½½‰Í•ÉÙ…Ñ¥½¸½™½ÉµÕ±„½…Á…‰¥±¥Ñ¥•Ì™¥•±‘Ì…¹…‘‘ÌÑÉ…•Í€°ÍÉ¥ÁÑ€°Ù¥ÍÕ…±MÑ…Ñ•€…¹ÁÉ¥µ¥Ñ¥Ù•Í€¸4(4(ŒŒM½ÕÉ”¡…¹‘±¥¹œ4(4(´Q¡”Í½ÕÉ”¥Ì…ÁÑÕÉ•…Ì„Í¹…ÁÍ¡½Ğİ¡•¸„Á±…åÉ½Õ¹½Á•¹Ì¸4(´İ½É­ÍÁ…”µ‘…Ñ…Í•Ñ€Í½ÕÉ”É•½É‘Ì„™¥¹•ÉÁÉ¥¹Ğ½˜Ñ¡”‘…Ñ…Í•ĞÕÍ•¸4(´]¡•¸Ñ¡”İ½É­ÍÁ…”‘…Ñ…Í•Ğ¡…¹•Ì±…Ñ•È°Ñ¡”Í•ÍÍ¥½¸µ…É­ÌÍ½ÕÉ”¹ÍÑ…±”€ôÑÉÕ•€¸4(´=¹±äÉ•™É•Í¡M½ÕÉ” ¥€É”µÉ•…‘ÌÑ¡”İ½É­ÍÁ…”‘…Ñ…Í•Ğ…¹É•‰Õ¥±‘ÌÑ¡”Í•ÍÍ¥½¸¸4(´A±…åÉ½Õ¹•‘¥ÑÌ¹•Ù•Èµ½‘¥™ä…¹Ù…Ì¹½‘•Ì°Ñ½Á½±½ä°Ñ¡”ÁÉ½©•Ğ‘…Ñ…Í•Ğ°½ÈÑ¡”ÑÉ…¥¹•µ½‘•°¸€‰ÁÁ±äÑ¼…¹Ù…Ìˆ¥Ì™ÕÑÕÉ”İ½É¬…¹µÕÍĞ¼Ñ¡É½Õ Ñ¡”•á¥ÍÑ¥¹œ…¹Ù…Ì•¹Ğ½U$½µµ…¹‘Ì…¹Á…É…µ•Ñ•ÈÙ…±¥‘…Ñ¥½¸¸4(4(ŒŒM•¹…É¥½Ì4(4)M•¹…É¥½Ì…É”Í•É¥…±¥é…‰±”…Ñ¥½¸Í•ÅÕ•¹•Ìİ¥Ñ Á•ÈµÍÑ•À¹…ÉÉ…Ñ¥½¸­•åÌè4(4)©Ì4)ì4(€¥è€¥¹ÑÉ¼œ°4(€ÍÑ•ÁÌèl4(€€€ì…Ñ¥½¸èìÑåÁ”è€MQ}=9QI=0œ°­•äè€¬œ°Ù…±Õ”è€Äô°‘ÕÉ…Ñ¥½¹5Ìè€àÀÀ°¹…ÉÉ…Ñ¥½¹-•äè€Á±…åÉ½Õ¹¹­¹¸¹Í•¹…É¥¼¹¥¹ÑÉ½,Äœô°4(€t°4)ô4)€4(4)Q¡”U$…¹¥µ…Ñ•ÌÑ¡É½Õ ÍÑ•ÁÌ…Ğ‘ÕÉ…Ñ¥½¹5Ì€¼ÍÁ••‘€ìÑ¡”•¹ĞÉÕ¹M•¹…É¥¼ ¥€…ÁÁ±¥•ÌÑ¡•´‘•Ñ•Éµ¥¹¥ÍÑ¥…±±ä¸Q¡”Í…µ”Í•¹…É¥¼Á½İ•ÉÌ‰½Ñ °İ¡¥ µ…­•ÌÉ•½É‘•Ñ•…¡¥¹œÙ¥‘•½ÌÉ•ÁÉ½‘Õ¥‰±”¸4(4(ŒŒI•¹‘•É•È‰½Õ¹‘…Éä4(4)ÍÉŒ½½µÁ½¹•¹ÑÌ½Á±…åÉ½Õ¹½€½¹Ñ…¥¹ÌÑ¡”Õ¹¥™¥•U$è4(4(´U¹¥™¥•‘A±…åÉ½Õ¹‘¥…±½€¡½ÍÑÌÑ¡”Í•ÍÍ¥½¸…¹Á±…å‰…¬Ñ¥µ•È¸4(´A±…åÉ½Õ¹‘Q½½±‰…É€Í¡½İÌ5½‘•°€¼…Ñ…Í•Ğ€¼AÉ•Í•Ğ€¼•¹ĞÍÑ…ÑÕÌ¸4(´A±…åÉ½Õ¹‘MÑ…•€É•¹‘•ÉÌÑ¡”±…å½ÕĞ¹ÍÑ…•€ÁÉ¥µ¥Ñ¥Ù•ÌÑ¡É½Õ É•¹‘•É•ÉI•¥ÍÑÉä¹©Íá€ì¥Ğ¹•Ù•È­¹½İÌİ¡¥ µ½‘•°ÁÉ½‘Õ•Ñ¡•´¸4(´A±…åÉ½Õ¹‘%¹ÍÁ•Ñ½É€Í¡½İÌ½¹ÑÉ½±ÌÁ±ÕÌÑ¡”±…å½ÕĞ¹Í¥‘•€ÁÉ¥µ¥Ñ¥Ù•Ì€¡Ù½Ñ”‰…ÉÌ°µ•ÑÉ¥Ì°½‰Í•ÉÙ…Ñ¥½¸¤¸4(´A±…åÉ½Õ¹‘Q¥µ•±¥¹•€…¹Ñ¡”™½ÉµÕ±„‰…È‘É¥Ù”Á±…å‰…¬…¹¹…ÉÉ…Ñ¥½¸¸4(´É•¹‘•É•ÉÌ½€‘É…Ü)M=8ÁÉ½ÁÌ½¹±äìÑ¡•ä¹•Ù•È¥µÁ½ÉĞµ½‘•°µ…Ñ¡•µ…Ñ¥Ì¸4(4)¹¥µ…Ñ¥½¸•áÁÉ•ÍÍ•ÌÍ•µ…¹Ñ¥Œ¡…¹”€¡¹•¥¡‰½ÈÉ•Ù•…°°É…‘¥•¹ĞÍÑ•ÁÌ¤É…Ñ¡•ÈÑ¡…¸‘•½É…Ñ¥½¸°É•ÍÁ•ÑÌÁÉ•™•ÉÌµÉ•‘Õ•µµ½Ñ¥½¹€Ù¥„Ñ¡”Á±…å‰…¬µ½‘•°°…¹…±°½¹ÑÉ½±Ì…É”­•å‰½…Éµ…•ÍÍ¥‰±”¸…¹Ù…Ì¹½‘•ÌÍÑ…äÍÑ…Ñ¥Œì½¹±äÁ±…åÉ½Õ¹‘Ì…¹¥µ…Ñ”¸4(4(ŒŒŒAÉ•Í•¹Ñ…Ñ¥½¸5½‘”€¡A¡…Í”¸Ä¤4(4)AÉ•Í•¹Ñ…Ñ¥½¸5½‘”¥Ì„±½…°U$Ù¥•Ü½Ù•ÈÑ¡”Í…µ”Á±…åÉ½Õ¹Í¹…ÁÍ¡½Ğ…¹MÉ¥ÁĞIÕ¹Ñ¥µ”¸%Ğ¡¥‘•Ì…ÕÑ¡½É¥¹œ½‘•‰ÕœÍÕÉ™…•Ì°ÁÉ•Í•ÉÙ•ÌÑ¡”…¹½¹¥…°€ØĞÃ\ÌØÁ€ÍÑ…”…ÍÁ•ĞÉ…Ñ¥¼°…¹•áÁ½Í•Ì½¹±äI•ÍÑ…ÉĞ°A±…ä½A…ÕÍ”…¹á¥ĞAÉ•Í•¹Ñ…Ñ¥½¸½¹ÑÉ½±ÌÁ±ÕÌÑ¡”½ÁÑ¥½¹…°ÍÉ¥ÁĞµ‘•±…É•…¹¹½Ñ…Ñ¥½¸½™½ÉµÕ±„½¹Ñ•¹Ğ¸Q¡”ÍÑ…”ÕÍ•ÌÑ¡”µ•…ÍÕÉ•ÁÉ•Í•¹Ñ…Ñ¥½¸½¹Ñ•¹Ğ…É•„…¹¥Ì™¥ÑÑ•…ÌÑ¡”±…É•ÍĞ€ÄØèäÉ•Ñ…¹±”Ñ¡…ĞÍ…Ñ¥Í™¥•Ì…Ù…¥±…‰±”İ¥‘Ñ °…Ù…¥±…‰±”¡•¥¡Ğ…™Ñ•ÈÑ•…¡¥¹œ½¹Ñ•¹Ğ°…¹Ñ¡”€ÄÈàÁÁá€µ…á¥µÕ´İ¥‘Ñ ìÑ¡”MY¥ÑÍ•±˜¥Ì¹•Ù•ÈÍÑÉ•Ñ¡•½ÈÉ½ÁÁ•¸¹Ñ•É¥¹œ½È•á¥Ñ¥¹œÑ¡”µ½‘”¹•Ù•È‘¥ÍÁ…Ñ¡•Ì„ÉÕ¹Ñ¥µ”…Ñ¥½¸…¹¹•Ù•ÈÁ•ÉÍ¥ÍÑÌÍÑ…Ñ”¥¹Ñ¼Ñ¡”Y¥ÍÕ…±¥é…Ñ¥½¸MÉ¥ÁĞ¸-•å‰½…É¡…¹‘±¥¹œ¥ÌÍ½Á•Ñ¼Ñ¡”™½ÕÍ•ÁÉ•Í•¹Ñ…Ñ¥½¸É½½ĞèMÁ…”Ñ½±•ÌÁ±…å‰…¬°I€É•ÍÑ…ÉÑÌ°…¹Í…Á”•á¥ÑÌì•‘¥Ñ…‰±”½¹ÑÉ½±Ì…É”¹½Ğ¥¹Ñ•É•ÁÑ•¸4(4(ŒŒ‘‘¥¹œ„Ñ¡¥ÉÁ±…åÉ½Õ¹4(4(Ä¸É•…Ñ”„µ½‘•°…‘…ÁÑ•È¥¸ÍÉŒ½½É”½Á±…åÉ½Õ¹½µ½‘•°¼ñ¹…µ”ù‘…ÁÑ•È¹©Í€€¡¥¹¥Ñ¥…±¥é”°…ÁÁ±å5½‘•±Ñ¥½¸°‘•É¥Ù•M•¹”°‰Õ¥±‘AÉ¥µ¥Ñ¥Ù•Ì¤…¹É•¥ÍÑ•È¥Ğ¥¸µ½‘•±I•¥ÍÑÉä¹©Í€¸4(È¸É•…Ñ”„µ•Ñ…‘…Ñ„‘•ÍÉ¥ÁÑ½È¥¸ÍÉŒ½½É”½Á±…åÉ½Õ¹‘Ì¼ñ¹…µ”ø¹©Í€€¡¥°Ñ¥Ñ±•-•ä°½¹ÑÉ½±Ì°…Ñ¥½¹Ì°Í•¹…É¥½Ì°Ù…±¥‘…Ñ•M½ÕÉ”°…‘…ÁÑ•É%‘€¤…¹É•¥ÍÑ•È¥Ğ¥¸ÍÉŒ½½É”½Á±…åÉ½Õ¹‘Ì½É•¥ÍÑÉä¹©Í€¸4(Ì¸‘„)M=8ÁÉ•Í•Ğ¥¸ÍÉŒ½½É”½Á±…åÉ½Õ¹½ÁÉ•Í•ÑÌ½€…¹É•¥ÍÑ•È¥Ğ¥¸Ù¥ÍÕ…±¥é…Ñ¥½¸½ÁÉ•Í•ÑI•¥ÍÑÉä¹©Í€¸4(Ğ¸‘ÁÉ¥µ¥Ñ¥Ù”É•¹‘•É•ÉÌ¥¸ÍÉŒ½½µÁ½¹•¹ÑÌ½Á±…åÉ½Õ¹½É•¹‘•É•ÉÌ½€…¹µ…ÀÑ¡•´¥¸É•¹‘•É•ÉI•¥ÍÑÉä¹©Íá€¸4(Ô¸‘±½…±¥é•­•åÌ¥¸ÍÉŒ½±½…±•Ì½Õ¤¹©Í€…¹™½ÕÍ•…ÍÍ•ÉÑ¥½¹Ì¥¸ÍÉ¥ÁÑÌ½¡•¬µ½É”¹µ©Í€¸4(4)9¼¡…¹•ÌÑ¼QÕÑ½É¥…±¥…±½€½ÈÑ¡”Õ¹¥™¥•ÍÑ…”…É”¹••‘•èÑ¡”ÑÕÑ½É¥…°ÅÕ•É¥•ÌÁ±…åÉ½Õ¹‘Í½È ¥€•¹•É¥…±±ä…¹Ñ¡”ÍÑ…”½¹±ä½¹ÍÕµ•ÌÁÉ¥µ¥Ñ¥Ù•Ì¸4(4(ŒŒM¡…É•µ…Ñ 4(4(´1¥¹•…ÈÉ•É•ÍÍ¥½¸µ…Ñ ±¥Ù•Ì¥¸ÍÉŒ½½É”½±¥¹•…ÉI•É•ÍÍ¥½¹A±…åÉ½Õ¹¹©Í€€¡Í…µÁ±¥¹œ°É…¹•Ì°5M°±•…ÍĞÍÅÕ…É•Ì°É…‘¥•¹Ğ¤…¹ÍÉŒ½½É”½±¥¹•…ÉI•É•ÍÍ¥½¹5…Ñ ¹©Í€€¡ÍÑ…¹‘…É‘¥é•èµÍ½É”ÑÉ…¥¹•È¤¸Q¡”‰É½İÍ•ÈÉÕ¹Ñ¥µ”…¹Ñ¡”Á±…åÉ½Õ¹‰½Ñ ÑÉ…¥¸Ñ¡É½Õ É•…Ñ•1¥¹•…ÉI•É•ÍÍ¥½¹QÉ…¥¹•È ¥€€¼ÍÑ•Á1¥¹•…ÉI•É•ÍÍ¥½¹QÉ…¥¹•È ¥€°Í¼Ñ¡•¥ÈÑÉ…•Ì…¹¹½Ğ‘É¥™Ğ…Á…ÉĞ¸QÉ…¥¹¥¹œ…±İ…åÌ¡…ÁÁ•¹Ì¥¸ÍÑ…¹‘…É‘¥é•™•…ÑÕÉ”½Ñ…É•ĞÍÁ…”…¹Á…É…µ•Ñ•ÉÌ…É”½¹Ù•ÉÑ•‰…¬Ñ¼É…Ü½½É‘¥¹…Ñ•Ì™½È‘¥ÍÁ±…äì„™¥á•±•…É¹¥¹œÉ…Ñ”Ñ¡•É•™½É”…¹¹½Ğ‘¥Ù•É”½¸±…É”µµ…¹¥ÑÕ‘”‘…Ñ„¸4(´-98µ…Ñ ±¥Ù•Ì¥¸ÍÉŒ½½É”½­¹¹5…Ñ ¹©Í€€¡¹½Éµ…±¥é…Ñ¥½¸°‘¥ÍÑ…¹”°¹•¥¡‰½ÈÉ…¹­¥¹œ°Ù½Ñ¥¹œ°ÁÉ•‘¥Ñ¥½¸°É•™¥Ñ-¹¹É½µMÁ±¥Ñ€°½µÁÕÑ•Q•ÍÑÕÉ…å€°‰Õ¥±‘AÉ½©•Ñ¥½¹Y•Ñ½É€¤…¹¥ÌÍ¡…É•Ù•É‰…Ñ¥´İ¥Ñ Ñ¡”‰É½İÍ•ÈÉÕ¹Ñ¥µ”¸Q¡”‘¥ÍÑ…¹”µ•ÑÉ¥Œ¥ÌÍÅÕ…É•Õ±¥‘•…¸Ñ¼ÁÉ•Í•ÉÙ”ÉÕ¹Ñ¥µ”É…¹­¥¹œÍ•µ…¹Ñ¥Ìì‘¼¹½Ğ¡…¹”¥Ğİ¥Ñ¡½ÕĞÕÁ‘…Ñ¥¹œ‰½Ñ ½¹ÍÕµ•ÉÌ…¹Ñ•ÍÑÌ¸4(4(ŒŒ-98Á±…åÉ½Õ¹Í•µ…¹Ñ¥Ì4(4(´=¸½Á•¸°Ñ¡”-98Á±…åÉ½Õ¹‰Õ¥±‘Ì¥ÑÌ™¥ĞÑ¡É½Õ Ñ¡”Í…µ”Í¡…É•™¥Ñ-¹¸ ¥€¥¸ÍÉŒ½½É”½­¹¹5…Ñ ¹©Í€Ñ¡…ĞÑ¡”‰É½İÍ•ÈÉÕ¹Ñ¥µ”ÕÍ•ÌèÍÑÉ…Ñ¥™¥•ÑÉ…¥¸½Ñ•ÍĞÍÁ±¥Ğ€¡‘•Ñ•Éµ¥¹¥ÍÑ¥M¡Õ™™±•€€¬ÍÑÉ…Ñ¥™¥•‘MÁ±¥Ñ€°‘•™…Õ±ĞÍ••U1Q}-99}M€ô€ÈÀÈÙ€¤°¹½Éµ…±¥é…Ñ¥½¸™É½´Ñ¡”ÑÉ…¥¸Í•Ğ½¹±ä°…¹­€±…µÁ•Ñ¼Ñ¡”ÑÉ…¥¹¥¹œÍ¥é”¸Q¡”ÍÁ±¥ĞÕÍ•ÌÑ¡”Í•ÍÍ¥½¸Í••İ¡•¸½¹”¥ÌÁÉ½Ù¥‘•°½Ñ¡•Éİ¥Í”Ñ¡”Í¡…É•‘•™…Õ±Ğ°Í¼Ñ¡”Í…µ”‘…Ñ…Í•Ğ½¬½ÑÉ…¥¹I…Ñ¥¼ÁÉ½‘Õ•Ì¥‘•¹Ñ¥…°ÑÉ…¥¸½Ñ•ÍĞ½¹½Éµ…±¥é…Ñ¥½¸½…ÕÉ…ä¥¸Ñ¡”ÉÕ¹Ñ¥µ”…¹Ñ¡”Á±…åÉ½Õ¹¸4(´ÑÉ…¥¹I…Ñ¥½€½µ•Ì™É½´Ñ¡”Í½ÕÉ”€¡Í½ÕÉ”¹ÑÉ…¥¹I…Ñ¥½€°‘•™…Õ±Ğ€À¸à¤¸Á±…åÉ½Õ¹‘!½ÍÑ€É•½É‘Ì¥Ğ™½Èİ½É­ÍÁ…”‘…Ñ…Í•ÑÌ€¡‘…Ñ…Í•Ğ¹ÑÉ…¥¹I…Ñ¥¼€üü€À¸á€¤…¹Ñ•…¡¥¹œ‘…Ñ…Í•ÑÌ€¡Ñ•…¡¥¹œ¹ÑÉ…¥¹I…Ñ¥¼€üü€À¸á€¤¸4(´‘¥Ñ¥¹œÑÉ…¥¹¥¹œÁ½¥¹ÑÌ¥Ì„İ¡…Ğµ¥˜½Á•É…Ñ¥½¸èÑ¡”É…ÜÑÉ…¥¸Í•Ğ¥ÌÉ•™¥ÑÑ•İ¥Ñ É•™¥Ñ-¹¹É½µMÁ±¥Ğ ¥€°¹½Éµ…±¥é…Ñ¥½¸…¹¹½Éµ…±¥é•ÑÉ…¥¸Í…µÁ±•Ì…É”É•‰Õ¥±Ğ°…¹Ñ¡”Õ¹¡…¹•Ñ•ÍĞÍ•Ğ¥ÌÉ”µ•Ù…±Õ…Ñ•¸Q•ÍĞÁ½¥¹ÑÌ…É”¹½Ğ•‘¥Ñ…‰±”¸4(´5Õ±Ñ¥‘¥µ•¹Í¥½¹…°‘…Ñ…Í•ÑÌ…É”Í¡½İ¸…Ì„€ÉÍ±¥”è¡¥‘‘•¸™•…ÑÕÉ•Ì…É”™¥á•…ĞÑ¡”ÑÉ…¥¹¥¹œµ•…¸€¡èµÍ½É”€Á€¥¸Ñ¡”¹½Éµ…±¥é•Ù¥•Ü¤Ù¥„‰Õ¥±‘AÉ½©•Ñ¥½¹Y•Ñ½È ¥€¸µ•ÑÉ¥Ì¹ÉÕ¹Ñ¥µ•ÕÉ…å€¥ÌÑ¡”™¥ÑÑ•µ½‘•°Ì…ÕÉ…ä½¸Ñ¡”™Õ±°Ñ•ÍĞÙ•Ñ½ÉÌìµ•ÑÉ¥Ì¹ÕÉÉ•¹ÑY¥•İÕÉ…å€¥ÌÑ¡”Í±¥”µ½‘•°Ì…ÕÉ…ä™½ÈÑ¡”ÕÉÉ•¹ĞÁÉ½©•Ñ¥½¸…¹¹½Éµ…±¥é…Ñ¥½¸µ½‘”¸½ÈÑİ¼Ù¥Í¥‰±”™•…ÑÕÉ•Ìİ¥Ñ ¹½Éµ…±¥é…Ñ¥½¸½¸°Ñ¡”Ñİ¼…É”•ÅÕ…°¸4(´Q¡”¹½Éµ…±¥é•€½¹ÑÉ½°¥Ì„‘¥ÍÑ…¹”µÙ¥•Ü½µÁ…É¥Í½¸°¹½Ğ„µ½‘•°Íİ¥Ñ èİ¥Ñ ¥Ğ½™˜°ÁÉ•‘¥Ñ¥½¸…¹ÕÉÉ•¹ÑY¥•İÕÉ…å€…É”•áÁ±¥¥Ñ±äİ¡…Ğµ¥˜É•ÍÕ±ÑÌ…¹…É”±…‰•±•…ÌÍÕ ¥¸Ñ¡”U$¸4(