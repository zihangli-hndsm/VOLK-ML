import assert from 'node:assert/strict';
import { createProviderGateway, getProviderProtocol, textFromResponsesPayload } from '../src/core/ai/providerRegistry.js';
import { defaultAiConfig, normalizeAiConfig } from '../src/core/ai/aiSettings.js';
import { createLlmGoalInterpreter, teachingGoalResponseSchema } from '../src/core/playground/agent/llmGoalInterpreter.js';
import { createExplorationAiInterpreter, explorationGuidanceResponseSchema } from '../src/core/exploration/explorationAiInterpreter.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createPlaygroundAgentApi } from '../src/core/playgroundAgent.js';

assert.equal(getProviderProtocol('openai-responses').defaultEndpoint, 'https://api.openai.com/v1/responses');
assert.equal(getProviderProtocol('openai-compatible').defaultEndpoint, 'https://api.openai.com/v1/chat/completions');
assert.equal(defaultAiConfig().protocol, 'openai-responses');
assert.equal(normalizeAiConfig({ protocol: 'openai-compatible', model: 'legacy', apiKey: 'key' }).protocol, 'openai-compatible');

const teachingSchema = teachingGoalResponseSchema({ allowedControls: [{ key: 'hiddenUnits' }] });
const explorationSchema = explorationGuidanceResponseSchema({ availableDepths: ['evidence', 'mechanism', 'representation'] });
assert.deepEqual(teachingSchema.properties.type.enum, ['explain-process', 'compare-control', 'what-if']);
assert.deepEqual(teachingSchema.properties.control.anyOf[0].enum, ['hiddenUnits']);
assert.equal(teachingSchema.properties.values.anyOf[0].maxItems, 2);
assert.ok(explorationSchema.properties.kind.enum.includes('navigation'));
assert.equal(teachingSchema.additionalProperties, false);
assert.equal(explorationSchema.additionalProperties, false);
const worldDesignSchema = explorationSchema.properties.design.anyOf[0];
const worldPatchSchema = worldDesignSchema.properties.patch.anyOf[0];
assert.equal(worldPatchSchema.additionalProperties, false);
assert.equal(worldPatchSchema.properties.changes.items.anyOf.length, 8);
assert.ok(worldPatchSchema.properties.changes.items.anyOf.every((variant) => variant.additionalProperties === false || variant.anyOf?.every((nested) => nested.additionalProperties === false)));
const noiseVariant = worldPatchSchema.properties.changes.items.anyOf.find((variant) => variant.anyOf?.some((nested) => nested.properties?.type?.const === 'SET_NOISE'));
assert.ok(noiseVariant.anyOf.some((variant) => variant.properties?.kind?.const === 'position'));
assert.ok(noiseVariant.anyOf.some((variant) => variant.properties?.kind?.const === 'label'));

let requestedUrl = '';
let requestedBody = null;
const nativeGateway = createProviderGateway({ fetchImpl: async (url, options) => {
  requestedUrl = url;
  requestedBody = JSON.parse(options.body);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"type":"compare-control","control":"hiddenUnits","values":[2,6]}' }] }],
    }),
  };
} });
const nativeResult = await nativeGateway.complete({
  config: { protocol: 'openai-responses', model: 'gpt-5.6', apiKey: 'secret-key' },
  system: 'You are a bounded interpreter.',
  messages: [{ role: 'user', content: 'Compare hidden units.' }],
  responseMode: 'json',
  responseSchema: { name: 'volk_ml_teaching_goal', schema: teachingSchema },
});
assert.equal(requestedUrl, 'https://api.openai.com/v1/responses');
assert.equal(requestedBody.instructions, 'You are a bounded interpreter.');
assert.deepEqual(requestedBody.input, [{ role: 'user', content: [{ type: 'input_text', text: 'Compare hidden units.' }] }]);
assert.equal(requestedBody.store, false);
assert.equal('messages' in requestedBody, false);
assert.equal('response_format' in requestedBody, false);
assert.equal(requestedBody.text.format.type, 'json_schema');
assert.equal(requestedBody.text.format.strict, true);
assert.equal(nativeResult.text, '{"type":"compare-control","control":"hiddenUnits","values":[2,6]}');

assert.throws(
  () => textFromResponsesPayload({ status: 'failed', error: { message: 'bad request' } }),
  (error) => error.code === 'AI_PROVIDER_RESPONSE_FAILED' && error.details.status === 'failed',
);
assert.throws(
  () => textFromResponsesPayload({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }),
  (error) => error.code === 'AI_PROVIDER_REFUSAL',
);
assert.throws(
  () => textFromResponsesPayload({ status: 'completed', output: [] }),
  (error) => error.code === 'AI_PROVIDER_OUTPUT_MISSING',
);

const host = createPlaygroundHost({ getDataset: () => null });
await host.open({ playgroundId: 'mlp-classification', seed: 904 });
const agent = createPlaygroundAgentApi(host);
const context = agent.inspectContext();
let teachingFetchBody = null;
const teachingInterpreter = createLlmGoalInterpreter({ fetchImpl: async (_url, options) => {
  teachingFetchBody = JSON.parse(options.body);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"type":"compare-control","control":"hiddenUnits","values":[2,6]}' }] }],
    }),
  };
} });
const teaching = await teachingInterpreter.interpret({
  request: 'Compare hiddenUnits 2 and 6',
  context,
  config: { protocol: 'openai-responses', model: 'gpt-5.6', apiKey: 'test-key' },
});
assert.deepEqual(teaching.goal, { type: 'compare-control', control: 'hiddenUnits', values: [2, 6] });
assert.equal(teachingFetchBody.text.format.type, 'json_schema');
const plan = await agent.plan(teaching.goal);
assert.equal(plan.goal.control, 'hiddenUnits');
assert.deepEqual(agent.getState().experimentWorkspace, context.experimentWorkspace, 'native TeachingGoal interpretation does not mutate runtime');

const quietBefore = agent.getState();
const explorationInterpreter = createExplorationAiInterpreter({ fetchImpl: async (_url, options) => {
  const body = JSON.parse(options.body);
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, 'json_schema');
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"kind":"explanation","topic":"model-capacity","explanation":"A wider hidden layer can represent more patterns.","ambiguity":null}' }] }],
    }),
  };
} });
const quiet = await explorationInterpreter.interpret({
  request: '为什么隐藏层越大，拟合效果越好？',
  context: agent.inspectContext({ presentation: { currentDepth: null, comparisonActive: false, availableDepths: ['evidence', 'mechanism', 'representation'] } }),
  config: { protocol: 'openai-responses', model: 'gpt-5.6', apiKey: 'test-key' },
});
assert.equal(quiet.kind, 'explanation');
assert.equal(quiet.topic, 'model-capacity');
assert.deepEqual(agent.getState().experimentWorkspace, quietBefore.experimentWorkspace, 'native quiet explanation does not mutate runtime');
await host.close();

console.log('OpenAI Responses checks passed: explicit native endpoint/request contract, strict schemas, deterministic output parsing/errors, MLP TeachingGoal planning, quiet Agent explanation, and runtime non-mutation.');
