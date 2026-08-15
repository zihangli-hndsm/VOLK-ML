import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const detailsSource = readFileSync(new URL('../src/components/playground/ExploreDetailsRegion.jsx', import.meta.url), 'utf8');
const dialogSource = readFileSync(new URL('../src/components/playground/UnifiedPlaygroundDialog.jsx', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/components/playground/ExploreWorldRegion.jsx', import.meta.url), 'utf8');
const depthSource = readFileSync(new URL('../src/core/ui/exploreDepth.js', import.meta.url), 'utf8');

for (const required of ['activeDepth', 'aria-expanded', 'aria-pressed', 'PlaygroundInspector', 'ExplorationEvidence', 'TrainingMicroscopePanel', 'onDepthChange']) {
  if (!detailsSource.includes(required)) throw new Error(`UI-5 depth contract is missing ${required}`);
}
if (!dialogSource.includes('depthTelemetryType') || !dialogSource.includes('setActiveDepth(null)')) {
  throw new Error('UI-5 presentation depth is not reset/tracked at the dialog boundary');
}
if (!detailsSource.includes('playground.depth.inspectModel') || !detailsSource.includes("CONCEPTUAL_DEPTHS.REPRESENTATION")) {
  throw new Error('Inspect-model depth is not reachable from the Explore depth region');
}
if (!depthSource.includes('deriveExploreDepthCapabilities') || !depthSource.includes('howItDecides')) {
  throw new Error('Depth availability is not capability-driven');
}

const dir = mkdtempSync(path.join(tmpdir(), 'volk-ui5-depth-'));
const outfile = path.join(dir, 'smoke.cjs');
const entry = fileURLToPath(new URL('./ui-depth-smoke.jsx', import.meta.url));
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
  const result = await loaded.runUiDepthSmoke();
  if (!result?.passed) throw new Error('UI-5 depth smoke did not report success.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('UI-5 depth checks passed: progressive entrances, exclusive evidence/mechanism/inspector surfaces, runtime identity preservation, telemetry seam, and capability fallbacks.');
