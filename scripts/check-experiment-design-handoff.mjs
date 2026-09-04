import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { normalizeGeneratorSpec } from '../src/core/exploration/generator.js';
import { createExperimentDesignRequest, createExperimentSuggestionTask, createLearnerExperimentSuggestion } from '../src/core/exploration/learningAssistant.js';

const spec = normalizeGeneratorSpec({
  relation: { slope: 1.5, bias: 0.5 },
  noise: { amount: 0.8 },
  train: { input: { type: 'uniform', params: { min: -1, max: 1 } }, samples: 12 },
  test: { input: { type: 'uniform', params: { min: -1, max: 1 } }, samples: 12 },
  outliers: { count: 0 },
});

const designRequest = createExperimentDesignRequest({
  question: 'Increase same-distribution training data and compare train/test error.',
  design: { goal: 'more-same-distribution-data' },
});
assert.equal(designRequest.kind, 'experiment-design-request');
assert.equal(designRequest.requestedChange.factor, 'sample-size');
assert.equal(createLearnerExperimentSuggestion({ question: 'More?', message: 'Try it', design: { goal: 'more-same-distribution-data' } }).designRequest.kind, 'experiment-design-request');
assert.equal(createExperimentSuggestionTask('Would you like Experiment Agent to review this?').kind, 'experiment-suggestion');

const host = createPlaygroundHost({ getDataset: () => null });
await host.open({ playgroundId: 'data-lab', seed: 42 });
await host.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: 'linear-regression' });
await host.dispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction: {
  id: 'design-handoff-generator', actor: 'human', intent: 'world-generator',
  operations: [{ type: 'SET_WORLD_GENERATOR', spec }, { type: 'REGENERATE_WORLD', seed: 7101 }],
} });
await host.dispatch({ type: 'RUN' });
const before = host.getState();
const proposal = host.proposeExploration({ task: designRequest });
assert.equal(proposal.kind, 'proposal');
assert.equal(proposal.scenario.change[0].semanticTarget, 'train-sample-count');
assert.equal(proposal.assessment.fidelity.status, 'exact');
const result = await host.executeExploration({ scenario: proposal.scenario });
assert.equal(result.pedagogicalObservation.goal, 'more-same-distribution-data');
assert.equal(result.pedagogicalObservation.available, true);
assert.equal(result.snapshot.experimentWorkspace.experiments.length, 2);
assert.equal(before.experiment.world.generator.spec.train.samples, 12);
assert.equal(result.snapshot.experimentWorkspace.comparison.enabled, true);

const legacy = host.proposeExploration({ task: createExperimentSuggestionTask('是否要请 Experiment Agent 审核一个实验？') });
assert.equal(legacy.kind, 'clarification');
assert.equal(legacy.interpretation.ambiguity, 'legacy-suggestion-not-a-design-request');

console.log('Experiment design handoff checks passed: structured LUMI suggestions design locally, confirmation copy is never a task, and more-data proposals preserve controlled semantics.');
