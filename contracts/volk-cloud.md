# VOLK Cloud boundary contract

This contract belongs to the public VOLK-ML client. The disposable service in
`dev/backend/` exists only for local integration checks; the future private
`VOLK-Cloud` repository owns the production implementation.

## Client boundary

- `src/services/volkCloud/` is the single client abstraction for HTTP Cloud
  capabilities in the open client.
- In development, an absent `VITE_VOLK_API_URL` defaults to
  `http://127.0.0.1:8000`. In production, an absent URL means Cloud is
  `not-configured`, so the client creates no endpoint and makes no health
  request.
- A configured `VITE_VOLK_API_URL` is normalized and used as the API base URL
  in either mode.
- The initial endpoint is `GET /health`.
- A JSON response with `status: "ok"` is `available`; a network failure,
  non-2xx response, or invalid payload is `unavailable`.
- Health checks are advisory and never gate application startup or local
  World → Experiment → Evidence interaction. Production local-only mode does
  not perform a failed localhost probe; it remains explicitly unconfigured.

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
