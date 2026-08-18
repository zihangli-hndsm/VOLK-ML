import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createPlaygroundAgentApi } from '../src/core/playgroundAgent.js';
import { classifyAgentGuideRequest } from '../src/core/ui/agentGuide.js';
import { createExplorationAiInterpreter, projectExplorationAiContext } from '../src/core/exploration/explorationAiInterpreter.js';
import { createPedagogicalExperimentDesign, PEDAGOGICAL_EXPERIMENT_GOALS } from '../src/core/exploration/pedagogicalExperiment.js';
import { derivePedagogicalObservation } from '../src/core/exploration/pedagogicalObservation.js';
import { derivePedagogicalNextQuestionCandidates } from '../src/core/exploration/pedagogicalNextQuestions.js';
import { getWorldRecipePreset } from '../src/core/exploration/worldRecipePresets.js';
import { normalizeWorldRecipe } from '../src/core/exploration/worldRecipe.js';

const dataset = {
  name: 'Observation loop source', task: 'classification', featureColumns: ['x', 'y'], targetColumn: 'label',
  columns: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 'label', type: 'string' }],
  rows: [
    { x: -1, y: -1, label: '0' }, { x: -0.8, y: -1.1, label: '0' },
    { x: 1, y: 1, label: '1' }, { x: 0.8, y: 1.1, label: '1' },
  ],
};

async function setup(recipe = getWorldRecipePreset('rings'), seed = 6001) {
  const host = createPlaygroundHost({ getDataset: () => dataset });
  await host.open({ playgroundId: 'data-lab', seed });
  await host.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: 'knn-classification' });
  const setupProposal = host.proposeExploration({ worldDesign: { mode: 'create', recipe, patch: null, requestedHolds: [] } });
  assert.equal(setupProposal.kind, 'proposal');
  await host.executeExploration({ scenario: setupProposal.scenario });
  return host;
}

async function executeDesign(host, goal) {
  const design = createPedagogicalExperimentDesign(goal);
  const proposal = host.proposeExploration({ design });
  assert.equal(proposal.kind, 'proposal', `proposal available for ${goal}`);
  const result = await host.executeExploration({ scenario: proposal.scenario });
  return { design, proposal, result };
}

const host = await setup();
const separation = await executeDesign(host, PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION);
const observation = separation.result.pedagogicalObservation;
assert.equal(observation.available, true);
assert.equal(observation.goal, PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION);
assert.ok(observation.facts.some((fact) => fact.id === 'class-separation-distance'));
assert.ok(!JSON.stringify(observation).toLowerCase().includes('overlap increased'));
assert.ok(!JSON.stringify(observation).toLowerCase().includes('caused'));
assert.ok(separation.result.nextQuestions.length <= 2);
assert.ok(separation.result.nextQuestions.every((item) => item.preflightAssessment.fidelity.status === 'exact'));
assert.ok(separation.result.nextQuestions.every((item) => item.preflightAssessment.pedagogicalVerification.valid));

const tinyRecipe = normalizeWorldRecipe({
  ...getWorldRecipePreset('rings'),
  groups: [
    { ...getWorldRecipePreset('rings').groups[0], id: 'tiny-a', label: '0', shape: { type: 'blob', params: { radius: 0.08, aspect: [1, 1] } }, transform: { translate: [-10, 0], rotate: 0, scale: [1, 1] } },
    { ...getWorldRecipePreset('rings').groups[1], id: 'tiny-b', label: '1', shape: { type: 'blob', params: { radius: 0.08, aspect: [1, 1] } }, transform: { translate: [10, 0], rotate: 0, scale: [1, 1] } },
  ],
});
const tinyHost = await setup(tinyRecipe, 6003);
const tinySeparation = (await executeDesign(tinyHost, PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION)).result;
assert.equal(tinySeparation.pedagogicalObservation.summaryKey, 'playground.pedagogical.observation.classSeparation');
assert.ok(!JSON.stringify(tinySeparation.pedagogicalObservation).toLowerCase().includes('overlap increased'));
await tinyHost.close();

