import { PRIMITIVE_TYPES } from './primitives.js';
import { validateType } from './typeContracts.js';

// Primitive contract schemas: the single source of truth shared by the
// validator, the Agent context (inspectContext), the strict dry run and the
// contract tests. Each entry declares the typed props a renderer needs and the
// compatible bindings the materializer knows how to satisfy.

export const PRIMITIVE_SCHEMAS = {
  scatter: {
    placement: 'stage',
    props: {
      points: { type: 'array<point2d>', required: true },
      axes: { type: 'axes2d', required: false },
    },
    compatibleBindings: {
      points: ['$model.scatterPoints', '$model.displayPoints'],
      axes: ['$model.axes'],
    },
  },
  'regression-line': {
    placement: 'stage',
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
    placement: 'stage',
    whenControl: 'showBestFit',
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
    placement: 'stage',
    whenControl: 'showResiduals',
    props: {
      points: { type: 'array<residualPoint>', required: true },
    },
    compatibleBindings: {
      points: ['$model.residualPoints'],
    },
  },
  'decision-region': {
    placement: 'stage',
    whenControl: 'showDecisionRegions',
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
    placement: 'stage',
    props: {
      neighbors: { type: 'array<neighbor>', required: true },
      points: { type: 'array<point2d>', required: true },
      query: { type: 'point2d', required: true },
      showOrder: { type: 'boolean', required: false },
    },
    compatibleBindings: {
      neighbors: ['$model.neighbors'],
      points: ['$model.displayPoints'],
      query: ['$model.displayQuery'],
      showOrder: ['$controls.showNeighborOrder'],
    },
  },
  'query-point': {
    placement: 'stage',
    props: {
      query: { type: 'point2d', required: true },
    },
    compatibleBindings: {
      query: ['$model.displayQuery'],
    },
  },
  'vote-bars': {
    placement: 'stage',
    props: {
      voting: { type: 'voteState', required: true },
    },
    compatibleBindings: {
      voting: ['$model.voting'],
    },
  },
  'loss-curve': {
    placement: 'stage',
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
    placement: 'side',
    props: {
      formula: { type: 'formula', required: true },
    },
    compatibleBindings: {
      formula: ['$model.formula'],
    },
  },
  annotation: {
    placement: 'side',
    props: {
      observation: { type: 'observation', required: true },
    },
    compatibleBindings: {
      observation: ['$model.observation'],
    },
  },
  'metric-card': {
    placement: 'side',
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
  'parameter-trajectory': {
    placement: 'stage',
    props: {
      points: { type: 'array<trajectoryPoint>', required: true },
      axes: { type: 'axes2d', required: false },
    },
    compatibleBindings: {
      points: ['$model.training.parameterTrajectory'],
      axes: ['$model.axes'],
    },
  },
  'network-graph': {
    placement: 'stage',
    props: {
      nodes: { type: 'array<networkNode>', required: true },
      edges: { type: 'array<networkEdge>', required: true },
    },
    compatibleBindings: {
      nodes: ['$model.network.nodes'],
      edges: ['$model.network.edges'],
    },
  },
  'matrix-grid': {
    placement: 'stage',
    props: {
      rows: { type: 'integer', required: true },
      columns: { type: 'integer', required: true },
      cells: { type: 'array<matrixCell>', required: true },
    },
    compatibleBindings: {
      rows: ['$model.matrix.rows'],
      columns: ['$model.matrix.columns'],
      cells: ['$model.matrix.cells'],
    },
  },
  histogram: {
    placement: 'side',
    props: {
      bins: { type: 'array<histogramBin>', required: true },
    },
    compatibleBindings: {
      bins: ['$model.histogram.bins'],
    },
  },
  'image-grid': {
    domains: ['image'],
    placement: 'stage',
    props: {
      images: { type: 'array<imageSample>', required: true },
      columns: { type: 'integer', required: false },
    },
    compatibleBindings: {
      images: ['$model.imageSamples'],
      columns: ['$model.imageGrid.columns'],
    },
  },
  'token-sequence': {
    domains: ['sequence'],
    placement: 'stage',
    props: {
      tokens: { type: 'array<string>', required: true },
      highlights: { type: 'array<integer>', required: false },
    },
    compatibleBindings: {
      tokens: ['$model.tokens'],
      highlights: ['$model.highlightedTokenIndexes'],
    },
  },
  'attention-matrix': {
    domains: ['sequence'],
    placement: 'stage',
    props: {
      rows: { type: 'integer', required: true },
      columns: { type: 'integer', required: true },
      cells: { type: 'array<matrixCell>', required: true },
    },
    compatibleBindings: {
      rows: ['$model.attention.rows', '$model.featureMap.rows'],
      columns: ['$model.attention.columns', '$model.featureMap.columns'],
      cells: ['$model.attention.cells', '$model.featureMap.cells'],
    },
  },
  'ranked-results': {
    domains: ['retrieval', 'rag'],
    placement: 'stage',
    props: {
      items: { type: 'array<rankedResult>', required: true },
    },
    compatibleBindings: {
      items: ['$model.rankedResults'],
    },
  },
};

export function getPrimitiveSchema(type) {
  return PRIMITIVE_SCHEMAS[type] ?? null;
}

// Strict contract validation used by the dry run and the contract tests:
// required props must exist and match the declared semantic type (including
// element shapes for typed arrays such as array<point2d>).
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
    if (primitive.props?.[prop] !== undefined && !validateType(primitive.props[prop], propSchema.type)) {
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
    ...(PRIMITIVE_SCHEMAS[type]?.placement ? { placement: PRIMITIVE_SCHEMAS[type].placement } : {}),
    ...(PRIMITIVE_SCHEMAS[type]?.domains ? { domains: [...PRIMITIVE_SCHEMAS[type].domains] } : {}),
    ...(PRIMITIVE_SCHEMAS[type]?.whenControl ? { whenControl: PRIMITIVE_SCHEMAS[type].whenControl } : {}),
  }));
}
