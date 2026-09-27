# Graph explanation v1

The Build **Explain this graph** surface reads the mounted canonical VOLK graph
at six learner-selected depths: Phenomenon, Evidence, Mechanism,
Representation, Math, and Code. This is an explanation view over the existing
workspace, not another graph, runtime, or learning-history owner.

## Local truth and depth

`src/core/explanation.js` owns the versioned `GraphExplanationRequestV1`
projection, the local graph summary, and response validation. Its graph model
is derived only from canonical nodes, registered operation semantics, typed
connections, schema-allowlisted numeric/boolean/enum settings, and an optional
current Run result. It does not read node coordinates, selection, viewport,
screen state, DOM, data rows, full project JSON, or producer provenance.

Imported PyTorch and ONNX graphs, LUMI proposals after explicit Apply, and
human-authored graphs all enter the same explanation path after they become
canonical workspace nodes and edges. An operation outside the registered
catalog is shown locally as unregistered and is not given invented semantics
in the optional provider projection.

The six depths are explicit learner choices, not an automatic assessment of
learner level:

| Depth | Local source |
| --- | --- |
| Phenomenon | Component counts, stage counts, and graph connectivity |
| Evidence | Metrics only from a successful Run still bound to the current graph and dataset |
| Mechanism | Registered component explanations and tutorials |
| Representation | Canonical node aliases, ports, and typed graph connections |
| Math | Localized formula metadata from registered component tutorials |
| Code | A local preview from the canonical PyTorch exporter; it is never executed by Explain |

## Declared technicality preference

At the start of each Explain dialog, the learner may declare how technical
they want the starting explanation to feel:

| Session-only preference | Default depth |
| --- | --- |
| Start with the big picture | Phenomenon |
| Explain how it works | Mechanism |
| Use technical detail | Math |

This transparent preference selects only the starting depth. All six depth
controls remain available as learner overrides. Changing the preference
selects its mapped depth, revokes any one-request provider consent, aborts an
in-flight request, and makes any late response stale. The preference exists
only for the mounted Explain interaction and is not persisted.

The preference is not an ability, mastery, or readiness profile. It is never
inferred from Evidence, graph complexity, engagement, questions, provider
usage, or fallback guidance. Run Evidence remains grounded solely in the
current locally bound Run.

Missing, stale, or unsupported Run evidence is labeled as unavailable; older
metrics are not presented as current. Explanations do not mutate the graph,
dataset, model, Run result, or evidence. A generated-code preview is a view of
the existing compiler output, not execution authority.

## Optional provider boundary

The existing configured provider gateway is optional. Requests are sent only
after per-question consent and include a bounded, versioned projection with
request correlation identity, selected depth, the current question, request-
scoped node aliases, registered operations, bounded graph connections,
allowlisted settings, and safe current metric values. Consent is a volatile,
single-use capability bound to the exact explanation projection, the current
in-memory provider configuration/gateway, and private local references to the
dataset, model, runtime, and Run binding. Those references are used only for
revocation and are never projected to the provider. Consent is consumed before
the provider call and invalidated by question, depth, language, graph,
dataset, current-Run, or provider-configuration changes; it is never
remembered as a preference. The request excludes workspace node/edge IDs,
labels, coordinates, arbitrary text/code parameters, dataset rows, full
source, credentials, and UI state. Conversation history is not forwarded.

Provider replies must match schema version, request ID, and selected depth;
they are bounded and may cite only fact IDs supplied in that request. A stale,
failed, malformed, or unsupported reply is discarded and the deterministic
local graph reading remains available. Provider text is labeled as an
explanation, never as Evidence. It has no command or graph-mutation channel.

Changing component position or other presentation state does not change the
semantic projection or invalidate a response. A graph, current result, depth,
language, or question change does invalidate an in-flight response so stale
text cannot be shown against a different context.

## Scope

This contract covers graph explanation in Build only. It does not extract
Explore concepts, create an Explore experiment, add learner-history
persistence, or change the Playground and Agent APIs. Those remain separate
future integration steps.
