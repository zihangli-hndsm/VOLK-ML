# Graph Interop B0: detached workspace graph proposals

Graph Interop B0 introduces a small source-neutral boundary for describing and
assessing a VOLK graph without loading it into, running it in, or mutating a
workspace. Its implementation lives in `src/core/graph/`:

- `identity.js` defines bounded semantic and presentation identities for the
  existing `nodes` / `edges` graph representation.
- `workspaceProposal.js` defines `WorkspaceGraphProposalV1`, strict validation,
  pure capability projection, and the current empty-workspace assessment.
- `index.js` exports the public local contract.

```text
Build Agent GraphProposalV1 ─┐
                             ├─> WorkspaceGraphProposalV1 (detached)
VOLK project JSON ───────────┘
        │
        └─ migrate/validate with the existing project contract

Future producer families
        → source adapter / planner
        → WorkspaceGraphProposalV1
        → validation [B0]
        → preview / apply [future]
        → canonical VOLK project [future]
```

B0 implements only the source contract, graph-candidate handoff, and validation
through the bracketed B0 step. Preview, Apply, graph patching, and writing a
canonical project remain future work; no candidate path performs those actions.

## Graph scope and project boundary

The generic proposal carries only a graph: nodes, edges, and the referenced
custom component definitions needed to validate and interpret those nodes. It
does not carry the project name, dataset rows, trained model, language or
workspace preferences. Creating a proposal from a project first uses the
existing `migrateProject()` and `validateProjectForWorkspace()` path; it then
resolves node manifests against the live registry and uses existing Canvas
node/connection checks for bounded, structured diagnostics. It is not a second
project importer or graph reducer.

The VOLK project producer reports `partial` conversion fidelity at project
scope, with `exactFor` limited to graph semantics/layout and referenced custom
definitions. The complete native VOLK project import/export path remains the
exact path for project data, trained models, and preferences. A graph-scoped
proposal never claims those omitted layers were converted.

## Identity, provenance, and fidelity

`graphSemanticFingerprintV1()` includes stable node and edge IDs, component IDs
and operations, component schema/kind/property/runtime/compatibility/composite
contracts, normalized parameters, typed ports, and edge endpoints/handles.
Transient node status, selection/drag state, labels, localized names,
descriptions, category, and visual metadata do not contribute. Component
runtime capability declarations are semantic; a node's transient execution
status is presentation state.

`graphPresentationFingerprintV1()` separately identifies top-level node
positions and positions inside carried composite layouts. Moving a node changes
this fingerprint without changing semantic identity. The fingerprints use a
bounded stable non-cryptographic hash: they detect accidental or stale changes,
but are not signatures, authorization tokens, or proof against an attacker who
can recompute the envelope.

`WorkspaceGraphProposalV1` is versioned, detached, JSON-safe, and bounded. Its
proposal identity binds provenance, graph identity, conversion report,
capability snapshot, and assessment. The separately versioned source shape
uses bounded categorical dimensions: `kind` is `planner` or `import`,
`producer` distinguishes the producer, and `format` identifies the source
representation. `GRAPH_SOURCE_VERSION` is now 2: Build Agent evidence carries
the native validated `GraphProposalV1`, while project evidence carries only a
normalized VOLK project graph and migrated project version (never project data
rows or other project state). The currently implemented specialized producers are only
Build Agent (`planner` / `build-agent` / `volk-model-design-plan-v1`) and the
canonical VOLK project path (`import` / `volk-project` / `volk-project`). The
closed vocabulary also has bounded future values for human/external imports,
ONNX, `torch.export`, `torch.fx`, TensorFlow, Keras, and unknown imports; their
adapters are not implemented in B0. A source-neutral external planner can be
represented as `planner` / `external-agent` / `volk-graph-candidate-v1`
without claiming a framework export. Provenance accepts only bounded opaque
artifact/revision/fingerprint/reference identifiers and a finite location
label—never arbitrary metadata or raw file paths. The exported
`createWorkspaceGraphProposalFromCandidate()` boundary validates and
canonicalizes source-neutral candidates, but refuses calls claiming either
implemented producer so they cannot bypass the specialized adapters.

Build Agent adaptation first validates its original `GraphProposalV1`, then
copies its graph and preserves plan/dataset identity, rationale, limitations,
and diagnostics; it does not rematerialize the graph. That adaptation reports
`exact` fidelity for the carried contract.

## B0.1 trust and revalidation boundary

