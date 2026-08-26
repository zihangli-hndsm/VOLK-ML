// Session-local learner test designs. A TestDesign is a detached plan: it
// validates against current capabilities, but it never owns or mutates the
// World, Dataset, Experiment, Evidence, or Hypothesis runtime.

import { isEvidenceInstanceId } from './evidenceProvenance.js';
import { canonicalExperimentalControl, comparisonFactorCount } from './comparison.js';
import { listGeneratorParameterCapabilities } from './operationRegistry.js';

export const TEST_DESIGN_VERSION = 1;
export const MAX_TEST_DESIGNS = 8;
export const MAX_TEST_DESIGN_ID_LENGTH = 160;
export const MAX_TEST_DESIGN_OUTCOMES = 6;
export const MAX_TEST_DESIGN_EXECUTION_EVIDENCE = 16;
export const MAX_TEST_DESIGN_HOLDS = 12;
export const MAX_TEST_DESIGN_TEXT_LENGTH = 240;

export const TEST_DESIGN_STATUSES = Object.freeze({
  DRAFT: 'draft',
  READY: 'ready',
  EXECUTED: 'executed',
});

export const TEST_DESIGN_FACTOR_KINDS = Object.freeze([
  'world',
  'observationProcess',
  'trainTest',
  'model',
  'learning',
  'evaluation',
]);

export const TEST_DESIGN_PREDICTION_CHOICES = Object.freeze([
  'increase',
  'decrease',
  'similar',
  'uncertain',
]);

const VALID_STATUSES = new Set(Object.values(TEST_DESIGN_STATUSES));
const VALID_FACTORS = new Set(TEST_DESIGN_FACTOR_KINDS);
const VALID_PREDICTIONS = new Set(TEST_DESIGN_PREDICTION_CHOICES);
const GENERATOR_OPTIONS = Object.freeze([
  { path: 'noise.amount', factorKind: 'observationProcess', semanticPath: 'observationProcess.noise', labelKey: 'playground.testDesign.option.noise' },
  { path: 'train.samples', factorKind: 'observationProcess', semanticPath: 'observationProcess.sampleCount', labelKey: 'playground.testDesign.option.sampleCount' },
  { path: 'relation.slope', factorKind: 'world', semanticPath: 'world.relation', labelKey: 'playground.testDesign.option.relationSlope' },
]);
const SAMPLE_OPERATION = Object.freeze({
  id: 'observation.sample',
  factorKind: 'observationProcess',
  semanticPath: 'observationProcess.sample',
  operationType: 'RESAMPLE_WORLD',
  labelKey: 'playground.testDesign.option.sampleAgain',
});

function boundedString(value, max = MAX_TEST_DESIGN_ID_LENGTH) {
  const normalized = typeof value === 'string' ? value.trim().slice(0, max) : '';
  return normalized || null;
}

function boundedValue(value, depth = 0) {
  if (depth > 3 || value === undefined || value === null) return value === null ? null : undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return boundedString(value, MAX_TEST_DESIGN_TEXT_LENGTH);
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => boundedValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).slice(0, 16).map((key) => [
      boundedString(key, MAX_TEST_DESIGN_ID_LENGTH),
      boundedValue(value[key], depth + 1),
    ]).filter(([key]) => Boolean(key)));
  }
  return null;
}

function boundedIds(values, limit) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => boundedString(value))
    .filter(Boolean))].slice(0, limit);
}

function normalizePrediction(value) {
  if (!value || typeof value !== 'object' || !VALID_PREDICTIONS.has(value.choice)) return null;
  const text = boundedString(value.text, MAX_TEST_DESIGN_TEXT_LENGTH);
  return { choice: value.choice, ...(text ? { text } : {}) };
}

function normalizeIntervention(value) {
  if (!value || typeof value !== 'object' || !VALID_FACTORS.has(value.factorKind)) return null;
  const operationType = boundedString(value.operationType, 80);
  const controlKey = boundedString(value.controlKey, 80);
  const path = boundedString(value.path, 120);
  const semanticPath = boundedString(value.semanticPath, 160);
  if (!operationType && !controlKey && !path) return null;
  return {
    factorKind: value.factorKind,
    ...(controlKey ? { controlKey } : {}),
    ...(path ? { path } : {}),
    ...(operationType ? { operationType } : {}),
    ...(semanticPath ? { semanticPath } : {}),
    ...(value.requiresRegenerate ? { requiresRegenerate: true } : {}),
    ...(value.fromValue !== undefined ? { fromValue: boundedValue(value.fromValue) } : {}),
    ...(value.toValue !== undefined ? { toValue: boundedValue(value.toValue) } : {}),
  };
}

