import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  TEACHING_DIALOGUE_T7_CASE_FIXTURES,
  TEACHING_DIALOGUE_T7_MATRIX_RUNS,
  TEACHING_DIALOGUE_T7_MAX_CASES,
  createTeachingDialogueT7BrowserDriver,
  createTeachingDialogueT7Context,
  assertTeachingDialogueT7FixtureIntegrity,
  validateTeachingDialogueT7FixtureContext,
  evaluateTeachingDialogueT7Result,
  runTeachingDialogueT7Matrix,
} from '../src/core/exploration/teachingDialogueT7Matrix.js';
import { TEACHING_DIALOGUE_AUTHORED_CASES, createTeachingDialogueResponse, localTeachingDialoguePolicy } from '../src/core/exploration/teachingDialoguePilot.js';

const mainSource = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const inquirySource = fs.readFileSync(new URL('../src/components/playground/InquiryEpisodePanel.jsx', import.meta.url), 'utf8');
assert.match(mainSource, /import\.meta\.env\.DEV/);
assert.match(inquirySource, /import\.meta\.env\.DEV/);
const distAssets = path.resolve('dist/assets');
if (fs.existsSync(distAssets)) {
  const productionSource = fs.readdirSync(distAssets).filter((file) => file.endsWith('.js')).map((file) => fs.readFileSync(path.join(distAssets, file), 'utf8')).join('\n');
  assert.doesNotMatch(productionSource, /T7_MATRIX|__VOLK_ML_T7_MATRIX__|TeachingDialogueT7|teachingDialogueT7|Run matrix|Frozen revision/, 'production assets exclude the development matrix driver and control copy');
}

const safeRowKeys = ['caseId', 'run', 'origin', 'move', 'contentKey', 'grounding', 'refs', 'rubric', 'scores', 'safety', 'failureCategories', 'status'];
const safeOrigins = new Set(['local', 'provider', 'fallback']);
const safeCategories = new Set(['unavailable', 'timeout', 'aborted', 'transport', 'provider-schema', 'provider-context', 'provider-invalid-request', 'provider-4xx', 'provider-5xx', 'provider-response', 'malformed', 'semantic']);
const seenContexts = [];
const progressRows = [];
let providerCalls = 0;
const provider = async (context) => {
  providerCalls += 1;
  seenContexts.push(context);
  assert.equal(context.apiKey, undefined, 'matrix context never exposes a provider key');
  assert.equal(context.authorization, undefined, 'matrix context never exposes authorization');
  context.currentQuestion = 'provider cannot mutate the frozen source context';
  return localTeachingDialoguePolicy({ context });
};

const result = await runTeachingDialogueT7Matrix({ provider, revision: 'ae5b0d0', onRow: (row, progress) => progressRows.push({ row, progress }) });
assert.equal(result.version, 1);
assert.equal(result.caseCount, 12);
assert.equal(result.runCount, TEACHING_DIALOGUE_T7_MATRIX_RUNS);
assert.equal(result.rowCount, TEACHING_DIALOGUE_T7_MAX_CASES * TEACHING_DIALOGUE_T7_MATRIX_RUNS);
assert.equal(providerCalls, result.rowCount, 'every authored case is sent through the configured provider boundary exactly twice');
assert.equal(progressRows.length, result.rowCount, 'UI progress receives one bounded row update per call');
assert.deepEqual(progressRows.at(-1).progress, { completed: 24, total: 24 }, 'progress reaches the exact 24-row terminal count without retry masking');
assert.equal(result.failed, 0, 'deterministic provider responses satisfy every authored rubric');
for (const row of result.rows) {
  assert.deepEqual(Object.keys(row).sort(), [...safeRowKeys].sort(), 'matrix rows expose only bounded rubric metadata');
  assert.ok(safeOrigins.has(row.origin));
  assert.ok(row.caseId && row.run >= 1 && row.run <= 2);
  assert.ok(row.contentKey === null || row.contentKey.startsWith('episode.one.teachingDialogue.'));
  assert.ok(Array.isArray(row.refs.statementRefs) && Array.isArray(row.refs.evidenceRefs));
  assert.ok(row.failureCategories.every((reason) => safeCategories.has(reason)));
  if (['rejected-hypothesis', 'delayed-stop-switch', 'injection'].includes(row.caseId)) assert.equal(row.safety.status, 'contained', 'adversarial case reports contained invalid-output behavior');
  assert.deepEqual(Object.keys(row.rubric).sort(), ['forbiddenActions', 'forbiddenClaims', 'groundedness', 'learnerChoice', 'moveRelevance', 'uncertainty'].sort(), 'rows include every bounded rubric dimension and safety outcome');
  for (const dimension of ['groundedness', 'moveRelevance', 'learnerChoice', 'uncertainty']) assert.ok([0, 1, 2].includes(row.rubric[dimension].score) && typeof row.rubric[dimension].anchor === 'string', 'rubric dimensions include a bounded score and authored anchor');
}
assert.equal(JSON.stringify(result).includes('provider cannot mutate'), false, 'provider context text is never returned');
assert.equal(JSON.stringify(result).includes('apiKey'), false, 'credentials are not present in matrix metadata');
assert.equal(JSON.stringify(result).includes('authorization'), false, 'authorization is not present in matrix metadata');
assert.equal(JSON.stringify(result).includes('Ignore the contract'), false, 'learner adversarial text is not returned in matrix metadata');

