import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import ExperimentBar from '../src/components/playground/ExperimentBar.jsx';
import { resolveMessage } from '../src/i18n.js';

const t = (key, params) => resolveMessage(key, 'en', params);
const renderBar = (snapshot) => renderToStaticMarkup(React.createElement(ExperimentBar, {
  snapshot,
  onDispatch: () => {},
  t,
}));

export async function runUiExperimentBarSmoke() {
  const host = createPlaygroundHost({ getDataset: () => null });
  await host.open({ playgroundId: 'linear-regression', seed: 42 });
  let snapshot = host.getState();
  const experimentA = snapshot.experimentWorkspace.experiments[0];
  const initialMarkup = renderBar(snapshot);
  assert.ok(initialMarkup.includes('data-experiment-compact-initial="true"'), 'one experiment uses the compact initial presentation');
  assert.ok(initialMarkup.includes('My experiment'), 'initial state names the learner experiment plainly');
  assert.ok(initialMarkup.includes('Try another'), 'initial state leads with Try another');
  assert.ok(!initialMarkup.includes('Compare') && !initialMarkup.includes('Changed') && !initialMarkup.includes('Held constant'), 'comparison structure stays hidden before branching');

  await host.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
  snapshot = host.getState();
  const experimentB = snapshot.experimentWorkspace.experiments[1];
  const branchedMarkup = renderBar(snapshot);
  assert.ok(branchedMarkup.includes('Original') && branchedMarkup.includes('My experiment'), 'duplicate presents learner-facing A/B names');
  assert.ok(branchedMarkup.includes('Compare'), 'Compare becomes the primary next action after duplication');
  assert.ok(!branchedMarkup.includes('Changed') && !branchedMarkup.includes('Held constant'), 'comparison facts remain progressive until Compare is active');
  assert.ok(branchedMarkup.includes('Try another'), 'branched state keeps the duplicate action available');
  assert.equal(snapshot.experimentWorkspace.activeExperimentId, experimentB.id, 'duplicate activates the new branch');

  await host.dispatch({
    type: 'APPLY_WORLD_TRANSACTION',
    transaction: {
      id: 'ui-4-change-b',
      actor: 'human',
      intent: 'point',
      operations: [{ type: 'ADD_POINTS', points: [{ x: 10, y: 10, features: { x: 10, y: 10 }, membership: 'train' }] }],
    },
  });
  await host.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: experimentA.id });
  snapshot = host.getState();
  assert.deepEqual(snapshot.experimentWorkspace.comparison.diff.changed, ['world'], 'Compare exposes the runtime semantic diff');
  const comparisonBounds = snapshot.experimentWorkspace.comparison.bounds;
  const comparedMarkup = renderBar(snapshot);
  assert.ok(comparedMarkup.includes('Changed') && comparedMarkup.includes('Held constant'), 'Changed/Held constant appear only after Compare');
  assert.ok(comparedMarkup.includes('Clear comparison'), 'single-factor comparison uses the compact clarity signal');
  assert.ok(!comparedMarkup.includes('Result differences'), 'metric results are secondary behind View results');

  await host.dispatch({ type: 'SWITCH_EXPERIMENT', experimentId: experimentA.id });
  snapshot = host.getState();
  assert.deepEqual(snapshot.experimentWorkspace.comparison.bounds, comparisonBounds, 'switching to A preserves the shared comparison frame');
  await host.dispatch({ type: 'SWITCH_EXPERIMENT', experimentId: experimentB.id });
  snapshot = host.getState();
  assert.deepEqual(snapshot.experimentWorkspace.comparison.bounds, comparisonBounds, 'switching back to B preserves the shared comparison frame');

  await host.dispatch({ type: 'REPEAT_EXPERIMENT', trials: 2 });
  assert.equal(host.getState().repeatEvidence.trialCount, 2, 'Repeat remains available after comparison');
  await host.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.2 });
  await host.dispatch({ type: 'UNDO_EXPERIMENT_ACTION' });
  assert.equal(host.getState().controls.learningRate, 0.05, 'Undo remains available as a secondary experiment action');
  await host.dispatch({ type: 'ADD_POINT', x: 12, y: 12 });
  const bWorldAfterEdit = host.getState().world;
  await host.dispatch({ type: 'RESET' });
  assert.equal(host.getState().experimentWorkspace.activeExperimentId, experimentB.id, 'Reset remains available without changing experiment identity');
  assert.ok(host.getState().world.observations.length < bWorldAfterEdit.observations.length, 'Reset removes the secondary branch edit');

  await host.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
  snapshot = host.getState();
  const threeMarkup = renderBar(snapshot);
  assert.equal(snapshot.experimentWorkspace.experiments.length, 3, 'a third experiment remains supported');
  assert.ok(threeMarkup.includes('Experiment 3'), 'third branch receives a stable learner-facing alias');
  const aliases = snapshot.experimentWorkspace.experiments.map((_, index) => String.fromCharCode(65 + index));
  assert.equal(new Set(aliases).size, aliases.length, 'presentation aliases do not collide');
}
