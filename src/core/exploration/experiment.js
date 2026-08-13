// Phase 0 learner-facing Experiment snapshot. This remains separate from
// visualization script captures: an Experiment is the semantic bundle a
// future Workspace/Experiment Bar can duplicate, compare, and restore.

import { cloneWorld, validateWorld, explorationError } from './world.js';

export const EXPERIMENT_VERSION = 1;

const clone = (value) => structuredClone(value);

function configuration(value) {
  if (value === undefined || value === null) return { controls: {} };
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw explorationError('EXPLORATION_INVALID_EXPERIMENT', { field: 'configuration' });
  }
  return clone(value);
}

export function createExperiment({
  id = 'experiment-1',
  world,
  adapterId,
  model = {},
  learning = {},
  evaluation = {},
  seed = null,
  result = null,
  traces = [],
  lineage = {},
  mutations = [],
} = {}) {
  const validatedWorld = validateWorld(world);
  const effectiveSeed = validatedWorld.randomness?.seed ?? seed ?? null;
  if (adapterId !== null && adapterId !== undefined && (typeof adapterId !== 'string' || !adapterId)) {
    throw explorationError('EXPLORATION_INVALID_EXPERIMENT', { field: 'adapterId' });
  }
  return validateExperiment({
    version: EXPERIMENT_VERSION,
    id: String(id),
    world: validatedWorld,
    model: { adapterId: adapterId ?? null, ...configuration(model) },
    learning: configuration(learning),
    evaluation: configuration(evaluation),
    randomness: { seed: effectiveSeed, policy: effectiveSeed === null || effectiveSeed === undefined ? 'unspecified' : 'fixed-seed' },
    result: result === null ? null : clone(result),
    traces: clone(traces),
    lineage: {
      parentId: lineage.parentId ?? null,
      sourceId: lineage.sourceId ?? null,
      baselineId: lineage.baselineId ?? null,
    },
    mutations: clone(mutations),
  });
}

export function validateExperiment(experiment) {
  if (!experiment || typeof experiment !== 'object' || Array.isArray(experiment)) {
    throw explorationError('EXPLORATION_INVALID_EXPERIMENT');
  }
  if (experiment.version !== EXPERIMENT_VERSION || typeof experiment.id !== 'string' || !experiment.id) {
    throw explorationError('EXPLORATION_INVALID_EXPERIMENT', { field: 'version/id' });
  }
  validateWorld(experiment.world);
  if (!experiment.model || (experiment.model.adapterId !== null
    && (typeof experiment.model.adapterId !== 'string' || !experiment.model.adapterId))) {
    throw explorationError('EXPLORATION_INVALID_EXPERIMENT', { field: 'model.adapterId' });
  }
  if (!experiment.randomness || !('seed' in experiment.randomness)) {
    throw explorationError('EXPLORATION_INVALID_EXPERIMENT', { field: 'randomness' });
  }
  const worldSeed = experiment.world.randomness?.seed;
  if (worldSeed !== null && worldSeed !== undefined && experiment.randomness.seed !== worldSeed) {
    throw explorationError('EXPLORATION_INVALID_EXPERIMENT', { field: 'randomness.seed', reason: 'must agree with World seed' });
  }
  return clone(experiment);
}

export const cloneExperiment = (experiment) => validateExperiment(experiment);

export function duplicateExperiment(experiment, { id = `${experiment.id}-copy`, parentId = experiment.id } = {}) {
  const source = validateExperiment(experiment);
  return validateExperiment({
    ...source,
    id: String(id),
    world: cloneWorld(source.world),
    lineage: {
      ...source.lineage,
      parentId: parentId ?? null,
      sourceId: source.id,
      baselineId: source.lineage.baselineId ?? source.id,
    },
    mutations: clone(source.mutations),
  });
}

export function restoreExperiment(experiment, { id = experiment.id } = {}) {
  const restored = validateExperiment(experiment);
  return validateExperiment({ ...restored, id: String(id), world: cloneWorld(restored.world) });
}

export function serializeExperiment(experiment) {
  return JSON.stringify(validateExperiment(experiment));
}

export function deserializeExperiment(serialized) {
  try {
    return validateExperiment(JSON.parse(serialized));
  } catch (error) {
    if (error.code === 'EXPLORATION_INVALID_EXPERIMENT') throw error;
    throw explorationError('EXPLORATION_INVALID_EXPERIMENT', { reason: 'invalid-json' });
  }
}
