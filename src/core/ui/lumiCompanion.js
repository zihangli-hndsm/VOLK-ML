// Presentation-only resolver for the embodied LUMI companion. It consumes
// bounded semantic projections and never mutates runtime truth.
export const LUMI_COMPANION_STATES = Object.freeze({
  AMBIENT: 'AMBIENT', OBSERVE: 'OBSERVE', THINK: 'THINK', GUIDE: 'GUIDE', NOTICE: 'NOTICE', ILLUMINATE: 'ILLUMINATE',
});

const TARGETS = new Set(['world.canvas', 'world.sample', 'model.fit', 'experiment.compare', 'evidence.current', 'ideas.map', 'continuation.next']);

export function resolveLumiCompanionState({ askBusy = false, semanticAction = null, semanticTarget = null, recentConceptEvent = null, meaningfulResult = false, guidanceAvailable = false } = {}) {
  if (askBusy) return LUMI_COMPANION_STATES.THINK;
  if (recentConceptEvent?.conceptId || recentConceptEvent?.type === 'concept.evidenced') return LUMI_COMPANION_STATES.ILLUMINATE;
  if (meaningfulResult || semanticAction === 'NOTICE') return LUMI_COMPANION_STATES.NOTICE;
  if (semanticAction === 'GUIDE' || TARGETS.has(semanticTarget)) return LUMI_COMPANION_STATES.GUIDE;
  if (semanticAction === 'OBSERVE') return LUMI_COMPANION_STATES.OBSERVE;
  if (guidanceAvailable) return LUMI_COMPANION_STATES.GUIDE;
  return LUMI_COMPANION_STATES.AMBIENT;
}

export function normalizeLumiSemanticTarget(value) {
  return typeof value === 'string' && TARGETS.has(value) ? value : null;
}

export const LUMI_SEMANTIC_TARGETS = Object.freeze([...TARGETS]);
