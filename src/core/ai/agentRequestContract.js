/**
 * Shared semantic boundary for the three learner-facing Agent request modes.
 *
 * This module deliberately contains no provider, React, DOM, or runtime
 * dependencies.  It is safe to use from local interpreters, Cloud adapters,
 * and deterministic tests alike.
 */

export const AGENT_REQUEST_CONTRACT_VERSION = 1;
export const AGENT_LOGICAL_TIMEOUT_MS = 15_000;

export const AGENT_TASK_MODES = Object.freeze({
  ASK: 'ask',
  EXPERIMENT_DESIGN: 'experiment-design',
  WORLD_EDIT: 'world-edit',
});

export const AGENT_TASK_MODE_VALUES = Object.freeze(Object.values(AGENT_TASK_MODES));

export const AGENT_OUTPUT_SETS = Object.freeze({
  [AGENT_TASK_MODES.ASK]: 'answer-with-optional-suggestion',
  [AGENT_TASK_MODES.EXPERIMENT_DESIGN]: 'exploration-guidance',
  [AGENT_TASK_MODES.WORLD_EDIT]: 'world-recipe-or-patch',
});

// This is the shared JSON-only contract description used in provider prompts.
// The executable validators and response schemas remain the final authority,
// but keeping the bounded fields, null/empty policy, enums and cross-field
// rules here prevents protocol-specific prompt drift.
export const AGENT_TASK_CONTRACTS = Object.freeze({
  [AGENT_TASK_MODES.ASK]: Object.freeze({
    version: AGENT_REQUEST_CONTRACT_VERSION,
    mode: AGENT_TASK_MODES.ASK,
    required: ['answer'],
    optionalNullable: ['tryExperiment', 'depth'],
    bounds: { answer: 'string 1..1200', suggestionQuestion: 'string 1..240', suggestionMessage: 'string 1..240' },
    enums: { depth: ['phenomenon', 'tune', 'evidence', 'mechanism', 'representation'], suggestionGoal: ['class-separation', 'train-test-support-shift', 'observation-noise', 'outlier-sensitivity', 'more-same-distribution-data'] },
    emptyPolicy: 'omit optional fields or send null; empty strings are invalid',
    extraFieldPolicy: 'additional properties are forbidden at every object level',
    crossFieldRules: ['tryExperiment must be null/string or {question, design}; design.goal is required when design is present', 'suggestions are non-executable and never contain runtime operations'],
  }),
  [AGENT_TASK_MODES.EXPERIMENT_DESIGN]: Object.freeze({
    version: AGENT_REQUEST_CONTRACT_VERSION,
    mode: AGENT_TASK_MODES.EXPERIMENT_DESIGN,
    required: ['kind', 'topic', 'explanation', 'depth', 'intent', 'requestedChange', 'requestedHolds', 'design', 'experimentDesign', 'reason', 'ambiguity'],
    optionalNullable: ['topic', 'explanation', 'depth', 'intent', 'requestedChange', 'design', 'experimentDesign', 'reason', 'ambiguity'],
    enums: { kind: ['explanation', 'navigation', 'experiment', 'clarification'], topic: ['slope', 'bias', 'training-step', 'test-error', 'comparison', 'model-capacity', 'learning-rate'] },
    bounds: { explanation: 'string 1..600', requestedChange: 'string 1..240', reason: 'string 1..240', ambiguity: 'string 1..240', requestedHolds: 'canonical IDs, max 12' },
    emptyPolicy: 'all nullable fields use null; non-null strings must be non-empty',
    extraFieldPolicy: 'additional properties are forbidden',
    crossFieldRules: ['explanation requires a supported topic and explanation text', 'navigation requires an available depth', 'experiment requires a supported intent or validated experimentDesign', 'clarification requires a concrete reason', 'only experiment may carry an executable-design proposal, and it remains learner-confirmed'],
  }),
  [AGENT_TASK_MODES.WORLD_EDIT]: Object.freeze({
    version: AGENT_REQUEST_CONTRACT_VERSION,
    mode: AGENT_TASK_MODES.WORLD_EDIT,
    required: ['kind', 'topic', 'explanation', 'depth', 'intent', 'requestedChange', 'requestedHolds', 'design', 'experimentDesign', 'reason', 'ambiguity'],
    resultKinds: ['world-design', 'clarification'],
    designModes: ['create', 'edit'],
    bounds: { clarificationReason: 'string 1..240', recipe: 'WorldRecipe v1 bounded by WORLD_RECIPE_LIMITS', patch: 'WorldRecipePatch v1, max 32 changes' },
    nullPolicy: ['create requires recipe and null patch', 'edit requires current-context patch and null recipe', 'clarification requires reason and has no proposal'],
    emptyPolicy: 'non-null strings must be non-empty; omitted optional values normalize to null',
    extraFieldPolicy: 'additional properties are forbidden; runtime operations, points, observations, metrics and code are forbidden',
    crossFieldRules: ['edit patch version must equal the current World recipe version', 'edit requires current recipe and edit capability', 'create requires World-design capability', 'unsupported, ambiguous, stale or unauthorized requests become clarification'],
  }),
});

