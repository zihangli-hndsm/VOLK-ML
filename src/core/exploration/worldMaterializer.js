// Deterministic realization for the World Composer recipe grammar.
// This module is deliberately independent from React and from model adapters.

import { normalizeWorldRecipe } from './worldRecipe.js';

const TWO_PI = Math.PI * 2;
const clone = (value) => structuredClone(value);

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed, ...scope) {
  let state = hashString([Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : 0, ...scope].join('|'));
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  const u1 = Math.max(Number.EPSILON, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TWO_PI * u2);
}

function lerp(left, right, amount) {
  return left + (right - left) * amount;
}

function distance(left, right) {
  return Math.hypot(right[0] - left[0], right[1] - left[1]);
}

function inverseLinearDensity(value, from, to) {
  const normalization = (from + to) / 2;
  if (Math.abs(to - from) < 1e-9) return value;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const middle = (low + high) / 2;
    const cdf = (from * middle + ((to - from) * middle * middle) / 2) / normalization;
    if (cdf < value) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function densityParameter(value, density, domain = 'path') {
  if (density.type === 'center-heavy') {
    if (domain === 'radial') return Math.pow(value, 1 + density.strength * 2);
    const mapped = 0.5 + (value - 0.5) * (1 - density.strength * 0.8);
    return lerp(value, mapped, density.strength);
  }
  if (density.type === 'edge-heavy') {
    if (domain === 'radial') return 1 - Math.pow(1 - value, 1 + density.strength * 2);
    const local = value < 0.5 ? value * 2 : (value - 0.5) * 2;
    const mapped = value < 0.5 ? 0.5 * (1 - Math.sqrt(local)) : 0.5 + 0.5 * Math.sqrt(local);
    return lerp(value, mapped, density.strength);
  }
  if (density.type === 'gradient') {
    return inverseLinearDensity(value, density.from, density.to);
  }
  return value;
}

function pointInPolygon(point, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [x, y] = points[index];
    const [previousX, previousY] = points[previous];
    const intersects = ((y > point[1]) !== (previousY > point[1]))
      && point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function triangleArea(a, b, c) {
  return Math.abs((a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])) / 2);
}

function pointInTriangle(point, a, b, c) {
  const area = triangleArea(a, b, c);
  const sum = triangleArea(point, a, b) + triangleArea(point, b, c) + triangleArea(point, c, a);
  return Math.abs(sum - area) <= 1e-9;
}

function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function signedPolygonArea(points) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function triangulatePolygon(points) {
  const orientation = signedPolygonArea(points) >= 0 ? 1 : -1;
  const remaining = points.map((_, index) => index);
  const triangles = [];
  while (remaining.length > 3) {
    let earFound = false;
    for (let cursor = 0; cursor < remaining.length; cursor += 1) {
      const previous = remaining[(cursor + remaining.length - 1) % remaining.length];
      const current = remaining[cursor];
      const next = remaining[(cursor + 1) % remaining.length];
      if (orientation * cross(points[previous], points[current], points[next]) <= 1e-10) continue;
      const containsVertex = remaining.some((candidate) => candidate !== previous && candidate !== current && candidate !== next
        && pointInTriangle(points[candidate], points[previous], points[current], points[next]));
      if (containsVertex) continue;
      triangles.push([points[previous], points[current], points[next]]);
      remaining.splice(cursor, 1);
      earFound = true;
      break;
    }
    if (!earFound) throw new Error('EXPLORATION_INVALID_WORLD_RECIPE polygon triangulation failed');
  }
  triangles.push(remaining.map((index) => points[index]));
  return triangles;
}

function sampleTriangle(triangles, rng) {
  const weighted = triangles.map((triangle) => triangleArea(...triangle));
  const total = weighted.reduce((sum, value) => sum + value, 0);
  let target = rng() * total;
  let index = weighted.length - 1;
  for (let cursor = 0; cursor < weighted.length; cursor += 1) {
    target -= weighted[cursor];
    if (target <= 0) { index = cursor; break; }
  }
  const [a, b, c] = triangles[index];
  const root = Math.sqrt(rng());
  const first = 1 - root;
  const second = root * (1 - rng());
  return [first * a[0] + second * b[0] + (1 - first - second) * c[0], first * a[1] + second * b[1] + (1 - first - second) * c[1]];
}

