import { getModelAdapter } from '../model/modelRegistry.js';
import { isKnownPrimitiveType } from './primitives.js';
import { isKnownTraceEvent } from '../trace/traceTypes.js';
import {
  ALLOWED_STEP_FIELDS,
  ALLOWED_STEP_OPERATIONS,
  hasExecutableContent,
  isAllowedBinding,
  isJsonSafe,
  SCRIPT_VERSION,
} from './scriptSchema.js';

const MAX_STEPS = 200;
const MAX_PRIMITIVES = 40;
const MAX_DURATION_MS = 10000;
const MAX_DECISION_RESOLUTION = 48;

const scriptError = (code, details = {}) => (
  Object.assign(new Error(code), { code, details })
);

function collectBindings(value, bindings) {
  if (typeof value === 'string' && value.startsWith('$')) bindings.add(value);
  if (Array.isArray(value)) value.forEach((item) => collectBindings(item, bindings));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectBindings(item, bindings));
}

// Validates a Visualization Script declaration. Throws with a stable error
// code: SCRIPT_UNKNOWN_MODEL, SCRIPT_UNKNOWN_PRIMITIVE,
// SCRIPT_UNSUPPORTED_OPERATION, SCRIPT_INVALID_BINDING,
// SCRIPT_UNKNOWN_TRACE_EVENT, SCRIPT_TOO_COMPLEX, INVALID_SCRIPT.
export function validateScript(script) {
  if (!script || typeof script !== 'object' || Array.isArray(script)) {
    throw scriptError('INVALID_SCRIPT', { reason: 'declaration' });
  }
  if (!isJsonSafe(script)) throw scriptError('INVALID_SCRIPT', { reason: 'not json-safe' });
  if (hasExecutableContent(script)) throw scriptError('INVALID_SCRIPT', { reason: 'executable content' });
  if (script.version !== SCRIPT_VERSION) throw scriptError('INVALID_SCRIPT', { reason: 'version' });
  if (typeof script.id !== 'string' || !script.id) throw scriptError('INVALID_SCRIPT', { reason: 'id' });
  const adapterId = script.model?.adapter;
  const adapter = getModelAdapter(adapterId);
  if (!adapter) throw scriptError('SCRIPT_UNKNOWN_MODEL', { model: adapterId });
  if (!Array.isArray(script.steps) || !Array.isArray(script.primitives)) {
    throw scriptError('INVALID_SCRIPT', { reason: 'steps/primitives must be arrays' });
  }
  if (script.steps.length > MAX_STEPS) throw scriptError('SCRIPT_TOO_COMPLEX', { steps: script.steps.length, max: MAX_STEPS });
  if (script.primitives.length > MAX_PRIMITIVES) {
    throw scriptError('SCRIPT_TOO_COMPLEX', { primitives: script.primitives.length, max: MAX_PRIMITIVES });
  }

  const primitiveIds = new Set();
  for (const primitive of script.primitives) {
    if (typeof primitive.id !== 'string' || !primitive.id || primitiveIds.has(primitive.id)) {
      throw scriptError('INVALID_SCRIPT', { reason: 'primitive id must be unique' });
    }
    primitiveIds.add(primitive.id);
    if (!isKnownPrimitiveType(primitive.type)) {
      throw scriptError('SCRIPT_UNKNOWN_PRIMITIVE', { type: primitive.type, id: primitive.id });
    }
    if (primitive.props?.decisionRegion?.resolution !== undefined
      && primitive.props.decisionRegion.resolution > MAX_DECISION_RESOLUTION) {
      throw scriptError('SCRIPT_TOO_COMPLEX', { reason: 'decision resolution' });
    }
  }

  const stepIds = new Set();
  const bindings = new Set();
  for (const step of script.steps) {
    if (typeof step.id !== 'string' || !step.id || stepIds.has(step.id)) {
      throw scriptError('INVALID_SCRIPT', { reason: 'step id must be unique' });
    }
    stepIds.add(step.id);
    for (const field of Object.keys(step)) {
      if (!ALLOWED_STEP_FIELDS.has(field)) throw scriptError('INVALID_SCRIPT', { reason: `unknown step field ${field}` });
    }
    const operations = Object.keys(step).filter((key) => ALLOWED_STEP_OPERATIONS.includes(key));
    if (!operations.length) throw scriptError('INVALID_SCRIPT', { reason: 'step has no operation' });
    if (Number.isFinite(Number(step.durationMs)) && Number(step.durationMs) > MAX_DURATION_MS) {
      throw scriptError('SCRIPT_TOO_COMPLEX', { reason: 'duration' });
    }
    if (step.invoke) {
      const operation = step.invoke.operation;
      const capability = operation === 'traceFit' ? 'traceFit'
        : operation === 'tracePredict' ? 'tracePredict'
          : operation === 'setBestFit' ? 'fit'
            : operation === 'moveQuery' ? 'predict'
              : null;
      if (!capability || !adapter.capabilities[capability]) {
        throw scriptError('SCRIPT_UNSUPPORTED_OPERATION', { operation });
      }
      collectBindings(step.invoke.args, bindings);
    } else if ('invoke' in step) {
      throw scriptError('SCRIPT_UNSUPPORTED_OPERATION', { operation: null });
    }
    if (step.consume) {
      if (!isKnownTraceEvent(adapterId, step.consume.event)) {
        throw scriptError('SCRIPT_UNKNOWN_TRACE_EVENT', { event: step.consume.event });
      }
    }
    collectBindings(step, bindings);
  }
  for (const binding of bindings) {
    if (!isAllowedBinding(binding)) throw scriptError('SCRIPT_INVALID_BINDING', { binding });
  }
  return script;
}
