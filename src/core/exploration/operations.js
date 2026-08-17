// Pure domain operations. UI gestures, Agent requests, and future workspace
// tools can all map to these same operations without knowing React or models.

import { cloneWorld, createWorld, explorationError, worldFromPlaygroundSource } from './world.js';
import { validateExperiment } from './experiment.js';
import { isPublicWorldOperation } from './operationRegistry.js';
import { getProjectedValue } from './projection.js';
import { cloneGeneratorSpec, generateObservations, normalizeGeneratorSpec } from './generator.js';
import { applyWorldRecipePatch, normalizeWorldRecipe } from './worldRecipe.js';
import { materializeWorldRecipe } from './worldMaterializer.js';

const clone = (value) => structuredClone(value);

function mutation(type, details = {}) {
  return { type, details: clone(details) };
}

function worldWithObservations(world, observations, details) {
  const modifiedPointIds = new Set((details.modifiedPointIds ?? []).map(String));
  const nextObservations = observations.map((point) => modifiedPointIds.has(point.id) && point.generation
    ? { ...point, provenance: 'manual' }
    : point);
  const generator = world.generator
    ? {
      ...world.generator,
      status: world.mode === 'generated' ? 'modified' : world.generator.status,
    }
    : null;
  return {
    world: createWorld({
      ...world,
      observations: nextObservations,
      source: world.source,
      seed: world.randomness?.seed ?? null,
      mode: world.mode ?? 'sample',
      generator,
    }),
    mutation: mutation(details.type, details),
  };
}

function setWorldGenerator(world, spec, seed = world.randomness?.seed ?? null) {
  const normalized = normalizeGeneratorSpec(spec);
  const existing = world.generator;
  const hasRealization = existing?.kind === 'legacy-generator' && Boolean(existing.realization);
  const active = world.mode === 'generated' && Boolean(existing?.kind === 'legacy-generator' && existing?.active && hasRealization);
  return {
    world: createWorld({
      ...world,
      // Configuring a generator on a Sample World creates a draft. Existing
      // observations remain samples until REGENERATE_WORLD is dispatched.
      mode: active ? 'generated' : 'sample',
      seed,
      generator: {
        version: normalized.version,
        active,
        status: existing?.status === 'modified' ? 'modified' : 'dirty',
        spec: normalized,
        seed,
        realization: hasRealization
          ? {
            spec: cloneGeneratorSpec(existing.realization.spec),
            seed: existing.realization.seed ?? null,
          }
          : null,
      },
    }),
    mutation: mutation('world.setGenerator', { type: 'world.setGenerator', seed }),
  };
}

function setWorldRecipe(world, recipe, seed = world.randomness?.seed ?? null) {
  const normalized = normalizeWorldRecipe(recipe);
  const existing = world.generator;
  const hasRecipeRealization = existing?.kind === 'world-recipe' && Boolean(existing.realization);
  const active = world.mode === 'generated' && Boolean(existing?.active && hasRecipeRealization);
  return {
    world: createWorld({
      ...world,
      mode: active ? 'generated' : 'sample',
      seed,
      generator: {
        kind: 'world-recipe',
        version: normalized.version,
        active,
        status: existing?.status === 'modified' ? 'modified' : 'dirty',
        recipe: normalized,
        seed,
        realization: hasRecipeRealization
          ? { kind: 'world-recipe', recipe: existing.realization.recipe, seed: existing.realization.seed ?? null }
          : null,
      },
    }),
    mutation: mutation('world.setRecipe', { type: 'world.setRecipe', seed, groupCount: normalized.groups.length }),
  };
}

function patchWorldRecipe(world, patch) {
  if (world.generator?.kind !== 'world-recipe') throw explorationError('EXPLORATION_INVALID_WORLD_RECIPE', { reason: 'World has no recipe specification' });
  return setWorldRecipe(world, applyWorldRecipePatch(world.generator.recipe, patch), world.generator.seed ?? world.randomness?.seed ?? null);
}

