// Semantic World contract. A World is always an explicit finite collection of
// observations. A generated World additionally keeps the specification that
// produced the current realization; it never treats the points as a latent
// distribution by themselves.

import { cloneGeneratorSpec, GENERATOR_VERSION } from './generator.js';
import { normalizeWorldRecipe, WORLD_RECIPE_VERSION } from './worldRecipe.js';
import { domainSupportsTask, getExplorationDomainContract, normalizeDomainObservationPayload, normalizeExplorationDomain } from './domainContract.js';

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

function normalizeObservation(input, index, defaultProvenance, domain = 'tabular') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: `observations[${index}]` });
  }
  const position = input.position ?? {};
  const x = finite(input.x ?? position.x ?? (domain === 'tabular' ? undefined : index), `observations[${index}].x`);
  const y = finite(input.y ?? position.y ?? (domain === 'tabular' ? undefined : 0), `observations[${index}].y`);
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
  let payload;
  try {
    payload = normalizeDomainObservationPayload(domain, input.payload, `observations[${index}].payload`);
  } catch (error) {
    if (error?.code === 'EXPLORATION_DOMAIN_PAYLOAD_INVALID' || error?.code === 'EXPLORATION_DOMAIN_UNSUPPORTED') {
      throw explorationError('EXPLORATION_INVALID_WORLD', {
        field: error.details?.field ?? `observations[${index}].payload`,
        reason: error.code,
      });
    }
    throw error;
  }
  if (payload !== undefined) observation.payload = payload;
  return observation;
}

