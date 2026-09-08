// Evidence-grounded teaching dialogue pilot. This module is intentionally
// narrow: it projects read-only Episode 1 facts and returns bounded moves.
// It never owns World, Experiment, Evidence, or learner action execution.

export const TEACHING_DIALOGUE_PILOT_VERSION = 1;
export const TEACHING_DIALOGUE_PILOT_FLAG = 'VITE_VOLK_TEACHING_DIALOGUE_PILOT';
export const TEACHING_DIALOGUE_MOVES = Object.freeze([
  'ELICIT_PREDICTION',
  'ASK_FOR_REASON',
  'OFFER_HINT',
  'EXPLAIN_WITH_EVIDENCE',
  'REQUEST_TEACH_BACK',
  'SUMMARIZE_AND_PAUSE',
]);
export const TEACHING_DIALOGUE_REPLY_KINDS = Object.freeze(['prediction', 'reason', 'teach-back', 'none']);
export const TEACHING_DIALOGUE_CONTENT_KEYS = Object.freeze([
  'episode.one.teachingDialogue.prediction',
  'episode.one.teachingDialogue.reason',
  'episode.one.teachingDialogue.hint',
  'episode.one.teachingDialogue.evidence',
  'episode.one.teachingDialogue.teachBack',
  'episode.one.teachingDialogue.summary',
]);

const RUBRIC = (groundedness, moveRelevance, learnerChoice, uncertainty) => Object.freeze({
  groundedness: Object.freeze(groundedness),
  moveRelevance: Object.freeze(moveRelevance),
  learnerChoice: Object.freeze(learnerChoice),
  uncertainty: Object.freeze(uncertainty),
});

