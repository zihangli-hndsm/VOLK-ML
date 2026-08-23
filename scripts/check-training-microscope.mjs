import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createPlaygroundAgentApi } from '../src/core/playgroundAgent.js';
import {
  createLinearRegressionTrainer,
  normalizeLinearParameters,
  stepLinearRegressionTrainer,
} from '../src/core/linearRegressionMath.js';

const open = async (playgroundId = 'linear-regression') => {
  const host = createPlaygroundHost({ getDataset: () => null });
  const agent = createPlaygroundAgentApi(host);
  await agent.open({ playgroundId });
  return { host, agent };
};

const close = async ({ agent }) => agent.close();
const almostEqual = (left, right, message, tolerance = 1e-10) => assert.ok(
  Math.abs(left - right) <= tolerance,
  `${message}: ${left} !== ${right}`,
);

function trainerForSnapshot(snapshot) {
  const points = snapshot.scene.scatterPoints
    .filter((point) => point.membership !== 'test')
    .map(({ x, y }) => ({ x, y }));
  return createLinearRegressionTrainer(points);
}

// The learner-facing microscope action initializes training and advances one
// model step even while the ordinary Visualization Script remains loaded.
{
  const run = await open();
  const initial = run.agent.getState();
  assert.ok(initial.script?.steps?.length, 'the regression teaching script is loaded');
  assert.equal(initial.trainingMicroscope.canStep, true);
  const first = await run.agent.dispatch({ type: 'TRAINING_STEP' });
  assert.equal(first.trainingMicroscope.currentRuntimeStep, 1);
  assert.notDeepEqual(first.scene.line, initial.scene.line, 'the first microscope step updates visible parameters');
  const second = await run.agent.dispatch({ type: 'TRAINING_STEP' });
  assert.equal(second.trainingMicroscope.currentRuntimeStep, 2, 'each microscope action advances exactly once');
  assert.notDeepEqual(second.scene.line, first.scene.line);
  await close(run);
}

