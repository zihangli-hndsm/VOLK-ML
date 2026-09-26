# Local development

VOLK-ML is local-first. The frontend and local learning runtime work without a
backend; the temporary backend only verifies the future Cloud boundary.

## Start

```text
npm install
copy .env.example .env.local
npm run dev:all
```

Open `http://localhost:5173`. The local backend listens at
`http://127.0.0.1:8000`, and its health contract is
`http://127.0.0.1:8000/health`.

On Windows, `npm run dev:backend` tries the Python launcher (`py -3`) and falls
back to `python` only when the launcher executable is unavailable. If Python
itself exits with an error, it is reported rather than retried with another
interpreter. The frontend-only command is `npm run dev`.

## Configuration

`VITE_VOLK_API_URL` is optional. In development it defaults to
`http://127.0.0.1:8000`; set it in `.env.local` when testing another
development backend. In a production build, an absent URL disables Cloud
integration and no network request is attempted. Set the variable at build
time only when the published application should check a configured endpoint.
Do not put API keys or provider secrets in this file.

The development-only header indicator reports either “Cloud development
backend connected” or “Local mode — backend unavailable”. An unavailable
backend does not block Explore, World manipulation, Experiment operations, or
deterministic local Evidence.

## D2 local MCP workspace connection

D2 exposes the mounted workspace through the official MCP TypeScript SDK. The
MCP server uses stdio for JSON-RPC and a loopback-only browser session to call
the existing Agent Application API v1. It never receives a React object or a
Canvas Agent callback, and the tool list has no Apply or direct Run tool.

Use a fresh high-entropy session token of at least 32 URL-safe characters. Keep
it in the process environment; do not put it in source, a project file, or a
log. In PowerShell, for example:

```text
$env:VOLK_MCP_PORT = '5189'
$env:VOLK_MCP_SESSION_TOKEN = '<fresh-url-safe-token>'
npm run dev
```

Configure the external MCP client to spawn the server with the same working
directory and environment:

```text
command: node
args: scripts/volk-mcp-server.mjs
cwd: C:\path\to\VOLK-ML
```

Then open the intended local workspace in the same development browser:

```text
http://127.0.0.1:5173/?mcpBridge=http%3A%2F%2F127.0.0.1%3A5189%2Fv1%2Fbridge&mcpToken=<same-token>
```

The browser bridge is development-only. It accepts only `http://localhost`,
`http://127.0.0.1`, or `http://[::1]` endpoints, requires the configured
session token and the page's local Origin, binds one browser nonce to one
session, and expires an idle session after 20 seconds. The server listens only
on `127.0.0.1`; a different website or process cannot attach without the token
and the bound local Origin. A local process that has both is intentionally in
scope for this developer-only connection, so use a fresh token and close the
client when finished.

The nine MCP tools are `volk_inspect_workspace`, `volk_list_components`,
`volk_list_capabilities`, `volk_submit_graph_proposal`,
`volk_submit_graph_patch_proposal`, `volk_inspect_proposal`,
`volk_inspect_results`, `volk_export_graph`, and `volk_request_run`.
Proposal tools open the existing B1/C2 previews; only the learner's current
Apply button can commit. `volk_request_run` returns
`USER_CONFIRMATION_REQUIRED`. Inspection remains row-free and omits free-form
text/code parameters, credentials, browser handles, and presentation state.

The focused D2 checks are:

```text
npm run check:mcp-transport
npm run test:mcp:browser
```

The browser check starts a real Vite app, a real headless Chrome mounted to the
canonical workspace, an official MCP stdio client/server pair, and exercises
initialize/list-tools/call-tool, preview/cancel/Apply, stale-base rejection,
result freshness, PyTorch source export, malformed/oversized containment, the
confirmation gate, and disconnect/deadline behavior. The server prints only a
bounded readiness record to stderr; stdout remains the MCP protocol channel.

## Phase A architect iteration workflow

Start the local frontend (and optional disposable backend) with:

```text
npm run dev:all
```

Open `http://localhost:5173/?directorDebug=1` in a development build. The
Explore Home bar is explicitly marked development-only and provides:

- Launch Director — opens the eight-beat presentation. Use Play/Pause,
  Previous/Next, Restart, or the **Select implemented beat** menu to jump to
  any beat. The same controls are available with keyboard: Left/Right arrows,
  Space, and Escape.
- Start onboarding — opens the Phase A semantic onboarding workspace.
- Restart onboarding — rebuilds that workspace at deterministic seed `7101`
  and clears its session events.
- Enter Episode 1 directly — bypasses Director/onboarding and opens the existing
  Episode 1 contract, also at seed `7101`.

The Director CTA and Skip intro buttons open onboarding, not Episode 1. In the
onboarding workspace, use the existing World tools or invitation buttons to
change Noise/sample size, resample, fit, duplicate, and compare. Learner
actions emit normal Semantic Event v2 records. Prompts, beat navigation, debug
shortcuts, and view changes emit none. After any meaningful learner action,
choose **Explore this question** to promote a clean Episode 1 runtime.
Promotion is idempotent; selecting it again does not create another runtime.

Useful direct URLs:

```text
http://localhost:5173/?directorDebug=1   # Director + architect shortcuts
http://localhost:5173/                  # normal learner Explore Home
```

Close the playground to return safely. Restart onboarding whenever a clean
free-exploration state is needed; use direct Episode 1 entry when testing the
contract independently. These controls are development-only and are not part
of the production learner surface.

## T7 real-provider matrix driver

The development build exposes a credential-safe test driver only while the
page is running in Vite development mode. Configure the provider through the
existing AI settings dialog; the key remains in volatile page memory. Open
Episode 1 and use the amber **Architect iteration shortcuts (development
only)** panel to enter a frozen revision and choose **Run matrix**. Progress
and bounded rows appear in the panel.

