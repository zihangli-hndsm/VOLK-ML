// World Composer v1: a bounded, JSON-safe grammar for finite 2D Worlds.
// This module owns recipe normalization and semantic edits. It never creates
// observations; materialization lives in worldMaterializer.js.

export const WORLD_RECIPE_VERSION = 1;
export const WORLD_RECIPE_COORDINATE_SPACE = 'cartesian-2d';
export const WORLD_RECIPE_SHAPE_TYPES = Object.freeze([
  'blob', 'line', 'arc', 'ring', 'moon', 'spiral', 'rectangle', 'ellipse', 'polygon', 'polyline',
]);
export const WORLD_RECIPE_DENSITY_TYPES = Object.freeze(['uniform', 'center-heavy', 'edge-heavy', 'gradient']);
export const WORLD_RECIPE_NOISE_KINDS = Object.freeze(['position', 'label', 'outliers']);
export const WORLD_RECIPE_PATCH_TYPES = Object.freeze([
  'TRANSLATE_GROUP',
  'ROTATE_GROUP',
  'SCALE_GROUP',
  'SET_GROUP_SAMPLING',
  'SET_GROUP_SAMPLE_COUNT',
  'SET_NOISE',
  'SET_OUTLIERS',
  'SET_LOCAL_NOISE',
]);

export const WORLD_RECIPE_LIMITS = Object.freeze({
  maxGroups: 16,
  maxPointsPerShape: 32,
  maxSamplesPerGroupSplit: 500,
  maxTotalSamples: 5000,
  maxLocalNoiseRulesPerSplit: 16,
  maxPatchChanges: 32,
  maxCoordinate: 20,
  maxScale: 10,
  maxRadius: 20,
  maxThickness: 10,
  maxTurns: 20,
  maxNoiseAmount: 5,
  maxOutlierDistance: 30,
  maxDensityWeight: 10,
});

export const WORLD_RECIPE_SEMANTIC_DOMAINS = Object.freeze([
  'group-shape',
  'group-transform',
  'group-split-transform:train',
  'group-split-transform:test',
  'group-sampling-count',
  'group-sampling-density',
  'labels',
  'train-position-noise',
  'test-position-noise',
  'train-label-noise',
  'test-label-noise',
  'train-outliers',
  'test-outliers',
  'train-local-noise',
  'test-local-noise',
  'task',
  'coordinate-space',
]);

const clone = (value) => structuredClone(value);

export function worldRecipeError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

function plainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field });
  }
  return value;
}

function allowedKeys(value, keys, field) {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: `${field}.${key}`, reason: 'unknown-key' });
  }
}

function patchAllowedKeys(value, keys, field) {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE_PATCH', { field: `${field}.${key}`, reason: 'unknown-key' });
  }
}

function finite(value, field, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, value, min, max });
  }
  const number = value;
  return number;
}

function integer(value, field, min, max) {
  const number = finite(value, field);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw worldRecipeError(number < min || number > max ? 'EXPLORATION_RESOURCE_LIMIT' : 'EXPLORATION_INVALID_WORLD_RECIPE', {
      field, value, min, max,
    });
  }
  return number;
}

function positive(value, field, { max = Infinity } = {}) {
  const number = finite(value, field, { min: Number.EPSILON, max });
  if (number <= 0) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, value, reason: 'must-be-positive' });
  return number;
}

function vector2(value, field, { positiveValues = false, max = WORLD_RECIPE_LIMITS.maxCoordinate } = {}) {
  if (!Array.isArray(value) || value.length !== 2) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field });
  return value.map((item, index) => positiveValues
    ? positive(item, `${field}[${index}]`, { max })
    : finite(item, `${field}[${index}]`, { min: -max, max }));
}

function normalizeTransform(value, field = 'transform') {
  const source = value ?? {};
  plainObject(source, field);
  allowedKeys(source, ['translate', 'rotate', 'scale'], field);
  return {
    translate: vector2(source.translate ?? [0, 0], `${field}.translate`),
    rotate: finite(source.rotate ?? 0, `${field}.rotate`, { min: -32 * Math.PI, max: 32 * Math.PI }),
    scale: vector2(source.scale ?? [1, 1], `${field}.scale`, { positiveValues: true, max: WORLD_RECIPE_LIMITS.maxScale }),
  };
}

function normalizeDensity(value, field) {
  const source = value ?? { type: 'uniform' };
  plainObject(source, field);
  allowedKeys(source, ['type', 'strength', 'from', 'to', 'axis'], field);
  const type = source.type ?? 'uniform';
  if (!WORLD_RECIPE_DENSITY_TYPES.includes(type)) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: `${field}.type`, value: type });
  if (type === 'uniform') return { type };
  if (type === 'center-heavy' || type === 'edge-heavy') {
    return { type, strength: finite(source.strength ?? 0.6, `${field}.strength`, { min: 0, max: 1 }) };
  }
  const from = positive(source.from ?? 0.2, `${field}.from`, { max: WORLD_RECIPE_LIMITS.maxDensityWeight });
  const to = positive(source.to ?? 2, `${field}.to`, { max: WORLD_RECIPE_LIMITS.maxDensityWeight });
  if (!['x', 'path'].includes(source.axis ?? 'x')) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: `${field}.axis` });
  return { type, from, to, axis: source.axis ?? 'x' };
}

function densityDomain(shape) {
  if (shape.type === 'line' || shape.type === 'arc' || shape.type === 'ring' || shape.type === 'moon' || shape.type === 'spiral' || shape.type === 'polyline') return 'path';
  if (shape.type === 'rectangle' && !shape.params.fill) return 'path';
  if (shape.type === 'ellipse' && !shape.params.fill) return 'path';
  if (shape.type === 'polygon' && !shape.params.fill) return 'path';
  if (shape.type === 'blob' || shape.type === 'ellipse') return 'radial';
  if (shape.type === 'rectangle' || shape.type === 'polygon') return 'x';
  return 'unsupported';
}

