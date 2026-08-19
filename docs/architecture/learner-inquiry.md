# Learner Inquiry Engine

## Goal 2: deterministic inquiry projection

The Learner Inquiry Engine is a local, presentation-neutral projection over
the existing Semantic Event log, Experiment comparison state, Observation
Detector notices, Repeat evidence, and explicit Exploration Thread prediction.
It is not a second World, Experiment, Agent, or learner-profile state machine.

```text
completed runtime action
  -> bounded Semantic Event
  -> deterministic inquiry projection
  -> inspectable concept candidates
```

The projection is rebuilt from current runtime facts. It stores only bounded
event IDs, observation IDs, comparison factor names, reason codes, and an
already-recorded explicit prediction. It does not retain raw point data,
coordinates, DOM state, prompts, model output internals, or causal claims.
It remains local to the open Playground session because its source Event log is
local-session state.

## Inquiry state contract

`deriveLearnerInquiryState()` returns JSON-safe data with:

- recent Semantic Event IDs;
- active comparison identity and changed/held canonical factors, when one is
  currently enabled;
- deterministic candidate concepts with event/observation references;
- bounded IDs of concepts previously surfaced when an owning presentation later
  provides them;
- an inquiry stage (`exploring`, `comparing`, `observing`, or `repeating`);
- an explicit Thread prediction only when one already exists; and
- an explicitly supplied conceptual depth, never one inferred from UI activity.

Normal Playground snapshots expose this as `learnerInquiry`; detached Host
inspection exposes the same projection at `exploration.learnerInquiry`.

## Declarative, evidence-gated registry

The bounded V1 registry has six concepts: controlled comparison, mixed-factor
comparison, train/test distribution shift, generalization, stability, and
counterfactual reasoning. Every declaration defines localized title/summary
keys, evidence requirement codes, prerequisites, related concepts, and bounded
possible next inquiry actions. It is neither a learner ranking nor a lesson
order.

The matcher emits only `direct` candidates. Each candidate contains a concept
ID, supporting Semantic Event IDs, supporting Observation Detector IDs, and a
bounded reason code. It does not calculate a probability and does not make a
causal claim.

Current direct rules include:

- a duplicated baseline plus an authoritative one-factor comparison for
  controlled comparison and the counterfactual reasoning pattern;
- an authoritative mixed comparison for mixed-factor comparison;
- a Test-side World change plus `COVERAGE_MISMATCH` for distribution shift;
- a Test-side World change plus `TEST_ERROR_CHANGED_MORE` for generalization;
- a completed Repeat plus `REPEAT_VARIATION` for stability.

Metric notices without a relevant Test World event do not produce a
distribution-shift or generalization candidate. A historical detector event is
not enough: its matching notice must still be active in the current runtime
snapshot, and a comparison notice must reference the current Experiment pair.
Repeat completion alone does not claim variation. These are observations and
inquiry opportunities, never proof that one condition caused a result.

## Boundaries and next slice

No UI card, concept exposure action, LLM call, experiment execution, Teaching
Goal, or suggestion is introduced here. Goal 3 may use this same deterministic
candidate contract to decide whether to surface one quiet Concept Card. It must
not replace the matcher or accept caller-authored concept candidates.
