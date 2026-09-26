import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createGraphPatchProposal } from '../src/core/graph/graphPatchProposal.js';
import { graphPatchBaseFromProject } from '../src/core/graph/workspacePatchApply.js';

const baseUrl = 'http://127.0.0.1:5181';
const chromeDebugUrl = 'http://127.0.0.1:9231/json/list';
const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-agent-app-d1-'));
const scenarios = [];
const browserErrors = [];
let viteProcess = null;
let chromeProcess = null;
let cdp = null;

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
      if (!this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
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
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function connectBrowser() {
  const pages = await (await fetch(chromeDebugUrl)).json();
  const page = pages.find((item) => item.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('Chrome DevTools page was unavailable.');
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable');
  return client;
}

async function evaluate(expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.result?.description ?? result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Browser evaluation failed.');
  return result.result?.value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(predicate)) return;
    await sleep(100);
  }
  const details = await evaluate('({ url: location.href, ready: document.readyState, text: document.body?.innerText?.slice(0, 1600), applicationApi: Boolean(window.__VOLK_ML_AGENT_APPLICATION__), canvasAgent: Boolean(window.__VOLK_ML_AGENT__) })');
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify({ ...details, browserErrors })}`);
}

async function clickSelector(selector) {
  const clicked = await evaluate(`(() => { const item = document.querySelector(${JSON.stringify(selector)}); if (!item || item.disabled) return false; item.click(); return true; })()`);
  if (!clicked) throw new Error(`Could not click enabled control ${selector}`);
  await sleep(180);
}

async function waitForRuntimeStatus(expectedStatus, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await canvasAgent('getState');
    if (state.execution?.runtime?.status === expectedStatus) return state;
    await sleep(100);
  }
  const state = await canvasAgent('getState');
  throw new Error(`Timed out waiting for runtime status ${expectedStatus}: ${JSON.stringify(state.execution?.runtime)}`);
}

async function agentRequest(method, params = {}) {
  const id = `d1-${method}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await evaluate(`window.__VOLK_ML_AGENT_APPLICATION__.request(${JSON.stringify({ apiVersion: 1, requestId: id, method, params })})`, true);
  if (!response) throw new Error(`Agent Application API did not return for ${method}.`);
  return response;
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

async function record(id, outcome, evidence = {}) { scenarios.push({ id, outcome, evidence }); }