function normalizeStatus(value) {
  return VALID_STATUSES.has(value) ? value : TEST_DESIGN_STATUSES.DRAFT;
}

export function clearTestDesigns() {
  return Object.freeze({ version: TEST_DESIGN_VERSION, designs: Object.freeze([]) });
}

export function createTestDesign({
  id,
  hypothesisId,
  baselineExperimentId = null,
  intervention,
  heldConstantFactors = [],
  outcomeObservableIds = [],
  prediction = null,
  createdFrom = 'learner',
  status = TEST_DESIGN_STATUSES.DRAFT,
  interventionExperimentId = null,
  baselineConditionFingerprint = null,
  interventionConditionFingerprint = null,
  outcomeEvidenceIds = [],
  executionEvidenceIds = [],
} = {}) {
  const normalizedId = boundedString(id);
  const normalizedHypothesisId = boundedString(hypothesisId);
  const normalizedIntervention = normalizeIntervention(intervention);
  if (!normalizedId || !normalizedHypothesisId || !normalizedIntervention || createdFrom !== 'learner') return null;
  return Object.freeze({
    version: TEST_DESIGN_VERSION,
    id: normalizedId,
    hypothesisId: normalizedHypothesisId,
    baselineExperimentId: boundedString(baselineExperimentId),
    intervention: Object.freeze(normalizedIntervention),
    heldConstantFactors: Object.freeze(boundedIds(heldConstantFactors, MAX_TEST_DESIGN_HOLDS)),
    outcomeObservableIds: Object.freeze(boundedIds(outcomeObservableIds, MAX_TEST_DESIGN_OUTCOMES)),
    ...(normalizePrediction(prediction) ? { prediction: Object.freeze(normalizePrediction(prediction)) } : {}),
    status: normalizeStatus(status),
    createdFrom: 'learner',
    ...(boundedString(interventionExperimentId) ? { interventionExperimentId: boundedString(interventionExperimentId) } : {}),
    ...(boundedString(baselineConditionFingerprint) ? { baselineConditionFingerprint: boundedString(baselineConditionFingerprint) } : {}),
    ...(boundedString(interventionConditionFingerprint) ? { interventionConditionFingerprint: boundedString(interventionConditionFingerprint) } : {}),
    outcomeEvidenceIds: Object.freeze(boundedIds(outcomeEvidenceIds, MAX_TEST_DESIGN_OUTCOMES).filter(isEvidenceInstanceId)),
    executionEvidenceIds: Object.freeze(boundedIds(executionEvidenceIds, MAX_TEST_DESIGN_EXECUTION_EVIDENCE).filter(isEvidenceInstanceId)),
  });
}

export function normalizeTestDesign(value) {
  if (!value || typeof value !== 'object') return null;
  return createTestDesign(value);
}

export function normalizeTestDesignState(value) {
  const designs = (Array.isArray(value?.designs) ? value.designs : [])
    .map(normalizeTestDesign)
    .filter(Boolean)
    .slice(0, MAX_TEST_DESIGNS);
  return Object.freeze({ version: TEST_DESIGN_VERSION, designs: Object.freeze(designs) });
}

export function appendTestDesign(state, design) {
  const current = normalizeTestDesignState(state);
  const normalized = normalizeTestDesign(design);
  if (!normalized || current.designs.some((item) => item.id === normalized.id) || current.designs.length >= MAX_TEST_DESIGNS) return current;
  return Object.freeze({ version: TEST_DESIGN_VERSION, designs: Object.freeze([...current.designs, normalized]) });
}

export function replaceTestDesign(state, design) {
  const current = normalizeTestDesignState(state);
  const normalized = normalizeTestDesign(design);
  if (!normalized || !current.designs.some((item) => item.id === normalized.id)) return current;
  return Object.freeze({
    version: TEST_DESIGN_VERSION,
    designs: Object.freeze(current.designs.map((item) => item.id === normalized.id ? normalized : item)),
  });
}

export function getTestDesign(state, designId) {
  const id = boundedString(designId);
  return normalizeTestDesignState(state).designs.find((design) => design.id === id) ?? null;
}

function readPath(value, path) {
  return String(path ?? '').split('.').filter(Boolean).reduce((current, key) => current?.[key], value);
}

