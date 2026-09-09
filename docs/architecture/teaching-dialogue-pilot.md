# Evidence-Grounded Teaching Dialogue Pilot v1

The pilot is a removable, Episode 1-only layer over the existing inquiry
runtime. It is disabled by default with `VITE_VOLK_TEACHING_DIALOGUE_PILOT`.
When enabled, the learner explicitly opts in from the Episode 1 panel.

## Authority and data flow

`World / Experiment / semantic events / deterministic Evidence`
remain authoritative. `projectTeachingDialogueContext()` creates a bounded,
read-only projection containing contract references, comparison and Evidence
fingerprints, up to eight facts, four learner-statement references, two
hypothesis references, the active prediction, and one open question. It never
contains raw observations, DOM state, screenshots, secrets, or executable
operations.

The existing Episode prediction is projected with the stable
`episode.prediction` reference and remains distinct from provisional tutor
hypotheses. Hypotheses carry learner-statement references, are capped at two,
and can be revised or retracted explicitly. Delayed provider completions are
discarded when a newer learner turn, stop, fit, comparison, or other semantic
context revision is observed.

`localTeachingDialoguePolicy()` returns one of six versioned moves:
`ELICIT_PREDICTION`, `ASK_FOR_REASON`, `OFFER_HINT`,
`EXPLAIN_WITH_EVIDENCE`, `REQUEST_TEACH_BACK`, or `SUMMARIZE_AND_PAUSE`.
The response validator accepts only the shared content-key allowlist and
evidence/question/statement references supplied by the current context.
Provisional hypotheses are explicitly tentative. Dialogue turns are bounded
session metadata and do not become semantic events, Evidence, concepts, or
mastery.

The host exposes additive methods (`optInTeachingDialogue`,
`requestTeachingDialogue`, `recordTeachingDialogueTurn`, and
`stopTeachingDialogue`) and an additive `teachingDialogue` snapshot field.
No method can dispatch a World, Experiment, model, or view action. Existing
Ask/LUMI and Cloud paths are unchanged; provider-off behavior is the authored
local fallback.

## Quality rubric and results

`TEACHING_DIALOGUE_AUTHORED_CASES` is the single registry for exactly twelve
authored cases: correct reason, correct/no reason, ambiguous same World,
Chinese misconception, English/mixed paraphrase, unavailable evidence,
unchanged result, mixed factor, hint/direct choice, rejected hypothesis,
delayed stop/switch, and schema injection. Every case declares allowed moves,
forbidden claims, forbidden actions, evidence requirements, an authored
rationale, and 0/1/2 anchors for groundedness, move relevance, learner choice,
and uncertainty handling. `check-teaching-dialogue-pilot.mjs` executes every
case and records deterministic boundary outcomes, plus dedicated provider,
stale-response, hypothesis-lifecycle, transfer, and flag-off assertions.
The current deterministic run reports all 12 cases as `passed`, with the
selected move and evidence requirements printed as JSON for review.

Fixture engineering: VERIFIED by the focused script and the repository check.
The cases prove schema, reference, authority, and boundary behavior; localized
content keys and move IDs do not prove natural-language teaching quality.

Live-provider quality: NOT VERIFIED. No provider, credentials, paid calls,
24-request sample, or independent reviewer were used. Provider failures remain
contained by the local fallback adapter.

Learning effectiveness: NOT ESTABLISHED. The pilot does not infer mastery,
retention, transfer success, or instructional impact.

## Local iteration

Start the app with `VITE_VOLK_TEACHING_DIALOGUE_PILOT=1`, open Episode 1, and
choose **Try guided reflection**. Use **Ask for a move** for a bounded local
prompt, answer a question when requested, **Let me try** to continue alone, or
**Stop guidance** to invalidate the current dialogue revision. Remove the
variable (or set it to `0`) to restore the existing Episode 1 surface exactly.
