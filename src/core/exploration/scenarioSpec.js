import { MAX_WORLD_TRANSACTION_OPERATIONS } from './operations.js';
import { listGeneratorParameterCapabilities } from './operationRegistry.js';
import { validateCanonicalControlValue } from '../playground/controlValidation.js';
import { WORLD_RECIPE_SEMANTIC_DOMAINS, applyWorldRecipePatch, normalizeWorldRecipe, worldRecipePatchChangedPaths } from './worldRecipe.js';
import { validateExplorationDesign } from './pedagogicalExperiment.js';

export const SCENARIO_SPEC_VERSION = 1;
export const SCENARIO_FIDELITY_STATUSES = ['exact', 'partial', 'approximate'];

export function scenarioError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

const clone = (value) => structuredClone(value);

function stringArray(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item)) {
    throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field });
  }
  return [...value];
}

function worldRecipeDomainArray(value, field) {
  const domains = stringArray(value, field);
  const allowed = new Set(['whole-recipe', ...WORLD_RECIPE_SEMANTIC_DOMAINS]);
  if (domains.some((domain) => !allowed.has(domain))) throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field, value: domains });
  return domains;
}

function operationMetadata(context, type) {
  return (context?.exploration?.worldOperations ?? context?.worldOperations ?? [])
    .find((operation) => operation.type === type && operation.agentDiscoverable !== false) ?? null;
}

function validateControlValue(schema, value) {
  if (!schema) throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_CONTROL', { key: null });
  try {
    return validateCanonicalControlValue(schema, value);
  } catch {
    throw scenarioError('EXPLORATION_SCENARIO_CONTROL_OUT_OF_RANGE', {
      key: schema.key,
      value,
      min: schema.min,
      max: schema.max,
      step: schema.step,
      options: schema.options,
    });
  }
}

function generatorParameterCapability(path, context) {
  const registered = (context?.exploration?.worldOperations ?? [])
    .find((operation) => operation.type === 'SET_GENERATOR_PARAMETER')
    ?.parameterSchema?.parameters;
  return (registered ?? listGeneratorParameterCapabilities()).find((item) => item.path === path) ?? null;
}

function validateTypedGeneratorParameter(capability, value, path) {
  if (!capability) throw scenarioError('EXPLORATION_SCENARIO_INVALID_PARAMETER', { path, reason: 'capability-unavailable' });
  if (capability.type === 'enum') {
    if (!capability.options?.includes(value)) {
      throw scenarioError('EXPLORATION_SCENARIO_INVALID_PARAMETER', { path, value, options: capability.options });
    }
    return value;
  }
  const number = Number(value);
  if (!Number.isFinite(number)
    || (capability.type === 'integer' && !Number.isInteger(number))
    || (capability.min !== undefined && number < capability.min)
    || (capability.max !== undefined && number > capability.max)) {
    throw scenarioError('EXPLORATION_SCENARIO_INVALID_PARAMETER', { path, value, min: capability.min, max: capability.max, type: capability.type });
  }
  return number;
}

