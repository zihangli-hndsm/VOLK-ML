import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createWorld, deserializeWorld, serializeWorld } from '../src/core/exploration/world.js';
import { applyWorldTransaction } from '../src/core/exploration/operations.js';
import { compareExperiments } from '../src/core/exploration/comparison.js';
import { createExperiment } from '../src/core/exploration/experiment.js';
import { generateObservations, normalizeGeneratorSpec, MAX_GENERATOR_SAMPLES } from '../src/core/exploration/generator.js';
import { listWorldOperations } from '../src/core/exploration/operationRegistry.js';

const input = (type) => type === 'uniform'
  ? { type, params: { min: -1, max: 1 } }
  : type === 'gaussian'
    ? { type, params: { mean: 0, spread: 0.8 } }
    : { type, params: { centerA: -1.5, centerB: 1.5, spread: 0.25 } };

const specFor = (type = 'uniform') => normalizeGeneratorSpec({
  relation: { slope: 2, bias: 1 },
  noise: { amount: 0.5 },
  train: { input: input(type), samples: 40 },
  test: { input: input(type), samples: 20 },
  outliers: { count: 2 },
});

for (const type of ['uniform', 'gaussian', 'two-cluster']) {
  const spec = specFor(type);
  const first = generateObservations(spec, 42);
  const second = generateObservations(spec, 42);
  assert.deepEqual(first.observations, second.observations, `${type}: same spec and seed reproduce exact observations`);
  assert.notDeepEqual(first.observations, generateObservations(spec, 43).observations, `${type}: changed seed creates a new realization`);
  assert.equal(first.observations.length, 60, `${type}: bounded train/test sample count`);
  assert.equal(first.observations.filter((point) => point.membership === 'train').length, 40, `${type}: explicit train membership`);
  assert.equal(first.observations.filter((point) => point.membership === 'test').length, 20, `${type}: explicit test membership`);
  assert.equal(first.observations.filter((point) => point.provenance === 'generated-outlier').length, 2, `${type}: explicit outlier provenance`);
  assert.ok(first.observations.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)), `${type}: finite output`);
}

const uniformSpec = specFor('uniform');
assert.deepEqual(Object.keys(uniformSpec).sort(), ['noise', 'outliers', 'relation', 'test', 'train', 'version'], 'normalized schema has no duplicate input/sampling sources of truth');
assert.equal(uniformSpec.train.input.params.min, -1);
assert.throws(() => normalizeGeneratorSpec({ ...uniformSpec, train: { samples: MAX_GENERATOR_SAMPLES + 1 } }), /EXPLORATION_RESOURCE_LIMIT/);

const sourceWorld = createWorld({
  id: 'phase3-world',
  task: 'regression',
  featureNames: ['x', 'y'],
  observations: [
    { id: 'source-1', x: 0, y: 1, membership: 'train' },
    { id: 'source-2', x: 1, y: 3, membership: 'train' },
  ],
});

const configured = applyWorldTransaction(sourceWorld, {
  id: 'phase3-configure', actor: 'human', intent: 'configure-generator',
  operations: [{ type: 'SET_WORLD_GENERATOR', spec: uniformSpec }],
}).world;
assert.equal(configured.mode, 'sample', 'configuring a Sample World does not relabel existing points');
assert.equal(configured.generator.active, false);
assert.equal(configured.generator.realization, null);
const generated = applyWorldTransaction(configured, {
  id: 'phase3-generate', actor: 'human', intent: 'regenerate-world',
  operations: [{ type: 'REGENERATE_WORLD', seed: 42 }],
}).world;
assert.equal(generated.mode, 'generated');
assert.equal(generated.generator.status, 'clean');
assert.equal(generated.generator.seed, 42);
assert.equal(generated.generator.realization.seed, 42);
assert.deepEqual(generated.generator.realization.spec, generated.generator.spec);
assert.equal(generated.observations.length, 60);
assert.deepEqual(deserializeWorld(serializeWorld(generated)), generated, 'realization metadata serializes with the World');

const originalObservations = structuredClone(generated.observations);
const originalRealization = structuredClone(generated.generator.realization);
const changedInput = applyWorldTransaction(generated, {
  id: 'phase3-change-input', actor: 'human', intent: 'set-generator-parameter',
  operations: [{ type: 'SET_GENERATOR_PARAMETER', path: 'train.input.type', value: 'two-cluster' }],
}).world;
assert.equal(changedInput.generator.status, 'dirty');
assert.deepEqual(changedInput.observations, originalObservations, 'desired spec edits preserve displayed observations');
assert.equal(changedInput.generator.spec.train.input.type, 'two-cluster');
assert.equal(changedInput.generator.realization.spec.train.input.type, 'uniform');
assert.deepEqual(changedInput.generator.realization, originalRealization, 'desired spec edits preserve realization metadata');

