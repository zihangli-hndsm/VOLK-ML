import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { deriveLumiExplorationPlan } from '../src/core/ui/lumiExplorationPlanner.js';
import {
  compareExploreEnvironment,
  createBuildExploreBridge,
  createExploreEnvironmentIdentity,
  createExploreWorkspaceRecord,
  EXPLORE_WORKSPACE_LIFECYCLES,
} from '../src/core/exploration/exploreWorkspace.js';
import { deriveInquiryTrailEntries } from '../src/core/exploration/inquiryEpisodes.js';

const buildDataset = { name: 'Build data', task: 'classification', rows: [{ x: 1, y: 2, label: 'a' }] };
let buildState = { modelAdapterId: 'knn', dataset: buildDataset };
const explore = createPlaygroundHost({ getDataset: () => null, exploreRecipeId: 'model-capacity' });
await explore.openBigIdeaEntrance({ id: 'model-capacity', seed: 7105 });
const first = explore.getState();
assert.equal(first.bigIdea.id, 'model-capacity', 'Explore owns the selected built-in identity');
assert.equal(first.model.adapterId, 'mlp', 'built-in MLP Explore uses its recipe adapter');
assert.equal(first.source.kind, 'example', 'built-in Explore does not consume the Build dataset');
const originalWorld = JSON.stringify(first.world);
const originalCondition = explore.inspectContext().conditionFingerprint;
buildState = { modelAdapterId: 'resnet', dataset: { name: 'CIFAR', task: 'image', rows: [] } };
const afterBuildMutation = explore.getState();
assert.equal(afterBuildMutation.model.adapterId, 'mlp', 'Build model mutation does not change Explore model');
assert.equal(JSON.stringify(afterBuildMutation.world), originalWorld, 'Build dataset mutation does not change Explore World');
assert.equal(afterBuildMutation.source.kind, 'example', 'Build dataset mutation does not rebase Explore source');
assert.equal(afterBuildMutation.experiment.id, first.experiment.id, 'Explore experiment remains attached to its own environment');
assert.equal(originalCondition, explore.inspectContext().conditionFingerprint, 'Explore condition remains stable across Build changes');

const second = createPlaygroundHost({ getDataset: () => ({ name: 'ignored', task: 'regression', rows: [] }), exploreRecipeId: 'model-capacity' });
await second.openBigIdeaEntrance({ id: 'model-capacity', seed: 7105 });
assert.deepEqual(second.getState().world, first.world, 'built-in Explore recipe is deterministic and ignores active Build data');
assert.deepEqual(second.getExploreEnvironmentIdentity(), explore.getExploreEnvironmentIdentity(), 'environment identity is reproducible');

const expected = createExploreEnvironmentIdentity({ recipeId: 'model-capacity', playgroundId: 'mlp-classification', modelAdapterId: 'mlp' });
assert.equal(compareExploreEnvironment(expected, explore.getExploreEnvironmentIdentity()).compatible, true, 'matching Explore environment passes compatibility');
const mismatch = compareExploreEnvironment(expected, createExploreEnvironmentIdentity({ recipeId: 'other', playgroundId: 'data-lab', modelAdapterId: 'knn', sourceFingerprint: 'build' }));
assert.equal(mismatch.compatible, false, 'environment mismatch is detected');
assert.ok(mismatch.mismatches.includes('recipeId'), 'mismatch reports recipe provenance');
assert.equal(explore.getState().model.adapterId, 'mlp', 'mismatch detection does not silently rebase the session');

