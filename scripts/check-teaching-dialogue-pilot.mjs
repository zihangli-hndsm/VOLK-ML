import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TEACHING_DIALOGUE_MOVES,
  TEACHING_DIALOGUE_RESPONSE_SCHEMA,
  createTeachingDialogueSession,
  projectTeachingDialogueContext,
  localTeachingDialoguePolicy,
  createTeachingDialogueResponse,
  TEACHING_DIALOGUE_AUTHORED_CASES,
  createTeachingDialogueProvider,
  parseTeachingDialogueProviderResponse,
  TEACHING_DIALOGUE_PROVIDER_TIMEOUT_MS,
  decideTeachingDialogue,
  validateTeachingDialogueResponse,
  recordTeachingDialogueTurn,
  storeTeachingHypothesis,
  reviseTeachingHypothesis,
  stopTeachingDialogue,
  isTeachingDialoguePilotEnabled,
} from '../src/core/exploration/teachingDialoguePilot.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';

assert.equal(isTeachingDialoguePilotEnabled({}), false, 'pilot is disabled by default');
assert.equal(isTeachingDialoguePilotEnabled({ VITE_VOLK_TEACHING_DIALOGUE_PILOT: '1' }), true, 'pilot flag accepts explicit enablement');
assert.equal(TEACHING_DIALOGUE_RESPONSE_SCHEMA.schema.additionalProperties, false);
assert.equal(TEACHING_DIALOGUE_MOVES.length, 6);

