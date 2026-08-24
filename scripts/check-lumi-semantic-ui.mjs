import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import {
  CONCEPT_STATES,
  LUMI_MODES,
  LUMI_PRESENCE,
  canTransitionConceptState,
  deriveConceptState,
  deriveLumiMode,
  transitionConceptState,
} from '../src/core/ui/lumiSemantics.js';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const css = read('src/index.css');
const mainSource = read('src/main.jsx');
const lumiSource = read('src/components/playground/Lumi.jsx');
const conceptSource = read('src/components/playground/ConceptCard.jsx');
const guidanceSource = read('src/components/playground/GuidedExplore.jsx');
const evidenceSource = read('src/components/playground/ExplorationEvidence.jsx');
const experimentSource = read('src/components/playground/ExperimentBar.jsx');
const localeSource = read('src/locales/ui.js');
const lumiAssets = ['idle', 'observe', 'guide', 'illuminate'].map((state) => `src/assets/lumi/lumi-${state}.svg`);

assert.deepEqual(Object.values(CONCEPT_STATES), ['unexplored', 'active', 'illuminated']);
assert.deepEqual(Object.values(LUMI_PRESENCE), ['hidden', 'ambient', 'contextual', 'event']);
assert.deepEqual(Object.values(LUMI_MODES), ['idle', 'observe', 'guide', 'intervene', 'illuminate']);
assert.equal(deriveConceptState({ conceptId: 'distribution-shift' }), CONCEPT_STATES.UNEXPLORED);
assert.equal(deriveConceptState({ conceptId: 'distribution-shift', conceptSignals: { concepts: [{ id: 'distribution-shift' }] } }), CONCEPT_STATES.ACTIVE);
assert.equal(deriveConceptState({ conceptId: 'distribution-shift', conceptSignals: { concepts: [{ id: 'distribution-shift' }] }, illuminatedConceptIds: ['distribution-shift'] }), CONCEPT_STATES.ILLUMINATED);
assert.equal(canTransitionConceptState(CONCEPT_STATES.ACTIVE, CONCEPT_STATES.ILLUMINATED), true);
assert.equal(canTransitionConceptState(CONCEPT_STATES.ILLUMINATED, CONCEPT_STATES.ACTIVE), false);
assert.equal(transitionConceptState(CONCEPT_STATES.ILLUMINATED, CONCEPT_STATES.ACTIVE), CONCEPT_STATES.ILLUMINATED);
assert.equal(deriveLumiMode({ hasObservation: true }), LUMI_MODES.OBSERVE);
assert.equal(deriveLumiMode({ hasObservation: true, hasGuidance: true }), LUMI_MODES.GUIDE);
assert.equal(deriveLumiMode({ interventionActive: true }), LUMI_MODES.INTERVENE);
assert.equal(deriveLumiMode({ conceptState: CONCEPT_STATES.ILLUMINATED }), LUMI_MODES.ILLUMINATE);

for (const token of ['--volk-structure', '--volk-observation', '--volk-intervention', '--volk-concept-unexplored', '--volk-concept-illuminated', '--lumi-body', '--lumi-glow', '--lumi-pulse']) {
  assert.ok(css.includes(token), `semantic token exists: ${token}`);
}
assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'LUMI respects reduced motion');
for (const asset of lumiAssets) assert.ok(existsSync(new URL(`../${asset}`, import.meta.url)), `LUMI asset exists: ${asset}`);
assert.ok(mainSource.includes("import './index.css';"), 'active application entry loads semantic UI CSS');
assert.ok(lumiSource.includes('data-lumi-presence'), 'LUMI exposes semantic presence');
assert.ok(lumiSource.includes('data-lumi-mode'), 'LUMI exposes semantic mode');
assert.ok(lumiSource.includes('MODE_ASSETS'), 'LUMI maps semantic modes to dedicated visual assets');
assert.ok(conceptSource.includes('data-concept-state'), 'ConceptCard exposes semantic state');
assert.ok(conceptSource.includes('onIlluminate'), 'ConceptCard requires an explicit illumination action');
assert.ok(guidanceSource.includes('What I noticed') || guidanceSource.includes('whatNoticed'), 'guidance separates factual observations');
assert.ok(guidanceSource.includes('candidateConcept.summaryKey'), 'guidance derives conceptual meaning from an inquiry candidate');
assert.ok(evidenceSource.includes('data-evidence-kind="observation"'), 'Evidence marks factual observations');
assert.ok(experimentSource.includes('bg-orange-500'), 'Experiment Bar uses orange for intervention actions');
assert.ok(experimentSource.includes('interventionPulseKey'), 'Experiment Bar receives a bounded intervention pulse');
for (const key of ['playground.concept.state.unexplored', 'playground.concept.state.active', 'playground.concept.state.illuminated', 'playground.lumi.whatNoticed', 'playground.lumi.whyMatters', 'playground.lumi.interventionPulse']) {
  assert.ok(localeSource.includes(`'${key}'`), `localized key exists: ${key}`);
}

console.log('LUMI semantic UI checks passed: tokens, controlled presence/modes, grounded concept states, explicit illumination, evidence distinction, reduced motion, and localized guidance.');