function validateWorldParameters(change, context) {
  if (change.operation === 'UNDO_WORLD_ACTION') {
    if (!(context?.exploration?.transactionActions ?? []).includes(change.operation)) {
      throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { operation: change.operation });
    }
    const parameters = change.parameters ?? {};
    const actionId = String(parameters.actionId ?? '');
    const action = (context?.recentWorldActions ?? []).find((item) => item.id === actionId);
    if (!action?.reversible) throw scenarioError('EXPLORATION_SCENARIO_POINT_NOT_FOUND', { actionId });
    return { actionId };
  }
  const metadata = operationMetadata(context, change.operation);
  if (!metadata) throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { operation: change.operation });
  const parameters = change.parameters ?? {};
  if (change.operation === 'ADD_POINTS') {
    if (!Array.isArray(parameters.points) || !parameters.points.length) {
      throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'change.parameters.points' });
    }
    const currentCount = Number(context?.world?.observations?.length ?? 0);
    const max = Number(context?.resourceLimits?.maxWorldObservations ?? Infinity);
    if (currentCount + parameters.points.length > max) {
      throw scenarioError('EXPLORATION_SCENARIO_RESOURCE_LIMIT', { field: 'observations', max, requested: currentCount + parameters.points.length });
    }
    for (const point of parameters.points) {
      if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
        throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'change.parameters.points' });
      }
    }
  }
  if (change.operation === 'MOVE_POINT') {
    if (!parameters.pointId || !Number.isFinite(Number(parameters.x)) || !Number.isFinite(Number(parameters.y))) {
      throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'change.parameters' });
    }
    if (!context?.world?.observations?.some((point) => String(point.id) === String(parameters.pointId))) {
      throw scenarioError('EXPLORATION_SCENARIO_POINT_NOT_FOUND', { pointId: parameters.pointId });
    }
  }
  if (change.operation === 'SET_TRAIN_TEST_MEMBERSHIP') {
    if (!Array.isArray(parameters.pointIds) || !parameters.pointIds.length || !['train', 'test'].includes(parameters.membership)
      || parameters.pointIds.some((id) => !context?.world?.observations?.some((point) => String(point.id) === String(id)))) {
      throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'change.parameters' });
    }
  }
  if (change.operation === 'SET_FEATURE_VALUES') {
    if (!context?.world?.featureNames?.includes(parameters.feature)
      || !Array.isArray(parameters.values)
      || !parameters.values.length
      || parameters.values.some((entry) => !entry?.pointId
        || !Number.isFinite(Number(entry.value))
        || !context?.world?.observations?.some((point) => String(point.id) === String(entry.pointId)))) {
      throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'change.parameters' });
    }
  }
  if (change.operation === 'TRANSFORM_FEATURE_VALUES') {
    if (!context?.world?.featureNames?.includes(parameters.feature)
      || !['shift', 'scale', 'noise'].includes(parameters.kind)
      || !Number.isFinite(Number(parameters.amount))
      || !Array.isArray(parameters.pointIds)
      || !parameters.pointIds.length) {
      throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'change.parameters' });
    }
  }
  if (change.operation === 'SET_GENERATOR_PARAMETER') {
    const capability = generatorParameterCapability(parameters.path, context);
    const value = validateTypedGeneratorParameter(capability, parameters.value, parameters.path);
    if (!context?.world?.generator?.spec) {
      throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { operation: change.operation, reason: 'generator-required' });
    }
    return { ...clone(parameters), value };
  }
  if (change.operation === 'SET_WORLD_RECIPE') {
    if (!parameters.recipe || context?.world?.generator?.kind === 'world-recipe' && parameters.recipe.version === undefined) {
      throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'change.parameters.recipe' });
    }
    try {
      const recipe = normalizeWorldRecipe(parameters.recipe);
      const seed = parameters.seed === undefined ? context?.world?.randomness?.seed ?? 42 : Number(parameters.seed);
      if (!Number.isFinite(seed)) throw new Error('seed');
      return { ...clone(parameters), recipe, seed: Math.trunc(seed) };
    } catch (error) {
      if (error.code === 'EXPLORATION_RESOURCE_LIMIT') throw scenarioError('EXPLORATION_SCENARIO_RESOURCE_LIMIT', error.details);
      throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'change.parameters.recipe', reason: error.code ?? 'invalid-recipe' });
    }
  }
  if (change.operation === 'PATCH_WORLD_RECIPE') {
    if (context?.world?.generator?.kind !== 'world-recipe' || !parameters.patch) {
      throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { operation: change.operation, reason: 'recipe-required' });
    }
    try {
      applyWorldRecipePatch(context.world.generator.recipe, parameters.patch);
      return { ...clone(parameters), patch: clone(parameters.patch) };
    } catch (error) {
      if (error.code === 'EXPLORATION_RESOURCE_LIMIT') throw scenarioError('EXPLORATION_SCENARIO_RESOURCE_LIMIT', error.details);
      throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'change.parameters.patch', reason: error.code ?? 'invalid-recipe-patch' });
    }
  }
  return clone(parameters);
}

function validateChange(change, context) {
  if (!change || typeof change !== 'object' || typeof change.operation !== 'string') {
    throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'change' });
  }
  if (change.operation === 'SET_CONTROL') {
    const schema = (context?.controlSchemas ?? []).find((item) => item.key === change.parameters?.key);
    if (!schema || schema.domain === 'view') throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_CONTROL', { key: change.parameters?.key });
    return {
      semanticTarget: change.semanticTarget ?? `${schema.domain ?? 'model'}-configuration`,
      operation: change.operation,
      parameters: { ...clone(change.parameters ?? {}), value: validateControlValue(schema, change.parameters?.value) },
    };
  }
  if (['DUPLICATE_EXPERIMENT', 'SWITCH_EXPERIMENT', 'SET_COMPARE', 'COMPARE_EXPERIMENTS', 'REPEAT_EXPERIMENT'].includes(change.operation)) {
    if (!(context?.exploration?.experimentOperations ?? context?.experimentOperations ?? []).includes(change.operation)) {
      throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { operation: change.operation });
    }
    return { semanticTarget: change.semanticTarget ?? 'experiment', operation: change.operation, parameters: clone(change.parameters ?? {}) };
  }
  const parameters = validateWorldParameters(change, context);
  return { semanticTarget: String(change.semanticTarget ?? change.operation), operation: change.operation, parameters };
}

