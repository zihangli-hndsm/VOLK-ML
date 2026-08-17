# Exploration semantic foundation

Phase 0 introduces a small domain layer for exploration without creating a
second playground state machine.

## World

`src/core/exploration/world.js` defines `World v1` as an explicit finite
`sample` world. It contains stable observation IDs, 2D `x`/`y` coordinates,
optional feature maps and targets/labels, explicit `train`/`test`/
`unspecified` membership, provenance, and seed policy. A finite sample is not
represented as a distribution or generator unless a later phase adds that
contract deliberately.

`worldFromPlaygroundSource()` adapts the existing Playground source at the
runtime boundary. The model adapters remain responsible for model math and do
not import this domain layer.

World Composer v1 is an additional normalized generator kind. Its versioned
WorldRecipe is materialized into the same finite World observations and uses
the same seed, realization, transaction, comparison, and Agent preflight
boundaries. See [World Composer](./world-composer.md).

## Experiment

`src/core/exploration/experiment.js` defines `Experiment v1` as a detached,
JSON-safe bundle of World, model configuration, learning configuration,
evaluation configuration, randomness policy, result/traces, and lineage.
`duplicateExperiment()`, `restoreExperiment()`, and serialization helpers are
pure operations. Script captures remain a separate playback mechanism; they
may carry an Experiment snapshot so replay and restore do not lose semantic
state.

Experiments are currently session-scoped. They are exposed in the runtime
snapshot and Agent `inspectContext()`, but are not written to project JSON.
That keeps the existing project version and migration contract unchanged until
the learner-facing Experiment Bar has an accepted persistence design.

## Operations and comparison

`src/core/exploration/operations.js` contains model-independent operations for
adding, moving, removing, and assigning observations to train/test. Each
operation returns an immutable next World and one grouped mutation record;
future brush or Agent actions can map to the same boundary without leaking UI
details into the domain.

The registry also exposes named-feature interventions: `SET_FEATURE_VALUES`
for projected point edits and `TRANSFORM_FEATURE_VALUES` for deterministic
numeric Shift, Scale, and Add Noise operations. A transform is scoped to an
explicit observation ID set and records its feature, kind, amount, seed, and
scope. Noise uses stable seed/feature/observation identity, never UI
`Math.random()`, and both operation types invert through one grouped feature
value transaction.

Control descriptors declare whether a control belongs to `model`, `learning`,
`evaluation`, or `view`. Runtime synchronization uses those declarations to
partition the current session into the Experiment bundle. View-only controls
are intentionally excluded from semantic comparison.

`src/core/exploration/comparison.js` compares only semantic factors:
World/data, train/test relationship, model, learning, evaluation, and
randomness. Runtime IDs, lineage, mutation history, and playback bookkeeping
do not make otherwise identical experiments different. Results are reported as
`identical`, `high` (one factor changed), or `mixed` (multiple factors
changed); mixed is descriptive, not an error state.

## Shared state boundary

The active path remains:

```text
UI / Playground Agent / Script Runtime
          -> JSON runtime action
          -> unified playground reducer
          -> model adapter + semantic Experiment synchronization
          -> runtime snapshot + Agent inspectContext
```

This is an adapter around the existing runtime, not a second reducer. The
current no-Agent Playground journey remains usable and continues to use the
same model actions. A full 2D drawing workspace, user-facing duplicate/compare
controls, undo UI, generators, and persistent Experiment history remain
Phase 1/2/3 work.

## Phase 1.1 World transaction foundation

Phase 1.1 adds the semantic transaction boundary needed by the future 2D Data
Workspace without adding its drawing UI. `applyWorldTransaction()` applies a
non-empty list of registered World operations atomically and returns:

- the next validated World;
- one lightweight semantic action record (`actor`, `domain`, `intent`, and a
  mutation summary);
- a normalized forward transaction;
- an inverse transaction for exact Undo.

The unified Playground runtime accepts `APPLY_WORLD_TRANSACTION`,
`UNDO_WORLD_ACTION`, and `REDO_WORLD_ACTION`. It owns the history stacks, keeps
only forward/inverse operations rather than a World snapshot per action, and
clears Redo after a new accepted edit. Script baselines and captures preserve
World history, source state, the transaction counter, and view state so script
branches do not leak edits into one another. The public snapshot exposes only
the lightweight action records.

`src/core/exploration/gestures.js` is a pure deterministic materializer for
future Brush and Spray UI gestures. The same normalized path, seed, spread,
density, membership, and gesture ID produce the same point IDs and values.
Path input, points per gesture, and total World observations are bounded before
the runtime accepts the transaction. Transactions also cap operation count,
and the runtime retains a bounded number of reversible action entries.