const frozenContext = createTeachingDialogueT7Context({ id: 'correct-reason', locale: 'en', allowedMoves: ['ELICIT_PREDICTION', 'ASK_FOR_REASON'] }, 'ae5b0d0', 1);
assert.equal(Object.isFrozen(frozenContext), true, 'driver contexts are frozen before policy execution');
assert.equal(Object.isFrozen(frozenContext.activeComparison), true, 'nested driver context is frozen before policy execution');
assert.equal(frozenContext.apiKey, undefined);
assert.equal(frozenContext.inquiryRuntime, undefined, 'driver does not retain a second runtime or experiment copy');

const fallback = await runTeachingDialogueT7Matrix({
  revision: 'provider-error-fixture',
  cases: [{ id: 'unavailable', locale: 'en', allowedMoves: ['ELICIT_PREDICTION', 'ASK_FOR_REASON'] }],
  provider: async () => {
    const error = new Error('provider details must not escape');
    error.code = 'AI_PROVIDER_REQUEST_FAILED';
    error.details = { status: 422, providerMessage: 'secret provider response' };
    throw error;
  },
});
assert.equal(fallback.rowCount, 2);
assert.equal(fallback.rows.every((row) => row.origin === 'fallback'), true);
assert.equal(fallback.rows.every((row) => row.failureCategories.includes('provider-4xx')), true, 'provider failure is reduced to a safe category');
assert.equal(JSON.stringify(fallback).includes('secret provider response'), false);

const driver = createTeachingDialogueT7BrowserDriver({ provider });
assert.deepEqual(driver.caseIds.length, 12);
assert.equal(typeof driver.run, 'function');
assert.equal(Object.prototype.hasOwnProperty.call(driver, 'config'), false, 'browser driver never exposes provider configuration');
assert.equal(Object.prototype.hasOwnProperty.call(driver, 'gateway'), false, 'browser driver never exposes a gateway or credential store');

