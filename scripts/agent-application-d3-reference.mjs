import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCodexRun } from './agent-application-d3-codex-run.mjs';
import {
  D3_ALLOWED_MCP_TOOLS,
  buildD3AgentPrompt,
  buildD3CodexArguments,
  listConfiguredMcpServerNames,
  summarizeD3RunnerError,
  validateD3PythonRuntimeAttestation,
  validateEffectiveD3McpConfigOutput,
} from './agent-application-d3-contract.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const MCP_SERVER_SCRIPT = path.join(REPOSITORY_ROOT, 'scripts', 'volk-mcp-server.mjs');
const FIXTURE_DIRECTORY = path.join(REPOSITORY_ROOT, 'fixtures', 'graph-infrastructure-d3', 'pytorch-repo');
const MAX_CODEX_RUN_MS = 240_000;
const MAX_CODEX_EVENTS = 500;
const SAFE_ERROR_CODES = new Set([
  'CODEX_CLI_NOT_FOUND', 'CODEX_AUTH_UNAVAILABLE', 'CODEX_QUOTA_UNAVAILABLE', 'CODEX_RUN_TIMEOUT',
  'CODEX_MCP_CONFIG_UNAVAILABLE', 'CODEX_PROCESS_SETUP_FAILED',
  'CODEX_RUN_FAILED', 'PYTORCH_ENV_UNAVAILABLE', 'CHROME_NOT_FOUND', 'VITE_START_FAILED',
  'MCP_SERVER_NOT_READY', 'MCP_BROWSER_NOT_CONNECTED', 'BROWSER_START_FAILED', 'BROWSER_JOURNEY_FAILED',
  'AGENT_EVENT_STREAM_INVALID', 'AGENT_REQUIRED_TOOL_MISSING', 'AGENT_REQUIRED_COMMAND_MISSING',
  'FRESH_WORKSPACE_REQUIRED', 'B1_PREVIEW_INVALID', 'B1_CHANGED_BEFORE_APPLY', 'B1_APPLY_FAILED',
  'C2_PREVIEW_INVALID', 'C2_CHANGED_BEFORE_APPLY', 'C2_DIFF_INVALID', 'C2_APPLY_FAILED',
]);
const BUILD_BUTTON_EXPRESSION = 'document.querySelectorAll("nav button")[1] ?? null';
const RESTORE_DIALOG_EXPRESSION = '(() => { const hasLabel = (labels, choices) => labels.some((label) => choices.some((choice) => label.includes(choice))); return [...document.querySelectorAll("div.fixed.inset-0")].find((overlay) => { const labels = [...overlay.querySelectorAll("button")].map((button) => button.innerText || button.textContent || ""); return hasLabel(labels, ["Restore project", "恢复项目"]) && hasLabel(labels, ["Start fresh", "新建项目"]); }) ?? null; })()';
const RESTORE_START_FRESH_EXPRESSION = '(() => { const dialog = ' + RESTORE_DIALOG_EXPRESSION + '; if (!dialog) return null; return [...dialog.querySelectorAll("button")].find((button) => { const label = button.innerText || button.textContent || ""; return label.includes("Start fresh") || label.includes("新建项目"); }) ?? null; })()';
const FIRST_STARTER_DELETE_EXPRESSION = '(() => [...document.querySelectorAll(".react-flow__node button")].find((item) => item.classList.contains("bg-red-50") && !item.disabled) ?? null)()';
const DELETE_CONFIRM_EXPRESSION = '(() => { const dialog = document.querySelector("[role=dialog][aria-labelledby=deletion-confirm-title]"); if (!dialog) return null; const buttons = dialog.querySelectorAll("button"); return buttons[buttons.length - 1] ?? null; })()';

class D3Error extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) { throw new D3Error(code); }

function repositoryCommand(args) {
  const result = spawnSync('git', args, { cwd: REPOSITORY_ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
  return result.status === 0 ? result.stdout.trim() : null;
}

function findExecutable(explicitPath, commandName, defaultCandidates = []) {
  const candidates = [explicitPath, ...defaultCandidates].filter((value) => typeof value === 'string' && value);
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  const located = spawnSync('where.exe', [commandName], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 });
  const pathFromWhere = (located.stdout ?? '').split(/\r?\n/).map((value) => value.trim()).find((value) => value && fs.existsSync(value));
  return pathFromWhere ?? null;
}

function validateCodex(codexPath) {
  if (!codexPath) fail('CODEX_CLI_NOT_FOUND');
  const versionResult = spawnSync(codexPath, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  if (versionResult.error || versionResult.status !== 0) fail('CODEX_CLI_NOT_FOUND');
  const version = `${versionResult.stdout ?? ''}`.trim().slice(0, 100);
  const login = spawnSync(codexPath, ['login', 'status'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  const loginText = `${login.stdout ?? ''}\n${login.stderr ?? ''}`;
  if (login.error || login.status !== 0 || !/logged in using chatgpt/i.test(loginText)) fail('CODEX_AUTH_UNAVAILABLE');
  return version;
}

function validatePython(pythonPath) {
  if (!pythonPath || !fs.existsSync(pythonPath)) fail('PYTORCH_ENV_UNAVAILABLE');
  const result = spawnSync(pythonPath, ['-c', 'import json, os, platform, sys, torch; print(json.dumps({"pythonVersion": platform.python_version(), "torchVersion": str(torch.__version__), "pythonExecutable": os.path.realpath(sys.executable)}))'], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (result.error || result.status !== 0) fail('PYTORCH_ENV_UNAVAILABLE');
  let runtime;
  try {
    runtime = JSON.parse(String(result.stdout ?? '').trim().split(/\r?\n/).at(-1) ?? '');
  } catch {
    fail('PYTORCH_ENV_UNAVAILABLE');
  }
  if (!runtime || !/^\d+\.\d+(?:\.\d+)?$/.test(runtime.pythonVersion ?? '')
    || !/^\d+\.\d+/.test(runtime.torchVersion ?? '')
    || typeof runtime.pythonExecutable !== 'string'
    || path.resolve(runtime.pythonExecutable).toLowerCase() !== path.resolve(fs.realpathSync(pythonPath)).toLowerCase()) {
    fail('PYTORCH_ENV_UNAVAILABLE');
  }
  return {
    pythonVersion: runtime.pythonVersion,
    torchVersion: runtime.torchVersion,
    pythonExecutable: fs.realpathSync(pythonPath),
  };
}

function validateCodexMcpStartup(codexPath, mcpConfig, repositoryRoot) {
  const result = spawnSync(codexPath, ['doctor', '--json', '--summary', '-c', mcpConfig], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    timeout: 30_000,
    env: {
      ...process.env,
      VOLK_MCP_PORT: '0',
      VOLK_MCP_SESSION_TOKEN: randomBytes(36).toString('base64url'),
    },
  });
  if (result.error || result.status !== 0) return false;
  try {
    const report = JSON.parse(result.stdout);
    return report?.checks?.['mcp.config']?.status === 'ok';
  } catch { return false; }
}

async function reserveLocalPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitFor(predicate, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const ready = await waitFor(async () => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      return response.ok;
    } catch { return false; }
  }, timeoutMs);
  if (!ready) return false;
  return true;
}

async function waitForMcpHealth(port, timeoutMs = 30_000) {
  let lastHealth = null;
  const ready = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_000) });
      if (!response.ok) return false;
      lastHealth = await response.json();
      return lastHealth?.ok === true ? lastHealth : false;
    } catch { return false; }
  }, timeoutMs);
  return ready ? lastHealth : null;
}

function stopProcessTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32' && Number.isInteger(child.pid)) {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  } else {
    try { child.kill('SIGTERM'); } catch {}
  }
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.beforeUnloadDialogsAccepted = 0;
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new D3Error('BROWSER_START_FAILED')), { once: true });
      this.socket.addEventListener('close', () => reject(new D3Error('BROWSER_START_FAILED')), { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.method === 'Page.javascriptDialogOpening') {
        if (message.params?.type === 'beforeunload') {
          this.send('Page.handleJavaScriptDialog', { accept: true })
            .then(() => { this.beforeUnloadDialogsAccepted += 1; })
            .catch(() => {});
        }
        return;
      }
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new D3Error('BROWSER_START_FAILED'));
      else pending.resolve(message.result);
    });
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new D3Error('BROWSER_START_FAILED'));
      this.pending.clear();
    });
  }

  async send(method, params = {}, timeoutMs = 15_000) {
    try {
      await this.ready;
    } catch {
      failureDiagnostic.cdpFailureMethod = method;
      throw new D3Error('BROWSER_START_FAILED');
    }
    const id = ++this.sequence;
    failureDiagnostic.cdpMethod = method;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        failureDiagnostic.cdpTimeoutMethod ??= method;
        reject(new D3Error('BROWSER_START_FAILED'));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          if (failureDiagnostic.cdpMethod === method) delete failureDiagnostic.cdpMethod;
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          if (failureDiagnostic.cdpMethod === method) delete failureDiagnostic.cdpMethod;
          reject(error);
        },
      });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch {
        this.pending.delete(id);
        clearTimeout(timeout);
        failureDiagnostic.cdpFailureMethod ??= method;
        reject(new D3Error('BROWSER_START_FAILED'));
      }
    });
  }

  close() {
    for (const pending of this.pending.values()) pending.reject(new D3Error('BROWSER_START_FAILED'));
    this.pending.clear();
    try { this.socket.close(); } catch {}
  }
}

let cdp = null;
let failureDiagnostic = { stage: 'preflight', selector: null, condition: null, timeoutMs: null };
const failureStageHistory = [];
let codexLaunch = { spawnAttempted: false, childHandleCreated: false, processStarted: null, processStartErrorCode: null };

function markFailureDiagnostic({ stage, selector = null, condition = null, timeoutMs = null }) {
  const safeStage = typeof stage === 'string' ? stage.slice(0, 80) : 'unknown';
  failureStageHistory.push(safeStage);
  if (failureStageHistory.length > 16) failureStageHistory.shift();
  failureDiagnostic = {
    stage: safeStage,
    selector: typeof selector === 'string' ? selector.slice(0, 160) : null,
    condition: typeof condition === 'string' ? condition.slice(0, 160) : null,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : null,
  };
  currentPhase = failureDiagnostic.stage;
}

async function evaluate(expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) {
    failureDiagnostic.runtimeException = {
      className: typeof result.exceptionDetails.exception?.className === 'string'
        ? result.exceptionDetails.exception.className.slice(0, 80)
        : null,
      text: typeof result.exceptionDetails.text === 'string' ? result.exceptionDetails.text.slice(0, 80) : null,
      lineNumber: Number.isInteger(result.exceptionDetails.lineNumber) ? result.exceptionDetails.lineNumber : null,
    };
    fail('BROWSER_JOURNEY_FAILED');
  }
  return result.result?.value;
}

async function connectBrowser(chromePort, baseUrl) {
  markFailureDiagnostic({ stage: 'browser.connect', condition: 'Chrome DevTools page is available and accepts Page/Runtime commands', timeoutMs: 20_000 });
  const chromeDebugUrl = `http://127.0.0.1:${chromePort}/json/list`;
  if (!await waitForHttp(`http://127.0.0.1:${chromePort}/json/version`)) fail('BROWSER_START_FAILED');
  const pages = await (await fetch(chromeDebugUrl)).json();
  const page = pages.find((item) => item.type === 'page');
  if (!page?.webSocketDebuggerUrl) fail('BROWSER_START_FAILED');
  cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: baseUrl });
}

async function navigateBrowserPage(url) {
  if (!cdp) fail('BROWSER_START_FAILED');
  await cdp.send('Page.navigate', { url });
}

async function waitForApp(timeoutMs = 20_000) {
  markFailureDiagnostic({
    stage: 'browser.wait-for-app',
    selector: 'nav button; window.__VOLK_ML_AGENT_APPLICATION__',
    condition: 'navigation control and mounted Agent Application API are present',
    timeoutMs,
  });
  const ready = await waitFor(() => evaluate('Boolean(document.querySelector("nav button")) && Boolean(window.__VOLK_ML_AGENT_APPLICATION__)'), timeoutMs);
  if (!ready) fail('BROWSER_START_FAILED');
}

async function inspectLearnerTarget(elementExpression, { allowHoverReveal = false } = {}) {
  const expression = '(() => {'
    + 'const element = ' + elementExpression + ';'
    + 'if (!element || !element.isConnected) return { actionable: false, reason: "missing" };'
    + 'const rect = element.getBoundingClientRect();'
    + 'const style = window.getComputedStyle(element);'
    + 'if (element.disabled === true) return { actionable: false, reason: "disabled" };'
    + 'if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.pointerEvents === "none" || rect.width <= 0 || rect.height <= 0) return { actionable: false, reason: "not-visible" };'
    + 'if (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) return { actionable: false, reason: "outside-viewport" };'
    + 'const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2;'
    + 'const hit = document.elementFromPoint(x, y);'
    + 'if (!hit || (hit !== element && !element.contains(hit))) return { actionable: false, reason: "obscured" };'
    + 'const visuallyOpaque = Number(style.opacity) > 0.05;'
    + 'if (!visuallyOpaque && ' + String(!allowHoverReveal) + ') return { actionable: false, reason: "not-visible" };'
    + 'return { actionable: true, reason: null, x, y, visuallyOpaque, hitTarget: true };'
    + '})()';
  return evaluate(expression);
}

