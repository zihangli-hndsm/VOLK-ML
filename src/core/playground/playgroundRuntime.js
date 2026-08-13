import { getModelAdapter, requireModelAdapter } from './model/modelRegistry.js';
import { createTraceRecorder } from './trace/traceBuilder.js';
import { getPreset } from './visualization/presetRegistry.js';
import { materializePrimitives } from './visualization/primitiveMaterializer.js';
import { createBindingContext, resolveValue } from './visualization/bindings.js';
import { validateScript } from './visualization/scriptValidator.js';
import { scriptError } from './visualization/scriptErrors.js';
import { buildDataState } from './data/datasetAdapter.js';
import { getPlayground, listPlaygroundDescriptors } from '../playgrounds/registry.js';
import { createExperiment } from '../exploration/experiment.js';
import {
  applyWorldTransaction,
  MAX_WORLD_HISTORY_ACTIONS,
  synchronizeExperiment,
} from '../exploration/operations.js';
import { worldFromPlaygroundSource } from '../exploration/world.js';
import { canCreateObservationFromProjection } from '../exploration/projection.js';
import { isPublicWorldOperation, listWorldOperations } from '../exploration/operationRegistry.js';
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
  'RESET_LEARNING',
  'RUN',
  'RESTORE_ORIGINAL_DATA',
  'ATTACH_MODEL',
  'RUN_SCENARIO',
  'SCENARIO_NEXT',
  'SET_VISUAL',
  'SET_WORKSPACE_VIEW',
  'APPLY_WORLD_TRANSACTION',
  'UNDO_WORLD_ACTION',
  'REDO_WORLD_ACTION',
  'SCRIPT_LOAD',
  'SCRIPT_PLAY',
  'SCRIPT_PAUSE',
  'SCRIPT_STEP',
  'SCRIPT_SEEK',
  'SCRIPT_RESET',
  'SCRIPT_CAPTURE',
  'SCRIPT_RESTORE_CAPTURE',
];

const jsonSafe = (value) => (value === undefined || typeof value === 'function' ? null : structuredClone(value));

function initialViewState(ranges = {}, featureNames = []) {
  return {
    bounds: {
      xMin: Number.isFinite(ranges.xMin) ? ranges.xMin : -1,
      xMax: Number.isFinite(ranges.xMax) ? ranges.xMax : 1,
      yMin: Number.isFinite(ranges.yMin) ? ranges.yMin : -1,
      yMax: Number.isFinite(ranges.yMax) ? ranges.yMax : 1,
    },
    visibility: 'both',
    mode: 'scatter',
    xFeature: featureNames[0] ?? 'x',
    yFeature: featureNames[1] ?? 'y',
    autoFitRevision: 0,
  };
}

function validateViewPatch(current, patch = {}, featureNames = []) {
  const visibility = patch.visibility ?? current.visibility;
  if (!['train', 'test', 'both'].includes(visibility)) {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: 'SET_WORKSPACE_VIEW', field: 'visibility' });
  }
  const bounds = { ...current.bounds, ...(patch.bounds ?? {}) };
  if (!['xMin', 'xMax', 'yMin', 'yMax'].every((key) => Number.isFinite(Number(bounds[key])))
    || Number(bounds.xMin) >= Number(bounds.xMax)
    || Number(bounds.yMin) >= Number(bounds.yMax)) {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: 'SET_WORKSPACE_VIEW', field: 'bounds' });
  }
  return {
    bounds: Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Number(value)])),
    visibility,
    mode: ['scatter', 'distribution'].includes(patch.mode ?? current.mode)
      ? (patch.mode ?? current.mode)
      : (() => { throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: 'SET_WORKSPACE_VIEW', field: 'mode' }); })(),
    xFeature: featureNames.includes(patch.xFeature ?? current.xFeature)
      ? (patch.xFeature ?? current.xFeature)
      : current.xFeature,
    yFeature: featureNames.includes(patch.yFeature ?? current.yFeature)
      ? (patch.yFeature ?? current.yFeature)
      : current.yFeature,
    autoFitRevision: Number.isInteger(patch.autoFitRevision)
      ? patch.autoFitRevision
      : current.autoFitRevision,
  };
}

