import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createExplorationAiInterpreter, explorationGuidanceResponseSchema } from '../src/core/exploration/explorationAiInterpreter.js';
import { normalizeRequestedHolds, REQUESTED_HOLD_IDS, requestedHoldsJsonSchema } from '../src/core/exploration/requestedHolds.js';
import { routeAgentAiInterpretation } from '../src/core/ui/agentGuide.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createPlaygroundAgentApi } from '../src/core/playgroundAgent.js';
import { evaluateScenarioFidelity } from '../src/core/exploration/scenarioFidelity.js';
import { classifyAiError, createAiDiagnostic, diagnosticText } from '../src/core/ai/diagnostics.js';

const config = { protocol: 'openai-compatible', apiKey: 'fixture', model: 'fixture' };
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

const requestCases = [
  { id: 'seed-1-more-data', request: seedRequests[0], capability: 'linear-regression/train-sample-count', expected: 'valid plan', response: completeResponse({ intent: 'more-data', requestedHolds: ['world-generating-process', 'model-configuration', 'learning-configuration', 'evaluation-configuration'] }), expectedChanges: ['train-sample-count', 'generator-realization'], expectedHolds: ['world-generating-process', 'model-configuration', 'learning-configuration', 'evaluation-configuration'], forbidden: ['learning-configuration'] },
  { id: 'seed-2-noise', request: seedRequests[1], capability: 'linear-regression/noise-control', expected: 'valid plan', response: completeResponse({ intent: 'harder-noise', requestedHolds: ['model-configuration', 'learning-configuration', 'evaluation-configuration'] }), expectedChanges: ['noise'], expectedHolds: ['model-configuration', 'learning-configuration', 'evaluation-configuration'], forbidden: ['train-sample-count'] },
  { id: 'seed-3-resample', request: seedRequests[2], capability: 'linear-regression/resample-not-an-intent', expected: 'clarification', response: completeResponse({ kind: 'clarification', intent: null, reason: 'resample-is-a-runtime-action, not a controlled planner intent' }), expectedChanges: [], expectedHolds: [], forbidden: ['more-data substitution'] },
  { id: 'seed-4-learning-rate', request: seedRequests[3], capability: 'linear-regression/learning-rate-control', expected: 'valid plan', response: completeResponse({ intent: 'learning-rate-increase', requestedHolds: ['world', 'model-configuration', 'evaluation-configuration'] }), expectedChanges: ['learning-configuration'], expectedHolds: ['world', 'model-configuration', 'evaluation-configuration'], forbidden: ['train-sample-count', 'noise'] },
  { id: 'seed-5-repeat', request: seedRequests[4], capability: 'linear-regression/repeat-not-a-substitute', expected: 'clarification', response: completeResponse({ kind: 'clarification', intent: null, reason: 'repeat requires an explicit supported experiment' }), expectedChanges: [], expectedHolds: [], forbidden: ['more-data substitution'] },
  { id: 'seed-6-split', request: seedRequests[5], capability: 'linear-regression/split-control-unavailable', expected: 'clarification', response: completeResponse({ kind: 'clarification', intent: null, reason: 'split-repeat is unavailable in this model context' }), expectedChanges: [], expectedHolds: [], forbidden: ['test-shift substitution'] },
];

assert.deepEqual(requestCases.map((item) => item.request), seedRequests, 'six supplied seed requests remain verbatim');
const schema = explorationGuidanceResponseSchema({ availableDepths: ['evidence', 'mechanism', 'representation'] });
assert.deepEqual(schema.properties.requestedHolds, requestedHoldsJsonSchema(), 'interpreter schema uses the canonical hold vocabulary');
assert.deepEqual(schema.properties.requestedHolds.anyOf[0].items.enum, REQUESTED_HOLD_IDS);

let capturedPrompt = '';
const promptProbe = createExplorationAiInterpreter({ gateway: { complete: async ({ messages }) => {
  capturedPrompt = messages[0]?.content ?? '';
  return { protocol: 'fixture', text: JSON.stringify(completeResponse({ intent: null, kind: 'clarification', reason: 'prompt probe' })) };
} } });
await promptProbe.interpret({
  request: 'show me a bounded example',
  context: { presentation: { availableDepths: ['evidence', 'mechanism'] } },
  config,
});
const promptExamples = capturedPrompt
  .split('\n')
  .filter((line) => line.startsWith('Response example ('))
  .map((line) => JSON.parse(line.slice(line.indexOf(': ') + 2)));
