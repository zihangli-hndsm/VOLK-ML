import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { classifyPresentationCapabilities } from '../src/core/ui/uiArchitecture.js';
import { deriveSampleComparisonPresentation } from '../src/core/ui/sampleComparisonPresentation.js';

const dataWorkspaceSource = readFileSync(new URL('../src/components/playground/DataWorkspace.jsx', import.meta.url), 'utf8');
const detailsSource = readFileSync(new URL('../src/components/playground/ExploreDetailsRegion.jsx', import.meta.url), 'utf8');
const inspectorSource = readFileSync(new URL('../src/components/playground/PlaygroundInspector.jsx', import.meta.url), 'utf8');

assert.match(dataWorkspaceSource, /world\.sampleAgain/);
assert.match(dataWorkspaceSource, /Same World|sampleStatus/);
assert.match(dataWorkspaceSource, /DUPLICATE_EXPERIMENT/);
assert.match(detailsSource, /data-mechanism-loss/);
assert.match(inspectorSource, /data-representation-network/);

const linearHost = createPlaygroundHost({ getDataset: () => null });
await linearHost.open({ playgroundId: 'linear-regression', seed: 7 });
let linear = linearHost.getState();
assert.equal(linear.world.mode, 'generated');
assert.ok(linear.capabilities.worldOperations.some((operation) => operation.type === 'RESAMPLE_WORLD'));
const firstWorld = linear.datasetProvenance.worldFingerprint;
const firstDataset = linear.datasetProvenance.datasetId;
linear = await linearHost.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
const firstExperimentId = linear.experimentWorkspace.comparison.againstExperimentId;
linear = await linearHost.dispatch({ type: 'RESAMPLE_WORLD' });
assert.equal(linear.datasetProvenance.worldFingerprint, firstWorld, 'Sample again preserves the World identity');
assert.notEqual(linear.datasetProvenance.datasetId, firstDataset, 'Sample again creates a new finite Dataset');
assert.ok(linear.semanticEvents.events.some((event) => event.type === 'observation.sampled'));
assert.equal(deriveSampleComparisonPresentation(linear).available, true, 'same-World new-sample status is available from the active lineage before Compare is opened');
linear = await linearHost.dispatch({ type: 'SET_WORKSPACE_VIEW', patch: { boundsMode: 'manual', bounds: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 } } });
assert.equal(deriveSampleComparisonPresentation(linear).available, true, 'view-only changes preserve the active sampling lineage');
linear = await linearHost.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: firstExperimentId });
assert.deepEqual(linear.experimentWorkspace.comparison.diff.changedFactors, ['observationProcess']);
assert.equal(linear.experimentWorkspace.comparison.diff.factors.world.changed, false);
assert.equal(linear.experimentWorkspace.comparison.diff.factors.observationProcess.changed, true);
for (const factor of ['model', 'learning', 'evaluation']) {
  assert.equal(linear.experimentWorkspace.comparison.diff.factors[factor].changed, false, `${factor} remains held during sample comparison`);
}
linear = await linearHost.dispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction: { id: 'ui-sample-truth-world-change', actor: 'human', intent: 'point', operations: [{ type: 'ADD_POINTS', points: [{ x: 9, y: 9, target: 1, membership: 'train' }] }] } });
assert.equal(deriveSampleComparisonPresentation(linear).available, false, 'World changes invalidate the same-World new-sample presentation');
await linearHost.close();

const lifecycleSource = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
assert.match(lifecycleSource, /EXPLORE_WORKSPACE_LIFECYCLES\.EPHEMERAL/);
assert.match(lifecycleSource, /exploreForkCounterRef/);
assert.match(lifecycleSource, /exploreWorkspacesRef\.current\.delete/);
assert.match(lifecycleSource, /strictOpen/);

const mlpHost = createPlaygroundHost({ getDataset: () => null });
await mlpHost.open({ playgroundId: 'mlp-classification', seed: 2026 });
let mlp = mlpHost.getState();
const initialPoints = mlp.world.observations;
const initialSnapshot = structuredClone(initialPoints);
assert.equal(initialPoints.length, 32, 'default MLP concept World uses a moderate point count');
assert.deepEqual(initialPoints, initialSnapshot, 'default MLP source is deterministic');
assert.deepEqual(new Set(initialPoints.map((point) => point.label)), new Set(['a', 'b']));
assert.ok(initialPoints.every((point) => Math.abs(point.x) > 0.35 && Math.abs(point.y) > 0.35), 'default MLP clusters remain visually separated');
assert.ok(initialPoints.filter((point) => point.x * point.y > 0).every((point) => point.label === 'a'), 'same-sign quadrants share one class');
assert.ok(initialPoints.filter((point) => point.x * point.y < 0).every((point) => point.label === 'b'), 'opposite-sign quadrants share the other class');
const repeatMlpHost = createPlaygroundHost({ getDataset: () => null });
await repeatMlpHost.open({ playgroundId: 'mlp-classification', seed: 2026 });
assert.deepEqual(repeatMlpHost.getState().world.observations, initialPoints, 'default MLP World is deterministic across sessions');
await repeatMlpHost.close();

const network = () => mlp.primitives.find((primitive) => primitive.type === 'network-graph');
assert.equal(network().props.nodes.filter((node) => node.layer === 1).length, 3);
mlp = await mlpHost.dispatch({ type: 'SET_CONTROL', key: 'hiddenUnits', value: 5 });
assert.equal(network().props.nodes.filter((node) => node.layer === 1).length, 5, 'network graph follows the current hidden-unit structure');
assert.equal(mlp.primitives.find((primitive) => primitive.type === 'loss-curve').props.lossHistory.length, 0);
mlp = await mlpHost.dispatch({ type: 'TRAINING_STEP' });
assert.ok(mlp.primitives.find((primitive) => primitive.type === 'loss-curve').props.lossHistory.length > 0, 'loss curve uses real training history');
const trainedLossCount = mlp.primitives.find((primitive) => primitive.type === 'loss-curve').props.lossHistory.length;
mlp = await mlpHost.dispatch({ type: 'SET_CONTROL', key: 'hiddenUnits', value: 4 });
assert.equal(mlp.primitives.find((primitive) => primitive.type === 'loss-curve').props.lossHistory.length, 0, 'stale loss history is cleared after a model condition change');
assert.ok(trainedLossCount > 0);
await mlpHost.close();

assert.equal(classifyPresentationCapabilities({ containerWidth: 1440, containerHeight: 900, pointer: 'fine', hover: 'available' }).band, 'wide');
assert.equal(classifyPresentationCapabilities({ containerWidth: 1024, containerHeight: 768, pointer: 'coarse', hover: 'none', orientation: 'landscape' }).band, 'wide');
assert.equal(classifyPresentationCapabilities({ containerWidth: 390, containerHeight: 844, pointer: 'coarse', hover: 'none' }).inspectorPresentation, 'bottom-sheet');

console.log('Explore learning surface checks passed: learner resampling, same-World comparison, clear MLP XOR source, live network structure, loss history, stale-state clearing, and responsive bands.');
