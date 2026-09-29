import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = process.cwd();
const python = process.env.VOLK_G2_PYTHON;
if (!python) throw new Error('Set VOLK_G2_PYTHON to the local Python environment containing ONNX Runtime before running this real-process port test.');
const serverScript = path.join(root, 'dev/g2_attention/server.py');
const connectionToken = randomBytes(32).toString('base64url');
const origin = 'http://127.0.0.1:5173';
const childEnvironment = {
  ...process.env,
  VOLK_G2_RUNNER_TOKEN: connectionToken,
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
};

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function startRunner(port) {
  const child = spawn(python, [serverScript, '--host', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    env: childEnvironment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdoutText = '';
  child.stderrText = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { child.stdoutText += chunk; });
  child.stderr.on('data', (chunk) => { child.stderrText += chunk; });
  return child;
}

function waitForExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timeout = setTimeout(() => reject(new Error(`Runner did not exit in ${timeoutMs}ms.`)), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function stopRunner(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await waitForExit(child);
}

async function waitForHealth(child, port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Runner exited before health: code=${child.exitCode}; stdout=${child.stdoutText}; stderr=${child.stderrText}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Origin: origin, 'X-VOLK-Local-Authorization': connectionToken },
        signal: AbortSignal.timeout(750),
      });
      if (response.ok) return await response.json();
      lastError = new Error(`Health returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Runner health timed out: ${lastError?.message ?? 'no response'}; stdout=${child.stdoutText}; stderr=${child.stderrText}`);
}

const port = await findFreePort();
let owner = null;
let duplicate = null;
let recovered = null;
let passed = false;
try {
  owner = startRunner(port);
  const initialHealth = await waitForHealth(owner, port);
  assert.equal(initialHealth.status, 'ok');

  duplicate = startRunner(port);
  const duplicateExit = await waitForExit(duplicate);
  assert.equal(duplicateExit.code, 2, `Occupied runner exit code; stdout=${duplicate.stdoutText}; stderr=${duplicate.stderrText}`);
  assert.ok(duplicate.stdoutText.includes(`VOLK_G2_PORT_IN_USE ${port}`), `Actionable port diagnostic; stdout=${duplicate.stdoutText}; stderr=${duplicate.stderrText}`);
  assert.equal((await waitForHealth(owner, port)).status, 'ok', 'A conflicting second process must not displace the owning listener.');

  await stopRunner(owner);
  recovered = startRunner(port);
  const recoveredHealth = await waitForHealth(recovered, port);
  assert.equal(recoveredHealth.status, 'ok', 'A new runner can bind and serve health after the owner stops.');
  passed = true;
} finally {
  await Promise.all([stopRunner(owner), stopRunner(duplicate), stopRunner(recovered)]);
}
assert.ok(passed);
console.log('PASS G2 real-process port binding: one active listener only, duplicate process emits VOLK_G2_PORT_IN_USE, owner remains healthy, released port recovers.');