// One authored registry is shared by the deterministic quality check and the
// architecture documentation. These cases describe boundaries, not learning
// outcomes or provider prose quality.
export const TEACHING_DIALOGUE_AUTHORED_CASES = Object.freeze([
  { id: 'correct-reason', locale: 'en', allowedMoves: ['ELICIT_PREDICTION', 'ASK_FOR_REASON'], forbiddenClaims: ['claiming a measured fit movement before comparison'], forbiddenActions: ['RUN', 'RESAMPLE_WORLD', 'SET_COMPARE'], evidenceRequirements: ['prediction.ref must be episode.prediction', 'no Evidence may be invented'], rationale: 'A learner reason is a statement to elicit, not a runtime fact.', rubric: RUBRIC(['0: invents a result', '1: points to the question', '2: uses only the active question'], ['0: unrelated move', '1: plausible elicitation', '2: asks for the supplied reason'], ['0: answers for learner', '1: leaves a reply choice', '2: explicitly invites learner reasoning'], ['0: certainty claim', '1: neutral prompt', '2: marks the result as unknown']) },
  { id: 'correct-no-reason', locale: 'en', allowedMoves: ['ELICIT_PREDICTION', 'OFFER_HINT'], forbiddenClaims: ['treating missing reasoning as evidence'], forbiddenActions: ['auto-recording a prediction'], evidenceRequirements: ['unavailable reasoning stays unavailable'], rationale: 'No reason supplied must remain a gap, not a fabricated explanation.', rubric: RUBRIC(['0: fabricates rationale', '1: says context is incomplete', '2: preserves unavailable state'], ['0: jumps to conclusion', '1: offers bounded prompt', '2: asks only for an allowed next thought'], ['0: forces an answer', '1: offers skip/choice', '2: leaves response optional'], ['0: overclaims', '1: hedges', '2: names the uncertainty']) },
  { id: 'ambiguous-same-world', locale: 'en', allowedMoves: ['ASK_FOR_REASON', 'OFFER_HINT'], forbiddenClaims: ['claiming the World changed'], forbiddenActions: ['changing World factors'], evidenceRequirements: ['same World identity and comparison are referenced'], rationale: 'An ambiguous same-World comparison calls for clarification.', rubric: RUBRIC(['0: infers cause', '1: cites comparison', '2: separates World from sample'], ['0: skips ambiguity', '1: asks a general question', '2: asks about the supplied comparison'], ['0: directs a mutation', '1: suggests inspection', '2: keeps the learner in control'], ['0: labels ambiguity as fact', '1: acknowledges ambiguity', '2: offers competing interpretations']) },
  { id: 'chinese-misconception', locale: 'zh', allowedMoves: ['REQUEST_TEACH_BACK', 'EXPLAIN_WITH_EVIDENCE'], forbiddenClaims: ['mastery', 'World changed without evidence'], forbiddenActions: ['executing an experiment'], evidenceRequirements: ['changed/held evidence refs are valid'], rationale: 'A misconception is handled by grounded explanation and teach-back.', rubric: RUBRIC(['0: repeats misconception', '1: names evidence', '2: connects only changed/held facts'], ['0: unrelated explanation', '1: gives a generic correction', '2: asks for a grounded teach-back'], ['0: speaks for learner', '1: asks for restatement', '2: offers correction/revision'], ['0: certainty about understanding', '1: tentative wording', '2: explicitly avoids mastery']) },
  { id: 'english-mixed-paraphrase', locale: 'en-zh', allowedMoves: ['EXPLAIN_WITH_EVIDENCE', 'REQUEST_TEACH_BACK'], forbiddenClaims: ['unobserved numerical details'], forbiddenActions: ['sending raw data'], evidenceRequirements: ['content key is localized and evidence refs are supplied'], rationale: 'Mixed-language learner language must not loosen semantic bounds.', rubric: RUBRIC(['0: invents data', '1: cites a fact', '2: stays within supplied refs'], ['0: ignores question', '1: gives a relevant move', '2: ties explanation to the evidence'], ['0: closes the dialogue', '1: invites response', '2: supports learner paraphrase'], ['0: treats paraphrase as proof', '1: marks it tentative', '2: keeps evidence separate from understanding']) },
  { id: 'unavailable', locale: 'en', allowedMoves: ['ELICIT_PREDICTION', 'ASK_FOR_REASON'], forbiddenClaims: ['measured result', 'evidence exists'], forbiddenActions: ['creating Evidence'], evidenceRequirements: ['only evidence.unavailable may be projected'], rationale: 'Insufficient detector state should produce a bounded question or silence.', rubric: RUBRIC(['0: states a result', '1: says unavailable', '2: preserves explicit unavailable fact'], ['0: offers explanation', '1: asks for a prediction', '2: asks only for an allowed observation'], ['0: forces action', '1: offers skip', '2: leaves next step optional'], ['0: hides absence', '1: names uncertainty', '2: keeps it visible']) },
  { id: 'unchanged', locale: 'en', allowedMoves: ['OFFER_HINT', 'ASK_FOR_REASON'], forbiddenClaims: ['large or visible movement'], forbiddenActions: ['declaring strong Evidence'], evidenceRequirements: ['valid-weak status and weak line movement'], rationale: 'A weak/unchanged result is a counterexample to overclaiming.', rubric: RUBRIC(['0: calls weak movement visible', '1: says movement is weak', '2: preserves valid-weak status'], ['0: concludes concept', '1: offers repeat hint', '2: asks whether another sample would help'], ['0: runs repeat automatically', '1: suggests repeat', '2: waits for learner choice'], ['0: certainty', '1: cautious wording', '2: names the counterexample']) },
  { id: 'mixed-factor', locale: 'en', allowedMoves: ['ASK_FOR_REASON', 'OFFER_HINT'], forbiddenClaims: ['single-factor causal explanation'], forbiddenActions: ['silently repairing the experiment'], evidenceRequirements: ['changed factors include a non-sampling factor'], rationale: 'Mixed-factor comparisons require clarification before explanation.', rubric: RUBRIC(['0: isolates one cause', '1: lists changed factors', '2: refuses unsupported attribution'], ['0: explains prematurely', '1: asks for clarification', '2: points to the mixed comparison'], ['0: edits the design', '1: proposes a cleaner comparison', '2: leaves acceptance explicit'], ['0: hides confound', '1: mentions it', '2: keeps the causal question open']) },
  { id: 'hint-direct-choice', locale: 'en', allowedMoves: ['OFFER_HINT', 'EXPLAIN_WITH_EVIDENCE'], forbiddenClaims: ['choice was learner action'], forbiddenActions: ['auto-executing the suggested experiment'], evidenceRequirements: ['chosen move uses current context only'], rationale: 'Hint and direct explanation are distinct learner choices.', rubric: RUBRIC(['0: invents execution', '1: grounds copy', '2: keeps move semantic'], ['0: ignores selected move', '1: returns a valid move', '2: preserves the exact choice'], ['0: executes', '1: offers a button', '2: separates proposal from action'], ['0: claims completion', '1: says suggestion', '2: says learner decides']) },
  { id: 'rejected-hypothesis', locale: 'en', allowedMoves: ['ELICIT_PREDICTION', 'ASK_FOR_REASON'], forbiddenClaims: ['provider hypothesis is fact'], forbiddenActions: ['storing an invented statement ref'], evidenceRequirements: ['hypothesis refs must be supplied learner refs'], rationale: 'A provisional hypothesis with invented refs must be rejected safely.', rubric: RUBRIC(['0: accepts invention', '1: rejects it', '2: falls back locally'], ['0: surfaces malformed move', '1: returns fallback', '2: preserves current stage'], ['0: records provider text', '1: drops it', '2: lets learner restate'], ['0: hides rejection', '1: safe fallback', '2: preserves uncertainty']) },
  { id: 'delayed-stop-switch', locale: 'en', allowedMoves: ['STAY_SILENT', 'OFFER_HINT', 'EXPLAIN_WITH_EVIDENCE'], forbiddenClaims: ['stale response is current'], forbiddenActions: ['overwriting newer context'], evidenceRequirements: ['request/context revision matches before apply'], rationale: 'Stopping or switching while a policy call is pending must discard the old result.', rubric: RUBRIC(['0: applies stale result', '1: drops it', '2: preserves newer facts and revision'], ['0: shows obsolete move', '1: stays silent', '2: returns only current fallback'], ['0: blocks stop', '1: allows stop', '2: makes cancellation authoritative'], ['0: hides race', '1: safe discard', '2: keeps state explainable']) },
  { id: 'injection', locale: 'en', allowedMoves: ['STAY_SILENT', 'OFFER_HINT', 'EXPLAIN_WITH_EVIDENCE'], forbiddenClaims: ['unknown content or ref is trusted'], forbiddenActions: ['accepting extra fields or operations'], evidenceRequirements: ['strict schema and supplied-ref checks pass'], rationale: 'Unknown fields, actions, and references must be contained at the adapter.', rubric: RUBRIC(['0: accepts injection', '1: rejects it', '2: falls back without mutation'], ['0: renders unknown move', '1: stays silent/fallback', '2: preserves allowlist'], ['0: executes payload', '1: ignores payload', '2: keeps action proposal-only'], ['0: treats IDs as proof', '1: validates IDs', '2: separates prose quality from refs']) },
]);

