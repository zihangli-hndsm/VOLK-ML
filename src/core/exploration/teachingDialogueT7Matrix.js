import {
  TEACHING_DIALOGUE_AUTHORED_CASES,
  TEACHING_DIALOGUE_FAILURE_REASONS,
  createTeachingDialogueSession,
  decideTeachingDialogue,
  validateTeachingDialogueResponse,
} from './teachingDialoguePilot.js';

export const TEACHING_DIALOGUE_T7_MATRIX_VERSION = 1;
export const TEACHING_DIALOGUE_T7_MATRIX_RUNS = 2;
export const TEACHING_DIALOGUE_T7_MAX_CASES = 12;

const BASE_CONTEXT = Object.freeze({
  version: 1,
  sessionId: 't7-matrix-session',
  contextRevision: 0,
  contractId: 'episode-1-sampling-variability',
  language: 'en',
  currentQuestion: 'episode.one.question',
  currentDepth: 'PHENOMENON',
  openQuestion: 'episode.one.question',
  prediction: null,
  facts: Object.freeze([
    Object.freeze({ id: 'evidence.status', kind: 'observation', value: 'evidenced' }),
    Object.freeze({ id: 'evidence.structure.worldHeldConstant', kind: 'observation', value: true }),
    Object.freeze({ id: 'evidence.observed.lineMovement', kind: 'observation', value: 'visible' }),
  ]),
  evidence: Object.freeze([Object.freeze({ evidenceId: 't7-evidence-1', summary: 'evidenced' })]),
  activeComparison: Object.freeze({
    enabled: true,
    changed: Object.freeze(['sampling realization', 'sample identity', 'training Data']),
    held: Object.freeze(['World identity', 'model family']),
    outcome: 'visible',
  }),
  learnerStatements: Object.freeze([]),
  hypotheses: Object.freeze([]),
});

const clone = (value) => structuredClone(value);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function boundedText(value, max = 120) {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
}

function safeRevision(value) {
  const revision = boundedText(value, 80);
  if (!revision) throw new Error('T7_MATRIX_REVISION_REQUIRED');
  return revision;
}

function contextForCase(item, revision, runNumber) {
  const base = {
    ...clone(BASE_CONTEXT),
    sessionId: `t7-${revision}-${item.id}-${runNumber}`,
    contextRevision: 0,
  };
  if (item.id === 'unavailable') {
    base.evidence = [];
    base.activeComparison = null;
    base.facts = [{ id: 'evidence.unavailable', kind: 'unavailable', value: true }];
  } else if (item.id === 'mixed-factor') {
    base.evidence = [{ evidenceId: 't7-evidence-1', summary: 'valid-weak' }];
    base.activeComparison = { ...base.activeComparison, changed: ['sampling realization', 'train-sample-count'], outcome: 'weak' };
  } else if (item.id === 'unchanged') {
    base.evidence = [{ evidenceId: 't7-evidence-1', summary: 'valid-weak' }];
    base.activeComparison = { ...base.activeComparison, outcome: 'unchanged' };
    base.facts = [...base.facts, { id: 'evidence.observed.lineMovement', kind: 'observation', value: 'unchanged' }];
  } else if (item.id === 'ambiguous-same-world') {
    base.activeComparison = { ...base.activeComparison, changed: ['sampling realization', 'noise'], outcome: 'visible' };
  } else {
    base.prediction = item.id === 'correct-reason'
      ? { ref: 'episode:prediction', expectation: 'different', reasoning: 'same process' }
      : null;
    if (['correct-reason', 'correct-no-reason', 'rejected-hypothesis', 'delayed-stop-switch', 'injection'].includes(item.id)) {
      base.evidence = [{ evidenceId: 't7-evidence-1', summary: 'insufficient' }];
      base.facts = [{ id: 'evidence.unavailable', kind: 'unavailable', value: true }];
      if (item.id !== 'correct-reason') base.activeComparison = null;
    } else if (item.id === 'hint-direct-choice') {
      base.evidence = [{ evidenceId: 't7-evidence-1', summary: 'valid-weak' }];
      base.activeComparison = { ...base.activeComparison, outcome: 'weak' };
    }
  }
  return deepFreeze(base);
}

