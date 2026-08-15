# UI-2 — Responsive and Touch Foundation

UI-2 makes the existing Explore loop adapt to the measured Explore container
and input capability without creating a second semantic state tree.

## Capability boundary

`PlaygroundPresentationBoundary` owns one presentation-only measurement seam.
`useMeasuredPresentationCapabilities` observes its container with
`ResizeObserver` and listens to pointer/hover media queries. The resulting raw
metadata is classified by the existing `classifyPresentationCapabilities`
contract into `unknown`, `compact`, `medium`, or `wide`. Container height is
used only to derive portrait/landscape orientation when no explicit orientation
is supplied. User-agent detection is not used.

The first render can remain `unknown`. Changes to width, height, orientation, or
pointer capability update presentation metadata only; the Playground snapshot,
World, active Experiment, comparison, undo history, Agent state, and training
state remain owned by the existing host.

## Layout behavior

- Compact uses the available viewport, removes the extra modal card treatment,
  wraps the Context and Experiment controls, and keeps secondary content inside
  the viewport.
- Medium and Wide retain the World-first UI-1 structure.
- Inspector remains closed by default. When opened it is a bottom sheet on
  Compact and an approximately 300px overlay drawer on Medium/Wide. Its open
  state is presentation-only.

## Touch policy

The Data Workspace keeps its existing Pointer Events transaction boundary:
pointer capture and one completed gesture still produce one semantic World
transaction. The interactive SVG continues to use `touch-action: none`, while
the rest of the Explore surface remains normally scrollable. Coarse pointers
receive larger effective point hit radii and CSS touch targets; the visible
World representation and semantic gesture operations are unchanged.

Point selection and erase hit testing project both the pointer and the World
points into the same local canvas-pixel space. Coarse input therefore gets an
approximately 22px screen radius regardless of World coordinate scale,
anisotropic feature ranges, or canvas display size; fine input retains a tighter
radius. The responsive frame itself stops
pointer, mouse, and touch propagation before events can reach the dark
backdrop, so only the backdrop closes the Playground.

The existing Experiment Bar, World Builder, secondary disclosures, evidence,
Agent, and Training Microscope remain the same capabilities with wrapping and
overflow containment added for narrow layouts. UI-2 does not introduce swipe,
hold-to-compare, a new Experiment Bar, or a new gesture language.

## Deferred work

UI-3+ work remains deferred: phenomenon-first control reduction, new beginner
defaults, Experiment Bar 2.0, conceptual Evidence/Mechanism navigation,
Agent-as-navigation, animation/polish, and Phase 9.