assert.equal(promptExamples.length, 7, 'provider prompt contains one complete response example per guidance kind/hold case');
const requiredResponseKeys = Object.keys(schema.properties).sort();
for (const [index, example] of promptExamples.entries()) {
  assert.deepEqual(Object.keys(example).sort(), requiredResponseKeys, `prompt example ${index + 1} has the complete response envelope`);
  assert.ok(schema.properties.kind.enum.includes(example.kind), `prompt example ${index + 1} uses a registered kind`);
  if (example.requestedHolds !== null) {
    assert.ok(Array.isArray(example.requestedHolds), `prompt example ${index + 1} requestedHolds is an array or null`);
    assert.deepEqual(normalizeRequestedHolds(example.requestedHolds).holds, example.requestedHolds, `prompt example ${index + 1} uses canonical requestedHolds`);
  }
  const exampleInterpreter = createExplorationAiInterpreter({ gateway: { complete: async () => ({ protocol: 'prompt-example', text: JSON.stringify(example) }) } });
  await exampleInterpreter.interpret({ request: 'validate the captured prompt example', context: { presentation: { availableDepths: ['evidence', 'mechanism'] } }, config });
}
assert.ok(promptExamples.some((example) => example.requestedHolds?.includes('world')), 'prompt includes realized World hold example');
assert.ok(promptExamples.some((example) => example.requestedHolds?.includes('world-generating-process')), 'prompt includes World-generating-process hold example');
assert.ok(capturedPrompt.includes('["constructor"]'), 'prompt includes concise invalid unknown-hold example');
assert.ok(capturedPrompt.includes('["world","world-generating-process"]'), 'prompt distinguishes invalid broad/specific World holds');
assert.throws(() => normalizeRequestedHolds(['world', 'world-generating-process']), (error) => error.code === 'AI_INVALID_REQUESTED_HOLDS');

const normalization = normalizeRequestedHolds(['model', 'world-generating', 'model']);
assert.deepEqual(normalization.holds, ['model-configuration', 'world-generating-process']);
assert.equal(normalization.details.aliases.length, 3);
assert.deepEqual(normalizeRequestedHolds(normalization.holds).holds, normalization.holds, 'normalization is idempotent');
assert.deepEqual(normalizeRequestedHolds(null).holds, []);
assert.deepEqual(normalizeRequestedHolds(undefined).holds, []);
assert.deepEqual(normalizeRequestedHolds([]).holds, []);
for (const invalid of [
  ['unknown hold'], ['constructor'], ['prototype'], ['__proto__'], ['world', 'noise'], ['world', { value: 'noise' }],
  Array.from({ length: 13 }, () => 'model-configuration'),
]) assert.throws(() => normalizeRequestedHolds(invalid), (error) => error.code === 'AI_INVALID_REQUESTED_HOLDS');
assert.throws(() => normalizeRequestedHolds('model'), (error) => error.code === 'AI_INVALID_REQUESTED_HOLDS');
assert.ok(normalizeRequestedHolds(['world']).holds.every((item) => typeof item === 'string'), 'normalized values are JSON-safe canonical strings');

let providerCalls = 0;
async function interpretFixture(item) {
  const interpreter = createExplorationAiInterpreter({ gateway: { complete: async () => {
    providerCalls += 1;
    return { protocol: 'fixture', text: JSON.stringify(item.response) };
  } } });
  return interpreter.interpret({ request: item.request, context: { presentation: { availableDepths: [] } }, config });
}

