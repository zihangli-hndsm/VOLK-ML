# Agent Application API v1

The Agent Application API is VOLK-ML's narrow application boundary for an
in-page agent host or a future MCP adapter. It is separate from Canvas Agent
API v1: Canvas Agent remains the existing editor capability, while this API
exposes a bounded set of application inspections and proposal operations
without exporting React state or granting direct execution authority.

The browser bridge is:

```js
const app = globalThis.__VOLK_ML_AGENT_APPLICATION__;
const response = await app.request({
  apiVersion: 1,
  requestId: 'host-42',
  method: 'inspectWorkspace',
  params: {},
});
```

It opens no socket and contains no account credential. A host that relays
requests from an external agent is responsible for caller authentication,
origin isolation, user consent, authorization, and audit policy. Do not relay
arbitrary cross-origin `postMessage` payloads into this bridge.

## Envelope and bounds

Every request has exactly `apiVersion`, `requestId`, `method`, and `params`.
Version 1 rejects unknown envelope or method-specific parameter fields and
returns either `{ apiVersion, requestId, ok: true, result }` or
`{ apiVersion, requestId, ok: false, error: { code, details? } }`. Error
responses use stable codes and bounded diagnostics; they do not relay thrown
exception messages.

The API accepts JSON-only data, with a 1.1-million-code-unit request bound,
48-level nesting limit, and 60,000-value traversal bound. Responses are capped
at 1.5 million code units. Generated source is capped at 300,000 code units.
All returned values are detached and frozen. Request IDs are correlation
identifiers, not authorization tokens.

The finite method vocabulary is:

| Method | Result / authority |
| --- | --- |
| `inspectWorkspace` | Semantic graph, row-free dataset schema/count summary, and runtime status. No viewport, selection, React state, or raw dataset values. |
| `listComponents` | Bounded detached summaries of current built-in and project-local component definitions. |
| `listCapabilities` | Current compiler, browser execution, tier, and import capability assessment plus explicit authority limits. |
| `submitGraphProposal` | Validate and revalidate a whole-graph proposal, then stage it in the existing read-only preview. |
| `submitGraphPatchProposal` | Validate and revalidate a patch against the current canonical base, then stage it in the existing patch preview. |
| `inspectProposal` | Current proposal identity, live eligibility, safe diagnostic codes, and at most 12 lifecycle records; never the raw proposal. |
| `inspectResults` | Current browser-local result status, scalar metrics, bounded recent losses, graph/dataset binding, and explicit `understanding: not-assessed`. |
| `exportGraph` | Local PyTorch or TensorFlow source artifact. Returns source only; it does not execute, download, or persist the artifact. |
| `run` | Returns `USER_CONFIRMATION_REQUIRED`. D1 does not provide an agent-triggered run confirmation path. Use the existing Run control for learner-authorized execution. |

## Authority and freshness

World/project state, graph validation, browser execution, result production,
and learner Apply remain owned by the application. Proposal submission can
only open the existing preview path; it never commits the proposal. The
preview's existing explicit learner Apply control performs canonical live
revalidation before commit. Cancel, invalid, stale, unsupported, or off-Build
submission does not change the graph or runtime.

The proposal ledger is in-memory lifecycle metadata only, bounded to 12
records. It is not project history or durable agent memory. `inspectProposal`
revalidates the current proposal each time; a staged preview is not a standing
authorization. Results are reported as current only when the current semantic
graph and dataset match the binding recorded after the normal browser Run
path. Dataset identity in inspection is an opaque, session-scoped equality
token; it is neither a cryptographic digest nor anonymization. Dataset rows,
cells, file contents, and trained-model internals are never returned.

An export artifact describes generated source, not a completed experiment.
Result metrics describe runtime output, not evidence of learner understanding
or mastery. This API has no method to set parameters, edit a graph, load a
project, set a dataset, apply a proposal, or execute a graph directly.

## Compatibility and next transport

Canvas Agent API v1 and its API version are unchanged. The application bridge
does not wrap or expose the Canvas API object; a future MCP adapter should
translate an explicitly allowed subset of these versioned requests and retain
the same caller authentication and learner-confirmation requirements. This PR
adds no MCP server, remote transport, provider integration, or authorization
service.

The focused deterministic contract check is `npm run check:agent-application`.
The headless Chrome integration check is
`npm run test:agent-application:browser`; it starts a local Vite app with the
provider URL unset and uses the existing development-only detached proposal
fixture bridge. The fixture bridge can construct and submit test fixtures but
does not Apply them; the test itself must click the normal preview control to
verify learner authority.
