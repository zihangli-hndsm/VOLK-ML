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
  await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => api.selectNode(null))`, true);
  await click('(() => { const button = document.querySelector("button[aria-controls=build-more-actions]"); if (!button) return false; button.click(); return true; })()', 'Build More actions');
  if (await evaluate('Boolean(document.querySelector("button[data-explore-capacity-bridge]"))')) {
    throw new Error('The capacity-bridge entry must be unavailable when no Build node is selected.');
  }
  await click('(() => { const button = document.querySelector("button[aria-controls=build-more-actions]"); if (!button) return false; button.click(); return true; })()', 'close Build More actions after no-selection check');
  await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => api.selectNode("build-input"))`, true);
  await click('(() => { const button = document.querySelector("button[aria-controls=build-more-actions]"); if (!button) return false; button.click(); return true; })()', 'Build More actions for non-hidden selection');
  if (await evaluate('Boolean(document.querySelector("button[data-explore-capacity-bridge]"))')) {
    throw new Error('Selecting a non-hidden model node must not expose the capacity-bridge entry.');
  }
  await click('(() => { const button = document.querySelector("button[aria-controls=build-more-actions]"); if (!button) return false; button.click(); return true; })()', 'close Build More actions after non-hidden check');
  await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => api.selectNode("build-hidden"))`, true);
  await click('(() => { const button = document.querySelector("button[aria-controls=build-more-actions]"); if (!button) return false; button.click(); return true; })()', 'Build More actions for selected hidden Dense');
  const entryIdentity = await evaluate(`(() => {
    const button = document.querySelector("button[data-explore-capacity-bridge]");
    return button?.dataset.selectedNodeId ?? null;
  })()`);
  if (entryIdentity !== 'build-hidden') throw new Error(`The bridge entry did not bind the exact selected hidden node: ${entryIdentity}`);
  await click('(() => { const button = document.querySelector("button[data-explore-capacity-bridge]"); if (!button) return false; button.click(); return true; })()', 'Explore capacity bridge entry');
  await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge][data-lifecycle=ready]"))', 'eligible bridge session');
  const sessionOrigin = await evaluate('document.querySelector("[data-explore-capacity-bridge][data-lifecycle=ready]")?.dataset.selectedHiddenNodeId ?? null');
  if (sessionOrigin !== 'build-hidden') throw new Error(`Explore session origin did not retain the selected hidden node: ${sessionOrigin}`);

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

  const originalHiddenPosition = await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => api.getProject().graph.nodes.find((node) => node.id === "build-hidden").position)`, true);
  const layoutMoved = await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => { await api.updateNode("build-hidden", { position: { x: 777, y: 555 } }); return true; })`, true);
  if (!layoutMoved) throw new Error('Could not exercise layout-only source reconciliation.');
  await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge][data-lifecycle=completed]"))', 'completed state preserved after layout-only change');
  await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => api.updateNode("build-hidden", { position: ${JSON.stringify(originalHiddenPosition)} }))`, true);
  await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge][data-lifecycle=completed]"))', 'completed state after restoring source layout');
  const restoredSource = await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => { const state = api.getState(); const project = api.getProject(); return JSON.stringify({ graph: project.graph, data: project.data, runtime: state.execution.runtime }); })`, true);
  if (restoredSource !== sourceAfter) throw new Error('Restoring layout did not restore the exact pre-transfer C2 source state.');

  await click('(() => { const button = document.querySelector("[data-capacity-use-project]"); if (!button) return false; button.click(); return true; })()', 'stage the source-bound Explore→Build proposal');
  await waitFor('Boolean(document.querySelector("[data-graph-patch-preview] [data-explore-to-build-source]"))', 'G3 C2 preview');
  const preview = await evaluate(`(() => {
    const source = document.querySelector("[data-explore-to-build-source]");
    const changedNodes = [...document.querySelectorAll('[data-patch-diff-group="node-changed"] [data-patch-item]')].map((item) => item.dataset.patchItem).sort();
    const changedEdges = document.querySelectorAll('[data-patch-diff-group="edge-changed"] [data-patch-item]').length;
    const metrics = [...document.querySelectorAll('[data-explore-to-build-measurement]')].map((row) => ({ metric: row.dataset.exploreToBuildMeasurement, baseline: Number(row.dataset.baseline), variant: Number(row.dataset.variant), delta: Number(row.dataset.delta) }));
    const operations = [...document.querySelectorAll('[data-graph-patch-preview] ol li')].map((item) => item.innerText);
    return {
      comparisonId: source?.dataset.comparisonId,
      runIds: source?.dataset.sourceRunIds?.split(',') ?? [],
      changedNodes,
      changedEdges,
      metrics,
      operations,
      existingNodes: document.querySelectorAll('[data-patch-diff-group="node-existing"] [data-patch-item]').length,
      applyEnabled: !document.querySelector('[data-graph-patch-apply]')?.disabled,
      pairedNote: document.querySelector('[data-explore-to-build-source]')?.innerText ?? '',
    };
  })()`);
  if (!preview.comparisonId?.startsWith('capacity-comparison-')
    || preview.runIds.length !== 2
    || preview.runIds.some((runId) => !runId.startsWith('capacity-run-'))
    || preview.changedNodes.join(',') !== 'build-head,build-hidden'
    || preview.changedEdges !== 0
    || preview.metrics.length < 1
    || preview.metrics.some((metric) => ![metric.baseline, metric.variant, metric.delta].every(Number.isFinite)
      || metric.delta !== metric.variant - metric.baseline)
    || preview.operations.length !== 2
    || !preview.operations.some((line) => line.includes('build-hidden') && line.includes('units'))
    || !preview.operations.some((line) => line.includes('build-head') && line.includes('input_features'))
    || preview.existingNodes !== build.nodes.length - 2
    || !preview.applyEnabled) {
    throw new Error(`G3 preview did not show the exact paired source and bounded two-node change: ${JSON.stringify(preview)}`);
  }
  const g3PreviewSource = await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => { const state = api.getState(); const project = api.getProject(); return JSON.stringify({ graph: project.graph, data: project.data, runtime: state.execution.runtime }); })`, true);
  if (g3PreviewSource !== sourceAfter) throw new Error('Opening G3 preview mutated the Build graph, data, or runtime.');

  await click('(() => { const button = document.querySelector("[data-graph-patch-cancel]"); if (!button) return false; button.click(); return true; })()', 'cancel the first G3 preview');
  await waitFor('!document.querySelector("[data-graph-patch-preview]")', 'G3 preview cancellation');
  const cancelledSource = await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => { const state = api.getState(); const project = api.getProject(); return JSON.stringify({ graph: project.graph, data: project.data, runtime: state.execution.runtime }); })`, true);
  if (cancelledSource !== sourceAfter || !await evaluate('Boolean(document.querySelector("[data-explore-capacity-bridge][data-lifecycle=completed] [data-capacity-results]"))')) {
    throw new Error('Cancelling G3 must preserve both the Build workspace and the completed source comparison.');
  }

  await click('(() => { const button = document.querySelector("[data-capacity-use-project]"); if (!button) return false; button.click(); return true; })()', 'reopen the G3 preview for explicit Apply');
  await waitFor('Boolean(document.querySelector("[data-graph-patch-preview] [data-explore-to-build-source] [data-explore-to-build-measurements]"))', 'reopened G3 paired measurements');
  const replayedPreview = await evaluate('({ count: document.querySelectorAll("[data-graph-patch-preview]").length, runIds: document.querySelector("[data-explore-to-build-source]")?.dataset.sourceRunIds ?? "" })');
  if (replayedPreview.count !== 1 || replayedPreview.runIds !== preview.runIds.join(',')) {
    throw new Error(`Reopening G3 must stage one proposal from the same actual pair: ${JSON.stringify(replayedPreview)}`);
  }
  const beforeApply = await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => { const project = api.getProject(); const state = api.getState(); return { graph: project.graph, data: project.data, runtime: state.execution.runtime, model: project.trainedModel }; })`, true);
  await click('(() => { const button = document.querySelector("[data-graph-patch-apply]"); if (!button || button.disabled) return false; button.click(); button.click(); return true; })()', 'Apply the G3 proposal and exercise duplicate-Apply containment');
  await waitFor('!document.querySelector("[data-graph-patch-preview]")', 'explicit G3 Apply completion');
  const afterApply = await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => { const project = api.getProject(); const state = api.getState(); return { graph: project.graph, data: project.data, runtime: state.execution.runtime, model: project.trainedModel }; })`, true);
  const oldHidden = beforeApply.graph.nodes.find((node) => node.id === 'build-hidden').data.parameters;
  const newHidden = afterApply.graph.nodes.find((node) => node.id === 'build-hidden').data.parameters;
  const oldOutput = beforeApply.graph.nodes.find((node) => node.id === 'build-head').data.parameters;
  const newOutput = afterApply.graph.nodes.find((node) => node.id === 'build-head').data.parameters;
  const hiddenChangedKeys = [...new Set([...Object.keys(oldHidden), ...Object.keys(newHidden)])].filter((key) => oldHidden[key] !== newHidden[key]);
  const outputChangedKeys = [...new Set([...Object.keys(oldOutput), ...Object.keys(newOutput)])].filter((key) => oldOutput[key] !== newOutput[key]);
  const otherNodesBefore = beforeApply.graph.nodes.filter((node) => !['build-hidden', 'build-head'].includes(node.id));
  const otherNodesAfter = afterApply.graph.nodes.filter((node) => !['build-hidden', 'build-head'].includes(node.id));
  if (hiddenChangedKeys.join(',') !== 'units'
    || outputChangedKeys.join(',') !== 'input_features'
    || newHidden.units !== newOutput.input_features
    || JSON.stringify(otherNodesBefore) !== JSON.stringify(otherNodesAfter)
    || JSON.stringify(beforeApply.graph.edges) !== JSON.stringify(afterApply.graph.edges)
    || JSON.stringify(beforeApply.data) !== JSON.stringify(afterApply.data)
    || afterApply.runtime.status !== 'idle'
    || afterApply.model !== null
    || preview.runIds.some((runId) => JSON.stringify(afterApply).includes(runId))
    || JSON.stringify(afterApply).includes(preview.comparisonId)) {
    throw new Error('G3 Apply changed an out-of-scope field, persisted Explore measurements, or executed Build.');
  }
  await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge][data-lifecycle=stale]"))', 'source G2 session invalidated after applied semantic configuration change');
  await click('(() => { const button = document.querySelector("[data-explore-capacity-bridge] footer button:last-child"); if (!button) return false; button.click(); return true; })()', 'close stale G2 source dialog after Apply');
  await waitFor('!document.querySelector("[data-explore-capacity-bridge]")', 'close stale source session dialog');
  await click('(() => { const button = document.querySelector("[data-build-primary=run]"); if (!button) return false; button.click(); return true; })()', 'open Build Run explicitly after G3 Apply');
  await waitFor('Boolean(document.querySelector("[data-runner-execute]"))', 'Build Run dialog after explicit open');
  await click('(() => { const button = document.querySelector("[data-runner-execute]"); if (!button || button.disabled) return false; button.click(); return true; })()', 'execute the separately applied Build graph');
  await waitFor('Boolean(document.querySelector("[data-run-history-status=succeeded][data-run-history-freshness=current][data-run-history-attempt-id]"))', 'distinct Build run history result', 60000);
  const buildRun = await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => ({ runtime: api.getState().execution.runtime, model: api.getProject().trainedModel, attemptId: document.querySelector('[data-run-history-status="succeeded"][data-run-history-freshness="current"]')?.dataset.runHistoryAttemptId ?? null }))`, true);
  if (!buildRun.attemptId?.startsWith('run-')
    || preview.runIds.includes(buildRun.attemptId)
    || buildRun.runtime.status !== 'succeeded'
    || !buildRun.model) {
    throw new Error(`The explicit Build Run must create a distinct successful Build attempt: ${JSON.stringify(buildRun)}`);
  }
  const execution = buildRun.runtime.execution;
  if (execution?.schemaVersion !== 1
    || execution.status !== 'succeeded'
    || !execution.requestId?.startsWith('execution-')
    || execution.runId !== buildRun.attemptId
    || typeof execution.projectSessionId !== 'string'
    || execution.providerId !== 'browser-cpu'
    || execution.adapterId !== 'volk-browser-runtime'
    || execution.provenance !== 'live-local'
    || execution.graphIdentity?.kind !== 'graph'
    || typeof execution.graphIdentity.fingerprint !== 'string'
    || execution.artifactIdentity !== null) {
    throw new Error(`The Browser CPU run must expose its accepted graph-bound ExecutionResultV1 without a companion or artifact identity: ${JSON.stringify(execution)}`);
  }

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
    await api.selectNode("build-hidden");
    return api.getState().canvas.nodes.length;
  })`, true);
  if (reloadedFixture !== build.nodes.length) throw new Error('Could not restore the browser Build fixture for post-reload session check.');
  await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => api.selectNode("build-hidden"))`, true);
  await click('(() => { const buttons = [...document.querySelectorAll("header nav button[aria-pressed]")]; const buildButton = buttons.find((button) => button.getAttribute("aria-pressed") === "false" && button.textContent.trim().toLowerCase().includes("build")); if (!buildButton) return false; buildButton.click(); return true; })()', 'Build surface after reload');
  await click('(() => { const button = document.querySelector("button[aria-controls=build-more-actions]"); if (!button) return false; button.click(); return true; })()', 'Build More actions after reload');
  await click('(() => { const button = document.querySelector("button[data-explore-capacity-bridge]"); if (!button) return false; button.click(); return true; })()', 'new bridge after reload');
  await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge][data-lifecycle=ready]"))', 'new volatile bridge after reload');
  if (await evaluate('Boolean(document.querySelector("[data-capacity-results]"))')) throw new Error('Reload recreated previous comparison results.');
  await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => { const project = api.getProject(); project.name = "Bridge project switch fixture"; await api.loadProject(project); return true; })`, true);
  await waitFor('!document.querySelector("[data-explore-capacity-bridge]")', 'bridge disposal after project replacement');
  await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => api.selectNode("build-hidden"))`, true);

  await click('(() => { const button = document.querySelector("button[aria-controls=build-more-actions]"); if (!button) return false; button.click(); return true; })()', 'Build More actions after project replacement');
  await click('(() => { const button = document.querySelector("button[data-explore-capacity-bridge]"); if (!button) return false; button.click(); return true; })()', 'new bridge after project replacement');
  await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge][data-lifecycle=ready]"))', 'new session after project replacement');
  const unsupportedNodeId = await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => (await api.addNode({ componentId: "dense_node", id: "bridge-extra-hidden" })).nodeId)`, true);
  if (unsupportedNodeId !== 'bridge-extra-hidden') throw new Error('Could not create the unsupported-graph refresh fixture.');
  await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge][data-lifecycle=stale]"))', 'stale session after adding an unsupported graph branch');
  await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => { await api.removeNode("bridge-extra-hidden"); return true; })`, true);
  await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge][data-lifecycle=stale]"))', 'stale unsupported session after graph repair');
  await click('(() => { const button = document.querySelector("[data-capacity-new-session]"); if (!button) return false; button.click(); return true; })()', 're-evaluate repaired Build graph');
  await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge][data-lifecycle=ready]"))', 'fresh eligible session after repairing an unsupported graph');

  if (cloudPolicyRequests.length) throw new Error(`The local-only bridge unexpectedly called Cloud: ${cloudPolicyRequests.join(', ')}`);
  if (browserErrors.length) throw new Error(`Browser raised runtime exceptions: ${browserErrors.slice(-5).join(' | ')}`);
  console.log(`Mounted G2→G3 browser checks passed (two real Browser CPU runs ${preview.runIds.join(', ')}; layout-only session preserved; exact paired measurements previewed; cancel left Build unchanged; explicit Apply changed only Dense.units/input_features; G2 session became stale; separate Build Run ${buildRun.attemptId} succeeded; reload drops volatile state; project replacement disposes it; no Cloud call).`);
} finally {
  cdp?.close();
  stopProcess(chromeProcess);
  stopProcess(viteProcess);
  try { fs.rmSync(chromeProfile, { recursive: true, force: true }); } catch {}
}
