export function controlValidationError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

// This is the canonical runtime contract. ScenarioSpec validation and the
// reducer both call this function so a preflight cannot accept a value that
// SET_CONTROL would later reject. `step` remains UI quantization metadata;
// existing runtime controls intentionally accept continuous numeric values.
export function validateCanonicalControlValue(control, value) {
  if (!control || typeof control !== 'object') {
    throw controlValidationError('INVALID_PLAYGROUND_CONTROL', { key: control?.key ?? null, value });
  }
  if (control.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)
      || (control.min !== undefined && number < control.min)
      || (control.max !== undefined && number > control.max)) {
      throw controlValidationError('INVALID_PLAYGROUND_CONTROL', { key: control.key, value });
    }
    return number;
  }
  if (control.type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw controlValidationError('INVALID_PLAYGROUND_CONTROL', { key: control.key, value });
    }
    return value;
  }
  if (control.type === 'select' && control.options && !control.options.includes(value)) {
    throw controlValidationError('INVALID_PLAYGROUND_CONTROL', { key: control.key, value });
  }
  return value;
}
