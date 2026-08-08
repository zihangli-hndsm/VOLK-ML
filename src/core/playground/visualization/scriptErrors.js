// Single source of truth for Visualization Script contract error codes. The
// Agent error normalizer accepts these codes so script contract failures
// surface with a stable SCRIPT_* code instead of OPERATION_FAILED.
export const SCRIPT_ERROR_CODES = [
  'INVALID_SCRIPT',
  'SCRIPT_UNKNOWN_MODEL',
  'SCRIPT_MODEL_MISMATCH',
  'SCRIPT_UNKNOWN_PRIMITIVE',
  'SCRIPT_UNKNOWN_PRIMITIVE_REFERENCE',
  'SCRIPT_UNSUPPORTED_OPERATION',
  'SCRIPT_INVALID_BINDING',
  'SCRIPT_BINDING_UNRESOLVED',
  'SCRIPT_BINDING_TYPE_MISMATCH',
  'SCRIPT_PRIMITIVE_CONTRACT_VIOLATION',
  'SCRIPT_TRACE_PAYLOAD_INVALID',
  'SCRIPT_TOO_COMPLEX',
  'SCRIPT_ANNOTATION_TARGET_MISSING',
  'SCRIPT_ANNOTATION_TARGET_AMBIGUOUS',
  'SCRIPT_CAPTURE_MISSING',
];

export function scriptError(code, details = {}) {
  return Object.assign(new Error(code), { code, details });
}
