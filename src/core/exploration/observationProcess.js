// Derived, session-local semantics for the distinction between a latent World,
// an observation process, and the finite Dataset currently in view. These
// projections never add a second source of truth to World or Experiment.

export const OBSERVATION_PROCESS_VERSION = 1;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value, prefix) {
  let hash = 2166136261;
  for (const character of stable(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function legacyLatent(world) {
  const spec = world.generator?.spec ?? {};
  return {
    relation: spec.relation ?? null,
    task: world.task,
    featureNames: world.featureNames,
  };
}

function recipeLatent(world) {
  const recipe = world.generator?.recipe;
  return recipe ? {
    task: recipe.task,
    featureNames: world.featureNames,
    groups: (recipe.groups ?? []).map((group) => ({
      id: group.id,
      label: group.label,
      shape: group.shape,
      center: group.center,
      radii: group.radii,
      transform: group.transform,
    })),
  } : null;
}

export function deriveWorldIdentity(world) {
  if (!world || typeof world !== 'object') return null;
  const generated = world.mode === 'generated' || Boolean(world.generator?.active);
  const latent = world.generator?.kind === 'world-recipe' ? recipeLatent(world) : legacyLatent(world);
  const semantic = generated
    ? { kind: 'generated-world', latent }
    : { kind: 'finite-sample-world', worldId: world.id, task: world.task, featureNames: world.featureNames };
  return {
    version: OBSERVATION_PROCESS_VERSION,
    kind: semantic.kind,
    latent: generated,
    fingerprint: fingerprint(semantic, 'world'),
    semantic,
  };
}

function legacyObservationProcess(world) {
  const spec = world.generator?.spec ?? {};
  return {
    kind: 'generator-sampling',
    generatorKind: 'legacy-generator',
    train: { input: spec.train?.input ?? null, samples: spec.train?.samples ?? 0 },
    test: { input: spec.test?.input ?? null, samples: spec.test?.samples ?? 0 },
    noise: spec.noise ?? null,
    outliers: spec.outliers ?? null,
  };
}

function recipeObservationProcess(world) {
  const recipe = world.generator?.recipe;
  return {
    kind: 'generator-sampling',
    generatorKind: 'world-recipe',
    task: recipe?.task,
    groups: (recipe?.groups ?? []).map((group) => ({
      id: group.id,
      sampling: group.sampling,
      splitTransforms: group.splitTransforms,
    })),
    noise: recipe?.noise ?? null,
  };
}

export function deriveObservationProcess(world) {
  if (!world || typeof world !== 'object') return null;
  const generated = world.mode === 'generated' || Boolean(world.generator?.active);
  const process = generated
    ? (world.generator?.kind === 'world-recipe' ? recipeObservationProcess(world) : legacyObservationProcess(world))
    : { kind: 'direct-observations', generatorKind: null };
  const realizationSeed = world.generator?.realization?.seed ?? world.randomness?.seed ?? null;
  const semantic = {
    ...process,
    seedPolicy: world.randomness?.policy ?? 'unspecified',
    realizationSeed,
    generated,
  };
  return {
    version: OBSERVATION_PROCESS_VERSION,
    ...semantic,
    fingerprint: fingerprint(semantic, 'observation-process'),
  };
}

function observationSemantic(point) {
  return {
    id: point.id,
    membership: point.membership,
    features: point.features ?? null,
    x: point.x,
    y: point.y,
    target: point.target,
    label: point.label,
  };
}

export function deriveDatasetProvenance(world) {
  if (!world || typeof world !== 'object') return null;
  const worldIdentity = deriveWorldIdentity(world);
  const observationProcess = deriveObservationProcess(world);
  const dataset = {
    worldFingerprint: worldIdentity?.fingerprint ?? null,
    observationProcessFingerprint: observationProcess?.fingerprint ?? null,
    observations: (world.observations ?? []).map(observationSemantic),
  };
  const datasetId = fingerprint(dataset, 'dataset');
  return {
    version: OBSERVATION_PROCESS_VERSION,
    worldId: world.id ?? null,
    worldFingerprint: worldIdentity?.fingerprint ?? null,
    observationProcessFingerprint: observationProcess?.fingerprint ?? null,
    datasetId,
    sampleId: observationProcess?.realizationSeed === null || observationProcess?.realizationSeed === undefined
      ? datasetId
      : `sample-${observationProcess.realizationSeed}`,
    realizationSeed: observationProcess?.realizationSeed ?? null,
    observationCount: Array.isArray(world.observations) ? world.observations.length : 0,
    generated: Boolean(observationProcess?.generated),
    provenance: [...new Set((world.observations ?? []).map((point) => point.provenance).filter(Boolean))],
  };
}

export function deriveWorldDataSemantics(world) {
  return {
    worldIdentity: deriveWorldIdentity(world),
    observationProcess: deriveObservationProcess(world),
    datasetProvenance: deriveDatasetProvenance(world),
  };
}
