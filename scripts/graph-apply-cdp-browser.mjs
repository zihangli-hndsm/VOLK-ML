import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const baseUrl = 'http://127.0.0.1:5175';
const chromeDebugUrl = 'http://127.0.0.1:9225/json/list';
const evidenceDirectory = path.resolve('docs/acceptance/assets/graph-apply-b1');
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputDirectory = path.join(evidenceDirectory, runId);
const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-graph-apply-chrome-'));
let viteProcess = null;
let chromeProcess = null;
let cdp = null;
const scenarios = [];

fs.mkdirSync(outputDirectory, { recursive: true });

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
      if (!message.id || !this.pending.has(message.id)) return;
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Browser evaluation failed.');
  return result.result?.value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicateExpression, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(predicateExpression)) return;
    await sleep(100);
  }
  const details = await evaluate('({ url: location.href, title: document.title, text: document.body?.innerText?.slice(0, 2500) })');
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(details)}`);
}

async function clickSelector(selector) {
  const clicked = await evaluate(`(() => { const item = document.querySelector(${JSON.stringify(selector)}); if (!item || item.disabled) return false; item.click(); return true; })()`);
  if (!clicked) throw new Error(`Could not click enabled control ${selector}`);
  await sleep(180);
}

async function captureScreenshot(filename) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(outputDirectory, filename), Buffer.from(result.data, 'base64'));
}

async function agentCall(method, ...args) {
  return evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => api.${method}(...${JSON.stringify(args)}))`, true);
}

async function currentProject() {
  return agentCall('getProject');
}

function comparableProject(project) {
  const copy = structuredClone(project);
  delete copy.savedAt;
  return JSON.stringify(copy);
}

async function stageProposal(proposal) {
  return evaluate(`window.__VOLK_ML_GRAPH_APPLY_TEST__.stageProposal(${JSON.stringify(proposal)})`, true);
}

async function readPreviewState() {
  return evaluate(`(() => {
    const root = document.querySelector('[data-graph-proposal-preview]');
    const apply = root?.querySelector('[data-graph-proposal-apply]');
    const readOnly = root?.querySelector('[data-graph-proposal-readonly]');
    return {
      visible: Boolean(root),
      blockedBy: root?.getAttribute('data-apply-block-code') || null,
      applyDisabled: apply?.disabled ?? null,
      previewNodes: root?.querySelectorAll('[data-graph-preview-node]').length ?? 0,
      interactiveControlsInsideGraph: readOnly?.querySelectorAll('button,input,select,textarea').length ?? 0,
      accessibleDialog: Boolean(root?.querySelector('[role="dialog"][aria-modal="true"]')),
    };
  })()`);
}

async function recordScenario(id, outcome, evidence = {}) {
  scenarios.push({ id, outcome, evidence });
}

