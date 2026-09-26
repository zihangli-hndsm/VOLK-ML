import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  analyzeSourceReimport,
  finalizeSourceReimportProposal,
  SOURCE_REIMPORT_LIMITS,
} from '../src/core/graph/sourceReimportProposal.js';

const MAX_PROJECT_BYTES = SOURCE_REIMPORT_LIMITS.maxProjectCodeUnits;
const MAX_MANIFEST_BYTES = 3_600_000;
const MAX_AST_WORKER_INPUT_BYTES = 2_500_000;
const MAX_AST_WORKER_OUTPUT_BYTES = 4_000_000;
const MAX_AST_WORKER_STDERR_BYTES = 16_000;
const DEFAULT_WORKER_TIMEOUT_MS = 8_000;
const WORKER_PATH = fileURLToPath(new URL('../tools/source_reimport/parse_generated_pytorch.py', import.meta.url));

export class SourceReimportRunnerError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SourceReimportRunnerError';
    this.code = code;
  }
}

function fail(code) {
  throw new SourceReimportRunnerError(code);
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function normalizePathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

async function readBoundedInput(inputPath, maxBytes, codePrefix) {
  let info;
  let resolved;
  let file;
  try {
    const linkInfo = await lstat(inputPath);
    if (linkInfo.isSymbolicLink() || !linkInfo.isFile()) fail(`${codePrefix}_PATH_INVALID`);
    resolved = await realpath(inputPath);
    info = await stat(resolved);
    if (!info.isFile() || info.size > maxBytes) fail(`${codePrefix}_BOUND`);
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
    file = await open(resolved, flags);
    const opened = await file.stat();
    if (!opened.isFile() || opened.size > maxBytes || (info.ino && opened.ino && info.ino !== opened.ino)) {
      fail(`${codePrefix}_PATH_INVALID`);
    }
    const buffer = await file.readFile();
    if (buffer.length > maxBytes) fail(`${codePrefix}_BOUND`);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { fail(`${codePrefix}_UTF8_INVALID`); }
    return { text, resolvedPath: resolved };
  } catch (error) {
    if (error instanceof SourceReimportRunnerError) throw error;
    if (error?.code === 'ENOENT' || error?.code === 'EACCES' || error?.code === 'EPERM') fail(`${codePrefix}_FILE_UNAVAILABLE`);
    fail(`${codePrefix}_READ_FAILED`);
  } finally {
    await file?.close().catch(() => {});
  }
}

function workerEnvironment() {
  const result = {};
  for (const key of ['PATH', 'PATHEXT', 'COMSPEC', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    const value = process.env[key];
    if (typeof value === 'string' && value.length < 4_096) result[key] = value;
  }
  return result;
}

export function parseGeneratedSources({
  original,
  edited,
  pythonExecutable = process.env.VOLK_REIMPORT_PYTHON ?? process.env.PYTHON ?? 'python',
  workerPath = WORKER_PATH,
  timeoutMs = DEFAULT_WORKER_TIMEOUT_MS,
  signal,
} = {}) {
  const request = JSON.stringify({ protocol: 1, sources: { original, edited } });
  if (byteLength(request) > MAX_AST_WORKER_INPUT_BYTES) return Promise.reject(new SourceReimportRunnerError('SOURCE_REIMPORT_WORKER_INPUT_BOUND'));
  return (async () => {
    try {
      const workerInfo = await lstat(workerPath);
      if (workerInfo.isSymbolicLink() || !workerInfo.isFile()) fail('SOURCE_REIMPORT_WORKER_UNAVAILABLE');
    } catch (error) {
      if (error instanceof SourceReimportRunnerError) throw error;
      fail('SOURCE_REIMPORT_WORKER_UNAVAILABLE');
    }
    return new Promise((resolve, reject) => {
    let child;
    let timedOut = false;
    let interrupted = Boolean(signal?.aborted);
    let oversizedOutput = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout = [];
    let timer;
    const finishError = (code) => reject(new SourceReimportRunnerError(code));
    if (interrupted) { finishError('SOURCE_REIMPORT_INTERRUPTED'); return; }
    try {
      child = spawn(pythonExecutable, ['-I', '-S', workerPath], {
        cwd: path.dirname(workerPath),
        env: workerEnvironment(),
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      finishError('SOURCE_REIMPORT_PYTHON_UNAVAILABLE');
      return;
    }
    const onAbort = () => {
      interrupted = true;
      child.kill();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_AST_WORKER_OUTPUT_BYTES) {
        oversizedOutput = true;
        child.kill();
      } else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_AST_WORKER_STDERR_BYTES) child.kill();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      finishError(error?.code === 'ENOENT' ? 'SOURCE_REIMPORT_PYTHON_UNAVAILABLE' : 'SOURCE_REIMPORT_WORKER_FAILED');
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (interrupted) { finishError('SOURCE_REIMPORT_INTERRUPTED'); return; }
      if (timedOut) { finishError('SOURCE_REIMPORT_WORKER_TIMEOUT'); return; }
      if (oversizedOutput) { finishError('SOURCE_REIMPORT_WORKER_OUTPUT_BOUND'); return; }
      const output = Buffer.concat(stdout, stdoutBytes).toString('utf8');
      let decoded;
      try { decoded = JSON.parse(output); } catch { finishError('SOURCE_REIMPORT_WORKER_RESPONSE_INVALID'); return; }
      if (decoded?.protocol !== 1) { finishError('SOURCE_REIMPORT_WORKER_PROTOCOL_INVALID'); return; }
      if (typeof decoded?.error === 'string') { finishError(decoded.error); return; }
      if (exitCode !== 0 || !decoded?.asts || !decoded.asts.original || !decoded.asts.edited) {
        finishError('SOURCE_REIMPORT_WORKER_FAILED');
        return;
      }
      resolve(decoded.asts);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(request, 'utf8');
    });
  })();
}

function parseArguments(argv) {
  const allowed = new Set(['--project', '--original-source', '--manifest', '--edited-source', '--out']);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag) || values[flag] !== undefined) fail('SOURCE_REIMPORT_ARGUMENT_INVALID');
    const value = argv[index + 1];
    if (typeof value !== 'string' || !value || value.startsWith('--')) fail('SOURCE_REIMPORT_ARGUMENT_INVALID');
    values[flag] = value;
    index += 1;
  }
  if ([...allowed].some((flag) => typeof values[flag] !== 'string')) fail('SOURCE_REIMPORT_ARGUMENT_REQUIRED');
  return values;
}

