import assert from 'node:assert/strict';
import { applyWorldTransaction } from '../src/core/exploration/operations.js';
import { compareExperiments } from '../src/core/exploration/comparison.js';
import { createExperiment } from '../src/core/exploration/experiment.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createWorld, deriveWorldGeneratorFacts } from '../src/core/exploration/world.js';
import { normalizeGeneratorSpec } from '../src/core/exploration/generator.js';
import {
  applyWorldRecipePatch,
  normalizeWorldRecipe,
  worldRecipeDiff,
  worldRecipeJsonSchema,
  worldRecipePatchJsonSchema,
  worldRecipePatchSemanticDomains,
  worldRecipePathSemanticDomain,
  worldRecipeSummary,
  WORLD_RECIPE_SHAPE_TYPES,
} from '../src/core/exploration/worldRecipe.js';
import { materializeWorldRecipe, applyWorldRecipeTransform } from '../src/core/exploration/worldMaterializer.js';
import { getWorldRecipePreset, listWorldRecipePresets } from '../src/core/exploration/worldRecipePresets.js';
import { listWorldOperations } from '../src/core/exploration/operationRegistry.js';
import { evaluateScenarioFidelity } from '../src/core/exploration/scenarioFidelity.js';

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
const patchSchema = worldRecipePatchJsonSchema();
assert.equal(patchSchema.additionalProperties, false);
assert.equal(patchSchema.properties.changes.items.anyOf.length, 8, 'all patch types have strict structured variants');
assert.ok(patchSchema.properties.changes.items.anyOf.some((variant) => variant.properties?.type?.const === 'TRANSLATE_GROUP'));
const samplingPatchSchema = patchSchema.properties.changes.items.anyOf.find((variant) => variant.properties?.type?.const === 'SET_GROUP_SAMPLING');
assert.deepEqual(samplingPatchSchema.properties.split.enum, ['train', 'test']);
assert.equal(worldRecipePathSemanticDomain('.groups.class-b.sampling.test.count'), 'group-sampling-count');
assert.equal(worldRecipePathSemanticDomain('.noise.train.position.amount'), 'train-position-noise');

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

function pointInPolygon(point, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [x, y] = points[index];
    const [previousX, previousY] = points[previous];
    if (((y > point.y) !== (previousY > point.y)) && point.x < ((previousX - x) * (point.y - y)) / (previousY - y) + x) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start[0]) * dx + (point.y - start[1]) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - (start[0] + amount * dx), point.y - (start[1] + amount * dy));
}

function pointsFor(shape, count = 120, density = { type: 'uniform' }) {
  const candidate = recipe(shape);
  candidate.groups[0].sampling.train.count = count;
  candidate.groups[0].sampling.train.density = density;
  candidate.groups[0].sampling.test.count = 0;
  candidate.groups[0] = { ...candidate.groups[0], transform: { translate: [0, 0], rotate: 0, scale: [1, 1] } };
  return materializeWorldRecipe(candidate, 71, { worldId: 'geometry-invariants' }).observations.filter((point) => point.generation.groupId === 'class-a' && point.membership === 'train');
}

