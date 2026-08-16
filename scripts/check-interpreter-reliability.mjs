import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createPlaygroundAgentApi } from '../src/core/playgroundAgent.js';
import {
  buildTeachingInterpretationContext,
  canonicalizeTeachingGoal,
  createLlmGoalInterpreter,
} from '../src/core/playground/agent/llmGoalInterpreter.js';
import { createProviderGateway } from '../src/core/ai/providerRegistry.js';
import { createExplorationAiInterpreter } from '../src/core/exploration/explorationAiInterpreter.js';
import { routeAgentAiInterpretation, AGENT_GUIDANCE_OUTCOMES } from '../src/core/ui/agentGuide.js';
import { resolveCompactSheetGesture, COMPACT_SHEET_DISMISS_THRESHOLD } from '../src/core/ui/compactSheetGesture.js';

const buildSource = readFileSync(new URL('../src/components/BuildToolbar.jsx', import.meta.url), 'utf8');
const sheetSource = readFileSync(new URL('../src/components/CompactBottomSheet.jsx', import.meta.url), 'utf8');
const detailsSource = readFileSync(new URL('../src/components/playground/ExploreDetailsRegion.jsx', import.meta.url), 'utf8');
const agentSurfaceSource = readFileSync(new URL('../src/components/playground/ExploreAgentSurface.jsx', import.meta.url), 'utf8');
const dialogSource = readFileSync(new URL('../src/components/playground/UnifiedPlaygroundDialog.jsx', import.meta.url), 'utf8');
assert.match(buildSource, /createPortal/);
assert.match(buildSource, /document\.body/);
assert.match(buildSource, /data-build-more-compact/);
assert.match(buildSource, /fixed inset-x-2 bottom-2/);
assert.match(buildSource, /aria-modal="true"/);
assert.match(buildSource, /event\.key === 'Escape'/);
assert.match(buildSource, /fixed inset-0 z-\[55\]/);
assert.match(buildSource, /CompactBottomSheet/);
assert.match(sheetSource, /onPointerDown/);
assert.match(sheetSource, /onPointerMove/);
assert.match(sheetSource, /onPointerCancel/);
assert.match(sheetSource, /touchAction: 'none'/);
assert.match(sheetSource, /setPointerCapture/);
assert.match(sheetSource, /data-compact-sheet-scroll-region/);
assert.match(sheetSource, /touchAction: 'pan-y'/);
assert.match(sheetSource, /overscroll-y-contain/);
assert.match(detailsSource, /CompactBottomSheet/);
assert.match(agentSurfaceSource, /CompactBottomSheet/);
assert.match(dialogSource, /overscroll-y-contain/);
assert.deepEqual(resolveCompactSheetGesture({ deltaY: COMPACT_SHEET_DISMISS_THRESHOLD - 1, scrollTop: 0 }), { claimed: true, dismiss: false });
assert.deepEqual(resolveCompactSheetGesture({ deltaY: COMPACT_SHEET_DISMISS_THRESHOLD, scrollTop: 0 }), { claimed: true, dismiss: true });
assert.deepEqual(resolveCompactSheetGesture({ deltaY: -120, scrollTop: 0 }), { claimed: false, dismiss: false });
assert.deepEqual(resolveCompactSheetGesture({ deltaY: 120, scrollTop: 24 }), { claimed: false, dismiss: false });
assert.deepEqual(resolveCompactSheetGesture({ deltaY: 120, scrollTop: 24, startedFromHandle: true }), { claimed: true, dismiss: true });

const host = createPlaygroundHost({ getDataset: () => null });
await host.open({ playgroundId: 'mlp-classification', seed: 702 });
const agent = createPlaygroundAgentApi(host);
const context = agent.inspectContext({ presentation: {
  currentDepth: null,
  comparisonActive: false,
  availableDepths: ['evidence', 'mechanism', 'representation'],
} });
const boundedContext = buildTeachingInterpretationContext(context);
assert.equal(boundedContext.allowedGoalSchema.oneOf[1].control, 'one key from allowedControls');
assert.equal(boundedContext.allowedGoalSchema.oneOf[1].objective, undefined);
assert.ok(boundedContext.allowedControls.some((control) => control.key === 'hiddenUnits'));

const config = { protocol: 'openai-compatible', apiKey: 'test', model: 'mock', endpoint: 'https://example.test' };
const fixtures = [
  JSON.stringify({ type: 'compare-control', control: 'hiddenUnits', values: [2, 6] }),
  JSON.stringify({ goal: { type: 'compare-control', control: 'hiddenUnits', values: [2, 6] } }),
  JSON.stringify({ type: 'compare-control', control: { key: 'hiddenUnits' }, values: [2, 6] }),
  'Here is the requested JSON:\n```json\n{"type":"compare-control","control":"hiddenUnits","values":[2,6]}\n```',
];
for (const fixture of fixtures) {
  const interpreter = createLlmGoalInterpreter({ gateway: { complete: async () => ({ protocol: 'mock', text: fixture }) } });
  const result = await interpreter.interpret({ request: 'Compare hiddenUnits 2 and 6', context, config });
  assert.equal(result.goal.type, 'compare-control');
  assert.equal(result.goal.control, 'hiddenUnits');
  assert.deepEqual(result.goal.values, [2, 6]);
}

assert.deepEqual(canonicalizeTeachingGoal({ compareControl: { control: 'hiddenUnits', values: [2, 6] } }), {
  type: 'compare-control', control: 'hiddenUnits', values: [2, 6],
});

