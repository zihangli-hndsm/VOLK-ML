import { conditionFingerprintForSession, deriveObservableSet, isRepeatEvidenceCurrent } from './observables.js';
import { explorationThreadError, EXPLORATION_THREAD_LIMITS } from './explorationThread.js';

const clone = (value) => structuredClone(value);
const DEFAULT_OBSERVABLES = ['model.slope', 'model.bias', 'outcome.trainMse', 'outcome.testMse', 'generalizationGap', 'coverageMismatch'];

function fingerprintForState(state) {
  return conditionFingerprintForSession({
    world: state?.experiment?.world,
    adapterId: state?.adapterId ?? state?.experiment?.model?.adapterId,
    experiment: state?.experiment,
  });
}

function scenarioReference(scenario) {
  if (!scenario) return undefined;
  return {
    version: scenario.version ?? 1,
    change: (scenario.change ?? []).map((item) => ({ semanticTarget: item.semanticTarget, operation: item.operation })),
    hold: [...(scenario.hold ?? [])],
    observe: [...(scenario.observe ?? [])],
  };
}

function compactSemanticDiff(diff) {
  if (!diff) return undefined;
  return {
    changed: [...(diff.changed ?? [])],
    unchanged: [...(diff.unchanged ?? [])],
    clarity: diff.clarity ?? null,
    identical: Boolean(diff.identical),
    details: diff.details?.worldGenerator ? {
      worldGenerator: {
        changed: [...(diff.details.worldGenerator.changed ?? [])],
        unchanged: [...(diff.details.worldGenerator.unchanged ?? [])],
      },
    } : undefined,
  };
}

function workspaceIdentity(session, snapshot) {
  const workspace = session.experimentWorkspace;
  const activeId = snapshot.experimentWorkspace?.activeExperimentId ?? workspace.activeExperimentId;
  const againstId = snapshot.experimentWorkspace?.comparison?.againstExperimentId ?? workspace.comparison?.againstExperimentId;
  const enabled = Boolean(snapshot.experimentWorkspace?.comparison?.enabled && againstId && againstId !== activeId);
  const experimentIds = enabled ? [againstId, activeId] : [activeId];
  const conditionFingerprints = {};
  for (const id of experimentIds) {
    const state = id === activeId ? session : workspace.entries[id]?.state;
    const fingerprint = fingerprintForState(state);
    if (fingerprint) conditionFingerprints[id] = fingerprint;
  }
  return { activeId, againstId: enabled ? againstId : null, enabled, experimentIds, conditionFingerprints };
}

export function captureThreadExperiment({ session, snapshot, scenario, actor = 'human' } = {}) {
  const identity = workspaceIdentity(session, snapshot);
  if (!identity.activeId || !session.experimentWorkspace?.entries?.[identity.activeId]) {
    throw explorationThreadError('EXPLORATION_THREAD_EXPERIMENT_UNAVAILABLE', { experimentId: identity.activeId });
  }
  return {
    kind: 'experiment',
    actor,
    experimentIds: identity.experimentIds,
    activeExperimentId: identity.activeId,
    baselineExperimentId: identity.againstId ?? identity.activeId,
    comparison: { enabled: identity.enabled, againstExperimentId: identity.againstId },
    conditionFingerprints: identity.conditionFingerprints,
    semanticDiff: compactSemanticDiff(snapshot.experimentWorkspace?.comparison?.diff),
    ...(scenario?.interpretation?.summary ? { scenarioSummary: String(scenario.interpretation.summary).slice(0, 320) } : {}),
    ...(scenario ? { scenarioReference: scenarioReference(scenario) } : {}),
  };
}

function observationRecord(source, id) {
  const item = source?.[id];
  return item?.available ? item.value : undefined;
}

function addAvailable(target, ids, active, baseline) {
  for (const id of ids) {
    if (Object.keys(target).length >= EXPLORATION_THREAD_LIMITS.maxObservablesPerObservation) break;
    const activeValue = observationRecord(active?.raw, id) ?? observationRecord(active?.derived, id);
    const baselineValue = observationRecord(baseline?.raw, id) ?? observationRecord(baseline?.derived, id);
    if (activeValue === undefined && baselineValue === undefined) continue;
    target[id] = activeValue === undefined
      ? { baseline: clone(baselineValue) }
      : baselineValue === undefined
        ? { active: clone(activeValue) }
        : { active: clone(activeValue), baseline: clone(baselineValue) };
  }
}

function compactRepeat(repeatEvidence, fingerprint) {
  if (!isRepeatEvidenceCurrent(repeatEvidence, fingerprint)) return undefined;
  return {
    conditionFingerprint: fingerprint,
    trialCount: repeatEvidence.trialCount,
    seedPolicy: repeatEvidence.seedPolicy,
    baseSeed: repeatEvidence.baseSeed,
    aggregates: clone(repeatEvidence.aggregates ?? {}),
  };
}

export function captureThreadObservation({ session, snapshot, scenario, note, actor = 'human' } = {}) {
  const identity = workspaceIdentity(session, snapshot);
  const activeState = identity.activeId === session.experimentWorkspace.activeExperimentId
    ? session
    : session.experimentWorkspace.entries[identity.activeId]?.state;
  const baselineState = identity.againstId ? session.experimentWorkspace.entries[identity.againstId]?.state : null;
  if (!activeState) throw explorationThreadError('EXPLORATION_THREAD_EXPERIMENT_UNAVAILABLE', { experimentId: identity.activeId });
  if (identity.againstId && !baselineState) throw explorationThreadError('EXPLORATION_THREAD_EXPERIMENT_UNAVAILABLE', { experimentId: identity.againstId });
  const activeFingerprint = identity.conditionFingerprints[identity.activeId];
  const activeEvidence = { raw: snapshot.observables, derived: snapshot.derivedObservables };
  const baselineEvidence = baselineState
    ? deriveObservableSet({ world: baselineState.experiment.world, result: baselineState.experiment.result })
    : null;
  const observeIds = [...new Set([...(scenario?.observe ?? []), ...DEFAULT_OBSERVABLES])];
  const observables = {};
  addAvailable(observables, observeIds, activeEvidence, baselineEvidence);
  const notices = (snapshot.observations ?? []).slice(0, EXPLORATION_THREAD_LIMITS.maxNoticesPerObservation).map((item) => ({
    id: item.id,
    severity: item.severity,
    messageKey: item.messageKey,
    evidence: clone(item.evidence ?? {}),
  }));
  return {
    kind: 'observation',
    actor,
    experimentIds: identity.experimentIds,
    conditionFingerprints: identity.conditionFingerprints,
    evidence: {
      observables,
      semanticDiff: compactSemanticDiff(snapshot.experimentWorkspace?.comparison?.diff),
      notices,
      ...(compactRepeat(snapshot.repeatEvidence, activeFingerprint) ? { repeatEvidence: compactRepeat(snapshot.repeatEvidence, activeFingerprint) } : {}),
    },
    ...(note ? { note: String(note).slice(0, EXPLORATION_THREAD_LIMITS.maxNoteLength) } : {}),
    historical: true,
    ...(scenario ? { scenarioReference: scenarioReference(scenario) } : {}),
  };
}
