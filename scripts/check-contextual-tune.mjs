import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeControlPresentation } from '../src/core/ui/contextualTune.js';

const tuneSource = readFileSync(new URL('../src/components/playground/TunePanel.jsx', import.meta.url), 'utf8');
const descriptorSources = ['knn.js', 'linearRegression.js', 'mlp.js'].map((file) => readFileSync(new URL(`../src/core/playgrounds/${file}`, import.meta.url), 'utf8'));
for (const source of descriptorSources) assert.ok(source.includes('presentation:'), 'model-owned presentation metadata is declared');
assert.ok(!tuneSource.includes('knn-classification') && !tuneSource.includes('linear-regression') && !tuneSource.includes('mlp-classification'), 'Tune has no model-ID presentation branches');
assert.ok(tuneSource.includes('aria-expanded') && tuneSource.includes('aria-controls'), 'More controls uses an accessible disclosure contract');
assert.ok(tuneSource.includes('data-ui-control-group="primary"') && tuneSource.includes('PlaygroundControlField'), 'primary controls use the shared control renderer');
assert.ok(!tuneSource.includes('overflow-x'), 'Tune does not introduce nested horizontal scrolling');
assert.deepEqual(normalizeControlPresentation({ key: 'legacy' }), { importance: 'secondary', roles: [] }, 'legacy controls use bounded fallback metadata');
assert.deepEqual(normalizeControlPresentation({ presentation: { importance: 'invalid', roles: ['experiment', 'bad', 'inspection', 'extra'], explanationKey: 'hint' } }), { importance: 'secondary', roles: ['experiment', 'inspection'], explanationKey: 'hint' });

const dir = mkdtempSync(path.join(tmpdir(), 'volk-contextual-tune-'));
const outfile = path.join(dir, 'smoke.cjs');
const entry = fileURLToPath(new URL('./ui-contextual-tune-smoke.jsx', import.meta.url));
const entryPoint = path.relative(process.cwd(), entry).split(path.sep).join('/');
try {
  buildSync({ entryPoints: [`./${entryPoint}`], bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic', outfile, logLevel: 'silent' });
  const loaded = await import(pathToFileURL(outfile).href);
  const result = await loaded.runContextualTuneSmoke();
  if (!result?.passed) throw new Error('Contextual Tune smoke did not report success.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('Contextual Tune checks passed: descriptor-driven primary controls, separate domain/importance metadata, progressive reachability, deterministic comparison markers, legacy fallback, accessibility, and runtime-safe presentation.');
