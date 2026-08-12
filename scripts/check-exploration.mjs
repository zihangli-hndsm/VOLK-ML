import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createWorld,
  deserializeWorld,
  serializeWorld,
  worldFromPlaygroundSource,
} from '../src/core/exploration/world.js';
import {
  createExperiment,
  deserializeExperiment,
  duplicateExperiment,
  serializeExperiment,
} from '../src/core/exploration/experiment.js';
import { compareExperiments, semanticFingerprint } from '../src/core/exploration/comparison.js';
import {
  applyExperimentOperation,
  applyWorldTransaction,
  MAX_WORLD_TRANSACTION_OPERATIONS,
} from '../src/core/exploration/operations.js';
import {
  materializeWorldGesture,
  MAX_GESTURE_PATH_POINTS,
  MAX_POINTS_PER_GESTURE,
} from '../src/core/exploration/gestures.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createPlaygroundAgentApi } from '../src/core/playgroundAgent.js';

// Phase 0 exploration semantics: World/Experiment snapshots are explicit,
// detached, serializable domain state shared by runtime and Agent inspection.
const phase0World = createWorld({
  id: 'phase0-world-a',
  task: 'regression',
  seed: 17,
  observations: [
    { id: 'p1', x: 0, y: 0, target: 0, membership: 'train', provenance: 'manual' },
    { id: 'p2', x: 1, y: 1, target: 1, membership: 'test', provenance: 'manual' },
  ],
});
const phase0Experiment = createExperiment({
  id: 'phase0-experiment-a',
  world: phase0World,
  adapterId: 'linear-regression',
  model: { controls: { weight: 0, bias: 0 } },
  learning: { controls: { learningRate: 0.05 } },
  seed: 17,
});
const phase0Duplicate = duplicateExperiment(phase0Experiment, { id: 'phase0-experiment-b' });
assert.deepEqual(compareExperiments(phase0Experiment, phase0Duplicate).changed, [], 'duplicate experiments are semantically identical');
phase0Duplicate.world.observations[0].x = 9;
assert.equal(phase0Experiment.world.observations[0].x, 0, 'duplicate World state is detached');
assert.equal(deserializeWorld(serializeWorld(phase0World)).observations[0].membership, 'train', 'World serialization preserves train membership');
assert.equal(deserializeExperiment(serializeExperiment(phase0Experiment)).world.observations[1].membership, 'test', 'Experiment serialization preserves test membership');

const phase0Moved = applyExperimentOperation(phase0Experiment, { type: 'MOVE_POINT', pointId: 'p1', x: 2, y: 2 });
const movedDiff = compareExperiments(phase0Experiment, phase0Moved);
assert.deepEqual(movedDiff.changed, ['world'], 'one world mutation is reported as one factor');
assert.equal(movedDiff.clarity, 'high');
const phase0MultiChanged = applyExperimentOperation(phase0Moved, {
  type: 'SET_TRAIN_TEST_MEMBERSHIP', pointIds: ['p1'], membership: 'test',
});
const multiDiff = compareExperiments(phase0Experiment, phase0MultiChanged);
assert.ok(multiDiff.changed.includes('world') && multiDiff.changed.includes('trainTest'), 'multiple semantic factors are reported separately');
assert.equal(multiDiff.clarity, 'mixed', 'mixed comparisons are informative, not invalid');

const source = {
  kind: 'example', name: 'phase0-source', fingerprint: 'phase0-source-v1',
  points: [{ id: 'a', x: 0, y: 1 }, { id: 'b', x: 1, y: 2 }], feature: 'x', target: 'y',
};
const seededA = worldFromPlaygroundSource(source, { seed: 2026 });
const seededB = worldFromPlaygroundSource(source, { seed: 2026 });
const seededC = worldFromPlaygroundSource(source, { seed: 7 });
assert.deepEqual(seededA, seededB, 'same seed produces identical World state');
assert.notDeepEqual(seededA.randomness, seededC.randomness, 'different seed policies remain distinguishable');