assert.equal(Object.keys(TEACHING_DIALOGUE_T7_CASE_FIXTURES).length, 12, 'every authored case has a canonical fixture');
assert.equal(assertTeachingDialogueT7FixtureIntegrity({ revision: 'fixture-integrity', run: 1 }), true, 'all authored contexts pass fixture integrity checks');
const unchangedContext = createTeachingDialogueT7Context(TEACHING_DIALOGUE_AUTHORED_CASES.find((item) => item.id === 'unchanged'), 'fixture-integrity', 1);
assert.equal(unchangedContext.facts.filter((fact) => fact.id === 'evidence.observed.lineMovement').length, 1, 'unchanged context contains exactly one line-movement fact');
assert.equal(unchangedContext.facts.find((fact) => fact.id === 'evidence.status')?.value, unchangedContext.evidence[0].summary, 'unchanged status fact matches evidence summary');
assert.deepEqual(createTeachingDialogueT7Context(TEACHING_DIALOGUE_AUTHORED_CASES.find((item) => item.id === 'unchanged'), 'fixture-integrity', 1), unchangedContext, 'fixture construction order is deterministic');
const originalDuplicateFixture = { ...unchangedContext, facts: [...unchangedContext.facts.map((fact) => fact.id === 'evidence.observed.lineMovement' ? { ...fact, value: 'visible' } : fact), { id: 'evidence.observed.lineMovement', kind: 'observation', value: 'unchanged' }] };
const duplicateValidation = validateTeachingDialogueT7FixtureContext(originalDuplicateFixture, { caseId: 'unchanged' });
assert.equal(duplicateValidation.valid, false, 'the original append-style unchanged fixture is rejected');
assert.ok(duplicateValidation.errors.includes('duplicate-line-movement'));
assert.ok(duplicateValidation.errors.includes('line-movement-does-not-match-outcome'));
for (const caseId of ['mixed-factor', 'hint-direct-choice']) {
  const item = TEACHING_DIALOGUE_AUTHORED_CASES.find((candidate) => candidate.id === caseId);
  const context = createTeachingDialogueT7Context(item, 'fixture-integrity', 1);
  assert.equal(context.facts.find((fact) => fact.id === 'evidence.status')?.value, context.evidence[0].summary, `${caseId} status fact matches evidence summary`);
  assert.equal(context.facts.filter((fact) => fact.id === 'evidence.observed.lineMovement').length, 1, `${caseId} has one line-movement fact`);
}
const statusConflictFixture = {
  ...unchangedContext,
  facts: unchangedContext.facts.map((fact) => fact.id === 'evidence.status' ? { ...fact, value: 'evidenced' } : fact),
};
const statusConflictValidation = validateTeachingDialogueT7FixtureContext(statusConflictFixture, { caseId: 'unchanged' });
assert.equal(statusConflictValidation.valid, false, 'status/summary conflict is rejected before provider execution');
assert.deepEqual(statusConflictValidation.errors, ['status-fact-summary-mismatch'], 'status conflict is the only defect in the narrow negative fixture');
const mixedContext = createTeachingDialogueT7Context(TEACHING_DIALOGUE_AUTHORED_CASES.find((item) => item.id === 'mixed-factor'), 'fixture-integrity', 1);
const unchangedAfterMixed = createTeachingDialogueT7Context(TEACHING_DIALOGUE_AUTHORED_CASES.find((item) => item.id === 'unchanged'), 'fixture-integrity', 1);
assert.deepEqual(unchangedAfterMixed, unchangedContext, 'creating another case does not leak mixed-factor state');
assert.equal(mixedContext.evidence[0].summary, 'valid-weak');
assert.ok(TEACHING_DIALOGUE_T7_CASE_FIXTURES['chinese-misconception'].learnerStatements.length > 0, 'misconception fixture includes learner input');
assert.ok(TEACHING_DIALOGUE_T7_CASE_FIXTURES['english-mixed-paraphrase'].learnerStatements[0].text.includes('Data'), 'mixed-language fixture includes its authored paraphrase');
const chineseItem = TEACHING_DIALOGUE_AUTHORED_CASES.find((item) => item.id === 'chinese-misconception');
const chineseContext = createTeachingDialogueT7Context(chineseItem, 'meta', 1);
const genericAllowedMove = createTeachingDialogueResponse({ context: chineseContext, move: 'ELICIT_PREDICTION' });
const genericEvaluation = evaluateTeachingDialogueT7Result({ item: chineseItem, context: chineseContext, result: genericAllowedMove });
assert.ok(genericEvaluation.failureReasons.includes('move-not-allowed'), 'generic allowed move does not satisfy a case-specific authored rubric');
const validLocal = localTeachingDialoguePolicy({ context: chineseContext });
const injectedOperation = evaluateTeachingDialogueT7Result({ item: chineseItem, context: chineseContext, result: { ...validLocal, operation: 'RUN' } });
assert.ok(injectedOperation.failureReasons.includes('response-invalid-or-ungrounded'), 'executable provider payload is rejected by the strict response boundary');
assert.ok(injectedOperation.failureReasons.includes('executable-payload'), 'executable provider payload is reported as a forbidden action');
const rejectedItem = TEACHING_DIALOGUE_AUTHORED_CASES.find((item) => item.id === 'rejected-hypothesis');
const rejectedContext = createTeachingDialogueT7Context(rejectedItem, 'meta', 1);
const forgedHypothesis = evaluateTeachingDialogueT7Result({ item: rejectedItem, context: rejectedContext, result: { ...localTeachingDialoguePolicy({ context: rejectedContext }), provisionalHypothesis: { id: 'forged', text: 'A provider claim', statementRefs: ['invented'], status: 'tentative' } } });
assert.ok(forgedHypothesis.failureReasons.includes('fabricated-hypothesis'), 'invented hypothesis references are rejected and scored');
const staleResult = evaluateTeachingDialogueT7Result({ item: rejectedItem, context: rejectedContext, result: { ...validLocal, contextRevision: 99 } });
assert.ok(staleResult.failureReasons.includes('stale-result'), 'stale provider results are caught by the shared evaluator');

console.log('Teaching dialogue T7 matrix driver checks passed: bounded 24-row execution, frozen contexts, safe failure categories, no credential/runtime exposure, and provider-boundary reuse.');
