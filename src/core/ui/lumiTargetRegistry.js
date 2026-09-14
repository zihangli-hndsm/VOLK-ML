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

export function isLumiSemanticTarget(value) {
  return ALLOWLIST.has(value);
}

export function resolveLumiTargetEntries(entries = [], key, viewport = {}) {
  if (!isLumiSemanticTarget(key)) return { status: 'unsupported', target: null };
  const matches = entries.filter((entry) => entry?.key === key && entry?.current !== false);
  if (matches.length !== 1) return { status: matches.length ? 'ambiguous' : 'missing', target: null };
  const entry = matches[0];
  const element = entry.ref?.current ?? null;
  if (!element || entry.enabled === false || entry.visible === false) return { status: 'unavailable', target: null };
  const rect = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null;
  if (!rect) return { status: 'unavailable', target: null };
  const width = finite(viewport.width) ?? (typeof window !== 'undefined' ? window.innerWidth : 0);
  const height = finite(viewport.height) ?? (typeof window !== 'undefined' ? window.innerHeight : 0);
  const geometry = Object.freeze({ left: finite(rect.left) ?? 0, top: finite(rect.top) ?? 0, width: finite(rect.width) ?? 0, height: finite(rect.height) ?? 0 });
  const onscreen = geometry.width > 0 && geometry.height > 0 && geometry.left < width && geometry.top < height && geometry.left + geometry.width > 0 && geometry.top + geometry.height > 0;
  return { status: onscreen ? 'ready' : 'offscreen', target: Object.freeze({ key, controlId: entry.controlId ?? null, courseId: entry.courseId ?? null, element, geometry, onscreen, reveal: onscreen ? null : (entry.reveal ?? null) }) };
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