export function createRuntimeSession(playground, { source, controls = {}, seed, sessionId, dataset }) {
  const adapter = playground.adapterId ? requireModelAdapter(playground.adapterId) : null;
  const normalizedSource = playground.validateSource(source);
  const validatedControls = {};
  for (const [key, value] of Object.entries(controls)) {
    const control = playground.controls.find((item) => item.key === key);
    if (!control) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key });
    validatedControls[key] = validateControlValue(control, value);
  }
  const recorder = createTraceRecorder();
  const initialized = adapter
    ? adapter.initialize({
      source: normalizedSource,
      controls: validatedControls,
      seed,
      recorder,
    })
    : { controls: {}, modelState: null, totalSteps: 0 };
  const preset = adapter?.defaultVisualizationPreset
    ? getPreset(adapter.defaultVisualizationPreset)
    : null;
  const dataState = buildDataState({ source: normalizedSource, workspaceDataset: dataset });
  const resolvedSessionId = sessionId ?? `playground-${crypto.randomUUID()}`;
  const semanticId = `${adapter?.id ?? playground.id}-${normalizedSource.fingerprint ?? normalizedSource.name ?? 'source'}`
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .slice(0, 120);
  const experiment = synchronizeExperiment(createExperiment({
    id: `experiment-${semanticId}`,
    world: worldFromPlaygroundSource(normalizedSource, { id: `world-${semanticId}`, seed }),
    adapterId: adapter?.id ?? null,
    seed,
  }), {
    source: normalizedSource,
    points: initialized.modelState?.points,
    controls: initialized.controls,
    controlDescriptors: playground.controls,
    adapterId: adapter?.id ?? null,
    seed,
    traces: recorder.list(),
  });
  return {
    apiVersion: 1,
    sessionId: resolvedSessionId,
    playgroundId: playground.id,
    modelPlaygroundId: adapter ? playground.id : null,
    adapterId: adapter?.id ?? null,
    status: 'ready',
    seed,
    baseline: {
      controls: structuredClone(initialized.controls),
      modelState: structuredClone(initialized.modelState),
      source: structuredClone(normalizedSource),
      dataState: structuredClone(dataState),
      experiment: structuredClone(experiment),
      traces: structuredClone(recorder.list()),
      worldHistory: { past: [], future: [] },
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
    modelState: initialized.modelState ?? null,
    dataState,
    experiment,
    worldHistory: { past: [], future: [] },
    worldActionCounter: 0,
    viewState: initialViewState(initialized.modelState?.ranges, experiment.world.featureNames),
    timeline: { step: 0, totalSteps: initialized.totalSteps ?? 0, speed: 1 },
    scenario: null,
    script: preset ? structuredClone(preset) : null,
    scriptState: preset
      ? { status: 'ready', step: 0, totalSteps: preset.steps.length }
      : { status: 'idle', step: 0, totalSteps: 0 },
    captures: {},
    traces: recorder.list(),
    visualState: {},
    metrics: {},
  };
}

export function mergeTimelinePatch(current, patch) {
  const timeline = { ...current };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value !== undefined) timeline[key] = value;
  }
  return timeline;
}

function mergePatches(session, patch) {
  const timeline = mergeTimelinePatch(session.timeline, patch.timeline);
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
  const adapter = modelAdapterFor(session);
  if (!adapter) throw playgroundError('PLAYGROUND_MODEL_REQUIRED', { action: action.type });
  const recorder = createTraceRecorder(session.traces);
  const patch = adapter.applyModelAction(session.modelState, action, {
    controls: session.controls,
    recorder,
    source: session.sourceData,
  });
  const merged = mergePatches(session, patch);
  const points = Array.isArray(merged.modelState?.points) ? merged.modelState.points : undefined;
  const next = {
    ...merged,
    experiment: synchronizeExperiment(session.experiment, {
      source: session.sourceData,
      points,
      controls: merged.controls,
      controlDescriptors: modelControlsFor(session),
      adapterId: session.adapterId,
      seed: session.seed,
      action,
      traces: recorder.list(),
    }),
  };
  return {
    next,
    recorder,
  };
}

