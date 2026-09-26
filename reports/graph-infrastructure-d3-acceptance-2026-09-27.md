# Graph Infrastructure D3 — Acceptance and Delivery

Date: 2026-09-27
Repository: VOLK-ML
Branch: `codex/agent-application-d3`
Accepted frozen source revision: `3d029342a476dfee09123efec5bd9612a10daa9d`

## Outcome

The D3 repair is ready for VOLK-Dev verification. The failure was caused by the real Codex workflow starting its initial MCP reads concurrently while the existing transport allows only two pending requests. The third read was correctly rejected with `MCP_WORKSPACE_BUSY`. The D3 reference now explicitly requires each initial read to finish before starting the next; bounded error diagnostics retain only allowlisted codes/classes, never raw tool text.

The regression uses the actual local MCP stdio server and browser bridge without a model: a three-way parallel negative case gets the expected safe busy rejection, and three serial calls complete. The accepted runtime remains capped at two pending requests.

## Acceptance evidence

- Focused D3 validation (`npm run check:agent-application:d3`): exit 0; static contract, Python attestation, and no-model concurrency regression passed.
- Independent full repository check (Dev acceptance session 53622): exit 0 with real PyTorch and ONNX integrations configured.
- Independent production build: exit 0 using isolated output.
- Independent focused attestation and concurrency regressions: exit 0.
- Real Codex acceptance run: exit 0 with 39 semantic events; initial MCP reads completed sequentially; whole proposal and the units 32→128 patch were both explicitly applied.
- D1, D2, B1 Graph Apply, and C2 Graph Patch browser regression chain: exit 0.
- Scoped diff check: exit 0.
- All five screenshots from the selected final run were individually reviewed. The accompanying run artifact is `docs/acceptance/assets/agent-application-d3/2026-09-26T16-24-23-106Z.json`.

Local validation receipts and logs are included under `docs/acceptance/assets/agent-application-d3/`. The local full-check receipt records optional PyTorch and ONNX/NumPy integrations as skipped; Dev's independent session 53622 supplied the configured full-check acceptance result.

## Scope and limitations

- No paid/live Agent workflow was rerun during the repair implementation; the final real Codex run was performed as the independent acceptance run.
- The 32→128 proposal was applied and inspected; the modified model was not executed, so no runnability claim is made for that width.
- Post-Apply canvas screenshots retain the earlier viewport, leaving some graph nodes off-screen although the preview and snapshot identity are complete. This is recorded as a P2 fit-view experience follow-up and was not expanded into this repair.
- The isolated build reported the existing large-chunk warning.
- Generated `dist` changes, caches, unrelated historical B1 evidence, and old failure artifacts are excluded from delivery.

The exact 18-file frozen source manifest, including SHA-256 values, is `reports/d3-frozen-source-2026-09-27.json`.
