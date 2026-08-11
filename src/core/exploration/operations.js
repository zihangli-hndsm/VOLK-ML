// Pure domain operations. UI gestures, Agent requests, and future workspace
// tools can all map to these same operations without knowing React or models.

import { cloneWorld, createWorld, explorationError, worldFromPlaygroundSource } from './world.js';
import { validateExperiment } from './experiment.js';

const clone = (value) => structuredClone(value);

function mutation(type, details = {}) {
  return { type, details: clone(details) };
}

function worldWithObservations(world, observations, details) {
  return {
    world: createWorld({
      ...world,
      observations,
      source: world.source,
      seed: world.randomness?.seed ?? null,
    }),
    mutation: mutation(details.type, details),
  };
}

export function addPoints(world, points, { provenance = 'manual' } = {}) {
  if (!Array.isArray(points) || !points.length) throw explorationError('EXPLORATION_INVALID_OPERATION', { type: 'ADD_POINTS' });
  const next = points.map((point) => ({ ...point, provenance: point.provenance ?? provenance }));
  return worldWithObservations(world, [...world.observations, ...next], { type: 'world.addPoints', count: next.length });
}

export function movePoint(world, pointId, { x, y }) {
  const observations = world.observations.map((point) => point.id === String(pointId) ? { ...point, x, y } : point);
  if (observations.every((point, index) => point === world.observations[index])) {
    throw explorationError('EXPLORATION_POINT_NOT_FOUND', { pointId });
  }
  return worldWithObservations(world, observations, { type: 'world.movePoint', pointId: String(pointId) });
}

export function removePoint(world, pointId) {
  const observations = world.observations.filter((point) => point.id !== String(pointId));
  if (observations.length === world.observations.length) throw explorationError('EXPLORATION_POINT_NOT_FOUND', { pointId });
  return worldWithObservations(world, observations, { type: 'world.removePoint', pointId: String(pointId) });
}

export function setTrainTestMembership(world, pointIds, membership) {
  const ids = new Set((Array.isArray(pointIds) ? pointIds : [pointIds]).map(String));
  const observations = world.observations.map((point) => ids.has(point.id) ? { ...point, membership } : point);
  return worldWithObservations(world, observations, {
    type: 'world.setTrainTestMembership',
    pointIds: [...ids],
    membership,
  });
}

export function applyWorldOperation(world, operation) {
  const current = cloneWorld(world);
  switch (operation?.type) {
    case 'ADD_POINTS': return addPoints(current, operation.points, operation);
    case 'MOVE_POINT': return movePoint(current, operation.pointId, operation);
    case 'REMOVE_POINT': return removePoint(current, operation.pointId);
    case 'SET_TRAIN_TEST_MEMBERSHIP': return setTrainTestMembership(current, operation.pointIds, operation.membership);
    default: throw explorationError('EXPLORATION_INVALID_OPERATION', { type: operation?.type });
  }
}

function partitionControls(controls, descriptors = []) {
  const sections = { model: {}, learning: {}, evaluation: {} };
  for (const [key, value] of Object.entries(controls ?? {})) {
    const descriptor = descriptors.find((item) => item.key === key);
    const section = descriptor?.domain === 'learning'
      ? 'learning'
      : descriptor?.domain === 'evaluation'
        ? 'evaluation'
        : descriptor?.domain === 'view'
          ? null
          : 'model';
    if (section) sections[section][key] = clone(value);
  }
  return sections;
}

function runtimeMutation(action, descriptors = []) {
  if (!action?.type) return null;
  if (action.type === 'SET_CONTROL') {
    const descriptor = descriptors.find((item) => item.key === action.key);
    return mutation('configuration.setControl', {
      key: action.key,
      domain: descriptor?.domain ?? 'model',
    });
  }
  const types = {
    ADD_POINT: 'world.addPoints',
    ADD_TRAINING_POINT: 'world.addPoints',
    MOVE_POINT: 'world.movePoint',
    MOVE_TRAINING_POINT: 'world.movePoint',
    REMOVE_POINT: 'world.removePoint',
    REMOVE_TRAINING_POINT: 'world.removePoint',
    SET_TRAIN_TEST_MEMBERSHIP: 'world.setTrainTestMembership',
    SET_PARAMETERS: 'model.setParameters',
    SET_BEST_FIT: 'model.setBestFit',
    START_TRAINING: 'learning.start',
    START_NEIGHBOR_REVEAL: 'learning.start',
  };
  const type = types[action.type];
  return type ? mutation(type, { action: action.type, pointId: action.pointId ?? null }) : null;
}

export function synchronizeExperiment(experiment, {
  source,
  points,
  controls,
  controlDescriptors,
  adapterId,
  seed,
  action,
  traces,
} = {}) {
  const current = validateExperiment(experiment);
  const runtimePoints = points?.map((point) => {
    const previous = current.world.observations.find((observation) => observation.id === String(point.id));
    return {
      ...point,
      ...(point.membership === undefined && previous?.membership ? { membership: previous.membership } : {}),
      ...(point.provenance === undefined ? { provenance: previous?.provenance ?? 'manual' } : {}),
    };
  });
  const runtimeSource = runtimePoints ? { ...source, points: clone(runtimePoints) } : source;
  const world = runtimeSource ? worldFromPlaygroundSource(runtimeSource, { id: current.world.id, seed }) : current.world;
  const sections = partitionControls(controls, controlDescriptors);
  const nextMutation = runtimeMutation(action, controlDescriptors);
  return validateExperiment({
    ...current,
    world,
    model: { adapterId: adapterId ?? current.model.adapterId, controls: sections.model },
    learning: { controls: sections.learning },
    evaluation: { controls: sections.evaluation },
    randomness: { seed: seed ?? null, policy: seed === null || seed === undefined ? 'unspecified' : 'fixed-seed' },
    ...(traces ? { traces: clone(traces) } : {}),
    mutations: nextMutation ? [...current.mutations, nextMutation] : current.mutations,
  });
}

export function applyExperimentOperation(experiment, operation) {
  const current = validateExperiment(experiment);
  if (operation?.type === 'SYNC_RUNTIME') {
    return synchronizeExperiment(current, operation);
  }
  if (['ADD_POINTS', 'MOVE_POINT', 'REMOVE_POINT', 'SET_TRAIN_TEST_MEMBERSHIP'].includes(operation?.type)) {
    const result = applyWorldOperation(current.world, operation);
    return validateExperiment({
      ...current,
      world: result.world,
      result: null,
      mutations: [...current.mutations, result.mutation],
    });
  }
  throw explorationError('EXPLORATION_INVALID_OPERATION', { type: operation?.type });
}
