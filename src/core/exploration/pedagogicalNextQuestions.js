import { createPedagogicalExperimentDesign, PEDAGOGICAL_EXPERIMENT_GOALS } from './pedagogicalExperiment.js';

const metricDelta = (observation, id) => observation?.facts?.find((fact) => fact.id === id)?.delta ?? 0;

const CANDIDATES = Object.freeze({
  [PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION]: [
    { goal: PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE, questionKey: 'playground.pedagogical.next.classSeparation.noise', rationaleKey: 'playground.pedagogical.next.rationale.outcome' },
    { goal: PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY, questionKey: 'playground.pedagogical.next.classSeparation.outliers', rationaleKey: 'playground.pedagogical.next.rationale.outcome' },
  ],
  [PEDAGOGICAL_EXPERIMENT_GOALS.TRAIN_TEST_SUPPORT_SHIFT]: [
    { goal: PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE, questionKey: 'playground.pedagogical.next.supportShift.noise', rationaleKey: 'playground.pedagogical.next.rationale.coverage' },
    { goal: PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY, questionKey: 'playground.pedagogical.next.supportShift.outliers', rationaleKey: 'playground.pedagogical.next.rationale.coverage' },
  ],
  [PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE]: [
    { goal: PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY, questionKey: 'playground.pedagogical.next.noise.outliers', rationaleKey: 'playground.pedagogical.next.rationale.intervention' },
    { goal: PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION, questionKey: 'playground.pedagogical.next.noise.classSeparation', rationaleKey: 'playground.pedagogical.next.rationale.intervention' },
  ],
  [PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY]: [
    { goal: PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE, questionKey: 'playground.pedagogical.next.outliers.noise', rationaleKey: 'playground.pedagogical.next.rationale.intervention' },
    { goal: PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION, questionKey: 'playground.pedagogical.next.outliers.classSeparation', rationaleKey: 'playground.pedagogical.next.rationale.intervention' },
  ],
});

export function derivePedagogicalNextQuestionCandidates({ design, observation, task } = {}) {
  if (!observation?.available || !CANDIDATES[design?.goal]) return [];
  const candidates = [...CANDIDATES[design.goal]];
  if (design.goal === PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION
    && Math.abs(metricDelta(observation, 'outcome.testAccuracy')) > Math.abs(metricDelta(observation, 'outcome.trainAccuracy'))) {
    candidates.reverse();
  }
  return candidates
    .filter((candidate) => candidate.goal !== PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION || task === 'classification')
    .slice(0, 2)
    .map((candidate) => ({
      ...candidate,
      goal: candidate.goal,
      design: createPedagogicalExperimentDesign(candidate.goal),
    }));
}