const GENERATOR_PARAMETER_ALIASES = {
  'input.type': 'train.input.type',
  'input.params.min': 'train.input.params.min',
  'input.params.max': 'train.input.params.max',
  'input.params.mean': 'train.input.params.mean',
  'input.params.spread': 'train.input.params.spread',
  'input.params.centerA': 'train.input.params.centerA',
  'input.params.centerB': 'train.input.params.centerB',
  'sampling.samples': 'train.samples',
};

const GENERATOR_PARAMETER_PATHS = new Set([
  'train.input.type', 'train.input.params.min', 'train.input.params.max', 'train.input.params.mean',
  'train.input.params.spread', 'train.input.params.centerA', 'train.input.params.centerB', 'train.samples',
  'test.input.type', 'test.input.params.min', 'test.input.params.max', 'test.input.params.mean',
  'test.input.params.spread', 'test.input.params.centerA', 'test.input.params.centerB', 'test.samples',
  'relation.slope', 'relation.bias', 'noise.amount', 'outliers.count',
]);

function canonicalGeneratorParameterPath(path) {
  const canonicalPath = GENERATOR_PARAMETER_ALIASES[path] ?? path;
  if (!GENERATOR_PARAMETER_PATHS.has(canonicalPath)) {
    throw explorationError('EXPLORATION_INVALID_GENERATOR', { field: 'path', value: path });
  }
  return canonicalPath;
}

function setGeneratorParameter(world, path, value) {
  const canonicalPath = canonicalGeneratorParameterPath(path);
  return setGeneratorParameterValues(world, [{ path: canonicalPath, value }]);
}

function setGeneratorParameterValues(world, parameters) {
  const spec = cloneGeneratorSpec(world.generator?.spec ?? {});
  for (const { path, value } of parameters) {
    const canonicalPath = canonicalGeneratorParameterPath(path);
    const segments = canonicalPath.split('.');
    let cursor = spec;
    for (const segment of segments.slice(0, -1)) cursor = cursor[segment];
    cursor[segments.at(-1)] = value;
  }
  // Normalize once for a parameter batch so a learner/Agent can update both
  // ends of a range in one transaction (e.g. min=3, max=5) without exposing
  // an invalid intermediate specification.
  return setWorldGenerator(world, spec, world.randomness?.seed ?? null);
}

function setGeneratorSeed(world, seed) {
  const number = Number(seed);
  if (!Number.isFinite(number)) throw explorationError('EXPLORATION_INVALID_GENERATOR', { field: 'seed', value: seed });
  if (world.generator?.kind === 'world-recipe') return setWorldRecipe(world, world.generator.recipe, Math.trunc(number));
  return setWorldGenerator(world, world.generator?.spec ?? {}, Math.trunc(number));
}

function regenerateWorld(world, seed = world.randomness?.seed ?? null) {
  if (world.generator?.kind === 'world-recipe') {
    const effectiveSeed = seed ?? world.generator.seed ?? world.randomness?.seed ?? null;
    const generated = materializeWorldRecipe(world.generator.recipe, effectiveSeed, { worldId: world.id });
    return {
      world: createWorld({
        ...world,
        mode: 'generated',
        observations: generated.observations,
        seed: generated.seed,
        generator: {
          ...world.generator,
          kind: 'world-recipe',
          active: true,
          status: 'clean',
          recipe: generated.recipe,
          seed: generated.seed,
          realization: { kind: 'world-recipe', recipe: generated.recipe, seed: generated.seed },
        },
      }),
      mutation: mutation('world.regenerate', { type: 'world.regenerate', seed: generated.seed, count: generated.observations.length, recipeVersion: generated.recipe.version }),
    };
  }
  if (!world.generator?.spec) throw explorationError('EXPLORATION_INVALID_GENERATOR', { reason: 'World has no generator specification' });
  const effectiveSeed = seed ?? world.generator.seed ?? world.randomness?.seed ?? null;
  const generated = generateObservations(world.generator.spec, effectiveSeed, { worldId: world.id });
  return {
    world: createWorld({
      ...world,
      mode: 'generated',
      observations: generated.observations,
      seed: generated.seed,
      generator: {
        ...world.generator,
        active: true,
        status: 'clean',
        spec: generated.spec,
        seed: generated.seed,
        realization: { spec: generated.spec, seed: generated.seed },
      },
    }),
    mutation: mutation('world.regenerate', { type: 'world.regenerate', seed: generated.seed, count: generated.observations.length }),
  };
}

