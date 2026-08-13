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
import {
  getWorldOperation,
  isPublicWorldOperation,
  listWorldOperations,
} from '../src/core/exploration/operationRegistry.js';
import { createPlaygroundHost, getPlaybackAction } from '../src/core/playgroundHost.js';
import { createPlaygroundAgentApi } from '../src/core/playgroundAgent.js';
import { teachingDatasetById } from '../src/core/teachingDatasets.js';
import { canCreateObservationFromProjection, observationFromProjection } from '../src/core/exploration/projection.js';

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
const phase0MembershipChanged = applyExperimentOperation(phase0Experiment, {
  type: 'SET_TRAIN_TEST_MEMBERSHIP', pointIds: ['p1'], membership: 'test',
});
const membershipDiff = compareExperiments(phase0Experiment, phase0MembershipChanged);
assert.deepEqual(membershipDiff.changed, ['trainTest'], 'pure membership changes are not double-counted as World data changes');
assert.equal(membershipDiff.clarity, 'high');
const phase0MultiChanged = applyExperimentOperation(phase0Moved, {
  type: 'SET_TRAIN_TEST_MEMBERSHIP', pointIds: ['p1'], membership: 'test',
});
const multiDiff = compareExperiments(phase0Experiment, phase0MultiChanged);
assert.deepEqual(multiDiff.changed, ['world', 'trainTest'], 'point-value and membership changes remain independently detectable');
assert.equal(multiDiff.clarity, 'mixed', 'mixed comparisons are informative, not invalid');

const registeredWorldOperations = listWorldOperations();
assert.deepEqual(registeredWorldOperations.map((operation) => operation.type), [
  'ADD_POINTS',
  'MOVE_POINT',
  'REMOVE_POINT',
  'REMOVE_POINTS',
  'SET_FEATURE_VALUES',
  'TRANSFORM_FEATURE_VALUES',
  'SET_TRAIN_TEST_MEMBERSHIP',
], 'the public World operation registry is authoritative and ordered');
for (const operation of registeredWorldOperations) {
  assert.equal(operation.domain, 'world-state');
  assert.equal(operation.undoable, true);
  assert.equal(operation.agentDiscoverable, true);
  assert.equal(operation.humanAccessible, true);
  assert.ok(operation.changes.length > 0 && operation.preserves.length > 0);
}
assert.equal(getWorldOperation('RESTORE_POINTS'), null, 'inverse point restore is not a public capability');
assert.equal(isPublicWorldOperation('RESTORE_MEMBERSHIPS'), false, 'inverse membership restore is not public');

const unspecifiedWorld = createWorld({
  id: 'unspecified-world', task: 'regression', seed: 23,
  observations: [
    { id: 'u1', x: 0, y: 0 },
    { id: 'u2', x: 1, y: 1 },
    { id: 'u3', x: 2, y: 2 },
  ],
});
const firstSplit = applyWorldTransaction(unspecifiedWorld, {
  id: 'first-split', actor: 'human', intent: 'membership',
  operations: [{ type: 'SET_TRAIN_TEST_MEMBERSHIP', pointIds: ['u3'], membership: 'test' }],
});
assert.deepEqual(firstSplit.world.observations.map((point) => point.membership), ['train', 'train', 'test']);
assert.equal(firstSplit.record.mutationSummary.normalizedUnspecifiedToTrain, 2);
const unsplitAgain = applyWorldTransaction(firstSplit.world, firstSplit.inverse);
assert.deepEqual(unsplitAgain.world, unspecifiedWorld, 'Undo restores the exact pre-split unspecified World');

