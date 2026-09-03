import assert from 'node:assert/strict';
import { messages } from '../src/locales/ui.js';
import { DIRECTOR_BEATS, DIRECTOR_HANDOFF, createDirectorState, directorReducer, validateDirectorScript } from '../src/core/director/directorPrototype.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';

const keys = new Set(Object.keys(messages));
assert.equal(validateDirectorScript(DIRECTOR_BEATS, { localizedKeys: keys }).valid, true);
assert.equal(DIRECTOR_BEATS.length, 8);
assert.equal(DIRECTOR_HANDOFF.target, 'episode-1-sampling-variability');
for (let beatIndex = 0; beatIndex < DIRECTOR_BEATS.length; beatIndex += 1) {
  assert.equal(directorReducer(createDirectorState(), { type: 'SEEK_BEAT', beatIndex }).beatIndex, beatIndex);
}

let state = createDirectorState();
state = directorReducer(state, { type: 'PLAY' });
state = directorReducer(state, { type: 'TICK', deltaMs: DIRECTOR_BEATS[0].durationMs });
assert.equal(state.beatIndex, 1);
assert.equal(state.timeMs, 0);
state = directorReducer(state, { type: 'NEXT_BEAT' });
state = directorReducer(state, { type: 'PREVIOUS_BEAT' });
assert.equal(state.beatIndex, 1);
state = directorReducer(state, { type: 'RESET' });
assert.deepEqual(state, createDirectorState());

const host = createPlaygroundHost({ getDataset: () => null, exploreRecipeId: 'director-check' });
await host.openPhaseAHandoff({ id: DIRECTOR_HANDOFF.target, seed: DIRECTOR_HANDOFF.seed });
const before = host.getState();
assert.equal(before.bigIdea.phaseA, 'onboarding');
assert.equal(before.semanticEvents.events.length, 0);
assert.equal(before.inquiryRuntime, null);
await host.dispatch({ type: 'RUN' });
const afterAction = host.getState();
assert.ok(afterAction.semanticEvents.events.some((event) => event.type === 'model.fit-completed'));
await host.promotePhaseAInquiry({ id: DIRECTOR_HANDOFF.target, seed: DIRECTOR_HANDOFF.seed });
const episode = host.getState();
assert.equal(episode.bigIdea.phaseA, undefined);
assert.equal(episode.bigIdea.episodeId, 'episode-0-world-data-model');
assert.ok(episode.semanticEvents.events.length > 0, 'Episode 0 promotion preserves onboarding semantic journey');
assert.ok(episode.inquiryRuntime.baseline?.fit, 'Episode 0 promotion preserves Fit A');
await host.restartPhaseAHandoff({ id: DIRECTOR_HANDOFF.target, seed: DIRECTOR_HANDOFF.seed });
assert.equal(host.getState().bigIdea.phaseA, 'onboarding');
host.close();

const secondRoute = createPlaygroundHost({ getDataset: () => null, exploreRecipeId: 'director-check-2' });
await secondRoute.openPhaseAHandoff({ id: DIRECTOR_HANDOFF.target, seed: DIRECTOR_HANDOFF.seed });
await secondRoute.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
await secondRoute.dispatch({ type: 'RESAMPLE_WORLD' });
const routeEvents = secondRoute.getState().semanticEvents.events;
assert.ok(routeEvents.some((event) => event.type === 'experiment.duplicated'));
assert.ok(routeEvents.some((event) => event.type === 'observation.sampled'));
await secondRoute.promotePhaseAInquiry({ id: DIRECTOR_HANDOFF.target, seed: DIRECTOR_HANDOFF.seed });
const cleanSecondEpisode = secondRoute.getState();
assert.ok(cleanSecondEpisode.semanticEvents.events.length >= 2, 'Episode 0 promotion preserves resample journey');
assert.equal(cleanSecondEpisode.bigIdea.episodeId, 'episode-0-world-data-model');
assert.equal(cleanSecondEpisode.inquiryRuntime.contractId, 'episode-1-sampling-variability');
secondRoute.close();

const directEpisode = createPlaygroundHost({ getDataset: () => null, exploreRecipeId: 'director-direct-entry' });
await directEpisode.openBigIdeaEntrance({ id: DIRECTOR_HANDOFF.target, seed: DIRECTOR_HANDOFF.seed });
const directSnapshot = directEpisode.getState();
assert.equal(directSnapshot.bigIdea.phaseA, undefined);
assert.equal(directSnapshot.inquiryRuntime.evidence.status, 'insufficient');
assert.equal(directSnapshot.semanticEvents.events.length, 0);
directEpisode.close();
console.log('director prototype checks passed');
