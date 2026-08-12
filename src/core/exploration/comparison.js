// Semantic comparison deliberately ignores runtime identity/history. A mixed
// comparison is information about multiple changed factors, not an error.

import { validateExperiment } from './experiment.js';

const FACTORS = ['world', 'trainTest', 'model', 'learning', 'evaluation', 'randomness'];

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
  observations: world.observations.map(({ membership, ...observation }) => observation),
  source: world.source,
  metadata: world.metadata,
});

const trainTestSemantic = (world) => world.observations.map(({ id, membership }) => ({ id, membership }));

export function semanticFactors(experiment) {
  const value = validateExperiment(experiment);
  return {
    world: worldSemantic(value.world),
    trainTest: trainTestSemantic(value.world),
    model: value.model,
    learning: value.learning,
    evaluation: value.evaluation,
    randomness: value.randomness,
  };
}

export function compareExperiments(left, right) {
  const a = semanticFactors(left);
  const b = semanticFactors(right);
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
    clarity: changed.length === 0 ? 'identical' : changed.length === 1 ? 'high' : 'mixed',
  };
}

export function semanticFingerprint(experiment) {
  return stable(semanticFactors(experiment));
}
