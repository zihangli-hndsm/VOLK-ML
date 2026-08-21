# Phase 10A — Embedded Learning Assistant

Phase 10A adds a small answer-only learning surface to the existing
Exploration Agent. It does not add a second runtime, a new World operation, or
an AI execution path.

## Boundaries

The learner-facing path is:

```text
Ask VOLK question
  -> bounded learning-assistant context
  -> structured answer
  -> optional learner-reviewed experiment question
```

The answer is conceptual language only. It cannot dispatch actions, mutate a
World or Experiment, create a ScenarioSpec, or claim that an experiment was
run. The existing Agent proposal and explicit execution boundary remains the
only route to semantic experimentation.

The provider receives a projection of the current task/model, conceptual
depth, comparison summary, inquiry concepts, active annotations, and a short
conversation window. It does not receive API secrets, raw observations,
coordinates, imported rows, or executable operations. The projection is
JSON-safe and bounded before it reaches the gateway.

## Learner annotations

`src/core/exploration/learnerAnnotations.js` is a session-local v1 store for
small learner signals attached to registered surfaces. An annotation has a
bounded kind (`understood`, `unclear`, or `ask-about-this`) and a stable
semantic anchor, never a DOM node or arbitrary object. Annotation provenance is
always human at this boundary. The store is capped and resolved annotations
are retained only in the local snapshot for the current session.

## Provider configuration and diagnostics

`src/core/ai/providerPresets.js` is the data-driven catalog for the primary
provider/model choices. Presets are advisory, contain no secrets, and do not
remove custom model or advanced endpoint configuration. Native OpenAI uses the
Responses protocol; compatible providers retain their existing transports.

`Test connection` runs a short staged probe without learner context:
configuration, network, authentication/model access, basic text, structured
output, and the existing Exploration interpreter. Failures are normalized to
bounded diagnostic codes. Diagnostic text redacts authorization, key, token,
and secret-like values and is never part of runtime or project state.

## Deliberate non-goals

This slice does not implement adaptive curriculum, learner ability or mastery
inference, video retrieval, long-term memory, new model/domain capabilities,
automatic experiment execution, or unrestricted generation. Those require a
separate accepted design.