function validateDensityForShape(density, shape, field) {
  const domain = densityDomain(shape);
  if (shape.type === 'polygon' && shape.params.fill && density.type !== 'uniform') {
    throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, reason: 'polygon-fill-density-unsupported' });
  }
  if (density.type === 'gradient' && density.axis !== domain) {
    throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, reason: 'density-axis-unsupported', axis: density.axis, domain });
  }
  if (domain === 'unsupported') {
    throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, reason: 'density-domain-unsupported' });
  }
  return density;
}

function polygonArea(points) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function segmentsIntersect(a, b, c, d) {
  const orientation = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const ab = orientation(a, b, c) * orientation(a, b, d);
  const cd = orientation(c, d, a) * orientation(c, d, b);
  return ab < 0 && cd < 0;
}

function hasSelfIntersection(points) {
  for (let left = 0; left < points.length; left += 1) {
    const leftNext = (left + 1) % points.length;
    for (let right = left + 1; right < points.length; right += 1) {
      const rightNext = (right + 1) % points.length;
      if (left === right || leftNext === right || rightNext === left) continue;
      if (segmentsIntersect(points[left], points[leftNext], points[right], points[rightNext])) return true;
    }
  }
  return false;
}

function pathLength(points) {
  return points.slice(1).reduce((sum, point, index) => {
    const previous = points[index];
    return sum + Math.hypot(point[0] - previous[0], point[1] - previous[1]);
  }, 0);
}

function normalizeShape(value, field) {
  const source = plainObject(value, field);
  allowedKeys(source, ['type', 'params'], field);
  const type = source.type;
  if (!WORLD_RECIPE_SHAPE_TYPES.includes(type)) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: `${field}.type`, value: type });
  const params = plainObject(source.params ?? {}, `${field}.params`);
  let normalized;
  if (type === 'blob') {
    allowedKeys(params, ['radius', 'aspect'], `${field}.params`);
    normalized = { radius: positive(params.radius ?? 1, `${field}.params.radius`, { max: WORLD_RECIPE_LIMITS.maxRadius }), aspect: vector2(params.aspect ?? [1, 1], `${field}.params.aspect`, { positiveValues: true, max: WORLD_RECIPE_LIMITS.maxScale }) };
  } else if (type === 'line') {
    allowedKeys(params, ['start', 'end', 'thickness'], `${field}.params`);
    const start = vector2(params.start ?? [-1, 0], `${field}.params.start`);
    const end = vector2(params.end ?? [1, 0], `${field}.params.end`);
    if (start[0] === end[0] && start[1] === end[1]) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, reason: 'degenerate-line' });
    normalized = { start, end, thickness: positive(params.thickness ?? 0.12, `${field}.params.thickness`, { max: WORLD_RECIPE_LIMITS.maxThickness }) };
  } else if (type === 'arc') {
    allowedKeys(params, ['radius', 'startAngle', 'endAngle', 'thickness'], `${field}.params`);
    normalized = {
      radius: positive(params.radius ?? 1, `${field}.params.radius`, { max: WORLD_RECIPE_LIMITS.maxRadius }),
      startAngle: finite(params.startAngle ?? 0, `${field}.params.startAngle`, { min: -32 * Math.PI, max: 32 * Math.PI }),
      endAngle: finite(params.endAngle ?? Math.PI, `${field}.params.endAngle`, { min: -32 * Math.PI, max: 32 * Math.PI }),
      thickness: positive(params.thickness ?? 0.12, `${field}.params.thickness`, { max: WORLD_RECIPE_LIMITS.maxThickness }),
    };
  } else if (type === 'ring') {
    allowedKeys(params, ['radius', 'thickness'], `${field}.params`);
    const radius = positive(params.radius ?? 1, `${field}.params.radius`, { max: WORLD_RECIPE_LIMITS.maxRadius });
    const thickness = positive(params.thickness ?? 0.15, `${field}.params.thickness`, { max: WORLD_RECIPE_LIMITS.maxThickness });
    if (thickness >= radius * 2) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, reason: 'ring-thickness-too-large' });
    normalized = { radius, thickness };
  } else if (type === 'moon') {
    allowedKeys(params, ['outerRadius', 'innerRadius', 'innerOffset', 'thickness'], `${field}.params`);
    const outerRadius = positive(params.outerRadius ?? 1, `${field}.params.outerRadius`, { max: WORLD_RECIPE_LIMITS.maxRadius });
    const innerRadius = positive(params.innerRadius ?? 0.8, `${field}.params.innerRadius`, { max: WORLD_RECIPE_LIMITS.maxRadius });
    if (innerRadius >= outerRadius) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, reason: 'moon-radii-invalid' });
    const innerOffset = vector2(params.innerOffset ?? [0.45, 0], `${field}.params.innerOffset`);
    const offsetDistance = Math.hypot(innerOffset[0], innerOffset[1]);
    if (!(Math.abs(outerRadius - innerRadius) + 1e-9 < offsetDistance
      && offsetDistance < outerRadius + innerRadius - 1e-9)) {
      throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, reason: 'moon-circles-must-intersect' });
    }
    normalized = {
      outerRadius,
      innerRadius,
      innerOffset,
      thickness: positive(params.thickness ?? 0.02, `${field}.params.thickness`, { max: WORLD_RECIPE_LIMITS.maxThickness }),
    };
  } else if (type === 'spiral') {
    allowedKeys(params, ['turns', 'radius', 'startRadius', 'thickness'], `${field}.params`);
    normalized = {
      turns: positive(params.turns ?? 1.5, `${field}.params.turns`, { max: WORLD_RECIPE_LIMITS.maxTurns }),
      radius: positive(params.radius ?? 1, `${field}.params.radius`, { max: WORLD_RECIPE_LIMITS.maxRadius }),
      startRadius: finite(params.startRadius ?? 0.05, `${field}.params.startRadius`, { min: 0, max: WORLD_RECIPE_LIMITS.maxRadius }),
      thickness: positive(params.thickness ?? 0.12, `${field}.params.thickness`, { max: WORLD_RECIPE_LIMITS.maxThickness }),
    };
  } else if (type === 'rectangle') {
    allowedKeys(params, ['width', 'height', 'fill', 'thickness'], `${field}.params`);
    normalized = {
      width: positive(params.width ?? 2, `${field}.params.width`, { max: WORLD_RECIPE_LIMITS.maxCoordinate * 2 }),
      height: positive(params.height ?? 2, `${field}.params.height`, { max: WORLD_RECIPE_LIMITS.maxCoordinate * 2 }),
      fill: params.fill !== false,
      thickness: positive(params.thickness ?? 0.12, `${field}.params.thickness`, { max: WORLD_RECIPE_LIMITS.maxThickness }),
    };
  } else if (type === 'ellipse') {
    allowedKeys(params, ['radii', 'fill', 'thickness'], `${field}.params`);
    normalized = {
      radii: vector2(params.radii ?? [1.5, 0.8], `${field}.params.radii`, { positiveValues: true, max: WORLD_RECIPE_LIMITS.maxRadius }),
      fill: params.fill !== false,
      thickness: positive(params.thickness ?? 0.12, `${field}.params.thickness`, { max: WORLD_RECIPE_LIMITS.maxThickness }),
    };
  } else if (type === 'polygon') {
    allowedKeys(params, ['points', 'fill', 'thickness'], `${field}.params`);
    if (!Array.isArray(params.points) || params.points.length < 3 || params.points.length > WORLD_RECIPE_LIMITS.maxPointsPerShape) {
      throw worldRecipeError('EXPLORATION_RESOURCE_LIMIT', { field: `${field}.params.points`, max: WORLD_RECIPE_LIMITS.maxPointsPerShape });
    }
    const points = params.points.map((point, index) => vector2(point, `${field}.params.points[${index}]`));
    if (Math.abs(polygonArea(points)) < 1e-9) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, reason: 'degenerate-polygon' });
    if (hasSelfIntersection(points)) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, reason: 'self-intersecting-polygon' });
    normalized = { points, fill: params.fill !== false, thickness: positive(params.thickness ?? 0.12, `${field}.params.thickness`, { max: WORLD_RECIPE_LIMITS.maxThickness }) };
  } else {
    allowedKeys(params, ['points', 'thickness'], `${field}.params`);
    if (!Array.isArray(params.points) || params.points.length < 2 || params.points.length > WORLD_RECIPE_LIMITS.maxPointsPerShape) {
      throw worldRecipeError('EXPLORATION_RESOURCE_LIMIT', { field: `${field}.params.points`, max: WORLD_RECIPE_LIMITS.maxPointsPerShape });
    }
    const points = params.points.map((point, index) => vector2(point, `${field}.params.points[${index}]`));
    if (pathLength(points) <= 0) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, reason: 'degenerate-polyline' });
    normalized = { points, thickness: positive(params.thickness ?? 0.12, `${field}.params.thickness`, { max: WORLD_RECIPE_LIMITS.maxThickness }) };
  }
  return { type, params: normalized };
}