function normalizeGeneratorState(generator, { mode, seed }) {
  if (!generator || typeof generator !== 'object' || Array.isArray(generator)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'generator' });
  }
  const kind = generator.kind ?? (generator.recipe ? 'world-recipe' : 'legacy-generator');
  if (!['legacy-generator', 'world-recipe'].includes(kind)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'generator.kind', value: kind });
  }
  const spec = kind === 'legacy-generator' ? cloneGeneratorSpec(generator.spec) : null;
  const recipe = kind === 'world-recipe' ? normalizeWorldRecipe(generator.recipe) : null;
  if (kind === 'legacy-generator' && !generator.spec) throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'generator.spec' });
  if (kind === 'world-recipe' && generator.spec) throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'generator.spec', reason: 'recipe-generator-cannot-have-legacy-spec' });
  const desiredSeed = generator.seed ?? generator.lastSeed ?? seed ?? null;
  const legacyRealization = mode === 'generated' && !generator.realization && generator.status === 'clean'
    ? { kind, ...(kind === 'legacy-generator' ? { spec } : { recipe }), seed: generator.lastSeed ?? seed ?? null }
    : null;
  const realization = generator.realization ?? legacyRealization;
  if (realization && realization.kind !== undefined && realization.kind !== kind) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'generator.realization.kind', value: realization.kind, reason: 'generator-kind-mismatch' });
  }
  const normalizedRealization = realization
    ? {
      kind: realization.kind ?? kind,
      ...(kind === 'legacy-generator' ? { spec: cloneGeneratorSpec(realization.spec) } : { recipe: normalizeWorldRecipe(realization.recipe) }),
      seed: realization.seed ?? null,
    }
    : null;
  return {
    kind,
    version: generator.version ?? (kind === 'world-recipe' ? WORLD_RECIPE_VERSION : GENERATOR_VERSION),
    active: Boolean(generator.active ?? mode === 'generated'),
    status: ['clean', 'dirty', 'modified'].includes(generator.status) ? generator.status : 'dirty',
    ...(kind === 'legacy-generator' ? { spec } : { recipe }),
    seed: desiredSeed,
    realization: normalizedRealization,
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
    || generator.kind !== realization.kind
    || !sameValue(generator.kind === 'world-recipe' ? generator.recipe : generator.spec, generator.kind === 'world-recipe' ? realization.recipe : realization.spec)
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
  domain = 'tabular',
  coordinateSpace = null,
  featureNames = ['x', 'y'],
  observations = [],
  provenance = 'manual',
  seed = null,
  source = null,
  metadata = {},
  mode = 'sample',
  generator = null,
} = {}) {
  const normalizedDomain = normalizeExplorationDomain(domain);
  const normalizedCoordinateSpace = coordinateSpace ?? getExplorationDomainContract(normalizedDomain)?.coordinateSpaces?.[0] ?? 'plot2d';
  if (!getExplorationDomainContract(normalizedDomain)?.coordinateSpaces.includes(normalizedCoordinateSpace)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'coordinateSpace', value: normalizedCoordinateSpace, domain: normalizedDomain });
  }
  if (task !== null && task !== undefined && !domainSupportsTask(normalizedDomain, task)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'task', value: task });
  }
  const minimumFeatureNames = normalizedDomain === 'tabular' ? 2 : 0;
  if (!Array.isArray(featureNames) || featureNames.length < minimumFeatureNames || featureNames.some((name) => typeof name !== 'string' || !name)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'featureNames' });
  }
  if (!Array.isArray(observations) || observations.length > MAX_WORLD_OBSERVATIONS) {
    throw explorationError('EXPLORATION_RESOURCE_LIMIT', { field: 'observations', max: MAX_WORLD_OBSERVATIONS });
  }
  const normalized = observations.map((observation, index) => normalizeObservation(observation, index, provenance, normalizedDomain));
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
    domain: normalizedDomain,
    coordinateSpace: normalizedCoordinateSpace,
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
  const domain = normalizeExplorationDomain(world.domain ?? 'tabular');
  const coordinateSpace = world.coordinateSpace ?? getExplorationDomainContract(domain)?.coordinateSpaces?.[0] ?? 'plot2d';
  if (!getExplorationDomainContract(domain)?.coordinateSpaces.includes(coordinateSpace)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'coordinateSpace', value: coordinateSpace, domain });
  }
  if (world.task !== null && world.task !== undefined && !domainSupportsTask(domain, world.task)) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'task', value: world.task });
  }
  const minimumFeatureNames = domain === 'tabular' ? 2 : 0;
  if (!Array.isArray(world.featureNames) || world.featureNames.length < minimumFeatureNames || world.featureNames.some((name) => typeof name !== 'string' || !name)) {
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
  if (mode === 'generated' && generator?.realization) {
    const realizationTask = generator.kind === 'world-recipe'
      ? generator.realization.recipe.task
      : 'regression';
    if (world.task !== realizationTask) {
      throw explorationError('EXPLORATION_INVALID_WORLD', {
        field: 'task',
        value: world.task,
        expected: realizationTask,
        reason: 'task-realization-mismatch',
      });
    }
  }
  const defaultProvenance = world.observations[0]?.provenance ?? 'manual';
  const observations = world.observations.map((observation, index) => normalizeObservation(observation, index, defaultProvenance, domain));
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
    domain,
    coordinateSpace,
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
  if (!source || typeof source !== 'object' || (!Array.isArray(source.points) && !Array.isArray(source.samples))) {
    throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'source' });
  }
  if (source.domain && source.domain !== 'tabular') {
    const domain = normalizeExplorationDomain(source.domain);
    const samples = source.samples ?? [];
    const labels = [...new Set(samples.map((sample) => String(sample.label ?? '')))].filter(Boolean);
    const labelIndex = new Map(labels.map((label, index) => [label, index]));
    const observations = samples.map((sample, index) => ({
      id: sample.id ?? `observation-${index + 1}`,
      x: index,
      y: labelIndex.get(String(sample.label ?? '')) ?? 0,
      label: sample.label,
      membership: sample.membership ?? sample.split,
      provenance: sample.provenance,
      payload: sample.payload,
    }));
    const contract = getExplorationDomainContract(domain);
    if (!contract?.taskKinds.includes(source.task)) {
      throw explorationError('EXPLORATION_INVALID_WORLD', { field: 'task', value: source.task, domain });
    }
    return createWorld({
      id,
      name: source.name ?? `${domain} sample world`,
      task: source.task,
      domain,
      featureNames: [],
      observations,
      provenance: source.kind === 'workspace-dataset' ? 'imported' : 'generated',
      seed,
      source: { kind: source.kind ?? null, fingerprint: source.fingerprint ?? null, name: source.name ?? null },
    });
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
    domain: source.domain ?? 'tabular',
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