function freezeAsSamples(world) {
  if (!world.generator) return { world: cloneWorld(world), mutation: mutation('world.freezeAsSamples', { alreadySample: true }) };
  return {
    world: createWorld({
      ...world,
      mode: 'sample',
      generator: { ...world.generator, active: false, status: 'modified' },
    }),
    mutation: mutation('world.freezeAsSamples', { sourceMode: 'generated' }),
  };
}

const TRANSACTION_ACTORS = ['human', 'agent', 'system'];
export const MAX_WORLD_TRANSACTION_OPERATIONS = 512;
export const MAX_WORLD_HISTORY_ACTIONS = 200;

function requireOperationArray(operations) {
  if (!Array.isArray(operations) || !operations.length) {
    throw explorationError('EXPLORATION_INVALID_OPERATION', { field: 'operations' });
  }
  if (operations.length > MAX_WORLD_TRANSACTION_OPERATIONS) {
    throw explorationError('EXPLORATION_RESOURCE_LIMIT', {
      field: 'operations',
      max: MAX_WORLD_TRANSACTION_OPERATIONS,
    });
  }
  return operations;
}

function allocatePointIds(world, points, transactionId) {
  const used = new Set(world.observations.map((point) => point.id));
  return points.map((point, index) => {
    if (point.id !== undefined && point.id !== null && String(point.id)) {
      const id = String(point.id);
      if (used.has(id)) throw explorationError('EXPLORATION_INVALID_OPERATION', { field: 'point.id', value: id });
      used.add(id);
      return { ...point, id };
    }
    let suffix = index + 1;
    let id = `${transactionId}-point-${suffix}`;
    while (used.has(id)) {
      suffix += 1;
      id = `${transactionId}-point-${suffix}`;
    }
    used.add(id);
    return { ...point, id };
  });
}

export function addPoints(world, points, { provenance = 'manual' } = {}) {
  if (!Array.isArray(points) || !points.length) throw explorationError('EXPLORATION_INVALID_OPERATION', { type: 'ADD_POINTS' });
  const explicitSplit = world.observations.some((point) => point.membership !== 'unspecified')
    || points.some((point) => point.membership === 'train' || point.membership === 'test');
  const existing = explicitSplit
    ? world.observations.map((point) => point.membership === 'unspecified' ? { ...point, membership: 'train' } : point)
    : world.observations;
  const next = points.map((point) => ({
    ...point,
    membership: explicitSplit && (point.membership ?? 'unspecified') === 'unspecified'
      ? 'train'
      : point.membership,
    provenance: point.provenance ?? provenance,
  }));
  return worldWithObservations(world, [...existing, ...next], {
    type: 'world.addPoints',
    count: next.length,
    normalizedUnspecifiedToTrain: explicitSplit
      ? existing.filter((point, index) => point.membership !== world.observations[index].membership).length
      : 0,
  });
}

export function movePoint(world, pointId, { x, y, target }) {
  const observations = world.observations.map((point) => point.id === String(pointId)
    ? {
      ...setFeatureValue(
        world,
        setFeatureValue(world, point, world.metadata?.modelFeature ?? 'x', x),
        world.metadata?.targetFeature ?? 'y',
        target ?? y,
      ),
      x,
      y,
      ...(point.target !== undefined ? { target: target ?? y } : {}),
    }
    : point);
  if (observations.every((point, index) => point === world.observations[index])) {
    throw explorationError('EXPLORATION_POINT_NOT_FOUND', { pointId });
  }
  return worldWithObservations(world, observations, { type: 'world.movePoint', pointId: String(pointId), modifiedPointIds: [pointId] });
}

export function removePoint(world, pointId) {
  const observations = world.observations.filter((point) => point.id !== String(pointId));
  if (observations.length === world.observations.length) throw explorationError('EXPLORATION_POINT_NOT_FOUND', { pointId });
  return worldWithObservations(world, observations, { type: 'world.removePoint', pointId: String(pointId) });
}