function normalizeSampling(value, field) {
  const source = plainObject(value ?? {}, field);
  allowedKeys(source, ['count', 'density'], field);
  return {
    count: integer(source.count ?? 0, `${field}.count`, 0, WORLD_RECIPE_LIMITS.maxSamplesPerGroupSplit),
    density: normalizeDensity(source.density, `${field}.density`),
  };
}

function normalizeRegion(value, field) {
  const source = plainObject(value, field);
  allowedKeys(source, ['type', 'min', 'max', 'center', 'radius'], field);
  if (source.type === 'bbox') {
    const min = vector2(source.min, `${field}.min`);
    const max = vector2(source.max, `${field}.max`);
    if (min[0] >= max[0] || min[1] >= max[1]) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, reason: 'invalid-bbox' });
    return { type: 'bbox', min, max };
  }
  if (source.type === 'circle') return { type: 'circle', center: vector2(source.center ?? [0, 0], `${field}.center`), radius: positive(source.radius ?? 1, `${field}.radius`, { max: WORLD_RECIPE_LIMITS.maxRadius }) };
  throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: `${field}.type`, value: source.type });
}

function normalizeNoise(value, field) {
  const source = plainObject(value ?? {}, field);
  allowedKeys(source, ['position', 'label', 'outliers', 'local'], field);
  const position = plainObject(source.position ?? {}, `${field}.position`);
  const label = plainObject(source.label ?? {}, `${field}.label`);
  const outliers = plainObject(source.outliers ?? {}, `${field}.outliers`);
  allowedKeys(position, ['amount'], `${field}.position`);
  allowedKeys(label, ['probability', 'policy'], `${field}.label`);
  allowedKeys(outliers, ['fraction', 'placement', 'distance'], `${field}.outliers`);
  const amount = finite(position.amount ?? 0, `${field}.position.amount`, { min: 0, max: WORLD_RECIPE_LIMITS.maxNoiseAmount });
  const probability = finite(label.probability ?? 0, `${field}.label.probability`, { min: 0, max: 0.5 });
  const fraction = finite(outliers.fraction ?? 0, `${field}.outliers.fraction`, { min: 0, max: 0.25 });
  if (fraction < 0 || fraction > 0.25) {
    throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, reason: 'noise-range' });
  }
  const policy = label.policy ?? 'flip';
  if (policy !== 'flip') throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: `${field}.label.policy`, value: policy });
  const placement = outliers.placement ?? 'radial';
  if (!['radial', 'bbox'].includes(placement)) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: `${field}.outliers.placement`, value: placement });
  const local = source.local ?? [];
  if (!Array.isArray(local) || local.length > WORLD_RECIPE_LIMITS.maxLocalNoiseRulesPerSplit) throw worldRecipeError('EXPLORATION_RESOURCE_LIMIT', { field: `${field}.local`, max: WORLD_RECIPE_LIMITS.maxLocalNoiseRulesPerSplit });
  return {
    position: { amount },
    label: { probability, policy },
    outliers: { fraction, placement, distance: positive(outliers.distance ?? 2, `${field}.outliers.distance`, { max: WORLD_RECIPE_LIMITS.maxOutlierDistance }) },
    local: local.map((rule, index) => {
      const item = plainObject(rule, `${field}.local[${index}]`);
      allowedKeys(item, ['region', 'kind', 'amount', 'probability'], `${field}.local[${index}]`);
      if (!['position', 'label'].includes(item.kind)) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: `${field}.local[${index}].kind` });
      if ((item.kind === 'position' && item.probability !== undefined) || (item.kind === 'label' && item.amount !== undefined)) {
        throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: `${field}.local[${index}]`, reason: 'wrong-noise-property' });
      }
      if ((item.kind === 'position' && item.amount === undefined) || (item.kind === 'label' && item.probability === undefined)) {
        throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: `${field}.local[${index}]`, reason: 'missing-noise-value' });
      }
      const value = finite(item.kind === 'position' ? item.amount ?? 0 : item.probability ?? 0, `${field}.local[${index}].${item.kind === 'position' ? 'amount' : 'probability'}`, { min: 0, max: item.kind === 'position' ? WORLD_RECIPE_LIMITS.maxNoiseAmount : 0.5 });
      if (value < 0 || item.kind === 'label' && value > 0.5) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: `${field}.local[${index}]`, reason: 'noise-range' });
      return { region: normalizeRegion(item.region, `${field}.local[${index}].region`), kind: item.kind, ...(item.kind === 'position' ? { amount: value } : { probability: value }) };
    }),
  };
}