const session = createTeachingDialogueSession({ id: 'pilot-test', language: 'en' });
const context = projectTeachingDialogueContext({
  session,
  snapshot: {
    bigIdea: { orchestrationContractId: 'episode-1-sampling-variability' },
    inquiryRuntime: {
      contractId: 'episode-1-sampling-variability', currentQuestion: 'episode.one.question', currentDepth: 'PHENOMENON',
      evidence: { status: 'evidenced', structure: { worldHeldConstant: true, sampleIdentityChanged: true }, evidence: { changed: ['training Data'], held: ['World identity'], observed: { lineMovement: 'visible' } } },
      comparison: { enabled: true }, baseline: { experimentId: 'A' },
    },
    experimentWorkspace: { activeExperimentId: 'B' },
  },
});
const local = localTeachingDialoguePolicy({ context, session });
assert.equal(local.move, 'REQUEST_TEACH_BACK');
assert.deepEqual(validateTeachingDialogueResponse(local, { context }), local);
assert.equal((await decideTeachingDialogue({ context, session, preferredMove: 'EXPLAIN_WITH_EVIDENCE' })).move, 'EXPLAIN_WITH_EVIDENCE', 'learner-selected direct explanation remains the selected move');
const unavailableDirect = localTeachingDialoguePolicy({ context: { ...context, evidence: [], activeComparison: { enabled: false } }, session, preferredMove: 'EXPLAIN_WITH_EVIDENCE' });
assert.equal(unavailableDirect.grounding, 'conceptual', 'direct explanation remains available as a conceptual response without evidence');
assert.equal(unavailableDirect.content.key, 'episode.one.teachingDialogue.conceptual');
assert.deepEqual(unavailableDirect.evidenceRefs, []);
assert.equal(validateTeachingDialogueResponse({ ...unavailableDirect, grounding: 'evidence', content: { key: 'episode.one.teachingDialogue.evidence' }, evidenceRefs: [] }, { context: { ...context, evidence: [], activeComparison: { enabled: false } } }), null, 'measured explanation without supplied evidence is rejected');
assert.equal(validateTeachingDialogueResponse({ ...local, move: 'EXPLAIN_WITH_EVIDENCE', grounding: 'conceptual', content: { key: 'episode.one.teachingDialogue.conceptual' }, evidenceRefs: [] }, { context }), null, 'conceptual explanation cannot replace a valid measured comparison');
assert.equal(validateTeachingDialogueResponse({ ...local, evidenceRefs: ['invented'] }, { context }), null, 'invented evidence refs are rejected');
assert.equal(validateTeachingDialogueResponse({ ...local, extra: true }, { context }), null, 'schema injection is rejected');
assert.equal(validateTeachingDialogueResponse({ ...local, contextRevision: 99 }, { context }), null, 'stale responses are rejected');
const directFresh = localTeachingDialoguePolicy({ context: { ...context, evidence: [], activeComparison: null }, session, preferredMove: 'EXPLAIN_WITH_EVIDENCE' });
const directUnchanged = localTeachingDialoguePolicy({ context: { ...context, evidence: [{ evidenceId: 'e1', summary: 'valid-weak' }], activeComparison: { ...context.activeComparison, outcome: 'unchanged' }, facts: [...context.facts, { id: 'evidence.observed.lineMovement', kind: 'observation', value: 'unchanged' }] }, session, preferredMove: 'EXPLAIN_WITH_EVIDENCE' });
const directMixed = localTeachingDialoguePolicy({ context: { ...context, evidence: [{ evidenceId: 'e1', summary: 'evidenced' }], activeComparison: { ...context.activeComparison, changed: ['sampling realization', 'noise'] } }, session, preferredMove: 'EXPLAIN_WITH_EVIDENCE' });
const directChanged = localTeachingDialoguePolicy({ context: { ...context, evidence: [{ evidenceId: 'e1', summary: 'evidenced' }], activeComparison: { ...context.activeComparison, outcome: 'visible' }, facts: [...context.facts, { id: 'evidence.observed.lineMovement', kind: 'observation', value: 'visible' }] }, session, preferredMove: 'EXPLAIN_WITH_EVIDENCE' });
assert.equal(directFresh.content.key, 'episode.one.teachingDialogue.conceptual');
assert.equal(directUnchanged.content.key, 'episode.one.teachingDialogue.observedUnchanged');
assert.equal(directMixed.content.key, 'episode.one.teachingDialogue.conceptual');
assert.equal(directChanged.content.key, 'episode.one.teachingDialogue.evidence');
let providerCalls = 0; let capturedProviderPrompt = ''; let providerSignal = null;
const providerAdapter = createTeachingDialogueProvider({ config: { apiKey: 'fixture', protocol: 'openai-compatible', model: 'fixture' }, gateway: { complete: async ({ messages, responseSchema, signal }) => { providerCalls += 1; providerSignal = signal; capturedProviderPrompt = messages[0].content; assert.equal(responseSchema.name, 'volk_ml_teaching_dialogue_pilot_v1'); return { text: JSON.stringify({ ...local, origin: 'provider' }) }; } } });
const providerResult = await providerAdapter({ ...context, learnerStatements: [{ id: 's1', text: 'The learner wrote this.', kind: 'reason', source: 'learner' }] }, { signal: new AbortController().signal });
assert.equal(providerCalls, 1, 'configured provider adapter makes one bounded call');
assert.match(capturedProviderPrompt, /The learner wrote this/);
assert.ok(providerSignal, 'provider boundary receives a cancellation signal');
assert.equal(providerResult.origin, 'provider');
assert.match(capturedProviderPrompt, /must contain exactly these keys/);
assert.match(capturedProviderPrompt, /statementRefs and evidenceRefs must contain only IDs supplied/);
assert.deepEqual(parseTeachingDialogueProviderResponse('```json\n{"ok":true}\n```'), { ok: true }, 'a single JSON code fence is safely unwrapped');
assert.equal(parseTeachingDialogueProviderResponse('prefix {"ok":true}'), null, 'non-JSON provider prose is rejected');
const providerFallback = await decideTeachingDialogue({ context, session, provider: async () => { throw new Error('offline'); } });
assert.equal(providerFallback.origin, 'fallback', 'provider failure preserves authored local fallback origin');
assert.equal(providerFallback.fallbackReason, 'transport', 'transport failure is classified without exposing provider details');
assert.equal(providerFallback.move, local.move);
const malformedFallback = await decideTeachingDialogue({ context, session, provider: async () => ({ version: 99 }) });
assert.equal(malformedFallback.origin, 'fallback', 'malformed or unsupported provider output falls back');
assert.equal(malformedFallback.fallbackReason, 'semantic', 'schema-validity failure is classified as semantic rejection');
const unavailableFallback = await decideTeachingDialogue({ context, session, provider: async () => null });
assert.equal(unavailableFallback.fallbackReason, 'unavailable', 'missing provider output is classified as unavailable');
const malformedProvider = createTeachingDialogueProvider({ config: { apiKey: 'fixture', protocol: 'openai-compatible', model: 'fixture' }, gateway: { complete: async () => ({ text: 'not json' }) } });
const malformedProviderFallback = await decideTeachingDialogue({ context, session, provider: malformedProvider });
assert.equal(malformedProviderFallback.fallbackReason, 'malformed', 'invalid provider JSON is classified as malformed');
assert.equal(TEACHING_DIALOGUE_PROVIDER_TIMEOUT_MS, 10000, 'live provider budget is explicitly bounded at ten seconds');
const timeoutFallback = await decideTeachingDialogue({ context, session, timeoutMs: 1, provider: () => new Promise(() => {}) });
assert.equal(timeoutFallback.origin, 'fallback', 'provider timeout preserves local fallback');
assert.equal(timeoutFallback.fallbackReason, 'timeout', 'provider timeout is classified without raw error text');
assert.deepEqual(validateTeachingDialogueResponse(timeoutFallback, { context }), timeoutFallback, 'bounded fallback diagnostics remain inside the validated response envelope');
let timedAbort = false;
const abortingProvider = createTeachingDialogueProvider({ config: { apiKey: 'fixture', protocol: 'openai-compatible', model: 'fixture' }, gateway: { complete: ({ signal }) => new Promise((resolve) => signal.addEventListener('abort', () => { timedAbort = true; resolve({ text: JSON.stringify(local) }); }, { once: true })) } });
await decideTeachingDialogue({ context, session, provider: abortingProvider, timeoutMs: 1 });
assert.equal(timedAbort, true, 'provider timeout aborts the underlying gateway request');
const externalAbort = new AbortController();
const abortedDecision = decideTeachingDialogue({ context, session, provider: () => new Promise(() => {}), signal: externalAbort.signal, timeoutMs: 10000 });
externalAbort.abort();
assert.equal((await abortedDecision).fallbackReason, 'aborted', 'external cancellation is classified as aborted');