const regenerated = applyWorldTransaction(changedInput, {
  id: 'phase3-regenerate-input', actor: 'human', intent: 'regenerate-world',
  operations: [{ type: 'REGENERATE_WORLD', seed: 42 }],
}).world;
assert.equal(regenerated.generator.status, 'clean');
assert.equal(regenerated.generator.realization.spec.train.input.type, 'two-cluster');
assert.notDeepEqual(regenerated.observations, generated.observations, 'changed input primitive changes the realization');

const seedChanged = applyWorldTransaction(regenerated, {
  id: 'phase3-change-seed', actor: 'human', intent: 'set-generator-seed',
  operations: [{ type: 'SET_GENERATOR_SEED', seed: 43 }],
}).world;
assert.equal(seedChanged.randomness.seed, 43);
assert.equal(seedChanged.generator.seed, 43);
assert.equal(seedChanged.generator.realization.seed, 42, 'seed edit preserves old realization until regenerate');
assert.equal(seedChanged.generator.status, 'dirty');
assert.deepEqual(seedChanged.observations, regenerated.observations);
const seedRegenerated = applyWorldTransaction(seedChanged, {
  id: 'phase3-regenerate-seed', actor: 'human', intent: 'regenerate-world',
  operations: [{ type: 'REGENERATE_WORLD' }],
}).world;
assert.equal(seedRegenerated.randomness.seed, 43);
assert.equal(seedRegenerated.generator.realization.seed, 43);
assert.notDeepEqual(seedRegenerated.observations, regenerated.observations);

const modified = applyWorldTransaction(seedRegenerated, {
  id: 'phase3-manual-edit', actor: 'human', intent: 'move',
  operations: [{ type: 'MOVE_POINT', pointId: seedRegenerated.observations[0].id, x: 8, y: 8 }],
}).world;
assert.equal(modified.mode, 'generated');
assert.equal(modified.generator.status, 'modified');
assert.equal(modified.observations[0].provenance, 'manual');
assert.deepEqual(modified.observations[0].generation, seedRegenerated.observations[0].generation, 'manual move preserves original generation metadata');
const frozen = applyWorldTransaction(modified, {
  id: 'phase3-freeze', actor: 'human', intent: 'freeze-as-samples',
  operations: [{ type: 'FREEZE_AS_SAMPLES' }],
}).world;
assert.equal(frozen.mode, 'sample');
assert.equal(frozen.generator.active, false);
assert.deepEqual(frozen.observations, modified.observations, 'freeze preserves every current observation');
const frozenEdited = applyWorldTransaction(frozen, {
  id: 'phase3-edit-after-freeze', actor: 'human', intent: 'move',
  operations: [{ type: 'MOVE_POINT', pointId: frozen.observations[1].id, x: 9, y: 9 }],
}).world;
assert.equal(frozenEdited.observations[1].provenance, 'manual');
assert.ok(frozenEdited.observations[1].generation, 'historical generation metadata remains inspectable after freeze and edit');

const trainTestA = applyWorldTransaction(sourceWorld, {
  id: 'phase3-train-test-a', actor: 'human', intent: 'generate-world',
  operations: [{ type: 'SET_WORLD_GENERATOR', spec: normalizeGeneratorSpec({
    relation: uniformSpec.relation, noise: uniformSpec.noise,
    train: { input: input('uniform'), samples: 40 },
    test: { input: input('uniform'), samples: 20 }, outliers: { count: 0 },
  }) }, { type: 'REGENERATE_WORLD', seed: 42 }],
}).world;
const trainTestB = applyWorldTransaction(trainTestA, {
  id: 'phase3-train-test-b', actor: 'human', intent: 'set-test-support',
  operations: [
    { type: 'SET_GENERATOR_PARAMETER', path: 'test.input.params.min', value: 3 },
    { type: 'SET_GENERATOR_PARAMETER', path: 'test.input.params.max', value: 5 },
    { type: 'REGENERATE_WORLD', seed: 42 },
  ],
}).world;
const diff = compareExperiments(
  createExperiment({ id: 'A', world: trainTestA, adapterId: 'linear-regression', seed: 42 }),
  createExperiment({ id: 'B', world: trainTestB, adapterId: 'linear-regression', seed: 42 }),
);
assert.deepEqual(diff.changed, ['world']);
assert.deepEqual(diff.details.worldGenerator.changed, ['testInputDistribution']);
for (const key of ['trainInputDistribution', 'linearRelation', 'noise', 'sampleCount', 'outliers', 'seedPolicy']) {
  assert.ok(diff.details.worldGenerator.unchanged.includes(key), `comparison holds ${key}`);
}
assert.equal(diff.clarity, 'high');

const operationTypes = listWorldOperations().map((operation) => operation.type);
assert.ok(operationTypes.includes('SET_GENERATOR_PARAMETER'));
assert.ok(operationTypes.includes('REGENERATE_WORLD'));
assert.ok(operationTypes.includes('FREEZE_AS_SAMPLES'));

