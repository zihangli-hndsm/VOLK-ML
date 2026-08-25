// Semantic comparison deliberately ignores runtime identity/history. A mixed
// comparison is information about multiple changed factors, not an error.

import { validateExperiment } from './experiment.js';
import { worldRecipeDiff } from './worldRecipe.js';
import { deriveObservationProcess, deriveWorldIdentity } from './observationProcess.js';

const FACTORS = ['world', 'observationProcess', 'trainTest', 'model', 'learning', 'evaluation', 'randomness'];
const DERIVED_MODEL_CONTROLS = new Set(['weight', 'bias']);

// A control can be a valid runtime/inspection field without being part of an
// Experiment's canonical condition. Consumers use this same policy rather
// than independently treating every SET_CONTROL as an experiment factor.
export function canonicalExperimentalControl(controlDescriptor, key = controlDescriptor?.key) {
  const normalizedKey = String(key ?? '');
  if (!normalizedKey || DERIVED_MODEL_CONTROLS.has(normalizedKey)) return null;
  const domain = controlDescriptor?.domain;
  if (domain === 'view') return null;
  return {
    key: normalizedKey,
    comparisonFactor: domain === 'learning'
      ? 'learning'
      : domain === 'evaluation'
        ? 'evaluation'
        : 'model',
  };
}

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const worldSemantic = (world) => ({
  kind: world.kind,
  dimension: world.dimension,
  domain: world.domain ?? 'tabular',
  coordinateSpace: world.coordinateSpace ?? 'plot2d',
  task: world.task,
  featureNames: world.featureNames,
  mode: world.mode ?? 'sample',
  identity: deriveWorldIdentity(world)?.semantic ?? null,
  // A generated World is the mechanism, not this particular finite draw.
  // Finite/manual Worlds have no latent mechanism claim, so their observations
  // remain part of the World factor.
  generator: world.mode === 'generated' && world.generator?.status !== 'modified' ? null : world.generator,
  observations: world.mode === 'generated' && world.generator?.status !== 'modified'
    ? null
    : world.observations.map(({ membership, ...observation }) => observation),
  source: world.source,
  metadata: world.metadata,
});

const generatorSemantic = (world) => {
  if (world.generator?.kind === 'world-recipe') {
    return {
      kind: 'world-recipe',
      recipe: world.generator.recipe,
      seedPolicy: {
        policy: world.randomness?.policy ?? 'unspecified',
        seed: world.randomness?.seed ?? null,
      },
    };
  }
  const spec = world.generator?.spec;
  if (!spec) return null;
  return {
    trainInput: spec.train?.input,
    testInput: spec.test?.input,
    relation: spec.relation,
    noise: spec.noise,
    samples: { train: spec.train?.samples ?? 0, test: spec.test?.samples ?? 0 },
    outliers: spec.outliers,
    seedPolicy: {
      policy: world.randomness?.policy ?? 'unspecified',
      seed: world.randomness?.seed ?? null,
    },
  };
};

function worldGeneratorDetails(left, right) {
  if (left.generator?.kind === 'world-recipe' || right.generator?.kind === 'world-recipe') {
    return { changed: [], unchanged: [], left: null, right: null };
  }
  const a = generatorSemantic(left);
  const b = generatorSemantic(right);
  if (!a && !b) return { changed: [], left: null, right: null };
  const fields = [
    ['trainInputDistribution', a?.trainInput, b?.trainInput],
    ['testInputDistribution', a?.testInput, b?.testInput],
    ['linearRelation', a?.relation, b?.relation],
    ['noise', a?.noise, b?.noise],
    ['sampleCount', a?.samples, b?.samples],
    ['outliers', a?.outliers, b?.outliers],
    ['seedPolicy', a?.seedPolicy, b?.seedPolicy],
  ];
  return {
    changed: fields.filter(([, leftValue, rightValue]) => stable(leftValue) !== stable(rightValue)).map(([key]) => key),
    unchanged: fields.filter(([, leftValue, rightValue]) => stable(leftValue) === stable(rightValue)).map(([key]) => key),
    changedPaths: fields
      .filter(([, leftValue, rightValue]) => stable(leftValue) !== stable(rightValue))
      .map(([key]) => ({
        trainInputDistribution: 'world.train.input',
        testInputDistribution: 'world.test.input',
        linearRelation: 'world.relation',
        noise: 'world.noise',
        sampleCount: 'world.sampleCount',
        outliers: 'world.outliers',
        seedPolicy: 'world.seed-policy',
      }[key] ?? `world.${key}`)),
    unchangedPaths: fields
      .filter(([, leftValue, rightValue]) => stable(leftValue) === stable(rightValue))
      .map(([key]) => ({
        trainInputDistribution: 'world.train.input',
        testInputDistribution: 'world.test.input',
        linearRelation: 'world.relation',
        noise: 'world.noise',
        sampleCount: 'world.sampleCount',
        outliers: 'world.outliers',
        seedPolicy: 'world.seed-policy',
      }[key] ?? `world.${key}`)),
    left: a,
    right: b,
  };
}