const mixedWorld = createWorld({
  id: 'mixed-world', task: 'regression', seed: 29,
  observations: [
    { id: 'm1', x: 0, y: 0, membership: 'train' },
    { id: 'm2', x: 1, y: 1, membership: 'unspecified' },
  ],
});
const normalizedAddition = applyWorldTransaction(mixedWorld, {
  id: 'mixed-add', actor: 'human', intent: 'point',
  operations: [{ type: 'ADD_POINTS', points: [{ x: 2, y: 2 }] }],
});
assert.equal(
  normalizedAddition.world.observations.some((point) => point.membership === 'unspecified'),
  false,
  'adding to an explicit or mixed split normalizes unspecified membership to train',
);

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
assert.equal(afterAgentMutation.world.observations.at(-1).provenance, 'agent', 'Agent compatibility edits have explicit actor provenance');
assert.equal(afterAgentMutation.actionHistory.past.length, 1, 'legacy Agent ADD_POINT uses canonical grouped World history');
assert.equal(afterAgentMutation.actionHistory.past.at(-1).intent, 'point');
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
const denserGesture = materializeWorldGesture({ ...gestureInput, density: 12 });
assert.ok(denserGesture.operations[0].points.length > gestureA.operations[0].points.length, 'brush density increases generated observations');
assert.ok(gestureA.operations[0].points.length <= MAX_POINTS_PER_GESTURE, 'gesture point output is bounded');
assert.throws(() => materializeWorldGesture({
  ...gestureInput,
  path: Array.from({ length: MAX_GESTURE_PATH_POINTS + 1 }, (_, index) => ({ x: index, y: index })),
}), (error) => error.code === 'EXPLORATION_RESOURCE_LIMIT', 'gesture path input is bounded before expansion');

const multiFeatureWorld = createWorld({
  id: 'multi-feature-world', task: 'regression', featureNames: ['area', 'age', 'price'],
  metadata: { modelFeature: 'area', targetFeature: 'price' },
  observations: [
    { id: 'mf1', x: 10, y: 100, target: 100, features: { area: 10, age: 4, price: 100 }, membership: 'train' },
    { id: 'mf2', x: 20, y: 200, target: 200, features: { area: 20, age: 8, price: 200 }, membership: 'test' },
  ],
});
const transformedFeatures = applyWorldTransaction(multiFeatureWorld, {
  id: 'feature-shift', actor: 'human', intent: 'feature-intervention',
  operations: [{ type: 'TRANSFORM_FEATURE_VALUES', feature: 'age', kind: 'shift', amount: 2, scope: 'train', pointIds: ['mf1'] }],
});
assert.equal(transformedFeatures.world.observations[0].features.age, 6, 'feature intervention changes the named feature');
assert.equal(transformedFeatures.world.observations[1].features.age, 8, 'scoped feature intervention leaves other observations unchanged');
assert.equal(transformedFeatures.world.observations[0].features.area, 10, 'feature intervention preserves unrelated features');
assert.deepEqual(applyWorldTransaction(transformedFeatures.world, transformedFeatures.inverse).world, multiFeatureWorld, 'feature intervention undo restores exact values');
const noiseTransaction = {
  id: 'feature-noise', actor: 'human', intent: 'feature-intervention',
  operations: [{ type: 'TRANSFORM_FEATURE_VALUES', feature: 'age', kind: 'noise', amount: 0.5, seed: 19, scope: 'all', pointIds: ['mf1', 'mf2'] }],
};
assert.deepEqual(
  applyWorldTransaction(multiFeatureWorld, noiseTransaction).world,
  applyWorldTransaction(multiFeatureWorld, { ...noiseTransaction, id: 'feature-noise-repeat' }).world,
  'same feature noise seed produces deterministic values',
);
assert.throws(() => applyWorldTransaction(multiFeatureWorld, {
  id: 'unknown-feature', actor: 'human', intent: 'feature-intervention',
  operations: [{ type: 'SET_FEATURE_VALUES', feature: 'not-a-column', values: [{ pointId: 'mf1', value: 1 }] }],
}), (error) => error.code === 'EXPLORATION_UNKNOWN_FEATURE', 'unknown feature edits are rejected explicitly');
assert.throws(() => applyWorldTransaction(multiFeatureWorld, {
  id: 'unknown-transform-feature', actor: 'human', intent: 'feature-intervention',
  operations: [{ type: 'TRANSFORM_FEATURE_VALUES', feature: 'not-a-column', kind: 'shift', amount: 1, pointIds: ['mf1'] }],
}), (error) => error.code === 'EXPLORATION_UNKNOWN_FEATURE', 'unknown feature transforms are rejected explicitly');

