# Post-UI7 Playtest Stabilization

This stabilization pass keeps the UI-0 through UI-7 runtime and conceptual
depth contracts intact. It addresses hands-on issues found after UI-7:

- quiet Agent questions now distinguish bounded explanation from experiment
  proposals; conceptual MLP capacity questions do not dispatch mutations;
- the AI TeachingGoal prompt describes the exact top-level typed goal shapes
  consumed by `planTeachingGoal`, including the current objective and control
  registries, with one sanitized repair pass;
- the primary MLP phenomenon remains the data/decision plot while network,
  matrix, loss, and parameter support visuals are separated from that plot in
  presentation mode;
- Build More uses a compact fixed, internally scrollable surface and a bounded
  desktop popover so its outer rectangle remains inside the viewport;
- Explore exposes the existing shared `AiSettingsDialog` beside the quiet
  Agent entry and inside the Agent surface. Local guidance remains available
  without a provider.

AI interpretation remains bounded and non-authoritative. It can classify an
explanation or typed TeachingGoal, but deterministic runtime planning and
execution continue to own controls, operations, evidence, and model results.