const OUTPUT_SET_VALUES = new Set(Object.values(AGENT_OUTPUT_SETS));
const MAX_ID = 96;
const MAX_TEXT = 320;
const MAX_CONTEXT_KEYS = 32;

const asText = (value, max = MAX_TEXT) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= max ? text : null;
};

const asId = (value) => asText(value, MAX_ID);

function boundedArray(values, max = 12) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => asText(value, MAX_ID))
    .filter(Boolean))].slice(0, max);
}

function projectTaskInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const allowed = ['question', 'expectation', 'reasoning', 'goal', 'requestedChange', 'mode', 'recipeVersion', 'patchVersion'];
  const next = {};
  for (const key of allowed) {
    const value = input[key];
    if (typeof value === 'string') {
      const text = asText(value, key === 'question' ? 240 : 160);
      if (text) next[key] = text;
    } else if (Number.isFinite(value) && /Version$/.test(key)) next[key] = Number(value);
  }
  return Object.keys(next).length ? next : null;
}

/**
 * Project only semantic, bounded fields. Unknown keys are intentionally not
 * copied: a task request must never become an opaque application-state dump.
 */
export function projectAgentSemanticContext(context = {}, { taskMode = null } = {}) {
  const source = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
  const runtime = source.inquiryRuntime ?? source;
  const comparison = runtime.comparison ?? source.comparison ?? source.experimentWorkspace?.comparison ?? null;
  const evidence = runtime.evidence ?? source.evidence ?? null;
  const world = source.world ?? runtime.world ?? null;
  const experiment = source.experiment ?? runtime.experiment ?? null;
  const projected = {
    ...(asText(taskMode, 48) ? { taskMode: asText(taskMode, 48) } : {}),
    ...(asId(runtime.currentInquiry ?? source.currentInquiry) ? { inquiryId: asId(runtime.currentInquiry ?? source.currentInquiry) } : {}),
    ...(asId(runtime.contractId ?? source.contractId) ? { orchestrationId: asId(runtime.contractId ?? source.contractId) } : {}),
    ...(asText(runtime.currentQuestion ?? source.currentQuestion, 240) ? { currentQuestion: asText(runtime.currentQuestion ?? source.currentQuestion, 240) } : {}),
    ...(asText(runtime.currentDepth ?? source.currentDepth, 48) ? { currentDepth: asText(runtime.currentDepth ?? source.currentDepth, 48) } : {}),
    ...(runtime.prediction && typeof runtime.prediction === 'object' ? {
      prediction: {
        ...(asText(runtime.prediction.expectation, 80) ? { expectation: asText(runtime.prediction.expectation, 80) } : {}),
        ...(asText(runtime.prediction.reasoning, 240) ? { reasoning: asText(runtime.prediction.reasoning, 240) } : {}),
        ...(runtime.prediction.skipped ? { skipped: true } : {}),
      },
    } : {}),
    ...(world && typeof world === 'object' ? {
      world: {
        ...(asId(world.id ?? world.identity ?? source.worldIdentity?.fingerprint) ? { identity: asId(world.id ?? world.identity ?? source.worldIdentity?.fingerprint) } : {}),
        ...(asText(world.task, 40) ? { task: asText(world.task, 40) } : {}),
        ...(Number.isFinite(world.recipeVersion ?? world.generator?.recipe?.version ?? world.generator?.version) ? { recipeVersion: Number(world.recipeVersion ?? world.generator?.recipe?.version ?? world.generator?.version) } : {}),
        ...(asText(world.recipeFingerprint ?? world.generator?.realization?.fingerprint, MAX_ID) ? { recipeFingerprint: asText(world.recipeFingerprint ?? world.generator?.realization?.fingerprint, MAX_ID) } : {}),
        ...((world.semanticFactors ?? world.factors) && typeof (world.semanticFactors ?? world.factors) === 'object' ? {
          factors: Object.fromEntries(Object.entries(world.semanticFactors ?? world.factors).filter(([key, value]) => ['relation', 'noise', 'sampleSize', 'samplingRule'].includes(key) && (typeof value === 'string' || Number.isFinite(value))).slice(0, 8)),
        } : {}),
      },
    } : {}),
    ...(experiment && typeof experiment === 'object' ? {
      experiment: {
        ...(asId(experiment.baselineId ?? experiment.baselineExperimentId) ? { baselineId: asId(experiment.baselineId ?? experiment.baselineExperimentId) } : {}),
        ...(asId(experiment.activeId ?? experiment.activeExperimentId) ? { activeId: asId(experiment.activeId ?? experiment.activeExperimentId) } : {}),
        ...(asText(experiment.modelFamily, 80) ? { modelFamily: asText(experiment.modelFamily, 80) } : {}),
      },
    } : {}),
    ...(comparison && typeof comparison === 'object' ? {
      comparison: {
        ...(comparison.enabled ? { active: true } : { active: false }),
        changed: boundedArray(comparison.diff?.changed ?? comparison.changed, 12),
        held: boundedArray(comparison.diff?.unchanged ?? comparison.held, 12),
      },
    } : {}),
    ...(evidence && typeof evidence === 'object' ? {
      evidence: {
        status: asText(evidence.status, 40),
        ids: boundedArray(evidence.ids ?? evidence.evidenceIds, 12),
        types: boundedArray(evidence.types ?? evidence.evidenceTypes, 12),
      },
    } : {}),
    recentEventTypes: boundedArray((runtime.recentSemanticEvents ?? source.recentSemanticEvents ?? []).map((event) => event?.type ?? event?.eventType), 12),
    candidateConcepts: boundedArray(runtime.candidateConcepts ?? source.candidateConcepts, 8),
    conceptsEncountered: boundedArray(runtime.encounteredConcepts ?? source.conceptsEncountered, 8),
    conceptsEvidenced: boundedArray(runtime.evidencedConcepts ?? source.conceptsEvidenced, 8),
  };
  return Object.fromEntries(Object.entries(projected).slice(0, MAX_CONTEXT_KEYS));
}

