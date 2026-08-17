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
});

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

function finite(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, value });
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

function positive(value, field) {
  const number = finite(value, field);
  if (number <= 0) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, value, reason: 'must-be-positive' });
  return number;
}

function vector2(value, field, { positiveValues = false } = {}) {
  if (!Array.isArray(value) || value.length !== 2) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field });
  return value.map((item, index) => positiveValues ? positive(item, `${field}[${index}]`) : finite(item, `${field}[${index}]`));
}

function normalizeTransform(value, field = 'transform') {
  const source = value ?? {};
  plainObject(source, field);
  allowedKeys(source, ['translate', 'rotate', 'scale'], field);
  return {
    translate: vector2(source.translate ?? [0, 0], `${field}.translate`),
    rotate: finite(source.rotate ?? 0, `${field}.rotate`),
    scale: vector2(source.scale ?? [1, 1], `${field}.scale`, { positiveValues: true }),
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
    return { type, strength: Math.min(1, Math.max(0, finite(source.strength ?? 0.6, `${field}.strength`))) };
  }
  const from = positive(source.from ?? 0.2, `${field}.from`);
  const to = positive(source.to ?? 2, `${field}.to`);
  if (!['x', 'path'].includes(source.axis ?? 'x')) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: `${field}.axis` });
  return { type, from, to, axis: source.axis ?? 'x' };
}

