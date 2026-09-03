import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectLearnerMilestones } from '../src/core/ui/journeyProjection.js';

const event = (id, type, sequence) => ({ id, type, sequence, actor: 'human' });
const input = [
  event('noise-1', 'world.changed', 1), event('noise-2', 'world.changed', 2),
  event('sample-1', 'observation.sampled', 3), event('sample-2', 'observation.sampled', 4),
  event('sample-3', 'observation.sampled', 5), event('fit-1', 'model.fit-completed', 6),
  event('sample-4', 'observation.sampled', 7), event('compare-1', 'comparison.completed', 8),
];
const projection = projectLearnerMilestones(input);
assert.deepEqual(projection.visible.map(({ kind, count }) => [kind, count]), [
  ['world-change', 2], ['resample', 3], ['fit', 1], ['resample', 1], ['compare', 1],
]);
assert.equal(projection.milestones.find((item) => item.kind === 'resample').sourceEventIds.length, 3);
assert.equal(projectLearnerMilestones(Array.from({ length: 100 }, (_, index) => event(`fit-${index}`, 'model.fit-completed', index + 1))).visible.length, 5);
assert.equal(projectLearnerMilestones(Array.from({ length: 100 }, (_, index) => event(`fit-${index}`, 'model.fit-completed', index + 1)), { limit: 12 }).visible.length, 12);
assert.equal(projectLearnerMilestones(input.filter((item) => item.actor !== 'human')).visible.length, 0);
assert.equal(projectLearnerMilestones([event('world-1', 'world.intervened', 1)]).visible[0].kind, 'world-change');
const repeated = projectLearnerMilestones(Array.from({ length: 5 }, (_, index) => [
  event(`duplicate-${index}`, 'experiment.duplicated', index * 2 + 1),
  event(`sample-${index}`, 'observation.sampled', index * 2 + 2),
]).flat());
assert.deepEqual(repeated.visible.map(({ kind, count }) => [kind, count]), [['resample', 5]]);
assert.equal(repeated.milestones[0].sourceEventIds.length, 10, 'duplicate and sample provenance remain inspectable');

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const detailsSource = source('src/components/playground/ExploreDetailsRegion.jsx');
const stageSource = source('src/components/playground/PlaygroundStage.jsx');
const episodeSource = source('src/components/playground/InquiryEpisodePanel.jsx');
const trailSource = source('src/components/playground/InquiryTrail.jsx');
const timelineSource = source('src/components/playground/LumiJourneyTimeline.jsx');
assert.ok(detailsSource.includes('data-secondary-inquiry-surfaces'), 'secondary inquiry surfaces are disclosure-gated');
assert.ok(detailsSource.includes('data-lumi-ambient'), 'LUMI has an ambient entry');
assert.ok(stageSource.includes('showFittedOnly') && stageSource.includes("primitive.type === 'regression-line'"), 'fit visibility is runtime-gated');
assert.ok(episodeSource.includes('data-episode-fit-overlay') && episodeSource.includes('baselineFit') && episodeSource.includes('activeFit'), 'A/B overlay uses stored fits');
assert.ok(trailSource.includes('entries.slice(-5)'), 'Notebook history is bounded');
assert.ok(timelineSource.includes('meaningfulFrontier'), 'empty concept frontiers stay hidden');
console.log('journey projection checks passed');
