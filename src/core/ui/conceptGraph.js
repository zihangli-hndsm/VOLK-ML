// Projection-only concept graph for the exploration presentation layer.
// Concept IDs and relationships come from existing semantic registries and
// Journey evidence; this module never discovers, ranks, or persists concepts.

import { INQUIRY_CONCEPT_REGISTRY } from '../exploration/learnerInquiry.js';
import { MAX_HYPOTHESES, normalizeHypothesisState } from '../exploration/hypothesis.js';
import {
  discriminationSemanticEdges,
  normalizeDiscriminationPlanState,
  normalizeHypothesisGroupState,
} from '../exploration/competingHypotheses.js';
import { normalizeTestDesignState } from '../exploration/testDesign.js';

export const CONCEPT_GRAPH_VERSION = 1;
export const MAX_CONCEPT_GRAPH_NODES = 24;
export const MAX_CONCEPT_GRAPH_EDGES = 48;

export const CONCEPT_GRAPH_STATES = Object.freeze({
  UNEXPLORED: 'unexplored',
  ACTIVE: 'active',
  ILLUMINATED: 'illuminated',
});

export const CONCEPT_GRAPH_RELATIONS = Object.freeze({
  PREREQUISITE: 'prerequisite',
  RELATED: 'related',
  CAUSED_BY: 'caused_by',
  OBSERVED_WITH: 'observed_with',
});

export const HYPOTHESIS_GRAPH_RELATIONS = Object.freeze({
  CONCEPT_LINK: 'hypothesis_link',
  EVIDENCE_LINK: 'hypothesis_evidence',
});

export const DISCRIMINATION_GRAPH_RELATIONS = Object.freeze({
  PREDICTED_BY: 'predicted_by',
  TESTED_BY: 'tested_by',
});

export function conceptGraphRelationSemantics(relation) {
  switch (relation) {
    case CONCEPT_GRAPH_RELATIONS.PREREQUISITE:
      return Object.freeze({ directed: true, sourceMeaning: 'prerequisite' });
    case CONCEPT_GRAPH_RELATIONS.CAUSED_BY:
      return Object.freeze({ directed: true, sourceMeaning: 'caused_by' });
    case CONCEPT_GRAPH_RELATIONS.RELATED:
      return Object.freeze({ directed: false, sourceMeaning: 'related' });
    case CONCEPT_GRAPH_RELATIONS.OBSERVED_WITH:
      return Object.freeze({ directed: false, sourceMeaning: 'observed_with' });
    default:
      return Object.freeze({ directed: false, sourceMeaning: null });
  }
}

const VALID_STATES = new Set(Object.values(CONCEPT_GRAPH_STATES));
const VALID_RELATIONS = new Set(Object.values(CONCEPT_GRAPH_RELATIONS));
const MAX_ID_LENGTH = 160;
const CONCEPT_ID_ALIASES = Object.freeze({
  'distribution-shift': 'train-test-distribution-shift',
});

function boundedId(value) {
  const normalized = typeof value === 'string' ? value.trim().slice(0, MAX_ID_LENGTH) : '';
  return normalized || null;
}

function conceptId(value) {
  const normalized = boundedId(value);
  return normalized ? CONCEPT_ID_ALIASES[normalized] ?? normalized : null;
}

function safeIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(conceptId).filter(Boolean))];
}

function registryConcept(id) {
  const normalizedId = conceptId(id);
  return normalizedId ? INQUIRY_CONCEPT_REGISTRY[normalizedId] ?? null : null;
}

function addConceptId(target, id) {
  const normalizedId = conceptId(id);
  if (normalizedId && registryConcept(normalizedId)) target.add(normalizedId);
}

function addEdge(edges, seen, from, to, relation) {
  const normalizedFrom = boundedId(from);
  const normalizedTo = boundedId(to);
  if (!normalizedFrom || !normalizedTo || normalizedFrom === normalizedTo || !VALID_RELATIONS.has(relation)) return;
  if (!registryConcept(normalizedFrom) || !registryConcept(normalizedTo)) return;
  const key = `${normalizedFrom}|${normalizedTo}|${relation}`;
  if (seen.has(key) || edges.length >= MAX_CONCEPT_GRAPH_EDGES) return;
  seen.add(key);
  edges.push(Object.freeze({ from: normalizedFrom, to: normalizedTo, relation }));
}

function normalizedJourneyEvents(journey) {
  return Array.isArray(journey?.events) ? journey.events.filter((event) => event && typeof event === 'object') : [];
}

function deriveConceptIds({ inquiry, journey, activeConceptId, illuminatedConceptIds, hypotheses }) {
  const ids = new Set();
  addConceptId(ids, activeConceptId);
  safeIds(illuminatedConceptIds).forEach((id) => addConceptId(ids, id));
  (inquiry?.candidates ?? []).forEach((candidate) => addConceptId(ids, candidate?.conceptId));
  normalizedJourneyEvents(journey).forEach((event) => addConceptId(ids, event?.conceptId));
  hypotheses.forEach((hypothesis) => hypothesis.linkedConceptIds.forEach((id) => addConceptId(ids, id)));

  [...ids].forEach((id) => {
    const concept = registryConcept(id);
    safeIds(concept?.prerequisites).forEach((relatedId) => addConceptId(ids, relatedId));
    safeIds(concept?.relatedConceptIds).forEach((relatedId) => addConceptId(ids, relatedId));
  });
  return [...ids].slice(0, MAX_CONCEPT_GRAPH_NODES);
}

