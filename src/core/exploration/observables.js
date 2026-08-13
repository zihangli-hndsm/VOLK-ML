// Shared semantic observables for learner UI, deterministic detectors, and
// host inspection. This module is intentionally small and model-capability
// neutral; Linear Regression simply contributes slope/bias and MSE values.

export const OBSERVABLE_LEVELS = ['WORLD', 'EVIDENCE', 'MODEL', 'LEARNING', 'OUTCOME'];

const finite = (value) => value === null || value === undefined || value === ''
  ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;

function rangeFor(points) {
  const values = (points ?? []).map((point) => Number(point.x)).filter(Number.isFinite);
  return values.length ? { min: Math.min(...values), max: Math.max(...values), count: values.length } : null;
}

function descriptor(id, level, labelKey, valueType, derive) {
  return { id, level, labelKey, valueType, derive };
}

export const RAW_OBSERVABLES = [
  descriptor('world.trainSampleCount', 'WORLD', 'playground.evidence.trainSampleCount', 'number', ({ world }) => (
    world ? world.observations.filter((point) => point.membership === 'train').length : null
  )),
  descriptor('world.testSampleCount', 'WORLD', 'playground.evidence.testSampleCount', 'number', ({ world }) => (
    world ? world.observations.filter((point) => point.membership === 'test').length : null
  )),
  descriptor('world.trainXRange', 'WORLD', 'playground.evidence.trainXRange', 'range', ({ world }) => (
    rangeFor(world?.observations.filter((point) => point.membership === 'train'))
  )),
  descriptor('world.testXRange', 'WORLD', 'playground.evidence.testXRange', 'range', ({ world }) => (
    rangeFor(world?.observations.filter((point) => point.membership === 'test'))
  )),
  descriptor('world.generatorNoise', 'WORLD', 'playground.evidence.generatorNoise', 'number', ({ world }) => (
    finite(world?.generator?.spec?.noise?.amount)
  )),
  descriptor('world.outlierCount', 'WORLD', 'playground.evidence.outlierCount', 'number', ({ world }) => (
    world ? world.observations.filter((point) => point.provenance === 'generated-outlier').length : null
  )),
  descriptor('model.slope', 'MODEL', 'playground.evidence.slope', 'number', ({ result }) => finite(result?.model?.weight)),
  descriptor('model.bias', 'MODEL', 'playground.evidence.bias', 'number', ({ result }) => finite(result?.model?.bias)),
  descriptor('outcome.trainMse', 'OUTCOME', 'playground.evidence.trainMse', 'number', ({ result }) => finite(result?.metrics?.trainMse ?? result?.metrics?.mse)),
  descriptor('outcome.testMse', 'OUTCOME', 'playground.evidence.testMse', 'number', ({ result }) => finite(result?.metrics?.testMse)),
  descriptor('learning.currentStep', 'LEARNING', 'playground.evidence.currentStep', 'number', ({ result }) => finite(result?.model?.trainingStep)),
  descriptor('comparison.changedFactorCount', 'EVIDENCE', 'playground.evidence.changedFactorCount', 'number', ({ comparison }) => (
    comparison?.diff ? comparison.diff.changed.length : null
  )),
  descriptor('comparison.clarity', 'EVIDENCE', 'playground.evidence.clarity', 'string', ({ comparison }) => comparison?.diff?.clarity ?? null),
];

function valueRecord(item, value) {
  return {
    id: item.id,
    level: item.level,
    labelKey: item.labelKey,
    valueType: item.valueType,
    available: value !== null && value !== undefined,
    value: value === undefined ? null : value,
  };
}

export function deriveRawObservables(context = {}) {
  return Object.fromEntries(RAW_OBSERVABLES.map((item) => {
    let value = null;
    try { value = item.derive(context); } catch { value = null; }
    return [item.id, valueRecord(item, value)];
  }));
}

function difference(left, right) {
  const a = finite(left);
  const b = finite(right);
  return a === null || b === null ? null : a - b;
}

function ratio(value, baseline) {
  const a = finite(value);
  const b = finite(baseline);
  if (a === null || b === null || Math.abs(b) < 1e-9) return null;
  return a / b;
}

