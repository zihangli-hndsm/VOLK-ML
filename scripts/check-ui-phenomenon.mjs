import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { derivePhenomenonCapabilities } from '../src/core/ui/phenomenon.js';
import { selectScatterBounds } from '../src/components/playground/dataWorkspaceGeometry.js';
import { resolveMessage } from '../src/i18n.js';

const worldSource = readFileSync(new URL('../src/components/playground/ExploreWorldRegion.jsx', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../src/components/playground/DataWorkspace.jsx', import.meta.url), 'utf8');
const dialogSource = readFileSync(new URL('../src/components/playground/UnifiedPlaygroundDialog.jsx', import.meta.url), 'utf8');
const experimentSource = readFileSync(new URL('../src/components/playground/ExperimentBar.jsx', import.meta.url), 'utf8');

assert.ok(worldSource.includes('derivePhenomenonCapabilities'), 'World region is capability-driven');
assert.ok(worldSource.includes('variant="phenomenon"'), 'L0 uses the shared Data Workspace gesture surface');
assert.ok(workspaceSource.includes('moreWorldTools'), 'full World tools remain reachable');
assert.ok(workspaceSource.includes('getVisiblePrimitives'), 'phenomenon rendering consumes runtime primitives');
assert.ok(workspaceSource.includes('rendererByPrimitiveType'), 'phenomenon rendering reuses the shared primitive renderer registry');
assert.ok(workspaceSource.includes('APPLY_WORLD_TRANSACTION'), 'phenomenon gestures commit through the canonical World transaction');
assert.ok(!workspaceSource.includes('weight *') && !workspaceSource.includes('calculateSlope'), 'phenomenon UI does not recompute model math');
assert.ok(experimentSource.includes('data-experiment-compact-initial'), 'initial Experiment identity has a compact presentation');

const host = createPlaygroundHost({ getDataset: () => null });
const initial = await host.open({ playgroundId: 'linear-regression', seed: 42 });
const capabilities = derivePhenomenonCapabilities(initial);
assert.equal(capabilities.available, true, 'Linear Regression exposes the editable phenomenon contract');
assert.ok(initial.primitives.some((primitive) => primitive.type === 'scatter'), 'L0 has World points');
assert.ok(initial.primitives.some((primitive) => primitive.type === 'regression-line'), 'L0 has the runtime regression response');
assert.equal(resolveMessage('playground.phenomenon.question', 'en'), 'What pattern does the model see?');
assert.equal(resolveMessage('playground.phenomenon.question', 'zh'), '模型看到了什么模式？');

const narrowAutoBounds = { xMin: -1.2, xMax: 1.2, yMin: -1.2, yMax: 1.2 };
const wideAutoBounds = { xMin: -1.2, xMax: 10.8, yMin: -1.2, yMax: 10.8 };
const sharedComparisonBounds = { xMin: -1.2, xMax: 10.8, yMin: -1.2, yMax: 10.8, xFeature: 'x', yFeature: 'y' };
assert.deepEqual(
  selectScatterBounds({ comparisonBounds: sharedComparisonBounds, xFeature: 'x', yFeature: 'y', autoBounds: narrowAutoBounds }),
  sharedComparisonBounds,
  'Phenomenon uses the shared Compare frame when the projection matches',
);
assert.deepEqual(
  selectScatterBounds({ comparisonBounds: sharedComparisonBounds, xFeature: 'x', yFeature: 'y', autoBounds: wideAutoBounds }),
  sharedComparisonBounds,
  'full Data and Phenomenon use the same shared Compare frame',
);
assert.deepEqual(
  selectScatterBounds({ comparisonBounds: null, xFeature: 'x', yFeature: 'y', autoBounds: narrowAutoBounds }),
  narrowAutoBounds,
  'Phenomenon returns to its own auto frame when Compare is disabled',
);

const comparisonHost = createPlaygroundHost({ getDataset: () => null });
await comparisonHost.open({ playgroundId: 'linear-regression', seed: 43 });
const comparisonA = comparisonHost.getState().experimentWorkspace.experiments[0];
await comparisonHost.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
const comparisonB = comparisonHost.getState().experimentWorkspace.experiments[1];
await comparisonHost.dispatch({
  type: 'APPLY_WORLD_TRANSACTION',
  transaction: {
    id: 'ui-3-phenomenon-comparison-range',
    actor: 'human',
    intent: 'point',
    operations: [{ type: 'ADD_POINTS', points: [{ x: 10, y: 10, features: { x: 10, y: 10 }, membership: 'train' }] }],
  },
});
await comparisonHost.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: comparisonA.id });
const comparisonSnapshot = comparisonHost.getState();
const runtimeComparisonBounds = comparisonSnapshot.experimentWorkspace.comparison.bounds;
assert.equal(comparisonSnapshot.experimentWorkspace.comparison.enabled, true, 'range-shifted experiments enable semantic comparison');
assert.ok(runtimeComparisonBounds.xMax > 5, 'comparison bounds include the substantially wider B support');
assert.deepEqual(
  selectScatterBounds({ comparisonBounds: runtimeComparisonBounds, xFeature: 'x', yFeature: 'y', autoBounds: narrowAutoBounds }),
  runtimeComparisonBounds,
  'runtime comparison bounds are selected by Phenomenon mode',
);
assert.equal(comparisonSnapshot.experimentWorkspace.activeExperimentId, comparisonB.id, 'range-shifted comparison keeps B active');

const point = initial.world.observations[0];
const moved = await host.dispatch({
  type: 'APPLY_WORLD_TRANSACTION',
  transaction: {
    id: 'ui-3-phenomenon-move',
    actor: 'human',
    intent: 'move',
    operations: [{ type: 'MOVE_POINT', pointId: point.id, x: point.x + 0.25, y: point.y + 0.25 }],
  },
});
assert.equal(moved.world.observations.find((candidate) => candidate.id === point.id).x, point.x + 0.25, 'direct manipulation changes the shared World');
assert.equal(derivePhenomenonCapabilities(moved).available, true, 'moving a point keeps the same phenomenon capability');

const dataHost = createPlaygroundHost({ getDataset: () => null });
const dataOnly = await dataHost.open({ playgroundId: 'data-lab', seed: 42 });
assert.equal(derivePhenomenonCapabilities(dataOnly).available, false, 'no attached model uses the compatibility fallback');

console.log('UI-3 phenomenon checks passed: capability contract, runtime primitives, shared World gestures, compact Experiment identity, localization, and fallback behavior.');