function deriveHypothesisProjection({ hypotheses, conceptIds, selectedHypothesisId }) {
  const allowedConcepts = new Set(conceptIds);
  const hypothesisNodes = hypotheses.slice(0, MAX_HYPOTHESES).map((hypothesis) => {
    const linkedConceptIds = hypothesis.linkedConceptIds.map(conceptId).filter((id) => allowedConcepts.has(id));
    return Object.freeze({
    id: hypothesis.id,
    kind: 'hypothesis',
    statement: hypothesis.statement,
    status: hypothesis.status,
    linkedConceptIds: Object.freeze(linkedConceptIds),
    evidenceIds: Object.freeze(hypothesis.evidenceIds),
    });
  });
  const hypothesisEdges = [];
  hypothesisNodes.forEach((hypothesis) => {
    hypothesis.linkedConceptIds.forEach((conceptId) => hypothesisEdges.push(Object.freeze({
      from: conceptId,
      to: hypothesis.id,
      relation: HYPOTHESIS_GRAPH_RELATIONS.CONCEPT_LINK,
    })));
    hypothesis.evidenceIds.forEach((evidenceId) => hypothesisEdges.push(Object.freeze({
      from: hypothesis.id,
      to: evidenceId,
      relation: HYPOTHESIS_GRAPH_RELATIONS.EVIDENCE_LINK,
    })));
  });
  return {
    hypothesisNodes: Object.freeze(hypothesisNodes),
    hypothesisEdges: Object.freeze(hypothesisEdges),
    selectedHypothesisId: hypothesisNodes.some((node) => node.id === selectedHypothesisId) ? selectedHypothesisId : null,
  };
}

function deriveDiscriminationProjection({ hypotheses, groups, plans, testDesigns }) {
  const groupState = normalizeHypothesisGroupState({ version: 1, groups }, { hypotheses });
  const planState = normalizeDiscriminationPlanState({ version: 1, plans }, {
    groups: groupState.groups,
    hypotheses,
    testDesigns,
  });
  const validDesignIds = new Set(normalizeTestDesignState({ version: 1, designs: testDesigns }).designs.map((design) => design.id));
  const groupById = new Map(groupState.groups.map((group) => [group.id, group]));
  const discriminationNodes = planState.plans.map((plan) => Object.freeze({
    id: plan.id,
    kind: 'discrimination-plan',
    hypothesisGroupId: plan.hypothesisGroupId,
    testDesignId: plan.testDesignId,
    predictedOutcomes: plan.predictedOutcomes,
  }));
  const discriminationEdges = planState.plans.flatMap((plan) => discriminationSemanticEdges({
    group: groupById.get(plan.hypothesisGroupId),
    plan,
    testDesign: validDesignIds.has(plan.testDesignId) ? { id: plan.testDesignId } : null,
    hypotheses,
  })).slice(0, MAX_CONCEPT_GRAPH_EDGES).map((edge) => Object.freeze(edge));
  return {
    discriminationNodes: Object.freeze(discriminationNodes),
    discriminationEdges: Object.freeze(discriminationEdges),
  };
}

function deriveEvidenceByConcept(journey) {
  const evidenceByConcept = {};
  normalizedJourneyEvents(journey)
    .filter((event) => event.type === 'connect' && conceptId(event.conceptId) && boundedId(event.evidenceId))
    .forEach((event) => {
      const normalizedConceptId = conceptId(event.conceptId);
      const evidenceId = boundedId(event.evidenceId);
      const current = evidenceByConcept[normalizedConceptId] ?? [];
      if (!current.includes(evidenceId)) evidenceByConcept[normalizedConceptId] = [...current, evidenceId].slice(-8);
    });
  return evidenceByConcept;
}

function derivePathConceptIds(journey) {
  return [...new Set(normalizedJourneyEvents(journey)
    .filter((event) => (event.type === 'connect' || event.type === 'illuminate') && conceptId(event.conceptId))
    .map((event) => conceptId(event.conceptId)))];
}

function deriveCurrentConceptId(journey, activeConceptId) {
  const target = journey?.currentTarget;
  if (target?.type === 'concept') return conceptId(target.id);
  return conceptId(activeConceptId);
}

function deriveExperimentRelation(journey) {
  const currentEvent = journey?.currentEvent;
  if (currentEvent?.type !== 'intervene' || !boundedId(currentEvent.experimentId)) return null;
  return Object.freeze({
    experimentId: boundedId(currentEvent.experimentId),
    controlKey: boundedId(currentEvent.controlKey),
  });
}

