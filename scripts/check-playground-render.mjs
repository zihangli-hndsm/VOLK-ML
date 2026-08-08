import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Bundles the JSX render smoke and executes it with React server rendering.
// Kept separate from check-core.mjs because the renderers are JSX and need a
// transform; no browser test framework is introduced.
const dir = mkdtempSync(path.join(tmpdir(), 'volk-playground-render-'));
const outfile = path.join(dir, 'smoke.cjs');
const entry = fileURLToPath(new URL('./playground-render-smoke.jsx', import.meta.url));
try {
  buildSync({
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    outfile,
    logLevel: 'silent',
  });
  const loaded = await import(pathToFileURL(outfile).href);
  const runPlaygroundRenderSmoke = loaded.runPlaygroundRenderSmoke ?? loaded.default?.runPlaygroundRenderSmoke;
  if (typeof runPlaygroundRenderSmoke !== 'function') throw new Error('render smoke entry did not export runPlaygroundRenderSmoke');
  const result = runPlaygroundRenderSmoke();
  console.log(`Playground render smoke passed: ${JSON.stringify(result)}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