function defaultTarget(option) {
  const current = option.currentValue;
  if (option.operationType === 'RESAMPLE_WORLD') return null;
  if (option.type === 'boolean') return !Boolean(current);
  if (option.type === 'select') return option.options?.find((value) => value !== current) ?? current;
  const number = Number(current);
  if (!Number.isFinite(number)) return current;
  if (option.path === 'noise.amount') return 0.8;
  if (option.path === 'train.samples') return Math.min(option.max ?? 500, number + 40);
  if (option.path === 'relation.slope') return Number((number + 0.5).toFixed(3));
  const step = Number(option.step) || 1;
  return Math.min(option.max ?? number + step, Number((number + step * 2).toFixed(6)));
}

function generatorOption(snapshot, definition, parameter) {
  const currentValue = readPath(snapshot?.world?.generator?.spec, definition.path);
  if (currentValue === undefined || currentValue === null || !parameter) return null;
  const option = {
    id: definition.path,
    labelKey: definition.labelKey,
    factorKind: definition.factorKind,
    semanticPath: definition.semanticPath,
    operationType: 'SET_GENERATOR_PARAMETER',
    path: definition.path,
    requiresRegenerate: true,
    currentValue,
    type: parameter.type === 'integer' ? 'number' : parameter.type,
    min: parameter.min,
    max: parameter.max,
    step: parameter.type === 'integer' ? 1 : 0.01,
    options: parameter.options,
  };
  return { ...option, defaultToValue: defaultTarget(option) };
}

export function deriveTestDesignCapabilities({ snapshot, playground } = {}) {
  const options = [];
  const worldOperations = new Set((snapshot?.capabilities?.worldOperations ?? []).map((operation) => operation.type));
  const descriptors = playground?.controls ?? [];
  for (const descriptor of descriptors) {
    const canonical = canonicalExperimentalControl(descriptor, descriptor.key);
    if (!canonical || !['model', 'learning', 'evaluation'].includes(descriptor.domain)) continue;
    const currentValue = snapshot?.controls?.[descriptor.key];
    if (currentValue === undefined) continue;
    const option = {
      id: `control.${descriptor.key}`,
      labelKey: `playground.control.${descriptor.key}`,
      factorKind: canonical.comparisonFactor,
      semanticPath: `${canonical.comparisonFactor}.controls.${descriptor.key}`,
      operationType: 'SET_CONTROL',
      controlKey: descriptor.key,
      currentValue,
      type: descriptor.type,
      min: descriptor.min,
      max: descriptor.max,
      step: descriptor.step,
      options: descriptor.options,
    };
    options.push({ ...option, defaultToValue: defaultTarget(option) });
  }
  if (snapshot?.world?.generator?.spec && worldOperations.has('SET_GENERATOR_PARAMETER')) {
    const parameters = new Map(listGeneratorParameterCapabilities().map((parameter) => [parameter.path, parameter]));
    for (const definition of GENERATOR_OPTIONS) {
      const option = generatorOption(snapshot, definition, parameters.get(definition.path));
      if (option) options.push(option);
    }
  }
  if (snapshot?.world?.mode === 'generated' && worldOperations.has('RESAMPLE_WORLD')) options.push({ ...SAMPLE_OPERATION, defaultToValue: null });
  const observableEntries = [
    ...Object.entries(snapshot?.observables?.raw ?? snapshot?.observables ?? {}),
    ...Object.entries(snapshot?.observables?.derived ?? snapshot?.derivedObservables ?? {}),
  ];
  const orderedObservableEntries = [
    ...observableEntries.filter(([, value]) => value?.level === 'OUTCOME'),
    ...observableEntries.filter(([, value]) => value?.level !== 'OUTCOME'),
  ];
  const outcomes = [...new Map(orderedObservableEntries
    .filter(([, value]) => value?.available && !String(value.id ?? '').startsWith('comparison.'))
    .map(([id, value]) => [id, { id, labelKey: value.labelKey, valueType: value.valueType }])).values()]
    .slice(0, MAX_TEST_DESIGN_OUTCOMES);
  const heldOptions = [...new Set([
    ...options.map((option) => option.semanticPath),
    'world',
    'observationProcess',
    'trainTest',
    'model',
    'learning',
    'evaluation',
  ])].slice(0, MAX_TEST_DESIGN_HOLDS);
  return { version: TEST_DESIGN_VERSION, options, outcomes, heldOptions };
}

function pathMatches(path, hold) {
  return path === hold || path.startsWith(`${hold}.`) || hold === path.split('.')[0];
}

function interventionSemanticPath(intervention) {
  if (intervention?.semanticPath) return intervention.semanticPath;
  if (intervention?.operationType === 'RESAMPLE_WORLD') return 'observationProcess.sample';
  if (intervention?.factorKind) return intervention.factorKind;
  return null;
}