const phase0Host = createPlaygroundHost({ getDataset: () => null });
const phase0Agent = createPlaygroundAgentApi(phase0Host);
await phase0Agent.open({ playgroundId: 'linear-regression', seed: 2026 });
const initialContext = phase0Agent.inspectContext();
assert.deepEqual(initialContext.world, phase0Host.getState().world, 'Agent inspection and runtime expose the same World');
const initialPointCount = initialContext.world.observations.length;
const afterAgentMutation = await phase0Agent.dispatch({ type: 'ADD_POINT', x: 2, y: 3 });
assert.equal(afterAgentMutation.world.observations.length, initialPointCount + 1, 'shared runtime action updates the semantic World');
assert.equal(phase0Agent.inspectContext().experiment.world.observations.length, initialPointCount + 1, 'Agent inspection observes the accepted mutation');
assert.equal(afterAgentMutation.world.observations.at(-1).provenance, 'manual', 'new runtime observations have explicit provenance');
assert.equal(afterAgentMutation.experiment.mutations.at(-1).type, 'world.addPoints', 'runtime actions retain grouped domain mutation boundaries');
await phase0Agent.close();

// Phase 1.1: one canonical World transaction is atomic, invertible and
// independent of UI/model vocabulary.
const transaction = applyWorldTransaction(phase0World, {
  id: 'gesture-1',
  actor: 'human',
  intent: 'brush',
  operations: [{
    type: 'ADD_POINTS',
    points: [
      { x: 2, y: 2, target: 2, membership: 'train' },
      { x: 3, y: 3, target: 3, membership: 'test' },
    ],
  }],
});
assert.equal(transaction.world.observations.length, phase0World.observations.length + 2);
assert.equal(transaction.record.mutationSummary.operationCount, 1, 'one gesture creates one semantic action record');
assert.equal(transaction.record.actor, 'human');
const undoneTransaction = applyWorldTransaction(transaction.world, transaction.inverse);
assert.deepEqual(undoneTransaction.world, phase0World, 'inverse transaction restores the exact World');
const removedMiddle = applyWorldTransaction(transaction.world, {
  id: 'remove-middle', actor: 'human', intent: 'erase',
  operations: [{ type: 'REMOVE_POINT', pointId: transaction.world.observations[1].id }],
});
assert.deepEqual(
  applyWorldTransaction(removedMiddle.world, removedMiddle.inverse).world,
  transaction.world,
  'undoing removal restores the original observation order and values',
);
assert.throws(() => applyWorldTransaction(phase0World, {
  id: 'atomic-failure', actor: 'human', intent: 'edit', operations: [
    { type: 'MOVE_POINT', pointId: 'p1', x: 4, y: 4 },
    { type: 'MOVE_POINT', pointId: 'missing', x: 5, y: 5 },
  ],
}), (error) => error.code === 'EXPLORATION_POINT_NOT_FOUND', 'a failed transaction rejects atomically');
assert.equal(phase0World.observations[0].x, 0, 'failed transaction cannot mutate its input World');
assert.throws(() => applyWorldTransaction(phase0World, {
  id: 'too-many-operations', actor: 'agent', intent: 'edit',
  operations: Array.from({ length: MAX_WORLD_TRANSACTION_OPERATIONS + 1 }, () => ({
    type: 'MOVE_POINT', pointId: 'p1', x: 1, y: 1,
  })),
}), (error) => error.code === 'EXPLORATION_RESOURCE_LIMIT', 'transaction work is bounded before applying operations');

const gestureInput = {
  id: 'deterministic-brush',
  tool: 'brush',
  path: [{ x: -1, y: -1 }, { x: 1, y: 1 }],
  seed: 91,
  spread: 0.1,
  density: 3,
  membership: 'train',
};
const gestureA = materializeWorldGesture(gestureInput);
const gestureB = materializeWorldGesture(gestureInput);
assert.deepEqual(gestureA, gestureB, 'same normalized gesture and seed materialize identical observations and IDs');
assert.ok(gestureA.operations[0].points.length <= MAX_POINTS_PER_GESTURE, 'gesture point output is bounded');
assert.throws(() => materializeWorldGesture({
  ...gestureInput,
  path: Array.from({ length: MAX_GESTURE_PATH_POINTS + 1 }, (_, index) => ({ x: index, y: index })),
}), (error) => error.code === 'EXPLORATION_RESOURCE_LIMIT', 'gesture path input is bounded before expansion');

