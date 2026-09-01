# VOLK Cloud boundary contract

This contract belongs to the public VOLK-ML client. The disposable service in
`dev/backend/` exists only for local integration checks; the future private
`VOLK-Cloud` repository owns the production implementation.

## Client boundary

- `src/services/volkCloud/` is the single client abstraction for HTTP Cloud
  capabilities in the open client.
- The API base URL comes from `VITE_VOLK_API_URL` and defaults to
  `http://127.0.0.1:8000`.
- The initial endpoint is `GET /health`.
- A JSON response with `status: "ok"` is `available`; a network failure,
  non-2xx response, or invalid payload is `unavailable`.
- Health checks are advisory and never gate application startup or local
  World → Experiment → Evidence interaction.

## Health response

```json
{
  "status": "ok",
  "service": "volk-dev-backend",
  "apiVersion": "0"
}
```

## Ownership boundary

The frontend remains authoritative for World truth, Experiment truth, Evidence
truth, local runtime execution, deterministic fallback, and immediate learner
interaction. The future backend may own identity, persistence, long-term
memory, Agent policy, ASR, scalable execution, entitlement, and secrets. It
must not invent or reconstruct experiment Evidence from opaque client state.

The public client does not contain provider credentials, authentication,
payments, persistent learner history, production Agent logic, or model-worker
infrastructure.