const supportRecipe = normalizeWorldRecipe({
  ...getWorldRecipePreset('rings'),
  groups: getWorldRecipePreset('rings').groups.map((group) => ({ ...group, splitTransforms: { train: null, test: { translate: [-1, 0], rotate: 0, scale: [1, 1] } } })),
});
const supportHost = await setup(supportRecipe, 6004);
const supportResult = (await executeDesign(supportHost, PEDAGOGICAL_EXPERIMENT_GOALS.TRAIN_TEST_SUPPORT_SHIFT)).result;
assert.ok(supportResult.pedagogicalObservation.facts.some((fact) => fact.id === 'test-outside-train-fraction'));
assert.ok(supportResult.pedagogicalObservation.facts.some((fact) => fact.id === 'train-realization-held'));
await supportHost.close();

const noiseHost = await setup(undefined, 6005);
const noiseResult = (await executeDesign(noiseHost, PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE)).result;
assert.ok(noiseResult.pedagogicalObservation.facts.some((fact) => fact.id === 'train-position-changes'));
assert.ok(noiseResult.pedagogicalObservation.facts.some((fact) => fact.id === 'test-realization-held'));
await noiseHost.close();

const outlierHost = await setup(undefined, 6006);
const outlierResult = (await executeDesign(outlierHost, PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY)).result;
assert.ok(outlierResult.pedagogicalObservation.facts.some((fact) => fact.id === 'train-outlier-count'));
assert.ok(outlierResult.pedagogicalObservation.facts.some((fact) => fact.id === 'test-realization-held'));
await outlierHost.close();

const threadHost = await setup();
threadHost.createExplorationThread({ title: 'Observation loop', question: 'What will happen?', actor: 'human' });
const threadDesign = createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION);
const threadProposal = threadHost.proposeExploration({ design: threadDesign });
threadHost.addExplorationThreadPrediction({ text: 'Test accuracy may decrease.', scenario: threadProposal.scenario, actor: 'human' });
const threadResult = await threadHost.executeExploration({ scenario: threadProposal.scenario });
threadHost.recordExplorationThreadExperiment({ scenario: threadProposal.scenario, actor: 'agent' });
const threadAgent = createPlaygroundAgentApi(threadHost);
threadAgent.recordExplorationThreadObservation({
  scenario: threadProposal.scenario,
  actor: 'agent',
  pedagogicalObservation: {
    version: 1,
    goal: 'class-separation',
    available: true,
    summaryKey: 'fake',
    facts: [{ id: 'fake', before: 1, after: 999, direction: 'increased', nested: { oversized: 'x'.repeat(10000) } }],
    changed: ['fake'],
    held: [],
  },
});
const threadEntries = threadHost.getState().activeExplorationThread.entries.slice(-3);
assert.deepEqual(threadEntries.map((entry) => entry.kind), ['prediction', 'experiment', 'observation']);
assert.deepEqual(threadEntries.map((entry) => entry.actor), ['human', 'agent', 'agent']);
assert.deepEqual(threadEntries[2].evidence.pedagogicalObservation, threadResult.pedagogicalObservation);
assert.equal(JSON.stringify(threadEntries[2].evidence).includes('fake'), false, 'caller-authored observation does not enter Thread evidence');
assert.equal(JSON.stringify(threadEntries[2].evidence).includes('oversized'), false, 'fabricated nested observation does not enter Thread evidence');

const noEvidence = derivePedagogicalObservation({
  design: threadDesign,
  evidence: { grounded: false, goal: threadDesign.goal },
  verification: null,
});
assert.equal(noEvidence.available, false);
assert.deepEqual(noEvidence.facts, []);

const deterministicA = await setup(undefined, 6002);
const deterministicB = await setup(undefined, 6002);
const resultA = (await executeDesign(deterministicA, PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION)).result;
const resultB = (await executeDesign(deterministicB, PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION)).result;
assert.deepEqual(resultA.pedagogicalObservation, resultB.pedagogicalObservation);
assert.deepEqual(
  derivePedagogicalNextQuestionCandidates({ design: threadDesign, observation: resultA.pedagogicalObservation, task: 'classification' }),
  derivePedagogicalNextQuestionCandidates({ design: threadDesign, observation: resultB.pedagogicalObservation, task: 'classification' }),
);

