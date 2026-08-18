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

export function derivePedagogicalEvidence({ snapshot, scenario, verification } = {}) {
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
  const metricsComplete = metrics.length > 0 && metrics.every((item) => item.before !== null && item.after !== null);
  const coverage = verification?.measurements?.coverageMismatch ?? null;
  const coverageComplete = scenario?.pedagogicalDesign?.goal !== 'train-test-support-shift'
    || Boolean(coverage?.before?.testOutsideTrainFraction !== undefined && coverage?.after?.testOutsideTrainFraction !== undefined);
  const grounded = Boolean(comparison?.enabled && verification?.valid && metricsComplete && coverageComplete);
  return {
    available: grounded,
    grounded,
    changed: [...(comparison?.diff?.changed ?? [])],
    held: [...(comparison?.diff?.unchanged ?? [])],
    clarity: comparison?.diff?.clarity ?? null,
    metrics,
    coverageMismatch: coverage ? { before: coverage.before, after: coverage.after } : null,
    goal: scenario?.pedagogicalDesign?.goal ?? null,
    ...(grounded ? {} : { unavailableReason: !comparison?.enabled ? 'comparison-unavailable' : !verification?.valid ? 'intervention-unverified' : !metricsComplete ? 'outcome-evidence-incomplete' : 'coverage-evidence-incomplete' }),
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
