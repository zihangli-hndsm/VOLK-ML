# H2 Local Python v2

H2 is an explicit, app-local CPU training exception for one bounded tabular
`Supervised Trainer` profile. It does not make generic L2 available, change
the Browser CPU runtime, or add a second graph/compiler/runtime contract.

## Authority and execution path

```text
learner presses “Fit this model with local Python”
  → semantic H2 request projection (graph + dataset, no layout)
  → strict local coordinator validation against the live component registry
  → canonical VOLK IR → PyTorch compiler with the H2 training profile
  → one-use request authorization
  → fixed Python worker, data supplied only on stdin
  → bounded result and tensor-manifest validation
  → Execution Contract v1 identity/freshness gate
  → current Build model commit
```

The browser keeps the existing CPU Run action separate. The H2 client is
configured only by the local development launcher; an absent or offline
companion leaves normal browser execution intact. H2 output is accepted only
for the graph, project session, dataset, configuration, and request that were
current when the learner started the fit. Failure, cancellation, timeout, or
stale completion cannot replace the prior model.

The H2 request is a closed, versioned projection of registered component
identities/parameters, connections, dataset columns/rows, split, and training
configuration. Classification requests include an explicit ordered class
vocabulary in dataset identity and run identity, so integer worker labels map
back to the exact original categories. Numeric feature and regression-target
values accept finite numbers or non-empty numeric strings; nulls, booleans,
empty strings, and non-finite values are rejected instead of silently
coercing to zero. Tensor Input shapes and every Dense layer's input/output
dimensions are checked against the connected predecessor before compilation.
Canvas layout, selection, viewport, DOM, screenshots, and UI
telemetry are excluded. The canonical compiler generates source from the
validated registered graph; training rows are not interpolated into that
source. Request and result envelopes use `volk.h2.request.v2` and
`volk.h2.result.v2`; the result echoes the request's target semantics and
class mapping for independent validation. Dataset values travel to the loopback coordinator and fixed worker as
bounded JSON/stdin data, not as a generated script or temporary dataset file.
Only compiled source is written under the app-owned temporary run directory,
which is removed after completion or failure.

## Fixed profile and limits

The accepted profile is sequential tabular single-input/single-output Dense
networks with ReLU, Sigmoid, Tanh, optional terminal Softmax, and Dropout;
MSE or cross-entropy; SGD (including momentum) or Adam; and the registered
train/test split and Supervised Trainer. The semantic validator checks the
connected graph and live registry parameters before compilation. The request
is capped at 4,096 rows, 64 features, 128 graph nodes, 256 edges, three hidden
Dense layers of width 128, 8,192 parameters, 100 epochs, batch size 256, 20
MiB input, 256 KiB output, and 120 seconds.

The local runtime is pinned in `tools/h2_local_python/runtime-lock.json` to
official Windows CPython 3.12.10 embeddable, PyTorch 2.14.0 CPU, and NumPy
2.5.3 artifacts with SHA-256 verification. The local Windows supervisor
creates the worker suspended, assigns it to a Job Object with a 2 GiB aggregate
job memory limit and kill-on-job-close, verifies assignment/limits, then
resumes it. The supervisor also configures a guaranteed Job Object memory
notification at the same 2 GiB threshold (it does not lower or replace the
hard cap), then queries the typed limit-violation record before reporting a
resource failure. Only a confirmed job-wide memory violation followed by an
abnormal worker exit maps to `H2_PROCESS_MEMORY_LIMIT_EXCEEDED`; malformed
worker output without that evidence remains `H2_WORKER_RESPONSE_INVALID`.
Cancellation, timeout, client disconnect, and coordinator exit
terminate the supervised process tree; success waits for confirmed worker
exit before returning its result.

Job Object process and memory containment is **not** a complete operating
system sandbox. It does not prevent paging, crash dumps, administrator access,
or every host-level side channel. H2 is a local developer/runtime capability,
not a multi-user service or hostile-code execution environment. The worker
executes only source emitted by the canonical compiler after identity
verification; arbitrary user-provided Python is not accepted.

## Local setup and verification

On 64-bit Windows, install the optional pinned environment with:

```powershell
npm run setup:h2-local-python
```

Setup downloads only pinned official artifacts, validates SHA-256 hashes, and
installs beneath the current user's `AppData\Local\VOLK` directory. It does
not modify global Python or project files. Start the coordinator and Vite
application together with:

```powershell
npm run dev:h2-local-python
```

Open `http://127.0.0.1:5173`, switch to Build, open Run for a supported
Trainer graph, and copy `H2_PAIRING_TOKEN` from the coordinator terminal into
the local runtime pairing field. Select **Connect local runtime**; this only
checks and pairs with the local companion. Then explicitly select **Fit this
model with local Python** to start training. Closing/reloading the page drops
the in-memory pairing; restarting the companion requires its newly printed
code. Browser Run remains a separate choice. H2 is not enabled by generic
execution-tier estimates.

Focused acceptance commands are `npm run check:h2-local-python`,
`npm run test:h2-local-python:companion`, and
`npm run test:h2-local-python:browser`. On Windows,
`npm run test:h2-local-python:lifecycle` also verifies runtime/setup failure,
client cancellation, worker/supervisor termination, marker-owned temporary
cleanup, and coordinator restart recovery. The real 120-second worst-case CPU
deadline stress test is opt-in via
`$env:VOLK_H2_RUN_DEADLINE_TEST='1'; npm run test:h2-local-python:lifecycle`.
The browser test launches an isolated
headless browser, verifies the configured local HTTP authorization and fit
responses, and checks that a current `live-local` Execution Contract result
was committed. Full repository acceptance also runs `npm run check`,
`npm run build`, and `git diff --check`.