World edits remain model-independent. An adapter may opt into them through
`applyWorld(modelState, world, context)`. Linear Regression is the first and
only Phase 1.1 implementation. It rebuilds its point state from the canonical
World, clears stale training playback, and computes fitting/training from
explicit `train` observations while reserving `test` observations for
`testMse`. Legacy Worlds with only `unspecified` membership retain the previous
all-data training behavior. KNN and MLP do not yet advertise `canEditWorld`.

Workspace view state is separate from the Experiment. `SET_WORKSPACE_VIEW`
updates validated bounds and Train/Test visibility without changing the World,
Experiment semantic fingerprint, or World action history. The future drawing
surface must use this boundary rather than encoding pan/zoom as data changes.

Phase 1.1 deliberately does not include an Experiment Bar, generators,
Scenario execution, or persistence. The accepted Phase 1.2 Data Lab slice adds
the learner-facing Point/Brush/Spray and selection controls over this same
transaction boundary; it still does not add editable KNN/MLP model adapters.

## Canonical World operations and split semantics

`src/core/exploration/operationRegistry.js` is the authority for public World
operations. Each entry declares what the operation changes and preserves,
whether it is undoable, and whether humans and Agents may discover it. Runtime
capability inspection is derived from this registry. Internal inverse
operations such as `RESTORE_POINTS` and `RESTORE_MEMBERSHIPS` are deliberately
absent from it and are accepted only inside system-owned Undo transactions.

Every editable Linear Regression World action now follows one path:

```text
human gesture / Agent action / legacy LR action
                  -> registered World operation
                  -> one atomic World transaction
                  -> canonical Experiment.world
                  -> adapter.applyWorld()
                  -> derived model state and metrics
```

Legacy `ADD_POINT`, `MOVE_POINT`, and `REMOVE_POINT` actions are compatibility
inputs only. The runtime translates them before mutation, so they share point
ID allocation, action grouping, validation, history, and Agent provenance with
the public operations. One dispatch is one human-level history boundary even
when its transaction contains many operations. Undo applies the stored inverse
operations as one system transaction; Redo reapplies the normalized forward
transaction.

Membership has one explicit transition rule. A World containing only
`unspecified` observations preserves the legacy behavior that every
observation trains the model. The first public assignment to `train` or `test`
starts an explicit split and atomically normalizes every remaining
`unspecified` observation to `train`. Once a split exists, newly added
unspecified observations are likewise normalized to `train`. Linear
Regression therefore always treats `membership !== 'test'` as training data,
including a defensive mixed imported World. A transaction that would leave
fewer than two training observations is rejected before model synchronization;
the World, Experiment, traces, and Undo/Redo history remain unchanged.

`adapter.applyWorld()` is a synchronization consequence, not an alternative
mutation authority. Adapters may validate whether a candidate canonical World
is usable by their model and then rebuild derived state, but they do not define
public World actions or split policy. This keeps a future finite-sample model
extension on the registry/transaction boundary and avoids model branches in
the exploration layer.

Experiment comparison keeps the factors orthogonal. Coordinates, targets,
labels, provenance, and observation existence belong to the `world` factor;
observation membership belongs only to `trainTest`. Moving test points changes
`world` while preserving fitted Linear Regression parameters, although test
MSE may change. A pure membership edit changes only `trainTest`. View state is
outside both the Experiment and comparison fingerprint.

## Phase 1 2D Data Workspace MVP

`src/components/playground/DataWorkspace.jsx` is a generic learner-facing Data
Lab surface over the canonical World snapshot. The internal `data-lab` session
opens without a model, so editing and projection are available before model
selection. An attached adapter may opt into World synchronization through
`applyWorld()`; Linear Regression is the first supported adapter, while KNN
and MLP remain inspectable model choices without editable World synchronization.

The human interaction boundary is:

```text
pointer event(s)
    -> local tool/layer/gesture draft
    -> completed pointer gesture
    -> registered World operation
    -> one World transaction
    -> runtime history + adapter.applyWorld()
    -> semantic model snapshot and render
```

Point, precise-coordinate entry, Brush, Spray, Select/Move, and Erase all use
the same registered operations. Brush and Spray delegate point materialization
to `materializeWorldGesture()` and commit one `ADD_POINTS` transaction on
pointer-up. Move commits one `MOVE_POINT`; a multi-point erase commits one
`REMOVE_POINTS` transaction. Pointer cancellation and resource-limit
violations discard the local draft without a partial semantic mutation.

The Workspace keeps a projection policy: scatter and distribution views read
named values through `src/core/exploration/projection.js`; changing the
projection changes only `SET_WORKSPACE_VIEW` state. Bounds are computed from
the active projection and never become World data. Visibility (`train`, `test`,
or `both`) also remains view state and never enters World history or the
Experiment semantic fingerprint. Hidden test points remain counted and are
called out in the layer legend.