const boundedWorkspace = createExploreWorkspaceRecord({ id: 'x'.repeat(400), recipeId: 'r'.repeat(400), playgroundId: 'mlp-classification' });
assert.ok(boundedWorkspace.id.length <= 160 && boundedWorkspace.recipeId.length <= 160, 'workspace identifiers remain bounded');
assert.equal(boundedWorkspace.lifecycle, EXPLORE_WORKSPACE_LIFECYCLES.PERSISTENT, 'built-in workspaces are persistent by default');
assert.equal(createExploreWorkspaceRecord({ id: 'fork', lifecycle: EXPLORE_WORKSPACE_LIFECYCLES.EPHEMERAL }).lifecycle, 'ephemeral', 'explicit Build forks are ephemeral');
const strictHost = createPlaygroundHost({ getDataset: () => null });
await strictHost.open({ playgroundId: 'linear-regression', seed: 19 });
const strictBefore = strictHost.getState();
await assert.rejects(() => strictHost.ensureOpen('data-lab', { strict: true }), /PLAYGROUND_ALREADY_OPEN/, 'strict Explore ensureOpen rejects a mismatched session');
assert.equal(strictHost.getState().experiment.id, strictBefore.experiment.id, 'strict ensureOpen does not mutate a mismatched host');
await strictHost.close();
const bridgeBuild = { modelAdapterId: 'knn', dataset: { task: 'classification', featureColumns: ['x', 'y'], targetColumn: 'label', columns: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 'label', type: 'string' }], rows: [{ x: 1, y: 2, label: 'a' }, { x: -1, y: -2, label: 'b' }] } };
const supportedBridge = createBuildExploreBridge({ build: bridgeBuild, target: 'data-lab' });
assert.equal(supportedBridge.supported, true, 'explicit compatible Build bridge is supported');
assert.equal(supportedBridge.kind, 'explicit-build-bridge');
assert.match(supportedBridge.workspace.id, /^explore-custom-data-lab/);
const customDataset = bridgeBuild.dataset;
const customExplore = createPlaygroundHost({ getDataset: () => structuredClone(customDataset), exploreRecipeId: supportedBridge.workspace.recipeId });
await customExplore.ensureOpen('data-lab');
await customExplore.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: supportedBridge.modelPlaygroundId, actor: 'system' });
assert.equal(customExplore.getState().model.adapterId, 'knn', 'explicit bridge materializes the selected Build adapter');
assert.equal(customExplore.getState().source.kind, 'workspace-dataset', 'explicit bridge materializes the selected Build dataset');
const unsupportedBridge = createBuildExploreBridge({ build: { modelAdapterId: 'resnet', dataset: { task: 'image', rows: [] } }, target: 'data-lab' });
assert.equal(unsupportedBridge.supported, false, 'unsupported Build configuration is rejected');
assert.equal(unsupportedBridge.workspace, null, 'unsupported configuration cannot create a fake Explore workspace');

const mainSource = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const dialogSource = readFileSync(new URL('../src/components/playground/UnifiedPlaygroundDialog.jsx', import.meta.url), 'utf8');
assert.doesNotMatch(mainSource, /getDataset:\s*\(\)\s*=>\s*workspaceStateRef\.current\.dataset/, 'Explore no longer closes over Build dataset state');
assert.match(mainSource, /exploreWorkspacesRef/, 'application owns Explore sessions separately');
assert.match(dialogSource, /preserveSession/, 'closing the Explore dialog preserves its session owner');
assert.match(mainSource, /closeExploreWorkspace/, 'dialog close has an explicit workspace lifecycle owner');
assert.match(mainSource, /setExploreWorkspaceKey\(null\)/, 'ephemeral disposal clears the active routing key');

const revisionPlan = deriveLumiExplorationPlan({
  interpretations: [
    { id: 'interpretation-a', judgment: 'challenges' },
    { id: 'interpretation-b', judgment: 'needs-more-testing' },
  ],
  revisions: [{ id: 'revision-1', interpretationIds: ['interpretation-a'] }],
});
assert.equal(revisionPlan.suggestions.find((item) => item.kind === 'revise')?.target, 'interpretation-b', 'revision suggestion is scoped to an unconsumed interpretation');
const trail = deriveInquiryTrailEntries({ revisions: [{ id: 'revision-1', parentHypothesisId: 'h1', childHypothesisId: 'h2', interpretationIds: ['interpretation-a'] }] });
assert.ok(trail[0].sourceIds.includes('revision-1'), 'revision trail keeps the stable revision source ID');

console.log('Workspace isolation checks passed: independent Explore ownership, deterministic recipes, provenance-safe mismatch handling, explicit capability-gated bridge, bounded IDs, and relationship-aware revision guidance.');
