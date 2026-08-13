// Projection semantics shared by Data Lab views and World operations.
// A projection is a view over named observation features; it is never a
// second coordinate system or a mutation of the Experiment.

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);

export function getProjectedValue(observation, feature) {
  if (!observation || typeof feature !== 'string' || !feature) return null;
  if (hasOwn(observation.features, feature)) {
    const value = Number(observation.features[feature]);
    return Number.isFinite(value) ? value : null;
  }
  if (feature === 'x') {
    const value = Number(observation.x);
    return Number.isFinite(value) ? value : null;
  }
  if (feature === 'y') {
    const value = Number(observation.target ?? observation.y);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

export function projectObservation(observation, xFeature, yFeature) {
  return {
    id: observation?.id,
    x: getProjectedValue(observation, xFeature),
    y: getProjectedValue(observation, yFeature),
    membership: observation?.membership,
    label: observation?.label,
  };
}

export function projectionIsComplete(world, xFeature, yFeature) {
  if (!world || !Array.isArray(world.featureNames) || world.featureNames.length !== 2) return false;
  if (typeof xFeature !== 'string' || typeof yFeature !== 'string' || xFeature === yFeature) return false;
  if (!world.featureNames.includes(xFeature) || !world.featureNames.includes(yFeature)) return false;
  return world.observations.every((observation) => (
    Number.isFinite(getProjectedValue(observation, xFeature))
    && Number.isFinite(getProjectedValue(observation, yFeature))
  ));
}

export function canCreateObservationFromProjection(world, xFeature, yFeature) {
  return world?.task === 'regression' && projectionIsComplete(world, xFeature, yFeature);
}

export function observationFromProjection(world, {
  xFeature,
  yFeature,
  x,
  y,
  membership = 'unspecified',
  provenance = 'manual',
} = {}) {
  if (!canCreateObservationFromProjection(world, xFeature, yFeature)) return null;
  const values = { [xFeature]: Number(x), [yFeature]: Number(y) };
  const modelFeature = world.metadata?.modelFeature ?? world.featureNames[0];
  const targetFeature = world.metadata?.targetFeature ?? world.featureNames[1];
  const modelValue = values[modelFeature];
  const targetValue = values[targetFeature];
  if (!Number.isFinite(modelValue) || !Number.isFinite(targetValue)) return null;
  return {
    x: modelValue,
    y: targetValue,
    features: values,
    ...(world.task === 'regression' ? { target: targetValue } : {}),
    membership,
    provenance,
  };
}

export function projectedBounds(observations, xFeature, yFeature) {
  const points = observations
    .map((observation) => projectObservation(observation, xFeature, yFeature))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const xMin = xs.length ? Math.min(...xs) : -1;
  const xMax = xs.length ? Math.max(...xs) : 1;
  const yMin = ys.length ? Math.min(...ys) : -1;
  const yMax = ys.length ? Math.max(...ys) : 1;
  const xSpan = Math.max(0.5, xMax - xMin);
  const ySpan = Math.max(0.5, yMax - yMin);
  return {
    xMin: xMin - xSpan * 0.12,
    xMax: xMax + xSpan * 0.12,
    yMin: yMin - ySpan * 0.12,
    yMax: yMax + ySpan * 0.12,
  };
}
