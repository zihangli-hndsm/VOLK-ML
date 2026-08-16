import { planTeachingGoal } from './teachingPlanner.js';
import { normalizeAiConfig } from '../../ai/aiSettings.js';
import { createProviderGateway, listProviderProtocols } from '../../ai/providerRegistry.js';

export const LLM_PROVIDERS = Object.freeze(listProviderProtocols().map((protocol) => Object.freeze({
  ...protocol,
  providerId: protocol.id,
})));

function goalSchemaFor(context = {}) {
  const objectives = [...(context?.teaching?.supportedObjectives ?? [])];
  const controls = (context?.controlSchemas ?? []).map((schema) => ({
    key: schema.key,
    type: schema.type,
    ...(schema.min !== undefined ? { min: schema.min } : {}),
    ...(schema.max !== undefined ? { max: schema.max } : {}),
    ...(schema.options ? { options: [...schema.options] } : {}),
  }));
  return {
    oneOf: [
      { type: 'explain-process', objective: objectives },
      { type: 'compare-control', objective: objectives, control: controls, values: 'exactly two valid values for control' },
      { type: 'what-if', objective: objectives, control: controls, value: 'one valid value for control' },
    ],
  };
}

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function buildTeachingInterpretationContext(context) {
  const operations = Object.fromEntries(Object.entries(context?.model?.operations ?? {}).map(([name, schema]) => [name, {
    intent: schema?.intent ?? null,
    playback: schema?.playback?.revealCountControl
      ? { revealCountControl: schema.playback.revealCountControl }
      : null,
  }]));
  return {
    playground: context?.playground ?? null,
    teaching: {
      objectives: [...(context?.teaching?.objectives ?? [])],
      supportedObjectives: [...(context?.teaching?.supportedObjectives ?? [])],
    },
    controlSchemas: (context?.controlSchemas ?? []).map((schema) => ({
      key: schema.key,
      type: schema.type,
      ...(schema.min !== undefined ? { min: schema.min } : {}),
      ...(schema.max !== undefined ? { max: schema.max } : {}),
      ...(schema.step !== undefined ? { step: schema.step } : {}),
      ...(schema.options ? { options: [...schema.options] } : {}),
      ...(schema.runObjective ? { runObjective: schema.runObjective } : {}),
    })),
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
    allowedGoalSchema: goalSchemaFor(context),
  };
}

function sanitizedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
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
    ? 'expected compare-control shape: { type: "compare-control", objective, control, values }'
    : details.reason === 'what-if needs a value'
      ? 'expected what-if shape: { type: "what-if", objective, control, value }'
      : '';
  const fallback = !objectiveProblem && !controlProblem && !shapeProblem
    ? 'expected one of the exact top-level shapes: { type: "explain-process", objective }, { type: "compare-control", objective, control, values }, or { type: "what-if", objective, control, value }'
    : '';
  return [error?.code ?? 'AI_INVALID_GOAL', objectiveProblem, controlProblem, shapeProblem, fallback].filter(Boolean).join('; ');
}

export function sanitizeInterpreterError(error) {
  const code = error?.code?.startsWith('AI_PROVIDER_') || error?.code === 'AI_PROVIDER_UNAVAILABLE'
    ? error.code
    : 'AI_INVALID_GOAL';
  return sanitizedError(code, code === 'AI_INVALID_GOAL'
    ? 'The model returned a goal that does not match this playground.'
    : 'The AI interpreter request failed. Check the provider configuration or use the local parser.');
}

function parseJsonText(text) {
  const raw = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not-object');
    return parsed;
  } catch {
    throw sanitizedError('AI_INVALID_GOAL', 'The AI interpreter returned an invalid goal shape.');
  }
}

function validateCandidate(candidate, context) {
  try {
    planTeachingGoal({ goal: candidate, context });
  } catch (error) {
    throw sanitizedError(error?.code ?? 'AI_INVALID_GOAL', 'The AI goal was rejected by the deterministic planner.', { problem: validationProblem(error, context) });
  }
  return candidate;
}

function promptFor({ request, context, repairProblem }) {
  return [
    'Interpret the user request into one typed TeachingGoal JSON object.',
    'Return JSON only. Never return a Visualization Script, operations, phases, code, or prose.',
    'Use only controls, values, objectives, and operation intents present in the supplied context.',
    'For unsupported or ambiguous requests, return the closest typed shape only if it is directly supported; otherwise return {"type":"explain-process"} only for a genuinely generic teaching request.',
    `Allowed TeachingGoal schema (use these exact top-level fields): ${JSON.stringify(context.allowedGoalSchema)}`,
    `Bounded playground context: ${JSON.stringify(context)}`,
    repairProblem ? `The previous goal failed deterministic validation. Correct it using this sanitized problem: ${repairProblem}` : '',
    `User request: ${String(request ?? '').trim()}`,
  ].filter(Boolean).join('\n\n');
}

export function createLlmGoalInterpreter({ gateway, fetchImpl = globalThis.fetch } = {}) {
  const providerGateway = gateway ?? createProviderGateway({ fetchImpl });
  return Object.freeze({
    async interpret({ request, context, config, providerId = 'openai-compatible', apiKey, model, endpoint }) {
      const resolvedConfig = normalizeAiConfig(config ?? { protocol: providerId, apiKey, model, endpoint });
      if (!resolvedConfig) throw sanitizedError('AI_PROVIDER_UNSUPPORTED', 'The selected AI protocol is not supported.');
      const boundedContext = buildTeachingInterpretationContext(context);
      let repairProblem = '';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await providerGateway.complete({
            config: resolvedConfig,
            system: 'You are VOLK-ML\'s temporary semantic goal interpreter. Deterministic VOLK-ML code remains authoritative.',
            messages: [{ role: 'user', content: promptFor({ request, context: boundedContext, repairProblem }) }],
            responseMode: 'json',
          });
          return { goal: validateCandidate(parseJsonText(response.text), context), attempts: attempt + 1, providerId: response.protocol };
        } catch (error) {
          if (error?.code?.startsWith('AI_PROVIDER_') || error?.code === 'AI_KEY_REQUIRED' || error?.code === 'AI_MODEL_REQUIRED' || error?.code === 'AI_PROVIDER_UNSUPPORTED' || error?.code === 'AI_PROVIDER_UNAVAILABLE') {
            throw sanitizeInterpreterError(error);
          }
          if (attempt === 1) throw sanitizeInterpreterError(error);
            repairProblem = error?.details?.problem ?? error?.code ?? 'invalid goal';
        }
      }
      throw sanitizedError('AI_INTERPRETATION_FAILED', 'The AI interpreter request failed.');
    },
  });
}

