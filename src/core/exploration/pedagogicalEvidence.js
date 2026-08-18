import { PEDAGOGICAL_EXPERIMENT_GOALS } from './pedagogicalExperiment.js';

const outcomeMetric = Object.freeze({
  'outcome.trainAccuracy': 'trainAccuracy',
  'outcome.testAccuracy': 'testAccuracy',
  'outcome.trainMse': 'trainMse',
  'outcome.testMse': 'testMse',
});

function valueOf(snapshot, id) {
  const record = snapshot?.observables?.[id] ?? snapshot?.derivedObservables?.[id];
  return record?.available ? record.value : null;
}

export function derivePedagogicalEvidence({ snapshot, scenario } = {}) {
  const comparison = snapshot?.experimentWorkspace?.comparison ?? null;
  const activeResult = comparison?.results?.active ?? null;
  const baselineResult = comparison?.results?.against ?? null;
  const metrics = (scenario?.observe ?? [])
    .filter((id) => outcomeMetric[id])
    .map((id) => ({
      id,
      before: baselineResult?.metrics ? baselineResult.metrics[outcomeMetric[id]] ?? null : null,
      after: activeResult?.metrics ? activeResult.metrics[outcomeMetric[id]] ?? valueOf(snapshot, id) : valueOf(snapshot, id),
    }))
    .filter((item) => item.before !== null || item.after !== null);
  return {
    available: Boolean(comparison?.enabled),
    grounded: true,
    changed: [...(comparison?.diff?.changed ?? [])],
    held: [...(comparison?.diff?.unchanged ?? [])],
    clarity: comparison?.diff?.clarity ?? null,
    metrics,
    coverageMismatch: valueOf(snapshot, 'coverageMismatch'),
    goal: scenario?.pedagogicalDesign?.goal ?? null,
  };
}

export function pedagogicalFollowUpGoals(goal) {
  const order = {
    [PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_OVERLAP]: [
      PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE,
      PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY,
    ],
    [PEDAGOGICAL_EXPERIMENT_GOALS.TRAIN_TEST_SUPPORT_SHIFT]: [
      PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE,
      PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY,
    ],
    [PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE]: [
      PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_OVERLAP,
      PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY,
    ],
    [PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY]: [
      PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE,
      PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_OVERLAP,
    ],
  };
  return [...(order[goal] ?? [])].slice(0, 2);
}
