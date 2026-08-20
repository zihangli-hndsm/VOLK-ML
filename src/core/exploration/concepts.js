// Small, runtime-grounded concept vocabulary. Concept IDs are derived from
// verified experiment evidence; callers and AI providers cannot author them.

import { PEDAGOGICAL_EXPERIMENT_GOALS } from './pedagogicalExperiment.js';
import { comparisonFactorCount, hasCanonicalComparisonPaths } from './comparison.js';

export const CONCEPT_CATALOG_VERSION = 1;

export const CONCEPT_IDS = Object.freeze({
  CONTROLLED_COMPARISON: 'controlled-comparison',
  HELD_CONSTANT: 'held-constant',
  TRAIN_TEST_DISTRIBUTION_SHIFT: 'train-test-distribution-shift',
  OBSERVATION_NOISE: 'observation-noise',
  OUTLIERS: 'outliers',
  CLASS_SEPARATION: 'class-separation',
});

const CATALOG = Object.freeze({
  [CONCEPT_IDS.CONTROLLED_COMPARISON]: Object.freeze({
    id: CONCEPT_IDS.CONTROLLED_COMPARISON,
    version: CONCEPT_CATALOG_VERSION,
    titleKey: 'playground.concept.controlledComparison.title',
    definitionKey: 'playground.concept.controlledComparison.definition',
    questionKey: 'playground.concept.controlledComparison.question',
  }),
  [CONCEPT_IDS.HELD_CONSTANT]: Object.freeze({
    id: CONCEPT_IDS.HELD_CONSTANT,
    version: CONCEPT_CATALOG_VERSION,
    titleKey: 'playground.concept.heldConstant.title',
    definitionKey: 'playground.concept.heldConstant.definition',
    questionKey: 'playground.concept.heldConstant.question',
  }),
  [CONCEPT_IDS.TRAIN_TEST_DISTRIBUTION_SHIFT]: Object.freeze({
    id: CONCEPT_IDS.TRAIN_TEST_DISTRIBUTION_SHIFT,
    version: CONCEPT_CATALOG_VERSION,
    titleKey: 'playground.concept.trainTestDistributionShift.title',
    definitionKey: 'playground.concept.trainTestDistributionShift.definition',
    questionKey: 'playground.concept.trainTestDistributionShift.question',
  }),
  [CONCEPT_IDS.OBSERVATION_NOISE]: Object.freeze({
    id: CONCEPT_IDS.OBSERVATION_NOISE,
    version: CONCEPT_CATALOG_VERSION,
    titleKey: 'playground.concept.observationNoise.title',
    definitionKey: 'playground.concept.observationNoise.definition',
    questionKey: 'playground.concept.observationNoise.question',
  }),
  [CONCEPT_IDS.OUTLIERS]: Object.freeze({
    id: CONCEPT_IDS.OUTLIERS,
    version: CONCEPT_CATALOG_VERSION,
    titleKey: 'playground.concept.outliers.title',
    definitionKey: 'playground.concept.outliers.definition',
    questionKey: 'playground.concept.outliers.question',
  }),
  [CONCEPT_IDS.CLASS_SEPARATION]: Object.freeze({
    id: CONCEPT_IDS.CLASS_SEPARATION,
    version: CONCEPT_CATALOG_VERSION,
    titleKey: 'playground.concept.classSeparation.title',
    definitionKey: 'playground.concept.classSeparation.definition',
    questionKey: 'playground.concept.classSeparation.question',
  }),
});