```text
candidate/source claims
        │ bounded syntax + detached proposal identity
        ▼
proposal snapshot (integrity hint, not authority)
        │ current built-in registry comparison
        │ project/Canvas canonicalization and graph validation
        ▼
canonical detached graph + recomputed graph-only capabilities
        │
        ├─ no current dataset ──> browser runnability: not-assessed
        └─ explicit current dataset ──> separate dataset-bound assessment
```

Validation never trusts a caller-recomputed `proposalId` as proof. It compares
every embedded built-in manifest with the current component registry (including
operation, runtime, compatibility, property, and port contracts), rejects
built-in shadowing by custom definitions, checks custom instances against their
carried definitions, and runs the existing project/Canvas validation path. A
pure canonicalization API returns a detached graph; it does not rewrite the
proposal, apply it, or grant authority. Proposal validation and revalidation
therefore remain safe even when a candidate recomputes its graph identity,
capability snapshot, and proposal ID after tampering.

The proposal's graph capability snapshot is recalculated from the current
canonical graph and registry. It describes components, compiler support, and
graph-level execution tier only. Browser execution is explicitly
`not-assessed` with `CURRENT_DATASET_REQUIRED`; it is not inferred from absent
dataset data and does not claim a graph is runnable with arbitrary data. A
caller may ask for a separate dataset-bound browser/tier assessment by passing
an explicit current local dataset to revalidation. That assessment returns
bounded status/reason codes only, never dataset rows. For Build Agent proposals,
that same explicit dataset must still match the preserved semantic fingerprint
and selected feature/target columns or revalidation reports stale/invalid
selection. A VOLK project proposal deliberately omits an embedded project's
dataset from both its graph snapshot and proposal body.

Conversion fidelity and verification are independent. `fidelity` describes
how much source meaning is preserved (`exact`, `structural`, `partial`, or
`unsupported`); `verification` describes which source contract has been
revalidated. `volk-verified` requires a native Build Agent proposal that passes
its validator and matches the detached graph and preserved source facts, or a
graph-only VOLK source project that passes the canonical project path and
matches the detached graph. Source identity strings alone are insufficient.
These source records establish semantic validity; they do not authenticate the
human/process origin because the public envelope fingerprint is
non-cryptographic. The generic candidate factory rejects any caller-supplied
`conversion.verification`; when omitted, it sets `producer-declared`. Only the
specialized Build Agent and VOLK project factories can emit `volk-verified`
with the required source evidence. The generic factory also reserves those
producer identities and the future ONNX, Torch, TensorFlow, and Keras adapter
identities; external agents can still submit a generic graph candidate or an
ONNX-described import without impersonating a future official adapter.

The proposal identity binds the supplied snapshot and conversion claims for
change detection; it is a stable non-cryptographic fingerprint, not a signature
or authorization token. Any future preview/Apply path must repeat current
registry validation and capability/dataset assessment at the point of use.

Conversion fidelity is one of `exact`, `structural`, `partial`, or
`unsupported`. The versioned report includes bounded machine-readable
`exactFor`, `preserved`, `approximated`, `missing`, `unsupported`, and
`warnings` lists. The legacy `omitted` field remains as an exact alias of
`missing`. VOLK project graph conversion is `partial`: it explicitly lists the
missing project name, dataset, trained model, language, and workspace
preferences, while Build Agent graph adaptation has empty approximation/loss/
warning lists. Capability projection reuses the live component
registry, source compilers, and graph-level runtime tier estimator. It does not
execute a model or include dataset rows in the proposal. Browser execution
analysis is only performed as the separate, explicit dataset-bound assessment
described above.

## Authority and assessment policy

Every proposal has `authority: detached-proposal` and
`requiresUserAcceptance: true`. B0 creates no Apply action, run path, ghost
graph, patch proposal, transport, or importer beyond the local VOLK producer.

The current pure workspace assessment is deliberately non-destructive: an
empty target is `eligible`; any non-empty target is `blocked` with
`TARGET_WORKSPACE_NOT_EMPTY`. Assessment reads counts only and does not replace,
merge, clear, or otherwise mutate the target workspace or proposal. The
assessment is informational and grants no future Apply authority.

GraphPatchProposal, merge policy, transport, authentication, provider
integration, remote formats such as ONNX/PyTorch/TensorFlow, and UI preview are
future phases. Existing `PROJECT_VERSION`, Canvas Agent API, and full-project
serialization remain unchanged in B0.
