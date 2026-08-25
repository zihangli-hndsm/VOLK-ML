import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createSemanticEventStore,
} from '../src/core/exploration/semanticEvents.js';
import {
  deriveEvidenceInstances,
  getEvidenceInstance,
  isEvidenceInstanceId,
  MAX_EVIDENCE_INSTANCES,
} from '../src/core/exploration/evidenceProvenance.js';
import {
  appendHypothesis,
  bindHypothesisEvidence,
  createHypothesis,
  getHypothesis,
  HYPOTHESIS_STATUSES,
  MAX_HYPOTHESIS_EVIDENCE,
} from '../src/core/exploration/hypothesis.js';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

let tick = 0;
const store = createSemanticEventStore({
  now: () => `2026-08-25T00:00:0${tick++}.000Z`,
});
const appendObservation = ({ key, experimentId, conditionFingerprint, value }) => store.append([{
  type: 'observation.detected',
  actor: 'system',
  experimentIds: [experimentId],
  semanticFactors: [],
  operationTypes: [],
  reasonCode: 'COVERAGE_MISMATCH',
  evidenceRefs: ['coverageMismatch'],
  observationDedupeKey: key,
  conditionFingerprint,
  messageKey: 'playground.observation.coverageMismatch',
  severity: 'warning',
  evidence: { testOutsideTrainFraction: value, bounded: true },
}]);

appendObservation({ key: 'condition-a', experimentId: 'experiment-a', conditionFingerprint: 'condition-a', value: 0.2 });
const first = store.snapshot();
appendObservation({ key: 'condition-b', experimentId: 'experiment-b', conditionFingerprint: 'condition-b', value: 0.8 });
const second = store.snapshot();
const instances = deriveEvidenceInstances({ semanticEvents: second });
assert.equal(instances.length, 2);
assert.equal(instances[0].reasonCode, instances[1].reasonCode, 'detector reasonCode is allowed to repeat');
assert.notEqual(instances[0].id, instances[1].id, 'evidence identity is an instance, not a reasonCode');
assert.deepEqual(instances[0].experimentIds, ['experiment-a']);
assert.equal(instances[0].conditionFingerprint, 'condition-a');
assert.equal(instances[0].semanticSequence, 1);
assert.equal(instances[0].observedAt, '2026-08-25T00:00:00.000Z');
assert.equal(instances[0].evidence.testOutsideTrainFraction, 0.2);
assert.equal(instances[0].available, true);
assert.equal(first.evidenceInstances.length, 1, 'provenance is exposed beside, not inside, the semantic event');
assert.equal(first.events[0].evidenceRefs[0], 'coverageMismatch');
assert.ok(!JSON.stringify(first.events[0]).includes('testOutsideTrainFraction'));

const hypothesis = createHypothesis({ id: 'hypothesis-1', statement: 'The test distribution differs from train data.' });
let state = appendHypothesis(undefined, hypothesis);
state = bindHypothesisEvidence(state, {
  hypothesisId: hypothesis.id,
  evidenceIds: [instances[0].id, 'COVERAGE_MISMATCH'],
  validEvidenceIds: instances.map((instance) => instance.id),
});
assert.deepEqual(getHypothesis(state, hypothesis.id).evidenceIds, [instances[0].id], 'only explicitly selected stable IDs bind');
assert.equal(getHypothesis(state, hypothesis.id).status, HYPOTHESIS_STATUSES.PROPOSED, 'binding never upgrades learner-authored status');

const afterNewEvidence = bindHypothesisEvidence(state, {
  hypothesisId: hypothesis.id,
  evidenceIds: [],
  validEvidenceIds: instances.map((instance) => instance.id),
});
assert.deepEqual(getHypothesis(afterNewEvidence, hypothesis.id).evidenceIds, [instances[0].id], 'new current observations cannot rewrite historical references');
assert.equal(getEvidenceInstance(instances, instances[0].id).conditionFingerprint, 'condition-a');
assert.equal(getEvidenceInstance(instances, 'evidence-instance-missing'), null, 'missing history is not replaced by a current observation');
assert.equal(isEvidenceInstanceId('COVERAGE_MISMATCH'), false);
assert.equal(getHypothesis({ hypotheses: [{ ...hypothesis, evidenceIds: ['COVERAGE_MISMATCH'] }] }, hypothesis.id).evidenceIds.length, 0);

const bounded = Array.from({ length: MAX_EVIDENCE_INSTANCES + 10 }, (_, index) => ({
  ...instances[0],
  id: `evidence-instance-${index + 1}`,
  semanticSequence: index + 1,
}));
assert.equal(deriveEvidenceInstances({ semanticEvents: { evidenceInstances: bounded } }).length, MAX_EVIDENCE_INSTANCES);
assert.equal(MAX_HYPOTHESIS_EVIDENCE >= 1, true);

const provenanceSource = read('src/core/exploration/evidenceProvenance.js');
const hypothesisSource = read('src/core/exploration/hypothesis.js');
const panelSource = read('src/components/playground/HypothesisPanel.jsx');
const mapSource = read('src/components/playground/ConceptMap.jsx');
const lumiSource = read('src/core/ui/lumiInteraction.js');
const cssSource = read('src/index.css');
for (const source of [provenanceSource, hypothesisSource, panelSource, mapSource, lumiSource]) {
  assert.ok(!source.includes('localStorage'), 'provenance remains session-local');
  assert.ok(!source.includes('dispatch('), 'provenance does not gain runtime authority');
  assert.ok(!source.includes('host.'), 'provenance does not call Agent or host authority');
}
assert.ok(panelSource.includes('type="checkbox"'), 'evidence selection is explicit');
assert.ok(panelSource.includes('Attach selected') || panelSource.includes('attachSelected'), 'picker has an explicit attach action');
assert.ok(panelSource.includes('unavailableEvidence'), 'missing historical evidence is visible as unavailable');
assert.ok(mapSource.includes('getEvidenceInstance'), 'Concept Graph resolves historical evidence instances only');
assert.ok(cssSource.includes('hypothesis-evidence-picker'), 'evidence picker has dedicated responsive styling hook');
assert.ok(cssSource.includes('@media (max-width: 640px)'), 'evidence picker is covered by narrow-screen rules');

console.log('Hypothesis evidence provenance checks passed: stable bounded instances, explicit selection, historical references, unavailable-state handling, neutral graph/LUMI boundaries, and session-local safety.');
