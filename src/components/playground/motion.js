// One small presentation contract is shared by primitive motion and the
// Explore shell. These are deliberately presentation values: they never
// participate in runtime dispatch or semantic state.
export const MOTION_TOKENS = Object.freeze({
  fast: 120,
  normal: 220,
  emphasis: 320,
});

export const MOTION_EASINGS = Object.freeze({
  standard: 'ease-out-cubic',
  emphasis: 'ease-in-out-cubic',
});

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export const DEFAULT_MOTION_POLICY = Object.freeze({
  enter: MOTION_TOKENS.normal,
  update: MOTION_TOKENS.emphasis,
  exit: MOTION_TOKENS.fast,
  highlight: MOTION_TOKENS.normal,
  easing: MOTION_EASINGS.standard,
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

export function resolveMotionConfig(snapshot, reducedMotion = false, { token = 'emphasis' } = {}) {
  const step = snapshot?.scriptState?.step ?? snapshot?.timeline?.step ?? 0;
  const stepDuration = snapshot?.script?.steps?.[step]?.durationMs;
  const speed = Math.max(0.25, Number(snapshot?.timeline?.speed) || 1);
  const availableDuration = Number.isFinite(stepDuration) ? stepDuration / speed : undefined;
  const requestedDuration = MOTION_TOKENS[token] ?? DEFAULT_MOTION_POLICY.update;
  return {
    enabled: true,
    token,
    durationMs: clampMotionDuration(requestedDuration, availableDuration, { reducedMotion }),
    easing: MOTION_EASINGS.standard,
    reducedMotion,
  };
}

export function easeMotionProgress(progress, easing = DEFAULT_MOTION_POLICY.easing) {
  const clamped = Math.min(1, Math.max(0, progress));
  if (easing === 'linear') return clamped;
  if (easing === 'ease-in-out-cubic') {
    return clamped < 0.5
      ? 4 * clamped ** 3
      : 1 - ((-2 * clamped + 2) ** 3) / 2;
  }
  if (easing === 'ease-out-cubic') return 1 - ((1 - clamped) ** 3);
  return clamped;
}

export function getVisiblePrimitives(snapshot, placement = 'stage') {
  const layout = snapshot?.script?.layout?.[placement] ?? [];
  const visualState = snapshot?.visualState ?? {};
  return (snapshot?.primitives ?? []).filter((primitive) => (
    layout.includes(primitive.id) && visualState[primitive.id] !== false
  ));
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

function withPrimitiveMotionOpacity(primitive, opacity, progress) {
  return {
    ...primitive,
    props: { ...(primitive.props ?? {}), motionOpacity: opacity, motionProgress: progress },
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
    if (!previous) return withPrimitiveMotionOpacity(current, progress, progress);
    if (!current) return withPrimitiveMotionOpacity(previous, 1 - progress, progress);
    return withPrimitiveMotionOpacity({
      ...current,
      props: interpolateValue(previous.props ?? {}, current.props ?? {}, progress),
    }, 1, progress);
  });
}
