# Unified AI Provider Settings

VOLK-ML exposes one application-level AI provider configuration for the project explanation dialog and the Playground Agent. The configuration is volatile React state owned by the application shell. It is deliberately outside `workspaceStateRef`, `projectFromWorkspace`, project JSON, exports, URLs, browser storage, logs, and analytics.

## Boundary

```text
volatile application settings
        ↓
protocol adapter registry
        ↓
provider gateway: complete({ system, messages, responseMode })
        ├─ Explanation: text response
        └─ Playground Agent: typed TeachingGoal response
```

The gateway normalizes every supported protocol to `{ text, provider, protocol, model }`. Protocol-specific headers, request bodies, and response extraction live only in `src/core/ai/providerRegistry.js`. Feature layers do not branch on providers and do not send credentials themselves.

Supported protocol contracts are OpenAI-compatible, Anthropic-compatible, and Gemini-compatible. A custom endpoint may be supplied for any protocol. Remote endpoints are expected to use HTTPS; HTTP is surfaced as a warning and is intended only for trusted local development endpoints.

Changing protocol clears the previous API key. Clearing the key or configuration is immediate. Refreshing or closing the page clears all settings because no persistence mechanism is used.

Explanation keeps its deterministic graph analysis and local fallback. Playground Agent sends only a bounded context to the gateway and continues through the existing deterministic `TeachingGoal` planner, composer, validator, and runtime pipeline.
