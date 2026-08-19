import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { INQUIRY_CONCEPT_IDS } from '../src/core/exploration/learnerInquiry.js';
import { nextInquiryConceptEventExposure, nextInquiryConceptExposure, selectInquiryConceptCard } from '../src/core/exploration/inquiryConceptCard.js';

const candidate = (conceptId, reasonCode, eventId) => ({ conceptId, confidence: 'direct', reasonCode, supportingEventIds: [eventId], supportingObservationIds: [] });
const inquiry = { candidates: [
  candidate(INQUIRY_CONCEPT_IDS.CONTROLLED_COMPARISON, 'duplicated-one-factor-comparison', 'event-compare'),
  candidate(INQUIRY_CONCEPT_IDS.COUNTERFACTUAL_REASONING, 'changed-one-condition-against-baseline', 'event-compare'),
] };

const first = selectInquiryConceptCard({ inquiry });
assert.equal(first.conceptId, INQUIRY_CONCEPT_IDS.CONTROLLED_COMPARISON, 'a clean A/B experiment surfaces one appropriate controlled-comparison card');
assert.deepEqual(first.whyKeys, ['playground.inquiry.why.duplicated', 'playground.inquiry.why.oneFactor', 'playground.inquiry.why.compared'], 'why-now content is a deterministic projection of event evidence');
assert.equal(first.action.type, 'open-evidence', 'cards reuse an existing conceptual-depth action rather than executing an experiment');
assert.equal(selectInquiryConceptCard({ inquiry, shownConceptIds: [first.conceptId], shownEventIds: first.supportingEventIds }), null, 'the same evidence cycle does not surface a second card during minor actions in one session');
assert.deepEqual(nextInquiryConceptExposure(['a', 'a'], first.conceptId), ['a', first.conceptId], 'session exposure remains bounded and deduplicated');
assert.deepEqual(nextInquiryConceptEventExposure(['event-a'], first.supportingEventIds), ['event-a', 'event-compare'], 'event-cycle exposure remains bounded and deduplicated');
assert.equal(selectInquiryConceptCard({ inquiry: { candidates: [{ ...inquiry.candidates[0], confidence: 'maybe' }] } }), null, 'only deterministic direct candidates can create a card');
assert.equal(selectInquiryConceptCard({ inquiry: { candidates: [candidate(INQUIRY_CONCEPT_IDS.GENERALIZATION, 'unrecognized-reason', 'event')] } }), null, 'unrecognized caller-authored reason codes cannot create a card');
assert.equal(selectInquiryConceptCard({ inquiry: { candidates: [] } }), null, 'no candidate renders no card placeholder');

const dir = mkdtempSync(path.join(tmpdir(), 'volk-inquiry-card-'));
const outfile = path.join(dir, 'smoke.cjs');
const entry = fileURLToPath(new URL('./ui-inquiry-concept-card-smoke.jsx', import.meta.url));
try {
  buildSync({ entryPoints: [path.relative(process.cwd(), entry).split(path.sep).join('/')], bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic', outfile, logLevel: 'silent' });
  const loaded = await import(pathToFileURL(outfile).href);
  assert.equal((await loaded.runInquiryConceptCardSmoke({ card: first })).passed, true);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('Inquiry Concept Card checks passed: deterministic candidate-only selection, one-card priority, session deduplication, factual why-now copy, existing Evidence navigation, no AI, and compact-safe markup.');
