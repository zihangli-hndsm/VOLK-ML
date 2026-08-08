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
  'mlp': [
    'data.loaded',
    'mlp.initialized',
    'loss.measured',
    'gradient.computed',
    'parameters.updated',
    'training.completed',
    'query.received',
    'mlp.hiddenActivated',
    'prediction.emitted',
  ],
};

import { validateType } from '../visualization/typeContracts.js';

// Payload shape registry for trace events. Every event type declares required
// and optional fields so the schema describes actual runtime behavior (e.g.
// data.loaded carries different fields for regression vs classification).
export const TRACE_PAYLOAD_SCHEMAS = {
  'data.loaded': {
    required: { points: 'integer' },
    optional: { feature: 'string', target: 'string', features: 'array<string>', trainRatio: 'number' },
  },
  'split.created': {
    required: { trainRows: 'integer', testRows: 'integer' },
    optional: { trainIds: 'array', testIds: 'array', kind: 'string' },
  },
  'normalization.fitted': {
    required: {},
    optional: { xMean: 'number', xStd: 'number', yMean: 'number', yStd: 'number', means: 'array<number>', stds: 'array<number>' },
  },
  'regression.initialized': { required: { weight: 'number', bias: 'number' }, optional: {} },
  'prediction.updated': { required: { weight: 'number', bias: 'number' }, optional: {} },
  'residuals.computed': { required: { count: 'integer' }, optional: { mse: 'number' } },
  'loss.measured': { required: { step: 'integer', loss: 'number' }, optional: { lossNormalized: 'number' } },
  'gradient.computed': { required: { step: 'integer', magnitude: 'number' }, optional: { weight: 'number', bias: 'number' } },
  'parameters.updated': { required: { weight: 'number', bias: 'number' }, optional: { step: 'integer' } },
  'training.completed': { required: { steps: 'integer', requestedSteps: 'integer' }, optional: { stoppedReason: 'string' } },
  'knn.samplesStored': { required: { count: 'integer' }, optional: { trainIds: 'array' } },
  'query.received': { required: { x: 'number', y: 'number' }, optional: { vector: 'array<number>' } },
  'knn.distancesComputed': { required: { count: 'integer' }, optional: { nearest: 'number' } },
  'knn.neighborSelected': { required: { rank: 'integer', pointId: 'id', distance: 'number', label: 'string' }, optional: {} },
  'knn.voteUpdated': { required: { counts: 'object' }, optional: { predictedLabel: 'string', tie: 'boolean' } },
  'prediction.emitted': { required: { label: 'string' }, optional: { k: 'integer' } },
  'evaluation.completed': { required: {}, optional: { accuracy: 'number|null', k: 'integer' } },
  'mlp.initialized': { required: { hiddenSize: 'integer' }, optional: { inputSize: 'integer', outputSize: 'integer' } },
  'mlp.hiddenActivated': { required: { index: 'integer' }, optional: { activation: 'number' } },
};

// Validates an emitted trace event against its payload schema. Required
// fields must exist and match; optional fields are checked when present.
export function validateTracePayload(event) {
  const schema = TRACE_PAYLOAD_SCHEMAS[event.type];
  if (!schema) {
    return { valid: false, code: 'SCRIPT_UNKNOWN_TRACE_EVENT', details: { type: event.type } };
  }
  for (const [field, type] of Object.entries(schema.required ?? {})) {
    if (event.payload?.[field] === undefined || !validateType(event.payload[field], type)) {
      return {
        valid: false,
        code: 'SCRIPT_TRACE_PAYLOAD_INVALID',
        details: { type: event.type, field, expected: type, required: true },
      };
    }
  }
  for (const [field, type] of Object.entries(schema.optional ?? {})) {
    if (event.payload?.[field] !== undefined && !validateType(event.payload[field], type)) {
      return {
        valid: false,
        code: 'SCRIPT_TRACE_PAYLOAD_INVALID',
        details: { type: event.type, field, expected: type, required: false },
      };
    }
  }
  return { valid: true };
}

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