export function taskContractFor(taskMode) {
  if (!AGENT_TASK_MODE_VALUES.includes(taskMode)) return null;
  return Object.freeze({
    version: AGENT_REQUEST_CONTRACT_VERSION,
    mode: taskMode,
    outputSet: AGENT_OUTPUT_SETS[taskMode],
  });
}

export function taskContractDefinition(taskMode) {
  const definition = AGENT_TASK_CONTRACTS[taskMode];
  return definition ? structuredClone(definition) : null;
}

export function createAgentRequest({ taskMode, requestId, context = {}, input = null, contract = null } = {}) {
  const task = contract ?? taskContractFor(taskMode);
  if (!task || task.version !== AGENT_REQUEST_CONTRACT_VERSION || !AGENT_TASK_MODE_VALUES.includes(task.mode)
    || !OUTPUT_SET_VALUES.has(task.outputSet) || task.outputSet !== AGENT_OUTPUT_SETS[task.mode]) {
    const error = new Error('AI_TASK_CONTRACT_INVALID');
    error.code = 'AI_TASK_CONTRACT_INVALID';
    error.details = { field: 'task' };
    throw error;
  }
  const id = asId(requestId);
  if (!id) {
    const error = new Error('AI_REQUEST_ID_REQUIRED');
    error.code = 'AI_REQUEST_ID_REQUIRED';
    error.details = { field: 'requestId' };
    throw error;
  }
  const projectedInput = projectTaskInput(input);
  return Object.freeze({
    version: AGENT_REQUEST_CONTRACT_VERSION,
    requestId: id,
    task: { version: task.version, mode: task.mode, outputSet: task.outputSet },
    context: projectAgentSemanticContext(context, { taskMode: task.mode }),
    ...(projectedInput ? { input: projectedInput } : {}),
  });
}