export function removePoints(world, pointIds) {
  const ids = new Set((Array.isArray(pointIds) ? pointIds : [pointIds]).map(String));
  if (!ids.size) throw explorationError('EXPLORATION_INVALID_OPERATION', { type: 'REMOVE_POINTS' });
  if ([...ids].some((id) => !world.observations.some((point) => point.id === id))) {
    throw explorationError('EXPLORATION_POINT_NOT_FOUND', { pointIds: [...ids] });
  }
  const observations = world.observations.filter((point) => !ids.has(point.id));
  if (observations.length === world.observations.length) {
    throw explorationError('EXPLORATION_POINT_NOT_FOUND', { pointIds: [...ids] });
  }
  return worldWithObservations(world, observations, { type: 'world.removePoints', pointIds: [...ids] });
}

function setFeatureValue(world, point, feature, value) {
  const next = {
    ...point,
    features: { ...(point.features ?? {}), [feature]: value },
  };
  if (feature === world.metadata?.modelFeature) next.x = value;
  if (feature === world.metadata?.targetFeature) {
    next.y = value;
    if (next.target !== undefined) next.target = value;
  }
  return next;
}

function requireKnownFeature(world, feature, type) {
  if (typeof feature !== 'string' || !world.featureNames.includes(feature)) {
    throw explorationError('EXPLORATION_UNKNOWN_FEATURE', { type, feature });
  }
}

function featureValue(world, point, feature, type) {
  requireKnownFeature(world, feature, type);
  const value = getProjectedValue(point, feature);
  if (!Number.isFinite(value)) {
    throw explorationError('EXPLORATION_NON_NUMERIC_FEATURE', { type, feature, pointId: point.id });
  }
  return value;
}

function deterministicNoise(seed, pointId, feature) {
  let state = 2166136261;
  for (const character of `${seed}:${feature}:${pointId}`) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  const uniform = () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const u1 = Math.max(Number.EPSILON, uniform());
  const u2 = uniform();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(Math.PI * 2 * u2);
}

export function setFeatureValues(world, feature, values) {
  if (typeof feature !== 'string' || !feature || !Array.isArray(values) || !values.length) {
    throw explorationError('EXPLORATION_INVALID_OPERATION', { type: 'SET_FEATURE_VALUES' });
  }
  requireKnownFeature(world, feature, 'SET_FEATURE_VALUES');
  const valueById = new Map(values.map((entry) => [String(entry.pointId), Number(entry.value)]));
  if ([...valueById.values()].some((value) => !Number.isFinite(value))) {
    throw explorationError('EXPLORATION_INVALID_OPERATION', { type: 'SET_FEATURE_VALUES', feature });
  }
  const observations = world.observations.map((point) => valueById.has(point.id)
    ? setFeatureValue(world, point, feature, valueById.get(point.id))
    : point);
  if ([...valueById.keys()].some((id) => !world.observations.some((point) => point.id === id))) {
    throw explorationError('EXPLORATION_POINT_NOT_FOUND', { pointIds: [...valueById.keys()] });
  }
  world.observations.forEach((point) => {
    if (valueById.has(point.id)) featureValue(world, point, feature, 'SET_FEATURE_VALUES');
  });
  return worldWithObservations(world, observations, {
    type: 'world.setFeatureValues',
    feature,
    pointIds: [...valueById.keys()],
    modifiedPointIds: [...valueById.keys()],
  });
}

