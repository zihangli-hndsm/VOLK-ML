// Explicit presentation target registry. Targets are registered by the owning
// course controls; this module never queries the DOM or dispatches actions.
export const LUMI_SEMANTIC_TARGETS = Object.freeze({
  WORLD_CANVAS: 'world.canvas',
  WORLD_SAMPLE: 'world.sample',
  MODEL_FIT: 'model.fit',
  EXPERIMENT_DUPLICATE: 'experiment.duplicate',
  EXPERIMENT_COMPARE: 'experiment.compare',
  EVIDENCE_CURRENT: 'evidence.current',
  IDEAS_MAP: 'ideas.map',
  CONTINUATION_NEXT: 'continuation.next',
});

const ALLOWLIST = new Set(Object.values(LUMI_SEMANTIC_TARGETS));
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const bounds = (rect) => ({ left: finite(rect?.left) ?? 0, top: finite(rect?.top) ?? 0, right: finite(rect?.right) ?? ((finite(rect?.left) ?? 0) + (finite(rect?.width) ?? 0)), bottom: finite(rect?.bottom) ?? ((finite(rect?.top) ?? 0) + (finite(rect?.height) ?? 0)) });
const intersect = (left, right) => ({ left: Math.max(left.left, right.left), top: Math.max(left.top, right.top), right: Math.min(left.right, right.right), bottom: Math.min(left.bottom, right.bottom) });
const area = (rect) => Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);

function isHiddenByStyle(element, view) {
  if (!view?.getComputedStyle) return false;
  for (let current = element; current; current = current.parentElement) {
    const style = view.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return true;
  }
  return false;
}

function clippedBounds(element, viewport) {
  let visible = bounds(viewport.rect ?? { left: 0, top: 0, width: viewport.width, height: viewport.height });
  const view = element?.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : null);
  for (let parent = element?.parentElement; parent; parent = parent.parentElement) {
    if (parent === viewport.element) break;
    const style = view?.getComputedStyle?.(parent);
    if (!style || !['hidden', 'clip', 'auto', 'scroll'].some((value) => style.overflowX === value || style.overflowY === value)) continue;
    const rect = parent.getBoundingClientRect?.();
    if (rect) visible = intersect(visible, bounds(rect));
  }
  return visible;
}

export function isLumiSemanticTarget(value) {
  return ALLOWLIST.has(value);
}

export function resolveLumiTargetEntries(entries = [], key, viewport = {}) {
  if (!isLumiSemanticTarget(key)) return { status: 'unsupported', target: null };
  const matches = entries.filter((entry) => entry?.key === key && entry?.current !== false);
  if (matches.length !== 1) return { status: matches.length ? 'ambiguous' : 'missing', target: null };
  const entry = matches[0];
  const element = entry.ref?.current ?? null;
  if (!element || entry.enabled === false || entry.visible === false || element.disabled === true) return { status: 'unavailable', target: null };
  const rect = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null;
  if (!rect) return { status: 'unavailable', target: null };
  const width = finite(viewport.width) ?? (typeof window !== 'undefined' ? window.innerWidth : 0);
  const height = finite(viewport.height) ?? (typeof window !== 'undefined' ? window.innerHeight : 0);
  const geometry = Object.freeze({ left: finite(rect.left) ?? 0, top: finite(rect.top) ?? 0, width: finite(rect.width) ?? 0, height: finite(rect.height) ?? 0 });
  const rawBounds = bounds(rect);
  const visibleBounds = clippedBounds(element, { ...viewport, width, height });
  const visibleRect = intersect(rawBounds, visibleBounds);
  if (!geometry.width || !geometry.height || !area(visibleRect) || isHiddenByStyle(element, element.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : null))) {
    const direction = rawBounds.bottom <= visibleBounds.top ? 'up' : rawBounds.top >= visibleBounds.bottom ? 'down' : null;
    if (!direction || !entry.reveal?.learnerInitiated) return { status: 'unavailable', target: null };
    return { status: 'offscreen', target: Object.freeze({ key, controlId: entry.controlId ?? null, courseId: entry.courseId ?? null, element, geometry, visibleGeometry: null, onscreen: false, direction, reveal: entry.reveal }) };
  }
  const centerX = geometry.left + geometry.width / 2;
  const centerY = geometry.top + geometry.height / 2;
  const centerAccessible = centerX >= visibleBounds.left && centerX <= visibleBounds.right && centerY >= visibleBounds.top && centerY <= visibleBounds.bottom;
  if (!centerAccessible) {
    const direction = centerY < visibleBounds.top ? 'up' : centerY > visibleBounds.bottom ? 'down' : null;
    if (direction && entry.reveal?.learnerInitiated) return { status: 'offscreen', target: Object.freeze({ key, controlId: entry.controlId ?? null, courseId: entry.courseId ?? null, element, geometry, visibleGeometry: Object.freeze({ left: visibleRect.left, top: visibleRect.top, width: Math.max(0, visibleRect.right - visibleRect.left), height: Math.max(0, visibleRect.bottom - visibleRect.top) }), onscreen: false, direction, reveal: entry.reveal }) };
    return { status: 'unavailable', target: null };
  }
  const view = element.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : null);
  const hit = view?.document?.elementFromPoint?.(centerX, centerY);
  if (hit && hit !== element && !element.contains?.(hit)) return { status: 'unavailable', target: null };
  return { status: 'ready', target: Object.freeze({ key, controlId: entry.controlId ?? null, courseId: entry.courseId ?? null, element, geometry, visibleGeometry: Object.freeze({ left: visibleRect.left, top: visibleRect.top, width: Math.max(0, visibleRect.right - visibleRect.left), height: Math.max(0, visibleRect.bottom - visibleRect.top) }), onscreen: true, direction: 'aligned', reveal: null }) };
}

export function createLumiTargetRegistry() {
  const entries = new Map();
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());
  return Object.freeze({
    register(key, entry) {
      if (!isLumiSemanticTarget(key) || !entry?.ref) return false;
      entries.set(`${key}:${entry.controlId ?? ''}`, Object.freeze({ ...entry, key }));
      notify();
      return true;
    },
    unregister(key, controlId = '') { entries.delete(`${key}:${controlId}`); notify(); },
    clear() { entries.clear(); notify(); },
    subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    resolve(key, viewport) { return resolveLumiTargetEntries([...entries.values()], key, viewport); },
    snapshot() { return [...entries.values()]; },
  });
}
