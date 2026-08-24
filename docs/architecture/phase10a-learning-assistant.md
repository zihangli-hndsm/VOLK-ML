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

The learner-facing Agent sheet uses one shared prompt with three explicit
modes: Ask VOLK, Design experiment, and Generate World. Ask remains the
answer-only path above. Experiment and free-form World requests use their
existing bounded interpreters and produce reviewable proposals. The Rings,
Moons, XOR, and Checkerboard presets work without a provider, but they also
produce a proposal and never execute directly. The primary surface does not
embed a second advanced request box.

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
and secret-like values and is never part of runtime or project state. Provider
model request profiles are applied by the shared gateway adapter: native
OpenAI/Responses and compatible transports remain distinct, and Gemini
profiles omit unsupported sampling fields rather than sending a guessed
configuration. The connection probe uses that same gateway path as Ask and
Agent requests.

Diagnostics retain only bounded stage/status/model metadata. They never retain
prompts, request bodies, raw provider responses, hidden reasoning, or API keys;
the configured key is redacted by exact value before provider messages are
shown or copied. Recent request traces are limited to lifecycle markers such as
request-started, provider-response, parse, validation, fallback, and
completed/failed.

## Stable answers, annotations, and context

Learning conversation turns receive Host-owned session-local message IDs.
Selection anchors reference the semantic surface and message identity, so a
selection from answer A cannot attach to answer B. Concept, Evidence, and
Agent-answer surfaces use the same bounded annotation actions. “Ask about
this” carries a stable anchor and bounded quote into Ask VOLK, while the
learner can remove the attached selection before sending the question.

The “What VOLK knows” disclosure is a semantic projection of task, model,
depth, concepts, comparison, and bounded annotation counts. It intentionally
does not expose raw World data, coordinates, rows, documents, tokens,
Experiment internals, or credentials. Deterministic Observation/Evidence
content remains visible while optional AI interpretation is rendered as a
separate diagnostic/interpretation layer.

## Deliberate non-goals

This slice does not implement adaptive curriculum, learner ability or mastery
inference, video retrieval, long-term memory, new model/domain capabilities,
automatic experiment execution, or unrestricted generation. Those require a
separate accepted design.

## LUMI guidance integration

The LUMI layer is a visual companion to Phase 10A, not a replacement for Ask
VOLK. Ask VOLK remains answer-only, while the LUMI guidance surface presents
existing factual observations, grounded conceptual relevance, and learner-
reviewed next steps. It does not receive authority to execute an experiment or
invent a result.

LUMI keeps its Navy/Cyan identity with limited Orange intervention accents.
Purple and Green belong to Concept Cards and their explicit session-local
learning state. The signature Purple → Orange contact → Green → Cyan
confirmation sequence is driven by a real `active` → `illuminated` state
transition, with a static reduced-motion equivalent. No concept mastery,
adaptive curriculum, persistence, or new provider context is introduced by
this presentation integration.
