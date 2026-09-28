import assert from 'node:assert/strict';
import { makeBuildExploreCapacityFixture } from './build-explore-capacity-bridge-fixture.mjs';
import { validateAgentDataset } from '../src/core/canvasAgent.js';
import { validateGraphPatchProposal } from '../src/core/graph/graphPatchProposal.js';
import {
  createExploreBridgeSessionV1,
} from '../src/core/exploration/buildCapacityBridge.js';
import {
  EXPLORE_TO_BUILD_PROPOSAL_TYPE,
  validateExploreToBuildProposalV1,
} from '../src/core/exploration/exploreToBuildProposal.js';

const clone = (value) => structuredClone(value);
const build = makeBuildExploreCapacityFixture({ privateRowMarker: true });
const projectSessionId = 'project-g3-fixture';

function makeSession({ sourceBuild = build, sessionProjectId = projectSessionId, metricsByWidth = { 2: 0.4, 4: 0.7 }, runBrowserGraph } = {}) {
  return createExploreBridgeSessionV1({
    build: sourceBuild,
    selectedNodeId: 'build-hidden',
    projectSessionId: sessionProjectId,
    runBrowserGraph: runBrowserGraph ?? (async ({ nodes }) => {
      const width = nodes.find((node) => node.id === 'build-hidden').data.parameters.units;
      return { type: 'browser_mlp', metrics: { accuracy: metricsByWidth[width], macroF1: metricsByWidth[width] } };
    }),
  });
}

function currentBuildCopy(source = build) {
  return clone(source);
}

async function complete(session) {
  await session.runComparison();
  assert.equal(session.getSnapshot().lifecycle, 'completed');
  return session;
}

async function proposalFor(session, current = build, currentSessionId = projectSessionId) {
  return session.createExploreToBuildProposalV1({
    currentBuild: current,
    currentProjectSessionId: currentSessionId,
  });
}

const validSession = await complete(makeSession());
const validResult = await proposalFor(validSession);
assert.equal(validResult.ok, true, JSON.stringify(validResult));
const valid = validResult.proposal;
assert.equal(valid.type, EXPLORE_TO_BUILD_PROPOSAL_TYPE);
assert.equal(valid.version, 1);
assert.deepEqual(valid.source.runIds, valid.runs.map((run) => run.runId));
assert.deepEqual(valid.source.runIds, valid.graphPatchProposal.source.provenance.references.slice(2));
assert.deepEqual(valid.measurements.metrics, [
  { metric: 'accuracy', baseline: 0.4, variant: 0.7, delta: 0.29999999999999993 },
  { metric: 'macroF1', baseline: 0.4, variant: 0.7, delta: 0.29999999999999993 },
]);
assert.equal(valid.change.parameter, 'Dense.units');
assert.equal(valid.change.nodeId, 'build-hidden');
assert.equal(valid.derivedChanges[0].parameter, 'Dense.input_features');
assert.equal(valid.derivedChanges[0].nodeId, 'build-head');
assert.equal(valid.derivedChanges[0].from, 2);
assert.equal(valid.derivedChanges[0].to, 4);
assert.equal(Object.hasOwn(valid, 'evidence'), false);
assert.equal(JSON.stringify(valid).includes('bridge-private-row-sentinel'), false, 'The proposal must not carry source rows.');
assert.equal(JSON.stringify(valid).includes('bert-tiny'), false, 'The capacity handoff cannot borrow imported-Attention provenance.');
assert.equal(validateExploreToBuildProposalV1(valid).valid, true);
assert.equal(validateGraphPatchProposal(valid.graphPatchProposal).valid, true);
assert.deepEqual(valid.graphPatchProposal.operations.map((operation) => [operation.op, operation.nodeId]), [
  ['UPDATE_PARAMETERS', 'build-hidden'],
  ['UPDATE_PARAMETERS', 'build-head'],
]);
const replay = validateGraphPatchProposal(valid.graphPatchProposal).resultGraph;
assert.equal(replay.nodes.find((node) => node.id === 'build-hidden').data.parameters.units, 4);
assert.equal(replay.nodes.find((node) => node.id === 'build-head').data.parameters.input_features, 4);
assert.equal(JSON.stringify(replay.nodes.filter((node) => !['build-hidden', 'build-head'].includes(node.id))),
  JSON.stringify(valid.graphPatchProposal.baseGraph.nodes.filter((node) => !['build-hidden', 'build-head'].includes(node.id))));

const liveRevalidation = validSession.validateExploreToBuildProposalV1(valid, {
  currentBuild: build,
  currentProjectSessionId: projectSessionId,
});
assert.equal(liveRevalidation.valid, true);

for (const [label, pair, expectedDelta] of [
  ['positive', { 2: 0.2, 4: 0.8 }, 0.6000000000000001],
  ['zero', { 2: 0.5, 4: 0.5 }, 0],
  ['negative', { 2: 0.9, 4: 0.1 }, -0.8],
]) {
  const session = await complete(makeSession({ metricsByWidth: pair }));
  const result = await proposalFor(session);
  assert.equal(result.ok, true, `${label} result deltas must not decide proposal eligibility.`);
  assert.equal(result.proposal.measurements.metrics[0].delta, expectedDelta);
  assert.equal(result.proposal.source.comparisonId, session.getSnapshot().comparison.comparisonId);
}

const failed = makeSession({ runBrowserGraph: async () => { throw new Error('fixture-run-failed'); } });
await assert.rejects(failed.runComparison());
assert.equal((await proposalFor(failed)).ok, false, 'A failed/incomplete pair cannot be transferred.');
const unrun = makeSession();
assert.equal((await proposalFor(unrun)).ok, false, 'A ready session with no paired runs cannot be transferred.');