The train/test authoring layer is UI state that supplies membership to new
observations. The first explicit assignment still goes through the domain's
normalization rule; React does not duplicate split semantics. Train points use
filled markers and test points use outlined diamond markers, so the distinction
does not depend on color alone. Residual primitives carry the same subset
metadata and render test residuals with a distinct dashed violet treatment;
`trainMse` and `testMse` remain separate semantic metrics.

The precise editor is an accessibility and exactness path, not a second data
store. It emits named-feature `SET_FEATURE_VALUES` for a selected point and
uses `observationFromProjection()` for a new row only when the active 2D
projection supplies every required World value. Multi-feature projections
therefore disable new-row tools instead of silently filling hidden columns or
writing a fallback `y`. Unknown feature names and non-numeric feature values
are rejected atomically by the domain operations.

The Experiment Lab shell presents Data Lab and Model Lab as peer UI tabs over
one runtime session. Data Lab owns projection state (scatter/distribution,
selected numeric features, visibility, and selection); Model Lab owns model
controls and learning playback. Switching tabs does not recreate the session.
`RUN` and `RESET_LEARNING` reset/recompute learning from the current canonical
World, while `RESTORE_ORIGINAL_DATA` is the explicit open-time baseline restore.
Attaching a compatible model changes model capabilities, not the World. A
visualization-script restart restores the explanation/model baseline while
preserving current World observations, World history, and feature edits.

## Phase 4 evidence identity and inspection parity

Shared observables in `src/core/exploration/observables.js` are derived at the
runtime boundary and consumed by the learner surface, deterministic detectors,
and Agent `inspectContext()`. Train/test coverage is interval geometry: positive
width ranges use overlap-length fractions, while zero-width ranges use explicit
point containment so no division by zero implies false coverage.

Repeat evidence carries a canonical `conditionFingerprint`. Its semantic
payload includes World mode and execution mode, generator specification and
seed/realization state, fixed World observations and memberships when the
active condition is a sample/manual realization, model adapter/configuration,
learning and evaluation configuration, and execution-relevant controls. It
excludes experiment IDs and presentation state. Snapshot derivation compares
the stored fingerprint with the active condition before exposing Repeat
evidence or deriving Repeat observables; stale evidence may remain in runtime
history but is unavailable as current evidence.

The Agent inspection boundary exposes the same `EXPLORATION_RECIPES`,
`THINGS_TO_TRY`, and `AFFORDANCE_IDS` registries used by the learner UI.
Recipes additionally declare `relevantObservableIds`, completing the semantic
link from an exploration prompt to the evidence a learner can inspect without
introducing automatic interpretation or intervention.

## Phase 5 Exploration Agent learner mode

Phase 5 adds an optional learner-facing Agent path over the same semantic
runtime. `scenarioSpec.js` defines a deliberately small JSON-safe requested
ScenarioSpec v1 with `baseline`, `change`, `hold`, `observe`, and `execution`.
Fidelity is a derived ScenarioAssessment, never trusted input in the request.
The baseline contains the active Experiment ID and the Phase 4 semantic
condition fingerprint. A proposal is validated against `inspectContext()`
before execution: World operations come from the registered operation list,
controls come from model control schemas, observables come from the shared raw
and derived registry, and resource limits are checked before mutation.

Natural-language interpretation is separated from deterministic planning.
`explorationInterpreter.js` provides a bounded local fallback for obvious
learner intents, while `explorationAiInterpreter.js` can use the existing
AiProviderContext/gateway for high-level intent only. Neither interpreter can
return runtime actions. `scenarioPlanner.js` resolves intent through the
registered World capabilities and typed generator-parameter metadata, then
produces operations and observable IDs. `scenarioFidelity.js` compares the
declared Change/Keep-fixed contract with the actual Experiment semantic diff
and reports `exact`, `partial`, or an explicitly disclosed `approximate`
assessment.

Execution requires explicit acceptance. `preflightExplorationScenario()` checks
the baseline and runs the complete accepted path on a detached session using
the normal Duplicate, World transaction, Run, Compare, Repeat, and SET_VISUAL
actions. Only a successful detached candidate is committed to the live host,
so a later failure cannot leave a half-executed Agent experiment. The same
preflight derives proposal fidelity; execution reports both proposal and
execution fidelity and surfaces a mismatch instead of claiming control.
The `Why did the line move?` path uses only the latest reversible point action
from compact Agent inspection history; if that before-state is unavailable it
clarifies rather than inventing a replacement point. The resulting branch
remains visible in the normal Experiment Bar and its evidence remains the
shared Evidence surface. Existing TeachingPlan and Visualization Script
tooling is retained under an Advanced section. Persistent Exploration Threads,
background tutoring, parameter sweeps, and a general Scenario Engine remain
out of scope.