export function validateAgentRequest(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, errors: ['shape'] };
  for (const key of Object.keys(value)) if (!['version', 'requestId', 'task', 'context', 'input'].includes(key)) errors.push(`unknown:${key}`);
  if (value.version !== AGENT_REQUEST_CONTRACT_VERSION) errors.push('version');
  if (!asId(value.requestId)) errors.push('requestId');
  if (value.task && typeof value.task === 'object') for (const key of Object.keys(value.task)) if (!['version', 'mode', 'outputSet'].includes(key)) errors.push(`unknown:task.${key}`);
  if (!value.task || value.task.version !== AGENT_REQUEST_CONTRACT_VERSION || !AGENT_TASK_MODE_VALUES.includes(value.task.mode)) errors.push('task');
  if (value.task && (!OUTPUT_SET_VALUES.has(value.task.outputSet)
    || value.task.outputSet !== AGENT_OUTPUT_SETS[value.task.mode])) errors.push('outputSet');
  if (!value.context || typeof value.context !== 'object' || Array.isArray(value.context)) errors.push('context');
  if (value.input !== undefined && (!value.input || typeof value.input !== 'object' || Array.isArray(value.input))) errors.push('input');
  if (value.input && typeof value.input === 'object') for (const key of Object.keys(value.input)) if (!['question', 'expectation', 'reasoning', 'goal', 'requestedChange', 'mode', 'recipeVersion', 'patchVersion'].includes(key)) errors.push(`unknown:input.${key}`);
  return { valid: errors.length === 0, errors };
}

export function taskContractPrompt(request) {
  const checked = validateAgentRequest(request);
  if (!checked.valid) return '';
  const definition = taskContractDefinition(request.task.mode);
  const rules = {
    [AGENT_TASK_MODES.ASK]: 'Return one JSON object with a bounded answer string and an optional non-executable suggestion; never return runtime operations.',
    [AGENT_TASK_MODES.EXPERIMENT_DESIGN]: 'Return one JSON guidance outcome: explanation, navigation, experiment, or clarification. Any experiment is a proposal for the local planner and cannot execute.',
    [AGENT_TASK_MODES.WORLD_EDIT]: 'Return one JSON World result: bounded create, bounded current-context edit/patch, or clarification with a concrete reason. Do not return points, observations, metrics, runtime operations, Experiment output, or evidence.',
  }[request.task.mode];
  const examples = {
    [AGENT_TASK_MODES.ASK]: { answer: 'A bounded explanation.', tryExperiment: null, depth: null },
    [AGENT_TASK_MODES.EXPERIMENT_DESIGN]: { kind: 'clarification', topic: null, explanation: null, depth: null, intent: null, requestedChange: null, requestedHolds: [], design: null, experimentDesign: null, reason: 'Need one bounded learner question.', ambiguity: null },
    [AGENT_TASK_MODES.WORLD_EDIT]: { kind: 'clarification', topic: null, explanation: null, depth: null, intent: null, requestedChange: null, requestedHolds: [], design: null, experimentDesign: null, reason: 'A current World recipe or a complete new recipe is required.', ambiguity: null },
  }[request.task.mode];
  return [
    `VOLK-ML semantic task contract v${request.version}.`,
    `taskMode=${request.task.mode}; outputSet=${request.task.outputSet}; requestId=${request.requestId}.`,
    'Deterministic runtime state, learner consent, and execution remain local authority.',
    rules ? `Task rules: ${rules}` : '',
    definition ? `JSON contract: ${JSON.stringify(definition)}` : '',
    examples ? `Valid output example: ${JSON.stringify(examples)}` : '',
    `Bounded semantic context: ${JSON.stringify(request.context)}`,
    request.input ? `Bounded task input: ${JSON.stringify(request.input)}` : '',
  ].filter(Boolean).join('\n');
}

