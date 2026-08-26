// A fixed, presentation-only learning path. It is a registry of possible
// topics, not a required sequence or an assessment model.

export const LEARNING_PATH_VERSION = 1;
export const LEARNING_PATH_NODE_IDS = Object.freeze([
  'world-vs-data',
  'sampling-variation',
  'linear-relationship',
  'loss-and-fitting',
  'train-vs-test',
  'generalization',
  'nonlinearity',
  'mlp-representation',
]);
export const LEARNING_PATH_STATES = Object.freeze({ AVAILABLE: 'available', EXPLORED: 'explored', ILLUMINATED: 'illuminated' });

export const LEARNING_PATH_REGISTRY = Object.freeze([
  { id: 'world-vs-data', titleKey: 'playground.learningPath.node.worldVsData', descriptionKey: 'playground.learningPath.description.worldVsData', conceptIds: [] },
  { id: 'sampling-variation', titleKey: 'playground.learningPath.node.samplingVariation', descriptionKey: 'playground.learningPath.description.samplingVariation', conceptIds: ['stability'] },
  { id: 'linear-relationship', titleKey: 'playground.learningPath.node.linearRelationship', descriptionKey: 'playground.learningPath.description.linearRelationship', conceptIds: [] },
  { id: 'loss-and-fitting', titleKey: 'playground.learningPath.node.lossAndFitting', descriptionKey: 'playground.learningPath.description.lossAndFitting', conceptIds: [] },
  { id: 'train-vs-test', titleKey: 'playground.learningPath.node.trainVsTest', descriptionKey: 'playground.learningPath.description.trainVsTest', conceptIds: ['train-test-distribution-shift'] },
  { id: 'generalization', titleKey: 'playground.learningPath.node.generalization', descriptionKey: 'playground.learningPath.description.generalization', conceptIds: ['generalization'] },
  { id: 'nonlinearity', titleKey: 'playground.learningPath.node.nonlinearity', descriptionKey: 'playground.learningPath.description.nonlinearity', conceptIds: [] },
  { id: 'mlp-representation', titleKey: 'playground.learningPath.node.mlpRepresentation', descriptionKey: 'playground.learningPath.description.mlpRepresentation', conceptIds: [] },
]);

function hasEvent(events, predicate) { return (Array.isArray(events) ? events : []).some(predicate); }

export function deriveLearningPath({ semanticEvents = [], inquiry = null, journey = null, playgroundId = null, illuminatedPathIds = [] } = {}) {
  const events = Array.isArray(semanticEvents) ? semanticEvents : semanticEvents?.events ?? [];
  const candidates = new Set((inquiry?.candidates ?? []).map((candidate) => candidate.conceptId));
  const connected = new Set(journey?.connectedConceptIds ?? []);
  const illuminated = new Set(Array.isArray(illuminatedPathIds) ? illuminatedPathIds : []);
  const explored = {
    'world-vs-data': hasEvent(events, (event) => event.type === 'world.intervened' || event.type === 'observation.sampled'),
    'sampling-variation': hasEvent(events, (event) => event.type === 'observation.sampled' || event.type === 'repeat.completed'),
    'linear-relationship': playgroundId === 'linear-regression' || hasEvent(events, (event) => String(event.reasonCode ?? '').includes('slope')),
    'loss-and-fitting': playgroundId === 'linear-regression' || playgroundId === 'mlp' || hasEvent(events, (event) => event.type === 'experiment.factor-changed'),
    'train-vs-test': candidates.has('train-test-distribution-shift') || connected.has('train-test-distribution-shift'),
    generalization: candidates.has('generalization') || connected.has('generalization'),
    nonlinearity: playgroundId === 'mlp' || hasEvent(events, (event) => String(event.reasonCode ?? '').includes('nonlinear')),
    'mlp-representation': playgroundId === 'mlp' || hasEvent(events, (event) => String(event.reasonCode ?? '').includes('hidden')),
  };
  return Object.freeze({ version: LEARNING_PATH_VERSION, nodes: Object.freeze(LEARNING_PATH_REGISTRY.map((entry) => Object.freeze({
    ...entry,
    state: illuminated.has(entry.id) ? LEARNING_PATH_STATES.ILLUMINATED : explored[entry.id] ? LEARNING_PATH_STATES.EXPLORED : LEARNING_PATH_STATES.AVAILABLE,
  }))) });
}