function sessionForCase(item, revision, runNumber) {
  const session = createTeachingDialogueSession({ id: `t7-${revision}-${item.id}-${runNumber}`, language: item.locale === 'zh' ? 'zh' : 'en' });
  return {
    ...session,
    language: item.locale,
    followUpsWithoutInformation: item.id === 'english-mixed-paraphrase' ? 2 : 0,
  };
}

function rowFor({ item, runNumber, context, result }) {
  const responseValid = validateTeachingDialogueResponse(result, { context }) !== null;
  const selectedMoveAllowed = item.allowedMoves.includes(result?.move);
  const noInventedHypothesis = result?.provisionalHypothesis === null;
  const failureReasons = [];
  if (!selectedMoveAllowed) failureReasons.push('move-not-allowed');
  if (!responseValid) failureReasons.push('response-invalid-or-ungrounded');
  if (!noInventedHypothesis) failureReasons.push('invented-hypothesis');
  const safeFailure = TEACHING_DIALOGUE_FAILURE_REASONS.includes(result?.fallbackReason) ? result.fallbackReason : null;
  if (safeFailure) failureReasons.push(safeFailure);
  return {
    caseId: item.id,
    run: runNumber,
    origin: result?.origin === 'provider' || result?.origin === 'fallback' ? result.origin : 'local',
    move: typeof result?.move === 'string' ? result.move : 'STAY_SILENT',
    contentKey: typeof result?.content?.key === 'string' ? result.content.key : null,
    grounding: ['none', 'conceptual', 'evidence'].includes(result?.grounding) ? result.grounding : 'none',
    refs: {
      statementRefs: Array.isArray(result?.statementRefs) ? result.statementRefs.filter((ref) => context.learnerStatements.some((statement) => statement.id === ref)).slice(0, 4) : [],
      evidenceRefs: Array.isArray(result?.evidenceRefs) ? result.evidenceRefs.filter((ref) => context.evidence.some((evidence) => evidence.evidenceId === ref)).slice(0, 8) : [],
    },
    rubric: { selectedMoveAllowed, responseValid, noInventedHypothesis },
    scores: { selectedMoveAllowed: selectedMoveAllowed ? 2 : 0, responseValid: responseValid ? 2 : 0, noInventedHypothesis: noInventedHypothesis ? 2 : 0 },
    failureReasons: [...new Set(failureReasons)].slice(0, 4),
    status: failureReasons.length === 0 ? 'passed' : 'failed',
  };
}

export async function runTeachingDialogueT7Matrix({ provider = null, revision, runs = TEACHING_DIALOGUE_T7_MATRIX_RUNS, cases = TEACHING_DIALOGUE_AUTHORED_CASES, timeoutMs } = {}) {
  const selectedRevision = safeRevision(revision);
  const runCount = Math.max(1, Math.min(TEACHING_DIALOGUE_T7_MATRIX_RUNS, Number.isInteger(runs) ? runs : TEACHING_DIALOGUE_T7_MATRIX_RUNS));
  const selectedCases = Array.isArray(cases) ? cases.slice(0, TEACHING_DIALOGUE_T7_MAX_CASES) : [];
  const rows = [];
  for (const item of selectedCases) {
    if (!item?.id || !Array.isArray(item.allowedMoves)) continue;
    for (let runNumber = 1; runNumber <= runCount; runNumber += 1) {
      const context = contextForCase(item, selectedRevision, runNumber);
      const session = sessionForCase(item, selectedRevision, runNumber);
      const result = await decideTeachingDialogue({ context, session, provider, timeoutMs });
      rows.push(rowFor({ item, runNumber, context, result }));
    }
  }
  const passed = rows.filter((row) => row.status === 'passed').length;
  return Object.freeze({
    version: TEACHING_DIALOGUE_T7_MATRIX_VERSION,
    revision: selectedRevision,
    caseCount: selectedCases.length,
    runCount,
    rowCount: rows.length,
    passed,
    failed: rows.length - passed,
    rows: Object.freeze(rows),
  });
}

export function createTeachingDialogueT7BrowserDriver({ provider } = {}) {
  return Object.freeze({
    version: TEACHING_DIALOGUE_T7_MATRIX_VERSION,
    caseIds: Object.freeze(TEACHING_DIALOGUE_AUTHORED_CASES.slice(0, TEACHING_DIALOGUE_T7_MAX_CASES).map((item) => item.id)),
    run: (options = {}) => runTeachingDialogueT7Matrix({ ...options, provider }),
  });
}

export { contextForCase as createTeachingDialogueT7Context };
