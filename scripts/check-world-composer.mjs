import assert from 'node:assert/strict';
import { applyWorldTransaction } from '../src/core/exploration/operations.js';
import { compareExperiments } from '../src/core/exploration/comparison.js';
import { createExperiment } from '../src/core/exploration/experiment.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createWorld, deriveWorldGeneratorFacts } from '../src/core/exploration/world.js';
import {
  applyWorldRecipePatch,
  normalizeWorldRecipe,
  worldRecipeDiff,
  worldRecipeJsonSchema,
  worldRecipeSummary,
  WORLD_RECIPE_SHAPE_TYPES,
} from '../src/core/exploration/worldRecipe.js';
import { materializeWorldRecipe } from '../src/core/exploration/worldMaterializer.js';
import { getWorldRecipePreset, listWorldRecipePresets } from '../src/core/exploration/worldRecipePresets.js';
import { listWorldOperations } from '../src/core/exploration/operationRegistry.js';

const noise = () => ({
  train: { position: { amount: 0 }, label: { probability: 0, policy: 'flip' }, outliers: { fraction: 0, placement: 'radial', distance: 2 }, local: [] },
  test: { position: { amount: 0 }, label: { probability: 0, policy: 'flip' }, outliers: { fraction: 0, placement: 'radial', distance: 2 }, local: [] },
});

const group = (id, label, shape, translate = [0, 0]) => ({
  id,
  label,
  shape,
  transform: { translate, rotate: 0, scale: [1, 1] },
  splitTransforms: { train: null, test: null },
  sampling: { train: { count: 12, density: { type: 'uniform' } }, test: { count: 6, density: { type: 'uniform' } } },
});

const recipe = (shapeA = { type: 'blob', params: { radius: 0.5, aspect: [1, 1] } }) => normalizeWorldRecipe({
  version: 1,
  task: 'classification',
  coordinateSpace: 'cartesian-2d',
  groups: [
    group('class-a', '0', shapeA, [-0.8, 0]),
    group('class-b', '1', { type: 'blob', params: { radius: 0.5, aspect: [1, 1] } }, [0.8, 0]),
  ],
  noise: noise(),
});

assert.deepEqual(Object.keys(worldRecipeJsonSchema()).sort(), ['additionalProperties', 'properties', 'required', 'type']);
assert.ok(listWorldOperations().some((operation) => operation.type === 'SET_WORLD_RECIPE'));
assert.ok(listWorldOperations().some((operation) => operation.type === 'PATCH_WORLD_RECIPE'));

for (const shapeType of WORLD_RECIPE_SHAPE_TYPES) {
  const shapes = {
    blob: { type: 'blob', params: { radius: 1, aspect: [1, 1] } },
    line: { type: 'line', params: { start: [-1, -1], end: [1, 1], thickness: 0.1 } },
    arc: { type: 'arc', params: { radius: 1, startAngle: 0, endAngle: Math.PI, thickness: 0.1 } },
    ring: { type: 'ring', params: { radius: 1, thickness: 0.1 } },
    moon: { type: 'moon', params: { outerRadius: 1, innerRadius: 0.7, innerOffset: [0.3, 0], thickness: 0.1 } },
    spiral: { type: 'spiral', params: { turns: 1.5, radius: 1, startRadius: 0.1, thickness: 0.1 } },
    rectangle: { type: 'rectangle', params: { width: 1, height: 1, fill: true, thickness: 0.1 } },
    ellipse: { type: 'ellipse', params: { radii: [1, 0.5], fill: true, thickness: 0.1 } },
    polygon: { type: 'polygon', params: { points: [[-1, -1], [1, -1], [0, 1]], fill: true, thickness: 0.1 } },
    polyline: { type: 'polyline', params: { points: [[-1, 1], [0, -1], [1, 1]], thickness: 0.1 } },
  };
  const materialized = materializeWorldRecipe(recipe(shapes[shapeType]), 42);
  assert.equal(materialized.observations.length, 36, `${shapeType}: sample count`);
  assert.ok(materialized.observations.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)), `${shapeType}: finite points`);
  assert.ok(materialized.observations.every((point) => ['class-a', 'class-b'].includes(point.generation.groupId)), `${shapeType}: generation provenance`);
}

const base = recipe();
const first = materializeWorldRecipe(base, 42, { worldId: 'composer-test' });
const second = materializeWorldRecipe(base, 42, { worldId: 'composer-test' });
assert.deepEqual(first.observations, second.observations, 'same recipe and seed are exactly deterministic');
assert.notDeepEqual(first.observations, materializeWorldRecipe(base, 43, { worldId: 'composer-test' }).observations, 'different seed creates a different realization');

const movedB = applyWorldRecipePatch(base, { version: 1, changes: [{ type: 'TRANSLATE_GROUP', groupId: 'class-b', delta: [0.7, 0] }] });
const movedMaterialized = materializeWorldRecipe(movedB, 42, { worldId: 'composer-test' });
assert.deepEqual(
  movedMaterialized.observations.filter((point) => point.generation.groupId === 'class-a'),
  first.observations.filter((point) => point.generation.groupId === 'class-a'),
  'group-scoped substreams keep unchanged group realizations stable',
);
assert.equal(worldRecipeDiff(base, movedB).affectedGroupIds[0], 'class-b');
assert.equal(worldRecipeSummary(base).groupCount, 2);

const noisy = normalizeWorldRecipe({ ...base, noise: { train: { ...noise().train, position: { amount: 0.2 }, label: { probability: 0.2, policy: 'flip' }, outliers: { fraction: 0.1, placement: 'radial', distance: 2.5 }, local: [{ kind: 'label', probability: 0.2, region: { type: 'bbox', min: [-1, -1], max: [1, 1] } }] }, test: noise().test } });
const noisyPoints = materializeWorldRecipe(noisy, 42).observations;
assert.ok(noisyPoints.some((point) => point.generation.positionNoiseApplied));
assert.ok(noisyPoints.some((point) => point.generation.anomaly === 'outlier'));
assert.ok(noisyPoints.every((point) => point.generation.recipeVersion === 1));