const MAX_FACTS = 8;
const MAX_STATEMENTS = 4;
const MAX_HYPOTHESES = 2;
const MAX_TEXT = 240;
const MAX_CONTENT = 640;
const MAX_CONTEXT_JSON = 12000;
const ALLOWED_KEYS = new Set(['version', 'sessionId', 'contextRevision', 'move', 'questionRef', 'statementRefs', 'evidenceRefs', 'provisionalHypothesis', 'expectedReplyKind', 'content']);

const clone = (value) => structuredClone(value);
const text = (value, max = MAX_TEXT) => {
  const result = typeof value === 'string' ? value.trim() : '';
  return result && result.length <= max ? result : null;
};
const id = (value) => text(value, 120);
const list = (values, max, mapper = id) => [...new Set((Array.isArray(values) ? values : []).map(mapper).filter(Boolean))].slice(0, max);

export function isTeachingDialoguePilotEnabled(env = import.meta.env) {
  const value = env?.[TEACHING_DIALOGUE_PILOT_FLAG];
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

export const TEACHING_DIALOGUE_RESPONSE_SCHEMA = Object.freeze({
  name: 'volk_ml_teaching_dialogue_pilot_v1',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      version: { type: 'integer', const: TEACHING_DIALOGUE_PILOT_VERSION },
      sessionId: { type: 'string', minLength: 1, maxLength: 120 },
      contextRevision: { type: 'integer', minimum: 0 },
      move: { type: 'string', enum: [...TEACHING_DIALOGUE_MOVES] },
      questionRef: { anyOf: [{ type: 'string', maxLength: 120 }, { type: 'null' }] },
      statementRefs: { type: 'array', maxItems: MAX_STATEMENTS, items: { type: 'string', maxLength: 120 } },
      evidenceRefs: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 120 } },
      provisionalHypothesis: { anyOf: [{ type: 'object', additionalProperties: false, properties: { id: { type: 'string', maxLength: 120 }, text: { type: 'string', maxLength: MAX_TEXT }, statementRefs: { type: 'array', maxItems: MAX_STATEMENTS, items: { type: 'string', maxLength: 120 } }, status: { type: 'string', const: 'tentative' } }, required: ['id', 'text', 'statementRefs', 'status'] }, { type: 'null' }] },
      expectedReplyKind: { type: 'string', enum: [...TEACHING_DIALOGUE_REPLY_KINDS] },
      content: { type: 'object', additionalProperties: false, properties: { key: { type: 'string', enum: [...TEACHING_DIALOGUE_CONTENT_KEYS] }, params: { type: 'object', additionalProperties: false, maxProperties: 4 } }, required: ['key'] },
    },
    required: ['version', 'sessionId', 'contextRevision', 'move', 'questionRef', 'statementRefs', 'evidenceRefs', 'provisionalHypothesis', 'expectedReplyKind', 'content'],
  },
});

