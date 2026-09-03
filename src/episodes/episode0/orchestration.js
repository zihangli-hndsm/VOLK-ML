import { LUMI_ACTION_TYPES } from '../../core/exploration/inquiryContracts.js';
import { SEMANTIC_AFFORDANCE_TARGETS } from '../../core/orchestration/targets.js';
import { ORCHESTRATION_FALLBACK_LEVELS } from '../../core/orchestration/fallback.js';

export const EPISODE_ZERO_ORCHESTRATION_ID = 'episode-0-world-data-model';

// Episode content is declarative. Completion predicates are named facts
// interpreted by the generic orchestration runtime.
export const EPISODE_ZERO_ORCHESTRATION = Object.freeze({
  version: 1,
  id: EPISODE_ZERO_ORCHESTRATION_ID,
  type: 'introductory-inquiry',
  explorationContractId: 'episode-1-sampling-variability',
  learningIntent: 'world-data-model',
  entryStage: 'ENTRY',
  entry: {
    titleKey: 'episode.zero.title',
    questionKey: 'episode.zero.question',
    orientationKey: 'episode.zero.orientation',
  },
  stages: [
    { id: 'ENTRY', goalKey: 'episode.zero.goal.entry', completion: 'automatic', next: ['HOOK'] },
    { id: 'HOOK', goalKey: 'episode.zero.goal.hook', completion: 'automatic', next: ['REDUCTION'] },
    { id: 'REDUCTION', goalKey: 'episode.zero.goal.reduction', completion: 'automatic', next: ['FOUNDATION'] },
    { id: 'FOUNDATION', goalKey: 'episode.zero.goal.foundation', targets: [SEMANTIC_AFFORDANCE_TARGETS.WORLD_CANVAS], completeWhen: { fact: 'meaningfulLearnerAction' }, next: ['HANDOFF'] },
    { id: 'HANDOFF', goalKey: 'episode.zero.goal.handoff', completion: 'automatic', next: ['ORIENTATION'] },
    { id: 'ORIENTATION', goalKey: 'episode.zero.goal.orientation', targets: [SEMANTIC_AFFORDANCE_TARGETS.WORLD_NOISE], completeWhen: { any: [{ fact: 'directManipulation' }, { fact: 'sampled' }, { fact: 'fitA' }] }, next: ['FREE_ACTION'] },
    { id: 'FREE_ACTION', goalKey: 'episode.zero.goal.freeAction', guidance: { actions: ['STAY_SILENT'] }, completeWhen: { fact: 'meaningfulLearnerAction' }, next: ['QUESTION'] },
    { id: 'QUESTION', questionKey: 'episode.zero.question', goalKey: 'episode.zero.goal.question', completion: 'automatic', next: ['PREDICTION'] },
    { id: 'PREDICTION', questionKey: 'episode.zero.prediction', goalKey: 'episode.zero.goal.prediction', completeWhen: { fact: 'prediction' }, next: ['BASELINE'], optional: true },
    { id: 'BASELINE', questionKey: 'episode.zero.baseline', goalKey: 'episode.zero.goal.baseline', targets: [SEMANTIC_AFFORDANCE_TARGETS.MODEL_FIT], completeWhen: { fact: 'fitA' }, next: ['RESAMPLE'] },
    { id: 'RESAMPLE', questionKey: 'episode.zero.resample', goalKey: 'episode.zero.goal.resample', targets: [SEMANTIC_AFFORDANCE_TARGETS.WORLD_SAMPLE], completeWhen: { fact: 'sampled' }, next: ['SECOND_FIT'] },
    { id: 'SECOND_FIT', questionKey: 'episode.zero.secondFit', goalKey: 'episode.zero.goal.secondFit', targets: [SEMANTIC_AFFORDANCE_TARGETS.MODEL_FIT], completeWhen: { fact: 'fitB' }, next: ['COMPARE'] },
    { id: 'COMPARE', questionKey: 'episode.zero.compare', goalKey: 'episode.zero.goal.compare', targets: [SEMANTIC_AFFORDANCE_TARGETS.EXPERIMENT_COMPARE], completeWhen: { fact: 'comparison' }, next: ['INTERPRET'] },
    { id: 'INTERPRET', questionKey: 'episode.zero.interpret', goalKey: 'episode.zero.goal.interpret', completeWhen: { any: [{ fact: 'interpretation' }, { fact: 'evidence' }] }, next: ['EVIDENCE'], optional: true },
    { id: 'EVIDENCE', questionKey: 'episode.zero.evidence', goalKey: 'episode.zero.goal.evidence', targets: [SEMANTIC_AFFORDANCE_TARGETS.EVIDENCE_CURRENT], completeWhen: { fact: 'evidenceStrong' }, next: ['CONCEPT'] },
    { id: 'CONCEPT', questionKey: 'episode.zero.concept', goalKey: 'episode.zero.goal.concept', completeWhen: { fact: 'conceptEvidenced' }, next: ['TRANSFER'] },
    { id: 'TRANSFER', questionKey: 'episode.zero.transfer', goalKey: 'episode.zero.goal.transfer', completion: 'automatic', next: ['REFLECTION'] },
    { id: 'REFLECTION', questionKey: 'episode.zero.reflection', goalKey: 'episode.zero.goal.reflection', completeWhen: { fact: 'reflection' }, optional: true, next: ['CONTINUATION'] },
    { id: 'CONTINUATION', questionKey: 'episode.zero.continuation', goalKey: 'episode.zero.goal.continuation', completion: 'automatic', next: [] },
  ],
  fallbackSpine: ['ENTRY', 'HOOK', 'REDUCTION', 'FOUNDATION', 'HANDOFF', 'ORIENTATION', 'FREE_ACTION', 'QUESTION', 'PREDICTION', 'BASELINE', 'RESAMPLE', 'SECOND_FIT', 'COMPARE', 'INTERPRET', 'EVIDENCE', 'CONCEPT', 'TRANSFER', 'REFLECTION', 'CONTINUATION'],
  evidenceRequirements: ['SAMPLING_VARIABILITY_EVIDENCED'],
  conceptRequirements: ['SAMPLING_VARIABILITY'],
  fallbackLevels: Object.values(ORCHESTRATION_FALLBACK_LEVELS),
  conceptEligibility: { conceptId: 'SAMPLING_VARIABILITY', outcome: 'evidenced' },
  guidance: { maxHintsPerStage: 1, cooldownEventsAfterConcept: 3, maxHistory: 12 },
  continuations: [
    { id: 'continue-learning', questionKey: 'episode.zero.continuation.guided', mode: 'guided' },
    { id: 'explore-own-question', questionKey: 'episode.zero.continuation.free', mode: 'free-exploration' },
  ],
  transferHooks: ['more-data', 'repeated-sampling', 'noise', 'images', 'language'],
  agentPolicy: { authority: 'suggestion-only', actionTypes: LUMI_ACTION_TYPES },
});
