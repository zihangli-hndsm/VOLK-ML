import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const componentSource = readFileSync(new URL('../src/components/playground/ExploreAgentSurface.jsx', import.meta.url), 'utf8');
const detailsSource = readFileSync(new URL('../src/components/playground/ExploreDetailsRegion.jsx', import.meta.url), 'utf8');
const dialogSource = readFileSync(new URL('../src/components/playground/UnifiedPlaygroundDialog.jsx', import.meta.url), 'utf8');

for (const required of ["mode === 'ask'", "mode === 'experiment'", "mode === 'world'", 'WORLD_RECIPE_PRESET_IDS', 'submitRequest']) {
  if (!componentSource.includes(required)) throw new Error(`Unified Agent input contract is missing ${required}`);
}
if (componentSource.includes('ExplorationAgentPanel')) throw new Error('Agent guide must not embed a second request panel');

for (const forbidden of ['document.querySelector', 'document.getElementById', '.click(']) {
  if (componentSource.includes(forbidden)) throw new Error(`Agent guide must not navigate through DOM APIs: ${forbidden}`);
}
for (const required of ['agentOpen', 'onAgentOpen', 'aria-expanded', 'ExploreAgentSurface', 'onDepthChange']) {
  if (!detailsSource.includes(required)) throw new Error(`Agent guide presentation contract is missing ${required}`);
}
if (!dialogSource.includes('setAgentOpen(false)') || !dialogSource.includes('depthTelemetryType')) {
  throw new Error('Agent/depth overlay boundary is not owned by UnifiedPlaygroundDialog');
}

const dir = mkdtempSync(path.join(tmpdir(), 'volk-ui6-agent-guide-'));
const outfile = path.join(dir, 'smoke.cjs');
const entry = fileURLToPath(new URL('./ui-agent-guide-smoke.jsx', import.meta.url));
const entryPoint = path.relative(process.cwd(), entry).split(path.sep).join('/');
try {
  buildSync({ entryPoints: [`./${entryPoint}`], bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic', outfile, logLevel: 'silent' });
  const loaded = await import(pathToFileURL(outfile).href);
  const result = await loaded.runUiAgentGuideSmoke();
  if (!result?.passed) throw new Error('UI-6 Agent guide smoke did not report success.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('UI-6 Agent guide checks passed: quiet availability, structured depth/proposal outcomes, explicit execution, disabled fallback, one-overlay navigation, and DOM-independent presentation.');