const invalidInterpreter = createLlmGoalInterpreter({ gateway: { complete: async () => ({
  protocol: 'mock',
  text: JSON.stringify({ type: 'compare-control', control: 'layers', values: [2, 6] }),
}) } });
await assert.rejects(
  invalidInterpreter.interpret({ request: 'Compare layers 2 and 6', context, config }),
  (error) => error.code === 'AI_INVALID_GOAL'
    && error.details.stage === 'validate'
    && error.details.candidate.control === 'layers'
    && error.details.problem.includes('hiddenUnits')
    && !JSON.stringify(error.details).includes('apiKey'),
);

let repairCalls = 0;
let repairPrompt = '';
const repairInterpreter = createLlmGoalInterpreter({ gateway: { complete: async ({ messages }) => {
  repairCalls += 1;
  repairPrompt = messages[0].content;
  return repairCalls === 1
    ? { protocol: 'mock', text: JSON.stringify({ type: 'compare-control', control: 'layers', values: [2, 6] }) }
    : { protocol: 'mock', text: JSON.stringify({ type: 'compare-control', control: 'hiddenUnits', values: [2, 6] }) };
} } });
const repaired = await repairInterpreter.interpret({ request: 'Compare two hidden-unit widths', context, config });
assert.equal(repairCalls, 2);
assert.equal(repaired.goal.control, 'hiddenUnits');
assert.match(repairPrompt, /Previous candidate/);
assert.match(repairPrompt, /layers/);
assert.match(repairPrompt, /allowed controls|hiddenUnits/);

let providerCalls = 0;
const providerGateway = createProviderGateway({ fetchImpl: async (_endpoint, options) => {
  providerCalls += 1;
  const body = JSON.parse(options.body);
  if (providerCalls === 1) return {
    ok: false,
    status: 400,
    json: async () => ({ error: { message: 'response_format json_object is not supported' } }),
  };
  assert.equal(body.response_format, undefined);
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '{"type":"explain-process"}' } }] }),
  };
} });
const providerResult = await providerGateway.complete({ config, system: 'test', messages: [{ role: 'user', content: 'test' }], responseMode: 'json' });
assert.equal(providerCalls, 2);
assert.equal(providerResult.text, '{"type":"explain-process"}');

let authCalls = 0;
const authGateway = createProviderGateway({ fetchImpl: async () => {
  authCalls += 1;
  return { ok: false, status: 401, json: async () => ({ error: { message: 'invalid api key' } }) };
} });
await assert.rejects(
  authGateway.complete({ config, messages: [], responseMode: 'json' }),
  (error) => error.code === 'AI_PROVIDER_REQUEST_FAILED',
);
assert.equal(authCalls, 1);

const diagnosticInterpreter = createLlmGoalInterpreter({ gateway: { complete: async () => {
  const error = new Error('provider rejected request');
  error.code = 'AI_PROVIDER_REQUEST_FAILED';
  error.details = { status: 429, providerMessage: 'rate limit' };
  throw error;
} } });
await assert.rejects(
  diagnosticInterpreter.interpret({ request: 'Explain the process', context, config }),
  (error) => error.code === 'AI_PROVIDER_REQUEST_FAILED'
    && error.details.stage === 'provider'
    && error.details.status === 429
    && !JSON.stringify(error.details).includes('apiKey'),
);

const explorationGateway = { complete: async ({ messages }) => ({
  protocol: 'mock',
  text: messages[0].content.includes('Please clarify this')
    ? JSON.stringify({ kind: 'clarification', reason: 'needs a supported operation' })
    : JSON.stringify({ kind: 'navigation', depth: 'mechanism' }),
}) };
const explorationInterpreter = createExplorationAiInterpreter({ gateway: explorationGateway });
const navigation = await explorationInterpreter.interpret({ request: 'How does it learn?', context, config });
assert.deepEqual(navigation, { kind: 'navigation', depth: 'mechanism', ambiguity: null, providerId: 'mock' });
assert.deepEqual(routeAgentAiInterpretation({ interpretation: navigation, request: 'How does it learn?', snapshot: agent.getState(), capabilities: { mechanism: true } }), {
  kind: AGENT_GUIDANCE_OUTCOMES.OPEN_DEPTH, depth: 'mechanism', source: 'ai', request: 'How does it learn?',
});
const clarification = await explorationInterpreter.interpret({ request: 'Please clarify this', context, config });
assert.deepEqual(clarification, { kind: 'clarification', reason: 'needs a supported operation', ambiguity: null, providerId: 'mock' });
assert.equal(routeAgentAiInterpretation({ interpretation: clarification, request: 'Please clarify this', snapshot: agent.getState() }).kind, AGENT_GUIDANCE_OUTCOMES.CLARIFICATION);

const invalidNavigation = createExplorationAiInterpreter({ gateway: { complete: async () => ({ protocol: 'mock', text: JSON.stringify({ kind: 'navigation', depth: 'not-available' }) }) } });
await assert.rejects(
  invalidNavigation.interpret({ request: 'Open an unavailable surface', context, config }),
  (error) => error.code === 'AI_INVALID_EXPLORATION_INTERPRETATION',
);

await host.close();
console.log('Interpreter reliability checks passed: canonical goal variants, planner-owned objectives, safe repair diagnostics, provider JSON-mode fallback, bounded exploration outcomes, and portal mobile More contract.');
