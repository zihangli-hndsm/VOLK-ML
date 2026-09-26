# D3 external Agent reference workflow

This local-only reference joins the installed Codex CLI, the existing D2 MCP
stdio server, the mounted D1 Agent Application API, and the existing B1/C2
learner previews. It does not add an alternate workspace runtime or mutation
route.

```text
real Codex CLI
  ├─ reads the bounded PyTorch fixture and runs torch.export in the B2 venv
  ├─ uses VOLK's metadata-only adapter to prepare a detached whole-graph proposal
  ├─ calls D2 MCP to stage B1 ── browser learner clicks Apply
  └─ inspects the accepted workspace and stages a detached C2 patch
                                      └─ browser learner clicks Apply
```

The runner starts a fresh local Vite app and isolated headless Chrome profile,
passes one ephemeral session token only to the D2 server/browser session, and
uses invocation-scoped Codex MCP configuration. Before launch, it reads only
server names from `codex mcp list`; it does not retain the command or environment
columns. It overrides each discovered server with an inert, disabled stdio entry,
then enables the D3 allowlisted server only. The configured default model and
`CODEX_HOME` login are reused; no model override or global configuration write
is performed. The model gets read-only repository access and a single per-run
scratch directory on `D:` when available. Codex runs with that scratch directory
as its only writable workspace; the repository is not added as another writable
root. Since the isolated scratch folder is not a Git checkout, the invocation
uses Codex's `--skip-git-repo-check`; source files are read by absolute path.
The isolated Chrome profile is a sibling of that workspace, not inside
it, and the browser bridge scrubs its one-time URL credentials before connecting.
The configured B2 Python `Scripts` directory is prepended only to the Agent
child's `PATH`. That is configuration, not evidence of which interpreter a
shell wrapper actually ran. The runner separately hashes the configured Python
executable and gives the fixture exporter a one-run nonce. After a successful
export command, the runner reads the exporter's bounded `.runtime.json` sidecar
from that run's private scratch directory and verifies its nonce, canonical
executable path, executable SHA-256, Python version, and PyTorch version against
the preflight values. Only this verified runtime attestation sets the
sanitized `usedPythonPath` proof flag. Command text and PATH ordering never do.
The report contains the verified versions and executable hash, but not the
nonce or full executable path.

The browser harness waits for the ordinary local-save indicator, requests a
fresh same-origin document, accepts only the browser-native `beforeunload`
confirmation when the app requests it, and resolves the resulting local-project
prompt through its visible `Start fresh` choice. It does not clear browser
storage or mutate app state. The browser confirmation is reported separately;
it does not dismiss or stand in for the in-app restore prompt.
Every recorded learner control is checked for viewport visibility and
`elementFromPoint` hit-target ownership, then activated through CDP mouse
move/press/release events. An overlay-obscured navigation control is exercised
as a negative case and must be rejected before any pointer press. The
before/after acceptance screenshots also require the restore overlay to be
absent, and their saved file paths are included in the resolved browser report.

The Agent may inspect, export metadata, and submit proposals. The enabled MCP
tool allowlist contains no Run, Apply, project-load, or parameter-write tool.
The browser harness uses only normal learner-facing Apply buttons and
read-only Agent API inspection. It never submits proposals or changes graph
state directly. Both existing previews revalidate current workspace state,
and their explicit Apply controls remain the only commit path.

The PyTorch fixture contains source code only. It has no dataset or trained
weights. The extractor omits parameter values; the report stores neither the
TorchExportDocument nor a proposal body. Sanitized provenance records event
types, allowlisted tool names, bounded proposal identities, the changed node
and parameter summary, and browser before/preview/after graph identities.
Tokens, raw commands, agent prose, dataset rows, and full MCP payloads are not
written to the acceptance report.

## Run locally

Prerequisites:

