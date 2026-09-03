const EVENTS = new Set([
  'world.intervened', 'experiment.factor-changed', 'observation.sampled',
  'model.fit-completed', 'experiment.baseline-captured', 'experiment.duplicated',
  'comparison.completed', 'observation.detected', 'concept.evidenced',
]);

const eventsOf = (value) => (Array.isArray(value) ? value : value?.events ?? [])
  .filter((event) => event && typeof event === 'object' && EVENTS.has(event.type));

const humanEvents = (events) => events.filter((event) => event.actor === 'human');
const hasType = (events, type) => events.some((event) => event.type === type);

export function deriveOrchestrationFacts({ snapshot = null, semanticEvents = [], memory = {} } = {}) {
  const events = eventsOf(semanticEvents);
  const runtime = snapshot?.inquiryRuntime ?? {};
  const evidence = runtime.evidence ?? snapshot?.samplingVariability ?? null;
  const human = humanEvents(events);
  const fitEvents = events.filter((event) => event.type === 'model.fit-completed');
  const fitIds = [...new Set(fitEvents.flatMap((event) => event.experimentIds ?? []).filter(Boolean))];
  const comparison = runtime.comparison ?? snapshot?.experimentWorkspace?.comparison ?? null;
  const baselineFit = runtime.baseline?.fit ?? null;
  const activeFit = runtime.activeFit ?? null;
  const meaningful = human.filter((event) => [
    'world.intervened', 'experiment.factor-changed', 'observation.sampled',
    'model.fit-completed', 'experiment.duplicated', 'comparison.completed',
  ].includes(event.type));
  const conceptEvidenced = hasType(events, 'concept.evidenced') || evidence?.status === 'evidenced';
  return Object.freeze({
    meaningfulLearnerAction: meaningful.length > 0,
    directManipulation: human.some((event) => ['world.intervened', 'experiment.factor-changed'].includes(event.type)),
    worldIntervention: hasType(events, 'world.intervened') || hasType(events, 'experiment.factor-changed'),
    sampled: hasType(events, 'observation.sampled'),
    duplicated: hasType(events, 'experiment.duplicated'),
    fitA: Boolean(baselineFit) || fitEvents.length >= 1 || hasType(events, 'experiment.baseline-captured'),
    fitB: Boolean(activeFit && baselineFit && activeFit.experimentId !== baselineFit.experimentId) || fitEvents.length >= 2,
    comparison: Boolean(comparison?.enabled && comparison?.againstExperimentId),
    interpretation: Array.isArray(memory.interpretations) && memory.interpretations.length > 0,
    evidence: Boolean(evidence && ['valid-weak', 'evidenced'].includes(evidence.status)),
    evidenceStrong: evidence?.status === 'evidenced',
    conceptEvidenced,
    prediction: Boolean(memory.prediction),
    reflection: Boolean(memory.reflection),
    continuation: Boolean(memory.continuationId),
    fitCount: Math.max(fitEvents.length, fitIds.length),
    meaningfulEventCount: meaningful.length,
    recentHumanAction: meaningful.at(-1)?.type ?? null,
    recentEventSequence: events.at(-1)?.sequence ?? 0,
    comparisonResult: comparison,
  });
}

export function predicateMatches(predicate, facts) {
  if (!predicate) return false;
  if (typeof predicate === 'string') return Boolean(facts?.[predicate]);
  if (Array.isArray(predicate)) return predicate.every((item) => predicateMatches(item, facts));
  if (typeof predicate !== 'object') return false;
  if (predicate.all) return predicate.all.every((item) => predicateMatches(item, facts));
  if (predicate.any) return predicate.any.some((item) => predicateMatches(item, facts));
  if (predicate.not) return !predicateMatches(predicate.not, facts);
  if (typeof predicate.fact === 'string') {
    const actual = facts?.[predicate.fact];
    if (Object.hasOwn(predicate, 'equals')) return actual === predicate.equals;
    return Boolean(actual);
  }
  return false;
}