const host = createPlaygroundHost({ getDataset: () => null });
await host.open({ playgroundId: 'linear-regression', seed: 8201 });
const agent = createPlaygroundAgentApi(host);
const caseResults = [];
for (const item of requestCases) {
  const interpretation = await interpretFixture(item);
  const routed = routeAgentAiInterpretation({ interpretation, request: item.request, snapshot: { model: {} } });
  let actual = routed?.kind === 'experiment-proposal' ? 'valid plan' : 'clarification';
  let proposal = null;
  if (actual === 'valid plan') {
    proposal = agent.proposeExploration({ request: item.request, intent: routed.intent, design: routed.design, requestedHolds: routed.requestedHolds });
    actual = proposal.kind === 'proposal' ? 'valid plan' : 'clarification';
    if (proposal.kind === 'proposal') {
      for (const target of item.expectedChanges) assert.ok(proposal.scenario.change.some((change) => change.semanticTarget === target), `${item.id} preserves ${target}`);
      for (const hold of item.expectedHolds) assert.ok(proposal.scenario.hold.includes(hold), `${item.id} preserves ${hold}`);
      assert.equal(proposal.scenario.change.some((change) => item.forbidden.includes(change.semanticTarget)), false, `${item.id} avoids forbidden substitutions`);
    }
  }
  assert.equal(actual, item.expected, `${item.id} expected outcome`);
  caseResults.push({ id: item.id, capability: item.capability, expected: item.expected, actual, changes: proposal?.scenario.change.map((change) => change.semanticTarget) ?? [], holds: proposal?.scenario.hold ?? [], route: routed?.source ?? 'ai', providerCalls: 1, normalization: interpretation.requestedHoldsNormalization?.input ?? 'array', fallback: false, pass: true });
}

const beforeTask = host.inspectContext();
const rejectedTask = agent.proposeExploration({ request: 'increase data but keep sample count fixed', task: { version: 1, kind: 'experiment-design-request', source: 'lumi', learnerQuestion: 'increase data', goal: 'more-same-distribution-data', requestedHolds: ['train-sample-count'], requiresLearnerAcceptance: true } });
assert.equal(rejectedTask.kind, 'clarification', 'conflicting task hold is rejected before proposal');
assert.deepEqual(host.inspectContext().experiment, beforeTask.experiment, 'rejected task cannot mutate Experiment');
assert.deepEqual(host.inspectContext().world, beforeTask.world, 'rejected task cannot mutate World');

const validLearningRate = agent.proposeExploration({ request: 'change learning rate', intent: 'learning-rate-increase', requestedHolds: ['model-configuration'] });
assert.equal(validLearningRate.kind, 'proposal', 'learning-rate change may hold model configuration');
assert.ok(validLearningRate.scenario.hold.includes('model-configuration'));
assert.equal(agent.proposeExploration({ request: 'change learning rate', intent: 'learning-rate-increase', requestedHolds: ['learning-configuration'] }).kind, 'clarification', 'learning-rate change cannot hold learning configuration');
assert.equal(agent.proposeExploration({ request: 'increase data', intent: 'more-data', requestedHolds: ['train-sample-count'] }).kind, 'clarification', 'data increase cannot hold train sample count');

const fabricatedFidelity = evaluateScenarioFidelity({ intendedFactors: ['learning'], change: [{ semanticTarget: 'learning-configuration' }], hold: ['learning-configuration'] }, { changed: ['learning'] });
assert.equal(fabricatedFidelity.status, 'partial', 'fidelity rejects a fabricated hold/change conflict');
await host.close();

for (const [playgroundId, request, hold] of [
  ['image-classification', 'increase trainingSteps', 'learning-configuration'],
  ['sequence-attention', 'increase attentionTemperature', 'model-configuration'],
  ['retrieval-ranking', 'increase topK', 'model-configuration'],
  ['rag-grounding', 'increase topK', 'model-configuration'],
]) {
  const branchHost = createPlaygroundHost({ getDataset: () => null });
  await branchHost.open({ playgroundId, seed: 8301 });
  const branchAgent = createPlaygroundAgentApi(branchHost);
  assert.equal(branchAgent.proposeExploration({ request, intent: 'domain-control', requestedHolds: [hold] }).kind, 'clarification', `${playgroundId} does not drop conflicting holds on early cross-domain return`);
  await branchHost.close();
}