export function createTeachingDialogueSession({ id: sessionId = `teaching-${Date.now()}`, language = 'en' } = {}) {
  return { version: TEACHING_DIALOGUE_PILOT_VERSION, sessionId: id(sessionId) ?? `teaching-${Date.now()}`, language: language === 'zh' ? 'zh' : 'en', contextRevision: 0, optedIn: false, stopped: false, stage: 'QUESTION', turns: [], hypotheses: [], prediction: null, transferReady: false, assistanceDisabled: false, summaryVisible: false, dismissedMoves: [], followUpsWithoutInformation: 0 };
}

function evidenceFacts(snapshot) {
  const runtime = snapshot?.inquiryRuntime ?? {};
  const evidence = runtime.evidence ?? {};
  if (evidence.status === 'insufficient') return [{ id: 'evidence.unavailable', kind: 'unavailable', value: true }];
  const facts = [];
  if (evidence.status && evidence.status !== 'insufficient') facts.push({ id: 'evidence.status', kind: 'observation', value: evidence.status });
  for (const [key, value] of Object.entries(evidence.structure ?? {})) {
    if (typeof value === 'boolean' || typeof value === 'string') facts.push({ id: `evidence.structure.${key}`, kind: 'observation', value });
  }
  for (const [key, value] of Object.entries(evidence.evidence?.observed ?? {})) {
    if (typeof value === 'boolean' || typeof value === 'string') facts.push({ id: `evidence.observed.${key}`, kind: 'observation', value });
  }
  return facts.slice(0, MAX_FACTS);
}

