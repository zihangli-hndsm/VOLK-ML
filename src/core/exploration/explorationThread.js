// Lightweight learner reasoning history. Threads reference canonical
// Experiment Workspace records; they never own a second runtime copy.

export const EXPLORATION_THREAD_VERSION = 1;
export const EXPLORATION_THREAD_LIMITS = Object.freeze({
  maxThreads: 20,
  maxEntriesPerThread: 100,
  maxTitleLength: 120,
  maxTextLength: 500,
  maxNoteLength: 500,
  maxObservablesPerObservation: 12,
  maxNoticesPerObservation: 8,
});

const ACTORS = new Set(['human', 'agent', 'system']);
const ENTRY_KINDS = new Set(['question', 'prediction', 'experiment', 'observation']);
import { canonicalizeConceptSignals } from './concepts.js';

export function explorationThreadError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

const clone = (value) => structuredClone(value);
const text = (value, max, field) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field, max });
  }
  return value.trim();
};

function safeId(value, field = 'id') {
  return text(String(value ?? ''), 160, field);
}

function actor(value) {
  return ACTORS.has(value) ? value : 'human';
}

function safeJson(value, field) {
  try {
    const copyValue = clone(value);
    JSON.stringify(copyValue);
    return copyValue;
  } catch {
    throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field, reason: 'not-json-safe' });
  }
}

function safeRecord(value, field) {
  const copyValue = safeJson(value, field);
  if (!copyValue || typeof copyValue !== 'object' || Array.isArray(copyValue)) {
    throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field, reason: 'record-required' });
  }
  return copyValue;
}

function validateEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: 'entry' });
  }
  const kind = entry.kind;
  if (!ENTRY_KINDS.has(kind)) throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: 'entry.kind' });
  const normalized = {
    id: safeId(entry.id, 'entry.id'),
    kind,
    actor: actor(entry.actor),
    ...(entry.source ? { source: text(entry.source, 120, 'entry.source') } : {}),
  };
  if (kind === 'question' || kind === 'prediction') {
    normalized.text = text(entry.text, EXPLORATION_THREAD_LIMITS.maxTextLength, 'entry.text');
  }
  if (kind === 'prediction') {
    if (typeof entry.baselineConditionFingerprint !== 'string' || !entry.baselineConditionFingerprint.trim()) {
      throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: 'entry.baselineConditionFingerprint' });
    }
    normalized.baselineConditionFingerprint = entry.baselineConditionFingerprint.trim();
    if (entry.scenarioSummary !== undefined) normalized.scenarioSummary = text(entry.scenarioSummary, 320, 'entry.scenarioSummary');
    if (entry.scenarioReference !== undefined) normalized.scenarioReference = safeJson(entry.scenarioReference, 'entry.scenarioReference');
  }
  if (kind === 'experiment') {
    if (!Array.isArray(entry.experimentIds) || entry.experimentIds.length === 0 || entry.experimentIds.length > 4) {
      throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: 'entry.experimentIds' });
    }
    const experimentIds = entry.experimentIds.map((id) => safeId(id, 'entry.experimentIds'));
    if (new Set(experimentIds).size !== experimentIds.length) {
      throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: 'entry.experimentIds', reason: 'duplicate' });
    }
    normalized.experimentIds = experimentIds.slice(0, 4);
    normalized.activeExperimentId = safeId(entry.activeExperimentId, 'entry.activeExperimentId');
    normalized.baselineExperimentId = safeId(entry.baselineExperimentId ?? entry.activeExperimentId, 'entry.baselineExperimentId');
    if (!normalized.experimentIds.includes(normalized.activeExperimentId)) {
      throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: 'entry.activeExperimentId', reason: 'not-referenced' });
    }
    if (!normalized.experimentIds.includes(normalized.baselineExperimentId)) {
      throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: 'entry.baselineExperimentId', reason: 'not-referenced' });
    }
    normalized.comparison = {
      enabled: Boolean(entry.comparison?.enabled),
      againstExperimentId: entry.comparison?.againstExperimentId ? safeId(entry.comparison.againstExperimentId, 'entry.comparison.againstExperimentId') : null,
    };
    if (normalized.comparison.enabled
      && (!normalized.comparison.againstExperimentId || !normalized.experimentIds.includes(normalized.comparison.againstExperimentId))) {
      throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: 'entry.comparison.againstExperimentId', reason: 'not-referenced' });
    }
    normalized.conditionFingerprints = safeRecord(entry.conditionFingerprints ?? {}, 'entry.conditionFingerprints');
    for (const id of normalized.experimentIds) {
      if (typeof normalized.conditionFingerprints[id] !== 'string' || !normalized.conditionFingerprints[id].trim()) {
        throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: `entry.conditionFingerprints.${id}` });
      }
    }
    if (entry.semanticDiff !== undefined) normalized.semanticDiff = safeJson(entry.semanticDiff, 'entry.semanticDiff');
    if (entry.scenarioSummary !== undefined) normalized.scenarioSummary = text(entry.scenarioSummary, 320, 'entry.scenarioSummary');
    if (entry.scenarioReference !== undefined) normalized.scenarioReference = safeJson(entry.scenarioReference, 'entry.scenarioReference');
  }
  if (kind === 'observation') {
    if (!Array.isArray(entry.experimentIds) || entry.experimentIds.length === 0 || entry.experimentIds.length > 4) {
      throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: 'entry.experimentIds' });
    }
    const experimentIds = entry.experimentIds.map((id) => safeId(id, 'entry.experimentIds'));
    if (new Set(experimentIds).size !== experimentIds.length) {
      throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: 'entry.experimentIds', reason: 'duplicate' });
    }
    normalized.experimentIds = experimentIds.slice(0, 4);
    if (!normalized.experimentIds.length) throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: 'entry.experimentIds' });
    normalized.conditionFingerprints = safeRecord(entry.conditionFingerprints ?? {}, 'entry.conditionFingerprints');
    for (const id of normalized.experimentIds) {
      if (typeof normalized.conditionFingerprints[id] !== 'string' || !normalized.conditionFingerprints[id].trim()) {
        throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: `entry.conditionFingerprints.${id}` });
      }
    }
    normalized.evidence = safeRecord(entry.evidence ?? {}, 'entry.evidence');
    if (normalized.evidence.conceptSignals !== undefined) {
      const canonicalConceptSignals = canonicalizeConceptSignals(normalized.evidence.conceptSignals);
      if (!canonicalConceptSignals || JSON.stringify(canonicalConceptSignals) !== JSON.stringify(normalized.evidence.conceptSignals)) {
        throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: 'entry.evidence.conceptSignals', reason: 'canonical-concepts-required' });
      }
      normalized.evidence.conceptSignals = canonicalConceptSignals;
    }
    for (const field of ['observables', 'derivedObservables', 'repeatEvidence']) {
      if (normalized.evidence[field] !== undefined
        && (!normalized.evidence[field] || typeof normalized.evidence[field] !== 'object' || Array.isArray(normalized.evidence[field]))) {
        throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: `entry.evidence.${field}`, reason: 'record-required' });
      }
    }
    const observableCount = Object.keys(normalized.evidence.observables ?? {}).length
      + Object.keys(normalized.evidence.derivedObservables ?? {}).length;
    if (observableCount > EXPLORATION_THREAD_LIMITS.maxObservablesPerObservation) {
      throw explorationThreadError('EXPLORATION_THREAD_RESOURCE_LIMIT', { field: 'entry.evidence', max: EXPLORATION_THREAD_LIMITS.maxObservablesPerObservation });
    }
    if (entry.note !== undefined && entry.note !== null && entry.note !== '') {
      normalized.note = text(entry.note, EXPLORATION_THREAD_LIMITS.maxNoteLength, 'entry.note');
    }
    normalized.historical = true;
  }
  if (entry.recordedAt !== undefined) normalized.recordedAt = String(entry.recordedAt);
  return normalized;
}

