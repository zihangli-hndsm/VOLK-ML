import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { getPlayground, listPlaygroundDescriptors } from '../src/core/playgrounds/registry.js';
import { derivePlayQuickControl } from '../src/core/ui/playQuickControl.js';
import PlayQuickControl from '../src/components/playground/PlayQuickControl.jsx';

const t = (key) => ({
  'playground.quickControl.ariaLabel': 'Quick experiment control',
  'playground.quickControl.prompt': 'Try changing this',
  'playground.control.k': 'Neighbors (k)',
  'playground.control.learningRate': 'Learning rate',
  'playground.control.trainingSteps': 'Training steps',
  'playground.controlHint.k': 'How many nearby points vote?',
  'playground.controlHint.learningRate': 'How large is each training update?',
  'playground.controlHint.trainingSteps': 'How long should training continue?',
  'playground.experiment.changed': 'Changed',
  'playground.experiment.heldConstant': 'Held constant',
}[key] ?? key);

function renderQuick(playground, snapshot) {
  return renderToStaticMarkup(<PlayQuickControl playground={playground} snapshot={snapshot} onDispatch={() => {}} t={t} />);
}

export async function runPlayQuickControlSmoke() {
  const hosts = new Map();
  const snapshots = new Map();
  for (const id of ['knn-classification', 'linear-regression', 'mlp-classification', 'data-lab']) {
    const host = createPlaygroundHost({ getDataset: () => null });
    await host.open({ playgroundId: id, seed: 1301 });
    hosts.set(id, host);
    snapshots.set(id, host.getState());
  }

  for (const playground of listPlaygroundDescriptors()) {
    const snapshot = snapshots.get(playground.id);
    if (!snapshot) continue;
    const markup = renderQuick(playground, snapshot);
    assert.ok((markup.match(/data-ui-quick-control/g) ?? []).length <= 1, `${playground.id} exposes at most one Play quick control`);
    assert.equal(markup.includes('overflow-x'), false, `${playground.id} does not add horizontal overflow`);
  }

  const knn = getPlayground('knn-classification');
  const knnSnapshot = snapshots.get('knn-classification');
  assert.equal(derivePlayQuickControl(knn, knnSnapshot)?.key, 'k', 'KNN uses its unique declared quick-control default');
  assert.ok(renderQuick(knn, knnSnapshot).includes('Neighbors (k)'), 'KNN quick control is visible on Play');

  const lr = getPlayground('linear-regression');
  const lrSnapshot = snapshots.get('linear-regression');
  assert.equal(derivePlayQuickControl(lr, lrSnapshot), null, 'Linear Regression does not choose between two eligible controls without context');
  assert.equal(renderQuick(lr, lrSnapshot), '', 'null selection renders no placeholder');
  assert.equal(derivePlayQuickControl(lr, { ...lrSnapshot, scenario: { variable: { key: 'trainingSteps' } } })?.key, 'trainingSteps', 'scenario variable resolves one eligible control');

  const mlp = getPlayground('mlp-classification');
  const mlpSnapshot = snapshots.get('mlp-classification');
  assert.equal(derivePlayQuickControl(mlp, mlpSnapshot)?.key, 'hiddenUnits', 'MLP exposes one declared default, never its full primary inventory');
  assert.equal(mlp.controls.filter((control) => normalizeQuick(control)).length, 3, 'MLP has three eligible candidates but selection remains bounded to one');

  const lrHost = hosts.get('linear-regression');
  const experimentA = lrSnapshot.experimentWorkspace.experiments[0];
  await lrHost.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
  await lrHost.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.2 });
  await lrHost.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: experimentA.id });
  const oneChanged = lrHost.getState();
  assert.equal(derivePlayQuickControl(lr, oneChanged)?.key, 'learningRate', 'real comparison selects the one changed eligible control');
  assert.ok(renderQuick(lr, oneChanged).includes('Changed'), 'quick control reuses exact comparison status');

  await lrHost.dispatch({ type: 'SET_CONTROL', key: 'trainingSteps', value: 42 });
  const twoChanged = lrHost.getState();
  assert.equal(derivePlayQuickControl(lr, twoChanged), null, 'two equally eligible changed controls resolve to no quick control');

  const worldOnly = {
    ...knnSnapshot,
    scenario: {
      pedagogicalDesign: { goal: 'class-separation' },
      change: [{ operation: 'APPLY_WORLD_TRANSACTION', parameters: { operations: [] } }],
    },
  };
  assert.equal(derivePlayQuickControl(knn, worldOnly), null, 'World-only pedagogical scenarios do not map to a model quick control');

  const knnHost = hosts.get('knn-classification');
  const quick = derivePlayQuickControl(knn, knnSnapshot);
  const priorExperiment = knnSnapshot.experiment;
  await knnHost.dispatch({ type: 'SET_CONTROL', key: quick.key, value: 1 });
  const changedKnn = knnHost.getState();
  assert.equal(changedKnn.controls[quick.key], 1, 'quick-control value follows the runtime snapshot');
  assert.equal(changedKnn.experiment.model.controls[quick.key], 1, 'quick control uses normal Experiment SET_CONTROL semantics');
  assert.notDeepEqual(changedKnn.experiment, priorExperiment, 'changing quick control changes Experiment state normally');
  assert.equal(quick.key, 'k', 'Tune and Play consume the same KNN descriptor key/value');

  const weight = lr.controls.find((control) => control.key === 'weight');
  const bias = lr.controls.find((control) => control.key === 'bias');
  const view = lr.controls.find((control) => control.key === 'showResiduals');
  assert.equal(normalizeQuick(weight), false, 'derived weight is not quick eligible');
  assert.equal(normalizeQuick(bias), false, 'derived bias is not quick eligible');
  assert.equal(normalizeQuick(view), false, 'view controls are not quick eligible');
  assert.equal(derivePlayQuickControl(lr, { ...lrSnapshot, controls: { ...lrSnapshot.controls, weight: 99, bias: 2 } }), null, 'derived output changes cannot create a quick control');
  assert.equal(renderQuick(getPlayground('data-lab'), snapshots.get('data-lab')), '', 'AI-free Data Lab without a model stays empty');

  for (const host of hosts.values()) await host.close();
  return { passed: true };
}

function normalizeQuick(control) {
  return control.presentation?.quickControl === true;
}
