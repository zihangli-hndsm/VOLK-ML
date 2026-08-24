// Presentation-only bindings between LUMI and existing semantic learning
// objects. This module never creates events, mutates runtime state, or infers
// mastery; it only projects bounded targets from the current snapshot.

export const LUMI_TARGET_TYPES = Object.freeze({
  EVIDENCE: 'evidence',
  CONCEPT: 'concept',
  EXPERIMENT: 'experiment',
});

export const LUMI_SHOWCASE_STAGES = Object.freeze({
  FRONTIER: 'frontier',
  OBSERVE: 'observe',
  INTERVENE: 'intervene',
  UNDERSTAND: 'understand',
});

const MAX_TARGET_ID_LENGTH = 160;
const validTargetType = (type) => Object.values(LUMI_TARGET_TYPES).includes(type);

export function createLumiTarget(type, id) {
  if (!validTargetType(type)) return null;
  const normalizedId = typeof id === 'string' ? id.trim().slice(0, MAX_TARGET_ID_LENGTH) : '';
  if (!normalizedId) return null;
  return Object.freeze({ type, id: normalizedId });
}

export function normalizeLumiTarget(value) {
  return value && typeof value === 'object' ? createLumiTarget(value.type, value.id) : null;
}

export function lumiTargetKey(target) {
  const normalized = normalizeLumiTarget(target);
  return normalized ? `${normalized.type}:${normalized.id}` : null;
}

export function lumiTargetEquals(left, right) {
  return lumiTargetKey(left) === lumiTargetKey(right);
}

function firstLinkedObservation(snapshot, candidate) {
  const observations = snapshot?.observations ?? [];
  const linked = (candidate?.supportingObservationIds ?? [])
    .map((value) => String(value))
    .map((value) => observations.find((observation) => String(observation?.id ?? '') === value || String(observation?.reasonCode ?? '') === value))
    .find(Boolean);
  return linked?.id ?? observations[0]?.id ?? null;
}

export function deriveLumiInteraction({ snapshot, intervention = null, activeConceptId = null } = {}) {
  const candidate = snapshot?.learnerInquiry?.candidates?.[0] ?? null;
  const evidenceTarget = createLumiTarget(LUMI_TARGET_TYPES.EVIDENCE, firstLinkedObservation(snapshot, candidate));
  const conceptTarget = createLumiTarget(LUMI_TARGET_TYPES.CONCEPT, activeConceptId ?? candidate?.conceptId);
  const experimentTarget = createLumiTarget(
    LUMI_TARGET_TYPES.EXPERIMENT,
    snapshot?.experimentWorkspace?.activeExperimentId ?? snapshot?.experiment?.id,
  );
  const interventionTarget = normalizeLumiTarget(intervention?.target) ?? null;
  const connection = evidenceTarget && conceptTarget
    ? Object.freeze({ from: evidenceTarget, to: conceptTarget })
    : null;
  const primaryTarget = interventionTarget ?? evidenceTarget ?? conceptTarget ?? experimentTarget;
  const mode = interventionTarget ? 'intervene' : conceptTarget ? 'explore' : evidenceTarget ? 'observe' : 'idle';
  return Object.freeze({
    mode,
    primaryTarget,
    evidenceTarget,
    conceptTarget,
    experimentTarget,
    interventionTarget,
    interventionControlKey: typeof intervention?.controlKey === 'string' ? intervention.controlKey : null,
    connection,
    hypothesisPrompt: evidenceTarget && conceptTarget
      ? Object.freeze({ conceptId: conceptTarget.id, evidenceId: evidenceTarget.id })
      : null,
  });
}

export function deriveLumiShowcaseStage({ attention, illuminatedConceptIds = [] } = {}) {
  const conceptId = attention?.conceptTarget?.id;
  const illuminated = new Set((illuminatedConceptIds ?? []).map((id) => String(id)));
  if (conceptId && illuminated.has(conceptId)) return LUMI_SHOWCASE_STAGES.UNDERSTAND;
  if (attention?.interventionTarget) return LUMI_SHOWCASE_STAGES.INTERVENE;
  if (attention?.evidenceTarget || attention?.conceptTarget) return LUMI_SHOWCASE_STAGES.OBSERVE;
  return LUMI_SHOWCASE_STAGES.FRONTIER;
}
