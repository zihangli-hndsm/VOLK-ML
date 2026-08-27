// Chronological trail entries and coherent episodes are separate projections.
// Neither is a second event log or a progress/causality engine.

import { isEvidenceInstanceId } from './evidenceProvenance.js';

export const INQUIRY_EPISODE_VERSION = 1;
export const MAX_INQUIRY_EPISODES = 32;
export const MAX_INQUIRY_TRAIL_ENTRIES = 48;
const TRAIL_TYPES = new Set(['observe', 'intervene', 'compare', 'design', 'hypothesize', 'interpret', 'revise', 'counterfactual', 'illuminate']);

function boundedId(value) { const normalized = typeof value === 'string' ? value.trim().slice(0, 160) : ''; return normalized || null; }
function boundedIds(values, limit = 12) { return [...new Set((Array.isArray(values) ? values : []).map(boundedId).filter(Boolean))].slice(0, limit); }
function evidenceIds(values, limit = 12) { return boundedIds(values, limit).filter(isEvidenceInstanceId); }
function eventsOf(value) { return (Array.isArray(value) ? value : value?.events ?? []).filter((event) => event && typeof event === 'object').slice(-MAX_INQUIRY_TRAIL_ENTRIES); }
function semanticType(event) {
  if (event.type === 'observation.detected') return 'observe';
  if (event.type === 'comparison.completed') return 'compare';
  if (event.type === 'experiment.duplicated' || event.type === 'experiment.factor-changed' || event.type === 'world.intervened') return 'intervene';
  return null;
}
function conceptsForEvent(event, inquiry) { return boundedIds((inquiry?.candidates ?? []).filter((candidate) => (candidate.supportingEventIds ?? []).includes(event.id)).map((candidate) => candidate.conceptId)); }

function createTrailEntry({ type, id, sourceIds = [], evidenceInstanceIds = [], reasonCodes = [], observableRefs = [], conceptIds = [], sequence = 0 } = {}) {
  if (!TRAIL_TYPES.has(type) || !boundedId(id)) return null;
  return Object.freeze({ version: INQUIRY_EPISODE_VERSION, id: boundedId(id), type, sourceIds: Object.freeze(boundedIds(sourceIds)), evidenceInstanceIds: Object.freeze(evidenceIds(evidenceInstanceIds)), reasonCodes: Object.freeze(boundedIds(reasonCodes, 6)), observableRefs: Object.freeze(boundedIds(observableRefs)), conceptIds: Object.freeze(boundedIds(conceptIds)), sequence: Number.isFinite(Number(sequence)) ? Math.max(0, Math.trunc(Number(sequence))) : 0, titleKey: `playground.inquiryTrail.episode.${type}` });
}

export function deriveInquiryTrailEntries({ semanticEvents = [], journey = null, inquiry = null, hypotheses = [], testDesigns = [], interpretations = [], revisions = [], counterfactualQuestions = [], illuminationEvents = [] } = {}) {
  const entries = [];
  eventsOf(semanticEvents).forEach((event, index) => {
    const type = semanticType(event); if (!type) return;
    entries.push(createTrailEntry({ type, id: `trail-${type}-${event.id}`, sourceIds: [event.id], evidenceInstanceIds: event.evidenceInstanceIds, reasonCodes: event.reasonCode ? [event.reasonCode] : [], observableRefs: event.evidenceRefs, conceptIds: conceptsForEvent(event, inquiry), sequence: event.sequence ?? index + 1 }));
  });
  (Array.isArray(testDesigns) ? testDesigns : []).slice(0, 8).forEach((design, index) => entries.push(createTrailEntry({ type: 'design', id: `trail-design-${design.id}`, sourceIds: [design.id, design.baselineExperimentId], evidenceInstanceIds: [...(design.outcomeEvidenceIds ?? []), ...(design.executionEvidenceIds ?? [])], sequence: 100 + index })));
  (Array.isArray(hypotheses) ? hypotheses : []).slice(0, 8).forEach((hypothesis, index) => entries.push(createTrailEntry({ type: 'hypothesize', id: `trail-hypothesis-${hypothesis.id}`, sourceIds: [hypothesis.id, hypothesis.experimentId], evidenceInstanceIds: hypothesis.evidenceInstanceIds ?? hypothesis.evidenceIds, conceptIds: hypothesis.linkedConceptIds, sequence: 140 + index })));
  (Array.isArray(interpretations) ? interpretations : []).slice(0, 12).forEach((item, index) => entries.push(createTrailEntry({ type: 'interpret', id: `trail-interpretation-${item.id}`, sourceIds: [item.id, ...(item.hypothesisIds ?? []), item.testDesignId], evidenceInstanceIds: item.evidenceInstanceIds, sequence: 180 + index })));
  (Array.isArray(revisions) ? revisions : []).slice(0, 12).forEach((item, index) => entries.push(createTrailEntry({ type: 'revise', id: `trail-revision-${item.childHypothesisId}`, sourceIds: [item.id, item.parentHypothesisId, item.childHypothesisId, ...(item.interpretationIds ?? [])], sequence: 200 + index })));
  (Array.isArray(counterfactualQuestions) ? counterfactualQuestions : []).slice(0, 8).forEach((item, index) => entries.push(createTrailEntry({ type: 'counterfactual', id: `trail-counterfactual-${item.id}`, sourceIds: [item.id, item.testDesignId], evidenceInstanceIds: item.observedEvidenceInstanceIds, sequence: 210 + index })));
  (Array.isArray(illuminationEvents) ? illuminationEvents : []).slice(0, 12).forEach((item, index) => entries.push(createTrailEntry({ type: 'illuminate', id: `trail-illuminate-${item.conceptId}`, sourceIds: [item.conceptId], conceptIds: [item.conceptId], sequence: 220 + index })));
  return Object.freeze(entries.filter(Boolean).sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id)).slice(-MAX_INQUIRY_TRAIL_ENTRIES));
}

