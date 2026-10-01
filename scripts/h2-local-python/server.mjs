import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  H2_LOCAL_PYTHON_LIMITS,
  H2_LOCAL_PYTHON_PROFILE_V1,
  H2_LOCAL_PYTHON_RESPONSE_V1,
  attachH2LocalPythonAuthorizationV1,
  validateH2LocalPythonRequestV1,
  validateH2LocalPythonResultV1,
} from '../../src/core/execution/h2LocalPython.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(MODULE_DIR, '../..');
const WORKER_PATH = path.join(MODULE_DIR, 'worker.py');
const SUPERVISOR_PATH = path.join(MODULE_DIR, 'supervisor.ps1');
const PYTHON_VERSION_FOLDER = 'python-3.12.10';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8766;
const BODY_LIMIT = H2_LOCAL_PYTHON_LIMITS.requestBytes;
const OUTPUT_LIMIT = H2_LOCAL_PYTHON_LIMITS.responseBytes;
const AUTHORIZATION_TTL_MS = 60_000;
const ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
const AUTHORIZATIONS = new Map();

function localRoot() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  return path.join(localAppData, 'VOLK', 'h2-local-python-v1');
}

function environmentPaths(root = localRoot()) {
  if (!root) return null;
  return {
    root,
    python: path.join(root, PYTHON_VERSION_FOLDER, 'python.exe'),
    runs: path.join(root, 'runs'),
  };
}

function runtimeAvailable() {
  const paths = environmentPaths();
  return Boolean(paths && fs.existsSync(paths.python)
    && fs.existsSync(path.join(paths.root, PYTHON_VERSION_FOLDER, 'python312.dll'))
    && fs.existsSync(path.join(paths.root, PYTHON_VERSION_FOLDER, 'Lib', 'site-packages', 'torch'))
    && fs.existsSync(path.join(paths.root, PYTHON_VERSION_FOLDER, 'Lib', 'site-packages', 'numpy'))
    && fs.existsSync(WORKER_PATH) && fs.existsSync(SUPERVISOR_PATH));
}

function safeCode(error, fallback = 'H2_REQUEST_INVALID') {
  return typeof error?.code === 'string' && /^H2_[A-Z0-9_]{1,48}$/.test(error.code) ? error.code : fallback;
}

function fail(code) {
  throw Object.assign(new TypeError(code), { code });
}

function failure(code, { cancellationRequested = false, processTerminated = false, resultDiscarded = true } = {}) {
  return {
    schemaVersion: H2_LOCAL_PYTHON_RESPONSE_V1,
    status: 'failed',
    error: { code, message: code },
    lifecycle: { cancellationRequested, processTerminated, resultDiscarded },
  };
}

function jsonResponse(response, status, value, origin = null) {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': encoded.byteLength,
    'cache-control': 'no-store',
    ...(origin ? {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '300',
      vary: 'Origin',
    } : {}),
  });
  response.end(encoded);
}

function acceptedOrigin(request) {
  const origin = request.headers.origin;
  if (origin === undefined) return null;
  return ALLOWED_ORIGINS.has(origin) ? origin : false;
}

function hostIsLocal(request) {
  return request.headers.host === `${DEFAULT_HOST}:${request.socket.localPort}`;
}

async function readBody(request) {
  const contentLength = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > BODY_LIMIT) throw Object.assign(new Error('H2_REQUEST_TOO_LARGE'), { code: 'H2_REQUEST_TOO_LARGE' });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > BODY_LIMIT) throw Object.assign(new Error('H2_REQUEST_TOO_LARGE'), { code: 'H2_REQUEST_TOO_LARGE' });
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); } catch {
    throw Object.assign(new Error('H2_REQUEST_JSON_INVALID'), { code: 'H2_REQUEST_JSON_INVALID' });
  }
  return body;
}

