# LUMI visible guidance lifecycle

The visible companion is presentation-only. `lumiPresentationRuntime.js`
tracks bounded request identities for Ask VOLK and the teaching dialogue, and
short-lived feedback events for one-time illumination. It never dispatches a
World, Data, Experiment, Evidence, or learner-progress action. Stale
completion, cancellation, page-hide, unmount, and reset paths clear only this
presentation state.

`lumiTargetRegistry.js` is the explicit target boundary. Course controls own
refs and register one current, enabled control for an allowlisted semantic
target. Resolution uses the registered ref and its geometry; it does not query
selectors or infer targets from copy. Offscreen controls may return a
learner-triggered reveal request, but no reveal or experiment is executed by
LUMI.

`lumiEpisodeGuidance.js` maps the existing Episode 1 policy and legal runtime
stage to a presentation target (`model.fit`, `world.sample`,
`experiment.compare`, `evidence.current`, or `ideas.map`). The result is
always `proposalOnly`; the existing orchestration policy and guidance budget
remain authoritative. THINK wins over feedback illumination, which wins over
GUIDE, and an otherwise idle companion stays quiet.

The companion exposes the resulting state through additive data attributes and
uses a static outline as the reduced-motion equivalent of the normal glow or
motion. Persistent Evidence and one-time feedback remain separate, so opening
or rerendering Explore cannot replay a completed illumination.