const withTurn = recordTeachingDialogueTurn(session, { kind: 'reason', text: 'The sample may vary.' });
assert.equal(withTurn.contextRevision, 1);
assert.equal(withTurn.turns.length, 1);
const stopped = stopTeachingDialogue(withTurn);
assert.equal(stopped.stopped, true);
assert.equal(stopped.contextRevision, 2);
let saturated = session;
for (let index = 0; index < 12; index += 1) saturated = recordTeachingDialogueTurn(saturated, { kind: 'statement', text: `turn-${index}` });
assert.equal(new Set(saturated.turns.map((turn) => turn.id)).size, saturated.turns.length, 'turn IDs remain unique after bounded eviction');
assert.equal(saturated.nextTurnSequence, 12);
const boundedContext = projectTeachingDialogueContext({ session: saturated, snapshot: { inquiryRuntime: { currentQuestion: 'q', evidence: { status: 'insufficient' } } } });
assert.equal(boundedContext.learnerStatements.at(-1).text, 'turn-11', 'bounded context prioritizes the latest learner statement');
assert.equal(boundedContext.learnerStatements.some((statement) => statement.text === 'turn-0'), false, 'evicted learner text is not projected');
let retained = recordTeachingDialogueTurn(session, { kind: 'reason', text: 'keep this statement' });
const retainedRef = retained.turns[0].id;
retained = storeTeachingHypothesis(retained, { id: 'eviction-h1', text: 'A provisional idea', statementRefs: [retainedRef], status: 'tentative' });
for (let index = 0; index < 8; index += 1) retained = recordTeachingDialogueTurn(retained, { kind: 'statement', text: `overflow-${index}` });
assert.equal(retained.hypotheses[0].status, 'retracted', 'evicting a referenced statement retracts the hypothesis');
assert.equal(reviseTeachingHypothesis(retained, { id: 'eviction-h1', text: 'Revised without a retained ref', statementRefs: [retainedRef] }).hypotheses[0].status, 'retracted', 'retracted hypotheses cannot be revived with an evicted ref');

