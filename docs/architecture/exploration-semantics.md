# Exploration semantic foundation

## Phase 10A — embedded learning assistance

The embedded Ask VOLK surface is an answer-only presentation layer over the
existing Host and Agent contracts. Its provider context is a bounded semantic
projection; raw World observations, coordinates, imported rows, secrets, and
runtime operations never cross the provider boundary. A returned answer may
contain a learner-facing experiment question, but it is not a proposal and
cannot execute or authorize a mutation.

Learner annotations are session-local, bounded, and attached to registered
semantic surfaces. They are optional learner signals, not canonical runtime
facts. Their stable anchors and selected quotes are validated before storage.
Provider/model presets and staged connection diagnostics are likewise
presentation/configuration concerns and do not change the runtime authority
boundary.

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
Two-dimensional WorldRecipe realization publishes canonical `x`/`y` feature
names together with generated feature maps, so adapters never receive a stale
source-specific feature declaration such as `x1`/`x2`.

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
all-data training behavior. Later slices added KNN classification and bounded
two-dimensional binary-classification MLP synchronization through the same
adapter boundary. MLP rejects incompatible Worlds atomically and resets stale
training playback when a valid World is applied.

Workspace view state is separate from the Experiment. `SET_WORKSPACE_VIEW`
updates validated bounds and Train/Test visibility without changing the World,
Experiment semantic fingerprint, or World action history. `boundsMode`
(`auto`/`manual`) and `equalScale` are session-only view fields: zoom uses a
manual centered frame, Fit and feature changes restore auto bounds, and equal
scale expands the shorter axis to preserve one-unit geometry. Axis ticks and
pointer mapping consume the same effective bounds. Experiment branches and
Experiment Undo retain projection/layer choices but omit camera bounds, Fit
revision, and 1:1 state, so restoring semantic work cannot move the learner's
current camera.

Phase 1.1 deliberately does not include an Experiment Bar, generators,
Scenario execution, or persistence. The accepted Phase 1.2 Data Lab slice adds
the learner-facing Point/Brush/Spray and selection controls over this same
transaction boundary; later compatibility work added editable KNN and bounded
binary 2D MLP adapters without changing the operation registry.

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
selection. An attached adapter opts into World synchronization through
`applyWorld()`. Linear Regression accepts regression Worlds, KNN accepts
classification Worlds, and MLP accepts exactly two numeric features with two
labels represented in the explicit training split.

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

## Grounded Concept Cards

`src/core/exploration/concepts.js` contains a small versioned catalog whose
learner copy is localized in `src/locales/ui.js`. `deriveConceptSignals()` is
the only owner of concept IDs: it accepts verified pedagogical observations,
the runtime comparison, and exact execution fidelity, then emits bounded
direct signals with evidence references and registered reason codes. It never
uses playground or model identity as a shortcut, and partial comparisons do
not produce comparison concepts.

Signals are ordered intervention-first, then exact held-constant evidence,
then the generic controlled-comparison concept. The Agent result surfaces at
most one new card per in-memory exploration session; repeated IDs are kept in
a small presentation-only exposure list. Thread observation metadata is
derived at the Host boundary and validated against the same catalog. Provider
or UI input cannot author concept IDs, definitions, metrics, or causal claims.

## Semantic Event Foundation

`src/core/exploration/semanticEvents.js` provides a bounded, local-session
record of completed semantic exploration actions. It is presentation context
for deterministic inquiry work, not analytics, project persistence, or a
second runtime. `createPlaygroundHost()` derives drafts only after the normal
runtime action has succeeded, then appends canonical JSON-safe events to its
in-memory store. A failed runtime action therefore records nothing, and event
recording is fail-open so it cannot block a successful semantic commit.

The v1 event vocabulary is intentionally small: experiment duplication,
registered control factor changes, completed World transactions, completed
comparisons, completed repeats, and Observation Detector notices. Actor
provenance is explicit: UI dispatches mark learner actions `human`, Agent
execution marks them `agent`, and omitted or internal Host/runtime work is
projected as `system`. The event layer never defaults unknown work to learner
behavior, while leaving existing runtime action/Undo defaults untouched.

`experiment.factor-changed` uses the same canonical experimental-condition
policy as Experiment comparison. View/inspection controls and derived model
values such as weight and bias are not experiment factors merely because a
runtime control changed. Registered learning, model, and evaluation condition
controls retain their comparison-factor identity, with the specific control key
as a bounded reason code.

