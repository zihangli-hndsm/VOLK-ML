import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const checkCommands = packageJson.scripts.check.split('&&').map((command) => command.trim());
const intentCheckIndex = checkCommands.indexOf('node scripts/check-build-intent.mjs');
const graphEditCheckIndex = checkCommands.indexOf('node scripts/check-graph-edit-intent.mjs');

assert.ok(intentCheckIndex >= 0, 'The normal npm run check chain invokes the Build Intent regression directly.');
assert.ok(graphEditCheckIndex > intentCheckIndex, 'The normal npm run check chain invokes Graph Edit Intent after Build Intent.');
assert.ok(checkCommands.includes('node scripts/check-build-agent.mjs'), 'The existing Build Agent gate remains in the normal check chain.');

const probeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-r0-check-chain-'));
try {
  fs.writeFileSync(path.join(probeDirectory, 'package.json'), JSON.stringify({
    name: 'volk-r0-failure-propagation-probe',
    private: true,
    scripts: { check: 'node -e "process.exit(47)" && node -e "process.exit(0)"' },
  }), 'utf8');
  const probe = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'check'], {
    cwd: probeDirectory,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(probe.status, 47, `npm run check propagates the first failing gate status.\n${probe.stdout}\n${probe.stderr}`);
  console.log('PASS R0 check routing: both requested gates are explicit in npm run check; existing Build Agent gate is retained; npm && failure propagation returns the failing status.');
} finally {
  fs.rmSync(probeDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}
