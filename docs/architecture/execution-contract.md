# Execution Contract v1

`src/core/execution/executionContract.js` defines the shared, JSON-safe
request/result envelope for the currently supported local execution adapters:
Browser CPU graph runs, the bounded H2 local Python profile, and the registered
local ONNX Runtime CPU G2 profile.
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
| `browser-webgpu` | `volk-browser-webgpu-mlp` | Semantic graph + full fitted browser-MLP snapshot + exact input; `inference` only | `live-webgpu` |
| `local-python-h2` | `volk-h2-local-python` | Semantic registered Trainer graph + dataset + pinned H2 profile; `fit` only | `live-local` |
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

The H1 WebGPU capabilities use separate, mode-specific provider profiles.
`browser-webgpu` remains inference-only for the already-fitted registered
sequential tabular MLP subset. Inference uses
`src/core/execution/browserWebGpuMlp.js`: Dense, ReLU, Sigmoid, Tanh, and
Softmax compute for one input or a bounded batch of up to 128 rows. It compares
against the CPU reference and never writes fitted parameters. Training uses
`browser-webgpu-mlp-training` is fit-only and invokes
`src/core/execution/browserWebGpuMlpTraining.js` only after the learner presses
the Runner's separate “Fit this MLP with WebGPU” action. That bounded H1-T
profile implements forward pass, loss, backpropagation, mean mini-batch
gradients, and SGD-with-momentum or Adam updates in actual WebGPU compute
passes. CPU performs existing graph/data validation, deterministic split,
train-only normalization, and seeded initialization; the GPU computes the
training updates. CPU “Run” remains a separate action and its implementation is
unchanged. There is no implicit fallback between providers.

Both modes bind the current graph, project session, input, configuration, and
an `explicit-user-action` approval in Execution Contract v1. A fit result also
binds a provider-semantics version and returns bounded dispatch/step/loss
diagnostics. It is accepted only after the usual result-identity freshness
check, then the training diagnostics are kept in the execution envelope rather
than the persisted model. Cancellation, device loss, timeout, non-finite
output, resource-limit failure, or stale identity yields a non-success result
and does not commit a partially fitted model. The profile is restricted to the
currently validated sequential tabular MLP and bounded to 120 seconds, 64 MiB
of WebGPU allocations, 256 features, 8,192 training rows/parameters/activation
values, 500 epochs, and 100,000 optimizer steps. These limits are explicit
guardrails, not throughput promises. Generic L1 availability and the tier
estimator remain unchanged; the H1-T action is a request-specific exception,
not a general WebGPU backend declaration.

The WebGPU training arithmetic is checked independently against a scalar
Float64 micro-batch oracle with fixed elementwise envelope
`abs(error) <= 1e-5 + 5e-4 * abs(reference)`. This training envelope is separate
from the inference-specific thresholds below and is never widened at runtime.

H2 local Python is a separate explicit Runner action for its strict supported
tabular Trainer subset. The browser creates a semantic request projection;
the loopback coordinator validates it against the live registry, compiles the
same graph through canonical VOLK IR/PyTorch generation, and returns a
bounded tensor manifest. The fixed CPU worker runs under the Windows Job
Object supervisor only after suspended creation and verified assignment.
H2 results pass the same project-session, graph, input, configuration, and
freshness gate before model commit. It does not change generic tier estimates
or browser CPU behavior, and it has no implicit fallback. Setup, privacy
projection, profile bounds, and the limits of Job Object containment are
documented in [`h2-local-python.md`](./h2-local-python.md).

Unsupported graphs, missing/rejected devices, cancellation, device loss,
timeout, non-finite output, parity failure, or stale identity produce bounded
non-success results; there is no implicit CPU fallback. Inference has no
write-back to model/project/experiment state. GPU fitting updates the model
only after the standard freshness/acceptance gate; existing project and
experiment ownership is unchanged.

The fixed parity thresholds are: normalized-input handoff absolute error
`<= 1e-6 + 1e-6 * abs(CPU)`; Dense output `<= 1e-5 + 1e-4 * abs(CPU)`;
ReLU must preserve zero/positive classification and absolute error `<= 1e-6`;
Sigmoid, Tanh, and each Softmax element have absolute error `<= 2e-6`; each
Softmax row must sum to one with absolute error `<= 1e-5`. A failed threshold
makes the request non-success; tolerances are not widened at runtime.

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
The H1-T preflight and oracle regressions run through
`scripts/check-webgpu-mlp-training.mjs`; physical-device fit checks use
`scripts/webgpu-mlp-training-cdp-browser.mjs`.