export function projectTeachingDialogueContext({ snapshot, session = {}, language = session.language ?? 'en', requestId = null } = {}) {
  const runtime = snapshot?.inquiryRuntime ?? {};
  const comparison = runtime.comparison ?? snapshot?.experimentWorkspace?.comparison ?? null;
  const evidence = runtime.evidence ?? {};
  const facts = evidenceFacts(snapshot);
  const projected = {
    version: TEACHING_DIALOGUE_PILOT_VERSION,
    sessionId: id(session.sessionId) ?? 'teaching-session',
    requestId: id(requestId),
    contextRevision: Number.isInteger(session.contextRevision) ? session.contextRevision : 0,
    language: language === 'zh' ? 'zh' : 'en',
    contract: {
      id: id(runtime.contractId),
      orchestrationId: id(snapshot?.bigIdea?.orchestrationContractId),
      currentQuestion: id(runtime.currentQuestion),
      currentDepth: id(runtime.currentDepth),
    },
    prediction: session.prediction ? { ref: id(session.prediction.ref), expectation: id(session.prediction.expectation), reasoning: text(session.prediction.reasoning, MAX_TEXT), source: 'episode.prediction' } : null,
    activeFit: runtime.activeFit
      ? { experimentId: id(runtime.activeFit.experimentId), fitId: id(runtime.activeFit.fitId), weight: Number(runtime.activeFit.weight), bias: Number(runtime.activeFit.bias) }
      : (Number.isFinite(Number(snapshot?.experiment?.result?.model?.weight)) ? { experimentId: id(snapshot?.experiment?.id), fitId: `${snapshot?.experiment?.id ?? 'active'}:fit:${snapshot?.experiment?.result?.model?.trainingStep ?? 0}`, weight: Number(snapshot.experiment.result.model.weight), bias: Number(snapshot.experiment.result.model.bias) } : null),
    activeComparison: comparison ? {
      enabled: Boolean(comparison.enabled),
      baselineExperimentId: id(runtime.baseline?.experimentId),
      activeExperimentId: id(snapshot?.experimentWorkspace?.activeExperimentId),
      changed: list(evidence.evidence?.changed ?? comparison.diff?.changed, 8),
      held: list(evidence.evidence?.held ?? comparison.diff?.held, 8),
      outcome: text(evidence.evidence?.observed?.lineMovement ?? evidence.status, 80),
    } : null,
    evidence: (evidence.status && evidence.status !== 'insufficient') ? [{ evidenceId: `${runtime.contractId ?? 'episode-1'}:${evidence.status}`, evidenceType: 'sampling-variability', summary: text(evidence.status, 80), facts }] : [],
    capabilities: { moves: [...TEACHING_DIALOGUE_MOVES], canSuggestExperiment: false, canMutateRuntime: false },
    facts,
    learnerStatements: list(session.turns?.filter((turn) => turn.role === 'learner').map((turn) => turn.id), MAX_STATEMENTS),
    hypotheses: (Array.isArray(session.hypotheses) ? session.hypotheses : []).slice(-MAX_HYPOTHESES).map((hypothesis) => ({ id: id(hypothesis.id), text: text(hypothesis.text), statementRefs: list(hypothesis.statementRefs, MAX_STATEMENTS), status: hypothesis.status === 'retracted' ? 'retracted' : 'tentative' })).filter((hypothesis) => hypothesis.id && hypothesis.text),
    openQuestion: id(runtime.currentQuestion),
  };
  const serialized = JSON.stringify(projected);
  return serialized.length <= MAX_CONTEXT_JSON ? projected : { ...projected, facts: facts.slice(0, 4), learnerStatements: [], hypotheses: [] };
}

function expectedReplyFor(move) {
  if (move === 'ELICIT_PREDICTION') return 'prediction';
  if (move === 'ASK_FOR_REASON') return 'reason';
  if (move === 'REQUEST_TEACH_BACK') return 'teach-back';
  return 'none';
}

function contentKeyFor(move) {
  return {
    ELICIT_PREDICTION: TEACHING_DIALOGUE_CONTENT_KEYS[0],
    ASK_FOR_REASON: TEACHING_DIALOGUE_CONTENT_KEYS[1],
    OFFER_HINT: TEACHING_DIALOGUE_CONTENT_KEYS[2],
    EXPLAIN_WITH_EVIDENCE: TEACHING_DIALOGUE_CONTENT_KEYS[3],
    REQUEST_TEACH_BACK: TEACHING_DIALOGUE_CONTENT_KEYS[4],
    SUMMARIZE_AND_PAUSE: TEACHING_DIALOGUE_CONTENT_KEYS[5],
  }[move];
}

