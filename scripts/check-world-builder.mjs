import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createWorld, deserializeWorld, serializeWorld } from '../src/core/exploration/world.js';
import { applyWorldTransaction } from '../src/core/exploration/operations.js';
import { compareExperiments } from '../src/core/exploration/comparison.js';
import { createExperiment } from '../src/core/exploration/experiment.js';
import { generateObservations, normalizeGeneratorSpec, MAX_GENERATOR_SAMPLES } from '../src/core/exploration/generator.js';
import { listWorldOperations } from '../src/core/exploration/operationRegistry.js';

const spec = normalizeGeneratorSpec({
  input: { type: 'uniform', params: { min: -2, max: 2 } },
  relation: { slope: 2, bias: 1 },
  noise: { amount: 0.5 },
  train: { samples: 40 },
  test: { samples: 0 },
  outliers: { count: 2 },
});
const first = generateObservations(spec, 42);
const second = generateObservations(spec, 42);
assert.deepEqual(first.observations, second.observations, 'same generator spec and seed reproduce the exact observations');
assert.notDeepEqual(first.observations, generateObservations(spec, 43).observations, 'a changed seed creates a new realization');
assert.equal(first.observations.filter((point) => point.provenance === 'generated-outlier').length, 2, 'outlier provenance is explicit');
assert.throws(() => normalizeGeneratorSpec({ ...spec, train: { samples: MAX_GENERATOR_SAMPLES + 1 } }), /EXPLORATION_RESOURCE_LIMIT/);

const sourceWorld = createWorld({
  id: 'phase3-world',
  task: 'regression',
  featureNames: ['x', 'y'],
  observations: [
    { id: 'source-1', x: 0, y: 1, membership: 'train' },
    { id: 'source-2', x: 1, y: 3, membership: 'train' },
  ],
});
const generated = applyWorldTransaction(sourceWorld, {
  id: 'phase3-generate', actor: 'human', intent: 'regenerate-world',
  operations: [{ type: 'SET_WORLD_GENERATOR', spec }, { type: 'REGENERATE_WORLD', seed: 42 }],
}).world;
assert.equal(generated.mode, 'generated');
assert.equal(generated.generator.status, 'clean');
assert.equal(generated.observations.length, 40);
assert.deepEqual(deserializeWorld(serializeWorld(generated)), generated, 'generator metadata serializes with the World');

const changedInput = applyWorldTransaction(generated, {
  id: 'phase3-change-input', actor: 'human', intent: 'set-generator-parameter',
  operations: [{ type: 'SET_GENERATOR_PARAMETER', path: 'train.input.type', value: 'two-cluster' }],
}).world;
assert.equal(changedInput.generator.status, 'dirty');
const regenerated = applyWorldTransaction(changedInput, {
  id: 'phase3-regenerate-input', actor: 'human', intent: 'regenerate-world',
  operations: [{ type: 'REGENERATE_WORLD', seed: 42 }],
}).world;
assert.equal(regenerated.generator.status, 'clean');
assert.notDeepEqual(regenerated.observations, generated.observations, 'changing the input primitive changes the realization');
const undoneGeneratorChange = applyWorldTransaction(regenerated, {
  id: 'phase3-undo-input', actor: 'system', intent: 'undo:set-generator-parameter',
  operations: [{ type: 'RESTORE_WORLD', world: generated }],
}).world;
assert.deepEqual(undoneGeneratorChange, generated, 'generator operation inverse restores the exact prior World');
const modified = applyWorldTransaction(regenerated, {
  id: 'phase3-manual-edit', actor: 'human', intent: 'move',
  operations: [{ type: 'MOVE_POINT', pointId: regenerated.observations[0].id, x: 8, y: 8 }],
}).world;
assert.equal(modified.mode, 'generated');
assert.equal(modified.generator.status, 'modified');
assert.equal(modified.observations[0].provenance, 'manual');
const frozen = applyWorldTransaction(modified, {
  id: 'phase3-freeze', actor: 'human', intent: 'freeze-as-samples',
  operations: [{ type: 'FREEZE_AS_SAMPLES' }],
}).world;
assert.equal(frozen.mode, 'sample');
assert.equal(frozen.generator.active, false);
assert.equal(frozen.observations[0].provenance, 'manual');

const a = createExperiment({ id: 'A', world: generated, adapterId: 'linear-regression', seed: 42 });
const b = createExperiment({ id: 'B', world: regenerated, adapterId: 'linear-regression', seed: 42 });
const diff = compareExperiments(a, b);
assert.deepEqual(diff.changed, ['world']);
assert.deepEqual(diff.details.worldGenerator.changed, ['inputDistribution']);
assert.ok(diff.details.worldGenerator.unchanged.includes('linearRelation'));
assert.ok(diff.details.worldGenerator.unchanged.includes('noise'));
assert.ok(diff.details.worldGenerator.unchanged.includes('sampleCount'));

const operationTypes = listWorldOperations().map((operation) => operation.type);
assert.ok(operationTypes.includes('SET_WORLD_GENERATOR'));
assert.ok(operationTypes.includes('REGENERATE_WORLD'));
assert.ok(operationTypes.includes('FREEZE_AS_SAMPLES'));

const host = createPlaygroundHost({ getDataset: () => null });
await host.open({ playgroundId: 'data-lab', seed: 42 });
await host.dispatch({ type: 'SET_WORLD_GENERATOR', spec });
const agentRegenerated = await host.dispatch({ type: 'REGENERATE_WORLD', seed: 42 });
assert.deepEqual(agentRegenerated.world.observations, generated.observations, 'direct Agent operation uses the same domain generator as the UI');
assert.equal(host.inspectContext().world.generator.spec.relation.slope, 2, 'Agent inspection sees generator parameters');
assert.ok(host.inspectContext().exploration.operations.includes('REGENERATE_WORLD'), 'Agent inspection sees generator capabilities');
await host.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: 'linear-regression' });
const runPreservesGenerator = await host.dispatch({ type: 'RUN' });
assert.equal(runPreservesGenerator.world.mode, 'generated', 'model run preserves Generated World semantics and provenance');
assert.equal(runPreservesGenerator.world.generator.status, 'clean', 'model run does not dirty the generator');
await host.close();

console.log('World Builder checks passed: deterministic generation, bounded resources, explicit provenance, generator edits, train/test-ready schema, freeze semantics, comparison detail, serialization, and UI/Agent operation parity.');
