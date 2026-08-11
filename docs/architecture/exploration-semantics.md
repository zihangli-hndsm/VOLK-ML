# Exploration semantic foundation

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
