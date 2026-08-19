# Learner Inquiry Engine

## Goal 6: causal/scientific inquiry concept pack

Goal 6 adds a bounded `causalInquiry` projection over the same Semantic Events,
Learner Inquiry candidates, exact comparison evidence, Repeat evidence, and
explicit Thread predictions already used elsewhere. It names a scientific
reasoning sequence without claiming that a measured outcome has a causal
explanation:

```text
observed pattern -> explicit hypothesis -> intervention
  -> controlled comparison / mixed comparison -> counterfactual -> repeat variation
```

An Observation Detector notice is an `observed-pattern`, never an association
or a causal conclusion. A hypothesis exists only when the learner already
recorded a Thread prediction. An intervention is a registered World/control
factor change. Controlled and counterfactual steps require the existing direct
exact-comparison candidates; a mixed comparison is explicitly a limit on what
the comparison isolates; repeat variation is an uncertainty-checking step.

The initial Causal World is an inspectable **design-only** contract rather
than a second runtime: it declares observable, intervenable, and latent
variables plus a post-comparison mechanism-reveal policy, but contains no
observations, operations, generated code, or Agent execution path. A future
materialization must enter through the normal finite World, registered
intervention, Experiment, comparison, and evidence contracts. Until that
exists, ordinary ML Worlds cannot claim a causal association merely from their
metrics.

The projection is local, JSON-safe, deterministic, visible in normal snapshots
and Agent inspection, and does not require an AI provider.

## Goal 5: optional background pedagogical AI

Goal 5 is an optional, event-triggered interpretation layer over the existing
deterministic inquiry pipeline. It has no authority over `World`, Experiments,
observations, concept candidates, or execution.

`deriveInquiryGuidanceTrigger()` only accepts a newly completed Semantic Event
which directly supports a current direct candidate. It is suppressed after the
same event has been handled, during a three-event local cooldown, and after a
bounded local-session interruption budget. Ordinary rendering never calls an
AI provider.

The strict provider response may choose only `ignore`, a current direct
concept, a prevalidated inquiry suggestion, or an already available conceptual
depth. Its context contains semantic candidate reasons, suggestion identifiers,
task/model family, inquiry stage, and available depths. It excludes raw World
observations, coordinates, event/Experiment identifiers, prompts, and runtime
objects. Provider output is independently validated; unavailable, malformed,
or invalid output falls back to the deterministic policy.

An AI suggestion remains a presentation choice. Any executable teaching goal
continues through planning, composition, validation, dry run, fidelity, and
explicit learner execution. The default is `ignore`; the deterministic fallback
only surfaces a directly related, already valid suggestion. This keeps guidance
quiet and preserves no-provider/manual parity.

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

## Goal 3 — quiet Concept Cards

Goal 3 consumes the Goal 2 candidate contract through a pure presentation
projection. It surfaces at most one compact, dismissible card in the Play
experiment region. The card contains the catalog title and summary, a
deterministic “Why this appeared” list, an optional non-causal explanation,
and one presentation-only action to open the existing Evidence depth.

The Explore dialog owns a bounded session-only exposure list. A concept is
shown at most once per session, and all candidates supported by the same event
cycle are suppressed after one card has appeared. Dismissal does not mutate the
World, Experiment, comparison, Agent, Thread, or inquiry matcher. New card
display stays deliberately separate from the older Agent-result Concept Card;
both consume deterministic contracts and neither lets callers or AI author a
canonical concept.

Goal 3 adds no LLM call, TeachingGoal, suggestion execution, or permanent
concept panel. Goal 4 may add structured inquiry suggestions, but must reuse
the existing validated TeachingGoal/Scenario paths rather than make this card
an execution authority.

## Goal 4: deterministic causal-inquiry suggestions

Goal 4 adds a small `InquirySuggestion` projection. It consumes only direct
Goal 2 candidates plus the current inspected World/model capabilities. It is
not a recommendation model, an LLM result, an executable Scenario, or an
additional experiment runtime.

```text
direct inquiry candidate + registered capability
  -> bounded InquirySuggestion
  -> learner elects to inspect or execute
  -> existing TeachingGoal / TeachingPlan / Composer / dry run / fidelity / Runtime
```

Each suggestion contains a localized question and hypothesis-to-test, one
intended intervention, bounded intended holds, task-appropriate existing
observable IDs, related inquiry concepts, and a reason code. It never asserts
that its hypothesis is true. At most two suggestions are returned.

V1 has two deliberately distinct routes:

- A direct distribution-shift or generalization candidate can offer an
  inspectable **manual World** suggestion: change only Test input support while
  holding Train input, model, learning, evaluation, and randomness policy
  fixed. It is not forced into a model-control TeachingGoal.
- A generalization candidate can offer a **TeachingGoal** capacity comparison
  only if a model-owned registered control explicitly declares
  `presentation.inquiryRole: 'capacity'`. The current MLP `hiddenUnits`
  descriptor is that declaration. The goal is validated by the existing
  `compare-control` planner; a learner-approved use continues through the
  established plan, composition, validation, strict dry run, fidelity, and
  explicit Script Runtime path.

No React model-ID branch, AI ranking, inferred causal importance, automatic
execution, or new TeachingGoal taxonomy is involved. Suggestions are derived
again from the Host's own snapshot in `suggestInquiry()`, so an API caller
cannot install arbitrary suggestions as canonical runtime state.

Goal 5 remains deferred: no background AI interpretation, candidate ranking,
or interruption policy is included here.