assert.equal(TEACHING_DIALOGUE_AUTHORED_CASES.length, 12, 'exactly twelve authored quality cases are registered');
assert.deepEqual(new Set(TEACHING_DIALOGUE_AUTHORED_CASES.map((item) => item.id)).size, 12, 'authored case IDs are unique');
function evaluateAuthoredCase({ item, context: caseContext, session: caseSession, policy = localTeachingDialoguePolicy }) {
  let callCount = 0;
  const result = policy({ context: caseContext, session: caseSession });
  callCount += 1;
  const failureReasons = [];
  const selectedMoveAllowed = item.allowedMoves.includes(result?.move);
  const responseValid = validateTeachingDialogueResponse(result, { context: caseContext }) !== null;
  const noInventedHypothesis = result?.provisionalHypothesis === null;
  if (!selectedMoveAllowed) failureReasons.push('move-not-allowed');
  if (!responseValid) failureReasons.push('response-invalid-or-ungrounded');
  if (!noInventedHypothesis) failureReasons.push('invented-hypothesis');
  const assertions = { selectedMoveAllowed, responseValid, noInventedHypothesis };
  return {
    result,
    callCount,
    assertions,
    failureReasons,
    status: failureReasons.length === 0 ? 'passed' : 'failed',
    origin: result?.origin ?? 'unknown',
    fallbackUsed: result?.origin === 'fallback',
    repairUsed: Boolean(result?.repaired),
    scores: Object.fromEntries(Object.entries(assertions).map(([key, passed]) => [key, passed ? 2 : 0])),
  };
}
const caseOutcomes = [];
TEACHING_DIALOGUE_AUTHORED_CASES.forEach((item) => {
  assert.ok(item.allowedMoves.length && item.forbiddenClaims.length && item.forbiddenActions.length && item.evidenceRequirements.length, `${item.id} declares quality boundaries`);
  for (const dimension of ['groundedness', 'moveRelevance', 'learnerChoice', 'uncertainty']) assert.equal(item.rubric[dimension].length, 3, `${item.id} has 0/1/2 anchors for ${dimension}`);
  const caseContext = item.id === 'unavailable'
    ? { ...context, language: item.locale, evidence: [], activeComparison: null, facts: [{ id: 'evidence.unavailable', kind: 'unavailable', value: true }] }
    : item.id === 'mixed-factor'
      ? { ...context, language: item.locale, evidence: [{ evidenceId: 'e1', summary: 'valid-weak' }], activeComparison: { ...context.activeComparison, changed: ['sampling realization', 'train-sample-count'] } }
      : item.id === 'unchanged'
        ? { ...context, language: item.locale, evidence: [{ evidenceId: 'e1', summary: 'valid-weak' }] }
        : item.id === 'ambiguous-same-world'
          ? { ...context, language: item.locale, evidence: [{ evidenceId: 'e1', summary: 'evidenced' }], activeComparison: { ...context.activeComparison, changed: ['sampling realization', 'noise'] } }
          : { ...context, language: item.locale, prediction: item.id === 'correct-reason' ? { ref: 'episode:prediction', expectation: 'different', reasoning: 'same process' } : null, activeComparison: ['correct-no-reason', 'rejected-hypothesis', 'delayed-stop-switch', 'injection'].includes(item.id) ? null : context.activeComparison, evidence: [{ evidenceId: 'e1', summary: ['correct-reason', 'correct-no-reason', 'rejected-hypothesis', 'delayed-stop-switch', 'injection'].includes(item.id) ? 'insufficient' : item.id === 'hint-direct-choice' ? 'valid-weak' : 'evidenced' }] };
  const caseSession = { ...session, language: item.locale, followUpsWithoutInformation: item.id === 'english-mixed-paraphrase' ? 2 : 0 };
  const evaluation = evaluateAuthoredCase({ item, context: caseContext, session: caseSession });
  const result = evaluation.result;
  assert.equal(evaluation.status, 'passed', `${item.id} first result passes authored assertions: ${evaluation.failureReasons.join(',')}`);
  if (item.id === 'correct-reason') assert.equal(caseContext.prediction?.ref, 'episode:prediction');
  if (item.id === 'unavailable') assert.deepEqual(caseContext.facts, [{ id: 'evidence.unavailable', kind: 'unavailable', value: true }]);
  if (item.id === 'unchanged') assert.equal(caseContext.evidence[0].summary, 'valid-weak');
  if (item.id === 'mixed-factor') assert.ok(caseContext.activeComparison.changed.includes('train-sample-count'));
  if (item.id === 'hint-direct-choice') assert.equal(result.move, 'OFFER_HINT');
  caseOutcomes.push({ id: item.id, status: evaluation.status, origin: evaluation.origin, callCount: evaluation.callCount, fallbackUsed: evaluation.fallbackUsed, repairUsed: evaluation.repairUsed, selectedMove: result.move, allowedMoves: item.allowedMoves, assertions: evaluation.assertions, scores: evaluation.scores, failureReasons: evaluation.failureReasons, evidenceRequirements: item.evidenceRequirements });
});
const wrongMoveEvaluation = evaluateAuthoredCase({ item: TEACHING_DIALOGUE_AUTHORED_CASES[0], context, session, policy: () => ({ ...local, move: 'SUMMARIZE_AND_PAUSE' }) });
assert.deepEqual(wrongMoveEvaluation.failureReasons, ['move-not-allowed'], 'negative runner reports a deliberately wrong first move');
const missingEvidenceEvaluation = evaluateAuthoredCase({ item: TEACHING_DIALOGUE_AUTHORED_CASES[4], context, session, policy: () => createTeachingDialogueResponse({ context, move: 'EXPLAIN_WITH_EVIDENCE', grounding: 'evidence', evidenceRefs: [] }) });
assert.deepEqual(missingEvidenceEvaluation.failureReasons, ['response-invalid-or-ungrounded'], 'negative runner reports missing required evidence');
const fabricatedMeasuredClaim = { ...unavailableDirect, grounding: 'evidence', content: { key: 'episode.one.teachingDialogue.evidence' }, evidenceRefs: ['invented'] };
const fabricatedEvaluation = evaluateAuthoredCase({ item: TEACHING_DIALOGUE_AUTHORED_CASES[4], context: { ...context, evidence: [], activeComparison: { enabled: false } }, session, policy: () => fabricatedMeasuredClaim });
assert.deepEqual(fabricatedEvaluation.failureReasons, ['response-invalid-or-ungrounded'], 'negative runner reports a fabricated measured claim');
const allElicitFailures = TEACHING_DIALOGUE_AUTHORED_CASES.map((item) => evaluateAuthoredCase({ item, context, session, policy: ({ context: incoming }) => createTeachingDialogueResponse({ context: incoming, move: 'ELICIT_PREDICTION' }) })).filter((evaluation) => evaluation.failureReasons.includes('move-not-allowed'));
assert.ok(allElicitFailures.length >= 1, 'all-ELICIT policy fails authored cases that require a different first move');
const allExplainFailures = TEACHING_DIALOGUE_AUTHORED_CASES.map((item) => evaluateAuthoredCase({ item, context, session, policy: ({ context: incoming }) => createTeachingDialogueResponse({ context: incoming, move: 'EXPLAIN_WITH_EVIDENCE', grounding: 'evidence' }) })).filter((evaluation) => evaluation.failureReasons.length > 0);
assert.ok(allExplainFailures.length >= 1, 'all-EXPLAIN policy fails authored cases with unavailable or inapplicable explanation');
assert.equal(context.evidence.length, 1, 'evidence fixture retains a stable supplied ID');
const unavailableContext = projectTeachingDialogueContext({ session, snapshot: { inquiryRuntime: { evidence: { status: 'insufficient' } } } });
assert.deepEqual(unavailableContext.facts, [{ id: 'evidence.unavailable', kind: 'unavailable', value: true }], 'unavailable evidence is explicit and does not imply measured booleans');

