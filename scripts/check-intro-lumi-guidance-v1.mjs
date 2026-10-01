import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import {
  INTRO_PREFERENCE_KEY,
  INTRO_PREFERENCE_VERSION,
  markIntroDismissed,
  normalizeIntroPreference,
  readIntroPreference,
  rememberIntroEntry,
  writeIntroPreference,
} from '../src/core/ui/introExperience.js';
import { deriveEpisode1CourseStep } from '../src/core/ui/episode1CourseStep.js';
import { resolveRailPromptLayout } from '../src/core/ui/railPromptLayout.js';

const memory = new Map();
const storage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
};
assert.deepEqual(readIntroPreference(storage), { version: INTRO_PREFERENCE_VERSION, dismissed: false, lastEntryId: null });
writeIntroPreference(rememberIntroEntry(markIntroDismissed(null), 'episode-1-sampling-variability'), storage);
assert.equal(JSON.parse(memory.get(INTRO_PREFERENCE_KEY)).lastEntryId, 'episode-1-sampling-variability');
assert.equal(readIntroPreference(storage).dismissed, true);
assert.deepEqual(normalizeIntroPreference({ version: 99, dismissed: true, lastEntryId: 'anything' }), { version: 1, dismissed: false, lastEntryId: null });
assert.doesNotThrow(() => readIntroPreference({ getItem() { throw new Error('storage disabled'); } }));
assert.doesNotThrow(() => writeIntroPreference({ version: 1, dismissed: true }, { setItem() { throw new Error('storage disabled'); } }));

const centeredPrompt = resolveRailPromptLayout({ railTop: 100, railLeft: 200, railHeight: 600, avatarTop: 340, avatarRight: 360, avatarHeight: 112, promptHeight: 96, controlsTop: 620 });
assert.equal(centeredPrompt.left, 172, 'prompt starts after the measured avatar image plus a 12px gap');
assert.ok(centeredPrompt.top >= 8, 'prompt stays within the rail safe inset');
assert.ok(centeredPrompt.top + 96 <= 620 - 100 - 8, 'prompt stays above the rail controls');
assert.equal(centeredPrompt.compact, false);
const compactPrompt = resolveRailPromptLayout({ railTop: 100, railLeft: 0, railHeight: 190, avatarTop: 140, avatarRight: 120, avatarHeight: 112, promptHeight: 140, controlsTop: 245 });
assert.equal(compactPrompt.compact, true, 'short rails mark the prompt for compact scrolling');
assert.ok(compactPrompt.top + compactPrompt.maxHeight <= 245 - 100 - 8, 'compact prompt still clears controls');

const host = createPlaygroundHost({ getDataset: () => null });
let snapshot = await host.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
const initialEvents = snapshot.semanticEvents.events.length;
assert.equal(deriveEpisode1CourseStep(snapshot).stage, 'baseline-fit');
assert.equal(deriveEpisode1CourseStep(snapshot, { freeExploration: true }).mode, 'free');
assert.equal(deriveEpisode1CourseStep(snapshot, { freeExploration: true, helpRequested: true }).operation, 'RUN');

await host.recordInquiryPrediction({ expectation: 'different', skipped: false });
snapshot = await host.dispatch({ type: 'RUN' });
assert.equal(deriveEpisode1CourseStep(snapshot).stage, 'resample');
assert.equal(deriveEpisode1CourseStep(snapshot, { freeExploration: true }).operation, null, 'free exploration suppresses unsolicited course steps');
assert.equal(deriveEpisode1CourseStep(snapshot, { freeExploration: true, helpRequested: true }).targetKey, 'world.sample', 'explicit help immediately offers the legal local step');

const eventCountBeforeView = snapshot.semanticEvents.events.length;
const evidenceBeforeView = snapshot.inquiryRuntime.evidence;
await host.dispatch({ type: 'SET_WORKSPACE_VIEW', patch: { visibility: 'both' } });
snapshot = host.getState();
assert.equal(snapshot.semanticEvents.events.length, eventCountBeforeView, 'view-only change does not create an inquiry event');
assert.deepEqual(snapshot.inquiryRuntime.evidence, evidenceBeforeView, 'view-only change cannot create or alter Evidence');

