// Maps existing Episode 1 policy output to presentation-only targets.
const STAGES = new Set(['baseline-fit', 'resample', 'evidence', 'concept']);
const ACTIONS = new Set(['RUN', 'RESAMPLE_WORLD', 'SET_COMPARE']);

export function createLumiPolicyRequestIdentity(snapshot = null) {
  const runtime = snapshot?.inquiryRuntime;
  const sequence = snapshot?.semanticEvents?.events?.at(-1)?.sequence ?? 0;
  const key = runtime ? `${runtime.contractId}:${runtime.stage}:${sequence}` : null;
  return Object.freeze({ key, contractId: runtime?.contractId ?? null, stage: runtime?.stage ?? null, sequence });
}

export function isCurrentLumiPolicyResult({ requestId, currentRequestId, requestIdentity, currentIdentity } = {}) {
  return Boolean(requestId && currentRequestId && requestId === currentRequestId
    && requestIdentity?.key && requestIdentity.key === currentIdentity?.key);
}

export function isEpisode1StageLegal(stage) {
  return STAGES.has(stage);
}

function episode1Facts(snapshot, runtime) {
  const workspace = snapshot?.experimentWorkspace;
  const baselineId = runtime?.baseline?.experimentId ?? null;
  const activeId = workspace?.activeExperimentId ?? null;
  const hasBaselineFit = Boolean(runtime?.baseline?.fit?.fitId);
  const hasActiveFit = Boolean(runtime?.activeFit?.fitId && runtime.activeFit.experimentId === activeId);
  const hasSecondBranch = Boolean(activeId && baselineId && activeId !== baselineId);
  const sampledActiveBranch = (runtime?.recentSemanticEvents ?? []).some((event) => event?.type === 'observation.sampled' && (event.experimentIds ?? []).includes(activeId));
  const comparison = runtime?.comparison ?? workspace?.comparison ?? null;
  return { baselineId, activeId, hasBaselineFit, hasActiveFit, hasSecondBranch, sampledActiveBranch, comparison };
}

export function deriveEpisode1NextOperation(snapshot = null) {
  const runtime = snapshot?.inquiryRuntime;
  if (!runtime || !isEpisode1StageLegal(runtime.stage)) return null;
  const facts = episode1Facts(snapshot, runtime);
  if (!facts.hasBaselineFit) return 'RUN';
  if (!facts.hasSecondBranch && !facts.comparison?.enabled) return 'RESAMPLE_WORLD';
  if (facts.hasSecondBranch && !facts.sampledActiveBranch && !facts.comparison?.enabled) return 'RESAMPLE_WORLD';
  if (facts.hasSecondBranch && facts.sampledActiveBranch && !facts.hasActiveFit && !facts.comparison?.enabled) return 'RUN';
  if (facts.hasSecondBranch && facts.hasActiveFit && !facts.comparison?.enabled && facts.comparison?.againstExperimentId) return 'SET_COMPARE';
  if (runtime.evidence?.status === 'valid-weak') return 'RESAMPLE_WORLD';
  return null;
}

export function deriveEpisode1GuidanceStage(snapshot = null) {
  const runtime = snapshot?.inquiryRuntime;
  if (!runtime || !isEpisode1StageLegal(runtime.stage)) return runtime?.stage ?? null;
  const facts = episode1Facts(snapshot, runtime);
  if (!facts.hasBaselineFit) return 'baseline-fit';
  if (!facts.hasSecondBranch) return 'resample';
  if (!facts.sampledActiveBranch) return 'resample';
  if (!facts.hasActiveFit) return 'fit-b';
  if (!facts.comparison?.enabled) return 'compare';
  return runtime.evidence?.status === 'valid-weak' ? 'repeat-resample' : 'concept';
}

export function deriveEpisode1Guidance({ snapshot = null, policyAction = null } = {}) {
  const runtime = snapshot?.inquiryRuntime;
  const stage = runtime?.stage;
  if (!isEpisode1StageLegal(stage) || !policyAction) return null;
  const actionType = policyAction.type ?? policyAction.action ?? null;
  if (actionType === 'STAY_SILENT') return null;
  const operation = deriveEpisode1NextOperation(snapshot);
  if (actionType === 'SUGGEST_EXPERIMENT' && operation && ACTIONS.has(operation)) {
    const targetKey = operation === 'RUN'
      ? 'model.fit'
      : operation === 'RESAMPLE_WORLD' ? 'world.sample' : 'experiment.compare';
    const requestReason = operation === 'RUN'
      ? (episode1Facts(snapshot, runtime).hasSecondBranch ? 'fit-active-branch' : 'baseline-fit')
      : operation === 'RESAMPLE_WORLD' ? 'same-world-resample' : 'compare-evidence';
    return { targetKey, actionType, proposalOnly: true, stage, requestReason, operation };
  }
  if ((stage === 'concept' || runtime?.evidence?.status === 'evidenced') && ['NAME_CONNECTION', 'HIGHLIGHT_EVIDENCE'].includes(actionType)) return { targetKey: actionType === 'HIGHLIGHT_EVIDENCE' ? 'evidence.current' : 'ideas.map', actionType, proposalOnly: true, stage, requestReason: 'concept-connection' };
  return null;
}