export function deriveConceptGraph({
  inquiry = null,
  journey = null,
  activeConceptId = null,
  illuminatedConceptIds = [],
  selectedConceptId = null,
  hypotheses = [],
  selectedHypothesisId = null,
  hypothesisGroups = [],
  discriminationPlans = [],
  testDesigns = [],
} = {}) {
  const hypothesisState = normalizeHypothesisState({ version: 1, hypotheses });
  const conceptIds = deriveConceptIds({ inquiry, journey, activeConceptId, illuminatedConceptIds, hypotheses: hypothesisState.hypotheses });
  const illuminated = new Set(safeIds(illuminatedConceptIds));
  const currentConceptId = deriveCurrentConceptId(journey, activeConceptId);
  const pathConceptIds = derivePathConceptIds(journey);
  const connectedConceptIds = new Set(safeIds(journey?.connectedConceptIds));
  const candidateIds = new Set((inquiry?.candidates ?? []).map((candidate) => conceptId(candidate?.conceptId)).filter(Boolean));
  const requestedSelection = conceptId(selectedConceptId);
  const selected = requestedSelection && conceptIds.includes(requestedSelection) ? requestedSelection : null;
  const nodes = conceptIds.map((id) => {
    const state = illuminated.has(id)
      ? CONCEPT_GRAPH_STATES.ILLUMINATED
      : id === currentConceptId
        ? CONCEPT_GRAPH_STATES.ACTIVE
        : CONCEPT_GRAPH_STATES.UNEXPLORED;
    return Object.freeze({ id, state });
  });
  const edges = [];
  const seenEdges = new Set();
  conceptIds.forEach((id) => {
    const concept = registryConcept(id);
    safeIds(concept?.prerequisites).forEach((prerequisiteId) => addEdge(edges, seenEdges, prerequisiteId, id, CONCEPT_GRAPH_RELATIONS.PREREQUISITE));
    safeIds(concept?.relatedConceptIds).forEach((relatedId) => {
      const [from, to] = [id, relatedId].sort();
      addEdge(edges, seenEdges, from, to, CONCEPT_GRAPH_RELATIONS.RELATED);
    });
  });

  const frontierConceptIds = conceptIds.filter((id) => candidateIds.has(id)
    && id !== currentConceptId
    && !connectedConceptIds.has(id)
    && !illuminated.has(id));
  const neighborConceptIds = selected
    ? edges.filter((edge) => edge.from === selected || edge.to === selected)
      .map((edge) => edge.from === selected ? edge.to : edge.from)
    : [];
  const highlightedConceptIds = [...new Set([
    selected,
    ...pathConceptIds,
    ...neighborConceptIds,
  ].filter(Boolean))];
  const evidenceByConcept = deriveEvidenceByConcept(journey);
  const evidenceIds = selected ? (evidenceByConcept[selected] ?? []) : [];
  const hypothesisProjection = deriveHypothesisProjection({ hypotheses: hypothesisState.hypotheses, conceptIds, selectedHypothesisId });
  const selectedHypothesis = hypothesisProjection.hypothesisNodes.find((node) => node.id === hypothesisProjection.selectedHypothesisId);
  const discriminationProjection = deriveDiscriminationProjection({
    hypotheses: hypothesisState.hypotheses,
    groups: hypothesisGroups,
    plans: discriminationPlans,
    testDesigns,
  });

  return Object.freeze({
    version: CONCEPT_GRAPH_VERSION,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    currentConceptId,
    selectedConceptId: selected,
    pathConceptIds: Object.freeze(pathConceptIds),
    frontierConceptIds: Object.freeze(frontierConceptIds),
    highlightedConceptIds: Object.freeze(highlightedConceptIds),
    neighborConceptIds: Object.freeze([...new Set(neighborConceptIds)]),
    connectedEvidenceIds: Object.freeze(evidenceIds),
    evidenceByConcept: Object.freeze(Object.fromEntries(Object.entries(evidenceByConcept).map(([id, values]) => [id, Object.freeze(values)]))),
    experimentRelation: deriveExperimentRelation(journey),
    hypothesisNodes: hypothesisProjection.hypothesisNodes,
    hypothesisEdges: hypothesisProjection.hypothesisEdges,
    selectedHypothesisId: hypothesisProjection.selectedHypothesisId,
    selectedHypothesisEvidenceIds: Object.freeze(selectedHypothesis?.evidenceIds ?? []),
    discriminationNodes: discriminationProjection.discriminationNodes,
    discriminationEdges: discriminationProjection.discriminationEdges,
    // Causal edges are accepted as a vocabulary value for future explicit
    // semantic sources, but this projection never creates one.
    causalEdgeCount: edges.filter((edge) => edge.relation === CONCEPT_GRAPH_RELATIONS.CAUSED_BY).length,
  });
}

export function normalizeConceptGraph(value) {
  if (!value || value.version !== CONCEPT_GRAPH_VERSION || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null;
  const nodes = value.nodes.filter((node) => boundedId(node?.id) && VALID_STATES.has(node?.state));
  const edges = value.edges.filter((edge) => boundedId(edge?.from) && boundedId(edge?.to) && VALID_RELATIONS.has(edge?.relation));
  return { version: CONCEPT_GRAPH_VERSION, nodes, edges };
}