async function clickLearnerTarget(elementExpression, errorCode, { expectBlocked = false } = {}) {
  markFailureDiagnostic({
    stage: expectBlocked ? 'browser.overlay-negative-control' : 'browser.trusted-learner-click',
    selector: 'visible learner control',
    condition: expectBlocked
      ? 'an overlay-obscured control is rejected before any pointer input is dispatched'
      : 'the control is in the viewport, visually visible, and elementFromPoint resolves to it before trusted pointer click',
    timeoutMs: 5_000,
  });
  const initial = await inspectLearnerTarget(elementExpression, { allowHoverReveal: true });
  const summarizeTargetCheck = (target) => ({
    actionable: target?.actionable === true,
    reason: typeof target?.reason === 'string' ? target.reason : 'missing',
    visuallyOpaque: target?.visuallyOpaque === true,
    hitTarget: target?.hitTarget === true,
    x: Number.isFinite(target?.x) ? Math.round(target.x) : null,
    y: Number.isFinite(target?.y) ? Math.round(target.y) : null,
  });
  if (expectBlocked) {
    if (initial.reason !== 'obscured') {
      failureDiagnostic.targetCheck = summarizeTargetCheck(initial);
      fail(errorCode);
    }
    return { clicked: false, reason: 'obscured', inputDispatched: false };
  }
  if (!initial.actionable) {
    failureDiagnostic.targetCheck = summarizeTargetCheck(initial);
    fail(errorCode);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: initial.x, y: initial.y });
  let lastTargetCheck = null;
  let target = await waitFor(async () => {
    const current = await inspectLearnerTarget(elementExpression);
    lastTargetCheck = summarizeTargetCheck(current);
    return current.actionable && current.visuallyOpaque && current.hitTarget ? current : null;
  }, 2_000, 75);
  if (!target) {
    failureDiagnostic.targetCheck = lastTargetCheck;
    fail(errorCode);
  }
  if (Math.abs(target.x - initial.x) > 1 || Math.abs(target.y - initial.y) > 1) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
    const stableTarget = await inspectLearnerTarget(elementExpression);
    if (!stableTarget.actionable || !stableTarget.visuallyOpaque || !stableTarget.hitTarget) {
      failureDiagnostic.targetCheck = summarizeTargetCheck(stableTarget);
      fail(errorCode);
    }
    target = stableTarget;
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount: 1 });
  return { clicked: true, hitTargetVerified: true, inputMethod: 'cdp-mouse' };
}

async function resolveRestorePrompt({ required = false } = {}) {
  let present = await evaluate('Boolean(' + RESTORE_DIALOG_EXPRESSION + ')');
  if (required && !present) {
    present = await waitFor(() => evaluate('Boolean(' + RESTORE_DIALOG_EXPRESSION + ')'), 10_000);
  }
  if (required && !present) fail('BROWSER_START_FAILED');
  if (!present) return { encountered: false, selectedStartFresh: false, occlusionNegativeControl: null };

  const blockedBuildControl = await clickLearnerTarget(BUILD_BUTTON_EXPRESSION, 'BROWSER_START_FAILED', { expectBlocked: true });
  const freshChoice = await clickLearnerTarget(RESTORE_START_FRESH_EXPRESSION, 'BROWSER_START_FAILED');
  const dismissed = await waitFor(() => evaluate('!Boolean(' + RESTORE_DIALOG_EXPRESSION + ')'), 10_000);
  if (!dismissed) fail('BROWSER_START_FAILED');
  return {
    encountered: true,
    selectedStartFresh: freshChoice.clicked,
    choiceInputMethod: freshChoice.inputMethod,
    occlusionNegativeControl: {
      target: 'Build navigation behind restore dialog',
      rejectedAs: blockedBuildControl.reason,
      inputDispatched: blockedBuildControl.inputDispatched,
    },
  };
}

async function waitForLocalProjectAutosave() {
  markFailureDiagnostic({
    stage: 'browser.wait-for-local-autosave',
    condition: 'allow the normal debounced local-project save to settle; the subsequent restore dialog verifies the saved record through the UI',
    timeoutMs: 4_000,
  });
  await sleep(3_000);
}

async function enterBuildWorkspace({ requireRestorePrompt = false } = {}) {
  markFailureDiagnostic({ stage: 'browser.enter-build', selector: 'Build navigation control', condition: 'normal Build navigation is selected, any local restore choice is made through its visible control, and the workspace Agent API is available', timeoutMs: 20_000 });
  await waitForApp();
  const buildActive = await evaluate('Boolean((' + BUILD_BUTTON_EXPRESSION + ')?.getAttribute("aria-pressed") === "true")');
  if (!buildActive) await clickLearnerTarget(BUILD_BUTTON_EXPRESSION, 'BROWSER_START_FAILED');
  const selected = await waitFor(() => evaluate('Boolean((' + BUILD_BUTTON_EXPRESSION + ')?.getAttribute("aria-pressed") === "true")'), 5_000);
  if (!selected) fail('BROWSER_START_FAILED');
  const restorePrompt = await resolveRestorePrompt({ required: requireRestorePrompt });
  const apiReady = await waitFor(() => evaluate('Boolean(window.__VOLK_ML_AGENT__?.listInstances?.().length)'), 20_000);
  if (!apiReady) fail('BROWSER_START_FAILED');
  return restorePrompt;
}

async function clearStarterGraphWithLearnerClicks() {
  markFailureDiagnostic({ stage: 'browser.clear-starter-graph', selector: '.react-flow__node button.bg-red-50', condition: 'each visible delete action and explicit confirmation reduces the graph to zero nodes and edges', timeoutMs: 5_000 });
  let current = await workspaceSnapshot();
  let clickCount = 0;
  while (current.nodeCount > 0 && clickCount < 256) {
    await clickLearnerTarget(FIRST_STARTER_DELETE_EXPRESSION, 'FRESH_WORKSPACE_REQUIRED');
    await waitForSelector('[role="dialog"][aria-labelledby="deletion-confirm-title"]', true, 5_000);
    await clickLearnerTarget(DELETE_CONFIRM_EXPRESSION, 'FRESH_WORKSPACE_REQUIRED');
    clickCount += 1;
    const next = await waitFor(async () => {
      const snapshot = await workspaceSnapshot();
      return snapshot.nodeCount < current.nodeCount ? snapshot : null;
    }, 5_000);
    if (!next) fail('FRESH_WORKSPACE_REQUIRED');
    current = next;
  }
  if (current.nodeCount !== 0 || current.edgeCount !== 0) fail('FRESH_WORKSPACE_REQUIRED');
  return {
    graph: current,
    removedStarterNodeCount: clickCount,
    actor: 'automated-learner',
    controls: ['viewport-visible Delete component buttons via CDP mouse', 'viewport-visible explicit Delete confirmation via CDP mouse'],
  };
}

