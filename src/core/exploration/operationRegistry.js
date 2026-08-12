// `preserves` names semantic configuration domains only. They do not promise
// that derived fitted parameters, metrics, or results remain numerically
// unchanged after the World is edited.
const PUBLIC_WORLD_OPERATIONS = [
  {
    type: 'ADD_POINTS',
    domain: 'world-state',
    category: 'create-observations',
    changes: ['observations', 'observation-values'],
    preserves: ['model-configuration', 'learning-configuration', 'evaluation-configuration'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
  },
  {
    type: 'MOVE_POINT',
    domain: 'world-state',
    category: 'edit-observation',
    changes: ['observation-values'],
    preserves: ['membership', 'model-configuration', 'learning-configuration', 'evaluation-configuration'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
  },
  {
    type: 'REMOVE_POINT',
    domain: 'world-state',
    category: 'remove-observations',
    changes: ['observations'],
    preserves: ['model-configuration', 'learning-configuration', 'evaluation-configuration'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
  },
  {
    type: 'REMOVE_POINTS',
    domain: 'world-state',
    category: 'remove-observations',
    changes: ['observations'],
    preserves: ['model-configuration', 'learning-configuration', 'evaluation-configuration'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
  },
  {
    type: 'SET_FEATURE_VALUES',
    domain: 'world-state',
    category: 'edit-feature-values',
    changes: ['feature-values'],
    preserves: ['other-feature-values', 'membership', 'model-configuration', 'learning-configuration', 'evaluation-configuration'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
  },
  {
    type: 'TRANSFORM_FEATURE_VALUES',
    domain: 'world-state',
    category: 'transform-feature-values',
    changes: ['feature-values', 'intervention'],
    preserves: ['other-feature-values', 'membership', 'model-configuration', 'learning-configuration', 'evaluation-configuration'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
  },
  {
    type: 'SET_TRAIN_TEST_MEMBERSHIP',
    domain: 'world-state',
    category: 'assign-membership',
    changes: ['membership'],
    preserves: ['observation-values', 'model-configuration', 'learning-configuration', 'evaluation-configuration'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
  },
];

const byType = new Map(PUBLIC_WORLD_OPERATIONS.map((operation) => [operation.type, operation]));

const copy = (value) => structuredClone(value);

export function listWorldOperations() {
  return PUBLIC_WORLD_OPERATIONS.map(copy);
}

export function getWorldOperation(type) {
  const operation = byType.get(type);
  return operation ? copy(operation) : null;
}

export function isPublicWorldOperation(type) {
  return byType.has(type);
}
