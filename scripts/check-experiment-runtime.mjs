import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';

const host = createPlaygroundHost({ getDataset: () => null });
await host.open({ playgroundId: 'linear-regression', seed: 42 });
const initial = host.getState();
const experimentA = initial.experimentWorkspace.experiments[0];

await host.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
let snapshot = host.getState();
const experimentB = snapshot.experimentWorkspace.experiments[1];
assert.notEqual(experimentA.id, experimentB.id, 'duplicate receives a new experiment identity');
assert.equal(experimentB.parentExperimentId, experimentA.id, 'duplicate records its parent');
assert.equal(experimentB.baselineExperimentId, experimentA.id, 'duplicate records its baseline');
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
    operations: [{ type: 'ADD_POINTS', points: [{ x: 8, y: 7, features: { x: 8, y: 7 }, membership: 'train' }] }],
  },
});
snapshot = host.getState();
assert.deepEqual(snapshot.experimentWorkspace.comparison.diff.changed, ['world'], 'data-only change is one semantic factor');
assert.equal(snapshot.experimentWorkspace.comparison.diff.clarity, 'high', 'data-only change has high clarity');
const bPointCount = snapshot.world.observations.length;

await host.dispatch({ type: 'SWITCH_EXPERIMENT', experimentId: experimentA.id });
snapshot = host.getState();
assert.equal(snapshot.world.observations.length, initial.world.observations.length, 'switching to A restores A without B data');
await host.dispatch({ type: 'SWITCH_EXPERIMENT', experimentId: experimentB.id });
snapshot = host.getState();
assert.equal(snapshot.world.observations.length, bPointCount, 'switching back restores B data');

await host.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.2 });
snapshot = host.getState();
assert.deepEqual(snapshot.experimentWorkspace.comparison.diff.changed, ['world', 'learning'], 'multiple factors are visible');
assert.equal(snapshot.experimentWorkspace.comparison.diff.clarity, 'mixed', 'multiple factors have mixed clarity');
await host.dispatch({ type: 'UNDO_EXPERIMENT_ACTION' });
snapshot = host.getState();
assert.equal(snapshot.controls.learningRate, 0.05, 'control undo restores the previous learning rate');
assert.deepEqual(snapshot.experimentWorkspace.comparison.diff.changed, ['world'], 'control undo returns to the one-factor comparison');
assert.equal(snapshot.experimentWorkspace.repeat.policy, 'fixed-seed', 'duplicate preserves fixed seed semantics');
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
