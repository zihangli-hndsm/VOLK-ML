// Presentation capability contract for the L0 Phenomenon surface.
// This helper only describes whether an existing runtime snapshot can be
// shown as one editable World + model-response surface. It never owns or
// derives semantic model state.

const EDITABLE_WORLD_OPERATIONS = new Set([
  'ADD_POINTS',
  'MOVE_POINT',
  'REMOVE_POINT',
  'REMOVE_POINTS',
  'SET_TRAIN_TEST_MEMBERSHIP',
]);

const RESPONSE_PRIMITIVES = new Set([
  'regression-line',
  'decision-region',
  'neighbor-links',
  'query-point',
  'vote-bars',
]);

export function derivePhenomenonCapabilities(snapshot) {
  const world = snapshot?.world;
  const operations = new Set((snapshot?.capabilities?.worldOperations ?? []).map((operation) => operation.type));
  const twoDimensional = Array.isArray(world?.featureNames)
    && world.featureNames.length === 2
    && Array.isArray(world.observations);
  const editableWorld = Boolean(snapshot?.capabilities?.canEditWorld)
    && [...EDITABLE_WORLD_OPERATIONS].every((operation) => operations.has(operation));
  const hasPoints = (snapshot?.primitives ?? []).some((primitive) => primitive.type === 'scatter');
  const hasModelResponse = (snapshot?.primitives ?? []).some((primitive) => RESPONSE_PRIMITIVES.has(primitive.type));
  return {
    available: Boolean(snapshot?.model) && twoDimensional && editableWorld && hasPoints && hasModelResponse,
    editableWorld,
    twoDimensional,
    hasPoints,
    hasModelResponse,
  };
}