function worldRecipeDetails(left, right) {
  const leftRecipe = left.generator?.kind === 'world-recipe' ? left.generator.recipe : null;
  const rightRecipe = right.generator?.kind === 'world-recipe' ? right.generator.recipe : null;
  if (!leftRecipe && !rightRecipe) return { changedPaths: [], unchangedPaths: [], affectedGroupIds: [], changedSplits: [], left: null, right: null };
  if (!leftRecipe || !rightRecipe) return { changedPaths: ['recipe-kind'], unchangedPaths: [], affectedGroupIds: [], changedSplits: [], left: leftRecipe, right: rightRecipe };
  const diff = worldRecipeDiff(leftRecipe, rightRecipe);
  const changedSplits = [...new Set(diff.changedPaths.map((path) => path.match(/\.(train|test)(?:\.|$)/)?.[1]).filter(Boolean))];
  return { ...diff, changedSplits };
}

const trainTestSemantic = (world, sharedIds = null) => world.observations
  .filter(({ id }) => !sharedIds || sharedIds.has(id))
  .map(({ id, membership }) => ({ id, membership: membership === 'test' ? 'test' : 'train' }));

function changedObjectPaths(left, right, prefix) {
  const keys = [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].sort();
  return keys.filter((key) => stable(left?.[key]) !== stable(right?.[key]))
    .map((key) => `${prefix}.${key}`);
}

function unchangedObjectPaths(left, right, prefix) {
  const keys = [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].sort();
  return keys.filter((key) => stable(left?.[key]) === stable(right?.[key]))
    .map((key) => `${prefix}.${key}`);
}

// Runtime fidelity retains leaf paths (including vector components), while
// learner-facing factor identity groups components that belong to one
// semantic property. This keeps a two-component translation one intervention
// without losing the exact leaf paths used by fidelity.
function semanticFactorPath(path) {
  return String(path)
    .replace(/(\.points\.\d+)\.\d+$/, '$1')
    .replace(/\.(translate|scale|innerOffset|radii|start|end|center|min|max)\.\d+$/, '.$1');
}

function semanticChangedPaths(a, b, details) {
  const generatorPaths = a.world?.generator?.kind === 'world-recipe' || b.world?.generator?.kind === 'world-recipe'
    ? (details.worldRecipe?.changedPaths ?? []).map((path) => `world.recipe${path}`)
    : (details.worldGenerator?.changedPaths ?? []);
  const worldPaths = generatorPaths.filter((path) => path === 'world.relation' || path.startsWith('world.recipe'));
  const observationPaths = generatorPaths
    .filter((path) => !worldPaths.includes(path))
    .map((path) => path.replace(/^world\./, 'observationProcess.'));
  const worldKindChanged = a.world?.identity?.kind !== b.world?.identity?.kind;
  if (!worldKindChanged && stable(a.observationProcess) !== stable(b.observationProcess) && observationPaths.length === 0) {
    observationPaths.push('observationProcess.sample');
  }
  const trainTestChanged = stable(a.trainTest) !== stable(b.trainTest) ? ['world.train-test.membership'] : [];
  const worldObservationChanged = stable(a.world) !== stable(b.world)
    && worldPaths.length === 0
    ? ['world.observations']
    : [];
  const modelPaths = [
    ...changedObjectPaths(a.model?.controls, b.model?.controls, 'model.controls'),
    ...(a.model?.adapterId !== b.model?.adapterId ? ['model.adapter'] : []),
  ];
  const learningPaths = changedObjectPaths(a.learning?.controls, b.learning?.controls, 'learning.controls');
  const evaluationPaths = changedObjectPaths(a.evaluation?.controls, b.evaluation?.controls, 'evaluation.controls');
  const randomnessPaths = changedObjectPaths(a.randomness, b.randomness, 'randomness');
  return [...new Set([...worldPaths, ...observationPaths, ...worldObservationChanged, ...trainTestChanged, ...modelPaths, ...learningPaths, ...evaluationPaths, ...randomnessPaths])];
}

