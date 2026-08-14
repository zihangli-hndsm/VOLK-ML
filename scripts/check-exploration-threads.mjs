import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createPlaygroundAgentApi } from '../src/core/playgroundAgent.js';
import { createPlaygroundSession, dispatchPlaygroundAction } from '../src/core/playgrounds/session.js';
import { getPlayground } from '../src/core/playgrounds/registry.js';
import { appendExplorationThreadEntry, createExplorationThread, validateExplorationThread } from '../src/core/exploration/explorationThread.js';

const host = createPlaygroundHost({ getDataset: () => null });
const agent = createPlaygroundAgentApi(host);
await agent.open({ playgroundId: 'linear-regression', seed: 919 });

let snapshot = agent.createExplorationThread({ title: 'Outliers', question: 'What happens after an outlier?', source: 'manual' });
assert.equal(snapshot.activeExplorationThread.entries[0].kind, 'question');
await assert.rejects(() => agent.dispatch({
  type: 'ADD_THREAD_PREDICTION',
  entry: { text: 'The slope will move.', baselineConditionFingerprint: 'forged-condition' },
}), (error) => error.code === 'EXPLORATION_THREAD_INVALID', 'generic Agent dispatch cannot forge Prediction identity');
const predictionFingerprint = agent.inspectContext().conditionFingerprint;
agent.addExplorationThreadPrediction({ text: 'The fitted slope will move.' });
assert.equal(agent.inspectContext().activeExplorationThread.entries.at(-1).baselineConditionFingerprint, predictionFingerprint);
await agent.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.1 });
assert.equal(agent.inspectContext().activeExplorationThread.entries.at(-1).baselineConditionFingerprint, predictionFingerprint, 'prediction baseline must remain historical after condition changes');

await agent.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
await agent.dispatch({ type: 'SET_COMPARE', enabled: true });
await agent.dispatch({ type: 'RUN' });
snapshot = agent.recordExplorationThreadExperiment();
const experimentEntry = snapshot.activeExplorationThread.entries.at(-1);
assert.equal(experimentEntry.kind, 'experiment');
assert.equal(experimentEntry.comparison.enabled, true);
assert.equal(Object.keys(experimentEntry.conditionFingerprints).length, 2);
assert.equal(Object.hasOwn(experimentEntry.semanticDiff, 'factors'), false, 'thread diff must stay compact');

snapshot = agent.recordExplorationThreadObservation({ note: 'The line moved.' });
const observationEntry = snapshot.activeExplorationThread.entries.at(-1);
assert.equal(observationEntry.historical, true);
assert.ok(Object.keys(observationEntry.evidence.observables).length > 0);
assert.ok(Object.values(observationEntry.evidence.observables).every((value) => Object.values(value).every((item) => item !== null)));
const frozenObservation = JSON.stringify(observationEntry);

await agent.dispatch({ type: 'ADD_POINT', x: 10, y: -10 });
assert.equal(JSON.stringify(agent.inspectContext().activeExplorationThread.entries.at(-1)), frozenObservation, 'historical evidence must not refresh');
agent.addExplorationThreadQuestion({ text: 'Does more data reduce the effect?', source: 'manual' });
assert.equal(agent.inspectContext().activeExplorationThread.entries.at(-1).kind, 'question');

await agent.dispatch({ type: 'SWITCH_EXPERIMENT', experimentId: experimentEntry.experimentIds[0] });
snapshot = agent.resumeExplorationThreadExperiment(experimentEntry.id);
assert.equal(snapshot.experimentWorkspace.activeExperimentId, experimentEntry.activeExperimentId);
assert.equal(snapshot.experimentWorkspace.comparison.enabled, true);

const inspection = agent.inspectContext();
assert.deepEqual(inspection.activeExplorationThread, snapshot.activeExplorationThread);
assert.deepEqual(inspection.exploration.threads, inspection.explorationThreads);
assert.doesNotThrow(() => JSON.stringify(inspection.explorationThreads));
await agent.close();

const scenarioHost = createPlaygroundHost({ getDataset: () => null });
const scenarioAgent = createPlaygroundAgentApi(scenarioHost);
await scenarioAgent.open({ playgroundId: 'data-lab', seed: 42 });
await scenarioAgent.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: 'linear-regression' });
await scenarioAgent.dispatch({ type: 'RUN' });
const scenarioProposal = scenarioAgent.proposeExploration('What happens if I add some outliers?');
assert.equal(scenarioProposal.kind, 'proposal');
scenarioAgent.createExplorationThread({ title: 'Scenario prediction', question: 'Will the outliers move the line?' });
const scenarioSnapshot = scenarioAgent.addExplorationThreadPrediction({
  text: 'The outliers will move the fitted line.',
  scenario: scenarioProposal.scenario,
  actor: 'agent',
});
const scenarioPrediction = scenarioSnapshot.activeExplorationThread.entries.at(-1);
assert.equal(scenarioPrediction.baselineConditionFingerprint, scenarioProposal.scenario.baseline.conditionFingerprint);
assert.equal(scenarioPrediction.scenarioSummary, scenarioProposal.scenario.interpretation.summary);
assert.deepEqual(Object.keys(scenarioPrediction.scenarioReference).sort(), ['change', 'hold', 'observe', 'version']);
const detachedScenarioPrediction = JSON.stringify(scenarioPrediction);
scenarioProposal.scenario.interpretation.summary = 'caller mutation';
scenarioProposal.scenario.change[0].operation = 'SET_CONTROL';
assert.equal(JSON.stringify(scenarioAgent.inspectContext().activeExplorationThread.entries.at(-1)), detachedScenarioPrediction, 'Scenario-linked Prediction must be detached from caller mutation');
await scenarioAgent.close();