const phase11Host = createPlaygroundHost({ getDataset: () => null });
await phase11Host.open({ playgroundId: 'linear-regression', seed: 404 });
const phase11Initial = phase11Host.getState();
const ids = phase11Initial.world.observations.map((point) => point.id);
const testId = ids.at(-1);
const splitSnapshot = await phase11Host.dispatch({
  type: 'APPLY_WORLD_TRANSACTION',
  transaction: {
    id: 'explicit-split',
    actor: 'human',
    intent: 'membership',
    operations: [
      { type: 'SET_TRAIN_TEST_MEMBERSHIP', pointIds: ids.slice(0, -1), membership: 'train' },
      { type: 'SET_TRAIN_TEST_MEMBERSHIP', pointIds: [testId], membership: 'test' },
    ],
  },
});
assert.equal(splitSnapshot.actionHistory.past.length, 1, 'a multi-operation split is one undoable action');
assert.deepEqual(splitSnapshot.world, splitSnapshot.experiment.world, 'runtime World and Experiment World share one semantic result');
assert.equal(splitSnapshot.metrics.testMse === null, false, 'explicit test membership produces a test metric');
const fitBeforeTestMove = {
  weight: splitSnapshot.scene.bestFitLine.weight,
  bias: splitSnapshot.scene.bestFitLine.bias,
};
const movedTest = await phase11Host.dispatch({
  type: 'APPLY_WORLD_TRANSACTION',
  transaction: {
    id: 'move-test', actor: 'human', intent: 'move',
    operations: [{ type: 'MOVE_POINT', pointId: testId, x: 999, y: -999 }],
  },
});
assert.deepEqual({
  weight: movedTest.scene.bestFitLine.weight,
  bias: movedTest.scene.bestFitLine.bias,
}, fitBeforeTestMove, 'moving only a test point cannot change the train-only best-fit parameters');
assert.notEqual(movedTest.metrics.testMse, splitSnapshot.metrics.testMse, 'moving a test point changes test evidence');
const afterUndo = await phase11Host.dispatch({ type: 'UNDO_WORLD_ACTION' });
assert.deepEqual(afterUndo.world, splitSnapshot.world, 'runtime Undo restores the exact previous World');
assert.equal(afterUndo.actionHistory.future.length, 1, 'Undo exposes one redoable semantic action');
const afterRedo = await phase11Host.dispatch({ type: 'REDO_WORLD_ACTION' });
assert.deepEqual(afterRedo.world, movedTest.world, 'runtime Redo restores the forward World transaction');
const beforeInvalidSplit = phase11Host.getState();
await assert.rejects(() => phase11Host.dispatch({
  type: 'APPLY_WORLD_TRANSACTION',
  transaction: {
    id: 'invalid-one-train', actor: 'human', intent: 'membership',
    operations: [{
      type: 'SET_TRAIN_TEST_MEMBERSHIP',
      pointIds: beforeInvalidSplit.world.observations.slice(1).map((point) => point.id),
      membership: 'test',
    }],
  },
}), (error) => error.code === 'INVALID_PLAYGROUND_ACTION', 'LR rejects a World with fewer than two training observations');
assert.deepEqual(phase11Host.getState().world, beforeInvalidSplit.world, 'adapter rejection leaves the live World unchanged');
const fingerprintBeforeView = semanticFingerprint(afterRedo.experiment);
const afterView = await phase11Host.dispatch({
  type: 'SET_WORKSPACE_VIEW',
  patch: { visibility: 'train', bounds: { xMin: -20, xMax: 20, yMin: -30, yMax: 30 } },
});
assert.equal(semanticFingerprint(afterView.experiment), fingerprintBeforeView, 'view state does not mutate Experiment semantics');
assert.equal(afterView.viewState.visibility, 'train');
assert.equal(afterView.actionHistory.past.length, afterRedo.actionHistory.past.length, 'view actions do not enter World history');
await phase11Host.close();

