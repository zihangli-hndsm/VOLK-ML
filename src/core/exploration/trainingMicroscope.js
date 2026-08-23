// Semantic, bounded view of runtime training evidence. This module never
// computes learning values; it only projects canonical trace events emitted by
// model adapters into a JSON-safe learner/Agent representation.

export const TRAINING_MICROSCOPE_LIMITS = Object.freeze({
  maxSteps: 100,
  maxParameters: 12,
  maxGradients: 12,
  maxPreprocessingRecords: 8,
});

const DEFAULT_CAPABILITIES = Object.freeze({
  lossTrace: false,
  parameters: [],
  gradients: [],
  updates: false,
  preprocessing: [],
});

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function currentFingerprint({ conditionFingerprint, session }) {
  return session?.modelState?.training?.conditionFingerprint
    ?? conditionFingerprint
    ?? session?.conditionFingerprint
    ?? null;
}

function eventMatches(event, { runId, fingerprint }) {
  return event?.type === 'training.step'
    && event.payload?.runId === runId
    && event.payload?.conditionFingerprint === fingerprint;
}

function preprocessingFromTraces(traces) {
  // Preprocessing events predate the training-step identity fields. They are
  // still canonical runtime facts; adapters re-emit them whenever the data
  // condition is rebuilt, so the latest event is the applicable one.
  const relevant = traces;
  const split = [...relevant].reverse().find((event) => event.type === 'split.created')?.payload;
  const normalization = [...relevant].reverse().find((event) => event.type === 'normalization.fitted')?.payload;
  const records = [];
  if (split) {
    records.push({
      id: 'train-test-split',
      kind: 'train-test-split',
      status: 'applied',
      inputSummary: { rows: finite(split.trainRows) + finite(split.testRows) },
      outputSummary: { trainRows: finite(split.trainRows), testRows: finite(split.testRows), kind: split.kind ?? null },
    });
  }
  if (normalization && Object.keys(normalization).length) {
    records.push({
      id: 'linear-z-score-normalization',
      kind: 'feature-target-normalization',
      status: 'applied',
      inputSummary: { fields: ['feature', 'target'] },
      outputSummary: {
        xMean: finite(normalization.xMean),
        xStd: finite(normalization.xStd),
        yMean: finite(normalization.yMean),
        yStd: finite(normalization.yStd),
      },
    });
  }
  return records.slice(0, TRAINING_MICROSCOPE_LIMITS.maxPreprocessingRecords);
}

function stepSummary(event) {
  const payload = event.payload;
  return {
    step: payload.step,
    runId: payload.runId,
    conditionFingerprint: payload.conditionFingerprint,
    objective: clone(payload.objective),
    parameters: clone(payload.parameters),
    gradients: clone(payload.gradients),
    update: clone(payload.update),
    outcome: clone(payload.outcome),
  };
}

export function deriveTrainingMicroscope({ session, adapter, traces = [], conditionFingerprint } = {}) {
  const capabilities = {
    ...DEFAULT_CAPABILITIES,
    ...(adapter?.trainingMicroscopeCapabilities ?? {}),
    parameters: [...(adapter?.trainingMicroscopeCapabilities?.parameters ?? [])].slice(0, TRAINING_MICROSCOPE_LIMITS.maxParameters),
    gradients: [...(adapter?.trainingMicroscopeCapabilities?.gradients ?? [])].slice(0, TRAINING_MICROSCOPE_LIMITS.maxGradients),
    preprocessing: [...(adapter?.trainingMicroscopeCapabilities?.preprocessing ?? [])].slice(0, TRAINING_MICROSCOPE_LIMITS.maxPreprocessingRecords),
  };
  const fingerprint = currentFingerprint({ conditionFingerprint, session });
  const runId = session?.modelState?.training?.runId ?? null;
  const matching = traces.filter((event) => eventMatches(event, { runId, fingerprint }));
  const steps = matching.slice(0, TRAINING_MICROSCOPE_LIMITS.maxSteps).map(stepSummary);
  const available = Boolean(adapter && (capabilities.lossTrace || capabilities.parameters.length || capabilities.gradients.length || capabilities.updates));
  const reduced = available && !(capabilities.parameters.length && capabilities.gradients.length && capabilities.updates);
  const currentRuntimeStep = finite(session?.modelState?.training?.currentStep ?? session?.timeline?.step) ?? 0;
  const totalSteps = finite(session?.modelState?.training?.totalSteps ?? session?.timeline?.totalSteps) ?? steps.length;
  const selected = steps.find((step) => step.step === currentRuntimeStep) ?? null;
  const canStep = available && (totalSteps <= 0 || currentRuntimeStep < totalSteps);
  return clone({
    version: 1,
    available,
    status: !available ? 'unavailable' : (reduced ? 'reduced' : (steps.length ? 'available' : 'ready')),
    runIdentity: { runId, conditionFingerprint: fingerprint },
    currentConditionFingerprint: fingerprint,
    canStep,
    capabilities,
    currentRuntimeStep,
    totalSteps,
    selectedStep: selected,
    steps,
    lossTrace: capabilities.lossTrace
      ? steps.map((step) => ({
        step: step.step,
        // The visible trajectory follows the post-update state revealed by
        // STEP/SEEK; selected records retain both objective timings.
        loss: finite(step.objective?.after?.loss),
        lossNormalized: finite(step.objective?.after?.lossNormalized),
      }))
      : [],
    currentModel: {
      weight: finite(session?.modelState?.weight),
      bias: finite(session?.modelState?.bias),
      hiddenUnits: finite(session?.modelState?.hiddenSize),
    },
    preprocessing: preprocessingFromTraces(traces),
  });
}
