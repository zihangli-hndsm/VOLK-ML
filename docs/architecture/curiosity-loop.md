# Curiosity Loop (Phase 10.1)

The Curiosity projection is a small deterministic layer over the existing
exploration contracts:

```text
Semantic Event     = a bounded fact about a committed semantic action
Learner Inquiry    = a bounded summary of the current exploration evidence
Concept Candidate  = a deterministic, evidence-backed related idea
Curiosity          = an unresolved exploration opportunity
Reflection         = a localized question about that opportunity
Opportunity        = a pointer to an existing safe depth/action capability
```

Curiosity is not confusion, lack of knowledge, ability estimation, or an AI
prediction of learner state. It does not claim that one factor caused an
outcome. It records that the current evidence leaves a bounded relationship
worth inspecting or testing further.

## Phase 10.1 contract

`src/core/exploration/curiosity.js` owns the versioned registry and pure
matcher. It consumes only:

- the bounded Semantic Event log;
- the current `learnerInquiry` candidates and active comparison;
- current observation identities already accepted by the Inquiry contract.

It does not inspect raw World observations, pointer events, prompts, model
payloads, or AI output. All retained references are bounded event or
observation IDs. Reflection questions are localization keys, not generated
prose.

The initial registry is deliberately limited to:

- `single-factor-mechanism-unclear`;
- `mixed-factor-comparison`;
- `distribution-shift-question`;
- `repeat-stability-question`.

Each entry points to an existing Inquiry concept and an existing safe action
direction such as mechanism depth, one-factor isolation, evidence depth, or
repeat. The projection does not create or execute a runtime operation.

Only human-proven event sequences can create a learner curiosity opportunity.
System and Agent events may remain runtime facts, but cannot be treated as
learner curiosity evidence by this layer.

The Host derives Curiosity beside the normal Inquiry projection. Normal
snapshots and `inspectContext()` therefore share the same deterministic
projection. Capability resolution is a separate pure step: a reflection can
remain factual when its existing depth, proposal, or repeat capability is not
available, but no unsupported action is exposed as an opportunity. The
provider-facing projection contains only bounded gap/concept IDs,
localization keys, action directions, and capability names. It deliberately
omits supporting event/observation references and Experiment IDs. AI may
phrase or discuss a supplied opportunity, but cannot create new curiosity
types, concept IDs, evidence, metrics, or causal conclusions.

Curiosity priority is deterministic: a mixed-factor comparison outranks a
distribution-shift question, which outranks repeat variation, which outranks
the generic single-factor mechanism question. Supporting events must be human
events for the current comparison pair; Agent/system events and stale pairs do
not create learner curiosity.

This slice intentionally stops before learner-state inference, adaptive
curriculum, Concept Cards, and background AI decisions.