export function applyFeatureTransform(world, operation) {
  const feature = String(operation?.feature ?? '');
  const kind = String(operation?.kind ?? 'shift');
  const amount = Number(operation?.amount);
  const pointIds = new Set((operation?.pointIds ?? []).map(String));
  if (!feature || !['shift', 'scale', 'noise'].includes(kind) || !Number.isFinite(amount) || !pointIds.size) {
    throw explorationError('EXPLORATION_INVALID_OPERATION', { type: 'TRANSFORM_FEATURE_VALUES' });
  }
  requireKnownFeature(world, feature, 'TRANSFORM_FEATURE_VALUES');
  if ([...pointIds].some((id) => !world.observations.some((point) => point.id === id))) {
    throw explorationError('EXPLORATION_POINT_NOT_FOUND', { pointIds: [...pointIds] });
  }
  const observations = world.observations.map((point) => {
    if (!pointIds.has(point.id)) return point;
    const numeric = featureValue(world, point, feature, 'TRANSFORM_FEATURE_VALUES');
    const nextValue = kind === 'shift'
      ? numeric + amount
      : kind === 'scale'
        ? numeric * amount
        : numeric + deterministicNoise(operation.seed ?? 0, point.id, feature) * amount;
    return setFeatureValue(world, point, feature, nextValue);
  });
  return worldWithObservations(world, observations, {
    type: 'world.transformFeatureValues',
    feature,
    kind,
    amount,
    seed: operation.seed ?? 0,
    scope: operation.scope ?? 'selected',
    pointIds: [...pointIds],
    modifiedPointIds: [...pointIds],
  });
}

export function setTrainTestMembership(world, pointIds, membership) {
  if (membership !== 'train' && membership !== 'test') {
    throw explorationError('EXPLORATION_INVALID_OPERATION', {
      type: 'SET_TRAIN_TEST_MEMBERSHIP',
      field: 'membership',
      value: membership,
    });
  }
  const ids = new Set((Array.isArray(pointIds) ? pointIds : [pointIds]).map(String));
  if (!ids.size || [...ids].some((id) => !world.observations.some((point) => point.id === id))) {
    throw explorationError('EXPLORATION_POINT_NOT_FOUND', { pointIds: [...ids] });
  }
  const observations = world.observations.map((point) => ({
    ...point,
    membership: ids.has(point.id)
      ? membership
      : point.membership === 'unspecified'
        ? 'train'
        : point.membership,
  }));
  return worldWithObservations(world, observations, {
    type: 'world.setTrainTestMembership',
    pointIds: [...ids],
    membership,
    normalizedUnspecifiedToTrain: world.observations.filter((point, index) => (
      point.membership === 'unspecified' && observations[index].membership === 'train'
    )).length,
  });
}

export function applyWorldOperation(world, operation) {
  const current = cloneWorld(world);
  switch (operation?.type) {
    case 'ADD_POINTS': return addPoints(current, operation.points, operation);
    case 'MOVE_POINT': return movePoint(current, operation.pointId, operation);
    case 'REMOVE_POINT': return removePoint(current, operation.pointId);
    case 'REMOVE_POINTS': return removePoints(current, operation.pointIds);
    case 'SET_FEATURE_VALUES': return setFeatureValues(current, operation.feature, operation.values);
    case 'TRANSFORM_FEATURE_VALUES': return applyFeatureTransform(current, operation);
    case 'RESTORE_POINTS': {
      const entries = [...(operation.entries ?? [])].sort((a, b) => a.index - b.index);
      const observations = [...current.observations];
      for (const entry of entries) observations.splice(entry.index, 0, clone(entry.point));
      return worldWithObservations(current, observations, {
        type: 'world.restorePoints',
        pointIds: entries.map((entry) => entry.point.id),
      });
    }
    case 'SET_TRAIN_TEST_MEMBERSHIP': return setTrainTestMembership(current, operation.pointIds, operation.membership);
    case 'RESTORE_MEMBERSHIPS': {
      const membershipById = new Map((operation.entries ?? []).map((entry) => [String(entry.pointId), entry.membership]));
      const observations = current.observations.map((point) => membershipById.has(point.id)
        ? { ...point, membership: membershipById.get(point.id) }
        : point);
      return worldWithObservations(current, observations, {
        type: 'world.restoreMemberships',
        pointIds: [...membershipById.keys()],
      });
    }
    case 'SET_WORLD_GENERATOR': return setWorldGenerator(current, operation.spec, operation.seed);
    case 'SET_WORLD_RECIPE': return setWorldRecipe(current, operation.recipe, operation.seed);
    case 'PATCH_WORLD_RECIPE': return patchWorldRecipe(current, operation.patch);
    case 'SET_GENERATOR_PARAMETER': return setGeneratorParameter(current, String(operation.path ?? ''), operation.value);
    case 'SET_GENERATOR_SEED': return setGeneratorSeed(current, operation.seed);
    case 'REGENERATE_WORLD': return regenerateWorld(current, operation.seed);
    case 'FREEZE_AS_SAMPLES': return freezeAsSamples(current);
    case 'RESTORE_WORLD': return { world: cloneWorld(operation.world), mutation: mutation('world.restore', { type: 'world.restore' }) };
    default: throw explorationError('EXPLORATION_INVALID_OPERATION', { type: operation?.type });
  }
}