await host.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
snapshot = await host.dispatch({ type: 'RESAMPLE_WORLD' });
assert.equal(deriveEpisode1CourseStep(snapshot).stage, 'fit-b');
assert.equal(deriveEpisode1CourseStep(snapshot, { freeExploration: true }).mode, 'free');
assert.equal(deriveEpisode1CourseStep(snapshot, { freeExploration: true, helpRequested: true }).operation, 'RUN');
snapshot = await host.dispatch({ type: 'RUN' });
assert.equal(deriveEpisode1CourseStep(snapshot).stage, 'compare');
snapshot = await host.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: snapshot.experimentWorkspace.comparison.againstExperimentId });
assert.equal(snapshot.inquiryRuntime.evidence.status, 'evidenced');
assert.equal(deriveEpisode1CourseStep(snapshot).mode, 'concept');
assert.ok(snapshot.inquiryRuntime.candidateConcepts.includes('SAMPLING_VARIABILITY'));
assert.ok(snapshot.inquiryRuntime.continuations.some((item) => item.id === 'collect-more-data'));
assert.ok(snapshot.inquiryRuntime.continuations.some((item) => item.id === 'repeat-many-times'));
assert.ok(snapshot.inquiryRuntime.continuations.some((item) => item.id === 'noisier-world'));
await host.close();

const source = readFileSync(new URL('../src/components/playground/UnifiedPlaygroundDialog.jsx', import.meta.url), 'utf8');
assert.ok(source.includes('if (freeExploration) {'), 'runtime policy boundary suspends automatic prompts during free exploration');
assert.ok(source.includes('<LumiVerticalRail'), 'Episode 1 uses the reserved vertical companion rail');
assert.ok(source.includes('setExplicitLumiPromptRequest((previous) => ({ sequence: previous.sequence + 1, identity }))'), 'explicit learner help creates a new target-bound prompt request identity');
assert.ok(source.includes('setLumiGuidanceDismissedKey(null)'), 'explicit help clears only the presentation dismissal gate');
assert.ok(source.includes('episodeFlow={episodeOneActive}'), 'legacy floating companion is suppressed on the Episode surface');
const panel = readFileSync(new URL('../src/components/playground/InquiryEpisodePanel.jsx', import.meta.url), 'utf8');
assert.ok(panel.includes('onHelpRequestedChange?.(true)'), 'free exploration only resumes course guidance by explicit learner request');
assert.ok(panel.includes('data-free-exploration-help-dismiss'), 'free-exploration help can be deliberately stopped before another request');
assert.ok(panel.includes('onFreeExplorationChange?.(true)'), 'the course can be paused into free exploration');
const rail = readFileSync(new URL('../src/components/playground/LumiVerticalRail.jsx', import.meta.url), 'utf8');
assert.ok(rail.includes('observer?.observe(avatar)'), 'avatar size changes remeasure the registered target alignment');
assert.ok(rail.includes('explicitPromptRequest?.identity === targetIdentity'), 'prompt rearming is scoped to the same registered target identity');
assert.ok(rail.includes('suppressedIdentityRef.current = null'), 'only an explicit matching request clears a prompt suppression');
const browserCheck = readFileSync(new URL('../scripts/r148-cdp-browser.mjs', import.meta.url), 'utf8');
assert.ok(browserCheck.includes('exerciseExplicitHelpRearm'), 'mounted browser regression covers prompt timeout, dismissal, help rearm, and learner-confirmed reveal');
assert.ok(browserCheck.includes('assertRailAlignment'), 'mounted browser regression checks exact target-center alignment and scroll behavior');
assert.ok(browserCheck.includes('assertRailPromptNoOcclusion'), 'mounted browser regression checks the actual avatar image against the visible prompt and controls');
assert.ok(browserCheck.includes('runBubbleViewportMatrix'), 'mounted browser regression covers the six required viewport sizes and a 200%-equivalent layout');

console.log('Intro and LUMI Guidance v1 checks passed');