export function classifyAgentFailure(error, { stage = null } = {}) {
  const code = String(error?.code ?? '').toUpperCase();
  const status = Number(error?.details?.status) || null;
  const name = String(error?.name ?? '');
  if (name === 'AbortError' || code.includes('CANCEL') || code.includes('ABORT')) return 'cancel';
  if (code.includes('TIMEOUT') || code.includes('INCOMPLETE')) return 'timeout';
  if (code.includes('RESPONSE_INVALID') || code.includes('OUTPUT_MISSING') || code.includes('RESPONSE_EMPTY')) return 'parse';
  if (status === 401 || status === 403 || code.includes('AUTH') || code.includes('KEY_REQUIRED')) return 'authentication';
  if (status === 429 || code.includes('RATE_LIMIT')) return 'rate-limit';
  if (status >= 500 || code.includes('SERVER')) return 'server';
  if (status === 408 || status === 409 || status === 422 || (status >= 400 && status < 500)) return 'http';
  if (code.includes('INVALID') || code.includes('VALIDATION') || code.includes('INTERPRET') || code.includes('ANSWER') || code.includes('TASK_CONTRACT')) {
    return stage === 'parse' || code.includes('JSON') ? 'parse' : 'answer-validation';
  }
  if (code.includes('NETWORK') || code.includes('UNAVAILABLE') || code.includes('UNREACHABLE') || code.includes('PROVIDER_REQUEST')) return 'network';
  if (stage === 'parse') return 'parse';
  if (stage === 'provider-response' || stage === 'network') return 'network';
  return 'unknown';
}

export function safeTaskFailure(error, { taskMode = null, stage = null, requestId = null } = {}) {
  const details = error?.details ?? {};
  return Object.freeze({
    version: AGENT_REQUEST_CONTRACT_VERSION,
    failureClass: classifyAgentFailure(error, { stage }),
    code: String(error?.code ?? 'AI_UNKNOWN_FAILURE').slice(0, 80),
    stage: asText(stage ?? details.stage, 48),
    taskMode: asText(taskMode, 48),
    requestId: asId(requestId),
    fieldPath: asText(details.fieldPath ?? details.field, 120),
    cause: asText(details.cause ?? details.reason, 160),
    httpStatus: Number(details.status) || null,
    finishReason: asText(details.finishReason, 80),
    truncated: typeof details.truncated === 'boolean' ? details.truncated : null,
    responseLength: Number.isFinite(details.responseLength) ? Math.max(0, Math.min(100_000, details.responseLength)) : null,
    elapsedMs: Number.isFinite(details.elapsedMs) ? Math.max(0, Math.min(120_000, Math.floor(details.elapsedMs))) : null,
    attemptCount: Number.isFinite(details.attempts) ? Math.max(1, Math.min(2, Math.floor(details.attempts))) : null,
    repairCount: Number.isFinite(details.repairCount) ? Math.max(0, Math.min(1, Math.floor(details.repairCount))) : null,
  });
}

export function createLogicalRequestController({ requestId, onState } = {}) {
  let status = 'idle';
  let terminal = false;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const set = (next) => { status = next; onState?.({ requestId, status }); return status; };
  return Object.freeze({
    requestId,
    signal: controller?.signal,
    start() { if (terminal || status !== 'idle') return false; set('running'); return true; },
    finish(next = 'completed') { if (terminal) return false; terminal = true; set(next); return true; },
    cancel() { if (terminal) return false; controller?.abort(); terminal = true; set('cancelled'); return true; },
    isCurrent() { return !terminal; },
    getState() { return { requestId, status, terminal }; },
  });
}

