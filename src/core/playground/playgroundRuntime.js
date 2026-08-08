import { requireModelAdapter } from './model/modelRegistry.js';
import { createTraceRecorder } from './trace/traceBuilder.js';
import { getPreset } from './visualization/presetRegistry.js';
import { materializePrimitives } from './visualization/primitiveMaterializer.js';
import { createBindingContext, resolveValue } from './visualization/bindings.js';
import { validateScript } from './visualization/scriptValidator.js';
import { scriptError } from './visualization/scriptErrors.js';
import { buildDataState } from './data/datasetAdapter.js';
import { getPlayground } from '../playgrounds/registry.js';
import {
  playgroundError,
  validateActionShape,
  validateControlValue,
} from '../playgrounds/session.js';

// The unified playground runtime. This module owns the session reducer: the
// UI, the Agent and the visualization script runtime all dispatch the same
// JSON actions through dispatchRuntimeAction(). Model-specific behavior lives
// in the model adapters; visualization composition lives in the Primitive
// Materializer (scripts declare primitives, adapters never do).

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
  'SCRIPT_LOAD',
  'SCRIPT_PLAY',
  'SCRIPT_PAUSE',
  'SCRIPT_STEP',
  'SCRIPT_SEEK',
  'SCRIPT_RESET',
];

const jsonSafe = (value) => (value === undefined || typeof value === 'function' ? null : structuredClone(value));

