import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UI_LAYERS, UI_LAYER_DESCRIPTORS, CONCEPTUAL_DEPTHS, classifyPresentationCapabilities } from '../src/core/ui/uiArchitecture.js';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const details = read('src/components/playground/ExploreDetailsRegion.jsx');
const tune = read('src/components/playground/TunePanel.jsx');
const inspector = read('src/components/playground/PlaygroundInspector.jsx');
const context = read('src/components/playground/ExploreContextBar.jsx');
const agent = read('src/components/playground/ExploreAgentSurface.jsx');
const dialog = read('src/components/playground/UnifiedPlaygroundDialog.jsx');
const motion = read('src/components/playground/motion.js');
const navigation = read('src/core/ui/layerNavigation.js');

assert.deepEqual(Object.values(UI_LAYERS), ['play', 'tune', 'inspect']);
for (const layer of Object.values(UI_LAYERS)) assert.equal(UI_LAYER_DESCRIPTORS[layer].id, layer);
assert.equal(CONCEPTUAL_DEPTHS.TUNE, 'tune');
assert.ok(details.includes('CONCEPTUAL_DEPTHS.TUNE') && details.includes('TunePanel'));
for (const depth of ['EVIDENCE', 'MECHANISM', 'REPRESENTATION']) assert.ok(details.includes(`CONCEPTUAL_DEPTHS.${depth}`));
assert.ok(details.includes("data-ui-layer={activeDepth === CONCEPTUAL_DEPTHS.TUNE ? 'tune' : activeDepth ? 'inspect' : 'play'}"));
assert.ok(!details.includes('playground.controls.map'));
for (const group of ['world', 'moreModel', 'moreLearning', 'moreEvaluation']) assert.ok(tune.includes(`playground.layer.${group}`));
assert.ok(tune.includes('PlaygroundControlField') && tune.includes('data-ui-control-group'));
assert.ok(inspector.includes('PlaygroundControlField') && inspector.includes('playground.controls.map'));
assert.ok(tune.includes('onOpenWorldTools') && tune.includes('moreWorldTools'));
assert.ok(context.includes('flex-wrap') && context.includes('max-w-full'));
assert.ok(dialog.includes('setFullWorldToolsOpen') && dialog.includes('onFullWorldToolsChange'));
assert.ok(dialog.includes('openFullWorldWorkspaceFromTune') && dialog.includes('setActiveDepth(next.activeDepth)'));
assert.ok(navigation.includes("activeTab: 'data'") && navigation.includes('activeDepth: null'));
for (const key of ['pedagogical.observationTitle', 'pedagogical.evidenceTitle', 'pedagogical.interpretationTitle', 'pedagogical.nextQuestions']) assert.ok(agent.includes(key));
assert.ok(agent.includes('advanced') && agent.includes('ExplorationAgentPanel'));
assert.ok(motion.includes('prefers-reduced-motion') && motion.includes('MOTION_TOKENS'));
for (const width of [1366, 1024, 834]) assert.notEqual(classifyPresentationCapabilities({ containerWidth: width }).inspectorPresentation, 'bottom-sheet');
assert.equal(classifyPresentationCapabilities({ containerWidth: 390 }).inspectorPresentation, 'bottom-sheet');

const dir = mkdtempSync(path.join(tmpdir(), 'volk-ui-layer-'));
const outfile = path.join(dir, 'smoke.cjs');
const entry = fileURLToPath(new URL('./ui-layer-smoke.jsx', import.meta.url));
const entryPoint = path.relative(process.cwd(), entry).split(path.sep).join('/');
try {
  buildSync({ entryPoints: [`./${entryPoint}`], bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic', outfile, logLevel: 'silent' });
  const loaded = await import(pathToFileURL(outfile).href);
  const result = await loaded.runUiLayerSmoke();
  if (!result?.passed) throw new Error('Layer navigation smoke did not report success.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('Layered UI checks passed: Play/Tune/Inspect hierarchy, grouped controls, manual World path, stable inspector sizing, Agent result hierarchy, responsive behavior, and reduced-motion seam.');
