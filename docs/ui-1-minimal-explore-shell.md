# UI-1 — Minimal Explore Shell

UI-1 makes the existing Playground visibly World-first while preserving the
UI-0 presentation contracts and the Playground host as the only semantic
authority.

## Shell hierarchy

The first Explore view now has four explicit presentation regions:

```text
ExploreContextBar
    ↓
ExploreWorldRegion
    ↓
ExploreExperimentRegion
    ↓
ExploreDetailsRegion
```

The World/model stage is rendered before the Experiment Bar. Questions,
Guided Explore, evidence, Threads, Agent panels, timeline, Training
Microscope, formula, and presentation-adjacent teaching surfaces remain in a
single native disclosure region so they are reachable without competing with
the first phenomenon.

## Context Bar

`ExploreContextBar` keeps the title, description, source metadata, model
context, stale-source warning, close action, and a compact visible Run action.
Reset Learning, Restore Original Data, and Presentation Mode are behind the
keyboard-accessible More menu. Run remains visible in UI-1 because it is part
of the normal experiment loop; a later phase may move it closer to the World
controls without changing its semantic action.

`PlaygroundToolbar.jsx` remains a compatibility re-export to the new Context
Bar, so existing imports cannot silently recover the old crowded toolbar.

## Details and state ownership

The model Inspector is closed by default in `ExploreWorldRegion` and is opened
explicitly with the localized Details button. Its existing controls and
dispatch actions are unchanged. Data/Model tabs remain presentation state;
switching them does not create or copy a runtime session.

The new shell components contain no World, Experiment, model, evidence, or
Agent state. They receive the shared snapshot and dispatch existing semantic
actions. `PlaygroundPresentationBoundary`, `UI_SURFACES`, conceptual depth,
responsive capability, and telemetry contracts remain in use.

## Explicitly deferred

UI-1 does not implement UI-2 measurement or mobile presentation, bottom
sheets, touch gestures, Experiment Bar redesign, final progressive depth,
Agent navigation, animation, or Phase 9 runtime/model work.
