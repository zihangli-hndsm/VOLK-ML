import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeBuildExploreCapacityFixture } from './build-explore-capacity-bridge-fixture.mjs';

const baseUrl = 'http://127.0.0.1:5188';
const chromeDebugUrl = 'http://127.0.0.1:9288/json/list';
const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-capacity-bridge-chrome-'));
const chromePath = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
let viteProcess = null;
let chromeProcess = null;
let cdp = null;
const browserErrors = [];
const cloudPolicyRequests = [];

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
    this.eventHandlers = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id && message.method) {
        const handler = this.eventHandlers.get(message.method);
        if (handler) Promise.resolve(handler(message.params)).catch(() => {});
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
  onEvent(method, handler) { this.eventHandlers.set(method, handler); }
  close() { this.socket.close(); }
}

async function waitForHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function evaluate(expression, awaitPromise = false) {
  let result;
  try {
    result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  } catch (error) {
    throw new Error(`Runtime.evaluate failed for ${expression.slice(0, 180)}: ${error.message}`);
  }
  if (result.exceptionDetails) throw new Error(result.result?.description ?? result.exceptionDetails.text ?? 'Browser evaluation failed.');
  return result.result?.value;
}

async function waitFor(expression, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression, true)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const details = await evaluate('({ url: location.href, dialog: document.querySelector("[data-explore-capacity-bridge]")?.innerText?.slice(0, 2000), body: document.body?.innerText?.slice(-1400) })');
  details.browserErrors = browserErrors.slice(-8);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(details)}`);
}

async function click(expression, label) {
  if (!await evaluate(expression)) throw new Error(`Could not click ${label}`);
  await new Promise((resolve) => setTimeout(resolve, 150));
}

const build = makeBuildExploreCapacityFixture({ privateRowMarker: true });
const nodes = JSON.stringify(build.nodes);
const edges = JSON.stringify(build.edges);
const dataset = JSON.stringify(build.dataset);

try {
  const viteEnv = { ...process.env };
  delete viteEnv.VITE_VOLK_API_URL;
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5188', '--strictPort'], {
    cwd: process.cwd(), env: viteEnv, stdio: 'inherit',
  });
  await waitForHttp(`${baseUrl}/`);
  chromeProcess = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=9288', '--window-size=1440,1000',
    `--user-data-dir=${chromeProfile}`, 'about:blank',
  ], { stdio: 'ignore' });
  await waitForHttp(chromeDebugUrl);
  const pages = await (await fetch(chromeDebugUrl)).json();
  const page = pages.find((item) => item.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('Chrome DevTools page was unavailable.');
  cdp = new CdpClient(page.webSocketDebuggerUrl);
  cdp.onEvent('Runtime.exceptionThrown', ({ exceptionDetails }) => browserErrors.push(exceptionDetails?.text ?? 'Browser exception'));
  cdp.onEvent('Network.requestWillBeSent', ({ request }) => {
    if (request?.url?.includes('/v0/lumi/respond')) cloudPolicyRequests.push(request.url);
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: baseUrl });
  await waitFor('Boolean(document.querySelector("header nav button[aria-pressed]"))', 'mounted Build/Explore navigation');
  await waitFor('typeof window.__VOLK_ML_AGENT__?.open === "function"', 'mounted Canvas Agent fixture surface');

  const loaded = await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => {
    const project = api.getProject();
    project.graph = { nodes: ${nodes}, edges: ${edges} };
    project.data = ${dataset};
    project.customComponents = [];
    project.trainedModel = null;
    await api.loadProject(project);
    const state = api.getState();
    return { nodeCount: state.canvas.nodes.length, task: state.dataset?.task, runtimeStatus: state.execution.runtime.status };
  })`, true);
  if (loaded.nodeCount !== build.nodes.length || loaded.task !== 'classification') {
    throw new Error(`Browser fixture project did not load as expected: ${JSON.stringify(loaded)}`);
  }

  await click('(() => { const buttons = [...document.querySelectorAll("header nav button[aria-pressed]")]; const buildButton = buttons.find((button) => button.getAttribute("aria-pressed") === "false" && button.textContent.trim().toLowerCase().includes("build")); if (!buildButton) return false; buildButton.click(); return true; })()', 'Build surface');
  await click('(() => { const button = document.querySelector("button[aria-controls=build-more-actions]"); if (!button) return false; button.click(); return true; })()', 'Build More actions');
  await click('(() => { const button = document.querySelector("button[data-explore-capacity-bridge]"); if (!button) return false; button.click(); return true; })()', 'Explore capacity bridge entry');
  await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge][data-lifecycle=ready]"))', 'eligible bridge session');

  const sourceBefore = await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => { const state = api.getState(); const project = api.getProject(); return JSON.stringify({ graph: project.graph, data: project.data, runtime: state.execution.runtime }); })`, true);
  await click('(() => { const button = document.querySelector("[data-capacity-run]"); if (!button || button.disabled) return false; button.click(); return true; })()', 'explicit comparison run');
  await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge][data-lifecycle=completed] [data-capacity-results]"))', 'completed local comparison', 30000);
  const rendered = await evaluate(`(() => ({
    runNote: document.querySelector("[data-capacity-results]")?.innerText ?? "",
    comparisonId: document.querySelector("[data-capacity-results]")?.dataset.comparisonId ?? "",
    runIds: document.querySelector("[data-capacity-results]")?.dataset.runIds?.split(",") ?? [],
    metricRows: document.querySelectorAll("[data-capacity-results] tbody tr").length,
    lifecycle: document.querySelector("[data-explore-capacity-bridge]")?.dataset.lifecycle,
  }))()`);
  if (!rendered.comparisonId.startsWith('capacity-comparison-')
    || rendered.runIds.length !== 2
    || rendered.runIds.some((runId) => !runId.startsWith('capacity-run-'))
    || rendered.runIds[0] === rendered.runIds[1]
    || rendered.metricRows < 1
    || rendered.lifecycle !== 'completed') {
    throw new Error(`Browser did not render source-provenanced comparison metrics: ${JSON.stringify(rendered)}`);
  }
  const sourceAfter = await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => { const state = api.getState(); const project = api.getProject(); return JSON.stringify({ graph: project.graph, data: project.data, runtime: state.execution.runtime }); })`, true);
  if (sourceBefore !== sourceAfter) throw new Error('Bridge training changed the active Build graph, dataset, or Build runtime result.');

  const layoutMoved = await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => { await api.updateNode("build-hidden", { position: { x: 777, y: 555 } }); return true; })`, true);
  if (!layoutMoved) throw new Error('Could not exercise layout-only source reconciliation.');
  await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge][data-lifecycle=completed]"))', 'completed state preserved after layout-only change');
  const semanticChanged = await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => { await api.updateNode("build-hidden", { parameters: { use_bias: false } }); return true; })`, true);
  if (!semanticChanged) throw new Error('Could not exercise semantic source invalidation.');
  await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge][data-lifecycle=stale]"))', 'stale comparison after graph semantics changed');

  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor('Boolean(document.querySelector("header nav button[aria-pressed]"))', 'app navigation after reload');
  await waitFor('typeof window.__VOLK_ML_AGENT__?.open === "function"', 'Canvas Agent after reload');
  const dialogSurvivedReload = await evaluate('Boolean(document.querySelector("[data-explore-capacity-bridge]"))');
  if (dialogSurvivedReload) throw new Error('An in-memory Explore bridge result survived page reload.');
  const reloadedFixture = await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => {
    const project = api.getProject();
    project.graph = { nodes: ${nodes}, edges: ${edges} };
    project.data = ${dataset};
    project.customComponents = [];
    project.trainedModel = null;
    await api.loadProject(project);
    return api.getState().canvas.nodes.length;
  })`, true);
  if (reloadedFixture !== build.nodes.length) throw new Error('Could not restore the browser Build fixture for post-reload session check.');
  await click('(() => { const buttons = [...document.querySelectorAll("header nav button[aria-pressed]")]; const buildButton = buttons.find((button) => button.getAttribute("aria-pressed") === "false" && button.textContent.trim().toLowerCase().includes("build")); if (!buildButton) return false; buildButton.click(); return true; })()', 'Build surface after reload');
  await click('(() => { const button = document.querySelector("button[aria-controls=build-more-actions]"); if (!button) return false; button.click(); return true; })()', 'Build More actions after reload');
  await click('(() => { const button = document.querySelector("button[data-explore-capacity-bridge]"); if (!button) return false; button.click(); return true; })()', 'new bridge after reload');
  await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge][data-lifecycle=ready]"))', 'new volatile bridge after reload');
  if (await evaluate('Boolean(document.querySelector("[data-capacity-results]"))')) throw new Error('Reload recreated previous comparison results.');
  await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => { const project = api.getProject(); project.name = "Bridge project switch fixture"; await api.loadProject(project); return true; })`, true);
  await waitFor('!document.querySelector("[data-explore-capacity-bridge]")', 'bridge disposal after project replacement');

  const unsupportedNodeId = await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => (await api.addNode({ componentId: "dense_node", id: "bridge-extra-hidden" })).nodeId)`, true);
  if (unsupportedNodeId !== 'bridge-extra-hidden') throw new Error('Could not create the unsupported-graph refresh fixture.');
  await click('(() => { const button = document.querySelector("button[aria-controls=build-more-actions]"); if (!button) return false; button.click(); return true; })()', 'Build More actions for unsupported refresh');
  await click('(() => { const button = document.querySelector("button[data-explore-capacity-bridge]"); if (!button) return false; button.click(); return true; })()', 'unsupported graph bridge entry');
  await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge] [data-capacity-reason]"))', 'actionable unsupported/stale bridge state');
  const unsupportedReason = await evaluate('document.querySelector("[data-explore-capacity-bridge] [data-capacity-reason]")?.innerText ?? ""');
  if (!unsupportedReason.toLowerCase().includes('additional or disconnected branch')
    && !unsupportedReason.toLowerCase().includes('build graph')) {
    throw new Error(`Unsupported/stale graph did not receive its localized reason: ${unsupportedReason}`);
  }
  await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => { await api.removeNode("bridge-extra-hidden"); return true; })`, true);
  await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge][data-lifecycle=stale]"))', 'stale unsupported session after graph repair');
  await click('(() => { const button = document.querySelector("[data-capacity-new-session]"); if (!button) return false; button.click(); return true; })()', 're-evaluate repaired Build graph');
  await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge][data-lifecycle=ready]"))', 'fresh eligible session after repairing an unsupported graph');

  if (cloudPolicyRequests.length) throw new Error(`The local-only bridge unexpectedly called Cloud: ${cloudPolicyRequests.join(', ')}`);
  if (browserErrors.length) throw new Error(`Browser raised runtime exceptions: ${browserErrors.slice(-5).join(' | ')}`);
  console.log('Mounted Build→Explore bridge browser checks passed (two real Browser CPU runs; source unchanged; layout preserved; semantic edit stale; reload drops session; project replacement disposes it; no Cloud call).');
} finally {
  cdp?.close();
  stopProcess(chromeProcess);
  stopProcess(viteProcess);
  try { fs.rmSync(chromeProfile, { recursive: true, force: true }); } catch {}
}
