# Agent MCP transport D2

D2 provides a local MCP transport for the accepted Agent Application API v1.
It is a transport adapter, not a second workspace runtime:

```text
official MCP client
        │ stdio JSON-RPC
        ▼
scripts/volk-mcp-server.mjs
        │ 127.0.0.1 loopback session
        ▼
dev-gated browser bridge
        │ __VOLK_ML_AGENT_APPLICATION__
        ▼
canonical mounted VOLK workspace
```

## Protocol boundary

The server uses the official `@modelcontextprotocol/server` v2 package and
stdio transport. The test client uses the matching official client package.
The server accepts the SDK's legacy 2025 MCP opening for compatibility with
the current client and exposes a versioned VOLK transport envelope inside each
tool call:

```json
{
  "apiVersion": 1,
  "requestId": "mcp-…",
  "method": "inspectWorkspace",
  "params": {}
}
```

The browser returns the existing D1 response unchanged. MCP tool results carry
that bounded envelope in `structuredContent` and as JSON text; `ok: false`
results are marked `isError: true` without leaking thrown messages.

Tool names are stable and intentionally explicit:

| MCP tool | D1 method | Authority |
| --- | --- | --- |
| `volk_inspect_workspace` | `inspectWorkspace` | row-free semantic inspection |
| `volk_list_components` | `listComponents` | bounded capability catalog |
| `volk_list_capabilities` | `listCapabilities` | compiler/runtime/authority status |
| `volk_submit_graph_proposal` | `submitGraphProposal` | preview-only whole graph |
| `volk_submit_graph_patch_proposal` | `submitGraphPatchProposal` | preview-only patch |
| `volk_inspect_proposal` | `inspectProposal` | live freshness and lifecycle |
| `volk_inspect_results` | `inspectResults` | current browser-local result |
| `volk_export_graph` | `exportGraph` | source-only local compiler |
| `volk_request_run` | `run` | confirmation-required response |

There is deliberately no Apply, set-parameter, load-project, set-dataset, or
direct-execution tool. Proposal submission can only open the existing B1/C2
preview; current canonical revalidation and the learner's Apply click remain
the sole commit path. Run requests retain D1's
`USER_CONFIRMATION_REQUIRED` gate.

## Browser session and authority

The server listens on `127.0.0.1` only. A developer supplies
`VOLK_MCP_SESSION_TOKEN` (at least 32 URL-safe characters) and a fixed local
port. The browser receives the endpoint and token through a development URL;
the token is not bundled, persisted, or printed by the server. The browser
bridge sends a one-time local nonce and Origin during `connect`. The server
requires the same token, a local HTTP Origin, the bound session ID, and the
bound Origin on every poll, response, heartbeat, and disconnect. Only one
browser session is accepted at a time; idle sessions expire after 20 seconds.

This is an intentional local developer boundary. A process that possesses the
token and runs on the same machine can act as the developer's MCP client; no
remote or cross-origin caller is admitted. The token should therefore be
fresh per session and kept out of shell history where practical. The server
does not expose browser handles, React state, mutating callbacks, raw rows,
dataset cells, credentials, or free-form graph text/code.

## Bounds and failure behavior

Requests and responses retain D1's JSON bounds. The transport additionally
limits each HTTP body to 1.3 MB, MCP requests to 1.1 million JSON code units,
responses to 1.6 million code units, concurrent browser requests to two, and
each browser request to a 10-second deadline. Polls are bounded to five
seconds and heartbeats keep the session alive only while the browser is
actually polling.

Queued calls are bound to their MCP request lifetime. A caller cancellation
withdraws the matching bridge request, request deadlines remove it from both
the queue and active set, and the browser must claim a still-live dispatch
before invoking the mounted Agent Application API. Responses arriving after
cancellation or expiry are rejected. Polling again cannot surface a withdrawn
proposal.

Malformed, unsupported, oversized, stale, disconnected, or timed-out calls
return stable bounded error codes such as `MCP_JSON_BOUND`,
`MCP_WORKSPACE_DEADLINE`, and `MCP_WORKSPACE_DISCONNECTED`. They never mutate
the workspace and do not make the local application unusable. A browser
disconnect rejects pending calls; a paused or unresponsive browser produces a
deadline error.

## Verification

`npm run check:mcp-transport` covers the shared endpoint, token, request, and
JSON-bound contract. `npm run test:mcp:browser` is the required mounted proof:
an official MCP client initializes and lists tools against the real stdio
server, calls the real browser-mounted D1 API, checks whole-graph preview and
cancel, patch preview and Apply, stale-base rejection, result freshness,
PyTorch export, malformed/oversized containment, Run confirmation, semantic
invalidation, cancelled/expired proposal withdrawal after polling resumes, and
disconnect/deadline behavior. No fixture-only MCP server or duplicate
workspace is used.
