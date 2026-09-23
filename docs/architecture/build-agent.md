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
proposal preflight. The blueprints reuse the existing component registry,
Canvas Agent node/edge validation, browser execution contract, compiler IR,
and workload estimator. They do not introduce a second graph reducer or
runtime.

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
column names/types, task, bounded counts, and split availability. It never
contains rows, raw labels/values, file bytes/paths, project graphs, DOM,
screenshots, telemetry, credentials, weights, or executable operations.

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