export function validateExplorationThread(thread) {
  if (!thread || typeof thread !== 'object' || Array.isArray(thread)) {
    throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: 'thread' });
  }
  if (thread.version !== EXPLORATION_THREAD_VERSION) {
    throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: 'thread.version', expected: EXPLORATION_THREAD_VERSION });
  }
  if (!Array.isArray(thread.entries) || thread.entries.length > EXPLORATION_THREAD_LIMITS.maxEntriesPerThread) {
    throw explorationThreadError('EXPLORATION_THREAD_RESOURCE_LIMIT', { field: 'thread.entries' });
  }
  const ids = new Set();
  const entries = thread.entries.map((entry) => {
    const normalized = validateEntry(entry);
    if (ids.has(normalized.id)) throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: 'entry.id', reason: 'duplicate' });
    ids.add(normalized.id);
    return normalized;
  });
  return {
    version: EXPLORATION_THREAD_VERSION,
    id: safeId(thread.id, 'thread.id'),
    title: text(thread.title ?? 'Exploration', EXPLORATION_THREAD_LIMITS.maxTitleLength, 'thread.title'),
    entries,
    createdAt: thread.createdAt ? String(thread.createdAt) : undefined,
    updatedAt: thread.updatedAt ? String(thread.updatedAt) : undefined,
  };
}

export function createExplorationThread({ id, title, now = new Date().toISOString(), question, actor: entryActor = 'human', source } = {}) {
  const thread = validateExplorationThread({
    version: EXPLORATION_THREAD_VERSION,
    id: id ?? `thread-${crypto.randomUUID()}`,
    title: title ?? question ?? 'Exploration',
    entries: question ? [{ id: `entry-${crypto.randomUUID()}`, kind: 'question', text: question, actor: entryActor, source }] : [],
    createdAt: now,
    updatedAt: now,
  });
  return thread;
}

export function appendExplorationThreadEntry(thread, entry, now = new Date().toISOString()) {
  const current = validateExplorationThread(thread);
  if (current.entries.length >= EXPLORATION_THREAD_LIMITS.maxEntriesPerThread) {
    throw explorationThreadError('EXPLORATION_THREAD_RESOURCE_LIMIT', { field: 'thread.entries', max: EXPLORATION_THREAD_LIMITS.maxEntriesPerThread });
  }
  const normalized = validateEntry({ id: entry.id ?? `entry-${crypto.randomUUID()}`, ...entry });
  if (current.entries.some((item) => item.id === normalized.id)) {
    throw explorationThreadError('EXPLORATION_THREAD_INVALID', { field: 'entry.id', reason: 'duplicate' });
  }
  return validateExplorationThread({ ...current, entries: [...current.entries, normalized], updatedAt: now });
}

export function removeExplorationThreadEntry(thread, entryId, now = new Date().toISOString()) {
  const current = validateExplorationThread(thread);
  const id = safeId(entryId, 'entryId');
  return validateExplorationThread({ ...current, entries: current.entries.filter((entry) => entry.id !== id), updatedAt: now });
}

export function createExplorationThreadState() {
  return { explorationThreads: [], activeExplorationThreadId: null };
}

export function normalizeExplorationThreadState(state = {}) {
  const threads = Array.isArray(state.explorationThreads) ? state.explorationThreads : [];
  if (threads.length > EXPLORATION_THREAD_LIMITS.maxThreads) {
    throw explorationThreadError('EXPLORATION_THREAD_RESOURCE_LIMIT', { field: 'explorationThreads', max: EXPLORATION_THREAD_LIMITS.maxThreads });
  }
  const normalized = threads.map(validateExplorationThread);
  const active = state.activeExplorationThreadId === null || state.activeExplorationThreadId === undefined
    ? null
    : safeId(state.activeExplorationThreadId, 'activeExplorationThreadId');
  if (active && !normalized.some((thread) => thread.id === active)) {
    throw explorationThreadError('EXPLORATION_THREAD_NOT_FOUND', { threadId: active });
  }
  return { explorationThreads: normalized, activeExplorationThreadId: active };
}

export function activeExplorationThread(state) {
  return (state.explorationThreads ?? []).find((thread) => thread.id === state.activeExplorationThreadId) ?? null;
}

export function availableExperimentIds(session) {
  return new Set(Object.keys(session?.experimentWorkspace?.entries ?? {}));
}
