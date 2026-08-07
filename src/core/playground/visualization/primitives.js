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
];

export function isKnownPrimitiveType(type) {
  return PRIMITIVE_TYPES.includes(type);
}

export function validatePrimitive(primitive) {
  if (!primitive || typeof primitive !== 'object' || Array.isArray(primitive)) {
    throw Object.assign(new Error('SCRIPT_UNKNOWN_PRIMITIVE'), { code: 'SCRIPT_UNKNOWN_PRIMITIVE' });
  }
  if (typeof primitive.id !== 'string' || !primitive.id) {
    throw Object.assign(new Error('SCRIPT_UNKNOWN_PRIMITIVE'), { code: 'SCRIPT_UNKNOWN_PRIMITIVE', details: { reason: 'id' } });
  }
  if (!isKnownPrimitiveType(primitive.type)) {
    throw Object.assign(new Error('SCRIPT_UNKNOWN_PRIMITIVE'), { code: 'SCRIPT_UNKNOWN_PRIMITIVE', details: { type: primitive.type } });
  }
  try {
    structuredClone(primitive);
  } catch {
    throw Object.assign(new Error('SCRIPT_UNKNOWN_PRIMITIVE'), { code: 'SCRIPT_UNKNOWN_PRIMITIVE', details: { reason: 'not json-safe' } });
  }
  return primitive;
}