function prepareOperation(world, operation, transactionId) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw explorationError('EXPLORATION_INVALID_OPERATION', { type: operation?.type });
  }
  if (operation.type === 'ADD_POINTS') {
    if (!Array.isArray(operation.points) || !operation.points.length) {
      throw explorationError('EXPLORATION_INVALID_OPERATION', { type: operation.type });
    }
    return { ...clone(operation), points: allocatePointIds(world, operation.points, transactionId) };
  }
  return clone(operation);
}

function isInternalWorldOperation(type) {
  return type === 'RESTORE_POINTS' || type === 'RESTORE_MEMBERSHIPS' || type === 'RESTORE_WORLD';
}

function inverseFor(world, operation) {
  if (operation.type === 'ADD_POINTS') {
    const normalized = world.observations
      .filter((point) => point.membership === 'unspecified')
      .map((point) => ({ pointId: point.id, membership: point.membership }));
    return [
      { type: 'REMOVE_POINTS', pointIds: operation.points.map((point) => String(point.id)) },
      ...(normalized.length ? [{ type: 'RESTORE_MEMBERSHIPS', entries: normalized }] : []),
    ];
  }
  if (operation.type === 'MOVE_POINT') {
    const previous = world.observations.find((point) => point.id === String(operation.pointId));
    if (!previous) throw explorationError('EXPLORATION_POINT_NOT_FOUND', { pointId: operation.pointId });
    return {
      type: 'MOVE_POINT',
      pointId: previous.id,
      x: previous.x,
      y: previous.y,
      ...(previous.target !== undefined ? { target: previous.target } : {}),
    };
  }
  if (operation.type === 'REMOVE_POINT' || operation.type === 'REMOVE_POINTS') {
    const ids = new Set((operation.type === 'REMOVE_POINT' ? [operation.pointId] : operation.pointIds).map(String));
    const entries = world.observations
      .map((point, index) => ({ point, index }))
      .filter((entry) => ids.has(entry.point.id));
    if (entries.length !== ids.size) throw explorationError('EXPLORATION_POINT_NOT_FOUND', { pointIds: [...ids] });
    return { type: 'RESTORE_POINTS', entries: clone(entries) };
  }
  if (operation.type === 'SET_FEATURE_VALUES' || operation.type === 'TRANSFORM_FEATURE_VALUES') {
    const feature = String(operation.feature);
    const pointIds = operation.type === 'SET_FEATURE_VALUES'
      ? (operation.values ?? []).map((entry) => String(entry.pointId))
      : (operation.pointIds ?? []).map(String);
    const values = pointIds.map((pointId) => {
      const point = world.observations.find((item) => item.id === pointId);
      if (!point) throw explorationError('EXPLORATION_POINT_NOT_FOUND', { pointId });
      return {
        pointId,
        value: featureValue(world, point, feature, operation.type),
      };
    });
    return { type: 'SET_FEATURE_VALUES', feature, values };
  }
  if (operation.type === 'RESTORE_POINTS') {
    return { type: 'REMOVE_POINTS', pointIds: (operation.entries ?? []).map((entry) => String(entry.point.id)) };
  }
  if (operation.type === 'SET_TRAIN_TEST_MEMBERSHIP' || operation.type === 'RESTORE_MEMBERSHIPS') {
    const ids = operation.type === 'SET_TRAIN_TEST_MEMBERSHIP'
      ? new Set([
        ...(Array.isArray(operation.pointIds) ? operation.pointIds : [operation.pointIds]).map(String),
        ...world.observations
          .filter((point) => point.membership === 'unspecified')
          .map((point) => point.id),
      ])
      : new Set((operation.entries ?? []).map((entry) => String(entry.pointId)));
    return {
      type: 'RESTORE_MEMBERSHIPS',
      entries: world.observations.filter((point) => ids.has(point.id)).map((point) => ({
        pointId: point.id,
        membership: point.membership,
      })),
    };
  }
  if (['SET_WORLD_GENERATOR', 'SET_WORLD_RECIPE', 'PATCH_WORLD_RECIPE', 'SET_GENERATOR_PARAMETER', 'SET_GENERATOR_SEED', 'REGENERATE_WORLD', 'FREEZE_AS_SAMPLES'].includes(operation.type)) {
    return { type: 'RESTORE_WORLD', world: cloneWorld(world) };
  }
  if (operation.type === 'RESTORE_WORLD') return { type: 'RESTORE_WORLD', world: cloneWorld(world) };
  throw explorationError('EXPLORATION_INVALID_OPERATION', { type: operation.type });
}

