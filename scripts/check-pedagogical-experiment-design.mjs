import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { classifyAgentGuideRequest, AGENT_GUIDANCE_OUTCOMES } from '../src/core/ui/agentGuide.js';
import { createExplorationAiInterpreter } from '../src/core/exploration/explorationAiInterpreter.js';
import { routeAgentAiInterpretation } from '../src/core/ui/agentGuide.js';
import { getWorldRecipePreset } from '../src/core/exploration/worldRecipePresets.js';
import { normalizeWorldRecipe } from '../src/core/exploration/worldRecipe.js';
import {
  createPedagogicalExperimentDesign,
  PEDAGOGICAL_EXPERIMENT_GOALS,
  validateExplorationDesign,
} from '../src/core/exploration/pedagogicalExperiment.js';
import { derivePedagogicalEvidence } from '../src/core/exploration/pedagogicalEvidence.js';

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

const design = createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION, { prediction: true });
assert.equal(validateExplorationDesign(design).goal, 'class-separation');
const before = structuredClone(host.getState());
const proposal = host.proposeExploration({
  request: 'Why does KNN struggle when the classes overlap?',
  design,
});
assert.equal(proposal.kind, 'proposal', 'curiosity produces a proposal');
assert.equal(proposal.scenario.pedagogicalDesign.goal, 'class-separation');
assert.deepEqual(proposal.scenario.observe, ['outcome.trainAccuracy', 'outcome.testAccuracy']);
assert.equal(proposal.assessment.fidelity.status, 'exact');
assert.deepEqual(host.getState().experimentWorkspace, before.experimentWorkspace, 'proposal is preview-only');
assert.deepEqual(proposal.scenario.hold.slice(0, 3), ['model-configuration', 'learning-configuration', 'evaluation-configuration']);
assert.ok(proposal.scenario.intendedWorldRecipePaths.length >= 1, 'overlap declares a concrete recipe path');

const result = await host.executeExploration({ scenario: proposal.scenario });
assert.equal(result.fidelity.status, 'exact');
assert.equal(result.pedagogicalEvidence.grounded, true);
assert.equal(result.pedagogicalEvidence.goal, 'class-separation');
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

async function recipeHost(recipe, model = 'knn-classification') {
  const nextHost = createPlaygroundHost({ getDataset: () => classificationDataset });
  await nextHost.open({ playgroundId: 'data-lab', seed: 3100 });
  await nextHost.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: model });
  const setup = nextHost.proposeExploration({ request: 'Create the test World', worldDesign: { mode: 'create', recipe, patch: null, requestedHolds: [] } });
  assert.equal(setup.kind, 'proposal');
  await nextHost.executeExploration({ scenario: setup.scenario });
  return nextHost;
}

const baseRecipe = getWorldRecipePreset('rings');
const realizationPoints = (world, membership) => world.observations
  .filter((point) => point.membership === membership)
  .map((point) => ({
    id: point.id,
    groupId: point.generation?.groupId ?? null,
    membership: point.membership,
    label: point.label ?? null,
    target: point.target ?? null,
    x: point.x,
    y: point.y,
    features: point.features ?? null,
  }));

const offsetGeometry = normalizeWorldRecipe({
  ...baseRecipe,
  groups: [
    { ...baseRecipe.groups[0], id: 'left-class', label: '0', shape: { type: 'line', params: { start: [-10, 0], end: [-9, 0], thickness: 0.08 } } },
    { ...baseRecipe.groups[1], id: 'right-class', label: '1', shape: { type: 'line', params: { start: [9, 0], end: [10, 0], thickness: 0.08 } } },
  ],
});
const offsetHost = await recipeHost(offsetGeometry);
const offsetProposal = offsetHost.proposeExploration({ request: 'Why does KNN struggle when the classes overlap?', design: createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION) });
assert.equal(offsetProposal.kind, 'proposal', 'realized local geometry supports class-separation design');
assert.ok(offsetProposal.assessment.pedagogicalVerification.measurements.after < offsetProposal.assessment.pedagogicalVerification.measurements.before);
const offsetOtherBefore = realizationPoints(offsetHost.getState().experiment.world, 'train').filter((point) => point.groupId === 'left-class');
const offsetResult = await offsetHost.executeExploration({ scenario: offsetProposal.scenario });
const offsetOtherAfter = realizationPoints(offsetResult.snapshot.experiment.world, 'train').filter((point) => point.groupId === 'left-class');
assert.deepEqual(offsetOtherAfter, offsetOtherBefore, 'class-separation leaves the non-moved class realization unchanged');
await offsetHost.close();