World events retain bounded factor references such as Train/Test observations,
Train/Test input, sample count, noise, outliers, relation, seed policy, or
generator realization. Those factors are derived from registered World
operations and current membership only; they never retain point IDs,
coordinates, raw observations, pointer paths, condition fingerprints, prompts,
DOM references, or runtime mutation objects. Continuous tools already
materialize one World transaction on gesture completion; the event layer records
that one semantic intervention rather than individual pointer updates.

Undo and Redo preserve that same factor identity. When a World history entry is
created, the runtime derives a bounded factor projection from its canonical
forward operations. Semantic Event derivation reads that projection from the
entry being reversed or replayed; `UNDO_WORLD_ACTION` and
`REDO_WORLD_ACTION` are control-flow metadata only, never the source of World
meaning. This also means undoing the first World action emits a truthful event
even though the resulting `past` history is empty. The event retains only the
bounded factor references and Undo/Redo metadata, never the entry's
forward/inverse transactions, IDs, snapshots, or raw World values.

The store retains at most 100 ordered events per open Playground session and
resets when that session closes. It is visible in normal snapshots and the
Agent inspection context for future deterministic inquiry derivation, while
the detailed existing `recentWorldActions` contract remains unchanged.
Observation events use a lifecycle identity of detector ID, relevant Experiment
IDs, and relevant observable references. The store records appearance once,
suppresses persistent detector output (including insignificant evidence-value
changes), clears active identity when the notice disappears, and records a new
event if the same observation later reappears. It does not expose a separate
cleared-event type in Goal 1.

An injected store-shaped seam (`reset`, `append`, `snapshot`) supports a later
layered persistence provider without adding cloud, account, project-format, or
telemetry changes here. Goal 1 deliberately does not classify learners, match
concepts, display cards, or invoke an AI provider.

## Goal 2 — Learner inquiry projection

The local Semantic Event history now feeds a deterministic, bounded Learner
Inquiry projection (`docs/architecture/learner-inquiry.md`). The projection
matches only inspectable event and Observation Detector evidence; it does not
infer causes, rank learners, invoke AI, execute experiments, or create UI
cards. Runtime snapshots and detached Host inspection expose the same
JSON-safe candidate contract so a later presentation layer can remain a
consumer rather than a second source of truth.

## LUMI semantic learning presentation

LUMI is a presentation guide layered over the existing semantic event,
observation, inquiry, and suggestion projections. It does not create a second
source of truth. `deriveConceptState()` maps an explicitly identified concept
to `unexplored`, `active`, or `illuminated`: inquiry relevance and grounded
signals are sufficient for `active`, while `illuminated` requires an explicit
session action. A model result alone is never treated as learner mastery.

The visual contract is intentionally asymmetric. Cyan marks observable facts
and attention; Orange marks an intentional intervention; Purple marks an
unresolved possibility or frontier; Green marks learner-confirmed
understanding; Navy provides structure. Guidance may combine these layers but
must label observation, hypothesis, and suggestion separately.

The LUMI UI is localized, keyboard reachable, responsive, and reduced-motion
safe. Its ambient/contextual mascot is an entry point around existing controls
and cannot obscure the World, Experiment, Evidence, or model surface. The
session-only illumination projection is cleared with the exploration session
and is excluded from project persistence and experiment identity. The visual
identity is a local asset set under `src/assets/lumi/`; semantic modes select
the asset while CSS owns only bounded float, focus, pulse, and illumination
presentation. A meaningful World/model intervention may produce one transient
Orange `intervene` pulse in the Experiment Bar, which is presentation-only.

### LUMI target binding and attention

The LUMI interaction layer in `src/core/ui/lumiInteraction.js` projects a
bounded `LumiTarget` (`evidence`, `concept`, or `experiment`) from the current
semantic snapshot. It is a view projection, not a second event system. The
interaction rail can connect an existing observation to an inquiry concept,
focus the changed experiment control for one transient pulse, and mark an
unexplored concept as a purple frontier. It does not explain the observation,
create evidence, execute experiments, claim causality, infer mastery, or choose
the learner's path. The Distribution Shift showcase makes the intended flow
visible as Observe → Intervene → Understand; the final green state remains an
explicit learner illumination transition.

### LUMI exploration journey projection

