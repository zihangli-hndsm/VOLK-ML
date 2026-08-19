// A bounded, presentation-agnostic record of completed exploration actions.
// This is deliberately not telemetry: it is local session context for future
// deterministic inquiry work. Runtime actions remain authoritative.
export const SEMANTIC_EVENT_VERSION = 1;
export const SEMANTIC_EVENT_LOG_VERSION = 1;
export const MAX_SEMANTIC_EVENTS = 100;

export const SEMANTIC_EVENT_TYPES = Object.freeze([
  'experiment.duplicated',
  'experiment.factor-changed',
  'world.intervened',
  'comparison.completed',
  'repeat.completed',
  'observation.detected',
]);

const EVENT_TYPES = new Set(SEMANTIC_EVENT_TYPES);
const ACTORS = new Set(['human', 'agent', 'system']);
const MAX_EVENT_STRINGS = 12;
const MAX_EVENT_STRING_LENGTH = 96;

function boundedString(value, fallback = null) {
  const normalized = String(value ?? '').trim();
  return normalized && normalized.length <= MAX_EVENT_STRING_LENGTH ? normalized : fallback;
}

function boundedStrings(values, max = MAX_EVENT_STRINGS) {
  return [...new Set((values ?? [])
    .map((value) => boundedString(value))
    .filter(Boolean))]
    .slice(0, max);
}

function actorFor(action) {
  return ACTORS.has(action?.actor) ? action.actor : 'human';
}

function activeExperimentId(snapshot) {
  return boundedString(snapshot?.experimentWorkspace?.activeExperimentId ?? snapshot?.experiment?.id);
}

function comparisonEvent(snapshot, action) {
  const comparison = snapshot?.experimentWorkspace?.comparison;
  if (!comparison?.enabled || !comparison.diff) return null;
  const activeId = activeExperimentId(snapshot);
  const againstId = boundedString(comparison.againstExperimentId);
  if (!activeId || !againstId) return null;
  return {
    type: 'comparison.completed',
    actor: actorFor(action),
    experimentIds: boundedStrings([againstId, activeId], 2),
    semanticFactors: boundedStrings(comparison.diff.changed),
    operationTypes: [],
    reasonCode: comparison.diff.clarity === 'mixed' ? 'comparison-mixed' : 'comparison-ready',
  };
}

function duplicateEvent(before, after, action) {
  const activeId = activeExperimentId(after);
  const previousId = activeExperimentId(before)
    ?? boundedString(after?.experimentWorkspace?.comparison?.againstExperimentId);
  if (!activeId) return null;
  return {
    type: 'experiment.duplicated',
    actor: actorFor(action),
    experimentIds: boundedStrings([previousId, activeId], 2),
    semanticFactors: [],
    operationTypes: [],
    reasonCode: 'experiment-preserved',
  };
}

function controlEvent(before, after, action, controlDescriptors) {
  const key = boundedString(action?.key);
  if (!key) return null;
  if (stableJson(before?.controls?.[key]) === stableJson(after?.controls?.[key])) return null;
  const descriptor = (controlDescriptors ?? []).find((control) => control.key === key);
  return {
    type: 'experiment.factor-changed',
    actor: actorFor(action),
    experimentIds: boundedStrings([activeExperimentId(after)], 1),
    semanticFactors: [`control.${key}`],
    operationTypes: ['SET_CONTROL'],
    reasonCode: boundedString(descriptor?.domain, 'control-changed'),
  };
}

function worldEvent(after, action, operations = action?.transaction?.operations) {
  const operationTypes = boundedStrings((operations ?? []).map((operation) => operation?.type));
  if (!operationTypes.length) return null;
  return {
    type: 'world.intervened',
    actor: actorFor(action?.transaction?.actor ? { actor: action.transaction.actor } : action),
    experimentIds: boundedStrings([activeExperimentId(after)], 1),
    semanticFactors: ['world'],
    operationTypes,
    reasonCode: boundedString(action?.transaction?.intent, 'world-transaction'),
  };
}

function worldEventFromHistory(before, after, action) {
  const previous = before?.actionHistory?.past?.at(-1)?.id ?? null;
  const current = after?.actionHistory?.past?.at(-1) ?? null;
  if (!current || current.id === previous) return null;
  return worldEvent(after, {
    ...action,
    transaction: {
      actor: current.actor,
      intent: current.intent,
      operations: (current.mutationSummary?.types ?? []).map((type) => ({ type })),
    },
  });
}

