// Semantic World contract. A World is always an explicit finite collection of
// observations. A generated World additionally keeps the specification that
// produced the current realization; it never treats the points as a latent
// distribution by themselves.

import { cloneGeneratorSpec, GENERATOR_VERSION } from './generator.js';

export const WORLD_VERSION = 1;
export const WORLD_KIND = 'sample';
export const WORLD_DIMENSION = 2;
export const WORLD_MEMBERSHIPS = ['train', 'test', 'unspecified'];
export const WORLD_PROVENANCE = ['manual', 'generated', 'generated-outlier', 'imported', 'agent'];
export const MAX_WORLD_OBSERVATIONS = 10_000;

const clone = (value) => structuredClone(value);

export function explorationError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

function finite(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw explorationError('EXPLORATION_INVALID_WORLD', { field, value });
  return number;
}

function normalizeMembership(value) {
  const membership = value ?? 'unspecified';
  if (!WORLD_MEMBERSHIPS.includes(membership)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'membership', value });
  }
  return membership;
}

function normalizeProvenance(value, fallback) {
  const provenance = value ?? fallback;
  if (!WORLD_PROVENANCE.includes(provenance)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'provenance', value });
  }
  return provenance;
}

function normalizeObservation(input, index, defaultProvenance) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: `observations[${index}]` });
  }
  const position = input.position ?? {};
  const x = finite(input.x ?? position.x, `observations[${index}].x`);
  const y = finite(input.y ?? position.y, `observations[${index}].y`);
  const id = String(input.id ?? `observation-${index + 1}`);
  if (!id) throw explorationError('EXPLORATION_INVALID_WORLD', { field: `observations[${index}].id` });
  const features = input.features && typeof input.features === 'object' && !Array.isArray(input.features)
    ? Object.fromEntries(Object.entries(input.features).map(([key, value]) => [key, finite(value, `observations[${index}].features.${key}`)]))
    : undefined;
  const observation = {
    id,
    x,
    y,
    membership: normalizeMembership(input.membership ?? input.split),
    provenance: normalizeProvenance(input.provenance, defaultProvenance),
  };
  if (features) observation.features = features;
  if (input.label !== undefined) observation.label = String(input.label);
  if (input.target !== undefined) observation.target = finite(input.target, `observations[${index}].target`);
  if (input.generation && typeof input.generation === 'object' && !Array.isArray(input.generation)) {
    observation.generation = clone(input.generation);
  }
  return observation;
}

function normalizeGeneratorState(generator, { mode, seed }) {
  if (!generator || typeof generator !== 'object' || Array.isArray(generator) || !generator.spec) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'generator' });
  }
  const spec = cloneGeneratorSpec(generator.spec);
  const desiredSeed = generator.seed ?? generator.lastSeed ?? seed ?? null;
  const legacyRealization = mode === 'generated' && !generator.realization && generator.status === 'clean'
    ? { spec, seed: generator.lastSeed ?? seed ?? null }
    : null;
  const realization = generator.realization ?? legacyRealization;
  return {
    version: generator.version ?? GENERATOR_VERSION,
    active: Boolean(generator.active ?? mode === 'generated'),
    status: ['clean', 'dirty', 'modified'].includes(generator.status) ? generator.status : 'dirty',
    spec,
    seed: desiredSeed,
    realization: realization
      ? { spec: cloneGeneratorSpec(realization.spec), seed: realization.seed ?? null }
      : null,
  };
}

const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// These facts deliberately remain separate from the legacy status enum. A
// learner can change the desired generator and then manually edit the
// displayed realization; both facts must remain visible at once.
export function deriveWorldGeneratorFacts(world) {
  const generator = world?.generator;
  if (!generator) return { needsRegeneration: false, hasManualEdits: false };
  const realization = generator.realization;
  const needsRegeneration = !realization
    || !sameValue(generator.spec, realization.spec)
    || generator.seed !== realization.seed;
  const hasManualEdits = (world.observations ?? []).some((point) => (
    point.provenance === 'manual' && point.generation
  ));
  return { needsRegeneration, hasManualEdits };
}

export function createWorld({
  id = 'world-1',
  name = 'Untitled sample world',
  task = null,
  featureNames = ['x', 'y'],
  observations = [],
  provenance = 'manual',
  seed = null,
  source = null,
  metadata = {},
  mode = 'sample',
  generator = null,
} = {}) {
  if (!['regression', 'classification', null].includes(task)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'task', value: task });
  }
  if (!Array.isArray(featureNames) || featureNames.length < 2 || featureNames.some((name) => typeof name !== 'string' || !name)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'featureNames' });
  }
  if (!Array.isArray(observations) || observations.length > MAX_WORLD_OBSERVATIONS) {
    throw explorationError('EXPLORATION_RESOURCE_LIMIT', { field: 'observations', max: MAX_WORLD_OBSERVATIONS });
  }
  const normalized = observations.map((observation, index) => normalizeObservation(observation, index, provenance));
  const ids = new Set();
  for (const observation of normalized) {
    if (ids.has(observation.id)) throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'observation.id', value: observation.id });
    ids.add(observation.id);
  }
  if (!['sample', 'generated'].includes(mode)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'mode', value: mode });
  }
  const normalizedGenerator = generator ? normalizeGeneratorState(generator, { mode, seed }) : null;
  if (mode === 'generated' && !normalizedGenerator) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'generator' });
  }
  return validateWorld({
    version: WORLD_VERSION,
    kind: WORLD_KIND,
    dimension: WORLD_DIMENSION,
    id: String(id),
    name: String(name),
    task,
    featureNames: [...featureNames],
    observations: normalized,
    source: source ? clone(source) : null,
    mode,
    generator: normalizedGenerator,
    randomness: { seed: seed ?? null, policy: seed === null || seed === undefined ? 'unspecified' : 'fixed-seed' },
    metadata: clone(metadata),
  });
}

