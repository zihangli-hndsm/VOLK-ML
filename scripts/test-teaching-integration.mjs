import assert from 'node:assert/strict';
import {
  createTeachingDialogueProvider,
  createTeachingDialogueResponse,
  decideTeachingDialogue,
  localTeachingDialoguePolicy,
} from '../src/core/exploration/teachingDialoguePilot.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createProviderGateway } from '../src/core/ai/providerRegistry.js';
import { createProviderFixtureContext, jsonResponse, openAiCompatiblePayload, responsePayload, safeErrorReport } from './provider-test-support.mjs';

const CONFIG = Object.freeze({ protocol: 'openai-compatible', endpoint: 'https://fixture.invalid/v1/chat/completions', model: 'fixture-model', apiKey: 'fixture-only' });

function createDeterministicAppPolicy() {
  let activeContext = null;
  let invalidNext = false;
  let calls = 0;
  const fetchImpl = async (_endpoint, options) => {
    calls += 1;
    const parsed = JSON.parse(options.body);
    assert.equal(parsed.model, CONFIG.model);
    const context = activeContext;
    let response;
    if (invalidNext) {
      invalidNext = false;
      response = { ...responsePayload(createTeachingDialogueResponse({ context, move: 'OFFER_HINT', origin: 'provider' })), content: { key: 'episode.one.teachingDialogue.evidence', params: {} } };
    } else if (!context?.prediction) {
      response = responsePayload(createTeachingDialogueResponse({ context, move: 'ELICIT_PREDICTION', origin: 'provider' }));
    } else if (!(context.learnerStatements ?? []).some((statement) => statement.kind === 'reason')) {
      response = responsePayload(createTeachingDialogueResponse({ context, move: 'ASK_FOR_REASON', origin: 'provider' }));
    } else if ((context.learnerStatements ?? []).some((statement) => statement.kind === 'teach-back')) {
      response = responsePayload(createTeachingDialogueResponse({ context, move: 'SUMMARIZE_AND_PAUSE', origin: 'provider' }));
    } else {
      const evidenceRefs = context.evidence?.map((item) => item.evidenceId) ?? [];
      response = responsePayload(createTeachingDialogueResponse({ context, move: 'EXPLAIN_WITH_EVIDENCE', grounding: evidenceRefs.length ? 'evidence' : 'conceptual', evidenceRefs, origin: 'provider' }));
    }
    return jsonResponse(openAiCompatiblePayload(JSON.stringify(response)), 200);
  };
  const gateway = createProviderGateway({ fetchImpl });
  const adapter = createTeachingDialogueProvider({ gateway, config: CONFIG });
  return {
    provider: async (context, options) => { activeContext = context; return adapter(context, options); },
    invalidateNext() { invalidNext = true; },
    calls: () => calls,
  };
}