function samplePolyline(points, parameter, offset, thickness) {
  const lengths = points.slice(1).map((point, index) => distance(points[index], point));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  let remaining = parameter * total;
  let segmentIndex = lengths.length - 1;
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index]) {
      segmentIndex = index;
      break;
    }
    remaining -= lengths[index];
  }
  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  const segmentLength = Math.max(lengths[segmentIndex], Number.EPSILON);
  const t = remaining / segmentLength;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const normalLength = Math.max(Math.hypot(dx, dy), Number.EPSILON);
  return [
    lerp(start[0], end[0], t) - (dy / normalLength) * offset * thickness,
    lerp(start[1], end[1], t) + (dx / normalLength) * offset * thickness,
  ];
}

function sampleShape(shape, u, v, rng) {
  const { type, params } = shape;
  const angle = v * TWO_PI;
  if (type === 'blob') {
    const radius = params.radius * Math.sqrt(u);
    return [Math.cos(angle) * radius * params.aspect[0], Math.sin(angle) * radius * params.aspect[1]];
  }
  if (type === 'line') return samplePolyline([params.start, params.end], u, (v - 0.5) * 2, params.thickness);
  if (type === 'arc') {
    const arcAngle = lerp(params.startAngle, params.endAngle, u);
    const radius = params.radius + (v - 0.5) * params.thickness;
    return [Math.cos(arcAngle) * radius, Math.sin(arcAngle) * radius];
  }
  if (type === 'ring') {
    const radius = params.radius + (v - 0.5) * params.thickness;
    const pathAngle = u * TWO_PI;
    return [Math.cos(pathAngle) * radius, Math.sin(pathAngle) * radius];
  }
  if (type === 'moon') {
    const radius = params.outerRadius + (v - 0.5) * params.thickness;
    let point = [Math.cos(angle) * radius, Math.sin(angle) * radius];
    const innerX = point[0] - params.innerOffset[0];
    const innerY = point[1] - params.innerOffset[1];
    if (Math.hypot(innerX, innerY) < params.innerRadius) {
      point = [-point[0], point[1]];
    }
    return point;
  }
  if (type === 'spiral') {
    const spiralAngle = u * params.turns * TWO_PI;
    const radius = lerp(params.startRadius, params.radius, u) + (v - 0.5) * params.thickness;
    return [Math.cos(spiralAngle) * radius, Math.sin(spiralAngle) * radius];
  }
  if (type === 'rectangle') {
    if (params.fill) return [(u - 0.5) * params.width, (v - 0.5) * params.height];
    const perimeter = 2 * (params.width + params.height);
    const along = u * perimeter;
    if (along < params.width) return [(along - params.width / 2), -params.height / 2 + (v - 0.5) * params.thickness];
    if (along < params.width + params.height) return [params.width / 2 + (v - 0.5) * params.thickness, (along - params.width) - params.height / 2];
    if (along < 2 * params.width + params.height) return [(params.width / 2) - (along - params.width - params.height), params.height / 2 + (v - 0.5) * params.thickness];
    return [-params.width / 2 + (v - 0.5) * params.thickness, params.height / 2 - (along - 2 * params.width - params.height)];
  }
  if (type === 'ellipse') {
    const radius = params.fill ? Math.sqrt(u) : 1;
    return [Math.cos(angle) * params.radii[0] * radius, Math.sin(angle) * params.radii[1] * radius + (v - 0.5) * params.thickness];
  }
  if (type === 'polygon') {
    if (params.fill) return sampleTriangle(triangulatePolygon(params.points), rng);
    return samplePolyline([...params.points, params.points[0]], u, (v - 0.5) * 2, params.thickness);
  }
  return samplePolyline(params.points, u, (v - 0.5) * 2, params.thickness);
}

function applyTransform(point, transform) {
  const scaled = [point[0] * transform.scale[0], point[1] * transform.scale[1]];
  const cos = Math.cos(transform.rotate);
  const sin = Math.sin(transform.rotate);
  return [
    scaled[0] * cos - scaled[1] * sin + transform.translate[0],
    scaled[0] * sin + scaled[1] * cos + transform.translate[1],
  ];
}

export const applyWorldRecipeTransform = applyTransform;

function inRegion(point, region) {
  if (region.type === 'bbox') return point[0] >= region.min[0] && point[0] <= region.max[0] && point[1] >= region.min[1] && point[1] <= region.max[1];
  return Math.hypot(point[0] - region.center[0], point[1] - region.center[1]) <= region.radius;
}

function transformFor(group, split) {
  return group.splitTransforms[split] ?? null;
}

