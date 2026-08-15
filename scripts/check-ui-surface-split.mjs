import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_TOP_LEVEL_SURFACE, createTopLevelSurfaceState, switchTopLevelSurface } from '../src/core/ui/topLevelSurface.js';
import { UI_SURFACES } from '../src/core/ui/uiArchitecture.js';
import { createBuildPanelPresentation, toggleBuildPanel } from '../src/core/ui/buildSurfacePresentation.js';
import { listBigIdeaEntrances } from '../src/core/exploration/bigIdeaRegistry.js';
import { languages, resolveMessage } from '../src/i18n.js';

const mainSource = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const homeSource = readFileSync(new URL('../src/components/ExploreHome.jsx', import.meta.url), 'utf8');
const ideaSource = readFileSync(new URL('../src/components/BigIdeaEntrancePanel.jsx', import.meta.url), 'utf8');
const buildSource = readFileSync(new URL('../src/components/BuildToolbar.jsx', import.meta.url), 'utf8');

assert.equal(DEFAULT_TOP_LEVEL_SURFACE, UI_SURFACES.EXPLORE, 'new sessions must enter Explore');
assert.equal(createTopLevelSurfaceState().surface, UI_SURFACES.EXPLORE);
const runtime = { workspace: 'shared' };
const switched = switchTopLevelSurface(createTopLevelSurfaceState({ surface: UI_SURFACES.EXPLORE, runtime }), UI_SURFACES.BUILD);
assert.equal(switched.surface, UI_SURFACES.BUILD);
assert.equal(switched.runtime, runtime, 'surface switching must preserve the shared runtime reference');
assert.throws(() => switchTopLevelSurface(switched, 'lesson'), /Unknown top-level surface/);

const compactBuild = createBuildPanelPresentation({ viewportWidth: 390 });
assert.equal(compactBuild.compact, true);
assert.equal(compactBuild.leftOpen, false, 'compact Build starts with Blocks closed');
assert.equal(compactBuild.rightOpen, false, 'compact Build starts with Parameters closed');
const compactWithBlocks = toggleBuildPanel(compactBuild, 'left');
assert.equal(compactWithBlocks.leftOpen, true);
assert.equal(compactWithBlocks.rightOpen, false);
const compactWithParameters = toggleBuildPanel(compactWithBlocks, 'right');
assert.equal(compactWithParameters.leftOpen, false, 'opening Parameters closes Blocks on Compact');
assert.equal(compactWithParameters.rightOpen, true);
const wideBuild = createBuildPanelPresentation({ viewportWidth: 1440 });
assert.equal(wideBuild.leftOpen, true, 'Wide Build preserves the normal open panel behavior');
assert.equal(wideBuild.rightOpen, true);
assert.equal(wideBuild.rightWidth, 300, 'fresh Build uses the normalized right-panel width');

assert.match(mainSource, /useState\(UI_SURFACES\.EXPLORE\)/, 'Workspace must default to Explore');
assert.match(mainSource, /data-top-level-surface=\{surface\}/);
assert.match(mainSource, /surface === UI_SURFACES\.EXPLORE \? <ExploreHome/);
assert.match(mainSource, /<BuildToolbar /);
assert.match(mainSource, /data-build-surface/);
assert.match(mainSource, /<ReactFlow /);
assert.match(mainSource, /createBuildPanelPresentation\(\{ viewportWidth: window\.innerWidth \}\)/);
assert.match(mainSource, /toggleBuildPanel\(buildPresentation, 'left'\)/);
assert.match(mainSource, /toggleBuildPanel\(buildPresentation, 'right'\)/);
assert.match(mainSource, /setViewportWidth\(window\.innerWidth\)/);
assert.doesNotMatch(homeSource, /ReactFlow|ComponentLibrary|data-build-surface/);
assert.match(homeSource, /<BigIdeaEntrancePanel variant="home"/);
assert.match(homeSource, /surface\.openAnotherLab/);
assert.match(buildSource, /data-build-toolbar/);
assert.match(buildSource, /data-build-more-actions/);
assert.match(buildSource, /aria-expanded=\{open\}/);
assert.doesNotMatch(buildSource, /role="menu"|role="menuitem"/);
assert.match(ideaSource, /className=\{isHome \? 'rounded-2xl'/, 'home variant must not be the old top-level strip');

const entries = listBigIdeaEntrances();
assert.equal(entries.length, 5);
for (const entry of entries) {
  for (const language of languages) {
    for (const key of [entry.titleKey, entry.summaryKey]) {
      assert.notEqual(resolveMessage(key, language.code), key, `${key} must resolve in ${language.code}`);
    }
  }
}

assert.doesNotMatch(mainSource, /projectFromWorkspace\([\s\S]{0,400}surface/);
console.log('UI-2.5 top-level surface checks passed');
