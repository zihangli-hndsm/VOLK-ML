// Semantic comparison deliberately ignores runtime identity/history. A mixed
// comparison is information about multiple changed factors, not an error.

import { validateExperiment } from './experiment.js';
import { worldRecipeDiff } from './worldRecipe.js';

const FACTORS = ['world', 'trainTest', 'model', 'learning', 'evaluation', 'randomness'];
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
  task: world.task,
  featureNames: world.featureNames,
  mode: world.mode ?? 'sample',
  generator: world.generator,
  observations: world.observations.map(({ membership, ...observation }) => observation),
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

export function semanticFactors(experiment, { sharedObservationIds = null } = {}) {
  const value = validateExperiment(experiment);
  const modelControls = Object.fromEntries(
    Object.entries(value.model?.controls ?? {}).filter(([key]) => Boolean(canonicalExperimentalControl(null, key))),
  );
  return {
    world: worldSemantic(value.world),
    trainTest: trainTestSemantic(value.world, sharedObservationIds),
    model: { adapterId: value.model.adapterId, controls: modelControls },
    learning: value.learning,
    evaluation: value.evaluation,
    randomness: value.randomness,
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
  const factors = Object.fromEntries(FACTORS.map((factor) => [factor, {
    changed: stable(a[factor]) !== stable(b[factor]),
    left: a[factor],
    right: b[factor],
  }]));
  const changed = FACTORS.filter((factor) => factors[factor].changed);
  return {
    identical: changed.length === 0,
    changed,
    unchanged: FACTORS.filter((factor) => !factors[factor].changed),
    factors,
    details: {
      worldGenerator: worldGeneratorDetails(leftValue.world, rightValue.world),
      worldRecipe: worldRecipeDetails(leftValue.world, rightValue.world),
    },
    clarity: changed.length === 0 ? 'identical' : changed.length === 1 ? 'high' : 'mixed',
  };
}

export function semanticFingerprint(experiment) {
  return stable(semanticFactors(experiment));
}