async function startServices() {
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5175', '--strictPort'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  viteProcess.on('exit', (code, signal) => console.error(`GRAPH_APPLY_VITE_EXIT code=${code} signal=${signal ?? ''}`));
  await waitForHttp(`${baseUrl}/`);

  chromeProcess = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--disable-gpu',
    '--remote-debugging-port=9225',
    '--window-size=1440,1000',
    `--user-data-dir=${chromeProfile}`,
    'about:blank',
  ], { stdio: 'ignore' });
  chromeProcess.on('exit', (code, signal) => console.error(`GRAPH_APPLY_CHROME_EXIT code=${code} signal=${signal ?? ''}`));
  await waitForHttp(chromeDebugUrl);
  cdp = await connectBrowser();
  await cdp.send('Page.navigate', { url: `${baseUrl}/?graphApplyTest=1` });
  await waitFor('Boolean(document.querySelector("nav button[aria-pressed=\\\"true\\\"]"))', 'application shell');
  const enteredBuild = await evaluate(`(() => {
    const button = [...document.querySelectorAll('nav button')].find((item) => item.getAttribute('aria-pressed') !== 'true' && /build/i.test(item.innerText));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!enteredBuild) throw new Error('Could not enter the existing Build workspace for Apply acceptance.');
  await waitFor('Boolean(window.__VOLK_ML_AGENT__ && window.__VOLK_ML_AGENT__.listInstances().length && window.__VOLK_ML_GRAPH_APPLY_TEST__)', 'Build workspace, local test bridge, and Canvas Agent');
}

const report = {
  task: 'VOLK-ML Graph Infrastructure B1 Apply browser acceptance',
  browser: null,
  scenarios,
  artifacts: {
    directory: outputDirectory,
    previewScreenshot: path.join(outputDirectory, 'graph-apply-preview.png'),
  },
};

try {
  await startServices();
  const browserVersion = await cdp.send('Browser.getVersion');
  const userAgent = await evaluate('navigator.userAgent');
  report.browser = { product: browserVersion.product, revision: browserVersion.revision, userAgent, viewport: await evaluate('({ width: innerWidth, height: innerHeight })') };

  const fixture = await evaluate('window.__VOLK_ML_GRAPH_APPLY_TEST__.createBuildAgentFixture()');
  const initialState = await agentCall('getState');
  for (const node of initialState.canvas.nodes) await agentCall('removeNode', node.id);
  await agentCall('setDataset', fixture.dataset);
  const emptyProject = await currentProject();
  if (emptyProject.graph.nodes.length !== 0 || emptyProject.graph.edges.length !== 0) throw new Error('Could not establish an empty target through the existing graph-removal API.');

  // B: Cancel is a detached UI operation only.
  const beforeCancel = await currentProject();
  const stagedCancel = await stageProposal(fixture.proposal);
  if (!stagedCancel.ok) throw new Error(`Could not stage cancellation scenario: ${JSON.stringify(stagedCancel)}`);
  await waitFor("Boolean(document.querySelector('[data-graph-proposal-preview]'))", 'proposal preview for Cancel');
  const cancelPreview = await readPreviewState();
  await clickSelector('[data-graph-proposal-cancel]');
  await waitFor("!document.querySelector('[data-graph-proposal-preview]')", 'proposal preview to close after Cancel');
  const afterCancel = await currentProject();
  if (comparableProject(beforeCancel) !== comparableProject(afterCancel)) throw new Error('Cancel changed the canonical project.');
  await recordScenario('B-cancel-preserves-workspace', 'PASS', { preview: cancelPreview, canonicalProjectUnchanged: true });

  // C: Occupancy is re-evaluated while a detached preview is open.
  const stageOccupied = await stageProposal(fixture.proposal);
  if (!stageOccupied.ok) throw new Error(`Could not stage occupied-target scenario: ${JSON.stringify(stageOccupied)}`);
  await waitFor("Boolean(document.querySelector('[data-graph-proposal-preview]'))", 'proposal preview for occupancy check');
  await agentCall('addNode', { componentId: 'relu_node', id: 'graph-apply-occupied-probe', position: { x: 45, y: 55 } });
  await waitFor("document.querySelector('[data-graph-proposal-apply]')?.disabled === true", 'Apply to disable for occupied target');
  const occupiedPreview = await readPreviewState();
  if (occupiedPreview.blockedBy !== 'TARGET_WORKSPACE_NOT_EMPTY') throw new Error(`Unexpected occupied-target diagnostic: ${JSON.stringify(occupiedPreview)}`);
  const occupiedProjectBeforeCancel = await currentProject();
  await clickSelector('[data-graph-proposal-cancel]');
  const occupiedProjectAfterCancel = await currentProject();
  if (comparableProject(occupiedProjectBeforeCancel) !== comparableProject(occupiedProjectAfterCancel)) throw new Error('Cancel mutated the intentionally occupied workspace.');
  await agentCall('removeNode', 'graph-apply-occupied-probe');
  await recordScenario('C-target-occupied-during-preview', 'PASS', { preview: occupiedPreview, proposalDidNotReplaceTarget: true });

  // D: A changed dataset remains authoritative and makes the Build Agent proposal stale.
  const stageStale = await stageProposal(fixture.proposal);
  if (!stageStale.ok) throw new Error(`Could not stage stale-dataset scenario: ${JSON.stringify(stageStale)}`);
  await waitFor("Boolean(document.querySelector('[data-graph-proposal-preview]'))", 'proposal preview for dataset freshness check');
  const changedDataset = structuredClone(fixture.dataset);
  changedDataset.rows[0].quality += 0.25;
  await agentCall('setDataset', changedDataset);
  await waitFor("document.querySelector('[data-graph-proposal-apply]')?.disabled === true", 'Apply to disable for stale dataset');
  const stalePreview = await readPreviewState();
  if (stalePreview.blockedBy !== 'BUILD_DATASET_STALE') throw new Error(`Unexpected stale-dataset diagnostic: ${JSON.stringify(stalePreview)}`);
  const staleProjectBeforeCancel = await currentProject();
  await clickSelector('[data-graph-proposal-cancel]');
  const staleProjectAfterCancel = await currentProject();
  if (comparableProject(staleProjectBeforeCancel) !== comparableProject(staleProjectAfterCancel)) throw new Error('Cancel changed the current dataset or project.');
  await agentCall('setDataset', fixture.dataset);
  await recordScenario('D-dataset-changed-during-preview', 'PASS', { preview: stalePreview, staleDatasetPreservedUntilExplicitReset: true });

  // A: Same app-level path; the real local Build Agent APIs create and adapt the proposal.
  const projectBeforeApply = await currentProject();
  const stateBeforeApply = await agentCall('getState');
  const stagedApply = await stageProposal(fixture.proposal);
  if (!stagedApply.ok) throw new Error(`Could not stage Apply scenario: ${JSON.stringify(stagedApply)}`);
  await waitFor("Boolean(document.querySelector('[data-graph-proposal-preview]'))", 'production proposal preview');
  const readyPreview = await readPreviewState();
  if (!readyPreview.accessibleDialog || readyPreview.applyDisabled || readyPreview.interactiveControlsInsideGraph !== 0) {
    throw new Error(`Preview was not read-only and eligible: ${JSON.stringify(readyPreview)}`);
  }
  if (readyPreview.previewNodes !== fixture.proposal.graph.nodes.length) throw new Error('Read-only preview did not render the complete proposed graph.');
  const projectBeforeApplyAfterPreview = await currentProject();
  const stateBeforeApplyAfterPreview = await agentCall('getState');
  if (comparableProject(projectBeforeApply) !== comparableProject(projectBeforeApplyAfterPreview)) throw new Error('Opening Preview changed project serialization.');
  if (JSON.stringify(stateBeforeApply.execution.runtime) !== JSON.stringify(stateBeforeApplyAfterPreview.execution.runtime)) throw new Error('Opening Preview changed runtime state.');
  await captureScreenshot('graph-apply-preview.png');
  await clickSelector('[data-graph-proposal-apply]');
  await waitFor("!document.querySelector('[data-graph-proposal-preview]')", 'preview to close after successful Apply');
  const appliedProject = await currentProject();
  if (appliedProject.graph.nodes.length !== fixture.proposal.graph.nodes.length || appliedProject.graph.edges.length !== fixture.proposal.graph.edges.length) throw new Error('Apply did not commit the proposal topology.');
  const appliedById = new Map(appliedProject.graph.nodes.map((node) => [node.id, node]));
  for (const candidateNode of fixture.proposal.graph.nodes) {
    const appliedNode = appliedById.get(candidateNode.id);
    if (!appliedNode || JSON.stringify(appliedNode.data.parameters) !== JSON.stringify(candidateNode.data.parameters)
      || JSON.stringify(appliedNode.position) !== JSON.stringify(candidateNode.position)
      || JSON.stringify(appliedNode.data.label) !== JSON.stringify(candidateNode.data.label ?? candidateNode.data.manifest.name)) {
      throw new Error(`Applied node differs from canonical revalidated proposal: ${candidateNode.id}`);
    }
    if (appliedNode.data.status !== 'idle') throw new Error(`Applied node status was not reset: ${candidateNode.id}`);
  }
  if (comparableProject({ ...projectBeforeApply, graph: appliedProject.graph, customComponents: appliedProject.customComponents, trainedModel: appliedProject.trainedModel }) !== comparableProject(appliedProject)) {
    throw new Error('Apply changed metadata or current dataset outside the graph/required definitions/model reset.');
  }
  if (appliedProject.trainedModel !== null) throw new Error('Successful Apply did not clear the prior model slot.');
  await recordScenario('A-build-agent-preview-and-apply', 'PASS', { preview: readyPreview, proposalId: fixture.proposal.proposalId, nodes: appliedProject.graph.nodes.length, edges: appliedProject.graph.edges.length, datasetPreserved: true, metadataPreserved: true });

  // Ordinary graph operations remain available after Apply.
  const split = appliedProject.graph.nodes.find((node) => node.data.manifest.id === 'train_test_split_node');
  const dataNode = appliedProject.graph.nodes.find((node) => node.data.manifest.id === 'tabular_data_node');
  if (!split || !dataNode) throw new Error('Applied graph is not an ordinary editable VOLK graph.');
  await agentCall('selectNode', split.id);
  await agentCall('updateNode', split.id, {
    position: { x: split.position.x + 18, y: split.position.y + 12 },
    parameters: { train_ratio: 0.75 },
  });
  await agentCall('addNode', { componentId: 'train_test_split_node', id: 'graph-apply-connectivity-probe', position: { x: 340, y: 430 } });
  await agentCall('connect', { id: 'graph-apply-connectivity-edge', source: dataNode.id, sourceHandle: 'dataset', target: 'graph-apply-connectivity-probe', targetHandle: 'dataset' });
  await agentCall('disconnect', 'graph-apply-connectivity-edge');
  await agentCall('removeNode', 'graph-apply-connectivity-probe');
  const editedProject = await currentProject();
  if (editedProject.graph.nodes.find((node) => node.id === split.id)?.data.parameters.train_ratio !== 0.75) throw new Error('Applied graph parameter edit did not persist.');
  const runResult = await agentCall('run');
  if (!runResult?.type) throw new Error('Applied graph did not run through the ordinary browser runtime.');
  const exported = await agentCall('exportCode', 'pytorch');
  if (typeof exported !== 'string' || exported.length < 100) throw new Error('Applied graph did not export through the ordinary compiler path.');
  const download = await agentCall('downloadProject');
  if (!download?.filename || download.bytes < 100) throw new Error('Applied graph did not serialize/download through the ordinary project path.');
  await waitFor("document.querySelector('[data-build-toolbar]')?.innerText.includes('Saved locally')", 'ordinary local autosave after Apply and edit', 12000);
  await recordScenario('ordinary-edit-connect-run-export-save', 'PASS', { parameterEdited: true, moved: true, selected: true, connectedAndDisconnected: true, removed: true, runType: runResult.type, exportCharacters: exported.length, projectSerializationFilename: download.filename, projectSerializationBytes: download.bytes, autosavedLocally: true });

  // B0.1: A rebuilt composite keeps its source catalogue template while the applied instance keeps its own parameters.
  const beforeCompositeState = await agentCall('getState');
  for (const node of beforeCompositeState.canvas.nodes) await agentCall('removeNode', node.id);
  const compositeFixture = await evaluate('window.__VOLK_ML_GRAPH_APPLY_TEST__.createRebuiltCompositeFixture()');
  const proposedCompositeLabel = compositeFixture.proposal.graph.nodes[0].data.label
    ?? compositeFixture.proposal.graph.nodes[0].data.manifest.name;
  const projectBeforeComposite = await currentProject();
  const stagedComposite = await stageProposal(compositeFixture.proposal);
  if (!stagedComposite.ok) throw new Error(`Could not stage rebuilt-composite scenario: ${JSON.stringify(stagedComposite)}`);
  await waitFor("Boolean(document.querySelector('[data-graph-proposal-preview]'))", 'rebuilt-composite proposal preview');
  const compositePreview = await readPreviewState();
  if (!compositePreview.accessibleDialog || compositePreview.applyDisabled || compositePreview.previewNodes !== 1) {
    throw new Error(`Rebuilt composite was not eligible in the read-only preview: ${JSON.stringify(compositePreview)}`);
  }
  await clickSelector('[data-graph-proposal-apply]');
  await waitFor("!document.querySelector('[data-graph-proposal-preview]')", 'rebuilt-composite preview to close after Apply');
  const compositeProject = await currentProject();
  const compositeInstance = compositeProject.graph.nodes[0];
  const template = compositeProject.customComponents.find((definition) => definition.id === compositeFixture.customComponentId);
  const embeddedDense = compositeInstance?.data?.manifest?.composition?.nodes?.find((node) => node.componentId === 'dense_node');
  const templateDense = template?.composition?.nodes?.find((node) => node.componentId === 'dense_node');
  if (compositeProject.graph.nodes.length !== 1 || compositeProject.graph.edges.length !== 0
    || embeddedDense?.parameters?.units !== compositeFixture.instanceUnits
    || JSON.stringify(compositeInstance?.data?.label) !== JSON.stringify(proposedCompositeLabel)
    || templateDense?.parameters?.units !== compositeFixture.catalogueUnits
    || compositeFixture.instanceUnits === compositeFixture.catalogueUnits) {
    throw new Error('Applying the rebuilt composite did not preserve distinct instance and catalogue-template definitions.');
  }
  if (comparableProject({ ...projectBeforeComposite, graph: compositeProject.graph, customComponents: compositeProject.customComponents, trainedModel: compositeProject.trainedModel }) !== comparableProject(compositeProject)) {
    throw new Error('Applying the composite proposal changed unrelated workspace metadata or dataset.');
  }
  if (await evaluate('window.__VOLK_ML_GRAPH_APPLY_TEST__.validateCurrentProject()', true) !== true) throw new Error('Applied rebuilt composite failed canonical project validation.');
  await recordScenario('B0.1-composite-preview-apply', 'PASS', {
    preview: compositePreview,
    componentId: compositeFixture.customComponentId,
    catalogueTemplateUnits: templateDense.parameters.units,
    appliedInstanceUnits: embeddedDense.parameters.units,
    canonicalProjectValidation: true,
    datasetAndMetadataPreserved: true,
  });

  await captureScreenshot('graph-apply-completed.png');
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = error?.stack ?? String(error);
  if (cdp) {
    try { await captureScreenshot('graph-apply-failure.png'); } catch {}
  }
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(outputDirectory, 'trace.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  cdp?.close();
  stopProcess(chromeProcess);
  stopProcess(viteProcess);
  try { fs.rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  console.log(JSON.stringify(report, null, 2));
}
