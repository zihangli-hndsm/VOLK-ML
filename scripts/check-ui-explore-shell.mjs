import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = readFileSync(new URL('../src/components/playground/UnifiedPlaygroundDialog.jsx', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../src/components/playground/ExploreShell.jsx', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/components/playground/ExploreWorldRegion.jsx', import.meta.url), 'utf8');
const depthSource = readFileSync(new URL('../src/components/playground/ExploreDetailsRegion.jsx', import.meta.url), 'utf8');
const dir = mkdtempSync(path.join(tmpdir(), 'volk-ui1-shell-'));
const outfile = path.join(dir, 'smoke.cjs');
const entry = fileURLToPath(new URL('./ui-explore-shell-smoke.jsx', import.meta.url));
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
  const result = loaded.runUiExploreShellSmoke();
  if (!result?.passed) throw new Error('UI-1 shell smoke did not report success.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (!source.includes('<ExploreShell ')) {
  throw new Error('UnifiedPlaygroundDialog does not route through the Explore shell.');
}
if (source.includes('<PlaygroundInspector') || source.includes('<PlaygroundStage')) {
  throw new Error('World/detail ownership was not moved behind Explore regions.');
}
if (!shellSource.includes('contextBar') || !shellSource.includes('worldRegion') || !shellSource.includes('experimentRegion') || !shellSource.includes('detailsRegion')) {
  throw new Error('ExploreShell is missing a required UI-1 region boundary.');
}
if (!depthSource.includes('playground.depth.inspectModel') || !depthSource.includes('PlaygroundInspector')) {
  throw new Error('Inspect-model depth is not explicitly reachable from the Explore depth region.');
}
if (!depthSource.includes('activeDepth') || !depthSource.includes('PlaygroundInspector')) {
  throw new Error('Explore depth does not own the presentation-only inspector transition.');
}
const contextSource = readFileSync(new URL('../src/components/playground/ExploreContextBar.jsx', import.meta.url), 'utf8');
if (!contextSource.includes('aria-controls="explore-more-actions"') || !contextSource.includes('aria-expanded={moreOpen}')) {
  throw new Error('More does not expose the native disclosure contract.');
}
if (contextSource.includes('aria-haspopup="menu"') || contextSource.includes('role="menu"') || contextSource.includes('role="menuitem"')) {
  throw new Error('More retains incomplete ARIA menu semantics.');
}
if (!contextSource.includes('aria-label={t(\'common.close\')}') || !contextSource.includes('>×</button>')) {
  throw new Error('Close affordance visual and accessible semantics are inconsistent.');
}

console.log('UI-1 Explore shell checks passed');
