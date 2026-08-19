// Goal 7 local-session evaluation projection. It measures completed inquiry
// process signals, never learner expertise, causal understanding, or chat
// quality. Raw learner text, point data, Experiment IDs, and provider output
// are deliberately excluded.
export const INQUIRY_TRAJECTORY_VERSION = 1;
export const MAX_INQUIRY_PRESENTATION_EVENTS = 32;

export const INQUIRY_PRESENTATION_EVENT_TYPES = Object.freeze([
  'concept-card-surfaced',
  'concept-card-engaged',
  'suggestion-surfaced',
  'suggestion-accepted',
  'suggestion-modified',
  'agent-guidance-surfaced',
  'depth-opened',
]);

const PRESENTATION_TYPES = new Set(INQUIRY_PRESENTATION_EVENT_TYPES);
const GUIDANCE_TYPES = new Set(['concept-card-surfaced', 'suggestion-surfaced', 'agent-guidance-surfaced']);
const MEANINGFUL_ACTION_TYPES = new Set(['world.intervened', 'experiment.factor-changed']);

function safeIso(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function safeSequence(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizedSemanticEvents(value) {
  const events = Array.isArray(value) ? value : value?.events;
  return (events ?? []).map((event) => ({
    sequence: Number.isInteger(event?.sequence) && event.sequence > 0 ? event.sequence : 0,
    type: typeof event?.type === 'string' ? event.type : null,
    actor: typeof event?.actor === 'string' ? event.actor : null,
    occurredAt: safeIso(event?.occurredAt),
    semanticFactorCount: Array.isArray(event?.semanticFactors) ? event.semanticFactors.filter((factor) => typeof factor === 'string' && factor).length : 0,
  })).filter((event) => event.sequence > 0 && event.type)
    .sort((left, right) => left.sequence - right.sequence);
}

function normalizedPresentationEvents(events) {
  return (Array.isArray(events) ? events : []).map((event) => {
    const type = typeof event?.type === 'string' ? event.type : null;
    const occurredAt = safeIso(event?.occurredAt);
    const afterSemanticEventSequence = safeSequence(event?.afterSemanticEventSequence);
    return type && PRESENTATION_TYPES.has(type) && occurredAt
      ? { type, occurredAt, afterSemanticEventSequence }
      : null;
  }).filter(Boolean).slice(-MAX_INQUIRY_PRESENTATION_EVENTS);
}

function count(events, predicate) {
  return events.filter(predicate).length;
}

function threadSignals(activeExplorationThread) {
  const entries = Array.isArray(activeExplorationThread?.entries) ? activeExplorationThread.entries : [];
  const questions = entries.filter((entry) => entry?.kind === 'question');
  const predictions = entries.filter((entry) => entry?.kind === 'prediction');
  return {
    questionCount: questions.length,
    predictionCount: predictions.length,
    followUpQuestionCount: Math.max(0, questions.length - 1),
    hasFollowUpQuestion: questions.length > 1,
  };
}

function elapsedMs(startedAt, eventAt) {
  const start = Date.parse(startedAt ?? '');
  const end = Date.parse(eventAt ?? '');
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

export function deriveInquiryTrajectory({ sessionStartedAt = null, semanticEvents, presentationEvents, activeExplorationThread } = {}) {
  const semantic = normalizedSemanticEvents(semanticEvents);
  const presentation = normalizedPresentationEvents(presentationEvents);
  const firstMeaningful = semantic.find((event) => event.actor === 'human' && MEANINGFUL_ACTION_TYPES.has(event.type));
  const compareCount = count(semantic, (event) => event.type === 'comparison.completed');
  const oneFactorComparisonCount = count(semantic, (event) => event.type === 'comparison.completed' && event.semanticFactorCount === 1);
  const firstGuidance = presentation.find((event) => GUIDANCE_TYPES.has(event.type));
  const independentAfterGuidance = Boolean(firstGuidance && semantic.some((event) => (
    event.actor === 'human'
    && MEANINGFUL_ACTION_TYPES.has(event.type)
    && event.sequence > (firstGuidance.afterSemanticEventSequence ?? Number.MAX_SAFE_INTEGER)
  )));
  return {
    version: INQUIRY_TRAJECTORY_VERSION,
    session: {
      timeToFirstMeaningfulManipulationMs: firstMeaningful ? elapsedMs(sessionStartedAt, firstMeaningful.occurredAt) : null,
      hasSecondExperiment: semantic.some((event) => event.type === 'experiment.duplicated'),
    },
    experiments: {
      duplicateCount: count(semantic, (event) => event.type === 'experiment.duplicated'),
      compareCount,
      compareUsed: compareCount > 0,
      oneFactorComparisonCount,
      oneFactorComparisonRate: compareCount ? oneFactorComparisonCount / compareCount : null,
      repeatCount: count(semantic, (event) => event.type === 'repeat.completed'),
    },
    guidance: {
      conceptCardsSurfaced: count(presentation, (event) => event.type === 'concept-card-surfaced'),
      conceptCardsEngaged: count(presentation, (event) => event.type === 'concept-card-engaged'),
      suggestionsSurfaced: count(presentation, (event) => event.type === 'suggestion-surfaced'),
      suggestionsAccepted: count(presentation, (event) => event.type === 'suggestion-accepted'),
      suggestionsModified: count(presentation, (event) => event.type === 'suggestion-modified'),
      depthTransitions: count(presentation, (event) => event.type === 'depth-opened'),
      transitionedToIndependentExploration: independentAfterGuidance,
    },
    thread: threadSignals(activeExplorationThread),
  };
}

// The store is presentation-only, local-session-only, and deliberately keeps
// no learner text, card title, suggestion details, World values, or IDs.
export function createInquiryTrajectoryStore({ limit = MAX_INQUIRY_PRESENTATION_EVENTS, now = () => new Date().toISOString() } = {}) {
  const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_INQUIRY_PRESENTATION_EVENTS) : MAX_INQUIRY_PRESENTATION_EVENTS;
  let sessionStartedAt = null;
  let events = [];
  return {
    reset() {
      sessionStartedAt = safeIso(now());
      events = [];
    },
    append({ type, afterSemanticEventSequence = null } = {}) {
      if (!PRESENTATION_TYPES.has(type)) return null;
      const occurredAt = safeIso(now());
      if (!occurredAt) return null;
      const event = {
        type,
        occurredAt,
        afterSemanticEventSequence: safeSequence(afterSemanticEventSequence),
      };
      events = [...events, event].slice(-boundedLimit);
      return structuredClone(event);
    },
    snapshot() {
      return { sessionStartedAt, presentationEvents: structuredClone(events) };
    },
  };
}