export function validateTestDesign(design, { capabilities = null } = {}) {
  const normalized = normalizeTestDesign(design);
  const errors = [];
  if (!normalized) return { valid: false, status: TEST_DESIGN_STATUSES.DRAFT, errors: ['invalid'] };
  if (!normalized.baselineExperimentId) errors.push('missing-baseline');
  if (!normalized.outcomeObservableIds.length) errors.push('missing-outcome');
  const option = capabilities?.options?.find((item) => (
    item.operationType === normalized.intervention.operationType
    && (item.controlKey ?? null) === (normalized.intervention.controlKey ?? null)
    && (item.path ?? null) === (normalized.intervention.path ?? null)
  ));
  if (capabilities && !option) errors.push('unsupported-intervention');
  if (normalized.intervention.operationType !== 'RESAMPLE_WORLD'
    && normalized.intervention.toValue === undefined) errors.push('missing-target');
  if (option && normalized.intervention.toValue !== undefined && option.type === 'number') {
    const number = Number(normalized.intervention.toValue);
    if (!Number.isFinite(number) || (option.min !== undefined && number < option.min) || (option.max !== undefined && number > option.max)) errors.push('target-out-of-range');
  }
  const ready = errors.length === 0;
  return { valid: ready, status: ready ? TEST_DESIGN_STATUSES.READY : TEST_DESIGN_STATUSES.DRAFT, errors, design: Object.freeze({ ...normalized, status: ready ? TEST_DESIGN_STATUSES.READY : TEST_DESIGN_STATUSES.DRAFT }) };
}

export function compileTestDesignActionPlan(design, { snapshot, capabilities } = {}) {
  const validation = validateTestDesign(design, { capabilities });
  if (!validation.valid) return { valid: false, ...validation, actions: [] };
  const normalized = validation.design;
  const activeId = snapshot?.experimentWorkspace?.activeExperimentId ?? snapshot?.experiment?.id ?? null;
  if (!activeId || activeId !== normalized.baselineExperimentId) return { valid: false, status: TEST_DESIGN_STATUSES.DRAFT, errors: ['stale-baseline'], actions: [] };
  const actions = [{ type: 'DUPLICATE_EXPERIMENT', actor: 'human' }];
  const intervention = normalized.intervention;
  if (intervention.operationType === 'SET_CONTROL') {
    actions.push({ type: 'SET_CONTROL', actor: 'human', key: intervention.controlKey, value: intervention.toValue });
  } else if (intervention.operationType === 'RESAMPLE_WORLD') {
    actions.push({ type: 'RESAMPLE_WORLD', actor: 'human' });
  } else if (intervention.operationType === 'SET_GENERATOR_PARAMETER') {
    const operations = [{ type: 'SET_GENERATOR_PARAMETER', path: intervention.path, value: intervention.toValue }];
    if (intervention.requiresRegenerate) operations.push({ type: 'REGENERATE_WORLD' });
    actions.push({
      type: 'APPLY_WORLD_TRANSACTION',
      transaction: {
        id: `test-design-${normalized.id}`,
        actor: 'human',
        intent: 'test-design-intervention',
        operations,
      },
    });
  } else {
    return { valid: false, status: TEST_DESIGN_STATUSES.DRAFT, errors: ['unsupported-operation'], actions: [] };
  }
  actions.push({ type: 'RUN', actor: 'human' });
  actions.push({ type: 'SET_COMPARE', actor: 'human', enabled: true, againstExperimentId: normalized.baselineExperimentId });
  return { valid: true, status: TEST_DESIGN_STATUSES.READY, errors: [], design: normalized, actions };
}

