// Inquiry Episodes are a notebook-like projection over existing semantic
// events and learner records. They are not a second event log or progress
// engine.

export const INQUIRY_EPISODE_VERSION = 1;
export const MAX_INQUIRY_EPISODES = 32;

const EPISODE_TYPES = new Set(['observe', 'intervene', 'compare', 'design', 'hypothesize', 'interpret', 'revise', 'illuminate']);

function boundedId(value) {
  const normalized = typeof value === 'string' ? value.trim().slice(0, 160) : '';
  return normalized || null;
}

function boundedIds(values, limit = 8) {
  return [...new Set((Array.isArray(values) ? values : []).map(boundedId).filter(Boolean))].slice(0, limit);
}

function episode(type, id, sourceIds = [], evidenceIds = [], conceptIds = [], sequence = 0) {
  if (!EPISODE_TYPES.has(type) || !boundedId(id)) return null;
  return Object.freeze({
    version: INQUIRY_EPISODE_VERSION,
    id: boundedId(id),
    type,
    sourceIds: Object.freeze(boundedIds(sourceIds)),
    evidenceIds: Object.freeze(boundedIds(evidenceIds)),
    conceptIds: Object.freeze(boundedIds(conceptIds)),
    sequence: Number.isFinite(Number(sequence)) ? Math.max(0, Math.trunc(Number(sequence))) : 0,
    titleKey: `playground.inquiryTrail.episode.${type}`,
  });
}

export function deriveInquiryEpisodes({ semanticEvents = [], journey = null, inquiry = null, hypotheses = [], testDesigns = [], interpretations = [], revisions = [], illuminationEvents = [] } = {}) {
  const episodes = [];
  const events = (Array.isArray(semanticEvents) ? semanticEvents : semanticEvents?.events ?? [])
    .filter((event) => event && typeof event === 'object')
    .slice(-24);
  events.forEach((event, index) => {
    const type = event.type === 'observation.detected' ? 'observe'
      : event.type === 'comparison.completed' ? 'compare'
        : event.type === 'experiment.duplicated' || event.type === 'experiment.factor-changed' || event.type === 'world.intervened' ? 'intervene'
          : null;
    if (!type) return;
    const concepts = (inquiry?.candidates ?? []).filter((candidate) => (candidate.supportingEventIds ?? []).includes(event.id)).map((candidate) => candidate.conceptId);
    episodes.push(episode(type, `episode-${type}-${event.id}`, [event.id], [event.reasonCode, ...(event.evidenceRefs ?? [])], concepts, event.sequence ?? index + 1));
  });
  (Array.isArray(testDesigns) ? testDesigns : []).slice(0, 8).forEach((design, index) => episodes.push(episode('design', `episode-design-${design.id}`, [design.id, design.baselineExperimentId], design.outcomeEvidenceIds, [], 100 + index)));
  (Array.isArray(hypotheses) ? hypotheses : []).slice(0, 8).forEach((hypothesis, index) => episodes.push(episode('hypothesize', `episode-hypothesis-${hypothesis.id}`, [hypothesis.id, hypothesis.experimentId], hypothesis.evidenceIds, hypothesis.linkedConceptIds, 140 + index)));
  (Array.isArray(interpretations) ? interpretations : []).slice(0, 12).forEach((interpretation, index) => episodes.push(episode('interpret', `episode-interpretation-${interpretation.id}`, [interpretation.id, ...(interpretation.hypothesisIds ?? []), ...(interpretation.testDesignId ? [interpretation.testDesignId] : [])], interpretation.evidenceInstanceIds, [], 180 + index)));
  (Array.isArray(revisions) ? revisions : []).slice(0, 12).forEach((revision, index) => episodes.push(episode('revise', `episode-revision-${revision.childHypothesisId}`, [revision.parentHypothesisId, revision.childHypothesisId, ...(revision.interpretationIds ?? [])], [], [], 200 + index)));
  (Array.isArray(illuminationEvents) ? illuminationEvents : []).slice(0, 12).forEach((event, index) => episodes.push(episode('illuminate', `episode-illuminate-${event.conceptId}`, [event.conceptId], [], [event.conceptId], 220 + index)));
  return Object.freeze(episodes.filter(Boolean).sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id)).slice(-MAX_INQUIRY_EPISODES));
}
