export const DIRECTOR_PROTOTYPE_VERSION = 1;

export const DIRECTOR_PRIMITIVES = Object.freeze([
  'load', 'step', 'play', 'pause', 'seek', 'reset', 'setControl', 'invoke',
  'show', 'hide', 'reveal', 'highlight', 'annotate', 'capture', 'restoreCapture',
  'wait', 'durationMs', 'narrationKey',
]);

export const DIRECTOR_BEATS = Object.freeze([
  { id: 'where-do-we-start', titleKey: 'director.beat.start.title', bodyKey: 'director.beat.start.body', questionKey: 'director.beat.start.question', visualKind: 'references', durationMs: 7000, steps: ['load', 'show', 'narrationKey'] },
  { id: 'shared-structure', titleKey: 'director.beat.structure.title', bodyKey: 'director.beat.structure.body', visualKind: 'flow', durationMs: 6000, steps: ['reveal', 'highlight', 'narrationKey'] },
  { id: 'what-changes', titleKey: 'director.beat.changes.title', bodyKey: 'director.beat.changes.body', visualKind: 'factors', durationMs: 6500, steps: ['show', 'highlight', 'annotate', 'narrationKey'] },
  { id: 'why-volk', titleKey: 'director.beat.volk.title', bodyKey: 'director.beat.volk.body', visualKind: 'experiment', durationMs: 7000, steps: ['setControl', 'invoke', 'highlight', 'narrationKey'] },
  { id: 'experimenting', titleKey: 'director.beat.experiment.title', bodyKey: 'director.beat.experiment.body', visualKind: 'experiment', durationMs: 7000, steps: ['capture', 'restoreCapture', 'highlight', 'narrationKey'] },
  { id: 'meet-lumi', titleKey: 'director.beat.lumi.title', bodyKey: 'director.beat.lumi.body', visualKind: 'lumi', durationMs: 6000, steps: ['show', 'annotate', 'narrationKey'] },
  { id: 'world-grows', titleKey: 'director.beat.scale.title', bodyKey: 'director.beat.scale.body', visualKind: 'scale', durationMs: 6000, steps: ['reveal', 'highlight', 'narrationKey'] },
  { id: 'welcome', titleKey: 'director.beat.welcome.title', bodyKey: 'director.beat.welcome.body', visualKind: 'welcome', durationMs: 5000, steps: ['show', 'narrationKey'] },
]);

export const DIRECTOR_HANDOFF = Object.freeze({
  target: 'episode-1-sampling-variability',
  episodeId: 'episode-0-world-data-model',
  mode: 'clean-semantic-entry',
  seed: 7101,
});

export const DIRECTOR_SCRIPT = Object.freeze({
  version: DIRECTOR_PROTOTYPE_VERSION,
  beats: DIRECTOR_BEATS,
  handoff: DIRECTOR_HANDOFF,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createDirectorState({ beatIndex = 0, playing = false, timeMs = 0 } = {}) {
  const index = clamp(Number(beatIndex) || 0, 0, DIRECTOR_BEATS.length - 1);
  return { version: DIRECTOR_PROTOTYPE_VERSION, beatIndex: index, playing: Boolean(playing), timeMs: Math.max(0, Number(timeMs) || 0) };
}

export function directorReducer(state, action) {
  const current = state ?? createDirectorState();
  switch (action?.type) {
    case 'PLAY': return { ...current, playing: true };
    case 'PAUSE': return { ...current, playing: false };
    case 'RESET': return createDirectorState();
    case 'NEXT_BEAT': {
      const next = clamp(current.beatIndex + 1, 0, DIRECTOR_BEATS.length - 1);
      return { ...current, beatIndex: next, timeMs: 0, playing: next < DIRECTOR_BEATS.length - 1 && current.playing };
    }
    case 'PREVIOUS_BEAT': return { ...current, beatIndex: clamp(current.beatIndex - 1, 0, DIRECTOR_BEATS.length - 1), timeMs: 0, playing: false };
    case 'SEEK_BEAT': return { ...current, beatIndex: clamp(Number(action.beatIndex) || 0, 0, DIRECTOR_BEATS.length - 1), timeMs: 0, playing: false };
    case 'TICK': {
      const timeMs = current.timeMs + Math.max(0, Number(action.deltaMs) || 0);
      const duration = DIRECTOR_BEATS[current.beatIndex]?.durationMs ?? 5000;
      return timeMs >= duration && current.beatIndex < DIRECTOR_BEATS.length - 1
        ? directorReducer({ ...current, timeMs: 0 }, { type: 'NEXT_BEAT' })
        : { ...current, timeMs: Math.min(timeMs, duration), playing: current.beatIndex === DIRECTOR_BEATS.length - 1 ? false : current.playing };
    }
    default: return current;
  }
}

export function validateDirectorScript(beats = DIRECTOR_BEATS, { localizedKeys = new Set() } = {}) {
  if (!Array.isArray(beats) || !beats.length) return { valid: false, reason: 'empty-script' };
  const ids = new Set();
  for (const beat of beats) {
    if (!beat?.id || ids.has(beat.id) || !beat.titleKey || !beat.bodyKey || !Number.isFinite(beat.durationMs)) return { valid: false, reason: 'invalid-beat' };
    if (localizedKeys.size && (!localizedKeys.has(beat.titleKey) || !localizedKeys.has(beat.bodyKey) || (beat.questionKey && !localizedKeys.has(beat.questionKey)))) return { valid: false, reason: 'missing-localization' };
    ids.add(beat.id);
    if ((beat.steps ?? []).some((step) => !DIRECTOR_PRIMITIVES.includes(step))) return { valid: false, reason: 'unsupported-primitive' };
  }
  return { valid: true, version: DIRECTOR_PROTOTYPE_VERSION, beats: beats.map((beat) => beat.id) };
}