async function prepareOutputPath(outputArgument, inputPaths) {
  const absolute = path.resolve(outputArgument);
  const parentPath = path.dirname(absolute);
  const basename = path.basename(absolute);
  if (!basename || basename === '.' || basename === '..') fail('SOURCE_REIMPORT_OUTPUT_PATH_INVALID');
  let parentRealPath;
  try { parentRealPath = await realpath(parentPath); } catch { fail('SOURCE_REIMPORT_OUTPUT_DIRECTORY_UNAVAILABLE'); }
  const outputPath = path.join(parentRealPath, basename);
  if (inputPaths.some((inputPath) => normalizePathKey(inputPath) === normalizePathKey(outputPath))) {
    fail('SOURCE_REIMPORT_OUTPUT_ALIASES_INPUT');
  }
  try {
    const info = await lstat(outputPath);
    if (info.isSymbolicLink()) fail('SOURCE_REIMPORT_OUTPUT_PATH_INVALID');
    fail('SOURCE_REIMPORT_OUTPUT_EXISTS');
  } catch (error) {
    if (error instanceof SourceReimportRunnerError) throw error;
    if (error?.code !== 'ENOENT') fail('SOURCE_REIMPORT_OUTPUT_PATH_INVALID');
  }
  return outputPath;
}

async function writeNewProposal(outputPath, proposal) {
  const bytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`, 'utf8');
  if (bytes.length > 4_000_000) fail('SOURCE_REIMPORT_PROPOSAL_BOUND');
  let file;
  try {
    file = await open(outputPath, 'wx', 0o600);
    await file.writeFile(bytes);
    await file.sync();
  } catch (error) {
    if (error?.code === 'EEXIST') fail('SOURCE_REIMPORT_OUTPUT_EXISTS');
    fail('SOURCE_REIMPORT_OUTPUT_WRITE_FAILED');
  } finally {
    await file?.close().catch(() => {});
  }
}

export async function runSourceReimportCli(argv = process.argv.slice(2), options = {}) {
  const args = parseArguments(argv);
  const inputOptions = [
    ['--project', MAX_PROJECT_BYTES, 'SOURCE_REIMPORT_PROJECT'],
    ['--original-source', SOURCE_REIMPORT_LIMITS.maxSourceBytes, 'SOURCE_REIMPORT_ORIGINAL'],
    ['--manifest', MAX_MANIFEST_BYTES, 'SOURCE_REIMPORT_MANIFEST'],
    ['--edited-source', SOURCE_REIMPORT_LIMITS.maxSourceBytes, 'SOURCE_REIMPORT_EDITED'],
  ];
  const inputs = new Map();
  for (const [flag, max, prefix] of inputOptions) {
    inputs.set(flag, await readBoundedInput(args[flag], max, prefix));
  }
  const paths = [...inputs.values()].map((entry) => entry.resolvedPath);
  if (new Set(paths.map(normalizePathKey)).size !== paths.length) fail('SOURCE_REIMPORT_INPUTS_ALIAS');
  const outputPath = await prepareOutputPath(args['--out'], paths);
  let project;
  let manifest;
  try { project = JSON.parse(inputs.get('--project').text); } catch { fail('SOURCE_REIMPORT_PROJECT_JSON_INVALID'); }
  try { manifest = JSON.parse(inputs.get('--manifest').text); } catch { fail('SOURCE_REIMPORT_MANIFEST_JSON_INVALID'); }
  const originalSource = inputs.get('--original-source').text;
  const editedSource = inputs.get('--edited-source').text;
  const asts = await parseGeneratedSources({
    original: originalSource,
    edited: editedSource,
    pythonExecutable: options.pythonExecutable,
    workerPath: options.workerPath,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
  const prepared = await analyzeSourceReimport({
    project,
    originalSource,
    manifest,
    editedSource,
    originalAst: asts.original,
    editedAst: asts.edited,
  });
  if (!prepared.ok) throw new SourceReimportRunnerError(prepared.diagnostics?.[0]?.code ?? 'SOURCE_REIMPORT_FAILED');
  if (prepared.status === 'no-op') return { status: 'no-op', analysis: prepared.analysis };
  const candidateAsts = await parseGeneratedSources({
    original: prepared.candidateSource,
    edited: editedSource,
    pythonExecutable: options.pythonExecutable,
    workerPath: options.workerPath,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
  const finalized = finalizeSourceReimportProposal(prepared, {
    candidateAst: candidateAsts.original,
    editedAst: candidateAsts.edited,
  });
  if (!finalized.ok) throw new SourceReimportRunnerError(finalized.diagnostics?.[0]?.code ?? 'SOURCE_REIMPORT_FAILED');
  await writeNewProposal(outputPath, finalized.proposal);
  return {
    status: 'proposal',
    proposalId: finalized.proposal.proposalId,
    operationCount: finalized.analysis.operationCount,
    shapeCompatibility: finalized.analysis.shapeCompatibility,
    shapeLimitations: finalized.analysis.shapeLimitations,
  };
}

async function main(argv = process.argv.slice(2), signal) {
  try {
    const result = await runSourceReimportCli(argv, { signal });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof SourceReimportRunnerError
      ? error.code
      : /^[A-Z][A-Z0-9_]{2,95}$/.test(error?.code ?? '') ? error.code : 'SOURCE_REIMPORT_FAILED';
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = code === 'SOURCE_REIMPORT_INTERRUPTED' ? 130 : 2;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const controller = new AbortController();
  const interrupt = () => {
    controller.abort();
    process.exitCode = 130;
  };
  process.once('SIGINT', interrupt);
  main(process.argv.slice(2), controller.signal).finally(() => process.removeListener('SIGINT', interrupt));
}
