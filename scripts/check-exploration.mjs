import assert from 'node:assert/strict';
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
import { compareExperiments } from '../src/core/exploration/comparison.js';
import { applyExperimentOperation } from '../src/core/exploration/operations.js';
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

console.log('Exploration semantic checks passed: World/Experiment duplication, serialization, comparison, deterministic seed policy, runtime sync, and Agent inspection.');