const playground = getPlayground('linear-regression');
const source = { kind: 'example', name: 'test', fingerprint: 'test', task: 'regression', points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 1, y: 1 }] };
// The missing-reference check records a normal canonical Experiment entry, then
// removes only its runtime reference to simulate workspace loss.
let session = createPlaygroundSession(playground, { source, seed: 3 });
session = dispatchPlaygroundAction(session, { type: 'CREATE_EXPLORATION_THREAD', thread: { id: 'fixture-thread', title: 'Fixture' } });
session = dispatchPlaygroundAction(session, {
  type: 'RECORD_THREAD_EXPERIMENT',
});
const fixtureEntry = session.explorationThreads[0].entries.at(-1);
assert.ok(fixtureEntry.conditionFingerprints[fixtureEntry.activeExperimentId]);
assert.throws(() => dispatchPlaygroundAction({
  ...session,
  experimentWorkspace: {
    ...session.experimentWorkspace,
    entries: Object.fromEntries(Object.entries(session.experimentWorkspace.entries).filter(([id]) => id !== fixtureEntry.experimentIds[0])),
  },
}, { type: 'RESUME_THREAD_EXPERIMENT', entryId: fixtureEntry.id }), (error) => error.code === 'EXPLORATION_THREAD_EXPERIMENT_UNAVAILABLE');
assert.equal(session.explorationThreads[0].entries.at(-1).id, fixtureEntry.id, 'historical thread entry remains readable after workspace loss');

assert.throws(() => dispatchPlaygroundAction(session, {
  type: 'RECORD_THREAD_OBSERVATION',
  entry: {
    experimentIds: fixtureEntry.experimentIds,
    conditionFingerprints: fixtureEntry.conditionFingerprints,
    evidence: { observables: { 'outcome.testMse': { active: -999 } } },
  },
}), (error) => error.code === 'EXPLORATION_THREAD_INVALID', 'generic dispatch cannot inject observation evidence');
assert.throws(() => dispatchPlaygroundAction(session, {
  type: 'RECORD_THREAD_EXPERIMENT',
  entry: { experimentIds: ['forged'], conditionFingerprints: { forged: 'fake' }, semanticDiff: { changed: ['world'] } },
}), (error) => error.code === 'EXPLORATION_THREAD_INVALID', 'generic dispatch cannot inject Experiment identity');
assert.throws(() => dispatchPlaygroundAction(session, {
  type: 'RECORD_THREAD_OBSERVATION',
  entry: { evidence: { repeatEvidence: { aggregates: { slope: { mean: -999 } } } } },
}), (error) => error.code === 'EXPLORATION_THREAD_INVALID', 'generic dispatch cannot inject Repeat evidence');

assert.throws(() => validateExplorationThread({ version: 1, id: 'bad-prediction', title: 'Bad', entries: [{ id: 'p', kind: 'prediction', text: 'p' }] }), (error) => error.code === 'EXPLORATION_THREAD_INVALID');
const validFingerprint = 'condition-a';
const validExperiment = { id: 'x', kind: 'experiment', experimentIds: ['a', 'b'], activeExperimentId: 'a', baselineExperimentId: 'b', comparison: { enabled: true, againstExperimentId: 'b' }, conditionFingerprints: { a: validFingerprint, b: 'condition-b' } };
assert.throws(() => validateExplorationThread({ version: 1, id: 'bad-active', title: 'Bad', entries: [{ ...validExperiment, activeExperimentId: 'missing' }] }), (error) => error.code === 'EXPLORATION_THREAD_INVALID');
assert.throws(() => validateExplorationThread({ version: 1, id: 'bad-compare', title: 'Bad', entries: [{ ...validExperiment, comparison: { enabled: true, againstExperimentId: 'missing' } }] }), (error) => error.code === 'EXPLORATION_THREAD_INVALID');
assert.throws(() => validateExplorationThread({ version: 1, id: 'bad-observation', title: 'Bad', entries: [{ id: 'o', kind: 'observation', experimentIds: ['a'], conditionFingerprints: {}, evidence: {} }] }), (error) => error.code === 'EXPLORATION_THREAD_INVALID');

const base = createExplorationThread({ id: 'bounds', title: 'Bounds' });
const entries = Array.from({ length: 100 }, (_, index) => ({ id: `q-${index}`, kind: 'question', text: `Question ${index}` }));
const bounded = entries.reduce((thread, entry) => appendExplorationThreadEntry(thread, entry), base);
assert.equal(bounded.entries.length, 100);
assert.throws(() => appendExplorationThreadEntry(bounded, { id: 'q-over', kind: 'question', text: 'one too many' }), (error) => error.code === 'EXPLORATION_THREAD_RESOURCE_LIMIT');
assert.doesNotThrow(() => validateExplorationThread(JSON.parse(JSON.stringify(bounded))));

console.log('Exploration thread checks passed: shared manual/Agent contract, compact references, deterministic historical evidence, condition identity, follow-up, resume, unavailable references, bounds, inspection parity, and JSON safety.');
