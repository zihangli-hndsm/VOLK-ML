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
| ONNX SHA-256 | `19b18790c5cc466d086ec473e91566bc3e852a74878fbae68f78d483a45c6cef` |
| ONNX size | 17,650,030 bytes |

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
omitted. Once the ONNX artifact exists, the actual Explore experience works
offline; the runtime does not call Hugging Face, VOLK-Cloud, or another remote
inference provider.

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

This is loopback isolation and a narrow request contract, not an operating
system sandbox: Python and ONNX Runtime execute with the current user's normal
process permissions. The service does not accept arbitrary paths, user-authored
ONNX, source code, text, or Cloud requests.

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

Project v9 persists only `localModelReferences: [{ profileId, sha256 }]`. It
does not embed the ONNX file or preserve its user path; another device must
relink the exact hash-matching local artifact before execution. The project
migration from v8 supplies an empty reference list. G2 references are artifact
metadata only and do not carry Explore session state into the Build graph.

## Development and acceptance

`npm run dev:g2` starts Vite and the local runner. It uses the environment's
`VOLK_G2_PYTHON`, then the app-local Python 3.12 virtual environment, then
`py -3.12`. The ordinary `npm run dev` remains unchanged and does not start a
model service. To run real reference validation, provide the local checkpoint
snapshot directory and regenerated artifact:

```powershell
$env:VOLK_G2_PYTHON = Join-Path $env:LOCALAPPDATA 'VOLK\venvs\g2-attention-exporter\Scripts\python.exe'
$env:VOLK_G2_MODEL_DIR = 'C:\path\to\pinned\checkpoint-snapshot'
$env:VOLK_G2_REFERENCE_ONNX = "$env:LOCALAPPDATA\VOLK\models\bert-tiny-attention-v25.onnx"
npm run check:g2-imported-model
npm run test:g2-imported-model:reference
npm run test:g2-imported-model:browser
```

The real reference test regenerates the ONNX file from the local checkpoint,
asserts the exact registered hash, starts the production loopback server, sends
the actual model bytes through the production client, and checks CPU logits,
normalized attention outputs, semantic comparison, and Evidence. The browser
test covers file relinking, explicit Run/Compare, rendering, project metadata,
and runner-offline failure containment while preserving any existing truthful
Evidence. This strict G2 profile does not make
other ONNX opsets, model files, sequence models, or general L2 graphs executable.