export function applyWorldTransaction(world, transaction) {
  const current = cloneWorld(world);
  const id = String(transaction?.id ?? 'world-transaction');
  if (!id) throw explorationError('EXPLORATION_INVALID_OPERATION', { field: 'id' });
  const actor = transaction?.actor ?? 'human';
  if (!TRANSACTION_ACTORS.includes(actor)) {
    throw explorationError('EXPLORATION_INVALID_OPERATION', { field: 'actor', value: actor });
  }
  const intent = String(transaction?.intent ?? 'edit');
  if (!intent) throw explorationError('EXPLORATION_INVALID_OPERATION', { field: 'intent' });
  const requested = requireOperationArray(transaction?.operations);
  for (const operation of requested) {
    if (!isPublicWorldOperation(operation?.type) && !(actor === 'system' && isInternalWorldOperation(operation?.type))) {
      throw explorationError('EXPLORATION_INVALID_OPERATION', { type: operation?.type });
    }
  }
  let next = current;
  const forward = [];
  const inverse = [];
  const mutations = [];
  for (let operationIndex = 0; operationIndex < requested.length;) {
    const requestedOperation = requested[operationIndex];
    if (requestedOperation?.type === 'SET_GENERATOR_PARAMETER') {
      const parameters = [];
      while (requested[operationIndex]?.type === 'SET_GENERATOR_PARAMETER') {
        const prepared = prepareOperation(next, requested[operationIndex], id);
        parameters.push({
          path: prepared.path,
          value: prepared.value,
        });
        operationIndex += 1;
      }
      const undo = inverseFor(next, { type: 'SET_GENERATOR_PARAMETER' });
      const result = setGeneratorParameterValues(next, parameters);
      next = result.world;
      forward.push(...parameters.map(({ path, value }) => ({ type: 'SET_GENERATOR_PARAMETER', path, value })));
      inverse.unshift(...(Array.isArray(undo) ? undo : [undo]));
      mutations.push(result.mutation);
      continue;
    }
    const operation = prepareOperation(next, requestedOperation, id);
    const undo = inverseFor(next, operation);
    const result = applyWorldOperation(next, operation);
    next = result.world;
    forward.push(operation);
    inverse.unshift(...(Array.isArray(undo) ? undo : [undo]));
    mutations.push(result.mutation);
    operationIndex += 1;
  }
  const record = {
    id,
    actor,
    domain: 'world',
    intent,
    mutationSummary: {
      operationCount: forward.length,
      types: [...new Set(mutations.map((item) => item.type))],
      normalizedUnspecifiedToTrain: mutations.reduce(
        (total, item) => total + Number(item.details?.normalizedUnspecifiedToTrain ?? 0),
        0,
      ),
    },
  };
  return {
    world: next,
    record,
    forward: { id, actor, intent, operations: forward },
    inverse: { id: `${id}-inverse`, actor: 'system', intent: `undo:${intent}`, operations: inverse },
  };
}

