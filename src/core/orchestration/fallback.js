export const ORCHESTRATION_FALLBACK_LEVELS = Object.freeze({
  SILENCE: 0,
  VISUAL_CUE: 1,
  QUESTION: 2,
  SUGGEST_EXPERIMENT: 3,
  PREPARE_WITH_CONFIRMATION: 4,
  MINIMAL_EXPLANATION: 5,
});

export const ORCHESTRATION_MOMENTUM = Object.freeze({ ACTIVE: 'active', RECENTLY_ACTIVE: 'recently-active', IDLE: 'idle', STUCK: 'stuck' });

export function deriveLearnerMomentum({ facts = {}, recentMeaningfulEvents = 0, idleCategory = 'none' } = {}) {
  if (facts.recentHumanAction || recentMeaningfulEvents > 0 && idleCategory === 'none') return ORCHESTRATION_MOMENTUM.ACTIVE;
  if (idleCategory === 'short') return ORCHESTRATION_MOMENTUM.RECENTLY_ACTIVE;
  if (idleCategory === 'long') return ORCHESTRATION_MOMENTUM.IDLE;
  if (idleCategory === 'stuck') return ORCHESTRATION_MOMENTUM.STUCK;
  return ORCHESTRATION_MOMENTUM.RECENTLY_ACTIVE;
}

export function deriveFallbackLevel({ momentum = ORCHESTRATION_MOMENTUM.ACTIVE, recentGuidance = [], dismissed = false, stageId = '', hasProgress = false } = {}) {
  if (hasProgress || momentum === ORCHESTRATION_MOMENTUM.ACTIVE) return ORCHESTRATION_FALLBACK_LEVELS.SILENCE;
  if (dismissed) return ORCHESTRATION_FALLBACK_LEVELS.SILENCE;
  if (momentum === ORCHESTRATION_MOMENTUM.RECENTLY_ACTIVE) return ORCHESTRATION_FALLBACK_LEVELS.VISUAL_CUE;
  const count = recentGuidance.filter((item) => item?.stageId === stageId).length;
  if (momentum === ORCHESTRATION_MOMENTUM.IDLE) return count === 0 ? ORCHESTRATION_FALLBACK_LEVELS.VISUAL_CUE : ORCHESTRATION_FALLBACK_LEVELS.QUESTION;
  if (count === 0) return ORCHESTRATION_FALLBACK_LEVELS.QUESTION;
  if (count === 1) return ORCHESTRATION_FALLBACK_LEVELS.SUGGEST_EXPERIMENT;
  if (count === 2) return ORCHESTRATION_FALLBACK_LEVELS.PREPARE_WITH_CONFIRMATION;
  return ORCHESTRATION_FALLBACK_LEVELS.MINIMAL_EXPLANATION;
}

export function resetFallbackOnMomentum(fallbackLevel, momentum) {
  return momentum === ORCHESTRATION_MOMENTUM.ACTIVE
    ? ORCHESTRATION_FALLBACK_LEVELS.SILENCE
    : Math.max(ORCHESTRATION_FALLBACK_LEVELS.SILENCE, Number(fallbackLevel) || 0);
}
