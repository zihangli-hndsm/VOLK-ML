import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createSemanticEventStore,
  deriveSemanticEventDrafts,
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
const makeWorld = (offset = 0) => ({
  mode: 'fixed',
  task: 'classification',
  domain: 'tabular',
  coordinateSpace: 'plot2d',
  featureNames: ['x'],
  metadata: {},
  randomness: { seed: 7104 },
  observations: [
    { id: 'train-a', x: 0 + offset, y: 0, target: 0, label: 0, membership: 'train', features: [0 + offset] },
    { id: 'train-b', x: 1 + offset, y: 1, target: 1, label: 1, membership: 'train', features: [1 + offset] },
    { id: 'test-a', x: 3 + offset, y: 1, target: 1, label: 1, membership: 'test', features: [3 + offset] },
  ],
});
const makeObservationSnapshot = ({ offset = 0, active = true } = {}) => ({
  world: makeWorld(offset),
  model: { adapterId: 'knn' },
  experiment: {
    id: 'experiment-a',
    model: { adapterId: 'knn' },
    learning: { k: 5 },
    evaluation: { split: 'train-test' },
  },
  experimentWorkspace: { activeExperimentId: 'experiment-a' },
  observations: active ? [{
    id: 'COVERAGE_MISMATCH',
    relatedExperimentIds: ['experiment-a'],
    relatedObservableIds: ['coverageMismatch'],
    messageKey: 'playground.observation.coverageMismatch',
    severity: 'warning',
    evidence: { testOutsideTrainFraction: 0.2 + offset, bounded: true },
  }] : [],
});
const productionDrafts = (snapshot) => deriveSemanticEventDrafts({
  after: snapshot,
  action: { type: 'RUN', actor: 'system' },
});

const conditionA = makeObservationSnapshot({ offset: 0 });
const firstDrafts = productionDrafts(conditionA);
const first = store.append(firstDrafts);
assert.equal(firstDrafts.length, 1, 'production observation derivation creates a detector draft');
const sameConditionDrafts = productionDrafts(makeObservationSnapshot({ offset: 0 }));
assert.equal(sameConditionDrafts[0].observationDedupeKey, firstDrafts[0].observationDedupeKey, 'same condition keeps the same occurrence identity');
assert.equal(store.append(sameConditionDrafts).length, 0, 'same detector under the same condition is deduplicated');
const conditionB = makeObservationSnapshot({ offset: 0.5 });
const secondDrafts = productionDrafts(conditionB);
assert.notEqual(secondDrafts[0].observationDedupeKey, firstDrafts[0].observationDedupeKey, 'condition changes produce a new occurrence identity');
const secondEvent = store.append(secondDrafts);
assert.equal(secondEvent.length, 1, 'same detector under a new condition creates a new event');
const second = store.snapshot();
const instances = deriveEvidenceInstances({ semanticEvents: second });
assert.equal(instances.length, 2);
assert.equal(instances[0].reasonCode, instances[1].reasonCode, 'detector reasonCode is allowed to repeat');
assert.notEqual(instances[0].id, instances[1].id, 'evidence identity is an instance, not a reasonCode');
assert.equal(instances[0].reasonCode, 'COVERAGE_MISMATCH');
assert.equal(instances[1].reasonCode, 'COVERAGE_MISMATCH');
assert.notEqual(instances[0].conditionFingerprint, instances[1].conditionFingerprint, 'condition identity is part of historical Evidence provenance');
assert.deepEqual(instances[0].experimentIds, ['experiment-a']);
assert.equal(instances[0].semanticSequence, 1);
assert.equal(instances[0].observedAt, '2026-08-25T00:00:00.000Z');
assert.equal(instances[0].evidence.testOutsideTrainFraction, 0.2);
assert.equal(instances[0].available, true);
assert.equal(first.length, 1, 'provenance is created beside the canonical semantic event');
assert.equal(store.snapshot().events[0].evidenceRefs[0], 'coverageMismatch');
assert.ok(!JSON.stringify(store.snapshot().events[0]).includes('testOutsideTrainFraction'));

store.append(productionDrafts(makeObservationSnapshot({ offset: 1, active: false })));
const conditionCEvent = store.append(productionDrafts(makeObservationSnapshot({ offset: 1.25, active: true })));
assert.equal(conditionCEvent.length, 1, 'a detector that disappears can reappear as a new historical observation');
assert.equal(store.snapshot().evidenceInstances.length, 3);

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
assert.equal(getEvidenceInstance(instances, instances[0].id).conditionFingerprint, firstDrafts[0].conditionFingerprint);
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