export function normalizeWorldRecipe(recipe = {}) {
  const source = plainObject(recipe, 'recipe');
  allowedKeys(source, ['version', 'task', 'coordinateSpace', 'groups', 'noise'], 'recipe');
  if (source.version !== WORLD_RECIPE_VERSION) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: 'version', value: source.version });
  const task = source.task ?? 'classification';
  if (!['classification', 'regression'].includes(task)) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: 'task', value: task });
  if ((source.coordinateSpace ?? WORLD_RECIPE_COORDINATE_SPACE) !== WORLD_RECIPE_COORDINATE_SPACE) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: 'coordinateSpace' });
  if (!Array.isArray(source.groups) || !source.groups.length || source.groups.length > WORLD_RECIPE_LIMITS.maxGroups) throw worldRecipeError('EXPLORATION_RESOURCE_LIMIT', { field: 'groups', max: WORLD_RECIPE_LIMITS.maxGroups });
  const ids = new Set();
  const groups = source.groups.map((group, index) => {
    const item = plainObject(group, `groups[${index}]`);
    allowedKeys(item, ['id', 'label', 'shape', 'transform', 'splitTransforms', 'sampling'], `groups[${index}]`);
    const id = String(item.id ?? '');
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(id) || ids.has(id)) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: `groups[${index}].id`, value: id });
    ids.add(id);
    const label = item.label === undefined || item.label === null ? null : String(item.label);
    if (task === 'classification' && !label) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: `groups[${index}].label` });
    const shape = normalizeShape(item.shape, `groups[${index}].shape`);
    const sampling = plainObject(item.sampling ?? {}, `groups[${index}].sampling`);
    allowedKeys(sampling, ['train', 'test'], `groups[${index}].sampling`);
    const splitTransforms = plainObject(item.splitTransforms ?? {}, `groups[${index}].splitTransforms`);
    allowedKeys(splitTransforms, ['train', 'test'], `groups[${index}].splitTransforms`);
    const normalizedSampling = {
      train: normalizeSampling(sampling.train, `groups[${index}].sampling.train`),
      test: normalizeSampling(sampling.test, `groups[${index}].sampling.test`),
    };
    validateDensityForShape(normalizedSampling.train.density, shape, `groups[${index}].sampling.train.density`);
    validateDensityForShape(normalizedSampling.test.density, shape, `groups[${index}].sampling.test.density`);
    return {
      id,
      label,
      shape,
      transform: normalizeTransform(item.transform, `groups[${index}].transform`),
      splitTransforms: {
        train: splitTransforms.train === null || splitTransforms.train === undefined ? null : normalizeTransform(splitTransforms.train, `groups[${index}].splitTransforms.train`),
        test: splitTransforms.test === null || splitTransforms.test === undefined ? null : normalizeTransform(splitTransforms.test, `groups[${index}].splitTransforms.test`),
      },
      sampling: normalizedSampling,
    };
  });
  if (task === 'classification' && groups.length < 2) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: 'groups', reason: 'classification-needs-two-groups' });
  const noiseSource = plainObject(source.noise ?? {}, 'noise');
  allowedKeys(noiseSource, ['train', 'test'], 'noise');
  const normalized = {
    version: WORLD_RECIPE_VERSION,
    task,
    coordinateSpace: WORLD_RECIPE_COORDINATE_SPACE,
    groups,
    noise: { train: normalizeNoise(noiseSource.train, 'noise.train'), test: normalizeNoise(noiseSource.test, 'noise.test') },
  };
  const total = groups.reduce((sum, group) => sum + group.sampling.train.count + group.sampling.test.count, 0);
  if (total < 2 || total > WORLD_RECIPE_LIMITS.maxTotalSamples) throw worldRecipeError('EXPLORATION_RESOURCE_LIMIT', { field: 'sampling.total', min: 2, max: WORLD_RECIPE_LIMITS.maxTotalSamples, value: total });
  return clone(normalized);
}