function polygonArea(points) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
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
    normalized = { radius: positive(params.radius ?? 1, `${field}.params.radius`), aspect: vector2(params.aspect ?? [1, 1], `${field}.params.aspect`, { positiveValues: true }) };
  } else if (type === 'line') {
    allowedKeys(params, ['start', 'end', 'thickness'], `${field}.params`);
    const start = vector2(params.start ?? [-1, 0], `${field}.params.start`);
    const end = vector2(params.end ?? [1, 0], `${field}.params.end`);
    if (start[0] === end[0] && start[1] === end[1]) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, reason: 'degenerate-line' });
    normalized = { start, end, thickness: positive(params.thickness ?? 0.12, `${field}.params.thickness`) };
  } else if (type === 'arc') {
    allowedKeys(params, ['radius', 'startAngle', 'endAngle', 'thickness'], `${field}.params`);
    normalized = {
      radius: positive(params.radius ?? 1, `${field}.params.radius`),
      startAngle: finite(params.startAngle ?? 0, `${field}.params.startAngle`),
      endAngle: finite(params.endAngle ?? Math.PI, `${field}.params.endAngle`),
      thickness: positive(params.thickness ?? 0.12, `${field}.params.thickness`),
    };
  } else if (type === 'ring') {
    allowedKeys(params, ['radius', 'thickness'], `${field}.params`);
    const radius = positive(params.radius ?? 1, `${field}.params.radius`);
    const thickness = positive(params.thickness ?? 0.15, `${field}.params.thickness`);
    if (thickness >= radius * 2) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, reason: 'ring-thickness-too-large' });
    normalized = { radius, thickness };
  } else if (type === 'moon') {
    allowedKeys(params, ['outerRadius', 'innerRadius', 'innerOffset', 'thickness'], `${field}.params`);
    const outerRadius = positive(params.outerRadius ?? 1, `${field}.params.outerRadius`);
    const innerRadius = positive(params.innerRadius ?? 0.8, `${field}.params.innerRadius`);
    if (innerRadius >= outerRadius) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, reason: 'moon-radii-invalid' });
    normalized = {
      outerRadius,
      innerRadius,
      innerOffset: vector2(params.innerOffset ?? [0.45, 0], `${field}.params.innerOffset`),
      thickness: positive(params.thickness ?? 0.02, `${field}.params.thickness`),
    };
  } else if (type === 'spiral') {
    allowedKeys(params, ['turns', 'radius', 'startRadius', 'thickness'], `${field}.params`);
    normalized = {
      turns: positive(params.turns ?? 1.5, `${field}.params.turns`),
      radius: positive(params.radius ?? 1, `${field}.params.radius`),
      startRadius: Math.max(0, finite(params.startRadius ?? 0.05, `${field}.params.startRadius`)),
      thickness: positive(params.thickness ?? 0.12, `${field}.params.thickness`),
    };
  } else if (type === 'rectangle') {
    allowedKeys(params, ['width', 'height', 'fill', 'thickness'], `${field}.params`);
    normalized = {
      width: positive(params.width ?? 2, `${field}.params.width`),
      height: positive(params.height ?? 2, `${field}.params.height`),
      fill: params.fill !== false,
      thickness: positive(params.thickness ?? 0.12, `${field}.params.thickness`),
    };
  } else if (type === 'ellipse') {
    allowedKeys(params, ['radii', 'fill', 'thickness'], `${field}.params`);
    normalized = {
      radii: vector2(params.radii ?? [1.5, 0.8], `${field}.params.radii`, { positiveValues: true }),
      fill: params.fill !== false,
      thickness: positive(params.thickness ?? 0.12, `${field}.params.thickness`),
    };
  } else if (type === 'polygon') {
    allowedKeys(params, ['points', 'fill', 'thickness'], `${field}.params`);
    if (!Array.isArray(params.points) || params.points.length < 3 || params.points.length > WORLD_RECIPE_LIMITS.maxPointsPerShape) {
      throw worldRecipeError('EXPLORATION_RESOURCE_LIMIT', { field: `${field}.params.points`, max: WORLD_RECIPE_LIMITS.maxPointsPerShape });
    }
    const points = params.points.map((point, index) => vector2(point, `${field}.params.points[${index}]`));
    if (Math.abs(polygonArea(points)) < 1e-9) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, reason: 'degenerate-polygon' });
    normalized = { points, fill: params.fill !== false, thickness: positive(params.thickness ?? 0.12, `${field}.params.thickness`) };
  } else {
    allowedKeys(params, ['points', 'thickness'], `${field}.params`);
    if (!Array.isArray(params.points) || params.points.length < 2 || params.points.length > WORLD_RECIPE_LIMITS.maxPointsPerShape) {
      throw worldRecipeError('EXPLORATION_RESOURCE_LIMIT', { field: `${field}.params.points`, max: WORLD_RECIPE_LIMITS.maxPointsPerShape });
    }
    const points = params.points.map((point, index) => vector2(point, `${field}.params.points[${index}]`));
    if (pathLength(points) <= 0) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, reason: 'degenerate-polyline' });
    normalized = { points, thickness: positive(params.thickness ?? 0.12, `${field}.params.thickness`) };
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
  if (source.type === 'circle') return { type: 'circle', center: vector2(source.center ?? [0, 0], `${field}.center`), radius: positive(source.radius ?? 1, `${field}.radius`) };
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
  const amount = finite(position.amount ?? 0, `${field}.position.amount`);
  const probability = finite(label.probability ?? 0, `${field}.label.probability`);
  const fraction = finite(outliers.fraction ?? 0, `${field}.outliers.fraction`);
  if (amount < 0 || probability < 0 || probability > 0.5 || fraction < 0 || fraction > 0.25) {
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
    outliers: { fraction, placement, distance: positive(outliers.distance ?? 2, `${field}.outliers.distance`) },
    local: local.map((rule, index) => {
      const item = plainObject(rule, `${field}.local[${index}]`);
      allowedKeys(item, ['region', 'kind', 'amount', 'probability'], `${field}.local[${index}]`);
      if (!['position', 'label'].includes(item.kind)) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field: `${field}.local[${index}].kind` });
      const value = finite(item.kind === 'position' ? item.amount ?? 0 : item.probability ?? 0, `${field}.local[${index}].${item.kind === 'position' ? 'amount' : 'probability'}`);
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
    const sampling = plainObject(item.sampling ?? {}, `groups[${index}].sampling`);
    allowedKeys(sampling, ['train', 'test'], `groups[${index}].sampling`);
    const splitTransforms = plainObject(item.splitTransforms ?? {}, `groups[${index}].splitTransforms`);
    allowedKeys(splitTransforms, ['train', 'test'], `groups[${index}].splitTransforms`);
    return {
      id,
      label,
      shape: normalizeShape(item.shape, `groups[${index}].shape`),
      transform: normalizeTransform(item.transform, `groups[${index}].transform`),
      splitTransforms: {
        train: splitTransforms.train === null || splitTransforms.train === undefined ? null : normalizeTransform(splitTransforms.train, `groups[${index}].splitTransforms.train`),
        test: splitTransforms.test === null || splitTransforms.test === undefined ? null : normalizeTransform(splitTransforms.test, `groups[${index}].splitTransforms.test`),
      },
      sampling: {
        train: normalizeSampling(sampling.train, `groups[${index}].sampling.train`),
        test: normalizeSampling(sampling.test, `groups[${index}].sampling.test`),
      },
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

const number = { type: 'number' };
const vectorSchema = { type: 'array', minItems: 2, maxItems: 2, items: number };
const transformSchema = {
  type: 'object', additionalProperties: false,
  properties: { translate: vectorSchema, rotate: number, scale: vectorSchema },
  required: ['translate', 'rotate', 'scale'],
};
const densitySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    type: { type: 'string', enum: WORLD_RECIPE_DENSITY_TYPES },
    strength: nullable(number), from: nullable(number), to: nullable(number), axis: nullable({ type: 'string', enum: ['x', 'path'] }),
  },
  required: ['type', 'strength', 'from', 'to', 'axis'],
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
  properties: { type: { const: type }, params: shapeParams(properties) },
  required: ['type', 'params'],
});
const pointsSchema = { type: 'array', minItems: 2, maxItems: WORLD_RECIPE_LIMITS.maxPointsPerShape, items: vectorSchema };
const shapeSchema = {
  anyOf: [
    shapeVariant('blob', { radius: number, aspect: vectorSchema }),
    shapeVariant('line', { start: vectorSchema, end: vectorSchema, thickness: number }),
    shapeVariant('arc', { radius: number, startAngle: number, endAngle: number, thickness: number }),
    shapeVariant('ring', { radius: number, thickness: number }),
    shapeVariant('moon', { outerRadius: number, innerRadius: number, innerOffset: vectorSchema, thickness: number }),
    shapeVariant('spiral', { turns: number, radius: number, startRadius: number, thickness: number }),
    shapeVariant('rectangle', { width: number, height: number, fill: boolean, thickness: number }),
    shapeVariant('ellipse', { radii: vectorSchema, fill: boolean, thickness: number }),
    shapeVariant('polygon', { points: { ...pointsSchema, minItems: 3 }, fill: boolean, thickness: number }),
    shapeVariant('polyline', { points: { ...pointsSchema, minItems: 2 }, thickness: number }),
  ],
};
const regionSchema = {
  anyOf: [
    { type: 'object', additionalProperties: false, properties: { type: { const: 'bbox' }, min: vectorSchema, max: vectorSchema }, required: ['type', 'min', 'max'] },
    { type: 'object', additionalProperties: false, properties: { type: { const: 'circle' }, center: vectorSchema, radius: number }, required: ['type', 'center', 'radius'] },
  ],
};
const localNoiseSchema = {
  anyOf: [
    { type: 'object', additionalProperties: false, properties: { region: regionSchema, kind: { const: 'position' }, amount: number }, required: ['region', 'kind', 'amount'] },
    { type: 'object', additionalProperties: false, properties: { region: regionSchema, kind: { const: 'label' }, probability: number }, required: ['region', 'kind', 'probability'] },
  ],
};
const noiseSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    position: { type: 'object', additionalProperties: false, properties: { amount: number }, required: ['amount'] },
    label: { type: 'object', additionalProperties: false, properties: { probability: number, policy: { type: 'string', enum: ['flip'] } }, required: ['probability', 'policy'] },
    outliers: { type: 'object', additionalProperties: false, properties: { fraction: number, placement: { type: 'string', enum: ['radial', 'bbox'] }, distance: number }, required: ['fraction', 'placement', 'distance'] },
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

