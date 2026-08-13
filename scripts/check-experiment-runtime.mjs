import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { projectedBounds } from '../src/core/exploration/projection.js';

const host = createPlaygroundHost({ getDataset: () => null });
await host.open({ playgroundId: 'linear-regression', seed: 42 });
const initial = host.getState();
const experimentA = initial.experimentWorkspace.experiments[0];

await host.dispatch({
  type: 'APPLY_WORLD_TRANSACTION',
  transaction: {
    id: 'experiment-a-edit-before-duplicate',
    actor: 'human',
    intent: 'point',
    operations: [{ type: 'ADD_POINTS', points: [{ x: 8, y: 7, features: { x: 8, y: 7 }, membership: 'train' }] }],
  },
});
const aAtDuplicate = host.getState();
await host.dispatch({ type: 'RUN' });
const aFittedAtDuplicate = host.getState();

await host.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
let snapshot = host.getState();
const experimentB = snapshot.experimentWorkspace.experiments[1];
assert.notEqual(experimentA.id, experimentB.id, 'duplicate receives a new experiment identity');
assert.equal(experimentB.parentExperimentId, experimentA.id, 'duplicate records its parent');
assert.equal(experimentB.baselineExperimentId, experimentA.id, 'duplicate records its baseline');
assert.deepEqual(snapshot.world, aFittedAtDuplicate.world, 'duplicate starts from the exact current A World');
assert.deepEqual(snapshot.scene.points, aFittedAtDuplicate.scene.points, 'duplicate starts from the exact current A model state');
await host.dispatch({ type: 'SWITCH_EXPERIMENT', experimentId: experimentA.id });
snapshot = host.getState();
assert.equal(snapshot.experimentWorkspace.comparison.againstExperimentId, experimentB.id, 'switching never leaves a disabled self-comparison label');
await host.dispatch({ type: 'SWITCH_EXPERIMENT', experimentId: experimentB.id });
await host.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: experimentA.id });
snapshot = host.getState();
assert.deepEqual(snapshot.experimentWorkspace.comparison.diff.changed, [], 'duplicate starts semantically equal');
assert.equal(snapshot.experimentWorkspace.comparison.diff.clarity, 'identical', 'identical duplicate has identical clarity');

await host.dispatch({
  type: 'APPLY_WORLD_TRANSACTION',
  transaction: {
    id: 'experiment-b-add-point',
    actor: 'human',
    intent: 'point',
    operations: [{ type: 'ADD_POINTS', points: [{ x: 28, y: 27, features: { x: 28, y: 27 }, membership: 'train' }] }],
  },
});
await host.dispatch({ type: 'RUN' });
snapshot = host.getState();
assert.deepEqual(snapshot.experimentWorkspace.comparison.diff.changed, ['world'], 'data-only change is one semantic factor');
assert.equal(snapshot.experimentWorkspace.comparison.diff.clarity, 'high', 'data-only change has high clarity');
assert.deepEqual(snapshot.experimentWorkspace.comparison.results.active, snapshot.experiment.result, 'comparison result rows use the current B result');
const bPointCount = snapshot.world.observations.length;
const comparisonBounds = snapshot.experimentWorkspace.comparison.bounds;
const allComparedPoints = [...aAtDuplicate.world.observations, ...snapshot.world.observations];
const expectedA = projectedBounds(aAtDuplicate.world.observations, 'x', 'y');
const expectedB = projectedBounds(snapshot.world.observations, 'x', 'y');
assert.ok(comparisonBounds.xMin <= Math.min(expectedA.xMin, expectedB.xMin));
assert.ok(comparisonBounds.xMax >= Math.max(expectedA.xMax, expectedB.xMax));
assert.ok(comparisonBounds.yMin <= Math.min(expectedA.yMin, expectedB.yMin));
assert.ok(comparisonBounds.yMax >= Math.max(expectedA.yMax, expectedB.yMax));
assert.ok(allComparedPoints.every((point) => point.x >= comparisonBounds.xMin && point.x <= comparisonBounds.xMax), 'comparison frame contains both Worlds');

await host.dispatch({ type: 'SWITCH_EXPERIMENT', experimentId: experimentA.id });
snapshot = host.getState();
assert.equal(snapshot.world.observations.length, aAtDuplicate.world.observations.length, 'switching to A restores A without B data');
assert.equal(snapshot.experimentWorkspace.comparison.againstExperimentId, experimentB.id, 'switching to comparison target swaps A/B roles');
assert.equal(snapshot.experimentWorkspace.comparison.againstExperimentId, snapshot.experimentWorkspace.activeExperimentId === experimentA.id ? experimentB.id : experimentA.id, 'A never compares with itself');
await host.dispatch({ type: 'SWITCH_EXPERIMENT', experimentId: experimentB.id });
snapshot = host.getState();
assert.equal(snapshot.world.observations.length, bPointCount, 'switching back restores B data');
assert.equal(snapshot.experimentWorkspace.comparison.againstExperimentId, experimentA.id, 'switching back restores the reverse A/B roles');
assert.deepEqual(snapshot.experimentWorkspace.comparison.bounds, comparisonBounds, 'switching A/B preserves the shared comparison frame');

