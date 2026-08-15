// Vendor-independent semantic telemetry boundary. The default sink is a
// no-op: importing or using this module never sends data anywhere.

export const EXPLORATION_EVENT_TYPES = Object.freeze([
  'exploration_opened',
  'world_point_moved',
  'first_meaningful_manipulation',
  'experiment_duplicated',
  'experiment_compared',
  'repeat_requested',
  'depth_evidence_opened',
  'depth_mechanism_opened',
  'guided_prompt_accepted',
]);

const EVENT_FIELDS = Object.freeze({
  exploration_opened: Object.freeze({ surface: 'surface', playgroundId: 'id', bigIdeaId: 'id' }),
  world_point_moved: Object.freeze({ scope: 'scope' }),
  first_meaningful_manipulation: Object.freeze({ domain: 'domain' }),
  experiment_duplicated: Object.freeze({}),
  experiment_compared: Object.freeze({ changedFactors: 'factor-list' }),
  repeat_requested: Object.freeze({ trials: 'positive-integer' }),
  depth_evidence_opened: Object.freeze({}),
  depth_mechanism_opened: Object.freeze({}),
  guided_prompt_accepted: Object.freeze({ promptId: 'id' }),
});

const REQUIRED_FIELDS = Object.freeze({
  exploration_opened: Object.freeze(['surface']),
  world_point_moved: Object.freeze(['scope']),
  first_meaningful_manipulation: Object.freeze(['domain']),
  experiment_duplicated: Object.freeze([]),
  experiment_compared: Object.freeze(['changedFactors']),
  repeat_requested: Object.freeze(['trials']),
  depth_evidence_opened: Object.freeze([]),
  depth_mechanism_opened: Object.freeze([]),
  guided_prompt_accepted: Object.freeze(['promptId']),
});

const ENUMS = Object.freeze({
  surface: ['explore', 'build'],
  scope: ['train', 'test', 'world'],
  domain: ['world', 'experiment', 'evidence', 'mechanism'],
});

const STABLE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,96}$/;
const MAX_FACTOR_COUNT = 16;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateField(value, kind) {
  if (kind === 'id') return typeof value === 'string' && STABLE_IDENTIFIER_PATTERN.test(value);
  if (kind === 'surface' || kind === 'scope' || kind === 'domain') return ENUMS[kind].includes(value);
  if (kind === 'factor-list') return Array.isArray(value)
    && value.length <= MAX_FACTOR_COUNT
    && value.every((item) => typeof item === 'string' && STABLE_IDENTIFIER_PATTERN.test(item));
  if (kind === 'positive-integer') return Number.isInteger(value) && value > 0;
  return false;
}

export function validateExplorationEvent(event) {
  if (!isPlainObject(event) || event.version !== 1 || !EXPLORATION_EVENT_TYPES.includes(event.type)) {
    throw new TypeError('Invalid exploration telemetry event envelope.');
  }
  if (!isPlainObject(event.payload)) throw new TypeError('Exploration telemetry payload must be an object.');
  const fields = EVENT_FIELDS[event.type];
  for (const required of REQUIRED_FIELDS[event.type]) {
    if (!Object.prototype.hasOwnProperty.call(event.payload, required)) {
      throw new TypeError(`Missing exploration telemetry field: ${event.type}.${required}`);
    }
  }
  for (const [key, value] of Object.entries(event.payload)) {
    if (!Object.prototype.hasOwnProperty.call(fields, key) || !validateField(value, fields[key])) {
      throw new TypeError(`Invalid exploration telemetry field: ${event.type}.${key}`);
    }
  }
  return true;
}

export function createExplorationEvent(type, payload = {}) {
  const event = { version: 1, type, payload: structuredClone(payload) };
  validateExplorationEvent(event);
  return Object.freeze(event);
}

export const NOOP_EXPLORATION_TELEMETRY = Object.freeze({
  track() {},
});

export function createMemoryExplorationTelemetry() {
  const events = [];
  return {
    track(event) {
      validateExplorationEvent(event);
      events.push(structuredClone(event));
    },
    getEvents() {
      return structuredClone(events);
    },
    clear() {
      events.length = 0;
    },
  };
}

export function trackExplorationEvent(event, telemetry = NOOP_EXPLORATION_TELEMETRY) {
  validateExplorationEvent(event);
  if (!telemetry || typeof telemetry.track !== 'function') throw new TypeError('Telemetry adapter must provide track(event).');
  telemetry.track(structuredClone(event));
  return event;
}

// Telemetry is an observer, never a prerequisite for learner interaction.
// Keep failure handling here so future callers do not each need their own
// vendor/network try/catch boundary.
export function safeTrackExplorationEvent(event, telemetry = NOOP_EXPLORATION_TELEMETRY) {
  try {
    trackExplorationEvent(event, telemetry);
    return true;
  } catch {
    return false;
  }
}

// Ephemeral, UI-independent session boundary for exploration_opened. A new
// caller-provided session key means a new meaningful open; rerenders and
// adapter replacement reuse the existing key and are ignored.
export function createExplorationOpenTracker() {
  let openedSessionKey = null;
  return Object.freeze({
    claim(sessionKey) {
      if (typeof sessionKey !== 'string' || !sessionKey.trim()) {
        throw new TypeError('Exploration session key must be a non-empty string.');
      }
      if (openedSessionKey === sessionKey) return false;
      openedSessionKey = sessionKey;
      return true;
    },
  });
}