function densityDomainForShape(shape) {
  if (shape.type === 'blob' || (shape.type === 'ellipse' && shape.params.fill)) return 'radial';
  if ((shape.type === 'rectangle' || shape.type === 'polygon') && shape.params.fill) return 'x';
  return 'path';
}

function applyNoise(point, noise, rng) {
  const offset = noise.position.amount;
  return [point[0] + gaussian(rng) * offset, point[1] + gaussian(rng) * offset];
}

function otherLabel(labels, current) {
  const uniqueLabels = [...new Set(labels)];
  if (uniqueLabels.length < 2) return current;
  const index = uniqueLabels.indexOf(current);
  return uniqueLabels[(index + 1) % uniqueLabels.length];
}

export function materializeWorldRecipe(recipe, seed, { worldId = 'world-1' } = {}) {
  const normalized = normalizeWorldRecipe(recipe);
  const normalizedSeed = Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : 0;
  const labels = normalized.groups.map((group) => group.label).filter((label) => label !== null);
  const observations = [];
  for (const split of ['train', 'test']) {
    const splitNoise = normalized.noise[split];
    for (const group of normalized.groups) {
      const sampling = group.sampling[split];
      const splitTransform = transformFor(group, split);
      const outlierCount = Math.round(sampling.count * splitNoise.outliers.fraction);
      const outlierIndexes = new Set();
      const outlierRng = createRng(normalizedSeed, worldId, group.id, split, 'outliers');
      while (outlierIndexes.size < outlierCount) outlierIndexes.add(Math.floor(outlierRng() * Math.max(1, sampling.count)));
      for (let sampleIndex = 0; sampleIndex < sampling.count; sampleIndex += 1) {
        const geometryRng = createRng(normalizedSeed, worldId, group.id, split, 'geometry', sampleIndex);
        const positionRng = createRng(normalizedSeed, worldId, group.id, split, 'position-noise', sampleIndex);
        const labelRng = createRng(normalizedSeed, worldId, group.id, split, 'label-noise', sampleIndex);
        const u = densityParameter(geometryRng(), sampling.density, densityDomainForShape(group.shape));
        const v = geometryRng();
        let position = applyTransform(sampleShape(group.shape, u, v, geometryRng), group.transform);
        if (splitTransform) position = applyTransform(position, splitTransform);
        const localRules = splitNoise.local.filter((rule) => inRegion(position, rule.region));
        const positionAmount = splitNoise.position.amount + localRules.filter((rule) => rule.kind === 'position').reduce((sum, rule) => sum + rule.amount, 0);
        if (positionAmount > 0) position = [position[0] + gaussian(positionRng) * positionAmount, position[1] + gaussian(positionRng) * positionAmount];
        const isOutlier = outlierIndexes.has(sampleIndex);
        if (isOutlier) {
          const distanceFromCenter = splitNoise.outliers.distance * (1 + outlierRng());
          if (splitNoise.outliers.placement === 'bbox') {
            position = [position[0] + (outlierRng() * 2 - 1) * distanceFromCenter, position[1] + (outlierRng() * 2 - 1) * distanceFromCenter];
          } else {
            const angle = outlierRng() * TWO_PI;
            position = [position[0] + Math.cos(angle) * distanceFromCenter, position[1] + Math.sin(angle) * distanceFromCenter];
          }
        }
        let label = group.label;
        const labelProbability = splitNoise.label.probability + localRules.filter((rule) => rule.kind === 'label').reduce((sum, rule) => sum + rule.probability, 0);
        const labelNoiseApplied = normalized.task === 'classification' && label !== null && labelRng() < Math.min(0.5, labelProbability);
        if (labelNoiseApplied) label = otherLabel(labels, label);
        const generated = {
          recipeVersion: normalized.version,
          groupId: group.id,
          shapeType: group.shape.type,
          sampleIndex,
          split,
          positionNoiseApplied: positionAmount > 0,
          labelNoiseApplied,
          anomaly: isOutlier ? 'outlier' : null,
        };
        observations.push({
          id: `recipe-${split}-${group.id}-${sampleIndex + 1}`,
          x: position[0],
          y: position[1],
          target: normalized.task === 'regression' ? position[1] : undefined,
          label: normalized.task === 'classification' ? label : undefined,
          membership: split,
          provenance: isOutlier ? 'generated-outlier' : 'generated',
          features: { x: position[0], y: position[1] },
          generation: generated,
        });
      }
    }
  }
  return { observations: clone(observations), recipe: normalized, seed: normalizedSeed };
}
