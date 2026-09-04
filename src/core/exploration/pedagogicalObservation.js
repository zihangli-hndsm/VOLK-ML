import { PEDAGOGICAL_EXPERIMENT_GOALS } from './pedagogicalExperiment.js';
import { conditionFingerprintForSession } from './observables.js';
import { derivePedagogicalEvidence } from './pedagogicalEvidence.js';
import { verifyPedagogicalIntervention } from './pedagogicalVerification.js';

export const PEDAGOGICAL_OBSERVATION_VERSION = 1;

const SUPPORTED_GOALS = new Set(Object.values(PEDAGOGICAL_EXPERIMENT_GOALS));
const SUMMARY_KEYS = Object.freeze({
  [PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION]: 'playground.pedagogical.observation.classSeparation',
  [PEDAGOGICAL_EXPERIMENT_GOALS.TRAIN_TEST_SUPPORT_SHIFT]: 'playground.pedagogical.observation.supportShift',
  [PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE]: 'playground.pedagogical.observation.noise',
  [PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY]: 'playground.pedagogical.observation.outliers',
  [PEDAGOGICAL_EXPERIMENT_GOALS.MORE_SAME_DISTRIBUTION_DATA]: 'playground.pedagogical.observation.moreData',
});

const FACT_CONTRACTS = Object.freeze({
  'class-separation-distance': { kind: 'intervention', labelKey: 'playground.pedagogical.observation.classSeparationDistance', numeric: true },
  'test-outside-train-fraction': { kind: 'coverage', labelKey: 'playground.pedagogical.observation.testOutsideTrainFraction', numeric: true },
  'train-realization-held': { kind: 'hold', labelKey: 'playground.pedagogical.observation.trainHeld', numeric: false },
  'train-position-changes': { kind: 'intervention', labelKey: 'playground.pedagogical.observation.trainPositionsChanged', numeric: true },
  'test-realization-held': { kind: 'hold', labelKey: 'playground.pedagogical.observation.testHeld', numeric: false },
  'train-outlier-count': { kind: 'intervention', labelKey: 'playground.pedagogical.observation.outlierCount', numeric: true },
  'train-sample-count': { kind: 'intervention', labelKey: 'playground.explorationAgent.semantic.trainSamples', numeric: true },
  'outcome.trainAccuracy': { kind: 'outcome', labelKey: 'playground.pedagogical.trainOutcome', numeric: true },
  'outcome.testAccuracy': { kind: 'outcome', labelKey: 'playground.pedagogical.testOutcome', numeric: true },
  'outcome.trainMse': { kind: 'outcome', labelKey: 'playground.pedagogical.trainMse', numeric: true },
  'outcome.testMse': { kind: 'outcome', labelKey: 'playground.pedagogical.testMse', numeric: true },
});

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

function canonicalFact(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const contract = FACT_CONTRACTS[value.id];
  if (!contract || value.kind !== contract.kind || value.labelKey !== contract.labelKey) return null;
  if (contract.numeric) {
    if (![value.before, value.after, value.delta].every(Number.isFinite)
      || Math.abs(value.delta - (value.after - value.before)) > 1e-6
      || !['increased', 'decreased', 'unchanged'].includes(value.direction)) return null;
    return {
      id: value.id,
      kind: contract.kind,
      labelKey: contract.labelKey,
      before: value.before,
      after: value.after,
      delta: value.delta,
      direction: value.direction,
    };
  }
  return {
    id: value.id,
    kind: contract.kind,
    labelKey: contract.labelKey,
    direction: 'unchanged',
  };
}

export function canonicalizePedagogicalObservation(value) {
  if (!value?.available || value.version !== PEDAGOGICAL_OBSERVATION_VERSION || !SUPPORTED_GOALS.has(value.goal)) return null;
  if (value.summaryKey !== SUMMARY_KEYS[value.goal]
    || !Array.isArray(value.facts)
    || value.facts.length > 8
    || !Array.isArray(value.changed)
    || value.changed.length > 12
    || !Array.isArray(value.held)
    || value.held.length > 12
    || value.changed.some((item) => typeof item !== 'string' || item.length > 120)
    || value.held.some((item) => typeof item !== 'string' || item.length > 120)) return null;
  const facts = value.facts.map(canonicalFact);
  if (facts.some((fact) => !fact)) return null;
  return {
    version: PEDAGOGICAL_OBSERVATION_VERSION,
    goal: value.goal,
    available: true,
    facts,
    changed: [...value.changed],
    held: [...value.held],
    summaryKey: value.summaryKey,
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
  if (goal === PEDAGOGICAL_EXPERIMENT_GOALS.MORE_SAME_DISTRIBUTION_DATA) {
    const before = (verification.measurements?.trainSamplesBefore);
    const after = (verification.measurements?.trainSamplesAfter);
    if (Number.isFinite(before) && Number.isFinite(after)) facts.push(numericFact({
      id: 'train-sample-count', kind: 'intervention', labelKey: 'playground.explorationAgent.semantic.trainSamples', before, after,
    }));
  }

  const summaryKey = SUMMARY_KEYS[goal] ?? null;
  const completeFacts = [...facts, ...outcomeFacts(evidence)].slice(0, 8);
  return {
    ...observation,
    available: Boolean(summaryKey && completeFacts.length),
    facts: clone(completeFacts),
    summaryKey,
  };
}

function conditionFingerprintForState(state) {
  return conditionFingerprintForSession({
    world: state?.experiment?.world,
    adapterId: state?.adapterId ?? state?.experiment?.model?.adapterId,
    experiment: state?.experiment,
  });
}

export function derivePedagogicalObservationForScenario({ session, snapshot, scenario } = {}) {
  const design = scenario?.pedagogicalDesign;
  const baselineId = scenario?.baseline?.experimentId;
  const workspace = session?.experimentWorkspace;
  const comparison = snapshot?.experimentWorkspace?.comparison;
  const activeId = snapshot?.experimentWorkspace?.activeExperimentId ?? workspace?.activeExperimentId ?? session?.experiment?.id;
  if (!design || !baselineId || !activeId || activeId === baselineId
    || !comparison?.enabled
    || comparison.againstExperimentId !== baselineId) return null;
  const baselineState = workspace?.entries?.[baselineId]?.state;
  if (!baselineState || conditionFingerprintForState(baselineState) !== scenario.baseline.conditionFingerprint) return null;
  const verification = verifyPedagogicalIntervention({
    design,
    baselineWorld: baselineState.experiment?.world,
    candidateWorld: session.experiment?.world,
    scenario,
    comparison: comparison.diff,
  });
  if (!verification.valid) return null;
  const evidence = derivePedagogicalEvidence({ snapshot, scenario, verification });
  return canonicalizePedagogicalObservation(derivePedagogicalObservation({ design, evidence, verification }));
}
