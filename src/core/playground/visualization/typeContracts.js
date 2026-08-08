// Reusable semantic type contracts used by primitive validation, trace
// payload validation and the strict dry run. Types are strings like
// 'number', 'array<point2d>', 'neighbor', 'line2d'. Complex record types
// check the fields the current renderers/runtime actually require; extra
// fields are allowed.

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const ELEMENT_CONTRACTS = {
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  'number|null': (value) => value === null || (typeof value === 'number' && Number.isFinite(value)),
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  string: (value) => typeof value === 'string',
  id: (value) => typeof value === 'string' || typeof value === 'number',
  point2d: (value) => isRecord(value) && ELEMENT_CONTRACTS.number(value.x) && ELEMENT_CONTRACTS.number(value.y),
  classifiedPoint2d: (value) => isRecord(value)
    && ELEMENT_CONTRACTS.number(value.x)
    && ELEMENT_CONTRACTS.number(value.y)
    && (value.label === undefined || typeof value.label === 'string'),
  residualPoint: (value) => isRecord(value)
    && ELEMENT_CONTRACTS.number(value.x)
    && ELEMENT_CONTRACTS.number(value.y)
    && ELEMENT_CONTRACTS.number(value.prediction),
  neighbor: (value) => isRecord(value)
    && ELEMENT_CONTRACTS.id(value.pointId)
    && ELEMENT_CONTRACTS.number(value.distance)
    && (value.label === undefined || typeof value.label === 'string'),
  decisionCell: (value) => isRecord(value)
    && ELEMENT_CONTRACTS.number(value.x)
    && ELEMENT_CONTRACTS.number(value.y)
    && typeof value.label === 'string',
};

const RECORD_TYPES = new Set([
  'object',
  'line2d',
  'ranges2d',
  'axes2d',
  'decisionRegion',
  'voteState',
  'trainingState',
  'projection',
  'normalization',
  'metrics',
  'formula',
  'observation',
]);

const PRIMITIVE_ARRAY_TYPES = new Set(['number', 'string', 'id']);

// Validates a value against a semantic type. Returns true/false; unknown types
// fail closed so schema gaps are detected instead of silently accepted.
export function validateType(value, type) {
  if (type.startsWith('array<')) {
    const inner = type.slice('array<'.length, -1);
    if (!Array.isArray(value)) return false;
    if (PRIMITIVE_ARRAY_TYPES.has(inner)) {
      return value.every((item) => ELEMENT_CONTRACTS[inner](item));
    }
    const elementCheck = ELEMENT_CONTRACTS[inner];
    return elementCheck ? value.every(elementCheck) : false;
  }
  if (ELEMENT_CONTRACTS[type]) return ELEMENT_CONTRACTS[type](value);
  if (type === 'array') return Array.isArray(value);
  if (RECORD_TYPES.has(type)) return isRecord(value);
  return false;
}
