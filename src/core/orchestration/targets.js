// Stable semantic affordance targets. UI layers resolve these names to the
// current rendered controls; contracts never depend on DOM selectors.
export const SEMANTIC_AFFORDANCE_TARGETS = Object.freeze({
  WORLD_CANVAS: 'world.canvas',
  WORLD_NOISE: 'world.noise',
  WORLD_SAMPLE: 'world.sample',
  MODEL_FIT: 'model.fit',
  EXPERIMENT_COMPARE: 'experiment.compare',
  EVIDENCE_CURRENT: 'evidence.current',
});

export const SEMANTIC_AFFORDANCE_TARGET_REGISTRY = Object.freeze(Object.fromEntries(
  Object.values(SEMANTIC_AFFORDANCE_TARGETS).map((id) => [id, Object.freeze({ id })]),
));

export function isSemanticAffordanceTarget(value) {
  return typeof value === 'string' && Object.hasOwn(SEMANTIC_AFFORDANCE_TARGET_REGISTRY, value);
}

export function listSemanticAffordanceTargets() {
  return Object.keys(SEMANTIC_AFFORDANCE_TARGET_REGISTRY);
}
