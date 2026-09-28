import assert from 'node:assert/strict';
import { BROWSER_MLP_SEED, executeBrowserGraph } from '../src/core/browserRuntime.js';
import { DEFAULT_KNN_SEED } from '../src/core/knnMath.js';
import { makeBuildExploreCapacityFixture } from './build-explore-capacity-bridge-fixture.mjs';
import { validateAgentDataset } from '../src/core/canvasAgent.js';
import {
  createExploreBridgeSessionV1,
  inspectExploreCapacityBuild,
} from '../src/core/exploration/buildCapacityBridge.js';

const check = (condition, message) => assert.ok(condition, message);

const build = makeBuildExploreCapacityFixture({ privateRowMarker: true });
const buildBefore = JSON.stringify(build);
const actualRunTestRows = [];
const assessment = inspectExploreCapacityBuild(build);
check(assessment.supported, `Canonical Build MLP should be eligible, received ${assessment.reasonCode}.`);
assert.equal(assessment.recommendedTier, 'L0');
assert.equal(assessment.baselineWidth, 2);
assert.equal(assessment.seed, 2026);
assert.equal(BROWSER_MLP_SEED, DEFAULT_KNN_SEED, 'MLP initialization, shuffle, and data split use the same declared deterministic seed.');
check(!JSON.stringify(assessment).includes('bridge-private-'), 'Public eligibility projection must not expose raw dataset values.');

const actualRunInputs = [];
const initial = createExploreBridgeSessionV1({
  build,
  projectSessionId: 'project-1',
  runBrowserGraph: async (input) => {
    actualRunInputs.push({ nodes: structuredClone(input.nodes), edges: structuredClone(input.edges), dataset: structuredClone(input.dataset) });
    const model = await executeBrowserGraph(input);
    actualRunTestRows.push(model.test.map((sample) => sample.index));
    return model;
  },
});
assert.equal(initial.getSnapshot().type, 'ExploreBridgeSessionV1');
assert.equal(initial.getSnapshot().lifecycle, 'ready');
assert.equal(initial.getSnapshot().capacity.variantWidth, 4);
check(!JSON.stringify(initial.getSnapshot()).includes('bridge-private-'), 'Session snapshots must not retain raw examples.');
check(!Object.hasOwn(initial.getSnapshot().split, 'trainRowIds') && !Object.hasOwn(initial.getSnapshot().split, 'testRowIds'), 'Session snapshots retain only split counts and a stable identity.');
assert.equal(initial.setVariantWidth(2), 'VARIANT_WIDTH_MUST_DIFFER');
assert.equal(initial.setVariantWidth(0), 'VARIANT_WIDTH_OUT_OF_RANGE');
assert.equal(initial.setVariantWidth(4), null);

const unsupportedBuild = { ...build, customComponents: [{ id: 'custom-layer' }] };
assert.equal(inspectExploreCapacityBuild(unsupportedBuild).reasonCode, 'CUSTOM_COMPONENTS_UNSUPPORTED');
assert.equal(inspectExploreCapacityBuild({ ...build, dataset: null }).reasonCode, 'DATASET_MISSING');
const extraRoot = structuredClone(build);
extraRoot.nodes.push({
  ...structuredClone(extraRoot.nodes.find((node) => node.data.manifest.op === 'supervised_trainer')),
  id: 'second-trainer',
});
assert.equal(inspectExploreCapacityBuild(extraRoot).reasonCode, 'MULTIPLE_TRAINING_ROOTS');
const multipleHidden = structuredClone(build);
const extraHidden = structuredClone(multipleHidden.nodes.find((node) => node.id === 'build-head'));
extraHidden.id = 'build-extra-hidden';
extraHidden.data.parameters.input_features = 2;
multipleHidden.nodes.push(extraHidden);
const reluToHead = multipleHidden.edges.find((edge) => edge.source === 'build-relu' && edge.target === 'build-head');
multipleHidden.edges = multipleHidden.edges.filter((edge) => edge !== reluToHead);
multipleHidden.edges.push(
  { ...reluToHead, id: 'extra-hidden-in', target: 'build-extra-hidden' },
  { ...reluToHead, id: 'extra-hidden-out', source: 'build-extra-hidden' },
);
assert.equal(inspectExploreCapacityBuild(multipleHidden).reasonCode, 'UNSUPPORTED_MODEL_PATH');
const extraTopology = structuredClone(build);
extraTopology.nodes.push({
  ...structuredClone(extraTopology.nodes.find((node) => node.data.manifest.op === 'dense')),
  id: 'unconnected-dense',
});
assert.equal(inspectExploreCapacityBuild(extraTopology).reasonCode, 'UNSUPPORTED_GRAPH_BRANCH');
const alteredPort = structuredClone(build);
alteredPort.edges.find((edge) => edge.source === 'build-input').sourceHandle = 'invented-output';
assert.equal(inspectExploreCapacityBuild(alteredPort).reasonCode, 'L0_GRAPH_UNSUPPORTED');
const alteredManifest = structuredClone(build);
alteredManifest.nodes.find((node) => node.id === 'build-hidden').data.manifest.properties
  .find((property) => property.key === 'units').max = 999999;
