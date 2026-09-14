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

export function deriveEpisode1Guidance({ snapshot = null, policyAction = null } = {}) {
  const runtime = snapshot?.inquiryRuntime;
  const stage = runtime?.stage;
  if (!isEpisode1StageLegal(stage) || !policyAction) return null;
  const actionType = policyAction.type ?? policyAction.action ?? null;
  const operation = policyAction.payload?.operation ?? policyAction.operation ?? null;
  const allowed = runtime?.eligibleActions?.some((item) => item === operation || item?.type === operation || item?.operation === operation);
  if (actionType === 'SUGGEST_EXPERIMENT' && operation && ACTIONS.has(operation) && allowed === false) return null;
  if (stage === 'baseline-fit' && operation === 'RUN') return { targetKey: 'model.fit', actionType, proposalOnly: true, stage, requestReason: 'baseline-fit' };
  if (stage === 'resample' && operation === 'RESAMPLE_WORLD') return { targetKey: 'world.sample', actionType, proposalOnly: true, stage, requestReason: 'same-world-resample' };
  if (stage === 'evidence' && operation === 'SET_COMPARE') return { targetKey: 'experiment.compare', actionType, proposalOnly: true, stage, requestReason: 'compare-evidence' };
  if ((stage === 'concept' || runtime?.evidence?.status === 'evidenced') && ['NAME_CONNECTION', 'HIGHLIGHT_EVIDENCE'].includes(actionType)) return { targetKey: actionType === 'HIGHLIGHT_EVIDENCE' ? 'evidence.current' : 'ideas.map', actionType, proposalOnly: true, stage, requestReason: 'concept-connection' };
  return null;
}
