import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createH2LocalPythonServer } from './h2-local-python/server.mjs';
import { projectH2LocalPythonRequestV1 } from '../src/core/execution/h2LocalPython.js';
import { h2RegressionFixture } from './h2-local-python/test-fixtures.mjs';

if (process.platform !== 'win32') {
  process.stdout.write('H2 Windows Job Object lifecycle acceptance requires Windows; skipped on this platform.\n');
  process.exit(0);
}

const origin = 'http://localhost:5173';
const appLocalRoot = path.join(process.env.LOCALAPPDATA, 'VOLK', 'h2-local-python-v1');
const runsRoot = path.join(appLocalRoot, 'runs');
const pythonPath = path.join(appLocalRoot, 'python-3.12.10', 'python.exe');
const workerPath = path.resolve('scripts/h2-local-python/worker.py');
const supervisorPath = path.resolve('scripts/h2-local-python/supervisor.ps1');
const powershellPath = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
function longRegressionFixture() {
  const fixture = h2RegressionFixture();
  fixture.nodes.find((node) => node.id === 'trainer').data.parameters = { ...fixture.nodes.find((node) => node.id === 'trainer').data.parameters, epochs: 100, batch_size: 1 };
  fixture.dataset.rows = Array.from({ length: 1024 }, (_, index) => ({
    x0: Math.sin(index * 0.023), x1: Math.cos(index * 0.017), target: Math.sin(index * 0.011) + index * 0.0002,
  }));
  return fixture;
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function waitForHealth(base) {
  return waitFor(async () => {
    try {
      const response = await fetch(`${base}/health`);
      return response.ok ? response : null;
    } catch { return null; }
  }, `coordinator ${base}`);
}

function runProcesses(processName, pattern) {
  const quotedPattern = `'${pattern.replaceAll("'", "''")}'`;
  const quotedProcessName = `'${processName.replaceAll("'", "''")}'`;
  const command = `$needle = ${quotedPattern}; $processName = ${quotedProcessName}; $items = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq $processName -and $_.CommandLine -and $_.CommandLine.Contains($needle) } | Select-Object -ExpandProperty ProcessId; if ($null -eq $items) { '[]' } else { ConvertTo-Json -InputObject @($items) -Compress }`;
  const output = execFileSync(powershellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true }).trim();
  if (!output) return [];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).map(Number).filter(Number.isInteger);
}

const workerProcesses = () => runProcesses('python.exe', 'scripts\\h2-local-python\\worker.py');
const supervisorProcesses = () => runProcesses('powershell.exe', 'scripts\\h2-local-python\\supervisor.ps1');

function ownedRunDirectories() {
  if (!fs.existsSync(runsRoot)) return [];
  return fs.readdirSync(runsRoot, { withFileTypes: true })
    .filter((item) => item.isDirectory() && /^h2-[A-Za-z0-9-]{5,80}$/.test(item.name))
    .map((item) => path.join(runsRoot, item.name))
    .filter((directory) => fs.existsSync(path.join(directory, '.volk-h2-owned'))
      && fs.readFileSync(path.join(directory, '.volk-h2-owned'), 'ascii') === 'volk-h2-owned-v1\n');
}

async function authorize(base, draft) {
  const response = await fetch(`${base}/authorize`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
  });
  assert.equal(response.status, 200, `the lifecycle run is authorized: ${await response.clone().text()}`);
  const envelope = await response.json();
  return { ...draft, authorization: envelope.authorization };
}

async function fit(base, request, signal) {
  return fetch(`${base}/fit`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(request), signal,
  });
}

async function startCoordinator(port, extraEnvironment = {}) {
  const child = spawn(process.execPath, ['scripts/h2-local-python/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnvironment, VOLK_H2_PORT: String(port) },
    windowsHide: true, stdio: 'ignore',
  });
  child.once('error', () => {});
  const base = `http://127.0.0.1:${port}/v1/h2`;
  await waitForHealth(base);
  return { child, base };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try { child.kill('SIGTERM'); } catch { /* Already stopped. */ }
  await Promise.race([exited, delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL'); } catch { /* Bounded cleanup. */ }
    await Promise.race([exited, delay(1000)]);
  }
}

async function verifyMissingRuntimeFailsClosed() {
  const localData = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-h2-runtime-missing-'));
  const port = await unusedPort();
  let child;
  try {
    ({ child } = await startCoordinator(port, { LOCALAPPDATA: localData }));
    const base = `http://127.0.0.1:${port}/v1/h2`;
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.available, false);
    assert.equal(health.reason, 'H2_RUNTIME_UNAVAILABLE');
    const draft = await projectH2LocalPythonRequestV1(longRegressionFixture());
    const authorizeResponse = await fetch(`${base}/authorize`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
    });
    assert.equal(authorizeResponse.status, 503);
    assert.equal((await authorizeResponse.json()).error.code, 'H2_RUNTIME_UNAVAILABLE');
    assert.equal(fs.readdirSync(path.join(localData, 'VOLK', 'h2-local-python-v1', 'runs')).length, 0,
      'missing local Python is rejected before creating a run folder or starting a process');
  } finally {
    await stopChild(child);
    fs.rmSync(localData, { recursive: true, force: true });
  }
}