function sourceFromWorld(source, world) {
  const inputFeatures = world.task === 'regression'
    ? world.featureNames.filter((feature) => feature !== world.metadata?.targetFeature)
    : [...world.featureNames];
  const targetFeature = world.metadata?.targetFeature ?? source.target ?? source.targetColumn;
  const modelFeature = world.metadata?.modelFeature ?? source.feature ?? inputFeatures[0];
  return {
    ...source,
    task: world.task ?? source.task,
    points: world.observations.map((point) => ({
      ...point,
      id: point.id,
      features: point.features ? structuredClone(point.features) : undefined,
      x: point.x,
      y: point.target ?? point.y,
      target: point.target ?? point.y,
      label: point.label,
      membership: point.membership,
      provenance: point.provenance,
    })),
    featureColumns: inputFeatures,
    feature: modelFeature,
    target: targetFeature,
    targetColumn: targetFeature,
    total: world.observations.length,
  };
}

function modelPlaygroundFor(session) {
  return session.modelPlaygroundId
    ? getPlayground(session.modelPlaygroundId)
    : session.adapterId
      ? getPlayground(session.playgroundId)
      : null;
}

function modelAdapterFor(session) {
  return session.adapterId ? getModelAdapter(session.adapterId) : null;
}

function modelControlsFor(session) {
  return modelPlaygroundFor(session)?.controls ?? [];
}

function emptySemanticContext(session) {
  return {
    scene: { axes: {}, ranges: session.viewState?.bounds ?? null },
    metrics: {},
    observation: null,
    formula: null,
    capabilities: {},
    modelContext: { axes: {}, ranges: session.viewState?.bounds ?? null },
    context: createBindingContext({
      model: { axes: {}, ranges: session.viewState?.bounds ?? null },
      data: session.dataState ?? {},
      controls: {},
      trace: session.traces,
      metrics: {},
    }),
  };
}

function compatibleModelPlaygrounds(session) {
  const worldTask = session.experiment?.world?.task;
  return listPlaygroundDescriptors()
    .filter((playground) => playground.kind !== 'session')
    .filter((playground) => playground?.supportedTasks?.includes(worldTask))
    .filter((playground) => {
      try {
        playground.validateSource(session.sourceData);
        return Boolean(playground.adapterId);
      } catch {
        return false;
      }
    });
}

function attachModelSession(session, modelPlaygroundId) {
  if (session.playgroundId !== 'data-lab') {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: 'ATTACH_MODEL', reason: 'Data Lab session required' });
  }
  const playground = getPlayground(modelPlaygroundId);
  if (!playground?.adapterId || !compatibleModelPlaygrounds(session).some((item) => item.id === modelPlaygroundId)) {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: 'ATTACH_MODEL', modelPlaygroundId });
  }
  const adapter = requireModelAdapter(playground.adapterId);
  const source = playground.validateSource(session.sourceData);
  const recorder = createTraceRecorder();
  const initialized = adapter.initialize({ source, controls: {}, seed: session.seed, recorder });
  const experiment = synchronizeExperiment(session.experiment, {
    world: session.experiment.world,
    source,
    points: initialized.modelState.points,
    controls: initialized.controls,
    controlDescriptors: playground.controls,
    adapterId: adapter.id,
    seed: session.seed,
    traces: recorder.list(),
  });
  const preset = getPreset(adapter.defaultVisualizationPreset);
  const dataState = buildDataState({ source, workspaceDataset: null });
  return {
    ...session,
    modelPlaygroundId,
    adapterId: adapter.id,
    sourceData: source,
    source: { ...session.source, name: source.name, fingerprint: source.fingerprint, stale: false },
    controls: initialized.controls,
    modelState: initialized.modelState,
    dataState,
    experiment,
    script: preset ? structuredClone(preset) : null,
    scriptState: preset ? { status: 'ready', step: 0, totalSteps: preset.steps.length } : { status: 'idle', step: 0, totalSteps: 0 },
    scriptBaseline: preset ? {
      controls: structuredClone(initialized.controls),
      modelState: structuredClone(initialized.modelState),
      dataState: structuredClone(dataState),
      experiment: structuredClone(experiment),
      source: structuredClone(source),
      seed: session.seed,
      traces: structuredClone(recorder.list()),
      worldHistory: structuredClone(session.worldHistory),
      worldActionCounter: session.worldActionCounter,
      viewState: structuredClone(session.viewState),
    } : null,
    timeline: { step: 0, totalSteps: initialized.totalSteps ?? 0, speed: session.timeline.speed ?? 1 },
    traces: recorder.list(),
    visualState: {},
    status: 'ready',
  };
}