let browserRequestCounter = 0;
async function applicationRequest(method) {
  const envelope = {
    apiVersion: 1,
    requestId: `d3-browser-${++browserRequestCounter}`,
    method,
    params: {},
  };
  const result = await evaluate(`window.__VOLK_ML_AGENT_APPLICATION__.request(${JSON.stringify(envelope)})`, true);
  if (!result?.ok) fail('BROWSER_JOURNEY_FAILED');
  return result.result;
}

function summarizeWorkspace(workspace) {
  const graph = workspace?.graph;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) fail('BROWSER_JOURNEY_FAILED');
  return {
    identity: {
      semanticFingerprint: graph.identity?.semanticFingerprint ?? null,
      presentationFingerprint: graph.identity?.presentationFingerprint ?? null,
    },
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      componentId: node.componentId,
      operation: node.operation,
      parameters: node.parameters,
    })),
  };
}

async function workspaceSnapshot() {
  const result = await applicationRequest('inspectWorkspace');
  if (result?.privacy?.datasetRowsIncluded !== false || result?.privacy?.datasetCellsIncluded !== false || result?.privacy?.viewStateIncluded !== false) {
    fail('BROWSER_JOURNEY_FAILED');
  }
  return summarizeWorkspace(result.workspace);
}

async function proposalSnapshot() {
  return applicationRequest('inspectProposal');
}

async function waitForSelector(selector, expected, timeoutMs = 90_000) {
  markFailureDiagnostic({
    stage: 'browser.wait-for-selector',
    selector,
    condition: expected ? 'selector is present' : 'selector is absent',
    timeoutMs,
  });
  const selectorText = JSON.stringify(selector);
  const predicate = expected
    ? `Boolean(document.querySelector(${selectorText}))`
    : `!document.querySelector(${selectorText})`;
  const ready = await waitFor(() => evaluate(predicate), timeoutMs);
  if (!ready) fail('BROWSER_JOURNEY_FAILED');
}

async function clickLearnerApply(selector) {
  const clicked = await clickLearnerTarget('document.querySelector(' + JSON.stringify(selector) + ')', selector.includes('patch') ? 'C2_APPLY_FAILED' : 'B1_APPLY_FAILED');
  if (!clicked.clicked) fail(selector.includes('patch') ? 'C2_APPLY_FAILED' : 'B1_APPLY_FAILED');
}

function identityEqual(left, right) {
  return left?.identity?.semanticFingerprint === right?.identity?.semanticFingerprint
    && left?.identity?.presentationFingerprint === right?.identity?.presentationFingerprint;
}

function firstHiddenDense(graph) {
  return graph.nodes.find((node) => node.operation === 'dense' && Number.isFinite(node.parameters?.units));
}

async function captureAcceptanceScreenshot(screenshots, name) {
  await assertRestorePromptAbsent('screenshot-' + name);
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (typeof result?.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(result.data)) fail('BROWSER_JOURNEY_FAILED');
  screenshots.push({ name, data: result.data });
}

async function assertRestorePromptAbsent(stage) {
  markFailureDiagnostic({
    stage: ('browser.' + stage).slice(0, 80),
    condition: 'the local-project restore overlay is absent so the recorded canvas is unobscured',
  });
  const unobscured = await evaluate('!Boolean(' + RESTORE_DIALOG_EXPRESSION + ')');
  if (!unobscured) fail('BROWSER_JOURNEY_FAILED');
  return true;
}

