# Build Agent A: local model-design boundary

Build Agent A is the first declarative planning boundary for a future Build
workspace assistant. It is intentionally detached from the Canvas Agent and
does not execute, apply, or mutate a project.

```text
authoritative local dataset
        ↓
DatasetContextV1 (semantic, no rows)
        ↓
BuildGoalV1
        ↓
ModelDesignPlanV1
        ↓
registered graph blueprint
        ↓
GraphProposalV1 (detached, learner acceptance required)
```

`src/core/buildAgent/` owns the versioned JSON-safe contracts, dataset
projection, deterministic goal resolver, four small graph blueprints, and
proposal preflight. A local `datasetFingerprint` is computed from the
normalized task, ordered declared feature/target schema, and ordered training
values. Runtime-equivalent absent, null, and blank cells use one explicit
missing-value marker. It uses a stable, non-cryptographic local hash and
excludes display names and file metadata. Plans and detached graph
proposals carry this identity; a mismatch at proposal construction or the pure
freshness assessment returns `BUILD_DATASET_STALE`. The fingerprint is local
and is intentionally omitted from provider projections. Proposals also retain
the selected feature/target projection that was preflighted, without copying
any cell values. The blueprints reuse the existing component registry,
Canvas Agent node/edge validation, browser execution contract, compiler IR,
and workload estimator. They do not introduce a second graph reducer or
runtime.

Identity roles are distinct: `BuildGoal.goalId` identifies a request, while
`ModelDesignPlan.planId` identifies its deterministic semantic plan and
`GraphProposal.proposalId` identifies the embedded complete
`ModelDesignPlanV1`, selected projection, and canonical semantic graph. A
proposal embeds the validated plan rather than a lossy plan summary. The
validator rematerializes the registered blueprint from that plan and compares
node IDs, component IDs/operations and non-presentation contracts (schema/kind,
property constraints/defaults, runtime/backend tier, framework compatibility,
and composite expansion), normalized parameters, input/output port contracts,
edge IDs/endpoints/handles, and deterministic node positions. Presentation
labels, runtime status, and localized manifest names/descriptions/categories
are excluded from graph identity. Nodes, edges, ports, and object keys are
compared without depending on their array/object insertion order. Blueprint
positions are contract-owned and compared exactly. Graph changes fail with
`BUILD_PROPOSAL_GRAPH_MISMATCH`; dataset freshness remains a separate check and
reports `BUILD_DATASET_STALE`. Different request IDs can therefore share a
plan ID when their semantics match. Changing the dataset, selected
features/target, training settings, or execution expectation changes the plan
ID and proposal ID. These stable non-cryptographic IDs are not authorization
tokens, signatures, or persistence keys.

The external execution vocabulary is deliberately small and stable:
`browser-local`, `export-only`, `future-cloud`, and `unsupported`. Internal
L0 checks remain implementation details; versioned Build Agent payloads never
expose internal tier names.

Default planning is deterministic: numeric regression without an explicit
family selects the linear baseline, classification selects KNN, and an
explicit neural/MLP request selects the small MLP blueprint. Ambiguous or
unsupported task, target, feature, split, or execution requests return a
typed clarification/unsupported result rather than guessing.

Provider projection uses `projectBuildDatasetContext` and contains only
column names/types, task, bounded counts, and split availability. Mixed
numeric/text schemas remain representable as metadata; model capability is
resolved and browser-preflighted from selected features only, so unused text
columns do not block a numeric selection. Selected text features remain a
typed unsupported outcome. Projection never contains
fingerprints, rows, raw labels/values, file bytes/paths, project graphs, DOM,
screenshots, telemetry, credentials, weights, or executable operations.

`GraphProposalV1.application` is the single local applicability gate. For
`browser-local`, it requires a current dataset binding, a materializable
feature selection, valid browser preflight, and an available local execution
tier. For `export-only`, it requires a current binding, materializable
features, and at least one supported source compiler. This gate describes
applicability only; it does not apply, execute, or authorize a graph. Evaluation
metrics, rationale identifiers, and limitations are deterministic and tied
to the registered blueprint rather than generated free-form claims.

The validation/application fields inside a proposal are preview-time facts, not
future Apply authorization. Any later learner-confirmed Apply boundary must
recheck the current workspace and dataset, current component/runtime
capabilities, and the integrity of the embedded plan and canonical graph before
performing an action. Neither a valid proposal ID nor a prior `applicable`
status grants that authority.

