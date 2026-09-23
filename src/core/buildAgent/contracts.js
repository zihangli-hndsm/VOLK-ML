export const BUILD_AGENT_CONTRACT_VERSION = 1;
export const BUILD_EXECUTION_EXPECTATIONS = Object.freeze([
  'browser-local',
  'export-only',
  'future-cloud',
  'unsupported',
]);

export const BUILD_TASKS = Object.freeze(['regression', 'classification']);
export const BUILD_MODEL_FAMILIES = Object.freeze(['linear-regression', 'knn', 'mlp']);
export const BUILD_ARCHITECTURES = Object.freeze(['baseline', 'explicit-mlp']);

export class BuildAgentError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BuildAgentError';
    this.code = code;
    this.details = structuredClone(details);
  }
}

export function buildAgentError(code, message, details = {}) {
  return new BuildAgentError(code, message, details);
}

export function failBuildAgent(code, message, details = {}) {
  throw buildAgentError(code, message, details);
}

export function assertPlainObject(value, code, field = 'value') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    failBuildAgent(code, `${field} must be a plain object.`, { field });
  }
  return value;
}

export function assertJsonSafe(value, code = 'BUILD_CONTRACT_INVALID', path = '$', ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    failBuildAgent(code, `Non-finite number at ${path}.`, { path });
  }
  if (typeof value !== 'object' || ancestors.has(value)) {
    failBuildAgent(code, `Non-JSON value at ${path}.`, { path });
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) {
    failBuildAgent(code, `Non-plain object at ${path}.`, { path });
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, code, `${path}[${index}]`, ancestors));
  } else {
    Object.entries(value).forEach(([key, child]) => assertJsonSafe(child, code, `${path}.${key}`, ancestors));
  }
  ancestors.delete(value);
  return value;
}

export function rejectUnknownFields(value, allowed, code = 'BUILD_CONTRACT_INVALID', path = '$') {
  assertPlainObject(value, code, path);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) failBuildAgent(code, `Unknown field(s) at ${path}.`, { path, unknown });
}

export function boundedId(value, field = 'id', max = 96) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    failBuildAgent('BUILD_CONTRACT_INVALID', `${field} must be a bounded non-empty string.`, { field, max });
  }
  return value.trim();
}

export function boundedString(value, field, max = 160) {
  if (typeof value !== 'string' || value.length > max) {
    failBuildAgent('BUILD_CONTRACT_INVALID', `${field} must be bounded text.`, { field, max });
  }
  return value;
}

export function boundedStringArray(values, field, { max = 32, itemMax = 96 } = {}) {
  if (!Array.isArray(values) || values.length > max) {
    failBuildAgent('BUILD_CONTRACT_INVALID', `${field} must be a bounded array.`, { field, max });
  }
  const seen = new Set();
  return values.map((value, index) => {
    const item = boundedString(value, `${field}[${index}]`, itemMax).trim();
    if (!item || seen.has(item)) failBuildAgent('BUILD_CONTRACT_INVALID', `${field} contains an empty or duplicate item.`, { field, index });
    seen.add(item);
    return item;
  });
}

export function boundedInteger(value, field, { min = 0, max = 1_000_000 } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    failBuildAgent('BUILD_CONTRACT_INVALID', `${field} must be an integer within bounds.`, { field, min, max, value });
  }
  return value;
}

export function boundedNumber(value, field, { min = -Infinity, max = Infinity } = {}) {
  if (!Number.isFinite(value) || value < min || value > max) {
    failBuildAgent('BUILD_CONTRACT_INVALID', `${field} must be a finite number within bounds.`, { field, min, max, value });
  }
  return value;
}

export function assertVersion(value, field = 'version') {
  if (value !== BUILD_AGENT_CONTRACT_VERSION) {
    failBuildAgent('BUILD_CONTRACT_VERSION_UNSUPPORTED', `${field} must be ${BUILD_AGENT_CONTRACT_VERSION}.`, {
      field,
      expected: BUILD_AGENT_CONTRACT_VERSION,
      received: value,
    });
  }
}

export function cloneJson(value) {
  assertJsonSafe(value);
  return structuredClone(value);
}
