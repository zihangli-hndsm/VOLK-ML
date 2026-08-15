import { getProjectedValue } from '../../core/exploration/projection.js';

export const DATA_WORKSPACE_VIEWBOX = Object.freeze({ width: 640, height: 360 });
export const DATA_WORKSPACE_PLOT = Object.freeze({ left: 42, right: 620, top: 18, bottom: 320 });

// Compare owns the coordinate frame when both experiments use the same
// projected features.  The Phenomenon and full Data surfaces intentionally
// provide different normal auto-bounds, but they must select the same shared
// frame while a semantic comparison is active.
export function selectScatterBounds({ comparisonBounds, xFeature, yFeature, autoBounds }) {
  if (comparisonBounds?.xFeature === xFeature && comparisonBounds?.yFeature === yFeature) {
    return comparisonBounds;
  }
  return autoBounds;
}

export function clientToSvgPoint({ clientX, clientY, rect }) {
  if (!rect?.width || !rect?.height) return null;
  return {
    x: (clientX - rect.left) / rect.width * DATA_WORKSPACE_VIEWBOX.width,
    y: (clientY - rect.top) / rect.height * DATA_WORKSPACE_VIEWBOX.height,
  };
}

export function clientToLocalPoint({ clientX, clientY, rect }) {
  if (!rect?.width || !rect?.height) return null;
  return { x: clientX - rect.left, y: clientY - rect.top };
}

export function worldToSvgPoint({ x, y, bounds }) {
  if (!bounds || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: DATA_WORKSPACE_PLOT.left + ((x - bounds.xMin) / (bounds.xMax - bounds.xMin)) * (DATA_WORKSPACE_PLOT.right - DATA_WORKSPACE_PLOT.left),
    y: DATA_WORKSPACE_PLOT.bottom - ((y - bounds.yMin) / (bounds.yMax - bounds.yMin)) * (DATA_WORKSPACE_PLOT.bottom - DATA_WORKSPACE_PLOT.top),
  };
}

export function projectObservationToSvg({ point, xFeature, yFeature, bounds }) {
  return worldToSvgPoint({
    x: getProjectedValue(point, xFeature),
    y: getProjectedValue(point, yFeature),
    bounds,
  });
}

export function projectObservationToLocal({ point, xFeature, yFeature, bounds, rect }) {
  const projected = projectObservationToSvg({ point, xFeature, yFeature, bounds });
  if (!projected || !rect?.width || !rect?.height) return null;
  return {
    x: projected.x / DATA_WORKSPACE_VIEWBOX.width * rect.width,
    y: projected.y / DATA_WORKSPACE_VIEWBOX.height * rect.height,
  };
}

export function nearestPointInSvg({ points, position, xFeature, yFeature, bounds }) {
  if (!position) return null;
  return points
    .map((point) => {
      const projected = projectObservationToSvg({ point, xFeature, yFeature, bounds });
      return projected
        ? { point, distancePx: Math.hypot(projected.x - position.x, projected.y - position.y), projected }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.distancePx - right.distancePx)[0] ?? null;
}

export function nearestPointInLocal({ points, position, xFeature, yFeature, bounds, rect }) {
  if (!position) return null;
  return points
    .map((point) => {
      const projected = projectObservationToLocal({ point, xFeature, yFeature, bounds, rect });
      return projected
        ? { point, distancePx: Math.hypot(projected.x - position.x, projected.y - position.y), projected }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.distancePx - right.distancePx)[0] ?? null;
}
