import { normalizeAiConfig } from '../ai/aiSettings.js';
import { createProviderGateway } from '../ai/providerRegistry.js';
import { EXPLORATION_INTENT_IDS } from './explorationIntents.js';

const INTENTS = EXPLORATION_INTENT_IDS;

function interpreterError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.details = {};
  return error;
}

function parseJsonText(text) {
  const raw = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape');
    return value;
  } catch {
    throw interpreterError('AI_INVALID_EXPLORATION_INTERPRETATION', 'The AI interpreter returned an invalid exploration interpretation.');
  }
}

function validateInterpretation(value) {
  if (!INTENTS.includes(value.intent)) {
    throw interpreterError('AI_INVALID_EXPLORATION_INTERPRETATION', 'The AI interpreter selected an unsupported exploration intent.');
  }
  if (value.requestedHolds !== undefined && (!Array.isArray(value.requestedHolds) || value.requestedHolds.some((item) => typeof item !== 'string'))) {
    throw interpreterError('AI_INVALID_EXPLORATION_INTERPRETATION', 'The AI interpreter returned invalid requested holds.');
  }
  return {
    intent: value.intent,
    requestedChange: typeof value.requestedChange === 'string' ? value.requestedChange : null,
    requestedHolds: [...(value.requestedHolds ?? [])],
    ambiguity: value.ambiguity ?? null,
  };
}

export function projectExplorationAiContext(context = {}) {
  const comparison = context?.experimentWorkspace?.comparison;
  const recentActions = (context?.recentWorldActions ?? context?.exploration?.recentWorldActions ?? [])
    .slice(-10)
    .map((action) => ({
      actor: action.actor ?? null,
      intent: action.intent ?? null,
      operationTypes: Array.isArray(action.operationTypes) ? [...action.operationTypes] : [],
      reversible: Boolean(action.reversible),
    }));
  return {
    modelKind: context?.playground?.modelAdapter ?? context?.playground?.modelAdapterId ?? null,
    task: context?.data?.task ?? context?.playground?.task ?? null,
    currentDepth: context?.presentation?.currentDepth ?? null,
    comparisonActive: Boolean(context?.presentation?.comparisonActive ?? comparison?.enabled),
    availableDepths: Array.isArray(context?.presentation?.availableDepths) ? [...context.presentation.availableDepths] : [],
    changedSemanticDimensions: [
      ...(context?.presentation?.changedSemanticDimensions ?? comparison?.diff?.changed ?? []),
    ],
    supportedOperationTypes: [...new Set((context?.exploration?.worldOperations ?? []).map((operation) => operation.type))],
    recentActions,
  };
}

function promptFor({ request, context }) {
  return [
    'Interpret the learner request into one high-level VOLK-ML exploration intent.',
    'Return JSON only. Never return runtime operations, operation IDs, control IDs, observable IDs, code, or a ScenarioSpec.',
    `Allowed intents: ${INTENTS.join(', ')}`,
    'The deterministic planner and capability registry will choose all executable operations after this response.',
    `Bounded semantic context: ${JSON.stringify(projectExplorationAiContext(context))}`,
    'Shape: {"intent":"...","requestedChange":"...","requestedHolds":["..."],"ambiguity":null}',
    `Learner request: ${String(request ?? '').trim()}`,
  ].join('\n\n');
}

export function createExplorationAiInterpreter({ gateway, fetchImpl = globalThis.fetch } = {}) {
  const providerGateway = gateway ?? createProviderGateway({ fetchImpl });
  return Object.freeze({
    async interpret({ request, context, config, providerId = 'openai-compatible', apiKey, model, endpoint }) {
      const resolvedConfig = normalizeAiConfig(config ?? { protocol: providerId, apiKey, model, endpoint });
      if (!resolvedConfig) throw interpreterError('AI_PROVIDER_UNSUPPORTED', 'The selected AI protocol is not supported.');
      try {
        const response = await providerGateway.complete({
          config: resolvedConfig,
          system: 'You are VOLK-ML\'s high-level exploration intent interpreter. Deterministic code remains authoritative.',
          messages: [{ role: 'user', content: promptFor({ request, context }) }],
          responseMode: 'json',
        });
        return { ...validateInterpretation(parseJsonText(response.text)), providerId: response.protocol };
      } catch (error) {
        if (error?.code?.startsWith('AI_')) throw error;
        throw interpreterError('AI_PROVIDER_UNAVAILABLE', 'The exploration AI interpreter is unavailable.');
      }
    },
  });
}

export const explorationIntentIds = Object.freeze([...INTENTS]);
