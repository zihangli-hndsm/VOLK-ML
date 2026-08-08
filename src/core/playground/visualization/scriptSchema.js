// Visualization Script DSL schema. A script is a plain JSON object:
//
//   {
//     version: 1,
//     id, model: { adapter }, data: { source },
//     controls: [...], layout: { stage: [...], side: [...] },
//     primitives: [{ id, type, ... }],
//     steps: [{ id, setControl?, invoke?, reveal?, show?, hide?,
//               highlight?, annotate?, reset?, wait?, narrationKey?, durationMs }],
//   }
//
// The schema deliberately forbids executable strings, arbitrary expressions,
// DOM selectors, React component names, network calls and loops.

export const SCRIPT_VERSION = 1;

export const ALLOWED_STEP_OPERATIONS = [
  'invoke',
  'setControl',
  'show',
  'hide',
  'highlight',
  'reveal',
  'reset',
  'annotate',
  'wait',
];

export const ALLOWED_STEP_FIELDS = new Set([
  'id',
  'invoke',
  'setControl',
  'show',
  'hide',
  'highlight',
  'reveal',
  'reset',
  'annotate',
  'wait',
  'narrationKey',
  'durationMs',
]);

export const BINDING_PREFIXES = ['$controls', '$model', '$data', '$trace', '$metrics'];

import { BINDING_TRANSFORMS } from './bindings.js';

export const BINDING_TRANSFORM_NAMES = new Set(Object.keys(BINDING_TRANSFORMS));

export const EXECUTABLE_MARKERS = ['eval(', 'Function(', 'new Function', 'document.', 'window.', 'fetch(', 'import(', 'require('];

export function isAllowedBinding(binding) {
  if (typeof binding !== 'string') return false;
  const transformMatch = /^([A-Za-z]+)\((\$[A-Za-z0-9_.]+)\)$/.exec(binding);
  if (transformMatch) return BINDING_TRANSFORM_NAMES.has(transformMatch[1]);
  if (binding.includes('(')) return false;
  if (!binding.startsWith('$')) return false;
  return BINDING_PREFIXES.some((prefix) => binding === prefix || binding.startsWith(`${prefix}.`));
}

export function hasExecutableContent(value) {
  if (typeof value === 'string') {
    return EXECUTABLE_MARKERS.some((marker) => value.includes(marker));
  }
  if (Array.isArray(value)) return value.some((item) => hasExecutableContent(item));
  if (value && typeof value === 'object') return Object.values(value).some((item) => hasExecutableContent(item));
  return false;
}

export function isJsonSafe(value) {
  try {
    structuredClone(value);
    return true;
  } catch {
    return false;
  }
}