function requestAbortError({ kind, requestId, startedAt, stage = 'logical-request' } = {}) {
  const timeout = kind === 'timeout';
  const error = new Error(timeout ? 'AI_REQUEST_TIMEOUT' : 'AI_REQUEST_CANCELLED');
  error.name = timeout ? 'TimeoutError' : 'AbortError';
  error.code = timeout ? 'AI_REQUEST_TIMEOUT' : 'AI_REQUEST_CANCELLED';
  error.details = {
    reason: timeout ? 'logical-deadline' : 'learner-cancelled',
    cause: timeout ? 'logical-deadline' : 'request-aborted',
    stage,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    requestId: asId(requestId),
  };
  return error;
}

/**
 * Normalize the optional logical deadline shared by every Agent caller.
 *
 * UI surfaces intentionally use `null` to mean "use the standard deadline".
 * Do that normalization here, before numeric coercion: Number(null) and
 * Number('') are both zero and would otherwise turn a normal request into a
 * one-millisecond timeout.
 */
export function normalizeAgentTimeoutMs(value) {
  if (value === null || value === undefined) return AGENT_LOGICAL_TIMEOUT_MS;
  if (typeof value === 'string' && value.trim() === '') return AGENT_LOGICAL_TIMEOUT_MS;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return AGENT_LOGICAL_TIMEOUT_MS;
  return Math.max(1, Math.min(120_000, Math.floor(numeric)));
}

function boundedTimeoutMs(value) {
  return normalizeAgentTimeoutMs(value);
}

/**
 * One logical request may make an initial call and one validation repair. The
 * repair is never attempted for transport, auth, rate-limit, timeout, or
 * cancellation failures.
 */
