import { cloneExperiment, duplicateExperiment } from './experiment.js';
import { compareExperiments } from './comparison.js';
import { projectedBounds } from './projection.js';

export const EXPERIMENT_WORKSPACE_VERSION = 1;
export const MAX_EXPERIMENT_UNDO = 50;

const clone = (value) => structuredClone(value);

export function captureExperimentRuntime(session) {
  return {
    baseline: clone(session.baseline),
    sourceData: clone(session.sourceData),
    source: clone(session.source),
    controls: clone(session.controls),
    modelState: clone(session.modelState),
    dataState: clone(session.dataState),
    experiment: cloneExperiment(session.experiment),
    worldHistory: clone(session.worldHistory),
    worldActionCounter: session.worldActionCounter,
    viewState: clone(session.viewState),
    timeline: clone(session.timeline),
    traces: clone(session.traces),
    visualState: clone(session.visualState),
    script: clone(session.script),
    scriptState: clone(session.scriptState),
    scriptBaseline: clone(session.scriptBaseline),
    captures: clone(session.captures),
    scenario: clone(session.scenario),
    status: session.status,
    seed: session.seed,
  };
}

function recordFromSession(session, metadata = {}) {
  return {
    id: metadata.id ?? session.experiment.id,
    name: metadata.name ?? 'A',
    state: captureExperimentRuntime(session),
    undo: clone(session.experimentUndo ?? []),
  };
}

function initialWorkspace(session) {
  const id = session.experiment.id;
  return {
    version: EXPERIMENT_WORKSPACE_VERSION,
    activeExperimentId: id,
    nextOrdinal: 2,
    entries: {
      [id]: recordFromSession(session, { id, name: 'A' }),
    },
    comparison: {
      enabled: false,
      againstExperimentId: null,
    },
  };
}

export function ensureExperimentWorkspace(session) {
  if (session.experimentWorkspace?.version === EXPERIMENT_WORKSPACE_VERSION) return session;
  return { ...session, experimentWorkspace: initialWorkspace(session) };
}

export function syncActiveExperiment(session) {
  const prepared = ensureExperimentWorkspace(session);
  const workspace = prepared.experimentWorkspace;
  const activeId = workspace.activeExperimentId ?? prepared.experiment.id;
  const current = workspace.entries[activeId] ?? recordFromSession(prepared, { id: activeId });
  return {
    ...prepared,
    experimentWorkspace: {
      ...workspace,
      activeExperimentId: activeId,
      entries: {
        ...workspace.entries,
        [activeId]: recordFromSession(prepared, {
          ...current,
          id: activeId,
        }),
      },
    },
  };
}

function baselineFromState(state) {
  return {
    controls: clone(state.controls),
    modelState: clone(state.modelState),
    source: clone(state.sourceData),
    dataState: clone(state.dataState),
    experiment: cloneExperiment(state.experiment),
    traces: clone(state.traces),
    worldHistory: clone(state.worldHistory),
    seed: state.seed ?? state.experiment.randomness?.seed ?? null,
  };
}

function scriptBaselineFromState(state) {
  return state.script
    ? {
      controls: clone(state.controls),
      modelState: clone(state.modelState),
      dataState: clone(state.dataState),
      experiment: cloneExperiment(state.experiment),
      source: clone(state.sourceData),
      seed: state.seed ?? state.experiment.randomness?.seed ?? null,
      traces: clone(state.traces),
      worldHistory: clone(state.worldHistory),
      worldActionCounter: state.worldActionCounter,
      viewState: clone(state.viewState),
    }
    : null;
}

