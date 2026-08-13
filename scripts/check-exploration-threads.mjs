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
agent.addExplorationThreadPrediction({ text: 'The fitted slope will move.' });

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

const playground = getPlayground('linear-regression');
const source = { kind: 'example', name: 'test', fingerprint: 'test', task: 'regression', points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 1, y: 1 }] };
// The missing-reference check uses the canonical reducer fixture, not a UI-only state.
let session = createPlaygroundSession(playground, { source, seed: 3 });
session = dispatchPlaygroundAction(session, { type: 'CREATE_EXPLORATION_THREAD', thread: { id: 'fixture-thread', title: 'Fixture' } });
session = dispatchPlaygroundAction(session, {
  type: 'RECORD_THREAD_EXPERIMENT',
  entry: {
    id: 'fixture-entry', kind: 'experiment', experimentIds: ['missing'], activeExperimentId: 'missing', baselineExperimentId: 'missing',
    comparison: { enabled: false, againstExperimentId: null }, conditionFingerprints: {},
  },
});
assert.throws(() => dispatchPlaygroundAction({
  ...session,
  experimentWorkspace: { ...session.experimentWorkspace, entries: {} },
}, { type: 'RESUME_THREAD_EXPERIMENT', entryId: 'fixture-entry' }), (error) => error.code === 'EXPLORATION_THREAD_EXPERIMENT_UNAVAILABLE');

const base = createExplorationThread({ id: 'bounds', title: 'Bounds' });
const entries = Array.from({ length: 100 }, (_, index) => ({ id: `q-${index}`, kind: 'question', text: `Question ${index}` }));
const bounded = entries.reduce((thread, entry) => appendExplorationThreadEntry(thread, entry), base);
assert.equal(bounded.entries.length, 100);
assert.throws(() => appendExplorationThreadEntry(bounded, { id: 'q-over', kind: 'question', text: 'one too many' }), (error) => error.code === 'EXPLORATION_THREAD_RESOURCE_LIMIT');
assert.doesNotThrow(() => validateExplorationThread(JSON.parse(JSON.stringify(bounded))));

console.log('Exploration thread checks passed: shared manual/Agent contract, compact references, deterministic historical evidence, condition identity, follow-up, resume, unavailable references, bounds, inspection parity, and JSON safety.');
