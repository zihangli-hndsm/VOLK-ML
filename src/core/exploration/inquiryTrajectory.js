// Goal 7 local-session evaluation projection. It measures completed inquiry
// process signals, never learner expertise, causal understanding, or chat
// quality. Raw learner text, point data, Experiment IDs, and provider output
// are deliberately excluded.
export const INQUIRY_TRAJECTORY_VERSION = 1;
export const MAX_INQUIRY_PRESENTATION_EVENTS = 32;
export const INQUIRY_PRESENTATION_AGGREGATE_VERSION = 1;

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
    semanticFactorCount: Array.isArray(event?.semanticFactorPaths)
      ? event.semanticFactorPaths.filter((factor) => typeof factor === 'string' && factor).length
      : Array.isArray(event?.semanticFactors) ? event.semanticFactors.filter((factor) => typeof factor === 'string' && factor).length : 0,
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

export function deriveInquiryTrajectory({ sessionStartedAt = null, semanticEvents, presentationEvents, presentationAggregates, activeExplorationThread } = {}) {
  const semantic = normalizedSemanticEvents(semanticEvents);
  const presentation = normalizedPresentationEvents(presentationEvents);
  const semanticAggregates = semanticEvents?.aggregates;
  const firstMeaningful = semantic.find((event) => event.actor === 'human' && MEANINGFUL_ACTION_TYPES.has(event.type));
  const learnerEvents = semantic.filter((event) => event.actor === 'human');
  const compareCount = Number.isInteger(semanticAggregates?.compareCount)
    ? semanticAggregates.compareCount
    : count(learnerEvents, (event) => event.type === 'comparison.completed');
  const oneFactorComparisonCount = Number.isInteger(semanticAggregates?.oneFactorComparisonCount)
    ? semanticAggregates.oneFactorComparisonCount
    : count(learnerEvents, (event) => event.type === 'comparison.completed' && event.semanticFactorCount === 1);
  const firstGuidance = presentation.find((event) => GUIDANCE_TYPES.has(event.type));
  const firstGuidanceSequence = Number.isInteger(presentationAggregates?.firstGuidanceAfterSemanticEventSequence)
    ? presentationAggregates.firstGuidanceAfterSemanticEventSequence
    : firstGuidance?.afterSemanticEventSequence;
  const independentAfterGuidance = Boolean(firstGuidance && semantic.some((event) => (
    event.actor === 'human'
    && MEANINGFUL_ACTION_TYPES.has(event.type)
    && event.sequence > (firstGuidanceSequence ?? Number.MAX_SAFE_INTEGER)
  ))) || Boolean(
    firstGuidanceSequence !== null && firstGuidanceSequence !== undefined
    && semantic.some((event) => event.actor === 'human'
      && MEANINGFUL_ACTION_TYPES.has(event.type)
      && event.sequence > firstGuidanceSequence),
  );
  return {
    version: INQUIRY_TRAJECTORY_VERSION,
    session: {
      timeToFirstMeaningfulManipulationMs: semanticAggregates?.firstMeaningfulAt
        ? elapsedMs(sessionStartedAt, semanticAggregates.firstMeaningfulAt)
        : firstMeaningful ? elapsedMs(sessionStartedAt, firstMeaningful.occurredAt) : null,
      hasSecondExperiment: semanticAggregates?.secondExperimentCreated === true
        || learnerEvents.some((event) => event.type === 'experiment.duplicated'),
    },
    experiments: {
      duplicateCount: Number.isInteger(semanticAggregates?.duplicateCount)
        ? semanticAggregates.duplicateCount
        : count(learnerEvents, (event) => event.type === 'experiment.duplicated'),
      compareCount,
      compareUsed: compareCount > 0,
      oneFactorComparisonCount,
      oneFactorComparisonRate: compareCount ? oneFactorComparisonCount / compareCount : null,
      repeatCount: Number.isInteger(semanticAggregates?.repeatCount)
        ? semanticAggregates.repeatCount
        : count(learnerEvents, (event) => event.type === 'repeat.completed'),
    },
    guidance: {
      conceptCardsSurfaced: Number.isInteger(presentationAggregates?.conceptCardsSurfaced) ? presentationAggregates.conceptCardsSurfaced : count(presentation, (event) => event.type === 'concept-card-surfaced'),
      conceptCardsEngaged: Number.isInteger(presentationAggregates?.conceptCardsEngaged) ? presentationAggregates.conceptCardsEngaged : count(presentation, (event) => event.type === 'concept-card-engaged'),
      suggestionsSurfaced: Number.isInteger(presentationAggregates?.suggestionsSurfaced) ? presentationAggregates.suggestionsSurfaced : count(presentation, (event) => event.type === 'suggestion-surfaced'),
      suggestionsAccepted: Number.isInteger(presentationAggregates?.suggestionsAccepted) ? presentationAggregates.suggestionsAccepted : count(presentation, (event) => event.type === 'suggestion-accepted'),
      suggestionsModified: Number.isInteger(presentationAggregates?.suggestionsModified) ? presentationAggregates.suggestionsModified : count(presentation, (event) => event.type === 'suggestion-modified'),
      depthTransitions: Number.isInteger(presentationAggregates?.depthTransitions) ? presentationAggregates.depthTransitions : count(presentation, (event) => event.type === 'depth-opened'),
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
  let aggregates = {
    version: INQUIRY_PRESENTATION_AGGREGATE_VERSION,
    conceptCardsSurfaced: 0,
    conceptCardsEngaged: 0,
    suggestionsSurfaced: 0,
    suggestionsAccepted: 0,
    suggestionsModified: 0,
    depthTransitions: 0,
    firstGuidanceAfterSemanticEventSequence: null,
  };
  return {
    reset() {
      sessionStartedAt = safeIso(now());
      events = [];
      aggregates = {
        version: INQUIRY_PRESENTATION_AGGREGATE_VERSION,
        conceptCardsSurfaced: 0,
        conceptCardsEngaged: 0,
        suggestionsSurfaced: 0,
        suggestionsAccepted: 0,
        suggestionsModified: 0,
        depthTransitions: 0,
        firstGuidanceAfterSemanticEventSequence: null,
      };
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
      const aggregateKey = type === 'concept-card-surfaced' ? 'conceptCardsSurfaced'
        : type === 'concept-card-engaged' ? 'conceptCardsEngaged'
          : type === 'suggestion-surfaced' ? 'suggestionsSurfaced'
            : type === 'suggestion-accepted' ? 'suggestionsAccepted'
              : type === 'suggestion-modified' ? 'suggestionsModified'
                : type === 'depth-opened' ? 'depthTransitions' : null;
      if (aggregateKey) aggregates[aggregateKey] += 1;
      if (GUIDANCE_TYPES.has(type) && aggregates.firstGuidanceAfterSemanticEventSequence === null) {
        aggregates.firstGuidanceAfterSemanticEventSequence = event.afterSemanticEventSequence;
      }
      return structuredClone(event);
    },
    snapshot() {
      return { sessionStartedAt, presentationEvents: structuredClone(events), presentationAggregates: structuredClone(aggregates) };
    },
  };
}
