import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { applyWorldTransaction } from '../src/core/exploration/operations.js';
import { compareExperiments } from '../src/core/exploration/comparison.js';
import { createExperiment } from '../src/core/exploration/experiment.js';
import { createWorld } from '../src/core/exploration/world.js';
import { normalizeGeneratorSpec } from '../src/core/exploration/generator.js';
import { deriveWorldDataSemantics } from '../src/core/exploration/observationProcess.js';
import { createHypothesis, normalizeHypothesisState, setHypothesisStatus, HYPOTHESIS_STATUSES } from '../src/core/exploration/hypothesis.js';
import { deriveLumiJourneyProjection, LUMI_JOURNEY_EVENT_TYPES } from '../src/core/ui/lumiJourney.js';

const spec = normalizeGeneratorSpec({
  relation: { slope: 2, bias: 1 },
  noise: { amount: 0.2 },
  train: { input: { type: 'uniform', params: { min: -2, max: 2 } }, samples: 20 },
  test: { input: { type: 'uniform', params: { min: -2, max: 2 } }, samples: 10 },
  outliers: { count: 0 },
});

const source = createWorld({
  id: 'inquiry-world', task: 'regression', featureNames: ['x', 'y'],
  observations: [{ id: 'seed', x: 0, y: 1, membership: 'train' }],
});
const generated = applyWorldTransaction(source, {
  id: 'generate', actor: 'human', intent: 'generate-world',
  operations: [{ type: 'SET_WORLD_GENERATOR', spec }, { type: 'REGENERATE_WORLD', seed: 11 }],
}).world;
const resampled = applyWorldTransaction(generated, {
  id: 'sample-again', actor: 'human', intent: 'sample-again',
  operations: [{ type: 'RESAMPLE_WORLD', seed: 12 }],
}).world;
const repeated = applyWorldTransaction(generated, {
  id: 'sample-again-same-seed', actor: 'human', intent: 'sample-again',
  operations: [{ type: 'RESAMPLE_WORLD', seed: 12 }],
}).world;

const generatedSemantics = deriveWorldDataSemantics(generated);
const resampledSemantics = deriveWorldDataSemantics(resampled);
assert.equal(generatedSemantics.worldIdentity.fingerprint, resampledSemantics.worldIdentity.fingerprint, 'resampling preserves World identity');
assert.notEqual(generatedSemantics.datasetProvenance.datasetId, resampledSemantics.datasetProvenance.datasetId, 'resampling creates a different finite Dataset');
assert.equal(resampledSemantics.datasetProvenance.datasetId, deriveWorldDataSemantics(repeated).datasetProvenance.datasetId, 'explicit seed reproduces the same Dataset');
assert.deepEqual(resampled.observations, repeated.observations, 'explicit seed reproduces exact observations');

const resampleDiff = compareExperiments(
  createExperiment({ id: 'generated-a', world: generated, adapterId: 'linear-regression', seed: 11 }),
  createExperiment({ id: 'generated-b', world: resampled, adapterId: 'linear-regression', seed: 12 }),
);
assert.equal(resampleDiff.factors.world.changed, false, 'resampling does not change World factor');
assert.equal(resampleDiff.factors.observationProcess.changed, true, 'resampling changes observation-process factor');
assert.deepEqual(resampleDiff.changedFactors, ['observationProcess'], 'resampling is a one-factor observation comparison');
assert.equal(resampleDiff.details.observationProcess.changed, true);

const relationChanged = applyWorldTransaction(generated, {
  id: 'world-change', actor: 'human', intent: 'world-generator',
  operations: [{ type: 'SET_GENERATOR_PARAMETER', path: 'relation.slope', value: 4 }, { type: 'REGENERATE_WORLD', seed: 11 }],
}).world;
const worldDiff = compareExperiments(
  createExperiment({ id: 'world-a', world: generated, adapterId: 'linear-regression', seed: 11 }),
  createExperiment({ id: 'world-b', world: relationChanged, adapterId: 'linear-regression', seed: 11 }),
);
assert.equal(worldDiff.factors.world.changed, true, 'latent relation change is a World change');
assert.equal(worldDiff.factors.observationProcess.changed, false, 'latent relation change leaves the sampling process held');

const modelHost = createPlaygroundHost({ getDataset: () => null });
await modelHost.open({ playgroundId: 'mlp-classification', seed: 7 });
const modelWorld = modelHost.getState().world;
const modelA = createExperiment({ id: 'same-data-knn', world: modelWorld, adapterId: 'knn', seed: 7 });
const modelB = createExperiment({ id: 'same-data-mlp', world: modelWorld, adapterId: 'mlp', seed: 7 });
const modelDiff = compareExperiments(modelA, modelB);
assert.equal(modelDiff.factors.world.changed, false, 'same Dataset keeps World held across supported model comparison');
assert.equal(modelDiff.factors.observationProcess.changed, false, 'same Dataset keeps observation process held across model comparison');
assert.deepEqual(modelDiff.changedFactors, ['model'], 'same Dataset, different Models is a one-factor comparison');
await modelHost.close();

