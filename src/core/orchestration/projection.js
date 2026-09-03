import { deriveLearnerMomentum, deriveFallbackLevel, resetFallbackOnMomentum, ORCHESTRATION_MOMENTUM } from './fallback.js';
import { deriveOrchestrationFacts, predicateMatches } from './facts.js';

export function projectOrchestrationLumiContext(state = {}) {
  return Object.freeze({
    episodeId: state.episodeId ?? null,
    stageId: state.stageId ?? null,
    currentQuestion: state.currentQuestion ?? null,
    currentGoal: state.currentGoal ?? null,
    fallbackLevel: state.fallbackLevel ?? 0,
    learnerMomentum: state.learnerMomentum ?? ORCHESTRATION_MOMENTUM.RECENTLY_ACTIVE,
    eligibleActions: [...(state.eligibleGuidanceActions ?? [])].slice(0, 8),
    semanticTarget: state.semanticTarget ?? null,
    evidenceState: state.evidenceState ?? 'insufficient',
  });
}

export function deriveOrchestrationProjection({ contract, snapshot = null, semanticEvents = [], memory = {}, idleCategory = 'none', recentGuidance = [], dismissed = false } = {}) {
  const facts = deriveOrchestrationFacts({ snapshot, semanticEvents, memory });
  const stages = Array.isArray(contract?.stages) ? contract.stages : [];
  const completed = [];
  let current = null;
  for (const stage of stages) {
    const complete = stage.completion === 'automatic' || stage.optional === true || predicateMatches(stage.completeWhen, facts);
    if (complete) {
      completed.push(stage.id);
      continue;
    }
    if (!current && (!stage.enterWhen || predicateMatches(stage.enterWhen, facts))) current = stage;
    break;
  }
  const completedMilestones = completed;
  current ??= stages.find((stage) => !completedMilestones.includes(stage.id)) ?? stages.at(-1) ?? null;
  const momentum = deriveLearnerMomentum({ facts, recentMeaningfulEvents: facts.meaningfulEventCount, idleCategory });
  const fallback = resetFallbackOnMomentum(deriveFallbackLevel({ momentum, recentGuidance, dismissed, stageId: current?.id, hasProgress: Boolean(facts.recentHumanAction) }), momentum);
  const evidenceState = snapshot?.inquiryRuntime?.evidence?.status ?? 'insufficient';
  const conceptState = facts.evidenceStrong
    ? 'evidenced'
    : (Array.isArray(memory.encounteredConcepts) && memory.encounteredConcepts.length ? 'encountered' : 'unavailable');
  const eligibleGuidanceActions = fallback === 0 ? ['STAY_SILENT'] : (current?.guidance?.actions ?? ['ASK']).slice(0, 4);
  return Object.freeze({
    version: 1,
    episodeId: contract?.id ?? null,
    stageId: current?.id ?? null,
    completedMilestones: Object.freeze(completedMilestones),
    currentQuestion: current?.questionKey ?? contract?.entry?.questionKey ?? null,
    currentGoal: current?.goalKey ?? current?.goal ?? null,
    eligibleGuidanceActions: Object.freeze(eligibleGuidanceActions),
    fallbackLevel: fallback,
    learnerMomentum: momentum,
    conceptState,
    continuationOptions: Object.freeze((contract?.continuations ?? []).map((item) => ({ ...item }))),
    facts,
    lumi: projectOrchestrationLumiContext({ episodeId: contract?.id, stageId: current?.id, currentQuestion: current?.questionKey ?? contract?.entry?.questionKey, currentGoal: current?.goalKey ?? current?.goal, fallbackLevel: fallback, learnerMomentum: momentum, eligibleGuidanceActions, semanticTarget: current?.targets?.[0] ?? null, evidenceState }),
  });
}
