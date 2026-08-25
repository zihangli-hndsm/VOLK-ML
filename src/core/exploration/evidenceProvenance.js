// Historical Evidence-instance identities for the local exploration session.
// This projection never resolves a reference through a current detector notice.

export const EVIDENCE_PROVENANCE_VERSION = 1;
export const MAX_EVIDENCE_INSTANCES = 48;
export const EVIDENCE_INSTANCE_ID_PREFIX = 'evidence-instance-';
const MAX_ID_LENGTH = 160;
const MAX_STRING_LENGTH = 160;
const MAX_EXPERIMENT_IDS = 4;
const MAX_EVIDENCE_REFS = 12;
const MAX_OBJECT_KEYS = 24;
const MAX_ARRAY_ITEMS = 24;
const MAX_DEPTH = 3;

function boundedString(value, max = MAX_STRING_LENGTH) {
  const normalized = typeof value === 'string' ? value.trim().slice(0, max) : '';
  return normalized || null;
}

function boundedIds(values, limit = MAX_EXPERIMENT_IDS) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => boundedString(value, MAX_ID_LENGTH))
    .filter(Boolean))].slice(0, limit);
}

export function isEvidenceInstanceId(value) {
  const id = boundedString(value, MAX_ID_LENGTH);
  return Boolean(id && id.startsWith(EVIDENCE_INSTANCE_ID_PREFIX) && id.length > EVIDENCE_INSTANCE_ID_PREFIX.length);
}

export function boundedEvidenceValue(value, depth = 0) {
  if (depth > MAX_DEPTH || value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return boundedString(value);
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => boundedEvidenceValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).slice(0, MAX_OBJECT_KEYS).map((key) => [
      boundedString(key, MAX_ID_LENGTH),
      boundedEvidenceValue(value[key], depth + 1),
    ]).filter(([key]) => Boolean(key)));
  }
  return null;
}

export function createEvidenceInstance({ event, draft = null } = {}) {
  if (event?.type !== 'observation.detected' || !Number.isInteger(event?.sequence) || event.sequence < 1) return null;
  const id = `${EVIDENCE_INSTANCE_ID_PREFIX}${event.sequence}`;
  const reasonCode = boundedString(event.reasonCode);
  const conditionFingerprint = boundedString(draft?.conditionFingerprint, MAX_ID_LENGTH);
  const evidence = boundedEvidenceValue(draft?.evidence);
  if (!reasonCode) return null;
  return Object.freeze({
    version: EVIDENCE_PROVENANCE_VERSION,
    id,
    reasonCode,
    experimentIds: Object.freeze(boundedIds(event.experimentIds)),
    conditionFingerprint,
    semanticSequence: event.sequence,
    observedAt: boundedString(event.occurredAt, MAX_STRING_LENGTH),
    evidence: evidence === null ? null : Object.freeze(evidence),
    evidenceRefs: Object.freeze(boundedIds(event.evidenceRefs, MAX_EVIDENCE_REFS)),
    messageKey: boundedString(draft?.messageKey),
    severity: boundedString(draft?.severity),
    available: Boolean(conditionFingerprint && evidence !== null),
  });
}

function normalizeEvidenceInstance(value) {
  if (!isEvidenceInstanceId(value?.id) || !boundedString(value?.reasonCode)) return null;
  const evidence = boundedEvidenceValue(value.evidence);
  return Object.freeze({
    version: EVIDENCE_PROVENANCE_VERSION,
    id: boundedString(value.id, MAX_ID_LENGTH),
    reasonCode: boundedString(value.reasonCode),
    experimentIds: Object.freeze(boundedIds(value.experimentIds)),
    conditionFingerprint: boundedString(value.conditionFingerprint, MAX_ID_LENGTH),
    semanticSequence: Number.isInteger(value.semanticSequence) && value.semanticSequence > 0 ? value.semanticSequence : null,
    observedAt: boundedString(value.observedAt, MAX_STRING_LENGTH),
    evidence: evidence === null ? null : Object.freeze(evidence),
    evidenceRefs: Object.freeze(boundedIds(value.evidenceRefs, MAX_EVIDENCE_REFS)),
    messageKey: boundedString(value.messageKey),
    severity: boundedString(value.severity),
    available: Boolean(value.available && value.conditionFingerprint && evidence !== null),
  });
}

export function deriveEvidenceInstances({ semanticEvents } = {}) {
  const values = Array.isArray(semanticEvents?.evidenceInstances)
    ? semanticEvents.evidenceInstances
    : [];
  return Object.freeze(values.map(normalizeEvidenceInstance).filter(Boolean).slice(-MAX_EVIDENCE_INSTANCES));
}

export function getEvidenceInstance(evidenceInstances, evidenceId) {
  return deriveEvidenceInstances({ semanticEvents: { evidenceInstances } }).find((item) => item.id === evidenceId) ?? null;
}
