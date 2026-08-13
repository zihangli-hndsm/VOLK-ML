# Exploration Threads

Phase 6 adds a small `ExplorationThread` history to the canonical Playground
session. It records intentional reasoning milestones—questions, predictions,
canonical Experiment references, and deterministic historical observations.

Threads do not copy Experiment runtime state, world history, React state, UI
labels, provider configuration, prompts, or raw model responses. Predictions
carry the current condition fingerprint; observations carry the fingerprints,
semantic comparison, available observable values, notices, and current Repeat
aggregate when its condition identity is still valid. Missing observables are
omitted rather than represented as zero. Observation snapshots never refresh
when the active Experiment changes.

The manual and Agent Explore surfaces use the same semantic thread actions.
Resume switches to the referenced canonical Experiment and restores its A/B
comparison. If a referenced Experiment is unavailable, Resume reports
`EXPLORATION_THREAD_EXPERIMENT_UNAVAILABLE`; it never substitutes another
Experiment. Historical observations remain readable in that case.

The current Experiment Workspace is intentionally session-scoped in VOLK-ML;
it is not part of the canonical project JSON yet. Consequently thread history
is durable for the open Playground session, but a browser reload or closing the
Playground does not promise to restore Experiment references. This is an
explicit boundary, not a localStorage side channel or a duplicate project
format. The resource limits and JSON-safe validation remain enforced at the
semantic boundary.
