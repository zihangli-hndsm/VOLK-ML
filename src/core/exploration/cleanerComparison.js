import { conditionFingerprintForSession } from './observables.js';

const clone = (value) => structuredClone(value);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function featureValue(point, feature) {
  const value = point?.features?.[feature] ?? point?.[feature];
  return Number(value);
}

function sameWorldShape(left, right) {
  if (!left || !right) return false;
  const { observations: leftObservations, ...leftShape } = left;
  const { observations: rightObservations, ...rightShape } = right;
  return equal(leftShape, rightShape)
    && Array.isArray(leftObservations)
    && Array.isArray(rightObservations)
    && leftObservations.length === rightObservations.length
    && new Set(leftObservations.map((point) => String(point.id))).size === leftObservations.length
    && new Set(rightObservations.map((point) => String(point.id))).size === rightObservations.length;
}

function worldRestorationChanges(diff, context = {}) {
  const left = diff?.factors?.world?.left;
  const right = diff?.factors?.world?.right;
  const leftTrainTest = diff?.factors?.trainTest?.left ?? [];
  const rightTrainTest = diff?.factors?.trainTest?.right ?? [];
  const registeredOperations = context.exploration?.worldOperations;
  const available = new Set((registeredOperations ?? []).map((operation) => operation.type));
  const supports = (type) => !registeredOperations || available.has(type);
  if (!sameWorldShape(left, right)) return null;
  const rightById = new Map(right.observations.map((point) => [String(point.id), point]));
  const leftIds = new Set(left.observations.map((point) => String(point.id)));
  if ([...rightById.keys()].some((id) => !leftIds.has(id))) return null;
  const changes = [];

  for (const feature of right.featureNames ?? []) {
    const values = right.observations.map((point) => ({
      pointId: point.id,
      value: featureValue(point, feature),
    }));
    if (values.some((item) => !Number.isFinite(item.value))) return null;
    const differs = values.some((item) => featureValue(left.observations.find((point) => String(point.id) === String(item.pointId)), feature) !== item.value);
    if (differs) {
      if (!supports('SET_FEATURE_VALUES')) return null;
      changes.push({
        semanticTarget: 'world',
        operation: 'SET_FEATURE_VALUES',
        parameters: { feature, values },
      });
    }
  }

  const rightMembership = new Map(rightTrainTest.map((point) => [String(point.id), point.membership]));
  const leftMembership = new Map(leftTrainTest.map((point) => [String(point.id), point.membership]));
  const membershipGroups = new Map();
  for (const [id, membership] of rightMembership) {
    if (membership !== leftMembership.get(id)) {
      if (!['train', 'test'].includes(membership) || !supports('SET_TRAIN_TEST_MEMBERSHIP')) return null;
      if (!membershipGroups.has(membership)) membershipGroups.set(membership, []);
      membershipGroups.get(membership).push(id);
    }
  }
  for (const [membership, pointIds] of membershipGroups) {
    changes.push({
      semanticTarget: 'train-test',
      operation: 'SET_TRAIN_TEST_MEMBERSHIP',
      parameters: { pointIds, membership },
    });
  }
  return changes;
}

function learningRestorationChanges(diff, context = {}) {
  const left = diff?.factors?.learning?.left?.controls ?? {};
  const right = diff?.factors?.learning?.right?.controls ?? {};
  const schemas = new Map((context.controlSchemas ?? []).map((schema) => [schema.key, schema]));
  const changes = [];
  for (const key of Object.keys(right)) {
    if (equal(left[key], right[key])) continue;
    const schema = schemas.get(key);
    if (schema && schema.domain !== 'learning') return null;
    changes.push({
      semanticTarget: 'learning-configuration',
      operation: 'SET_CONTROL',
      parameters: { key, value: clone(right[key]) },
    });
  }
  return changes.length ? changes : null;
}

function holdFor(factor) {
  return factor === 'learning'
    ? ['world', 'model-configuration', 'evaluation-configuration']
    : ['learning-configuration', 'model-configuration', 'evaluation-configuration'];
}

function changeSummary(factor) {
  return factor === 'learning'
    ? 'Keep the comparison World fixed and change only the learning settings.'
    : 'Keep the learning settings fixed and change only the World.';
}

// Returns only proposals whose non-selected changed dimensions can be restored
// with registered runtime operations. It never chooses a factor by inspecting
// UI labels and never mutates the active session.
export function deriveCleanerComparisonProposal({ snapshot = {}, comparison, context = {} } = {}) {
  const activeId = snapshot.experimentWorkspace?.activeExperimentId ?? snapshot.experiment?.id ?? null;
  const targetId = comparison?.againstExperimentId ?? null;
  const diff = comparison?.diff ?? snapshot.experimentWorkspace?.comparison?.diff;
  if (!activeId || !targetId || !diff || diff.clarity !== 'mixed') return { options: [] };
  const changed = [...(diff.changed ?? [])];
  if (!changed.includes('world') || !changed.includes('learning')) return { options: [] };
  const options = [];
  const restoreWorld = worldRestorationChanges(diff, context);
  if (restoreWorld?.length) options.push({
    factor: 'learning',
    change: restoreWorld,
    hold: holdFor('learning'),
    summary: changeSummary('learning'),
  });
  const restoreLearning = learningRestorationChanges(diff, context);
  if (restoreLearning?.length) options.push({
    factor: 'world',
    change: restoreLearning,
    hold: holdFor('world'),
    summary: changeSummary('world'),
  });
  if (!options.length) return { options: [] };
  const baseline = {
    experimentId: activeId,
    conditionFingerprint: conditionFingerprintForSession({
      world: snapshot.world,
      adapterId: snapshot.experiment?.model?.adapterId,
      experiment: snapshot.experiment,
    }),
  };
  return {
    activeExperimentId: activeId,
    againstExperimentId: targetId,
    options: options.map((option) => ({
      ...option,
      scenario: {
        version: 1,
        request: `Create a cleaner comparison by changing only ${option.factor}.`,
        interpretation: { summary: option.summary, ambiguity: null },
        baseline,
        change: option.change,
        intendedFactors: [option.factor],
        hold: option.hold,
        observe: ['model.slope', 'model.bias', 'outcome.trainMse', 'outcome.testMse'],
        execution: {
          duplicateBaseline: true,
          run: true,
          compare: true,
          compareAgainstExperimentId: targetId,
          repeat: null,
        },
      },
    })),
  };
}
