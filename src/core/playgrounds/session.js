import {
  createRuntimeSession,
  deriveRuntimeSnapshot,
  dispatchRuntimeAction,
} from '../playground/playgroundRuntime.js';

export const PLAYGROUND_ERROR_CODES = [
  'PLAYGROUND_NOT_FOUND',
  'PLAYGROUND_NOT_AVAILABLE',
  'PLAYGROUND_NOT_OPEN',
  'PLAYGROUND_ALREADY_OPEN',
  'INVALID_PLAYGROUND_SOURCE',
  'INVALID_PLAYGROUND_CONTROL',
  'INVALID_PLAYGROUND_ACTION',
  'INVALID_PLAYGROUND_STEP',
  'PLAYGROUND_SCENARIO_NOT_FOUND',
  'PLAYGROUND_PRESET_NOT_FOUND',
  'PLAYGROUND_SOURCE_STALE',
  'TEACHING_PLAN_INVALID',
  'TEACHING_GOAL_UNSUPPORTED',
  'TEACHING_CONTROL_INVALID',
  'TEACHING_VALUE_OUT_OF_RANGE',
  'TEACHING_GOAL_FIDELITY_FAILED',
];

export function playgroundError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

export function validateActionShape(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action?.type ?? null });
  }
  if (typeof action.type !== 'string' || !action.type) {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type });
  }
}

export function validateControlValue(control, value) {
  if (control.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: control.key, value });
    if (control.min !== undefined && number < control.min) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: control.key, value });
    if (control.max !== undefined && number > control.max) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: control.key, value });
    return number;
  }
  if (control.type === 'boolean') return Boolean(value);
  if (control.type === 'select' && control.options && !control.options.includes(value)) {
    throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: control.key, value });
  }
  return value;
}

// Public session API. All session semantics live in the unified playground
// runtime; these wrappers keep the registry/Agent/UI contracts stable.
export function createPlaygroundSession(playground, options) {
  return createRuntimeSession(playground, options);
}

export function dispatchPlaygroundAction(session, action) {
  return dispatchRuntimeAction(session, action);
}

export function derivePlaygroundSnapshot(session) {
  return deriveRuntimeSnapshot(session);
}
