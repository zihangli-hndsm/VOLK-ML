import { normalizeAiConfig } from '../ai/aiSettings.js';
import { createProviderGateway } from '../ai/providerRegistry.js';
import { EXPLORATION_INTENT_IDS } from './explorationIntents.js';
import { applyWorldRecipePatch, normalizeWorldRecipe, worldRecipeJsonSchema, worldRecipePatchJsonSchema } from './worldRecipe.js';
import { pedagogicalExperimentSchema, validateExplorationDesign, pedagogicalGoalIds } from './pedagogicalExperiment.js';
import { canonicalizePedagogicalObservation } from './pedagogicalObservation.js';
import { projectCuriosityContext } from './curiosity.js';
import { normalizeRequestedHolds, requestedHoldsJsonSchema } from './requestedHolds.js';

const INTENTS = EXPLORATION_INTENT_IDS;
const EXPLANATION_TOPICS = Object.freeze(['slope', 'bias', 'training-step', 'test-error', 'comparison', 'model-capacity', 'learning-rate']);
const GUIDANCE_KINDS = Object.freeze(['explanation', 'navigation', 'experiment', 'world-design', 'clarification']);

const nullableStringSchema = () => ({ anyOf: [{ type: 'string' }, { type: 'null' }] });

export function explorationGuidanceResponseSchema({ availableDepths = [] } = {}) {
  const depths = availableDepths.length ? availableDepths : ['unavailable'];
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: GUIDANCE_KINDS },
      topic: { anyOf: [{ type: 'string', enum: EXPLANATION_TOPICS }, { type: 'null' }] },
      explanation: nullableStringSchema(),
      depth: { anyOf: [{ type: 'string', enum: depths }, { type: 'null' }] },
      intent: { anyOf: [{ type: 'string', enum: INTENTS }, { type: 'null' }] },
      requestedChange: nullableStringSchema(),
      requestedHolds: requestedHoldsJsonSchema(),
      design: { anyOf: [{ type: 'object', additionalProperties: false, properties: {
        mode: { type: 'string', enum: ['create', 'edit'] },
        recipe: { anyOf: [worldRecipeJsonSchema(), { type: 'null' }] },
        patch: { anyOf: [worldRecipePatchJsonSchema(), { type: 'null' }] },
      }, required: ['mode', 'recipe', 'patch'] }, { type: 'null' }] },
      experimentDesign: { anyOf: [pedagogicalExperimentSchema(), { type: 'null' }] },
      reason: nullableStringSchema(),
      ambiguity: nullableStringSchema(),
    },
    required: ['kind', 'topic', 'explanation', 'depth', 'intent', 'requestedChange', 'requestedHolds', 'design', 'experimentDesign', 'reason', 'ambiguity'],
  };
}

function interpreterError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.details = {};
  return error;
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
          const value = JSON.parse(raw.slice(start, index + 1));
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape');
          return value;
        } catch {
          throw interpreterError('AI_INVALID_EXPLORATION_INTERPRETATION', 'The AI interpreter returned an invalid exploration interpretation.');
        }
      }
    }
  }
  throw interpreterError('AI_INVALID_EXPLORATION_INTERPRETATION', 'The AI interpreter returned an invalid exploration interpretation.');
}