async function verifySetupFailureIsFailClosed() {
  const before = workerProcesses();
  const result = spawnSync(powershellPath, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', supervisorPath,
    '-PythonPath', pythonPath, '-WorkerPath', workerPath, '-SourcePath', workerPath,
    '-CoordinatorPid', '2147483647',
  ], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.equal(result.status, 77, `missing coordinator process is a supervisor setup failure (${result.stderr})`);
  assert.match(result.stderr, /H2_JOB_SETUP_FAILED/);
  await delay(200);
  assert.deepEqual(workerProcesses(), before, 'a setup failure before job assignment launches no Python worker');
}

async function verifyClientCancellationAndCleanup() {
  const server = await createH2LocalPythonServer({ port: 0 });
  const base = `http://127.0.0.1:${server.address().port}/v1/h2`;
  const fixture = longRegressionFixture();
  const draft = await projectH2LocalPythonRequestV1(fixture);
  const request = await authorize(base, draft);
  const oldWorkers = new Set(workerProcesses());
  const oldRunDirectories = new Set(ownedRunDirectories());
  const controller = new AbortController();
  const workerStart = waitFor(async () => workerProcesses().find((pid) => !oldWorkers.has(pid)), 'supervised worker start', 20_000);
  const runDirectoryStart = waitFor(() => ownedRunDirectories().find((folder) => !oldRunDirectories.has(folder)), 'cancelled run lease', 20_000);
  const pending = fit(base, request, controller.signal)
    .then((response) => ({ response }), (error) => ({ error }));
  let workerPid = null;
  try {
    [workerPid] = await Promise.all([workerStart]);
    const runDirectory = await runDirectoryStart;
    await delay(250);
    controller.abort('test-client-cancel');
    const cancelled = await pending;
    assert.ok(cancelled.error, 'the caller observes its cancelled HTTP request');
    await waitFor(async () => !workerProcesses().includes(workerPid), 'cancelled worker process termination', 10_000);
    await waitFor(() => !ownedRunDirectories().includes(runDirectory), 'cancelled run temp cleanup', 10_000);

    const shortFixture = h2RegressionFixture();
    const shortDraft = await projectH2LocalPythonRequestV1(shortFixture);
    const shortRequest = await authorize(base, shortDraft);
    const response = await fit(base, shortRequest, AbortSignal.timeout(30_000));
    assert.equal(response.status, 200, `the execution slot is released after cancellation: ${await response.clone().text()}`);
    const result = await response.json();
    assert.equal(result.lifecycle.processTerminated, true);
    assert.equal(result.lifecycle.resultDiscarded, false);
  } finally {
    if (!controller.signal.aborted) controller.abort('test-cleanup');
    server.close();
    await once(server, 'close');
  }
}

async function verifyCoordinatorExitKillsWorkerAndReapsOwnedTemp() {
  const port = await unusedPort();
  const { child, base } = await startCoordinator(port);
  const fixture = longRegressionFixture();
  const draft = await projectH2LocalPythonRequestV1(fixture);
  const request = await authorize(base, draft);
  const existingWorkers = new Set(workerProcesses());
  const existingSupervisors = new Set(supervisorProcesses());
  const existingRuns = new Set(ownedRunDirectories());
  const runDirectoryStart = waitFor(() => ownedRunDirectories().find((folder) => !existingRuns.has(folder)), 'owned run folder and lease', 20_000);
  const pending = fit(base, request, AbortSignal.timeout(30_000)).catch((error) => error);
  let workerPid = null;
  let supervisorPid = null;
  let runDirectory = null;
  try {
    workerPid = await waitFor(async () => workerProcesses().find((pid) => !existingWorkers.has(pid)), 'worker before coordinator exit', 20_000);
    supervisorPid = await waitFor(async () => supervisorProcesses().find((pid) => !existingSupervisors.has(pid)), 'supervisor before coordinator exit', 20_000);
    runDirectory = await runDirectoryStart;
    const lease = JSON.parse(fs.readFileSync(path.join(runDirectory, '.lease.json'), 'utf8'));
    assert.equal(lease.coordinatorPid, child.pid);
    assert.equal(lease.supervisorPid, supervisorPid);
    assert.equal(lease.workerPid, workerPid);

    await stopChild(child);
    const disconnectedResult = await pending;
    assert.ok(disconnectedResult instanceof Error || disconnectedResult.status >= 400,
      'coordinator exit cannot return an accepted success to the disconnected client');
    await waitFor(async () => !workerProcesses().includes(workerPid), 'worker-tree termination after coordinator exit', 10_000);
    await waitFor(async () => !supervisorProcesses().includes(supervisorPid), 'supervisor exit after coordinator exit', 10_000);

    const restarted = await startCoordinator(port);
    try {
      assert.equal(ownedRunDirectories().includes(runDirectory), false,
        'startup reaps the marker-owned run only after coordinator and supervisor are gone');
    } finally {
      await stopChild(restarted.child);
    }
  } finally {
    await stopChild(child);
  }
}

