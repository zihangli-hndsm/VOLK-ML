// Semantic trace event contract shared by the unified playground runtime.
//
// A trace event is a plain JSON-safe object that records *what happened* in
// model terms. Renderers never receive raw model state; they receive the
// scene/primitives derived from these events. Events are deterministic: id,
// step and timestamp come from a session-local counter, never from the wall
// clock, so the same script + seed + data replays to exactly the same trace.

export const TRACE_EVENTS = {
  'linear-regression': [
    'data.loaded',
    'split.created',
    'normalization.fitted',
    'regression.initialized',
    'prediction.updated',
    'residuals.computed',
    'loss.measured',
    'gradient.computed',
    'parameters.updated',
    'training.completed',
  ],
  'knn': [
    'data.loaded',
    'split.created',
    'normalization.fitted',
    'knn.samplesStored',
    'query.received',
    'knn.distancesComputed',
    'knn.neighborSelected',
    'knn.voteUpdated',
    'prediction.emitted',
    'evaluation.completed',
  ],
};

export function isKnownTraceEvent(adapterId, type) {
  return Array.isArray(TRACE_EVENTS[adapterId]) && TRACE_EVENTS[adapterId].includes(type);
}

// Validates that an event is JSON-safe and carries the required identity
// fields. Throws a plain Error with a stable code for contract tests.
export function validateTraceEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw Object.assign(new Error('INVALID_TRACE_EVENT'), { code: 'INVALID_TRACE_EVENT' });
  }
  if (typeof event.id !== 'string' || !event.id) {
    throw Object.assign(new Error('INVALID_TRACE_EVENT'), { code: 'INVALID_TRACE_EVENT', details: { reason: 'id' } });
  }
  if (typeof event.type !== 'string' || !event.type) {
    throw Object.assign(new Error('INVALID_TRACE_EVENT'), { code: 'INVALID_TRACE_EVENT', details: { reason: 'type' } });
  }
  if (!Number.isInteger(event.step) || !Number.isInteger(event.timestamp)) {
    throw Object.assign(new Error('INVALID_TRACE_EVENT'), { code: 'INVALID_TRACE_EVENT', details: { reason: 'step/timestamp' } });
  }
  try {
    structuredClone(event);
  } catch {
    throw Object.assign(new Error('INVALID_TRACE_EVENT'), { code: 'INVALID_TRACE_EVENT', details: { reason: 'not json-safe' } });
  }
  return event;
}
