# Phase 9 cross-domain exploration contracts

Phase 9 extends the existing exploration grammar beyond the 2D tabular
surface. The first slice is intentionally a contract and one small executable
Image World; it does not introduce a second runtime or expand World Composer.

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
prototype head. It is deliberately small: it provides truthful image
classification evidence and feature-map visualization without claiming to be a
general CNN training framework.

The adapter exposes train/test accuracy through the shared observable IDs and
emits ordinary runtime trace families (`data.loaded`, `split.created`,
`training.*`, and `evaluation.completed`). It does not opt into World mutation
until a domain-specific adapter contract is accepted. The normal manual path
therefore remains inspectable and the UI does not expose unsupported World
editing affordances.

## Retrieval and grounded retrieval slices

The first retrieval/RAG probes are also executable but deliberately local. A
bounded document fixture is ranked by deterministic token overlap. Retrieval
exposes a ranked-list primitive and a relevance observable; grounded retrieval
exposes the same ranked evidence plus a bounded grounded-source count. These
adapters do not call an embedding service, generate unrestricted text, or
claim that lexical overlap is semantic understanding. They are inspectable
runtime seams for a later embedding/RAG vertical slice.

The Host's `inspectContext()` includes the normalized domain and coordinate
space, adapter capabilities, primitive schemas, and trace schemas. This gives a
future Agent a safe capability projection without granting it raw operations or
new execution authority.

## Execution seam

`execution/executionContract.js` defines bounded execution metadata and a
JSON-safe request/status envelope. Current adapters explicitly resolve to
`mode: sync`; no fake asynchronous work or artificial loading state is added.
Future image/sequence/remote adapters can opt into an async runner without
changing World or Experiment identity, and stale-result/cancellation policy can
be added at that shared boundary before remote inference is introduced.

## Static probes and limits

The 9A probes cover tabular regression, image classification, and sequence
attention as non-executable contract fixtures. They are capability discovery,
not fake runtime sessions. Retrieval, RAG, attention execution, async/remote
execution, and Agent planning remain later vertical slices.

All domain payloads and primitive contracts are bounded before materialization.
No arbitrary functions, generated code, raw pointer streams, new persistence
formats, or Phase 9 domain expansion are part of this slice.