Every proposal carries `authority: detached-proposal` and
`requiresLearnerAcceptance: true`. A proposal can be inspected or rendered by
the Build UI, but no policy, planner, or proposal path may apply it or run it
without an explicit future learner action. `GraphProposalV1` is local-first;
Cloud and provider policy adapters are outside this phase.

Run the focused contract, blueprint, browser-preflight, compiler, and runtime
checks with:

```text
npm run check:build-agent
```

The existing `agentExerciseSuite` now consumes the same fixture datasets and
blueprint materializer, so the browser exercise path and Build Agent path do
not maintain duplicate graph definitions.

Build Agent graph proposals can also be adapted into the source-neutral
detached workspace contract described in
[`graph-interop.md`](./graph-interop.md). That adapter validates the original
proposal, copies its graph without rematerializing it, and preserves its plan,
dataset binding, rationale, limitations, and diagnostics. The generic graph
identity utility is shared, while Build Agent retains its stricter exact
semantic-and-layout comparison against the registered blueprint.

## F1 LUMI Build Intent boundary

Build Intent v1 accepts a bounded, single-line learner request and the same
semantic-only dataset metadata projection. The versioned response is a strict
union of `goal`, `clarification`, or `unsupported`; it does not accept graph
operations, component IDs, executable text, weights, or Apply/Run instructions.
`src/core/buildAgent/buildIntent.js` owns projection, validation, bounded
provider execution, local MLP layer-count clarification, and explicit-family
substitution checks. The optional provider call uses the existing volatile AI
configuration and `createProviderGateway`; no new task mode or second gateway
is introduced.

The UI invokes interpretation only after the learner explicitly submits a
request. The local planner resolves the validated goal against the current
dataset and registered blueprint. The learner then chooses “Review graph
proposal” to create and stage a detached proposal through the existing
source-neutral workspace proposal boundary. The existing read-only preview is
the only Apply surface; proposal creation and LUMI output never apply or run a
graph. A current graph must be empty for this whole-graph path. VOLK-ML does
not clear or replace an occupied graph, and the empty-target rule remains
rechecked by the existing Apply contract.

If the configured provider is unavailable, times out, returns malformed or
unsupported output, or the dataset/provider configuration changes while a
request is pending, the UI reports a bounded localized result and leaves
project graph, dataset, model, and runtime untouched. Closing, cancelling, or
reopening the dialog also invalidates its pending response. Provider requests
contain the learner's short request plus task, schema names/types, and row
counts. They exclude the local dataset fingerprint, all row/cell values,
project graph, viewport, DOM, credentials, and runtime state. The disclosure
is shown before the explicit Interpret action.

The registered MLP blueprint currently means exactly two Dense layers total:
one hidden Dense layer and one output layer. “Two-layer MLP” is clarified
locally; the learner can explicitly select that interpretation. Depth
classification is conservative across supported English and Chinese number
forms, including large digit and cardinal counts: requests for more than one
hidden layer or more than two Dense layers total are typed unsupported before
contacting a provider. It does not clamp larger counts or reduce them to the
registered blueprint.

Explicitly requested numeric parameters are extracted from the bounded request
and must match the provider's validated response exactly. Supported ranges are
hidden width 1–128, training split 0.5–0.9, epochs 1–1000, and batch size
1–512; conflicting, fractional integer, or out-of-range requests are rejected
locally, and a provider response that changes an explicit value is rejected
rather than silently rewritten. Omitted values may use the registered plan
defaults.

Before the learner reviews a proposal, the plan summary names the selected
feature columns and target, train/test split, evaluation metrics, planning
rationale, limitations, and applicable MLP width, epochs, and batch size. This
summary is factual plan metadata; it does not apply or execute the graph.

## F3 LUMI Result Reasoning

The Build Run reflection, its current-result binding, bounded in-memory
attempt history, provider disclosure/consent, response validation, and inert
suggestion authority are documented in
[`lumi-result-reasoning.md`](./lumi-result-reasoning.md). Result reasoning is
not part of `BuildGoalV1`, `GraphProposalV1`, project persistence, or the
Canvas Agent Application API. A selected graph-layout suggestion only opens
the existing F2 typed Edit Intent and C2 proposal preview; explicit Apply
remains a separate learner action.
