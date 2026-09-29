import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localPython = process.env.VOLK_G2_PYTHON
  ?? (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'VOLK', 'venvs', 'g2-imported-attention', 'Scripts', 'python.exe')
    : null);
const pythonCommand = localPython && existsSync(localPython) ? localPython : (process.platform === 'win32' ? 'py' : 'python3');
const pythonArgs = pythonCommand === 'py' ? ['-3.12', 'dev/g2_attention/server.py'] : ['dev/g2_attention/server.py'];
const connectionCode = randomBytes(32).toString('base64url');
if (!/^[A-Za-z0-9_-]{32,128}$/.test(connectionCode)) {
  throw new Error('VOLK_G2_RUNNER_TOKEN must contain 32 to 128 URL-safe characters.');
}
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});
const runner = spawn(pythonCommand, pythonArgs, {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, VOLK_G2_RUNNER_TOKEN: connectionCode },
});

console.log('VOLK G2 local development lifecycle: start with npm run dev:g2; stop both services with Ctrl+C.');
console.log('Local runner connection code (memory-only; enter it in the G2 surface): ' + connectionCode);

let shuttingDown = false;
function stop(signal = 'SIGINT') {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [vite, runner]) {
    if (!child.killed) child.kill(signal);
  }
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
runner.on('error', (error) => console.error(`Local G2 runner could not start: ${error.message}`));
vite.on('error', (error) => {
  console.error(`Vite could not start: ${error.message}`);
  stop();
});
vite.on('exit', (code) => {
  if (!shuttingDown) stop();
  process.exitCode = code ?? 0;
});
runner.on('exit', (code) => {
  if (!shuttingDown && code === 2) console.error('Local G2 runner could not bind its port; close the process using port 8765, then restart npm run dev:g2.');
  else if (!shuttingDown && code) console.error('Local G2 runner stopped; the browser surface remains available but model execution is offline.');
});