function cleanupOldAuthorizations(now = Date.now()) {
  for (const [id, authorization] of AUTHORIZATIONS) {
    if (authorization.expiresAtMs <= now) AUTHORIZATIONS.delete(id);
  }
  while (AUTHORIZATIONS.size > 32) AUTHORIZATIONS.delete(AUTHORIZATIONS.keys().next().value);
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

function writeRunLease(runDirectory, lease) {
  fs.writeFileSync(path.join(runDirectory, '.lease.json'), JSON.stringify(lease), { encoding: 'utf8' });
}

function reapOwnedStaleRuns(paths) {
  fs.mkdirSync(paths.runs, { recursive: true });
  for (const entry of fs.readdirSync(paths.runs, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^h2-[A-Za-z0-9-]{5,80}$/.test(entry.name)) continue;
    const runPath = path.resolve(paths.runs, entry.name);
    if (path.dirname(runPath) !== path.resolve(paths.runs)) continue;
    const marker = path.join(runPath, '.volk-h2-owned');
    const leasePath = path.join(runPath, '.lease.json');
    if (!fs.existsSync(marker) || fs.readFileSync(marker, 'ascii') !== 'volk-h2-owned-v1\n' || !fs.existsSync(leasePath)) continue;
    let lease;
    try { lease = JSON.parse(fs.readFileSync(leasePath, 'utf8')); } catch { continue; }
    if (!Number.isInteger(lease.coordinatorPid) || !Number.isInteger(lease.supervisorPid)
      || processIsAlive(lease.coordinatorPid) || processIsAlive(lease.supervisorPid)
      || (Number.isInteger(lease.workerPid) && processIsAlive(lease.workerPid))) continue;
    fs.rmSync(runPath, { recursive: true, force: true });
  }
}

function quoteCode() {
  return crypto.randomBytes(24).toString('base64url');
}

function waitForProcessGone(pid, timeoutMs = 4000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (!processIsAlive(pid)) return resolve(true);
      if (Date.now() - started >= timeoutMs) return resolve(false);
      setTimeout(check, 50);
    };
    check();
  });
}

function parseSupervisorOutput(stdout, stderr, validated, runtime, { cancelled, timedOut, childPid, setupFailed }) {
  if (cancelled || timedOut) return { status: 408, value: failure(timedOut ? 'H2_DEADLINE_EXCEEDED' : 'H2_CANCELLED', {
    cancellationRequested: true,
    processTerminated: childPid === null,
    resultDiscarded: true,
  }) };
  let body;
  try { body = JSON.parse(stdout.toString('utf8')); } catch {
    return { status: 502, value: failure(setupFailed ? 'H2_JOB_OBJECT_UNAVAILABLE' : 'H2_WORKER_RESPONSE_INVALID', {
      cancellationRequested: cancelled || timedOut,
      processTerminated: childPid === null,
      resultDiscarded: true,
    }) };
  }
  if (body?.schemaVersion === H2_LOCAL_PYTHON_RESPONSE_V1 && body.status === 'failed') {
    const validFailure = Object.keys(body).sort().join(',') === 'error,lifecycle,schemaVersion,status'
      && Object.keys(body.error ?? {}).sort().join(',') === 'code,message'
      && /^H2_[A-Z0-9_]{1,48}$/.test(body.error.code ?? '')
      && typeof body.error.message === 'string' && body.error.message.length <= 512;
    if (!validFailure) return { status: 502, value: failure('H2_WORKER_RESPONSE_INVALID', { processTerminated: childPid === null }) };
    return { status: 422, value: {
      ...body,
      error: { code: body.error.code, message: body.error.code },
      lifecycle: {
        cancellationRequested: cancelled || timedOut,
        processTerminated: childPid === null,
        resultDiscarded: true,
      },
    } };
  }
  try {
    body.lifecycle = { cancellationRequested: false, processTerminated: childPid === null, resultDiscarded: false };
    validateH2LocalPythonResultV1(body, validated);
    return { status: 200, value: body };
  } catch (error) {
    return { status: 502, value: failure(safeCode(error, 'H2_WORKER_RESULT_INVALID'), { processTerminated: childPid === null }) };
  }
}

