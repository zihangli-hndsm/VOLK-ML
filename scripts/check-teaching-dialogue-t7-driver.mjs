import assert from 'node:assert/strict';
import {
  TEACHING_DIALOGUE_T7_MATRIX_RUNS,
  TEACHING_DIALOGUE_T7_MAX_CASES,
  createTeachingDialogueT7BrowserDriver,
  createTeachingDialogueT7Context,
  runTeachingDialogueT7Matrix,
} from '../src/core/exploration/teachingDialogueT7Matrix.js';
import { localTeachingDialoguePolicy } from '../src/core/exploration/teachingDialoguePilot.js';

const safeRowKeys = ['caseId', 'run', 'origin', 'move', 'contentKey', 'grounding', 'refs', 'rubric', 'scores', 'failureReasons', 'status'];
const safeOrigins = new Set(['local', 'provider', 'fallback']);
const safeCategories = new Set(['unavailable', 'timeout', 'aborted', 'transport', 'provider-schema', 'provider-context', 'provider-invalid-request', 'provider-4xx', 'provider-5xx', 'provider-response', 'malformed', 'semantic']);
const seenContexts = [];
let providerCalls = 0;
const provider = async (context) => {
  providerCalls += 1;
  seenContexts.push(context);
  assert.equal(context.apiKey, undefined, 'matrix context never exposes a provider key');
  assert.equal(context.authorization, undefined, 'matrix context never exposes authorization');
  context.currentQuestion = 'provider cannot mutate the frozen source context';
  return localTeachingDialoguePolicy({ context });
};

const result = await runTeachingDialogueT7Matrix({ provider, revision: 'ae5b0d0' });
assert.equal(result.version, 1);
assert.equal(result.caseCount, 12);
assert.equal(result.runCount, TEACHING_DIALOGUE_T7_MATRIX_RUNS);
assert.equal(result.rowCount, TEACHING_DIALOGUE_T7_MAX_CASES * TEACHING_DIALOGUE_T7_MATRIX_RUNS);
assert.equal(providerCalls, result.rowCount, 'every authored case is sent through the configured provider boundary exactly twice');
assert.equal(result.failed, 0, 'deterministic provider responses satisfy every authored rubric');
for (const row of result.rows) {
  assert.deepEqual(Object.keys(row).sort(), [...safeRowKeys].sort(), 'matrix rows expose only bounded rubric metadata');
  assert.ok(safeOrigins.has(row.origin));
  assert.ok(row.caseId && row.run >= 1 && row.run <= 2);
  assert.ok(row.contentKey === null || row.contentKey.startsWith('episode.one.teachingDialogue.'));
  assert.ok(Array.isArray(row.refs.statementRefs) && Array.isArray(row.refs.evidenceRefs));
  assert.ok(row.failureReasons.every((reason) => safeCategories.has(reason)));
}
assert.equal(JSON.stringify(result).includes('provider cannot mutate'), false, 'provider context text is never returned');
assert.equal(JSON.stringify(result).includes('apiKey'), false, 'credentials are not present in matrix metadata');
assert.equal(JSON.stringify(result).includes('authorization'), false, 'authorization is not present in matrix metadata');

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
assert.equal(fallback.rows.every((row) => row.failureReasons.includes('provider-4xx')), true, 'provider failure is reduced to a safe category');
assert.equal(JSON.stringify(fallback).includes('secret provider response'), false);

const driver = createTeachingDialogueT7BrowserDriver({ provider });
assert.deepEqual(driver.caseIds.length, 12);
assert.equal(typeof driver.run, 'function');
assert.equal(Object.prototype.hasOwnProperty.call(driver, 'config'), false, 'browser driver never exposes provider configuration');
assert.equal(Object.prototype.hasOwnProperty.call(driver, 'gateway'), false, 'browser driver never exposes a gateway or credential store');

console.log('Teaching dialogue T7 matrix driver checks passed: bounded 24-row execution, frozen contexts, safe failure categories, no credential/runtime exposure, and provider-boundary reuse.');
