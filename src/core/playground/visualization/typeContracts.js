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

// Structural contracts for composite semantic types: they validate the fields
// the current renderers/runtime actually consume. Extra fields are allowed,
// optional fields are only checked when present.
const STRUCTURAL_CONTRACTS = {
  line2d: (value) => isRecord(value)
    && ELEMENT_CONTRACTS.point2d(value.start)
    && ELEMENT_CONTRACTS.point2d(value.end)
    && (value.weight === undefined || ELEMENT_CONTRACTS.number(value.weight))
    && (value.bias === undefined || ELEMENT_CONTRACTS.number(value.bias)),
  ranges2d: (value) => isRecord(value)
    && ELEMENT_CONTRACTS.number(value.xMin)
    && ELEMENT_CONTRACTS.number(value.xMax)
    && ELEMENT_CONTRACTS.number(value.yMin)
    && ELEMENT_CONTRACTS.number(value.yMax),
  axes2d: (value) => isRecord(value) && typeof value.x === 'string' && typeof value.y === 'string',
  decisionRegion: (value) => isRecord(value)
    && (value.resolution === undefined || ELEMENT_CONTRACTS.integer(value.resolution))
    && (value.cells === undefined || (Array.isArray(value.cells) && value.cells.every(ELEMENT_CONTRACTS.decisionCell))),
  voteState: (value) => isRecord(value) && isRecord(value.counts),
  trainingState: (value) => isRecord(value)
    && (value.currentStep === undefined || ELEMENT_CONTRACTS.integer(value.currentStep))
    && (value.totalSteps === undefined || ELEMENT_CONTRACTS.integer(value.totalSteps))
    && (value.lossHistory === undefined || (Array.isArray(value.lossHistory) && value.lossHistory.every(ELEMENT_CONTRACTS.number))),
  projection: (value) => isRecord(value)
    && (value.enabled === undefined || typeof value.enabled === 'boolean')
    && (value.xFeature === undefined || typeof value.xFeature === 'string')
    && (value.yFeature === undefined || typeof value.yFeature === 'string'),
  normalization: (value) => isRecord(value)
    && (value.means === undefined || (Array.isArray(value.means) && value.means.every(ELEMENT_CONTRACTS.number)))
    && (value.stds === undefined || (Array.isArray(value.stds) && value.stds.every(ELEMENT_CONTRACTS.number))),
  formula: (value) => isRecord(value) && typeof value.key === 'string' && isRecord(value.params ?? {}),
  observation: (value) => isRecord(value)
    && typeof value.titleKey === 'string'
    && typeof value.bodyKey === 'string'
    && isRecord(value.params ?? {}),
  metrics: (value) => isRecord(value),
};

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
  if (STRUCTURAL_CONTRACTS[type]) return STRUCTURAL_CONTRACTS[type](value);
  if (type === 'object') return isRecord(value);
  return false;
}