const ringPoints = pointsFor({ type: 'ring', params: { radius: 1, thickness: 0.1 } });
assert.ok(ringPoints.every((point) => Math.abs(Math.hypot(point.x, point.y) - 1) <= 0.051), 'ring points remain within radial thickness');
const blobPoints = pointsFor({ type: 'blob', params: { radius: 1, aspect: [2, 0.5] } });
assert.ok(blobPoints.every((point) => (point.x * point.x) / 4 + 4 * (point.y * point.y) <= 1.001), 'blob points remain inside the configured ellipse');
const arcPoints = pointsFor({ type: 'arc', params: { radius: 1, startAngle: 0.25, endAngle: 1.75, thickness: 0.1 } });
assert.ok(arcPoints.every((point) => {
  const angle = Math.atan2(point.y, point.x);
  return angle >= 0.19 && angle <= 1.81;
}), 'arc points remain inside the requested angular range');
const linePoints = pointsFor({ type: 'line', params: { start: [-1, -1], end: [1, 1], thickness: 0.1 } });
assert.ok(linePoints.every((point) => distanceToSegment(point, [-1, -1], [1, 1]) <= 0.101), 'line points remain within band thickness');
const polylinePoints = pointsFor({ type: 'polyline', params: { points: [[-1, 1], [0, -1], [1, 1]], thickness: 0.1 } });
assert.ok(polylinePoints.every((point) => Math.min(distanceToSegment(point, [-1, 1], [0, -1]), distanceToSegment(point, [0, -1], [1, 1])) <= 0.101), 'polyline points remain within path thickness');
const spiralPoints = pointsFor({ type: 'spiral', params: { turns: 2, radius: 1, startRadius: 0.2, thickness: 0.1 } });
assert.ok(spiralPoints.every((point) => Math.hypot(point.x, point.y) >= 0.149 && Math.hypot(point.x, point.y) <= 1.051), 'spiral points remain within radial bounds');
const rectanglePoints = pointsFor({ type: 'rectangle', params: { width: 1, height: 1, fill: true, thickness: 0.1 } });
assert.ok(rectanglePoints.every((point) => Math.abs(point.x) <= 0.501 && Math.abs(point.y) <= 0.501), 'filled rectangle points remain inside the region');
const ellipsePoints = pointsFor({ type: 'ellipse', params: { radii: [1, 0.5], fill: true, thickness: 0.1 } });
assert.ok(ellipsePoints.every((point) => (point.x * point.x) + 4 * (point.y * point.y) <= 1.001), 'filled ellipse points remain inside the region');
const triangle = [[-1, -1], [1, -1], [0, 1]];
const trianglePoints = pointsFor({ type: 'polygon', params: { points: triangle, fill: true, thickness: 0.1 } });
assert.ok(trianglePoints.every((point) => pointInPolygon(point, triangle)), 'filled polygon samples its interior');
const concave = [[-1, -1], [1, -1], [1, 0], [0, 0.1], [1, 1], [-1, 1]];
const concavePoints = pointsFor({ type: 'polygon', params: { points: concave, fill: true, thickness: 0.05 } });
assert.ok(concavePoints.every((point) => pointInPolygon(point, concave)), 'concave polygon samples its interior');
const thin = [[-1, -0.04], [1, -0.04], [1, 0.04], [-1, 0.04]];
assert.ok(pointsFor({ type: 'polygon', params: { points: thin, fill: true, thickness: 0.02 } }).every((point) => pointInPolygon(point, thin)), 'thin polygon samples its interior');
const invalidPolygonBase = recipe();
assert.throws(() => normalizeWorldRecipe({ ...invalidPolygonBase, groups: [{ ...invalidPolygonBase.groups[0], shape: { type: 'polygon', params: { points: [[-1, -1], [1, 1], [-1, 1], [1, -1]], fill: true, thickness: 0.1 } } }, invalidPolygonBase.groups[1]] }), /EXPLORATION_INVALID_WORLD_RECIPE/);
assert.deepEqual(applyWorldRecipeTransform([1, 0], { scale: [2, 3], rotate: Math.PI / 2, translate: [4, 5] }).map((value) => Number(value.toFixed(8))), [4, 7], 'transform order is scale then rotate then translate');

const base = recipe();
const first = materializeWorldRecipe(base, 42, { worldId: 'composer-test' });

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
const centerHeavy = pointsFor({ type: 'blob', params: { radius: 1, aspect: [1, 1] } }, 500, { type: 'center-heavy', strength: 1 });
const edgeHeavy = pointsFor({ type: 'blob', params: { radius: 1, aspect: [1, 1] } }, 500, { type: 'edge-heavy', strength: 1 });
const centerMass = centerHeavy.filter((point) => Math.hypot(point.x, point.y) < 0.4).length;
const centerEdgeMass = centerHeavy.filter((point) => Math.hypot(point.x, point.y) > 0.8).length;
const edgeMass = edgeHeavy.filter((point) => Math.hypot(point.x, point.y) > 0.8).length;
const edgeCenterMass = edgeHeavy.filter((point) => Math.hypot(point.x, point.y) < 0.4).length;
assert.ok(centerMass > centerEdgeMass * 1.5, 'center-heavy concentrates area samples near the center');
assert.ok(edgeMass > edgeCenterMass * 1.5, 'edge-heavy concentrates area samples near the edge');
const pathEdge = pointsFor({ type: 'arc', params: { radius: 1, startAngle: 0, endAngle: Math.PI, thickness: 0.05 } }, 500, { type: 'edge-heavy', strength: 1 });
const pathCenter = pointsFor({ type: 'arc', params: { radius: 1, startAngle: 0, endAngle: Math.PI, thickness: 0.05 } }, 500, { type: 'center-heavy', strength: 1 });
const pathDistanceFromEnds = (point) => Math.min(Math.atan2(point.y, point.x), Math.PI - Math.atan2(point.y, point.x));
assert.ok(pathEdge.filter((point) => pathDistanceFromEnds(point) < 0.35).length > pathEdge.filter((point) => pathDistanceFromEnds(point) > 1.0).length * 1.3, 'edge-heavy uses path distance near both ends');
assert.ok(pathCenter.filter((point) => pathDistanceFromEnds(point) > 1.0).length > pathCenter.filter((point) => pathDistanceFromEnds(point) < 0.35).length * 1.2, 'center-heavy uses path distance near the middle');
const ringGradient = pointsFor({ type: 'ring', params: { radius: 1, thickness: 0.05 } }, 500, { type: 'gradient', from: 5, to: 0.2, axis: 'path' });
assert.ok(ringGradient.filter((point) => Math.abs(Math.atan2(point.y, point.x)) < 0.35).length > ringGradient.filter((point) => Math.abs(Math.atan2(point.y, point.x) - Math.PI) < 0.35).length, 'ring path gradient changes angular density');
const rectangleGradient = pointsFor({ type: 'rectangle', params: { width: 2, height: 1, fill: true, thickness: 0.1 } }, 500, { type: 'gradient', from: 5, to: 0.2, axis: 'x' });
assert.ok(mean(rectangleGradient.map((point) => point.x)) < -0.15, 'rectangle x-gradient favors the requested side');
assert.throws(() => normalizeWorldRecipe({ ...recipe(), groups: [{ ...recipe().groups[0], sampling: { ...recipe().groups[0].sampling, train: { count: 12, density: { type: 'gradient', from: 1, to: 2, axis: 'x' } } } }, recipe().groups[1]] }), /EXPLORATION_INVALID_WORLD_RECIPE/);

