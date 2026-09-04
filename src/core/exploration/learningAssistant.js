import { projectLearnerAnnotations } from './learnerAnnotations.js';


export const LEARNING_ASSISTANT_VERSION = 1;
export const MAX_LEARNING_TURNS = 8;
export const LEARNING_MESSAGE_VERSION = 1;
export const EXPERIMENT_SUGGESTION_TASK_VERSION = 1;
export const EXPERIMENT_DESIGN_REQUEST_VERSION = 1;
const MAX_CONTEXT_TEXT = 260;
const DEPTHS = new Set(['phenomenon', 'tune', 'evidence', 'mechanism', 'representation']);

const bounded = (value, max = MAX_CONTEXT_TEXT) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= max ? text : null;
};

export const EXPERIMENT_SUGGESTION_TASK_SCHEMA = Object.freeze({
  name: 'volk_ml_experiment_suggestion_task',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      version: { type: 'integer', const: EXPERIMENT_SUGGESTION_TASK_VERSION },
      kind: { type: 'string', const: 'experiment-suggestion' },
      prompt: { type: 'string', minLength: 1, maxLength: 240 },
      source: { type: 'string', const: 'lumi' },
      requiresLearnerAcceptance: { type: 'boolean', const: true },
      intent: { anyOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] },
    },
    required: ['version', 'kind', 'prompt', 'source', 'requiresLearnerAcceptance'],
  },
});

const EXPERIMENT_DESIGN_GOALS = new Set(['class-separation', 'train-test-support-shift', 'observation-noise', 'outlier-sensitivity', 'more-same-distribution-data']);

export const EXPERIMENT_DESIGN_REQUEST_SCHEMA = Object.freeze({
  name: 'volk_ml_experiment_design_request',
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      version: { type: 'integer', const: EXPERIMENT_DESIGN_REQUEST_VERSION },
      kind: { type: 'string', const: 'experiment-design-request' },
      source: { type: 'string', const: 'lumi' },
      learnerQuestion: { type: 'string', minLength: 1, maxLength: 240 },
      goal: { type: 'string', enum: [...EXPERIMENT_DESIGN_GOALS] },
      requestedChange: { type: 'object', additionalProperties: false, properties: {
        factor: { type: 'string', maxLength: 64 }, direction: { type: 'string', maxLength: 32 }, scope: { type: 'string', maxLength: 32 },
      } },
      requestedHolds: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 120 } },
      requestedObservables: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 120 } },
      experimentDesign: { type: ['object', 'null'] },
      requiresLearnerAcceptance: { type: 'boolean', const: true },
    },
    required: ['version', 'kind', 'source', 'learnerQuestion', 'goal', 'requestedChange', 'requestedHolds', 'requestedObservables', 'requiresLearnerAcceptance'],
  },
});

export function createExperimentSuggestionTask(value) {
  if (typeof value === 'string') {
    const prompt = bounded(value, 240);
    return prompt ? Object.freeze({ version: EXPERIMENT_SUGGESTION_TASK_VERSION, kind: 'experiment-suggestion', prompt, source: 'lumi', requiresLearnerAcceptance: true }) : null;
  }
  if (value && typeof value === 'object' && !value.question && !value.learnerQuestion && value.prompt) {
    const prompt = bounded(value.prompt, 240);
    return prompt ? Object.freeze({ version: EXPERIMENT_SUGGESTION_TASK_VERSION, kind: 'experiment-suggestion', prompt, source: 'lumi', requiresLearnerAcceptance: true }) : null;
  }
  return createExperimentDesignRequest(value);
}

function designGoal(value, question) {
  const explicit = value?.goal ?? value?.design?.goal ?? value?.experimentDesign?.goal;
  if (typeof explicit === 'string' && EXPERIMENT_DESIGN_GOALS.has(explicit)) return explicit;
  const text = `${question} ${JSON.stringify(value?.requestedChange ?? value?.design?.requestedChange ?? '')}`;
  if (/sample|data|batch|更多|样本|数据/i.test(text) && /increase|more|add|增加|更多|提高/i.test(text)) return 'more-same-distribution-data';
  return null;
}

