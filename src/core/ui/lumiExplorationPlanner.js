import { deriveDiscriminationStructure, DISCRIMINATION_STATUSES } from '../exploration/competingHypotheses.js';

// Deterministic, suggestion-only LUMI guidance. This module consumes existing
// projections and never dispatches, executes, ranks hypotheses, or mutates.

export const LUMI_PLANNER_VERSION = 1;
export const MAX_LUMI_SUGGESTIONS = 4;
export const LUMI_SUGGESTION_KINDS = Object.freeze([
  'observe',
  'predict',
  'design-test',
  'compare-hypotheses',
  'hold-constant',
  'inspect-evidence',
  'interpret',
  'revise',
  'counterfactual',
  'explore-concept',
]);

const PRIORITY = Object.freeze({
  'inspect-evidence': 10,
  observe: 20,
  predict: 30,
  interpret: 40,
  'design-test': 50,
  'hold-constant': 60,
  'compare-hypotheses': 70,
  revise: 80,
  counterfactual: 90,
  'explore-concept': 100,
});

function boundedId(value) {
  const normalized = typeof value === 'string' ? value.trim().slice(0, 160) : '';
  return normalized || null;
}

function suggestion(kind, reasonKey, target = null) {
  if (!LUMI_SUGGESTION_KINDS.includes(kind)) return null;
  return Object.freeze({
    id: `lumi-suggestion-${kind}`,
    kind,
    priority: PRIORITY[kind],
    reasonKey,
    ...(boundedId(target) ? { target: boundedId(target) } : {}),
    authority: 'suggestion-only',
  });
}

export function deriveLumiExplorationPlan({ snapshot = null, journey = null, hypotheses = [], evidenceInstances = [], testDesigns = [], testDesignResults = {}, hypothesisGroups = [], discriminationPlans = [], interpretations = [], revisions = [], counterfactualQuestions = [], conceptGraph = null } = {}) {
  const suggestions = [];
  const availableEvidence = (Array.isArray(evidenceInstances) ? evidenceInstances : []).filter((instance) => instance?.available);
  const observed = (journey?.observedEvidenceIds ?? []).length > 0 || (snapshot?.observations ?? []).length > 0;
  const comparison = snapshot?.experimentWorkspace?.comparison ?? snapshot?.comparison;
  const frontier = conceptGraph?.frontierConceptIds?.[0] ?? journey?.frontierConceptIds?.[0] ?? null;
  const executedDesigns = testDesigns.filter((design) => design?.status === 'executed');
  const executedOutcomeIds = new Set(executedDesigns.flatMap((design) => design.outcomeEvidenceIds ?? []));
  const relevantEvidence = availableEvidence.filter((instance) => executedOutcomeIds.has(instance.id));
  const concrete = (hypothesis) => ['increase', 'decrease', 'similar'].includes(hypothesis?.prediction?.choice ?? hypothesis?.prediction);
  if (availableEvidence.length > 0) suggestions.push(suggestion('inspect-evidence', 'playground.lumiPlanner.reason.inspectEvidence', availableEvidence[0].id));
  if (!observed) suggestions.push(suggestion('observe', 'playground.lumiPlanner.reason.observe'));
  if (hypotheses.length > 0 && hypotheses.some((hypothesis) => !concrete(hypothesis))) suggestions.push(suggestion('predict', 'playground.lumiPlanner.reason.predict', hypotheses.find((hypothesis) => !concrete(hypothesis))?.id));
  const interpretedEvidenceIds = new Set(interpretations.flatMap((item) => item.evidenceInstanceIds ?? []));
  if (relevantEvidence.length > 0 && !relevantEvidence.some((item) => interpretedEvidenceIds.has(item.id))) suggestions.push(suggestion('interpret', 'playground.lumiPlanner.reason.interpret', relevantEvidence[0].id));
  const testedHypothesisIds = new Set(testDesigns.map((design) => design.hypothesisId));
  const concreteUntested = hypotheses.find((hypothesis) => concrete(hypothesis) && !testedHypothesisIds.has(hypothesis.id));
  if (concreteUntested) suggestions.push(suggestion('design-test', 'playground.lumiPlanner.reason.designTest', concreteUntested.id));
  if (Object.values(testDesignResults).some((result) => result?.comparisonClass === 'confounded')) suggestions.push(suggestion('hold-constant', 'playground.lumiPlanner.reason.holdConstant'));
  if (hypotheses.length >= 2) {
    if (hypothesisGroups.length === 0) suggestions.push(suggestion('compare-hypotheses', 'playground.lumiPlanner.reason.compareHypotheses'));
    hypothesisGroups.forEach((group) => {
      const plan = discriminationPlans.find((item) => item.hypothesisGroupId === group.id);
      const structure = deriveDiscriminationStructure({ plan, group });
      if (structure.status === DISCRIMINATION_STATUSES.INSUFFICIENT) suggestions.push(suggestion('compare-hypotheses', 'playground.lumiPlanner.reason.completePredictions', group.id));
      if (structure.status === DISCRIMINATION_STATUSES.OVERLAP) suggestions.push(suggestion('compare-hypotheses', 'playground.lumiPlanner.reason.discriminatingTest', group.id));
    });
  }
  const revisedInterpretationIds = new Set(revisions.flatMap((revision) => revision?.interpretationIds ?? []));
  const challenged = interpretations.find((item) => (
    (item.judgment === 'challenges' || item.judgment === 'needs-more-testing')
    && !revisedInterpretationIds.has(item.id)
  ));
  if (challenged) suggestions.push(suggestion('revise', 'playground.lumiPlanner.reason.revise', challenged.id));
  if (counterfactualQuestions.length === 0 && hypotheses.length > 0 && (executedDesigns.length > 0 || interpretations.length > 0)) suggestions.push(suggestion('counterfactual', 'playground.lumiPlanner.reason.counterfactual'));
  if (frontier) suggestions.push(suggestion('explore-concept', 'playground.lumiPlanner.reason.exploreConcept', frontier));
  const deduped = [...new Map(suggestions.filter(Boolean).map((item) => [item.kind, item])).values()]
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
    .slice(0, MAX_LUMI_SUGGESTIONS);
  return Object.freeze({ version: LUMI_PLANNER_VERSION, authority: 'suggestion-only', suggestions: Object.freeze(deduped) });
}
