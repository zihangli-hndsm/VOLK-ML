import { cloneExperiment, duplicateExperiment } from './experiment.js';
import { compareExperiments } from './comparison.js';

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
  };
}

function recordFromSession(session, metadata = {}) {
  return {
    id: metadata.id ?? session.experiment.id,
    name: metadata.name ?? 'A',
    parentExperimentId: metadata.parentExperimentId ?? session.experiment.lineage?.parentId ?? null,
    baselineExperimentId: metadata.baselineExperimentId ?? session.experiment.lineage?.baselineId ?? null,
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

function rekeyState(state, experiment) {
  const next = clone(state);
  next.experiment = cloneExperiment(experiment);
  if (next.baseline?.experiment) next.baseline.experiment = cloneExperiment(experiment);
  if (next.scriptBaseline?.experiment) next.scriptBaseline.experiment = cloneExperiment(experiment);
  return next;
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
  const state = rekeyState(captureExperimentRuntime(prepared), experiment);
  const name = Object.keys(workspace.entries).length === 1 ? 'B' : `Experiment ${ordinal}`;
  return {
    ...prepared,
    experiment,
    baseline: state.baseline,
    sourceData: state.sourceData,
    source: state.source,
    controls: state.controls,
    modelState: state.modelState,
    dataState: state.dataState,
    worldHistory: state.worldHistory,
    worldActionCounter: state.worldActionCounter,
    viewState: state.viewState,
    timeline: state.timeline,
    traces: state.traces,
    visualState: state.visualState,
    script: state.script,
    scriptState: state.scriptState,
    scriptBaseline: state.scriptBaseline,
    captures: state.captures,
    scenario: state.scenario,
    status: 'paused',
    experimentUndo: clone(prepared.experimentUndo ?? []),
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
          parentExperimentId: sourceId,
          baselineExperimentId: sourceId,
          state,
          undo: clone(prepared.experimentUndo ?? []),
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
  const state = clone(target.state);
  return {
    ...prepared,
    ...state,
    status: 'paused',
    experimentUndo: clone(target.undo ?? []),
    scriptState: state.scriptState ? { ...state.scriptState, status: 'paused' } : state.scriptState,
    experimentWorkspace: {
      ...workspace,
      activeExperimentId: target.id,
    },
  };
}

export function setExperimentComparison(session, { enabled = true, againstExperimentId } = {}) {
  const prepared = syncActiveExperiment(session);
  const workspace = prepared.experimentWorkspace;
  const targetId = againstExperimentId
    ?? workspace.comparison.againstExperimentId
    ?? Object.keys(workspace.entries).find((id) => id !== workspace.activeExperimentId)
    ?? null;
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

export function resetActiveExperiment(session) {
  const prepared = syncActiveExperiment(session);
  const baseline = prepared.baseline ?? {};
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
    parentExperimentId: record.parentExperimentId ?? null,
    baselineExperimentId: record.baselineExperimentId ?? null,
  }));
  const target = workspace.comparison.enabled
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
    },
    repeat: {
      available: Boolean(prepared.adapterId),
      seed: prepared.seed ?? null,
      policy: prepared.seed === null || prepared.seed === undefined ? 'unspecified' : 'fixed-seed',
    },
  };
}
