// Safe binding resolution for Visualization Scripts. Bindings are strings of
// the form `$model.points`, `$controls.k`, `$metrics.mse`, `$data.rows`,
// `$trace` or a whitelist transform `mean($data.values)`.
//
// Context is always { model, data, controls, trace, metrics }; the schema
// declares exactly these prefixes and the runtime provides exactly these
// objects, so a valid binding never resolves to `undefined` context.

export const BINDING_TRANSFORMS = {
  mean: (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length),
  min: (values) => Math.min(...values),
  max: (values) => Math.max(...values),
  extent: (values) => [Math.min(...values), Math.max(...values)],
  formatNumber: (values) => values.map((value) => (Number.isInteger(value) ? String(value) : Number(value).toFixed(3))),
  take: (values) => (Array.isArray(values) && values.length ? values[values.length - 1] : undefined),
  filterByEvent: (values, eventType) => values.filter((value) => value?.type === eventType),
};

export function createBindingContext({ model, data, controls, trace, metrics }) {
  return { model, data, controls, trace, metrics };
}

function resolvePath(context, path) {
  return path.split('.').reduce((current, key) => (current == null ? undefined : current[key]), context);
}

// Resolves a single value. Transforms are matched first (the bug fixed in this
// PR: `mean($data.values)` previously fell through to the literal `$` check).
export function resolveBinding(binding, context) {
  const transformMatch = /^([A-Za-z]+)\((\$[A-Za-z0-9_.]+)\)$/.exec(binding);
  if (transformMatch) {
    const transform = transformMatch[1];
    const rawPath = transformMatch[2];
    const value = resolvePath(context, rawPath.slice(1));
    if (!BINDING_TRANSFORMS[transform]) return undefined;
    return BINDING_TRANSFORMS[transform](value);
  }
  if (typeof binding !== 'string' || !binding.startsWith('$')) return binding;
  return resolvePath(context, binding.slice(1));
}

// Recursively resolves bindings inside objects/arrays, leaving literals alone.
export function resolveValue(value, context) {
  if (typeof value === 'string') return resolveBinding(value, context);
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, context));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValue(item, context)]));
  }
  return value;
}