export function validateWorld(world) {
  if (!world || typeof world !== 'object' || Array.isArray(world)) {
    throw explorationError('EXPLORATION_INVALID_WORLD');
  }
  if (world.version !== WORLD_VERSION || world.kind !== WORLD_KIND || world.dimension !== WORLD_DIMENSION) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { version: world.version, kind: world.kind, dimension: world.dimension });
  }
  if (!Array.isArray(world.observations) || world.observations.length > MAX_WORLD_OBSERVATIONS) {
    throw explorationError('EXPLORATION_RESOURCE_LIMIT', { field: 'observations', max: MAX_WORLD_OBSERVATIONS });
  }
  if (!['regression', 'classification', null].includes(world.task ?? null)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'task', value: world.task });
  }
  if (!Array.isArray(world.featureNames) || world.featureNames.length < 2 || world.featureNames.some((name) => typeof name !== 'string' || !name)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'featureNames' });
  }
  const mode = world.mode ?? 'sample';
  if (!['sample', 'generated'].includes(mode)) throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'mode', value: mode });
  let generator = null;
  if (world.generator) {
    generator = normalizeGeneratorState(world.generator, {
      mode,
      seed: world.randomness?.seed ?? null,
    });
  }
  if (mode === 'generated' && (!generator || !generator.active || !generator.realization)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'generator.active' });
  }
  const defaultProvenance = world.observations[0]?.provenance ?? 'manual';
  const observations = world.observations.map((observation, index) => normalizeObservation(observation, index, defaultProvenance));
  const ids = new Set();
  for (const observation of observations) {
    if (ids.has(observation.id)) throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'observation.id', value: observation.id });
    ids.add(observation.id);
  }
  return clone({
    version: WORLD_VERSION,
    kind: WORLD_KIND,
    dimension: WORLD_DIMENSION,
    id: String(world.id),
    name: String(world.name),
    task: world.task ?? null,
    featureNames: [...world.featureNames],
    observations,
    source: world.source ? clone(world.source) : null,
    mode,
    generator,
    randomness: {
      seed: world.randomness?.seed ?? null,
      policy: world.randomness?.policy ?? (world.randomness?.seed === null || world.randomness?.seed === undefined ? 'unspecified' : 'fixed-seed'),
    },
    metadata: clone(world.metadata ?? {}),
  });
}

export const cloneWorld = (world) => validateWorld(clone(world));

export function worldFromPlaygroundSource(source, { seed = null, id = 'world-1' } = {}) {
  if (!source || typeof source !== 'object' || !Array.isArray(source.points)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'source' });
  }
  const classification = source.task === 'classification'
    || (!source.task && Array.isArray(source.featureColumns) && source.featureColumns.length >= 2 && !source.target);
  const inputFeatureNames = Array.isArray(source.featureColumns) && source.featureColumns.length
    ? [...source.featureColumns]
    : [source.feature ?? 'x'];
  const targetFeature = source.target ?? 'y';
  const featureNames = classification
    ? inputFeatureNames
    : [...new Set([...inputFeatureNames, targetFeature])];
  const defaultProvenance = source.kind === 'workspace-dataset' ? 'imported' : 'generated';
  const observations = source.points.map((point, index) => {
    if (classification) {
      const values = featureNames.map((feature) => finite(point.features?.[feature] ?? point[feature], `source.points[${index}].${feature}`));
      return {
        id: point.id ?? `observation-${index + 1}`,
        x: values[0],
        y: values[1],
        features: Object.fromEntries(featureNames.map((feature, featureIndex) => [feature, values[featureIndex]])),
        label: point.label,
        membership: point.membership ?? point.split,
        provenance: point.provenance,
      };
    }
    const features = Object.fromEntries(inputFeatureNames.map((feature) => [
      feature,
      finite(
        point.features?.[feature]
          ?? point[feature]
          ?? (feature === source.feature ? point.x : undefined),
        `source.points[${index}].${feature}`,
      ),
    ]));
    const target = finite(
      point.features?.[targetFeature]
        ?? point[targetFeature]
        ?? point.target
        ?? point.y,
      `source.points[${index}].${targetFeature}`,
    );
    features[targetFeature] = target;
    const modelFeature = source.feature ?? inputFeatureNames[0] ?? 'x';
    return {
      id: point.id ?? `observation-${index + 1}`,
      x: features[modelFeature] ?? finite(point.x, `source.points[${index}].x`),
      y: target,
      target,
      features,
      membership: point.membership ?? point.split,
      provenance: point.provenance,
    };
  });
  return createWorld({
    id,
    name: source.name ?? 'Playground sample world',
    task: classification ? 'classification' : 'regression',
    featureNames,
    observations,
    provenance: defaultProvenance,
    seed,
    source: {
      kind: source.kind ?? null,
      fingerprint: source.fingerprint ?? null,
      name: source.name ?? null,
    },
    metadata: classification ? {} : {
      modelFeature: source.feature ?? inputFeatureNames[0] ?? 'x',
      targetFeature,
    },
  });
}

export function serializeWorld(world) {
  return JSON.stringify(validateWorld(world));
}

export function deserializeWorld(serialized) {
  try {
    return validateWorld(JSON.parse(serialized));
  } catch (error) {
    if (error.code === 'EXPLORATION_INVALID_WORLD' || error.code === 'EXPLORATION_RESOURCE_LIMIT') throw error;
    throw explorationError('EXPLORATION_INVALID_WORLD', { reason: 'invalid-json' });
  }
}