function restoreOriginalDataSession(session) {
  const baselineSource = structuredClone(session.baseline?.source ?? session.sourceData);
  const world = worldFromPlaygroundSource(baselineSource, {
    id: session.experiment.world.id,
    seed: session.seed,
  });
  const restored = synchronizeWorldSession(
    { ...session, sourceData: baselineSource },
    { world },
    {
      history: { past: [], future: [] },
      mutationRecord: {
        id: `${session.sessionId}-restore-original-data`,
        actor: 'human',
        domain: 'world',
        intent: 'restore-original-data',
        mutationSummary: { explicitDestructiveAction: true },
      },
    },
  );
  return {
    ...restored,
    baseline: session.baseline,
    sourceData: baselineSource,
    source: { ...session.source, name: baselineSource.name, fingerprint: baselineSource.fingerprint, stale: false },
    worldHistory: { past: [], future: [] },
  };
}

function synchronizeWorldSession(session, transactionResult, { history, mutationRecord }) {
  const adapter = modelAdapterFor(session);
  if (adapter && typeof adapter.applyWorld !== 'function') {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', {
      type: 'APPLY_WORLD_TRANSACTION',
      reason: 'adapter does not support World editing',
      adapterId: session.adapterId,
    });
  }
  const recorder = createTraceRecorder(session.traces);
  const sourceData = sourceFromWorld(session.sourceData, transactionResult.world);
  if (adapter?.validateWorld) {
    adapter.validateWorld(transactionResult.world);
  }
  const patch = adapter
    ? adapter.applyWorld(session.modelState, transactionResult.world, {
      controls: session.controls,
      recorder,
      source: sourceData,
    })
    : { modelState: null, timeline: { step: 0, totalSteps: 0 } };
  const merged = mergePatches(session, patch);
  const dataState = buildDataState({ source: sourceData, workspaceDataset: null });
  const synced = synchronizeExperiment(session.experiment, {
    world: transactionResult.world,
    source: sourceData,
    controls: merged.controls,
    controlDescriptors: modelControlsFor(session),
    adapterId: session.adapterId,
    seed: session.seed,
    traces: recorder.list(),
  });
  return {
    ...merged,
    sourceData,
    dataState,
    experiment: {
      ...synced,
      mutations: [...session.experiment.mutations, structuredClone(mutationRecord)],
    },
    worldHistory: history,
    traces: recorder.list(),
    status: 'paused',
  };
}

function canonicalWorldTransaction(action) {
  const actor = ['human', 'agent', 'system'].includes(action.actor) ? action.actor : 'human';
  if (action.type === 'ADD_POINT') {
    return {
      actor,
      intent: 'point',
      operations: [{
        type: 'ADD_POINTS',
        points: [{
          x: action.x,
          y: action.y,
          target: action.y,
          membership: action.membership ?? 'unspecified',
          provenance: action.provenance ?? (actor === 'agent' ? 'agent' : 'manual'),
        }],
      }],
    };
  }
  if (isPublicWorldOperation(action.type)) {
    const intent = action.type === 'ADD_POINTS'
      ? 'point'
      : action.type === 'MOVE_POINT'
        ? 'move'
        : action.type === 'SET_TRAIN_TEST_MEMBERSHIP'
          ? 'membership'
          : action.type === 'SET_FEATURE_VALUES' || action.type === 'TRANSFORM_FEATURE_VALUES'
            ? 'feature-intervention'
          : 'erase';
    const operation = { ...action };
    delete operation.actor;
    return { actor, intent, operations: [operation] };
  }
  return null;
}

