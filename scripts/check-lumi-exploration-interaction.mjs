import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createLumiTarget,
  deriveLumiInteraction,
  deriveLumiShowcaseStage,
  lumiTargetEquals,
  LUMI_SHOWCASE_STAGES,
  LUMI_TARGET_TYPES,
} from '../src/core/ui/lumiInteraction.js';
import { LUMI_MODES } from '../src/core/ui/lumiSemantics.js';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const railSource = read('src/components/playground/LumiAttentionRail.jsx');
const detailsSource = read('src/components/playground/ExploreDetailsRegion.jsx');
const evidenceSource = read('src/components/playground/ExplorationEvidence.jsx');
const conceptSource = read('src/components/playground/ConceptCard.jsx');
const inquirySource = read('src/components/playground/InquiryConceptCard.jsx');
const controlSource = read('src/components/playground/PlaygroundControlField.jsx');
const quickControlSource = read('src/components/playground/PlayQuickControl.jsx');
const runtimeSource = read('src/components/playground/UnifiedPlaygroundDialog.jsx');
const css = read('src/index.css');

const evidence = createLumiTarget(LUMI_TARGET_TYPES.EVIDENCE, 'evidence-instance-1');
const concept = createLumiTarget(LUMI_TARGET_TYPES.CONCEPT, 'distribution-shift');
const experiment = createLumiTarget(LUMI_TARGET_TYPES.EXPERIMENT, 'experiment-1');

assert.deepEqual(evidence, { type: 'evidence', id: 'evidence-instance-1' });
assert.equal(createLumiTarget('unsupported', 'x'), null);
assert.equal(createLumiTarget('evidence', '   '), null);
assert.equal(createLumiTarget('evidence', 1), null);
assert.equal(createLumiTarget('evidence', ` ${'x'.repeat(200)} `).id.length, 160);
assert.equal(lumiTargetEquals(evidence, { type: 'evidence', id: 'evidence-instance-1' }), true);
assert.equal(lumiTargetEquals(evidence, concept), false);

const snapshot = {
  observations: [{ id: 'observation-1', reasonCode: 'coverage-mismatch' }],
  semanticEvents: { evidenceInstances: [{ id: 'evidence-instance-1', reasonCode: 'coverage-mismatch', experimentIds: ['experiment-1'], conditionFingerprint: 'condition-1', semanticSequence: 1, evidence: { value: 1 }, available: true }] },
  learnerInquiry: { candidates: [{ conceptId: 'distribution-shift', supportingObservationIds: ['coverage-mismatch'] }] },
  experimentWorkspace: { activeExperimentId: 'experiment-1' },
};
const observed = deriveLumiInteraction({ snapshot });
assert.equal(observed.mode, 'explore');
assert.deepEqual(observed.evidenceTarget, evidence);
assert.deepEqual(observed.conceptTarget, concept);
assert.deepEqual(observed.experimentTarget, experiment);
assert.deepEqual(observed.connection.from, evidence);
assert.deepEqual(observed.connection.to, concept);
assert.deepEqual(observed.primaryTarget, evidence);
const phenomenon = deriveLumiInteraction({ snapshot: { observations: [{ id: 'observation-1' }] }, activeConceptId: 'distribution-shift' });
assert.deepEqual(phenomenon.conceptTarget, concept);
assert.equal(phenomenon.mode, 'explore');
const emptyEpisode = deriveLumiInteraction({ snapshot: { learnerInquiry: { candidates: [] }, observations: [] }, activeConceptId: 'episode-1-sampling-variability' });
assert.equal(emptyEpisode.conceptTarget, null, 'Episode 1 hides a generic concept frontier until a candidate exists');

const intervention = deriveLumiInteraction({ snapshot, intervention: { target: experiment, controlKey: 'testShift' } });
assert.equal(intervention.mode, 'intervene');
assert.deepEqual(intervention.interventionTarget, experiment);
assert.equal(intervention.interventionControlKey, 'testShift');
assert.deepEqual(intervention.primaryTarget, experiment);

assert.equal(deriveLumiShowcaseStage({ attention: observed }), LUMI_SHOWCASE_STAGES.OBSERVE);
assert.equal(deriveLumiShowcaseStage({ attention: intervention }), LUMI_SHOWCASE_STAGES.INTERVENE);
assert.equal(deriveLumiShowcaseStage({ attention: observed, illuminatedConceptIds: ['distribution-shift'] }), LUMI_SHOWCASE_STAGES.UNDERSTAND);
assert.equal(deriveLumiShowcaseStage({ attention: { mode: 'explore' } }), LUMI_SHOWCASE_STAGES.FRONTIER);
assert.equal(LUMI_MODES.EXPLORE, 'explore');

for (const source of [railSource, evidenceSource, conceptSource, inquirySource, quickControlSource]) {
  assert.ok(source.includes('data-lumi-target'), 'learning surfaces expose bounded LUMI targets');
}
assert.ok(detailsSource.includes('LumiAttentionRail'), 'details region mounts the attention rail');
assert.ok(railSource.includes('data-lumi-interaction-rail'), 'attention rail is discoverable');
assert.ok(railSource.includes('data-lumi-showcase="distribution-shift"'), 'showcase flow is bounded to the curated story');
assert.ok(controlSource.includes('data-lumi-control'), 'controls expose semantic focus anchors');
assert.ok(runtimeSource.includes('createLumiTarget'), 'runtime creates only transient target metadata');
assert.ok(runtimeSource.includes('setLumiIntervention'), 'control changes drive a transient presentation pulse');
assert.ok(!read('src/core/ui/lumiInteraction.js').includes('dispatch('), 'LUMI projection does not dispatch runtime actions');
assert.ok(!read('src/core/ui/lumiInteraction.js').includes('host.'), 'LUMI projection does not call Agent or host authority');
for (const token of ['lumi-explore', 'lumi-target-connection', 'lumi-control-focus', 'prefers-reduced-motion']) {
  assert.ok(css.includes(token), `LUMI interaction styling exists: ${token}`);
}

console.log('LUMI exploration interaction checks passed: targets, attention, concept connection, intervention pulse, showcase stages, and authority boundaries.');
