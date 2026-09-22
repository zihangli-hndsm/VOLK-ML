# Unified AI Provider Settings

VOLK-ML exposes one application-level AI provider configuration for the project explanation dialog and the Playground Agent. The configuration is volatile React state owned by the application shell. It is deliberately outside `workspaceStateRef`, `projectFromWorkspace`, project JSON, exports, URLs, browser storage, logs, and analytics.

## Boundary

```text
volatile application settings
        ↓
versioned Agent task contract (ask | experiment-design | world-edit)
        ↓
protocol adapter registry
        ↓
provider gateway: complete({ system, messages, responseMode })
        ├─ Explanation: text response
        └─ Playground Agent: typed TeachingGoal response
```

The gateway normalizes every supported protocol to `{ text, provider, protocol, model }`. Feature layers may attach the shared `AgentRequestContractV1`; the gateway serializes its bounded semantic task mode, output set, request identity, and projected context into the provider instruction/messages. It never forwards DOM state, screenshots, telemetry, executable operations, credentials, or opaque application state. Protocol-specific headers, request bodies, and response extraction live only in `src/core/ai/providerRegistry.js`.

Supported protocol contracts are OpenAI-compatible, Anthropic-compatible, and Gemini-compatible. A custom endpoint may be supplied for any protocol. Remote endpoints are expected to use HTTPS; HTTP is surfaced as a warning and is intended only for trusted local development endpoints.

Changing protocol clears the previous API key. Clearing the key or configuration is immediate. Refreshing or closing the page clears all settings because no persistence mechanism is used.

Explanation keeps its deterministic graph analysis and local fallback. The three Explore entry points use explicit task modes: Ask (`answer-with-optional-suggestion`), Experiment Design (`exploration-guidance`), and World Edit (`world-recipe-or-patch`). The existing deterministic planners remain the only execution authority; provider output is a proposal until the learner accepts it.

`src/core/ai/agentRequestContract.js` owns the reusable contract, semantic projection, safe failure categories, and logical request lifecycle. A logical request has one initial provider call and at most one validation repair. Network, authentication, rate-limit, timeout, and cancellation failures never trigger repair. Successful transport with malformed or semantically invalid JSON is reported as parse/answer validation rather than network/CORS. Optional Ask suggestions are layered on a valid answer body; an invalid suggestion is marked unavailable and cannot execute a runtime operation.

Provider capabilities are data-driven. Native schema-capable protocols use a schema only when their registered capability says `schema`; JSON-only, prompt-JSON, JSON-MIME, and fallback capabilities use their protocol's supported representation. No vendor name is used to select a request shape. Request identity and UI lifecycle guards reject stale completions after retry, context/mode changes, stop/reset, unmount, or timeout.

## Deterministic browser acceptance

The production `ExploreAgentSurface` and `AskVolkPanel` can be exercised against a local HTTP transport fixture:

```text
npm run test:agent-request:browser
```

The command starts Vite, a CORS-enabled fixture at `127.0.0.1:4179`, and headless Chrome. It records bounded request metadata and writes `docs/acceptance/assets/agent-request-contract/browser-evidence.json`. The flow covers typed Ask output, a learner-confirmed Experiment proposal, an explicit World proposal application, malformed output fallback, pending-task consumption across rerender, explicit retry identity, and stale mode-switch suppression. The fixture never bypasses the provider gateway or injects post-validation runtime state.
