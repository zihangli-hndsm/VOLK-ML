# Phase 9 cross-domain exploration contracts

Phase 9 extends the existing exploration grammar beyond the 2D tabular
surface. This vertical slice keeps one shared World/Experiment/runtime path and
adds bounded executable Image, Sequence, Retrieval, and RAG surfaces. It does
not introduce a second runtime or expand World Composer.

## Domain contract

`src/core/exploration/domainContract.js` is the bounded vocabulary for
`tabular`, `image`, `sequence`, `retrieval`, and `rag`. A domain declares its
World kind, supported task kinds, coordinate spaces, conceptual depths, and
evidence families. The existing tabular World remains the default when a
legacy source omits `domain`.

World observations remain finite and JSON-safe. Non-tabular observations carry
a bounded `payload` (for example normalized image pixels or token strings),
while the shared World, Experiment, comparison, and history contracts remain
authoritative. Raw payloads are not sent to an Agent merely because a domain
exists.

World keeps the legacy `dimension: 2` compatibility field, but new domains also
declare an explicit `coordinateSpace` (`image`, `token-sequence`, or
`ranked-list`). Presentation and capability code should use the coordinate
space rather than treating every World as an x/y plot.

## Visualization contract

Visualization Scripts still declare JSON primitives and the materializer still
resolves bindings. Primitive presentation metadata distinguishes coordinate
spaces such as `plot2d`, `image`, `token-sequence`, `attention-matrix`, and
`ranked-list`; renderer registration remains the only UI extension point.

Tabular stages retain their existing axes and direct-manipulation behavior.
Domain-native primitives use a neutral stage without inventing 2D axes. The
Phenomenon capability contract recognizes a domain-native primitive as a
readable surface, while editable World tools remain capability-driven.

## Image vertical slice

`image-classification` is a deterministic finite image World with explicit
Train/Test membership. Its bounded image adapter uses a fixed 2x2 mean
convolution as a local feature extractor and a deterministic per-label
prototype head. `trainingSteps` and `learningRate` produce bounded deterministic
updates and history. It is deliberately small: it provides truthful image
classification evidence and feature-map visualization without claiming to be a
general CNN training framework.

The adapter exposes train/test accuracy through the shared observable IDs and
emits ordinary runtime trace families (`data.loaded`, `split.created`,
`training.*`, and `evaluation.completed`). It does not opt into World mutation
until a domain-specific adapter contract is accepted. The normal manual path
therefore remains inspectable and the UI does not expose unsupported World
editing affordances.

## Sequence / attention vertical slice

`sequence-attention` uses finite labeled token sequences, a deterministic token
embedding projection, a bounded content-dependent self-attention matrix, and
shared train/test accuracy observables. Attention temperature is an explicit
model control. The matrix is evidence/representation, not a claim about a
pretrained Transformer.

## Retrieval, embeddings, and grounded retrieval slices

The first retrieval/RAG probes are also executable but deliberately local. A
bounded document fixture is embedded with a deterministic hashing projection
and ranked by cosine similarity. Retrieval exposes ranked results and an
embedding projection; grounded retrieval additionally exposes an extractive
bounded answer with source IDs. These adapters do not call an embedding
service, generate unrestricted text, or claim that a local hashing vector is
semantic pretraining.

## Cross-domain Agent and execution seam

`crossDomainPlanner.js` maps a small supported set of representation questions
and model-control interventions into existing depth navigation or
`ScenarioSpec` proposals. The proposal remains subject to validation,
detached preflight, exact fidelity, and explicit execution. Unsupported domain
interventions return clarification rather than falling through to tabular
operations. The provider receives `projectExplorationAiContext()` only: domain
capabilities, bounded counts, task, coordinate space, and boolean model
capabilities; payloads, pixels, tokens, document text, queries, and vectors do
not cross that boundary.

`executionRunner.js` provides a bounded adapter-neutral async seam with stable
run IDs, cancellation, stale replacement, concurrency limits, and normalized
status. Current Phase 9 adapters remain synchronous; no artificial delay is
introduced.

The Host's `inspectContext()` includes the normalized domain and coordinate
space, adapter capabilities, primitive schemas, and trace schemas. This gives a
future Agent a safe capability projection without granting it raw operations or
new execution authority.

## Static probes and limits

The Phase 9 checker covers both contract probes and real synchronous runtime
sessions for image, sequence, retrieval, and RAG, plus detached Agent proposal
and execution checks. Remote inference, large pretrained models, and a full
visual Composer are intentionally outside this bounded local vertical slice.

All domain payloads and primitive contracts are bounded before materialization.
No arbitrary functions, generated code, raw pointer streams, new persistence
formats, or Phase 9 domain expansion are part of this slice.
