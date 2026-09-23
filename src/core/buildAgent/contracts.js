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

const FNV64_OFFSET = 14_695_981_039_346_656_037n;
const FNV64_PRIME = 1_099_511_628_211n;
const FNV64_MASK = 18_446_744_073_709_551_615n;

function emitCanonical(value, visit) {
  if (value === null || typeof value !== 'object') {
    const scalar = JSON.stringify(value);
    for (let index = 0; index < scalar.length; index += 1) visit(scalar.charCodeAt(index));
    return;
  }
  if (Array.isArray(value)) {
    visit(91);
    value.forEach((item, index) => {
      if (index) visit(44);
      emitCanonical(item, visit);
    });
    visit(93);
    return;
  }
  visit(123);
  Object.keys(value).sort().forEach((key, index) => {
    if (index) visit(44);
    const encodedKey = JSON.stringify(key);
    for (let offset = 0; offset < encodedKey.length; offset += 1) visit(encodedKey.charCodeAt(offset));
    visit(58);
    emitCanonical(value[key], visit);
  });
  visit(125);
}

/** Stable, non-cryptographic identity for bounded local semantic values. */
export function stableBuildIdentity(value, namespace) {
  assertJsonSafe(value, 'BUILD_IDENTITY_INVALID');
  const identityNamespace = boundedId(namespace, 'identity namespace', 32);
  let hash = FNV64_OFFSET;
  let codeUnits = 0;
  emitCanonical(value, (unit) => {
    hash ^= BigInt(unit);
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
    codeUnits += 1;
  });
  return `${identityNamespace}-v1-${hash.toString(16).padStart(16, '0')}-${codeUnits.toString(16)}`;
}

export function assertBuildIdentity(value, namespace, field = 'identity') {
  const prefix = `${boundedId(namespace, 'identity namespace', 32)}-v1-`;
  if (typeof value !== 'string' || !value.startsWith(prefix) || !/^[0-9a-f]{16}-[0-9a-f]+$/.test(value.slice(prefix.length))) {
    failBuildAgent('BUILD_CONTRACT_INVALID', `${field} has an invalid semantic identity.`, { field, namespace });
  }
  return value;
}