const sameDatasetRows = [
  [-2, -2, 'A'], [-1, -1, 'A'], [-2, -1, 'A'],
  [2, 2, 'B'], [1, 1, 'B'], [2, 1, 'B'],
].map(([x, y, label], index) => ({ x, y, label, membership: index < 4 ? 'train' : 'test' }));
const sameDataset = {
  name: 'same-data-model-check',
  task: 'classification',
  featureColumns: ['x', 'y'],
  targetColumn: 'label',
  columns: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 'label', type: 'string' }],
  rows: sameDatasetRows,
};
const dataLabHost = createPlaygroundHost({ getDataset: () => sameDataset });
await dataLabHost.open({ playgroundId: 'data-lab', seed: 7 });
let dataLabSnapshot = dataLabHost.getState();
assert.deepEqual(dataLabSnapshot.availableModels.map((model) => model.id), ['knn-classification', 'mlp-classification'], 'Data Lab exposes both supported classification models');
dataLabSnapshot = await dataLabHost.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: 'knn-classification' });
const knnExperimentId = dataLabSnapshot.experimentWorkspace.activeExperimentId;
const sameDatasetId = dataLabSnapshot.datasetProvenance.datasetId;
dataLabSnapshot = await dataLabHost.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
dataLabSnapshot = await dataLabHost.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: 'mlp-classification' });
const mlpExperimentId = dataLabSnapshot.experimentWorkspace.activeExperimentId;
dataLabSnapshot = await dataLabHost.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: knnExperimentId });
assert.equal(dataLabSnapshot.datasetProvenance.datasetId, sameDatasetId, 'same-model comparison keeps Dataset provenance held');
assert.equal(dataLabSnapshot.experimentWorkspace.comparison.diff.factors.world.changed, false, 'same-model comparison keeps World held');
assert.equal(dataLabSnapshot.experimentWorkspace.comparison.diff.factors.observationProcess.changed, false, 'same-model comparison keeps observation process held');
assert.equal(dataLabSnapshot.experimentWorkspace.comparison.diff.factors.trainTest.changed, false, 'same-model comparison keeps split held');
assert.equal(dataLabSnapshot.experimentWorkspace.comparison.diff.factors.evaluation.changed, false, 'same-model comparison keeps evaluation held');
assert.equal(dataLabSnapshot.experimentWorkspace.comparison.diff.factors.model.changed, true, 'Data Lab comparison isolates the model change');
assert.notEqual(mlpExperimentId, knnExperimentId, 'same Dataset models retain distinct experiment lineage');
await dataLabHost.close();

const learnerHypothesis = createHypothesis({
  id: 'hypothesis-1', statement: 'A new sample may change the fitted line.',
  createdAt: '2026-08-26T00:00:00.000Z', experimentId: 'generated-a', threadId: 'thread-1', prediction: { choice: 'increase' },
});
const hypothesisState = normalizeHypothesisState({ hypotheses: [learnerHypothesis] });
assert.equal(hypothesisState.hypotheses[0].status, 'proposed', 'hypothesis remains learner-proposed');
assert.equal(hypothesisState.hypotheses[0].prediction.choice, 'increase', 'prediction stays separate from the machine model');
assert.equal(hypothesisState.hypotheses[0].createdAt, '2026-08-26T00:00:00.000Z');
assert.equal(hypothesisState.hypotheses[0].experimentId, 'generated-a');
assert.equal(hypothesisState.hypotheses[0].threadId, 'thread-1');
const hypothesisJourney = deriveLumiJourneyProjection({ hypotheses: hypothesisState.hypotheses });
assert.equal(hypothesisJourney.events[0].type, LUMI_JOURNEY_EVENT_TYPES.PREDICT, 'learner hypothesis enters the Journey as prediction');
const revisedHypothesisState = setHypothesisStatus(hypothesisState, { hypothesisId: 'hypothesis-1', status: HYPOTHESIS_STATUSES.REVISED });
assert.equal(revisedHypothesisState.hypotheses[0].status, HYPOTHESIS_STATUSES.REVISED, 'revision is an explicit learner action');
assert.ok(deriveLumiJourneyProjection({ hypotheses: revisedHypothesisState.hypotheses }).events.some((event) => event.type === LUMI_JOURNEY_EVENT_TYPES.REVISE), 'revised hypothesis enters the Journey as revision');

const host = createPlaygroundHost({ getDataset: () => null });
await host.open({ playgroundId: 'linear-regression', seed: 11 });
let snapshot = await host.dispatch({ type: 'SET_WORLD_GENERATOR', spec });
snapshot = await host.dispatch({ type: 'REGENERATE_WORLD', seed: 11 });
const beforeView = structuredClone({ world: snapshot.world, experiment: snapshot.experiment, dataset: snapshot.datasetProvenance });
snapshot = await host.dispatch({ type: 'SET_WORKSPACE_VIEW', patch: { bounds: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }, boundsMode: 'manual' } });
assert.deepEqual({ world: snapshot.world, experiment: snapshot.experiment, dataset: snapshot.datasetProvenance }, beforeView, 'view changes do not mutate semantic World/Data state');
const inspected = host.inspectContext();
assert.deepEqual(inspected.exploration.worldIdentity, snapshot.worldIdentity, 'Agent inspection shares World identity projection');
assert.deepEqual(inspected.exploration.observationProcess, snapshot.observationProcess, 'Agent inspection shares observation-process projection');
assert.deepEqual(inspected.exploration.datasetProvenance, snapshot.datasetProvenance, 'Agent inspection shares Dataset provenance projection');
snapshot = await host.dispatch({ type: 'RESAMPLE_WORLD', seed: 12 });
assert.notEqual(snapshot.datasetProvenance.datasetId, beforeView.dataset.datasetId, 'runtime Sample again updates Dataset provenance');
assert.ok(snapshot.semanticEvents.events.some((event) => event.type === 'observation.sampled'), 'runtime emits a distinct sampling event');
assert.ok(!snapshot.semanticEvents.events.some((event) => event.type === 'world.intervened' && event.operationTypes.includes('RESAMPLE_WORLD')), 'sampling is not recorded as a World intervention');
await host.close();

console.log('World–Data inquiry loop checks passed: identity, sampling, provenance, comparison, learner prediction, view isolation, Agent parity, and sampling event boundaries.');