const classificationProjectionWorld = createWorld({
  id: 'classification-projection-world', task: 'classification', featureNames: ['x1', 'x2'],
  metadata: { modelFeature: 'x1', targetFeature: 'x2', targetColumn: 'label' },
  observations: [
    { id: 'c1', x: 0, y: 0, features: { x1: 0, x2: 0 }, label: 'left' },
    { id: 'c2', x: 1, y: 1, features: { x1: 1, x2: 1 }, label: 'right' },
  ],
});
assert.equal(canCreateObservationFromProjection(classificationProjectionWorld, 'x1', 'x2'), false, 'classification projections cannot create unlabeled observations');
assert.equal(observationFromProjection(classificationProjectionWorld, { xFeature: 'x1', yFeature: 'x2', x: 0.5, y: 0.5 }), null, 'classification projection creation never fabricates a label');

const phase11Host = createPlaygroundHost({ getDataset: () => null });
await phase11Host.open({ playgroundId: 'linear-regression', seed: 404 });
const phase11Initial = phase11Host.getState();
const ids = phase11Initial.world.observations.map((point) => point.id);
assert.ok(ids.length > 2, 'default LR World has enough observations for a split');
assert.equal(ids.length, teachingDatasetById('linear-trend').dataset.rows.length, 'default LR uses the registered linear-trend teaching dataset');
assert.ok(phase11Initial.world.observations.every((point) => point.membership === 'unspecified'));
const editedBeforeRun = await phase11Host.dispatch({ type: 'ADD_POINT', x: 50, y: 50 });
const editedPointCount = editedBeforeRun.world.observations.length;
const runOnCurrentWorld = await phase11Host.dispatch({ type: 'RUN' });
assert.equal(runOnCurrentWorld.world.observations.length, editedPointCount, 'Run trains on the current World without restoring edits');
const resetLearningOnly = await phase11Host.dispatch({ type: 'RESET_LEARNING' });
assert.equal(resetLearningOnly.world.observations.length, editedPointCount, 'Reset learning preserves learner data edits');
const restoredOriginal = await phase11Host.dispatch({ type: 'RESTORE_ORIGINAL_DATA' });
assert.equal(restoredOriginal.world.observations.length, phase11Initial.world.observations.length, 'Restore original data is the explicit destructive action');
const testIds = ids.slice(-2);
const splitSnapshot = await phase11Host.dispatch({
  type: 'SET_TRAIN_TEST_MEMBERSHIP', pointIds: testIds, membership: 'test',
});
assert.equal(splitSnapshot.actionHistory.past.length, 1, 'one compatibility split action is one undoable canonical action');
assert.equal(splitSnapshot.world.observations.filter((point) => point.membership === 'train').length, ids.length - 2);
assert.equal(splitSnapshot.world.observations.filter((point) => point.membership === 'test').length, 2);
assert.equal(splitSnapshot.world.observations.filter((point) => point.membership === 'unspecified').length, 0);
assert.equal(splitSnapshot.actionHistory.past[0].mutationSummary.normalizedUnspecifiedToTrain, ids.length - 2, 'first split normalization is inspectable');
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
    operations: [
      { type: 'MOVE_POINT', pointId: testIds[0], x: 999, y: -999 },
      { type: 'MOVE_POINT', pointId: testIds[1], x: 1000, y: -1000 },
    ],
  },
});
assert.deepEqual({
  weight: movedTest.scene.bestFitLine.weight,
  bias: movedTest.scene.bestFitLine.bias,
}, fitBeforeTestMove, 'moving only a test point cannot change the train-only best-fit parameters');
assert.notEqual(movedTest.metrics.testMse, splitSnapshot.metrics.testMse, 'moving a test point changes test evidence');
assert.deepEqual(compareExperiments(splitSnapshot.experiment, movedTest.experiment).changed, ['world'], 'moving test points changes World values but not split assignment');
const membershipEdited = await phase11Host.dispatch({
  type: 'SET_TRAIN_TEST_MEMBERSHIP', pointIds: [ids[0]], membership: 'test',
});
const membershipOnlyDiff = compareExperiments(movedTest.experiment, membershipEdited.experiment);
assert.deepEqual(membershipOnlyDiff.changed, ['trainTest']);
assert.equal(membershipOnlyDiff.clarity, 'high');
const afterMembershipUndo = await phase11Host.dispatch({ type: 'UNDO_WORLD_ACTION' });
assert.deepEqual(afterMembershipUndo.world, movedTest.world, 'Undo restores the exact World before one membership action');
assert.equal(afterMembershipUndo.actionHistory.future.length, 1, 'one human-level membership action is redoable');
const afterUndo = await phase11Host.dispatch({ type: 'UNDO_WORLD_ACTION' });
assert.deepEqual(afterUndo.world, splitSnapshot.world, 'second Undo restores the World before the grouped test-point move');
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
assert.deepEqual(phase11Host.getState(), beforeInvalidSplit, 'invalid split leaves World, model-derived state, history, and Experiment unchanged');
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
assert.deepEqual(resetScript.world, editedInScript.world, 'SCRIPT_RESET preserves the current learner-edited World');
assert.deepEqual(resetScript.actionHistory, editedInScript.actionHistory, 'SCRIPT_RESET preserves World history');
assert.notDeepEqual(resetScript.world, beforeScriptEdit.world, 'SCRIPT_RESET does not jump to the open-time session baseline');
await scriptHistoryHost.close();

