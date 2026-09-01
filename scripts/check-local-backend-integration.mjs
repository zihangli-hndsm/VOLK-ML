import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const backendScript = fileURLToPath(new URL('../dev/backend/server.py', import.meta.url));

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function launch(command, interpreterArgs, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...interpreterArgs, backendScript, '--host', '127.0.0.1', '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    child.stdout.resume();
    child.stderr.resume();
    child.once('error', (error) => {
      if (error.code === 'ENOENT') resolve({ missing: true });
      else reject(error);
    });
    child.once('spawn', () => resolve({ child }));
  });
}

async function requestHealth(url) {
  const response = await fetch(url, { headers: { Origin: 'http://localhost:5173' } });
  const payload = await response.json();
  return { response, payload };
}

async function waitForHealth(child, url) {
  let exit = null;
  child.once('exit', (code, signal) => { exit = { code, signal }; });
  let lastError = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (exit) throw new Error(`Backend exited before /health was reachable (code=${exit.code}, signal=${exit.signal})`);
    try {
      return await requestHealth(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Timed out waiting for the local backend: ${lastError?.message ?? 'unknown error'}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  child.kill();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const port = await reservePort();
const candidates = process.platform === 'win32'
  ? [['py', ['-3']], ['python', []]]
  : [['python3', []], ['python', []]];
let backend = null;
try {
  for (const [command, args] of candidates) {
    const result = await launch(command, args, port);
    if (result.missing) continue;
    backend = result.child;
    break;
  }
  assert.ok(backend, 'A Python interpreter is required for the local backend contract test');
  const { response, payload } = await waitForHealth(backend, `http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    status: 'ok',
    service: 'volk-dev-backend',
    apiVersion: '0',
  });
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  console.log(`Local backend integration passed on port ${port}: real Python /health contract and CORS verified.`);
} finally {
  await stop(backend);
}