async function main() {
  const fixture = createDeterministicAppPolicy();

  const noEvidenceContext = {
    ...createProviderFixtureContext(),
    evidence: [],
    facts: [],
    activeComparison: { enabled: false, changed: [], held: [], outcome: 'none' },
  };
  const conceptualGateway = createProviderGateway({
    fetchImpl: async () => jsonResponse(openAiCompatiblePayload(JSON.stringify(responsePayload(createTeachingDialogueResponse({
      context: noEvidenceContext,
      move: 'EXPLAIN_WITH_EVIDENCE',
      grounding: 'conceptual',
      contentKey: 'episode.one.teachingDialogue.conceptual',
      evidenceRefs: [],
      origin: 'provider',
    })))), 200),
  });
  const conceptualProvider = createTeachingDialogueProvider({ gateway: conceptualGateway, config: CONFIG });
  const noEvidenceExplanation = await decideTeachingDialogue({ provider: conceptualProvider, context: noEvidenceContext, session: {}, timeoutMs: 40 });
  assert.equal(noEvidenceExplanation.origin, 'provider');
  assert.equal(noEvidenceExplanation.grounding, 'conceptual', 'no-evidence explanation stays conceptual');
  assert.deepEqual(noEvidenceExplanation.evidenceRefs, [], 'no-evidence explanation cannot invent references');

  const timeoutResult = await decideTeachingDialogue({ provider: async () => new Promise(() => {}), context: noEvidenceContext, session: {}, timeoutMs: 1 });
  assert.equal(timeoutResult.origin, 'fallback');
  assert.equal(timeoutResult.fallbackReason, 'timeout');

  const host = createPlaygroundHost({ getDataset: () => null, teachingDialoguePilotEnabled: true, teachingDialoguePolicy: fixture.provider });
  await host.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
  await host.optInTeachingDialogue();
  host.recordTeachingDialogueReply({ kind: 'prediction', expectation: 'different', text: 'A new sample may move the fitted line.' });
  const predictionDecision = await host.requestTeachingDialogue({ requestId: 'prediction' });
  assert.equal(predictionDecision.origin, 'provider');
  assert.equal(predictionDecision.move, 'ASK_FOR_REASON');
  host.recordTeachingDialogueReply({ kind: 'reason', text: 'The World can stay fixed while the sampled Data changes.' });

  const beforeActions = host.getState();
  await host.dispatch({ type: 'RUN' });
  const baseline = await host.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
  const resampled = await host.dispatch({ type: 'RESAMPLE_WORLD' });
  assert.equal(resampled.experimentWorkspace.activeExperimentId, baseline.experimentWorkspace.activeExperimentId, 'resampling keeps the active B branch');
  const fitB = await host.dispatch({ type: 'RUN' });
  const comparison = await host.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: fitB.experimentWorkspace.comparison.againstExperimentId });
  assert.equal(comparison.inquiryRuntime.evidence.status, 'evidenced');
  assert.deepEqual(comparison.inquiryRuntime.evidence.evidence.held.includes('World identity'), true);
  assert.deepEqual(host.getState().experiment, comparison.experiment, 'experiment remains runtime-owned');
  const explanation = await host.requestTeachingDialogue({ requestId: 'explanation', preferredMove: 'EXPLAIN_WITH_EVIDENCE' });
  assert.equal(explanation.origin, 'provider');
  assert.equal(explanation.move, 'EXPLAIN_WITH_EVIDENCE');
  const beforeInvalid = host.getState();
  fixture.invalidateNext();
  const invalidFallback = await host.requestTeachingDialogue({ requestId: 'invalid-combination', preferredMove: 'EXPLAIN_WITH_EVIDENCE' });
  assert.equal(invalidFallback.origin, 'fallback', 'invalid provider combinations use local fallback');
  assert.deepEqual(host.getState().experiment, beforeInvalid.experiment);
  assert.deepEqual(host.getState().inquiryRuntime.evidence, beforeInvalid.inquiryRuntime.evidence);
  host.recordTeachingDialogueReply({ kind: 'teach-back', text: 'I revise my explanation: the World stayed fixed and the Data changed.' });
  const summary = await host.requestTeachingDialogue({ requestId: 'summary' });
  assert.equal(summary.origin, 'provider');
  assert.equal(summary.move, 'SUMMARIZE_AND_PAUSE');
  assert.equal(host.getState().teachingDialogue.summaryVisible, true, 'final user-visible state is the pause summary');
  await host.beginTeachingTransfer();
  assert.equal(await host.requestTeachingDialogue({ requestId: 'transfer-blocked' }), null, 'optional transfer stays paused until explicitly allowed');
  const transferHelp = await host.requestTeachingDialogue({ requestId: 'transfer-allowed', allowTransferHelp: true });
  assert.ok(transferHelp);

  let release;
  const staleHost = createPlaygroundHost({
    getDataset: () => null,
    teachingDialoguePilotEnabled: true,
    teachingDialoguePolicy: async () => new Promise((resolve) => { release = resolve; }),
  });
  await staleHost.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
  await staleHost.optInTeachingDialogue();
  const oldRequest = staleHost.requestTeachingDialogue({ requestId: 'stale' });
  await staleHost.recordTeachingDialogueTurn({ kind: 'reason', text: 'A newer learner turn supersedes the pending request.' });
  release(localTeachingDialoguePolicy({ context: staleHost.getTeachingDialogueContext({ requestId: 'stale' }), session: {} }));
  assert.equal(await oldRequest, null, 'stale response is discarded');
  assert.equal(staleHost.getState().teachingDialogue.contextRevision, 1);

  let stopRelease;
  const stopHost = createPlaygroundHost({ getDataset: () => null, teachingDialoguePilotEnabled: true, teachingDialoguePolicy: async () => new Promise((resolve) => { stopRelease = resolve; }) });
  await stopHost.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
  await stopHost.optInTeachingDialogue();
  const stopped = stopHost.requestTeachingDialogue({ requestId: 'stop' });
  await stopHost.stopTeachingDialogue();
  stopRelease();
  assert.equal(await stopped, null, 'stopping cancels an in-flight policy result');

  const flagOff = createPlaygroundHost({ getDataset: () => null });
  await flagOff.openBigIdeaEntrance({ id: 'episode-1-sampling-variability', seed: 7101 });
  assert.equal(flagOff.getState().teachingDialogue, null, 'flag-off path is local and inactive');
  assert.deepEqual(host.getState().semanticEvents.events.filter((event) => event.type === 'prediction.recorded').length, 1);
  assert.ok(fixture.calls() >= 4, 'the deterministic app adapter was exercised for multiple policy decisions');
  console.log(JSON.stringify({ version: 1, status: 'passed', mode: 'deterministic-app-integration', journey: ['opt-in', 'prediction', 'reason', 'baseline-fit', 'resample', 'fit-b', 'compare', 'explanation', 'invalid-fallback', 'teach-back', 'summary', 'transfer-pause'], providerCalls: fixture.calls(), browser: 'NOT APPLICABLE' }));
}

main().catch((error) => {
  console.error(JSON.stringify({ version: 1, status: 'failed', mode: 'deterministic-app-integration', error: safeErrorReport(error), browser: 'NOT APPLICABLE' }));
  process.exitCode = 1;
});
