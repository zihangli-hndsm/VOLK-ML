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

## Verification

Run `npm run check:build-explore-capacity-bridge` for contract, lifecycle, and
real-runtime checks, and `npm run test:build-explore-capacity-bridge:browser`
for the mounted browser path, which starts the app without a Cloud URL and
executes both CPU runs from the visible Build → More action.
