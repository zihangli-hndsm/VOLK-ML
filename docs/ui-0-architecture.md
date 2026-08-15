# UI-0 — Architecture and Information Hierarchy

UI-0 prepares presentation seams without changing the Playground runtime or
redesigning the visible shell. The semantic source of truth remains the
unified Playground host: World, Experiment, model state, evidence, traces,
condition fingerprints, and Agent provenance are not copied into UI state.

## Current responsibility map

| Current surface | Responsibility today | UI-0 destination |
| --- | --- | --- |
| Global `Workspace` toolbar | navigation, project actions, Builder entry points | Context / global and Build |
| Playground stage / Data Workspace | inspect and manipulate World observations | World manipulation |
| Playground Inspector | model, learning, evaluation, and view controls | Evidence / Mechanism; Build for engineering controls later |
| Experiment Bar | Duplicate, Compare, Repeat, Reset, Undo | Experiment |
| Evidence and observation cards | metrics, residuals, train/test, factual observations | Evidence |
| Training Microscope and timeline | loss, gradients, updates, learning progression | Mechanism |
| Exploration Agent and Threads | optional semantic acceleration and reasoning history | Explore / Evidence; authority remains runtime |
| Component library, graph, parameters, export | architecture and construction detail | Build |

The map is descriptive. Existing controls remain where they are during UI-0.

## Semantic versus presentation responsibilities

The Playground host and its domain helpers remain semantic/domain code: they
own World transactions, model actions, Experiment identity, evidence,
condition fingerprints, traces, and Agent provenance. `WorldBuilder`,
`DataWorkspace`, `ExperimentBar`, `ExplorationEvidence`, and
`TrainingMicroscopePanel` render or dispatch those capabilities; they do not
define alternate mobile or desktop meanings.

`PlaygroundPresentationBoundary`, the current shell wrappers, drawer widths,
tabs, and future bottom-sheet/side-by-side layouts are presentation code. They
may choose placement and disclosure, but must consume the same snapshot and
semantic actions. This keeps a future compact presentation from becoming a
second Experiment state tree.

## Explore and Build

`src/core/ui/uiArchitecture.js` defines two presentation surfaces:

- `explore`: learner-facing experimentation over shared runtime state;
- `build`: architecture, construction, and engineering detail over that same
  state.

`deriveUiPresentation({ snapshot, ...view })` is the adapter boundary. It
returns the view descriptor and the original runtime snapshot; it does not
create a second Project, World, or Experiment store. A future shell can route
the same snapshot to Explore or Build components without changing runtime
actions or semantic identity.

`PlaygroundPresentationBoundary` is the first current consumer of this
contract. It adds only stable `data-ui-*` presentation metadata around the
existing Explore content; it does not change the rendered hierarchy or runtime
actions. `UI_MIGRATION_SEAMS` names the planned hand-off points for the Context
Bar, World surface, Experiment Bar, depth disclosure, Agent entry, and Build
entry.

## Conceptual depth

The internal depth vocabulary is:

`phenomenon → evidence → mechanism → representation → builder`

These values describe the depth of the current question/interface, not a
learner level. They are semantic IDs and are not shown as `L0`/`L1` labels.
Future surfaces can disclose one depth at a time instead of rendering every
deeper panel simultaneously.

## Responsive presentation

`classifyPresentationCapabilities()` uses container width and optional pointer,
hover, and orientation capabilities. It classifies `compact` (<640 px),
`medium` (640–1023 px), or `wide` (1024 px and above). These are presentation
contracts, not device branches. The descriptor suggests future inspector and
compare presentations, but it never changes semantic state, World coordinates,
Experiment conditions, or action history.

The representative acceptance widths are 390, 844, 768, 1024, and 1440 px;
orientation and input capabilities are metadata, not alternate runtime paths.

## Telemetry boundary

`src/core/telemetry/explorationTelemetry.js` defines a vendor-independent,
JSON-safe semantic event contract. The vocabulary includes:

`exploration_opened`, `world_point_moved`,
`first_meaningful_manipulation`, `experiment_duplicated`,
`experiment_compared`, `repeat_requested`, `depth_evidence_opened`,
`depth_mechanism_opened`, and `guided_prompt_accepted`.

The default adapter is no-op. The memory adapter is intended for tests and
development. Events reject DOM-style names, unknown payload fields, raw
coordinates, arbitrary text, and other unbounded data. No vendor is integrated
in UI-0, and Agent conversations or imported dataset contents are not tracked.

## Intentionally deferred coupling

`main.jsx` still owns the Builder shell and its responsive drawer widths;
`UnifiedPlaygroundDialog.jsx` still composes Explore surfaces, while
`PlaygroundInspector.jsx` still mixes model controls with derived primitives.
These are known UI-1/UI-2 migration seams. Rewriting them now would risk
changing stable runtime semantics and is outside UI-0.

No mobile bottom sheet, Experiment Bar redesign, Agent redesign, new model, or
Phase 9 runtime/model expansion is included.
