import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = fs.readFileSync(path.join(root, 'scripts/h2-local-python/worker.py'), 'utf8');
const supervisor = fs.readFileSync(path.join(root, 'scripts/h2-local-python/supervisor.ps1'), 'utf8');
const server = fs.readFileSync(path.join(root, 'scripts/h2-local-python/server.mjs'), 'utf8');
const client = fs.readFileSync(path.join(root, 'src/services/h2LocalPythonClient.js'), 'utf8');
const contracts = fs.readFileSync(path.join(root, 'src/core/execution/h2LocalPython.js'), 'utf8');

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
assert.match(server, /H2_PROCESS_MEMORY_LIMIT_EXCEEDED/, 'a verified Job Object memory-limit event has a stable bounded diagnostic');
assert.match(server, /supervisorExitCode === SUPERVISOR_JOB_MEMORY_LIMIT_EXIT_CODE && jobMemoryLimitExceeded/,
  'resource-limit classification requires both the dedicated supervisor exit code and its explicit Job Object event');
assert.match(supervisor, /JOBOBJECT_ASSOCIATE_COMPLETION_PORT/, 'the supervisor associates the Job Object with a completion port');
assert.match(supervisor, /GetQueuedCompletionStatus/, 'the supervisor observes actual Job Object completion messages');
assert.match(supervisor, /JOB_OBJECT_MSG_NOTIFICATION_LIMIT = 11/, 'the guaranteed resource-notification completion message is observed');
assert.match(supervisor, /JobObjectNotificationLimitInformation = 12/, 'a guaranteed notification threshold is configured');
assert.match(supervisor, /JOB_MEMORY_NOTIFICATION_BYTES = JOB_MEMORY_LIMIT_BYTES/, 'the notification threshold matches the unchanged 2 GiB hard cap');
assert.match(supervisor, /TerminateAndReportJobMemoryLimit\(job, process\.hProcess, process\.dwProcessId\)/,
  'verified memory events terminate and await the worker process before emitting bounded diagnostics');
assert.match(supervisor, /static int TerminateAndReportJobMemoryLimit[\s\S]*?Check\(TerminateJobObject\(job, 0xE0020003\)\)/,
  'every verified resource failure terminates the whole Job Object even if the primary worker already exited');
assert.match(supervisor, /while \(activeProcesses != 0\)[\s\S]*?accounting\.ActiveProcesses/,
  'the resource marker is delayed until all Job Object processes have exited');
assert.match(supervisor, /JobObjectLimitViolationInformation = 13/, 'the supervisor queries the authoritative Job Object violation record');
assert.match(supervisor, /ViolationLimitFlags & JOB_OBJECT_LIMIT_JOB_MEMORY/,
  'only an explicitly reported job-wide memory violation is classified');
assert.match(supervisor, /violation\.JobMemory >= violation\.JobMemoryLimit/,
  'the reported committed job memory must have reached its configured threshold');
assert.match(supervisor, /if \(jobMemoryLimitExceeded && exitCode != 0\)/,
  'a threshold notification alone cannot turn a normal worker exit into a resource failure');
assert.match(supervisor, /return 80;/, 'the supervisor uses a dedicated resource-limit exit code distinct from setup/coordinator failures');
assert.match(supervisor, /EntryPoint = "SetInformationJobObject"[\s\S]*ref JOBOBJECT_ASSOCIATE_COMPLETION_PORT/,
  'the completion-port association uses the correctly typed native overload');
assert.match(contracts, /volk\.h2\.request\.v2/, 'the shared contract uses the class-vocabulary-bound request version');
assert.match(server, /H2_CONNECTION_REQUIRED/, 'the companion rejects execution without a connection credential');
assert.match(server, /timingSafeEqual/, 'connection credentials are compared without a timing-sensitive string comparison');
assert.match(server, /H2_PAIRING_TOKEN=/, 'the one-time local pairing token is emitted only by the companion process');
assert.match(client, /Authorization: `Bearer \$\{token\}`/, 'the client sends the user-paired bearer credential explicitly');
assert.match(client, /connectionId !== connection\.connectionId/, 'the client refuses stale coordinator generations');
assert.match(contracts, /classVocabulary/, 'class labels are part of request identity and result semantics');
assert.match(contracts, /H2_DATASET_NUMERIC_VALUE_INVALID/, 'non-numeric source values receive a stable contract error rather than coercion');
assert.match(contracts, /H2_GRAPH_LAYER_DIMENSION_MISMATCH/, 'Dense dimensions are validated against their predecessor');

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