export function deriveTestComparison({ testDesign, comparison, outcomeEvidenceIds = [] } = {}) {
  const design = normalizeTestDesign(testDesign);
  const diff = comparison?.diff ?? comparison ?? null;
  const changedFactors = [...new Set(Array.isArray(diff?.changedFactors) ? diff.changedFactors : diff?.changed ?? [])];
  const changedPaths = [...new Set(Array.isArray(diff?.semanticChangedPaths) ? diff.semanticChangedPaths : changedFactors)];
  const canonicalFactorPaths = [...new Set(Array.isArray(diff?.semanticFactorPaths) ? diff.semanticFactorPaths : [])];
  const canonicalFactorCount = diff ? comparisonFactorCount(diff) : 0;
  const intendedPath = interventionSemanticPath(design?.intervention);
  const held = design?.heldConstantFactors ?? [];
  const heldConstantViolated = held.filter((hold) => canonicalFactorPaths.some((path) => pathMatches(path, hold)));
  const intendedChanged = intendedPath
    ? canonicalFactorPaths.some((path) => path === intendedPath || path.startsWith(`${intendedPath}.`))
    : false;
  const samplingOnly = canonicalFactorCount === 1 && canonicalFactorPaths[0] === 'observationProcess.sample';
  let comparisonClass = 'insufficient';
  if (diff && canonicalFactorCount > 0) {
    if (samplingOnly) comparisonClass = 'observational';
    else if (intendedChanged && canonicalFactorCount === 1 && heldConstantViolated.length === 0) comparisonClass = 'single-factor';
    else if (canonicalFactorCount > 1 || heldConstantViolated.length > 0) comparisonClass = 'confounded';
  }
  return {
    version: TEST_DESIGN_VERSION,
    testDesignId: design?.id ?? null,
    comparisonClass,
    intendedFactor: design?.intervention?.factorKind ?? null,
    intendedPath,
    changedFactors,
    changedPaths,
    canonicalFactorPaths,
    canonicalFactorCount,
    heldConstantSatisfied: Boolean(diff && heldConstantViolated.length === 0),
    heldConstantViolated,
    outcomeEvidenceIds: [...new Set((Array.isArray(outcomeEvidenceIds) ? outcomeEvidenceIds : []).filter(isEvidenceInstanceId))].slice(0, MAX_TEST_DESIGN_OUTCOMES),
  };
}

export function scopeTestDesignEvidence({ evidenceInstances = [], beforeSequence = 0, outcomeObservableIds = [] } = {}) {
  const outcomeIds = new Set((Array.isArray(outcomeObservableIds) ? outcomeObservableIds : []).filter((id) => typeof id === 'string'));
  const executionEvidenceIds = [...new Set((Array.isArray(evidenceInstances) ? evidenceInstances : [])
    .filter((instance) => isEvidenceInstanceId(instance?.id) && Number(instance?.semanticSequence) > Number(beforeSequence))
    .map((instance) => instance.id))].slice(0, MAX_TEST_DESIGN_EXECUTION_EVIDENCE);
  const outcomeEvidenceIds = [...new Set((Array.isArray(evidenceInstances) ? evidenceInstances : [])
    .filter((instance) => executionEvidenceIds.includes(instance?.id))
    .filter((instance) => Array.isArray(instance?.evidenceRefs) && instance.evidenceRefs.some((ref) => outcomeIds.has(ref)))
    .map((instance) => instance.id))].slice(0, MAX_TEST_DESIGN_OUTCOMES);
  return { executionEvidenceIds, outcomeEvidenceIds };
}

function resultObservableValue(result, id) {
  if (!result || typeof id !== 'string') return null;
  if (id === 'outcome.trainMse') return result.metrics?.trainMse ?? result.metrics?.mse ?? null;
  if (id === 'outcome.testMse') return result.metrics?.testMse ?? null;
  if (id === 'outcome.trainAccuracy') return result.metrics?.trainAccuracy ?? result.metrics?.accuracy ?? null;
  if (id === 'outcome.testAccuracy') return result.metrics?.testAccuracy ?? result.metrics?.runtimeAccuracy ?? null;
  if (id === 'model.slope') return result.model?.weight ?? null;
  if (id === 'model.bias') return result.model?.bias ?? null;
  if (id === 'model.hiddenUnits') return result.model?.hiddenUnits ?? null;
  if (id === 'learning.currentStep') return result.model?.trainingStep ?? null;
  return null;
}

export function deriveTestOutcomeView({ testDesign, results } = {}) {
  const design = normalizeTestDesign(testDesign);
  if (!design) return [];
  return design.outcomeObservableIds.map((id) => ({
    id,
    before: resultObservableValue(results?.against, id),
    after: resultObservableValue(results?.active, id),
  }));
}

export function testDesignSemanticEdges({ design, comparison, outcomeEvidenceIds = [] } = {}) {
  const normalized = normalizeTestDesign(design);
  if (!normalized) return [];
  const edges = [];
  if (normalized.hypothesisId) edges.push({ from: normalized.hypothesisId, to: normalized.id, relation: 'test_design' });
  if (normalized.baselineExperimentId) edges.push({ from: normalized.id, to: normalized.baselineExperimentId, relation: 'baseline' });
  if (normalized.interventionExperimentId) edges.push({ from: normalized.id, to: normalized.interventionExperimentId, relation: 'intervention' });
  for (const evidenceId of (comparison?.outcomeEvidenceIds ?? outcomeEvidenceIds).filter(isEvidenceInstanceId)) {
    edges.push({ from: normalized.id, to: evidenceId, relation: 'observed_with' });
  }
  return edges.slice(0, 16);
}
