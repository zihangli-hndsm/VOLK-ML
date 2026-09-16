/**
 * Shared semantic boundary for the three learner-facing Agent request modes.
 *
 * This module deliberately contains no provider, React, DOM, or runtime
 * dependencies.  It is safe to use from local interpreters, Cloud adapters,
 * and deterministic tests alike.
 */

export const AGENT_REQUEST_CONTRACT_VERSION = 1;

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

export function createAgentRequest({ taskMode, requestId, context = {}, input = null, contract = null } = {}) {
  const task = contract ?? taskContractFor(taskMode);
  if (!task || task.version !== AGENT_REQUEST_CONTRACT_VERSION || !AGENT_TASK_MODE_VALUES.includes(task.mode) || !OUTPUT_SET_VALUES.has(task.outputSet)) {
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
  if (value.task && !OUTPUT_SET_VALUES.has(value.task.outputSet)) errors.push('outputSet');
  if (!value.context || typeof value.context !== 'object' || Array.isArray(value.context)) errors.push('context');
  if (value.input !== undefined && (!value.input || typeof value.input !== 'object' || Array.isArray(value.input))) errors.push('input');
  if (value.input && typeof value.input === 'object') for (const key of Object.keys(value.input)) if (!['question', 'expectation', 'reasoning', 'goal', 'requestedChange', 'mode', 'recipeVersion', 'patchVersion'].includes(key)) errors.push(`unknown:input.${key}`);
  return { valid: errors.length === 0, errors };
}

export function taskContractPrompt(request) {
  const checked = validateAgentRequest(request);
  if (!checked.valid) return '';
  const rules = {
    [AGENT_TASK_MODES.ASK]: 'Return one JSON object with a bounded answer string and an optional non-executable suggestion; never return runtime operations.',
    [AGENT_TASK_MODES.EXPERIMENT_DESIGN]: 'Return one JSON guidance outcome: explanation, navigation, experiment, or clarification. Any experiment is a proposal for the local planner and cannot execute.',
    [AGENT_TASK_MODES.WORLD_EDIT]: 'Return one JSON world-design outcome with a validated recipe or patch only. Do not return points, observations, metrics, runtime operations, or evidence.',
  }[request.task.mode];
  const examples = {
    [AGENT_TASK_MODES.ASK]: { answer: 'A bounded explanation.', tryExperiment: null, depth: null },
    [AGENT_TASK_MODES.EXPERIMENT_DESIGN]: { kind: 'clarification', topic: null, explanation: null, depth: null, intent: null, requestedChange: null, requestedHolds: [], design: null, experimentDesign: null, reason: 'Need one bounded learner question.', ambiguity: null },
    [AGENT_TASK_MODES.WORLD_EDIT]: { kind: 'world-design', topic: null, explanation: null, depth: null, intent: null, requestedChange: null, requestedHolds: [], design: { mode: 'edit', recipe: null, patch: { version: 1, changes: [{ type: 'SET_NOISE', split: 'train', kind: 'position', amount: 0.1 }] } }, experimentDesign: null, reason: null, ambiguity: null },
  }[request.task.mode];
  return [
    `VOLK-ML semantic task contract v${request.version}.`,
    `taskMode=${request.task.mode}; outputSet=${request.task.outputSet}; requestId=${request.requestId}.`,
    'Deterministic runtime state, learner consent, and execution remain local authority.',
    rules ? `Task rules: ${rules}` : '',
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
  if (status === 408 || status === 409 || status === 422 || status === 429 || (status >= 400 && status < 500)) return 'http';
  if (status >= 500) return 'http';
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

/**
 * One logical request may make an initial call and one validation repair. The
 * repair is never attempted for transport, auth, rate-limit, timeout, or
 * cancellation failures.
 */
export async function runBoundedTask({ execute, validate, repairInput = null, fallback = null, taskMode = null, requestId = null, signal = null } = {}) {
  let firstFailure = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal?.aborted) {
      const error = new Error('AI_REQUEST_CANCELLED');
      error.code = 'AI_REQUEST_CANCELLED';
      throw error;
    }
    try {
      const raw = await execute({ attempt, repairInput: attempt ? repairInput : null, signal });
      return { value: validate ? validate(raw) : raw, attempts: attempt + 1, firstFailure: firstFailure ? safeTaskFailure(firstFailure, { taskMode, requestId }) : null };
    } catch (error) {
      const failureClass = classifyAgentFailure(error);
      if (!firstFailure) firstFailure = error;
      if (attempt === 1 || !['parse', 'answer-validation'].includes(failureClass)) {
        if (fallback) return { value: await fallback({ error, firstFailure, attempts: attempt + 1 }), attempts: attempt + 1, firstFailure: safeTaskFailure(firstFailure, { taskMode, requestId }) };
        if (attempt > 0 && error && typeof error === 'object') {
          error.details = {
            ...(error.details ?? {}),
            firstFailureCode: String(firstFailure?.code ?? '').slice(0, 80) || null,
            firstFailureClass: classifyAgentFailure(firstFailure),
            attempts: attempt + 1,
          };
        }
        throw error;
      }
    }
  }
  throw firstFailure ?? new Error('AI_TASK_FAILED');
}
