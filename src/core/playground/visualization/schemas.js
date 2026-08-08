import { PRIMITIVE_TYPES } from './primitives.js';

// Primitive contract schemas: the single source of truth shared by the
// validator, the Agent context (inspectContext), the strict dry run and the
// contract tests. Each entry declares the typed props a renderer needs and the
// compatible bindings the materializer knows how to satisfy.

export const PRIMITIVE_SCHEMAS = {
  scatter: {
    props: {
      points: { type: 'array<point2d>', required: true },
      axes: { type: 'axes2d', required: false },
    },
    compatibleBindings: {
      points: ['$model.scatterPoints', '$model.displayPoints', '$model.points'],
      axes: ['$model.axes'],
    },
  },
  'regression-line': {
    props: {
      line: { type: 'line2d', required: true },
      ranges: { type: 'ranges2d', required: true },
    },
    compatibleBindings: {
      line: ['$model.line', '$model.bestFitLine'],
      ranges: ['$model.ranges'],
    },
  },
  'reference-line': {
    props: {
      line: { type: 'line2d', required: true },
      ranges: { type: 'ranges2d', required: true },
    },
    compatibleBindings: {
      line: ['$model.line', '$model.bestFitLine'],
      ranges: ['$model.ranges'],
    },
  },
  'residual-lines': {
    props: {
      points: { type: 'array<residualPoint>', required: true },
    },
    compatibleBindings: {
      points: ['$model.residualPoints', '$model.residuals'],
    },
  },
  'decision-region': {
    props: {
      cells: { type: 'array<decisionCell>', required: true },
      resolution: { type: 'integer', required: false },
    },
    compatibleBindings: {
      cells: ['$model.decisionRegions.cells'],
      resolution: ['$model.decisionRegions.resolution'],
    },
  },
  'neighbor-links': {
    props: {
      neighbors: { type: 'array<neighbor>', required: true },
      points: { type: 'array<point2d>', required: true },
      query: { type: 'point2d', required: true },
      showOrder: { type: 'boolean', required: false },
    },
    compatibleBindings: {
      neighbors: ['$model.neighbors'],
      points: ['$model.displayPoints', '$model.points'],
      query: ['$model.displayQuery', '$model.query'],
      showOrder: ['$controls.showNeighborOrder'],
    },
  },
  'query-point': {
    props: {
      query: { type: 'point2d', required: true },
    },
    compatibleBindings: {
      query: ['$model.displayQuery', '$model.query'],
    },
  },
  'vote-bars': {
    props: {
      voting: { type: 'voteState', required: true },
    },
    compatibleBindings: {
      voting: ['$model.voting'],
    },
  },
  'loss-curve': {
    props: {
      lossHistory: { type: 'array<number>', required: true },
      currentStep: { type: 'integer', required: false },
    },
    compatibleBindings: {
      lossHistory: ['$model.training.lossHistory'],
      currentStep: ['$model.training.currentStep'],
    },
  },
  formula: {
    props: {
      formula: { type: 'formula', required: true },
    },
    compatibleBindings: {
      formula: ['$model.formula'],
    },
  },
  annotation: {
    props: {
      observation: { type: 'observation', required: true },
    },
    compatibleBindings: {
      observation: ['$model.observation'],
    },
  },
  'metric-card': {
    props: {
      metrics: { type: 'metrics', required: true },
    },
    compatibleBindings: {
      metrics: ['$metrics'],
    },
  },
  legend: {
    props: {},
    compatibleBindings: {},
  },
};

export function getPrimitiveSchema(type) {
  return PRIMITIVE_SCHEMAS[type] ?? null;
}

function matchesType(value, type) {
  if (type === 'array<point2d>' || type === 'array<residualPoint>' || type === 'array<decisionCell>'
    || type === 'array<neighbor>' || type === 'array<number>') {
    return Array.isArray(value);
  }
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'string') return typeof value === 'string';
  return value !== null && typeof value === 'object';
}

// Strict contract validation used by the dry run and the contract tests:
// required props must exist and match the declared basic type. This is a
// lightweight type check, not a full JSON schema.
export function validatePrimitiveContract(primitive) {
  const schema = getPrimitiveSchema(primitive.type);
  if (!schema) {
    return { valid: false, code: 'SCRIPT_UNKNOWN_PRIMITIVE', details: { type: primitive.type } };
  }
  for (const [prop, propSchema] of Object.entries(schema.props)) {
    if (propSchema.required && primitive.props?.[prop] === undefined) {
      return {
        valid: false,
        code: 'SCRIPT_PRIMITIVE_CONTRACT_VIOLATION',
        details: { primitiveId: primitive.id, type: primitive.type, prop },
      };
    }
    if (primitive.props?.[prop] !== undefined && !matchesType(primitive.props[prop], propSchema.type)) {
      return {
        valid: false,
        code: 'SCRIPT_PRIMITIVE_CONTRACT_VIOLATION',
        details: { primitiveId: primitive.id, type: primitive.type, prop, expected: propSchema.type },
      };
    }
  }
  return { valid: true };
}

export function listPrimitiveSchemas() {
  return PRIMITIVE_TYPES.map((type) => ({
    type,
    props: PRIMITIVE_SCHEMAS[type]?.props ?? {},
    compatibleBindings: PRIMITIVE_SCHEMAS[type]?.compatibleBindings ?? {},
  }));
}
