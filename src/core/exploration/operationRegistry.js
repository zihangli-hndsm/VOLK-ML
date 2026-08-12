const PUBLIC_WORLD_OPERATIONS = [
  {
    type: 'ADD_POINTS',
    domain: 'world-state',
    category: 'create-observations',
    changes: ['observations', 'observation-values'],
    preserves: ['model', 'learning', 'evaluation'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
  },
  {
    type: 'MOVE_POINT',
    domain: 'world-state',
    category: 'edit-observation',
    changes: ['observation-values'],
    preserves: ['membership', 'model', 'learning', 'evaluation'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
  },
  {
    type: 'REMOVE_POINT',
    domain: 'world-state',
    category: 'remove-observations',
    changes: ['observations'],
    preserves: ['model', 'learning', 'evaluation'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
  },
  {
    type: 'REMOVE_POINTS',
    domain: 'world-state',
    category: 'remove-observations',
    changes: ['observations'],
    preserves: ['model', 'learning', 'evaluation'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
  },
  {
    type: 'SET_TRAIN_TEST_MEMBERSHIP',
    domain: 'world-state',
    category: 'assign-membership',
    changes: ['membership'],
    preserves: ['observation-values', 'model', 'learning', 'evaluation'],
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
