import {
  createTeachingDialogueResponse,
  createTeachingDialogueSession,
  projectTeachingDialogueContext,
} from '../src/core/exploration/teachingDialoguePilot.js';
import { sanitizeProviderUsageSummary } from '../src/core/ai/providerUsage.js';

export const PROVIDER_TEST_VERSION = 1;
export const PROVIDER_LIVE_TIMEOUT_MS = 20_000;

const SAFE_MATRIX_FAILURES = new Set([
  'unavailable', 'timeout', 'aborted', 'transport', 'provider-schema', 'provider-context',
  'provider-invalid-request', 'provider-4xx', 'provider-5xx', 'provider-response', 'malformed',
  'semantic', 'move-not-allowed', 'response-invalid-or-ungrounded', 'invented-hypothesis',
  'unsupported-evidence-claim', 'stale-result', 'fabricated-hypothesis', 'executable-payload',
  'evidence-requirement', 'adversarial-not-contained',
]);

export function createProviderFixtureContext({ sessionId = 'provider-contract-session', contextRevision = 0, prediction = null } = {}) {
  const session = {
    ...createTeachingDialogueSession({ id: sessionId, language: 'en' }),
    contextRevision,
    prediction: prediction ? { ref: 'episode-1-sampling-variability:prediction', expectation: prediction.expectation, reasoning: prediction.reasoning ?? null, source: 'episode.prediction' } : null,
  };
  return projectTeachingDialogueContext({
    session,
    snapshot: {
      bigIdea: { orchestrationContractId: 'episode-1-sampling-variability' },
      inquiryRuntime: {
        contractId: 'episode-1-sampling-variability',
        currentQuestion: 'episode.one.question',
        currentDepth: 'PHENOMENON',
        evidence: {
          status: 'evidenced',
          structure: { worldHeldConstant: true, sampleIdentityChanged: true },
          evidence: {
            changed: ['sampling realization', 'sample identity', 'training Data'],
            held: ['World identity', 'World factors', 'model family/configuration', 'learning', 'evaluation'],
            observed: { lineMovement: 'visible' },
          },
        },
        comparison: { enabled: true },
        baseline: { experimentId: 'baseline-A' },
        activeFit: { experimentId: 'active-B', fitId: 'active-B:fit:1', weight: 1.4, bias: 0.6 },
      },
      experimentWorkspace: { activeExperimentId: 'active-B' },
    },
  });
}

export function providerResponseFor(context, { move = 'ELICIT_PREDICTION', grounding = null, evidenceRefs, expectedReplyKind, contentKey } = {}) {
  return createTeachingDialogueResponse({ context, move, grounding, evidenceRefs, expectedReplyKind, contentKey, origin: 'provider' });
}

export function responsePayload(response) {
  const { fallbackReason: _fallbackReason, ...wire } = response;
  return wire;
}

export function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (typeof payload === 'string') return JSON.parse(payload);
      return payload;
    },
  };
}

export function openAiCompatiblePayload(text, usage = null) {
  return { choices: [{ message: { content: text } }], ...(usage ? { usage } : {}) };
}

export function safeErrorReport(error) {
  return { name: String(error?.name ?? 'Error').slice(0, 60), code: String(error?.code ?? 'ASSERTION_FAILED').slice(0, 80) };
}

export function summarizeProviderMatrixResult(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const executedCases = [...new Set(rows.map((row) => typeof row?.caseId === 'string' ? row.caseId : null).filter(Boolean))];
  const failedCaseIds = [...new Set(rows.filter((row) => row?.status === 'failed').map((row) => typeof row?.caseId === 'string' ? row.caseId : null).filter(Boolean))];
  const safeReasons = {};
  const caseResults = [];
  for (const row of rows) {
    const reasons = Array.isArray(row?.failureReasons) ? row.failureReasons : (Array.isArray(row?.failureCategories) ? row.failureCategories : []);
    const safe = reasons.filter((reason) => SAFE_MATRIX_FAILURES.has(reason));
    for (const reason of safe) safeReasons[reason] = (safeReasons[reason] ?? 0) + 1;
    if (typeof row?.caseId === 'string' && Number.isInteger(row?.run)) caseResults.push({ caseId: row.caseId, run: row.run, status: row.status === 'passed' ? 'passed' : 'failed', origin: ['local', 'provider', 'fallback'].includes(row.origin) ? row.origin : 'local', failureCategories: [...new Set(safe)].slice(0, 4) });
  }
  return { rows, executedCases, failedCaseIds, safeReasons, caseResults };
}

export function createProviderLiveReport({ mode, requestedCases = [], skippedCases = [], revision = 'unknown', head = null, dirty = false, reason = null, result = null, networkAttempts = 0, policyTimeoutMs = PROVIDER_LIVE_TIMEOUT_MS, usageSummary = null } = {}) {
  const summary = summarizeProviderMatrixResult(result);
  const executedRuns = summary.rows.length;
  const fallbackCount = summary.rows.filter((row) => row?.origin === 'fallback').length;
  const providerCalls = executedRuns;
  const acceptedProviderRows = summary.rows.filter((row) => row?.origin === 'provider').length;
  const liveBoundaryStatus = networkAttempts > 0 && acceptedProviderRows > 0 ? 'VERIFIED' : 'NOT VERIFIED';
  const resultPassed = Boolean(result && result.failed === 0 && executedRuns > 0 && liveBoundaryStatus === 'VERIFIED');
  const defaultReason = resultPassed ? null : (networkAttempts > 0 ? (summary.safeReasons['provider-response'] ? 'provider-response-failures' : 'provider-results-not-fully-accepted') : 'no-live-provider-calls');
  return {
    version: PROVIDER_TEST_VERSION,
    status: resultPassed ? 'passed' : (networkAttempts > 0 ? 'failed' : 'NOT VERIFIED'),
    reason: reason ?? defaultReason,
    head,
    dirty,
    runId: `t7-${revision}-${mode}`,
    revision,
    mode,
    caseVersion: 1,
    policyTimeoutMs,
    requestedCases,
    executedCases: summary.executedCases,
    skippedCases,
    failedCaseIds: summary.failedCaseIds,
    caseResults: summary.caseResults,
    executedRuns,
    plannedCalls: requestedCases.length * 2,
    initialCalls: executedRuns,
    providerCalls,
    networkAttempts,
    retryAttempts: Math.max(0, networkAttempts - executedRuns),
    repairCalls: 0,
    fallbackCount,
    tokenUsage: sanitizeProviderUsageSummary(usageSummary),
    safeReasons: summary.safeReasons,
    engineeringStatus: 'VERIFIED',
    liveBoundaryStatus,
    qualityReviewStatus: 'NOT VERIFIED',
    artifactPath: '.test-artifacts/provider-live-report.json',
  };
}