assert.throws(() => normalizeWorldRecipe({ ...base, groups: [{ ...base.groups[0], shape: { type: 'unknown', params: {} } }, base.groups[1]] }), /EXPLORATION_INVALID_WORLD_RECIPE/);
assert.throws(() => normalizeWorldRecipe({ ...base, groups: [{ ...base.groups[0], transform: { ...base.groups[0].transform, scale: [NaN, 1] } }, base.groups[1]] }), /EXPLORATION_INVALID_WORLD_RECIPE/);
assert.throws(() => applyWorldRecipePatch(base, { version: 1, changes: [{ type: 'INVENTED', groupId: 'class-a' }] }), /EXPLORATION_INVALID_WORLD_RECIPE_PATCH/);
assert.throws(() => normalizeWorldRecipe({ ...base, groups: Array.from({ length: 17 }, (_, index) => group(`g-${index}`, String(index), base.groups[0].shape)) }), /EXPLORATION_RESOURCE_LIMIT/);

const sampleWorld = createWorld({ task: 'classification', observations: [
  { id: 'manual-a', x: 0, y: 0, label: '0', membership: 'train', provenance: 'manual' },
  { id: 'manual-b', x: 1, y: 1, label: '1', membership: 'train', provenance: 'manual' },
] });
const configured = applyWorldTransaction(sampleWorld, { id: 'recipe-configure', actor: 'human', intent: 'world-design', operations: [{ type: 'SET_WORLD_RECIPE', recipe: base, seed: 42 }] }).world;
assert.equal(configured.generator.kind, 'world-recipe');
assert.equal(configured.mode, 'sample');
const generated = applyWorldTransaction(configured, { id: 'recipe-generate', actor: 'human', intent: 'regenerate-world', operations: [{ type: 'REGENERATE_WORLD' }] }).world;
assert.equal(generated.mode, 'generated');
assert.equal(generated.generator.status, 'clean');
assert.equal(generated.generator.realization.recipe.version, 1);
const changed = applyWorldTransaction(generated, { id: 'recipe-patch', actor: 'human', intent: 'world-design', operations: [{ type: 'PATCH_WORLD_RECIPE', patch: { version: 1, changes: [{ type: 'SET_GROUP_SAMPLE_COUNT', groupId: 'class-a', split: 'train', count: 20 }] } }] }).world;
assert.equal(changed.generator.status, 'dirty');
assert.equal(changed.observations.length, generated.observations.length, 'recipe edits keep realization until explicit regenerate');
const regenerated = applyWorldTransaction(changed, { id: 'recipe-regenerate', actor: 'human', intent: 'regenerate-world', operations: [{ type: 'REGENERATE_WORLD' }] }).world;
assert.equal(regenerated.observations.length, 44);
assert.ok(deriveWorldGeneratorFacts(regenerated).needsRegeneration === false);
const frozen = applyWorldTransaction(regenerated, { id: 'recipe-freeze', actor: 'human', intent: 'freeze', operations: [{ type: 'FREEZE_AS_SAMPLES' }] }).world;
assert.equal(frozen.mode, 'sample');

const makeExperiment = (id, world) => createExperiment({ id, world, adapterId: 'linear-regression', model: { adapterId: 'linear-regression', controls: {} }, learning: { controls: {} }, evaluation: { controls: {} } });
const recipeDiff = compareExperiments(makeExperiment('recipe-a', generated), makeExperiment('recipe-b', regenerated));
assert.ok(recipeDiff.details.worldRecipe.changedPaths.some((path) => path.includes('class-a')));

const host = createPlaygroundHost({ getDataset: () => null });
await host.open({ playgroundId: 'data-lab', seed: 42 });
await host.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: 'linear-regression' });
const proposal = host.proposeExploration({ request: 'Create a ring world', worldDesign: { mode: 'create', recipe: getWorldRecipePreset('rings'), patch: null, requestedHolds: [] } });
assert.equal(proposal.kind, 'proposal');
assert.equal(proposal.assessment.fidelity.status, 'exact');
assert.equal(host.getState().experimentWorkspace.experiments.length, 1, 'world design proposal does not mutate before execution');
const result = await host.executeExploration({ scenario: proposal.scenario });
assert.equal(result.snapshot.experiment.world.generator.kind, 'world-recipe');
assert.equal(result.snapshot.experiment.world.observations.length, 280);
assert.equal(result.fidelity.status, 'exact');
await host.dispatch({ type: 'REPEAT_EXPERIMENT', trials: 2 });
assert.equal(host.getState().repeatEvidence?.trials?.length, 2, 'recipe Worlds use the normal Repeat lifecycle');
const editProposal = host.proposeExploration({ request: 'Move class B right', worldDesign: { mode: 'edit', recipe: null, patch: { version: 1, changes: [{ type: 'TRANSLATE_GROUP', groupId: 'inner-blob', delta: [0.7, 0] }] }, requestedHolds: ['model-configuration'] } });
assert.equal(editProposal.kind, 'proposal');
assert.equal(editProposal.assessment.fidelity.status, 'exact');

assert.deepEqual(listWorldRecipePresets().map((entry) => entry.id), ['rings', 'moons', 'xor', 'checkerboard']);
console.log('World Composer checks passed: canonical recipe validation, primitive/preset materialization, deterministic substreams, noise/provenance, atomic lifecycle, comparison, fidelity, Agent proposal, and legacy compatibility.');
