import { planTeachingGoal } from './teachingPlanner.js';
import { normalizeAiConfig } from '../../ai/aiSettings.js';
import { createProviderGateway, listProviderProtocols } from '../../ai/providerRegistry.js';

export const LLM_PROVIDERS = Object.freeze(listProviderProtocols().map((protocol) => Object.freeze({
  ...protocol,
  providerId: protocol.id,
})));

function goalSchemaFor() {
  return {
    oneOf: [
      { type: 'explain-process' },
      { type: 'compare-control', control: 'one key from allowedControls', values: 'exactly two valid values for control' },
      { type: 'what-if', control: 'one key from allowedControls', value: 'one valid value for control' },
    ],
  };
}

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function safePrimitive(value) {
  if (typeof value === 'string') return value.slice(0, 120);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return null;
}

function safeCandidateSummary(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const summary = { type: typeof candidate.type === 'string' ? candidate.type : null };
  if (typeof candidate.control === 'string') summary.control = candidate.control;
  else if (candidate.control && typeof candidate.control === 'object' && typeof candidate.control.key === 'string') summary.control = { key: candidate.control.key.slice(0, 120) };
  if (Array.isArray(candidate.values)) summary.values = candidate.values.slice(0, 2).map(safePrimitive);
  if (Object.prototype.hasOwnProperty.call(candidate, 'value')) summary.value = safePrimitive(candidate.value);
  if (typeof candidate.objective === 'string') summary.objective = candidate.objective.slice(0, 120);
  return summary;
}

export function canonicalizeTeachingGoal(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw sanitizedError('AI_INVALID_GOAL', 'The AI interpreter returned an invalid goal shape.', { stage: 'canonicalize' });
  }
  let source = candidate;
  if (candidate.goal && typeof candidate.goal === 'object' && !Array.isArray(candidate.goal)
    && !candidate.type && !candidate.control && !candidate.compareControl && !candidate.whatIf) {
    source = candidate.goal;
  }
  if (!source.type && source.compareControl && typeof source.compareControl === 'object') {
    source = { type: 'compare-control', ...source.compareControl };
  } else if (!source.type && source.whatIf && typeof source.whatIf === 'object') {
    source = { type: 'what-if', ...source.whatIf };
  }
  const normalized = { ...source };
  if (normalized.control && typeof normalized.control === 'object') {
    const keys = Object.keys(normalized.control);
    if (keys.length !== 1 || keys[0] !== 'key' || typeof normalized.control.key !== 'string') {
      throw sanitizedError('AI_INVALID_GOAL', 'The AI interpreter returned an ambiguous control shape.', {
        stage: 'canonicalize',
        candidate: safeCandidateSummary(normalized),
        problem: 'control object must contain only a string key',
      });
    }
    normalized.control = normalized.control.key;
  }
  return normalized;
}

export function buildTeachingInterpretationContext(context) {
  const operations = Object.fromEntries(Object.entries(context?.model?.operations ?? {}).map(([name, schema]) => [name, {
    intent: schema?.intent ?? null,
    playback: schema?.playback?.revealCountControl
      ? { revealCountControl: schema.playback.revealCountControl }
      : null,
  }]));
  const allowedControls = (context?.controlSchemas ?? []).map((schema) => ({
    key: schema.key,
    type: schema.type,
    ...(schema.min !== undefined ? { min: schema.min } : {}),
    ...(schema.max !== undefined ? { max: schema.max } : {}),
    ...(schema.step !== undefined ? { step: schema.step } : {}),
    ...(schema.options ? { options: [...schema.options] } : {}),
    ...(schema.runObjective ? { runObjective: schema.runObjective } : {}),
  }));
  return {
    playground: context?.playground ?? null,
    teaching: {
      objectives: [...(context?.teaching?.objectives ?? [])],
      supportedObjectives: [...(context?.teaching?.supportedObjectives ?? [])],
    },
    allowedGoalSchema: goalSchemaFor(),
    allowedControls,
    controlSchemas: allowedControls,
    currentControls: { ...(context?.controls ?? {}) },
    modelOperations: operations,
    data: {
      task: context?.data?.task ?? null,
      featureColumns: [...(context?.data?.featureColumns ?? [])],
      targetColumn: context?.data?.targetColumn ?? null,
      rowCount: finite(context?.data?.rowCount) ?? 0,
      statistics: Object.fromEntries(Object.entries(context?.data?.statistics ?? {}).map(([key, value]) => [key, {
        count: finite(value?.count) ?? 0,
        mean: finite(value?.mean),
        min: finite(value?.min),
        max: finite(value?.max),
      }])),
    },
    currentState: context?.currentState ?? null,
  };
}

function sanitizedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function diagnosticDetails(error, extra = {}) {
  const source = { ...(error?.details ?? {}), ...extra };
  const details = {};
  if (['parse', 'canonicalize', 'validate', 'provider'].includes(source.stage)) details.stage = source.stage;
  if (Number.isInteger(source.attempt)) details.attempt = source.attempt;
  if (Number.isFinite(Number(source.status))) details.status = Number(source.status);
  if (typeof source.protocol === 'string') details.protocol = source.protocol;
  if (typeof source.model === 'string') details.model = source.model.slice(0, 120);
  if (source.candidate) details.candidate = safeCandidateSummary(source.candidate);
  if (typeof source.problem === 'string') details.problem = source.problem.slice(0, 800);
  return details;
}

function validationProblem(error, context) {
  const details = error?.details ?? {};
  const objectiveProblem = details.objective
    ? `unsupported objective: ${details.objective}; allowed objectives: ${(context?.teaching?.supportedObjectives ?? []).join(', ')}`
    : '';
  const controlProblem = details.control
    ? `unsupported control: ${details.control}; allowed controls: ${(context?.controlSchemas ?? []).map((schema) => schema.key).join(', ')}`
    : '';
  const shapeProblem = details.reason === 'compare values need exactly two entries'
    ? 'expected compare-control shape: { type: "compare-control", control, values }'
    : details.reason === 'what-if needs a value'
      ? 'expected what-if shape: { type: "what-if", control, value }'
      : '';
  const fallback = !objectiveProblem && !controlProblem && !shapeProblem
    ? 'expected one of the exact top-level shapes: { type: "explain-process" }, { type: "compare-control", control, values }, or { type: "what-if", control, value }'
    : '';
  return [error?.code ?? 'AI_INVALID_GOAL', objectiveProblem, controlProblem, shapeProblem, fallback].filter(Boolean).join('; ');
}

export function sanitizeInterpreterError(error, extraDetails = {}) {
  const providerFailure = error?.code?.startsWith('AI_PROVIDER_')
    || error?.code === 'AI_PROVIDER_UNAVAILABLE'
    || error?.code === 'AI_KEY_REQUIRED'
    || error?.code === 'AI_MODEL_REQUIRED'
    || error?.code === 'AI_PROVIDER_UNSUPPORTED';
  const code = providerFailure ? error.code : 'AI_INVALID_GOAL';
  return sanitizedError(code, providerFailure
    ? 'The AI interpreter request failed. Check the provider configuration or use the local parser.'
    : 'The model returned a goal that does not match this playground.', diagnosticDetails(error, extraDetails));
}

function parseJsonText(text) {
  const raw = String(text ?? '').trim();
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      if (start >= 0) inString = true;
      continue;
    }
    if (character === '{') {
      if (start < 0) start = index;
      depth += 1;
    } else if (character === '}' && start >= 0) {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(raw.slice(start, index + 1));
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not-object');
          return parsed;
        } catch {
          throw sanitizedError('AI_INVALID_GOAL', 'The AI interpreter returned an invalid goal shape.', { stage: 'parse' });
        }
      }
    }
  }
  throw sanitizedError('AI_INVALID_GOAL', 'The AI interpreter returned an invalid goal shape.', { stage: 'parse' });
}

function validateCandidate(candidate, context) {
  try {
    planTeachingGoal({ goal: candidate, context });
  } catch (error) {
    throw sanitizedError(error?.code ?? 'AI_INVALID_GOAL', 'The AI goal was rejected by the deterministic planner.', {
      stage: 'validate',
      candidate: safeCandidateSummary(candidate),
      problem: validationProblem(error, context),
    });
  }
  return candidate;
}

function requestAwareCandidate({ request, candidate, context }) {
  if (candidate?.type !== 'explain-process' || candidate.objective) return candidate;
  const text = String(request ?? '').toLowerCase();
  const capacityQuestion = /hidden[\s_-]*units?|hidden[\s_-]*layer|\bwidth\b|\bcapacity\b|wider|fit(?:s|ting)?(?: the data)? better|隐[藏层层].{0,8}(?:大|宽|单元)|拟合|学习效果/.test(text);
  const supported = context?.teaching?.supportedObjectives ?? [];
  if (capacityQuestion && supported.includes('show_training')) {
    return { ...candidate, objective: 'show_training' };
  }
  return candidate;
}

