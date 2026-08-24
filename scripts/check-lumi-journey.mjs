import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  appendJourneyIllumination,
  clearJourney,
  deriveLumiJourneyProjection,
  LUMI_JOURNEY_EVENT_TYPES,
} from '../src/core/ui/lumiJourney.js';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const journeySource = read('src/core/ui/lumiJourney.js');
const dialogSource = read('src/components/playground/UnifiedPlaygroundDialog.jsx');
const detailsSource = read('src/components/playground/ExploreDetailsRegion.jsx');
const timelineSource = read('src/components/playground/LumiJourneyTimeline.jsx');
const localeSource = read('src/locales/ui.js');
const css = read('src/index.css');

const empty = clearJourney();
assert.deepEqual(empty, { version: 1, illuminationEvents: [] });
const withIllumination = appendJourneyIllumination(empty, { conceptId: 'distribution-shift', timestamp: 300, afterSequence: 4 });
assert.equal(withIllumination.illuminationEvents.length, 1);
assert.equal(appendJourneyIllumination(withIllumination, { conceptId: 'distribution-shift', timestamp: 301 }).illuminationEvents.length, 1);
assert.equal(appendJourneyIllumination(empty, { conceptId: '' }), empty);

const semanticEvents = {
  events: [
    { sequence: 1, actor: 'system', type: 'experiment.factor-changed', experimentIds: ['experiment-1'], reasonCode: 'control.testShift', occurredAt: '2026-08-24T01:00:00.000Z' },
    { sequence: 2, actor: 'human', type: 'experiment.factor-changed', experimentIds: ['experiment-1'], reasonCode: 'control.testShift', occurredAt: '2026-08-24T01:01:00.000Z' },
    { sequence: 3, actor: 'human', type: 'observation.detected', reasonCode: 'COVERAGE_MISMATCH', occurredAt: '2026-08-24T01:02:00.000Z' },
    { sequence: 4, actor: 'agent', type: 'world.intervened', experimentIds: ['experiment-1'], reasonCode: 'agent-change', occurredAt: '2026-08-24T01:03:00.000Z' },
  ],
};
const input = {
  semanticEvents,
  observations: [{ id: 'COVERAGE_MISMATCH', messageKey: 'playground.lumi.observationAvailable' }],
  inquiry: { candidates: [{ conceptId: 'distribution-shift', confidence: 'direct', supportingObservationIds: ['COVERAGE_MISMATCH'] }] },
  activeConceptId: 'distribution-shift',
};
const projection = deriveLumiJourneyProjection(input);
assert.deepEqual(projection.events.map((event) => event.type), [
  LUMI_JOURNEY_EVENT_TYPES.INTERVENE,
  LUMI_JOURNEY_EVENT_TYPES.OBSERVE,
  LUMI_JOURNEY_EVENT_TYPES.CONNECT,
]);
assert.equal(projection.events[0].controlKey, 'testShift');
assert.equal(projection.events[0].experimentId, 'experiment-1');
assert.equal(projection.events[1].evidenceId, 'COVERAGE_MISMATCH');
assert.equal(projection.events[2].conceptId, 'distribution-shift');
assert.deepEqual(projection.currentTarget, { type: 'concept', id: 'distribution-shift' });
assert.deepEqual(projection.frontierConceptIds, []);
assert.deepEqual(deriveLumiJourneyProjection(input), projection, 'projection is deterministic');

const illuminated = deriveLumiJourneyProjection({ ...input, illuminatedConceptIds: ['distribution-shift'], illuminationEvents: withIllumination.illuminationEvents });
assert.equal(illuminated.events.at(-1).type, LUMI_JOURNEY_EVENT_TYPES.ILLUMINATE);
assert.deepEqual(illuminated.currentTarget, { type: 'concept', id: 'distribution-shift' });

const frontier = deriveLumiJourneyProjection({ semanticEvents: [], inquiry: input.inquiry, activeConceptId: 'distribution-shift' });
assert.deepEqual(frontier.frontierConceptIds, ['distribution-shift']);
assert.deepEqual(frontier.currentTarget, { type: 'concept', id: 'distribution-shift' });

assert.ok(dialogSource.includes('appendJourneyIllumination'), 'explicit illumination appends a journey marker');
assert.ok(dialogSource.includes('setJourneySession(clearJourney())'), 'session/reset paths clear the journey');
assert.ok(detailsSource.includes('deriveLumiJourneyProjection'), 'details region consumes the projection');
assert.ok(timelineSource.includes('data-lumi-journey'), 'timeline exposes a stable semantic hook');
assert.ok(!journeySource.includes('dispatch('), 'journey projection cannot dispatch runtime actions');
assert.ok(!journeySource.includes('host.'), 'journey projection cannot call host or Agent authority');
assert.ok(!journeySource.includes('localStorage'), 'journey projection does not persist across sessions');
assert.ok(!timelineSource.includes('onDispatch'), 'timeline cannot execute actions');
for (const key of [
  'playground.lumi.journey.title',
  'playground.lumi.journey.current',
  'playground.lumi.journey.event.observe',
  'playground.lumi.journey.event.intervene',
  'playground.lumi.journey.event.connect',
  'playground.lumi.journey.event.illuminate',
]) assert.ok(localeSource.includes(`'${key}'`), `localized key exists: ${key}`);
for (const token of ['lumi-journey-timeline', 'lumi-journey-node-current', 'lumi-journey-frontier', 'prefers-reduced-motion']) {
  assert.ok(css.includes(token), `journey style exists: ${token}`);
}

console.log('LUMI journey checks passed: event projection, chronology, concept connection, explicit illumination, frontier state, clearing, and authority boundaries.');
