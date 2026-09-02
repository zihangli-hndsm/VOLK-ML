// Pure presentation projection for Goal 3. It consumes deterministic inquiry
// candidates and never authors a concept, observation, or runtime action.
import { INQUIRY_CONCEPT_IDS, getInquiryConcept } from './learnerInquiry.js';

export const INQUIRY_CONCEPT_CARD_VERSION = 1;
export const MAX_CONCEPT_EXPOSURES = 8;

const PRIORITY = [
  INQUIRY_CONCEPT_IDS.SAMPLING_VARIABILITY,
  INQUIRY_CONCEPT_IDS.DISTRIBUTION_SHIFT,
  INQUIRY_CONCEPT_IDS.GENERALIZATION,
  INQUIRY_CONCEPT_IDS.STABILITY,
  INQUIRY_CONCEPT_IDS.MIXED_FACTOR_COMPARISON,
  INQUIRY_CONCEPT_IDS.CONTROLLED_COMPARISON,
  INQUIRY_CONCEPT_IDS.COUNTERFACTUAL_REASONING,
];

const WHY_KEYS = Object.freeze({
  'sampling-variability-evidenced': ['playground.inquiry.samplingVariability.whyWorld', 'playground.inquiry.samplingVariability.whyData', 'playground.inquiry.samplingVariability.whyModel'],
  'duplicated-one-factor-comparison': ['playground.inquiry.why.duplicated', 'playground.inquiry.why.oneFactor', 'playground.inquiry.why.compared'],
  'changed-one-condition-against-baseline': ['playground.inquiry.why.duplicated', 'playground.inquiry.why.oneFactor', 'playground.inquiry.why.compared'],
  'mixed-factor-comparison': ['playground.inquiry.why.compared', 'playground.inquiry.why.multipleFactors'],
  'test-world-change-with-coverage-mismatch': ['playground.inquiry.why.testChanged', 'playground.inquiry.why.coverageMismatch'],
  'test-world-change-with-test-error-difference': ['playground.inquiry.why.testChanged', 'playground.inquiry.why.testErrorChangedMore'],
  'repeat-variation-observed': ['playground.inquiry.why.repeated', 'playground.inquiry.why.repeatVariation'],
});

function safeIds(values, max = MAX_CONCEPT_EXPOSURES) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.length > 0 && value.length <= 120))].slice(-max);
}

export function selectInquiryConceptCard({ inquiry, shownConceptIds = [], shownEventIds = [] } = {}) {
  const shown = new Set(safeIds(shownConceptIds));
  const shownEvents = new Set(safeIds(shownEventIds));
  const candidates = Array.isArray(inquiry?.candidates) ? inquiry.candidates : [];
  for (const conceptId of PRIORITY) {
    const candidate = candidates.find((item) => item?.conceptId === conceptId && item.confidence === 'direct');
    if (!candidate || shown.has(conceptId) || candidate.supportingEventIds?.some((id) => shownEvents.has(id))) continue;
    const concept = getInquiryConcept(conceptId);
    const whyKeys = WHY_KEYS[candidate.reasonCode];
    if (!concept || !whyKeys) continue;
    return {
      version: INQUIRY_CONCEPT_CARD_VERSION,
      conceptId,
      titleKey: concept.titleKey,
      summaryKey: concept.summaryKey,
      reasonCode: candidate.reasonCode,
      whyKeys: [...whyKeys],
      supportingEventIds: safeIds(candidate.supportingEventIds, 6),
      supportingObservationIds: safeIds(candidate.supportingObservationIds, 6),
      action: { type: 'open-evidence', labelKey: 'playground.inquiry.card.showEvidence' },
    };
  }
  return null;
}

export function nextInquiryConceptExposure(shownConceptIds, conceptId) {
  return safeIds([...(shownConceptIds ?? []), conceptId]);
}

export function nextInquiryConceptEventExposure(shownEventIds, supportingEventIds) {
  return safeIds([...(shownEventIds ?? []), ...(supportingEventIds ?? [])]);
}
