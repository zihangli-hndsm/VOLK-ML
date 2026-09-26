import path from 'node:path';
import { spawn as defaultSpawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  classifyCodexStderr,
  normalizeConfigPath,
  summarizeCodexJsonEvent,
  summarizeD3RunnerError,
} from './agent-application-d3-contract.mjs';

function stopChild(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  try { child.kill('SIGTERM'); } catch {}
}

export function prepareCodexRunConfiguration({ codexPath, args, env, cwd }) {
  if (typeof codexPath !== 'string' || !codexPath.trim()) throw new TypeError('Codex executable path is required.');
  if (!Array.isArray(args) || args.length === 0 || args.some((argument) => typeof argument !== 'string')) {
    throw new TypeError('Codex argument vector must contain strings.');
  }
  if (typeof cwd !== 'string' || !cwd.trim()) throw new TypeError('Codex working directory is required.');
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw new TypeError('Codex child environment is required.');
  const configuredPythonPath = env.VOLK_D3_PYTHON;
  if (typeof configuredPythonPath !== 'string' || !configuredPythonPath.trim()) {
    throw new TypeError('Configured D3 Python executable is required.');
  }
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  const childPath = pathKey ? env[pathKey] : null;
  if (typeof childPath !== 'string' || !childPath) throw new TypeError('Codex child PATH is required.');

  const windowsPath = path.win32.isAbsolute(configuredPythonPath) && /^[a-z]:/i.test(configuredPythonPath);
  const pathApi = windowsPath ? path.win32 : path;
  const pathDelimiter = windowsPath ? ';' : path.delimiter;
  const configuredPythonDirectory = pathApi.dirname(configuredPythonPath);
  const firstPathEntry = childPath.split(pathDelimiter)[0] ?? '';
  const configuredPythonOnPath = Boolean(configuredPythonDirectory)
    && normalizeConfigPath(firstPathEntry).replace(/\/+$/, '').toLowerCase()
      === normalizeConfigPath(configuredPythonDirectory).replace(/\/+$/, '').toLowerCase();

  return { codexPath, args: [...args], env, cwd, configuredPythonPath, pythonDirectoryPinned: configuredPythonOnPath };
}

export function createCodexRun({
  codexPath,
  args,
  env,
  cwd,
  launchState,
  spawnImpl = defaultSpawn,
  stopProcessTreeImpl = stopChild,
  maxRunMs = 240_000,
  maxEvents = 500,
}) {
  if (!launchState || typeof launchState !== 'object') throw new TypeError('Codex launch state is required.');
  if (typeof spawnImpl !== 'function' || typeof stopProcessTreeImpl !== 'function') {
    throw new TypeError('Codex process adapters must be callable.');
  }
  if (!Number.isInteger(maxRunMs) || maxRunMs < 1 || !Number.isInteger(maxEvents) || maxEvents < 1) {
    throw new TypeError('Codex process bounds must be positive integers.');
  }

  // Resolve every value used by stream setup before spawning. A setup failure
  // must not leave an unobserved Codex child alive.
  const configuration = prepareCodexRunConfiguration({ codexPath, args, env, cwd });
  const summary = {
    threadId: null,
    eventCount: 0,
    malformedJsonLines: 0,
    eventSummaries: [],
    mcpToolNames: new Set(),
    commandFlags: { inspectedD3Fixture: false, ranD3Exporter: false, usedPythonPath: false, usedTorchProposalHelper: false, usedPatchProposalHelper: false },
    usage: null,
    completed: false,
    failed: false,
    stderrClassification: null,
    processExitCode: null,
    processSignal: null,
    processStarted: false,
    processStartErrorCode: null,
  };
  let stderrText = '';

  launchState.spawnAttempted = true;
  const child = spawnImpl(configuration.codexPath, configuration.args, {
    cwd: configuration.cwd,
    env: configuration.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  launchState.child = child;

  let lineReader;
  let timeout;
  try {
    if (!child || typeof child.once !== 'function'
      || !child.stdout || typeof child.stdout.on !== 'function'
      || !child.stderr || typeof child.stderr.on !== 'function'
    ) {
      throw new TypeError('Codex child does not expose the expected process streams.');
    }
    launchState.childHandleCreated = true;
    child.once('spawn', () => {
      launchState.processStarted = true;
      summary.processStarted = true;
    });
    child.once('error', (error) => {
      launchState.processStarted = false;
      launchState.processStartErrorCode = summarizeD3RunnerError(error).code;
      summary.processStartErrorCode = launchState.processStartErrorCode;
    });
    lineReader = createInterface({ input: child.stdout });
    lineReader.on('line', (line) => {
      if (!line.trim()) return;
      let event;
      try { event = JSON.parse(line); } catch {
        summary.malformedJsonLines += 1;
        return;
      }
      summary.eventCount += 1;
      if (summary.eventCount > maxEvents) return;
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') summary.threadId = event.thread_id;
      const details = summarizeCodexJsonEvent(event);
      if (details.itemType === 'mcp_tool_call' || details.itemType === 'mcp_tool_call_output') {
        if (details.tool !== 'unsupported') summary.mcpToolNames.add(details.tool);
        summary.eventSummaries.push(details);
      } else if (details.itemType === 'command_execution') {
        if (details.status === 'completed' && (details.exitCode === null || details.exitCode === 0)) {
          for (const flag of Object.keys(summary.commandFlags)) summary.commandFlags[flag] ||= details[flag] === true;
        }
        summary.eventSummaries.push(details);
      } else if (event.type === 'turn.completed') {
        summary.completed = true;
        summary.usage = details.usage ?? null;
        summary.eventSummaries.push(details);
      } else if (event.type === 'turn.failed' || event.type === 'error') {
        summary.failed = true;
        summary.eventSummaries.push(details);
      }
      if (summary.eventSummaries.length > maxEvents) summary.eventSummaries.length = maxEvents;
    });
    child.stderr.on('data', (chunk) => {
      stderrText = `${stderrText}${chunk.toString('utf8')}`.slice(-12_000);
      summary.stderrClassification = classifyCodexStderr(stderrText);
    });
    timeout = setTimeout(() => stopProcessTreeImpl(child), maxRunMs);
    timeout.unref?.();
  } catch (error) {
    stopProcessTreeImpl(child);
    throw error;
  }

  const completion = new Promise((resolve) => {
    child.once('error', () => resolve({ exitCode: -1 }));
    child.once('close', (exitCode) => {
      clearTimeout(timeout);
      lineReader.close();
      summary.stderrClassification = classifyCodexStderr(stderrText);
      summary.processExitCode = exitCode ?? -1;
      summary.processSignal = child.signalCode ?? null;
      resolve({ exitCode: exitCode ?? -1 });
    });
  });
  return { child, completion, summary, pythonDirectoryPinned: configuration.pythonDirectoryPinned };
}