export const validateWorldRecipe = normalizeWorldRecipe;

function nullable(schema) {
  return { anyOf: [schema, { type: 'null' }] };
}

const coordinateNumber = { type: 'number', minimum: -WORLD_RECIPE_LIMITS.maxCoordinate, maximum: WORLD_RECIPE_LIMITS.maxCoordinate };
const positiveRadiusNumber = { type: 'number', exclusiveMinimum: 0, maximum: WORLD_RECIPE_LIMITS.maxRadius };
const scaleNumber = { type: 'number', exclusiveMinimum: 0, maximum: WORLD_RECIPE_LIMITS.maxScale };
const thicknessNumber = { type: 'number', exclusiveMinimum: 0, maximum: WORLD_RECIPE_LIMITS.maxThickness };
const rotationNumber = { type: 'number', minimum: -32 * Math.PI, maximum: 32 * Math.PI };
const noiseAmountNumber = { type: 'number', minimum: 0, maximum: WORLD_RECIPE_LIMITS.maxNoiseAmount };
const probabilityNumber = { type: 'number', minimum: 0, maximum: 0.5 };
const outlierFractionNumber = { type: 'number', minimum: 0, maximum: 0.25 };
const outlierDistanceNumber = { type: 'number', exclusiveMinimum: 0, maximum: WORLD_RECIPE_LIMITS.maxOutlierDistance };
const densityStrengthNumber = { type: 'number', minimum: 0, maximum: 1 };
const densityWeightNumber = { type: 'number', exclusiveMinimum: 0, maximum: WORLD_RECIPE_LIMITS.maxDensityWeight };
const turnsNumber = { type: 'number', exclusiveMinimum: 0, maximum: WORLD_RECIPE_LIMITS.maxTurns };
const vectorSchema = { type: 'array', minItems: 2, maxItems: 2, items: coordinateNumber };
const positiveVectorSchema = { type: 'array', minItems: 2, maxItems: 2, items: scaleNumber };
const stringConstant = (value) => ({ type: 'string', const: value });
const transformSchema = {
  type: 'object', additionalProperties: false,
  properties: { translate: vectorSchema, rotate: rotationNumber, scale: positiveVectorSchema },
  required: ['translate', 'rotate', 'scale'],
};
const densitySchema = {
  anyOf: [
    { type: 'object', additionalProperties: false, properties: { type: stringConstant('uniform') }, required: ['type'] },
    { type: 'object', additionalProperties: false, properties: { type: stringConstant('center-heavy'), strength: densityStrengthNumber }, required: ['type', 'strength'] },
    { type: 'object', additionalProperties: false, properties: { type: stringConstant('edge-heavy'), strength: densityStrengthNumber }, required: ['type', 'strength'] },
    { type: 'object', additionalProperties: false, properties: { type: stringConstant('gradient'), from: densityWeightNumber, to: densityWeightNumber, axis: { type: 'string', enum: ['x', 'path'] } }, required: ['type', 'from', 'to', 'axis'] },
  ],
};
const samplingSchema = {
  type: 'object', additionalProperties: false,
    properties: { count: { type: 'integer', minimum: 0, maximum: WORLD_RECIPE_LIMITS.maxSamplesPerGroupSplit }, density: densitySchema },
  required: ['count', 'density'],
};
const boolean = { type: 'boolean' };
const shapeParams = (properties) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const shapeVariant = (type, properties) => ({
  type: 'object', additionalProperties: false,
  properties: { type: stringConstant(type), params: shapeParams(properties) },
  required: ['type', 'params'],
});
const pointsSchema = { type: 'array', minItems: 2, maxItems: WORLD_RECIPE_LIMITS.maxPointsPerShape, items: vectorSchema };
const shapeSchema = {
  anyOf: [
    shapeVariant('blob', { radius: positiveRadiusNumber, aspect: positiveVectorSchema }),
    shapeVariant('line', { start: vectorSchema, end: vectorSchema, thickness: thicknessNumber }),
    shapeVariant('arc', { radius: positiveRadiusNumber, startAngle: rotationNumber, endAngle: rotationNumber, thickness: thicknessNumber }),
    shapeVariant('ring', { radius: positiveRadiusNumber, thickness: thicknessNumber }),
    shapeVariant('moon', { outerRadius: positiveRadiusNumber, innerRadius: positiveRadiusNumber, innerOffset: vectorSchema, thickness: thicknessNumber }),
    shapeVariant('spiral', { turns: turnsNumber, radius: positiveRadiusNumber, startRadius: { type: 'number', minimum: 0, maximum: WORLD_RECIPE_LIMITS.maxRadius }, thickness: thicknessNumber }),
    shapeVariant('rectangle', { width: { type: 'number', exclusiveMinimum: 0, maximum: WORLD_RECIPE_LIMITS.maxCoordinate * 2 }, height: { type: 'number', exclusiveMinimum: 0, maximum: WORLD_RECIPE_LIMITS.maxCoordinate * 2 }, fill: boolean, thickness: thicknessNumber }),
    shapeVariant('ellipse', { radii: { ...positiveVectorSchema, items: positiveRadiusNumber }, fill: boolean, thickness: thicknessNumber }),
    shapeVariant('polygon', { points: { ...pointsSchema, minItems: 3 }, fill: boolean, thickness: thicknessNumber }),
    shapeVariant('polyline', { points: { ...pointsSchema, minItems: 2 }, thickness: thicknessNumber }),
  ],
};
const regionSchema = {
  anyOf: [
    { type: 'object', additionalProperties: false, properties: { type: stringConstant('bbox'), min: vectorSchema, max: vectorSchema }, required: ['type', 'min', 'max'] },
    { type: 'object', additionalProperties: false, properties: { type: stringConstant('circle'), center: vectorSchema, radius: positiveRadiusNumber }, required: ['type', 'center', 'radius'] },
  ],
};
const localNoiseSchema = {
  anyOf: [
    { type: 'object', additionalProperties: false, properties: { region: regionSchema, kind: stringConstant('position'), amount: noiseAmountNumber }, required: ['region', 'kind', 'amount'] },
    { type: 'object', additionalProperties: false, properties: { region: regionSchema, kind: stringConstant('label'), probability: probabilityNumber }, required: ['region', 'kind', 'probability'] },
  ],
};
const noiseSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    position: { type: 'object', additionalProperties: false, properties: { amount: noiseAmountNumber }, required: ['amount'] },
    label: { type: 'object', additionalProperties: false, properties: { probability: probabilityNumber, policy: { type: 'string', enum: ['flip'] } }, required: ['probability', 'policy'] },
    outliers: { type: 'object', additionalProperties: false, properties: { fraction: outlierFractionNumber, placement: { type: 'string', enum: ['radial', 'bbox'] }, distance: outlierDistanceNumber }, required: ['fraction', 'placement', 'distance'] },
    local: { type: 'array', maxItems: WORLD_RECIPE_LIMITS.maxLocalNoiseRulesPerSplit, items: localNoiseSchema },
  },
  required: ['position', 'label', 'outliers', 'local'],
};