const playbackHost = createPlaygroundHost({ getDataset: () => null });
await playbackHost.open({ playgroundId: 'linear-regression', seed: 515 });
await playbackHost.loadPreset({ presetId: 'linear-regression.intuition' });
await playbackHost.dispatch({ type: 'SCRIPT_RESET' });
await playbackHost.dispatch({ type: 'SCRIPT_PLAY' });
const revealSnapshots = [];
let playbackState = playbackHost.getState();
let playbackGuard = 0;
while (playbackGuard < 20) {
  const playbackAction = getPlaybackAction(playbackState);
  if (!playbackAction) break;
  playbackState = await playbackHost.dispatch(playbackAction);
  if ([4, 5, 6].includes(playbackState.scriptState.step)) {
    revealSnapshots.push({
      currentStep: playbackState.scene.training.currentStep,
      weight: playbackState.scene.line.weight,
      bias: playbackState.scene.line.bias,
    });
  }
  playbackGuard += 1;
}
assert.equal(playbackState.scriptState.status, 'completed', 'automatic script playback reaches the final explanation step');
assert.deepEqual(revealSnapshots.map((snapshot) => snapshot.currentStep), [7, 14, 20], 'LR reveal playback samples the declared training timeline');
assert.ok(new Set(revealSnapshots.map((snapshot) => `${snapshot.weight}:${snapshot.bias}`)).size > 1, 'LR playback changes fitted parameters across reveal steps');
assert.equal(getPlaybackAction(playbackState), null, 'completed script playback has no pending scheduler action');
await playbackHost.close();

