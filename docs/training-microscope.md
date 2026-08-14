# Training Microscope

Phase 8 adds a bounded semantic view of real model-learning mechanics inside
the existing Playground. It is an optional depth layer: ordinary World,
Experiment, Compare, Repeat, Big Idea, Thread, and Agent flows remain usable
without opening it.

## Runtime contract

The first complete adapter is Linear Regression. Its actual training loop in
`linearRegressionAdapter` emits one `training.step` trace event for every
finite update that enters visible `training.history`, including the terminal
learning-rate-too-high step. Each event contains the run identity, objective
before and after the update, gradient evaluated at the before parameters,
learning rate, normalized-space delta, raw slope/intercept delta, raw
parameter state before and after the update, and an outcome/status. A stopped
terminal update remains visible because STEP/SEEK exposes it; the trace
describes that exact runtime behavior rather than calling it rejected. The
trace is emitted beside the update calculation, not reconstructed by React.

The optimizer operates in standardized feature/target space. The microscope
therefore labels the gradient/update space and also records raw parameters so
the visible fitted line can be checked against the `after` state. The
learner-facing loss trajectory uses the post-update objective, matching the
model state revealed by STEP/SEEK; a selected record shows both pre-update
and post-update normalized loss.

## View model and lifecycle

`deriveTrainingMicroscope()` is a JSON-safe, DOM-free projection of canonical
trace events. It is bounded to 100 steps, 12 parameter fields, 12 gradient
fields, and 8 preprocessing records. The current runtime step and current
model remain separate from a selected historical record; selecting an old
record in the UI is read-only and never rewinds the model.

Training records carry a deterministic session-local `runId` and condition
fingerprint. This avoids mixing successive runs while keeping identical
script/runtime traces reproducible across equivalent sessions. Changing a
learning condition clears the retained training history. World changes rebuild
the adapter state and therefore cannot present an old trace as current
evidence.

## Preprocessing and adapter capabilities

Linear Regression reports the runtime train/test split and z-score
normalization records already emitted by the adapter. If an adapter has no
registered transformation, the semantic result is an explicit empty
preprocessing list rather than an invented transformation. Adapter capability
metadata controls whether loss, parameters, gradients, and updates are shown.
MLP currently exposes a reduced view without fabricated gradients or weight
matrices; unsupported mechanics are shown as unavailable/reduced.

## Agent parity and limitations

The same `trainingMicroscope` snapshot is exposed through `inspectContext()`.
The Agent can inspect and explain recorded values but cannot author or modify
trace evidence. Exploration Threads may later record a compact microscope
observation; Phase 8 does not add a new Thread entry type. Activation probes,
full tensor/debugger views, optimizer comparisons, and generic preprocessing
pipelines remain future work.
