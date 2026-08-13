import { observableValue } from './observables.js';

// Centralized, conservative policies. They describe observable changes, not
// causal explanations, and are shared by every caller of the detector layer.
export const OBSERVATION_THRESHOLDS = Object.freeze({
  meaningfulRelativeChange: 0.25,
  testErrorChangeMultiplier: 1.5,
  generalizationGapIncrease: 0.25,
  coverageOutsideFraction: 0.5,
  slopeRelativeChange: 0.35,
  repeatSlopeRelativeSpread: 0.25,
});

const finite = (value) => value === null || value === undefined || value === ''
  ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;

function relativeChange(current, previous) {
  const a = finite(current);
  const b = finite(previous);
  if (a === null || b === null) return null;
  const scale = Math.max(Math.abs(b), 1e-9);
  return Math.abs(a - b) / scale;
}

function notice(id, severity, messageKey, evidence, relatedObservableIds, relatedExperimentIds = []) {
  return { id, severity, messageKey, evidence, relatedObservableIds, relatedExperimentIds };
}

export function detectObservations({ observables, comparisonObservables, comparison, repeatEvidence } = {}) {
  const notices = [];
  const current = (id) => observableValue(observables, id);
  const previous = (id) => observableValue(comparisonObservables, id);
  const experimentIds = comparison?.experimentIds ?? [];

  if (comparison?.diff?.clarity === 'mixed') {
    notices.push(notice(
      'MIXED_COMPARISON', 'info', 'playground.observation.mixedComparison',
      { changedFactors: [...comparison.diff.changed], changedFactorCount: comparison.diff.changed.length },
      ['comparison.changedFactorCount', 'comparison.clarity'], experimentIds,
    ));
  }

  const currentTest = current('outcome.testMse');
  const previousTest = previous('outcome.testMse');
  const currentTrain = current('outcome.trainMse');
  const previousTrain = previous('outcome.trainMse');
  const testChange = relativeChange(currentTest, previousTest);
  const trainChange = relativeChange(currentTrain, previousTrain);
  if (testChange !== null && trainChange !== null
    && testChange >= OBSERVATION_THRESHOLDS.meaningfulRelativeChange
    && testChange >= Math.max(OBSERVATION_THRESHOLDS.testErrorChangeMultiplier * trainChange, OBSERVATION_THRESHOLDS.meaningfulRelativeChange)) {
    notices.push(notice(
      'TEST_ERROR_CHANGED_MORE', 'notable', 'playground.observation.testErrorChangedMore',
      { activeTestMse: currentTest, comparisonTestMse: previousTest, activeTrainMse: currentTrain, comparisonTrainMse: previousTrain, testRelativeChange: testChange, trainRelativeChange: trainChange },
      ['outcome.testMse', 'outcome.trainMse', 'testErrorRatio'], experimentIds,
    ));
  }

  const currentGap = current('generalizationGap');
  const previousGap = previous('generalizationGap');
  if (currentGap !== null && previousGap !== null
    && currentGap - previousGap >= OBSERVATION_THRESHOLDS.generalizationGapIncrease) {
    notices.push(notice(
      'GENERALIZATION_GAP_INCREASED', 'notable', 'playground.observation.generalizationGapIncreased',
      { activeGap: currentGap, comparisonGap: previousGap, increase: currentGap - previousGap },
      ['generalizationGap'], experimentIds,
    ));
  }

  const coverage = current('coverageMismatch');
  if (coverage && coverage.testOutsideTrainFraction >= OBSERVATION_THRESHOLDS.coverageOutsideFraction) {
    notices.push(notice(
      'COVERAGE_MISMATCH', 'notable', 'playground.observation.coverageMismatch',
      { ...coverage, threshold: OBSERVATION_THRESHOLDS.coverageOutsideFraction },
      ['world.trainXRange', 'world.testXRange', 'coverageMismatch'], experimentIds,
    ));
  }

  const slope = current('model.slope');
  const previousSlope = previous('model.slope');
  const slopeChange = relativeChange(slope, previousSlope);
  if (slopeChange !== null && slopeChange >= OBSERVATION_THRESHOLDS.slopeRelativeChange) {
    notices.push(notice(
      'SLOPE_MOVED_STRONGLY', 'notable', 'playground.observation.slopeMovedStrongly',
      { activeSlope: slope, comparisonSlope: previousSlope, relativeChange: slopeChange },
      ['model.slope', 'slopeDifference'], experimentIds,
    ));
  }

  const repeatSpread = current('repeatSlopeSpread');
  const repeatMean = finite(repeatEvidence?.aggregates?.slope?.mean);
  if (repeatSpread !== null && repeatMean !== null
    && repeatSpread / Math.max(Math.abs(repeatMean), 1e-9) >= OBSERVATION_THRESHOLDS.repeatSlopeRelativeSpread) {
    notices.push(notice(
      'REPEAT_VARIATION', 'notable', 'playground.observation.repeatVariation',
      { slopeMean: repeatMean, slopeStandardDeviation: repeatSpread, relativeSpread: repeatSpread / Math.max(Math.abs(repeatMean), 1e-9), trialCount: repeatEvidence.trialCount },
      ['repeatSlopeSpread'], repeatEvidence.trials.map((trial) => trial.id ?? `trial-${trial.index}`),
    ));
  }

  return notices;
}
