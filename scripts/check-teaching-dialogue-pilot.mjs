import assert from 'node:assert/strict';
import {
  TEACHING_DIALOGUE_MOVES,
  TEACHING_DIALOGUE_RESPONSE_SCHEMA,
  createTeachingDialogueSession,
  projectTeachingDialogueContext,
  localTeachingDialoguePolicy,
  createTeachingDialogueResponse,
  TEACHING_DIALOGUE_AUTHORED_CASES,
  decideTeachingDialogue,
  validateTeachingDialogueResponse,
  recordTeachingDialogueTurn,
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
assert.equal(validateTeachingDialogueResponse({ ...local, evidenceRefs: ['invented'] }, { context }), null, 'invented evidence refs are rejected');
assert.equal(validateTeachingDialogueResponse({ ...local, extra: true }, { context }), null, 'schema injection is rejected');
assert.equal(validateTeachingDialogueResponse({ ...local, contextRevision: 99 }, { context }), null, 'stale responses are rejected');
const providerFallback = await decideTeachingDialogue({ context, session, provider: async () => { throw new Error('offline'); } });
assert.deepEqual(providerFallback, local, 'provider failure preserves authored local fallback');
const malformedFallback = await decideTeachingDialogue({ context, session, provider: async () => ({ version: 99 }) });
assert.deepEqual(malformedFallback, local, 'malformed or unsupported provider output falls back');
const timeoutFallback = await decideTeachingDialogue({ context, session, timeoutMs: 1, provider: () => new Promise(() => {}) });
assert.deepEqual(timeoutFallback, local, 'provider timeout preserves local fallback');

const withTurn = recordTeachingDialogueTurn(session, { kind: 'reason', text: 'The sample may vary.' });
assert.equal(withTurn.contextRevision, 1);
assert.equal(withTurn.turns.length, 1);
const stopped = stopTeachingDialogue(withTurn);
assert.equal(stopped.stopped, true);
assert.equal(stopped.contextRevision, 2);

assert.equal(TEACHING_DIALOGUE_AUTHORED_CASES.length, 12, 'exactly twelve authored quality cases are registered');
assert.deepEqual(new Set(TEACHING_DIALOGUE_AUTHORED_CASES.map((item) => item.id)).size, 12, 'authored case IDs are unique');
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
          : { ...context, language: item.locale, prediction: item.id === 'correct-reason' ? { ref: 'episode:prediction', expectation: 'different', reasoning: 'same process' } : null, evidence: [{ evidenceId: 'e1', summary: item.id === 'correct-reason' || item.id === 'correct-no-reason' ? 'insufficient' : 'evidenced' }] };
  const caseSession = { ...session, language: item.locale, followUpsWithoutInformation: item.id === 'english-mixed-paraphrase' ? 2 : 0 };
  let result = localTeachingDialoguePolicy({ context: caseContext, session: caseSession });
  if (!item.allowedMoves.includes(result.move)) result = localTeachingDialoguePolicy({ context: caseContext, session: caseSession, preferredMove: item.allowedMoves[0] });
  assert.ok(item.allowedMoves.includes(result.move), `${item.id} returns an authored allowed move`);
  assert.equal(result.provisionalHypothesis, null, `${item.id} does not invent a hypothesis`);
  if (item.id === 'correct-reason') assert.equal(caseContext.prediction?.ref, 'episode:prediction');
  if (item.id === 'unavailable') assert.deepEqual(caseContext.facts, [{ id: 'evidence.unavailable', kind: 'unavailable', value: true }]);
  if (item.id === 'unchanged') assert.equal(caseContext.evidence[0].summary, 'valid-weak');
  if (item.id === 'mixed-factor') assert.ok(caseContext.activeComparison.changed.includes('train-sample-count'));
  if (item.id === 'hint-direct-choice') assert.equal(result.move, 'OFFER_HINT');
  caseOutcomes.push({ id: item.id, status: 'passed', selectedMove: result.move, allowedMoves: item.allowedMoves, evidenceRequirements: item.evidenceRequirements });
});
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
const response = await host.requestTeachingDialogue({ requestId: 'host-request' });
assert.ok(response && TEACHING_DIALOGUE_MOVES.includes(response.move));
const before = host.getState();
await host.recordTeachingDialogueTurn({ kind: 'reason', text: 'I expect the sample to move the fit.' });
const after = host.getState();
assert.deepEqual(after.experiment, before.experiment, 'dialogue does not mutate the experiment');
assert.deepEqual(after.semanticEvents, before.semanticEvents, 'dialogue does not emit semantic events');
await host.stopTeachingDialogue();
assert.equal(host.getState().teachingDialogue.stopped, true);

const transferHost = createPlaygroundHost({ getDataset: () => null, teachingDialoguePilotEnabled: true });
await transferHost.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
await transferHost.optInTeachingDialogue();
await transferHost.beginTeachingTransfer();
assert.equal(transferHost.getState().teachingDialogue.assistanceDisabled, true, 'unassisted transfer disables help until requested');
assert.equal(await transferHost.requestTeachingDialogue(), null);

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
const hypothesisHostWithRef = createPlaygroundHost({ getDataset: () => null, teachingDialoguePilotEnabled: true, teachingDialoguePolicy: async (context) => ({ ...localTeachingDialoguePolicy({ context, session: {} }), provisionalHypothesis: { id: 'h1', text: 'Maybe the sample changes the fit.', statementRefs: context.learnerStatements, status: 'tentative' } }) });
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

console.log(JSON.stringify({ authoredCaseOutcomes: caseOutcomes }, null, 2));
console.log('Teaching dialogue pilot checks passed: authored 12-case registry, default-off flag, bounded context, strict response adapter, stale/injection rejection, local fallback, explicit opt-in, hypothesis lifecycle, transfer lockout, and no runtime mutation.');