function semanticContext(session) {
  const adapter = modelAdapterFor(session);
  if (!adapter) return emptySemanticContext(session);
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
  if (stepDefinition.reveal) {
    const revealSteps = script.steps.filter((step) => step.reveal);
    const revealIndex = revealSteps.indexOf(stepDefinition);
    const previousInvocation = script.steps
      .slice(0, scriptState.step)
      .reverse()
      .find((step) => step.invoke?.operation);
    const playback = previousInvocation
      ? adapter.scriptOperations?.[previousInvocation.invoke.operation]?.playback
      : null;
    const revealCountControl = playback?.revealCountControl;
    const declaredRevealCount = revealCountControl ? Number(session.controls[revealCountControl]) : 0;
    const currentStep = Number(session.timeline.step) || 0;
    const targetStep = Number.isFinite(declaredRevealCount) && declaredRevealCount > 0 && revealIndex >= 0
      ? Math.ceil(declaredRevealCount * (revealIndex + 1) / Math.max(1, revealSteps.length))
      : currentStep + 1;
    const stepsToDispatch = Math.max(1, targetStep - currentStep);
    for (let index = 0; index < stepsToDispatch; index += 1) actions.push({ type: 'STEP' });
  }
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
  // A teaching-script reset restarts the model explanation while preserving
  // the learner's current World. The explicit Restore Original Data action is
  // the only path that intentionally replaces World observations.
  if (stepDefinition.reset) actions.push({ type: 'RESET_LEARNING' });
  if (stepDefinition.capture) actions.push({ type: 'SCRIPT_CAPTURE', captureId: stepDefinition.capture.id });
  if (stepDefinition.restoreCapture) actions.push({ type: 'SCRIPT_RESTORE_CAPTURE', captureId: stepDefinition.restoreCapture.id });
  return actions;
}

function resetLearningSession(session) {
  const adapter = modelAdapterFor(session);
  if (!adapter) return { ...session, status: 'paused' };
  const recorder = createTraceRecorder(session.traces);
  const patch = typeof adapter.resetLearning === 'function'
    ? adapter.resetLearning(session.modelState, {
      controls: session.controls,
      recorder,
      source: session.sourceData,
      world: session.experiment.world,
    })
    : { modelState: session.modelState, timeline: { step: 0, totalSteps: 0 } };
  const merged = mergePatches(session, patch);
  const points = Array.isArray(merged.modelState?.points) ? merged.modelState.points : undefined;
  return {
    ...merged,
    status: 'paused',
    traces: recorder.list(),
    experiment: synchronizeExperiment(session.experiment, {
      world: session.experiment.world,
      source: session.sourceData,
      points,
      controls: merged.controls,
      controlDescriptors: modelControlsFor(session),
      adapterId: session.adapterId,
      seed: session.seed,
      traces: recorder.list(),
    }),
  };
}

function runCurrentWorld(session) {
  let next = resetLearningSession(session);
  const started = applyModelAction(next, { type: 'START_TRAINING' });
  next = { ...started.next, traces: started.recorder.list() };
  const totalSteps = next.timeline.totalSteps ?? 0;
  for (let index = 0; index < totalSteps; index += 1) {
    const stepped = applyModelAction(next, { type: 'STEP' });
    next = { ...stepped.next, traces: stepped.recorder.list() };
  }
  return { ...next, status: 'completed' };
}

