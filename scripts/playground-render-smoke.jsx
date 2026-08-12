import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { getPlayground } from '../src/core/playgrounds/registry.js';
import { createPlaygroundSession, dispatchPlaygroundAction, derivePlaygroundSnapshot } from '../src/core/playgrounds/session.js';
import { createScriptRuntime } from '../src/core/playground/visualization/scriptRuntime.js';
import { getPreset } from '../src/core/playground/visualization/presetRegistry.js';
import { fallbackRegressionPoints } from '../src/core/linearRegressionPlayground.js';
import PlaygroundStage from '../src/components/playground/PlaygroundStage.jsx';
import PlaygroundInspector from '../src/components/playground/PlaygroundInspector.jsx';
import DataWorkspace from '../src/components/playground/DataWorkspace.jsx';
import PresentationMode from '../src/components/playground/PresentationMode.jsx';
import VoteBarRenderer from '../src/components/playground/renderers/VoteBarRenderer.jsx';
import ParameterTrajectoryRenderer from '../src/components/playground/renderers/ParameterTrajectoryRenderer.jsx';
import NetworkGraphRenderer from '../src/components/playground/renderers/NetworkGraphRenderer.jsx';
import MatrixGridRenderer from '../src/components/playground/renderers/MatrixGridRenderer.jsx';
import HistogramRenderer from '../src/components/playground/renderers/HistogramRenderer.jsx';
import { buildLabelColorMap } from '../src/components/playground/visualEncoding.js';
import { generateXorDataset } from '../src/core/playground/model/mlpMath.js';

const t = (key) => key;
const noopDispatch = () => {};

const makeDriver = (getSession, setSession) => ({
  dispatch: (action) => setSession(dispatchPlaygroundAction(getSession(), action)),
  getState: () => derivePlaygroundSnapshot(getSession()),
  getAdapterId: () => getSession().adapterId,
  resetToBaseline: () => setSession(dispatchPlaygroundAction(getSession(), { type: 'RESET' })),
  subscribe: () => () => {},
});

const snapshotsForPreset = (playground, source, presetId, seed) => {
  let session = createPlaygroundSession(playground, { source, seed, sessionId: 'render-smoke' });
  const driver = makeDriver(() => session, (next) => { session = next; });
  const runtime = createScriptRuntime(driver).load(structuredClone(getPreset(presetId)));
  runtime.initialize();
  const snapshots = [derivePlaygroundSnapshot(session)];
  const total = getPreset(presetId).steps.length;
  for (let index = 0; index < total; index += 1) {
    runtime.step();
    snapshots.push(derivePlaygroundSnapshot(session));
  }
  return snapshots;
};

const renderStageAndInspector = (playground, snapshot) => {
  renderToStaticMarkup(React.createElement(PlaygroundStage, { snapshot, t }));
  renderToStaticMarkup(React.createElement(PlaygroundInspector, { playground, snapshot, onDispatch: noopDispatch, t }));
  renderToStaticMarkup(React.createElement(PresentationMode, { playground, snapshot, onDispatch: noopDispatch, onExit: noopDispatch, t }));
};