async function runBrowserLearnerJourney({ baseUrl, mcpPort, token, browser, screenshots }) {
  markFailureDiagnostic({ stage: 'browser.bridge-navigation', condition: 'bridge credentials are scrubbed from URL and app enters Build workspace', timeoutMs: 5_000 });
  const endpoint = `http://127.0.0.1:${mcpPort}/v1/bridge`;
  const target = new URL(baseUrl);
  target.searchParams.set('mcpBridge', endpoint);
  target.searchParams.set('mcpToken', token);
  await navigateBrowserPage(target.toString());
  const restorePromptHandling = await enterBuildWorkspace({ requireRestorePrompt: true });
  browser.restorePromptHandling = restorePromptHandling;
  const credentialsScrubbed = await waitFor(() => evaluate(`(() => {
    const params = new URLSearchParams(location.search);
    return !params.has('mcpBridge') && !params.has('mcpToken');
  })()`), 5_000);
  if (!credentialsScrubbed) {
    markFailureDiagnostic({ stage: 'browser.bridge-credential-scrub', selector: 'location.search parameters mcpBridge and mcpToken', condition: 'both credential parameters are absent', timeoutMs: 5_000 });
    fail('BROWSER_JOURNEY_FAILED');
  }
  browser.bridgeCredentialsScrubbed = true;
  browser.starterWorkspace = await clearStarterGraphWithLearnerClicks();
  const healthConnected = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${mcpPort}/health`, { signal: AbortSignal.timeout(1_000) });
      return response.ok && (await response.json()).workspaceConnected === true;
    } catch { return false; }
  }, 20_000);
  if (!healthConnected) fail('MCP_BROWSER_NOT_CONNECTED');

  const beforeB1 = await workspaceSnapshot();
  if (beforeB1.nodeCount !== 0 || beforeB1.edgeCount !== 0) fail('FRESH_WORKSPACE_REQUIRED');
  browser.before = beforeB1;
  await captureAcceptanceScreenshot(screenshots, 'before-b1');

  await waitForSelector('[data-graph-proposal-preview]', true);
  const duringB1 = await workspaceSnapshot();
  const b1Eligibility = await proposalSnapshot();
  const b1ApplyEnabled = await evaluate('Boolean(document.querySelector("[data-graph-proposal-apply]") && !document.querySelector("[data-graph-proposal-apply]").disabled)');
  if (!identityEqual(beforeB1, duringB1)) fail('B1_CHANGED_BEFORE_APPLY');
  if (b1Eligibility.current?.status !== 'staged' || b1Eligibility.current?.eligibility !== 'ready-for-human-apply' || !b1ApplyEnabled) fail('B1_PREVIEW_INVALID');
  await captureAcceptanceScreenshot(screenshots, 'b1-preview');
  browser.b1Preview = { visible: true, staged: true, readyForLearnerApply: true, graphUnchanged: true, learnerApplyButtonEnabled: true };
  await clickLearnerApply('[data-graph-proposal-apply]');
  await waitForSelector('[data-graph-proposal-preview]', false);
  const afterB1 = await waitFor(async () => {
    const current = await workspaceSnapshot();
    return current.nodeCount > 0 ? current : null;
  }, 20_000);
  if (!afterB1 || afterB1.nodeCount !== 5 || afterB1.edgeCount !== 4) fail('B1_APPLY_FAILED');
  const firstDense = firstHiddenDense(afterB1);
  if (!firstDense || firstDense.parameters.units !== 32) fail('B1_APPLY_FAILED');
  const b1Lifecycle = await proposalSnapshot();
  if (b1Lifecycle.current !== null || b1Lifecycle.history?.at(-1)?.status !== 'applied') fail('B1_APPLY_FAILED');
  browser.b1LearnerAction = { actor: 'automated-learner', control: 'data-graph-proposal-apply', clicked: true };
  browser.afterB1 = afterB1;
  browser.b1Lifecycle = { closedAfterApply: true, historyStatus: 'applied', firstDenseUnits: firstDense.parameters.units };
  await captureAcceptanceScreenshot(screenshots, 'after-b1');

  await waitForSelector('[data-graph-patch-preview]', true);
  const duringC2 = await workspaceSnapshot();
  const c2Eligibility = await proposalSnapshot();
  const c2ApplyEnabled = await evaluate('Boolean(document.querySelector("[data-graph-patch-apply]") && !document.querySelector("[data-graph-patch-apply]").disabled)');
  const expectedDense = firstHiddenDense(afterB1);
  const diff = await evaluate(`(() => {
    const item = [...document.querySelectorAll('[data-graph-patch-preview] [data-patch-item]')]
      .find((candidate) => candidate.dataset.patchItem === ${JSON.stringify(expectedDense.id)});
    return item ? item.innerText : '';
  })()`);
  if (!identityEqual(afterB1, duringC2)) fail('C2_CHANGED_BEFORE_APPLY');
  if (c2Eligibility.current?.status !== 'staged' || c2Eligibility.current?.eligibility !== 'ready-for-human-apply' || !c2ApplyEnabled) fail('C2_PREVIEW_INVALID');
  if (typeof diff !== 'string' || !diff.includes('units') || !diff.includes('32') || !diff.includes('128')) fail('C2_DIFF_INVALID');
  await captureAcceptanceScreenshot(screenshots, 'c2-preview');
  browser.c2Preview = {
    visible: true,
    staged: true,
    readyForLearnerApply: true,
    graphUnchanged: true,
    learnerApplyButtonEnabled: true,
    targetNodeId: expectedDense.id,
    parameterKey: 'units',
    before: 32,
    after: 128,
  };
  await clickLearnerApply('[data-graph-patch-apply]');
  await waitForSelector('[data-graph-patch-preview]', false);
  const afterC2 = await waitFor(async () => {
    const current = await workspaceSnapshot();
    const node = firstHiddenDense(current);
    return node?.parameters?.units === 128 ? current : null;
  }, 20_000);
  if (!afterC2 || identityEqual(afterB1, afterC2)) fail('C2_APPLY_FAILED');
  const finalDense = firstHiddenDense(afterC2);
  const c2Lifecycle = await proposalSnapshot();
  if (c2Lifecycle.current !== null || c2Lifecycle.history?.at(-1)?.status !== 'applied') fail('C2_APPLY_FAILED');
  browser.c2LearnerAction = { actor: 'automated-learner', control: 'data-graph-patch-apply', clicked: true };
  browser.afterC2 = afterC2;
  browser.c2Lifecycle = {
    closedAfterApply: true,
    historyStatus: 'applied',
    targetNodeId: finalDense.id,
    finalUnits: finalDense.parameters.units,
  };
  await captureAcceptanceScreenshot(screenshots, 'after-c2');
  browser.screenshotStages = screenshots.map((screenshot) => screenshot.name);
  browser.restorePromptAbsentAtScreenshots = [...browser.screenshotStages];
  return browser;
}

function assertRealAgentEvidence(agent) {
  if (agent.malformedJsonLines || !agent.completed || agent.failed) fail('AGENT_EVENT_STREAM_INVALID');
  for (const tool of ['volk_inspect_workspace', 'volk_list_capabilities', 'volk_list_components', 'volk_submit_graph_proposal', 'volk_submit_graph_patch_proposal']) {
    if (!agent.mcpToolNames.has(tool)) fail('AGENT_REQUIRED_TOOL_MISSING');
  }
  const flags = agent.commandFlags;
  if (!flags.inspectedD3Fixture || !flags.ranD3Exporter || !flags.usedTorchProposalHelper || !flags.usedPatchProposalHelper) fail('AGENT_REQUIRED_COMMAND_MISSING');
  if (!flags.usedPythonPath) fail('AGENT_REQUIRED_COMMAND_MISSING');
}

function sanitizedAgentReport(agent) {
  return {
    threadId: agent.threadId,
    eventCount: Math.min(agent.eventCount, MAX_CODEX_EVENTS),
    malformedJsonLines: agent.malformedJsonLines,
    completed: agent.completed,
    failed: agent.failed,
    processExitCode: agent.processExitCode,
    processSignal: agent.processSignal,
    processStarted: agent.processStarted,
    processStartErrorCode: agent.processStartErrorCode,
    stderrClassification: agent.stderrClassification,
    mcpToolNames: [...agent.mcpToolNames].sort(),
    commands: { ...agent.commandFlags },
    tokenUsage: agent.usage,
    eventProvenance: agent.eventSummaries,
  };
}

function findChrome() {
  const candidates = [
    process.env.VOLK_D3_CHROME_PATH,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
  ];
  return findExecutable(null, 'chrome.exe', candidates);
}

function artifactDirectory() {
  return path.join(REPOSITORY_ROOT, 'docs', 'acceptance', 'assets', 'agent-application-d3');
}

function safeMcpSummaries(agent) {
  return agent.eventSummaries.filter((event) => event.itemType?.startsWith('mcp_tool_call'));
}

function redactReport(report) {
  const serialized = JSON.stringify(report);
  if (serialized.includes('VOLK_MCP_SESSION_TOKEN') || /mcpToken=|private-row|secret-sentinel/i.test(serialized)) {
    fail('AGENT_EVENT_STREAM_INVALID');
  }
  return report;
}

let viteProcess = null;
let chromeProcess = null;
let codexRun = null;
let chromeProfile = null;
let scratchDirectory = null;
let scratchRoot = null;
let finishedCode = 0;
let report = null;
let currentPhase = 'preflight';
let safeInvocation = null;
let pythonPath = null;
let pythonVersion = null;
let torchVersion = null;
let configuredPythonSha256 = null;
let pythonAttestationNonce = null;
let pythonRuntimeEvidence = null;
const browserPreflightOnly = process.argv.includes('--browser-preflight-only');

try {
  const defaultPython = 'C:/Users/Administrator/AppData/Local/VOLK/venvs/torch-export-b2/Scripts/python.exe';
  let codexPath = null;
  let codexVersion = null;
  let existingMcpServerNames = [];
  if (!browserPreflightOnly) {
    currentPhase = 'python-preflight';
    pythonPath = process.env.VOLK_D3_PYTHON ?? defaultPython;
    const pythonRuntime = validatePython(pythonPath);
    pythonPath = pythonRuntime.pythonExecutable;
    pythonVersion = pythonRuntime.pythonVersion;
    torchVersion = pythonRuntime.torchVersion;
    configuredPythonSha256 = createHash('sha256').update(fs.readFileSync(pythonPath)).digest('hex');
    pythonAttestationNonce = randomBytes(32).toString('hex');
    currentPhase = 'codex-preflight';
    codexPath = findExecutable(process.env.VOLK_D3_CODEX_PATH, 'codex.exe');
    codexVersion = validateCodex(codexPath);
    existingMcpServerNames = listConfiguredMcpServerNames(codexPath, REPOSITORY_ROOT);
    if (!existingMcpServerNames) fail('CODEX_MCP_CONFIG_UNAVAILABLE');
  }
  currentPhase = 'browser-preflight';
  const chromePath = findChrome();
  if (!chromePath) fail('CHROME_NOT_FOUND');

  currentPhase = 'scratch-setup';
  const preferredTempRoot = process.env.VOLK_D3_TEMP_ROOT
    ?? (process.platform === 'win32' ? 'D:\\VOLK-ML-agent-application-d3-temp' : path.join(os.tmpdir(), 'volk-ml-agent-application-d3-temp'));
  scratchRoot = path.resolve(preferredTempRoot);
  fs.mkdirSync(scratchRoot, { recursive: true });
  scratchDirectory = fs.mkdtempSync(path.join(scratchRoot, 'run-'));
  chromeProfile = fs.mkdtempSync(path.join(scratchRoot, 'chrome-profile-'));

  currentPhase = 'port-reservation';
  const [vitePort, chromePort, mcpPort] = await Promise.all([reserveLocalPort(), reserveLocalPort(), reserveLocalPort()]);
  currentPhase = 'runtime-env';
  const baseUrl = `http://127.0.0.1:${vitePort}/`;
  const token = randomBytes(36).toString('base64url');
  const runtimeEnv = { ...process.env, TEMP: scratchDirectory, TMP: scratchDirectory, PYTHONDONTWRITEBYTECODE: '1' };
  delete runtimeEnv.VITE_VOLK_API_URL;
  delete runtimeEnv.VITE_VOLK_CLOUD_URL;
  delete runtimeEnv.OPENAI_API_KEY;
  delete runtimeEnv.CODEX_API_KEY;

  currentPhase = 'vite-launch';
  viteProcess = spawn(process.execPath, [
    path.join(REPOSITORY_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort',
  ], { cwd: REPOSITORY_ROOT, env: runtimeEnv, windowsHide: true, stdio: 'ignore' });
  currentPhase = 'vite-health';
  if (!await waitForHttp(baseUrl)) fail('VITE_START_FAILED');

  currentPhase = 'browser-start';
  chromeProcess = spawn(chromePath, [
    '--headless=new', '--disable-gpu', `--remote-debugging-port=${chromePort}`,
    '--window-size=1360,950', `--user-data-dir=${chromeProfile}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  await connectBrowser(chromePort, baseUrl);
  await enterBuildWorkspace();
  await waitForLocalProjectAutosave();

  if (browserPreflightOnly) {
    currentPhase = 'browser-starter-preflight';
    markFailureDiagnostic({
      stage: 'browser.restore-reload',
      condition: 'navigate to a fresh same-origin document so the saved local project is offered through the normal restore prompt',
      timeoutMs: 15_000,
    });
    const restoreUrl = new URL(baseUrl);
    restoreUrl.searchParams.set('d3RestorePreflight', '1');
    await navigateBrowserPage(restoreUrl.toString());
    const restorePromptHandling = await enterBuildWorkspace({ requireRestorePrompt: true });
    const starter = await clearStarterGraphWithLearnerClicks();
    const finalWorkspace = await workspaceSnapshot();
    if (finalWorkspace.nodeCount !== 0 || finalWorkspace.edgeCount !== 0) fail('FRESH_WORKSPACE_REQUIRED');
    await assertRestorePromptAbsent('browser-preflight-final');
    const browserScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (typeof browserScreenshot?.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(browserScreenshot.data)) fail('BROWSER_JOURNEY_FAILED');
    const preflightArtifactDirectory = artifactDirectory();
    fs.mkdirSync(preflightArtifactDirectory, { recursive: true });
    const preflightScreenshot = `browser-preflight-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    fs.writeFileSync(path.join(preflightArtifactDirectory, preflightScreenshot), Buffer.from(browserScreenshot.data, 'base64'));
    process.stdout.write(`${JSON.stringify({
      status: 'PREFLIGHT PASS',
      mode: 'browser-only; no Codex Agent invocation',
      starterGraphCleared: starter.removedStarterNodeCount,
      restorePromptHandling,
      restorePromptOcclusionNegativeControl: restorePromptHandling.occlusionNegativeControl,
      browserBeforeUnloadConfirmationsAccepted: cdp.beforeUnloadDialogsAccepted,
      visibleControls: ['Delete component', 'explicit Delete confirmation'],
      emptyWorkspace: { nodeCount: finalWorkspace.nodeCount, edgeCount: finalWorkspace.edgeCount },
      screenshotCapture: 'supported',
      screenshot: path.relative(REPOSITORY_ROOT, path.join(preflightArtifactDirectory, preflightScreenshot)),
      graphMutationApiUsed: false,
      logsPersisted: false,
    })}\n`);
  } else {
  markFailureDiagnostic({ stage: 'codex-config-preflight', condition: 'effective invocation enables only the bounded D3 MCP server; doctor mcp.config is ok', timeoutMs: 30_000 });
  const prompt = buildD3AgentPrompt({ repositoryRoot: REPOSITORY_ROOT, scratchDirectory, pythonPath, mcpPort });
  const args = buildD3CodexArguments({
    codexPath,
    repositoryRoot: REPOSITORY_ROOT,
    mcpServerScript: MCP_SERVER_SCRIPT,
    scratchDirectory,
    prompt,
    existingMcpServerNames,
  });
  const effectiveConfig = spawnSync(codexPath, ['mcp', 'list', '--json', '-c', args[args.indexOf('-c') + 1]], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    timeout: 15_000,
  });
  if (effectiveConfig.error || effectiveConfig.status !== 0
    || !validateEffectiveD3McpConfigOutput(effectiveConfig.stdout, existingMcpServerNames)) fail('CODEX_MCP_CONFIG_UNAVAILABLE');
  if (!validateCodexMcpStartup(codexPath, args[args.indexOf('-c') + 1], REPOSITORY_ROOT)) fail('CODEX_MCP_CONFIG_UNAVAILABLE');
  safeInvocation = {
    command: 'codex --ask-for-approval never exec',
    jsonEvents: true,
    ephemeral: true,
    sandbox: 'workspace-write',
    workingDirectory: 'per-run scratch only',
    repositoryWritableRootAdded: false,
    approvalPolicy: 'never',
    modelOverride: false,
    isolatedMcpServer: 'volk_ml_d3',
    mcpStartupPreflight: 'codex doctor JSON mcp.config check; no model call',
    enabledToolNames: [...D3_ALLOWED_MCP_TOOLS],
    disabledInheritedMcpServerCount: existingMcpServerNames.filter((name) => name !== 'volk_ml_d3').length,
  };
  markFailureDiagnostic({ stage: 'codex-child-environment', condition: 'create isolated child environment and pin configured Python Scripts directory first on PATH' });
  const agentEnv = {
    ...runtimeEnv,
    VOLK_MCP_PORT: String(mcpPort),
    VOLK_MCP_SESSION_TOKEN: token,
    VOLK_D3_PYTHON: pythonPath,
    VOLK_D3_PYTHON_SHA256: configuredPythonSha256,
    VOLK_D3_ATTESTATION_NONCE: pythonAttestationNonce,
  };
  const inheritedAgentPath = agentEnv.PATH ?? agentEnv.Path ?? '';
  delete agentEnv.Path;
  agentEnv.PATH = [path.dirname(pythonPath), inheritedAgentPath].filter(Boolean).join(path.delimiter);
  markFailureDiagnostic({ stage: 'codex-child-create', condition: 'spawn one bounded Codex child and attach sanitized JSONL/stderr readers', timeoutMs: MAX_CODEX_RUN_MS });
  let invocation;
  try {
    invocation = createCodexRun({
      codexPath,
      args,
      env: agentEnv,
      cwd: REPOSITORY_ROOT,
      launchState: codexLaunch,
      stopProcessTreeImpl: stopProcessTree,
      maxRunMs: MAX_CODEX_RUN_MS,
      maxEvents: MAX_CODEX_EVENTS,
    });
  } catch (error) {
    failureDiagnostic.error = summarizeD3RunnerError(error);
    fail('CODEX_PROCESS_SETUP_FAILED');
  }
  codexRun = invocation;
  markFailureDiagnostic({ stage: 'browser.initial-snapshot', condition: 'mounted workspace viewport can be read without exporting page contents' });
  const browserEvidence = {
    viewport: await evaluate('({ width: innerWidth, height: innerHeight })'),
    beforeUnloadConfirmationsAccepted: cdp.beforeUnloadDialogsAccepted,
    before: null,
  };
  const screenshots = [];
  const mcpHealth = await waitForMcpHealth(mcpPort);
  if (!mcpHealth) fail('MCP_SERVER_NOT_READY');
  markFailureDiagnostic({ stage: 'browser.journey', condition: 'live MCP workspace is connected before starting the learner-facing browser journey' });
  const browserJourney = runBrowserLearnerJourney({ baseUrl, mcpPort, token, browser: browserEvidence, screenshots });
  currentPhase = 'agent-and-browser-acceptance';
  const [cliResult, journeyResult] = await Promise.all([invocation.completion, browserJourney]);
  if (cliResult.exitCode !== 0) {
    if (invocation.summary.stderrClassification === 'quota') fail('CODEX_QUOTA_UNAVAILABLE');
    if (invocation.summary.stderrClassification === 'auth') fail('CODEX_AUTH_UNAVAILABLE');
    fail(cliResult.exitCode === -1 ? 'CODEX_RUN_TIMEOUT' : 'CODEX_RUN_FAILED');
  }
  markFailureDiagnostic({
    stage: 'agent.evidence-validation',
    condition: 'successful D3 exporter command and bounded runtime attestation match configured Python executable, nonce, Python version, and PyTorch version',
  });
  const exporterCommandCompleted = invocation.summary.eventSummaries.some((event) => (
    event.ranD3Exporter === true && event.status === 'completed' && event.exitCode === 0
  ));
  let attestationValidation = null;
  if (exporterCommandCompleted) {
    const attestationPath = path.join(scratchDirectory, 'torch-export-document.json.runtime.json');
    try {
      const attestationStat = fs.statSync(attestationPath);
      if (attestationStat.isFile() && attestationStat.size > 0 && attestationStat.size <= 4_096) {
        const attestation = JSON.parse(fs.readFileSync(attestationPath, 'utf8'));
        attestationValidation = validateD3PythonRuntimeAttestation({
          attestation,
          expectedNonce: pythonAttestationNonce,
          configuredPythonPath: pythonPath,
          configuredPythonSha256,
          expectedPythonVersion: pythonVersion,
          expectedTorchVersion: torchVersion,
        });
      } else {
        attestationValidation = { valid: false, reason: 'attestation-size-invalid' };
      }
    } catch {
      attestationValidation = { valid: false, reason: 'attestation-unavailable-or-malformed' };
    }
  } else {
    attestationValidation = { valid: false, reason: 'exporter-command-not-completed' };
  }
  if (attestationValidation?.valid) {
    pythonRuntimeEvidence = {
      status: 'verified',
      pythonVersion: attestationValidation.pythonVersion,
      torchVersion: attestationValidation.torchVersion,
      pythonExecutableSha256: attestationValidation.pythonExecutableSha256,
    };
    invocation.summary.commandFlags.usedPythonPath = true;
  } else {
    pythonRuntimeEvidence = {
      status: 'invalid',
      reason: attestationValidation?.reason ?? 'attestation-invalid',
    };
    failureDiagnostic.pythonRuntimeEvidence = pythonRuntimeEvidence;
    fail('AGENT_REQUIRED_COMMAND_MISSING');
  }
  assertRealAgentEvidence(invocation.summary);
  const toolNames = invocation.summary.mcpToolNames;
  if ([...toolNames].some((tool) => !D3_ALLOWED_MCP_TOOLS.includes(tool))) fail('AGENT_REQUIRED_TOOL_MISSING');

  const wholeProposalCall = invocation.summary.eventSummaries.find((event) => event.proposal?.kind === 'whole-graph');
  const patchProposalCall = invocation.summary.eventSummaries.find((event) => event.proposal?.kind === 'graph-patch');
  if (!wholeProposalCall || !patchProposalCall) fail('AGENT_EVENT_STREAM_INVALID');
  if (patchProposalCall.proposal.operation !== 'UPDATE_PARAMETERS'
    || patchProposalCall.proposal.changedParameterKeys.length !== 1
    || patchProposalCall.proposal.changedParameterKeys[0] !== 'units'
    || patchProposalCall.proposal.hiddenUnitsChangedTo128 !== true
    || patchProposalCall.proposal.targetNodeId !== journeyResult.c2Preview.targetNodeId) fail('AGENT_EVENT_STREAM_INVALID');

  const date = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDirectory = artifactDirectory();
  fs.mkdirSync(outputDirectory, { recursive: true });
  const screenshotFiles = screenshots.map(({ name, data }) => {
    const filename = `${date}-${name}.png`;
    fs.writeFileSync(path.join(outputDirectory, filename), Buffer.from(data, 'base64'));
    return path.relative(REPOSITORY_ROOT, path.join(outputDirectory, filename));
  });
  journeyResult.screenshots = screenshotFiles;
  report = redactReport({
    schema: 'VOLK-ML-AgentApplicationD3AcceptanceV1',
    status: 'PASS',
    date: new Date().toISOString(),
    source: { branch: repositoryCommand(['branch', '--show-current']), baseCommit: repositoryCommand(['rev-parse', 'HEAD']) },
    toolchain: {
      codexCli: codexVersion,
      configuredModelOverride: false,
      pythonVersion,
      torchVersion,
      pythonRuntimeEvidence,
      browser: await evaluate('navigator.userAgent'),
      mcpTransport: 'existing D2 official stdio + loopback browser bridge',
    },
    agent: sanitizedAgentReport(invocation.summary),
    browser: journeyResult,
    privacy: {
      rawDatasetRowsStored: false,
      exportDocumentStored: false,
      fullProposalPayloadStored: false,
      rawAgentTextStored: false,
      commandsStored: false,
      sessionTokenStored: false,
    },
  });
  const outputPath = path.join(outputDirectory, `${date}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ status: 'PASS', artifact: path.relative(REPOSITORY_ROOT, outputPath), agentTools: report.agent.mcpToolNames, browserAcceptances: 2, tokenUsage: report.agent.tokenUsage })}\n`);
  }
} catch (error) {
  const rawCode = error instanceof D3Error ? error.code : 'BROWSER_JOURNEY_FAILED';
  const code = SAFE_ERROR_CODES.has(rawCode) ? rawCode : 'BROWSER_JOURNEY_FAILED';
  if (error instanceof D3Error) failureDiagnostic.error ??= { name: 'D3Error', code };
  else failureDiagnostic.error = summarizeD3RunnerError(error);
  finishedCode = 1;
  const activeCodexChild = codexRun?.child ?? codexLaunch.child;
  if (activeCodexChild && activeCodexChild.exitCode === null && !activeCodexChild.killed) {
    stopProcessTree(activeCodexChild);
    if (codexRun) await Promise.race([codexRun.completion, sleep(2_000)]);
  }
  const agentSummary = codexRun ? sanitizedAgentReport(codexRun.summary) : null;
  let browserSnapshot = null;
  let failureScreenshot = null;
  if (cdp) {
    try {
      browserSnapshot = await evaluate(`(() => {
        const url = new URL(location.href);
        const params = url.searchParams;
        return {
          origin: url.origin,
          pathname: url.pathname,
          readyState: document.readyState,
          mcpBridgeParameterPresent: params.has('mcpBridge'),
          mcpTokenParameterPresent: params.has('mcpToken'),
          applicationApiMounted: Boolean(window.__VOLK_ML_AGENT_APPLICATION__),
          workspaceAgentMounted: Boolean(window.__VOLK_ML_AGENT__),
        };
      })()`);
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      if (typeof screenshot?.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(screenshot.data)) {
        const outputDirectory = artifactDirectory();
        fs.mkdirSync(outputDirectory, { recursive: true });
        const filename = `failure-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        const outputPath = path.join(outputDirectory, filename);
        fs.writeFileSync(outputPath, Buffer.from(screenshot.data, 'base64'));
        failureScreenshot = path.relative(REPOSITORY_ROOT, outputPath);
      }
    } catch {
      browserSnapshot = { capture: 'unavailable' };
    }
  }
  const diagnostic = {
    schema: 'VOLK-ML-AgentApplicationD3FailureV1',
    status: 'NOT VERIFIED',
    date: new Date().toISOString(),
    source: { branch: repositoryCommand(['branch', '--show-current']), baseCommit: repositoryCommand(['rev-parse', 'HEAD']) },
    reason: code,
    phase: failureDiagnostic,
    stageHistory: [...failureStageHistory],
    codexInvocation: safeInvocation,
    codexLaunch: {
      spawnAttempted: codexLaunch.spawnAttempted,
      childHandleCreated: codexLaunch.childHandleCreated,
      processStarted: codexLaunch.processStarted,
      processStartErrorCode: codexLaunch.processStartErrorCode,
      handleRegistered: Boolean(codexRun),
      threadStarted: Boolean(codexRun?.summary.threadId),
      eventCount: codexRun ? Math.min(codexRun.summary.eventCount, MAX_CODEX_EVENTS) : null,
      tokenUsage: codexRun?.summary.usage ?? null,
    },
    agent: agentSummary,
    browser: browserSnapshot,
    screenshot: failureScreenshot,
    logsPersisted: false,
  };
  const outputDirectory = artifactDirectory();
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `failure-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ...diagnostic, artifact: path.relative(REPOSITORY_ROOT, outputPath) })}\n`);
} finally {
  if (cdp) cdp.close();
  stopProcessTree(chromeProcess);
  stopProcessTree(viteProcess);
  stopProcessTree(codexRun?.child ?? codexLaunch.child);
  if (chromeProfile && scratchRoot) {
    const root = path.resolve(scratchRoot) + path.sep;
    const target = path.resolve(chromeProfile);
    if (target.startsWith(root) && path.basename(target).startsWith('chrome-profile-') && fs.existsSync(target)) {
      try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
    }
  }
  if (scratchDirectory && scratchRoot) {
    const root = path.resolve(scratchRoot) + path.sep;
    const target = path.resolve(scratchDirectory);
    if (target.startsWith(root) && path.basename(target).startsWith('run-') && fs.existsSync(target)) {
      try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
    }
  }
  if (finishedCode) process.exitCode = finishedCode;
}