For an automation channel that can access page globals, the equivalent call is:

```js
await globalThis.__VOLK_ML_T7_MATRIX__.run({ revision: 'ae5b0d0' })
```

The driver sends the twelve authored teaching-dialogue contexts through the
same configured policy boundary twice (24 calls). It returns only case ID,
run number, origin, selected move, localized content key, grounding, supplied
reference IDs, bounded rubric scores, and safe failure categories. It never
returns provider text, request bodies, credentials, or runtime state. A missing
or failed provider produces local/fallback rows rather than retrying or
changing the learner runtime. The global is absent from production builds.

## LUMI companion checks

Inside any Explore playground, the small floating LUMI companion stays
available while you work. Its body state names whether it is ambient, looking,
guiding, noticing evidence, or illuminating a newly eligible concept. **Ask
LUMI** opens the existing suggestion surface; **See evidence** opens the
structured comparison; **Ideas map** opens the read-only concept map. A
continuation question only focuses the relevant surface and does not run an
experiment. With no Cloud URL or an unavailable service, the same companion
uses the deterministic local policy.

## Tests

```text
npm run check:volk-cloud
npm run check:local-backend
npm run test:local
npm run build
git diff --check
```

`npm run check:volk-cloud` covers mocked Cloud-client behavior, production
no-config network isolation, development defaults, configured production
endpoints, and runtime independence. `npm run check:local-backend` starts the
actual disposable Python fixture on a temporary port and verifies its `/health`
and local CORS contract, including cleanup. `npm run test:local` runs both
focused checks. The comprehensive `npm run check` remains the repository-wide
suite. No production backend is bundled into GitHub Pages.

## Local ONNX graph import (B3)

ONNX import is an optional local preparation step; the browser receives only a
bounded metadata JSON document, never the `.onnx` protobuf or external tensor
files. With a local Python that has ONNX and NumPy installed, run:

```text
python tools/onnx/extract_onnx.py --input model.onnx --output model.onnx.json --model-id local-model
```

Then open Build → More → **Import normalized ONNX JSON**, select the generated
JSON, inspect the detached graph preview, and use **Apply graph** only if the
current workspace is empty and the proposed architecture is what you want.
Canceling or rejecting the document does not alter the workspace. The adapter
supports only standard ONNX opset 13; models at the current default opset 28
receive a clear unsupported-opset diagnostic. The supported operator subset,
metadata-only initializer rule, and reshape limitations are detailed in
[`architecture/graph-interop.md`](architecture/graph-interop.md#b3-local-onnx-adapter).

For the real ModelProto and browser regressions, set `ONNX_PYTHON` to the ONNX-enabled
Python executable and run `npm run check:onnx-interop` and
`npm run test:onnx:browser`. A configured but unavailable/broken interpreter is
a test failure, not a silent skip.

Episode 0 is frontend-shipped and runs through the same Explore host. Use
`npm run check:episode-0` to verify its registry, stage derivation, fallback,
out-of-order progress, and generic-runtime reuse fixture.

## Provider test entry points

The provider checks are deterministic by default and safe to run without
credentials or a network. They exercise the same teaching adapter, request
projection, response validator, and local fallback used by the application:

```text
npm run test:provider:contract
npm run test:teaching:integration
npm run test:teaching:e2e
npm run test:provider:live -- --mode=smoke --allow-live
```

The first command checks the provider contract with fixture-only transport. The
second drives a clean Episode 1 session through the real playground host and
adapter; it is the host-integration check used by `npm run check`. The browser
E2E entry is intentionally separate. In this environment no safe browser
runner is available, so `npm run test:teaching:e2e` prints structured
`NOT VERIFIED` and exits nonzero rather than reporting a false green result.
The first two commands make zero external requests. The live command is opt-in: without
`--allow-live`, or without a provider key, it exits `NOT VERIFIED` and makes no
network calls. Smoke mode runs the bounded first three authored cases; the
default full mode runs the 12-case matrix twice with a hard cap of 24 initial
calls, a bounded 20-second live policy budget per case, and no script-level
retries or repair passes. This live-test budget is separate from the 10-second
production learner policy timeout.

For a live run, supply configuration only through the current process
environment (never command-line arguments, source files, Vite-exposed values,
or report files):

```text
VOLK_PROVIDER_API_KEY=...        # or VOLK_AI_API_KEY
VOLK_PROVIDER_PROTOCOL=...
VOLK_PROVIDER_ENDPOINT=...
VOLK_PROVIDER_MODEL=...
VOLK_PROVIDER_VENDOR=...
```

The live runner reuses the application provider gateway and writes only a
sanitized summary to `.test-artifacts/provider-live-report.json` (ignored by
Git). Reports include requested/executed/skipped and failed case IDs, bounded
provider/network/fallback/repair counts, safe failure categories, run/revision,
repository HEAD/dirty state, fixture version, and explicit engineering/live/
quality-review statuses, plus `tokenUsage` totals sourced only from provider-
reported metadata and a count of calls without reported usage. They never
include prompts, provider output, headers, endpoints, or credential material.
The browser E2E report names `npm run test:teaching:integration` as the
deterministic host fallback. It does not execute a provider, mutate the
playground, or claim browser coverage.

The AI Settings dialog shows the same session-local `tokenUsage` counters. A
missing provider usage object is rendered as `Not reported`; counts are never
estimated from prompt or response text and are reset when the in-memory
provider configuration lifecycle resets.

## Future extraction

The disposable `dev/backend/server.py` should be replaced by the private
`VOLK-Cloud` service when that repository exists. The frontend should keep
using `src/services/volkCloud/` rather than adding provider-specific requests
to UI components or the deterministic learning runtime.