function groupFor(recipe, groupId) {
  const group = recipe.groups.find((item) => item.id === String(groupId));
  if (!group) throw worldRecipeError('EXPLORATION_WORLD_RECIPE_GROUP_NOT_FOUND', { groupId });
  return group;
}

function splitFor(value, field) {
  if (!['train', 'test'].includes(value)) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, value });
  return value;
}

function changeValue(change, field) {
  const value = Number(change);
  if (!Number.isFinite(value)) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE', { field, value: change });
  return value;
}

export function applyWorldRecipePatch(recipe, patch) {
  const normalized = normalizeWorldRecipe(recipe);
  const source = plainObject(patch, 'patch');
  allowedKeys(source, ['version', 'changes'], 'patch');
  if (source.version !== WORLD_RECIPE_VERSION || !Array.isArray(source.changes) || source.changes.length > WORLD_RECIPE_LIMITS.maxPatchChanges) {
    throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE_PATCH', { field: 'patch' });
  }
  const next = clone(normalized);
  for (const [index, rawChange] of source.changes.entries()) {
    const change = plainObject(rawChange, `patch.changes[${index}]`);
    const type = change.type;
    if (!WORLD_RECIPE_PATCH_TYPES.includes(type)) throw worldRecipeError('EXPLORATION_INVALID_WORLD_RECIPE_PATCH', { field: `patch.changes[${index}].type`, value: type });
    const group = type === 'SET_NOISE' || type === 'SET_OUTLIERS' || type === 'SET_LOCAL_NOISE' ? null : groupFor(next, change.groupId);
    if (type === 'TRANSLATE_GROUP') {
      const delta = vector2(change.delta, `patch.changes[${index}].delta`);
      group.transform.translate = group.transform.translate.map((value, itemIndex) => value + delta[itemIndex]);
    } else if (type === 'ROTATE_GROUP') group.transform.rotate += changeValue(change.radians, `patch.changes[${index}].radians`);
    else if (type === 'SCALE_GROUP') {
      const scale = vector2(change.scale, `patch.changes[${index}].scale`, { positiveValues: true });
      group.transform.scale = group.transform.scale.map((value, itemIndex) => value * scale[itemIndex]);
    } else if (type === 'SET_GROUP_SAMPLING') {
      const split = splitFor(change.split, `patch.changes[${index}].split`);
      group.sampling[split] = normalizeSampling(change.sampling, `patch.changes[${index}].sampling`);
    } else if (type === 'SET_GROUP_SAMPLE_COUNT') {
      const split = splitFor(change.split, `patch.changes[${index}].split`);
      group.sampling[split].count = integer(change.count, `patch.changes[${index}].count`, 0, WORLD_RECIPE_LIMITS.maxSamplesPerGroupSplit);
    } else if (type === 'SET_NOISE') {
      const split = splitFor(change.split, `patch.changes[${index}].split`);
      const noise = normalizeNoise({ ...next.noise[split], [change.kind]: change.kind === 'position' ? { amount: change.amount } : { probability: change.probability, policy: 'flip' } }, `patch.changes[${index}]`);
      next.noise[split] = noise;
    } else if (type === 'SET_OUTLIERS') {
      const split = splitFor(change.split, `patch.changes[${index}].split`);
      next.noise[split] = normalizeNoise({ ...next.noise[split], outliers: { fraction: change.fraction, placement: change.placement, distance: change.distance } }, `patch.changes[${index}]`);
    } else if (type === 'SET_LOCAL_NOISE') {
      const split = splitFor(change.split, `patch.changes[${index}].split`);
      const local = Array.isArray(change.local) ? change.local : [change.local];
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
      trainSamples: group.sampling.train.count,
      testSamples: group.sampling.test.count,
    })),
    totalSamples: normalized.groups.reduce((sum, group) => sum + group.sampling.train.count + group.sampling.test.count, 0),
  };
}