export function createExperimentDesignRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const learnerQuestion = bounded(value.question ?? value.learnerQuestion ?? value.prompt, 240);
  const goal = designGoal(value, learnerQuestion ?? '');
  if (!learnerQuestion || !goal) return null;
  const rawChange = value.requestedChange ?? value.design?.requestedChange;
  const requestedChange = rawChange && typeof rawChange === 'object'
    ? Object.fromEntries(['factor', 'direction', 'scope'].filter((key) => typeof rawChange[key] === 'string').map((key) => [key, rawChange[key].slice(0, 64)]))
    : goal === 'more-same-distribution-data' ? { factor: 'sample-size', direction: 'increase', scope: 'train' } : {};
  const requestedHolds = [...new Set((value.requestedHolds ?? value.design?.requestedHolds ?? [
    'world-generating-process', 'model-configuration', 'learning-configuration', 'evaluation-configuration',
  ]).filter((item) => typeof item === 'string').map((item) => item.slice(0, 120)))].slice(0, 12);
  const requestedObservables = [...new Set((value.requestedObservables ?? (goal === 'more-same-distribution-data'
    ? ['outcome.trainMse', 'outcome.testMse'] : [])).filter((item) => typeof item === 'string').map((item) => item.slice(0, 120)))].slice(0, 12);
  const design = value.experimentDesign ?? value.design;
  return Object.freeze({
    version: EXPERIMENT_DESIGN_REQUEST_VERSION,
    kind: 'experiment-design-request',
    source: 'lumi',
    learnerQuestion,
    goal,
    requestedChange,
    requestedHolds,
    requestedObservables,
    ...(design?.kind === 'exploration-design' ? { experimentDesign: structuredClone(design) } : {}),
    requiresLearnerAcceptance: true,
  });
}

// Presentation-only projection. Consumers must pass its designRequest through
// the planner boundary; question/message are never valid Agent task fields.
export function createLearnerExperimentSuggestion(value) {
  if (typeof value === 'string') {
    const question = bounded(value, 240);
    return question ? Object.freeze({ question, message: question, designRequest: null }) : null;
  }
  const designRequest = createExperimentDesignRequest(value);
  if (!designRequest) return null;
  return Object.freeze({
    question: designRequest.learnerQuestion,
    message: bounded(value?.message, 240),
    designRequest,
  });
}

export const LEARNING_ANSWER_SCHEMA = Object.freeze({
  name: 'volk_ml_learning_answer',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      answer: { type: 'string', minLength: 1, maxLength: 1200 },
      tryExperiment: { anyOf: [
        { type: 'string', maxLength: 240 },
        { type: 'object', additionalProperties: false, properties: {
          question: { type: 'string', minLength: 1, maxLength: 240 },
          message: { anyOf: [{ type: 'string', maxLength: 240 }, { type: 'null' }] },
          design: { type: 'object', additionalProperties: false, properties: {
            goal: { type: 'string', enum: [...EXPERIMENT_DESIGN_GOALS] },
            requestedChange: { type: 'object', additionalProperties: false, properties: {
              factor: { type: 'string', maxLength: 64 }, direction: { type: 'string', maxLength: 32 }, scope: { type: 'string', maxLength: 32 },
            } },
            requestedHolds: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 120 } },
            requestedObservables: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 120 } },
          }, required: ['goal'] },
        }, required: ['question', 'design'] },
        { type: 'null' },
      ] },
      depth: { anyOf: [{ type: 'string', enum: [...DEPTHS] }, { type: 'null' }] },
    },
    required: ['answer', 'tryExperiment', 'depth'],
  },
});

