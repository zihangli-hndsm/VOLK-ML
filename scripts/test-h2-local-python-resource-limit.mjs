import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  attachH2LocalPythonAuthorizationV1,
  projectH2LocalPythonRequestV2,
} from '../src/core/execution/h2LocalPython.js';
import { h2RegressionFixture } from './h2-local-python/test-fixtures.mjs';

if (process.platform !== 'win32') {
  process.stdout.write('H2 Job Object memory-limit diagnostic requires Windows; skipped on this platform.\n');
  process.exit(0);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const localRoot = path.join(process.env.LOCALAPPDATA ?? '', 'VOLK', 'h2-local-python-v1');
const pythonDirectory = path.join(localRoot, 'python-3.12.10');
const runsRoot = path.join(localRoot, 'runs');
const pythonPath = path.join(pythonDirectory, 'python.exe');
if (!fs.existsSync(pythonPath)
  || !fs.existsSync(path.join(pythonDirectory, 'Lib', 'site-packages', 'torch'))
  || !fs.existsSync(path.join(pythonDirectory, 'Lib', 'site-packages', 'numpy'))) {
  process.stdout.write('H2 Job Object memory-limit diagnostic requires the pinned local runtime; skipped because it is not installed.\n');
  process.exit(0);
}

const isolatedCoordinatorRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-h2-memory-limit-test-'));
const sourceDirectory = path.join(scriptDirectory, 'h2-local-python');
const supervisorSource = fs.readFileSync(path.join(sourceDirectory, 'supervisor.ps1'), 'utf8');
const defaultMemoryLimit = 'const ulong JOB_MEMORY_LIMIT_BYTES = 2147483648UL;';
assert.equal(supervisorSource.split(defaultMemoryLimit).length - 1, 1,
  'the production hard cap has one explicit declaration for the isolated test copy to replace');
const isolatedSupervisor = supervisorSource.replace(defaultMemoryLimit,
  'const ulong JOB_MEMORY_LIMIT_BYTES = 67108864UL;');
for (const filename of ['server.mjs', 'worker.py']) {
  let source = fs.readFileSync(path.join(sourceDirectory, filename), 'utf8');
  if (filename === 'server.mjs') {
    const contractImport = "from '../../src/core/execution/h2LocalPython.js';";
    assert.ok(source.includes(contractImport), 'isolated server retains the canonical contract module');
    source = source.replace(contractImport,
      `from '${pathToFileURL(path.join(repositoryRoot, 'src/core/execution/h2LocalPython.js')).href}';`)
      .replace("const REPOSITORY_ROOT = path.resolve(MODULE_DIR, '../..');",
        `const REPOSITORY_ROOT = ${JSON.stringify(repositoryRoot)};`);
  }
  fs.writeFileSync(path.join(isolatedCoordinatorRoot, filename), source, { encoding: 'utf8', flag: 'wx' });
}
fs.writeFileSync(path.join(isolatedCoordinatorRoot, 'supervisor.ps1'), isolatedSupervisor, { encoding: 'utf8', flag: 'wx' });

const ownedRuns = () => {
  if (!fs.existsSync(runsRoot)) return [];
  return fs.readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^h2-[A-Za-z0-9-]{5,80}$/.test(entry.name))
    .map((entry) => path.join(runsRoot, entry.name))
    .filter((directory) => fs.existsSync(path.join(directory, '.volk-h2-owned'))
      && fs.readFileSync(path.join(directory, '.volk-h2-owned'), 'ascii') === 'volk-h2-owned-v1\n')
    .sort();
};

let server;
try {
  const { createH2LocalPythonServer } = await import(pathToFileURL(path.join(isolatedCoordinatorRoot, 'server.mjs')).href);
  server = await createH2LocalPythonServer({ port: 0 });
  const base = `http://127.0.0.1:${server.address().port}/v1/h2`;
  const connection = server.connectionCredential;
  const headers = {
    Origin: 'http://localhost:5173',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${connection.token}`,
    'X-Volk-H2-Connection-Id': connection.connectionId,
  };
  const draft = await projectH2LocalPythonRequestV2(h2RegressionFixture());
  const beforeRuns = ownedRuns();
  const authorizationResponse = await fetch(`${base}/authorize`, {
    method: 'POST', headers, body: JSON.stringify(draft),
  });
  assert.equal(authorizationResponse.status, 200, `the bounded resource test request is authorized: ${await authorizationResponse.clone().text()}`);
  const authorizationEnvelope = await authorizationResponse.json();
  const signedRequest = attachH2LocalPythonAuthorizationV1(draft, authorizationEnvelope.authorization);
  const response = await fetch(`${base}/fit`, {
    method: 'POST', headers, body: JSON.stringify(signedRequest), signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  assert.equal(response.status, 502, JSON.stringify(result));
  assert.equal(result.error.code, 'H2_PROCESS_MEMORY_LIMIT_EXCEEDED',
    'the real isolated 64 MiB Job Object hard limit is reported by stable resource code');
  assert.deepEqual(result.lifecycle, {
    cancellationRequested: false,
    processTerminated: true,
    resultDiscarded: true,
  }, 'resource termination is contained, confirmed, and never treated as a model result');
  assert.deepEqual(ownedRuns(), beforeRuns, 'the marker-owned run directory is removed after the hard-limit outcome');
  process.stdout.write('H2 verified Job Object memory-limit diagnostic passed: isolated 64 MiB hard cap, exact H2_PROCESS_MEMORY_LIMIT_EXCEEDED code, confirmed termination, discarded result, and run cleanup.\n');
} finally {
  if (server) {
    const closed = new Promise((resolve) => server.close(resolve));
    await closed;
  }
  const tempRoot = path.resolve(os.tmpdir());
  const cleanupTarget = path.resolve(isolatedCoordinatorRoot);
  if (cleanupTarget === tempRoot || !cleanupTarget.startsWith(`${tempRoot}${path.sep}`)) {
    throw new Error('Refusing to clean the H2 resource-test path because it is outside the system temporary directory.');
  }
  fs.rmSync(cleanupTarget, { recursive: true, force: true });
}
