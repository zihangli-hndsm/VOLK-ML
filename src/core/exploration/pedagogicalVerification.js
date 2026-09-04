import { coverageMismatch } from './observables.js';
import { PEDAGOGICAL_EXPERIMENT_GOALS } from './pedagogicalExperiment.js';

const EPSILON = 1e-6;
const clone = (value) => structuredClone(value);

function pointXY(point) {
  const x = Number(point?.x ?? point?.features?.x ?? point?.features?.[0]);
  const y = Number(point?.y ?? point?.features?.y ?? point?.features?.[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function observationsForGroup(world, groupId) {
  return (world?.observations ?? []).filter((point) => point?.generation?.groupId === groupId && pointXY(point));
}

function groupIdsByLabel(world) {
  const groups = new Map();
  for (const point of world?.observations ?? []) {
    const groupId = point?.generation?.groupId;
    if (!groupId || point?.label === undefined || point?.label === null) continue;
    const label = String(point.label);
    if (!groups.has(label)) groups.set(label, new Set());
    groups.get(label).add(String(groupId));
  }
  return groups;
}

function centroid(points) {
  if (!points.length) return null;
  const sum = points.reduce((acc, point) => {
    const [x, y] = pointXY(point);
    acc[0] += x;
    acc[1] += y;
    return acc;
  }, [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

function meanCrossGroupDistance(left, right) {
  const leftPoints = left.slice(0, 1000);
  const rightPoints = right.slice(0, 1000);
  if (!leftPoints.length || !rightPoints.length) return null;
  let total = 0;
  let count = 0;
  for (const leftPoint of leftPoints) {
    const [leftX, leftY] = pointXY(leftPoint);
    for (const rightPoint of rightPoints) {
      const [rightX, rightY] = pointXY(rightPoint);
      total += Math.hypot(leftX - rightX, leftY - rightY);
      count += 1;
    }
  }
  return count ? total / count : null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function pointIdentity(point) {
  return {
    id: point?.id === undefined || point?.id === null ? null : String(point.id),
    groupId: point?.generation?.groupId ?? null,
    membership: point?.membership ?? null,
    label: point?.label ?? null,
    target: point?.target ?? null,
  };
}

function pointSemanticSignature(point, { includePosition = true } = {}) {
  const position = pointXY(point);
  return {
    ...pointIdentity(point),
    ...(includePosition ? { position, features: stableValue(point?.features ?? null) } : {}),
  };
}

function samePointCollection(leftPoints, rightPoints, { includePosition = true } = {}) {
  if (leftPoints.length !== rightPoints.length) return false;
  const rightById = new Map(rightPoints.map((point) => [String(point?.id), point]));
  if (rightById.size !== rightPoints.length) return false;
  return leftPoints.every((point) => {
    const candidate = rightById.get(String(point?.id));
    if (!candidate) return false;
    return JSON.stringify(pointSemanticSignature(point, { includePosition }))
      === JSON.stringify(pointSemanticSignature(candidate, { includePosition }));
  });
}

function changedPositionCount(leftPoints, rightPoints) {
  if (!samePointCollection(leftPoints, rightPoints, { includePosition: false })) return false;
  const rightById = new Map(rightPoints.map((point) => [String(point?.id), point]));
  return leftPoints.filter((point) => {
    const left = pointXY(point);
    const right = pointXY(rightById.get(String(point?.id)));
    return !left || !right || Math.abs(left[0] - right[0]) > EPSILON || Math.abs(left[1] - right[1]) > EPSILON;
  }).length;
}

function pointsFor(world, predicate) {
  return (world?.observations ?? []).filter(predicate);
}

function trainRealizationUnchanged(baselineWorld, candidateWorld) {
  const baselineTrain = pointsFor(baselineWorld, (point) => point.membership === 'train');
  const candidateTrain = pointsFor(candidateWorld, (point) => point.membership === 'train');
  return baselineTrain.length > 0 && samePointCollection(baselineTrain, candidateTrain);
}

function rangeFor(world, membership) {
  const values = (world?.observations ?? [])
    .filter((point) => point.membership === membership)
    .map((point) => pointXY(point)?.[0])
    .filter(Number.isFinite);
  return values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
}

function patchChanges(scenario) {
  return scenario?.change
    ?.find((change) => change.operation === 'PATCH_WORLD_RECIPE')
    ?.parameters?.patch?.changes ?? [];
}

function invalid(goal, reason) {
  return { valid: false, goal, measurements: {}, reason };
}

export function verifyPedagogicalIntervention({ design, baselineWorld, candidateWorld, scenario, comparison } = {}) {
  const goal = design?.goal ?? scenario?.pedagogicalDesign?.goal ?? null;
  if (!goal || !baselineWorld || !candidateWorld) return invalid(goal, 'world-measurement-unavailable');
  const recipePaths = comparison?.details?.worldRecipe?.changedPaths ?? [];
  if (scenario?.change?.some((change) => change.operation === 'PATCH_WORLD_RECIPE') && recipePaths.length === 0) {
    return invalid(goal, 'no-semantic-recipe-change');
  }

  if (goal === PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION) {
    const groupsByLabel = groupIdsByLabel(baselineWorld);
    if (groupsByLabel.size !== 2 || [...groupsByLabel.values()].some((ids) => ids.size !== 1)) {
      return invalid(goal, 'class-group-selection-ambiguous');
    }
    const selectedGroupId = patchChanges(scenario).find((change) => change.type === 'TRANSLATE_GROUP')?.groupId;
    const labelGroups = [...groupsByLabel.entries()];
    const selectedLabel = labelGroups.find(([, ids]) => ids.has(String(selectedGroupId)))?.[0];
    const otherLabel = labelGroups.find(([label]) => label !== selectedLabel)?.[0];
    if (!selectedLabel || !otherLabel) return invalid(goal, 'class-group-selection-unavailable');
    const selectedBefore = observationsForGroup(baselineWorld, String(selectedGroupId));
    const otherBefore = observationsForGroup(baselineWorld, [...groupsByLabel.get(otherLabel)][0]);
    const selectedAfter = observationsForGroup(candidateWorld, String(selectedGroupId));
    const otherAfter = observationsForGroup(candidateWorld, [...groupsByLabel.get(otherLabel)][0]);
    if (!samePointCollection(otherBefore, otherAfter)) return invalid(goal, 'non-selected-class-changed');
    if (!samePointCollection(selectedBefore, selectedAfter, { includePosition: false })) return invalid(goal, 'selected-class-membership-changed');
    const before = meanCrossGroupDistance(selectedBefore, otherBefore);
    const after = meanCrossGroupDistance(selectedAfter, otherAfter);
    if (before === null || after === null) return invalid(goal, 'class-separation-unavailable');
    const selectedCentroidBefore = centroid(selectedBefore);
    const selectedCentroidAfter = centroid(selectedAfter);
    return after < before - EPSILON
      ? { valid: true, goal, measurements: { metric: 'meanCrossClassSeparation', before, after, selectedGroupId: String(selectedGroupId), selectedCentroidBefore, selectedCentroidAfter }, reason: null }
      : invalid(goal, 'class-separation-did-not-decrease');
  }

  if (goal === 'train-test-support-shift') {
    const before = coverageMismatch(rangeFor(baselineWorld, 'train'), rangeFor(baselineWorld, 'test'));
    const after = coverageMismatch(rangeFor(candidateWorld, 'train'), rangeFor(candidateWorld, 'test'));
    if (!before || !after) return invalid(goal, 'coverage-measurement-unavailable');
    if (!trainRealizationUnchanged(baselineWorld, candidateWorld)) return invalid(goal, 'train-realization-changed');
    return after.testOutsideTrainFraction > before.testOutsideTrainFraction + EPSILON
      ? { valid: true, goal, measurements: { coverageMismatch: { before: clone(before), after: clone(after) }, trainUnchanged: true }, reason: null }
      : invalid(goal, 'coverage-mismatch-did-not-increase');
  }

  if (goal === 'observation-noise') {
    const baselineTrain = pointsFor(baselineWorld, (point) => point.membership === 'train');
    const candidateTrain = pointsFor(candidateWorld, (point) => point.membership === 'train');
    const baselineTest = pointsFor(baselineWorld, (point) => point.membership === 'test');
    const candidateTest = pointsFor(candidateWorld, (point) => point.membership === 'test');
    const changed = changedPositionCount(baselineTrain, candidateTrain);
    return changed > 0 && samePointCollection(baselineTest, candidateTest)
      ? { valid: true, goal, measurements: { changedTrainPositions: changed }, reason: null }
      : invalid(goal, changed > 0 ? 'test-realization-changed' : 'noise-produced-no-change');
  }

  if (goal === 'outlier-sensitivity') {
    const count = (world) => (world?.observations ?? []).filter((point) => point.provenance === 'generated-outlier').length;
    const before = count(baselineWorld);
    const after = count(candidateWorld);
    const baselineTest = pointsFor(baselineWorld, (point) => point.membership === 'test');
    const candidateTest = pointsFor(candidateWorld, (point) => point.membership === 'test');
    return after > before && samePointCollection(baselineTest, candidateTest)
      ? { valid: true, goal, measurements: { outliersBefore: before, outliersAfter: after }, reason: null }
      : invalid(goal, after > before ? 'test-realization-changed' : 'outliers-produced-no-change');
  }
  if (goal === PEDAGOGICAL_EXPERIMENT_GOALS.MORE_SAME_DISTRIBUTION_DATA) {
    const generatorChange = scenario?.change?.find((change) => change.operation === 'SET_GENERATOR_PARAMETER' && change.parameters?.path === 'train.samples');
    const changedPaths = recipePaths;
    const recipeCountChange = changedPaths.length > 0 && changedPaths.every((path) => /\.groups\.[^.]+\.sampling\.train\.count$/.test(path));
    if (!generatorChange && !recipeCountChange) return invalid(goal, 'sample-count-only-change-required');
    const baselineTrain = pointsFor(baselineWorld, (point) => point.membership === 'train');
    const candidateTrain = pointsFor(candidateWorld, (point) => point.membership === 'train');
    const baselineTest = pointsFor(baselineWorld, (point) => point.membership === 'test');
    const candidateTest = pointsFor(candidateWorld, (point) => point.membership === 'test');
    const baselineSpec = baselineWorld.generator?.spec;
    const candidateSpec = candidateWorld.generator?.spec;
    const generatorHeld = baselineSpec && candidateSpec
      ? JSON.stringify({ ...baselineSpec, train: { ...baselineSpec.train, samples: undefined } }) === JSON.stringify({ ...candidateSpec, train: { ...candidateSpec.train, samples: undefined } })
      : true;
    const testSampleCountHeld = baselineSpec && candidateSpec
      ? Number(baselineSpec.test?.samples) === Number(candidateSpec.test?.samples)
      : baselineTest.length === candidateTest.length;
    return candidateTrain.length > baselineTrain.length && generatorHeld && testSampleCountHeld
      ? { valid: true, goal, measurements: { trainSamplesBefore: baselineTrain.length, trainSamplesAfter: candidateTrain.length, testRealizationHeld: true }, reason: null }
      : invalid(goal, candidateTrain.length > baselineTrain.length ? 'generating-process-changed' : 'sample-count-did-not-increase');
  }
  return invalid(goal, 'unsupported-goal');
}

export const PEDAGOGICAL_VERIFICATION_EPSILON = EPSILON;