function resetVisualizationScript(session) {
  const adapter = modelAdapterFor(session);
  if (!adapter) {
    return {
      ...session,
      scriptState: { status: 'ready', step: 0, totalSteps: session.script?.steps.length ?? 0 },
      visualState: {},
      status: 'paused',
    };
  }
  const baseline = session.scriptBaseline ?? {
    controls: session.baseline?.controls,
    modelState: session.baseline?.modelState,
    dataState: session.baseline?.dataState,
    experiment: session.baseline?.experiment,
    traces: session.baseline?.traces,
    worldHistory: session.baseline?.worldHistory,
  };
  const worldSignature = (world) => JSON.stringify({
    task: world?.task,
    featureNames: world?.featureNames,
    observations: world?.observations,
    metadata: world?.metadata,
  });
  const worldChanged = Boolean(
    baseline?.experiment?.world
    && worldSignature(baseline.experiment.world) !== worldSignature(session.experiment.world),
  );
  const controls = baseline?.controls ? structuredClone(baseline.controls) : structuredClone(session.controls);
  let modelState;
  let traces;
  let dataState;
  if (baseline?.modelState && !worldChanged) {
    modelState = structuredClone(baseline.modelState);
    traces = structuredClone(baseline.traces ?? session.traces);
    dataState = baseline.dataState ? structuredClone(baseline.dataState) : session.dataState;
  } else {
    const source = sourceFromWorld(session.sourceData, session.experiment.world);
    const recorder = createTraceRecorder();
    const initialized = adapter.initialize({ source, controls, seed: session.seed, recorder });
    modelState = initialized.modelState;
    traces = recorder.list();
    dataState = buildDataState({ source, workspaceDataset: null });
  }
  const source = sourceFromWorld(session.sourceData, session.experiment.world);
  const baselineHistoryIds = new Set((baseline?.worldHistory?.past ?? []).map((entry) => entry.record.id));
  const preservedWorldMutations = session.worldHistory.past
    .filter((entry) => !baselineHistoryIds.has(entry.record.id))
    .map((entry) => structuredClone(entry.record));
  const resetBaseExperiment = baseline?.experiment ?? session.experiment;
  const experiment = synchronizeExperiment({
    ...resetBaseExperiment,
    mutations: [
      ...(baseline?.experiment?.mutations ?? resetBaseExperiment.mutations),
      ...preservedWorldMutations,
    ],
  }, {
    world: session.experiment.world,
    source,
    points: modelState.points,
    controls,
    controlDescriptors: modelControlsFor(session),
    adapterId: session.adapterId,
    seed: session.seed,
    traces,
  });
  return {
    ...session,
    controls,
    modelState,
    sourceData: source,
    dataState,
    experiment,
    traces,
    timeline: { step: 0, totalSteps: 0, speed: session.timeline.speed ?? 1 },
    visualState: {},
    scriptState: { status: 'ready', step: 0, totalSteps: session.script?.steps.length ?? 0 },
    status: 'paused',
  };
}