const tinyDisjointRecipe = normalizeWorldRecipe({
  ...baseRecipe,
  groups: [
    { ...baseRecipe.groups[0], id: 'tiny-class-a', label: '0', shape: { type: 'blob', params: { radius: 0.08, aspect: [1, 1] } }, transform: { translate: [-10, 0], rotate: 0, scale: [1, 1] } },
    { ...baseRecipe.groups[1], id: 'tiny-class-b', label: '1', shape: { type: 'blob', params: { radius: 0.08, aspect: [1, 1] } }, transform: { translate: [10, 0], rotate: 0, scale: [1, 1] } },
  ],
  noise: {
    train: { position: { amount: 0 }, label: { probability: 0, policy: 'flip' }, outliers: { fraction: 0, placement: 'radial', distance: 2 }, local: [] },
    test: { position: { amount: 0 }, label: { probability: 0, policy: 'flip' }, outliers: { fraction: 0, placement: 'radial', distance: 2 }, local: [] },
  },
});
const tinyHost = await recipeHost(tinyDisjointRecipe);
const tinyProposal = tinyHost.proposeExploration({ request: 'What happens when the classes overlap?', design: createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION) });
assert.equal(tinyProposal.kind, 'proposal');
assert.equal(tinyProposal.scenario.pedagogicalDesign.goal, 'class-separation');
const tinyWorldBefore = tinyHost.getState().experiment.world;
const tinyA = realizationPoints(tinyWorldBefore, 'train').filter((point) => point.groupId === 'tiny-class-a');
const tinyB = realizationPoints(tinyWorldBefore, 'train').filter((point) => point.groupId === 'tiny-class-b');
assert.ok(Math.max(...tinyA.map((point) => point.x)) < Math.min(...tinyB.map((point) => point.x)), 'tiny class supports start disjoint');
const tinyResult = await tinyHost.executeExploration({ scenario: tinyProposal.scenario });
const tinyWorldAfter = tinyResult.snapshot.experiment.world;
const tinyBAfter = realizationPoints(tinyWorldAfter, 'train').filter((point) => point.groupId === 'tiny-class-b');
assert.ok(tinyResult.pedagogicalVerification.measurements.after < tinyResult.pedagogicalVerification.measurements.before, 'class separation distance decreases');
assert.ok(Math.max(...tinyA.map((point) => point.x)) < Math.min(...tinyBAfter.map((point) => point.x)), 'classes remain disjoint after moving closer');
await tinyHost.close();

const repeatedLabelRecipe = normalizeWorldRecipe({
  ...baseRecipe,
  groups: [...baseRecipe.groups, { ...baseRecipe.groups[0], id: 'outer-ring-copy' }],
});
const repeatedLabelHost = await recipeHost(repeatedLabelRecipe);
const repeatedLabelProposal = repeatedLabelHost.proposeExploration({ request: 'Why does KNN struggle when the classes overlap?', design: createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION) });
assert.equal(repeatedLabelProposal.kind, 'clarification', 'ambiguous class groups are not silently described as one class');
await repeatedLabelHost.close();

const leftTestRecipe = normalizeWorldRecipe({
  ...baseRecipe,
  groups: baseRecipe.groups.map((group) => ({ ...group, splitTransforms: { train: null, test: { translate: [-1, 0], rotate: 0, scale: [1, 1] } } })),
});
const leftTestHost = await recipeHost(leftTestRecipe);
const leftTrainBefore = leftTestHost.getState().experiment.world.observations.filter((point) => point.membership === 'train').map((point) => [point.id, point.x, point.y]);
const leftTestProposal = leftTestHost.proposeExploration({ request: 'Move Test support farther from Train', design: shiftDesign });
assert.equal(leftTestProposal.kind, 'proposal');
assert.ok(leftTestProposal.assessment.pedagogicalVerification.measurements.coverageMismatch.after.testOutsideTrainFraction > leftTestProposal.assessment.pedagogicalVerification.measurements.coverageMismatch.before.testOutsideTrainFraction);
const leftTestResult = await leftTestHost.executeExploration({ scenario: leftTestProposal.scenario });
const leftTrainAfter = leftTestResult.snapshot.experiment.world.observations.filter((point) => point.membership === 'train').map((point) => [point.id, point.x, point.y]);
assert.deepEqual(leftTrainAfter, leftTrainBefore, 'test-support shift preserves Train realization');
assert.equal(leftTestResult.pedagogicalVerification.measurements.trainUnchanged, true);
assert.ok(leftTestResult.pedagogicalEvidence.coverageMismatch.before && leftTestResult.pedagogicalEvidence.coverageMismatch.after);
await leftTestHost.close();

