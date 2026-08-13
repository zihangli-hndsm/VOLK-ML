import { normalizeGeneratorSpec } from './generator.js';

export const AFFORDANCE_IDS = Object.freeze([
  'experiment.duplicate',
  'experiment.compare',
  'experiment.repeat',
  'world.point',
  'world.outlier',
  'world.trainTestLayer',
  'world.generator.trainInput',
  'world.generator.testInput',
  'world.generator.noise',
  'world.generator.sampleCount',
  'model.run',
]);

export const THINGS_TO_TRY = Object.freeze([
  { id: 'outlier', questionKey: 'playground.guidance.try.outlier', approachKey: 'playground.guidance.approach.outlier', affordances: ['world.outlier', 'experiment.duplicate', 'experiment.compare'] },
  { id: 'test-support', questionKey: 'playground.guidance.try.testSupport', approachKey: 'playground.guidance.approach.testSupport', affordances: ['experiment.duplicate', 'world.generator.testInput', 'experiment.compare'] },
  { id: 'noise', questionKey: 'playground.guidance.try.noise', approachKey: 'playground.guidance.approach.noise', affordances: ['world.generator.noise', 'experiment.repeat'] },
  { id: 'more-data', questionKey: 'playground.guidance.try.moreData', approachKey: 'playground.guidance.approach.moreData', affordances: ['world.generator.sampleCount', 'experiment.repeat'] },
  { id: 'two-factors', questionKey: 'playground.guidance.try.twoFactors', approachKey: 'playground.guidance.approach.twoFactors', affordances: ['experiment.duplicate', 'experiment.compare'] },
]);

const cleanSpec = normalizeGeneratorSpec({
  relation: { slope: 2, bias: 1 },
  noise: { amount: 0.35 },
  train: { input: { type: 'uniform', params: { min: -1, max: 1 } }, samples: 30 },
  test: { input: { type: 'uniform', params: { min: -1, max: 1 } }, samples: 20 },
  outliers: { count: 0 },
});

export const EXPLORATION_RECIPES = Object.freeze([
  {
    id: 'train-test-shift',
    questionKey: 'playground.recipe.trainTestShift.question',
    approachKey: 'playground.recipe.trainTestShift.approach',
    affordances: ['experiment.duplicate', 'world.generator.testInput', 'experiment.compare'],
    setup: { spec: cleanSpec, seed: 42 },
  },
  {
    id: 'outlier',
    questionKey: 'playground.recipe.outlier.question',
    approachKey: 'playground.recipe.outlier.approach',
    affordances: ['experiment.duplicate', 'world.outlier', 'model.run', 'experiment.compare'],
    setup: { spec: cleanSpec, seed: 42 },
  },
]);

export function recipeById(id) {
  return EXPLORATION_RECIPES.find((recipe) => recipe.id === id) ?? null;
}
