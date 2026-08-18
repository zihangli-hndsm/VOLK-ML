import { PEDAGOGICAL_EXPERIMENT_GOALS } from './pedagogicalExperiment.js';

export const PEDAGOGICAL_OBSERVATION_VERSION = 1;

const clone = (value) => structuredClone(value);

function direction(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 'unchanged';
  if (after > before) return 'increased';
  if (after < before) return 'decreased';
  return 'unchanged';
}

function numericFact({ id, labelKey, kind, before, after }) {
  return {
    id,
    kind,
    labelKey,
    before,
    after,
    delta: Number((after - before).toFixed(8)),
    direction: direction(before, after),
  };
}

function outcomeFacts(evidence) {
  return (evidence?.metrics ?? []).slice(0, 4).map((metric) => numericFact({
    id: metric.id,
    kind: 'outcome',
    labelKey: metric.id === 'outcome.trainAccuracy'
      ? 'playground.pedagogical.trainOutcome'
      : metric.id === 'outcome.testAccuracy'
        ? 'playground.pedagogical.testOutcome'
        : metric.id === 'outcome.trainMse'
          ? 'playground.pedagogical.trainMse'
          : 'playground.pedagogical.testMse',
    before: metric.before,
    after: metric.after,
  }));
}

function baseObservation({ goal, evidence }) {
  return {
    version: PEDAGOGICAL_OBSERVATION_VERSION,
    goal: goal ?? null,
    available: false,
    facts: [],
    changed: [...(evidence?.changed ?? [])].slice(0, 12),
    held: [...(evidence?.held ?? [])].slice(0, 12),
    summaryKey: null,
  };
}

export function derivePedagogicalObservation({ design, evidence, verification } = {}) {
  const goal = design?.goal ?? evidence?.goal ?? null;
  const observation = baseObservation({ goal, evidence });
  if (!evidence?.grounded || !verification?.valid) return observation;

  const facts = [];
  if (goal === PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION) {
    const measurement = verification.measurements;
    if (Number.isFinite(measurement?.before) && Number.isFinite(measurement?.after)) {
      facts.push(numericFact({
        id: 'class-separation-distance',
        kind: 'intervention',
        labelKey: 'playground.pedagogical.observation.classSeparationDistance',
        before: measurement.before,
        after: measurement.after,
      }));
    }
  }
  if (goal === PEDAGOGICAL_EXPERIMENT_GOALS.TRAIN_TEST_SUPPORT_SHIFT) {
    const coverage = verification.measurements?.coverageMismatch;
    if (Number.isFinite(coverage?.before?.testOutsideTrainFraction) && Number.isFinite(coverage?.after?.testOutsideTrainFraction)) {
      facts.push(numericFact({
        id: 'test-outside-train-fraction',
        kind: 'coverage',
        labelKey: 'playground.pedagogical.observation.testOutsideTrainFraction',
        before: coverage.before.testOutsideTrainFraction,
        after: coverage.after.testOutsideTrainFraction,
      }));
    }
    if (verification.measurements?.trainUnchanged) facts.push({
      id: 'train-realization-held',
      kind: 'hold',
      labelKey: 'playground.pedagogical.observation.trainHeld',
      direction: 'unchanged',
    });
  }
  if (goal === PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE) {
    const changed = verification.measurements?.changedTrainPositions;
    if (Number.isFinite(changed)) facts.push(numericFact({
      id: 'train-position-changes',
      kind: 'intervention',
      labelKey: 'playground.pedagogical.observation.trainPositionsChanged',
      before: 0,
      after: changed,
    }));
    facts.push({ id: 'test-realization-held', kind: 'hold', labelKey: 'playground.pedagogical.observation.testHeld', direction: 'unchanged' });
  }
  if (goal === PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY) {
    const measurements = verification.measurements;
    if (Number.isFinite(measurements?.outliersBefore) && Number.isFinite(measurements?.outliersAfter)) facts.push(numericFact({
      id: 'train-outlier-count',
      kind: 'intervention',
      labelKey: 'playground.pedagogical.observation.outlierCount',
      before: measurements.outliersBefore,
      after: measurements.outliersAfter,
    }));
    facts.push({ id: 'test-realization-held', kind: 'hold', labelKey: 'playground.pedagogical.observation.testHeld', direction: 'unchanged' });
  }

  const summaryKey = {
    [PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION]: 'playground.pedagogical.observation.classSeparation',
    [PEDAGOGICAL_EXPERIMENT_GOALS.TRAIN_TEST_SUPPORT_SHIFT]: 'playground.pedagogical.observation.supportShift',
    [PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE]: 'playground.pedagogical.observation.noise',
    [PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY]: 'playground.pedagogical.observation.outliers',
  }[goal] ?? null;
  const completeFacts = [...facts, ...outcomeFacts(evidence)].slice(0, 8);
  return {
    ...observation,
    available: Boolean(summaryKey && completeFacts.length),
    facts: clone(completeFacts),
    summaryKey,
  };
}
