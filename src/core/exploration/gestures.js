import { explorationError, MAX_WORLD_OBSERVATIONS } from './world.js';

export const MAX_GESTURE_PATH_POINTS = 512;
export const MAX_POINTS_PER_GESTURE = 250;

function finitePoint(point, index) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw explorationError('EXPLORATION_INVALID_OPERATION', { field: `path[${index}]` });
  }
  return { x, y };
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomGenerator(seed) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function sampledPath(path, spacing) {
  if (path.length === 1) return [path[0]];
  const samples = [path[0]];
  let carried = 0;
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    let distance = spacing - carried;
    while (distance <= length) {
      const ratio = distance / length;
      samples.push({ x: start.x + dx * ratio, y: start.y + dy * ratio });
      distance += spacing;
    }
    carried = Math.max(0, length - (distance - spacing));
  }
  return samples;
}

export function materializeWorldGesture({
  id = 'gesture',
  tool,
  path,
  seed = 0,
  spread = 0,
  density = 1,
  membership = 'train',
  provenance = 'manual',
  existingPointCount = 0,
} = {}) {
  if (!['brush', 'spray'].includes(tool)) {
    throw explorationError('EXPLORATION_INVALID_OPERATION', { field: 'tool', value: tool });
  }
  if (!Array.isArray(path) || !path.length || path.length > MAX_GESTURE_PATH_POINTS) {
    throw explorationError('EXPLORATION_RESOURCE_LIMIT', { field: 'path', max: MAX_GESTURE_PATH_POINTS });
  }
  const normalizedPath = path.map(finitePoint);
  const normalizedSpread = Number(spread);
  const normalizedDensity = Math.max(1, Math.floor(Number(density)));
  if (!Number.isFinite(normalizedSpread) || normalizedSpread < 0 || !Number.isFinite(normalizedDensity)) {
    throw explorationError('EXPLORATION_INVALID_OPERATION', { field: 'spread/density' });
  }
  const random = randomGenerator(`${seed}:${id}:${tool}`);
  const spacing = tool === 'brush' ? Math.max(0.02, normalizedSpread || 0.08) : Math.max(0.04, normalizedSpread || 0.12);
  const anchors = sampledPath(normalizedPath, spacing);
  const points = [];
  for (const anchor of anchors) {
    const count = tool === 'spray' ? normalizedDensity : 1;
    for (let index = 0; index < count; index += 1) {
      if (points.length >= MAX_POINTS_PER_GESTURE) break;
      const angle = random() * Math.PI * 2;
      const radius = normalizedSpread * Math.sqrt(random());
      const x = anchor.x + Math.cos(angle) * radius;
      const y = anchor.y + Math.sin(angle) * radius;
      points.push({
        id: `${id}-point-${points.length + 1}`,
        x,
        y,
        target: y,
        membership,
        provenance,
      });
    }
    if (points.length >= MAX_POINTS_PER_GESTURE) break;
  }
  if (existingPointCount + points.length > MAX_WORLD_OBSERVATIONS) {
    throw explorationError('EXPLORATION_RESOURCE_LIMIT', {
      field: 'observations',
      max: MAX_WORLD_OBSERVATIONS,
    });
  }
  return {
    id: String(id),
    actor: 'human',
    intent: tool,
    operations: [{ type: 'ADD_POINTS', points }],
  };
}