`src/core/ui/lumiJourney.js` is a bounded presentation projection over the
existing session semantic events. It maps human experiment/world interventions
to orange nodes, deterministic observation notices to cyan nodes, and existing
inquiry support links to Evidence → Concept connections. Explicit learner
illumination contributes only a session-local marker; `clearJourney()` resets
that marker for development and testing. The timeline does not create
evidence, execute actions, infer mastery, call Agent authority, or persist
memory. Unconnected inquiry concepts are displayed as a purple frontier and
are never selected or recommended automatically.

### Concept Graph & Causal Exploration Map

`src/core/ui/conceptGraph.js` is a bounded projection over the existing
Inquiry concept registry, Journey path, Evidence connections, active concept,
and explicit session illumination. It preserves the semantic color contract:
purple for unexplored frontier, cyan for current attention, green for learner
confirmation, orange for an active experiment relation, and navy for graph
structure. The Distribution Shift presentation uses the registered
`train-test-distribution-shift` and `generalization` concepts and their
existing related relationship; it does not create a new concept for the
visual example.

The graph does not infer `caused_by`, mastery, prerequisites, or new concepts.
Prerequisite and related edges are copied only from existing concept metadata,
while connected Evidence is shown from existing Journey `connect` events.
Clicking a node changes only local presentation focus. Concept Map and LUMI
cannot dispatch runtime actions, alter World/Experiment/Evidence, invoke Agent
planning, or persist a graph.

### Phase 11 — Learner Hypothesis projection

`src/core/exploration/hypothesis.js` defines a bounded, session-local learner
object: an authored statement, linked existing Concept IDs, one of `proposed`,
`testing`, `supported`, or `rejected`, and explicitly attached existing
Evidence IDs. `createdFrom` is always `learner`; the object has no AI author,
confidence value, truth score, causal assertion, or persistence path. Creation,
status changes, and Evidence binding are explicit UI actions. Binding Evidence
never changes status automatically.

The Concept Map projects Hypothesis nodes and neutral links between existing
Concepts, Hypotheses, and Evidence. It never creates `caused_by` edges or
derives a causal graph. Purple continues to mean possibility, cyan means
observed Evidence, orange marks active testing, and green is reserved for
explicit learner illumination of a Concept. A supported Hypothesis therefore
is not rendered as truth or mastery.

LUMI may point to an existing Evidence–Concept relationship and offer the
learner a hypothesis composer. Only the learner's submit action creates the
object. The local state is cleared with the exploration session and is not
included in World, Experiment, Evidence, Undo/Redo, project JSON, Agent
authority, or Journey source events; Journey and Concept Map merely project it
alongside the existing path.

### Concept Graph truth-boundary hardening

`conceptGraphRelationSemantics()` is the single presentation contract for
relationship direction. `prerequisite` and any future explicit `caused_by`
source remain directed; `related` and `observed_with` are rendered with a
symmetric connector. Deterministic `from`/`to` ordering may still be used for
deduplication, but it has no semantic direction for undirected relations.

Concept Graph membership is derived only from semantic seeds and registered
relationship expansion: Inquiry, Journey, active Concept, explicit
illumination, and session Hypothesis links. `selectedConceptId` is normalized
after membership is derived. A stale or otherwise absent selection becomes
`null` and cannot reintroduce a registry Concept, create neighbors, or change
semantic state.

### Phase 11B — Evidence provenance and Hypothesis binding

`src/core/exploration/evidenceProvenance.js` adds a bounded, session-local
Evidence instance projection beside the canonical Semantic Event stream.
Detector `reasonCode` values remain repeatable categories, never historical
Evidence identities. Each instance receives a stable session ID and retains
only bounded `experimentIds`, a condition fingerprint, semantic sequence,
observation time, detector metadata, and a bounded evidence snapshot. The
projection is reset with the event store and is not persisted, included in
World/Experiment fingerprints, or exposed as Agent authority.

Hypotheses accept only these stable instance IDs. Evidence binding is an
explicit learner selection through the Evidence Picker; attaching evidence
does not change Hypothesis status. Concept Map and LUMI resolve historical
instances directly: missing or stale IDs render as unavailable and are never
replaced by a current notice with the same reason code. LUMI may focus an
available instance and invite attention, but cannot select, attach, or infer
status. The canonical Semantic Event payload remains free of raw evidence
values.