export function createRuntimeSession(playground, { source, controls = {}, seed, sessionId, dataset }) {
  const adapter = requireModelAdapter(playground.adapterId ?? playground.id);
  const normalizedSource = playground.validateSource(source);
  const validatedControls = {};
  for (const [key, value] of Object.entries(controls)) {
    const control = playground.controls.find((item) => item.key === key);
    if (!control) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key });
    validatedControls[key] = validateControlValue(control, value);
  }
  const recorder = createTraceRecorder();
  const initialized = adapter.initialize({
    source: normalizedSource,
    controls: validatedControls,
    seed,
    recorder,
  });
  const preset = getPreset(adapter.defaultVisualizationPreset);
  const dataState = buildDataState({ source: normalizedSource, workspaceDataset: dataset });
  return {
    apiVersion: 1,
    sessionId: sessionId ?? `playground-${crypto.randomUUID()}`,
    playgroundId: playground.id,
    adapterId: adapter.id,
    status: 'ready',
    seed,
    baseline: {
      controls: structuredClone(initialized.controls),
      source: structuredClone(normalizedSource),
      seed,
    },
    scriptBaseline: null,
    sourceData: normalizedSource,
    source: {
      kind: normalizedSource.kind,
      name: normalizedSource.name,
      fingerprint: normalizedSource.fingerprint,
      stale: false,
    },
    controls: initialized.controls,
    modelState: initialized.modelState,
    dataState,
    timeline: { step: 0, totalSteps: initialized.totalSteps ?? 0, speed: 1 },
    scenario: null,
    script: preset ? structuredClone(preset) : null,
    scriptState: preset
      ? { status: 'ready', step: 0, totalSteps: preset.steps.length }
      : { status: 'idle', step: 0, totalSteps: 0 },
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

function semanticContext(session) {
  const adapter = requireModelAdapter(session.adapterId);
  const semantic = adapter.deriveScene(session.modelState, {
    controls: session.controls,
    source: session.sourceData,
  });
  // Scripts bind against a stable model context: the semantic scene plus
  // metrics/formula/observation at the top level. snapshot.scene keeps the
  // historical scene shape for backward compatibility.
  const modelContext = {
    ...semantic.scene,
    metrics: semantic.metrics ?? {},
    formula: semantic.formula ?? null,
    observation: semantic.observation ?? null,
  };
  return {
    scene: semantic.scene,
    metrics: semantic.metrics ?? {},
    observation: semantic.observation ?? null,
    formula: semantic.formula ?? null,
    capabilities: semantic.capabilities ?? {},
    modelContext,
    context: createBindingContext({
      model: modelContext,
      data: session.dataState ?? {},
      controls: session.controls,
      trace: session.traces,
      metrics: semantic.metrics ?? {},
    }),
  };
}

// Translates one script step into the same JSON actions the UI and Agent use.
// Operation names go through adapter.scriptOperations so adding a model never
// requires changing the runtime.
function computeScriptStepActions(session) {
  const { script, scriptState, adapterId } = session;
  const stepDefinition = script.steps[scriptState.step];
  const adapter = requireModelAdapter(adapterId);
  const { context } = semanticContext(session);
  const actions = [];
  if (stepDefinition.setControl) {
    const resolved = resolveValue(stepDefinition.setControl, context);
    for (const [key, value] of Object.entries(resolved)) {
      actions.push({ type: 'SET_CONTROL', key, value });
    }
  }
  if (stepDefinition.invoke) {
    const translator = adapter.scriptOperationActions?.[stepDefinition.invoke.operation];
    if (!translator) {
      throw Object.assign(new Error('SCRIPT_UNSUPPORTED_OPERATION'), {
        code: 'SCRIPT_UNSUPPORTED_OPERATION',
        details: { operation: stepDefinition.invoke.operation },
      });
    }
    const action = translator(resolveValue(stepDefinition.invoke.args ?? {}, context));
    if (action) actions.push(action);
  }
  if (stepDefinition.reveal) actions.push({ type: 'STEP' });
  if (stepDefinition.show) actions.push({ type: 'SET_VISUAL', patch: { [stepDefinition.show]: true } });
  if (stepDefinition.hide) actions.push({ type: 'SET_VISUAL', patch: { [stepDefinition.hide]: false } });
  if (stepDefinition.highlight) actions.push({ type: 'SET_VISUAL', patch: { highlight: stepDefinition.highlight } });
  if (stepDefinition.annotate) {
    const resolved = resolveValue(stepDefinition.annotate, context);
    const annotationId = script.primitives.find((primitive) => primitive.type === 'annotation')?.id;
    if (annotationId) {
      actions.push({
        type: 'SET_VISUAL',
        patch: {
          overrides: {
            ...(session.visualState.overrides ?? {}),
            [annotationId]: { observation: resolved },
          },
        },
      });
    }
  }
  if (stepDefinition.reset) actions.push({ type: 'RESET' });
  return actions;
}

export function dispatchRuntimeAction(session, action) {
  validateActionShape(action);
  const playground = getPlayground(session.playgroundId);
  if (!playground) throw playgroundError('PLAYGROUND_NOT_FOUND', { playgroundId: session.playgroundId });
  if (!GENERIC_ACTIONS.includes(action.type) && !playground.actions.includes(action.type)) {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type, playgroundId: playground.id });
  }

  if (action.type === 'RESET') {
    const baseline = session.baseline ?? { controls: session.controls, source: session.sourceData, seed: session.seed };
    const reset = createRuntimeSession(playground, {
      source: baseline.source,
      controls: baseline.controls,
      seed: baseline.seed,
      sessionId: session.sessionId,
    });
    return { ...reset, dataState: session.dataState };
  }
  if (action.type === 'SET_CONTROL') {
    const control = playground.controls.find((item) => item.key === action.key);
    if (!control) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
    const value = validateControlValue(control, action.value);
    const { next, recorder } = applyModelAction(session, { ...action, value });
    return { ...next, status: 'paused', traces: recorder.list() };
  }
  if (action.type === 'SET_VISUAL') {
    return { ...session, visualState: { ...session.visualState, ...(action.patch ?? {}) } };
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

  // ---- Visualization Script execution (the single preset path) ----
  if (action.type === 'SCRIPT_LOAD') {
    validateScript(action.script);
    if (action.script.model.adapter !== session.adapterId) {
      throw scriptError('SCRIPT_MODEL_MISMATCH', { expected: session.adapterId, received: action.script.model.adapter });
    }
    return {
      ...session,
      script: structuredClone(action.script),
      scriptState: { status: 'ready', step: 0, totalSteps: action.script.steps.length },
      visualState: {},
      scriptBaseline: {
        controls: structuredClone(session.controls),
        modelState: structuredClone(session.modelState),
        dataState: session.dataState ? structuredClone(session.dataState) : {},
        source: structuredClone(session.sourceData ?? session.source),
        seed: session.seed,
        traces: structuredClone(session.traces),
      },
    };
  }
  if (action.type === 'SCRIPT_PLAY') {
    if (!session.script) return session;
    if (session.scriptState.step >= session.scriptState.totalSteps) {
      const reset = dispatchRuntimeAction(session, { type: 'SCRIPT_RESET' });
      return { ...reset, scriptState: { ...reset.scriptState, status: 'playing' } };
    }
    return { ...session, scriptState: { ...session.scriptState, status: 'playing' } };
  }
  if (action.type === 'SCRIPT_PAUSE') {
    if (!session.script) return session;
    return { ...session, scriptState: { ...session.scriptState, status: 'paused' } };
  }
  if (action.type === 'SCRIPT_STEP') {
    if (!session.script || !session.scriptState || session.scriptState.step >= session.scriptState.totalSteps) {
      return session.scriptState
        ? { ...session, scriptState: { ...session.scriptState, status: 'completed' } }
        : session;
    }
    const stepActions = computeScriptStepActions(session);
    let next = session;
    for (const stepAction of stepActions) next = dispatchRuntimeAction(next, stepAction);
    const step = session.scriptState.step + 1;
    const done = step >= session.scriptState.totalSteps;
    const status = done ? 'completed' : session.scriptState.status === 'playing' ? 'playing' : 'paused';
    return { ...next, script: session.script, scriptState: { ...session.scriptState, step, status } };
  }
  if (action.type === 'SCRIPT_SEEK') {
    let next = dispatchRuntimeAction(session, { type: 'SCRIPT_RESET' });
    const target = Math.max(0, Math.min(Number(action.step) || 0, next.scriptState.totalSteps));
    for (let index = 0; index < target; index += 1) next = dispatchRuntimeAction(next, { type: 'SCRIPT_STEP' });
    return next;
  }
  if (action.type === 'SCRIPT_RESET') {
    const baseline = session.scriptBaseline;
    const reset = baseline
      ? (() => {
        const shell = createRuntimeSession(playground, {
          source: baseline.source,
          controls: baseline.controls,
          seed: baseline.seed,
          sessionId: session.sessionId,
        });
        return {
          ...shell,
          modelState: structuredClone(baseline.modelState),
          dataState: baseline.dataState ? structuredClone(baseline.dataState) : {},
          traces: baseline.traces ? structuredClone(baseline.traces) : shell.traces,
          baseline: structuredClone(session.baseline ?? shell.baseline),
          scriptBaseline: structuredClone(session.scriptBaseline),
        };
      })()
      : dispatchRuntimeAction(session, { type: 'RESET' });
    return {
      ...reset,
      script: session.script,
      scriptState: {
        status: 'ready',
        step: 0,
        totalSteps: session.script?.steps.length ?? 0,
      },
    };
  }
  if (action.type === 'RUN_SCENARIO') {
    const scenario = playground.scenarios.find((item) => item.id === action.scenarioId);
    if (!scenario) throw playgroundError('PLAYGROUND_SCENARIO_NOT_FOUND', { scenarioId: action.scenarioId });
    const preset = getPreset(scenario.presetId ?? scenario.id);
    if (!preset) throw playgroundError('PLAYGROUND_SCENARIO_NOT_FOUND', { scenarioId: action.scenarioId });
    let next = dispatchRuntimeAction(session, { type: 'SCRIPT_LOAD', script: preset });
    next = { ...next, scriptState: { ...next.scriptState, status: 'playing' } };
    let guard = 0;
    while (next.scriptState.status !== 'completed' && guard < 500) {
      next = dispatchRuntimeAction(next, { type: 'SCRIPT_STEP' });
      guard += 1;
    }
    return { ...next, status: 'completed', scenario: null };
  }
  if (action.type === 'SCENARIO_NEXT') {
    return session.scenario ? { ...session, status: 'paused' } : { ...session, status: 'paused' };
  }

  const { next, recorder } = applyModelAction(session, action);
  return { ...next, traces: recorder.list() };
}

