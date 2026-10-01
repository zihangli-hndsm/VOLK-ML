import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeExecutable = process.execPath;
const viteEntry = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const environment = {
  ...process.env,
  VITE_VOLK_H2_LOCAL_PYTHON_URL: 'http://127.0.0.1:8766',
};
const coordinator = spawn(nodeExecutable, ['scripts/h2-local-python/server.mjs'], {
  cwd: root, env: environment, windowsHide: true, stdio: 'inherit',
});
const vite = spawn(nodeExecutable, [viteEntry, '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
  cwd: root, env: environment, windowsHide: true, stdio: 'inherit',
});
let stopping = false;

function stop(child) {
  if (child && child.exitCode === null) {
    try { child.kill('SIGTERM'); } catch { /* Process already exited. */ }
  }
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  stop(coordinator);
  stop(vite);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
for (const child of [coordinator, vite]) {
  child.once('error', () => shutdown());
  child.once('exit', (code) => {
    if (!stopping) {
      if (code !== 0) process.exitCode = code ?? 1;
      shutdown();
    }
  });
}
