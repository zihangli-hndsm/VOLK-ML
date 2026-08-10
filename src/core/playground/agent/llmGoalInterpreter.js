Exit code: 0
Wall time: 0.5 seconds
Output:
import { planTeachingGoal } from './teachingPlanner.js';

const DEFAULT_ENDPOINTS = Object.freeze({
  'openai-compatible': 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
});

export const LLM_PROVIDERS = Object.freeze([
  Object.freeze({ id: 'openai-compatible', labelKey: 'playground.agent.provider.openaiCompatible', defaultModel: 'gpt-4o-mini' }),
  Object.freeze({ id: 'anthropic', labelKey: 'playground.agent.provider.anthropic', defaultModel: 'claude-3-5-haiku-latest' }),
]);

const GOAL_SCHEMA = Object.freeze({
  type: ['explain-process', 'compare-control', 'what-if'],
  objective: 'one supported teaching objective from the provided context',
  compareControl: { control: 'string from context.controlSchemas', values: 'exactly two numbers/options' },
  whatIf: { control: 'string from context.controlSchemas', value: 'one value valid for that control' },
});

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
    allowedGoalSchema: GOAL_SCHEMA,
  };
}

function sanitizedError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.details = {};
  return error;
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
    throw sanitizedError(error?.code ?? 'AI_INVALID_GOAL', 'The AI goal was rejected by the deterministic planner.');
  }
  return candidate;
}

function promptFor({ request, context, repairProblem }) {
  return [
    'Interpret the user request into one typed TeachingGoal JSON object.',
    'Return JSON only. Never return a Visualization Script, operations, phases, code, or prose.',
    'Use only controls, values, objectives, and operation intents present in the supplied context.',
    'For unsupported or ambiguous requests, return the closest typed shape only if it is directly supported; otherwise return {"type":"explain-process"} only for a genuinely generic teaching request.',
    `Allowed TeachingGoal schema: ${JSON.stringify(GOAL_SCHEMA)}`,
    `Bounded playground context: ${JSON.stringify(context)}`,
    repairProblem ? `The previous goal failed deterministic validation. Correct it using this sanitized problem: ${repairProblem}` : '',
    `User request: ${String(request ?? '').trim()}`,
  ].filter(Boolean).join('\n\n');
}

async function readProviderResponse(response) {
  if (!response?.ok) throw sanitizedError('AI_PROVIDER_REQUEST_FAILED', 'The AI provider request failed.');
  let payload;
  try { payload = await response.json(); } catch { throw sanitizedError('AI_PROVIDER_RESPONSE_INVALID', 'The AI provider response was not valid JSON.'); }
  return payload;
}

const providerAdapters = Object.freeze({
  'openai-compatible': {
    async request({ fetchImpl, endpoint, apiKey, model, system, user }) {
      const response = await fetchImpl(endpoint || DEFAULT_ENDPOINTS['openai-compatible'], {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' }, messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ] }),
      });
      const payload = await readProviderResponse(response);
      return payload?.choices?.[0]?.message?.content ?? '';
    },
  },
  anthropic: {
    async request({ fetchImpl, endpoint, apiKey, model, system, user }) {
      const response = await fetchImpl(endpoint || DEFAULT_ENDPOINTS.anthropic, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 500, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
      });
      const payload = await readProviderResponse(response);
      return payload?.content?.find((item) => item?.type === 'text')?.text ?? '';
    },
  },
});

export function createLlmGoalInterpreter({ fetchImpl = globalThis.fetch } = {}) {
  return Object.freeze({
    async interpret({ request, context, providerId = 'openai-compatible', apiKey, model, endpoint }) {
      if (typeof fetchImpl !== 'function') throw sanitizedError('AI_PROVIDER_UNAVAILABLE', 'No browser fetch implementation is available.');
      if (typeof apiKey !== 'string' || !apiKey.trim()) throw sanitizedError('AI_KEY_REQUIRED', 'Enter an API key to use the AI interpreter.');
      const provider = providerAdapters[providerId];
      if (!provider) throw sanitizedError('AI_PROVIDER_UNSUPPORTED', 'The selected AI provider is not supported.');
      const boundedContext = buildTeachingInterpretationContext(context);
      let repairProblem = '';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const text = await provider.request({
            fetchImpl,
            endpoint,
            apiKey: apiKey.trim(),
            model: String(model ?? '').trim(),
            system: 'You are VOLK-ML\'s temporary semantic goal interpreter. Deterministic VOLK-ML code remains authoritative.',
            user: promptFor({ request, context: boundedContext, repairProblem }),
          });
          return { goal: validateCandidate(parseJsonText(text), context), attempts: attempt + 1, providerId };
        } catch (error) {
          if (error?.code?.startsWith('AI_PROVIDER_') || error?.code === 'AI_KEY_REQUIRED' || error?.code === 'AI_PROVIDER_UNSUPPORTED' || error?.code === 'AI_PROVIDER_UNAVAILABLE') {
            throw sanitizeInterpreterError(error);
          }
          if (attempt === 1) throw sanitizeInterpreterError(error);
          repairProblem = error?.code ?? 'invalid goal';
        }
      }
      throw sanitizedError('AI_INTERPRETATION_FAILED', 'The AI interpreter request failed.');
    },
  });
}

