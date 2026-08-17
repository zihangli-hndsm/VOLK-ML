// `preserves` names semantic configuration domains only. They do not promise
// that derived fitted parameters, metrics, or results remain numerically
// unchanged after the World is edited.
const GENERATOR_PARAMETER_CAPABILITIES = Object.freeze([
  { path: 'train.input.type', type: 'enum', options: ['uniform', 'gaussian', 'two-cluster'], semanticTarget: 'train-input-distribution' },
  { path: 'test.input.type', type: 'enum', options: ['uniform', 'gaussian', 'two-cluster'], semanticTarget: 'test-input-distribution' },
  ...['train', 'test'].flatMap((split) => [
    { path: `${split}.input.params.min`, type: 'number', semanticTarget: `${split}-input-support` },
    { path: `${split}.input.params.max`, type: 'number', semanticTarget: `${split}-input-support` },
    { path: `${split}.input.params.mean`, type: 'number', semanticTarget: `${split}-input-support` },
    { path: `${split}.input.params.spread`, type: 'number', min: 0, semanticTarget: `${split}-input-support` },
    { path: `${split}.input.params.centerA`, type: 'number', semanticTarget: `${split}-input-support` },
    { path: `${split}.input.params.centerB`, type: 'number', semanticTarget: `${split}-input-support` },
    { path: `${split}.samples`, type: 'integer', min: 0, max: 500, semanticTarget: `${split}-sample-count` },
  ]),
  { path: 'relation.slope', type: 'number', semanticTarget: 'latent-relation' },
  { path: 'relation.bias', type: 'number', semanticTarget: 'latent-relation' },
  { path: 'noise.amount', type: 'number', min: 0, semanticTarget: 'noise' },
  { path: 'outliers.count', type: 'integer', min: 0, max: 500, semanticTarget: 'outliers' },
]);

const GENERATOR_PARAMETER_SCHEMA = Object.freeze({ parameters: GENERATOR_PARAMETER_CAPABILITIES });

const PUBLIC_WORLD_OPERATIONS = [
  {
    type: 'SET_WORLD_RECIPE',
    capability: 'world.recipe.configure',
    domain: 'world-generator',
    category: 'configure-world-recipe',
    changes: ['world-recipe'],
    preserves: ['observations-until-regenerate', 'model-configuration', 'learning-configuration', 'evaluation-configuration'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
  },
  {
    type: 'PATCH_WORLD_RECIPE',
    capability: 'world.recipe.patch',
    domain: 'world-generator',
    category: 'edit-world-recipe',
    changes: ['world-recipe'],
    preserves: ['observations-until-regenerate', 'model-configuration', 'learning-configuration', 'evaluation-configuration'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
  },
  {
    type: 'SET_WORLD_GENERATOR',
    capability: 'world.generator.configure',
    domain: 'world-generator',
    category: 'configure-generator',
    changes: ['generator-specification'],
    preserves: ['observations-until-regenerate', 'model-configuration', 'learning-configuration', 'evaluation-configuration'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
    semanticTarget: 'generator-specification',
    parameterSchema: GENERATOR_PARAMETER_SCHEMA,
  },
  {
    type: 'SET_GENERATOR_PARAMETER',
    capability: 'world.generator.parameter',
    domain: 'world-generator',
    category: 'configure-generator-parameter',
    changes: ['generator-specification'],
    preserves: ['observations-until-regenerate', 'model-configuration', 'learning-configuration', 'evaluation-configuration'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
    semanticTarget: 'generator-specification',
    parameterSchema: GENERATOR_PARAMETER_SCHEMA,
  },
  {
    type: 'SET_GENERATOR_SEED',
    capability: 'world.generator.seed',
    domain: 'world-generator',
    category: 'configure-generator-seed',
    changes: ['seed-policy'],
    preserves: ['generator-specification', 'observations-until-regenerate', 'model-configuration', 'learning-configuration', 'evaluation-configuration'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
  },
  {
    type: 'REGENERATE_WORLD',
    capability: 'world.generator.regenerate',
    domain: 'world-generator',
    category: 'regenerate-observations',
    changes: ['observations', 'generator-realization', 'provenance'],
    preserves: ['generator-specification', 'model-configuration', 'learning-configuration', 'evaluation-configuration'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
  },
  {
    type: 'FREEZE_AS_SAMPLES',
    capability: 'world.generator.freeze',
    domain: 'world-generator',
    category: 'freeze-generated-world',
    changes: ['world-mode'],
    preserves: ['observations', 'model-configuration', 'learning-configuration', 'evaluation-configuration'],
    undoable: true,
    agentDiscoverable: true,
    humanAccessible: true,
  },
  {
    type: 'ADD_POINTS',
    capability: 'world.observations.add',
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
    capability: 'world.observations.move',
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
    capability: 'world.observations.remove',
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
    capability: 'world.observations.remove',
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
    capability: 'world.observations.set-values',
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
    capability: 'world.observations.transform',
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
    capability: 'world.observations.membership',
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

export function listGeneratorParameterCapabilities() {
  return GENERATOR_PARAMETER_CAPABILITIES.map(copy);
}

export function isPublicWorldOperation(type) {
  return byType.has(type);
}
