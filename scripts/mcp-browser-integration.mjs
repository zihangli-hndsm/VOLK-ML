import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createGraphPatchProposal } from '../src/core/graph/graphPatchProposal.js';
import { graphPatchBaseFromProject } from '../src/core/graph/workspacePatchApply.js';
import { MCP_TOOL_NAMES } from '../src/core/mcpTransport.js';

const root = process.cwd();
const tempRoot = 'D:\\VOLK-ML-agent-application-d2-temp';
fs.mkdirSync(tempRoot, { recursive: true });
const chromeProfile = fs.mkdtempSync(path.join(tempRoot, 'chrome-'));
const baseUrl = 'http://127.0.0.1:5182';
const chromeDebugUrl = 'http://127.0.0.1:9232/json/list';
const serverPath = path.join(root, 'scripts', 'volk-mcp-server.mjs');
const token = randomBytes(32).toString('base64url');
const scenarios = [];
const browserErrors = [];
let viteProcess = null;
let chromeProcess = null;
let cdp = null;
let client = null;
let transport = null;

function stopProcess(child) {
  if (child && child.exitCode === null) {
    try { child.kill(); } catch {}
  }
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? 'Runtime exception');
        if (message.method === 'Log.entryAdded' && message.params.entry?.level === 'error' && !/Failed to load resource/.test(message.params.entry.text ?? '')) browserErrors.push(message.params.entry.text);
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
          const text = (message.params.args ?? []).map((item) => item.value ?? item.description).join(' ');
          if (!/Failed to load resource/.test(text)) browserErrors.push(text);
        }
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.sequence;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close() { this.socket.close(); }
}

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function evaluate(expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.result?.description ?? result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Browser evaluation failed.');
  return result.result?.value;
}

async function waitFor(predicate, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(predicate)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const details = await evaluate('({ url: location.href, text: document.body?.innerText?.slice(0, 1200), application: Boolean(window.__VOLK_ML_AGENT_APPLICATION__), canvas: Boolean(window.__VOLK_ML_AGENT__) })');
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify({ details, browserErrors })}`);
}

async function clickSelector(selector) {
  const clicked = await evaluate(`(() => { const item = document.querySelector(${JSON.stringify(selector)}); if (!item || item.disabled) return false; item.click(); return true; })()`);
  if (!clicked) throw new Error(`Could not click enabled control ${selector}`);
  await new Promise((resolve) => setTimeout(resolve, 180));
}

async function canvasAgent(method, ...args) {
  return evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => api.${method}(...${JSON.stringify(args)}))`, true);
}

async function currentProject() { return canvasAgent('getProject'); }

function comparableProject(project) {
  const detached = structuredClone(project);
  delete detached.savedAt;
  return JSON.stringify(detached);
}

function mcpEnvelope(result) {
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  return text ? JSON.parse(text) : null;
}

async function callTool(name, args = {}, options = {}) {
  const result = await client.callTool({ name, arguments: args }, options);
  const envelope = mcpEnvelope(result);
  if (!envelope) throw new Error(`MCP tool ${name} returned no structured envelope: ${JSON.stringify(result)}`);
  return { result, envelope };
}

async function record(id, evidence) { scenarios.push({ id, outcome: 'PASS', evidence }); }

function waitForServerReady(stderr) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('VOLK_MCP_READY ')) {
          try { resolve(JSON.parse(line.slice('VOLK_MCP_READY '.length))); } catch (error) { reject(error); }
          return;
        }
        if (line.startsWith('VOLK_MCP_START_FAILED')) reject(new Error(line));
      }
    };
    stderr.on('data', onData);
    stderr.on('error', reject);
  });
}