async function startServices() {
  const env = { ...process.env };
  delete env.VITE_VOLK_API_URL;
  delete env.VITE_VOLK_CLOUD_URL;
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5181', '--strictPort'], {
    cwd: process.cwd(), env, stdio: 'inherit',
  });
  await waitForHttp(`${baseUrl}/`);
  chromeProcess = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=9231', '--window-size=1440,1000',
    `--user-data-dir=${chromeProfile}`, 'about:blank',
  ], { stdio: 'ignore' });
  await waitForHttp(chromeDebugUrl);
  cdp = await connectBrowser();
  await cdp.send('Page.navigate', { url: `${baseUrl}/?graphApplyTest=1` });
  await waitFor('Boolean(window.__VOLK_ML_AGENT_APPLICATION__) && Boolean(document.querySelector("nav button"))', 'application shell and restricted application API');
  const enteredBuild = await evaluate(`(() => {
    const button = [...document.querySelectorAll('nav button')].find((item) => /build/i.test(item.innerText));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!enteredBuild) throw new Error('Could not enter the existing Build workspace.');
  await waitFor('Boolean(window.__VOLK_ML_AGENT__?.listInstances?.().length && window.__VOLK_ML_GRAPH_APPLY_TEST__)', 'Build workspace and detached fixture bridge');
}

const report = {
  task: 'VOLK-ML Agent Application API D1 browser acceptance',
  browser: null,
  scenarios,
};

try {
  await startServices();
  const browserVersion = await cdp.send('Browser.getVersion');
  report.browser = {
    product: browserVersion.product,
    revision: browserVersion.revision,
    userAgent: await evaluate('navigator.userAgent'),
    viewport: await evaluate('({ width: innerWidth, height: innerHeight })'),
  };

  const firstInspection = await agentRequest('inspectWorkspace');
  if (!firstInspection.ok) throw new Error(`Workspace inspection failed: ${JSON.stringify(firstInspection.error)}`);
  const serializedInspection = JSON.stringify(firstInspection);
  if (serializedInspection.includes('rows') || serializedInspection.includes('selectedNodeId') || serializedInspection.includes('viewMode')) {
    throw new Error('Workspace inspection exposed row or presentation state.');
  }
  const legacy = await canvasAgent('getState');
  if (legacy.apiVersion !== 1) throw new Error('The existing Canvas Agent v1 API changed unexpectedly.');
  await record('restricted-inspection-and-v1-compatibility', 'PASS', { rowsExcluded: true, canvasAgentVersion: legacy.apiVersion });

  const patchFixture = await evaluate('window.__VOLK_ML_GRAPH_APPLY_TEST__.createOccupiedPatchFixture()', true);
  const projectBeforePatch = await currentProject();
  const stagedPatch = await agentRequest('submitGraphPatchProposal', { proposal: patchFixture.proposal });
  if (!stagedPatch.ok || stagedPatch.result.status !== 'staged' || !stagedPatch.result.learnerApplyRequired) {
    throw new Error(`Patch was not staged for learner review: ${JSON.stringify(stagedPatch)}`);
  }
  await waitFor("Boolean(document.querySelector('[data-graph-patch-preview]'))", 'C2 patch preview from D1 API');
  const previewStatus = await agentRequest('inspectProposal');
  if (!previewStatus.ok || previewStatus.result.current?.eligibility !== 'ready-for-human-apply') throw new Error(`Patch preview was not eligible: ${JSON.stringify(previewStatus)}`);
  const projectDuringPatchPreview = await currentProject();
  if (comparableProject(projectBeforePatch) !== comparableProject(projectDuringPatchPreview)) throw new Error('Staging a patch changed the graph before learner Apply.');
  await clickSelector('[data-graph-patch-cancel]');
  await waitFor("!document.querySelector('[data-graph-patch-preview]')", 'patch preview cancellation');
  const patchAfterCancel = await currentProject();
  if (comparableProject(projectBeforePatch) !== comparableProject(patchAfterCancel)) throw new Error('Cancelling the D1 patch preview changed the workspace.');
  await record('patch-proposal-preview-cancel-is-non-mutating', 'PASS', { previewOnly: true, cancelled: true });

  const patchForApply = await evaluate('window.__VOLK_ML_GRAPH_APPLY_TEST__.createOccupiedPatchFixture()', true);
  const patchApply = await agentRequest('submitGraphPatchProposal', { proposal: patchForApply.proposal });
  if (!patchApply.ok) throw new Error(`Could not stage patch for explicit Apply: ${JSON.stringify(patchApply)}`);
  await waitFor("Boolean(document.querySelector('[data-graph-patch-preview]'))", 'patch preview before explicit Apply');
  const beforeExplicitPatchApply = await currentProject();
  if (comparableProject(projectBeforePatch) !== comparableProject(beforeExplicitPatchApply)) throw new Error('Patch preview mutated the graph before the learner clicked Apply.');
  await clickSelector('[data-graph-patch-apply]');
  await waitFor("!document.querySelector('[data-graph-patch-preview]')", 'patch to commit only after explicit Apply');
  const afterPatchApply = await currentProject();
  if (comparableProject(beforeExplicitPatchApply) === comparableProject(afterPatchApply)) throw new Error('Explicit patch Apply did not commit the accepted patch.');
  const patchLifecycle = await agentRequest('inspectProposal');
  if (!patchLifecycle.ok || patchLifecycle.result.current !== null || patchLifecycle.result.history.at(-1)?.status !== 'applied') {
    throw new Error(`Patch lifecycle did not record the explicit learner Apply: ${JSON.stringify(patchLifecycle)}`);
  }
  await record('patch-apply-requires-human-click', 'PASS', { committedAfterClick: true, lifecycle: patchLifecycle.result.history.at(-1) });

  const buildFixture = await evaluate('window.__VOLK_ML_GRAPH_APPLY_TEST__.createBuildAgentFixture()');
  buildFixture.dataset.name = 'private-dataset-name-sentinel';
  buildFixture.dataset.fileContents = 'private-dataset-source-sentinel';
  buildFixture.dataset.rows[0].privateCell = 'private-row-cell-sentinel';
  const currentState = await canvasAgent('getState');
  for (const node of currentState.canvas.nodes) await canvasAgent('removeNode', node.id);
  await canvasAgent('setDataset', buildFixture.dataset);
  const emptyBeforeProposal = await currentProject();
  if (emptyBeforeProposal.graph.nodes.length || emptyBeforeProposal.graph.edges.length) throw new Error('Could not establish the empty Build target using existing Canvas Agent v1 methods.');
  const stagedWhole = await agentRequest('submitGraphProposal', { proposal: buildFixture.proposal });
  if (!stagedWhole.ok || stagedWhole.result.status !== 'staged' || !stagedWhole.result.learnerApplyRequired) {
    throw new Error(`Whole graph was not staged for learner review: ${JSON.stringify(stagedWhole)}`);
  }
  await waitFor("Boolean(document.querySelector('[data-graph-proposal-preview]'))", 'B1 whole-graph preview from D1 API');
  const wholePreview = await agentRequest('inspectProposal');
  if (!wholePreview.ok || wholePreview.result.current?.eligibility !== 'ready-for-human-apply') throw new Error(`Whole graph preview was not eligible: ${JSON.stringify(wholePreview)}`);
  const projectDuringWholePreview = await currentProject();
  if (comparableProject(emptyBeforeProposal) !== comparableProject(projectDuringWholePreview)) throw new Error('Whole-graph proposal changed the target before learner Apply.');
  const dataInspection = await agentRequest('inspectWorkspace');
  const serializedDataInspection = JSON.stringify(dataInspection);
  if (serializedDataInspection.includes('private-dataset-name-sentinel')
    || serializedDataInspection.includes('private-dataset-source-sentinel')
    || serializedDataInspection.includes('private-row-cell-sentinel')
    || /"rows"\s*:/.test(serializedDataInspection)) throw new Error('Workspace inspection exposed raw dataset values or row fields.');
  await clickSelector('[data-graph-proposal-apply]');
  await waitFor("!document.querySelector('[data-graph-proposal-preview]')", 'whole graph to commit after explicit Apply');
  const applied = await currentProject();
  if (applied.graph.nodes.length !== buildFixture.proposal.graph.nodes.length) throw new Error('Explicit whole-graph Apply did not commit the proposal topology.');
  const appliedLifecycle = await agentRequest('inspectProposal');
  if (!appliedLifecycle.ok || appliedLifecycle.result.current !== null || appliedLifecycle.result.history.at(-1)?.status !== 'applied') {
    throw new Error(`Whole graph lifecycle did not record explicit Apply: ${JSON.stringify(appliedLifecycle)}`);
  }
  await record('whole-graph-proposal-preview-then-learner-apply', 'PASS', { previewWasNonMutating: true, appliedNodes: applied.graph.nodes.length });

  await canvasAgent('run');
  await waitForRuntimeStatus('succeeded');
  const resultsBeforeLayoutApply = await agentRequest('inspectResults');
  if (!resultsBeforeLayoutApply.ok || !resultsBeforeLayoutApply.result.current) {
    throw new Error(`Normal browser Run did not produce a current application result: ${JSON.stringify(resultsBeforeLayoutApply)}`);
  }
  const layoutBaseProject = await currentProject();
  const layoutNode = layoutBaseProject.graph.nodes[0];
  const layoutProposalResult = createGraphPatchProposal({
    baseGraph: graphPatchBaseFromProject(layoutBaseProject),
    operations: [{ op: 'MOVE_NODE', nodeId: layoutNode.id, position: { x: layoutNode.position.x + 36, y: layoutNode.position.y + 18 } }],
    source: { producer: 'external-agent', provenance: { artifactId: 'd1-layout-freshness', revision: '1', location: 'inline' } },
    rationale: 'Verify that a layout-only Apply preserves current browser result provenance.',
  });
  if (!layoutProposalResult.ok) throw new Error(`Could not create the layout-only freshness patch: ${JSON.stringify(layoutProposalResult.diagnostics)}`);
  const stagedLayout = await agentRequest('submitGraphPatchProposal', { proposal: layoutProposalResult.proposal });
  if (!stagedLayout.ok) throw new Error(`Could not stage the layout-only freshness patch: ${JSON.stringify(stagedLayout)}`);
  await waitFor("Boolean(document.querySelector('[data-graph-patch-preview]'))", 'layout-only patch preview');
  await clickSelector('[data-graph-patch-apply]');
  await waitFor("!document.querySelector('[data-graph-patch-preview]')", 'layout-only patch Apply');
  const resultsAfterLayoutApply = await agentRequest('inspectResults');
  if (!resultsAfterLayoutApply.ok || !resultsAfterLayoutApply.result.current
    || resultsAfterLayoutApply.result.freshness !== resultsBeforeLayoutApply.result.freshness
    || JSON.stringify(resultsAfterLayoutApply.result.result) !== JSON.stringify(resultsBeforeLayoutApply.result.result)
    || resultsAfterLayoutApply.result.provenance !== resultsBeforeLayoutApply.result.provenance) {
    throw new Error(`Layout-only Apply incorrectly invalidated current results: ${JSON.stringify({ before: resultsBeforeLayoutApply, after: resultsAfterLayoutApply })}`);
  }
  await record('layout-only-apply-preserves-current-results', 'PASS', { currentBefore: true, currentAfter: true, provenance: resultsAfterLayoutApply.result.provenance });

  const stagedStaleCandidate = await agentRequest('submitGraphProposal', { proposal: buildFixture.proposal });
  if (!stagedStaleCandidate.ok) throw new Error(`Could not stage the dataset freshness scenario: ${JSON.stringify(stagedStaleCandidate)}`);
  await waitFor("Boolean(document.querySelector('[data-graph-proposal-preview]'))", 'second preview for dataset freshness');
  const changedDataset = structuredClone(buildFixture.dataset);
  changedDataset.rows[0].quality += 0.25;
  await canvasAgent('setDataset', changedDataset);
  await waitFor("document.querySelector('[data-graph-proposal-apply]')?.disabled === true", 'proposal to disable after dataset change');
  const freshStatus = await agentRequest('inspectProposal');
  if (!freshStatus.ok || freshStatus.result.current?.status !== 'stale'
    || !freshStatus.result.current.diagnosticCodes.includes('BUILD_DATASET_STALE')) {
    throw new Error(`Agent inspection did not report the proposal as stale: ${JSON.stringify(freshStatus)}`);
  }
  const graphBeforeStaleCancel = await currentProject();
  await clickSelector('[data-graph-proposal-cancel]');
  const graphAfterStaleCancel = await currentProject();
  if (comparableProject(graphBeforeStaleCancel) !== comparableProject(graphAfterStaleCancel)) throw new Error('Cancelling stale proposal changed the workspace.');
  await canvasAgent('setDataset', buildFixture.dataset);
  await record('proposal-freshness-is-recomputed-and-stale-is-blocked', 'PASS', { diagnostic: 'BUILD_DATASET_STALE', graphUnchangedOnCancel: true });

  const semanticBaseProject = await currentProject();
  const semanticNode = semanticBaseProject.graph.nodes.find((node) => node.data.manifest.properties?.some((property) => ['number', 'slider'].includes(property.type)));
  const semanticProperty = semanticNode?.data.manifest.properties.find((property) => ['number', 'slider'].includes(property.type));
  if (!semanticNode || !semanticProperty) throw new Error('The applied Build graph has no numeric semantic parameter for freshness invalidation.');
  const semanticBeforeValue = semanticNode.data.parameters[semanticProperty.key] ?? semanticProperty.default;
  const semanticStep = semanticProperty.step ?? 1;
  let semanticAfterValue = semanticBeforeValue + semanticStep;
  if (Number.isFinite(semanticProperty.max) && semanticAfterValue > semanticProperty.max) semanticAfterValue = semanticBeforeValue - semanticStep;
  if (Number.isFinite(semanticProperty.min) && semanticAfterValue < semanticProperty.min) semanticAfterValue = semanticBeforeValue + semanticStep;
  const semanticFreshnessPatch = createGraphPatchProposal({
    baseGraph: graphPatchBaseFromProject(semanticBaseProject),
    operations: [{
      op: 'UPDATE_PARAMETERS',
      nodeId: semanticNode.id,
      parameters: { ...semanticNode.data.parameters, [semanticProperty.key]: semanticAfterValue },
    }],
    source: { producer: 'external-agent', provenance: { artifactId: 'd1-semantic-freshness', revision: '1', location: 'inline' } },
    rationale: 'Verify that a semantic Apply invalidates current browser result provenance.',
  });
  if (!semanticFreshnessPatch.ok) throw new Error(`Could not create the semantic freshness patch: ${JSON.stringify(semanticFreshnessPatch.diagnostics)}`);
  const stagedSemanticFreshnessPatch = await agentRequest('submitGraphPatchProposal', { proposal: semanticFreshnessPatch.proposal });
  if (!stagedSemanticFreshnessPatch.ok) throw new Error(`Could not stage the semantic freshness patch: ${JSON.stringify(stagedSemanticFreshnessPatch)}`);
  await waitFor("Boolean(document.querySelector('[data-graph-patch-preview]'))", 'semantic freshness patch preview');
  await clickSelector('[data-graph-patch-apply]');
  await waitFor("!document.querySelector('[data-graph-patch-preview]')", 'semantic freshness patch Apply');
  const resultsAfterSemanticApply = await agentRequest('inspectResults');
  if (!resultsAfterSemanticApply.ok || resultsAfterSemanticApply.result.current
    || resultsAfterSemanticApply.result.freshness !== 'none') {
    throw new Error(`Semantic Apply did not invalidate the browser result binding: ${JSON.stringify(resultsAfterSemanticApply)}`);
  }
  await record('semantic-apply-invalidates-current-results', 'PASS', { current: false, freshness: resultsAfterSemanticApply.result.freshness });

  const runBefore = await canvasAgent('getState');
  const runResponse = await agentRequest('run');
  const runAfter = await canvasAgent('getState');
  if (runResponse.ok || runResponse.error?.code !== 'USER_CONFIRMATION_REQUIRED') throw new Error(`Agent run did not require learner confirmation: ${JSON.stringify(runResponse)}`);
  if (runAfter.execution.runtime.status !== runBefore.execution.runtime.status) throw new Error('Rejected agent run changed execution state.');
  const sourceArtifact = await agentRequest('exportGraph', { framework: 'pytorch' });
  if (!sourceArtifact.ok || sourceArtifact.result.executed || sourceArtifact.result.downloaded) throw new Error(`Source export had unexpected execution/download side effects: ${JSON.stringify(sourceArtifact.error ?? sourceArtifact.result)}`);
  await record('run-requires-confirmation-and-export-is-source-only', 'PASS', { runCode: runResponse.error.code, executed: sourceArtifact.result.executed, downloaded: sourceArtifact.result.downloaded });

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
  if (cdp) cdp.close();
  stopProcess(chromeProcess);
  stopProcess(viteProcess);
  try { fs.rmSync(chromeProfile, { recursive: true, force: true }); } catch {}
}
