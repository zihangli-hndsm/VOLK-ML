import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createPlaygroundAgentApi } from '../src/core/playgroundAgent.js';
import { classifyAgentGuideRequest, deriveAgentSemanticExplanation, AGENT_GUIDANCE_OUTCOMES } from '../src/core/ui/agentGuide.js';
import { buildTeachingInterpretationContext, createLlmGoalInterpreter } from '../src/core/playground/agent/llmGoalInterpreter.js';

const detailsSource = readFileSync(new URL('../src/components/playground/ExploreDetailsRegion.jsx', import.meta.url), 'utf8');
const agentSource = readFileSync(new URL('../src/components/playground/ExploreAgentSurface.jsx', import.meta.url), 'utf8');
const advancedSource = readFileSync(new URL('../src/components/playground/PlaygroundAgentPanel.jsx', import.meta.url), 'utf8');
const stageSource = readFileSync(new URL('../src/components/playground/PlaygroundStage.jsx', import.meta.url), 'utf8');
const buildSource = readFileSync(new URL('../src/components/BuildToolbar.jsx', import.meta.url), 'utf8');

const host = createPlaygroundHost({ getDataset: () => null });
try {
  await host.open({ playgroundId: 'mlp-classification', seed: 701 });
  const agent = createPlaygroundAgentApi(host);
  const snapshotBefore = agent.getState();
  const capabilities = { evidence: true, mechanism: true, representation: true };
  const conceptual = classifyAgentGuideRequest({
    request: '为什么隐藏层越大，学习效果越好？',
    capabilities,
    snapshot: snapshotBefore,
  });
  assert.deepEqual(conceptual, { kind: AGENT_GUIDANCE_OUTCOMES.EXPLANATION, topic: 'model-capacity' });
  assert.equal(deriveAgentSemanticExplanation('model-capacity', snapshotBefore).available, true);
  assert.deepEqual(agent.getState().experimentWorkspace, snapshotBefore.experimentWorkspace, 'conceptual explanation does not mutate the experiment');

  const teachingContext = agent.inspectContext();
  const comparePlan = await agent.plan({ type: 'compare-control', objective: 'compare', control: 'hiddenUnits', values: [2, 6] });
  assert.equal(comparePlan.goal.type, 'compare-control');
  assert.equal(comparePlan.goal.control, 'hiddenUnits');
  assert.deepEqual(comparePlan.goal.values, [2, 6]);
  assert.ok(teachingContext.controlSchemas.some((schema) => schema.key === 'hiddenUnits'));

  let prompt = '';
  const interpreter = createLlmGoalInterpreter({ gateway: { complete: async ({ messages }) => {
    prompt = messages[0].content;
    return { protocol: 'mock', text: JSON.stringify({ type: 'compare-control', objective: 'compare', control: 'hiddenUnits', values: [2, 6] }) };
  } } });
  const interpreted = await interpreter.interpret({
    request: 'Compare an MLP with 2 hidden units and 6 hidden units.',
    context: teachingContext,
    config: { protocol: 'openai-compatible', apiKey: 'test', model: 'mock', endpoint: 'https://example.test' },
  });
  assert.equal(interpreted.goal.control, 'hiddenUnits');
  assert.match(prompt, /compare-control/);
  assert.match(prompt, /hiddenUnits/);
  assert.match(prompt, /supportedObjectives/);
  assert.deepEqual(agent.getState().experimentWorkspace, snapshotBefore.experimentWorkspace, 'AI TeachingGoal interpretation remains non-mutating');

  let repairCalls = 0;
  const repairingInterpreter = createLlmGoalInterpreter({ gateway: { complete: async ({ messages }) => {
    repairCalls += 1;
    if (repairCalls === 1) return { protocol: 'mock', text: JSON.stringify({ type: 'compare-control', control: 'layers', values: [2, 6] }) };
    assert.match(messages[0].content, /expected compare-control shape|expected one of the exact top-level shapes|unsupported objective|unsupported control/);
    return { protocol: 'mock', text: JSON.stringify({ type: 'compare-control', objective: 'compare', control: 'hiddenUnits', values: [2, 6] }) };
  } } });
  const repaired = await repairingInterpreter.interpret({
    request: 'Compare hiddenUnits = 2 and hiddenUnits = 6',
    context: teachingContext,
    config: { protocol: 'openai-compatible', apiKey: 'test', model: 'mock', endpoint: 'https://example.test' },
  });
  assert.equal(repairCalls, 2);
  assert.equal(repaired.goal.control, 'hiddenUnits');
} finally {
  await host.close();
}

assert.match(detailsSource, /openSettings/);
assert.match(detailsSource, /ai\.configure/);
assert.match(agentSource, /ai\.statusLocalFallback/);
assert.match(agentSource, /onOpenAiSettings/);
assert.match(advancedSource, /aiInvalidGoal/);
assert.match(stageSource, /SUPPORTING_PRIMITIVES/);
assert.match(stageSource, /showSupporting/);
assert.match(buildSource, /createPortal/);
assert.match(buildSource, /data-build-more-compact/);
assert.match(buildSource, /fixed inset-x-2 bottom-2/);
assert.match(buildSource, /document\.body/);
assert.match(buildSource, /aria-label=\{t\('common\.close'\)\}/);
assert.match(buildSource, /max-h-\[calc\(100dvh-1rem\)\]/);
assert.match(buildSource, /overscroll-contain/);

console.log('Post-UI7 playtest checks passed: MLP explanation routing, hiddenUnits TeachingGoal schema, bounded repair, non-mutating AI interpretation, AI settings discoverability, supporting-visual separation, and Build More viewport containment.');
