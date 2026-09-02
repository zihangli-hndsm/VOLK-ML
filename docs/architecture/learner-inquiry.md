# Learner Inquiry Engine

## Stability contract for Goal 2–7 projections

Learner Inquiry consumes the same bounded semantic facts as comparison,
Concept Cards, Causal Inquiry, and trajectory evaluation. A comparison keeps
both `semanticChangedPaths` (the exact normalized leaves used for fidelity)
and `semanticFactorPaths` (the canonical property-level intervention identity
used for one-factor presentation and rates). Vector components belonging to a
single semantic property are grouped only in the latter projection; an extra
group, split, control, or property still creates an additional factor. The
coarse `changed` domains remain useful for display but are not a truthfulness
boundary.

Semantic Event actors are trusted provenance: only explicit `human` events
count as learner behavior in inquiry and trajectory metrics. `agent` and
`system` events remain available as runtime facts but cannot create learner
concepts, duplicate/compare rates, or independent-exploration signals.

The Host owns the session-local presentation context (conceptual depth and
bounded surfaced concept IDs) and validates concept/suggestion lifecycle
events against the current inquiry projection. UI and Agent callers cannot
install candidate concepts, suggestions, or presentation outcomes by ID.
Suggestion access is read-only until the existing plan → compose → validate →
dry-run → fidelity → explicit execution path is used.

Current causal inquiry is relationship-bound: supporting event IDs must be in
the bounded current event log and belong to the active comparison pair when a
comparison is active. A mixed comparison is reported neutrally as a mixed
comparison pattern; it is not renamed as an unverified causal condition.

Semantic and presentation event windows are bounded, while session-local
aggregate counters preserve completed human actions and guidance outcomes
after older events are evicted. These counters are not telemetry or a learner
profile and are reset when a Playground session is opened, restarted, or
closed.

## Goal 7: learner trajectory and evaluation

Goal 7 adds a bounded local-session `inquiryTrajectory` projection for product
evaluation. It measures completed exploration process, not learner ability,
mastery, causal understanding, chat length, or card-click volume.

The projection combines completed Semantic Events, explicitly recorded
presentation events, and existing Exploration Thread entry kinds. Its current
aggregate signals are:

- time to first meaningful **human** World/control manipulation;
- whether a second Experiment was created, Duplicate/Compare/Repeat use, and
  the canonical one-factor comparison rate;
- concept-card, depth, and explicit suggestion surface/engagement outcomes;
- whether a later human semantic action followed surfaced guidance (a process
  signal for independent exploration, not a mastery claim); and
- bounded question/prediction/follow-up-question counts from the active Thread.

The presentation store is local to the open Playground session and has a fixed
event bound. It retains only a known event type, timestamp, and the latest
Semantic Event sequence at presentation time. It excludes learner text, point
data, World factors, Experiment IDs, card content, suggestion content, model
results, provider output, project JSON, and telemetry vendors. It never
dispatches a semantic runtime action. Normal snapshots and Agent inspection
expose the same aggregate `inquiryTrajectory` projection.

This is deliberately an evaluation seam, not an optimization target. Any
future external reporting must remain opt-in and export only a separately
reviewed aggregate contract; it must not treat clicks or chat volume as the
success metric.

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

Sampling Variability is now an evidence-gated inquiry concept. It is eligible
only when the local Episode 1 detector verifies a same-World, different-sample
comparison with two current fits; `valid-weak` evidence remains a repeat
prompt and does not imply understanding or mastery.
