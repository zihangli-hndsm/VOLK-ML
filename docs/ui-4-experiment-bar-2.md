# UI-4 — Experiment Bar 2.0

UI-4 presents the existing Experiment Workspace as a learner-facing
scientific notebook strip. It does not create a second experiment state model.

## Presentation contract

The one-experiment state is intentionally small:

`A My experiment → Try another`

After `DUPLICATE_EXPERIMENT`, the active branch is shown as `B My experiment`
and the preserved branch as `A Original`. The labels are presentation aliases;
runtime experiment IDs, lineage, World state, and comparison state remain
authoritative in `experimentWorkspace`.

Experiment selectors dispatch `SWITCH_EXPERIMENT`. Compare dispatches
`SET_COMPARE`, and Changed / Held constant / Clarity are rendered only from
the resulting deterministic `comparison.diff`. Metrics remain available behind
the secondary results disclosure. Repeat, Undo, and Reset are secondary
actions; Repeat remains the existing `REPEAT_EXPERIMENT` operation and keeps
its condition-fingerprint lifecycle.

The compact one-experiment disclosure retains canonical Undo whenever the
runtime exposes `canUndoExperiment`. With three or more experiments, the bar
adds an explicit `Compare with` target chooser using presentation aliases;
`againstExperimentId`, the resulting diff, and comparison bounds remain owned
by the runtime. Learner-facing names progress from `A My experiment`, to
`A Original / B My experiment`, then `A Original / B Experiment 2 / C
Experiment 3` (and so on) without mutating experiment IDs. Mixed comparisons
are presented from the runtime clarity signal and changed-factor list.

## Responsive behavior

Wide and medium layouts use compact learner-facing branch chips. Compact
layouts use a horizontally scrollable, keyboard-accessible selector strip
inside the Experiment Bar; it does not create a second semantic state or
horizontal document overflow. The World remains above the bar and remains the
primary surface.

## Truth and telemetry

Compare continues to use the runtime shared comparison bounds, including the
UI-3 Phenomenon surface. Committed Duplicate, Compare, and Repeat actions may
emit the existing vendor-independent semantic telemetry events only after the
runtime action resolves. Telemetry is fail-open and contains no experiment
contents, coordinates, IDs, or learner text.

UI-5 conceptual depth navigation, UI-6 Agent navigation, UI-7 substantial
motion/polish, and Phase 9 remain deferred.
