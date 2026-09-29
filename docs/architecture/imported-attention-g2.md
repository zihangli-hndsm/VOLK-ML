# G2 imported attention profile

G2 is a narrow, local execution path for one imported BERT-Tiny
sequence-classification artifact. It is not the existing sequence playground
adapter, a general ONNX runtime, or general L2 availability. The existing
`sequence-attention` adapter and B3 metadata-only ONNX proposal flow are
unchanged.

## Pinned model and artifact

The checkpoint is
[`gokulsrinivasagan/bert_uncased_L-2_H-128_A-2_sst2`](https://huggingface.co/gokulsrinivasagan/bert_uncased_L-2_H-128_A-2_sst2/tree/e454ff624bde2785ee174112f0bcc7e99da8344d),
revision `e454ff624bde2785ee174112f0bcc7e99da8344d`, under Apache-2.0. The
exporter verifies the pinned `model.safetensors` SHA-256 before loading it.
The accepted single-file ONNX profile is:

| Property | Pinned value |
| --- | --- |
| Profile | `bert-tiny-sst2-attention-v25-cpu-v1` |
| Model | 2 layers, hidden size 128, 2 heads, intermediate size 512, 2 logits |
| ONNX | Standard domain, opset 25, 70 nodes, exactly two `Attention` nodes |
| Attention output | `qk_matmul_output_mode=3`, post-softmax probabilities |
| Runtime | ONNX Runtime 1.30.0, `CPUExecutionProvider` only |
| Current ONNX SHA-256 | `3ef55e4c13475e2b6cf4aec1f5002130412e9d58659e9e0943aeae863eba9cb1` |
| Current ONNX size | 17,641,252 bytes |
| Exact legacy alias | `19b18790c5cc466d086ec473e91566bc3e852a74878fbae68f78d483a45c6cef` (17,650,030 bytes) |

The exporter is `tools/g2_attention/export_reference.py`. It uses a pinned
Transformers/PyTorch/ONNX toolchain, checks the tokenizer's six IDs, exports the
model, and compares both logits and actual per-layer attention probabilities
against the source Transformers model for both A/B inputs (maximum absolute
error limit `2e-4`). The local runtime rejects any artifact with another hash,
input/output signature, node count, opset, or Attention profile.

The Attention v25 QK-probability output has an ONNX metadata shape whose final
dimension is unspecified. ONNX Runtime therefore emits a shape-inference
warning showing the runtime matrix `[1, 2, 6, 6]` versus metadata `[1, 2, -1,
0]`. This does not affect values: exporter parity checks and the runner's strict
runtime shape/probability checks both require two normalized 6×6 matrices.

On Windows, create isolated local environments rather than changing global
Python packages:

```powershell
npm run setup:g2-exporter
$env:VOLK_G2_PYTHON = Join-Path $env:LOCALAPPDATA 'VOLK\venvs\g2-attention-exporter\Scripts\python.exe'
& $env:VOLK_G2_PYTHON tools/g2_attention/export_reference.py --output "$env:LOCALAPPDATA\VOLK\models\bert-tiny-attention-v25.onnx"
npm run setup:g2-runtime
```

The exporter downloads only the pinned model revision when `--model-dir` is
omitted. It normalizes absolute checkout and Python-environment paths only in
the nonsemantic `pkg.torch.onnx.stack_trace` debug metadata, preserving frame
function and line information. This makes export bytes reproducible across
checkout roots while SHA-256 remains the identity of the exact file bytes.
Existing projects using the one exact legacy digest remain supported as an
explicit alias; arbitrary hashes are still rejected, and both artifacts must
pass the same pinned graph-profile and source/CPU parity validation. New
exports use the current digest. Once the ONNX artifact exists, the actual
Explore experience works offline; the runtime does not call Hugging Face,
VOLK-Cloud, or another remote inference provider.

## Local execution boundary

`dev/g2_attention/server.py` binds only to `127.0.0.1:8765`. It accepts model
bytes at `POST /v1/model/import`; it never accepts a client-provided filesystem
path. The artifact is checked and loaded into one in-memory ORT session, and
neither artifact bytes nor request samples are written by this service. The
comparison route accepts only the versioned request ID, exact model hash, and
the registered token-ID pair. It constructs the fixed all-visible mask and
zero token types locally and returns logits and checked probability matrices.
Responses are correlated and strictly validated by
`src/services/localAttention/client.js` before the inquiry record is updated.
Its per-request deadline and optional caller cancellation remain active until
the complete response body has been consumed and the endpoint-specific
response contract has passed validation. A timeout or close/cancel after
headers but before a valid body therefore settles the request without exposing
a partial result; the UI can leave its busy state, preserve the previous
comparison and Evidence, and allow an explicit retry.

This is loopback isolation and a narrow request contract, not an operating
system sandbox: Python and ONNX Runtime execute with the current user's normal
process permissions. The service does not accept arbitrary paths, user-authored
ONNX, source code, text, or Cloud requests.

The local service contract is `g2-local-v2`. It binds only to IPv4 loopback,
requires the exact `127.0.0.1:<port>` Host, accepts browser requests only from
the local Explore origins, and requires the per-process connection code in
`X-VOLK-Local-Authorization`. The code is generated in memory for each
`npm run dev:g2` launch and printed by that local development command; it is
not written to the project, URL, browser storage, or request body. The G2
surface requires the learner to enter it and provides an explicit Disconnect
action. Cross-origin preflight allows only the registered origins, methods,
and headers. A connection code is local page authorization, not OS-level
isolation or protection from local processes running as the same user.

The v2 health response reports the API/profile, ONNX Runtime provider version,
adapter ID, execution-contract version, and maximum concurrent operations.
Compare requests include that provider version; both the runner and client
reject a mismatch, and the compare response repeats the serving version so the
version is bound into the execution configuration identity. Requests and
responses use the shared strict Execution Contract v1 envelope at the semantic
commit boundary. Its approval digest binds the exact local request and is not
an authentication token or cryptographic proof of learner intent. See
[`execution-contract.md`](./execution-contract.md).

The runner admits at most four HTTP handler threads and one model load/inference
operation at a time. Bodies are bounded to the registered 20 MiB artifact or
16 KiB JSON request; request-body reads have a 20-second deadline, and model
comparison has a 25-second server deadline. The browser client has a bounded
response-body read and a 30-second request deadline. If an inference call
exceeds the deadline, the client rejects it and the semantic result is not
committed; the native ONNX call is not forcibly interrupted, so the single
operation slot stays occupied until it returns. A learner can stop both local
development processes with Ctrl+C. A port conflict exits with an explicit
`VOLK_G2_PORT_IN_USE` diagnostic and does not attach to or reuse another
service.

The two inputs are `[101, 2023, 3185, 2001, 2204, 102]` and
`[101, 2023, 3185, 2001, 2919, 102]`; exactly token position 4 changes. Model
weights, family, sequence length, attention mask, token types, and execution
provider are held constant. The browser displays the corresponding example
phrases but sends token IDs only to the loopback service. Neither phrase, token
IDs, weights, matrices, nor result values are copied into graph/proposal data or
the project artifact.

The semantic event log is the existing `createSemanticEventStore()` contract.
A successful explicit comparison appends `comparison.completed`; the
deterministic detector appends `observation.detected` only when a matrix cell's
absolute attention-probability change exceeds `1e-6`. Its bounded evidence
records per-layer max deltas and logit deltas. A Concept Card is shown only when
that detector evidence exists. Weak movement still leaves the comparison
visible and does not surface the concept. Failed, timed-out, stale, malformed,
or mismatched responses do not append events or alter the previous evidence.
Each successful comparison receives unique A/B experiment identities derived
from its validated request ID. Repeating the same fixed semantic condition
retains comparison history but condition-level deduplication prevents duplicate
Evidence. Loading or importing a project begins a fresh in-memory G2 inquiry
session, even when the same model hash remains linked; any in-flight result is
aborted and cannot populate the new session. The learner must explicitly run
again to create current-session comparison or Evidence.

Project v10 persists only allowlisted local artifact references. The current
artifact reference is `{ profileId, sha256, manifestId }`; the registered
legacy alias keeps `{ profileId, sha256 }`. It does not embed the ONNX file or
preserve its user path; another device must relink the exact hash-matching
local artifact before execution. The v9-to-v10 migration adds the registered
manifest identity only to the exact current artifact reference. G2 references
are artifact metadata only and do not carry Explore session state into the
Build graph.

On the same browser origin, a separate IndexedDB database stores the verified
artifact as a Blob under the registered `profileId:sha256` key. The cache
record contains only the profile identity, digest, and bytes; it never records
the selected filename or path. A manual file selection is hashed before the
local runner import and saved to IndexedDB only after that import succeeds.
The cache holds at most one registered artifact (up to 20 MiB); saving another
clears the previous entry, and the explicit Clear cache control removes the
stored bytes. Clearing does not unload a model already held in the active
runner session.
Each recovery read checks the record shape, size, and SHA-256 again before
re-importing it into the loopback runner. A missing record presents the
existing explicit relink path. A malformed or mismatched record is discarded,
fails closed, and asks for relinking. If browser storage is unavailable or
full, the current imported session remains usable and the UI explains that a
refresh may require relinking.

The cache is local browser storage, not project persistence: model bytes never
enter project JSON/downloads, cloud providers, synchronization, or the local
project store. Restoring a project hash reference or reloading a cached model
only prepares the runner; neither action runs inference, creates comparison
results, nor appends semantic events or Evidence. The learner must still press
**Run and compare A / B** to execute the fixed comparison.

## Build attention-node correspondence

The static, versioned profile manifest in
`src/core/playground/importedAttention/profileManifest.js` describes the exact
exported model inputs/outputs and ONNX operator/tensor identities. The
reproducible exporter-side generator `tools/g2_attention/export_manifest.py`
derives that manifest from the pinned model directory and ONNX bytes; the real
reference check requires two independent exports to produce the registered
manifest exactly. The manifest identifies which attention-probability output
belongs to each exported layer without treating visual layout or node labels
as model semantics.

From Build, the learner may open G2 for exactly one selected, canonical
`multihead_attention_node` with the registered `embed_dim: 128`, `num_heads: 2`,
and `dropout: 0` configuration, then choose one of the two manifest-declared
layers. `ModelArtifactBindingV1` records an `operator-correspondence`: the
selected Build node is an explicit conceptual anchor for the identified
exported ONNX operator/tensor. It does not assert that the standalone BERT-Tiny
is encoded by or was executed from the Build graph. In particular, the Build
node's sole `output` port is a context tensor, not the attention-probability
matrix shown by G2; UI copy and comparison records preserve this distinction.

The binding is local, ephemeral session state, not project JSON. It is
recomputed from the current project session, semantic graph fingerprint,
selected node, exact registered component contract and parameters, selected
layer, current artifact digest, and registered manifest identity. Layout-only
changes preserve the semantic fingerprint. Semantic graph/parameter changes,
selection changes, artifact or manifest changes, and project-session changes
invalidate the binding and disable comparison until it is valid again or the
learner explicitly clears it to continue in standalone Explore. A completed
comparison and its Evidence record the binding identity that was validated
before and after local inference; clearing or suggesting a binding never runs
the model or creates Evidence.

## Development and acceptance

`npm run dev:g2` starts Vite and the local runner. It uses the environment's
`VOLK_G2_PYTHON`, then the app-local Python 3.12 virtual environment, then
`py -3.12`. The ordinary `npm run dev` remains unchanged and does not start a
model service. On Windows the runner claims its loopback address with
`SO_EXCLUSIVEADDRUSE` and does not enable address reuse; an overlapping process
therefore cannot share the live listener. Other platforms retain ordinary
`SO_REUSEADDR` restart behavior without enabling `SO_REUSEPORT`. Bind conflicts
are reported as `VOLK_G2_PORT_IN_USE`, including Windows' exclusive-bind
`WSAEACCES` code. To verify the real process lifecycle on a machine with the
local ONNX Runtime environment, set `VOLK_G2_PYTHON` and run
`npm run test:g2-port-binding`; it starts an owner, checks that a second runner
process fails with the diagnostic without displacing the owner, then stops the
owner and verifies a fresh runner can bind and pass health.

To run real reference validation, provide the local checkpoint snapshot
directory and regenerated artifact:

On launch, the development command prints the one-time local connection code.
Open the G2 surface in Explore, enter that code, and press Connect before
importing or running the pinned model. Disconnect revokes access from that
page; restarting the command creates a new code and owns both service
lifecycles together.

```powershell
$env:VOLK_G2_PYTHON = Join-Path $env:LOCALAPPDATA 'VOLK\venvs\g2-attention-exporter\Scripts\python.exe'
$env:VOLK_G2_MODEL_DIR = 'C:\path\to\pinned\checkpoint-snapshot'
$env:VOLK_G2_REFERENCE_ONNX = "$env:LOCALAPPDATA\VOLK\models\bert-tiny-attention-v25.onnx"
$env:VOLK_G2_LEGACY_ONNX = 'C:\path\to\previously-accepted\g2-export-test.onnx'
npm run check:g2-imported-model
npm run test:g2-port-binding
npm run test:g2-imported-model:reference
npm run test:g2-imported-model:browser
```

The real reference test exports from two independent temporary checkout roots,
asserts byte-for-byte reproducibility and the exact current hash, validates the
exact registered legacy alias, starts the production loopback server, sends
both actual model files through the production client, and checks pinned-source
CPU logits, normalized attention outputs, semantic comparison, and Evidence. It
does not overwrite either supplied artifact. The browser
test covers file relinking, local hash-addressed cache persistence, project
refresh and runner-restart recovery without inference, missing/corrupt cache
recovery, hash-only project export, explicit Run/Compare, rendering, and
runner-offline failure containment while preserving any existing truthful
Evidence. It also verifies repeated-run identity and Evidence deduplication,
plus stale-response cancellation and clean inquiry state after a same-hash
project switch. This strict G2 profile does not make
other ONNX opsets, model files, sequence models, or general L2 graphs executable.