assert.equal(inspectExploreCapacityBuild(alteredManifest).reasonCode, 'CUSTOM_COMPONENTS_UNSUPPORTED');
const largeDataset = validateAgentDataset({
  ...build.dataset,
  rows: Array.from({ length: 1020 }, (_, index) => ({ ...build.dataset.rows[index % build.dataset.rows.length] })),
});
const budgetBuild = { ...build, dataset: largeDataset };
check(inspectExploreCapacityBuild(budgetBuild).supported, 'The baseline should remain within the L0 budget for the variant budget check.');
const budgetSession = createExploreBridgeSessionV1({ build: budgetBuild });
assert.equal(budgetSession.setVariantWidth(4096), 'VARIANT_EXCEEDS_L0_BUDGET');

const result = await initial.runComparison();
assert.equal(result.lifecycle, 'completed');
assert.equal(result.runs.length, 2);
assert.notEqual(result.runs[0].runId, result.runs[1].runId);
assert.equal(result.runs[0].role, 'baseline');
assert.equal(result.runs[1].role, 'variant');
assert.deepEqual(result.runs.map((run) => run.width), [2, 4]);
assert.notEqual(result.runs[0].graphFingerprint, result.runs[1].graphFingerprint);
assert.equal(actualRunInputs.length, 2);
assert.deepEqual(actualRunInputs.map((input) => input.dataset), [build.dataset, build.dataset]);
assert.deepEqual(actualRunInputs[0].edges, actualRunInputs[1].edges);
assert.deepEqual(actualRunTestRows[0], actualRunTestRows[1], 'Both real L0 runs must evaluate the same held-out sample identities.');
assert.equal(actualRunTestRows[0].length, result.split.testRows);
const baselineNodeById = new Map(actualRunInputs[0].nodes.map((node) => [node.id, node]));
const variantParameterChanges = actualRunInputs[1].nodes.flatMap((node) => {
  const baselineNode = baselineNodeById.get(node.id);
  return JSON.stringify(baselineNode.data.parameters) === JSON.stringify(node.data.parameters)
    ? []
    : [{ id: node.id, before: baselineNode.data.parameters, after: node.data.parameters }];
});
assert.deepEqual(variantParameterChanges.map(({ id }) => id).sort(), ['build-head', 'build-hidden']);
assert.equal(variantParameterChanges.find(({ id }) => id === 'build-hidden').after.units, 4);
assert.equal(variantParameterChanges.find(({ id }) => id === 'build-head').after.input_features, 4);
assert.deepEqual(result.comparison.runIds, result.runs.map((run) => run.runId));
assert.equal(result.comparison.datasetFingerprint, assessment.datasetFingerprint);
assert.equal(result.comparison.splitIdentity, result.split.identity);
assert.equal(result.comparison.trainingIdentity, result.training.identity);
assert.deepEqual(result.runs.map((run) => run.metricProvenance.source), ['executeBrowserGraph', 'executeBrowserGraph']);
assert.deepEqual(result.comparison.metricProvenance.map((entry) => entry.runId), result.comparison.runIds);
assert.equal(result.comparison.interpretation, 'descriptive-capacity-comparison');
assert.equal(JSON.stringify(build), buildBefore, 'Comparison must not mutate the source Build project.');

const regressionBuild = makeBuildExploreCapacityFixture({ task: 'regression' });
const regressionAssessment = inspectExploreCapacityBuild(regressionBuild);
check(regressionAssessment.supported && regressionAssessment.task === 'regression', 'The same strict bridge contract should accept the supported regression task.');
const regressionSession = createExploreBridgeSessionV1({ build: regressionBuild });
const regressionResult = await regressionSession.runComparison();
assert.equal(regressionResult.runs.length, 2);
check(Number.isFinite(regressionResult.comparison.metrics.rmse.delta), 'Regression metrics must come from the current paired evaluator runs.');
assert.equal(regressionResult.comparison.metricProvenance.length, 2);

const layoutOnly = structuredClone(build);
layoutOnly.nodes[0].position.x += 500;
assert.equal(initial.reconcileSource(layoutOnly, 'project-1'), false, 'Layout-only edits must not stale the bridge session.');
const changedGraph = structuredClone(build);
changedGraph.nodes.find((node) => node.id === 'build-hidden').data.parameters.use_bias = false;
assert.equal(initial.reconcileSource(changedGraph, 'project-1'), true);
assert.equal(initial.getSnapshot().reasonCode, 'SOURCE_CHANGED');