function emptyEpisode(id) { return { version: INQUIRY_EPISODE_VERSION, id, hypothesisIds: [], hypothesisGroupIds: [], discriminationPlanIds: [], testDesignIds: [], interpretationIds: [], revisionIds: [], counterfactualQuestionIds: [], evidenceInstanceIds: [], illuminatedConceptIds: [] }; }
function add(values, next, limit = 12, evidenceOnly = false) { const combined = [...values, ...(Array.isArray(next) ? next : [next])]; const normalized = boundedIds(combined, limit).filter((value) => !evidenceOnly || isEvidenceInstanceId(value)); values.splice(0, values.length, ...normalized); }
function attach(map, key, update) { if (!key) return; const episode = map.get(key) ?? emptyEpisode(key); update(episode); map.set(key, episode); }

export function deriveInquiryEpisodes({ semanticEvents = [], journey = null, inquiry = null, hypotheses = [], hypothesisGroups = [], discriminationPlans = [], testDesigns = [], interpretations = [], revisions = [], counterfactualQuestions = [], illuminationEvents = [] } = {}) {
  const map = new Map();
  const designs = Array.isArray(testDesigns) ? testDesigns : [];
  const groups = Array.isArray(hypothesisGroups) ? hypothesisGroups : [];
  const hypothesisEpisode = (id) => { const design = designs.find((item) => item.hypothesisId === id); return design ? `test-design:${design.id}` : (id ? `hypothesis:${id}` : null); };
  designs.slice(0, 8).forEach((design) => attach(map, `test-design:${design.id}`, (episode) => { add(episode.testDesignIds, design.id); add(episode.hypothesisIds, design.hypothesisId); add(episode.evidenceInstanceIds, [...(design.outcomeEvidenceIds ?? []), ...(design.executionEvidenceIds ?? [])], 12, true); }));
  (Array.isArray(hypotheses) ? hypotheses : []).slice(0, 12).forEach((item) => attach(map, hypothesisEpisode(item.id), (episode) => { add(episode.hypothesisIds, item.id); add(episode.evidenceInstanceIds, item.evidenceInstanceIds ?? item.evidenceIds, 12, true); }));
  groups.slice(0, 8).forEach((group) => attach(map, hypothesisEpisode(group.hypothesisIds?.[0]), (episode) => add(episode.hypothesisGroupIds, group.id)));
  (Array.isArray(discriminationPlans) ? discriminationPlans : []).slice(0, 8).forEach((plan) => { const group = groups.find((item) => item.id === plan.hypothesisGroupId); attach(map, hypothesisEpisode(group?.hypothesisIds?.[0]), (episode) => { add(episode.discriminationPlanIds, plan.id); add(episode.testDesignIds, plan.testDesignId); }); });
  (Array.isArray(interpretations) ? interpretations : []).slice(0, 12).forEach((item) => attach(map, item.testDesignId ? `test-design:${item.testDesignId}` : hypothesisEpisode(item.hypothesisIds?.[0]), (episode) => { add(episode.interpretationIds, item.id); add(episode.hypothesisIds, item.hypothesisIds); add(episode.testDesignIds, item.testDesignId); add(episode.evidenceInstanceIds, item.evidenceInstanceIds, 12, true); }));
  (Array.isArray(revisions) ? revisions : []).slice(0, 12).forEach((item) => attach(map, hypothesisEpisode(item.parentHypothesisId), (episode) => { add(episode.revisionIds, item.id); add(episode.hypothesisIds, [item.parentHypothesisId, item.childHypothesisId]); add(episode.interpretationIds, item.interpretationIds); }));
  (Array.isArray(counterfactualQuestions) ? counterfactualQuestions : []).slice(0, 8).forEach((item) => attach(map, item.testDesignId ? `test-design:${item.testDesignId}` : `counterfactual:${item.id}`, (episode) => { add(episode.counterfactualQuestionIds, item.id); add(episode.testDesignIds, item.testDesignId); add(episode.evidenceInstanceIds, item.observedEvidenceInstanceIds, 12, true); }));
  (Array.isArray(illuminationEvents) ? illuminationEvents : []).slice(0, 12).forEach((item) => attach(map, `concept:${item.conceptId}`, (episode) => add(episode.illuminatedConceptIds, item.conceptId)));
  return Object.freeze([...map.values()].map((episode) => Object.freeze({ ...episode, ...Object.fromEntries(Object.entries(episode).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, Object.freeze(value)])) })).slice(0, MAX_INQUIRY_EPISODES));
}
