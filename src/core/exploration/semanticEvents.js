// A bounded, presentation-agnostic record of completed exploration actions.
// This is deliberately not telemetry: it is local session context for future
// deterministic inquiry work. Runtime actions remain authoritative.
import { canonicalExperimentalControl } from './comparison.js';
import { deriveWorldSemanticFactors } from './worldSemanticFactors.js';
import { conditionFingerprintForSession } from './observables.js';
import { createEvidenceInstance, MAX_EVIDENCE_INSTANCES } from './evidenceProvenance.js';
export const SEMANTIC_EVENT_VERSION = 1;
export const SEMANTIC_EVENT_LOG_VERSION = 1;
export const MAX_SEMANTIC_EVENTS = 100;
export const SEMANTIC_EVENT_AGGREGATE_VERSION = 1;

export const SEMANTIC_EVENT_TYPES = Object.freeze([
  'experiment.duplicated',
  'experiment.factor-changed',
  'world.intervened',
  'observation.sampled',
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

function hashFingerprint(value) {
  let hash = 2166136261;
  for (const character of String(value ?? '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `condition-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function actorFor(action) {
  return ACTORS.has(action?.actor) ? action.actor : 'system';
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
    semanticFactorPaths: boundedStrings(comparison.diff.semanticFactorPaths ?? comparison.diff.semanticChangedPaths ?? comparison.diff.changed),
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
  const experimentalControl = canonicalExperimentalControl(descriptor, key);
  if (!experimentalControl) return null;
  return {
    type: 'experiment.factor-changed',
    actor: actorFor(action),
    experimentIds: boundedStrings([activeExperimentId(after)], 1),
    semanticFactors: [experimentalControl.comparisonFactor],
    semanticFactorPaths: [`${experimentalControl.comparisonFactor}.controls.${experimentalControl.key}`],
    operationTypes: ['SET_CONTROL'],
    reasonCode: `control.${experimentalControl.key}`,
  };
}

function worldEvent(before, after, action, operations = action?.transaction?.operations) {
  const worldOperations = (operations ?? []).filter((operation) => !['RESAMPLE_WORLD', 'observation.sample'].includes(operation?.type));
  const operationTypes = boundedStrings(worldOperations.map((operation) => operation?.type));
  if (!operationTypes.length) return null;
  return {
    type: 'world.intervened',
    actor: actorFor(action?.transaction?.actor ? { actor: action.transaction.actor } : action),
    experimentIds: boundedStrings([activeExperimentId(after)], 1),
    semanticFactors: boundedStrings(deriveWorldSemanticFactors({ operations: worldOperations, beforeWorld: before?.world })),
    semanticFactorPaths: boundedStrings(deriveWorldSemanticFactors({ operations: worldOperations, beforeWorld: before?.world })),
    operationTypes,
    reasonCode: boundedString(action?.transaction?.intent, 'world-transaction'),
  };
}

function semanticFactorsForHistoryEntry(entry, beforeWorld) {
  const stored = boundedStrings(entry?.semanticFactors);
  if (stored.length) return stored;
  return boundedStrings(deriveWorldSemanticFactors({
    operations: entry?.forward?.operations ?? [],
    beforeWorld,
  }));
}

function reversalEntry(beforeWorldHistory, type) {
  if (type === 'UNDO_WORLD_ACTION') return beforeWorldHistory?.past?.at(-1) ?? null;
  if (type === 'REDO_WORLD_ACTION') return beforeWorldHistory?.future?.[0] ?? null;
  return null;
}

function worldReversalEvent(before, after, action, beforeWorldHistory) {
  const type = action?.type;
  const entry = reversalEntry(beforeWorldHistory, type);
  if (!entry) return null;
  return {
    type: 'world.intervened',
    actor: actorFor(action),
    experimentIds: boundedStrings([activeExperimentId(after)], 1),
    // The wrapper action only controls history. Factor identity comes from
    // the original canonical World entry, not from UNDO/REDO itself.
    semanticFactors: semanticFactorsForHistoryEntry(entry, before?.world),
    semanticFactorPaths: semanticFactorsForHistoryEntry(entry, before?.world),
    operationTypes: [type],
    reasonCode: type === 'UNDO_WORLD_ACTION' ? 'world-undo' : 'world-redo',
  };
}

function reversalEventsFromExecution(before, after, action, beforeWorldHistory) {
  const events = [];
  let history = {
    past: [...(beforeWorldHistory?.past ?? [])],
    future: [...(beforeWorldHistory?.future ?? [])],
  };
  for (const change of action?.changes ?? []) {
    if (!['UNDO_WORLD_ACTION', 'REDO_WORLD_ACTION'].includes(change.operation)) continue;
    const event = worldReversalEvent(before, after, {
      type: change.operation,
      actor: action.actor,
    }, history);
    if (!event) continue;
    events.push(event);
    const entry = reversalEntry(history, change.operation);
    if (change.operation === 'UNDO_WORLD_ACTION') {
      history = { past: history.past.slice(0, -1), future: [entry, ...history.future] };
    } else {
      history = { past: [...history.past, entry], future: history.future.slice(1) };
    }
  }
  return events;
}

function worldEventFromHistory(before, after, action) {
  const previous = before?.actionHistory?.past?.at(-1)?.id ?? null;
  const current = after?.actionHistory?.past?.at(-1) ?? null;
  if (!current || current.id === previous) return null;
  const operation = action?.type && action.type !== 'EXECUTE_EXPLORATION'
    ? { ...action }
    : null;
  return worldEvent(before, after, {
    ...action,
    transaction: {
      actor: action?.actor ?? current.actor,
      intent: current.intent,
      operations: operation ? [operation] : (current.mutationSummary?.types ?? []).map((type) => ({ type })),
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

export function observationDedupeKey(notice, conditionFingerprint = null) {
  return stableJson({
    id: boundedString(notice?.id),
    // Detector output order is incidental. The pedagogical identity is the
    // same set of related experiments/observables, independent of ordering.
    relatedExperimentIds: boundedStrings(notice?.relatedExperimentIds).sort(),
    relatedObservableIds: boundedStrings(notice?.relatedObservableIds).sort(),
    // Detector values may fluctuate during rendering. A new occurrence is
    // created only when the semantic experimental condition changes.
    conditionFingerprint: boundedString(conditionFingerprint, MAX_EVENT_STRING_LENGTH),
  });
}

function observationSampledEventFromHistory(before, after, action) {
  const previous = before?.actionHistory?.past?.at(-1)?.id ?? null;
  const current = after?.actionHistory?.past?.at(-1) ?? null;
  if (!current || current.id === previous || !(current.mutationSummary?.types ?? []).some((type) => ['RESAMPLE_WORLD', 'observation.sample'].includes(type))) return null;
  return observationSampledEvent(after, {
    ...action,
    transaction: {
      actor: action?.actor ?? current.actor,
      intent: current.intent,
      operations: [{ type: 'RESAMPLE_WORLD' }],
    },
  });
}

function observationSampledEvent(after, action, operations = action?.transaction?.operations) {
  if (!(operations ?? []).some((operation) => operation?.type === 'RESAMPLE_WORLD')) return null;
  return {
    type: 'observation.sampled',
    actor: actorFor(action?.transaction?.actor ? { actor: action.transaction.actor } : action),
    experimentIds: boundedStrings([activeExperimentId(after)], 1),
    semanticFactors: ['observation.sample'],
    semanticFactorPaths: ['observation.sample'],
    operationTypes: ['RESAMPLE_WORLD'],
    reasonCode: boundedString(action?.transaction?.intent, 'sample-again'),
  };
}

function observationConditionFingerprint(after, notice) {
  const comparison = after?.experimentWorkspace?.comparison;
  return hashFingerprint(JSON.stringify({
    sessionCondition: conditionFingerprintForSession({
      world: after?.world,
      adapterId: after?.model?.adapterId ?? after?.experiment?.model?.adapterId,
      experiment: after?.experiment,
    }),
    activeExperimentId: activeExperimentId(after),
    relatedExperimentIds: boundedStrings(notice?.relatedExperimentIds, 4).sort(),
    comparison: comparison?.enabled ? {
      againstExperimentId: boundedString(comparison.againstExperimentId),
      clarity: boundedString(comparison.diff?.clarity),
      semanticChangedPaths: boundedStrings(comparison.diff?.semanticChangedPaths ?? comparison.diff?.changed),
    } : null,
  }));
}

function observationEvents(after, action) {
  return (after?.observations ?? [])
    .filter((notice) => boundedString(notice?.id))
    .map((notice) => {
      const conditionFingerprint = observationConditionFingerprint(after, notice);
      return {
        type: 'observation.detected',
        actor: actorFor(action),
        experimentIds: boundedStrings([...(notice.relatedExperimentIds ?? []), activeExperimentId(after)], 4),
        semanticFactors: [],
        operationTypes: [],
        reasonCode: boundedString(notice.id),
        evidenceRefs: boundedStrings(notice.relatedObservableIds),
        observationDedupeKey: observationDedupeKey(notice, conditionFingerprint),
        conditionFingerprint,
        messageKey: boundedString(notice.messageKey),
        severity: boundedString(notice.severity),
        evidence: notice.evidence,
      };
    });
}

function executionEvents(before, after, action, controlDescriptors, beforeWorldHistory) {
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
    .filter((change) => !['SET_CONTROL', 'REPEAT_EXPERIMENT', 'DUPLICATE_EXPERIMENT', 'SWITCH_EXPERIMENT', 'SET_COMPARE', 'COMPARE_EXPERIMENTS', 'UNDO_WORLD_ACTION', 'REDO_WORLD_ACTION'].includes(change.operation))
    .map((change) => ({ type: change.operation, ...(change.parameters ?? {}) }));
  const world = worldEvent(before, after, { ...action, transaction: { actor: action.actor, intent: 'exploration-scenario', operations: worldOperations } });
  if (world) events.push(world);
  const sampled = observationSampledEvent(after, { ...action, transaction: { actor: action.actor, intent: 'sample-again', operations: worldOperations } }, worldOperations);
  if (sampled) events.push(sampled);
  events.push(...reversalEventsFromExecution(before, after, action, beforeWorldHistory));
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
export function deriveSemanticEventDrafts({
  before,
  after,
  action,
  controlDescriptors = [],
  beforeWorldHistory = null,
} = {}) {
  const events = [];
  if (!after || !action?.type) return events;
  if (action.type === 'DUPLICATE_EXPERIMENT') {
    const event = duplicateEvent(before, after, action);
    if (event) events.push(event);
  } else if (action.type === 'SET_CONTROL') {
    const event = controlEvent(before, after, action, controlDescriptors);
    if (event) events.push(event);
  } else if (action.type === 'APPLY_WORLD_TRANSACTION') {
    const sampled = observationSampledEvent(after, action);
    if (sampled) events.push(sampled);
    const event = worldEvent(before, after, action);
    if (event) events.push(event);
  } else if (action.type === 'SET_COMPARE' || action.type === 'COMPARE_EXPERIMENTS') {
    const event = comparisonEvent(after, action);
    if (event) events.push(event);
  } else if (action.type === 'REPEAT_EXPERIMENT') {
    const event = repeatEvent(after, action);
    if (event) events.push(event);
  } else if (action.type === 'UNDO_WORLD_ACTION' || action.type === 'REDO_WORLD_ACTION') {
    const event = worldReversalEvent(before, after, action, beforeWorldHistory);
    if (event) events.push(event);
  } else if (action.type === 'EXECUTE_EXPLORATION') {
    events.push(...executionEvents(before, after, action, controlDescriptors, beforeWorldHistory));
  }
  if (!events.some((event) => event.type === 'world.intervened')) {
    const event = worldEventFromHistory(before, after, action);
    if (event) events.push(event);
  }
  if (!events.some((event) => event.type === 'observation.sampled')) {
    const event = observationSampledEventFromHistory(before, after, action);
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
    actor: ACTORS.has(draft.actor) ? draft.actor : 'system',
    experimentIds: boundedStrings(draft.experimentIds, 4),
    semanticFactors: boundedStrings(draft.semanticFactors),
    semanticFactorPaths: boundedStrings(draft.semanticFactorPaths ?? draft.semanticFactors),
    operationTypes: boundedStrings(draft.operationTypes),
    reasonCode: boundedString(draft.reasonCode, 'semantic-action'),
    evidenceRefs: boundedStrings(draft.evidenceRefs),
  };
}

export function createSemanticEventStore({ limit = MAX_SEMANTIC_EVENTS, now = () => new Date().toISOString() } = {}) {
  const normalizedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_SEMANTIC_EVENTS) : MAX_SEMANTIC_EVENTS;
  let sequence = 0;
  let events = [];
  let evidenceInstances = [];
  let activeObservationKeys = [];
  let aggregates = {
    version: SEMANTIC_EVENT_AGGREGATE_VERSION,
    firstMeaningfulAt: null,
    secondExperimentCreated: false,
    duplicateCount: 0,
    compareCount: 0,
    oneFactorComparisonCount: 0,
    repeatCount: 0,
  };

  return {
    reset() {
      sequence = 0;
      events = [];
      evidenceInstances = [];
      activeObservationKeys = [];
      aggregates = {
        version: SEMANTIC_EVENT_AGGREGATE_VERSION,
        firstMeaningfulAt: null,
        secondExperimentCreated: false,
        duplicateCount: 0,
        compareCount: 0,
        oneFactorComparisonCount: 0,
        repeatCount: 0,
      };
    },
    append(drafts = []) {
      const appended = [];
      const observationDrafts = drafts.filter((draft) => draft?.type === 'observation.detected');
      const nextObservationKeys = [...new Set(observationDrafts.map((draft) => draft.observationDedupeKey).filter(Boolean))]
        .slice(-normalizedLimit);
      for (const draft of drafts) {
        if (draft?.type === 'observation.detected') {
          const key = draft.observationDedupeKey;
          if (!key || activeObservationKeys.includes(key)) continue;
        }
        const event = canonicalEvent(draft, { sequence: sequence + 1, occurredAt: now() });
        sequence += 1;
        events = [...events, event].slice(-normalizedLimit);
        if (event.type === 'observation.detected') {
          const evidenceInstance = createEvidenceInstance({ event, draft });
          if (evidenceInstance) evidenceInstances = [...evidenceInstances, evidenceInstance].slice(-Math.min(normalizedLimit, MAX_EVIDENCE_INSTANCES));
        }
        if (event.actor === 'human') {
          if (!aggregates.firstMeaningfulAt && ['world.intervened', 'experiment.factor-changed'].includes(event.type)) {
            aggregates.firstMeaningfulAt = event.occurredAt;
          }
          if (event.type === 'experiment.duplicated') {
            aggregates.secondExperimentCreated = true;
            aggregates.duplicateCount += 1;
          }
          if (event.type === 'comparison.completed') {
            aggregates.compareCount += 1;
            if (event.semanticFactorPaths.length === 1) aggregates.oneFactorComparisonCount += 1;
          }
          if (event.type === 'repeat.completed') aggregates.repeatCount += 1;
        }
        appended.push(structuredClone(event));
      }
      activeObservationKeys = nextObservationKeys;
      return appended;
    },
    snapshot() {
      return {
        version: SEMANTIC_EVENT_LOG_VERSION,
        events: structuredClone(events),
        evidenceInstances: structuredClone(evidenceInstances),
        aggregates: structuredClone(aggregates),
      };
    },
  };
}