export function validateScenarioSpec(spec, context = {}) {
  if (!spec || typeof spec !== 'object' || spec.version !== SCENARIO_SPEC_VERSION) {
    throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'version' });
  }
  if (typeof spec.request !== 'string' || !spec.request.trim()) {
    throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'request' });
  }
  if (!spec.baseline || typeof spec.baseline.experimentId !== 'string' || typeof spec.baseline.conditionFingerprint !== 'string') {
    throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'baseline' });
  }
  const changes = Array.isArray(spec.change) ? spec.change.map((change) => validateChange(change, context)) : [];
  const intendedFactors = spec.intendedFactors === undefined
    ? null
    : stringArray(spec.intendedFactors, 'intendedFactors');
  const intendedWorldRecipeDomains = spec.intendedWorldRecipeDomains === undefined
    ? null
    : worldRecipeDomainArray(spec.intendedWorldRecipeDomains, 'intendedWorldRecipeDomains');
  const intendedWorldRecipePaths = spec.intendedWorldRecipePaths === undefined
    ? null
    : stringArray(spec.intendedWorldRecipePaths, 'intendedWorldRecipePaths');
  const recipeChange = changes.find((change) => change.operation === 'PATCH_WORLD_RECIPE' || change.operation === 'SET_WORLD_RECIPE');
  let canonicalWorldRecipePaths = null;
  if (recipeChange?.operation === 'PATCH_WORLD_RECIPE') {
    canonicalWorldRecipePaths = worldRecipePatchChangedPaths(
      context.world.generator.recipe,
      recipeChange.parameters.patch,
    );
  } else if (recipeChange?.operation === 'SET_WORLD_RECIPE') {
    canonicalWorldRecipePaths = ['whole-recipe'];
  }
  if (canonicalWorldRecipePaths) {
    if (intendedWorldRecipePaths && JSON.stringify(intendedWorldRecipePaths) !== JSON.stringify(canonicalWorldRecipePaths)) {
      throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'intendedWorldRecipePaths', reason: 'must-match-canonical-recipe-diff' });
    }
  } else if (intendedWorldRecipePaths) {
    throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'intendedWorldRecipePaths', reason: 'recipe-operation-required' });
  }
  const heldWorldRecipeDomains = spec.heldWorldRecipeDomains === undefined
    ? null
    : worldRecipeDomainArray(spec.heldWorldRecipeDomains, 'heldWorldRecipeDomains');
  const operationCount = changes.reduce((count, change) => count + (Array.isArray(change.parameters?.operations) ? change.parameters.operations.length : 1), 0);
  const maxOperations = Number(context?.resourceLimits?.maxWorldTransactionOperations ?? MAX_WORLD_TRANSACTION_OPERATIONS);
  if (operationCount > maxOperations) throw scenarioError('EXPLORATION_SCENARIO_RESOURCE_LIMIT', { field: 'operations', max: maxOperations, requested: operationCount });
  const hold = stringArray(spec.hold ?? [], 'hold');
  const observe = stringArray(spec.observe ?? [], 'observe');
  const observableIds = new Set([
    ...Object.keys(context?.observables ?? {}),
    ...Object.keys(context?.derivedObservables ?? {}),
  ]);
  for (const id of observe) {
    if (!observableIds.has(id)) throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OBSERVABLE', { id });
  }
  const execution = { duplicateBaseline: true, run: true, compare: true, repeat: null, ...(spec.execution ?? {}) };
  if (execution.compareAgainstExperimentId !== undefined) {
    const targetId = String(execution.compareAgainstExperimentId ?? '');
    const known = (context?.experimentWorkspace?.experiments ?? []).some((entry) => String(entry.id) === targetId);
    if (!targetId || !known) throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'execution.compareAgainstExperimentId' });
    execution.compareAgainstExperimentId = targetId;
  }
  if (execution.repeat !== null && (!Number.isInteger(Number(execution.repeat)) || Number(execution.repeat) < 2 || Number(execution.repeat) > 20)) {
    throw scenarioError('EXPLORATION_SCENARIO_RESOURCE_LIMIT', { field: 'execution.repeat', min: 2, max: 20 });
  }
  const pedagogicalDesign = spec.pedagogicalDesign === undefined
    ? null
    : validateExplorationDesign(spec.pedagogicalDesign, { context });
  return {
    version: SCENARIO_SPEC_VERSION,
    request: spec.request,
    interpretation: {
      summary: String(spec.interpretation?.summary ?? ''),
      ambiguity: spec.interpretation?.ambiguity ?? null,
    },
    baseline: { experimentId: spec.baseline.experimentId, conditionFingerprint: spec.baseline.conditionFingerprint },
    change: changes,
    ...(intendedFactors ? { intendedFactors } : {}),
    ...(intendedWorldRecipeDomains ? { intendedWorldRecipeDomains } : {}),
    ...(canonicalWorldRecipePaths ? { intendedWorldRecipePaths: canonicalWorldRecipePaths } : intendedWorldRecipePaths ? { intendedWorldRecipePaths } : {}),
    ...(heldWorldRecipeDomains ? { heldWorldRecipeDomains } : {}),
    ...(pedagogicalDesign ? { pedagogicalDesign } : {}),
    hold,
    observe,
    execution,
    ...(spec.approximation ? { approximation: String(spec.approximation) } : {}),
  };
}

export function scenarioObservableIds(context = {}) {
  return [...new Set([...Object.keys(context.observables ?? {}), ...Object.keys(context.derivedObservables ?? {})])];
}