export function deriveRuntimeSnapshot(session) {
  const adapter = requireModelAdapter(session.adapterId);
  const { scene, metrics, observation, formula, capabilities: semanticCapabilities, modelContext } = semanticContext(session);
  const scriptLoaded = Boolean(session.scriptState && session.scriptState.totalSteps > 0);
  const capabilities = scriptLoaded
    ? {
      canPlay: session.scriptState.totalSteps > 0,
      canPause: session.scriptState.status === 'playing',
      canStep: session.scriptState.step < session.scriptState.totalSteps,
      canSeek: session.scriptState.totalSteps > 0,
      canReset: true,
      canEditData: true,
    }
    : {
      ...semanticCapabilities,
      canPause: session.status === 'playing',
    };
  const primitives = materializePrimitives({
    script: session.script,
    semanticState: modelContext,
    traces: session.traces,
    controls: session.controls,
    metrics,
    visualState: session.visualState,
    dataState: session.dataState,
  });
  return {
    apiVersion: 1,
    sessionId: session.sessionId,
    playgroundId: session.playgroundId,
    status: session.status,
    source: jsonSafe(session.source),
    controls: jsonSafe(session.controls),
    timeline: jsonSafe(session.timeline),
    scenario: session.scenario ? jsonSafe(session.scenario) : null,
    scene: jsonSafe(scene),
    metrics: jsonSafe(metrics),
    observation: observation ? jsonSafe(observation) : null,
    formula: formula ? jsonSafe(formula) : null,
    capabilities,
    traces: jsonSafe(session.traces),
    script: session.script ? jsonSafe(session.script) : null,
    scriptState: jsonSafe(session.scriptState),
    visualState: jsonSafe(session.visualState),
    dataState: jsonSafe(session.dataState),
    primitives: primitives.map((primitive) => jsonSafe(primitive)),
  };
}