function repeatEvent(after, action) {
  const repeatEvidence = after?.repeatEvidence;
  if (!repeatEvidence || !Number.isInteger(repeatEvidence.trialCount) || repeatEvidence.trialCount < 1) return null;
  return {
    type: 'repeat.completed',
    actor: actorFor(action),
    experimentIds: boundedStrings([activeExperimentId(after)], 1),
    semanticFactors: [],
    operationTypes: ['REPEAT_EXPERIMENT'],
    reasonCode: 'repeat-evidence-ready',
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function observationDedupeKey(notice) {
  return stableJson({
    id: boundedString(notice?.id),
    relatedExperimentIds: boundedStrings(notice?.relatedExperimentIds),
    relatedObservableIds: boundedStrings(notice?.relatedObservableIds),
    evidence: notice?.evidence ?? null,
  });
}

function observationEvents(after, action) {
  return (after?.observations ?? [])
    .filter((notice) => boundedString(notice?.id))
    .map((notice) => ({
      type: 'observation.detected',
      actor: actorFor(action),
      experimentIds: boundedStrings(notice.relatedExperimentIds),
      semanticFactors: [],
      operationTypes: [],
      reasonCode: boundedString(notice.id),
      evidenceRefs: boundedStrings(notice.relatedObservableIds),
      observationDedupeKey: observationDedupeKey(notice),
    }));
}

function executionEvents(before, after, action, controlDescriptors) {
  const events = [];
  const changes = action?.changes ?? [];
  if (action?.execution?.duplicateBaseline || changes.some((change) => change.operation === 'DUPLICATE_EXPERIMENT')) {
    const event = duplicateEvent(before, after, action);
    if (event) events.push(event);
  }
  for (const change of changes) {
    if (change.operation === 'SET_CONTROL') {
      const event = controlEvent(before, after, { ...action, key: change.parameters?.key }, controlDescriptors);
      if (event) events.push(event);
    }
  }
  const worldOperations = changes
    .filter((change) => !['SET_CONTROL', 'REPEAT_EXPERIMENT', 'DUPLICATE_EXPERIMENT', 'SWITCH_EXPERIMENT', 'SET_COMPARE', 'COMPARE_EXPERIMENTS'].includes(change.operation))
    .map((change) => ({ type: change.operation }));
  const world = worldEvent(after, { ...action, transaction: { actor: action.actor, intent: 'exploration-scenario', operations: worldOperations } });
  if (world) events.push(world);
  if (action?.execution?.compare || changes.some((change) => ['SET_COMPARE', 'COMPARE_EXPERIMENTS'].includes(change.operation))) {
    const event = comparisonEvent(after, action);
    if (event) events.push(event);
  }
  if ((action?.execution?.repeat !== null && action?.execution?.repeat !== undefined)
    || changes.some((change) => change.operation === 'REPEAT_EXPERIMENT')) {
    const event = repeatEvent(after, action);
    if (event) events.push(event);
  }
  return events;
}

// Produces event drafts only after a runtime action has returned a committed
// candidate snapshot. No draft can dispatch or alter runtime state.
export function deriveSemanticEventDrafts({ before, after, action, controlDescriptors = [] } = {}) {
  const events = [];
  if (!after || !action?.type) return events;
  if (action.type === 'DUPLICATE_EXPERIMENT') {
    const event = duplicateEvent(before, after, action);
    if (event) events.push(event);
  } else if (action.type === 'SET_CONTROL') {
    const event = controlEvent(before, after, action, controlDescriptors);
    if (event) events.push(event);
  } else if (action.type === 'APPLY_WORLD_TRANSACTION') {
    const event = worldEvent(after, action);
    if (event) events.push(event);
  } else if (action.type === 'SET_COMPARE' || action.type === 'COMPARE_EXPERIMENTS') {
    const event = comparisonEvent(after, action);
    if (event) events.push(event);
  } else if (action.type === 'REPEAT_EXPERIMENT') {
    const event = repeatEvent(after, action);
    if (event) events.push(event);
  } else if (action.type === 'EXECUTE_EXPLORATION') {
    events.push(...executionEvents(before, after, action, controlDescriptors));
  }
  if (!events.some((event) => event.type === 'world.intervened')) {
    const event = worldEventFromHistory(before, after, action);
    if (event) events.push(event);
  }
  events.push(...observationEvents(after, action));
  return events;
}

function canonicalEvent(draft, { sequence, occurredAt } = {}) {
  if (!EVENT_TYPES.has(draft?.type)) throw new Error(`Invalid semantic event type: ${draft?.type}`);
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('Semantic event sequence must be positive.');
  const timestamp = boundedString(occurredAt);
  if (!timestamp) throw new Error('Semantic event timestamp is required.');
  return {
    version: SEMANTIC_EVENT_VERSION,
    id: `semantic-event-${sequence}`,
    sequence,
    occurredAt: timestamp,
    type: draft.type,
    actor: ACTORS.has(draft.actor) ? draft.actor : 'human',
    experimentIds: boundedStrings(draft.experimentIds, 4),
    semanticFactors: boundedStrings(draft.semanticFactors),
    operationTypes: boundedStrings(draft.operationTypes),
    reasonCode: boundedString(draft.reasonCode, 'semantic-action'),
    evidenceRefs: boundedStrings(draft.evidenceRefs),
  };
}

export function createSemanticEventStore({ limit = MAX_SEMANTIC_EVENTS, now = () => new Date().toISOString() } = {}) {
  const normalizedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_SEMANTIC_EVENTS) : MAX_SEMANTIC_EVENTS;
  let sequence = 0;
  let events = [];
  let seenObservationKeys = [];

  return {
    reset() {
      sequence = 0;
      events = [];
      seenObservationKeys = [];
    },
    append(drafts = []) {
      const appended = [];
      for (const draft of drafts) {
        if (draft?.type === 'observation.detected') {
          const key = draft.observationDedupeKey;
          if (!key || seenObservationKeys.includes(key)) continue;
          seenObservationKeys = [...seenObservationKeys, key].slice(-normalizedLimit);
        }
        const event = canonicalEvent(draft, { sequence: sequence + 1, occurredAt: now() });
        sequence += 1;
        events = [...events, event].slice(-normalizedLimit);
        appended.push(structuredClone(event));
      }
      return appended;
    },
    snapshot() {
      return {
        version: SEMANTIC_EVENT_LOG_VERSION,
        events: structuredClone(events),
      };
    },
  };
}
