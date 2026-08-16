import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { getPlayground } from '../src/core/playgrounds/registry.js';
import { CONCEPTUAL_DEPTHS } from '../src/core/ui/uiArchitecture.js';
import { deriveExploreDepthCapabilities, depthTelemetryType } from '../src/core/ui/exploreDepth.js';
import ExploreDetailsRegion from '../src/components/playground/ExploreDetailsRegion.jsx';
import { AiProvider } from '../src/components/ai/AiProviderContext.jsx';
import { resolveMessage } from '../src/i18n.js';

const t = (key, params) => resolveMessage(key, 'en', params);
const noop = () => {};

function renderDepth(snapshot, activeDepth, modelPlayground = null) {
  return renderToStaticMarkup(React.createElement(AiProvider, null,
    React.createElement(ExploreDetailsRegion, {
      snapshot,
      modelPlayground,
      bigIdea: null,
      agent: null,
      host: null,
      activeDepth,
      onDepthChange: noop,
      onDispatch: noop,
      onGuidanceChange: noop,
      formulaPrimitive: snapshot.primitives.find((primitive) => primitive.type === 'formula'),
      t,
    }),
  ));
}

function semanticIdentity(snapshot) {
  return {
    world: snapshot.world,
    activeExperimentId: snapshot.experimentWorkspace.activeExperimentId,
    comparison: snapshot.experimentWorkspace.comparison,
    experimentCount: snapshot.experimentWorkspace.experiments.length,
    repeatEvidence: snapshot.repeatEvidence,
  };
}

export async function runUiDepthSmoke() {
  assert.equal(depthTelemetryType(CONCEPTUAL_DEPTHS.EVIDENCE), 'depth_evidence_opened');
  assert.equal(depthTelemetryType(CONCEPTUAL_DEPTHS.MECHANISM), 'depth_mechanism_opened');
  assert.equal(depthTelemetryType(CONCEPTUAL_DEPTHS.REPRESENTATION), null);

  const host = createPlaygroundHost({ getDataset: () => null });
  await host.open({ playgroundId: 'linear-regression', seed: 808 });
  await host.dispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction: {
    id: 'ui-5-depth-move', actor: 'human', intent: 'move',
    operations: [{ type: 'MOVE_POINT', pointId: host.getState().world.observations[0].id, x: 0.3, y: 0.4 }],
  } });
  const experimentA = host.getState().experimentWorkspace.experiments[0];
  await host.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
  const experimentB = host.getState().experimentWorkspace.experiments[1];
  await host.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: experimentA.id });
  const snapshot = host.getState();
  const identityBefore = semanticIdentity(snapshot);
  const capabilities = deriveExploreDepthCapabilities(snapshot);
  assert.equal(capabilities.evidence, true, 'Linear Regression exposes deterministic evidence');
  assert.equal(capabilities.mechanism, true, 'Linear Regression exposes mechanism evidence');
  assert.equal(capabilities.representation, true, 'Linear Regression exposes model inspection');

  const initial = renderDepth(snapshot, null, getPlayground('linear-regression'));
  assert.ok(initial.includes('What do you want to look at next?'), 'depth prompt is visible by default');
  assert.ok(initial.includes('What changed?') && initial.includes('How does it learn?') && initial.includes('Inspect the model'), 'learner-facing depth entrances are visible');
  assert.equal(initial.includes('role="dialog"'), false, 'no depth panel opens by default');
  assert.equal(initial.includes('Training Microscope'), false, 'mechanism remains closed initially');
  assert.equal(initial.includes('Controls'), false, 'model inspector remains closed initially');

  const evidence = renderDepth(snapshot, CONCEPTUAL_DEPTHS.EVIDENCE, getPlayground('linear-regression'));
  assert.ok(evidence.includes('Semantic evidence and observations'), 'Evidence opens the existing deterministic evidence surface');
  assert.equal(evidence.includes('Training Microscope'), false, 'Evidence does not dump mechanism content');
  assert.equal(evidence.includes('Controls'), false, 'Evidence does not dump inspector content');

  const mechanism = renderDepth(snapshot, CONCEPTUAL_DEPTHS.MECHANISM, getPlayground('linear-regression'));
  assert.ok(mechanism.includes('Training Microscope') && mechanism.includes('Formula'), 'Mechanism composes the existing trace and formula surfaces');
  assert.equal(mechanism.includes('Semantic evidence and observations'), false, 'Mechanism is the exclusive active depth');
  assert.equal(mechanism.includes('Controls'), false, 'Mechanism does not dump inspector content');

  const inspector = renderDepth(snapshot, CONCEPTUAL_DEPTHS.REPRESENTATION, getPlayground('linear-regression'));
  assert.ok(inspector.includes('playground.controlsTitle') || inspector.includes('Controls'), 'Inspect model opens the real PlaygroundInspector');
  assert.equal(inspector.includes('Training Microscope'), false, 'Inspector does not dump mechanism content');

  assert.deepEqual(semanticIdentity(host.getState()), identityBefore, 'depth presentation navigation is semantically inert');
  assert.equal(host.getState().experimentWorkspace.activeExperimentId, experimentB.id, 'depth navigation preserves the active experiment');
  assert.equal(host.getState().experimentWorkspace.comparison.againstExperimentId, experimentA.id, 'depth navigation preserves comparison target');

  const knnHost = createPlaygroundHost({ getDataset: () => null });
  await knnHost.open({ playgroundId: 'knn-classification', seed: 809 });
  const knn = knnHost.getState();
  const knnCapabilities = deriveExploreDepthCapabilities(knn);
  assert.equal(knnCapabilities.mechanism, true, 'KNN exposes its decision timeline/formula');
  assert.equal(knnCapabilities.hasTrainingMechanism, false, 'KNN does not claim gradient training');
  const knnMechanism = renderDepth(knn, CONCEPTUAL_DEPTHS.MECHANISM, getPlayground('knn-classification'));
  assert.ok(knnMechanism.includes('How does it decide?'), 'non-gradient models use a truthful decision entrance');
  assert.equal(knnMechanism.includes('Training Microscope'), false, 'KNN does not render misleading training microscope content');

  const dataHost = createPlaygroundHost({ getDataset: () => null });
  await dataHost.open({ playgroundId: 'data-lab', seed: 810 });
  const data = dataHost.getState();
  const dataMarkup = renderDepth(data, null, null);
  assert.equal(dataMarkup.includes('How does it learn?'), false, 'model-free Data Lab does not expose model mechanism');
  assert.equal(dataMarkup.includes('Inspect the model'), false, 'model-free Data Lab does not expose inspector');

  return { passed: true, experimentCount: snapshot.experimentWorkspace.experiments.length, activeExperimentId: snapshot.experimentWorkspace.activeExperimentId };
}
