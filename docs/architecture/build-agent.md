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
