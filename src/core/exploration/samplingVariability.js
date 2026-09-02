// Deterministic evidence detector for Episode 1. It reads structured World,
// Dataset and fit snapshots only; presentation state is deliberately ignored.
export const SAMPLING_VARIABILITY_DETECTOR_ID = 'sampling-variability-linear-fit-v1';
export const SAMPLING_VARIABILITY_THRESHOLD = 0.10;

const finite = (value) => Number.isFinite(Number(value));
const clone = (value) => structuredClone(value);

function fitFor(state) {
  const value = state?.state ?? state;
  const result = value?.experiment?.result;
  const model = result?.model;
  if (!finite(model?.weight) || !finite(model?.bias)) return null;
  const completed = (value?.traces ?? []).some((trace) => trace?.type === 'training.completed')
    || (value?.experiment?.result && Number(value?.timeline?.step ?? 0) > 0)
    || value?.status === 'completed';
  return completed ? { weight: Number(model.weight), bias: Number(model.bias), id: value.experiment.id } : null;
}

function trainPoints(state) {
  const value = state?.state ?? state;
  return (value?.experiment?.world?.observations ?? [])
    .filter((point) => point?.membership === 'train' && finite(point.x) && finite(point.y))
    .map((point) => ({ x: Number(point.x), y: Number(point.y) }));
}

function worldConfig(world) {
  const generator = world?.generator ?? {};
  return JSON.stringify({
    id: world?.identity?.fingerprint ?? world?.identity ?? world?.id ?? null,
    relation: generator?.spec?.relation ?? generator?.recipe?.relation ?? world?.relation ?? null,
    noise: generator?.spec?.noise ?? generator?.recipe?.noise ?? world?.noise ?? null,
    sampleSize: generator?.spec?.train?.samples ?? generator?.recipe?.sampling?.train?.count ?? null,
    featureNames: world?.featureNames ?? [],
  });
}

function sampleIdentity(state) {
  const world = (state?.state ?? state)?.experiment?.world;
  const explicit = world?.generator?.realization?.seed ?? world?.observationIdentity ?? world?.realizationId ?? world?.randomness?.seed;
  if (explicit !== undefined && explicit !== null) return explicit;
  return JSON.stringify((world?.observations ?? []).map((point) => point?.id ?? [point?.x, point?.y, point?.membership])) || world?.id || null;
}

function lineMovement(a, b) {
  const points = [...trainPoints(a), ...trainPoints(b)];
  if (points.length < 2) return { ratio: 0, maxDistance: 0, targetSpan: 0, xRange: null };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const xMin = Math.min(...xs); const xMax = Math.max(...xs);
  const targetSpan = Math.max(...ys) - Math.min(...ys);
  if (!(targetSpan > 0) || !(xMax >= xMin)) return { ratio: 0, maxDistance: 0, targetSpan, xRange: [xMin, xMax] };
  const fitA = fitFor(a); const fitB = fitFor(b);
  const d0 = Math.abs((fitA.weight * xMin + fitA.bias) - (fitB.weight * xMin + fitB.bias));
  const d1 = Math.abs((fitA.weight * xMax + fitA.bias) - (fitB.weight * xMax + fitB.bias));
  const maxDistance = Math.max(d0, d1);
  return { ratio: maxDistance / targetSpan, maxDistance, targetSpan, xRange: [xMin, xMax] };
}

export function detectSamplingVariability({ snapshot, comparison = snapshot?.experimentWorkspace?.comparison } = {}) {
  const workspace = snapshot?.experimentWorkspace;
  const activeId = workspace?.activeExperimentId ?? snapshot?.experiment?.id;
  const againstId = comparison?.againstExperimentId;
  const records = workspace?.entries ?? workspace?.records ?? {};
  const activeEntry = records?.[activeId];
  const againstEntry = records?.[againstId];
  const a = againstEntry?.state; const b = activeEntry?.state;
  const structure = {
    detectorId: SAMPLING_VARIABILITY_DETECTOR_ID,
    worldHeldConstant: Boolean(a && b && worldConfig((a.state ?? a).experiment?.world) === worldConfig((b.state ?? b).experiment?.world)),
    sampleIdentityChanged: Boolean(a && b && sampleIdentity(a) !== sampleIdentity(b)),
    datasetIdentityChanged: Boolean(a && b && (a.state ?? a).experiment?.dataset?.id !== (b.state ?? b).experiment?.dataset?.id),
    bothFitsCurrent: Boolean(fitFor(a) && fitFor(b)),
    exactComparison: Boolean(comparison?.enabled && comparison?.diff?.clarity === 'high' && (comparison.diff.semanticFactorCount ?? comparison.diff.semanticFactorPaths?.length) === 1),
    experimentIds: [againstId, activeId].filter(Boolean),
  };
  const structurallyValid = structure.worldHeldConstant && structure.sampleIdentityChanged && structure.bothFitsCurrent && structure.exactComparison;
  if (!structurallyValid) return { status: 'insufficient', structure, movement: null, evidence: null };
  const movement = lineMovement(a, b);
  const parameterDelta = { weight: Math.abs(fitFor(a).weight - fitFor(b).weight), bias: Math.abs(fitFor(a).bias - fitFor(b).bias) };
  const outcome = movement.ratio >= SAMPLING_VARIABILITY_THRESHOLD && movement.targetSpan > 0 ? 'evidenced' : 'valid-weak';
  return {
    status: outcome,
    structure,
    movement,
    evidence: {
      changed: ['sampling realization', 'sample identity', 'training Data'],
      held: ['World identity', 'World factors', 'sampling rule and size', 'model family/configuration', 'learning', 'evaluation'],
      observed: { fitParametersChanged: parameterDelta.weight > 0 || parameterDelta.bias > 0, lineMovement: outcome === 'evidenced' ? 'visible' : 'weak', parameterDelta },
    },
  };
}

export function samplingVariabilityNotice(result) {
  if (!result || result.status === 'insufficient') return null;
  return {
    id: result.status === 'evidenced' ? 'SAMPLING_VARIABILITY_EVIDENCED' : 'SAMPLING_VARIABILITY_WEAK',
    severity: result.status === 'evidenced' ? 'info' : 'hint',
    messageKey: result.status === 'evidenced' ? 'playground.observation.samplingVariability' : 'playground.observation.samplingVariabilityWeak',
    relatedExperimentIds: result.structure.experimentIds,
    relatedObservableIds: ['model.slope', 'model.bias'],
    evidence: clone(result),
  };
}