async function verifyRealDeadlineIfRequested() {
  if (process.env.VOLK_H2_RUN_DEADLINE_TEST !== '1') {
    process.stdout.write('SKIP 120-second live CPU deadline stress test; set VOLK_H2_RUN_DEADLINE_TEST=1 to run it.\n');
    return;
  }
  const server = await createH2LocalPythonServer({ port: 0 });
  const base = `http://127.0.0.1:${server.address().port}/v1/h2`;
  const features = Array.from({ length: 64 }, (_, index) => `f${index}`);
  const fixture = h2RegressionFixture();
  fixture.nodes.find((node) => node.id === 'input').data.parameters = { shape: '64', dtype: 'float32' };
  fixture.nodes.find((node) => node.id === 'hidden').data.parameters = { input_features: 64, units: 124, use_bias: true };
  fixture.nodes.find((node) => node.id === 'output-layer').data.parameters = { input_features: 124, units: 1, use_bias: true };
  fixture.nodes.find((node) => node.id === 'trainer').data.parameters = { epochs: 100, batch_size: 1, shuffle: true };
  fixture.dataset = {
    task: 'regression', featureColumns: features, targetColumn: 'target',
    rows: Array.from({ length: 4096 }, (_, row) => ({
      ...Object.fromEntries(features.map((column, feature) => [column, Math.sin(row * 0.017 + feature * 0.13)])),
      target: Math.cos(row * 0.011) + row * 0.0001,
    })),
  };
  const draft = await projectH2LocalPythonRequestV1(fixture);
  const request = await authorize(base, draft);
  const startedAt = Date.now();
  const beforeWorkers = new Set(workerProcesses());
  const beforeRuns = new Set(ownedRunDirectories());
  try {
    const runDirectoryPromise = waitFor(() => ownedRunDirectories().find((folder) => !beforeRuns.has(folder)), 'deadline run temp folder', 30_000);
    const responsePromise = fit(base, request, AbortSignal.timeout(135_000));
    const runDirectory = await runDirectoryPromise;
    const response = await responsePromise;
    const result = await response.json();
    assert.equal(response.status, 408, `the 120-second coordinator deadline rejects the bounded worst-case fit: ${JSON.stringify(result)}`);
    assert.equal(result.error.code, 'H2_DEADLINE_EXCEEDED');
    assert.deepEqual(result.lifecycle, { cancellationRequested: true, processTerminated: true, resultDiscarded: true });
    assert.ok(Date.now() - startedAt >= 115_000, 'deadline evidence comes from the live 120-second runtime path.');
    await waitFor(async () => workerProcesses().every((pid) => beforeWorkers.has(pid)), 'deadline worker termination', 10_000);
    await waitFor(() => !ownedRunDirectories().includes(runDirectory), 'deadline temp cleanup', 10_000);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

try {
  assert.ok(fs.existsSync(pythonPath)
    && fs.existsSync(path.join(appLocalRoot, 'python-3.12.10', 'Lib', 'site-packages', 'torch'))
    && fs.existsSync(path.join(appLocalRoot, 'python-3.12.10', 'Lib', 'site-packages', 'numpy')),
  'the pinned local runtime is installed for Windows lifecycle acceptance.');
  await verifyMissingRuntimeFailsClosed();
  await verifySetupFailureIsFailClosed();
  await verifyClientCancellationAndCleanup();
  await verifyCoordinatorExitKillsWorkerAndReapsOwnedTemp();
  await verifyRealDeadlineIfRequested();
  process.stdout.write('H2 lifecycle acceptance passed: fail-closed setup/runtime, cancellation, process-tree termination, temp lease cleanup, and coordinator-exit recovery.\n');
} finally {
  // Temporary LOCALAPPDATA roots are scoped and removed inside their own test.
}