// Shared metadata for the learner-inquiry projection. Keeping these IDs next
// to the grounded concept catalog prevents the inquiry matcher and Concept
// Cards from silently acquiring different definitions for the same concept.
export const INQUIRY_CONCEPT_METADATA = Object.freeze({
  [CONCEPT_IDS.CONTROLLED_COMPARISON]: Object.freeze({
    ...CATALOG[CONCEPT_IDS.CONTROLLED_COMPARISON],
    summaryKey: CATALOG[CONCEPT_IDS.CONTROLLED_COMPARISON].definitionKey,
    evidenceRequirements: ['duplicated-baseline', 'one-factor-comparison'],
    prerequisites: [],
    relatedConceptIds: ['counterfactual-reasoning'],
    nextInquiryActions: ['compare-another-factor'],
  }),
  'mixed-factor-comparison': Object.freeze({
    titleKey: 'playground.inquiry.mixedComparison.title',
    summaryKey: 'playground.inquiry.mixedComparison.summary',
    evidenceRequirements: ['mixed-comparison'],
    prerequisites: [],
    relatedConceptIds: ['controlled-comparison'],
    nextInquiryActions: ['isolate-one-factor'],
  }),
  [CONCEPT_IDS.TRAIN_TEST_DISTRIBUTION_SHIFT]: Object.freeze({
    ...CATALOG[CONCEPT_IDS.TRAIN_TEST_DISTRIBUTION_SHIFT],
    summaryKey: CATALOG[CONCEPT_IDS.TRAIN_TEST_DISTRIBUTION_SHIFT].definitionKey,
    evidenceRequirements: ['test-world-change', 'coverage-mismatch'],
    prerequisites: [],
    relatedConceptIds: ['generalization'],
    nextInquiryActions: ['adjust-test-support'],
  }),
  generalization: Object.freeze({
    titleKey: 'playground.inquiry.generalization.title',
    summaryKey: 'playground.inquiry.generalization.summary',
    evidenceRequirements: ['test-world-change', 'test-error-changed-more'],
    prerequisites: [],
    relatedConceptIds: ['train-test-distribution-shift'],
    nextInquiryActions: ['inspect-test-evidence'],
  }),
  stability: Object.freeze({
    titleKey: 'playground.inquiry.stability.title',
    summaryKey: 'playground.inquiry.stability.summary',
    evidenceRequirements: ['repeat-completed', 'repeat-variation-observed'],
    prerequisites: [],
    relatedConceptIds: [],
    nextInquiryActions: ['repeat-with-new-seed'],
  }),
  'counterfactual-reasoning': Object.freeze({
    titleKey: 'playground.inquiry.counterfactual.title',
    summaryKey: 'playground.inquiry.counterfactual.summary',
    evidenceRequirements: ['duplicated-baseline', 'one-factor-comparison'],
    prerequisites: ['controlled-comparison'],
    relatedConceptIds: ['controlled-comparison'],
    nextInquiryActions: ['change-one-condition'],
  }),
});

const TRIGGERS = new Set([
  'exact-held-dimensions',
  'exact-comparison-fidelity',
  'verified-test-support-shift',
  'verified-position-noise',
  'verified-train-outliers',
  'verified-class-separation-decrease',
]);

const clone = (value) => structuredClone(value);

export function listConcepts() {
  return Object.values(CATALOG).map(clone);
}

export function getConcept(id) {
  return CATALOG[id] ? clone(CATALOG[id]) : null;
}

function exactComparison({ comparison, fidelity } = {}) {
  const diff = comparison?.diff;
  return Boolean(
    comparison?.enabled
    && diff
    && hasCanonicalComparisonPaths(diff)
    && fidelity?.status === 'exact'
    && comparisonFactorCount(diff) > 0,
  );
}

function fact(observation, id) {
  return observation?.facts?.find((item) => item.id === id) ?? null;
}

function directSignal(id, trigger, evidenceRefs) {
  return { id, confidence: 'direct', evidenceRefs: [...evidenceRefs].slice(0, 6), trigger };
}

