// A deliberately non-inferential prototype for the “same finite Data, more
// than one possible World” question. It names learner-facing possibilities;
// it does not decide compatibility, likelihood, causality, or truth.

export const POSSIBLE_WORLDS_VERSION = 1;

export function derivePossibleWorldCandidates(world) {
  if (world?.task !== 'regression' || (world.observations ?? []).length < 2) return [];
  return [
    {
      id: 'possible-linear-world',
      kind: 'linear',
      status: 'candidate',
      basis: 'same-finite-observations',
    },
    {
      id: 'possible-nonlinear-world',
      kind: 'nonlinear',
      status: 'candidate',
      basis: 'same-finite-observations',
    },
  ];
}

export function derivePossibleWorldQuestion(world) {
  const candidates = derivePossibleWorldCandidates(world);
  return candidates.length
    ? {
      version: POSSIBLE_WORLDS_VERSION,
      candidates,
      promptKey: 'playground.worldBuilder.possibleWorldsPrompt',
      boundaryKey: 'playground.worldBuilder.possibleWorldsBoundary',
    }
    : null;
}
