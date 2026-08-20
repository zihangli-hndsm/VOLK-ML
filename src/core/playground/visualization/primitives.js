// Visualization primitive registry. A primitive is a JSON-safe declaration
// that tells the unified stage *what to draw*; it never contains model math,
// React components, DOM nodes or functions.
//
//   { id, type, source: {...}, props: {...} }
//
// The stage resolves `type` through rendererByPrimitiveType and passes only
// `props` to the renderer.

export const PRIMITIVE_TYPES = [
  'scatter',
  'regression-line',
  'reference-line',
  'residual-lines',
  'decision-region',
  'neighbor-links',
  'query-point',
  'vote-bars',
  'loss-curve',
  'formula',
  'annotation',
  'metric-card',
  'legend',
  'parameter-trajectory',
  'network-graph',
  'matrix-grid',
  'histogram',
  'image-grid',
  'token-sequence',
  'attention-matrix',
  'ranked-results',
];

// Renderer-neutral metadata keeps domain and coordinate-space decisions out
// of PlaygroundStage. Existing primitives retain their tabular defaults.
export const PRIMITIVE_PRESENTATION = Object.freeze({
  scatter: { coordinateSpace: 'plot2d', domains: ['tabular'] },
  'regression-line': { coordinateSpace: 'plot2d', domains: ['tabular'] },
  'decision-region': { coordinateSpace: 'plot2d', domains: ['tabular'] },
  'image-grid': { coordinateSpace: 'image', domains: ['image'] },
  'token-sequence': { coordinateSpace: 'token-sequence', domains: ['sequence'] },
  'attention-matrix': { coordinateSpace: 'attention-matrix', domains: ['sequence'] },
  'ranked-results': { coordinateSpace: 'ranked-list', domains: ['retrieval', 'rag'] },
});

export function primitivePresentation(type) {
  return PRIMITIVE_PRESENTATION[type] ?? { coordinateSpace: 'generic', domains: ['tabular', 'image', 'sequence', 'retrieval', 'rag'] };
}

export function isKnownPrimitiveType(type) {
  return PRIMITIVE_TYPES.includes(type);
}

export function validatePrimitive(primitive) {
  if (!primitive || typeof primitive !== 'object' || Array.isArray(primitive)) {
    throw scriptError('SCRIPT_UNKNOWN_PRIMITIVE');
  }
  if (typeof primitive.id !== 'string' || !primitive.id) {
    throw scriptError('SCRIPT_UNKNOWN_PRIMITIVE', { reason: 'id' });
  }
  if (!isKnownPrimitiveType(primitive.type)) {
    throw scriptError('SCRIPT_UNKNOWN_PRIMITIVE', { type: primitive.type });
  }
  try {
    structuredClone(primitive);
  } catch {
    throw scriptError('SCRIPT_UNKNOWN_PRIMITIVE', { reason: 'not json-safe' });
  }
  return primitive;
}
import { scriptError } from './scriptErrors.js';