export function duplicateActiveExperiment(session) {
  const prepared = syncActiveExperiment(session);
  const workspace = prepared.experimentWorkspace;
  const sourceId = workspace.activeExperimentId;
  const ordinal = workspace.nextOrdinal ?? Object.keys(workspace.entries).length + 1;
  const id = `${sourceId}-copy-${ordinal}`;
  const experiment = duplicateExperiment(prepared.experiment, {
    id,
    parentId: sourceId,
  });
  const state = captureExperimentRuntime(prepared);
  state.experiment = cloneExperiment(experiment);
  // A duplicate is a branch from the exact current runtime state. Rebuilding
  // both baselines from that same captured state prevents a hybrid such as a
  // current World paired with the session-open model/data baseline.
  state.baseline = baselineFromState(state);
  state.scriptBaseline = scriptBaselineFromState(state);
  const name = Object.keys(workspace.entries).length === 1 ? 'B' : `Experiment ${ordinal}`;
  return {
    ...prepared,
    ...state,
    status: 'paused',
    experimentUndo: [],
    experimentWorkspace: {
      ...workspace,
      activeExperimentId: id,
      nextOrdinal: ordinal + 1,
      entries: {
        ...workspace.entries,
        [sourceId]: prepared.experimentWorkspace.entries[sourceId],
        [id]: {
          id,
          name,
          state,
          undo: [],
        },
      },
      comparison: {
        enabled: false,
        againstExperimentId: sourceId,
      },
    },
  };
}

export function switchExperiment(session, experimentId) {
  const prepared = syncActiveExperiment(session);
  const workspace = prepared.experimentWorkspace;
  const target = workspace.entries[String(experimentId)];
  if (!target) return prepared;
  if (target.id === workspace.activeExperimentId) return prepared;
  const state = clone(target.state);
  const comparison = workspace.comparison ?? { enabled: false, againstExperimentId: null };
  let nextAgainst = comparison.againstExperimentId;
  if (nextAgainst === target.id) nextAgainst = workspace.activeExperimentId;
  if (comparison.enabled && (!nextAgainst || nextAgainst === target.id)) {
    nextAgainst = Object.keys(workspace.entries).find((id) => id !== target.id) ?? null;
  }
  return {
    ...prepared,
    ...state,
    status: 'paused',
    experimentUndo: clone(target.undo ?? []),
    scriptState: state.scriptState ? { ...state.scriptState, status: 'paused' } : state.scriptState,
    experimentWorkspace: {
      ...workspace,
      activeExperimentId: target.id,
      comparison: {
        ...comparison,
        enabled: Boolean(comparison.enabled && nextAgainst && nextAgainst !== target.id),
        againstExperimentId: nextAgainst,
      },
    },
  };
}

export function setExperimentComparison(session, { enabled = true, againstExperimentId } = {}) {
  const prepared = syncActiveExperiment(session);
  const workspace = prepared.experimentWorkspace;
  let targetId = againstExperimentId
    ?? workspace.comparison.againstExperimentId
    ?? Object.keys(workspace.entries).find((id) => id !== workspace.activeExperimentId)
    ?? null;
  if (targetId === workspace.activeExperimentId) {
    targetId = Object.keys(workspace.entries).find((id) => id !== workspace.activeExperimentId) ?? null;
  }
  if (enabled && (!targetId || !workspace.entries[targetId])) return prepared;
  return {
    ...prepared,
    experimentWorkspace: {
      ...workspace,
      comparison: {
        enabled: Boolean(enabled),
        againstExperimentId: targetId,
      },
    },
  };
}

function comparisonBoundsFor(leftState, rightState) {
  const leftWorld = leftState?.experiment?.world;
  const rightWorld = rightState?.experiment?.world;
  if (!leftWorld || !rightWorld || leftWorld.featureNames?.length !== 2 || rightWorld.featureNames?.length !== 2) return null;
  const xFeature = leftState.viewState?.xFeature ?? leftWorld.featureNames[0];
  const yFeature = leftState.viewState?.yFeature ?? leftWorld.featureNames[1];
  if (!rightWorld.featureNames.includes(xFeature) || !rightWorld.featureNames.includes(yFeature)) return null;
  const bounds = [leftWorld, rightWorld].map((world) => projectedBounds(world.observations, xFeature, yFeature));
  return {
    xMin: Math.min(...bounds.map((value) => value.xMin)),
    xMax: Math.max(...bounds.map((value) => value.xMax)),
    yMin: Math.min(...bounds.map((value) => value.yMin)),
    yMax: Math.max(...bounds.map((value) => value.yMax)),
    xFeature,
    yFeature,
  };
}