function semanticUnchangedPaths(a, b, details) {
  const worldPaths = a.world?.generator?.kind === 'world-recipe' || b.world?.generator?.kind === 'world-recipe'
    ? (details.worldRecipe?.unchangedPaths ?? []).map((path) => `world.recipe${path}`)
    : (details.worldGenerator?.unchangedPaths ?? []);
  const trainTestPaths = stable(a.trainTest) === stable(b.trainTest) ? ['world.train-test.membership'] : [];
  const modelPaths = [...new Set([...Object.keys(a.model?.controls ?? {}), ...Object.keys(b.model?.controls ?? {})])].sort().filter((key) => canonicalExperimentalControl(null, key)
    && stable(a.model.controls[key]) === stable(b.model?.controls?.[key]))
    .map((key) => `model.controls.${key}`);
  const learningPaths = unchangedObjectPaths(a.learning?.controls, b.learning?.controls, 'learning.controls');
  const evaluationPaths = unchangedObjectPaths(a.evaluation?.controls, b.evaluation?.controls, 'evaluation.controls');
  const randomnessPaths = unchangedObjectPaths(a.randomness, b.randomness, 'randomness');
  return [...new Set([...worldPaths, ...trainTestPaths, ...modelPaths, ...learningPaths, ...evaluationPaths, ...randomnessPaths])];
}

export function comparisonChangedPaths(diff) {
  if (Array.isArray(diff?.semanticChangedPaths)) return [...new Set(diff.semanticChangedPaths)];
  return Array.isArray(diff?.changed) ? [...new Set(diff.changed)] : [];
}

export function hasCanonicalComparisonPaths(diff) {
  return Array.isArray(diff?.semanticChangedPaths);
}

export function comparisonFactorCount(diff) {
  if (Array.isArray(diff?.semanticFactorPaths)) return [...new Set(diff.semanticFactorPaths)].length;
  return comparisonChangedPaths(diff).length;
}

export function semanticFactors(experiment, { sharedObservationIds = null } = {}) {
  const value = validateExperiment(experiment);
  const modelControls = Object.fromEntries(
    Object.entries(value.model?.controls ?? {}).filter(([key]) => Boolean(canonicalExperimentalControl(null, key))),
  );
  return {
    world: worldSemantic(value.world),
    observationProcess: deriveObservationProcess(value.world),
    trainTest: trainTestSemantic(value.world, sharedObservationIds),
    model: { adapterId: value.model.adapterId, controls: modelControls },
    learning: value.learning,
    evaluation: value.evaluation,
    randomness: { policy: value.randomness?.policy ?? 'unspecified' },
  };
}

export function compareExperiments(left, right) {
  const leftValue = validateExperiment(left);
  const rightValue = validateExperiment(right);
  const leftIds = new Set(leftValue.world.observations.map(({ id }) => id));
  const rightIds = new Set(rightValue.world.observations.map(({ id }) => id));
  const sharedObservationIds = new Set([...leftIds].filter((id) => rightIds.has(id)));
  const a = semanticFactors(leftValue, { sharedObservationIds });
  const b = semanticFactors(rightValue, { sharedObservationIds });
  const worldKindChanged = a.world?.identity?.kind !== b.world?.identity?.kind;
  const factors = Object.fromEntries(FACTORS.map((factor) => [factor, {
    changed: factor === 'observationProcess'
      ? !worldKindChanged && stable(a[factor]) !== stable(b[factor])
      : stable(a[factor]) !== stable(b[factor]),
    left: a[factor],
    right: b[factor],
  }]));
  const details = {
    worldGenerator: worldGeneratorDetails(leftValue.world, rightValue.world),
    worldRecipe: worldRecipeDetails(leftValue.world, rightValue.world),
    observationProcess: {
      left: a.observationProcess,
      right: b.observationProcess,
      changed: stable(a.observationProcess) !== stable(b.observationProcess),
    },
  };
  const semanticPaths = semanticChangedPaths(a, b, details);
  const semanticFactorPaths = [...new Set(semanticPaths.map(semanticFactorPath))];
  const semanticHeldPaths = semanticUnchangedPaths(a, b, details);
  const factorChanged = FACTORS.filter((factor) => factors[factor].changed);
  // Keep the legacy changed[] vocabulary stable for existing callers that
  // treated generator configuration as a World edit. New consumers should use
  // factors/semantic paths, where sampling is explicitly distinct.
  const legacyChanged = factorChanged.length === 1
    && factorChanged[0] === 'observationProcess'
    && ((details.worldGenerator?.changed ?? []).some((field) => field !== 'seedPolicy')
      || (details.worldRecipe?.changedPaths ?? []).length > 0)
    ? ['world']
    : factorChanged;
  return {
    identical: factorChanged.length === 0,
    changed: legacyChanged,
    changedFactors: factorChanged,
    unchanged: FACTORS.filter((factor) => !factors[factor].changed),
    factors,
    semanticChangedPaths: semanticPaths,
    semanticFactorPaths,
    semanticUnchangedPaths: semanticHeldPaths,
    semanticFactorCount: semanticFactorPaths.length,
    details,
    clarity: semanticFactorPaths.length === 0 ? 'identical' : semanticFactorPaths.length === 1 ? 'high' : 'mixed',
  };
}

export function semanticFingerprint(experiment) {
  return stable(semanticFactors(experiment));
}