export async function runBoundedTask({ execute, validate, repairInput = null, fallback = null, taskMode = null, requestId = null, signal = null, timeoutMs = AGENT_LOGICAL_TIMEOUT_MS, onAttempt = null } = {}) {
  const startedAt = Date.now();
  const deadlineMs = boundedTimeoutMs(timeoutMs);
  const deadlineController = typeof AbortController === 'function' ? new AbortController() : null;
  const effectiveSignal = deadlineController?.signal ?? signal;
  let abortKind = null;
  let abortStage = 'logical-request';
  let deadlineTimer = null;
  let signalListener = null;
  const attemptTrace = [];
  const attemptBudget = { max: 2, used: 0 };
  const abort = (kind, stage = 'logical-request') => {
    if (abortKind) return;
    abortKind = kind;
    abortStage = stage;
    if (deadlineController && !deadlineController.signal.aborted) {
      deadlineController.abort({ code: kind === 'timeout' ? 'AI_REQUEST_TIMEOUT' : 'AI_REQUEST_CANCELLED', stage });
    }
  };
  if (signal?.aborted) abort('cancel', 'logical-request');
  else if (signal?.addEventListener) {
    signalListener = () => abort('cancel', 'logical-request');
    signal.addEventListener('abort', signalListener, { once: true });
  }
  deadlineTimer = setTimeout(() => abort('timeout', 'logical-deadline'), deadlineMs);
  const emitAttempt = (entry) => {
    const record = { version: 1, requestId: asId(requestId), elapsedMs: Math.max(0, Date.now() - startedAt), ...entry };
    attemptTrace.push(record);
    try { onAttempt?.(structuredClone(record)); } catch { /* tracing is observational */ }
  };
  const awaitWithAbort = async (promise, { stage }) => {
    if (abortKind) throw requestAbortError({ kind: abortKind, requestId, startedAt, stage: abortStage || stage });
    if (!effectiveSignal?.addEventListener) {
      const remaining = Math.max(1, deadlineMs - (Date.now() - startedAt));
      let localTimer;
      const deadlinePromise = new Promise((_, reject) => {
        localTimer = setTimeout(() => { abort('timeout', 'logical-deadline'); reject(requestAbortError({ kind: 'timeout', requestId, startedAt, stage: 'logical-deadline' })); }, remaining);
      });
      const safePromise = Promise.resolve(promise);
      safePromise.catch(() => {});
      try { return await Promise.race([safePromise, deadlinePromise]); }
      finally { if (localTimer) clearTimeout(localTimer); }
    }
    let abortListener;
    const abortPromise = new Promise((_, reject) => {
      abortListener = () => reject(requestAbortError({ kind: abortKind ?? 'cancel', requestId, startedAt, stage: abortStage || stage }));
      effectiveSignal.addEventListener('abort', abortListener, { once: true });
    });
    const safePromise = Promise.resolve(promise);
    // An abort-ignoring provider may settle later; consume that result/rejection
    // after the logical request has already returned to local fallback.
    safePromise.catch(() => {});
    try { return await Promise.race([safePromise, abortPromise]); }
    finally { effectiveSignal.removeEventListener?.('abort', abortListener); }
  };
  let firstFailure = null;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (abortKind) throw requestAbortError({ kind: abortKind, requestId, startedAt, stage: abortStage });
      const stage = attempt ? 'repair' : 'initial';
      try {
        const raw = await awaitWithAbort(execute({ attempt, repairInput: attempt ? repairInput : null, signal: effectiveSignal, attemptBudget }), { stage });
        const value = validate ? validate(raw) : raw;
        if (abortKind) throw requestAbortError({ kind: abortKind, requestId, startedAt, stage: abortStage });
        emitAttempt({ attempt: attempt + 1, stage, status: 'succeeded', usage: raw?.usage ?? value?.usage ?? null });
        return {
          value,
          attempts: attempt + 1,
          repairCount: attempt,
          finalSource: 'provider',
          attemptTrace: structuredClone(attemptTrace),
          firstFailure: firstFailure ? safeTaskFailure(firstFailure, { taskMode, stage: 'initial', requestId }) : null,
        };
      } catch (error) {
        const normalizedAbort = abortKind
          ? requestAbortError({ kind: abortKind, requestId, startedAt, stage: abortStage || stage })
          : error;
        const failureClass = classifyAgentFailure(normalizedAbort, { stage });
        if (!firstFailure) firstFailure = normalizedAbort;
        emitAttempt({
          attempt: attempt + 1,
          stage,
          status: failureClass === 'timeout' ? 'timeout' : failureClass === 'cancel' ? 'cancelled' : 'failed',
          failure: safeTaskFailure(normalizedAbort, { taskMode, stage, requestId }),
          usage: normalizedAbort?.details?.usage ?? null,
        });
        if (abortKind || attempt === 1 || !['parse', 'answer-validation'].includes(failureClass)) {
          if (fallback) {
            const value = await fallback({ error: normalizedAbort, firstFailure, attempts: attempt + 1 });
            return {
              value,
              attempts: attempt + 1,
              repairCount: attempt,
              finalSource: 'fallback',
              attemptTrace: structuredClone(attemptTrace),
              firstFailure: safeTaskFailure(firstFailure, { taskMode, stage: 'initial', requestId }),
            };
          }
          if (normalizedAbort && typeof normalizedAbort === 'object') {
            normalizedAbort.details = {
              ...(normalizedAbort.details ?? {}),
              firstFailureCode: String(firstFailure?.code ?? '').slice(0, 80) || null,
              firstFailureClass: classifyAgentFailure(firstFailure),
              attempts: attempt + 1,
              repairCount: attempt,
              elapsedMs: Math.max(0, Date.now() - startedAt),
              requestId: asId(requestId),
              attemptTrace: structuredClone(attemptTrace),
            };
          }
          throw normalizedAbort;
        }
      }
    }
    throw firstFailure ?? new Error('AI_TASK_FAILED');
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (signal && signalListener) signal.removeEventListener?.('abort', signalListener);
  }
}