const dataLabDataset = {
  name: 'Data Lab multi-feature regression',
  task: 'regression',
  featureColumns: ['area', 'age'],
  targetColumn: 'price',
  columns: [
    { name: 'area', type: 'number' },
    { name: 'age', type: 'number' },
    { name: 'price', type: 'number' },
  ],
  rows: [
    { area: 10, age: 4, price: 100 },
    { area: 20, age: 8, price: 200 },
    { area: 30, age: 12, price: 300 },
    { area: 40, age: 16, price: 400 },
  ],
};
const dataLabHost = createPlaygroundHost({ getDataset: () => dataLabDataset });
const baselineModelHost = createPlaygroundHost({ getDataset: () => dataLabDataset });
await dataLabHost.open({ playgroundId: 'data-lab', seed: 808 });
await baselineModelHost.open({ playgroundId: 'data-lab', seed: 808 });
const dataLabInitial = dataLabHost.getState();
assert.equal(dataLabInitial.model, null, 'Data Lab opens without an attached model');
assert.deepEqual(dataLabInitial.world.featureNames, ['area', 'age', 'price'], 'Data Lab preserves all declared numeric features and target');
const ageEdit = await dataLabHost.dispatch({
  type: 'APPLY_WORLD_TRANSACTION',
  transaction: {
    id: 'data-lab-age-edit', actor: 'human', intent: 'feature-intervention',
    operations: [{ type: 'TRANSFORM_FEATURE_VALUES', feature: 'age', kind: 'shift', amount: 5, pointIds: ['d0', 'd1', 'd2', 'd3'] }],
  },
});
assert.equal(ageEdit.world.observations[0].features.age, 9, 'Data Lab edits the selected named feature');
const ageEditedWorld = structuredClone(ageEdit.world);
const baselineAttached = await baselineModelHost.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: 'linear-regression' });
const editedAttached = await dataLabHost.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: 'linear-regression' });
assert.deepEqual(editedAttached.world, ageEditedWorld, 'attaching a model preserves the edited World exactly');
assert.deepEqual(
  { weight: editedAttached.scene.bestFitLine.weight, bias: editedAttached.scene.bestFitLine.bias },
  { weight: baselineAttached.scene.bestFitLine.weight, bias: baselineAttached.scene.bestFitLine.bias },
  'changing an unrelated feature does not change the selected linear model projection',
);
const modelOnlyHost = createPlaygroundHost({ getDataset: () => null });
await modelOnlyHost.open({ playgroundId: 'linear-regression', seed: 516 });
const modelTrainingStarted = await modelOnlyHost.dispatch({ type: 'START_TRAINING' });
assert.ok(modelTrainingStarted.timeline.totalSteps > 0, 'model-only playback prepares a finite model timeline');
const modelPlaying = await modelOnlyHost.dispatch({ type: 'PLAY' });
assert.equal(getPlaybackAction(modelPlaying)?.type, 'STEP', 'model-only playback uses the shared scheduler fallback');
const modelStep = await modelOnlyHost.dispatch(getPlaybackAction(modelPlaying));
assert.ok(modelStep.timeline.step > modelPlaying.timeline.step, 'model-only playback advances after Play');
await modelOnlyHost.close();
await dataLabHost.close();
await baselineModelHost.close();

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
const parityContext = agentParityApi.inspectContext();
assert.deepEqual(parityContext.exploration.worldOperations, registeredWorldOperations, 'Agent capability inspection derives from the World registry');
assert.equal(parityContext.exploration.worldOperations.some((operation) => operation.type.startsWith('RESTORE_')), false);
assert.deepEqual(
  parityContext.exploration.operations.slice(0, registeredWorldOperations.length),
  registeredWorldOperations.map((operation) => operation.type),
  'the compatibility capability list is derived from registry order',
);
await agentParityApi.close();

