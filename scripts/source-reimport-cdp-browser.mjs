import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { connectAgentNodes, createAgentNode } from '../src/core/canvasAgent.js';
import { componentById } from '../src/core/components.js';
import { exerciseDatasets } from '../src/core/buildAgent/exerciseFixtures.js';
import { finalizeSourceReimportProposal, analyzeSourceReimport } from '../src/core/graph/sourceReimportProposal.js';
import { graphPatchBaseFromProject } from '../src/core/graph/workspacePatchApply.js';
import { MCP_TOOL_NAMES } from '../src/core/mcpTransport.js';
import { PROJECT_VERSION, validateProjectForWorkspace } from '../src/core/project.js';
import { createVolkProjectGraphProposal } from '../src/core/graph/workspaceProposal.js';
import { parseGeneratedSources } from './propose-source-reimport.mjs';

const root = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-source-reimport-browser-'));
const chromeProfile = path.join(tempRoot, 'chrome');
const baseUrl = 'http://127.0.0.1:5183';
const chromeDebugUrl = 'http://127.0.0.1:9233/json/list';
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
          const line = (message.params.args ?? []).map((item) => item.value ?? item.description).join(' ');
          if (!/Failed to load resource/.test(line)) browserErrors.push(line);
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
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function evaluate(expression, awaitPromise = false) {
  const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.result?.description ?? response.exceptionDetails.exception?.description ?? 'Browser evaluation failed.');
  return response.result?.value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(predicate)) return;
    await sleep(100);
  }
  const details = await evaluate('({ url: location.href, text: document.body?.innerText?.slice(0, 1200), d1: Boolean(window.__VOLK_ML_AGENT_APPLICATION__), d2: Boolean(window.__VOLK_ML_MCP_BRIDGE_TEST__) })');
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify({ details, browserErrors })}`);
}

async function clickSelector(selector) {
  const clicked = await evaluate(`(() => { const control = document.querySelector(${JSON.stringify(selector)}); if (!control || control.disabled) return false; control.click(); return true; })()`);
  if (!clicked) throw new Error(`Could not click enabled control ${selector}`);
  await sleep(200);
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
  const text = result?.content?.find((entry) => entry.type === 'text')?.text;
  return text ? JSON.parse(text) : null;
}

async function callTool(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const envelope = mcpEnvelope(result);
  if (!envelope) throw new Error(`MCP tool ${name} returned no structured envelope.`);
  return envelope;
}

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
        if (line.startsWith('VOLK_MCP_START_FAILED')) reject(new Error('MCP server failed to start.'));
      }
    };
    stderr.on('data', onData);
    stderr.on('error', reject);
  });
}

async function startServices() {
  fs.mkdirSync(chromeProfile, { recursive: false });
  const env = { ...process.env, TEMP: tempRoot, TMP: tempRoot };
  delete env.VITE_VOLK_API_URL;
  delete env.VITE_VOLK_CLOUD_URL;
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5183', '--strictPort'], {
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
  client = new Client({ name: 'volk-ml-e2-source-reimport-browser', version: '1.0.0' });
  const connected = client.connect(transport);
  const ready = await readyPromise;
  await connected;
  chromeProcess = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=9233', '--window-size=1440,1000',
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
  await waitFor('Boolean(window.__VOLK_ML_AGENT_APPLICATION__) && Boolean(document.querySelector("nav button"))', 'mounted D1 application boundary');
  await waitFor('!new URLSearchParams(location.search).has("mcpBridge") && !new URLSearchParams(location.search).has("mcpToken")', 'one-time MCP credentials removed from URL');
  const enteredBuild = await evaluate(`(() => { const button = [...document.querySelectorAll('nav button')].find((item) => /build/i.test(item.innerText)); if (!button) return false; button.click(); return true; })()`);
  if (!enteredBuild) throw new Error('Could not enter Build workspace.');
  await waitFor('Boolean(window.__VOLK_ML_AGENT__?.listInstances?.().length && window.__VOLK_ML_GRAPH_APPLY_TEST__ && window.__VOLK_ML_MCP_BRIDGE_TEST__)', 'mounted workspace with D2 bridge');
  return ready;
}

function buildProject() {
  const nodes = [];
  const input = createAgentNode({ nodes, manifest: componentById.get('tensor_input_node'), request: { id: 'e2-input', position: { x: 20, y: 50 }, parameters: { shape: '8' } } });
  nodes.push(input);
  const dense = createAgentNode({ nodes, manifest: componentById.get('dense_node'), request: { id: 'e2-dense', position: { x: 260, y: 50 }, parameters: { input_features: 8, units: 4, use_bias: false } } });
  nodes.push(dense);
  const output = createAgentNode({ nodes, manifest: componentById.get('model_output_node'), request: { id: 'e2-output', position: { x: 500, y: 50 } } });
  nodes.push(output);
  const orphan = createAgentNode({ nodes, manifest: componentById.get('dense_node'), request: { id: 'e2-orphan', position: { x: 260, y: 260 }, parameters: { input_features: 8, units: 2 } } });
  nodes.push(orphan);
  let edges = connectAgentNodes(nodes, [], { id: 'e2-edge-input', source: input.id, sourceHandle: 'tensor', target: dense.id, targetHandle: 'input' });
  edges = connectAgentNodes(nodes, edges, { id: 'e2-edge-output', source: dense.id, sourceHandle: 'output', target: output.id, targetHandle: 'input' });
  const project = validateProjectForWorkspace({
    format: 'VOLK-ML', version: PROJECT_VERSION, name: 'E2 mounted acceptance fixture',
    language: { primary: 'en', secondary: null },
    workspace: { viewMode: 'canvas', leftWidth: 300, rightWidth: 380 },
    graph: { nodes, edges }, customComponents: [], data: null, trainedModel: null,
  });
  return { project, denseId: dense.id, orphanId: orphan.id };
}

let d1RequestSequence = 0;
async function agentRequest(method, params = {}) {
  return evaluate(`window.__VOLK_ML_AGENT_APPLICATION__.request(${JSON.stringify({
    apiVersion: 1,
    requestId: `e2-${method}-${++d1RequestSequence}`,
    method,
    params,
  })})`, true);
}

async function stageWholeFixture(fixture) {
  const state = await canvasAgent('getState');
  for (const node of state.canvas.nodes) await canvasAgent('removeNode', node.id);
  const emptyProject = await currentProject();
  const whole = createVolkProjectGraphProposal(fixture.project, { targetGraph: graphPatchBaseFromProject(emptyProject) });
  assert.equal(whole.ok, true, whole.diagnostics?.[0]?.code);
  const staged = await agentRequest('submitGraphProposal', { proposal: whole.proposal });
  assert.equal(staged.ok, true, staged.error?.code);
  await waitFor("Boolean(document.querySelector('[data-graph-proposal-preview]'))", 'whole graph preview');
  const beforeApply = await currentProject();
  assert.equal(beforeApply.graph.nodes.length, 0, 'whole proposal remains detached before Apply');
  await clickSelector('[data-graph-proposal-apply]');
  await waitFor("!document.querySelector('[data-graph-proposal-preview]')", 'whole graph Apply');
  const applied = await currentProject();
  assert.equal(applied.graph.nodes.length, fixture.project.graph.nodes.length);
  return applied;
}

function editDenseUnits(source, expectedUnits) {
  const sourceLine = new RegExp(`nn\\.Linear\\(8, ${expectedUnits}, bias=False\\)`);
  assert.equal((source.match(new RegExp(sourceLine.source, 'g')) ?? []).length, 1);
  return source.replace(sourceLine, `nn.Linear(8, ${expectedUnits + 1}, bias=False)`);
}

async function makePatch(project, exported, editedSource) {
  assert.equal(exported.ok, true, exported.error?.code);
  assert.equal(exported.result.manifest?.type, 'VolkSourceExportManifestV1');
  const parsed = await parseGeneratedSources({ original: exported.result.code, edited: editedSource });
  const prepared = await analyzeSourceReimport({
    project,
    originalSource: exported.result.code,
    manifest: exported.result.manifest,
    editedSource,
    originalAst: parsed.original,
    editedAst: parsed.edited,
  });
  assert.equal(prepared.ok, true, prepared.diagnostics?.[0]?.code);
  assert.equal(prepared.status, 'candidate');
  const canonical = await parseGeneratedSources({ original: prepared.candidateSource, edited: editedSource });
  const finalized = finalizeSourceReimportProposal(prepared, { candidateAst: canonical.original, editedAst: canonical.edited });
  assert.equal(finalized.ok, true, finalized.diagnostics?.[0]?.code);
  assert.equal(finalized.proposal.requiresUserAcceptance, true);
  return finalized.proposal;
}

async function verifyStagedAndApply({ channel, stage, fixture, project, unitsExpected }) {
  const before = await currentProject();
  const runtimeBefore = await canvasAgent('getState');
  const staged = await stage();
  assert.equal(staged.ok, true, staged.error?.code);
  await waitFor("Boolean(document.querySelector('[data-graph-patch-preview]'))", `${channel} C2 patch preview`);
  assert.equal(comparableProject(before), comparableProject(await currentProject()), `${channel} staging is preview-only`);
  const inspection = channel === 'D1'
    ? await agentRequest('inspectProposal')
    : await callTool(MCP_TOOL_NAMES.inspectProposal);
  const envelope = channel === 'D1' ? inspection : inspection;
  assert.equal(envelope.ok, true, envelope.error?.code);
  assert.equal(envelope.result.current?.eligibility, 'ready-for-human-apply');
  await clickSelector('[data-graph-patch-apply]');
  await waitFor("!document.querySelector('[data-graph-patch-preview]')", `${channel} explicit C2 Apply`);
  const after = await currentProject();
  assert.equal(after.graph.nodes.find((node) => node.id === fixture.denseId).data.parameters.units, unitsExpected);
  assert.ok(after.graph.nodes.some((node) => node.id === fixture.orphanId));
  assert.deepEqual(after.data, project.data, `${channel} Apply retains dataset rows and metadata`);
  const runtimeAfter = await canvasAgent('getState');
  assert.deepEqual(runtimeAfter.execution.runtime, runtimeBefore.execution.runtime, `${channel} re-import never executes the graph`);
  return after;
}

const report = { task: 'VOLK-ML E2 controlled generated-source re-import browser acceptance', protocol: null, browser: null, scenarios };

try {
  const protocol = await startServices();
  report.protocol = { apiVersion: protocol.apiVersion, transport: 'D1 request API + official D2 MCP stdio/loopback bridge' };
  report.browser = { userAgent: await evaluate('navigator.userAgent'), viewport: await evaluate('({ width: innerWidth, height: innerHeight })') };
  const fixture = { ...buildProject() };
  await stageWholeFixture(fixture);
  await canvasAgent('setDataset', structuredClone(exerciseDatasets.wine));
  let project = await currentProject();
  fixture.project = project;
  project.data.name = 'E2-retained-dataset';
  await canvasAgent('setDataset', project.data);
  project = await currentProject();
  fixture.project = project;
  await record('mounted-canonical-pytorch-graph-and-local-dataset', { nodeCount: project.graph.nodes.length, datasetRows: project.data?.rows?.length ?? 0, orphanRetained: project.graph.nodes.some((node) => node.id === fixture.orphanId) });

  const exportD1 = await agentRequest('exportGraph', { framework: 'pytorch', includeManifest: true });
  const editedD1 = editDenseUnits(exportD1.result.code, 4);
  const proposalD1 = await makePatch(project, exportD1, editedD1);
  project = await verifyStagedAndApply({
    channel: 'D1', stage: () => agentRequest('submitGraphPatchProposal', { proposal: proposalD1 }),
    fixture, project, unitsExpected: 5,
  });
  fixture.project = project;
  await record('d1-source-reimport-preview-and-explicit-apply', { proposal: 'typed GraphPatchProposalV1', unitsAfterApply: 5, sourceExecuted: false });

  const exportD2 = await agentRequest('exportGraph', { framework: 'pytorch', includeManifest: true });
  const editedD2 = editDenseUnits(exportD2.result.code, 5);
  const proposalD2 = await makePatch(project, exportD2, editedD2);
  const stagedD2 = await verifyStagedAndApply({
    channel: 'D2', stage: () => callTool(MCP_TOOL_NAMES.submitGraphPatchProposal, { proposal: proposalD2 }),
    fixture, project, unitsExpected: 6,
  });
  assert.equal(stagedD2.graph.nodes.find((node) => node.id === fixture.denseId).data.parameters.units, 6);
  const appliedLifecycle = await callTool(MCP_TOOL_NAMES.inspectProposal);
  assert.equal(appliedLifecycle.ok, true, appliedLifecycle.error?.code);
  assert.equal(appliedLifecycle.result.current, null);
  assert.equal(appliedLifecycle.result.history.at(-1)?.status, 'applied');
  await record('d2-mcp-source-reimport-preview-and-explicit-apply', { proposal: 'typed GraphPatchProposalV1', unitsAfterApply: 6, lifecycle: 'applied' });

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
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
}

async function record(id, evidence) { scenarios.push({ id, outcome: 'PASS', evidence }); }