- Node dependencies installed in VOLK-ML.
- `codex` available on `PATH` and already logged in (`codex login status`).
- The isolated B2 Python environment with PyTorch. On the D3 acceptance host
  this is `C:\Users\Administrator\AppData\Local\VOLK\venvs\torch-export-b2\Scripts\python.exe`.
- Google Chrome installed at the standard Windows path. The runner uses a
  fresh temporary profile and closes its process on exit.

From the VOLK-ML root:

```powershell
npm run test:agent-application:d3:concurrency
npm run test:agent-application:d3:browser-preflight
npm run test:agent-application:d3
```

The concurrency command uses the real local MCP stdio server and browser bridge
with a bounded stub Agent API, not a model. It verifies that three parallel
initial reads safely expose the third-call `MCP_WORKSPACE_BUSY` boundary and
that issuing the same reads one at a time completes all three. The next command
is a no-model browser diagnostic for local restore-prompt handling, overlay
rejection, and starter-graph cleanup. It uses the visible
`Start fresh` choice, then the visible Delete component action and ordinary
confirmation dialog, checking the empty workspace and unobscured screenshot.
It does not invoke Codex and is not a substitute for the second command's real
Agent acceptance.

Optional host-specific paths can be supplied for a single invocation:

```powershell
$env:VOLK_D3_PYTHON = 'D:\venvs\torch-export\Scripts\python.exe'
$env:VOLK_D3_CODEX_PATH = 'C:\tools\codex.exe'
$env:VOLK_D3_TEMP_ROOT = 'D:\VOLK-ML-d3-temp'
npm run test:agent-application:d3
```

The runner is bounded to one Codex invocation and one browser journey. It
reports a safe reason and stops on missing authentication, unavailable quota,
timeout, MCP startup failure, malformed Agent events, or failed proposal
validation; it does not
retry paid Agent work. A successful sanitized report is written under
`docs/acceptance/assets/agent-application-d3/`. The full conversation, shell
output, export document, proposal payloads, and MCP session token are never
saved there. A passing run also saves five local browser screenshots for the
empty target, B1 preview/acceptance, and C2 preview/acceptance alongside the
sanitized JSONL provenance report.

A failed run writes a separate `NOT VERIFIED` diagnostic in the same local
directory. It records the bounded stage, safe selector/condition/timeout when
available, allowlisted error name/code, whether the Codex child handle and
`thread.started` event were observed, bounded event count and token usage when
observed, and a browser screenshot/state summary. The browser summary contains
only origin/path, readiness, and booleans indicating whether bridge credential
parameters remain; it never stores their values or extracted page text. The
optional PNG is a visual artifact, not OCR/text data. Raw commands and stderr
are not stored. MCP tool failures retain only a stable error code from a small
allowlist and its coarse class; unknown failures are marked unclassified, and
raw tool/provider text is never retained. Missing process or usage evidence is recorded as unobserved,
not inferred as a successful or failed Agent turn. A preflight screenshot is
diagnostic-only and is not B1/C2 acceptance evidence.

## Reference Agent prompt

The runner substitutes `{{REPOSITORY_ROOT}}`, `{{SCRATCH_DIRECTORY}}`,
`{{PYTHON_PATH}}`, and `{{MCP_PORT}}` into the following bounded task.

