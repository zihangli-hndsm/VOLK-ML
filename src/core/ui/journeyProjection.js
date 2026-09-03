export const JOURNEY_PROJECTION_VERSION = 1;
export const MAX_VISIBLE_MILESTONES = 5;

const TYPES = new Set([
  'world.changed', 'world.intervened', 'experiment.factor-changed', 'observation.sampled',
  'experiment.duplicated', 'model.fit-completed', 'comparison.completed',
  'prediction.recorded', 'observation.detected',
]);

const kindFor = (event) => {
  if (event.type === 'observation.sampled') return 'resample';
  if (event.type === 'experiment.duplicated') return 'duplicate';
  if (event.type === 'model.fit-completed') return 'fit';
  if (event.type === 'comparison.completed') return 'compare';
  if (event.type === 'prediction.recorded') return 'prediction';
  if (event.type === 'observation.detected') return 'evidence';
  return 'world-change';
};

export function projectLearnerMilestones(input, { limit = MAX_VISIBLE_MILESTONES } = {}) {
  const events = (Array.isArray(input) ? input : input?.events ?? [])
    .filter((event) => TYPES.has(event?.type) && event?.actor === 'human');
  const milestones = [];
  let pendingDuplicateIds = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const kind = kindFor(event);
    if (kind === 'duplicate') {
      const next = events[index + 1];
      if (next && kindFor(next) === 'resample') {
        pendingDuplicateIds.push(event.id);
        continue;
      }
    }
    const sourceEventIds = [
      ...pendingDuplicateIds,
      ...(event.id ? [event.id] : []),
    ];
    pendingDuplicateIds = [];
    const previous = milestones.at(-1);
    const canGroup = previous?.kind === kind && (kind === 'resample' || kind === 'world-change');
    if (canGroup) {
      previous.count += 1;
      previous.sourceEventIds.push(...sourceEventIds);
      previous.lastSequence = event.sequence ?? previous.lastSequence;
      continue;
    }
    milestones.push({
      id: `milestone-${event.id ?? milestones.length}`,
      kind,
      count: 1,
      sourceEventIds,
      firstSequence: event.sequence ?? 0,
      lastSequence: event.sequence ?? 0,
      reasonCode: event.reasonCode ?? null,
    });
  }
  if (pendingDuplicateIds.length > 0) {
    milestones.push({
      id: `milestone-${pendingDuplicateIds[0] ?? milestones.length}`,
      kind: 'duplicate',
      count: 1,
      sourceEventIds: pendingDuplicateIds,
      firstSequence: 0,
      lastSequence: 0,
      reasonCode: null,
    });
  }
  const safe = milestones.map((milestone) => Object.freeze({
    ...milestone,
    sourceEventIds: Object.freeze([...milestone.sourceEventIds]),
  }));
  return Object.freeze({
    version: JOURNEY_PROJECTION_VERSION,
    total: safe.length,
    milestones: Object.freeze(safe),
    visible: Object.freeze(safe.slice(-Math.max(1, Math.min(12, limit)))),
  });
}