export function resetActiveExperiment(session) {
  const prepared = syncActiveExperiment(session);
  const baseline = prepared.baseline ?? {};
  const baselineSeed = baseline.seed ?? baseline.experiment?.randomness?.seed ?? prepared.seed ?? null;
  return {
    ...prepared,
    sourceData: clone(baseline.source ?? prepared.sourceData),
    source: { ...prepared.source, ...(baseline.source ? { name: baseline.source.name, fingerprint: baseline.source.fingerprint, stale: false } : {}) },
    controls: clone(baseline.controls ?? prepared.controls),
    modelState: clone(baseline.modelState ?? prepared.modelState),
    dataState: clone(baseline.dataState ?? prepared.dataState),
    experiment: cloneExperiment(baseline.experiment ?? prepared.experiment),
    worldHistory: clone(baseline.worldHistory ?? { past: [], future: [] }),
    worldActionCounter: 0,
    viewState: clone(baseline.viewState ?? prepared.viewState),
    timeline: { step: 0, totalSteps: 0, speed: prepared.timeline.speed ?? 1 },
    traces: clone(baseline.traces ?? []),
    seed: baselineSeed,
    visualState: {},
    status: 'paused',
    experimentUndo: [],
    scriptState: prepared.script ? { status: 'ready', step: 0, totalSteps: prepared.script.steps.length } : { status: 'idle', step: 0, totalSteps: 0 },
  };
}

export function restoreExperimentRuntime(session, state, { undo = [] } = {}) {
  return {
    ...session,
    ...clone(state),
    experimentWorkspace: session.experimentWorkspace,
    experimentUndo: clone(undo),
  };
}

function resultForRecord(record) {
  return record?.state?.experiment?.result ?? null;
}

export function deriveExperimentWorkspace(session) {
  // Keep ordinary playground/playback snapshots cheap. The active entry only
  // needs a fresh runtime capture while an A/B comparison is visible; explicit
  // workspace operations synchronize before they mutate or switch entries.
  const prepared = session.experimentWorkspace?.comparison?.enabled
    ? syncActiveExperiment(session)
    : ensureExperimentWorkspace(session);
  const workspace = prepared.experimentWorkspace;
  const active = recordFromSession(prepared, {
    ...workspace.entries[workspace.activeExperimentId],
    id: workspace.activeExperimentId,
  });
  const entries = Object.values(workspace.entries).map((record) => ({
    id: record.id,
    name: record.name,
    parentExperimentId: record.state?.experiment?.lineage?.parentId ?? null,
    baselineExperimentId: record.state?.experiment?.lineage?.baselineId ?? null,
  }));
  const target = workspace.comparison.enabled && workspace.comparison.againstExperimentId !== workspace.activeExperimentId
    ? workspace.entries[workspace.comparison.againstExperimentId]
    : null;
  const diff = target ? compareExperiments(active.state.experiment, target.state.experiment) : null;
  return {
    version: EXPERIMENT_WORKSPACE_VERSION,
    activeExperimentId: workspace.activeExperimentId,
    experiments: entries,
    comparison: {
      enabled: Boolean(workspace.comparison.enabled && target),
      againstExperimentId: workspace.comparison.againstExperimentId,
      diff,
      results: target ? {
        active: resultForRecord(active),
        against: resultForRecord(target),
      } : null,
      bounds: target ? comparisonBoundsFor(active.state, target.state) : null,
    },
    repeat: {
      available: Boolean(prepared.adapterId),
      seed: prepared.seed ?? null,
      policy: prepared.seed === null || prepared.seed === undefined ? 'unspecified' : 'fixed-seed',
    },
  };
}