function promptFor({ request, context, repairProblem, repairCandidate }) {
  return [
    'Interpret the user request into one typed TeachingGoal JSON object.',
    'Return JSON only. Never return a Visualization Script, operations, phases, code, or prose.',
    'Allowed goal shapes:',
    '{"type":"explain-process"}',
    '{"type":"compare-control","control":"<allowed control key>","values":[value1,value2]}',
    '{"type":"what-if","control":"<allowed control key>","value":value}',
    'Do not include objective unless an advanced request explicitly requires it; the deterministic planner derives the default objective.',
    `Allowed controls and values: ${JSON.stringify(context.allowedControls)}`,
    `Supported objectives (planner-owned, not required output fields): ${JSON.stringify(context.teaching.supportedObjectives)}`,
    'For a request explicitly about hidden-layer capacity or fitting/learning effect, the optional objective hint "show_training" is allowed; otherwise omit objective.',
    `Bounded playground context: ${JSON.stringify(context)}`,
    repairCandidate ? `Previous candidate (safe summary): ${JSON.stringify(repairCandidate)}` : '',
    repairProblem ? `The previous goal failed deterministic validation. Correct it using this sanitized problem: ${repairProblem}` : '',
    `User request: ${String(request ?? '').trim()}`,
  ].filter(Boolean).join('\n\n');
}

function isProviderFailure(error) {
  return error?.code?.startsWith('AI_PROVIDER_')
    || error?.code === 'AI_KEY_REQUIRED'
    || error?.code === 'AI_MODEL_REQUIRED'
    || error?.code === 'AI_PROVIDER_UNSUPPORTED'
    || error?.code === 'AI_PROVIDER_UNAVAILABLE';
}

export function createLlmGoalInterpreter({ gateway, fetchImpl = globalThis.fetch } = {}) {
  const providerGateway = gateway ?? createProviderGateway({ fetchImpl });
  return Object.freeze({
    async interpret({ request, context, config, providerId = 'openai-compatible', apiKey, model, endpoint }) {
      const resolvedConfig = normalizeAiConfig(config ?? { protocol: providerId, apiKey, model, endpoint });
      if (!resolvedConfig) throw sanitizedError('AI_PROVIDER_UNSUPPORTED', 'The selected AI protocol is not supported.', { stage: 'provider' });
      const boundedContext = buildTeachingInterpretationContext(context);
      let repairProblem = '';
      let repairCandidate = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await providerGateway.complete({
            config: resolvedConfig,
            system: 'You are VOLK-ML\'s temporary semantic goal interpreter. Deterministic VOLK-ML code remains authoritative.',
            messages: [{ role: 'user', content: promptFor({ request, context: boundedContext, repairProblem, repairCandidate }) }],
            responseMode: 'json',
          });
          const parsed = parseJsonText(response.text);
          let candidate;
          try {
            candidate = canonicalizeTeachingGoal(parsed);
          } catch (error) {
            throw sanitizedError(error?.code ?? 'AI_INVALID_GOAL', error?.message ?? 'The AI interpreter returned an invalid goal shape.', {
              ...diagnosticDetails(error),
              stage: 'canonicalize',
              candidate: safeCandidateSummary(parsed),
              problem: error?.details?.problem ?? 'goal structure could not be canonicalized unambiguously',
            });
          }
          candidate = requestAwareCandidate({ request, candidate, context });
          return {
            goal: validateCandidate(candidate, context),
            attempts: attempt + 1,
            providerId: response.protocol,
          };
        } catch (error) {
          if (isProviderFailure(error)) {
            throw sanitizeInterpreterError(error, {
              stage: 'provider',
              attempt: attempt + 1,
              protocol: resolvedConfig.protocol,
              model: resolvedConfig.model,
            });
          }
          if (attempt === 1) {
            throw sanitizeInterpreterError(error, {
              stage: error?.details?.stage ?? 'validate',
              attempt: attempt + 1,
              protocol: resolvedConfig.protocol,
              model: resolvedConfig.model,
            });
          }
          repairProblem = error?.details?.problem ?? error?.message ?? error?.code ?? 'invalid goal';
          repairCandidate = error?.details?.candidate ?? null;
        }
      }
      throw sanitizedError('AI_INTERPRETATION_FAILED', 'The AI interpreter request failed.', { stage: 'validate' });
    },
  });
}