// Normal Linear Regression mechanics: the trace comes from the same function
// that performs the update, with explicit objective timing.
{
  const run = await open();
  const initial = run.agent.getState();
  const started = await run.agent.dispatch({ type: 'START_TRAINING' });
  const stepped = await run.agent.dispatch({ type: 'STEP' });
  const event = stepped.traces.find((item) => item.type === 'training.step');
  const step = stepped.trainingMicroscope.steps[0];
  assert.ok(event, 'linear regression emits a canonical training.step event');
  assert.deepEqual(step, event.payload, 'microscope step is a detached semantic projection');
  assert.equal(stepped.trainingMicroscope.steps.length, 20);
  assert.equal(stepped.trainingMicroscope.lossTrace.length, 20);
  assert.deepEqual(step.parameters.before, {
    weight: initial.scene.line.weight,
    bias: initial.scene.line.bias,
  }, 'trace before matches actual pre-step model');
  assert.deepEqual(step.parameters.after, {
    weight: stepped.scene.line.weight,
    bias: stepped.scene.line.bias,
  }, 'trace after matches actual visible post-step model');

  const trainer = trainerForSnapshot(initial);
  const normalizedStart = normalizeLinearParameters({
    weights: [initial.scene.line.weight],
    bias: initial.scene.line.bias,
    normalization: trainer.normalization,
  });
  const expected = stepLinearRegressionTrainer(trainer, {
    ...normalizedStart,
    learningRate: initial.controls.learningRate,
  });
  almostEqual(step.objective.before.lossNormalized, expected.lossNormalized, 'pre-update objective');
  almostEqual(step.objective.after.lossNormalized, expected.nextLossNormalized, 'post-update objective');
  almostEqual(step.objective.after.loss, expected.nextLossRaw, 'post-update raw objective');
  almostEqual(step.gradients.weight, expected.gradient.weights[0], 'gradient weight');
  almostEqual(step.gradients.bias, expected.gradient.bias, 'gradient bias');
  almostEqual(step.update.delta.weight, -step.update.learningRate * step.gradients.weight, 'gradient descent weight delta');
  almostEqual(step.update.delta.bias, -step.update.learningRate * step.gradients.bias, 'gradient descent bias delta');
  almostEqual(step.parameters.normalizedBefore.weight + step.update.delta.weight, step.parameters.normalizedAfter.weight, 'normalized weight update');
  almostEqual(step.parameters.normalizedBefore.bias + step.update.delta.bias, step.parameters.normalizedAfter.bias, 'normalized bias update');
  almostEqual(step.parameters.before.weight + step.update.rawDelta.weight, step.parameters.after.weight, 'raw weight update');
  almostEqual(step.parameters.before.bias + step.update.rawDelta.bias, step.parameters.after.bias, 'raw bias update');
  assert.equal(step.update.space, 'normalized');
  assert.equal(step.gradients.space, 'normalized');
  assert.equal(step.outcome.status, 'applied');
  assert.ok(Number.isFinite(step.objective.after.loss));
  assert.ok(Number.isFinite(step.gradients.weight));
  assert.equal(stepped.trainingMicroscope.lossTrace[0].loss, step.objective.after.loss);
  assert.equal(stepped.trainingMicroscope.preprocessing.length, 2);
  assert.deepEqual(run.agent.inspectContext().trainingMicroscope, stepped.trainingMicroscope, 'Agent and learner microscope semantics match');
  assert.doesNotThrow(() => JSON.stringify(stepped.trainingMicroscope), 'microscope state is JSON-safe');

  const completed = started.traces.findLast((item) => item.type === 'training.completed');
  assert.equal(stepped.trainingMicroscope.steps.length, completed.payload.steps, 'every visible training step has a canonical trace');
  await close(run);

  const second = await open();
  await second.agent.dispatch({ type: 'START_TRAINING' });
  const secondStep = await second.agent.dispatch({ type: 'STEP' });
  assert.deepEqual(secondStep.trainingMicroscope.steps, stepped.trainingMicroscope.steps, 'same starting condition produces the same trace');
  await close(second);
}

// Historical inspection/navigation never rewinds or mutates the live model.
{
  const run = await open();
  await run.agent.dispatch({ type: 'START_TRAINING' });
  await run.agent.dispatch({ type: 'SEEK', step: 10 });
  const current = run.agent.getState();
  const historical = structuredClone(current.trainingMicroscope.steps.find((step) => step.step === 3));
  const liveBeforeInspection = structuredClone(current.scene.line);
  const inspected = run.agent.getState();
  assert.deepEqual(inspected.trainingMicroscope.steps.find((step) => step.step === 3), historical, 'historical trace remains immutable');
  assert.deepEqual(inspected.scene.line, liveBeforeInspection, 'inspection does not mutate the current model');
  const explicitlyRestored = await run.agent.dispatch({ type: 'SEEK', step: 5 });
  assert.equal(explicitlyRestored.timeline.step, 5, 'explicit runtime SEEK remains available for restoration');
  await close(run);
}

// A learning-condition change clears old traces instead of relabelling them.
{
  const run = await open();
  await run.agent.dispatch({ type: 'START_TRAINING' });
  assert.ok(run.agent.getState().trainingMicroscope.steps.length);
  const changed = await run.agent.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.01 });
  assert.equal(changed.trainingMicroscope.steps.length, 0);
  assert.equal(changed.trainingMicroscope.currentRuntimeStep, 0);
  await close(run);
}