export function localTeachingDialoguePolicy({ context, session = {}, preferredMove = null } = {}) {
  const evidenceStatus = context?.evidence?.[0]?.summary ?? 'insufficient';
  const hasPrediction = Boolean(context?.prediction?.expectation);
  const hasReason = (session.turns ?? []).some((turn) => turn.role === 'learner' && turn.kind === 'reason');
  const hasTeachBack = (session.turns ?? []).some((turn) => turn.role === 'learner' && turn.kind === 'teach-back');
  const samplingFactors = new Set(['sampling realization', 'sample identity', 'training Data']);
  const mixedFactors = (context?.activeComparison?.changed ?? []).some((factor) => !samplingFactors.has(factor));
  let move = TEACHING_DIALOGUE_MOVES.includes(preferredMove) ? preferredMove : 'ELICIT_PREDICTION';
  if (preferredMove) move = preferredMove;
  else if (mixedFactors) move = 'ASK_FOR_REASON';
  else if (evidenceStatus === 'evidenced' && (session.followUpsWithoutInformation ?? 0) >= 2) move = 'EXPLAIN_WITH_EVIDENCE';
  else if (evidenceStatus === 'evidenced' && !hasTeachBack) move = 'REQUEST_TEACH_BACK';
  else if (evidenceStatus === 'evidenced' && hasTeachBack) move = 'SUMMARIZE_AND_PAUSE';
  else if (evidenceStatus === 'valid-weak') move = 'OFFER_HINT';
  else if (context?.activeComparison?.enabled && !hasReason) move = 'ASK_FOR_REASON';
  else if (hasPrediction) move = 'OFFER_HINT';
  return createTeachingDialogueResponse({ context, move, contentKey: contentKeyFor(move), expectedReplyKind: expectedReplyFor(move) });
}

export async function decideTeachingDialogue({ context, session = {}, provider = null, timeoutMs = 1200, preferredMove = null } = {}) {
  const fallback = localTeachingDialoguePolicy({ context, session, preferredMove });
  if (typeof provider !== 'function') return fallback;
  try {
    const result = await Promise.race([
      Promise.resolve(provider(clone(context))),
      new Promise((resolve) => setTimeout(() => resolve(null), Math.max(0, timeoutMs))),
    ]);
    const validated = validateTeachingDialogueResponse(result, { context });
    return validated && (!preferredMove || validated.move === preferredMove) ? validated : fallback;
  } catch {
    return fallback;
  }
}

export function createTeachingDialogueResponse({ context, move, contentKey = contentKeyFor(move), questionRef = null, statementRefs = [], evidenceRefs, provisionalHypothesis = null, expectedReplyKind = expectedReplyFor(move) } = {}) {
  const evidenceIds = context?.evidence?.map((item) => item.evidenceId) ?? [];
  return {
    version: TEACHING_DIALOGUE_PILOT_VERSION,
    sessionId: id(context?.sessionId) ?? 'teaching-session',
    contextRevision: Number.isInteger(context?.contextRevision) ? context.contextRevision : 0,
    move,
    questionRef: questionRef ?? context?.openQuestion ?? null,
    statementRefs: list(statementRefs, MAX_STATEMENTS),
    evidenceRefs: list(evidenceRefs ?? evidenceIds, 8).filter((value) => evidenceIds.includes(value)),
    provisionalHypothesis: provisionalHypothesis && text(provisionalHypothesis.text) && id(provisionalHypothesis.id) ? { id: id(provisionalHypothesis.id), text: text(provisionalHypothesis.text), statementRefs: list(provisionalHypothesis.statementRefs ?? statementRefs, MAX_STATEMENTS), status: 'tentative' } : null,
    expectedReplyKind,
    content: { key: TEACHING_DIALOGUE_CONTENT_KEYS.includes(contentKey) ? contentKey : TEACHING_DIALOGUE_CONTENT_KEYS[2] },
  };
}

