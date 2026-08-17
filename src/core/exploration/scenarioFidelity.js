import { worldRecipePathSemanticDomain } from './worldRecipe.js';

const FACTOR_BY_TARGET = Object.freeze({
  outliers: 'world',
  'test-input-support': 'world',
  'input-distribution': 'world',
  noise: 'world',
  'observation-noise': 'world',
  'observation-values': 'world',
  'world-recipe': 'world',
  'learning-configuration': 'learning',
  'model-configuration': 'model',
});

const HOLD_TO_FACTOR = Object.freeze({
  'model-configuration': 'model',
  'learning-configuration': 'learning',
  'evaluation-configuration': 'evaluation',
  'train-distribution': 'world',
  'latent-relation': 'world',
  noise: 'world',
  'existing-train-test-setup': 'trainTest',
});

const TARGET_TO_GENERATOR_DETAIL = Object.freeze({
  outliers: 'outliers',
  noise: 'noise',
  'observation-noise': 'noise',
  'test-input-support': 'testInputDistribution',
  'input-distribution': 'trainInputDistribution',
});

const TARGET_TO_GENERATOR_DETAILS = Object.freeze({
  'input-distribution': ['trainInputDistribution', 'testInputDistribution'],
});

const HOLD_TO_GENERATOR_DETAIL = Object.freeze({
  noise: 'noise',
  'latent-relation': 'linearRelation',
  'train-distribution': 'trainInputDistribution',
});

export function evaluateScenarioFidelity(spec, comparison) {
  const changed = new Set(comparison?.changed ?? []);
  const intended = new Set((spec.intendedFactors ?? spec.change.map((change) => change.semanticTarget)).map((factor) => FACTOR_BY_TARGET[factor] ?? factor));
  const held = new Set(spec.hold.map((item) => HOLD_TO_FACTOR[item] ?? item));
  const confounds = [...held].filter((factor) => changed.has(factor) && !intended.has(factor));
  const unrepresented = [...changed].filter((factor) => !intended.has(factor));
  const generatorChanged = new Set(comparison?.details?.worldGenerator?.changed ?? []);
  const intendedGenerator = new Set(spec.change.flatMap((change) => (
    TARGET_TO_GENERATOR_DETAILS[change.semanticTarget]
      ?? [TARGET_TO_GENERATOR_DETAIL[change.semanticTarget]]
  )).filter(Boolean));
  const heldGenerator = new Set(spec.hold.map((item) => HOLD_TO_GENERATOR_DETAIL[item]).filter(Boolean));
  const generatorConfounds = [...heldGenerator].filter((field) => generatorChanged.has(field));
  const generatorUnrepresented = [...generatorChanged].filter((field) => !intendedGenerator.has(field));
  const recipeChanged = comparison?.details?.worldRecipe?.changedPaths ?? [];
  const recipeDomains = new Set(recipeChanged.map(worldRecipePathSemanticDomain));
  const declaredRecipeDomains = new Set(spec.intendedWorldRecipeDomains ?? []);
  const declaredRecipePaths = Array.isArray(spec.intendedWorldRecipePaths) ? new Set(spec.intendedWorldRecipePaths) : null;
  const recipeMissing = [];
  if (declaredRecipePaths?.has('whole-recipe') || (!declaredRecipePaths && declaredRecipeDomains.has('whole-recipe'))) {
    // A create-world design is explicitly a whole-recipe replacement. Its many
    // path changes are intentional, not hidden confounds.
  } else if (declaredRecipePaths) {
    for (const path of recipeChanged) {
      if (!declaredRecipePaths.has(path)) recipeMissing.push(`recipe:extra-path:${path}`);
    }
    for (const path of declaredRecipePaths) {
      if (!recipeChanged.includes(path)) recipeMissing.push(`recipe:missing-path:${path}`);
    }
  } else if (recipeChanged.length && !declaredRecipeDomains.size) {
    recipeMissing.push('recipe-domains-unclassified');
  } else {
    for (const domain of recipeDomains) {
      if (!declaredRecipeDomains.has(domain)) recipeMissing.push(`recipe:${domain}`);
    }
    for (const domain of declaredRecipeDomains) {
      if (domain !== 'whole-recipe' && !recipeDomains.has(domain)) recipeMissing.push(`recipe:not-changed:${domain}`);
    }
  }
  const missing = [...new Set([...confounds, ...unrepresented, ...generatorConfounds, ...generatorUnrepresented, ...recipeMissing])];
  const status = missing.length
    ? 'partial'
    : spec.approximation ? 'approximate' : 'exact';
  return {
    status,
    represented: [...changed].filter((factor) => !missing.includes(factor)),
    missing,
    approximations: spec.approximation
      ? [spec.approximation]
      : status === 'partial' ? ['Actual semantic diff contains a factor outside the declared one-factor proposal.'] : [],
  };
}