export function projectLearningAssistantContext({ context = {}, annotations = [], conversation = [], selectedAnchor = null, selectedQuote = null, learningUnitId = null, sourceVideoId = null, entryQuestion = null } = {}) {
  const inquiry = context.learnerInquiry ?? context.exploration?.learnerInquiry ?? {};
  const comparison = context.experimentWorkspace?.comparison ?? context.comparison ?? {};
  const diff = comparison.diff ?? {};
  const playground = context.playground ?? {};
  const projected = {
    version: LEARNING_ASSISTANT_VERSION,
    playground: {
      domain: bounded(playground.domain, 60),
      task: bounded(playground.task ?? context.data?.task, 60),
      modelKind: bounded(playground.modelAdapter ?? context.model?.adapterId, 80),
    },
    currentDepth: DEPTHS.has(context.presentation?.currentDepth) ? context.presentation.currentDepth : null,
    inquiryStage: bounded(inquiry.inquiryStage, 40),
    conceptIds: [...new Set((inquiry.candidates ?? []).map((item) => bounded(item?.conceptId, 100)).filter(Boolean))].slice(0, 6),
    observationIds: [...new Set([
      ...(inquiry.activeObservationIds ?? []),
      ...(inquiry.recentObservationIds ?? []),
    ].map((item) => bounded(item, 100)).filter(Boolean))].slice(0, 6),
    comparison: comparison.enabled ? {
      active: true,
      clarity: bounded(diff.clarity, 30),
      changedFactors: [...new Set((diff.changed ?? []).map((item) => bounded(item, 100)).filter(Boolean))].slice(0, 8),
    } : { active: false, clarity: null, changedFactors: [] },
    annotations: projectLearnerAnnotations(annotations, { activeOnly: true }).slice(0, 12),
    selectedAnchor: selectedAnchor && typeof selectedAnchor === 'object'
      ? projectLearnerAnnotations([{ version: 1, id: 'selection', actor: 'human', kind: 'ask-about-this', anchor: selectedAnchor, quote: null, createdAt: 0, resolvedAt: null }], { activeOnly: true })[0]?.anchor ?? null
      : null,
    selectedQuote: bounded(selectedQuote, 280),
    conversation: (Array.isArray(conversation) ? conversation : []).slice(-MAX_LEARNING_TURNS).map((turn) => ({
      id: bounded(turn?.id, 100),
      role: turn?.role === 'assistant' ? 'assistant' : 'user',
      text: bounded(turn?.text, 400),
    })).filter((turn) => turn.text),
    ...(bounded(learningUnitId, 100) ? { learningUnitId: bounded(learningUnitId, 100) } : {}),
    ...(bounded(sourceVideoId, 100) ? { sourceVideoId: bounded(sourceVideoId, 100) } : {}),
    ...(bounded(entryQuestion, 240) ? { entryQuestion: bounded(entryQuestion, 240) } : {}),
  };
  return structuredClone(projected);
}

export function validateLearningAnswer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI_LEARNING_ANSWER_INVALID');
  const answer = bounded(value.answer, 1200);
  const tryExperiment = value.tryExperiment === null || value.tryExperiment === undefined
    ? null
    : typeof value.tryExperiment === 'string'
      ? bounded(value.tryExperiment, 240)
      : value.tryExperiment && typeof value.tryExperiment === 'object' && !Array.isArray(value.tryExperiment)
        ? (() => {
          const question = bounded(value.tryExperiment.question, 240);
          const design = value.tryExperiment.design;
          const goal = design?.goal;
          if (!question || !design || !EXPERIMENT_DESIGN_GOALS.has(goal)) return null;
          return {
            question,
            message: value.tryExperiment.message === null || value.tryExperiment.message === undefined ? null : bounded(value.tryExperiment.message, 240),
            design: {
              goal,
              ...(design.requestedChange && typeof design.requestedChange === 'object' ? { requestedChange: Object.fromEntries(['factor', 'direction', 'scope'].filter((key) => typeof design.requestedChange[key] === 'string').map((key) => [key, design.requestedChange[key].slice(0, 64)])) } : {}),
              ...(Array.isArray(design.requestedHolds) ? { requestedHolds: design.requestedHolds.filter((item) => typeof item === 'string').slice(0, 12) } : {}),
              ...(Array.isArray(design.requestedObservables) ? { requestedObservables: design.requestedObservables.filter((item) => typeof item === 'string').slice(0, 12) } : {}),
            },
          };
        })()
        : null;
  const depth = value.depth === null || value.depth === undefined ? null : DEPTHS.has(value.depth) ? value.depth : null;
  if (!answer || (value.tryExperiment !== null && value.tryExperiment !== undefined && !tryExperiment)
    || (value.depth !== null && value.depth !== undefined && !depth)) throw new Error('AI_LEARNING_ANSWER_INVALID');
  return { version: LEARNING_ASSISTANT_VERSION, answer, tryExperiment, depth };
}

