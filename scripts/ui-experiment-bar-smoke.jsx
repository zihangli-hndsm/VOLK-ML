import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { projectedBounds } from '../src/core/exploration/projection.js';
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
  await host.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.2 });
  snapshot = host.getState();
  assert.equal(snapshot.capabilities.canUndoExperiment, true, 'a control edit exposes the canonical experiment Undo capability');
  await host.dispatch({ type: 'UNDO_EXPERIMENT_ACTION' });
  assert.equal(host.getState().controls.learningRate, 0.05, 'compact Undo restores the previous control value');
  await host.dispatch({ type: 'RUN' });

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
  await host.dispatch({ type: 'RUN' });
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
  const worldA = snapshot.world;
  assert.deepEqual(snapshot.experimentWorkspace.comparison.bounds, comparisonBounds, 'switching to A preserves the shared comparison frame');
  await host.dispatch({ type: 'SWITCH_EXPERIMENT', experimentId: experimentB.id });
  snapshot = host.getState();
  const worldB = snapshot.world;
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
  await host.dispatch({ type: 'ADD_POINT', x: 10, y: 10 });

  await host.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
  snapshot = host.getState();
  const threeMarkup = renderBar(snapshot);
  const experimentC = snapshot.experimentWorkspace.experiments[2];
  assert.equal(snapshot.experimentWorkspace.experiments.length, 3, 'a third experiment remains supported');
  assert.ok(threeMarkup.includes('A Original') && threeMarkup.includes('B Experiment 2') && threeMarkup.includes('C Experiment 3'), 'three branches receive progressive learner-facing names');
  assert.ok(!threeMarkup.includes('B My experiment'), 'My experiment is not permanently attached to the second branch');
  const aliases = snapshot.experimentWorkspace.experiments.map((_, index) => String.fromCharCode(65 + index));
  assert.equal(new Set(aliases).size, aliases.length, 'presentation aliases do not collide');

  await host.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.2 });
  await host.dispatch({ type: 'RUN' });
  await host.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: experimentA.id });
  snapshot = host.getState();
  assert.equal(snapshot.experimentWorkspace.comparison.againstExperimentId, experimentA.id, 'C can compare explicitly against A');
  assert.deepEqual(snapshot.experimentWorkspace.comparison.diff.changed, ['world', 'learning'], 'C vs A has two real changed semantic dimensions');
  assert.equal(snapshot.experimentWorkspace.comparison.diff.clarity, 'mixed', 'C vs A uses runtime mixed clarity');
  const cAgainstABounds = snapshot.experimentWorkspace.comparison.bounds;
  const cAgainstAMarkup = renderBar(snapshot);
  assert.ok(cAgainstAMarkup.includes('Compare with') && cAgainstAMarkup.includes('Mixed comparison') && cAgainstAMarkup.includes('2 things changed'), 'UI renders mixed comparison from runtime diff facts');
  assert.ok(cAgainstAMarkup.includes('aria-pressed="true"'), 'selected comparison target is visually/statefully exposed');

  const resultsAgainstA = snapshot.experimentWorkspace.comparison.results.against;
  await host.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: experimentB.id });
  snapshot = host.getState();
  assert.equal(snapshot.experimentWorkspace.comparison.againstExperimentId, experimentB.id, 'C can compare explicitly against B');
  assert.deepEqual(snapshot.experimentWorkspace.comparison.diff.changed, ['learning'], 'switching target recomputes the runtime diff');
  assert.notDeepEqual(snapshot.experimentWorkspace.comparison.results.against, resultsAgainstA, 'switching target recomputes the runtime comparison result');
  const cWorld = snapshot.world;
  const expectedCBLeft = projectedBounds(cWorld.observations, 'x', 'y');
  const expectedCBRight = projectedBounds(worldB.observations, 'x', 'y');
  const expectedCB = {
    xMin: Math.min(expectedCBLeft.xMin, expectedCBRight.xMin),
    xMax: Math.max(expectedCBLeft.xMax, expectedCBRight.xMax),
    yMin: Math.min(expectedCBLeft.yMin, expectedCBRight.yMin),
    yMax: Math.max(expectedCBLeft.yMax, expectedCBRight.yMax),
    xFeature: 'x',
    yFeature: 'y',
  };
  assert.deepEqual(snapshot.experimentWorkspace.comparison.bounds, expectedCB, 'switching target recomputes the shared bounds for C/B');
  assert.ok(Number.isFinite(cAgainstABounds.xMin), 'C/A also retained a deterministic comparison bounds object');
  const expectedCALeft = projectedBounds(cWorld.observations, 'x', 'y');
  const expectedCARight = projectedBounds(worldA.observations, 'x', 'y');
  assert.deepEqual(cAgainstABounds, {
    xMin: Math.min(expectedCALeft.xMin, expectedCARight.xMin),
    xMax: Math.max(expectedCALeft.xMax, expectedCARight.xMax),
    yMin: Math.min(expectedCALeft.yMin, expectedCARight.yMin),
    yMax: Math.max(expectedCALeft.yMax, expectedCARight.yMax),
    xFeature: 'x',
    yFeature: 'y',
  }, 'C/A captured its own deterministic comparison bounds');
}
