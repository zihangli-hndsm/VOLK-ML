import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { classifyAgentGuideRequest, AGENT_GUIDANCE_OUTCOMES } from '../src/core/ui/agentGuide.js';
import { createExplorationAiInterpreter } from '../src/core/exploration/explorationAiInterpreter.js';
import { routeAgentAiInterpretation } from '../src/core/ui/agentGuide.js';
import { getWorldRecipePreset } from '../src/core/exploration/worldRecipePresets.js';
import {
  createPedagogicalExperimentDesign,
  PEDAGOGICAL_EXPERIMENT_GOALS,
  validateExplorationDesign,
} from '../src/core/exploration/pedagogicalExperiment.js';

const classificationDataset = {
  name: 'Pedagogy classification source', task: 'classification', featureColumns: ['x', 'y'], targetColumn: 'label',
  columns: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 'label', type: 'string' }],
  rows: [
    { x: -1, y: -1, label: '0' }, { x: -0.8, y: -1.1, label: '0' },
    { x: 1, y: 1, label: '1' }, { x: 0.8, y: 1.1, label: '1' },
  ],
};

const host = createPlaygroundHost({ getDataset: () => classificationDataset });
await host.open({ playgroundId: 'data-lab', seed: 2048 });
await host.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: 'knn-classification' });

const worldProposal = host.proposeExploration({
  request: 'Create the starting classification world',
  worldDesign: { mode: 'create', recipe: getWorldRecipePreset('rings'), patch: null, requestedHolds: [] },
});
assert.equal(worldProposal.kind, 'proposal');
await host.executeExploration({ scenario: worldProposal.scenario });

const design = createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_OVERLAP, { prediction: true });
assert.equal(validateExplorationDesign(design).goal, 'class-overlap');
const before = structuredClone(host.getState());
const proposal = host.proposeExploration({
  request: 'Why does KNN struggle when the classes overlap?',
  design,
});
assert.equal(proposal.kind, 'proposal', 'curiosity produces a proposal');
assert.equal(proposal.scenario.pedagogicalDesign.goal, 'class-overlap');
assert.deepEqual(proposal.scenario.observe, ['outcome.trainAccuracy', 'outcome.testAccuracy']);
assert.equal(proposal.assessment.fidelity.status, 'exact');
assert.deepEqual(host.getState().experimentWorkspace, before.experimentWorkspace, 'proposal is preview-only');
assert.deepEqual(proposal.scenario.hold.slice(0, 3), ['model-configuration', 'learning-configuration', 'evaluation-configuration']);
assert.equal(proposal.scenario.intendedWorldRecipePaths.length, 1, 'overlap isolates one recipe path');

const result = await host.executeExploration({ scenario: proposal.scenario });
assert.equal(result.fidelity.status, 'exact');
assert.equal(result.pedagogicalEvidence.grounded, true);
assert.equal(result.pedagogicalEvidence.goal, 'class-overlap');
assert.ok(result.pedagogicalEvidence.metrics.every((metric) => metric.before !== null && metric.after !== null), 'evidence uses runtime outcome values');
assert.ok(result.followUps.length <= 2, 'at most two follow-ups');
assert.ok(result.followUps.every((item) => item.design), 'follow-ups retain bounded designs');
assert.equal(result.snapshot.experimentWorkspace.comparison.diff.clarity, 'high');
assert.equal(result.snapshot.observables['outcome.trainAccuracy'].available, true);
assert.equal(result.snapshot.observables['outcome.testAccuracy'].available, true);

const shiftDesign = createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.TRAIN_TEST_SUPPORT_SHIFT);
const shiftProposal = host.proposeExploration({ request: 'What happens when test data is outside training support?', design: shiftDesign });
assert.equal(shiftProposal.kind, 'proposal');
assert.ok(shiftProposal.scenario.intendedWorldRecipePaths.every((path) => path.includes('.splitTransforms.test')));
assert.equal(shiftProposal.scenario.observe.includes('coverageMismatch'), true);

const local = classifyAgentGuideRequest({
  request: 'Does more noise always hurt the model?',
  snapshot: host.getState(),
});
assert.equal(local.kind, AGENT_GUIDANCE_OUTCOMES.EXPERIMENT_PROPOSAL);
assert.equal(local.design.goal, PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE);

const aiInterpreter = createExplorationAiInterpreter({ gateway: {
  complete: async () => ({
    protocol: 'mock',
    text: JSON.stringify({
      kind: 'experiment', topic: null, explanation: null, depth: null, intent: null,
      requestedChange: null, requestedHolds: [],
      experimentDesign: design,
      design: null, reason: null, ambiguity: null,
    }),
  }),
} });
const aiInterpretation = await aiInterpreter.interpret({
  request: 'Why does KNN struggle when the classes overlap?',
  context: { world: { task: 'classification' }, presentation: { availableDepths: [] } },
  config: { protocol: 'openai-compatible', apiKey: 'test', model: 'test', endpoint: 'https://example.test' },
});
const aiOutcome = routeAgentAiInterpretation({ interpretation: aiInterpretation, request: 'Why does KNN struggle when the classes overlap?', snapshot: host.getState() });
assert.equal(aiOutcome.kind, AGENT_GUIDANCE_OUTCOMES.EXPERIMENT_PROPOSAL);
assert.equal(aiOutcome.design.goal, PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_OVERLAP);

const unsupportedHost = createPlaygroundHost({ getDataset: () => null });
await unsupportedHost.open({ playgroundId: 'linear-regression', seed: 2049 });
const unsupported = classifyAgentGuideRequest({ request: 'Why does KNN struggle when the classes overlap?', snapshot: unsupportedHost.getState() });
assert.notEqual(unsupported.design?.goal, PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_OVERLAP, 'unsupported task does not fabricate a classification design');
await unsupportedHost.close();
await host.close();

console.log('Pedagogical experiment checks passed: bounded designs, one-factor KNN overlap, task-aware observables, preview-only proposals, grounded evidence, capability-checked follow-ups, test-support shift, local fallback, and unsupported curiosity handling.');
