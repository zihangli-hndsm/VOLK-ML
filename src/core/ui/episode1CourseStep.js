import { deriveEpisode1GuidanceStage, deriveEpisode1NextOperation } from './lumiEpisodeGuidance.js';

const EPISODE_ID = 'episode-1-sampling-variability';

const STEP_COPY = Object.freeze({
  'baseline-fit': Object.freeze({ operation: 'RUN', branch: 'a', purposeKey: 'episode.one.step.fitA.purpose', whyKey: 'episode.one.step.fitA.why' }),
  resample: Object.freeze({ operation: 'SAMPLE_SAME_WORLD', branch: null, purposeKey: 'episode.one.step.resample.purpose', whyKey: 'episode.one.step.resample.why' }),
  'fit-b': Object.freeze({ operation: 'RUN', branch: 'b', purposeKey: 'episode.one.step.fitB.purpose', whyKey: 'episode.one.step.fitB.why' }),
  compare: Object.freeze({ operation: 'SET_COMPARE', branch: null, purposeKey: 'episode.one.step.compare.purpose', whyKey: 'episode.one.step.compare.why' }),
  'repeat-resample': Object.freeze({ operation: 'SAMPLE_SAME_WORLD', branch: null, purposeKey: 'episode.one.step.repeat.purpose', whyKey: 'episode.one.step.repeat.why' }),
});

const ACTION_TARGETS = Object.freeze({ RUN: 'model.fit', SAMPLE_SAME_WORLD: 'world.sample', SET_COMPARE: 'experiment.compare' });
const ACTION_LABELS = Object.freeze({
  'baseline-fit': 'episode.one.fitA',
  resample: 'episode.one.sample',
  'fit-b': 'episode.one.fitB',
  compare: 'episode.one.compare',
  'repeat-resample': 'episode.one.sample',
});

export function deriveEpisode1CourseStep(snapshot = null, { freeExploration = false, helpRequested = false } = {}) {
  const runtime = snapshot?.inquiryRuntime;
  if (runtime?.contractId !== EPISODE_ID) return null;
  if (freeExploration && !helpRequested) return Object.freeze({ mode: 'free', operation: null, targetKey: null });

  const stage = deriveEpisode1GuidanceStage(snapshot);
  const evidence = runtime.evidence;
  if (stage === 'concept' && evidence?.status === 'evidenced'
    && runtime.candidateConcepts?.includes('SAMPLING_VARIABILITY')) {
    return Object.freeze({ mode: 'concept', stage, operation: null, targetKey: null });
  }
  const copy = STEP_COPY[stage];
  if (!copy) return null;
  const legalOperation = deriveEpisode1NextOperation(snapshot);
  const requiredRuntimeOperation = copy.operation === 'SAMPLE_SAME_WORLD' ? 'RESAMPLE_WORLD' : copy.operation;
  if (legalOperation !== requiredRuntimeOperation) return null;
  if (stage === 'compare' && !snapshot?.experimentWorkspace?.comparison?.againstExperimentId) return null;
  return Object.freeze({
    mode: freeExploration ? 'requested-help' : 'guided',
    stage,
    operation: copy.operation,
    branch: copy.branch,
    purposeKey: copy.purposeKey,
    whyKey: copy.whyKey,
    actionLabelKey: ACTION_LABELS[stage],
    targetKey: ACTION_TARGETS[copy.operation],
  });
}
