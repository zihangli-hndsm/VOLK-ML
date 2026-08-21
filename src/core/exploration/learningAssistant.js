import { projectLearnerAnnotations } from './learnerAnnotations.js';

export const LEARNING_ASSISTANT_VERSION = 1;
export const MAX_LEARNING_TURNS = 8;
const MAX_CONTEXT_TEXT = 260;
const DEPTHS = new Set(['phenomenon', 'tune', 'evidence', 'mechanism', 'representation']);

const bounded = (value, max = MAX_CONTEXT_TEXT) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= max ? text : null;
};

export const LEARNING_ANSWER_SCHEMA = Object.freeze({
  name: 'volk_ml_learning_answer',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      answer: { type: 'string', minLength: 1, maxLength: 1200 },
      tryExperiment: { anyOf: [{ type: 'string', maxLength: 240 }, { type: 'null' }] },
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
    : bounded(value.tryExperiment, 240);
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
    'If a follow-up experiment would help, put a short learner-facing question in tryExperiment; it is only a suggestion and must be explicitly reviewed by the existing Experiment Agent.',
    `Bounded learning context: ${JSON.stringify(context)}`,
    `Learner question: ${String(question ?? '').trim().slice(0, 500)}`,
  ].join('\n\n');
}

export function createLearningConversationStore() {
  let turns = [];
  return Object.freeze({
    append(turn) {
      const role = turn?.role === 'assistant' ? 'assistant' : 'user';
      const text = bounded(turn?.text, 1200);
      if (!text) return null;
      const next = { role, text, at: Number.isFinite(turn?.at) ? turn.at : Date.now() };
      turns = [...turns, next].slice(-MAX_LEARNING_TURNS);
      return structuredClone(next);
    },
    snapshot() { return structuredClone(turns); },
    reset() { turns = []; },
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
      return { ...validateLearningAnswer(parsed), providerId: response.protocol };
    },
  });
}