function validateInterpretation(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw interpreterError('AI_INVALID_EXPLORATION_INTERPRETATION', 'The AI interpreter returned an invalid exploration interpretation.');
  }
  if (value.kind === 'explanation') {
    if (!EXPLANATION_TOPICS.includes(value.topic)) {
      throw interpreterError('AI_INVALID_EXPLORATION_INTERPRETATION', 'The AI interpreter selected an unsupported explanation topic.');
    }
    return {
      kind: 'explanation',
      topic: value.topic,
      explanation: typeof value.explanation === 'string' ? value.explanation.slice(0, 600) : null,
      ambiguity: value.ambiguity ?? null,
    };
  }
  if (value.kind === 'navigation') {
    const availableDepths = Array.isArray(context?.presentation?.availableDepths) ? context.presentation.availableDepths : [];
    if (typeof value.depth !== 'string' || !availableDepths.includes(value.depth)) {
      throw interpreterError('AI_INVALID_EXPLORATION_INTERPRETATION', 'The AI interpreter selected an unavailable conceptual depth.');
    }
    return { kind: 'navigation', depth: value.depth, ambiguity: value.ambiguity ?? null };
  }
  if (value.kind === 'clarification') {
    const reason = typeof value.reason === 'string' ? value.reason.slice(0, 240) : '';
    return { kind: 'clarification', reason: reason || 'unsupported-request', ambiguity: value.ambiguity ?? null };
  }
  if (value.kind === 'world-design') {
    const design = value.design;
    if (!design || !['create', 'edit'].includes(design.mode)) {
      throw interpreterError('AI_INVALID_EXPLORATION_INTERPRETATION', 'The AI interpreter returned an invalid World design mode.');
    }
    try {
      const recipe = design.mode === 'create' && design.recipe ? normalizeWorldRecipe(design.recipe) : null;
      const patch = design.mode === 'edit' && design.patch ? structuredClone(design.patch) : null;
      if (design.mode === 'create' && !recipe) throw new Error('recipe-required');
      if (design.mode === 'edit' && !patch) throw new Error('patch-required');
      if (patch && context?.world?.generator?.kind === 'world-recipe') applyWorldRecipePatch(context.world.generator.recipe, patch);
      const normalizedHolds = normalizeRequestedHolds(value.requestedHolds);
      return {
        kind: 'world-design',
        design: { mode: design.mode, recipe, patch },
        requestedHolds: normalizedHolds.holds,
        requestedHoldsNormalization: normalizedHolds.details,
        ambiguity: value.ambiguity ?? null,
      };
    } catch (error) {
      if (error?.code === 'AI_INVALID_REQUESTED_HOLDS') throw error;
      throw interpreterError('AI_INVALID_EXPLORATION_INTERPRETATION', 'The AI interpreter returned an invalid World design.');
    }
  }
  if (value.kind === 'experiment' || (!value.kind && value.intent)) {
    if (value.experimentDesign === null || value.experimentDesign === undefined) {
      if (!INTENTS.includes(value.intent)) {
      throw interpreterError('AI_INVALID_EXPLORATION_INTERPRETATION', 'The AI interpreter selected an unsupported exploration intent.');
      }
    }
    let normalizedHolds;
    try {
      normalizedHolds = normalizeRequestedHolds(value.requestedHolds);
    } catch (error) {
      if (error?.code === 'AI_INVALID_REQUESTED_HOLDS') throw error;
      throw interpreterError('AI_INVALID_EXPLORATION_INTERPRETATION', 'The AI interpreter returned invalid requested holds.');
    }
    let experimentDesign = null;
    if (value.experimentDesign !== null && value.experimentDesign !== undefined) {
      try {
        experimentDesign = validateExplorationDesign(value.experimentDesign, { context });
      } catch {
        throw interpreterError('AI_INVALID_EXPLORATION_INTERPRETATION', 'The AI interpreter returned an invalid pedagogical experiment design.');
      }
    }
    return {
      kind: 'experiment',
      intent: value.intent,
      design: experimentDesign,
      requestedChange: typeof value.requestedChange === 'string' ? value.requestedChange.slice(0, 240) : null,
      requestedHolds: normalizedHolds.holds,
      requestedHoldsNormalization: normalizedHolds.details,
      ambiguity: value.ambiguity ?? null,
    };
  }
  throw interpreterError('AI_INVALID_EXPLORATION_INTERPRETATION', 'The AI interpreter returned an unsupported guidance kind.');
}

export function projectExplorationAiContext(context = {}) {
  const comparison = context?.experimentWorkspace?.comparison;
  const curiosity = projectCuriosityContext(context?.curiosity ?? context?.exploration?.curiosity);
  const canonicalObservation = canonicalizePedagogicalObservation(context?.pedagogicalObservation);
  const pedagogicalObservation = canonicalObservation
    ? {
      version: canonicalObservation.version,
      goal: canonicalObservation.goal,
      facts: canonicalObservation.facts,
      changed: canonicalObservation.changed,
      held: canonicalObservation.held,
      summaryKey: canonicalObservation.summaryKey,
    }
    : null;
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
    supportedConcepts: [...EXPLANATION_TOPICS],
    supportedExperimentGoals: pedagogicalGoalIds(),
    pedagogicalObservation,
    curiosity,
    recentActions,
    worldComposer: context?.exploration?.worldComposer ?? null,
    domainContext: context?.domainContext ?? context?.exploration?.contextProjection ?? null,
  };
}

