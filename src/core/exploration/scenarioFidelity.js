const FACTOR_BY_TARGET = Object.freeze({
  outliers: 'world',
  'test-input-support': 'world',
  'input-distribution': 'world',
  noise: 'world',
  'observation-noise': 'world',
  'observation-values': 'world',
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
  const intended = new Set(spec.intendedFactors ?? spec.change.map((change) => FACTOR_BY_TARGET[change.semanticTarget] ?? change.semanticTarget));
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
  const missing = [...new Set([...confounds, ...unrepresented, ...generatorConfounds, ...generatorUnrepresented])];
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
