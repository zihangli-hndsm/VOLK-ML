// Phase 3 World Builder primitives. This is intentionally a small, explicit
// vocabulary rather than a general probability or simulation framework.

export const GENERATOR_VERSION = 1;
export const MAX_GENERATOR_SAMPLES = 500;
export const MIN_GENERATOR_SAMPLES = 2;
export const INPUT_DISTRIBUTIONS = ['uniform', 'gaussian', 'two-cluster'];

const clone = (value) => structuredClone(value);

function generatorError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

function finite(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw generatorError('EXPLORATION_INVALID_GENERATOR', { field, value });
  return number;
}

function integer(value, field) {
  const number = Math.trunc(finite(value, field));
  return number;
}

function boundedSamples(value, field = 'samples') {
  const samples = integer(value, field);
  if (samples < MIN_GENERATOR_SAMPLES || samples > MAX_GENERATOR_SAMPLES) {
    throw generatorError('EXPLORATION_RESOURCE_LIMIT', { field, min: MIN_GENERATOR_SAMPLES, max: MAX_GENERATOR_SAMPLES, value: samples });
  }
  return samples;
}

function normalizeInput(input, field = 'input') {
  const source = input ?? {};
  const type = source.type ?? source.distribution ?? 'uniform';
  if (!INPUT_DISTRIBUTIONS.includes(type)) {
    throw generatorError('EXPLORATION_INVALID_GENERATOR', { field: `${field}.type`, value: type });
  }
  const params = source.params ?? source;
  if (type === 'uniform') {
    const min = finite(params.min ?? -2, `${field}.params.min`);
    const max = finite(params.max ?? 2, `${field}.params.max`);
    if (min >= max) throw generatorError('EXPLORATION_INVALID_GENERATOR', { field: `${field}.params`, reason: 'min must be below max' });
    return { type, params: { min, max } };
  }
  if (type === 'gaussian') {
    const mean = finite(params.mean ?? 0, `${field}.params.mean`);
    const spread = finite(params.spread ?? params.standardDeviation ?? 1, `${field}.params.spread`);
    if (spread <= 0) throw generatorError('EXPLORATION_INVALID_GENERATOR', { field: `${field}.params.spread`, reason: 'spread must be positive' });
    return { type, params: { mean, spread } };
  }
  const centerA = finite(params.centerA ?? -1, `${field}.params.centerA`);
  const centerB = finite(params.centerB ?? 1, `${field}.params.centerB`);
  const spread = finite(params.spread ?? 0.35, `${field}.params.spread`);
  if (spread <= 0 || centerA === centerB) {
    throw generatorError('EXPLORATION_INVALID_GENERATOR', { field: `${field}.params`, reason: 'clusters need distinct centers and positive spread' });
  }
  return { type, params: { centerA, centerB, spread } };
}

function normalizeSplit(split, fallback, field) {
  const source = split ?? {};
  return {
    input: normalizeInput(source.input ?? fallback, `${field}.input`),
    samples: source.samples === undefined ? 0 : integer(source.samples, `${field}.samples`),
  };
}

