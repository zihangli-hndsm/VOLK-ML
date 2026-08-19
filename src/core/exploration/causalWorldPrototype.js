// A design-only seam for the first Causal World. It intentionally stores no
// observations and cannot be executed by the current World runtime. A future
// implementation must materialize through the normal World/operation path,
// rather than introducing Agent-owned data or hidden executable code.
export const CAUSAL_WORLD_PROTOTYPE_VERSION = 1;

export const CAUSAL_WORLD_PROTOTYPE = Object.freeze({
  id: 'study-effort-confounding-v1',
  version: CAUSAL_WORLD_PROTOTYPE_VERSION,
  status: 'design-only',
  task: 'regression',
  observables: ['study-effort', 'assessment-outcome'],
  intervenables: ['study-effort'],
  latentVariables: ['prior-preparation'],
  mechanism: {
    revealPolicy: 'after-controlled-comparison',
    relationIds: ['prior-preparation-to-study-effort', 'prior-preparation-to-assessment-outcome', 'study-effort-to-assessment-outcome'],
  },
  requirements: [
    'materialize-through-world',
    'registered-intervention',
    'finite-observation-provenance',
    'inspectable-mechanism-reveal',
  ],
});

export function getCausalWorldPrototype() {
  return structuredClone(CAUSAL_WORLD_PROTOTYPE);
}