> A learner asks you to import a small PyTorch model and then change its first
> hidden layer to 128 units. Work only in the mounted VOLK Build workspace
> through the enabled `volk_ml_d3` MCP tools. Never use another MCP server,
> `__VOLK_ML_AGENT__`, direct browser evaluation, Run, or an Apply action.
>
> First inspect `{{REPOSITORY_ROOT}}/fixtures/graph-infrastructure-d3/pytorch-repo/README.md` and
> `{{REPOSITORY_ROOT}}/fixtures/graph-infrastructure-d3/pytorch-repo/model.py`. Run the existing isolated interpreter
> `{{PYTHON_PATH}}` on
> `{{REPOSITORY_ROOT}}/fixtures/graph-infrastructure-d3/pytorch-repo/export_document.py` with
> `--output {{SCRATCH_DIRECTORY}}/torch-export-document.json`. This performs
> real `torch.export` and calls VOLK's existing metadata-only extractor. Then
> run `node {{REPOSITORY_ROOT}}/scripts/d3-graph-proposal-helper.mjs torch-proposal
> {{SCRATCH_DIRECTORY}}/torch-export-document.json
> {{SCRATCH_DIRECTORY}}/whole-graph-proposal.json`. Read the generated
> `WorkspaceGraphProposalV1` and verify it has no parameter values or dataset
> content.
>
> Before calling MCP, wait for
> `http://127.0.0.1:{{MCP_PORT}}/health` to report `workspaceConnected: true`
> (at most 60 seconds). Do not inspect or print environment variables. The
> local bridge has a bounded two-request queue and services browser requests
> serially, so never fan out MCP calls: call one tool, wait for its completed
> result, and only then issue the next. Read the initial state in this order:
> `volk_inspect_workspace`, then `volk_list_capabilities`, then
> `volk_list_components`. If the learner-facing starter graph is still being
> cleared, wait briefly and repeat those read-only inspections one at a time.
> Proceed only after the Build graph is empty and Torch Export is supported.
> Then submit the exact whole-graph proposal using
> `volk_submit_graph_proposal`. Submission stages the existing B1 preview; it
> does not apply it. Do not call Run or Apply.
>
> After the browser learner accepts B1, call `volk_inspect_workspace`, wait for
> its completed result, and then call `volk_list_components`. Proceed only if
> the imported graph identity equals the `graphIdentity` in your own submitted
> proposal. Identify the first
> `dense` node with a `units` property from the live workspace inspection and
> component capability. Use your original proposal file as the detached C2
> base and run `node {{REPOSITORY_ROOT}}/scripts/d3-graph-proposal-helper.mjs patch-proposal
> {{SCRATCH_DIRECTORY}}/whole-graph-proposal.json <inspected-node-id> units
> 128 {{SCRATCH_DIRECTORY}}/hidden-layer-patch.json`. Read the resulting
> `GraphPatchProposalV1`, verify only that node's `units` value changes to
> 128, and submit it with `volk_submit_graph_patch_proposal`. This stages the
> existing C2 preview. Do not call Run or Apply. Stop after the proposal is
> staged; the browser learner controls acceptance.

## Evidence and regression checks

The real reference journey must show:

- The external Agent read the fixture, ran the B2 interpreter/exporter, and
  called the allowlisted D2 tools for B1 and C2.
- B1 and C2 previews were visible and valid while their pre-Apply graph
  identities were unchanged.
- The app's ordinary starter graph was cleared through visible learner-facing
  Delete component controls and their explicit confirmation dialog. The browser
  harness did not call a graph mutation API to prepare the empty B1 target.
- The automated learner Apply click closed each preview; B1 installed the
  canonical exported graph and C2 changed the first hidden node's `units` to
  128.
- The graph-patch revalidation contract still rejects stale bases.

`npm run check:agent-application:d3` validates the D3 invocation, allowlist,
event redaction, proposal summaries, and attestation validator without
pretending to be real Agent acceptance. It also exercises the same
Codex-child setup/JSONL reader with a stub child process and, when the optional
B2 PyTorch interpreter is installed, runs the real fixture exporter to verify
that its actual interpreter attestation matches the configured executable.
The mismatched-binary negative case must fail before writing an export or
attestation. These checks do not make a Codex/model call. The actual
browser/Agent proof is a separate `npm run test:agent-application:d3` run.

The real-run diagnostic now marks `agent.evidence-validation` before checking
the exporter completion and runtime attestation. This keeps an exporter-proof
failure from being mislabeled as a browser selector timeout after the browser
has already completed its learner Apply actions.
