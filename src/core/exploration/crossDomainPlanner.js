import { conditionFingerprintForSession } from './observables.js';
import { scenarioError } from './scenarioSpec.js';

export const CROSS_DOMAIN_INTENTS = Object.freeze({
  DOMAIN_CONTROL: 'domain-control',
  DOMAIN_REPRESENTATION: 'domain-representation',
});

const RULES = Object.freeze({
  image: { controls: ['trainingSteps', 'learningRate'], observables: ['outcome.trainAccuracy', 'outcome.testAccuracy'], depth: 'representation' },
  sequence: { controls: ['attentionTemperature', 'trainingSteps'], observables: ['outcome.trainAccuracy', 'outcome.testAccuracy'], depth: 'mechanism' },
  retrieval: { controls: ['topK', 'embeddingDimensions'], observables: ['outcome.retrievalScore'], depth: 'representation' },
  rag: { controls: ['topK', 'embeddingDimensions'], observables: ['outcome.groundedSourceCount'], depth: 'representation' },
});

const clone = (value) => structuredClone(value);

function ruleFor(context) {
  return RULES[context?.playground?.domain ?? context?.exploration?.domain?.id] ?? null;
}

function nextValue(schema, current, direction = 'increase') {
  if (schema.type === 'select') {
    const options = [...(schema.options ?? [])];
    const index = options.findIndex((value) => String(value) === String(current));
    const nextIndex = direction === 'decrease' ? index - 1 : index + 1;
    return options[nextIndex] ?? null;
  }
  const number = Number(current);
  const step = Number(schema.step ?? 1);
  const candidate = direction === 'decrease' ? number - step : number + step;
  if (!Number.isFinite(candidate) || candidate < Number(schema.min) || candidate > Number(schema.max)) return null;
  return Number(candidate.toFixed(6));
}

function baseline(context) {
  return {
    experimentId: context.experiment.id,
    conditionFingerprint: context.conditionFingerprint
      ?? conditionFingerprintForSession({
        world: context.world,
        adapterId: context.experiment.model?.adapterId,
        experiment: context.experiment,
      }),
  };
}

function scenarioForControl({ request, context, key, value, rule }) {
  const schema = (context.controlSchemas ?? []).find((item) => item.key === key);
  if (!schema || schema.domain === 'view') throw scenarioError('EXPLORATION_SCENARIO_UNSUPPORTED_CONTROL', { key });
  return {
    version: 1,
    request,
    baseline: baseline(context),
    interpretation: {
      summary: `Change only ${key} in the current ${context.playground.domain} model condition and compare the result.`,
      ambiguity: null,
    },
    // Keep the existing canonical fidelity factor. The precise control path
    // remains in the SET_CONTROL parameters and comparison details.
    change: [{ semanticTarget: 'model-configuration', operation: 'SET_CONTROL', parameters: { key, value } }],
    hold: ['world', 'model-configuration', 'learning-configuration', 'evaluation-configuration', 'randomness-policy'],
    observe: [...rule.observables],
    execution: { duplicateBaseline: true, run: true, compare: true, repeat: null },
  };
}

export function planCrossDomainIntent(intent, request, context) {
  const rule = ruleFor(context);
  if (!rule) return null;
  if (intent === CROSS_DOMAIN_INTENTS.DOMAIN_REPRESENTATION) {
    return {
      kind: 'navigation',
      request,
      depth: rule.depth,
      interpretation: { kind: 'navigation', depth: rule.depth, ambiguity: null },
    };
  }
  if (intent !== CROSS_DOMAIN_INTENTS.DOMAIN_CONTROL) return null;
  const text = String(request ?? '').toLowerCase();
  const schema = rule.controls
    .map((key) => (context.controlSchemas ?? []).find((item) => item.key === key))
    .find((item) => item && new RegExp(item.key.replace(/[A-Z]/g, (letter) => `[-_${letter.toLowerCase()}]`)).test(text))
    ?? (rule.controls.length === 1 ? (context.controlSchemas ?? []).find((item) => item.key === rule.controls[0]) : null);
  if (!schema) return null;
  const direction = /lower|decrease|smaller|slower|reduce|降低|减少|变小/i.test(text) ? 'decrease' : 'increase';
  const value = nextValue(schema, context.controls?.[schema.key], direction);
  if (value === null || value === undefined) return null;
  return {
    kind: 'proposal',
    request,
    scenario: scenarioForControl({ request, context, key: schema.key, value, rule }),
    interpretation: { kind: 'domain-experiment', domain: context.playground.domain, control: schema.key },
  };
}

export function planCrossDomainRequest(request, context) {
  const text = String(request ?? '').trim();
  if (!text) return null;
  const rule = ruleFor(context);
  if (!rule) return null;
  if (/(show|inspect|see|look at|feature map|embedding|attention|sources|grounding|显示|查看|注意力|特征图|嵌入|来源|引用)/i.test(text)
    && !/(what happens|what if|try|increase|decrease|改变|增加|减少|如果)/i.test(text)) {
    return planCrossDomainIntent(CROSS_DOMAIN_INTENTS.DOMAIN_REPRESENTATION, request, context);
  }
  if (/(what happens|what if|try|increase|decrease|change|影响|增加|减少|改变|提高|降低)/i.test(text)) {
    return planCrossDomainIntent(CROSS_DOMAIN_INTENTS.DOMAIN_CONTROL, request, context);
  }
  return null;
}

export function crossDomainControlKeys(domain) {
  return [...(RULES[domain]?.controls ?? [])];
}

export function crossDomainRule(domain) {
  return RULES[domain] ? clone(RULES[domain]) : null;
}