export function learningAssistantPrompt({ question, context } = {}) {
  return [
    'Answer the learner as VOLK-ML embedded learning assistant.',
    'Return JSON only with answer, tryExperiment, and depth.',
    'This is an answer-only request. Never execute actions, emit operations, mutate World or Experiment state, or claim to have run an experiment.',
    'Runtime facts and supplied evidence are authoritative. Do not invent metrics, observations, data, or hidden application state.',
    'Explain concepts plainly and distinguish a conceptual explanation from measured runtime evidence.',
    'If a follow-up experiment suggestion would help, return tryExperiment as {question, design:{goal, requestedChange?, requestedHolds?, requestedObservables?}}. The question is learner-facing copy; design is structured semantic intent reviewed by the existing Experiment Agent. Never return confirmation copy as a task.',
    `Bounded learning context: ${JSON.stringify(context)}`,
    `Learner question: ${String(question ?? '').trim().slice(0, 500)}`,
  ].join('\n\n');
}

export function createLearningConversationStore() {
  let turns = [];
  let sequence = 0;
  return Object.freeze({
    append(turn) {
      const role = turn?.role === 'assistant' ? 'assistant' : 'user';
      const text = bounded(turn?.text, 1200);
      if (!text) return null;
      const next = {
        version: LEARNING_MESSAGE_VERSION,
        id: `learning-message-${++sequence}`,
        role,
        text,
        at: Number.isFinite(turn?.at) ? turn.at : Date.now(),
      };
      turns = [...turns, next].slice(-MAX_LEARNING_TURNS);
      return structuredClone(next);
    },
    snapshot() { return structuredClone(turns); },
    reset() { turns = []; sequence = 0; },
  });
}

export function createLearningAssistant({ gateway } = {}) {
  return Object.freeze({
    async ask({ question, config, context } = {}) {
      if (!config?.apiKey?.trim()) {
        const error = new Error('Configure a provider to use Ask VOLK.');
        error.code = 'AI_CONFIG_MISSING';
        throw error;
      }
      const response = await gateway.complete({
        config,
        system: 'Deterministic runtime code remains authoritative. You provide bounded conceptual language only.',
        messages: [{ role: 'user', content: learningAssistantPrompt({ question, context }) }],
        responseMode: 'json',
        responseSchema: LEARNING_ANSWER_SCHEMA,
      });
      let parsed;
      try { parsed = JSON.parse(response.text); } catch {
        const error = new Error('The learning assistant returned invalid JSON.');
        error.code = 'AI_RESPONSE_INVALID';
        throw error;
      }
      try {
        const answer = validateLearningAnswer(parsed);
        gateway.recordTrace?.({ stage: 'interpreter-validation', protocol: response.protocol, model: response.model, status: 'passed' });
        return { ...answer, providerId: response.protocol };
      } catch (error) {
        gateway.recordTrace?.({ stage: 'interpreter-validation', protocol: response.protocol, model: response.model, status: 'failed' });
        throw error;
      }
    },
  });
}
