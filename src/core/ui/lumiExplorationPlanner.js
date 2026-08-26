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

export function deriveLumiExplorationPlan({ snapshot = null, journey = null, hypotheses = [], evidenceInstances = [], testDesigns = [], hypothesisGroups = [], interpretations = [], revisions = [], counterfactualQuestions = [], conceptGraph = null } = {}) {
  const suggestions = [];
  const availableEvidence = (Array.isArray(evidenceInstances) ? evidenceInstances : []).filter((instance) => instance?.available);
  const observed = (journey?.observedEvidenceIds ?? []).length > 0 || (snapshot?.observations ?? []).length > 0;
  const comparison = snapshot?.experimentWorkspace?.comparison ?? snapshot?.comparison;
  const frontier = conceptGraph?.frontierConceptIds?.[0] ?? journey?.frontierConceptIds?.[0] ?? null;
  if (availableEvidence.length > 0) suggestions.push(suggestion('inspect-evidence', 'playground.lumiPlanner.reason.inspectEvidence', availableEvidence[0].id));
  if (!observed) suggestions.push(suggestion('observe', 'playground.lumiPlanner.reason.observe'));
  if (hypotheses.length === 0) suggestions.push(suggestion('predict', 'playground.lumiPlanner.reason.predict'));
  if (hypotheses.length > 0 && availableEvidence.length > 0 && interpretations.length === 0) suggestions.push(suggestion('interpret', 'playground.lumiPlanner.reason.interpret', hypotheses[0]?.id));
  if (testDesigns.length === 0 && hypotheses.length > 0) suggestions.push(suggestion('design-test', 'playground.lumiPlanner.reason.designTest', hypotheses[0]?.id));
  if (comparison?.enabled && testDesigns.length > 0) suggestions.push(suggestion('hold-constant', 'playground.lumiPlanner.reason.holdConstant'));
  if (hypotheses.length >= 2 && hypothesisGroups.length === 0) suggestions.push(suggestion('compare-hypotheses', 'playground.lumiPlanner.reason.compareHypotheses'));
  if (interpretations.length > 0 && revisions.length === 0) suggestions.push(suggestion('revise', 'playground.lumiPlanner.reason.revise', interpretations[0]?.id));
  if (counterfactualQuestions.length === 0 && hypotheses.length > 0) suggestions.push(suggestion('counterfactual', 'playground.lumiPlanner.reason.counterfactual'));
  if (frontier) suggestions.push(suggestion('explore-concept', 'playground.lumiPlanner.reason.exploreConcept', frontier));
  const deduped = [...new Map(suggestions.filter(Boolean).map((item) => [item.kind, item])).values()]
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
    .slice(0, MAX_LUMI_SUGGESTIONS);
  return Object.freeze({ version: LUMI_PLANNER_VERSION, authority: 'suggestion-only', suggestions: Object.freeze(deduped) });
}