const densityPatch = { version: 1, changes: [{ type: 'SET_GROUP_SAMPLING', groupId: 'class-a', split: 'train', sampling: { count: 12, density: { type: 'center-heavy', strength: 1 } } }] };
const densityChanged = applyWorldRecipePatch(base, densityPatch);
assert.deepEqual(worldRecipePatchSemanticDomains(base, densityPatch), ['group-sampling-density']);
assert.ok(worldRecipeDiff(base, densityChanged).changedPaths.some((path) => path.includes('.sampling.train.density')));
assert.deepEqual(
  materializeWorldRecipe(densityChanged, 42, { worldId: 'composer-test' }).observations.filter((point) => point.generation.groupId === 'class-b'),
  first.observations.filter((point) => point.generation.groupId === 'class-b'),
  'density edits do not resample an unrelated group',
);

const labelOnly = normalizeWorldRecipe({ ...base, noise: { ...base.noise, train: { ...base.noise.train, label: { probability: 0.2, policy: 'flip' } } } });
const positionOnly = normalizeWorldRecipe({ ...base, noise: { ...base.noise, train: { ...base.noise.train, position: { amount: 0.2 } } } });
const basePoints = materializeWorldRecipe(base, 42, { worldId: 'noise-stability' }).observations;
const labelPoints = materializeWorldRecipe(labelOnly, 42, { worldId: 'noise-stability' }).observations;
const positionPoints = materializeWorldRecipe(positionOnly, 42, { worldId: 'noise-stability' }).observations;
assert.deepEqual(labelPoints.map((point) => [point.x, point.y]), basePoints.map((point) => [point.x, point.y]), 'label noise does not resample coordinates');
assert.deepEqual(labelPoints.map((point) => point.label), materializeWorldRecipe(labelOnly, 42, { worldId: 'noise-stability' }).observations.map((point) => point.label), 'label noise remains deterministic');
assert.deepEqual(positionPoints.map((point) => point.label), basePoints.map((point) => point.label), 'position noise does not change labels');

