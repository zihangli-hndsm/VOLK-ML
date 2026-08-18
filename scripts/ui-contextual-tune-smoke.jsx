import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { getPlayground } from '../src/core/playgrounds/registry.js';
import { deriveTuneControlGroups, deriveTuneControlState } from '../src/core/ui/contextualTune.js';
import TunePanel from '../src/components/playground/TunePanel.jsx';
import { resolveMessage } from '../src/i18n.js';

const t = (key, params) => resolveMessage(key, 'en', params);

function renderTune(playground, snapshot, onDispatch = () => {}) {
  return renderToStaticMarkup(<TunePanel playground={playground} snapshot={snapshot} onDispatch={onDispatch} onOpenWorldTools={() => {}} t={t} />);
}

export async function runContextualTuneSmoke() {
  const knnHost = createPlaygroundHost({ getDataset: () => null });
  await knnHost.open({ playgroundId: 'knn-classification', seed: 913 });
  const knnSnapshot = knnHost.getState();
  const knn = getPlayground('knn-classification');
  const knnGroups = deriveTuneControlGroups(knn, knnSnapshot);
  assert.deepEqual(knnGroups.primary.map((control) => control.key), ['k'], 'KNN declares k as the primary Tune control');
  assert.ok(knnGroups.more.some((control) => control.key === 'normalize'), 'KNN secondary controls remain reachable');
  assert.equal(knn.controls.find((control) => control.key === 'k').domain, 'model');
  assert.equal(knn.controls.find((control) => control.key === 'k').presentation.importance, 'primary');
  const knnMarkup = renderTune(knn, knnSnapshot);
  assert.ok(knnMarkup.includes('Primary controls') && knnMarkup.includes('Neighbors (k)'));
  assert.ok(knnMarkup.includes('How many nearby points vote?'));
  assert.equal(knnMarkup.includes('Distance metric'), false, 'secondary KNN controls are behind More controls initially');

  const lrHost = createPlaygroundHost({ getDataset: () => null });
  await lrHost.open({ playgroundId: 'linear-regression', seed: 914 });
  const lrSnapshot = lrHost.getState();
  const lr = getPlayground('linear-regression');
  const lrGroups = deriveTuneControlGroups(lr, lrSnapshot);
  assert.deepEqual(lrGroups.primary.map((control) => control.key), ['learningRate', 'trainingSteps'], 'Linear Regression emphasizes learning controls');
  assert.ok(lrGroups.more.some((control) => control.key === 'weight') && lrGroups.more.some((control) => control.key === 'showBestFit'), 'Linear Regression inspection controls remain reachable');
  const lrMarkup = renderTune(lr, lrSnapshot);
  assert.ok(lrMarkup.includes('Learning rate') && lrMarkup.includes('Training steps'));
  assert.equal(lrMarkup.includes('Weight'), false, 'model inspection controls are not prominent initially');

  const changedSnapshot = structuredClone(lrSnapshot);
  changedSnapshot.experimentWorkspace.comparison = {
    enabled: true,
    diff: {
      changed: ['learning'],
      unchanged: ['model', 'evaluation', 'world', 'trainTest', 'randomness'],
      factors: {
        learning: { left: { controls: { learningRate: 0.01, trainingSteps: 10 } }, right: { controls: { learningRate: 0.2, trainingSteps: 10 } } },
      },
    },
  };
  assert.deepEqual(deriveTuneControlState(lr.controls.find((control) => control.key === 'learningRate'), changedSnapshot.experimentWorkspace.comparison.diff), { changed: true, held: false });
  assert.deepEqual(deriveTuneControlState(lr.controls.find((control) => control.key === 'weight'), changedSnapshot.experimentWorkspace.comparison.diff), { changed: false, held: true });
  const changedMarkup = renderTune(lr, changedSnapshot);
  assert.ok(changedMarkup.includes('Changed') && changedMarkup.includes('Held constant'), 'deterministic comparison state marks changed and held controls');

  const legacy = { id: 'legacy', controls: [{ key: 'legacyControl', type: 'number', min: 0, max: 1, step: 0.1, domain: 'model' }] };
  const legacySnapshot = { ...lrSnapshot, controls: { ...lrSnapshot.controls, legacyControl: 0.5 }, experimentWorkspace: { ...lrSnapshot.experimentWorkspace, comparison: { enabled: false } } };
  const legacyGroups = deriveTuneControlGroups(legacy, legacySnapshot);
  assert.equal(legacyGroups.primary.length, 0);
  assert.equal(legacyGroups.more[0].key, 'legacyControl', 'controls without presentation metadata stay reachable through More');

  let dispatched = 0;
  renderTune(knn, knnSnapshot, () => { dispatched += 1; });
  assert.equal(dispatched, 0, 'opening/rendering Tune does not dispatch runtime actions');
  await knnHost.close();
  await lrHost.close();
  return { passed: true, knnPrimary: knnGroups.primary.map((control) => control.key), lrPrimary: lrGroups.primary.map((control) => control.key) };
}
