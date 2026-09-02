import { EPISODE_ONE_ORCHESTRATION_CONTRACT } from './inquiryContracts.js';
import { detectSamplingVariability } from './samplingVariability.js';

export const INQUIRY_RUNTIME_VERSION = 1;

const clone = (value) => structuredClone(value);
const fitIdentity = (entry) => entry?.state?.experiment?.result?.model && Number.isFinite(Number(entry.state.experiment.result.model.weight))
  ? { experimentId: entry.id, fitId: `${entry.id}:fit:${entry.state.experiment.result.model.trainingStep ?? 0}`, weight: Number(entry.state.experiment.result.model.weight), bias: Number(entry.state.experiment.result.model.bias) }
  : null;

export function deriveInquiryRuntimeState({ snapshot, semanticEvents, learnerInquiry, sessionState = {}, contract = EPISODE_ONE_ORCHESTRATION_CONTRACT } = {}) {
  const workspace = snapshot?.experimentWorkspace;
  // ExperimentWorkspace exposes historical branches as `records` in the
  // presented snapshot (older hosts used `entries`). Keep the projection
  // additive and read whichever authoritative collection is present.
  const entries = workspace?.records ?? workspace?.entries ?? {};
  const ids = Object.keys(entries);
  const baselineEntry = sessionState.baselineExperimentId ? entries[sessionState.baselineExperimentId] : entries[ids[0]];
  const activeEntry = workspace?.activeExperimentId ? entries[workspace.activeExperimentId] : null;
  // The active branch is authoritative at the top level immediately after a
  // committed RUN; historical records are materialized on the next branch
  // transition. Prefer that live result so Fit A is visible in the same
  // snapshot that emitted `model.fit-completed`.
  const activeFit = fitIdentity(activeEntry) ?? (
    workspace?.activeExperimentId === snapshot?.experiment?.id
      ? fitIdentity({ id: workspace.activeExperimentId, state: { experiment: snapshot.experiment } })
      : null
  );
  const baselineFit = fitIdentity(baselineEntry) ?? (
    baselineEntry?.id === workspace?.activeExperimentId ? activeFit : null
  );
  const evidence = detectSamplingVariability({ snapshot });
  const stage = evidence.status === 'evidenced' ? 'concept' : workspace?.comparison?.enabled ? 'evidence' : baselineEntry && activeEntry && baselineEntry.id !== activeEntry.id ? 'resample' : 'baseline-fit';
  const eligibleConcepts = evidence.status === 'evidenced' ? ['SAMPLING_VARIABILITY'] : [];
  return {
    version: INQUIRY_RUNTIME_VERSION,
    contractId: contract.id,
    currentInquiry: contract.id,
    currentQuestion: sessionState.currentQuestion ?? contract.entry.questionKey,
    worldIdentity: snapshot?.worldIdentity?.fingerprint ?? null,
    stage,
    prediction: sessionState.prediction ? clone(sessionState.prediction) : null,
    actualOutcome: evidence.status === 'insufficient' ? null : evidence.status === 'evidenced' ? 'different' : 'slightly-different',
    baseline: baselineEntry ? { experimentId: baselineEntry.id, fit: baselineFit } : null,
    activeFit,
    comparison: snapshot?.experimentWorkspace?.comparison ?? null,
    recentSemanticEvents: clone((semanticEvents?.events ?? []).slice(-24)),
    observations: clone(snapshot?.observations ?? []),
    evidence: clone(evidence),
    eligibleActions: stage === 'baseline-fit' ? ['RUN'] : stage === 'resample' ? ['RESAMPLE_WORLD'] : stage === 'evidence' ? ['SET_COMPARE'] : [],
    candidateConcepts: eligibleConcepts,
    evidencedConcepts: evidence.status === 'evidenced' ? ['SAMPLING_VARIABILITY'] : [],
    encounteredConcepts: clone(sessionState.encounteredConcepts ?? []),
    currentDepth: sessionState.currentDepth ?? 'PHENOMENON',
    guidanceHistory: clone(sessionState.guidanceHistory ?? []),
    reflection: sessionState.reflection ? clone(sessionState.reflection) : null,
    continuations: clone(contract.continuations ?? []),
  };
}