const ambiguousItem = { request: 'Compare distributions somehow?', response: completeResponse({ kind: 'clarification', intent: null, reason: 'distribution-kind-ambiguous' }) };
const ambiguousInterpretation = await interpretFixture(ambiguousItem);
assert.equal(routeAgentAiInterpretation({ interpretation: ambiguousInterpretation, request: ambiguousItem.request, snapshot: { model: {} } }).kind, 'clarification', 'ambiguous request remains clarification');
const messyBilingual = { request: '只改变 noise，keep model 不变。', response: completeResponse({ intent: 'harder-noise', requestedHolds: ['model'] }) };
const messyInterpretation = await interpretFixture(messyBilingual);
const messyRoute = routeAgentAiInterpretation({ interpretation: messyInterpretation, request: messyBilingual.request, snapshot: { model: {} } });
const messyHost = createPlaygroundHost({ getDataset: () => null });
await messyHost.open({ playgroundId: 'linear-regression', seed: 8302 });
const messyProposal = createPlaygroundAgentApi(messyHost).proposeExploration({ request: messyBilingual.request, intent: messyRoute.intent, requestedHolds: messyRoute.requestedHolds });
assert.equal(messyProposal.kind, 'proposal', 'messy bilingual request uses the existing intent route');
assert.ok(messyProposal.scenario.hold.includes('model-configuration'));
await messyHost.close();

const malformed = await assert.rejects(
  () => createExplorationAiInterpreter({ gateway: { complete: async () => ({ protocol: 'fixture', text: JSON.stringify(completeResponse({ requestedHolds: ['model', { prose: true }] })) }) } }).interpret({ request: 'invalid', context: { presentation: { availableDepths: [] } }, config }),
  (error) => error.code === 'AI_INVALID_REQUESTED_HOLDS',
);
assert.equal(malformed, undefined, 'malformed requested holds are contained as interpreter validation');
const holdDiagnostic = createAiDiagnostic({ error: { code: 'AI_INVALID_REQUESTED_HOLDS', details: { field: 'requestedHolds', reason: 'unknown-hold', value: 'constructor' } }, config, stage: 'interpreter', fallbackUsed: true });
assert.equal(classifyAiError({ code: 'AI_INVALID_REQUESTED_HOLDS' }), 'AI_INTERPRETER_INVALID', 'hold validation is never classified as network/CORS');
assert.equal(holdDiagnostic.internalCode, 'AI_INVALID_REQUESTED_HOLDS');
assert.equal(holdDiagnostic.field, 'requestedHolds');
assert.ok(diagnosticText(holdDiagnostic).includes('reason=unknown-hold'));
const aliasResponse = await createExplorationAiInterpreter({ gateway: { complete: async () => ({ protocol: 'fixture', text: JSON.stringify(completeResponse({ requestedHolds: ['model', 'latent relation'] })) }) } }).interpret({ request: seedRequests[0], context: { presentation: { availableDepths: [] } }, config });
assert.deepEqual(aliasResponse.requestedHolds, ['model-configuration', 'latent-relation']);
assert.deepEqual(routeAgentAiInterpretation({ interpretation: aliasResponse, request: seedRequests[0], snapshot: { model: {} } }).requestedHolds, aliasResponse.requestedHolds);

const deliberateReplacement = { ...requestCases[0], expected: 'clarification', response: completeResponse({ intent: 'more-data', requestedHolds: [] }) };
let replacementRejected = false;
try {
  const interpretation = await interpretFixture(deliberateReplacement);
  const routed = routeAgentAiInterpretation({ interpretation, request: deliberateReplacement.request, snapshot: { model: {} } });
  assert.equal(routed?.kind === 'experiment-proposal' ? 'valid plan' : 'clarification', deliberateReplacement.expected);
} catch {
  replacementRejected = true;
}
assert.equal(replacementRejected, true, 'suite rejects a deliberate non-more-data expectation replaced by more-data');

const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
assert.ok(css.includes('--lumi-companion-size'), 'companion sizing is scoped to responsive tokens');
assert.match(css, /\.lumi-companion \.lumi-button \{ width: var\(--lumi-companion-size\); height: calc\(var\(--lumi-companion-size\) \* \.94\); \}/, 'companion hit target scales with the visible body');
assert.ok(css.includes('@media (min-width: 1600px)'), 'wide desktop companion breakpoint exists');
const companion = await import('../src/core/ui/lumiCompanion.js');
assert.ok(companion.resolveLumiCompanionState({ askBusy: true }) === companion.LUMI_COMPANION_STATES.THINK);

console.log(`Phase A.8.2 checks passed: ${caseResults.length} assertion-backed seed cases, ${providerCalls} fixture provider calls, cross-domain hold guards, fidelity conflict, diagnostics boundary, and responsive presentation tokens.`);