function tamper(candidate, mutate) {
  const changed = clone(candidate);
  mutate(changed);
  const strict = validateExploreToBuildProposalV1(changed);
  assert.equal(strict.valid, false, 'Tampered proposal must fail its closed contract.');
  assert.equal(validSession.validateExploreToBuildProposalV1(changed, {
    currentBuild: build,
    currentProjectSessionId: projectSessionId,
  }).valid, false, 'Tampered proposal must fail live session revalidation.');
}

tamper(valid, (value) => { value.measurements.metrics[0].variant += 0.1; });
tamper(valid, (value) => { value.runs[0].configuration.epochs += 1; });
tamper(valid, (value) => { value.runs[0].configuration = null; });
tamper(valid, (value) => { value.runs[0] = null; });
tamper(valid, (value) => { value.runs[0].metrics = null; });
tamper(valid, (value) => { value.runs[0].status = 'failed'; });
tamper(valid, (value) => { value.runs[0].provenance.source = 'imported-attention'; });
tamper(valid, (value) => { value.runs[1].metrics.accuracy = Infinity; });
tamper(valid, (value) => { value.change.nodeId = 'build-head'; });
tamper(valid, (value) => { value.change.to = 8; });
tamper(valid, (value) => { value.derivedChanges[0].to = 8; });
tamper(valid, (value) => { value.derivedChanges[0].parameter = 'Dense.learning_rate'; });
tamper(valid, (value) => { value.graphPatchProposal.operations.push(clone(value.graphPatchProposal.operations[0])); });
tamper(valid, (value) => { value.graphPatchProposal.operations[1].parameters.input_features = 99; });
tamper(valid, (value) => { value.evidenceId = 'fake-evidence'; });
tamper(valid, (value) => { value.source.runIds[1] = value.source.runIds[0]; });

for (const [label, mutate] of [
  ['session', (value) => { value.source.sessionId = 'other-session'; }],
  ['comparison', (value) => { value.source.comparisonId = 'other-comparison'; }],
  ['project session', (value) => { value.source.projectSessionId = 'other-project-session'; }],
  ['graph', (value) => { value.source.graphSemanticFingerprint = 'other-graph-fingerprint'; }],
  ['registry', (value) => { value.source.registryIdentity.manifestFingerprint = 'other-registry'; }],
  ['dataset identity', (value) => { value.source.dataset.fingerprint = 'other-dataset'; }],
  ['feature identity', (value) => { value.source.dataset.features[0] = 'other-feature'; }],
  ['target identity', (value) => { value.source.dataset.target = 'other-target'; }],
  ['task identity', (value) => { value.source.dataset.task = 'regression'; }],
  ['split identity', (value) => { value.source.split.identity = 'other-split'; }],
  ['split seed', (value) => { value.source.split.seed += 1; }],
  ['split condition', (value) => { value.source.split.trainRatio += 0.01; }],
  ['training identity', (value) => { value.source.training.identity = 'other-training'; }],
  ['training seed', (value) => { value.source.training.seed += 1; }],
  ['training config', (value) => { value.source.training.epochs += 1; }],
  ['run role', (value) => { value.runs[1].role = 'baseline'; }],
  ['run ID', (value) => { value.runs[1].runId = 'other-run'; }],
  ['run width', (value) => { value.runs[1].configuration.width += 1; }],
]) {
  tamper(valid, (value) => mutate(value));
  assert.ok(label.length > 0);
}

for (const [label, alterBuild, projectId] of [
  ['project switch', build, 'other-project'],
  ['semantic graph change', (() => { const next = currentBuildCopy(); next.nodes.find((node) => node.id === 'build-hidden').data.parameters.use_bias = false; return next; })(), projectSessionId],
  ['dataset change', (() => { const next = currentBuildCopy(); const feature = next.dataset.featureColumns[0]; next.dataset = validateAgentDataset({ ...next.dataset, rows: next.dataset.rows.map((row, index) => index ? row : { ...row, [feature]: row[feature] + 1 }) }); return next; })(), projectSessionId],
  ['training change', (() => { const next = currentBuildCopy(); next.nodes.find((node) => node.data.manifest.op === 'supervised_trainer').data.parameters.epochs += 1; return next; })(), projectSessionId],
  ['registry change', (() => { const next = currentBuildCopy(); next.nodes.find((node) => node.id === 'build-hidden').data.manifest.properties.find((property) => property.key === 'units').max = 999999; return next; })(), projectSessionId],
]) {
  const session = await complete(makeSession());
  const proposal = (await proposalFor(session)).proposal;
  const result = session.validateExploreToBuildProposalV1(proposal, {
    currentBuild: alterBuild,
    currentProjectSessionId: projectId,
  });
  assert.equal(result.valid, false, `${label} must stale the G3 handoff.`);
  assert.equal(session.getSnapshot().lifecycle, 'completed', `${label} validation must be read-only while checking current C2 eligibility.`);
  session.reconcileSource(alterBuild, projectId);
  assert.notEqual(session.getSnapshot().lifecycle, 'completed', `${label} marks its G2 source stale.`);
}

const malformedDataset = currentBuildCopy();
malformedDataset.dataset = null;
const unsupported = createExploreBridgeSessionV1({ build: malformedDataset, selectedNodeId: 'build-hidden', projectSessionId });
assert.equal(unsupported.getSnapshot().lifecycle, 'failed');
assert.equal((await proposalFor(unsupported)).ok, false);

console.log('Explore→Build G3 proposal checks passed (real paired-run source, outcome independence, strict identity binding, source staleness, tamper rejection, and deterministic C1 replay).');
