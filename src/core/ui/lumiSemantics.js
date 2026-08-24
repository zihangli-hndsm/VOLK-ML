// LUMI is a presentation layer over grounded exploration state. It does not
// own World, Experiment, evidence, or learner-session state.

export const LUMI_PRESENCE = Object.freeze({
  HIDDEN: 'hidden',
  AMBIENT: 'ambient',
  CONTEXTUAL: 'contextual',
  EVENT: 'event',
});

export const LUMI_MODES = Object.freeze({
  IDLE: 'idle',
  OBSERVE: 'observe',
  GUIDE: 'guide',
  INTERVENE: 'intervene',
  ILLUMINATE: 'illuminate',
  EXPLORE: 'explore',
});

export const CONCEPT_STATES = Object.freeze({
  UNEXPLORED: 'unexplored',
  ACTIVE: 'active',
  ILLUMINATED: 'illuminated',
});

const CONCEPT_STATE_ORDER = Object.freeze({
  [CONCEPT_STATES.UNEXPLORED]: 0,
  [CONCEPT_STATES.ACTIVE]: 1,
  [CONCEPT_STATES.ILLUMINATED]: 2,
});

const valid = (value, values, fallback) => values.includes(value) ? value : fallback;

export function normalizeLumiPresence(value) {
  return valid(value, Object.values(LUMI_PRESENCE), LUMI_PRESENCE.HIDDEN);
}

export function normalizeLumiMode(value) {
  return valid(value, Object.values(LUMI_MODES), LUMI_MODES.IDLE);
}

export function normalizeConceptState(value) {
  return valid(value, Object.values(CONCEPT_STATES), CONCEPT_STATES.UNEXPLORED);
}

export function canTransitionConceptState(from, to) {
  const current = normalizeConceptState(from);
  const next = normalizeConceptState(to);
  return CONCEPT_STATE_ORDER[next] >= CONCEPT_STATE_ORDER[current];
}

export function transitionConceptState(from, to) {
  const current = normalizeConceptState(from);
  const next = normalizeConceptState(to);
  if (!canTransitionConceptState(current, next)) return current;
  return next;
}

function hasCandidate(inquiry, conceptId) {
  return Boolean(conceptId && inquiry?.candidates?.some((candidate) => candidate?.conceptId === conceptId));
}

function hasSignal(signals, conceptId) {
  return Boolean(conceptId && signals?.concepts?.some((signal) => signal?.id === conceptId));
}

// Illumination is deliberately explicit. Evidence and inquiry relevance make
// a concept active, but neither is silently promoted to learner understanding.
export function deriveConceptState({
  conceptId,
  activeConceptId = null,
  inquiry = null,
  conceptSignals = null,
  illuminatedConceptIds = [],
} = {}) {
  if (!conceptId) return CONCEPT_STATES.UNEXPLORED;
  if (illuminatedConceptIds.includes(conceptId)) return CONCEPT_STATES.ILLUMINATED;
  if (activeConceptId === conceptId || hasCandidate(inquiry, conceptId) || hasSignal(conceptSignals, conceptId)) {
    return CONCEPT_STATES.ACTIVE;
  }
  return CONCEPT_STATES.UNEXPLORED;
}

export function deriveLumiMode({
  hasObservation = false,
  hasGuidance = false,
  interventionActive = false,
  conceptState = CONCEPT_STATES.UNEXPLORED,
} = {}) {
  if (conceptState === CONCEPT_STATES.ILLUMINATED) return LUMI_MODES.ILLUMINATE;
  if (interventionActive) return LUMI_MODES.INTERVENE;
  if (hasGuidance) return LUMI_MODES.GUIDE;
  if (hasObservation) return LUMI_MODES.OBSERVE;
  return LUMI_MODES.IDLE;
}
