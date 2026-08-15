# UI-5 — Progressive Conceptual Depth

UI-5 adds a presentation-only depth grammar after the Phenomenon and
Experiment surfaces:

```text
Phenomenon → What changed? → How does it learn/decide? → Inspect the model
```

The active depth is local React presentation state in
`UnifiedPlaygroundDialog`; it is not stored in World, Experiment, project JSON,
Agent state, or runtime history. The `PlaygroundPresentationBoundary` exposes
the corresponding UI-0 conceptual depth without changing semantic state.

## Entrances and truth sources

- `What changed?` mounts `ExplorationEvidence` with its existing observables,
  notices, comparison facts, and repeat-evidence lifecycle.
- `How does it learn?` is available when the adapter exposes training
  microscope evidence. It composes the existing timeline, training trace, and
  formula. Models without gradient-style training use `How does it decide?`
  when their runtime exposes a decision timeline or formula.
- `Inspect the model` mounts the existing `PlaygroundInspector` in the same
  responsive presentation contract. It never creates a second control state.

Only one depth panel is active at a time. Compact layouts use a bottom sheet;
Medium/Wide layouts use a bounded right drawer. Closing or switching depth is
presentation-only and preserves World, Experiment, comparison, repeat, and
training state.

Big Idea questions, Guided Explore, Threads, and Agent surfaces remain
available under low-prominence compatibility disclosures. They are not
evidence or mechanism content, and Agent remains optional.

Depth opening emits the existing `depth_evidence_opened` or
`depth_mechanism_opened` semantic event at the presentation transition. The
telemetry boundary is fail-open and emits no learner text or runtime IDs.

## Capability limits

Depth entrances derive from the snapshot's deterministic evidence and adapter
capabilities. A model-free Data Lab exposes World exploration and evidence
only. KNN exposes its decision timeline/formula through `How does it decide?`
without presenting a fabricated training microscope. MLP may expose the
reduced training microscope capability already provided by its runtime.
