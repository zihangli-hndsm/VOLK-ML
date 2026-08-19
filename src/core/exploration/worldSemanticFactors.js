// Bounded World-factor vocabulary for semantic event history. This describes
// what a completed operation touched, never why an outcome changed.
const FACTORS = Object.freeze({
  observations: 'world.observations',
  trainObservations: 'world.train.observations',
  testObservations: 'world.test.observations',
  trainInput: 'world.train.input',
  testInput: 'world.test.input',
  trainSampleCount: 'world.train.sampleCount',
  testSampleCount: 'world.test.sampleCount',
  noise: 'world.noise',
  labels: 'world.labels',
  outliers: 'world.outliers',
  relation: 'world.relation',
  seedPolicy: 'world.seedPolicy',
  generator: 'world.generator',
  realization: 'world.realization',
  mode: 'world.mode',
});

function membershipFactor(membership) {
  if (membership === 'train') return FACTORS.trainObservations;
  if (membership === 'test') return FACTORS.testObservations;
  return FACTORS.observations;
}

function factorsForPointIds(world, pointIds) {
  const membershipById = new Map((world?.observations ?? []).map((point) => [String(point.id), point.membership]));
  const factors = (pointIds ?? []).map((pointId) => membershipFactor(membershipById.get(String(pointId))));
  return factors.length ? factors : [FACTORS.observations];
}

function generatorParameterFactor(path) {
  const normalized = String(path ?? '');
  if (normalized.startsWith('train.input.')) return FACTORS.trainInput;
  if (normalized.startsWith('test.input.')) return FACTORS.testInput;
  if (normalized === 'train.samples') return FACTORS.trainSampleCount;
  if (normalized === 'test.samples') return FACTORS.testSampleCount;
  if (normalized.startsWith('noise.')) return FACTORS.noise;
  if (normalized.startsWith('outliers.')) return FACTORS.outliers;
  if (normalized.startsWith('relation.')) return FACTORS.relation;
  return FACTORS.generator;
}

function recipePatchFactors(change) {
  const scoped = (train, test) => change?.split === 'train' ? [train] : change?.split === 'test' ? [test] : [train, test];
  switch (change?.type) {
    case 'TRANSLATE_GROUP':
    case 'ROTATE_GROUP':
    case 'SCALE_GROUP':
      return scoped(FACTORS.trainInput, FACTORS.testInput);
    case 'SET_GROUP_SAMPLE_COUNT':
      return scoped(FACTORS.trainSampleCount, FACTORS.testSampleCount);
    case 'SET_GROUP_SAMPLING':
      return scoped(FACTORS.trainInput, FACTORS.testInput);
    case 'SET_NOISE':
      return [change.kind === 'label' ? FACTORS.labels : FACTORS.noise];
    case 'SET_OUTLIERS':
      return [FACTORS.outliers];
    case 'SET_LOCAL_NOISE':
      return [FACTORS.noise, FACTORS.labels];
    default:
      return [FACTORS.generator];
  }
}

function factorsForOperation(operation, beforeWorld) {
  switch (operation?.type) {
    case 'ADD_POINTS': return (operation.points ?? []).map((point) => membershipFactor(point.membership));
    case 'MOVE_POINT':
    case 'REMOVE_POINT': return factorsForPointIds(beforeWorld, [operation.pointId]);
    case 'REMOVE_POINTS': return factorsForPointIds(beforeWorld, operation.pointIds);
    case 'SET_FEATURE_VALUES': return factorsForPointIds(beforeWorld, (operation.values ?? []).map((entry) => entry.pointId));
    case 'TRANSFORM_FEATURE_VALUES': return operation.kind === 'noise' ? [FACTORS.noise] : factorsForPointIds(beforeWorld, operation.pointIds);
    case 'SET_TRAIN_TEST_MEMBERSHIP': return [FACTORS.trainObservations, FACTORS.testObservations];
    case 'SET_GENERATOR_PARAMETER': return [generatorParameterFactor(operation.path)];
    case 'SET_GENERATOR_SEED': return [FACTORS.seedPolicy];
    case 'SET_WORLD_GENERATOR':
    case 'SET_WORLD_RECIPE': return [FACTORS.generator];
    case 'PATCH_WORLD_RECIPE': return (operation.patch?.changes ?? []).flatMap(recipePatchFactors);
    case 'REGENERATE_WORLD': return [FACTORS.realization];
    case 'FREEZE_AS_SAMPLES': return [FACTORS.mode];
    default: return [FACTORS.observations];
  }
}

export function deriveWorldSemanticFactors({ operations = [], beforeWorld } = {}) {
  return [...new Set(operations.flatMap((operation) => factorsForOperation(operation, beforeWorld)))];
}

export { FACTORS as WORLD_SEMANTIC_FACTORS };
