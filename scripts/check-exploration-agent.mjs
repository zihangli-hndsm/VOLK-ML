import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { validateScenarioSpec } from '../src/core/exploration/scenarioSpec.js';
import { evaluateScenarioFidelity } from '../src/core/exploration/scenarioFidelity.js';
import { normalizeGeneratorSpec } from '../src/core/exploration/generator.js';
import { createExplorationAiInterpreter } from '../src/core/exploration/explorationAiInterpreter.js';
import { validateControlValue } from '../src/core/playgrounds/session.js';

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
  assert.equal(outlierProposal.scenario.fidelity, undefined, 'ScenarioSpec does not accept trusted fidelity');
  assert.equal(outlierProposal.assessment.fidelity.status, 'exact', 'proposal fidelity is derived by detached preflight');
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
  assert.ok(distributionProposal.scenario.change.some((change) => change.semanticTarget === 'input-distribution'));
  assert.ok(distributionProposal.scenario.change.some((change) => change.parameters.path === 'train.input.type'));
  assert.ok(distributionProposal.scenario.change.some((change) => change.parameters.path === 'test.input.type'));
  assert.notDeepEqual(
    shiftProposal.scenario.change.map((change) => change.parameters.path).filter(Boolean),
    distributionProposal.scenario.change.map((change) => change.parameters.path).filter(Boolean),
    'two distributions resolves to a different intervention than test shift',
  );
  const harderProposal = host.proposeExploration({ request: 'Make this dataset harder without changing the model.' });
  assert.equal(harderProposal.kind, 'proposal');
  assert.ok(harderProposal.scenario.hold.includes('model-configuration'));
  const lineMoveProposal = host.proposeExploration({ request: 'Why did the line move so much after I added that point?' });
  assert.equal(lineMoveProposal.kind, 'clarification', 'line move does not fake a historical baseline');

  await host.dispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction: {
    id: 'agent-check-recent-point', actor: 'human', intent: 'point',
    operations: [{ type: 'ADD_POINTS', points: [{ id: 'recent-point', x: 9, y: -9, membership: 'train', provenance: 'manual' }] }],
  } });
  await host.dispatch({ type: 'RUN' });
  const realLineMoveProposal = host.proposeExploration({ request: 'Why did the line move so much after I added that point?' });
  assert.equal(realLineMoveProposal.kind, 'proposal');
  assert.equal(realLineMoveProposal.scenario.change[0].operation, 'UNDO_WORLD_ACTION');
  assert.equal(realLineMoveProposal.assessment.fidelity.status, 'exact');
  assert.equal(realLineMoveProposal.scenario.change.some((change) => change.operation === 'ADD_POINTS'), false, 'line move uses the real recent intervention');
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
  const approximate = evaluateScenarioFidelity({
    change: [{ semanticTarget: 'noise' }],
    hold: ['model-configuration'],
    approximation: 'Supported Gaussian noise amount is used as a proxy for heavy-tailed noise.',
  }, { changed: ['world'], details: { worldGenerator: { changed: ['noise'] } } });
  assert.equal(approximate.status, 'approximate');
  assert.match(approximate.approximations[0], /proxy/);
  const currentBeforeConfound = host.getState();
  const confoundScenario = structuredClone(realLineMoveProposal.scenario);
  confoundScenario.baseline = { experimentId: context.experiment.id, conditionFingerprint: context.conditionFingerprint };
  confoundScenario.change.push({ semanticTarget: 'noise', operation: 'SET_GENERATOR_PARAMETER', parameters: { path: 'noise.amount', value: 0.9 } });
  const confoundAssessment = host.preflightExplorationScenario({ scenario: confoundScenario });
  assert.equal(confoundAssessment.fidelity.status, 'partial', 'hidden held-condition violation is disclosed before Run');
  assert.equal(host.getState().experimentWorkspace.experiments.length, currentBeforeConfound.experimentWorkspace.experiments.length);
  const realLineMoveResult = await host.executeExploration({ scenario: realLineMoveProposal.scenario });
  assert.equal(realLineMoveResult.fidelity.status, 'exact');
  assert.deepEqual(realLineMoveResult.mutationDiff.changed, ['world']);
  const resourceOverflow = structuredClone(shiftProposal.scenario);
  resourceOverflow.change = [{ semanticTarget: 'outliers', operation: 'ADD_POINTS', parameters: { points: Array.from({ length: context.resourceLimits.maxWorldObservations + 1 }, () => ({ x: 0, y: 0 })) } }];
  assert.throws(() => validateScenarioSpec(resourceOverflow, context), (error) => error.code === 'EXPLORATION_SCENARIO_RESOURCE_LIMIT');

  const typedEnum = structuredClone(distributionProposal.scenario);
  typedEnum.change[0].parameters.value = 'gaussian';
  assert.doesNotThrow(() => validateScenarioSpec(typedEnum, host.inspectContext()), 'typed enum generator parameter is accepted');
  const invalidEnum = structuredClone(distributionProposal.scenario);
  invalidEnum.change[0].parameters.value = 'invented-family';
  assert.throws(() => validateScenarioSpec(invalidEnum, host.inspectContext()), (error) => error.code === 'EXPLORATION_SCENARIO_INVALID_PARAMETER');
  const invalidRange = {
    ...structuredClone(shiftProposal.scenario),
    baseline: { experimentId: host.inspectContext().experiment.id, conditionFingerprint: host.inspectContext().conditionFingerprint },
  };
  invalidRange.change = [
    { semanticTarget: 'test-input-support', operation: 'SET_GENERATOR_PARAMETER', parameters: { path: 'test.input.params.min', value: 5 } },
    { semanticTarget: 'test-input-support', operation: 'SET_GENERATOR_PARAMETER', parameters: { path: 'test.input.params.max', value: -5 } },
  ];
  assert.throws(() => host.preflightExplorationScenario({ scenario: invalidRange }), /EXPLORATION_INVALID_GENERATOR/);
  assert.equal(validateControlValue({ key: 'flag', type: 'boolean' }, false), false);
  assert.throws(() => validateControlValue({ key: 'flag', type: 'boolean' }, 'false'), (error) => error.code === 'INVALID_PLAYGROUND_CONTROL');
  assert.throws(() => validateScenarioSpec({ ...structuredClone(shiftProposal.scenario), change: [{ semanticTarget: 'learning-configuration', operation: 'SET_CONTROL', parameters: { key: 'learningRate', value: 99 } }] }, host.inspectContext()), (error) => error.code === 'EXPLORATION_SCENARIO_CONTROL_OUT_OF_RANGE');

  const atomicHost = createPlaygroundHost({ getDataset: () => null });
  try {
    await atomicHost.open({ playgroundId: 'data-lab', seed: 7 });
    await atomicHost.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: 'linear-regression' });
    await atomicHost.dispatch({ type: 'RUN' });
    const atomicBaseline = atomicHost.getState();
    const atomicProposal = atomicHost.proposeExploration({ request: 'What happens if I add some outliers?' });
    const atomicScenario = structuredClone(atomicProposal.scenario);
    atomicScenario.change.push({ semanticTarget: 'world-generator', operation: 'REGENERATE_WORLD', parameters: { seed: 7 } });
    await assert.rejects(() => atomicHost.executeExploration({ scenario: atomicScenario }), /EXPLORATION_INVALID_GENERATOR/);
    const atomicAfter = atomicHost.getState();
    assert.equal(atomicAfter.experimentWorkspace.experiments.length, atomicBaseline.experimentWorkspace.experiments.length, 'failed scenario does not duplicate live experiment');
    assert.equal(atomicAfter.experimentWorkspace.activeExperimentId, atomicBaseline.experimentWorkspace.activeExperimentId, 'failed scenario keeps active experiment');
    assert.deepEqual(atomicAfter.world, atomicBaseline.world, 'failed scenario keeps World unchanged');
    assert.deepEqual(atomicAfter.experimentWorkspace.comparison, atomicBaseline.experimentWorkspace.comparison, 'failed scenario keeps comparison unchanged');
  } finally {
    await atomicHost.close();
  }

  const aiInterpreter = createExplorationAiInterpreter({ gateway: { complete: async () => ({ text: JSON.stringify({ intent: 'two-distributions', requestedChange: 'use a different family', requestedHolds: ['model-configuration'], ambiguity: null }), protocol: 'mock' }) } });
  const aiResult = await aiInterpreter.interpret({ request: 'Could you contrast two kinds of input spread?', context, config: { protocol: 'openai-compatible', apiKey: 'test', model: 'mock' } });
  assert.equal(aiResult.intent, 'two-distributions');
  assert.equal('operations' in aiResult, false, 'AI interpretation has no execution authority');
  const badAi = createExplorationAiInterpreter({ gateway: { complete: async () => ({ text: JSON.stringify({ intent: 'INVENTED_OPERATION' }), protocol: 'mock' }) } });
  await assert.rejects(() => badAi.interpret({ request: 'do anything', context, config: { protocol: 'openai-compatible', apiKey: 'test', model: 'mock' } }), (error) => error.code === 'AI_INVALID_EXPLORATION_INTERPRETATION');
} finally {
  await host.close();
}

console.log('Exploration Agent checks passed: capability-grounded proposals, preview-only planning, controlled A/B execution, stale proposal rejection, fidelity, agent provenance, evidence focus, and adversarial validation.');
