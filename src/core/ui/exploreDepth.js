import { CONCEPTUAL_DEPTHS } from './uiArchitecture.js';

// Presentation capabilities are derived from the runtime snapshot. They do
// not own or copy any World, Experiment, model, or evidence state.
export function deriveExploreDepthCapabilities(snapshot = {}) {
  const hasEvidence = Object.keys(snapshot.observables ?? {}).length > 0
    || Object.keys(snapshot.derivedObservables ?? {}).length > 0
    || (snapshot.observations ?? []).length > 0
    || Boolean(snapshot.repeatEvidence)
    || Boolean(snapshot.experimentWorkspace?.comparison?.enabled);
  const microscopeCapabilities = snapshot.trainingMicroscope?.capabilities ?? {};
  const hasTrainingMechanism = Boolean(
    microscopeCapabilities.lossTrace
      || microscopeCapabilities.updates
      || microscopeCapabilities.gradients?.length
  );
  const hasMechanism = Boolean(snapshot.model && (
    snapshot.timeline?.totalSteps > 0
      || snapshot.trainingMicroscope?.available
      || snapshot.formula
  ));
  const hasModelInspection = Boolean(snapshot.model && (snapshot.modelPlaygroundId || snapshot.playgroundId));

  return Object.freeze({
    [CONCEPTUAL_DEPTHS.TUNE]: Boolean(snapshot.model || snapshot.world),
    [CONCEPTUAL_DEPTHS.EVIDENCE]: hasEvidence,
    [CONCEPTUAL_DEPTHS.MECHANISM]: hasMechanism,
    [CONCEPTUAL_DEPTHS.REPRESENTATION]: hasModelInspection,
    mechanismLabelKey: hasTrainingMechanism ? 'playground.depth.howItLearns' : 'playground.depth.howItDecides',
    hasTrainingMechanism,
  });
}

export function depthTelemetryType(depth) {
  if (depth === CONCEPTUAL_DEPTHS.EVIDENCE) return 'depth_evidence_opened';
  if (depth === CONCEPTUAL_DEPTHS.MECHANISM) return 'depth_mechanism_opened';
  return null;
}
