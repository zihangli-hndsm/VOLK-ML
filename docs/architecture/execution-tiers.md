# Execution tiers

`src/core/runtimeTiers.js` estimates workload and recommends where a graph should run. A tier recommendation is guidance; it is not evidence that VOLK-ML implements that runtime.

## Tier contract

| Tier | Target | Available in the app | Intended workload |
| --- | --- | --- | --- |
| L0 | Browser CPU | Yes | Small interactive models with immediate feedback |
| L1 | Browser WebGPU | No | Medium neural networks in a supported GPU browser |
| L2 | Local Python | No | Larger PyTorch/TensorFlow models on the user's machine |
| L3 | Remote GPU | No | Large models or datasets requiring a managed accelerator |

Only L0 currently executes inside VOLK-ML. L1–L3 expose design/export guidance.

## Estimator inputs

`estimateExecutionPlan(nodes, dataset, capabilities)` combines:

- per-component parameter estimates;
- approximate operations per step;
- training-state memory;
- activation memory;
- dataset size;
- each manifest's minimum tier;
- browser backend completeness;
- WebGPU detection.

The result includes:

```js
{
  recommendedTier,
  parameters,
  peakMemoryMB,
  operationsPerStep,
  estimatedSeconds,
  canRunHere,
  browserBackendComplete,
  webgpuDetected,
  reasons
}
```

Estimates are guardrails, not benchmarks. They are deliberately conservative and should not be presented as exact performance predictions.

## Current assumptions

- Inference parameters use approximately 4 bytes each.
- Training parameters/state use approximately 16 bytes each.
- Adam/AdamW training uses approximately 24 bytes per parameter.
- Activation memory is at least 8 MiB and otherwise estimated from operation count.
- Dataset storage is estimated at 32 bytes per cell.
- Peak memory adds a 35% safety margin.
- Convolution estimates assume a representative `64 × 64` spatial area.
- Sequence and attention estimates assume a representative length of `128`.

When real shape inference is added, replace representative assumptions with inferred tensor shapes and document the IR dependency.

## Escalation thresholds

The estimator first honors the maximum `runtime.minimumTier` required by any selected node, then raises the tier using these thresholds:

| Recommended minimum | Any condition |
| --- | --- |
| L1 | parameters > 100,000; peak memory > 128 MiB; operations > 10,000,000 |
| L2 | parameters > 5,000,000; peak memory > 384 MiB; operations > 2,000,000,000 |
| L3 | parameters > 50,000,000; peak memory > 1,024 MiB; operations > 20,000,000,000 |

A dataset larger than 100 MiB also raises the recommendation to at least L2. A dataset warning reason appears above 30 MiB.

Threshold comparisons are strict `>` comparisons. Add boundary tests before changing them.

## Browser execution decision

`canRunHere` is true only when:

```text
recommendedTier === L0
and every selected component has a browser backend
```

WebGPU detection does not make L1 runnable today because the WebGPU executor is not implemented. It only affects explanatory guidance.

In `src/main.jsx`, tier estimation is based on nodes participating in at least one edge. This prevents an unconnected experimental component from blocking an otherwise valid L0 pipeline.

The browser executor separately validates:

- at least one connection exists;
- endpoints and port handles exist;
- port types match;
- every required active input has exactly one connection;
- the active graph is acyclic;
- a supported data source and browser backend exist.

Do not weaken browser validation because the tier estimator recommends L0; they answer different questions.

## Assigning a component tier

Use the lowest tier that can plausibly execute the component while preserving intended interactivity:

- Set L0 only after implementing and testing its browser CPU backend.
- Set L1 for browser-oriented neural operations without a CPU backend, while WebGPU remains planned.
- Set L2 when a Python runtime or unsupported browser dependency is required.
- Set L3 when the operation inherently expects remote accelerator-scale resources.

The estimator may still escalate above a component's declared minimum based on graph size.

## Changing tier behavior

1. Update component parameter/operation formulas if needed.
2. Preserve monotonic escalation: adding work must not lower the tier.
3. Add tests immediately below, at, and above changed boundaries.
4. Verify unconnected nodes do not affect the runner recommendation.
5. Update localized reasons in `src/locales/ui.js` when user guidance changes.
6. Keep `executionTiers[].available` false until an end-to-end runtime exists.
7. Run the validation baseline in `overview.md`.