export function worldRecipeJsonSchema() {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      version: { type: 'integer', enum: [WORLD_RECIPE_VERSION] },
      task: { type: 'string', enum: ['classification', 'regression'] },
      coordinateSpace: { type: 'string', enum: [WORLD_RECIPE_COORDINATE_SPACE] },
      groups: {
        type: 'array', minItems: 1, maxItems: WORLD_RECIPE_LIMITS.maxGroups,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$' },
            label: nullable({ type: 'string' }), shape: shapeSchema, transform: transformSchema,
            splitTransforms: { type: 'object', additionalProperties: false, properties: { train: nullable(transformSchema), test: nullable(transformSchema) }, required: ['train', 'test'] },
            sampling: { type: 'object', additionalProperties: false, properties: { train: samplingSchema, test: samplingSchema }, required: ['train', 'test'] },
          },
          required: ['id', 'label', 'shape', 'transform', 'splitTransforms', 'sampling'],
        },
      },
      noise: { type: 'object', additionalProperties: false, properties: { train: noiseSchema, test: noiseSchema }, required: ['train', 'test'] },
    },
    required: ['version', 'task', 'coordinateSpace', 'groups', 'noise'],
  };
}

const patchSplitSchema = { type: 'string', enum: ['all', 'train', 'test'] };
const patchSplitOnlySchema = { type: 'string', enum: ['train', 'test'] };
const patchGroupIdSchema = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$' };
const patchVariant = (type, properties, required) => ({
  type: 'object',
  additionalProperties: false,
  properties: { type: stringConstant(type), ...properties },
  required: ['type', ...required],
});

export function worldRecipePatchJsonSchema() {
  const common = { groupId: patchGroupIdSchema, split: patchSplitSchema };
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      version: { type: 'integer', enum: [WORLD_RECIPE_VERSION] },
      changes: {
        type: 'array', minItems: 1, maxItems: WORLD_RECIPE_LIMITS.maxPatchChanges,
        items: { anyOf: [
          patchVariant('TRANSLATE_GROUP', { ...common, delta: vectorSchema }, ['groupId', 'split', 'delta']),
          patchVariant('ROTATE_GROUP', { ...common, radians: rotationNumber }, ['groupId', 'split', 'radians']),
          patchVariant('SCALE_GROUP', { ...common, scale: positiveVectorSchema }, ['groupId', 'split', 'scale']),
          patchVariant('SET_GROUP_SAMPLING', { groupId: patchGroupIdSchema, split: patchSplitOnlySchema, sampling: samplingSchema }, ['groupId', 'split', 'sampling']),
          patchVariant('SET_GROUP_SAMPLE_COUNT', { groupId: patchGroupIdSchema, split: patchSplitOnlySchema, count: { type: 'integer', minimum: 0, maximum: WORLD_RECIPE_LIMITS.maxSamplesPerGroupSplit } }, ['groupId', 'split', 'count']),
          {
            anyOf: [
              patchVariant('SET_NOISE', { split: { type: 'string', enum: ['train', 'test'] }, kind: stringConstant('position'), amount: noiseAmountNumber }, ['split', 'kind', 'amount']),
              patchVariant('SET_NOISE', { split: { type: 'string', enum: ['train', 'test'] }, kind: stringConstant('label'), probability: probabilityNumber }, ['split', 'kind', 'probability']),
            ],
          },
          patchVariant('SET_OUTLIERS', { split: { type: 'string', enum: ['train', 'test'] }, fraction: outlierFractionNumber, placement: { type: 'string', enum: ['radial', 'bbox'] }, distance: outlierDistanceNumber }, ['split', 'fraction', 'placement', 'distance']),
          patchVariant('SET_LOCAL_NOISE', { split: { type: 'string', enum: ['train', 'test'] }, local: { type: 'array', maxItems: WORLD_RECIPE_LIMITS.maxLocalNoiseRulesPerSplit, items: localNoiseSchema } }, ['split', 'local']),
        ] },
      },
    },
    required: ['version', 'changes'],
  };
}

