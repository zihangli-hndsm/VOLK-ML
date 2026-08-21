import assert from 'node:assert/strict';
import {
  LEARNING_ANSWER_SCHEMA,
  createLearningAssistant,
  createLearningConversationStore,
  learningAssistantPrompt,
  projectLearningAssistantContext,
  validateLearningAnswer,
} from '../src/core/exploration/learningAssistant.js';

const rawContext = {
  apiKey: 'secret-key',
  playground: { task: 'classification', modelAdapter: 'knn', domain: 'exploration' },
  world: { observations: [{ id: 'point-1', features: { x: 99, y: 100 }, target: 'A' }], rows: [{ x: 99 }] },
  experimentWorkspace: { comparison: { enabled: true, diff: { clarity: 'clear', changed: ['learning.controls.k'] } } },
  learnerInquiry: { inquiryStage: 'evidence', candidates: [{ conceptId: 'controlled-comparison' }], activeObservationIds: ['observation-1'] },
};
const projected = projectLearningAssistantContext({
  context: rawContext,
  annotations: [{ version: 1, id: 'annotation-1', actor: 'human', kind: 'unclear', anchor: { surface: 'agent-answer', contentId: 'answer-1' }, quote: 'Explain this', createdAt: 1, resolvedAt: null }],
  conversation: [{ role: 'user', text: 'What changed?' }],
  selectedAnchor: { surface: 'agent-answer', contentId: 'answer-1' },
  selectedQuote: 'Explain this',
});
assert.equal(JSON.stringify(projected).includes('secret-key'), false, 'provider context does not include API keys');
assert.equal(JSON.stringify(projected).includes('point-1'), false, 'provider context does not include point IDs');
assert.equal(JSON.stringify(projected).includes('99'), false, 'provider context does not include raw coordinates or rows');
assert.equal(projected.selectedQuote, 'Explain this', 'selected text is bounded and explicit');
assert.equal(projected.annotations.length, 1, 'bounded learner annotations are available to the assistant');

const calls = [];
const gateway = {
  async complete(request) {
    calls.push(request);
    return { protocol: 'fake', text: request.responseMode === 'json' ? JSON.stringify({ answer: 'Use the evidence already shown.', tryExperiment: 'Try changing one supported factor.', depth: 'evidence' }) : 'OK' };
  },
};
const assistant = createLearningAssistant({ gateway });
const answer = await assistant.ask({ question: 'What should I notice?', config: { apiKey: 'secret', protocol: 'fake', model: 'fake-model' }, context: projected });
assert.deepEqual(answer, { version: 1, answer: 'Use the evidence already shown.', tryExperiment: 'Try changing one supported factor.', depth: 'evidence', providerId: 'fake' }, 'assistant returns only the bounded answer contract');
assert.equal(calls.length, 1, 'Ask VOLK uses one answer-only provider request');
assert.equal(calls[0].responseSchema, LEARNING_ANSWER_SCHEMA, 'provider receives the bounded answer schema');
assert.match(calls[0].messages[0].content, /never execute actions/i, 'prompt denies runtime execution');
assert.match(calls[0].messages[0].content, /authoritative/i, 'prompt preserves runtime authority');
assert.equal(calls[0].messages[0].content.includes('point-1'), false, 'prompt does not contain raw point identifiers');

assert.throws(() => validateLearningAnswer({ answer: 'ok', tryExperiment: { operation: 'SET_CONTROL' }, depth: null }), /AI_LEARNING_ANSWER_INVALID/);
assert.throws(() => validateLearningAnswer({ answer: 'ok', tryExperiment: null, depth: 'arbitrary-command' }), /AI_LEARNING_ANSWER_INVALID/);
assert.match(learningAssistantPrompt({ question: 'Why?', context: projected }), /suggestion/);

const conversations = createLearningConversationStore();
const firstMessage = conversations.append({ role: 'user', text: 'first', at: 0 });
const secondMessage = conversations.append({ role: 'assistant', text: 'second', at: 1 });
assert.notEqual(firstMessage.id, secondMessage.id, 'conversation turns have stable unique identities');
assert.match(firstMessage.id, /^learning-message-/);
for (let index = 0; index < 20; index += 1) conversations.append({ role: index % 2 ? 'assistant' : 'user', text: `turn-${index}`, at: index });
assert.equal(conversations.snapshot().length, 8, 'conversation history is bounded');
assert.equal(conversations.snapshot()[0].text, 'turn-12', 'only the newest bounded turns are retained');

console.log('Learning assistant checks passed: bounded provider context, answer-only schema, no runtime authority, safe annotations, and bounded conversation history.');
