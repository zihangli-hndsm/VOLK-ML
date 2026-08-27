import { comparisonFactorCount } from '../exploration/comparison.js';

const SAMPLE_EVENT = 'observation.sampled';

function activeExperimentId(snapshot) {
  return snapshot?.experimentWorkspace?.activeExperimentId
    ?? snapshot?.experiment?.id
    ?? null;
}

function currentSamplingLineage(snapshot) {
  const comparison = snapshot?.experimentWorkspace?.comparison;
  const activeId = activeExperimentId(snapshot);
  const baselineId = comparison?.againstExperimentId ?? comparison?.lineage?.againstExperimentId ?? null;
  const diff = comparison?.lineage?.diff ?? comparison?.diff ?? null;
  if (!activeId || !baselineId || activeId === baselineId || !diff) return null;
  if (diff.factors?.world?.changed !== false) return null;
  if (diff.factors?.observationProcess?.changed !== true) return null;
  if (['trainTest', 'model', 'learning', 'evaluation', 'randomness'].some((factor) => diff.factors?.[factor]?.changed)) return null;
  if (comparison?.lineage?.againstExperimentId !== baselineId && comparison?.enabled && comparison?.againstExperimentId !== baselineId) return null;
  return { activeId, baselineId, diff };
}

export function deriveSampleComparisonPresentation(snapshot) {
  const lineage = currentSamplingLineage(snapshot);
  const events = snapshot?.semanticEvents?.events ?? [];
  const latestSample = [...events].reverse().find((event) => event?.type === SAMPLE_EVENT);
  const activeId = activeExperimentId(snapshot);
  const eventBelongsToActiveLineage = Boolean(
    latestSample
    && activeId
    && Array.isArray(latestSample.experimentIds)
    && latestSample.experimentIds.includes(activeId),
  );
  const available = Boolean(lineage && eventBelongsToActiveLineage && comparisonFactorCount(lineage.diff) === 1);
  return Object.freeze({
    available,
    activeExperimentId: available ? lineage.activeId : activeId,
    baselineExperimentId: available ? lineage.baselineId : null,
    reason: available ? 'same-world-new-sample' : 'no-current-sampling-lineage',
    latestSampleEventId: latestSample?.id ?? null,
  });
}

export function isSameWorldNewSamplePresentation(snapshot) {
  return deriveSampleComparisonPresentation(snapshot).available;
}
