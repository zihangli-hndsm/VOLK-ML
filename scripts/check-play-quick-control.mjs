import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { getPlayground } from '../src/core/playgrounds/registry.js';
import { derivePlayQuickControl } from '../src/core/ui/playQuickControl.js';
import { validatePlaygroundControlPresentation } from '../src/core/ui/contextualTune.js';

const quickSource = readFileSync(new URL('../src/core/ui/playQuickControl.js', import.meta.url), 'utf8');
const fieldSource = readFileSync(new URL('../src/components/playground/PlaygroundControlField.jsx', import.meta.url), 'utf8');
const quickComponentSource = readFileSync(new URL('../src/components/playground/PlayQuickControl.jsx', import.meta.url), 'utf8');
assert.ok(!/knn-classification|linear-regression|mlp-classification/.test(quickSource), 'quick selection has no model-ID branches');
assert.ok(quickComponentSource.includes('PlaygroundControlField'), 'Play reuses the shared control renderer');
assert.ok(fieldSource.includes("type: 'SET_CONTROL'"), 'quick control uses the canonical SET_CONTROL dispatch path');
assert.ok(fieldSource.includes('compact') && !fieldSource.includes('transition-all'), 'compact quick control has bounded presentation semantics');
assert.throws(() => validatePlaygroundControlPresentation({ controls: [{ key: 'bad', presentation: { importance: 'primary', roles: ['inspection'], quickControl: true } }] }), /experiment role/);
assert.throws(() => validatePlaygroundControlPresentation({ controls: [{ key: 'bad', presentation: { importance: 'primary', roles: ['experiment'], quickControl: 'yes' } }] }), /quickControl/);
assert.throws(() => validatePlaygroundControlPresentation({ controls: [{ key: 'bad', presentation: { importance: 'primary', roles: ['experiment'], quickControlDefault: true } }] }), /must be eligible/);

const dir = mkdtempSync(path.join(tmpdir(), 'volk-play-quick-control-'));
const outfile = path.join(dir, 'smoke.cjs');
const entry = fileURLToPath(new URL('./ui-play-quick-control-smoke.jsx', import.meta.url));
const entryPoint = path.relative(process.cwd(), entry).split(path.sep).join('/');
try {
  buildSync({ entryPoints: [`./${entryPoint}`], bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic', outfile, logLevel: 'silent' });
  const loaded = await import(pathToFileURL(outfile).href);
  const result = await loaded.runPlayQuickControlSmoke();
  if (!result?.passed) throw new Error('Play quick control smoke did not report success.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('Play quick control checks passed: bounded eligibility, deterministic context selection, ambiguity suppression, shared SET_CONTROL semantics, comparison truthfulness, World-only isolation, responsive-safe rendering, and AI-free behavior.');
