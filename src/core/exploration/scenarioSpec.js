import { MAX_WORLD_TRANSACTION_OPERATIONS } from './operations.js';

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

function operationMetadata(context, type) {
  return (context?.exploration?.worldOperations ?? context?.worldOperations ?? [])
    .find((operation) => operation.type === type && operation.agentDiscoverable !== false) ?? null;
}

function validateControlValue(schema, value) {
  if (!schema) throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_CONTROL', { key: null });
  if (schema.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)
      || (schema.min !== undefined && number < schema.min)
      || (schema.max !== undefined && number > schema.max)) {
      throw scenarioError('EXPLORATION_SCENARIO_CONTROL_OUT_OF_RANGE', { key: schema.key, value, min: schema.min, max: schema.max });
    }
    return number;
  }
  if (schema.type === 'boolean') return Boolean(value);
  if (schema.options && !schema.options.includes(value)) {
    throw scenarioError('EXPLORATION_SCENARIO_CONTROL_OUT_OF_RANGE', { key: schema.key, value, options: schema.options });
  }
  return value;
}

function validateWorldParameters(change, context) {
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
    const allowedPaths = metadata.parameterSchema?.allowedPaths ?? [];
    if (!allowedPaths.includes(parameters.path) || !Number.isFinite(Number(parameters.value))) {
      throw scenarioError('EXPLORATION_SCENARIO_INVALID_PARAMETER', { operation: change.operation, path: parameters.path });
    }
    if (!context?.world?.generator?.spec) {
      throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION', { operation: change.operation, reason: 'generator-required' });
    }
    if (parameters.path.endsWith('.samples') || parameters.path === 'outliers.count') {
      const value = Number(parameters.value);
      if (!Number.isInteger(value) || value < 0 || value > 500) {
        throw scenarioError('EXPLORATION_SCENARIO_RESOURCE_LIMIT', { field: parameters.path, min: 0, max: 500, value });
      }
    }
    if (parameters.path === 'noise.amount' && Number(parameters.value) < 0) {
      throw scenarioError('EXPLORATION_SCENARIO_INVALID_PARAMETER', { operation: change.operation, path: parameters.path, reason: 'noise cannot be negative' });
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
  const fidelity = spec.fidelity ?? { status: 'exact', represented: [], missing: [], approximations: [] };
  if (!SCENARIO_FIDELITY_STATUSES.includes(fidelity.status)) throw scenarioError('EXPLORATION_SCENARIO_INVALID', { field: 'fidelity.status' });
  const execution = { duplicateBaseline: true, run: true, compare: true, repeat: null, ...(spec.execution ?? {}) };
  if (execution.repeat !== null && (!Number.isInteger(Number(execution.repeat)) || Number(execution.repeat) < 2 || Number(execution.repeat) > 20)) {
    throw scenarioError('EXPLORATION_SCENARIO_RESOURCE_LIMIT', { field: 'execution.repeat', min: 2, max: 20 });
  }
  return {
    version: SCENARIO_SPEC_VERSION,
    request: spec.request,
    interpretation: {
      summary: String(spec.interpretation?.summary ?? ''),
      ambiguity: spec.interpretation?.ambiguity ?? null,
    },
    baseline: { experimentId: spec.baseline.experimentId, conditionFingerprint: spec.baseline.conditionFingerprint },
    change: changes,
    hold,
    observe,
    execution,
    fidelity: {
      status: fidelity.status,
      represented: stringArray(fidelity.represented ?? [], 'fidelity.represented'),
      missing: stringArray(fidelity.missing ?? [], 'fidelity.missing'),
      approximations: stringArray(fidelity.approximations ?? [], 'fidelity.approximations'),
    },
  };
}

export function scenarioObservableIds(context = {}) {
  return [...new Set([...Object.keys(context.observables ?? {}), ...Object.keys(context.derivedObservables ?? {})])];
}