export function dispatchRuntimeAction(session, action) {
  validateActionShape(action);
  const playground = getPlayground(session.playgroundId);
  if (!playground) throw playgroundError('PLAYGROUND_NOT_FOUND', { playgroundId: session.playgroundId });
  // A Data Lab session remains the outer shell after a model is attached, but
  // model-specific actions belong to the attached model descriptor. Keeping
  // the two identities separate lets World actions stay Data Lab-scoped while
  // script invocations such as START_TRAINING pass the model action contract.
  const actionPlayground = session.modelPlaygroundId
    ? getPlayground(session.modelPlaygroundId) ?? playground
    : playground;
  if (!GENERIC_ACTIONS.includes(action.type)
    && !isPublicWorldOperation(action.type)
    && !actionPlayground.actions.includes(action.type)) {
    throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type, playgroundId: actionPlayground.id });
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
    const control = modelControlsFor(session).find((item) => item.key === action.key);
    if (!control) throw playgroundError('INVALID_PLAYGROUND_CONTROL', { key: action.key });
    const value = validateControlValue(control, action.value);
    const { next, recorder } = applyModelAction(session, { ...action, value });
    return { ...next, status: 'paused', traces: recorder.list() };
  }
  if (action.type === 'SET_VISUAL') {
    return { ...session, visualState: { ...session.visualState, ...(action.patch ?? {}) } };
  }
  if (action.type === 'SET_WORKSPACE_VIEW') {
    return {
      ...session,
      viewState: validateViewPatch(session.viewState, action.patch, session.experiment.world.featureNames),
    };
  }
  if (action.type === 'APPLY_WORLD_TRANSACTION') {
    const id = action.transaction?.id ?? `${session.sessionId}-world-${session.worldActionCounter + 1}`;
    if ([...session.worldHistory.past, ...session.worldHistory.future].some((entry) => entry.record.id === id)) {
      throw playgroundError('INVALID_PLAYGROUND_ACTION', { type: action.type, reason: 'duplicate transaction id', id });
    }
    const result = applyWorldTransaction(session.experiment.world, { ...action.transaction, id });
    const historyEntry = { record: result.record, forward: result.forward, inverse: result.inverse };
    return {
      ...synchronizeWorldSession(session, result, {
        history: {
          past: [...session.worldHistory.past, historyEntry].slice(-MAX_WORLD_HISTORY_ACTIONS),
          future: [],
        },
        mutationRecord: result.record,
      }),
      worldActionCounter: session.worldActionCounter + 1,
    };
  }
  if (action.type === 'ATTACH_MODEL') {
    return attachModelSession(session, action.modelPlaygroundId ?? action.modelId);
  }
  const compatibilityTransaction = canonicalWorldTransaction(action);
  if (compatibilityTransaction) {
    return dispatchRuntimeAction(session, {
      type: 'APPLY_WORLD_TRANSACTION',
      transaction: compatibilityTransaction,
    });
  }
  if (action.type === 'UNDO_WORLD_ACTION') {
    const entry = session.worldHistory.past.at(-1);
    if (!entry) return session;
    const result = applyWorldTransaction(session.experiment.world, entry.inverse);
    return synchronizeWorldSession(session, result, {
      history: {
        past: session.worldHistory.past.slice(0, -1),
        future: [entry, ...session.worldHistory.future],
      },
      mutationRecord: {
        id: `${entry.record.id}-undo`,
        actor: ['human', 'agent', 'system'].includes(action.actor) ? action.actor : 'human',
        domain: 'world',
        intent: 'undo',
        mutationSummary: { actionId: entry.record.id },
      },
    });
  }
  if (action.type === 'REDO_WORLD_ACTION') {
    const entry = session.worldHistory.future[0];
    if (!entry) return session;
    const result = applyWorldTransaction(session.experiment.world, entry.forward);
    const redoneEntry = { ...entry, forward: result.forward, inverse: result.inverse };
    return synchronizeWorldSession(session, result, {
      history: {
        past: [...session.worldHistory.past, redoneEntry].slice(-MAX_WORLD_HISTORY_ACTIONS),
        future: session.worldHistory.future.slice(1),
      },
      mutationRecord: {
        id: `${entry.record.id}-redo`,
        actor: ['human', 'agent', 'system'].includes(action.actor) ? action.actor : 'human',
        domain: 'world',
        intent: 'redo',
        mutationSummary: { actionId: entry.record.id },
      },
    });
  }
  if (action.type === 'RESET_LEARNING') return resetLearningSession(session);
  if (action.type === 'RUN') return runCurrentWorld(session);
  if (action.type === 'RESTORE_ORIGINAL_DATA') return restoreOriginalDataSession(session);
  if (action.type === 'PLAY') {
    if (session.timeline.totalSteps > 0 && session.timeline.step >= session.timeline.totalSteps) {
      return { ...session, status: 'completed' };
    }
    if (session.timeline.totalSteps <= 0 && modelAdapterFor(session)) {
      const started = dispatchRuntimeAction(session, { type: 'START_TRAINING' });
      return { ...started, status: 'playing' };
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
        experiment: structuredClone(session.experiment),
        source: structuredClone(session.sourceData ?? session.source),
        seed: session.seed,
        traces: structuredClone(session.traces),
        worldHistory: structuredClone(session.worldHistory),
        worldActionCounter: session.worldActionCounter,
        viewState: structuredClone(session.viewState),
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
    return resetVisualizationScript(session);
  }
  if (action.type === 'SCRIPT_CAPTURE') {
    const semantic = semanticContext(session);
    return {
      ...session,
      captures: {
        ...session.captures,
        [action.captureId]: {
          controls: structuredClone(session.controls),
          modelState: structuredClone(session.modelState),
          dataState: session.dataState ? structuredClone(session.dataState) : {},
          experiment: structuredClone(session.experiment),
          sourceData: structuredClone(session.sourceData),
          worldHistory: structuredClone(session.worldHistory),
          worldActionCounter: session.worldActionCounter,
          viewState: structuredClone(session.viewState),
          timeline: structuredClone(session.timeline),
          traceCount: session.traces.length,
          scene: jsonSafe(semantic.scene),
          semantic: {
            scene: jsonSafe(semantic.scene),
            metrics: jsonSafe(semantic.metrics),
            observation: jsonSafe(semantic.observation),
            formula: jsonSafe(semantic.formula),
          },
        },
      },
    };
  }
  if (action.type === 'SCRIPT_RESTORE_CAPTURE') {
    const captured = session.captures?.[action.captureId];
    if (!captured) {
      throw scriptError('SCRIPT_CAPTURE_MISSING', { captureId: action.captureId });
    }
    const source = sourceFromWorld(session.sourceData, session.experiment.world);
    const restoredExperiment = synchronizeExperiment(session.experiment, {
      world: session.experiment.world,
      source,
      points: captured.modelState?.points,
      controls: captured.controls,
      controlDescriptors: modelControlsFor(session),
      adapterId: session.adapterId,
      seed: session.seed,
      traces: Number.isInteger(captured.traceCount)
        ? session.traces.slice(0, captured.traceCount)
        : session.traces,
    });
    return {
      ...session,
      controls: structuredClone(captured.controls),
      modelState: structuredClone(captured.modelState),
      dataState: buildDataState({ source, workspaceDataset: null }),
      experiment: restoredExperiment,
      sourceData: source,
      worldHistory: session.worldHistory,
      worldActionCounter: Number.isInteger(captured.worldActionCounter)
        ? captured.worldActionCounter
        : session.worldActionCounter,
      viewState: session.viewState,
      timeline: captured.timeline ? structuredClone(captured.timeline) : session.timeline,
      // Branch isolation: the trace history returns to the baseline
      // checkpoint so branch B emits exactly the same evidence as a fresh
      // baseline -> branch B run. sessionBaseline / scriptBaseline /
      // scriptState are never touched by restore.
      traces: Number.isInteger(captured.traceCount)
        ? session.traces.slice(0, captured.traceCount)
        : session.traces,
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
  const adapter = modelAdapterFor(session);
  const { scene, metrics, observation, formula, capabilities: semanticCapabilities, modelContext } = semanticContext(session);
  const scriptLoaded = Boolean(adapter && session.scriptState && session.scriptState.totalSteps > 0);
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
  capabilities.canEditWorld = !adapter || typeof adapter.applyWorld === 'function';
  capabilities.worldOperations = capabilities.canEditWorld
    ? listWorldOperations()
    : [];
  capabilities.canCreateObservationFromProjection = canCreateObservationFromProjection(
    session.experiment.world,
    session.viewState.xFeature,
    session.viewState.yFeature,
  );
  capabilities.canUndoWorld = session.worldHistory.past.length > 0;
  capabilities.canRedoWorld = session.worldHistory.future.length > 0;
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
    modelPlaygroundId: session.modelPlaygroundId ?? null,
    model: adapter
      ? {
        adapterId: session.adapterId,
        playgroundId: session.modelPlaygroundId ?? session.playgroundId,
        titleKey: modelPlaygroundFor(session)?.titleKey ?? null,
        descriptionKey: modelPlaygroundFor(session)?.descriptionKey ?? null,
      }
      : null,
    availableModels: session.playgroundId === 'data-lab'
      ? compatibleModelPlaygrounds(session).map((playground) => ({
        id: playground.id,
        titleKey: playground.titleKey,
        descriptionKey: playground.descriptionKey,
      }))
      : [],
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
    experiment: jsonSafe(session.experiment),
    world: jsonSafe(session.experiment?.world),
    viewState: jsonSafe(session.viewState),
    actionHistory: {
      past: session.worldHistory.past.map((entry) => jsonSafe(entry.record)),
      future: session.worldHistory.future.map((entry) => jsonSafe(entry.record)),
    },
    primitives: primitives.map((primitive) => jsonSafe(primitive)),
  };
}
