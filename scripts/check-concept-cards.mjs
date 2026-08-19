import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalizeConceptSignals, CONCEPT_IDS, deriveConceptSignals, getConcept, listConcepts } from '../src/core/exploration/concepts.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { getWorldRecipePreset } from '../src/core/exploration/worldRecipePresets.js';
import { createPedagogicalExperimentDesign } from '../src/core/exploration/pedagogicalExperiment.js';

const exact = (changed = ['world'], unchanged = ['model', 'learning']) => ({
  enabled: true,
  diff: { changed, unchanged, clarity: 'high' },
});
const fidelity = { status: 'exact' };
const observation = (goal, facts) => ({ version: 1, goal, available: true, summaryKey: 'playground.pedagogical.observation.classSeparation', facts, changed: ['world'], held: ['model'] });
const fact = (id, before, after, kind = 'intervention') => ({ id, kind, labelKey: `fact.${id}`, before, after, delta: after - before, direction: after > before ? 'increased' : after < before ? 'decreased' : 'unchanged' });
const verification = { valid: true };

assert.equal(listConcepts().length, 6, 'V1 catalog remains deliberately bounded');
assert.equal(getConcept(CONCEPT_IDS.CLASS_SEPARATION).id, CONCEPT_IDS.CLASS_SEPARATION);

const supportSignals = deriveConceptSignals({
  comparison: exact(['world'], ['model', 'learning']),
  fidelity,
  pedagogicalDesign: { goal: 'train-test-support-shift' },
  pedagogicalVerification: verification,
  pedagogicalObservation: observation('train-test-support-shift', [
    fact('test-outside-train-fraction', 0.1, 0.7, 'coverage'),
    { id: 'train-realization-held', kind: 'hold', labelKey: 'held', direction: 'unchanged' },
  ]),
});
assert.deepEqual(supportSignals.concepts.map((item) => item.id).slice(0, 2), [CONCEPT_IDS.TRAIN_TEST_DISTRIBUTION_SHIFT, CONCEPT_IDS.HELD_CONSTANT], 'verified support shift surfaces its specific concept first');

const supportFailure = deriveConceptSignals({
  comparison: exact(), fidelity, pedagogicalDesign: { goal: 'train-test-support-shift' }, pedagogicalVerification: { valid: false },
  pedagogicalObservation: observation('train-test-support-shift', [fact('test-outside-train-fraction', 0.7, 0.1, 'coverage')]),
});
assert.equal(supportFailure.concepts.some((item) => item.id === CONCEPT_IDS.TRAIN_TEST_DISTRIBUTION_SHIFT), false, 'failed support predicate emits no distribution-shift concept');

for (const [goal, target, facts] of [
  ['observation-noise', CONCEPT_IDS.OBSERVATION_NOISE, [fact('train-position-changes', 0, 4), { id: 'test-realization-held', kind: 'hold', labelKey: 'held', direction: 'unchanged' }]],
  ['outlier-sensitivity', CONCEPT_IDS.OUTLIERS, [fact('train-outlier-count', 0, 2), { id: 'test-realization-held', kind: 'hold', labelKey: 'held', direction: 'unchanged' }]],
  ['class-separation', CONCEPT_IDS.CLASS_SEPARATION, [fact('class-separation-distance', 2.2, 1.1)]],
]) {
  const signals = deriveConceptSignals({ comparison: exact(), fidelity, pedagogicalDesign: { goal }, pedagogicalVerification: verification, pedagogicalObservation: observation(goal, facts) });
  assert.equal(signals.concepts[0]?.id, target, `${goal} emits its direct concept`);
  assert.equal(signals.concepts.some((item) => item.id === 'overlap'), false, `${goal} never emits an overlap concept`);
}

const controlled = deriveConceptSignals({ comparison: exact(['learningRate'], ['world', 'evaluation']), fidelity });
assert.deepEqual(controlled.concepts.map((item) => item.id), [CONCEPT_IDS.HELD_CONSTANT, CONCEPT_IDS.CONTROLLED_COMPARISON], 'exact one-factor comparison emits controlled-comparison and held-constant');
const partial = deriveConceptSignals({ comparison: exact(['learningRate'], ['world']), fidelity: { status: 'partial' } });
assert.deepEqual(partial.concepts, [], 'partial fidelity emits no comparison concept');
const noHeld = deriveConceptSignals({ comparison: exact(['world'], []), fidelity });
assert.deepEqual(noHeld.concepts.map((item) => item.id), [], 'missing exact held evidence emits no generic comparison concepts');