async function startServices() {
  const env = { ...process.env, TEMP: tempRoot, TMP: tempRoot };
  delete env.VITE_VOLK_API_URL;
  delete env.VITE_VOLK_CLOUD_URL;
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5182', '--strictPort'], {
    cwd: root, env, stdio: 'ignore',
  });
  await waitForHttp(`${baseUrl}/`);
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: root,
    env: { ...env, VOLK_MCP_PORT: '0', VOLK_MCP_SESSION_TOKEN: token },
    stderr: 'pipe',
    maxBufferSize: 2_000_000,
  });
  const readyPromise = waitForServerReady(transport.stderr);
  client = new Client({ name: 'volk-ml-d2-browser-test', version: '1.0.0' });
  const connectPromise = client.connect(transport);
  const ready = await readyPromise;
  await connectPromise;
  chromeProcess = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=9232', '--window-size=1440,1000',
    `--user-data-dir=${chromeProfile}`, 'about:blank',
  ], { stdio: 'ignore' });
  await waitForHttp(chromeDebugUrl);
  const pages = await (await fetch(chromeDebugUrl)).json();
  const page = pages.find((item) => item.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('Chrome DevTools page was unavailable.');
  cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  const bridgeUrl = `http://127.0.0.1:${ready.port}/v1/bridge`;
  await cdp.send('Page.navigate', { url: `${baseUrl}/?graphApplyTest=1&mcpBridge=${encodeURIComponent(bridgeUrl)}&mcpToken=${encodeURIComponent(token)}` });
  await waitFor('Boolean(window.__VOLK_ML_AGENT_APPLICATION__) && Boolean(document.querySelector("nav button"))', 'mounted D1 application bridge');
  await waitFor('!new URLSearchParams(location.search).has("mcpBridge") && !new URLSearchParams(location.search).has("mcpToken")', 'one-time MCP URL credentials are scrubbed');
  const connectedDeadline = Date.now() + 15000;
  while (Date.now() < connectedDeadline) {
    const health = await (await fetch(`http://127.0.0.1:${ready.port}/health`)).json();
    if (health.workspaceConnected) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const enteredBuild = await evaluate(`(() => { const button = [...document.querySelectorAll('nav button')].find((item) => /build/i.test(item.innerText)); if (!button) return false; button.click(); return true; })()`);
  if (!enteredBuild) throw new Error('Could not enter Build workspace.');
  await waitFor('Boolean(window.__VOLK_ML_AGENT__?.listInstances?.().length && Boolean(window.__VOLK_ML_GRAPH_APPLY_TEST__))', 'mounted canonical workspace');
  return ready;
}

async function waitForRuntimeSuccess(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await canvasAgent('getState');
    if (state.execution?.runtime?.status === 'succeeded') return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Browser runtime did not reach succeeded status.');
}

const report = { task: 'VOLK-ML D2 MCP mounted workspace acceptance', protocol: null, browser: null, scenarios };

try {
  const ready = await startServices();
  report.protocol = { apiVersion: ready.apiVersion, port: ready.port, transport: 'stdio + loopback browser bridge' };
  report.browser = { userAgent: await evaluate('navigator.userAgent'), viewport: await evaluate('({ width: innerWidth, height: innerHeight })') };

  const listed = await client.listTools();
  const expectedTools = Object.values(MCP_TOOL_NAMES).sort();
  assert.deepEqual((listed.tools ?? []).map((tool) => tool.name).sort(), expectedTools);
  await record('initialize-list-tools', { protocol: 'MCP', toolCount: listed.tools.length, tools: expectedTools });

  const initialInspection = await callTool(MCP_TOOL_NAMES.inspectWorkspace);
  assert.equal(initialInspection.envelope.ok, true);
  const initialSerialized = JSON.stringify(initialInspection.envelope);
  assert.equal(/"rows"\s*:/.test(initialSerialized), false);
  assert.equal(initialSerialized.includes('selectedNodeId'), false);
  assert.equal(initialSerialized.includes('viewMode'), false);
  await record('inspect-workspace-row-free', { noRows: true, noViewState: true });

  const fixture = await evaluate('window.__VOLK_ML_GRAPH_APPLY_TEST__.createBuildAgentFixture()', true);
  const patchFixture = await evaluate('window.__VOLK_ML_GRAPH_APPLY_TEST__.createOccupiedPatchFixture()', true);
  const beforePatch = await currentProject();
  const stagedPatch = await callTool(MCP_TOOL_NAMES.submitGraphPatchProposal, { proposal: patchFixture.proposal });
  assert.equal(stagedPatch.envelope.ok, true);
  await waitFor("Boolean(document.querySelector('[data-graph-patch-preview]'))", 'patch preview');
  assert.equal(comparableProject(beforePatch), comparableProject(await currentProject()));
  await clickSelector('[data-graph-patch-apply]');
  await waitFor("!document.querySelector('[data-graph-patch-preview]')", 'patch Apply');
  assert.notEqual(comparableProject(beforePatch), comparableProject(await currentProject()));
  await record('patch-preview-explicit-apply', { previewOnly: true, committedAfterLearnerClick: true });

  const staleBaseProject = await currentProject();
  const staleBaseNode = staleBaseProject.graph.nodes[0];
  const stalePatch = createGraphPatchProposal({
    baseGraph: graphPatchBaseFromProject(staleBaseProject),
    operations: [{ op: 'MOVE_NODE', nodeId: staleBaseNode.id, position: { x: staleBaseNode.position.x + 18, y: staleBaseNode.position.y + 18 } }],
    source: { producer: 'external-agent', provenance: { artifactId: 'd2-stale-base', revision: '1', location: 'inline' } },
    rationale: 'D2 stale-base rejection check.',
  });
  if (!stalePatch.ok) throw new Error(`Could not create stale patch: ${JSON.stringify(stalePatch.diagnostics)}`);
  await callTool(MCP_TOOL_NAMES.submitGraphPatchProposal, { proposal: stalePatch.proposal });
  await waitFor("Boolean(document.querySelector('[data-graph-patch-preview]'))", 'stale patch preview');
  await canvasAgent('updateNode', staleBaseNode.id, { position: { x: staleBaseNode.position.x + 36, y: staleBaseNode.position.y + 36 } });
  const staleInspection = await callTool(MCP_TOOL_NAMES.inspectProposal);
  assert.equal(staleInspection.envelope.ok, true);
  assert.equal(staleInspection.envelope.result.current.status, 'stale');
  await clickSelector('[data-graph-patch-cancel]');
  await record('stale-base-rejection', { status: staleInspection.envelope.result.current.status, diagnosticCodes: staleInspection.envelope.result.current.diagnosticCodes });

  await canvasAgent('setDataset', fixture.dataset);
  await canvasAgent('run');
  await waitForRuntimeSuccess();
  const resultsBeforeLayout = await callTool(MCP_TOOL_NAMES.inspectResults);
  assert.equal(resultsBeforeLayout.envelope.ok, true);
  assert.equal(resultsBeforeLayout.envelope.result.current, true);
  const layoutProject = await currentProject();
  const layoutNode = layoutProject.graph.nodes[0];
  const layoutProposal = createGraphPatchProposal({
    baseGraph: graphPatchBaseFromProject(layoutProject),
    operations: [{ op: 'MOVE_NODE', nodeId: layoutNode.id, position: { x: layoutNode.position.x + 24, y: layoutNode.position.y + 12 } }],
    source: { producer: 'external-agent', provenance: { artifactId: 'd2-layout', revision: '1', location: 'inline' } },
    rationale: 'D2 layout-only result freshness check.',
  });
  assert.equal(layoutProposal.ok, true);
  await callTool(MCP_TOOL_NAMES.submitGraphPatchProposal, { proposal: layoutProposal.proposal });
  await waitFor("Boolean(document.querySelector('[data-graph-patch-preview]'))", 'layout-only preview');
  await clickSelector('[data-graph-patch-apply]');
  await waitFor("!document.querySelector('[data-graph-patch-preview]')", 'layout-only Apply');
  const resultsAfterLayout = await callTool(MCP_TOOL_NAMES.inspectResults);
  assert.equal(resultsAfterLayout.envelope.result.current, true);
  assert.deepEqual(resultsAfterLayout.envelope.result.result, resultsBeforeLayout.envelope.result.result);
  await record('results-freshness-layout-only', { current: true, sameResult: true });

  const exportResult = await callTool(MCP_TOOL_NAMES.exportGraph, { framework: 'pytorch' });
  assert.equal(exportResult.envelope.ok, true);
  assert.equal(exportResult.envelope.result.executed, false);
  assert.equal(exportResult.envelope.result.downloaded, false);
  assert.match(exportResult.envelope.result.code, /Generated by VOLK-ML IR/);
  await record('safe-pytorch-export', { executed: false, downloaded: false, sourceOnly: true });

  const projectBeforeMalformed = await currentProject();
  const malformed = await callTool(MCP_TOOL_NAMES.submitGraphProposal, { proposal: { injectedMutation: true } });
  assert.equal(malformed.envelope.ok, false);
  const oversized = await callTool(MCP_TOOL_NAMES.submitGraphProposal, { proposal: { text: 'x'.repeat(1_100_001) } });
  assert.equal(oversized.envelope.ok, false);
  assert.equal(comparableProject(projectBeforeMalformed), comparableProject(await currentProject()));
  await record('malformed-oversized-containment', { malformed: malformed.envelope.error.code, oversized: oversized.envelope.error.code, graphUnchanged: true });

  const runBefore = await canvasAgent('getState');
  const runRequest = await callTool(MCP_TOOL_NAMES.run);
  const runAfter = await canvasAgent('getState');
  assert.equal(runRequest.envelope.ok, false);
  assert.equal(runRequest.envelope.error.code, 'USER_CONFIRMATION_REQUIRED');
  assert.equal(runAfter.execution.runtime.status, runBefore.execution.runtime.status);
  await record('run-confirmation-gate', { error: runRequest.envelope.error.code, runtimeUnchanged: true });

  const semanticProject = await currentProject();
  const semanticNode = semanticProject.graph.nodes.find((node) => node.data.manifest.properties?.some((property) => ['number', 'slider'].includes(property.type)));
  const semanticProperty = semanticNode?.data.manifest.properties.find((property) => ['number', 'slider'].includes(property.type));
  assert.ok(semanticNode && semanticProperty);
  let semanticValue = (semanticNode.data.parameters[semanticProperty.key] ?? semanticProperty.default) + (semanticProperty.step ?? 1);
  if (Number.isFinite(semanticProperty.max) && semanticValue > semanticProperty.max) semanticValue -= semanticProperty.step ?? 1;
  const semanticProposal = createGraphPatchProposal({
    baseGraph: graphPatchBaseFromProject(semanticProject),
    operations: [{ op: 'UPDATE_PARAMETERS', nodeId: semanticNode.id, parameters: { ...semanticNode.data.parameters, [semanticProperty.key]: semanticValue } }],
    source: { producer: 'external-agent', provenance: { artifactId: 'd2-semantic', revision: '1', location: 'inline' } },
    rationale: 'D2 semantic result freshness check.',
  });
  assert.equal(semanticProposal.ok, true);
  await callTool(MCP_TOOL_NAMES.submitGraphPatchProposal, { proposal: semanticProposal.proposal });
  await waitFor("Boolean(document.querySelector('[data-graph-patch-preview]'))", 'semantic invalidation preview');
  await clickSelector('[data-graph-patch-apply]');
  await waitFor("!document.querySelector('[data-graph-patch-preview]')", 'semantic invalidation Apply');
  const resultsAfterSemantic = await callTool(MCP_TOOL_NAMES.inspectResults);
  assert.equal(resultsAfterSemantic.envelope.result.current, false);
  await record('semantic-apply-invalidates-results', { current: false, freshness: resultsAfterSemantic.envelope.result.freshness });

  const currentState = await canvasAgent('getState');
  for (const node of currentState.canvas.nodes) await canvasAgent('removeNode', node.id);
  await canvasAgent('setDataset', fixture.dataset);
  const emptyBeforeWhole = await currentProject();
  const stagedWhole = await callTool(MCP_TOOL_NAMES.submitGraphProposal, { proposal: fixture.proposal });
  assert.equal(stagedWhole.envelope.ok, true);
  await waitFor("Boolean(document.querySelector('[data-graph-proposal-preview]'))", 'whole proposal preview');
  assert.equal(comparableProject(emptyBeforeWhole), comparableProject(await currentProject()));
  await clickSelector('[data-graph-proposal-cancel]');
  await waitFor("!document.querySelector('[data-graph-proposal-preview]')", 'whole proposal cancel');
  assert.equal(comparableProject(emptyBeforeWhole), comparableProject(await currentProject()));
  await record('whole-proposal-preview-cancel', { previewOnly: true, graphUnchanged: true });

  await evaluate('window.__VOLK_ML_MCP_BRIDGE_TEST__.pause()');
  const cancellation = new AbortController();
  const cancelledProposalCall = callTool(MCP_TOOL_NAMES.submitGraphProposal, { proposal: fixture.proposal }, { signal: cancellation.signal });
  await new Promise((resolve) => setTimeout(resolve, 150));
  cancellation.abort();
  let cancellationRejected = false;
  try { await cancelledProposalCall; } catch { cancellationRejected = true; }
  assert.equal(cancellationRejected, true);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await evaluate('window.__VOLK_ML_MCP_BRIDGE_TEST__.resume()');
  const afterCancellation = await callTool(MCP_TOOL_NAMES.inspectWorkspace);
  assert.equal(afterCancellation.envelope.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(await evaluate("Boolean(document.querySelector('[data-graph-proposal-preview]'))"), false);

  await evaluate('window.__VOLK_ML_MCP_BRIDGE_TEST__.pause()');
  const deadline = await callTool(MCP_TOOL_NAMES.submitGraphProposal, { proposal: fixture.proposal });
  assert.equal(deadline.envelope.ok, false);
  assert.equal(deadline.envelope.error.code, 'MCP_WORKSPACE_DEADLINE');
  await evaluate('window.__VOLK_ML_MCP_BRIDGE_TEST__.resume()');
  const afterDeadline = await callTool(MCP_TOOL_NAMES.inspectWorkspace);
  assert.equal(afterDeadline.envelope.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(await evaluate("Boolean(document.querySelector('[data-graph-proposal-preview]'))"), false);
  await record('cancelled-and-expired-proposal-withdrawal', {
    cancellationRejected,
    deadline: deadline.envelope.error.code,
    pollResumed: true,
    stalePreviewRendered: false,
    capacityReleased: afterDeadline.envelope.ok,
    localGraphUnchanged: comparableProject(emptyBeforeWhole) === comparableProject(await currentProject()),
  });
  await evaluate('window.__VOLK_ML_MCP_BRIDGE_TEST__.stop()');
  const disconnected = await callTool(MCP_TOOL_NAMES.inspectWorkspace);
  assert.equal(disconnected.envelope.ok, false);
  assert.equal(disconnected.envelope.error.code, 'MCP_WORKSPACE_DISCONNECTED');
  await record('disconnect-containment', { error: disconnected.envelope.error.code, localRuntimeNotMutated: true });

  if (browserErrors.length) throw new Error(`Browser console errors: ${JSON.stringify(browserErrors)}`);
  report.outcome = 'PASS';
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.outcome = 'FAIL';
  report.error = error?.stack ?? error?.message ?? String(error);
  report.browserErrors = browserErrors;
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  try { await client?.close(); } catch {}
  try { await transport?.close(); } catch {}
  if (cdp) cdp.close();
  stopProcess(chromeProcess);
  stopProcess(viteProcess);
  try { fs.rmSync(chromeProfile, { recursive: true, force: true }); } catch {}
}
