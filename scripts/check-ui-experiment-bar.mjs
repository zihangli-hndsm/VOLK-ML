import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = readFileSync(new URL('../src/components/playground/ExperimentBar.jsx', import.meta.url), 'utf8');
for (const required of ['DUPLICATE_EXPERIMENT', 'SWITCH_EXPERIMENT', 'SET_COMPARE', 'REPEAT_EXPERIMENT', 'UNDO_EXPERIMENT_ACTION', 'aria-pressed', 'aria-expanded', 'overflow-x-auto']) {
  if (!source.includes(required)) throw new Error(`Experiment Bar is missing ${required}`);
}
const compactStart = source.indexOf('if (showCompactInitial)');
const compactSource = source.slice(compactStart, source.indexOf('\n\n  return <section', compactStart));
if (!compactSource.includes('canUndoExperiment') || !compactSource.includes('UNDO_EXPERIMENT_ACTION')) throw new Error('Compact More actions do not retain canonical Undo');
if (source.includes('role="menu"') || source.includes("role='menu'")) throw new Error('Experiment Bar uses incomplete menu semantics');

const dir = mkdtempSync(path.join(tmpdir(), 'volk-ui4-experiment-bar-'));
const outfile = path.join(dir, 'smoke.cjs');
const entry = fileURLToPath(new URL('./ui-experiment-bar-smoke.jsx', import.meta.url));
const entryPoint = path.relative(process.cwd(), entry).split(path.sep).join('/');
try {
  buildSync({
    entryPoints: [`./${entryPoint}`],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    outfile,
    logLevel: 'silent',
  });
  const loaded = await import(pathToFileURL(outfile).href);
  await loaded.runUiExperimentBarSmoke();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('UI-4 Experiment Bar checks passed: progressive A/B grammar, runtime actions, shared bounds, secondary actions, responsive selectors, clarity, and multi-experiment navigation.');
