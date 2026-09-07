import assert from 'node:assert/strict';
import { createExplorationAiInterpreter, explorationGuidanceResponseSchema } from '../src/core/exploration/explorationAiInterpreter.js';
import { normalizeRequestedHolds } from '../src/core/exploration/requestedHolds.js';
import { routeAgentAiInterpretation } from '../src/core/ui/agentGuide.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createPlaygroundAgentApi } from '../src/core/playgroundAgent.js';
import { createPedagogicalExperimentDesign } from '../src/core/exploration/pedagogicalExperiment.js';

const completeResponse = (overrides = {}) => ({
  kind: 'experiment', topic: null, explanation: null, depth: null, intent: 'more-data',
  requestedChange: 'increase same-distribution training data', requestedHolds: [],
  design: null, experimentDesign: null, reason: null, ambiguity: null, ...overrides,
});

const seedRequests = [
  '增加一些同分布训练数据，其他条件不变，比较训练和测试误差。',
  '只改变噪声大小，模型和评估方式保持不变。',
  '在同一个 World 下重新随机采样几次，看看结果是否一样。',
  '保持世界不变，只改变学习率，比较拟合结果。',
  'Try the same world again, keep the model fixed, and compare the outcomes.',
  'Change only the split, repeat several times, and compare evaluation variation.',
];
const requestRecords = seedRequests.map((request, index) => ({
  caseId: `seed-${index + 1}`,
  request,
  expected: 'bounded interpretation or local clarification',
  route: 'provider-fixture',
  providerCalls: 0,
  actual: null,
}));
assert.equal(requestRecords.length, 6, 'six verbatim bounded request fixtures are recorded before provider output');

const schema = explorationGuidanceResponseSchema({ availableDepths: ['evidence', 'mechanism', 'representation'] });
assert.equal(schema.properties.requestedHolds.anyOf[0].maxItems, 12);
assert.equal(schema.properties.requestedHolds.anyOf[0].items.maxLength, 120);

const normalization = normalizeRequestedHolds(['model', 'world-generating', 'model']);
assert.deepEqual(normalization.holds, ['model-configuration', 'world-generating-process']);
assert.equal(normalization.details.aliases.length, 3);
assert.deepEqual(normalizeRequestedHolds(normalization.holds).holds, normalization.holds, 'normalization is idempotent');
assert.deepEqual(normalizeRequestedHolds(null).holds, []);
assert.deepEqual(normalizeRequestedHolds(undefined).holds, []);
assert.deepEqual(normalizeRequestedHolds([]).holds, []);
for (const invalid of [
  ['unknown hold'],
  ['world', 'noise'],
  ['world', { value: 'noise' }],
  Array.from({ length: 13 }, () => 'model-configuration'),
]) assert.throws(() => normalizeRequestedHolds(invalid), (error) => error.code === 'AI_INVALID_REQUESTED_HOLDS');
assert.throws(() => normalizeRequestedHolds('model'), (error) => error.code === 'AI_INVALID_REQUESTED_HOLDS');

let providerCalls = 0;
const interpreter = createExplorationAiInterpreter({ gateway: { complete: async () => {
  providerCalls += 1;
  return { protocol: 'fixture', text: JSON.stringify(completeResponse({ requestedHolds: null })) };
} } });
for (const record of requestRecords) {
  const before = providerCalls;
  const result = await interpreter.interpret({ request: record.request, context: { presentation: { availableDepths: [] } }, config: { protocol: 'openai-compatible', apiKey: 'fixture', model: 'fixture' } });
  record.actual = result.kind;
  record.providerCalls = providerCalls - before;
  assert.equal(record.providerCalls, 1, `${record.caseId} uses one bounded provider call`);
}
const interpretedNull = await interpreter.interpret({ request: seedRequests[1], context: { presentation: { availableDepths: [] } }, config: { protocol: 'openai-compatible', apiKey: 'fixture', model: 'fixture' } });
assert.equal(providerCalls, requestRecords.length + 1);
assert.deepEqual(interpretedNull.requestedHolds, []);
assert.equal(interpretedNull.requestedHoldsNormalization.input, 'null');

const interpretedAlias = await createExplorationAiInterpreter({ gateway: { complete: async () => ({ protocol: 'fixture', text: JSON.stringify(completeResponse({ requestedHolds: ['model', 'latent relation'] })) }) } }).interpret({ request: seedRequests[0], context: { presentation: { availableDepths: [] } }, config: { protocol: 'openai-compatible', apiKey: 'fixture', model: 'fixture' } });
assert.deepEqual(interpretedAlias.requestedHolds, ['model-configuration', 'latent-relation']);
assert.deepEqual(routeAgentAiInterpretation({ interpretation: interpretedAlias, request: seedRequests[0], snapshot: { model: {} } }).requestedHolds, interpretedAlias.requestedHolds);
await assert.rejects(
  () => createExplorationAiInterpreter({ gateway: { complete: async () => ({ protocol: 'fixture', text: JSON.stringify(completeResponse({ requestedHolds: ['model', { prose: true }] })) }) } }).interpret({ request: 'invalid', context: { presentation: { availableDepths: [] } }, config: { protocol: 'openai-compatible', apiKey: 'fixture', model: 'fixture' } }),
  (error) => error.code === 'AI_INVALID_REQUESTED_HOLDS',
);

const host = createPlaygroundHost({ getDataset: () => null });
await host.open({ playgroundId: 'linear-regression', seed: 8201 });
const agent = createPlaygroundAgentApi(host);
const proposal = agent.proposeExploration({ request: 'increase same-distribution data', intent: 'more-data', requestedHolds: ['world-generating-process'] });
assert.equal(proposal.kind, 'proposal');
assert.ok(proposal.scenario.hold.includes('world-generating-process'), 'accepted explicit hold reaches planner-owned ScenarioSpec');
assert.ok(proposal.scenario.hold.includes('model-configuration'), 'planner retains its deterministic required hold');
const designProposal = agent.proposeExploration({ request: 'increase same-distribution data', design: createPedagogicalExperimentDesign('more-same-distribution-data'), requestedHolds: ['train-test-setup'] });
assert.equal(designProposal.kind, 'proposal');
assert.ok(designProposal.scenario.hold.includes('existing-train-test-setup'), 'design handoff preserves explicit hold aliases');
await host.close();

const companion = await import('../src/core/ui/lumiCompanion.js');
const css = await (await import('node:fs/promises')).readFile(new URL('../src/index.css', import.meta.url), 'utf8');
assert.ok(css.includes('--lumi-companion-size'), 'companion sizing is scoped to responsive tokens');
assert.ok(css.includes('@media (min-width: 1600px)'), 'wide desktop companion breakpoint exists');
assert.ok(companion.resolveLumiCompanionState({ askBusy: true }) === companion.LUMI_COMPANION_STATES.THINK);

console.log(`Phase A.8.2 checks passed: ${requestRecords.length} seed fixtures, normalization/rejection matrix, provider calls=${providerCalls}, planner preservation, and responsive presentation tokens.`);