// The terminal learning-rate-too-high update remains visible history and now
// has exactly one canonical trace with truthful stop metadata.
{
  const run = await open();
  const changed = await run.agent.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 2 });
  assert.equal(changed.controls.learningRate, 2, 'high learning rate uses a valid control value');
  const started = await run.agent.dispatch({ type: 'START_TRAINING' });
  const completed = started.traces.findLast((item) => item.type === 'training.completed');
  assert.equal(completed.payload.stoppedReason, 'learning-rate-too-high');
  const terminal = started.trainingMicroscope.steps.at(-1);
  assert.ok(terminal, 'terminal history step has a microscope trace');
  assert.equal(started.trainingMicroscope.steps.length, completed.payload.steps);
  assert.equal(terminal.outcome.status, 'stopped');
  assert.equal(terminal.outcome.stopReason, 'learning-rate-too-high');
  const terminalVisible = await run.agent.dispatch({ type: 'SEEK', step: terminal.step });
  const visibleHistory = terminalVisible.scene.training.parameterHistory;
  const visibleLossHistory = terminalVisible.scene.training.lossHistory;
  assert.equal(visibleHistory.length, started.trainingMicroscope.steps.length, 'visible history and canonical trace have the same count');
  for (const [index, traceStep] of started.trainingMicroscope.steps.entries()) {
    assert.equal(traceStep.step, index + 1, 'history and trace step identities are aligned');
    almostEqual(visibleHistory[index].weight, traceStep.parameters.after.weight, `history visible weight step ${traceStep.step}`);
    almostEqual(visibleHistory[index].bias, traceStep.parameters.after.bias, `history visible bias step ${traceStep.step}`);
    almostEqual(visibleLossHistory[index], traceStep.objective.after.loss, `history visible loss step ${traceStep.step}`);
  }
  assert.deepEqual({ weight: terminalVisible.scene.line.weight, bias: terminalVisible.scene.line.bias }, terminal.parameters.after, 'terminal SEEK shows the traced post-update model');
  assert.deepEqual(terminalVisible.trainingMicroscope.selectedStep, terminal, 'terminal trace remains selected after SEEK');
  assert.deepEqual(run.agent.inspectContext().trainingMicroscope, terminalVisible.trainingMicroscope, 'Agent sees terminal outcome and evidence');
  const unchanged = structuredClone(terminalVisible.trainingMicroscope.steps.at(-1));
  await run.agent.dispatch({ type: 'SEEK', step: 0 });
  assert.deepEqual(run.agent.getState().trainingMicroscope.steps.at(-1), unchanged, 'terminal evidence remains immutable after inspection');
  await close(run);
}

// Adapters without the full mechanic expose an honest reduced view.
{
  const mlp = await open('mlp-classification');
  const initial = mlp.agent.getState();
  const microscope = initial.trainingMicroscope;
  assert.equal(microscope.available, true);
  assert.equal(microscope.canStep, true);
  assert.deepEqual(microscope.capabilities.gradients, []);
  assert.equal(microscope.capabilities.updates, false);
  assert.equal(microscope.steps.length, 0);
  const stepped = await mlp.agent.dispatch({ type: 'TRAINING_STEP' });
  assert.equal(stepped.trainingMicroscope.currentRuntimeStep, 1);
  assert.equal(stepped.trainingMicroscope.lossTrace.length, stepped.trainingMicroscope.totalSteps, 'MLP microscope exposes the initialized loss trajectory');
  assert.ok(Number.isFinite(stepped.trainingMicroscope.selectedStep.objective.after.loss), 'MLP first step selects its corresponding loss evidence');
  assert.notDeepEqual(stepped.scene.network.edges, initial.scene.network.edges, 'MLP microscope stepping updates network parameters');
  await close(mlp);
}

// A regression concept entrance keeps the same ordinary LR runtime and needs no AI.
{
  const host = createPlaygroundHost({ getDataset: () => null });
  const agent = createPlaygroundAgentApi(host);
  await agent.openBigIdeaEntrance({ id: 'finding-patterns' });
  assert.equal(agent.getState().model.adapterId, 'linear-regression');
  const trained = await agent.dispatch({ type: 'START_TRAINING' });
  assert.equal(trained.trainingMicroscope.available, true);
  assert.ok(trained.trainingMicroscope.steps.length);
  await agent.close();
}

console.log('training microscope checks passed');
