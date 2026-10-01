import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = fs.readFileSync(path.join(root, 'scripts/h2-local-python/worker.py'), 'utf8');
const supervisor = fs.readFileSync(path.join(root, 'scripts/h2-local-python/supervisor.ps1'), 'utf8');
const server = fs.readFileSync(path.join(root, 'scripts/h2-local-python/server.mjs'), 'utf8');

assert.match(worker, /sys\.stdin\.buffer\.read\(/, 'the fixed worker reads the bounded request from stdin');
assert.match(worker, /sys\.stdout\.buffer\.write\(/, 'the fixed worker writes its bounded result to stdout');
assert.match(worker, /torch\.manual_seed\(/, 'the worker establishes the contracted deterministic seed');
assert.match(worker, /model\.eval\(\)/, 'evaluation uses the non-training mode');
assert.match(worker, /def verify_dropout_modes\(model\):/, 'the real fit path probes configured Dropout training and evaluation modes');
assert.match(worker, /H2_DROPOUT_TRAIN_MODE_INVALID/, 'Dropout must demonstrate stochastic training behavior');
assert.match(worker, /H2_DROPOUT_EVAL_MODE_INVALID/, 'Dropout evaluation must be stable and the identity operation');
assert.doesNotMatch(worker, /subprocess|os\.system|(?<!\.)eval\s*\(/, 'the worker has no child-process or eval execution path');
assert.match(worker, /exec\(code, scope, scope\)/, 'the worker runs only the canonical compiler output');
assert.ok(worker.indexOf('source_hash != runtime.get("compiledSourceSha256")') < worker.indexOf('exec(code, scope, scope)'),
  'the fixed compiled source hash is checked before Python evaluates it');
assert.equal((worker.match(/print\s*\(/g) ?? []).length, 1, 'the worker has one bounded error-response writer');
assert.match(worker, /print\(canonical_json_bytes\(error_response\(/,
  'the sole print path emits only a bounded reason-code response');

for (const symbol of [
  'CREATE_SUSPENDED', 'CreateJobObject', 'SetInformationJobObject', 'AssignProcessToJobObject',
  'QueryInformationJobObject', 'IsProcessInJob', 'ResumeThread', 'JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE',
  'JOB_OBJECT_LIMIT_JOB_MEMORY',
]) assert.ok(supervisor.includes(symbol), `the Windows supervisor requires ${symbol}`);
assert.ok(supervisor.indexOf('AssignProcessToJobObject') < supervisor.indexOf('ResumeThread'),
  'the child is assigned to the bounded Job Object before its first instruction runs');
assert.match(supervisor, /CoordinatorPid/, 'the supervisor watches coordinator lifetime');
assert.match(server, /AbortSignal|signal\.aborted|abortController\.abort/, 'request cancellation reaches the supervised worker lifecycle');
assert.match(server, /H2_LOCAL_PYTHON_LIMITS\.durationMs/, 'the coordinator applies the contracted execution deadline');

const lock = JSON.parse(fs.readFileSync(path.join(root, 'tools/h2_local_python/runtime-lock.json'), 'utf8'));
assert.equal(lock.python.version, '3.12.10');
const torch = lock.packages.find((packageLock) => packageLock.name === 'torch');
const numpy = lock.packages.find((packageLock) => packageLock.name === 'numpy');
assert.equal(torch?.version, '2.14.0+cpu');
assert.equal(numpy?.version, '2.5.3');
assert.match(torch.artifact, /\+cpu-/);
assert.match(lock.python.sha256, /^[a-f0-9]{64}$/);
assert.ok(Array.isArray(lock.packages) && lock.packages.length >= 3);
for (const packageLock of lock.packages) assert.match(packageLock.sha256, /^[a-f0-9]{64}$/);

process.stdout.write('H2 fixed-worker, Windows containment ordering, lifecycle, and pinned-runtime checks passed.\n');