function partitionControls(controls, descriptors = []) {
  const sections = { model: {}, learning: {}, evaluation: {} };
  for (const [key, value] of Object.entries(controls ?? {})) {
    const descriptor = descriptors.find((item) => item.key === key);
    const section = descriptor?.domain === 'learning'
      ? 'learning'
      : descriptor?.domain === 'evaluation'
        ? 'evaluation'
        : descriptor?.domain === 'view'
          ? null
          : 'model';
    if (section) sections[section][key] = clone(value);
  }
  return sections;
}

function runtimeMutation(action, descriptors = []) {
  if (!action?.type) return null;
  if (action.type === 'SET_CONTROL') {
    const descriptor = descriptors.find((item) => item.key === action.key);
    return mutation('configuration.setControl', {
      key: action.key,
      domain: descriptor?.domain ?? 'model',
    });
  }
  const types = {
    ADD_POINT: 'world.addPoints',
    ADD_TRAINING_POINT: 'world.addPoints',
    MOVE_POINT: 'world.movePoint',
    MOVE_TRAINING_POINT: 'world.movePoint',
    REMOVE_POINT: 'world.removePoint',
    REMOVE_TRAINING_POINT: 'world.removePoint',
    SET_TRAIN_TEST_MEMBERSHIP: 'world.setTrainTestMembership',
    SET_PARAMETERS: 'model.setParameters',
    SET_BEST_FIT: 'model.setBestFit',
    START_TRAINING: 'learning.start',
    START_NEIGHBOR_REVEAL: 'learning.start',
  };
  const type = types[action.type];
  return type ? mutation(type, { action: action.type, pointId: action.pointId ?? null }) : null;
}

export function synchronizeExperiment(experiment, {
  world: suppliedWorld,
  source,
  points,
  controls,
  controlDescriptors,
  adapterId,
  seed,
  action,
  traces,
  result,
} = {}) {
  const current = validateExperiment(experiment);
  const runtimePoints = points?.map((point) => {
    const previous = current.world.observations.find((observation) => observation.id === String(point.id));
    return {
      ...point,
      ...(point.membership === undefined && previous?.membership ? { membership: previous.membership } : {}),
      ...(point.provenance === undefined ? { provenance: previous?.provenance ?? 'manual' } : {}),
    };
  });
  const runtimeSource = runtimePoints ? { ...source, points: clone(runtimePoints) } : source;
  const world = suppliedWorld
    ? cloneWorld(suppliedWorld)
    : runtimeSource
      ? worldFromPlaygroundSource(runtimeSource, { id: current.world.id, seed })
      : current.world;
  // The active World's seed is the authority. The explicit argument is only
  // an initialization fallback for legacy/sample sources without a World
  // seed; it must never overwrite a generator operation's resulting seed.
  const effectiveSeed = world.randomness?.seed ?? seed ?? null;
  const sections = partitionControls(controls, controlDescriptors);
  const nextMutation = runtimeMutation(action, controlDescriptors);
  return validateExperiment({
    ...current,
    world,
    model: { adapterId: adapterId ?? current.model.adapterId, controls: sections.model },
    learning: { controls: sections.learning },
    evaluation: { controls: sections.evaluation },
    randomness: { seed: effectiveSeed, policy: effectiveSeed === null || effectiveSeed === undefined ? 'unspecified' : 'fixed-seed' },
    ...(result !== undefined ? { result: clone(result) } : {}),
    ...(traces ? { traces: clone(traces) } : {}),
    mutations: nextMutation ? [...current.mutations, nextMutation] : current.mutations,
  });
}

export function applyExperimentOperation(experiment, operation) {
  const current = validateExperiment(experiment);
  if (operation?.type === 'SYNC_RUNTIME') {
    return synchronizeExperiment(current, operation);
  }
  if (isPublicWorldOperation(operation?.type)) {
    const result = applyWorldTransaction(current.world, {
      id: operation.transactionId ?? 'experiment-world-operation',
      actor: operation.actor ?? 'system',
      intent: operation.intent ?? operation.type.toLowerCase(),
      operations: [operation],
    });
    return validateExperiment({
      ...current,
      world: result.world,
      result: null,
      mutations: [...current.mutations, result.record],
    });
  }
  throw explorationError('EXPLORATION_INVALID_OPERATION', { type: operation?.type });
}
