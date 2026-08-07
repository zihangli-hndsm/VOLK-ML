import { getPlayground } from './registry.js';

export const PLAYGROUND_ERROR_CODES = [
  'PLAYGROUND_NOT_FOUND',
  'PLAYGROUND_NOT_AVAILABLE',
  'PLAYGROUND_NOT_OPEN',
  'PLAYGROUND_ALREADY_OPEN',
  'INVALID_PLAYGROUND_SOURCE',
  'INVALID_PLAYGROUND_CONTROL',
  'INVALID_PLAYGROUND_ACTION',
  'INVALID_PLAYGROUND_STEP',
  'PLAYGROUND_SCENARIO_NOT_FOUND',
  'PLAYGROUND_SOURCE_STALE',
];

export function playgroundError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

const jsonSafe = (value) => (
  value === undefined || typeof value === 'function'
    ? null
    : structuredClone(value)
);

const GENERIC_ACTIONS = ['SET_CONTROL', 'SET_SPEED', 'PLAY', 'PAUSE', 'STEP', 'SEEK', 'RESET', 'RUN_SCENARIO', 'SCENARIO_NEXT'];

function validateActionShape(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action?.type ?? null });
  }
  if (typeof action.type !== 'string' || !action.type) {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type });
  }
}

function validateControlValue(control, value) {
  if (control.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: control.key, value });
    if (control.min !== undefined && number < control.min) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: control.key, value });
    if (control.max !== undefined && number > control.max) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: control.key, value });
    return number;
  }
  if (control.type === 'boolean') return Boolean(value);
  if (control.type === 'select' && control.options && !control.options.includes(value)) {
    throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: control.key, value });
  }
  return value;
}

export function createPlaygroundSession(playground, { source, controls = {}, seed, sessionId }) {
  const normalizedSource = playground.validateSource(source);
  const initial = playground.createInitialState({ source: normalizedSource, controls, seed });
  return {
    apiVersion: 1,
    sessionId: sessionId ?? `playground-${crypto.randomUUID()}`,
    playgroundId: playground.id,
    status: 'ready',
    seed,
    sourceData: normalizedSource,
    source: {
      kind: normalizedSource.kind,
      name: normalizedSource.name,
      fingerprint: normalizedSource.fingerprint,
      stale: false,
    },
    controls: initial.controls,
    modelState: initial.modelState,
    timeline: { step: 0, totalSteps: initial.totalSteps ?? 0, speed: 1 },
    scenario: null,
  };
}

export function dispatchPlaygroundAction(session, action) {
  validateActionShape(action);
  const playground = getPlayground(session.playgroundId);
  if (!playground) throw playgroundError('PLAYGROUND_NOT_FOUND', { playgroundId: session.playgroundId });
  if (!GENERIC_ACTIONS.includes(action.type) && !playground.actions.includes(action.type)) {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type, playgroundId: playground.id });
  }
  if (action.type === 'RESET') {
    const reset = createPlaygroundSession(playground, {
      source: session.sourceData ?? session.source,
      controls: session.controls,
      sessionId: session.sessionId,
    });
    return reset;
  }
  if (action.type === 'SET_CONTROL') {
    const control = playground.controls.find((item) => item.key === action.key);
    if (!control) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
    const value = validateControlValue(control, action.value);
    return { ...playground.reduce(session, { ...action, value }), status: 'paused' };
  }
  if (action.type === 'PLAY') {
    if (session.timeline.totalSteps > 0 && session.timeline.step >= session.timeline.totalSteps) {
      const reset = dispatchPlaygroundAction(session, { type: 'RESET' });
      return { ...reset, status: 'playing' };
    }
    return { ...session, status: 'playing' };
  }
  if (action.type === 'PAUSE') return { ...session, status: 'paused' };
  if (action.type === 'SET_SPEED') {
    const speed = Math.max(0.25, Math.min(4, Number(action.value) || 1));
    return { ...session, timeline: { ...session.timeline, speed } };
  }
  if (action.type === 'STEP' || action.type === 'SEEK' || action.type === 'START_TRAINING' || action.type === 'START_NEIGHBOR_REVEAL') {
    const next = playground.reduce(session, action);
    const finished = next.timeline.totalSteps > 0 && next.timeline.step >= next.timeline.totalSteps;
    return { ...next, status: finished ? 'completed' : session.status === 'playing' ? 'playing' : 'paused' };
  }
  if (action.type === 'RUN_SCENARIO') {
    const scenario = playground.scenarios.find((item) => item.id === action.scenarioId);
    if (!scenario) throw playgroundError('PLAYGROUND_SCENARIO_NOT_FOUND', { scenarioId: action.scenarioId });
    if (!scenario.steps.length) return { ...session, scenario: { id: scenario.id, stepIndex: 0 }, status: 'completed' };
    const first = dispatchPlaygroundAction(session, scenario.steps[0].action);
    return { ...first, scenario: { id: scenario.id, stepIndex: 0 }, status: 'playing' };
  }
  if (action.type === 'SCENARIO_NEXT') {
    if (!session.scenario) return { ...session, status: 'paused' };
    const scenario = playground.scenarios.find((item) => item.id === session.scenario.id);
    if (!scenario) throw playgroundError('PLAYGROUND_SCENARIO_NOT_FOUND', { scenarioId: session.scenario.id });
    const nextIndex = session.scenario.stepIndex + 1;
    if (nextIndex >= scenario.steps.length) {
      return { ...session, scenario: null, status: 'completed' };
    }
    const next = dispatchPlaygroundAction(session, scenario.steps[nextIndex].action);
    return { ...next, scenario: { id: scenario.id, stepIndex: nextIndex }, status: 'playing' };
  }
  return playground.reduce(session, action);
}

export function derivePlaygroundSnapshot(session) {
  const playground = getPlayground(session.playgroundId);
  if (!playground) throw playgroundError('PLAYGROUND_NOT_FOUND', { playgroundId: session.playgroundId });
  const derived = playground.deriveScene(session);
  return {
    apiVersion: 1,
    sessionId: session.sessionId,
    playgroundId: session.playgroundId,
    status: session.status,
    source: jsonSafe(session.source),
    controls: jsonSafe(session.controls),
    timeline: jsonSafe(session.timeline),
    scenario: session.scenario ? jsonSafe(session.scenario) : null,
    scene: jsonSafe(derived.scene),
    metrics: jsonSafe(derived.metrics ?? {}),
    observation: derived.observation ? jsonSafe(derived.observation) : null,
    formula: derived.formula ? jsonSafe(derived.formula) : null,
    capabilities: derived.capabilities ?? {
      canPlay: false,
      canPause: false,
      canStep: false,
      canSeek: false,
      canReset: true,
      canEditData: false,
    },
  };
}
