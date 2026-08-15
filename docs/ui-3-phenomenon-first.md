# UI-3 — Phenomenon-first L0

UI-3 makes the first Explore Playground view answer: “What happens when I
change this World?” The default editable 2D surface combines the World points
and the existing model-response primitives in one canvas, with Move, Draw, and
Erase as the first visible tools.

## Presentation contract

`derivePhenomenonCapabilities(snapshot)` is a presentation capability adapter.
It requires an attached model, a two-dimensional World, the existing editable
World operations, a scatter primitive, and an existing model-response
primitive. It does not create semantic state or identify models by name.

The `DataWorkspace` `variant="phenomenon"` reuses the existing pointer gesture
boundary and `APPLY_WORLD_TRANSACTION` actions. Its canvas renders the same
JSON snapshot primitives through `rendererByPrimitiveType`; it does not
calculate slopes, predictions, boundaries, or residuals in React.

## Disclosure and compatibility

The initial view hides Data/Model tabs, World Builder controls, precise fields,
distribution controls, training controls, formula, evidence, Agent, and
Training Microscope. `More world tools` reveals the existing Data Workspace and
World Builder, and the existing Model view remains available there. Details
and the broader Explore compatibility region remain collapsed by default.

The initial Experiment Bar is a compact `A / My experiment / Try another`
presentation while retaining the existing Duplicate, Reset, Compare, Repeat,
Undo, and comparison semantics after the workspace becomes more complex.

## Fallbacks and responsive behavior

Playgrounds without an attached model, a two-dimensional editable World, or a
model-response primitive retain the existing Data/Model compatibility path.
Compact presentation uses the same responsive capability contract and the
same World coordinates and transaction semantics as the full workspace.

When Compare is enabled, both the Phenomenon and full Data surfaces select the
runtime comparison bounds whenever their x/y projection matches. Outside a
matching comparison frame, each surface may use its own presentation-specific
auto-bounds. First-manipulation telemetry is committed only after a human
World transaction resolves successfully; rejected transactions, Agent
actions, previews, and telemetry-adapter failures do not claim the session's
single event.

The question is localized and uses a registered Big Idea question when the
Playground was entered through a Big Idea. Big Idea initialization, provenance,
seeds, Agent inspection, evidence, and Experiment runtime remain unchanged.

UI-4 Experiment Bar 2.0, UI-5 conceptual Evidence/Mechanism navigation, UI-6
Agent navigation, UI-7 motion/polish, and Phase 9 are intentionally deferred.