const host = createPlaygroundHost({ getDataset: () => null, teachingDialoguePilotEnabled: true });
await host.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
assert.equal(host.getTeachingDialogueContext(), null, 'dialogue requires explicit opt-in');
await host.recordInquiryPrediction({ expectation: 'same', reasoning: 'same process' });
await host.optInTeachingDialogue();
const opted = host.getState();
assert.equal(opted.teachingDialogue.optedIn, true);
assert.equal(opted.teachingDialogue.context.prediction.expectation, 'same', 'Episode prediction is projected with provenance');
assert.equal(opted.teachingDialogue.context.prediction.ref, 'episode-1-sampling-variability:prediction');
assert.equal(host.getTeachingDialogueContext({ requestId: 'same-context' }).contextRevision, opted.teachingDialogue.context.contextRevision, 'host display and request context share the same semantic revision');
const response = await host.requestTeachingDialogue({ requestId: 'host-request' });
assert.ok(response && TEACHING_DIALOGUE_MOVES.includes(response.move));
const before = host.getState();
await host.recordTeachingDialogueTurn({ kind: 'reason', text: 'I expect the sample to move the fit.' });
const after = host.getState();
assert.deepEqual(after.experiment, before.experiment, 'dialogue does not mutate the experiment');
assert.deepEqual(after.semanticEvents, before.semanticEvents, 'dialogue does not emit semantic events');
await host.stopTeachingDialogue();
assert.equal(host.getState().teachingDialogue.stopped, true);