const syntheticObservation = (trainAfter, testAfter) => derivePedagogicalObservation({
  design: threadDesign,
  evidence: {
    grounded: true,
    changed: ['world'],
    held: ['model', 'learning'],
    metrics: [
      { id: 'outcome.trainAccuracy', before: 0.9, after: trainAfter },
      { id: 'outcome.testAccuracy', before: 0.9, after: testAfter },
    ],
  },
  verification: { valid: true, measurements: { before: 2, after: 1 } },
});
const generalizationObservation = syntheticObservation(0.88, 0.55);
const similarOutcomeObservation = syntheticObservation(0.55, 0.55);
const generalizationGoals = derivePedagogicalNextQuestionCandidates({ design: threadDesign, observation: generalizationObservation, task: 'classification' }).map((item) => item.goal);
const similarOutcomeGoals = derivePedagogicalNextQuestionCandidates({ design: threadDesign, observation: similarOutcomeObservation, task: 'classification' }).map((item) => item.goal);
assert.notDeepEqual(generalizationGoals, similarOutcomeGoals, 'grounded outcome deltas affect next-question selection');
assert.ok(generalizationGoals.includes(PEDAGOGICAL_EXPERIMENT_GOALS.TRAIN_TEST_SUPPORT_SHIFT));
assert.ok(!similarOutcomeGoals.includes(PEDAGOGICAL_EXPERIMENT_GOALS.TRAIN_TEST_SUPPORT_SHIFT));

const projected = projectExplorationAiContext({
  pedagogicalObservation: observation,
  recentWorldActions: [{ id: 'tx-private', pointId: 'point-private', actor: 'human', intent: 'move', operationTypes: ['MOVE_POINT'], reversible: true }],
});
assert.equal(projected.pedagogicalObservation.goal, observation.goal);
assert.deepEqual(projected.pedagogicalObservation.facts, observation.facts);
assert.equal(JSON.stringify(projected).includes('tx-private'), false);
assert.equal(JSON.stringify(projected).includes('point-private'), false);

const localClose = classifyAgentGuideRequest({ request: 'What happens when the classes move closer together?', snapshot: host.getState() });
assert.equal(localClose.design.goal, PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION);
const localChinese = classifyAgentGuideRequest({ request: '让两个类别更接近一点。', snapshot: host.getState() });
assert.equal(localChinese.design.goal, PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION);
for (const request of ['What happens if I move class A to the right?', 'Move the red class upward.', '把类别A向右移动。']) {
  const routed = classifyAgentGuideRequest({ request, snapshot: host.getState() });
  assert.notEqual(routed.design?.goal, PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION, `directional movement is not class separation: ${request}`);
}

let capturedPrompt = '';
const explanationInterpreter = createExplorationAiInterpreter({ gateway: {
  complete: async ({ messages }) => {
    capturedPrompt = messages[0].content;
    return { text: JSON.stringify({ kind: 'explanation', topic: 'comparison', explanation: 'The facts are consistent with a possible interpretation; test it next.' }), protocol: 'mock' };
  },
} });
const observationBeforeAi = structuredClone(observation);
const interpretation = await explanationInterpreter.interpret({
  request: 'Why did that happen?',
  context: { presentation: { availableDepths: ['evidence'] }, pedagogicalObservation: observation },
  config: { protocol: 'openai-compatible', apiKey: 'test', model: 'mock' },
});
assert.equal(interpretation.kind, 'explanation');
assert.match(capturedPrompt, /authoritative deterministic facts/);
assert.match(capturedPrompt, /Never overwrite, recompute, invent/);
assert.match(capturedPrompt, /never turn co-occurrence into causality/);
assert.match(capturedPrompt, /FACT, HYPOTHESIS \/ INTERPRETATION, and NEXT TEST/);
assert.match(capturedPrompt, /geometric overlap increased/);
assert.deepEqual(observation, observationBeforeAi, 'AI interpretation cannot mutate canonical facts');

const agentSource = readFileSync(new URL('../src/components/playground/ExploreAgentSurface.jsx', import.meta.url), 'utf8');
const predictionIndex = agentSource.indexOf('agent.addExplorationThreadPrediction');
const tryIndex = agentSource.lastIndexOf('try {', predictionIndex);
const executeIndex = agentSource.indexOf('agent.executeExploration', predictionIndex);
assert.ok(tryIndex >= 0 && tryIndex < predictionIndex && predictionIndex < executeIndex, 'prediction capture is inside the protected execution lifecycle');

await host.close();
await threadHost.close();
await deterministicA.close();
await deterministicB.close();

console.log('Pedagogical observation loop checks passed: deterministic observations, bounded exact next questions, Thread grounding, local fallback, AI-safe observation context, and protected prediction capture.');
