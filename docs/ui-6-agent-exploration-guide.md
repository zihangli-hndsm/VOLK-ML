# UI-6 — Agent as Exploration Guide

UI-6 adds a quiet Agent entry to the existing Explore depth surface. It does
not add a second runtime, experiment store, or navigation system.

## Presentation contract

When an Agent API is available, the learner sees `Ask about what you see…`
below the phenomenon, experiment, and UI-5 depth entrances. The entry is
closed by default. Compact layouts render the guide as one bottom sheet;
medium and wide layouts use a bounded side drawer. Opening it closes the
currently active UI-5 depth so there is only one secondary overlay.

When no Agent is configured, the entry and surface are absent. Phenomenon,
experiment, Guided Explore, and UI-5 depth paths remain complete without AI.

## Structured guidance

The presentation parser resolves a question into one of four bounded outcomes:

- `open-depth`: call the normal Evidence, Mechanism, or Inspect-model entry;
- `experiment-proposal`: call the existing `proposeExploration()` API;
- `explanation`: present bounded facts already in the runtime comparison;
- `clarification`: ask the learner to be more specific.

Depth transitions call the same `onDepthChange` boundary used by UI-5 and
therefore preserve runtime identity and existing depth telemetry. Experiment
questions produce a ScenarioSpec proposal only; the runtime changes only when
the learner explicitly chooses `Try it`. Execution remains atomic and uses the
ordinary Experiment/World runtime. Advanced Agent and thread tools remain
reachable under secondary disclosures.

## Truth, privacy, and limitations

Agent guidance reads `inspectContext()` and existing deterministic snapshots.
It does not receive DOM selectors, CSS, raw pointer coordinates, or a private
runtime state. The compact guide has a bounded local fallback; the existing
advanced AI interpreter remains available in the advanced tools. No thread is
created automatically and Agent-generated observations retain the existing
Phase 6 authority rules.

KNN uses the existing decision mechanism label and does not display Training
Microscope content without runtime training capabilities. The guide is a
presentation layer only; UI-7 motion and the later Agent navigation redesign
remain deferred.
