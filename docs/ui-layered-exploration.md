# Layered Exploration UI

The learner-facing Playground uses three presentation layers over the same
runtime snapshot and semantic actions:

## Play

The default surface keeps the World phenomenon, model response, Run, the
Experiment Bar, and the quiet Agent entry visible. Direct World gestures and
experiment actions remain manual and do not require the Agent.

## Tune

Tune is a presentation depth, not a second state store. It groups available
model controls by their registered semantic domain: World, Model, Learning,
and Evaluation. World editing continues through the existing full World
workspace, so the World and its observations are never copied into a Tune
model.

## Inspect

Evidence, Mechanism, and Inspect the model remain the existing UI-5 depth
entries. They open one responsive secondary surface at a time: a bottom sheet
on Compact and a stable approximately 300px drawer on Medium/Wide layouts.
Advanced Agent, thread, Big Idea, and developer-oriented surfaces remain
behind the existing compatibility disclosure.

The active layer is derived from the existing `activeDepth` presentation state.
Changing layers never dispatches a runtime action, changes a World, resets an
Experiment, or changes Agent authority. The existing motion contract and
`prefers-reduced-motion` behavior remain responsible for nonessential
transitions.

The shell publishes `data-ui-layer` markers for focused acceptance checks;
these markers are presentation metadata only.

## Contextual Tune

Playground descriptors may add bounded `presentation` metadata to a control:

```js
presentation: {
  importance: 'primary' | 'secondary' | 'advanced',
  roles: ['experiment', 'inspection'],
  explanationKey: 'playground.controlHint.someControl'
}
```

`domain` remains the semantic responsibility of a control; `importance` only
describes how prominently it should appear in Tune. The initial Tune view
shows descriptor-owned primary controls. Secondary and advanced controls are
grouped behind More controls and remain available in the full Inspector.

Current emphasis is declarative: KNN foregrounds `k`; Linear Regression
foregrounds learning rate and training steps; MLP foregrounds hidden units,
learning rate, and training steps. Controls without presentation metadata use
a bounded secondary fallback and are never removed.

When an enabled deterministic comparison exposes control-level values, Tune
marks the corresponding controls as Changed or Held constant. It does not
infer recommendations or causality, and no AI provider is involved.

The Changed/Held markers require exact control evidence on both comparison
sides. A factor-level unchanged label cannot mark every control in that
factor, and derived outputs or view controls remain unmarked when the runtime
does not expose exact control values. The playground registry validates this
metadata centrally and limits each playground to at most three primary
controls.

## Contextual Quick Control

A descriptor may additionally mark an experiment control with
`quickControl: true`; an optional `quickControlDefault: true` identifies a
unique fallback for a playground. Quick eligibility is separate from actual
selection. The pure Play selector first honors an active scenario/experiment
variable, then a single exact Changed control in the runtime comparison, then
one declared default. Ambiguous candidates resolve to no quick control.

World-only pedagogical scenarios are never mapped to an unrelated model
control, even when a comparison has a changed model control or a descriptor
declares a default. Explicit registered `SET_CONTROL` scenario variables are
still eligible. No AI ranking is involved. Play renders at most one compact
shared `PlaygroundControlField`; Tune and Play read the same snapshot value and
dispatch the same `SET_CONTROL` action. When no deterministic candidate exists,
Play renders no quick-control placeholder.
