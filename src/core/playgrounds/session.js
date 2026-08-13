import {
  createRuntimeSession,
  deriveRuntimeSnapshot,
  dispatchRuntimeAction,
} from '../playground/playgroundRuntime.js';
import { validateCanonicalControlValue } from '../playground/controlValidation.js';

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
  'PLAYGROUND_MODEL_REQUIRED',
  'TEACHING_PLAN_INVALID',
  'TEACHING_GOAL_UNSUPPORTED',
  'TEACHING_CONTROL_INVALID',
  'TEACHING_VALUE_OUT_OF_RANGE',
  'TEACHING_GOAL_FIDELITY_FAILED',
  'EXPLORATION_SCENARIO_INVALID',
  'EXPLORATION_SCENARIO_UNSUPPORTED_REQUEST',
  'EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION',
  'EXPLORATION_SCENARIO_UNSUPPORTED_OBSERVABLE',
  'EXPLORATION_SCENARIO_UNSUPPORTED_CONTROL',
  'EXPLORATION_SCENARIO_CONTROL_OUT_OF_RANGE',
  'EXPLORATION_SCENARIO_INVALID_PARAMETER',
  'EXPLORATION_SCENARIO_POINT_NOT_FOUND',
  'EXPLORATION_SCENARIO_RESOURCE_LIMIT',
  'EXPLORATION_PROPOSAL_STALE',
  'EXPLORATION_SCENARIO_NOT_PROPOSAL',
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
  try {
    return validateCanonicalControlValue(control, value);
  } catch (error) {
    throw playgroundError(error.code ?? 'INVALID_PLAYGROUND_CONTROL', error.details ?? { key: control?.key, value });
  }
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