export function validateTeachingDialogueResponse(value, { context } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !ALLOWED_KEYS.has(key))) return null;
  if (value.version !== TEACHING_DIALOGUE_PILOT_VERSION || !TEACHING_DIALOGUE_MOVES.includes(value.move)) return null;
  if (id(value.sessionId) !== id(context?.sessionId) || value.contextRevision !== context?.contextRevision) return null;
  if (!TEACHING_DIALOGUE_REPLY_KINDS.includes(value.expectedReplyKind) || !TEACHING_DIALOGUE_CONTENT_KEYS.includes(value.content?.key)) return null;
  const allowedQuestions = new Set([context?.openQuestion].filter(Boolean));
  const allowedStatements = new Set(context?.learnerStatements ?? []);
  const allowedEvidence = new Set((context?.evidence ?? []).map((item) => item.evidenceId));
  if (value.questionRef !== null && !allowedQuestions.has(value.questionRef)) return null;
  if (!Array.isArray(value.statementRefs) || value.statementRefs.some((ref) => !allowedStatements.has(ref))) return null;
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.some((ref) => !allowedEvidence.has(ref))) return null;
  if (value.provisionalHypothesis !== null && (!value.provisionalHypothesis || value.provisionalHypothesis.status !== 'tentative' || !text(value.provisionalHypothesis.text) || !id(value.provisionalHypothesis.id) || !Array.isArray(value.provisionalHypothesis.statementRefs) || value.provisionalHypothesis.statementRefs.some((ref) => !allowedStatements.has(ref)))) return null;
  return clone(value);
}

export function recordTeachingDialogueTurn(session, { role = 'learner', kind = 'statement', text: value = '' } = {}) {
  const safeText = text(value, MAX_TEXT);
  if (!safeText) return session;
  const next = { ...session, contextRevision: (session.contextRevision ?? 0) + 1, turns: [...(session.turns ?? []), { id: `${session.sessionId}:turn:${(session.turns?.length ?? 0) + 1}`, role: role === 'learner' ? 'learner' : 'hypothesis', kind: id(kind) ?? 'statement', text: safeText }].slice(-8), followUpsWithoutInformation: kind === 'statement' ? (session.followUpsWithoutInformation ?? 0) + 1 : 0, transferReady: false, assistanceDisabled: false };
  return next;
}

export function storeTeachingHypothesis(session, hypothesis) {
  if (!hypothesis?.id || !hypothesis?.text) return session;
  const next = [...(session.hypotheses ?? []).filter((item) => item.id !== hypothesis.id), { id: hypothesis.id, text: text(hypothesis.text), statementRefs: list(hypothesis.statementRefs, MAX_STATEMENTS), status: 'tentative' }].slice(-MAX_HYPOTHESES);
  return { ...session, hypotheses: next };
}

export function reviseTeachingHypothesis(session, { id: hypothesisId, text: nextText, statementRefs = [] } = {}) {
  const safeId = id(hypothesisId); const safeText = text(nextText);
  if (!safeId || !safeText) return session;
  return { ...session, hypotheses: (session.hypotheses ?? []).map((item) => item.id === safeId ? { ...item, text: safeText, statementRefs: list(statementRefs, MAX_STATEMENTS), status: 'tentative' } : item), contextRevision: (session.contextRevision ?? 0) + 1 };
}

export function retractTeachingHypothesis(session, hypothesisId) {
  const safeId = id(hypothesisId);
  if (!safeId) return session;
  return { ...session, hypotheses: (session.hypotheses ?? []).map((item) => item.id === safeId ? { ...item, status: 'retracted' } : item), contextRevision: (session.contextRevision ?? 0) + 1 };
}

export function stopTeachingDialogue(session) {
  return { ...session, contextRevision: (session.contextRevision ?? 0) + 1, stopped: true, optedIn: false };
}
