import { projectLearnerMilestones } from './journeyProjection.js';

// Session-local LUMI journey projection. Runtime semantic events remain the
// source of truth; this module only projects bounded learner-facing nodes.

export const LUMI_JOURNEY_VERSION = 1;
export const MAX_LUMI_JOURNEY_EVENTS = 120;

export const LUMI_JOURNEY_EVENT_TYPES = Object.freeze({
  OBSERVE: 'observe',
  PREDICT: 'predict',
  INTERVENE: 'intervene',
  CONNECT: 'connect',
  ILLUMINATE: 'illuminate',
  INTERPRET: 'interpret',
  REVISE: 'revise',
});

const JOURNEY_TYPES = new Set(Object.values(LUMI_JOURNEY_EVENT_TYPES));
const MAX_ID_LENGTH = 160;

function boundedId(value) {
  const normalized = typeof value === 'string' ? value.trim().slice(0, MAX_ID_LENGTH) : '';
  return normalized || null;
}

function boundedControlKey(value) {
  return boundedId(value)?.replace(/^control\./, '') ?? null;
}

function timestampValue(value, fallback = 0) {
  if (Number.isFinite(Number(value))) return Math.max(0, Math.trunc(Number(value)));
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function semanticEvents(value) {
  return (Array.isArray(value) ? value : value?.events ?? [])
    .filter((event) => event && typeof event === 'object')
    .slice(-MAX_LUMI_JOURNEY_EVENTS);
}

function eventSequence(event, fallback) {
  return Number.isInteger(event?.sequence) && event.sequence > 0 ? event.sequence : fallback;
}

function createJourneyEvent(type, payload, { timestamp = 0, sourceSequence = 0, order = 0 } = {}) {
  if (!JOURNEY_TYPES.has(type)) return null;
  const normalized = { type, timestamp: timestampValue(timestamp), sourceSequence, order };
  if (type === LUMI_JOURNEY_EVENT_TYPES.OBSERVE) normalized.evidenceId = boundedId(payload?.evidenceId);
  if (type === LUMI_JOURNEY_EVENT_TYPES.INTERVENE) {
    normalized.experimentId = boundedId(payload?.experimentId);
    normalized.controlKey = boundedControlKey(payload?.controlKey);
  }
  if (type === LUMI_JOURNEY_EVENT_TYPES.PREDICT || type === LUMI_JOURNEY_EVENT_TYPES.REVISE || type === LUMI_JOURNEY_EVENT_TYPES.INTERPRET) {
    normalized.hypothesisId = boundedId(payload?.hypothesisId);
    normalized.interpretationId = type === LUMI_JOURNEY_EVENT_TYPES.INTERPRET ? boundedId(payload?.interpretationId) : undefined;
  }
  if (type === LUMI_JOURNEY_EVENT_TYPES.CONNECT) {
    normalized.evidenceId = boundedId(payload?.evidenceId);
    normalized.conceptId = boundedId(payload?.conceptId);
  }
  if (type === LUMI_JOURNEY_EVENT_TYPES.ILLUMINATE) normalized.conceptId = boundedId(payload?.conceptId);
  const required = type === LUMI_JOURNEY_EVENT_TYPES.OBSERVE
    ? normalized.evidenceId
      : type === LUMI_JOURNEY_EVENT_TYPES.PREDICT || type === LUMI_JOURNEY_EVENT_TYPES.REVISE
        ? normalized.hypothesisId
        : type === LUMI_JOURNEY_EVENT_TYPES.INTERPRET
          ? normalized.hypothesisId && normalized.interpretationId
        : type === LUMI_JOURNEY_EVENT_TYPES.INTERVENE
      ? normalized.experimentId
      : type === LUMI_JOURNEY_EVENT_TYPES.CONNECT
        ? normalized.evidenceId && normalized.conceptId
        : normalized.conceptId;
  if (!required) return null;
  normalized.id = `lumi-journey-${type}-${sourceSequence || normalized.timestamp}-${normalized.evidenceId ?? normalized.conceptId ?? normalized.experimentId ?? normalized.hypothesisId}`;
  return Object.freeze(normalized);
}

function directCandidates(inquiry) {
  return (inquiry?.candidates ?? [])
    .filter((candidate) => boundedId(candidate?.conceptId))
    .filter((candidate) => !candidate?.confidence || candidate.confidence === 'direct');
}

function supportsEvidence(candidate, evidenceId, observation) {
  const support = (candidate?.supportingObservationIds ?? []).map(boundedId).filter(Boolean);
  return support.includes(evidenceId) || support.includes(boundedId(observation?.reasonCode));
}

export function clearJourney() {
  return Object.freeze({ version: LUMI_JOURNEY_VERSION, illuminationEvents: Object.freeze([]) });
}

export function appendJourneyIllumination(journey = clearJourney(), { conceptId, timestamp = 0, afterSequence = 0 } = {}) {
  const normalizedConceptId = boundedId(conceptId);
  if (!normalizedConceptId) return journey;
  const current = Array.isArray(journey?.illuminationEvents) ? journey.illuminationEvents : [];
  if (current.some((event) => event?.conceptId === normalizedConceptId)) return journey;
  const nextSequence = current.reduce((max, event) => Math.max(max, Number(event?.sequence) || 0), 0) + 1;
  const next = {
    conceptId: normalizedConceptId,
    timestamp: timestampValue(timestamp),
    sequence: nextSequence,
    afterSequence: Number.isInteger(afterSequence) ? Math.max(0, afterSequence) : 0,
  };
  return Object.freeze({
    version: LUMI_JOURNEY_VERSION,
    illuminationEvents: Object.freeze([...current, Object.freeze(next)].slice(-MAX_LUMI_JOURNEY_EVENTS)),
  });
}

export function deriveLumiJourneyProjection({
  semanticEvents: semanticEventInput,
  observations = [],
  inquiry = null,
  activeConceptId = null,
  illuminatedConceptIds = [],
  illuminationEvents = [],
  hypotheses = [],
  interpretations = [],
  revisions = [],
} = {}) {
  const events = semanticEvents(semanticEventInput);
  const notices = Array.isArray(observations) ? observations : [];
  const candidates = directCandidates(inquiry);
  const journeyEvents = [];
  const observedIds = new Set();
  const connectedConceptIds = new Set();

  events.forEach((event, index) => {
    if (event?.actor !== 'human') return;
    const sequence = eventSequence(event, index + 1);
    const timestamp = timestampValue(event.occurredAt, sequence);
    if (event.type === 'observation.detected') {
      const evidenceId = boundedId(event.reasonCode) ?? boundedId(event.evidenceRefs?.[0]);
      const observe = createJourneyEvent(LUMI_JOURNEY_EVENT_TYPES.OBSERVE, { evidenceId }, { timestamp, sourceSequence: sequence, order: sequence * 10 });
      if (observe) {
        journeyEvents.push(observe);
        observedIds.add(evidenceId);
        const notice = notices.find((item) => String(item?.id ?? '') === evidenceId || String(item?.reasonCode ?? '') === evidenceId);
        candidates.forEach((candidate) => {
          if (!supportsEvidence(candidate, evidenceId, notice)) return;
          const connect = createJourneyEvent(LUMI_JOURNEY_EVENT_TYPES.CONNECT, { evidenceId, conceptId: candidate.conceptId }, { timestamp, sourceSequence: sequence, order: sequence * 10 + 1 });
          if (!connect) return;
          journeyEvents.push(connect);
          connectedConceptIds.add(candidate.conceptId);
        });
      }
    }
    if (event.type === 'world.intervened' || event.type === 'experiment.factor-changed') {
      const intervene = createJourneyEvent(LUMI_JOURNEY_EVENT_TYPES.INTERVENE, {
        experimentId: event.experimentIds?.[0],
        controlKey: event.reasonCode,
      }, { timestamp, sourceSequence: sequence, order: sequence * 10 });
      if (intervene) journeyEvents.push(intervene);
    }
  });

  (Array.isArray(hypotheses) ? hypotheses : []).slice(0, 8).forEach((hypothesis, index) => {
    const hypothesisId = boundedId(hypothesis?.id);
    if (!hypothesisId) return;
    const order = (events.length + index + 1) * 10 + 3;
    const predict = createJourneyEvent(LUMI_JOURNEY_EVENT_TYPES.PREDICT, { hypothesisId }, { timestamp: 0, sourceSequence: index + 1, order });
    if (predict) journeyEvents.push(predict);
    if (hypothesis.status === 'supported' || hypothesis.status === 'rejected' || hypothesis.status === 'revised') {
      const revise = createJourneyEvent(LUMI_JOURNEY_EVENT_TYPES.REVISE, { hypothesisId }, { timestamp: 0, sourceSequence: index + 1, order: order + 1 });
      if (revise) journeyEvents.push(revise);
    }
  });

  (Array.isArray(interpretations) ? interpretations : []).slice(0, 12).forEach((interpretation, index) => {
    const hypothesisId = boundedId(interpretation?.hypothesisIds?.[0]);
    const interpretationId = boundedId(interpretation?.id);
    if (!hypothesisId || !interpretationId) return;
    const interpret = createJourneyEvent(LUMI_JOURNEY_EVENT_TYPES.INTERPRET, { hypothesisId, interpretationId }, {
      timestamp: 0,
      sourceSequence: index + 1,
      order: (events.length + index + 1) * 10 + 4,
    });
    if (interpret) journeyEvents.push(interpret);
  });

  (Array.isArray(revisions) ? revisions : []).slice(0, 12).forEach((revision, index) => {
    const hypothesisId = boundedId(revision?.childHypothesisId);
    if (!hypothesisId) return;
    const revise = createJourneyEvent(LUMI_JOURNEY_EVENT_TYPES.REVISE, { hypothesisId }, {
      timestamp: 0,
      sourceSequence: index + 1,
      order: (events.length + index + 1) * 10 + 5,
    });
    if (revise) journeyEvents.push(revise);
  });

  (Array.isArray(illuminationEvents) ? illuminationEvents : []).forEach((event) => {
    const illuminate = createJourneyEvent(LUMI_JOURNEY_EVENT_TYPES.ILLUMINATE, { conceptId: event?.conceptId }, {
      timestamp: event?.timestamp,
      sourceSequence: event?.sequence,
      order: (Number(event?.afterSequence) || events.length + 1) * 10 + 2 + (Number(event?.sequence) || 0),
    });
    if (illuminate) {
      journeyEvents.push(illuminate);
      connectedConceptIds.add(illuminate.conceptId);
    }
  });

  const illuminated = new Set((illuminatedConceptIds ?? []).map(boundedId).filter(Boolean));
  const frontierConceptIds = [...new Set([
    boundedId(activeConceptId),
    ...candidates.map((candidate) => boundedId(candidate.conceptId)),
  ].filter(Boolean))].filter((conceptId) => !connectedConceptIds.has(conceptId) && !illuminated.has(conceptId));
  const orderedEvents = journeyEvents
    .sort((left, right) => (left.order - right.order)
      || (left.timestamp - right.timestamp)
      || left.id.localeCompare(right.id))
    .slice(-MAX_LUMI_JOURNEY_EVENTS);
  const currentEvent = orderedEvents.at(-1) ?? null;
  const currentTarget = currentEvent
    ? currentEvent.type === LUMI_JOURNEY_EVENT_TYPES.OBSERVE || currentEvent.type === LUMI_JOURNEY_EVENT_TYPES.CONNECT
      ? { type: currentEvent.type === LUMI_JOURNEY_EVENT_TYPES.OBSERVE ? 'evidence' : 'concept', id: currentEvent.type === LUMI_JOURNEY_EVENT_TYPES.OBSERVE ? currentEvent.evidenceId : currentEvent.conceptId }
      : currentEvent.type === LUMI_JOURNEY_EVENT_TYPES.INTERVENE
        ? { type: 'experiment', id: currentEvent.experimentId }
        : currentEvent.type === LUMI_JOURNEY_EVENT_TYPES.PREDICT || currentEvent.type === LUMI_JOURNEY_EVENT_TYPES.REVISE || currentEvent.type === LUMI_JOURNEY_EVENT_TYPES.INTERPRET
          ? { type: 'hypothesis', id: currentEvent.hypothesisId }
        : { type: 'concept', id: currentEvent.conceptId }
    : frontierConceptIds[0] ? { type: 'concept', id: frontierConceptIds[0] } : null;
  return Object.freeze({
    version: LUMI_JOURNEY_VERSION,
    events: Object.freeze(orderedEvents),
    currentEvent,
    currentTarget: currentTarget ? Object.freeze(currentTarget) : null,
    frontierConceptIds: Object.freeze(frontierConceptIds),
    observedEvidenceIds: Object.freeze([...observedIds]),
    connectedConceptIds: Object.freeze([...connectedConceptIds]),
    illuminatedConceptIds: Object.freeze([...illuminated]),
    milestones: projectLearnerMilestones(events),
  });
}