let sharedPolicyCalls = 0; let sharedPolicyContext = null;
const sharedHost = createPlaygroundHost({ getDataset: () => null, teachingDialoguePilotEnabled: true, teachingDialoguePolicy: async (incoming) => { sharedPolicyCalls += 1; sharedPolicyContext = incoming; return createTeachingDialogueResponse({ context: incoming, move: 'OFFER_HINT', origin: 'provider' }); } });
await sharedHost.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
await sharedHost.optInTeachingDialogue();
await sharedHost.dispatch({ type: 'RUN' });
let sharedSnapshot = await sharedHost.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
sharedSnapshot = await sharedHost.dispatch({ type: 'RESAMPLE_WORLD' });
sharedSnapshot = await sharedHost.dispatch({ type: 'RUN' });
sharedSnapshot = await sharedHost.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: sharedSnapshot.experimentWorkspace.comparison.againstExperimentId });
sharedHost.recordTeachingDialogueReply({ kind: 'reason', text: 'The same World may produce a different sample.' });
const displayedSharedContext = sharedHost.getTeachingDialogueContext({ requestId: 'shared-comparison' });
const sharedResponse = await sharedHost.requestTeachingDialogue({ requestId: 'shared-comparison', preferredMove: 'OFFER_HINT' });
assert.equal(sharedPolicyCalls, 1, 'production boundary invokes the configured policy exactly once');
assert.deepEqual(sharedPolicyContext.activeComparison, displayedSharedContext.activeComparison, 'display and provider receive the same comparison');
assert.deepEqual(sharedPolicyContext.evidence, displayedSharedContext.evidence, 'display and provider receive the same canonical evidence refs');
assert.deepEqual(sharedPolicyContext.learnerStatements, displayedSharedContext.learnerStatements, 'display and provider receive the same learner reply projection');
assert.equal(sharedPolicyContext.contextRevision, displayedSharedContext.contextRevision, 'display and provider receive the same semantic revision');
assert.equal(sharedResponse.origin, 'provider');
await sharedHost.restartBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
assert.equal(sharedHost.getState().teachingDialogue.context, null, 'reset removes the opted-in dialogue context');

