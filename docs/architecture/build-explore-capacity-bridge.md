# Build→Explore capacity bridge v1

The capacity bridge offers one bounded comparison from Build's current graph
into an isolated, in-memory Explore session. First select exactly one eligible
hidden Dense node in Build; only then does Build → More show **Compare
hidden-layer capacity**. No selection, a non-hidden selection, or an
unsupported graph cannot start a session. The created session pins the exact
selected node ID and its canonical `dense_node` / `dense` registry identity;
it never substitutes another Dense layer. Source reconciliation rechecks that
same node against the current graph. The bridge is local-only and does not use
Cloud, an Agent, project persistence, or the separate imported-attention
experience.

## Supported experiment

The bridge currently accepts only a registered, connected L0 tabular
`Supervised Trainer` graph with one input, one hidden Dense layer, one
registered hidden activation, one output Dense layer, the task's registered
output, one loss and optimizer, and one matching evaluator. The normal
interactive predictor branch may remain attached. Custom components, other
training roots, extra model branches/layers, incomplete data, and graphs above
the browser L0 estimate are rejected with stable reason codes.

When a selected hidden Dense belongs to a recognizable registered one-hidden-
layer model path but the imported architecture has no dataset/training path, the
Build → More menu shows a localized repair prompt instead of a bridge entry.
The prompt names the missing Dataset → Train/Test Split and/or Supervised
Trainer → evaluator connections. It is a projection of the current graph, not a
repair proposal: it does not add components, choose a dataset, open a comparison
session, or execute the model. This behavior applies identically to canonical,
Torch Export, and normalized ONNX graphs; import still uses its own preview and
explicit Apply boundary.

`inspectExploreCapacityBuild(build, { selectedNodeId })` is a strict eligibility
check over current Build state and the explicit selection. A ready
`ExploreBridgeSessionV1` snapshots its supported graph, validated dataset,
task, selected hidden Dense node ID and registry identity, deterministic split
identity, and all non-capacity training semantics. It does not retain raw rows
in its public snapshot. The detached private copy is used only as input to the
existing `executeBrowserGraph()` implementation; results are never written
back to Build or the project.

## Comparison and truth boundary

The learner chooses a valid alternate `Dense.units` value. The bridge derives
the next Dense layer's `input_features` and changes no other setting. It never
clamps an invalid or over-budget choice. An explicit **Run comparison** starts
two new sequential L0 runs: baseline A at the current width and variant B at
the chosen width. Both use the same frozen data, test/train split, runtime seed,
epoch count, batch size, loss, optimizer, and evaluator. Each run and the
comparison receive fresh IDs; metrics are accepted only from the connected
evaluator result for that run. A partial pair is never published.

The result describes observed evaluator metrics and deltas; it is not Evidence,
mastery, or a claim that a wider model is better. Changing width changes
parameter count and initialization tensor shape as well as representational
capacity, so this comparison is not a strict causal isolation of “capacity”.
The learner sees that limitation before running.

## Lifecycle and invalidation

The session is held only in app memory. Reload starts without a bridge result;
closing keeps the current result read-only for the life of the project session.
Starting a new comparison creates a new session. Project replacement disposes
the old session. Semantic graph, dataset, training, or split changes mark a
session stale and preserve its prior result read-only; node movement and other
layout-only changes do not. Cancelled, disposed, or superseded asynchronous
results cannot be committed.

The only model execution authority is the existing browser L0 runtime. There
is no new executor, IR, Project JSON field, generic Playground action, Cloud
request, or Agent authority in this bridge. The fixed BERT-Tiny Attention v25
reference remains a separate G2 experience and is not used as this graph's
model.

## Explore → Build v1 configuration transfer (G3)

After a completed, successful G2 pair, **Use this configuration in Build** may
create a volatile `ExploreToBuildProposalV1` from that session's private source
snapshot and its two actual `executeBrowserGraph()` run records. The proposal
binds the comparison, both run IDs, exact metric provenance and values, project
session, semantic graph, registered hidden-layer identity, dataset, split, and
training settings. Positive, zero, and negative observed metric deltas are all
valid; the exact pair is descriptive, not Evidence and not a general claim
that the wider model is better.

The only transferred changes are the selected `Dense.units` and its derived
downstream `Dense.input_features`. The proposal is converted to the existing
detached `GraphPatchProposalV1`, then uses the existing C2 read-only preview,
freshness checks, explicit learner Apply, and commit. Cancelling or closing
the preview leaves Build unchanged. Preview and Apply both revalidate against
the still-live G2 session and current source; stale, replaced, edited, failed,
or incomplete sources cannot be applied. Duplicate staging resolves to the
same deterministic proposal identity and does not create another run.

Apply changes configuration only. It does not execute Build, write G2 run
records or measurements into the project, or change Evidence. The learner
must explicitly open Build Run and execute separately; the resulting Build
attempt has its own identity and result history. This v1 transfer does not
persist project metadata, add an Undo action, or depend on Cloud. The preview
states that after Apply the learner can manually Run and that Undo is
unavailable.

The contract and focused tamper/replay checks are in
`src/core/exploration/exploreToBuildProposal.js` and
`scripts/check-explore-to-build.mjs`. The mounted G2/G3 browser path is
`scripts/build-explore-capacity-bridge-cdp-browser.mjs`; run it with
`npm run test:explore-to-build:browser`.

## Verification

Run `npm run check:build-explore-capacity-bridge` for contract, lifecycle, and
real-runtime checks, and `npm run test:build-explore-capacity-bridge:browser`
for the mounted browser path, which starts the app without a Cloud URL and
executes both CPU runs from the visible Build → More action.
Run `npm run test:build-explore-capacity-bridge:import-browser` with
`ONNX_PYTHON` pointing to the configured ONNX/NumPy environment to verify real
B2 Torch Export and B3 normalized ONNX preview/explicit-Apply paths, localized
repair prompts, the unavailable Run boundary, and non-mutation after Apply.
