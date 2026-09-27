# LUMI Result Reasoning v1

LUMI Result Reasoning is the optional interpretation boundary for successful
Build workspace Runs. It reads the existing browser runtime result; it does not
execute a graph, own metrics, or change the Canvas Agent Application API.

```text
local Run result + semantic graph/data binding
        ↓
bounded volatile history (last 8 attempts)
        ↓
current-result freshness gate
        ↓
deterministic fact projection
        ↓
local reflection OR explicit-consent provider request
        ↓
strict LumiResultReasoningV1 validation
        ↓
LUMI presentation and inert suggestions
```

## Runtime and result identity

`src/core/buildAgent/lumiResultReasoning.js` owns the versioned request and
response contract, the eight-entry in-memory Run log, facts, local deterministic
fallback, and optional provider adapter. Each attempt keeps only a random
session-local attempt ID, semantic graph and dataset fingerprints, start/end
times, status, a model type, finite metric values, a bounded loss summary, a
safe failure code, and current/historical status. It never retains trained
weights, raw errors, dataset rows/cells, source code, or a full execution
snapshot. The history lives in the mounted Build workspace React session; it is
not added to project JSON or local project storage.

Only the latest successful attempt can support current-result reasoning. The
gate requires all of the following to agree: the current graph semantic
fingerprint, the current dataset fingerprint, the existing result binding, the
Run history record, and the runtime's succeeded result. A view/layout-only
change does not make a semantic result stale. Graph or dataset edits do. A
failed or stale attempt may appear in the eight-entry history with a bounded
status/code, but its output metrics are not projected as a current result.

The projection reuses the existing `DatasetContextV1` provider-safe schema and
uses request-scoped node aliases for graph topology. Graph positions, selected
state, dataset display name, raw node/edge IDs, viewport, DOM, screenshots,
telemetry, credentials, arbitrary logs, rows, and cell values are excluded.
Graph parameter values are restricted to declared numeric/boolean properties
and declared enum selections; all text and code properties are omitted.
Column names/types and counts, bounded graph operation/parameter semantics,
current metric/loss summaries, and up to eight status/result summaries are
included only in a per-request provider call after disclosure and affirmative
consent. The provider request includes `LumiResultReasoningV1`, version 1, a
correlation request ID, and the chosen display language.

## Output and authority

The response is an exact versioned object. Each bounded statement references
one or more fact IDs included in the request. Unknown facts, stale request IDs,
unknown fields, unsupported versions/actions, numeric claims, and explicit
causal-certainty or mastery/understanding claims are rejected. The local UI
renders the referenced values from local runtime facts; provider prose cannot
replace or author the actual metrics. Understanding remains `not-assessed`.

Provider output is presentation only. `inspect-loss` is view-only. Selecting
`review-graph-layout` opens the existing F2 Graph Edit surface with a prompt;
it does not interpret, stage, apply, or run anything. F2 still requires its own
per-request consent when a provider is used, returns a typed C1 patch, and
submits it to the existing C2 read-only preview. C2 revalidates against current
state and requires an explicit Apply action. No LUMI action directly changes a
graph, dataset, model, Run result, or execution setting.

Without consent/configuration, the UI uses deterministic local reflection. A
provider timeout, offline/error response, malformed/unsupported/stale output,
or changing context discards the response and shows the local reflection. The
current result, graph, dataset, and deterministic local facts remain owned by
VOLK-ML and unchanged.

## Validation

Focused runtime and provider-contract checks:

```text
npm run check:lumi-result-reasoning
npm run test:lumi-result-reasoning:browser
```

The browser check uses a local HTTP fixture and the actual provider gateway; it
does not contact an external model service. It verifies the consented request,
response/fact validation, no mutation from interpretation, and the F2/C2
proposal preview and explicit Apply boundary.