function groupFor(recipe, groupId) {
  const group = recipe.groups.find((item) => item.id === String(groupId));
  if (!group) throw worldRecipeError('EXPLORATION_WORLD_RECIPE_GROUP_NOT_FOUND', { groupId });
  return group;
}

function splitFor(value, field, { allowAll = false, errorCode = 'EXPLORATION_INVALID_WORLD_RECIPE' } = {}) {
  const allowed = allowAll ? ['all', 'train', 'test'] : ['train', 'test'];
  if (!allowed.includes(value)) throw worldRecipeError(errorCode, { field, value });
  return value;
}

function changeValue(change, field) {
  return finite(change, field, { min: -32 * Math.PI, max: 32 * Math.PI });
}

export function applyWorldRecipePatch(recipe, patch) {
  const normalized = normalizeWorldRecipe(recipe);
  const source = plainObject(patch, 'patch');
  allowedKeys(source, ['version', 'changes'], 'patch');
  if (source.version !== WORLD_RECIPE_VERSION || !Array.isArray(source.changes) || source.changes.length < 1 || source.changes.length > WORLD_RECIPE_LIMITS.maxPatchChanges) {
    throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE_PATCH', { field: 'patch' });
  }
  const next = clone(normalized);
  for (const [index, rawChange] of source.changes.entries()) {
    const change = plainObject(rawChange, `patch.changes[${index}]`);
    const type = change.type;
    if (!WORLD_RECIPE_PATCH_TYPES.includes(type)) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE_PATCH', { field: `patch.changes[${index}].type`, value: type });
    const allowed = {
      TRANSLATE_GROUP: ['type', 'groupId', 'split', 'delta'],
      ROTATE_GROUP: ['type', 'groupId', 'split', 'radians'],
      SCALE_GROUP: ['type', 'groupId', 'split', 'scale'],
      SET_GROUP_SAMPLING: ['type', 'groupId', 'split', 'sampling'],
      SET_GROUP_SAMPLE_COUNT: ['type', 'groupId', 'split', 'count'],
      SET_NOISE: ['type', 'split', 'kind', 'amount', 'probability'],
      SET_OUTLIERS: ['type', 'split', 'fraction', 'placement', 'distance'],
      SET_LOCAL_NOISE: ['type', 'split', 'local'],
    }[type];
    patchAllowedKeys(change, allowed, `patch.changes[${index}]`);
    const required = type === 'TRANSLATE_GROUP'
      ? ['groupId', 'split', 'delta']
      : type === 'ROTATE_GROUP' ? ['groupId', 'split', 'radians']
        : type === 'SCALE_GROUP' ? ['groupId', 'split', 'scale']
      : type === 'SET_GROUP_SAMPLING' ? ['groupId', 'sampling']
        : type === 'SET_GROUP_SAMPLE_COUNT' ? ['groupId', 'count']
          : type === 'SET_NOISE' ? ['kind']
            : type === 'SET_OUTLIERS' ? ['fraction', 'placement', 'distance']
              : ['local'];
    for (const key of required) {
      if (change[key] === undefined) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE_PATCH', { field: `patch.changes[${index}].${key}`, reason: 'required' });
    }
    const split = ['SET_NOISE', 'SET_OUTLIERS', 'SET_LOCAL_NOISE', 'SET_GROUP_SAMPLING', 'SET_GROUP_SAMPLE_COUNT'].includes(type)
      ? splitFor(change.split, `patch.changes[${index}].split`, { errorCode: 'EXPLORATION_INVALID_WORLD_RECIPE_PATCH' })
      : splitFor(change.split, `patch.changes[${index}].split`, { allowAll: true, errorCode: 'EXPLORATION_INVALID_WORLD_RECIPE_PATCH' });
    const group = type === 'SET_NOISE' || type === 'SET_OUTLIERS' || type === 'SET_LOCAL_NOISE' ? null : groupFor(next, change.groupId);
    const transformPatch = ['TRANSLATE_GROUP', 'ROTATE_GROUP', 'SCALE_GROUP'].includes(type);
    const target = transformPatch && group && split !== 'all'
      ? (group.splitTransforms[split] ??= normalizeTransform({}, `patch.changes[${index}].splitTransform`))
      : group?.transform;
    if (type === 'TRANSLATE_GROUP') {
      const delta = vector2(change.delta, `patch.changes[${index}].delta`);
      target.translate = target.translate.map((value, itemIndex) => value + delta[itemIndex]);
    } else if (type === 'ROTATE_GROUP') target.rotate += changeValue(change.radians, `patch.changes[${index}].radians`);
    else if (type === 'SCALE_GROUP') {
      const scale = vector2(change.scale, `patch.changes[${index}].scale`, { positiveValues: true, max: WORLD_RECIPE_LIMITS.maxScale });
      target.scale = target.scale.map((value, itemIndex) => value * scale[itemIndex]);
    } else if (type === 'SET_GROUP_SAMPLING') {
      group.sampling[split] = normalizeSampling(change.sampling, `patch.changes[${index}].sampling`);
      validateDensityForShape(group.sampling[split].density, group.shape, `patch.changes[${index}].sampling.density`);
    } else if (type === 'SET_GROUP_SAMPLE_COUNT') {
      group.sampling[split].count = integer(change.count, `patch.changes[${index}].count`, 0, WORLD_RECIPE_LIMITS.maxSamplesPerGroupSplit);
    } else if (type === 'SET_NOISE') {
      if (!['position', 'label'].includes(change.kind)) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE_PATCH', { field: `patch.changes[${index}].kind` });
      if ((change.kind === 'position' && change.probability !== undefined) || (change.kind === 'label' && change.amount !== undefined)) {
        throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE_PATCH', { field: `patch.changes[${index}]`, reason: 'wrong-noise-property' });
      }
      if ((change.kind === 'position' && change.amount === undefined) || (change.kind === 'label' && change.probability === undefined)) {
        throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE_PATCH', { field: `patch.changes[${index}]`, reason: 'missing-noise-value' });
      }
      const noise = normalizeNoise({ ...next.noise[split], [change.kind]: change.kind === 'position' ? { amount: change.amount } : { probability: change.probability, policy: 'flip' } }, `patch.changes[${index}]`);
      next.noise[split] = noise;
    } else if (type === 'SET_OUTLIERS') {
      next.noise[split] = normalizeNoise({ ...next.noise[split], outliers: { fraction: change.fraction, placement: change.placement, distance: change.distance } }, `patch.changes[${index}]`);
    } else if (type === 'SET_LOCAL_NOISE') {
      const local = change.local;
      if (!Array.isArray(local)) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE_PATCH', { field: `patch.changes[${index}].local` });
      next.noise[split] = normalizeNoise({ ...next.noise[split], local }, `patch.changes[${index}]`);
    }
  }
  return normalizeWorldRecipe(next);
}

