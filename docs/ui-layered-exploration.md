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