const first = deriveConceptSignals({ comparison: exact(), fidelity, pedagogicalDesign: { goal: 'class-separation' }, pedagogicalVerification: verification, pedagogicalObservation: observation('class-separation', [fact('class-separation-distance', 2, 1)]) });
const second = deriveConceptSignals({ comparison: exact(), fidelity, pedagogicalDesign: { goal: 'class-separation' }, pedagogicalVerification: verification, pedagogicalObservation: observation('class-separation', [fact('class-separation-distance', 2, 1)]) });
assert.deepEqual(first, second, 'identical evidence produces byte-stable concept signals');
assert.equal(canonicalizeConceptSignals({ version: 1, concepts: [{ id: 'forged-concept', confidence: 'direct', evidenceRefs: [], trigger: 'exact-comparison-fidelity' }] }), null, 'forged concept IDs cannot enter canonical state');
assert.equal(canonicalizeConceptSignals({ version: 1, concepts: [{ id: CONCEPT_IDS.CLASS_SEPARATION, confidence: 'direct', evidenceRefs: [], trigger: 'not-a-reason' }] }), null, 'unbounded concept trigger is rejected');

const dataset = {
  name: 'Concept card classification source', task: 'classification', featureColumns: ['x', 'y'], targetColumn: 'label',
  columns: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 'label', type: 'string' }],
  rows: [{ x: -1, y: -1, label: '0' }, { x: -0.8, y: -1.1, label: '0' }, { x: 1, y: 1, label: '1' }, { x: 0.8, y: 1.1, label: '1' }],
};
const runtimeHost = createPlaygroundHost({ getDataset: () => dataset });
await runtimeHost.open({ playgroundId: 'data-lab', seed: 2048 });
await runtimeHost.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: 'knn-classification' });
const worldSetup = runtimeHost.proposeExploration({ request: 'Create a classification world', worldDesign: { mode: 'create', recipe: getWorldRecipePreset('rings'), patch: null, requestedHolds: [] } });
await runtimeHost.executeExploration({ scenario: worldSetup.scenario });
const pedagogicalSetup = runtimeHost.proposeExploration({ design: createPedagogicalExperimentDesign('class-separation') });
assert.equal(pedagogicalSetup.kind, 'proposal', `runtime class-separation proposal: ${pedagogicalSetup.reason ?? pedagogicalSetup.interpretation?.ambiguity ?? 'unknown'}`);
const runtimeResult = await runtimeHost.executeExploration({ scenario: pedagogicalSetup.scenario });
assert.equal(runtimeResult.fidelity.status, 'exact', 'runtime pedagogical experiment is exact before concept derivation');
assert.equal(runtimeResult.conceptSignals.concepts[0].id, CONCEPT_IDS.CLASS_SEPARATION, 'successful runtime experiment returns an intervention-grounded concept');
assert.equal(runtimeResult.conceptSignals.concepts.some((item) => item.id === 'overlap'), false, 'runtime concept signal never renames separation as overlap');
await runtimeHost.close();

const dir = mkdtempSync(path.join(tmpdir(), 'volk-concept-card-'));
const outfile = path.join(dir, 'smoke.cjs');
const entry = fileURLToPath(new URL('./ui-concept-card-smoke.jsx', import.meta.url));
try {
  buildSync({ entryPoints: [path.relative(process.cwd(), entry).split(path.sep).join('/')], bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic', outfile, logLevel: 'silent' });
  const loaded = await import(pathToFileURL(outfile).href);
  const result = await loaded.runConceptCardSmoke({ signal: first.concepts[0], observation: observation('class-separation', [fact('class-separation-distance', 2, 1)]) });
  assert.equal(result.passed, true);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('Concept card checks passed: bounded catalog, deterministic evidence signals, intervention priority, exact-fidelity gating, canonical IDs, session deduplication, no-AI rendering, and compact-safe presentation.');