function coverageMismatch(trainRange, testRange) {
  if (!trainRange || !testRange) return null;
  const overlapMin = Math.max(trainRange.min, testRange.min);
  const overlapMax = Math.min(trainRange.max, testRange.max);
  const overlap = Math.max(0, overlapMax - overlapMin);
  const trainWidth = Math.max(0, trainRange.max - trainRange.min);
  const testWidth = Math.max(0, testRange.max - testRange.min);
  const testOutsideTrain = Math.max(0, testRange.min - trainRange.min) + Math.max(0, trainRange.max - testRange.max);
  const trainOutsideTest = Math.max(0, trainRange.min - testRange.min) + Math.max(0, testRange.max - trainRange.max);
  return {
    trainRange: { min: trainRange.min, max: trainRange.max },
    testRange: { min: testRange.min, max: testRange.max },
    overlapMin,
    overlapMax,
    overlapWidth: overlap,
    overlapFractionOfTrain: trainWidth ? overlap / trainWidth : (trainRange.min === trainRange.max ? (testRange.min <= trainRange.min && trainRange.min <= testRange.max ? 1 : 0) : null),
    overlapFractionOfTest: testWidth ? overlap / testWidth : (testRange.min === testRange.max ? (trainRange.min <= testRange.min && testRange.min <= trainRange.max ? 1 : 0) : null),
    testOutsideTrainFraction: testWidth ? Math.min(1, testOutsideTrain / testWidth) : 0,
    trainOutsideTestFraction: trainWidth ? Math.min(1, trainOutsideTest / trainWidth) : 0,
  };
}

export function deriveDerivedObservables({ raw, comparisonRaw, repeatEvidence } = {}) {
  const read = (source, id) => source?.[id]?.value ?? null;
  const trainMse = read(raw, 'outcome.trainMse');
  const testMse = read(raw, 'outcome.testMse');
  const comparisonTrainMse = read(comparisonRaw, 'outcome.trainMse');
  const comparisonTestMse = read(comparisonRaw, 'outcome.testMse');
  const currentSlope = read(raw, 'model.slope');
  const comparisonSlope = read(comparisonRaw, 'model.slope');
  const coverage = coverageMismatch(read(raw, 'world.trainXRange'), read(raw, 'world.testXRange'));
  const values = {
    generalizationGap: difference(testMse, trainMse),
    coverageMismatch: coverage,
    slopeDifference: difference(currentSlope, comparisonSlope),
    trainErrorRatio: ratio(trainMse, comparisonTrainMse),
    testErrorRatio: ratio(testMse, comparisonTestMse),
    repeatSlopeSpread: finite(repeatEvidence?.aggregates?.slope?.standardDeviation),
    repeatTrainMseSpread: finite(repeatEvidence?.aggregates?.trainMse?.standardDeviation),
    repeatTestMseSpread: finite(repeatEvidence?.aggregates?.testMse?.standardDeviation),
  };
  const labels = {
    generalizationGap: ['OUTCOME', 'playground.evidence.generalizationGap', 'number'],
    coverageMismatch: ['WORLD', 'playground.evidence.coverageMismatch', 'coverage'],
    slopeDifference: ['MODEL', 'playground.evidence.slopeDifference', 'number'],
    trainErrorRatio: ['OUTCOME', 'playground.evidence.trainErrorRatio', 'number'],
    testErrorRatio: ['OUTCOME', 'playground.evidence.testErrorRatio', 'number'],
    repeatSlopeSpread: ['EVIDENCE', 'playground.evidence.repeatSlopeSpread', 'number'],
    repeatTrainMseSpread: ['EVIDENCE', 'playground.evidence.repeatTrainMseSpread', 'number'],
    repeatTestMseSpread: ['EVIDENCE', 'playground.evidence.repeatTestMseSpread', 'number'],
  };
  return Object.fromEntries(Object.entries(values).map(([id, value]) => {
    const [level, labelKey, valueType] = labels[id];
    return [id, { id, level, labelKey, valueType, available: value !== null, value }];
  }));
}

export function deriveObservableSet(context = {}) {
  const raw = deriveRawObservables(context);
  const comparisonRaw = context.comparisonContext ? deriveRawObservables(context.comparisonContext) : null;
  const derived = deriveDerivedObservables({ raw, comparisonRaw, repeatEvidence: context.repeatEvidence });
  return { raw, derived };
}

export function observableValue(observables, id) {
  return observables?.raw?.[id]?.available ? observables.raw[id].value
    : observables?.derived?.[id]?.available ? observables.derived[id].value
      : null;
}
