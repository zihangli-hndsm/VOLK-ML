import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { validateScenarioSpec } from '../src/core/exploration/scenarioSpec.js';
import { evaluateScenarioFidelity } from '../src/core/exploration/scenarioFidelity.js';
import { normalizeGeneratorSpec } from '../src/core/exploration/generator.js';

const spec = normalizeGeneratorSpec({
  relation: { slope: 2, bias: 1 },
  noise: { amount: 0.2 },
  train: { input: { type: 'uniform', params: { min: -1, max: 1 } }, samples: 20 },
  test: { input: { type: 'uniform', params: { min: -1, max: 1 } }, samples: 20 },
  outliers: { count: 0 },
});

const host = createPlaygroundHost({ getDataset: () => null });
try {
  await host.open({ playgroundId: 'data-lab', seed: 42 });
  await host.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: 'linear-regression' });
  await host.dispatch({ type: 'RUN' });
  const baseline = host.getState();
  const outlierProposal = host.proposeExploration({ request: 'What happens if I add some outliers?' });
  assert.equal(outlierProposal.kind, 'proposal');
  assert.equal(host.getState().experimentWorkspace.experiments.length, 1, 'proposal is preview-only');
  assert.ok(outlierProposal.scenario.observe.includes('model.slope'));
  const outlierResult = await host.executeExploration({ scenario: outlierProposal.scenario });
  assert.equal(outlierResult.fidelity.status, 'exact');
  assert.equal(outlierResult.snapshot.experimentWorkspace.experiments.length, 2);
  assert.equal(outlierResult.snapshot.experimentWorkspace.comparison.enabled, true);
  assert.ok(outlierResult.mutationDiff.changed.includes('world'));
  assert.ok(outlierResult.snapshot.experiment.mutations.some((mutation) => mutation.actor === 'agent'));
  assert.equal(outlierResult.snapshot.visualState.evidenceFocus.includes('model.slope'), true);
  assert.ok(outlierResult.snapshot.derivedObservables.slopeDifference.available);

  const viewProposal = host.proposeExploration({ request: 'What happens if I add some outliers?' });
  await host.dispatch({ type: 'SET_CONTROL', key: 'showResiduals', value: true });
  const viewResult = await host.executeExploration({ scenario: viewProposal.scenario });
  assert.equal(viewResult.snapshot.experimentWorkspace.experiments.length, 3, 'view changes do not stale a proposal');

  const staleProposal = host.proposeExploration({ request: 'What happens if I add some outliers?' });
  await host.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.1 });
  await assert.rejects(() => host.executeExploration({ scenario: staleProposal.scenario }), (error) => error.code === 'EXPLORATION_PROPOSAL_STALE');

  await host.dispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction: {
    id: 'agent-check-generator', actor: 'human', intent: 'configure-generator',
    operations: [{ type: 'SET_WORLD_GENERATOR', spec }, { type: 'REGENERATE_WORLD', seed: 42 }],
  } });
  await host.dispatch({ type: 'RUN' });
  const shiftProposal = host.proposeExploration({ request: 'Make the test data different from training data.' });
  assert.equal(shiftProposal.kind, 'proposal');
  assert.ok(shiftProposal.scenario.change.some((change) => change.operation === 'SET_GENERATOR_PARAMETER'));
  const shiftResult = await host.executeExploration({ scenario: shiftProposal.scenario });
  assert.equal(shiftResult.fidelity.status, 'exact');
  assert.deepEqual(shiftResult.mutationDiff.changed, ['world']);
  const distributionProposal = host.proposeExploration({ request: 'Try linear regression on two different distributions.' });
  assert.equal(distributionProposal.kind, 'proposal');
  assert.ok(distributionProposal.scenario.change.some((change) => change.semanticTarget === 'test-input-support'));
  const harderProposal = host.proposeExploration({ request: 'Make this dataset harder without changing the model.' });
  assert.equal(harderProposal.kind, 'proposal');
  assert.ok(harderProposal.scenario.hold.includes('model-configuration'));
  const lineMoveProposal = host.proposeExploration({ request: 'Why did the line move so much after I added that point?' });
  assert.equal(lineMoveProposal.kind, 'proposal');

  const context = host.inspectContext();
  const unsupportedObservable = structuredClone(shiftProposal.scenario);
  unsupportedObservable.observe = ['does.not.exist'];
  assert.throws(() => validateScenarioSpec(unsupportedObservable, context), (error) => error.code === 'EXPLORATION_SCENARIO_UNSUPPORTED_OBSERVABLE');
  const unsupportedOperation = structuredClone(shiftProposal.scenario);
  unsupportedOperation.change = [{ semanticTarget: 'unknown', operation: 'INVENTED_OPERATION', parameters: {} }];
  assert.throws(() => validateScenarioSpec(unsupportedOperation, context), (error) => error.code === 'EXPLORATION_SCENARIO_UNSUPPORTED_OPERATION');
  const outOfRangeControl = structuredClone(shiftProposal.scenario);
  outOfRangeControl.change = [{ semanticTarget: 'learning-configuration', operation: 'SET_CONTROL', parameters: { key: 'learningRate', value: 99 } }];
  assert.throws(() => validateScenarioSpec(outOfRangeControl, context), (error) => error.code === 'EXPLORATION_SCENARIO_CONTROL_OUT_OF_RANGE');
  const hiddenConfound = evaluateScenarioFidelity({ change: [{ semanticTarget: 'outliers' }], hold: ['noise'] }, {
    changed: ['world'], details: { worldGenerator: { changed: ['noise'] } },
  });
  assert.equal(hiddenConfound.status, 'partial');
  const resourceOverflow = structuredClone(shiftProposal.scenario);
  resourceOverflow.change = [{ semanticTarget: 'outliers', operation: 'ADD_POINTS', parameters: { points: Array.from({ length: context.resourceLimits.maxWorldObservations + 1 }, () => ({ x: 0, y: 0 })) } }];
  assert.throws(() => validateScenarioSpec(resourceOverflow, context), (error) => error.code === 'EXPLORATION_SCENARIO_RESOURCE_LIMIT');
} finally {
  await host.close();
}

console.log('Exploration Agent checks passed: capability-grounded proposals, preview-only planning, controlled A/B execution, stale proposal rejection, fidelity, agent provenance, evidence focus, and adversarial validation.');