const scriptHistoryHost = createPlaygroundHost({ getDataset: () => null });
await scriptHistoryHost.open({ playgroundId: 'linear-regression', seed: 505 });
const beforeScriptEdit = scriptHistoryHost.getState();
await scriptHistoryHost.dispatch({
  type: 'APPLY_WORLD_TRANSACTION',
  transaction: {
    id: 'pre-script-edit', actor: 'human', intent: 'point',
    operations: [{ type: 'ADD_POINTS', points: [{ x: 8, y: 8, target: 8, membership: 'unspecified' }] }],
  },
});
const scriptBaseline = scriptHistoryHost.getState();
await scriptHistoryHost.loadPreset({ presetId: 'linear-regression.intuition' });
await scriptHistoryHost.dispatch({
  type: 'APPLY_WORLD_TRANSACTION',
  transaction: {
    id: 'inside-script-edit', actor: 'human', intent: 'point',
    operations: [{ type: 'ADD_POINTS', points: [{ x: 9, y: 9, target: 9, membership: 'unspecified' }] }],
  },
});
const editedInScript = scriptHistoryHost.getState();
assert.equal(editedInScript.actionHistory.past.length, scriptBaseline.actionHistory.past.length + 1);
await scriptHistoryHost.dispatch({ type: 'SCRIPT_RESET' });
const resetScript = scriptHistoryHost.getState();
assert.deepEqual(resetScript.world, scriptBaseline.world, 'SCRIPT_RESET restores the World captured at SCRIPT_LOAD');
assert.deepEqual(resetScript.actionHistory, scriptBaseline.actionHistory, 'SCRIPT_RESET restores World history without branch leakage');
assert.notDeepEqual(resetScript.world, beforeScriptEdit.world, 'SCRIPT_RESET does not jump to the open-time session baseline');
await scriptHistoryHost.close();

const agentParityHost = createPlaygroundHost({ getDataset: () => null });
const agentParityApi = createPlaygroundAgentApi(agentParityHost);
await agentParityApi.open({ playgroundId: 'linear-regression', seed: 606 });
const parityInitial = agentParityApi.inspectContext();
const parityTransaction = {
  id: 'agent-parity', actor: 'agent', intent: 'point',
  operations: [{ type: 'ADD_POINTS', points: [{ x: 6, y: 7, target: 7, membership: 'unspecified' }] }],
};
const parityResult = await agentParityApi.dispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction: parityTransaction });
const pureParity = applyWorldTransaction(parityInitial.world, parityTransaction);
assert.deepEqual(parityResult.world, pureParity.world, 'Agent dispatch and pure/manual transaction paths produce the same World');
assert.equal(parityResult.actionHistory.past.at(-1).actor, 'agent', 'Agent actor remains inspectable in semantic history');
await agentParityApi.close();

const runtimeSource = readFileSync(new URL('../src/core/playground/playgroundRuntime.js', import.meta.url), 'utf8');
const operationSource = readFileSync(new URL('../src/core/exploration/operations.js', import.meta.url), 'utf8');
const gestureSource = readFileSync(new URL('../src/core/exploration/gestures.js', import.meta.url), 'utf8');
for (const sourceText of [runtimeSource, operationSource, gestureSource]) {
  assert.doesNotMatch(sourceText, /knn|mlp|linear-regression/, 'World transaction and gesture layers contain no model-specific branches');
}

console.log('Exploration semantic checks passed: Phase 0 contracts plus Phase 1.1 atomic World transactions, deterministic gestures, grouped Undo/Redo, train/test semantics, and view isolation.');