const noiseHost = await recipeHost(baseRecipe);
const noiseBefore = noiseHost.getState().experiment.world;
const noiseProposal = noiseHost.proposeExploration({ design: createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE) });
const noiseResult = await noiseHost.executeExploration({ scenario: noiseProposal.scenario });
assert.notDeepEqual(realizationPoints(noiseResult.snapshot.experiment.world, 'train'), realizationPoints(noiseBefore, 'train'), 'train noise changes Train positions');
assert.deepEqual(realizationPoints(noiseResult.snapshot.experiment.world, 'test'), realizationPoints(noiseBefore, 'test'), 'train noise preserves Test realization');
await noiseHost.close();

const maximumNoiseRecipe = normalizeWorldRecipe({ ...baseRecipe, noise: { ...baseRecipe.noise, train: { ...baseRecipe.noise.train, position: { amount: 5 } } } });
const maximumNoiseHost = await recipeHost(maximumNoiseRecipe);
assert.equal(maximumNoiseHost.proposeExploration({ design: createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE) }).kind, 'clarification', 'maximum noise does not create a zero-change proposal');
await maximumNoiseHost.close();

const maximumOutlierRecipe = normalizeWorldRecipe({ ...baseRecipe, noise: { ...baseRecipe.noise, train: { ...baseRecipe.noise.train, outliers: { fraction: 0.25, placement: 'radial', distance: 2 } } } });
const maximumOutlierHost = await recipeHost(maximumOutlierRecipe);
assert.equal(maximumOutlierHost.proposeExploration({ design: createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY) }).kind, 'clarification', 'maximum outliers do not create a zero-change proposal');
await maximumOutlierHost.close();

const outlierHost = await recipeHost(baseRecipe);
const outlierBefore = outlierHost.getState().experiment.world;
const outlierProposal = outlierHost.proposeExploration({ design: createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY) });
const outlierResult = await outlierHost.executeExploration({ scenario: outlierProposal.scenario });
assert.ok(outlierResult.pedagogicalVerification.measurements.outliersAfter > outlierResult.pedagogicalVerification.measurements.outliersBefore);
assert.deepEqual(realizationPoints(outlierResult.snapshot.experiment.world, 'test'), realizationPoints(outlierBefore, 'test'), 'train outliers preserve Test realization');
await outlierHost.close();

const dirtyHost = await recipeHost(baseRecipe);
await dirtyHost.dispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction: { id: 'pedagogical-dirty-edit', actor: 'human', intent: 'world-edit', operations: [{ type: 'PATCH_WORLD_RECIPE', patch: { version: 1, changes: [{ type: 'TRANSLATE_GROUP', groupId: 'inner-blob', split: 'all', delta: [0.2, 0] }] } }] } });
assert.equal(dirtyHost.getState().experiment.world.generator.status, 'dirty');
const dirtyProposal = dirtyHost.proposeExploration({ design: createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE) });
assert.equal(dirtyProposal.kind, 'clarification');
assert.equal(dirtyProposal.interpretation.ambiguity, 'regenerate-baseline-first');
await dirtyHost.dispatch({ type: 'REGENERATE_WORLD' });
assert.equal(dirtyHost.proposeExploration({ design: createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE) }).kind, 'proposal');
await dirtyHost.close();

assert.equal(derivePedagogicalEvidence({ snapshot: { experimentWorkspace: { comparison: { enabled: false } } }, scenario: { pedagogicalDesign: design }, verification: null }).grounded, false, 'incomplete evidence is not grounded');

const mlpHost = await recipeHost(baseRecipe);
await mlpHost.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: 'mlp-classification' });
const mlpProposal = mlpHost.proposeExploration({ design: createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION) });
assert.equal(mlpProposal.kind, 'proposal', 'bounded binary 2D MLP World mutation is proposal-capable');
const mlpResult = await mlpHost.executeExploration({ scenario: mlpProposal.scenario });
assert.equal(mlpResult.snapshot.model.adapterId, 'mlp', 'pedagogical World execution keeps the MLP attached');
assert.deepEqual(mlpResult.snapshot.world.featureNames, ['x', 'y'], 'pedagogical MLP World keeps canonical recipe features');
await mlpHost.close();