const replyHost = createPlaygroundHost({ getDataset: () => null, teachingDialoguePilotEnabled: true });
await replyHost.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
await replyHost.optInTeachingDialogue();
replyHost.recordTeachingDialogueReply({ kind: 'prediction', expectation: 'different', text: 'The new sample may move the fit.' });
const replySnapshot = replyHost.getState();
assert.equal(replySnapshot.teachingDialogue.context.prediction.expectation, 'different', 'panel-equivalent prediction reply uses the prediction API semantics');
assert.equal(replySnapshot.teachingDialogue.context.prediction.reasoning, 'The new sample may move the fit.');
assert.equal(replySnapshot.semanticEvents.events.filter((event) => event.type === 'prediction.recorded').length, 1, 'prediction reply records exactly one semantic prediction');
replyHost.recordTeachingDialogueReply({ kind: 'prediction', expectation: 'same', text: 'same' });
assert.equal(replyHost.getState().semanticEvents.events.filter((event) => event.type === 'prediction.recorded').length, 1, 'later prediction replies cannot overwrite the original prediction');

const transferHost = createPlaygroundHost({ getDataset: () => null, teachingDialoguePilotEnabled: true });
await transferHost.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
await transferHost.optInTeachingDialogue();
await transferHost.beginTeachingTransfer();
assert.equal(transferHost.getState().teachingDialogue.assistanceDisabled, true, 'unassisted transfer disables help until requested');
assert.equal(await transferHost.requestTeachingDialogue(), null);

const offlineHost = createPlaygroundHost({ getDataset: () => null, teachingDialoguePilotEnabled: true });
await offlineHost.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
await offlineHost.optInTeachingDialogue();
const offlineResponse = await offlineHost.requestTeachingDialogue({ requestId: 'offline' });
assert.equal(offlineResponse.origin, 'local', 'provider-off production path stays local');

let release;
const delayedHost = createPlaygroundHost({ getDataset: () => null, teachingDialoguePilotEnabled: true, teachingDialoguePolicy: async (oldContext) => new Promise((resolve) => { release = () => resolve(localTeachingDialoguePolicy({ context: oldContext, session: {} })); }) });
await delayedHost.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
await delayedHost.optInTeachingDialogue();
const pending = delayedHost.requestTeachingDialogue({ requestId: 'old' });
await delayedHost.recordTeachingDialogueTurn({ kind: 'reason', text: 'new learner explanation' });
release();
assert.equal(await pending, null, 'delayed provider output is discarded after a newer learner turn');
assert.equal(delayedHost.getState().teachingDialogue.contextRevision, 1, 'stale output cannot roll context revision backward');

let releaseStop;
const stopHost = createPlaygroundHost({ getDataset: () => null, teachingDialoguePilotEnabled: true, teachingDialoguePolicy: async (oldContext) => new Promise((resolve) => { releaseStop = () => resolve(localTeachingDialoguePolicy({ context: oldContext, session: {} })); }) });
await stopHost.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
await stopHost.optInTeachingDialogue();
const stoppedRequest = stopHost.requestTeachingDialogue({ requestId: 'stop-old' });
await stopHost.stopTeachingDialogue();
releaseStop();
assert.equal(await stoppedRequest, null, 'delayed provider output is discarded after stop');

let hostAbortObserved = false;
const abortHost = createPlaygroundHost({ getDataset: () => null, teachingDialoguePilotEnabled: true, teachingDialoguePolicy: async (context, { signal }) => new Promise((resolve) => signal.addEventListener('abort', () => { hostAbortObserved = true; resolve(localTeachingDialoguePolicy({ context, session: {} })); }, { once: true })) });
await abortHost.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
await abortHost.optInTeachingDialogue();
const abortPending = abortHost.requestTeachingDialogue({ requestId: 'abort-old' });
abortHost.cancelTeachingDialogueRequest();
assert.equal(await abortPending, null, 'cancelled provider response cannot apply');
assert.equal(hostAbortObserved, true, 'host cancellation aborts the underlying provider request');

