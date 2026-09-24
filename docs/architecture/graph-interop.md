# Graph Interop: detached workspace graph proposals (B0 and B1)

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
                 ↓
        detached read-only preview
                 ↓ explicit learner Apply
        latest-snapshot revalidation
                 ↓
        canonical VOLK workspace commit
```

B0 established the source contract, detached graph-candidate handoff, and
validation. B1 adds a local read-only preview and an explicit, gated Apply path
for a whole graph proposal. The B0 proposal API remains detached and pure;
producer code cannot mutate a mounted workspace.

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
representation. `GRAPH_SOURCE_VERSION` is 2 for existing producers: Build Agent evidence carries
the native validated `GraphProposalV1`, while project evidence carries only a
normalized VOLK project graph and migrated project version (never project data
rows or other project state). The currently implemented specialized producers are only
Build Agent (`planner` / `build-agent` / `volk-model-design-plan-v1`) and the
canonical VOLK project path (`import` / `volk-project` / `volk-project`). The
Torch Export adapter adds its own strict source-v3 evidence shape while
preserving source-v2 compatibility for existing producers. The closed
vocabulary also has bounded values for human/external imports, ONNX,
`torch.export`, `torch.fx`, TensorFlow, Keras, and unknown imports; the other
framework adapters remain unimplemented. A source-neutral external planner can be
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
carried definition/catalogue availability, and runs the existing project/Canvas
validation path. A folded custom-composite instance is independently validated
as its own semantic snapshot; its copy-style catalogue definition may remain an
older template. Graph identity follows the embedded rebuilt instance, while
nested custom children must resolve through carried manifests/catalogue rules.
A pure canonicalization API returns a detached graph; it does not rewrite the
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

The exported `createGraphCapabilitySnapshot(graph)` and
`createDatasetBoundCapabilityAssessment(graph, dataset)` helpers are safe
public boundaries: each validates/canonicalizes the graph against current
registry and project rules before exposing derived capability information.
Their canonical-only implementation helpers are private; callers cannot use
them to derive a snapshot from an arbitrary forged graph.

Conversion fidelity and verification are independent. `fidelity` describes
how much source meaning is preserved (`exact`, `structural`, `partial`, or
`unsupported`); `verification` describes which source contract has been
revalidated. `volk-verified` requires a native Build Agent proposal that passes
its validator and matches the detached graph and preserved source facts, or a
graph-only VOLK source project that passes the canonical project path and
matches the detached graph. `adapter-verified` is reserved for the Torch
Export adapter after strict document validation and deterministic semantic +
layout rematerialization. Source identity strings alone are insufficient.
These source records establish semantic validity; they do not authenticate the
human/process origin because the public envelope fingerprint is
non-cryptographic. The generic candidate factory rejects any caller-supplied
`conversion.verification`; when omitted, it sets `producer-declared`. Only the
specialized Build Agent and VOLK project factories can emit `volk-verified`;
only the Torch Export adapter factory can emit `adapter-verified`. The generic
factory continues to reserve these official producer identities and all
unimplemented adapters; external agents can submit generic candidates without
impersonating an official adapter.

The proposal identity binds the supplied snapshot and conversion claims for
change detection; it is a stable non-cryptographic fingerprint, not a signature
or authorization token. B1 repeats current registry validation and
capability/dataset assessment both when preparing the preview and immediately
before committing it.

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
`requiresUserAcceptance: true`. B0 created no Apply action, run path, ghost
graph, or patch proposal. B1's Apply is an app-level learner action, not
proposal authority: the proposal remains data until the learner explicitly
accepts it in the preview.

The pure workspace assessment is deliberately non-destructive: an empty target
is `eligible`; any non-empty target is `blocked` with
`TARGET_WORKSPACE_NOT_EMPTY`. Assessment reads counts only and does not replace,
merge, clear, or otherwise mutate the target workspace or proposal. It is a
precondition for Apply, not Apply authority.

## B1 local preview and Apply lifecycle

`src/core/graph/workspaceApply.js` owns the pure preparation/commit boundary.
The Build workspace owns the only submission context in
`src/components/graph/WorkspaceGraphProposalContext.jsx`; producer surfaces
submit a detached proposal and receive no graph mutation capability. The
application validates and clones the proposal, stages it in transient UI state,
and renders `GraphProposalPreview` as a non-editable React Flow view.

Preparation uses the latest serialized project, runtime, dataset, current
component registry, proposal revalidation, and canonical project validator.
It blocks a running runtime, missing Build Agent dataset, stale data or column
selection, an occupied target, registry mismatch, malformed project, and
conflicting custom definition. The preview reports bounded localized reasons;
it never edits nodes, edges, parameters, or project fields. Presentation-only
selection/drag metadata is reset on the incoming nodes and edges before the
candidate project is validated.

Apply synchronously prepares again against the latest workspace snapshot. A
changed snapshot rejects the stale preparation; a newly occupied workspace or
stale dataset is rejected by the same current validator. Successful Apply
replaces only the graph, adds exact required custom definitions, clears the
prior trained model and execution runtime, clears selection/transient pending
operations, and then lets the existing project autosave path persist the
canonical project. Current project name, data, language, and workspace
preferences remain authoritative. Custom definition ID conflicts are rejected
unless the current definition is exactly identical. There is no merge or patch
mode.

The producer flow is source-neutral: the Build Agent's existing native
`GraphProposalV1` and the VOLK graph-only project adapter both end at
`WorkspaceGraphProposalV1`. The same validator, read-only preview, and Apply
boundary handle either; the existing full-project import/export format remains
separate. A dev-only `?graphApplyTest=1` bridge exposes fixture construction and
proposal staging for actual-browser acceptance, but exposes no Apply primitive.

Apply does not add a Canvas Agent command, change `CANVAS_AGENT_API_VERSION`,
change `PROJECT_VERSION`, or add a Cloud endpoint. Existing Canvas Agent graph
editing, execution, code export, project serialization, and local autosave
remain the canonical post-Apply paths. Graph patches/merge, remote formats and
their adapters, authentication, and provider transport remain future work.

## B2 Torch Export JSON adapter

The local Torch Export adapter maps the bounded, non-executable
`TorchExportDocumentV1` contract (`type: "TorchExportDocumentV1"`, `version: 1`)
into the existing WorkspaceGraphProposalV1 boundary. Its nested extractor
metadata declares `schemaVersion: 1`; the document schema is strict and rejects
unknown fields while carrying metadata only.
Build More exposes “Import Torch Export JSON”; selecting a file only parses and
stages a detached proposal. The B1 read-only preview, Cancel, latest-snapshot
revalidation, empty-workspace check, and explicit Apply remain authoritative.
The browser accepts JSON only and never opens a .pt2 archive.

The document has strict, unknown-field-rejecting objects:

- Root: type, version, exporter, model, extractor, graph, state, and
  documentFingerprint. Exporter records the bounded PyTorch version; model has
  a stable model-definition identifier; extractor records its schema version.
- Graph: ordered inputs, topological nodes, exactly one output, and finite
  rangeConstraints. Inputs distinguish USER_INPUT, PARAMETER, BUFFER, and
  CONSTANT_TENSOR. Other graph-signature kinds are bounded explicit errors;
  buffers/constants are recognized metadata but currently rejected for Apply.
- State: parameters, buffers, and constants contain only target/name/kind,
  dtype, shape, and requiresGrad metadata. Tensor values, byte payloads,
  buffers, and constants are never serialized into the document or proposal.
- Nodes: contiguous IDs, bounded ATen target names, typed arguments, and only
  dtype/shape/layout metadata. Unsupported operators may appear in a bounded
  normalized document, but the VOLK adapter rejects them before proposal
  creation. The supported target allowlist is checked against registered
  VOLK components.
- Output: exactly one USER_OUTPUT reference matching the inferred final tensor.

The current supported chain is one rank-2 input-to-output path with at least
one Linear, no fanout, shared or unused parameters, mutation, buffer/constant
execution, extra user inputs/outputs, or unsupported operators. The reference
fixture is `Linear(8,32) → ReLU → Linear(32,4)`. The importer carries only
architecture dimensions and bias-presence into editable Dense components;
it never imports trained values or marks a model trained. Shape/dtype
relationships are recomputed and checked against each operator's metadata.
Only static feature dimensions are materialized; symbolic batch constraints
remain in source evidence and are reported as missing from the target graph.

Bounds are 500,000 JSON code units per document, 64 operators, 128 graph
input/state entries, at most 65,536 metadata elements per state tensor, rank at
most 8, and static dimensions at most 1,000,000. The optional batch symbol has
exactly one finite range with 1 <= min <= max <= 1,000,000.

`documentFingerprint` is `sha256:<hex>` over canonical semantic JSON with the
fingerprint field omitted. Python and browser-side JavaScript use the same
sorted-key UTF-8 serialization and SHA-256 algorithm; validation recomputes it.
This artifact fingerprint is distinct from VOLK GraphIdentity and is not a
signature, source authentication, or proof of PyTorch origin. GraphIdentity
keeps its existing implementation.

The conversion report identifies high-level module structure as approximated
and original Python classes/source structure, trained parameter values, and
batch-range constraints as missing. Torch proposals use source version 4 and
conversion-report version 4; other version-2 proposal families remain valid.
The source embeds the complete validated metadata-only document. Revalidation
recomputes its SHA-256 fingerprint, validates the allowlist and metadata
references, deterministically rematerializes stable node/edge IDs and layout,
then compares canonical semantic and presentation graph identities and the
registered conversion report. `adapter-verified` means only that the bounded
document-to-graph mapping was revalidated; it does not authenticate the
document's producer or origin.

`tools/torch_export/extract_torch_export.py` exposes
`extract_exported_program(program, model_identifier=...)` as the reusable
function for an already-loaded ExportedProgram. The independent .pt2 convenience
wrapper/CLI requires explicit `trusted=True` / `--trusted-pt2`, plus a stable
`--model-id`; `torch.export.load` is pickle-backed and must only load a trusted
local artifact. The helper preflights archive sizes and refuses to overwrite
output unless `--overwrite` is supplied. The application and Cloud never load
.pt2, and PyTorch is not installed as part of VOLK-ML setup. Without PyTorch,
contract and digest tests still run, while the real ExportedProgram integration
is explicitly skipped rather than installing dependencies.

Example local invocation:

    python tools/torch_export/extract_torch_export.py --input model.pt2 --output model.json --model-id my-model --trusted-pt2
