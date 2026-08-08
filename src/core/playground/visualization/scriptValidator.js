import { getModelAdapter } from '../model/modelRegistry.js';
import { isKnownPrimitiveType } from './primitives.js';
import {
  ALLOWED_STEP_FIELDS,
  ALLOWED_STEP_OPERATIONS,
  hasExecutableContent,
  isAllowedBinding,
  isJsonSafe,
  SCRIPT_VERSION,
} from './scriptSchema.js';
import { scriptError } from './scriptErrors.js';

const MAX_STEPS = 200;
const MAX_PRIMITIVES = 40;
const MAX_DURATION_MS = 10000;
const MAX_DECISION_RESOLUTION = 48;

export const RESOURCE_LIMITS = {
  maxSteps: MAX_STEPS,
  maxPrimitives: MAX_PRIMITIVES,
  maxDecisionResolution: MAX_DECISION_RESOLUTION,
  defaultDecisionResolution: 48,
  maxDurationMs: MAX_DURATION_MS,
};

// Single rule for decision-region resolution limits, shared by the static
// validator and the strict dry run (which validates resolved values).
export function isValidDecisionResolution(resolution) {
  return Number.isInteger(resolution) && resolution >= 1 && resolution <= MAX_DECISION_RESOLUTION;
}

function collectBindings(value, bindings) {
  if (typeof value === 'string' && (
    value.startsWith('$') || /^[A-Za-z]+\(\$[A-Za-z0-9_.]+\)$/.test(value)
  )) bindings.add(value);
  if (Array.isArray(value)) value.forEach((item) => collectBindings(item, bindings));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectBindings(item, bindings));
}

// Validates a Visualization Script declaration. Throws with a stable error
// code: SCRIPT_UNKNOWN_MODEL, SCRIPT_UNKNOWN_PRIMITIVE,
// SCRIPT_UNKNOWN_PRIMITIVE_REFERENCE, SCRIPT_UNSUPPORTED_OPERATION,
// SCRIPT_INVALID_BINDING, SCRIPT_ANNOTATION_TARGET_MISSING,
// SCRIPT_ANNOTATION_TARGET_AMBIGUOUS, SCRIPT_TOO_COMPLEX, INVALID_SCRIPT.
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
  const bindings = new Set();
  let annotationCount = 0;
  for (const primitive of script.primitives) {
    if (typeof primitive.id !== 'string' || !primitive.id || primitiveIds.has(primitive.id)) {
      throw scriptError('INVALID_SCRIPT', { reason: 'primitive id must be unique' });
    }
    primitiveIds.add(primitive.id);
    if (primitive.type === 'annotation') annotationCount += 1;
    if (!isKnownPrimitiveType(primitive.type)) {
      throw scriptError('SCRIPT_UNKNOWN_PRIMITIVE', { type: primitive.type, id: primitive.id });
    }
    if (primitive.type === 'decision-region' && typeof primitive.props?.resolution === 'number'
      && !isValidDecisionResolution(primitive.props.resolution)) {
      throw scriptError('SCRIPT_TOO_COMPLEX', { reason: 'decision resolution', resolution: primitive.props.resolution, max: MAX_DECISION_RESOLUTION });
    }
    if (primitive.when !== undefined && !isJsonSafe(primitive.when)) {
      throw scriptError('INVALID_SCRIPT', { reason: 'when must be JSON-safe' });
    }
    collectBindings(primitive, bindings);
  }

  // Layout integrity: every layout bucket must reference declared primitives
  // and must not repeat an id.
  for (const bucket of ['stage', 'side']) {
    const layoutIds = script.layout?.[bucket];
    if (!Array.isArray(layoutIds)) continue;
    const seen = new Set();
    for (const id of layoutIds) {
      if (!primitiveIds.has(id)) throw scriptError('SCRIPT_UNKNOWN_PRIMITIVE_REFERENCE', { bucket, id });
      if (seen.has(id)) throw scriptError('INVALID_SCRIPT', { reason: `duplicate layout id ${id}` });
      seen.add(id);
    }
  }

  const stepIds = new Set();
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
    for (const operation of ['show', 'hide', 'highlight']) {
      if (step[operation] !== undefined && !primitiveIds.has(step[operation])) {
        throw scriptError('SCRIPT_UNKNOWN_PRIMITIVE_REFERENCE', {
          stepId: step.id,
          operation,
          primitiveId: step[operation],
        });
      }
    }
    if (step.annotate !== undefined) {
      if (annotationCount === 0) throw scriptError('SCRIPT_ANNOTATION_TARGET_MISSING', { stepId: step.id });
      if (annotationCount > 1) throw scriptError('SCRIPT_ANNOTATION_TARGET_AMBIGUOUS', { stepId: step.id, count: annotationCount });
    }
    if (Number.isFinite(Number(step.durationMs)) && Number(step.durationMs) > MAX_DURATION_MS) {
      throw scriptError('SCRIPT_TOO_COMPLEX', { reason: 'duration' });
    }
    if (step.invoke) {
      const operation = step.invoke.operation;
      if (!adapter.scriptOperations || !adapter.scriptOperations[operation]) {
        throw scriptError('SCRIPT_UNSUPPORTED_OPERATION', { operation });
      }
      collectBindings(step.invoke.args, bindings);
    } else if ('invoke' in step) {
      throw scriptError('SCRIPT_UNSUPPORTED_OPERATION', { operation: null });
    }
    collectBindings(step, bindings);
  }
  for (const binding of bindings) {
    if (!isAllowedBinding(binding)) throw scriptError('SCRIPT_INVALID_BINDING', { binding });
  }
  return script;
}