const pedagogicallyWrongHost = await recipeHost(offsetGeometry);
const exactButPedagogicallyWrong = structuredClone(pedagogicallyWrongHost.proposeExploration({ request: 'Why does KNN struggle when the classes overlap?', design: createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION) }).scenario);
const wrongPatch = exactButPedagogicallyWrong.change.find((change) => change.operation === 'PATCH_WORLD_RECIPE').parameters.patch;
wrongPatch.changes[0].delta = wrongPatch.changes[0].delta.map((value) => -value);
assert.throws(() => pedagogicallyWrongHost.preflightExplorationScenario({ scenario: exactButPedagogicallyWrong }), (error) => error.code === 'EXPLORATION_PEDAGOGICAL_INTERVENTION_INVALID', 'structural exactness cannot bypass pedagogical verification');
await pedagogicallyWrongHost.close();

const partialHost = await recipeHost(baseRecipe);
const partialScenario = structuredClone(partialHost.proposeExploration({ design: createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION) }).scenario);
partialScenario.change.push({ semanticTarget: 'learning-configuration', operation: 'SET_CONTROL', parameters: { key: 'k', value: 3 } });
const partialAssessment = partialHost.preflightExplorationScenario({ scenario: partialScenario });
assert.equal(partialAssessment.fidelity.status, 'partial', 'extra learning change makes pedagogical fidelity partial');
assert.equal(partialAssessment.pedagogicalVerification.valid, true, 'predicate can pass even when structural fidelity is partial');
const partialBefore = structuredClone(partialHost.getState().experimentWorkspace);
await assert.rejects(() => partialHost.executeExploration({ scenario: partialScenario }), (error) => error.code === 'EXPLORATION_PEDAGOGICAL_FIDELITY_NOT_EXACT');
assert.deepEqual(partialHost.getState().experimentWorkspace, partialBefore, 'partial pedagogical scenario cannot commit');
await partialHost.close();

const threadHost = await recipeHost(baseRecipe);
threadHost.createExplorationThread({ title: 'Pedagogical order', question: 'What will happen?', actor: 'human' });
const orderedProposal = threadHost.proposeExploration({ request: 'Why does KNN struggle when the classes overlap?', design: createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION) });
threadHost.addExplorationThreadPrediction({ text: 'Test accuracy may decrease.', scenario: orderedProposal.scenario, actor: 'human' });
await threadHost.executeExploration({ scenario: orderedProposal.scenario });
threadHost.recordExplorationThreadExperiment({ scenario: orderedProposal.scenario, actor: 'agent' });
threadHost.recordExplorationThreadObservation({ scenario: orderedProposal.scenario, actor: 'agent' });
const orderedEntries = threadHost.getState().activeExplorationThread.entries.slice(-3).map((entry) => entry.kind);
assert.deepEqual(orderedEntries, ['prediction', 'experiment', 'observation']);
assert.deepEqual(threadHost.getState().activeExplorationThread.entries.slice(-3).map((entry) => entry.actor), ['human', 'agent', 'agent']);
await threadHost.close();

const local = classifyAgentGuideRequest({
  request: 'Does more noise always hurt the model?',
  snapshot: host.getState(),
});
assert.equal(local.kind, AGENT_GUIDANCE_OUTCOMES.EXPERIMENT_PROPOSAL);
assert.equal(local.design.goal, PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE);
const overlapLocal = classifyAgentGuideRequest({ request: 'Why does KNN struggle when the classes overlap?', snapshot: host.getState() });
assert.equal(overlapLocal.kind, AGENT_GUIDANCE_OUTCOMES.EXPERIMENT_PROPOSAL);
assert.equal(overlapLocal.design.goal, PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION, 'overlap language routes to the truthful closeness design');
const overlapWhenLocal = classifyAgentGuideRequest({ request: 'What happens when the classes overlap?', snapshot: host.getState() });
assert.equal(overlapWhenLocal.kind, AGENT_GUIDANCE_OUTCOMES.EXPERIMENT_PROPOSAL);
assert.equal(overlapWhenLocal.design.goal, PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION);

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
assert.equal(aiOutcome.design.goal, PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION);

const unsupportedHost = createPlaygroundHost({ getDataset: () => null });
await unsupportedHost.open({ playgroundId: 'linear-regression', seed: 2049 });
const unsupported = classifyAgentGuideRequest({ request: 'Why does KNN struggle when the classes overlap?', snapshot: unsupportedHost.getState() });
assert.notEqual(unsupported.design?.goal, PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION, 'unsupported task does not fabricate a classification design');
await unsupportedHost.close();
await host.close();

console.log('Pedagogical experiment checks passed: bounded designs, one-factor KNN class-separation, task-aware observables, preview-only proposals, grounded evidence, capability-checked follow-ups, test-support shift, local fallback, and unsupported curiosity handling.');