export function normalizeGeneratorSpec(spec = {}) {
  const source = spec ?? {};
  // `input` and `sampling.samples` were accepted by the first Phase 3 slice.
  // They remain input aliases only; the normalized form has one authoritative
  // input and sample count for each split.
  const legacyInput = normalizeInput(source.input ?? source.distribution);
  const legacySamples = source.sampling?.samples ?? source.samples ?? 40;
  const trainSource = source.train ?? {};
  const testSource = source.test ?? {};
  const train = normalizeSplit(
    trainSource,
    trainSource.input ?? legacyInput,
    'train',
  );
  const test = normalizeSplit(
    testSource,
    testSource.input ?? legacyInput,
    'test',
  );
  if (train.samples === 0 && test.samples === 0) train.samples = boundedSamples(legacySamples, 'train.samples');
  else if (train.samples === 0 && source.train === undefined) train.samples = boundedSamples(legacySamples, 'train.samples');
  if (train.samples < 0 || train.samples > MAX_GENERATOR_SAMPLES || test.samples < 0 || test.samples > MAX_GENERATOR_SAMPLES) {
    throw generatorError('EXPLORATION_RESOURCE_LIMIT', { field: 'split.samples', max: MAX_GENERATOR_SAMPLES });
  }
  const total = train.samples + test.samples;
  if (total < MIN_GENERATOR_SAMPLES || total > MAX_GENERATOR_SAMPLES) {
    throw generatorError('EXPLORATION_RESOURCE_LIMIT', { field: 'sampling.total', min: MIN_GENERATOR_SAMPLES, max: MAX_GENERATOR_SAMPLES, value: total });
  }
  const relationSource = source.relation ?? {};
  const slope = finite(relationSource.slope ?? 2, 'relation.slope');
  const bias = finite(relationSource.bias ?? 1, 'relation.bias');
  const noiseSource = source.noise ?? {};
  const noiseAmount = finite(noiseSource.amount ?? noiseSource.spread ?? 0.5, 'noise.amount');
  if (noiseAmount < 0) throw generatorError('EXPLORATION_INVALID_GENERATOR', { field: 'noise.amount', reason: 'noise cannot be negative' });
  const outlierSource = source.outliers ?? source.anomalies ?? {};
  const outlierCount = integer(outlierSource.count ?? 0, 'outliers.count');
  if (outlierCount < 0 || outlierCount > total) {
    throw generatorError('EXPLORATION_INVALID_GENERATOR', { field: 'outliers.count', value: outlierCount });
  }
  return {
    version: GENERATOR_VERSION,
    relation: { type: 'linear', slope, bias },
    noise: { type: 'gaussian-additive', amount: noiseAmount },
    train: { input: train.input, samples: train.samples },
    test: { input: test.input, samples: test.samples },
    outliers: { type: 'count', count: outlierCount },
  };
}

function createRng(seed) {
  let state = (Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : 0) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  const u1 = Math.max(Number.EPSILON, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(Math.PI * 2 * u2);
}

function sampleInput(input, rng) {
  if (input.type === 'uniform') {
    return input.params.min + rng() * (input.params.max - input.params.min);
  }
  if (input.type === 'gaussian') return input.params.mean + gaussian(rng) * input.params.spread;
  const center = rng() < 0.5 ? input.params.centerA : input.params.centerB;
  return center + gaussian(rng) * input.params.spread;
}

export function generateObservations(spec, seed, { worldId = 'world-1' } = {}) {
  const normalized = normalizeGeneratorSpec(spec);
  const rng = createRng(seed);
  const total = normalized.train.samples + normalized.test.samples;
  const outlierIndexes = new Set();
  while (outlierIndexes.size < normalized.outliers.count) {
    outlierIndexes.add(Math.floor(rng() * total));
  }
  const observations = [];
  let index = 0;
  for (const [membership, split] of [['train', normalized.train], ['test', normalized.test]]) {
    for (let splitIndex = 0; splitIndex < split.samples; splitIndex += 1) {
      const x = sampleInput(split.input, rng);
      const isOutlier = outlierIndexes.has(index);
      const y = normalized.relation.slope * x
        + normalized.relation.bias
        + gaussian(rng) * normalized.noise.amount
        + (isOutlier ? gaussian(rng) * Math.max(1, normalized.noise.amount * 4) : 0);
      observations.push({
        id: `generated-${membership}-${splitIndex + 1}`,
        x,
        y,
        target: y,
        membership,
        provenance: isOutlier ? 'generated-outlier' : 'generated',
        features: { x, y },
        generation: { split: membership, index: splitIndex, anomaly: isOutlier ? 'outlier' : null },
      });
      index += 1;
    }
  }
  return { observations, spec: normalized, seed: Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : null };
}

export function generatorInputLabel(input) {
  const normalized = normalizeInput(input);
  if (normalized.type === 'uniform') return `Uniform [${normalized.params.min}, ${normalized.params.max}]`;
  if (normalized.type === 'gaussian') return `Gaussian (${normalized.params.mean}, ${normalized.params.spread})`;
  return `Two clusters (${normalized.params.centerA}, ${normalized.params.centerB})`;
}

export function generatorSemanticDetails(spec) {
  const value = normalizeGeneratorSpec(spec);
  return {
    trainInput: generatorInputLabel(value.train.input),
    testInput: generatorInputLabel(value.test.input),
    relation: `y = ${value.relation.slope}x + ${value.relation.bias}`,
    noise: value.noise.amount,
    samples: value.train.samples + value.test.samples,
    outliers: value.outliers.count,
  };
}

export const cloneGeneratorSpec = (spec) => clone(normalizeGeneratorSpec(spec));
