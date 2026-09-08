// `requestedHolds` is model-provided intent. It is not a ScenarioSpec and it
// never authorizes an operation. The deterministic planner remains the only
// owner of the executable `hold` list.

export const REQUESTED_HOLD_LIMIT = 12;

export const REQUESTED_HOLD_IDS = Object.freeze([
  'world',
  'world-generating-process',
  'latent-relation',
  'noise',
  'model-configuration',
  'learning-configuration',
  'evaluation-configuration',
  'existing-train-test-setup',
  'train-distribution',
  'test-distribution',
  'train-sample-count',
  'train-world',
  'test-world',
  'randomness-policy',
]);

export function requestedHoldsJsonSchema({ nullable = true } = {}) {
  const array = { type: 'array', maxItems: REQUESTED_HOLD_LIMIT, items: { type: 'string', enum: [...REQUESTED_HOLD_IDS], maxLength: 120 } };
  return nullable ? { anyOf: [array, { type: 'null' }] } : array;
}

const aliases = new Map([
  ['model', 'model-configuration'],
  ['model-config', 'model-configuration'],
  ['model-configuration', 'model-configuration'],
  ['learning', 'learning-configuration'],
  ['learning-config', 'learning-configuration'],
  ['learning-configuration', 'learning-configuration'],
  ['evaluation', 'evaluation-configuration'],
  ['evaluation-config', 'evaluation-configuration'],
  ['evaluation-configuration', 'evaluation-configuration'],
  ['world-process', 'world-generating-process'],
  ['world-generating', 'world-generating-process'],
  ['world-generating-process', 'world-generating-process'],
  ['latent-relation', 'latent-relation'],
  ['latent relation', 'latent-relation'],
  ['train-test', 'existing-train-test-setup'],
  ['train-test-setup', 'existing-train-test-setup'],
  ['existing-train-test-setup', 'existing-train-test-setup'],
  ['train-distribution', 'train-distribution'],
  ['test-distribution', 'test-distribution'],
  ['train-sample-count', 'train-sample-count'],
  ['train-world', 'train-world'],
  ['test-world', 'test-world'],
  ['randomness-policy', 'randomness-policy'],
  ['world', 'world'],
  ['noise', 'noise'],
]);

const broadWorldHolds = new Set(['world']);
const specificWorldHolds = new Set([
  'world-generating-process',
  'latent-relation',
  'noise',
  'train-distribution',
  'test-distribution',
  'train-world',
  'test-world',
]);

function holdError(reason, details = {}) {
  const error = new Error('Invalid requested holds.');
  error.code = 'AI_INVALID_REQUESTED_HOLDS';
  error.details = { reason, ...details };
  return error;
}

function lookupKey(value) {
  return value.trim().toLowerCase().replaceAll('_', '-');
}

/**
 * Normalize the bounded model-facing hold vocabulary before strict routing.
 * Missing, null, and [] all mean "no additional model-supplied hold".
 * Only exact aliases in this table are accepted; prose and fuzzy matches are
 * rejected. The returned details make aliases/defaulting observable without
 * leaking provider text into runtime state.
 */
export function normalizeRequestedHolds(value, { field = 'requestedHolds' } = {}) {
  const defaulted = value === undefined || value === null;
  if (defaulted) return {
    holds: [],
    details: { field, input: value === null ? 'null' : 'missing', aliases: [], deduplicated: [], defaulted: true },
  };
  if (!Array.isArray(value)) throw holdError('wrong-shape', { field });
  if (value.length > REQUESTED_HOLD_LIMIT) throw holdError('over-limit', { field, max: REQUESTED_HOLD_LIMIT });
  const holds = [];
  const aliasChanges = [];
  const deduplicated = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || item.length > 120) throw holdError('invalid-item', { field });
    const key = lookupKey(item);
    const canonical = aliases.get(key);
    if (typeof canonical !== 'string') throw holdError('unknown-hold', { field, value: item });
    if (canonical !== item) aliasChanges.push({ from: item, to: canonical });
    if (holds.includes(canonical)) {
      deduplicated.push(canonical);
      continue;
    }
    holds.push(canonical);
  }
  if (holds.some((item) => broadWorldHolds.has(item)) && holds.some((item) => specificWorldHolds.has(item))) {
    throw holdError('ambiguous-broad-and-specific-world-holds', { field, holds });
  }
  return {
    holds,
    details: { field, input: 'array', aliases: aliasChanges, deduplicated, defaulted: false },
  };
}

export function requestedHoldsAreEqual(left, right) {
  const a = normalizeRequestedHolds(left).holds;
  const b = normalizeRequestedHolds(right).holds;
  return JSON.stringify(a) === JSON.stringify(b);
}