const reloadSession = createExploreBridgeSessionV1({ build, projectSessionId: 'project-1' });
assert.equal(reloadSession.getSnapshot().lifecycle, 'ready', 'Reload starts a new in-memory session.');
assert.equal(reloadSession.getSnapshot().comparison, null, 'Completed comparison is not persisted into project/session storage.');
const closed = createExploreBridgeSessionV1({ build, projectSessionId: 'project-1' });
await closed.runComparison();
const retainedComparison = closed.getSnapshot().comparison;
closed.close();
assert.equal(closed.getSnapshot().lifecycle, 'closed');
assert.deepEqual(closed.getSnapshot().comparison, retainedComparison, 'Close keeps completed results read-only in the current app session.');
assert.equal(closed.setVariantWidth(8), null, 'Closed results cannot be edited or rerun.');
assert.equal(closed.reconcileSource(changedGraph, 'project-1'), true, 'A closed session still detects semantic Build changes.');
assert.equal(closed.getSnapshot().lifecycle, 'stale');
assert.deepEqual(closed.getSnapshot().comparison, retainedComparison, 'A closed stale result remains available as read-only history.');
closed.close();
assert.equal(closed.getSnapshot().lifecycle, 'stale', 'Closing a stale session must not erase its invalidation status.');

let fakeCall = 0;
let shouldFailVariant = true;
const retrying = createExploreBridgeSessionV1({
  build,
  runBrowserGraph: async ({ nodes }) => {
    fakeCall += 1;
    if (fakeCall === 2 && shouldFailVariant) {
      shouldFailVariant = false;
      throw new Error('fixture failure');
    }
    const width = Number(nodes.find((node) => node.id === 'build-hidden').data.parameters.units);
    return { type: 'browser_mlp', metrics: { accuracy: width === 2 ? 0.9 : 0.4 } };
  },
});
await assert.rejects(retrying.runComparison());
assert.equal(retrying.getSnapshot().lifecycle, 'failed');
assert.equal(retrying.getSnapshot().comparison, null, 'A partial A-only result must never be published.');
const retried = await retrying.runComparison();
assert.equal(retried.comparison.metrics.accuracy.delta, -0.5, 'Metric deltas remain descriptive, including negative outcomes.');
assert.notEqual(retried.runs[0].runId, retried.runs[1].runId);

let malformedRuntimeCall = 0;
const malformedRuntime = createExploreBridgeSessionV1({
  build,
  runBrowserGraph: async () => {
    malformedRuntimeCall += 1;
    return malformedRuntimeCall === 1
      ? { type: 'browser_mlp', metrics: { accuracy: 0.5 } }
      : { type: 'browser_mlp', metrics: null };
  },
});
await assert.rejects(malformedRuntime.runComparison());
assert.equal(malformedRuntime.getSnapshot().reasonCode, 'RUN_FAILED');
assert.equal(malformedRuntime.getSnapshot().comparison, null, 'A result with no evaluator metrics cannot become comparison truth.');

let releaseBaseline;
let controlledCalls = 0;
const deferredRun = createExploreBridgeSessionV1({
  build,
  runBrowserGraph: () => {
    controlledCalls += 1;
    return new Promise((resolve) => { releaseBaseline = resolve; });
  },
});
const firstAttempt = deferredRun.runComparison();
const duplicateAttempt = deferredRun.runComparison();
assert.equal(controlledCalls, 1, 'Double clicks share one active comparison attempt.');
assert.equal(deferredRun.getSnapshot().lifecycle, 'running');
assert.equal(deferredRun.cancel(), true);
const cancelledState = deferredRun.getSnapshot();
assert.equal(cancelledState.lifecycle, 'ready');
releaseBaseline({ type: 'browser_mlp', metrics: { accuracy: 0.5 } });
await Promise.all([firstAttempt, duplicateAttempt]);
assert.equal(deferredRun.getSnapshot().lifecycle, 'ready', 'A late cancelled response cannot publish comparison truth.');
assert.equal(deferredRun.getSnapshot().comparison, null);

let releaseSwitch;
const switching = createExploreBridgeSessionV1({
  build,
  projectSessionId: 'project-before',
  runBrowserGraph: () => new Promise((resolve) => { releaseSwitch = resolve; }),
});
const switchingAttempt = switching.runComparison();
assert.equal(switching.reconcileSource(build, 'project-after'), true);
assert.equal(switching.getSnapshot().reasonCode, 'PROJECT_SESSION_CHANGED');
releaseSwitch({ type: 'browser_mlp', metrics: { accuracy: 0.5 } });
await switchingAttempt;
assert.equal(switching.getSnapshot().lifecycle, 'stale');
assert.equal(switching.getSnapshot().comparison, null);

console.log('Build→Explore capacity bridge checks passed (including two real Browser CPU L0 training runs).');