await host.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.2 });
snapshot = host.getState();
assert.deepEqual(snapshot.experimentWorkspace.comparison.diff.changed, ['world', 'learning'], 'multiple factors are visible');
assert.equal(snapshot.experimentWorkspace.comparison.diff.clarity, 'mixed', 'multiple factors have mixed clarity');
await host.dispatch({ type: 'UNDO_EXPERIMENT_ACTION' });
snapshot = host.getState();
assert.equal(snapshot.controls.learningRate, 0.05, 'control undo restores the previous learning rate');
assert.deepEqual(snapshot.experimentWorkspace.comparison.diff.changed, ['world'], 'control undo returns to the one-factor comparison');
assert.equal(snapshot.experimentWorkspace.repeat.policy, 'fixed-seed', 'duplicate preserves fixed seed semantics');

await host.dispatch({ type: 'ADD_POINT', x: 35, y: 34 });
const bRestartWorld = host.getState().world;
await host.dispatch({ type: 'SCRIPT_RESET' });
snapshot = host.getState();
assert.deepEqual(snapshot.world, bRestartWorld, 'Restart explanation preserves B current World');
assert.equal(snapshot.scene.points.length, snapshot.world.observations.length, 'Restart explanation rebuilds model state for B current World');
assert.deepEqual(snapshot.experimentWorkspace.comparison.results.active, snapshot.experiment.result, 'Restart explanation refreshes the active comparison result');

await host.dispatch({ type: 'RESET' });
snapshot = host.getState();
assert.deepEqual(snapshot.world, aFittedAtDuplicate.world, 'B reset returns to the duplicate-time baseline');
assert.deepEqual(snapshot.scene.points, aFittedAtDuplicate.scene.points, 'B reset restores a coherent duplicate-time model baseline');
await host.dispatch({ type: 'SWITCH_EXPERIMENT', experimentId: experimentA.id });
snapshot = host.getState();
assert.deepEqual(snapshot.world, aFittedAtDuplicate.world, 'A remains independent after B reset');
await host.dispatch({ type: 'ADD_POINT', x: -9, y: -8 });
const aAfterBReset = host.getState();
await host.dispatch({ type: 'SWITCH_EXPERIMENT', experimentId: experimentB.id });
snapshot = host.getState();
assert.deepEqual(snapshot.world, aFittedAtDuplicate.world, 'B remains independent after a later A edit');
await host.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
snapshot = host.getState();
const experimentC = snapshot.experimentWorkspace.experiments.find((item) => item.id === snapshot.experimentWorkspace.activeExperimentId);
assert.equal(experimentC.parentExperimentId, experimentB.id, 'C lineage is derived from its semantic parent');
assert.equal(experimentC.baselineExperimentId, experimentA.id, 'C retains the canonical controlled-comparison baseline');
assert.equal(snapshot.experiment.lineage.parentId, experimentC.parentExperimentId, 'workspace parent matches semantic lineage');
assert.equal(snapshot.experiment.lineage.baselineId, experimentC.baselineExperimentId, 'workspace baseline matches semantic lineage');
assert.notDeepEqual(aAfterBReset.world, aAtDuplicate.world, 'A can continue independently after B reset');
const selfCompare = await host.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: snapshot.experimentWorkspace.activeExperimentId });
assert.notEqual(selfCompare.experimentWorkspace.comparison.againstExperimentId, selfCompare.experimentWorkspace.activeExperimentId, 'self comparison is normalized away');
assert.equal(selfCompare.experimentWorkspace.comparison.enabled, true, 'normalized comparison remains enabled when another branch exists');
const inspected = host.inspectContext();
assert.deepEqual(inspected.experimentWorkspace.comparison, selfCompare.experimentWorkspace.comparison, 'Agent sees the same comparison state as the Experiment Bar');
await host.close();

const classificationHost = createPlaygroundHost({ getDataset: () => null });
await classificationHost.open({ playgroundId: 'knn-classification', seed: 42 });
const classificationA = classificationHost.getState().experimentWorkspace.experiments[0].id;
await classificationHost.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
await classificationHost.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: classificationA });
await classificationHost.dispatch({ type: 'SET_CONTROL', key: 'k', value: 1 });
const classificationSnapshot = classificationHost.getState();
assert.deepEqual(classificationSnapshot.experimentWorkspace.comparison.diff.changed, ['model'], 'classification duplicate uses the same semantic model diff');
await classificationHost.dispatch({ type: 'SWITCH_EXPERIMENT', experimentId: classificationA });
assert.equal(classificationHost.getState().controls.k, 5, 'classification A restores independently');
await classificationHost.close();

console.log('Experiment runtime checks passed: duplicate identity/lineage, semantic equality, independent World mutation, restore, clarity, control undo, seed policy, and KNN parity.');
