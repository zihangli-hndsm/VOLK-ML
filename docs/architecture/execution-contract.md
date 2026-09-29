# Execution Contract v1

`src/core/execution/executionContract.js` defines the shared, JSON-safe
request/result envelope for the currently supported local execution adapters:
Browser CPU graph runs and the registered local ONNX Runtime CPU G2 profile.
It is a commit boundary, not a scheduler, remote execution API, permission
system, or replacement for either runtime.

## Authority and flow

```text
explicit learner action
  → bounded ExecutionRequestV1
  → registered adapter executes locally
  → bounded ExecutionResultV1
  → exact identity + freshness validation
  → existing runtime result / deterministic detector commit
```

The request is versioned and binds one graph identity or one registered
artifact identity (never both), a project-session identity, input and
configuration SHA-256 identities, provider and adapter IDs, execution mode,
budgets, and an approval record. Its request digest covers every request field
except the approval record itself. This digest is correlation and intent
binding, not cryptographic proof of a click, user authentication, or a security
boundary.

The result repeats the request's identities exactly and includes a distinct run
ID, status, provider version, canonical provenance, bounded output/diagnostic
codes, and cancellation disposition. Consumers accept only a validated
`succeeded` result whose graph/artifact, project session, input, and
configuration identities are still current. A failure, timeout, cancellation,
or stale completion cannot be passed to deterministic Evidence detectors.
Existing semantic runtime state remains authoritative; this envelope never
creates a second graph, dataset, experiment, or Evidence store.

Presentation-only state such as pan, zoom, selection, and viewport is excluded
from semantic execution identity. Graph fingerprints cover registered graph
semantics, not node placement. Changing actual graph parameters or connections,
dataset contents, configuration, or project session makes the prior result
stale.

## Bounds and adapters

The strict v1 validators reject unknown fields, non-JSON values, oversized
identities/outputs, non-finite numbers, unsupported provider/mode/status values,
invalid timestamps, unregistered provenance, and mismatched result identity.
Budgets are capped at 120 seconds, 20 MiB of input, and 256 KiB of output;
diagnostics are short reason codes and limited to eight entries. Current
registered adapters are:

| Provider | Adapter | Identity | Provenance |
| --- | --- | --- | --- |
| `browser-cpu` | `volk-browser-runtime` | Semantic graph + dataset + runtime configuration; `fit` only | `live-local` |
| `local-onnxruntime-cpu` | `onnxruntime-cpu` | Exact registered G2 Attention profile, an accepted SHA-256 alias, fixed input pair + runtime configuration; `compare` only | `live-local` |

`getExecutionCapabilityV1()` reports a registered adapter's explicit
`supported` status and constraints, or `not-assessed` with the stable reason
`EXECUTION_PROVIDER_NOT_REGISTERED` for an unknown provider.
`assessExecutionCapabilityV1()` evaluates a proposed semantic identity/mode:
known but incompatible combinations are `unsupported` with a stable reason.
`validateExecutionRequestV1()` invokes this assessment before approval/result
acceptance, so Browser CPU cannot claim artifact execution and ONNX Runtime
cannot claim graph execution. ONNX Runtime accepts only the profile ID and
SHA-256 aliases registered by `profile.js`; an arbitrary profile or artifact
hash is rejected. These checks report capability; they do not authenticate a
caller or sandbox an adapter.

For Browser CPU runs, cancellation is cooperative at training checkpoints and
between graph nodes. The UI can request cancellation and the client discards
any uncommitted output. A long synchronous operation cannot be preempted by
JavaScript, so a result still passes the normal freshness gate before commit.
The detached serializable execution envelope is exposed in the existing Canvas
Agent snapshot under `execution.runtime.execution`; the Canvas Agent API version
and existing `execution.runtime` meanings do not change.

G2's loopback service has additional connection authorization and narrower
artifact/request validation; see [`imported-attention-g2.md`](./imported-attention-g2.md).
Neither this contract nor the local connection code sandboxes the companion
process from the signed-in operating-system user. Cloud and non-local providers
are not enabled by this implementation.

## Validation

`scripts/check-execution-contract.mjs` covers strict schema validation,
digest-bound approval, graph/artifact exclusivity and provider compatibility,
registered G2 profile/hash validation, explicit capability status/reasons,
budgets, provenance, identity/freshness, and fail-closed result acceptance.
It runs as part of `npm run check` through `scripts/check-core.mjs`.
