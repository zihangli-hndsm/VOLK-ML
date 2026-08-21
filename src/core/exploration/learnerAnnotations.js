export const LEARNER_ANNOTATION_VERSION = 1;
export const MAX_LEARNER_ANNOTATIONS = 32;
export const MAX_ANNOTATION_QUOTE = 280;
export const LEARNER_ANNOTATION_KINDS = Object.freeze(['understood', 'unclear', 'ask-about-this']);
const SURFACES = new Set(['concept-card', 'evidence', 'agent-answer', 'learning-unit', 'formula']);

function bounded(value, max = 160) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= max ? text : null;
}

function anchorOf(anchor) {
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) return null;
  const surface = bounded(anchor.surface, 40);
  const contentId = bounded(anchor.contentId, 160);
  if (!surface || !SURFACES.has(surface) || !contentId) return null;
  const result = { surface, contentId };
  for (const key of ['messageId', 'conceptId', 'localizationKey']) {
    const value = bounded(anchor[key], 160);
    if (value) result[key] = value;
  }
  return result;
}

export function canonicalizeLearnerAnnotation(value) {
  if (!value || value.version !== LEARNER_ANNOTATION_VERSION || value.actor !== 'human') return null;
  if (!LEARNER_ANNOTATION_KINDS.includes(value.kind)) return null;
  const id = bounded(value.id, 80);
  const anchor = anchorOf(value.anchor);
  if (!id || !anchor) return null;
  const quote = value.quote === undefined || value.quote === null ? null : bounded(value.quote, MAX_ANNOTATION_QUOTE);
  if (value.quote !== undefined && value.quote !== null && !quote) return null;
  const createdAt = Number.isFinite(value.createdAt) ? Math.max(0, Math.round(value.createdAt)) : null;
  if (createdAt === null) return null;
  const resolvedAt = value.resolvedAt === undefined || value.resolvedAt === null
    ? null
    : Number.isFinite(value.resolvedAt) ? Math.max(createdAt, Math.round(value.resolvedAt)) : null;
  if (value.resolvedAt !== undefined && value.resolvedAt !== null && resolvedAt === null) return null;
  return { version: 1, id, kind: value.kind, actor: 'human', anchor, quote, createdAt, resolvedAt };
}

export function createLearnerAnnotationStore() {
  let annotations = [];
  let sequence = 0;
  const snapshot = () => annotations.map((item) => structuredClone(item));
  return Object.freeze({
    add({ kind, anchor, quote = null, now = Date.now() } = {}) {
      const candidate = canonicalizeLearnerAnnotation({
        version: 1,
        id: `annotation-${++sequence}`,
        kind,
        actor: 'human',
        anchor,
        quote,
        createdAt: now,
        resolvedAt: null,
      });
      if (!candidate) throw new Error('INVALID_LEARNER_ANNOTATION');
      annotations = [...annotations.filter((item) => item.id !== candidate.id), candidate].slice(-MAX_LEARNER_ANNOTATIONS);
      return structuredClone(candidate);
    },
    resolve(id, now = Date.now()) {
      const target = bounded(id, 80);
      let changed = null;
      annotations = annotations.map((item) => {
        if (item.id !== target || item.resolvedAt !== null) return item;
        changed = { ...item, resolvedAt: Math.max(item.createdAt, Math.round(now)) };
        return changed;
      });
      return changed ? structuredClone(changed) : null;
    },
    remove(id) {
      const target = bounded(id, 80);
      const previous = annotations.length;
      annotations = annotations.filter((item) => item.id !== target);
      return annotations.length !== previous;
    },
    snapshot,
    active() {
      return snapshot().filter((item) => item.resolvedAt === null);
    },
    reset() {
      annotations = [];
      sequence = 0;
    },
  });
}

export function projectLearnerAnnotations(annotations, { activeOnly = true } = {}) {
  return (Array.isArray(annotations) ? annotations : [])
    .map(canonicalizeLearnerAnnotation)
    .filter(Boolean)
    .filter((item) => !activeOnly || item.resolvedAt === null)
    .slice(-MAX_LEARNER_ANNOTATIONS)
    .map(({ id, kind, anchor, quote, resolvedAt }) => ({ id, kind, anchor, quote, resolvedAt }));
}
