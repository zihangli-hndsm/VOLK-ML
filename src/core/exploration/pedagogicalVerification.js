import { coverageMismatch } from './observables.js';

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

function samePoint(left, right) {
  const a = pointXY(left);
  const b = pointXY(right);
  if (!a || !b) return false;
  return left.id === right.id
    && left.membership === right.membership
    && left.label === right.label
    && Math.abs(a[0] - b[0]) <= EPSILON
    && Math.abs(a[1] - b[1]) <= EPSILON;
}

function trainRealizationUnchanged(baselineWorld, candidateWorld) {
  const candidateById = new Map((candidateWorld?.observations ?? []).map((point) => [String(point.id), point]));
  const baselineTrain = (baselineWorld?.observations ?? []).filter((point) => point.membership === 'train');
  return baselineTrain.length > 0 && baselineTrain.every((point) => samePoint(point, candidateById.get(String(point.id))));
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

  if (goal === 'class-overlap') {
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
    const before = meanCrossGroupDistance(selectedBefore, otherBefore);
    const after = meanCrossGroupDistance(selectedAfter, otherAfter);
    if (before === null || after === null) return invalid(goal, 'class-separation-unavailable');
    const selectedCentroidBefore = centroid(selectedBefore);
    const selectedCentroidAfter = centroid(selectedAfter);
    return after < before - EPSILON
      ? { valid: true, goal, measurements: { metric: 'meanCrossClassDistance', before, after, selectedGroupId: String(selectedGroupId), selectedCentroidBefore, selectedCentroidAfter }, reason: null }
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
    const baselineById = new Map((baselineWorld.observations ?? []).map((point) => [String(point.id), point]));
    const changed = (candidateWorld.observations ?? []).filter((point) => point.membership === 'train')
      .filter((point) => !samePoint(baselineById.get(String(point.id)), point)).length;
    return changed > 0
      ? { valid: true, goal, measurements: { changedTrainPositions: changed }, reason: null }
      : invalid(goal, 'noise-produced-no-change');
  }

  if (goal === 'outlier-sensitivity') {
    const count = (world) => (world?.observations ?? []).filter((point) => point.provenance === 'generated-outlier').length;
    const before = count(baselineWorld);
    const after = count(candidateWorld);
    return after > before
      ? { valid: true, goal, measurements: { outliersBefore: before, outliersAfter: after }, reason: null }
      : invalid(goal, 'outliers-produced-no-change');
  }
  return invalid(goal, 'unsupported-goal');
}

export const PEDAGOGICAL_VERIFICATION_EPSILON = EPSILON;
