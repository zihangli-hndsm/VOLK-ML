import { getProjectedValue } from '../../core/exploration/projection.js';

export const DATA_WORKSPACE_VIEWBOX = Object.freeze({ width: 640, height: 360 });
export const DATA_WORKSPACE_PLOT = Object.freeze({ left: 42, right: 620, top: 18, bottom: 320 });

// Manual view bounds have first priority. Otherwise Compare owns the
// coordinate frame when both experiments use the same projected features;
// auto-bounds are the final fallback. Every consumer uses this single frame.
function validBounds(bounds) {
  return bounds
    && ['xMin', 'xMax', 'yMin', 'yMax'].every((key) => Number.isFinite(Number(bounds[key])))
    && Number(bounds.xMin) < Number(bounds.xMax)
    && Number(bounds.yMin) < Number(bounds.yMax);
}

export function equalizeScatterBounds(bounds, plot = DATA_WORKSPACE_PLOT) {
  if (!validBounds(bounds)) return bounds;
  const width = Math.max(1, plot.right - plot.left);
  const height = Math.max(1, plot.bottom - plot.top);
  const requiredRatio = width / height;
  const xSpan = bounds.xMax - bounds.xMin;
  const ySpan = bounds.yMax - bounds.yMin;
  const centerX = (bounds.xMin + bounds.xMax) / 2;
  const centerY = (bounds.yMin + bounds.yMax) / 2;
  const nextXSpan = Math.max(xSpan, ySpan * requiredRatio);
  const nextYSpan = Math.max(ySpan, xSpan / requiredRatio);
  return {
    xMin: centerX - nextXSpan / 2,
    xMax: centerX + nextXSpan / 2,
    yMin: centerY - nextYSpan / 2,
    yMax: centerY + nextYSpan / 2,
  };
}

export function zoomScatterBounds(bounds, factor) {
  if (!validBounds(bounds) || !Number.isFinite(Number(factor)) || Number(factor) <= 0) return bounds;
  const centerX = (bounds.xMin + bounds.xMax) / 2;
  const centerY = (bounds.yMin + bounds.yMax) / 2;
  const halfX = Math.max(1e-9, (bounds.xMax - bounds.xMin) * Number(factor) / 2);
  const halfY = Math.max(1e-9, (bounds.yMax - bounds.yMin) * Number(factor) / 2);
  return { xMin: centerX - halfX, xMax: centerX + halfX, yMin: centerY - halfY, yMax: centerY + halfY };
}

export function axisTicks(min, max, targetCount = 5) {
  const lower = Number(min);
  const upper = Number(max);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower >= upper) return [];
  const desired = Math.max(4, Math.min(6, Math.round(targetCount)));
  const rawStep = (upper - lower) / Math.max(1, desired - 1);
  const exponent = Math.floor(Math.log10(rawStep));
  const candidates = [];
  for (let power = exponent - 2; power <= exponent + 2; power += 1) {
    for (const multiplier of [1, 2, 5]) {
      const step = multiplier * (10 ** power);
      const first = Math.ceil((lower - step * 1e-10) / step) * step;
      const last = Math.floor((upper + step * 1e-10) / step) * step;
      const count = last >= first ? Math.floor((last - first) / step + 1 + 1e-9) : 0;
      candidates.push({ step, count });
    }
  }
  const preferred = candidates.filter(({ count }) => count >= 4 && count <= 6);
  const pool = preferred.length ? preferred : candidates;
  const { step } = pool.sort((left, right) => (
    Math.abs(left.count - desired) - Math.abs(right.count - desired)
    || Math.abs(Math.log(left.step / rawStep)) - Math.abs(Math.log(right.step / rawStep))
  ))[0];
  const first = Math.ceil((lower - step * 1e-10) / step) * step;
  const ticks = [];
  for (let value = first; value <= upper + step * 1e-10 && ticks.length < 12; value += step) {
    const normalizedValue = Math.abs(value) < step * 1e-10 ? 0 : Number(value.toPrecision(12));
    ticks.push({ value: normalizedValue, label: formatAxisTick(normalizedValue, step) });
  }
  return ticks;
}

export function formatAxisTick(value, step = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  if (number === 0) return '0';
  const absolute = Math.abs(number);
  if (absolute >= 1e6 || absolute < 1e-4) return number.toExponential(2).replace(/\.00e/, 'e');
  const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(Math.abs(step))) + (Math.abs(step) < 1 ? 1 : 0)));
  return number.toFixed(decimals).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '').replace(/\.$/, '');
}

export function selectScatterBounds({ comparisonBounds, xFeature, yFeature, autoBounds, manualBounds, boundsMode = 'auto', equalScale = false, plot = DATA_WORKSPACE_PLOT }) {
  const comparisonMatches = comparisonBounds?.xFeature === xFeature && comparisonBounds?.yFeature === yFeature;
  const selected = boundsMode === 'manual' && validBounds(manualBounds)
    ? manualBounds
    : comparisonMatches && validBounds(comparisonBounds)
      ? comparisonBounds
      : autoBounds;
  return equalScale ? equalizeScatterBounds(selected, plot) : selected;
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