// The smoke entry is bundled and executed by scripts/check-playground-render.mjs.
export function runPlaygroundRenderSmoke() {
  const knn = getPlayground('knn-classification');
  const lr = getPlayground('linear-regression');
  const knnSource = {
    kind: 'example', name: 'Example', fingerprint: 'render-knn',
    points: Array.from({ length: 60 }, (_, index) => ({
      id: `k${index}`,
      features: { a: (index % 6) - 3 + (index % 2), b: Math.floor(index / 6) - 5 },
      label: index % 2 === 0 ? 'red' : 'blue',
    })),
    featureColumns: ['a', 'b'],
  };
  const lrSource = {
    kind: 'example', name: 'Example', fingerprint: 'render-lr',
    points: fallbackRegressionPoints.map((point, index) => ({ id: `e${index}`, x: point.x, y: point.y })),
    feature: 'x', target: 'y',
  };

  // KNN: every preset step must render Stage + Inspector without throwing.
  const knnSnapshots = snapshotsForPreset(knn, knnSource, 'knn.intro', 3);
  assert.equal(knnSnapshots[0].scene.voting.counts && Object.keys(knnSnapshots[0].scene.voting.counts).length, 0, 'initial vote is empty');
  assert.equal(knnSnapshots[2].metrics.revealed, 0, 'after tracePredict reveal is still 0');
  for (const snapshot of knnSnapshots) renderStageAndInspector(knn, snapshot);

  // The original crash: the first snapshot with a non-empty vote must render.
  const firstVote = knnSnapshots.find((snapshot) => Object.keys(snapshot.scene.voting.counts).length > 0);
  assert.ok(firstVote, 'fixture actually contains a non-empty vote');
  assert.ok(firstVote.metrics.revealed >= 1, 'first non-empty vote happens after a reveal');
  assert.ok(firstVote.script.layout.side.includes('vote-bars'), 'vote-bars is in the side layout');
  assert.ok(firstVote.primitives.some((primitive) => primitive.type === 'vote-bars'), 'vote-bars primitive is materialized');
  renderStageAndInspector(knn, firstVote);

  // Completed KNN and decision-region snapshots render.
  const completed = knnSnapshots.at(-1);
  assert.ok(completed.metrics.predictedLabel !== null, 'completed KNN has a prediction');
  assert.ok(completed.controls.showDecisionRegions === true, 'decision regions enabled at completion');
  renderStageAndInspector(knn, completed);

  // Shared visual encoding: scatter, neighbor links and vote bars use the same
  // label color, and the mapping is deterministic.
  const scatter = firstVote.primitives.find((primitive) => primitive.type === 'scatter');
  const colorByLabel = buildLabelColorMap(scatter?.props?.points);
  const label = Object.keys(firstVote.scene.voting.counts)[0];
  const sharedColor = colorByLabel[label];
  assert.ok(sharedColor, 'first vote label has a color');
  assert.deepEqual(buildLabelColorMap(scatter?.props?.points), colorByLabel, 'color mapping is deterministic');
  const stageMarkup = renderToStaticMarkup(React.createElement(PlaygroundStage, { snapshot: firstVote, t }));
  const voteMarkup = renderToStaticMarkup(React.createElement(VoteBarRenderer, { props: { voting: firstVote.scene.voting }, t, colorByLabel }));
  assert.ok(stageMarkup.includes(sharedColor), 'scatter/neighbor rendering uses the shared label color');
  assert.ok(voteMarkup.includes(sharedColor), 'vote bar uses the shared label color');

  // VoteBarRenderer must never throw, with or without optional visual context.
  renderToStaticMarkup(React.createElement(VoteBarRenderer, { props: { voting: firstVote.scene.voting }, t }));
  renderToStaticMarkup(React.createElement(VoteBarRenderer, { props: { voting: firstVote.scene.voting }, t, colorByLabel }));
  renderToStaticMarkup(React.createElement(VoteBarRenderer, { props: {}, t }));
  renderToStaticMarkup(React.createElement(VoteBarRenderer, { props: { voting: null }, t }));
  renderToStaticMarkup(React.createElement(VoteBarRenderer, { props: { voting: { counts: 'broken', predictedLabel: 'x' } }, t }));

  // LR: every preset step must render Stage + Inspector without throwing.
  const lrSnapshots = snapshotsForPreset(lr, lrSource, 'linear-regression.intuition', 7);
  for (const snapshot of lrSnapshots) renderStageAndInspector(lr, snapshot);
  const workspaceMarkup = renderToStaticMarkup(React.createElement(DataWorkspace, {
    snapshot: lrSnapshots[0], onDispatch: noopDispatch, t,
  }));
  assert.ok(workspaceMarkup.includes('playground.workspace.title'), 'editable LR workspace renders from capability snapshot');
  assert.ok(workspaceMarkup.includes('playground.workspace.tool.brush'), 'workspace exposes brush tool semantics');
  assert.ok(workspaceMarkup.includes('playground.workspace.undo'), 'workspace exposes runtime Undo control');
  assert.equal(renderToStaticMarkup(React.createElement(DataWorkspace, {
    snapshot: knnSnapshots[0], onDispatch: noopDispatch, t,
  })), '', 'unsupported adapters do not receive editable workspace controls');

  // PR F.1: the MLP preset trains, reveals epochs and hidden activations; the
  // new toolkit primitives (network-graph, matrix-grid, parameter-trajectory,
  // histogram) render at every step and degrade gracefully with empty props.
  const mlp = getPlayground('mlp-classification');
  const mlpSource = {
    kind: 'example', name: 'XOR', fingerprint: 'render-mlp',
    points: generateXorDataset({ seed: 3 }),
    featureColumns: ['x1', 'x2'],
  };
  const mlpSnapshots = snapshotsForPreset(mlp, mlpSource, 'mlp.intro', 3);
  for (const snapshot of mlpSnapshots) renderStageAndInspector(mlp, snapshot);
  const mlpFinal = mlpSnapshots.at(-1);
  assert.ok(mlpFinal.script.layout.stage.includes('network-graph'), 'MLP preset stage includes network-graph');
  assert.ok(mlpFinal.primitives.some((primitive) => primitive.type === 'parameter-trajectory'), 'parameter-trajectory is materialized');
  assert.ok(mlpFinal.primitives.some((primitive) => primitive.type === 'matrix-grid'), 'matrix-grid is materialized');
  assert.ok(mlpFinal.primitives.some((primitive) => primitive.type === 'loss-curve'), 'loss-curve is materialized');
  assert.ok(Array.isArray(mlpFinal.scene.histogram.bins) && mlpFinal.scene.histogram.bins.length > 0, 'MLP scene provides histogram bins');
  for (const Renderer of [ParameterTrajectoryRenderer, NetworkGraphRenderer, MatrixGridRenderer, HistogramRenderer]) {
    renderToStaticMarkup(React.createElement(Renderer, { props: {}, t }));
    renderToStaticMarkup(React.createElement(Renderer, { props: { points: [], nodes: [], edges: [], cells: [], bins: [] }, t }));
  }
  const histogramSnapshot = {
    ...mlpFinal,
    script: { ...mlpFinal.script, layout: { ...mlpFinal.script.layout, side: ['histogram'] } },
    primitives: [...mlpFinal.primitives, { id: 'histogram', type: 'histogram', props: { bins: mlpFinal.scene.histogram.bins } }],
  };
  renderToStaticMarkup(React.createElement(PlaygroundInspector, { playground: mlp, snapshot: histogramSnapshot, onDispatch: noopDispatch, t }));

  console.log(
    `Playground render smoke passed: ${knnSnapshots.length} KNN snapshots, ${lrSnapshots.length} LR snapshots, ${mlpSnapshots.length} MLP snapshots, first non-empty vote at revealed=${firstVote.metrics.revealed}.`,
  );
  return {
    knnSteps: knnSnapshots.length,
    lrSteps: lrSnapshots.length,
    mlpSteps: mlpSnapshots.length,
    firstVoteRevealed: firstVote.metrics.revealed,
  };
}