function promptFor({ request, context }) {
  const availableDepths = Array.isArray(context?.presentation?.availableDepths)
    ? context.presentation.availableDepths
    : [];
  const exampleDepth = availableDepths[0] ?? 'unavailable';
  const responseExample = (label, overrides = {}) => `Response example (${label}): ${JSON.stringify({
    kind: 'explanation',
    topic: null,
    explanation: null,
    depth: null,
    intent: null,
    requestedChange: null,
    requestedHolds: [],
    design: null,
    experimentDesign: null,
    reason: null,
    ambiguity: null,
    ...overrides,
  })}`;
  return [
    'Interpret the learner request into one bounded high-level VOLK-ML guidance outcome.',
    'Return JSON only. Never return runtime operations, operation IDs, control IDs, observable IDs, code, or a ScenarioSpec.',
    `Allowed outcome kinds: ${GUIDANCE_KINDS.join(', ')}`,
    `Allowed exploration intents: ${INTENTS.join(', ')}`,
    'When the learner asks a testable curiosity question, prefer experimentDesign with one supported goal over a lecture or arbitrary World.',
    'For requests about classes overlapping, use the truthful class-separation goal: move one class closer and observe the outcome; do not claim that geometric overlap was measured.',
    'World-design is bounded to a validated recipe or recipe patch. Never emit points, runtime operations, evidence, or metrics.',
    ...(context?.pedagogicalObservation?.available ? [
      'The PedagogicalObservation facts in context are authoritative deterministic facts from the runtime.',
      'Never overwrite, recompute, invent, round into different values, or contradict their numeric values.',
      'Never claim that an unmeasured variable changed, and never turn co-occurrence into causality.',
      'When explaining the result, distinguish FACT, HYPOTHESIS / INTERPRETATION, and NEXT TEST.',
      'If causal evidence is insufficient, use language such as "is consistent with", "one possible interpretation is", or "we can test that by...".',
      'For class-separation, never say or imply that geometric overlap increased.',
      'The AI cannot author canonical observation/evidence or authorize runtime execution.',
    ] : []),
    ...(context?.curiosity?.available || context?.exploration?.curiosity?.available ? [
      'Curiosity is a deterministic unresolved exploration opportunity, not a diagnosis of confusion, ability, or learner knowledge.',
      'The supplied curiosity gap, related concept, question key, and available action are authoritative bounded context. Do not invent new curiosity types or concept IDs.',
      'You may phrase a supplied reflection question, but do not create runtime operations, observations, metrics, or causal conclusions from it.',
      'If the supplied evidence is insufficient, preserve uncertainty and frame any interpretation as a possible idea to test.',
    ] : []),
    `Allowed explanation topics: ${EXPLANATION_TOPICS.join(', ')}`,
    'The deterministic planner and capability registry will choose all executable operations after this response.',
    `Bounded semantic context: ${JSON.stringify(projectExplorationAiContext(context))}`,
    responseExample('explanation', { kind: 'explanation', topic: 'comparison', explanation: 'short conceptual explanation' }),
    responseExample('navigation', { kind: 'navigation', depth: exampleDepth }),
    responseExample('experiment-hold-realized-world', {
      kind: 'experiment',
      intent: 'learning-rate-increase',
      requestedChange: 'increase the learning rate',
      requestedHolds: ['world'],
    }),
    responseExample('experiment-hold-world-process', {
      kind: 'experiment',
      intent: 'more-data',
      requestedChange: 'increase same-distribution training data',
      requestedHolds: ['world-generating-process'],
    }),
    responseExample('pedagogical-experiment', {
      kind: 'experiment',
      experimentDesign: {
        version: 1,
        kind: 'exploration-design',
        goal: 'more-same-distribution-data',
        intervention: 'increase-same-distribution-sample-size',
        evidence: 'outcome-and-stability',
        prediction: null,
      },
    }),
    responseExample('world-design', {
      kind: 'world-design',
      design: {
        mode: 'edit',
        recipe: null,
        patch: {
          version: 1,
          changes: [{ type: 'SET_NOISE', split: 'train', kind: 'position', amount: 0.1 }],
        },
      },
    }),
    responseExample('clarification', {
      kind: 'clarification',
      reason: 'short bounded reason',
      ambiguity: 'short bounded ambiguity',
    }),
    'requestedHolds semantics: ["world"] means hold the current realized World identity/state. ["world-generating-process"] means hold the generating relation/process; it is distinct from the realized World and must not be substituted for it.',
    'Invalid requestedHolds examples (reject rather than emit): ["constructor"] (unknown ID), ["keep everything else unchanged"] (prose), ["world","noise"] (contradictory broad realized-World hold plus a noise change), and ["world","world-generating-process"] (ambiguous broad and specific World holds).',
    'requestedHolds may be null or omitted to mean no additional model-supplied hold. Use only canonical IDs: world, world-generating-process, latent-relation, noise, model-configuration, learning-configuration, evaluation-configuration, existing-train-test-setup, train-distribution, test-distribution, train-sample-count, train-world, test-world, randomness-policy. Exact compatibility aliases may be normalized at the compatibility boundary; do not prefer aliases in new output. Unknown, prose, contradictory, and over-limit holds are invalid.',
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
          responseSchema: {
            name: 'volk_ml_exploration_guidance',
            schema: explorationGuidanceResponseSchema({
              availableDepths: context?.presentation?.availableDepths ?? [],
            }),
          },
        });
        const parsed = parseJsonText(response.text);
        const validated = validateInterpretation(parsed, context);
        providerGateway.recordTrace?.({ stage: 'interpreter-validation', protocol: response.protocol, model: response.model, status: 'passed' });
        return { ...validated, providerId: response.protocol };
      } catch (error) {
        providerGateway.recordTrace?.({ stage: 'interpreter-validation', status: 'failed' });
        if (error?.code?.startsWith('AI_')) throw error;
        throw interpreterError('AI_PROVIDER_UNAVAILABLE', 'The exploration AI interpreter is unavailable.');
      }
    },
  });
}

export const explorationIntentIds = Object.freeze([...INTENTS]);
