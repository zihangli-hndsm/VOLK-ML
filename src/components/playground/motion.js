export const DEFAULT_MOTION_POLICY = Object.freeze({
  enter: 220,
  update: 320,
  exit: 180,
  highlight: 280,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
});

const isObject = (value) => value !== null && typeof value === 'object';

export function clampMotionDuration(requestedMs, stepDurationMs, {
  enabled = true,
  reducedMotion = false,
} = {}) {
  if (!enabled || reducedMotion) return 0;
  const requested = Number.isFinite(requestedMs) ? Math.max(0, requestedMs) : DEFAULT_MOTION_POLICY.update;
  if (!Number.isFinite(stepDurationMs)) return requested;
  return Math.min(requested, Math.max(0, stepDurationMs));
}

export function resolveMotionConfig(snapshot, reducedMotion = false) {
  const step = snapshot?.scriptState?.step ?? snapshot?.timeline?.step ?? 0;
  const stepDuration = snapshot?.script?.steps?.[step]?.durationMs;
  const speed = Math.max(0.25, Number(snapshot?.timeline?.speed) || 1);
  const availableDuration = Number.isFinite(stepDuration) ? stepDuration / speed : undefined;
  return {
    enabled: true,
    durationMs: clampMotionDuration(DEFAULT_MOTION_POLICY.update, availableDuration, { reducedMotion }),
    easing: DEFAULT_MOTION_POLICY.easing,
    reducedMotion,
  };
}

export function stableMotionIdentity(value, index = 0) {
  if (!isObject(value)) return `index:${index}`;
  if (value.id !== undefined && value.id !== null) return `id:${value.id}`;
  if (value.pointId !== undefined && value.pointId !== null) return `point:${value.pointId}`;
  if (value.step !== undefined && value.step !== null) return `step:${value.step}`;
  if (value.row !== undefined && value.column !== undefined) return `cell:${value.row}:${value.column}`;
  if (value.source !== undefined && value.target !== undefined) return `edge:${value.source}:${value.target}`;
  return `index:${index}`;
}

const interpolateNumber = (from, to, progress) => from + (to - from) * progress;

function interpolateArray(from = [], to = [], progress) {
  const objectArray = from.some(isObject) || to.some(isObject);
  if (!objectArray) {
    return Array.from({ length: Math.max(from.length, to.length) }, (_, index) => {
      const fromValue = from[index];
      const toValue = to[index];
      if (typeof fromValue === 'number' && typeof toValue === 'number') return interpolateNumber(fromValue, toValue, progress);
      return toValue === undefined ? fromValue : toValue;
    }).filter((value) => value !== undefined);
  }
  const fromById = new Map(from.map((value, index) => [stableMotionIdentity(value, index), value]));
  const toById = new Map(to.map((value, index) => [stableMotionIdentity(value, index), value]));
  const orderedIds = [...to.map((value, index) => stableMotionIdentity(value, index)), ...from.map((value, index) => stableMotionIdentity(value, index))]
    .filter((id, index, all) => all.indexOf(id) === index);
  return orderedIds.map((id) => {
    const fromValue = fromById.get(id);
    const toValue = toById.get(id);
    const value = interpolateValue(fromValue, toValue, progress);
    if (!isObject(value)) return value;
    if (!fromValue) return { ...value, motionOpacity: progress };
    if (!toValue) return { ...value, motionOpacity: 1 - progress };
    return value;
  });
}

export function interpolateValue(from, to, progress) {
  if (progress <= 0) return from === undefined ? to : from;
  if (progress >= 1) return to === undefined ? from : to;
  if (typeof from === 'number' && typeof to === 'number') return interpolateNumber(from, to, progress);
  if (Array.isArray(from) || Array.isArray(to)) return interpolateArray(from ?? [], to ?? [], progress);
  if (isObject(from) || isObject(to)) {
    const fromObject = isObject(from) ? from : {};
    const toObject = isObject(to) ? to : {};
    const keys = new Set([...Object.keys(fromObject), ...Object.keys(toObject)]);
    return Object.fromEntries([...keys]
      .map((key) => [key, interpolateValue(fromObject[key], toObject[key], progress)])
      .filter(([, value]) => value !== undefined));
  }
  return to === undefined ? from : to;
}

function withPrimitiveMotionOpacity(primitive, opacity) {
  return {
    ...primitive,
    props: { ...(primitive.props ?? {}), motionOpacity: opacity },
  };
}

export function interpolatePrimitiveList(from = [], to = [], progress = 1) {
  if (progress >= 1) return to;
  const fromById = new Map(from.map((primitive) => [primitive.id, primitive]));
  const toById = new Map(to.map((primitive) => [primitive.id, primitive]));
  const orderedIds = [...to.map((primitive) => primitive.id), ...from.map((primitive) => primitive.id)]
    .filter((id, index, all) => all.indexOf(id) === index);
  return orderedIds.map((id) => {
    const previous = fromById.get(id);
    const current = toById.get(id);
    if (!previous) return withPrimitiveMotionOpacity(current, progress);
    if (!current) return withPrimitiveMotionOpacity(previous, 1 - progress);
    return withPrimitiveMotionOpacity({
      ...current,
      props: interpolateValue(previous.props ?? {}, current.props ?? {}, progress),
    }, 1);
  });
}