assert.throws(() => applyWorldRecipePatch(base, { version: 1, changes: [{ type: 'TRANSLATE_GROUP', groupId: 'class-a', split: 'all', delta: [0.1, 0], invented: true }] }), /EXPLORATION_INVALID_WORLD_RECIPE_PATCH/);
assert.throws(() => applyWorldRecipePatch(base, { version: 1, changes: [{ type: 'ROTATE_GROUP', groupId: 'class-a', split: 'all' }] }), /EXPLORATION_INVALID_WORLD_RECIPE_PATCH/);
assert.throws(() => applyWorldRecipePatch(base, { version: 1, changes: [{ type: 'TRANSLATE_GROUP', groupId: 'class-a', split: 'sideways', delta: [0.1, 0] }] }), /EXPLORATION_INVALID_WORLD_RECIPE_PATCH/);
assert.throws(() => applyWorldRecipePatch(base, { version: 1, changes: [{ type: 'TRANSLATE_GROUP', groupId: 'unknown', split: 'all', delta: [0.1, 0] }] }), /EXPLORATION_WORLD_RECIPE_GROUP_NOT_FOUND/);
assert.throws(() => applyWorldRecipePatch(base, { version: 1, changes: [{ type: 'SET_GROUP_SAMPLE_COUNT', groupId: 'class-a', split: 'all', count: 12 }] }), /EXPLORATION_INVALID_WORLD_RECIPE_PATCH/);
assert.throws(() => normalizeWorldRecipe({ ...base, noise: { ...base.noise, train: { ...base.noise.train, local: [{ kind: 'position', amount: 0.1, probability: 0.2, region: { type: 'bbox', min: [-1, -1], max: [1, 1] } }] } } }), /EXPLORATION_INVALID_WORLD_RECIPE/);
assert.throws(() => applyWorldRecipePatch(base, { version: 1, changes: Array.from({ length: 33 }, () => ({ type: 'TRANSLATE_GROUP', groupId: 'class-a', split: 'all', delta: [0, 0] })) }), /EXPLORATION_INVALID_WORLD_RECIPE_PATCH/);
assert.throws(() => normalizeWorldRecipe({ ...base, groups: [{ ...base.groups[0], transform: { ...base.groups[0].transform, translate: [21, 0] } }, base.groups[1]] }), /EXPLORATION_INVALID_WORLD_RECIPE/);
assert.throws(() => normalizeWorldRecipe({ ...base, groups: [{ ...base.groups[0], shape: { type: 'spiral', params: { turns: 1, radius: 1, startRadius: -1, thickness: 0.1 } } }, base.groups[1]] }), /EXPLORATION_INVALID_WORLD_RECIPE/);

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
const legacyTransitionSpec = normalizeGeneratorSpec({
  relation: { slope: 1, bias: 0 },
  noise: { amount: 0 },
  train: { input: { type: 'uniform', params: { min: -1, max: 1 } }, samples: 6 },
  test: { input: { type: 'uniform', params: { min: -1, max: 1 } }, samples: 4 },
  outliers: { count: 0 },
});
const transitionSource = createWorld({ task: 'regression', observations: [{ id: 'transition-source', x: 0, y: 0, membership: 'train' }] });
const legacyGenerated = applyWorldTransaction(
  applyWorldTransaction(transitionSource, { id: 'legacy-configure', actor: 'human', intent: 'configure-generator', operations: [{ type: 'SET_WORLD_GENERATOR', spec: legacyTransitionSpec }] }).world,
  { id: 'legacy-generate', actor: 'human', intent: 'regenerate-world', operations: [{ type: 'REGENERATE_WORLD', seed: 17 }] },
).world;
const recipeAfterLegacy = applyWorldTransaction(legacyGenerated, { id: 'legacy-to-recipe', actor: 'human', intent: 'world-design', operations: [{ type: 'SET_WORLD_RECIPE', recipe: base, seed: 17 }] }).world;
assert.equal(recipeAfterLegacy.generator.kind, 'world-recipe');
assert.equal(recipeAfterLegacy.generator.realization, null);
const recipeRegeneratedAfterLegacy = applyWorldTransaction(recipeAfterLegacy, { id: 'recipe-regenerate-after-legacy', actor: 'human', intent: 'regenerate-world', operations: [{ type: 'REGENERATE_WORLD' }] }).world;
assert.equal(recipeRegeneratedAfterLegacy.generator.realization.kind, 'world-recipe');
const legacyAfterRecipe = applyWorldTransaction(recipeRegeneratedAfterLegacy, { id: 'recipe-to-legacy', actor: 'human', intent: 'configure-generator', operations: [{ type: 'SET_WORLD_GENERATOR', spec: legacyTransitionSpec }] }).world;
assert.equal(legacyAfterRecipe.generator.kind, 'legacy-generator');
assert.equal(legacyAfterRecipe.generator.realization, null);
const legacyRegeneratedAfterRecipe = applyWorldTransaction(legacyAfterRecipe, { id: 'legacy-regenerate-after-recipe', actor: 'human', intent: 'regenerate-world', operations: [{ type: 'REGENERATE_WORLD' }] }).world;
assert.equal(legacyRegeneratedAfterRecipe.generator.realization.kind, 'legacy-generator');
const frozen = applyWorldTransaction(regenerated, { id: 'recipe-freeze', actor: 'human', intent: 'freeze', operations: [{ type: 'FREEZE_AS_SAMPLES' }] }).world;
assert.equal(frozen.mode, 'sample');

