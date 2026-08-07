import { requireModelAdapter } from './model/modelRegistry.js';
import { createTraceRecorder } from './trace/traceBuilder.js';
import { getPreset } from './visualization/presetRegistry.js';
import { getPlayground } from '../playgrounds/registry.js';
import {
  playgroundError,
  validateActionShape,
  validateControlValue,
} from '../playgrounds/session.js';

// The unified playground runtime. This module owns the session reducer: the
// UI, the Agent and the visualization script runtime all dispatch the same
// JSON actions through dispatchRuntimeAction(). Model-specific behavior lives
// in the model adapters; the session (controls, timeline, status, traces,
// visual state) lives here.

const GENERIC_ACTIONS = [
  'SET_CONTROL',
  'SET_SPEED',
  'PLAY',
  'PAUSE',
  'STEP',
  'SEEK',
  'RESET',
  'RUN_SCENARIO',
  'SCENARIO_NEXT',
  'SET_VISUAL',
];

const jsonSafe = (value) => (value === undefined || typeof value === 'function' ? null : structuredClone(value));

export function createRuntimeSession(playground, { source, controls = {}, seed, sessionId }) {
  const adapter = requireModelAdapter(playground.adapterId ?? playground.id);
  const normalizedSource = playground.validateSource(source);
  const recorder = createTraceRecorder();
  const initialized = adapter.initialize({
    source: normalizedSource,
    controls,
    seed,
    recorder,
  });
  const preset = getPreset(adapter.defaultVisualizationPreset);
  return {
    apiVersion: 1,
    sessionId: sessionId ?? `playground-${crypto.randomUUID()}`,
    playgroundId: playground.id,
    adapterId: adapter.id,
    status: 'ready',
    seed,
    sourceData: normalizedSource,
    source: {
      kind: normalizedSource.kind,
      name: normalizedSource.name,
      fingerprint: normalizedSource.fingerprint,
      stale: false,
    },
    controls: initialized.controls,
    modelState: initialized.modelState,
    dataState: {},
    timeline: { step: 0, totalSteps: initialized.totalSteps ?? 0, speed: 1 },
    scenario: null,
    script: preset
      ? { id: preset.id, model: preset.model, layout: structuredClone(preset.layout) }
      : null,
    traces: recorder.list(),
    visualState: {},
    metrics: {},
  };
}

function mergePatches(session, patch) {
  const timeline = { ...session.timeline, ...(patch.timeline ?? {}) };
  if (patch.timeline?.totalSteps !== undefined && patch.timeline.step === undefined) {
    timeline.step = Math.min(session.timeline.step, patch.timeline.totalSteps);
  }
  return {
    ...session,
    controls: { ...session.controls, ...(patch.controls ?? {}) },
    modelState: { ...session.modelState, ...(patch.modelState ?? {}) },
    timeline,
  };
}

function applyModelAction(session, action) {
  const adapter = requireModelAdapter(session.adapterId);
  const recorder = createTraceRecorder(session.traces);
  const patch = adapter.applyModelAction(session.modelState, action, {
    controls: session.controls,
    recorder,
    source: session.sourceData,
  });
  return {
    next: mergePatches(session, patch),
    recorder,
  };
}

export function dispatchRuntimeAction(session, action) {
  validateActionShape(action);
  const playground = getPlayground(session.playgroundId);
  if (!playground) throw playgroundError('PLAYGROUND_NOT_FOUND', { playgroundId: session.playgroundId });
  if (!GENERIC_ACTIONS.includes(action.type) && !playground.actions.includes(action.type)) {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type, playgroundId: playground.id });
  }

  if (action.type === 'RESET') {
    return createRuntimeSession(playground, {
      source: session.sourceData ?? session.source,
      controls: session.controls,
      sessionId: session.sessionId,
      seed: session.seed,
    });
  }
  if (action.type === 'SET_CONTROL') {
    const control = playground.controls.find((item) => item.key === action.key);
    if (!control) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
    const value = validateControlValue(control, action.value);
    const { next, recorder } = applyModelAction(session, { ...action, value });
    return { ...next, status: 'paused', traces: recorder.list() };
  }
  if (action.type === 'SET_VISUAL') {
    return {
      ...session,
      visualState: { ...session.visualState, ...(action.patch ?? {}) },
    };
  }
  if (action.type === 'PLAY') {
    if (session.timeline.totalSteps > 0 && session.timeline.step >= session.timeline.totalSteps) {
      const reset = dispatchRuntimeAction(session, { type: 'RESET' });
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
    const { next, recorder } = applyModelAction(session, action);
    const finished = next.timeline.totalSteps > 0 && next.timeline.step >= next.timeline.totalSteps;
    return {
      ...next,
      traces: recorder.list(),
      status: finished ? 'completed' : session.status === 'playing' ? 'playing' : 'paused',
    };
  }
  if (action.type === 'RUN_SCENARIO') {
    const scenario = playground.scenarios.find((item) => item.id === action.scenarioId);
    if (!scenario) throw playgroundError('PLAYGROUND_SCENARIO_NOT_FOUND', { scenarioId: action.scenarioId });
    if (!scenario.steps.length) {
      return { ...session, scenario: { id: scenario.id, stepIndex: 0 }, status: 'completed' };
    }
    const first = dispatchRuntimeAction(session, scenario.steps[0].action);
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
    const next = dispatchRuntimeAction(session, scenario.steps[nextIndex].action);
    return { ...next, scenario: { id: scenario.id, stepIndex: nextIndex }, status: 'playing' };
  }
  const { next, recorder } = applyModelAction(session, action);
  return { ...next, traces: recorder.list() };
}

export function deriveRuntimeSnapshot(session) {
  const adapter = requireModelAdapter(session.adapterId);
  const derived = adapter.deriveScene(session.modelState, { controls: session.controls });
  const capabilities = {
    ...derived.capabilities,
    canPause: session.status === 'playing',
  };
  const primitives = adapter.buildPrimitives(
    session.modelState,
    derived.scene,
    derived,
    { controls: session.controls, source: session.sourceData },
  );
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
    capabilities,
    traces: jsonSafe(session.traces),
    script: session.script ? jsonSafe(session.script) : null,
    visualState: jsonSafe(session.visualState),
    primitives: primitives.map((primitive) => jsonSafe(primitive)),
  };
}