function flatten(value, prefix, output) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value).sort()) flatten(value[key], `${prefix}.${key}`, output);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}.${index}`, output));
    return output;
  }
  output[prefix] = value;
  return output;
}

export function worldRecipeDiff(leftRecipe, rightRecipe) {
  const normalizedLeft = normalizeWorldRecipe(leftRecipe);
  const normalizedRight = normalizeWorldRecipe(rightRecipe);
  const rewriteGroupPath = (path, recipe) => path.replace(/^\.groups\.(\d+)(?=\.|$)/, (_, index) => `.groups.${recipe.groups[Number(index)]?.id ?? index}`);
  const left = Object.fromEntries(Object.entries(flatten(normalizedLeft, '', {})).map(([path, value]) => [rewriteGroupPath(path, normalizedLeft), value]));
  const right = Object.fromEntries(Object.entries(flatten(normalizedRight, '', {})).map(([path, value]) => [rewriteGroupPath(path, normalizedRight), value]));
  const allPaths = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const changedPaths = allPaths.filter((path) => JSON.stringify(left[path]) !== JSON.stringify(right[path]));
  const unchangedPaths = allPaths.filter((path) => JSON.stringify(left[path]) === JSON.stringify(right[path]));
  const affectedGroupIds = [...new Set(changedPaths.map((path) => path.match(/^\.groups\.([^\.]+)/)?.[1]).filter(Boolean))];
  return { changedPaths, unchangedPaths, affectedGroupIds, left, right };
}

export function worldRecipePathSemanticDomain(path) {
  if (path === '.task') return 'task';
  if (path === '.coordinateSpace') return 'coordinate-space';
  if (path.startsWith('.groups.')) {
    if (path.includes('.shape.')) return 'group-shape';
    if (path.includes('.transform.')) return 'group-transform';
    const splitTransform = path.match(/\.splitTransforms\.(train|test)(?:\.|$)/);
    if (splitTransform) return `group-split-transform:${splitTransform[1]}`;
    if (path.includes('.sampling.') && path.endsWith('.count')) return 'group-sampling-count';
    if (path.includes('.sampling.') && path.includes('.density.')) return 'group-sampling-density';
    if (path.endsWith('.label')) return 'labels';
  }
  const noise = path.match(/^\.noise\.(train|test)\.(position|label|outliers|local)/);
  if (noise) return `${noise[1]}-${noise[2]}${noise[2] === 'outliers' || noise[2] === 'local' ? '' : '-noise'}`;
  return 'whole-recipe';
}

export function worldRecipeSemanticDomainsForPaths(paths = []) {
  return [...new Set(paths.map(worldRecipePathSemanticDomain))];
}

export function worldRecipeSemanticDomains(recipe) {
  const normalized = normalizeWorldRecipe(recipe);
  const paths = Object.keys(flatten(normalized, '', {}));
  return worldRecipeSemanticDomainsForPaths(paths);
}

export function worldRecipePatchSemanticDomains(recipe, patch) {
  const next = applyWorldRecipePatch(recipe, patch);
  return worldRecipeSemanticDomainsForPaths(worldRecipeDiff(recipe, next).changedPaths);
}

export function worldRecipePatchChangedPaths(recipe, patch) {
  const normalized = normalizeWorldRecipe(recipe);
  const next = applyWorldRecipePatch(normalized, patch);
  return worldRecipeDiff(normalized, next).changedPaths;
}

export function worldRecipeSummary(recipe) {
  const normalized = normalizeWorldRecipe(recipe);
  return {
    version: normalized.version,
    task: normalized.task,
    groupCount: normalized.groups.length,
    groups: normalized.groups.map((group) => ({
      id: group.id,
      label: group.label,
      shapeType: group.shape.type,
      transform: clone(group.transform),
      splitTransforms: clone(group.splitTransforms),
      trainSamples: group.sampling.train.count,
      testSamples: group.sampling.test.count,
      trainDensity: clone(group.sampling.train.density),
      testDensity: clone(group.sampling.test.density),
    })),
    noise: clone(normalized.noise),
    totalSamples: normalized.groups.reduce((sum, group) => sum + group.sampling.train.count + group.sampling.test.count, 0),
  };
}