export function deriveConceptSignals({ comparison, pedagogicalDesign, pedagogicalVerification, pedagogicalObservation, fidelity } = {}) {
  const signals = [];
  const goal = pedagogicalDesign?.goal ?? pedagogicalObservation?.goal;
  const verified = Boolean(pedagogicalObservation?.available && pedagogicalVerification?.valid);
  const diff = comparison?.diff;

  if (!exactComparison({ comparison, fidelity })) return { version: CONCEPT_CATALOG_VERSION, concepts: [] };

  if (verified && goal === PEDAGOGICAL_EXPERIMENT_GOALS.TRAIN_TEST_SUPPORT_SHIFT) {
    const coverage = fact(pedagogicalObservation, 'test-outside-train-fraction');
    const trainHeld = fact(pedagogicalObservation, 'train-realization-held');
    if (coverage?.after > coverage?.before && trainHeld) {
      signals.push(directSignal(
        CONCEPT_IDS.TRAIN_TEST_DISTRIBUTION_SHIFT,
        'verified-test-support-shift',
        ['test-outside-train-fraction', 'train-realization-held'],
      ));
    }
  }

  if (verified && goal === PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE) {
    const changed = fact(pedagogicalObservation, 'train-position-changes');
    const testHeld = fact(pedagogicalObservation, 'test-realization-held');
    if (changed?.after > 0 && testHeld) {
      signals.push(directSignal(CONCEPT_IDS.OBSERVATION_NOISE, 'verified-position-noise', ['train-position-changes', 'test-realization-held']));
    }
  }

  if (verified && goal === PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY) {
    const outliers = fact(pedagogicalObservation, 'train-outlier-count');
    const testHeld = fact(pedagogicalObservation, 'test-realization-held');
    if (outliers?.after > outliers?.before && testHeld) {
      signals.push(directSignal(CONCEPT_IDS.OUTLIERS, 'verified-train-outliers', ['train-outlier-count', 'test-realization-held']));
    }
  }

  if (verified && goal === PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION) {
    const separation = fact(pedagogicalObservation, 'class-separation-distance');
    if (separation?.after < separation?.before) {
      signals.push(directSignal(CONCEPT_IDS.CLASS_SEPARATION, 'verified-class-separation-decrease', ['class-separation-distance']));
    }
  }

  if (Array.isArray(diff?.semanticUnchangedPaths) && diff.semanticUnchangedPaths.length > 0) {
    signals.push(directSignal(CONCEPT_IDS.HELD_CONSTANT, 'exact-held-dimensions', ['comparison.diff.unchanged']));
  }
  if (Array.isArray(diff?.semanticUnchangedPaths) && diff.semanticUnchangedPaths.length > 0 && comparisonFactorCount(diff) === 1) {
    signals.push(directSignal(CONCEPT_IDS.CONTROLLED_COMPARISON, 'exact-comparison-fidelity', ['comparison.diff.changed', 'comparison.diff.unchanged']));
  }

  const seen = new Set();
  const concepts = signals.filter((signal) => {
    if (seen.has(signal.id)) return false;
    seen.add(signal.id);
    return Boolean(CATALOG[signal.id]);
  });
  return { version: CONCEPT_CATALOG_VERSION, concepts };
}

export function canonicalizeConceptSignals(value) {
  if (!value || value.version !== CONCEPT_CATALOG_VERSION || !Array.isArray(value.concepts) || value.concepts.length > Object.keys(CATALOG).length) return null;
  const seen = new Set();
  const concepts = value.concepts.map((signal) => {
    if (!signal || typeof signal !== 'object' || !CATALOG[signal.id] || signal.confidence !== 'direct') return null;
    if (seen.has(signal.id)) return null;
    seen.add(signal.id);
    if (!Array.isArray(signal.evidenceRefs) || signal.evidenceRefs.length > 6 || signal.evidenceRefs.some((ref) => typeof ref !== 'string' || ref.length > 120)) return null;
    if (!TRIGGERS.has(signal.trigger)) return null;
    return { id: signal.id, confidence: 'direct', evidenceRefs: [...signal.evidenceRefs], trigger: signal.trigger };
  });
  if (concepts.some((signal) => !signal)) return null;
  return { version: CONCEPT_CATALOG_VERSION, concepts };
}