let releaseExperiment;
const changedHost = createPlaygroundHost({ getDataset: () => null, teachingDialoguePilotEnabled: true, teachingDialoguePolicy: async (oldContext) => new Promise((resolve) => { releaseExperiment = () => resolve(localTeachingDialoguePolicy({ context: oldContext, session: {} })); }) });
await changedHost.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
await changedHost.optInTeachingDialogue();
const changedRequest = changedHost.requestTeachingDialogue({ requestId: 'experiment-old' });
await changedHost.dispatch({ type: 'RUN' });
releaseExperiment();
assert.equal(await changedRequest, null, 'delayed provider output is discarded after a fit changes runtime context');

const hypothesisHost = createPlaygroundHost({ getDataset: () => null, teachingDialoguePilotEnabled: true, teachingDialoguePolicy: async (context) => ({ ...localTeachingDialoguePolicy({ context, session: {} }), provisionalHypothesis: { id: 'h1', text: 'Maybe the sample changes the fit.', statementRefs: ['invented'], status: 'tentative' } }) });
await hypothesisHost.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
await hypothesisHost.optInTeachingDialogue();
const hypothesisResponse = await hypothesisHost.requestTeachingDialogue();
assert.equal(hypothesisResponse.provisionalHypothesis, null, 'hypothesis with no supplied statement reference is rejected to local fallback');
await hypothesisHost.recordTeachingDialogueTurn({ kind: 'reason', text: 'The sample can move the fit.' });
const hypothesisHostWithRef = createPlaygroundHost({ getDataset: () => null, teachingDialoguePilotEnabled: true, teachingDialoguePolicy: async (context) => ({ ...localTeachingDialoguePolicy({ context, session: {} }), provisionalHypothesis: { id: 'h1', text: 'Maybe the sample changes the fit.', statementRefs: context.learnerStatements.map((statement) => statement.id), status: 'tentative' } }) });
await hypothesisHostWithRef.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
await hypothesisHostWithRef.optInTeachingDialogue();
await hypothesisHostWithRef.recordTeachingDialogueTurn({ kind: 'reason', text: 'The sample can move the fit.' });
const acceptedHypothesis = await hypothesisHostWithRef.requestTeachingDialogue();
assert.equal(acceptedHypothesis.provisionalHypothesis.status, 'tentative');
assert.equal(hypothesisHostWithRef.getState().teachingDialogue.hypotheses[0].id, 'h1');
await hypothesisHostWithRef.reviseTeachingHypothesis({ id: 'h1', text: 'I now think the fit may move only a little.', statementRefs: hypothesisHostWithRef.getState().teachingDialogue.context.learnerStatements });
assert.match(hypothesisHostWithRef.getState().teachingDialogue.hypotheses[0].text, /little/);
await hypothesisHostWithRef.retractTeachingHypothesis('h1');
assert.equal(hypothesisHostWithRef.getState().teachingDialogue.hypotheses[0].status, 'retracted');

const flagOffHost = createPlaygroundHost({ getDataset: () => null });
await flagOffHost.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
assert.equal(flagOffHost.getState().teachingDialogue, null, 'flag-off host snapshot remains unchanged');

const mainSource = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
assert.match(mainSource, /createTeachingDialogueProvider/);
assert.match(mainSource, /teachingDialoguePolicy/);
assert.match(mainSource, /createPlaygroundHost\(\{ getDataset: datasetProvider, exploreRecipeId: recipeId, cloudClient: volkCloudClient, teachingDialoguePolicy \}\)/, 'actual Explore host construction receives the pilot provider');

console.log(JSON.stringify({ authoredCaseOutcomes: caseOutcomes }, null, 2));
console.log('Teaching dialogue pilot checks passed: authored 12-case registry, default-off flag, bounded context, strict response adapter, stale/injection rejection, local fallback, explicit opt-in, hypothesis lifecycle, transfer lockout, and no runtime mutation.');