const makeExperiment = (id, world) => createExperiment({ id, world, adapterId: 'linear-regression', model: { adapterId: 'linear-regression', controls: {} }, learning: { controls: {} }, evaluation: { controls: {} } });
const recipeDiff = compareExperiments(makeExperiment('recipe-a', generated), makeExperiment('recipe-b', regenerated));
assert.ok(recipeDiff.details.worldRecipe.changedPaths.some((path) => path.includes('class-a')));

const splitPatch = { version: 1, changes: [{ type: 'TRANSLATE_GROUP', groupId: 'class-b', split: 'test', delta: [0.7, 0] }] };
const splitRecipe = applyWorldRecipePatch(base, splitPatch);
const splitBase = materializeWorldRecipe(base, 42, { worldId: 'split-test' });
const splitMaterialized = materializeWorldRecipe(splitRecipe, 42, { worldId: 'split-test' });
assert.deepEqual(
  splitMaterialized.observations.filter((point) => point.membership === 'train'),
  splitBase.observations.filter((point) => point.membership === 'train'),
  'test-only transform preserves train realization',
);
assert.ok(splitMaterialized.observations.some((point, index) => point.membership === 'test' && (point.x !== splitBase.observations[index].x || point.y !== splitBase.observations[index].y)), 'test-only transform changes test realization');
const splitDiff = compareExperiments(
  makeExperiment('split-a', { ...generated, generator: { ...generated.generator, kind: 'world-recipe', recipe: base, realization: { ...generated.generator.realization, recipe: base } } }),
  makeExperiment('split-b', { ...generated, generator: { ...generated.generator, kind: 'world-recipe', recipe: splitRecipe, realization: { ...generated.generator.realization, recipe: splitRecipe } } }),
);
assert.ok(splitDiff.details.worldRecipe.changedPaths.some((path) => path.includes('splitTransforms.test')));
assert.deepEqual(worldRecipePatchSemanticDomains(base, splitPatch), ['group-split-transform:test']);

const exactRecipeFidelity = evaluateScenarioFidelity(
  { change: [], hold: [], intendedWorldRecipeDomains: ['group-sampling-density'] },
  { changed: [], details: { worldRecipe: { changedPaths: ['.groups.class-a.sampling.train.density.type'] } } },
);
assert.equal(exactRecipeFidelity.status, 'exact');
const accidentalRecipeFidelity = evaluateScenarioFidelity(
  { change: [], hold: [], intendedWorldRecipeDomains: ['group-sampling-density'] },
  { changed: [], details: { worldRecipe: { changedPaths: ['.groups.class-a.sampling.train.density.type', '.groups.class-a.shape.params.radius'] } } },
);
assert.equal(accidentalRecipeFidelity.status, 'partial');
const wholeRecipeFidelity = evaluateScenarioFidelity(
  { change: [], hold: [], intendedWorldRecipeDomains: ['whole-recipe'] },
  { changed: [], details: { worldRecipe: { changedPaths: ['.task', '.groups.class-a.shape.type'] } } },
);
assert.equal(wholeRecipeFidelity.status, 'exact');

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
const agentComposerContext = host.inspectContext().exploration.worldComposer;
assert.equal(agentComposerContext.supported, true);
assert.equal(agentComposerContext.currentRecipe.groups[0].id, 'outer-ring');
assert.deepEqual(agentComposerContext.currentRecipe.groups[0].trainDensity, { type: 'uniform' });
assert.equal('observations' in agentComposerContext.currentRecipe, false, 'Agent recipe summary is relative and does not include raw observations');
await host.dispatch({ type: 'REPEAT_EXPERIMENT', trials: 2 });
assert.equal(host.getState().repeatEvidence?.trials?.length, 2, 'recipe Worlds use the normal Repeat lifecycle');
const editProposal = host.proposeExploration({ request: 'Move class B right', worldDesign: { mode: 'edit', recipe: null, patch: { version: 1, changes: [{ type: 'TRANSLATE_GROUP', groupId: 'inner-blob', delta: [0.7, 0] }] }, requestedHolds: ['model-configuration'] } });
assert.equal(editProposal.kind, 'proposal');
assert.equal(editProposal.assessment.fidelity.status, 'exact');

assert.deepEqual(listWorldRecipePresets().map((entry) => entry.id), ['rings', 'moons', 'xor', 'checkerboard']);
console.log('World Composer checks passed: canonical recipe validation, primitive/preset materialization, deterministic substreams, noise/provenance, atomic lifecycle, comparison, fidelity, Agent proposal, and legacy compatibility.');