async function runTraining(request, validated, { python, runs, signal }) {
  if (process.platform !== 'win32') return { status: 503, value: failure('H2_WINDOWS_RUNTIME_REQUIRED') };
  if (!runtimeAvailable()) return { status: 503, value: failure('H2_RUNTIME_UNAVAILABLE') };
  if (activeRun) return { status: 409, value: failure('H2_BUSY') };
  const runId = `h2-${crypto.randomUUID()}`;
  const runDirectory = fs.mkdtempSync(path.join(runs, 'h2-'));
  const sourcePath = path.join(runDirectory, 'compiled.py');
  const startedAt = new Date().toISOString();
  fs.writeFileSync(path.join(runDirectory, '.volk-h2-owned'), 'volk-h2-owned-v1\n', { encoding: 'ascii', flag: 'wx' });
  const lease = { coordinatorPid: process.pid, supervisorPid: null, workerPid: null, startedAt };
  fs.writeFileSync(path.join(runDirectory, '.lease.json'), JSON.stringify(lease), { encoding: 'utf8', flag: 'wx' });
  const source = Buffer.from(validated.source, 'utf8');
  if (source.byteLength > 600_000) {
    fs.rmSync(runDirectory, { recursive: true, force: true });
    return { status: 413, value: failure('H2_COMPILER_OUTPUT_TOO_LARGE') };
  }
  fs.writeFileSync(sourcePath, source, { flag: 'wx', mode: 0o600 });
  const compiledSourceSha256 = crypto.createHash('sha256').update(source).digest('hex');
  const runtime = { runId, configFingerprint: validated.configFingerprint, compiledSourceSha256 };
  const workerInput = Buffer.from(JSON.stringify({ request, runtime }), 'utf8');
  const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const supervisor = spawn(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SUPERVISOR_PATH,
    '-PythonPath', python, '-WorkerPath', WORKER_PATH, '-SourcePath', sourcePath,
    '-CoordinatorPid', String(process.pid),
  ], { cwd: REPOSITORY_ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  if (Number.isInteger(supervisor.pid)) {
    lease.supervisorPid = supervisor.pid;
    writeRunLease(runDirectory, lease);
  }
  const active = { supervisor, runDirectory, cancelled: false, timedOut: false, childPid: null, outputSize: 0, stdout: [], stderr: [], stderrText: '' };
  activeRun = active;
  const terminate = (why) => {
    if (active.terminated) return;
    if (why === 'deadline') active.timedOut = true;
    else if (why === 'disconnect') active.cancelled = true;
    else active.resultDiscarded = true;
    active.terminated = true;
    supervisor.kill('SIGKILL');
  };
  const abort = () => terminate('disconnect');
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const deadline = setTimeout(() => terminate('deadline'), H2_LOCAL_PYTHON_LIMITS.durationMs);
  supervisor.stdout.on('data', (chunk) => {
    active.outputSize += chunk.byteLength;
    if (active.outputSize > OUTPUT_LIMIT) {
      terminate('output-limit');
      return;
    }
    active.stdout.push(chunk);
  });
  supervisor.stderr.on('data', (chunk) => {
    const line = Buffer.from(chunk).toString('utf8');
    active.stderrText = `${active.stderrText}${line}`.slice(-4096);
    const readyMatch = active.stderrText.match(/H2_JOB_READY:(\d+)/);
    if (readyMatch && active.childPid === null) {
      active.childPid = Number(readyMatch[1]);
      lease.workerPid = active.childPid;
      writeRunLease(runDirectory, lease);
    }
    const endedMatch = active.stderrText.match(/H2_PROCESS_TERMINATED:(\d+)/);
    if (endedMatch && Number(endedMatch[1]) === active.childPid) active.childTerminated = true;
    if (active.stderrText.includes('H2_JOB_SETUP_FAILED') || active.stderrText.includes('H2_SUPERVISOR_UNAVAILABLE')) active.setupFailed = true;
    active.stderr.push(Buffer.from(chunk));
    while (active.stderr.reduce((sum, part) => sum + part.byteLength, 0) > 4096) active.stderr.shift();
  });
  const resultPromise = new Promise((resolve) => {
    supervisor.once('error', (error) => resolve({ spawnError: error }));
    supervisor.once('close', (code, closeSignal) => resolve({ code, signal: closeSignal }));
  });
  supervisor.stdin.on('error', () => {});
  supervisor.stdin.end(workerInput);
    const ended = await resultPromise;
  clearTimeout(deadline);
  signal?.removeEventListener('abort', abort);
  const processGone = active.childTerminated || active.childPid === null || await waitForProcessGone(active.childPid);
  activeRun = null;
  try {
    if (ended.spawnError) return { status: 503, value: failure('H2_SUPERVISOR_UNAVAILABLE', { processTerminated: true }) };
    if (!processGone) return { status: 502, value: failure('H2_PROCESS_TERMINATION_UNCONFIRMED', {
      cancellationRequested: active.cancelled || active.timedOut,
      processTerminated: false,
      resultDiscarded: true,
    }) };
    if (active.outputSize > OUTPUT_LIMIT) return { status: 413, value: failure('H2_RESULT_TOO_LARGE', {
      cancellationRequested: active.cancelled,
      processTerminated: true,
      resultDiscarded: true,
    }) };
    const stdout = Buffer.concat(active.stdout);
    const stderr = Buffer.concat(active.stderr).toString('utf8');
    return parseSupervisorOutput(stdout, stderr, validated, runtime, {
      cancelled: active.cancelled,
      timedOut: active.timedOut,
      childPid: processGone ? null : active.childPid,
      setupFailed: active.setupFailed,
    });
  } finally {
    fs.rmSync(runDirectory, { recursive: true, force: true });
  }
}

let activeRun = null;

export function createH2LocalPythonServer({ host = DEFAULT_HOST, port = DEFAULT_PORT } = {}) {
  if (host !== DEFAULT_HOST) throw new TypeError('H2 coordinator may bind only to 127.0.0.1.');
  const paths = environmentPaths();
  if (paths) reapOwnedStaleRuns(paths);
  const server = http.createServer(async (request, response) => {
    const origin = acceptedOrigin(request);
    if (!hostIsLocal(request) || origin === false) {
      jsonResponse(response, 403, failure('H2_ORIGIN_OR_HOST_REJECTED'));
      return;
    }
    if (request.method === 'OPTIONS') {
      if (origin === null) {
        jsonResponse(response, 403, failure('H2_ORIGIN_REQUIRED'));
        return;
      }
      response.writeHead(204, {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '300',
        vary: 'Origin',
      });
      response.end();
      return;
    }
    const url = new URL(request.url, `http://${DEFAULT_HOST}:${port}`);
    if (request.method === 'GET' && url.pathname === '/v1/h2/health') {
      jsonResponse(response, 200, {
        schemaVersion: 'volk.h2.health.v1',
        profile: H2_LOCAL_PYTHON_PROFILE_V1,
        available: process.platform === 'win32' && runtimeAvailable(),
        platform: process.platform === 'win32' ? 'win32' : 'unsupported',
        reason: process.platform !== 'win32' ? 'H2_WINDOWS_RUNTIME_REQUIRED' : runtimeAvailable() ? null : 'H2_RUNTIME_UNAVAILABLE',
        limits: { ...H2_LOCAL_PYTHON_LIMITS },
      }, origin);
      return;
    }
    if (request.method !== 'POST' || !['/v1/h2/authorize', '/v1/h2/fit'].includes(url.pathname)) {
      jsonResponse(response, 404, failure('H2_ROUTE_NOT_FOUND'), origin);
      return;
    }
    if (origin === null) {
      jsonResponse(response, 403, failure('H2_ORIGIN_REQUIRED'));
      return;
    }
    let body;
    try { body = await readBody(request); } catch (error) {
      jsonResponse(response, 400, failure(safeCode(error, 'H2_REQUEST_JSON_INVALID')), origin);
      return;
    }
    if (url.pathname === '/v1/h2/authorize') {
      try {
        if (!runtimeAvailable()) {
          jsonResponse(response, 503, failure('H2_RUNTIME_UNAVAILABLE'), origin);
          return;
        }
        const validated = await validateH2LocalPythonRequestV1(body, { requireAuthorization: false });
        const authorizationId = `h2-auth-${crypto.randomUUID()}`;
        const nonce = quoteCode();
        const expiresAt = new Date(Date.now() + AUTHORIZATION_TTL_MS).toISOString();
        const authorization = {
          authorizationId,
          requestFingerprint: validated.identity.normalizedRequestFingerprint,
          expiresAt,
          nonce,
        };
        cleanupOldAuthorizations();
        AUTHORIZATIONS.set(authorizationId, {
          requestFingerprint: authorization.requestFingerprint,
          expiresAt,
          expiresAtMs: Date.parse(expiresAt),
          nonce,
          sessionId: validated.request.sessionId,
          consumed: false,
        });
        jsonResponse(response, 200, { schemaVersion: 'volk.h2.authorization.v1', authorization }, origin);
      } catch (error) {
        jsonResponse(response, 422, failure(safeCode(error)), origin);
      }
      return;
    }
    const abortController = new AbortController();
    request.on('aborted', () => abortController.abort('disconnect'));
    response.on('close', () => {
      if (!response.writableEnded) abortController.abort('disconnect');
    });
    try {
      const validated = await validateH2LocalPythonRequestV1(body);
      const authorization = AUTHORIZATIONS.get(body.authorization.authorizationId);
      if (!authorization || authorization.consumed || authorization.expiresAtMs <= Date.now()
        || authorization.sessionId !== body.sessionId
        || authorization.requestFingerprint !== body.authorization.requestFingerprint
        || authorization.nonce !== body.authorization.nonce
        || authorization.expiresAt !== body.authorization.expiresAt) fail('H2_AUTHORIZATION_EXPIRED_OR_REPLAYED');
      if (activeRun) {
        jsonResponse(response, 409, failure('H2_BUSY'), origin);
        return;
      }
      authorization.consumed = true;
      AUTHORIZATIONS.delete(body.authorization.authorizationId);
      const requestForWorker = attachH2LocalPythonAuthorizationV1(validated.request, body.authorization);
      const paths = environmentPaths();
      fs.mkdirSync(paths.runs, { recursive: true });
      const result = await runTraining(requestForWorker, validated, { python: paths.python, runs: paths.runs, signal: abortController.signal });
      if (!response.destroyed) jsonResponse(response, result.status, result.value, origin);
    } catch (error) {
      if (!response.destroyed) jsonResponse(response, 422, failure(safeCode(error)), origin);
    }
  });
  server.on('close', () => {
    if (activeRun?.supervisor) activeRun.supervisor.kill('SIGKILL');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.VOLK_H2_PORT ?? DEFAULT_PORT);
  createH2LocalPythonServer({ port }).then((server) => {
    const address = server.address();
    process.stdout.write(`VOLK_H2_LOCAL_PYTHON=http://${DEFAULT_HOST}:${address.port}\n`);
  }).catch((error) => {
    process.stderr.write(`H2_COORDINATOR_START_FAILED:${safeCode(error, 'H2_COORDINATOR_START_FAILED')}\n`);
    process.exitCode = 1;
  });
}