const host = createPlaygroundHost({ getDataset: () => null });
await host.open({ playgroundId: 'data-lab', seed: 42 });
let snapshot = await host.dispatch({ type: 'SET_WORLD_GENERATOR', spec: uniformSpec });
assert.equal(snapshot.seed, 42);
snapshot = await host.dispatch({ type: 'REGENERATE_WORLD', seed: 42 });
const seedLayers = () => [snapshot.seed, snapshot.world.randomness.seed, snapshot.experiment.randomness.seed, snapshot.world.generator.seed, snapshot.world.generator.realization.seed];
assert.deepEqual(seedLayers(), [42, 42, 42, 42, 42], 'session, World, Experiment, desired seed, and realization seed agree');
const generatedA = structuredClone(snapshot.world);
snapshot = await host.dispatch({ type: 'SET_GENERATOR_SEED', seed: 43 });
assert.deepEqual([snapshot.seed, snapshot.world.randomness.seed, snapshot.experiment.randomness.seed, snapshot.world.generator.seed], [43, 43, 43, 43]);
assert.equal(snapshot.world.generator.realization.seed, 42);
snapshot = await host.dispatch({ type: 'REGENERATE_WORLD' });
assert.deepEqual(seedLayers(), [43, 43, 43, 43, 43]);

await host.dispatch({ type: 'RESET' });
snapshot = await host.dispatch({ type: 'SET_WORLD_GENERATOR', spec: uniformSpec });
snapshot = await host.dispatch({ type: 'REGENERATE_WORLD', seed: 42 });
const aBeforeDuplicate = structuredClone(snapshot.world);
snapshot = await host.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
const aId = snapshot.experimentWorkspace.experiments.find((entry) => entry.id !== snapshot.experimentWorkspace.activeExperimentId).id;
const bId = snapshot.experimentWorkspace.activeExperimentId;
const duplicateBaseline = structuredClone(snapshot.world);
snapshot = await host.dispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction: {
  id: 'phase3-test-shift', actor: 'agent', intent: 'set-test-support',
  operations: [
    { type: 'SET_GENERATOR_PARAMETER', path: 'test.input.params.min', value: 3 },
    { type: 'SET_GENERATOR_PARAMETER', path: 'test.input.params.max', value: 5 },
  ],
} });
snapshot = await host.dispatch({ type: 'REGENERATE_WORLD' });
assert.equal(snapshot.world.generator.spec.test.input.params.min, 3);
assert.deepEqual(snapshot.world.generator.spec.train, duplicateBaseline.generator.spec.train);
snapshot = await host.dispatch({ type: 'RESET' });
assert.deepEqual(snapshot.world, duplicateBaseline, 'RESET restores duplication-time generator, realization, seed, and observations');
snapshot = await host.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: aId });
assert.ok(snapshot.world, 'A/B switching remains available after reset');
assert.deepEqual(snapshot.experimentWorkspace.experiments.length, 2);
assert.ok(snapshot.experimentWorkspace.comparison.bounds, 'A/B comparison retains a shared spatial frame');
snapshot = await host.dispatch({ type: 'SWITCH_EXPERIMENT', experimentId: aId });
assert.equal(snapshot.experimentWorkspace.activeExperimentId, aId);
snapshot = await host.dispatch({ type: 'SWITCH_EXPERIMENT', experimentId: bId });
assert.equal(snapshot.experimentWorkspace.activeExperimentId, bId);

const agentHost = createPlaygroundHost({ getDataset: () => null });
await agentHost.open({ playgroundId: 'data-lab', seed: 42 });
await agentHost.dispatch({ type: 'SET_WORLD_GENERATOR', spec: uniformSpec });
await agentHost.dispatch({ type: 'REGENERATE_WORLD', seed: 42 });
const agentChanged = await agentHost.dispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction: {
  id: 'agent-dirty-test-range', actor: 'agent', intent: 'set-test-support',
  operations: [
    { type: 'SET_GENERATOR_PARAMETER', path: 'test.input.params.min', value: 3 },
    { type: 'SET_GENERATOR_PARAMETER', path: 'test.input.params.max', value: 5 },
  ],
} });
assert.equal(agentChanged.world.generator.status, 'dirty');
assert.equal(agentChanged.world.generator.realization.spec.test.input.params.min, -1);
const inspected = agentHost.inspectContext();
assert.equal(inspected.exploration.worldMode, 'generated');
assert.equal(inspected.exploration.generator.status, 'dirty');
assert.ok(inspected.exploration.operations.includes('SET_GENERATOR_PARAMETER'));
const agentRegenerated = await agentHost.dispatch({ type: 'REGENERATE_WORLD', seed: 42 });
assert.deepEqual(agentRegenerated.world.generator.spec.test.input.params, { min: 3, max: 5 });
assert.equal(agentRegenerated.world.generator.realization.seed, 42);
await agentHost.close();

console.log('World Builder checks passed: canonical train/test schema, deterministic uniform/gaussian/two-cluster generation, seed authority, desired-vs-realized dirty semantics, provenance, freeze, comparison, reset, serialization, and Agent/UI parity.');