const manualMembershipHost = createPlaygroundHost({ getDataset: () => null });
const agentMembershipHost = createPlaygroundHost({ getDataset: () => null });
const agentMembershipApi = createPlaygroundAgentApi(agentMembershipHost);
await manualMembershipHost.open({ playgroundId: 'linear-regression', seed: 616 });
await agentMembershipApi.open({ playgroundId: 'linear-regression', seed: 616 });
const membershipPointId = manualMembershipHost.getState().world.observations.at(-1).id;
const manualMembership = await manualMembershipHost.dispatch({
  type: 'SET_TRAIN_TEST_MEMBERSHIP', pointIds: [membershipPointId], membership: 'test',
});
const agentMembership = await agentMembershipApi.dispatch({
  type: 'SET_TRAIN_TEST_MEMBERSHIP', pointIds: [membershipPointId], membership: 'test',
});
assert.deepEqual(manualMembership.world, agentMembership.world, 'human and Agent membership edits produce identical World semantics');
assert.equal(manualMembership.actionHistory.past.at(-1).actor, 'human');
assert.equal(agentMembership.actionHistory.past.at(-1).actor, 'agent');
assert.equal(manualMembership.actionHistory.past.at(-1).mutationSummary.types[0], 'world.setTrainTestMembership');
assert.equal(agentMembership.actionHistory.past.at(-1).mutationSummary.types[0], 'world.setTrainTestMembership');
await manualMembershipHost.close();
await agentMembershipApi.close();

const legacyHost = createPlaygroundHost({ getDataset: () => null });
const canonicalHost = createPlaygroundHost({ getDataset: () => null });
await legacyHost.open({ playgroundId: 'linear-regression', seed: 707 });
await canonicalHost.open({ playgroundId: 'linear-regression', seed: 707 });
const legacyAdded = await legacyHost.dispatch({ type: 'ADD_POINT', x: 4, y: 5 });
const addedPoint = legacyAdded.world.observations.at(-1);
const canonicalAdded = await canonicalHost.dispatch({
  type: 'APPLY_WORLD_TRANSACTION',
  transaction: {
    id: 'canonical-add', actor: 'human', intent: 'point',
    operations: [{ type: 'ADD_POINTS', points: [addedPoint] }],
  },
});
assert.deepEqual(legacyAdded.world, canonicalAdded.world, 'legacy ADD_POINT and canonical ADD_POINTS produce equivalent Worlds');
assert.equal(legacyAdded.actionHistory.past.length, 1);
const legacyMoved = await legacyHost.dispatch({ type: 'MOVE_POINT', pointId: addedPoint.id, x: 6, y: 7 });
const canonicalMoved = await canonicalHost.dispatch({ type: 'MOVE_POINT', pointId: addedPoint.id, x: 6, y: 7 });
assert.deepEqual(legacyMoved.world, canonicalMoved.world, 'legacy-compatible MOVE_POINT uses the canonical transaction path');
const legacyRemoved = await legacyHost.dispatch({ type: 'REMOVE_POINT', pointId: addedPoint.id });
const canonicalRemoved = await canonicalHost.dispatch({ type: 'REMOVE_POINT', pointId: addedPoint.id });
assert.deepEqual(legacyRemoved.world, canonicalRemoved.world, 'legacy-compatible REMOVE_POINT uses the canonical transaction path');
assert.equal(legacyRemoved.actionHistory.past.length, 3, 'add, move, and remove remain three human-level actions');
await legacyHost.close();
await canonicalHost.close();

const runtimeSource = readFileSync(new URL('../src/core/playground/playgroundRuntime.js', import.meta.url), 'utf8');
const operationSource = readFileSync(new URL('../src/core/exploration/operations.js', import.meta.url), 'utf8');
const gestureSource = readFileSync(new URL('../src/core/exploration/gestures.js', import.meta.url), 'utf8');
const registrySource = readFileSync(new URL('../src/core/exploration/operationRegistry.js', import.meta.url), 'utf8');
for (const sourceText of [runtimeSource, operationSource, gestureSource, registrySource]) {
  assert.doesNotMatch(sourceText, /knn|mlp|linear-regression/, 'World transaction and gesture layers contain no model-specific branches');
}

console.log('Exploration semantic checks passed: canonical registered World operations, legacy and Agent parity, grouped Undo/Redo, explicit split semantics, orthogonal comparison, and view isolation.');
