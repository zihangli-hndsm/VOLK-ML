import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createOnnxGraphProposal, createTorchExportGraphProposal } from '../src/core/graph/workspaceProposal.js';

const repoRoot = process.cwd();
const python = process.env.ONNX_PYTHON ?? process.env.PYTHON ?? 'python';
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-capacity-import-repair-'));
const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-capacity-import-repair-chrome-'));
const chromePath = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const pythonEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
const browserErrors = [];
const cloudRequests = [];
let viteProcess = null;
let chromeProcess = null;
let cdp = null;

function stopProcess(child) {
  if (child && child.exitCode === null) {
    try { child.kill(); } catch {}
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id && message.method) {
        Promise.resolve(this.handlers.get(message.method)?.(message.params)).catch(() => {});
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
  onEvent(method, handler) { this.handlers.set(method, handler); }
  close() { this.socket.close(); }
}

async function evaluate(expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.result?.description ?? result.exceptionDetails.text ?? 'Browser evaluation failed.');
  return result.result?.value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression, true)) return;
    await sleep(100);
  }
  const details = await evaluate('({url:location.href,text:document.body?.innerText?.slice(-1800)})');
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify({ ...details, browserErrors: browserErrors.slice(-6) })}`);
}

async function click(selector) {
  const clicked = await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) return false; element.click(); return true; })()`);
  assert.equal(clicked, true, `Can click ${selector}.`);
  await sleep(150);
}

async function closeBuildMoreIfOpen() {
  const isOpen = await evaluate('document.querySelector("[data-build-toolbar] button[aria-expanded]")?.getAttribute("aria-expanded") === "true"');
  if (isOpen) await click('[data-build-toolbar] button[aria-expanded]');
}

async function agentCall(method, ...args) {
  return evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => api.${method}(...${JSON.stringify(args)}))`, true);
}

async function upload(selector, filePath) {
  const documentNode = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector });
  assert.ok(nodeId, `The production file picker ${selector} is mounted.`);
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [filePath] });
  await evaluate(`document.querySelector(${JSON.stringify(selector)})?.dispatchEvent(new Event('change',{bubbles:true}))`);
}

async function setLanguages(primary) {
  await click('nav button[aria-controls="global-more-actions"]');
  await waitFor('Boolean(document.querySelector("#global-more-actions"))', 'global settings menu');
  const opened = await evaluate('(() => { const button=[...document.querySelectorAll("#global-more-actions button")].find((item)=>/language|语言/i.test(item.innerText)); if(!button)return false; button.click(); return true; })()');
  assert.equal(opened, true, 'Language settings open through the existing UI.');
  await waitFor('Boolean([...document.querySelectorAll("label")].find((label)=>/primary language|主要语言|主语言/i.test(label.innerText))?.querySelector("select"))', 'language dialog');
  const applied = await evaluate(`(() => {
    const labels=[...document.querySelectorAll('label')];
    const primaryLabel=labels.find((label)=>/primary language|主要语言|主语言/i.test(label.innerText));
    const parallelLabel=labels.find((label)=>/parallel language|并行语言/i.test(label.innerText));
    if(!primaryLabel||!parallelLabel)return false;
    const set=(select,value)=>{const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(select,value);select.dispatchEvent(new Event('change',{bubbles:true}));};
    set(primaryLabel.querySelector('select'),${JSON.stringify(primary)}); set(parallelLabel.querySelector('select'),'none');
    const dialog=primaryLabel.closest('div.fixed.inset-0'); const button=[...dialog.querySelectorAll('button')].find((item)=>/apply|应用/i.test(item.innerText));
    if(!button)return false; button.click(); return true;
  })()`);
  assert.equal(applied, true, `The existing language control applies ${primary}.`);
}

function semanticGraph(project) {
  const nodes = project.graph.nodes.map((node) => ({
    id: node.id,
    componentId: node.data.manifest.id,
    op: node.data.manifest.op,
    parameters: node.data.parameters,
  })).sort((left, right) => left.id.localeCompare(right.id));
  const edges = project.graph.edges.map(({ source, sourceHandle, target, targetHandle }) => ({ source, sourceHandle, target, targetHandle }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return { nodes, edges };
}

function makeOnnxDocument() {
  const probe = spawnSync(python, ['-c', 'import onnx, numpy; print(onnx.__version__)'], { encoding: 'utf8', env: pythonEnv });
  assert.equal(probe.status, 0, `The configured ONNX Python environment is usable: ${probe.stderr ?? probe.error ?? ''}`);
  const source = [
    'import json, sys',
    'from pathlib import Path',
    'root=Path(sys.argv[1])',
    'sys.path.insert(0,str(root / "tests"))',
    'sys.path.insert(0,str(root / "tools" / "onnx"))',
    'from onnx_model_fixtures import make_model',
    'from extract_onnx import extract_model',
    'print(json.dumps(extract_model(make_model("gemm-mlp"), model_identifier="capacity-repair-browser"),separators=(",",":")))',
  ].join('\n');
  const result = spawnSync(python, ['-c', source, repoRoot], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, env: pythonEnv });
  assert.equal(result.status, 0, `A real ONNX ModelProto is normalized for the browser import: ${result.stderr ?? ''}`);
  return JSON.parse(result.stdout.trim());
}

const b2Path = path.resolve(repoRoot, 'fixtures/torch-export/linear-relu.json');
const b2Document = JSON.parse(fs.readFileSync(b2Path, 'utf8'));
const b2Proposal = createTorchExportGraphProposal(b2Document);
assert.equal(b2Proposal.ok, true, 'The canonical B2 fixture produces a valid production import proposal.');
const b3Document = makeOnnxDocument();
const b3Path = path.join(tempRoot, 'normalized-onnx.json');
fs.writeFileSync(b3Path, JSON.stringify(b3Document), 'utf8');
const b3Proposal = createOnnxGraphProposal(b3Document);
assert.equal(b3Proposal.ok, true, 'The extracted B3 fixture produces a valid production import proposal.');

const scenarios = [
  { id: 'B2 Torch Export', filePath: b2Path, picker: '[data-torch-export-document-input]', importButton: '[data-torch-export-import]', expected: b2Proposal.proposal, language: 'en' },
  { id: 'B3 normalized ONNX', filePath: b3Path, picker: '[data-onnx-document-input]', importButton: '[data-onnx-import]', expected: b3Proposal.proposal, language: 'zh' },
];

let result = { task: 'G2 imported architecture repair prompt', scenarios: [] };
try {
  const appPort = await freePort();
  const debugPort = await freePort();
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const debugUrl = `http://127.0.0.1:${debugPort}/json/list`;
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'], {
    cwd: repoRoot, env: { ...process.env, VITE_VOLK_API_URL: '' }, stdio: 'inherit',
  });
  await waitForHttp(`${baseUrl}/`);
  chromeProcess = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`, '--window-size=1440,1000',
    `--user-data-dir=${chromeProfile}`, 'about:blank',
  ], { stdio: 'ignore' });
  await waitForHttp(debugUrl);
  const pages = await (await fetch(debugUrl)).json();
  const page = pages.find((item) => item.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'The mounted Chrome page is available.');
  cdp = new CdpClient(page.webSocketDebuggerUrl);
  cdp.onEvent('Runtime.exceptionThrown', ({ exceptionDetails }) => browserErrors.push(exceptionDetails?.text ?? 'browser exception'));
  cdp.onEvent('Network.requestWillBeSent', ({ request }) => {
    if (request?.url?.includes('/v0/lumi/respond')) cloudRequests.push(request.url);
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Page.navigate', { url: baseUrl });
  await waitFor('Boolean(document.querySelector("header nav button[aria-pressed]"))', 'mounted app shell');
  await waitFor('typeof window.__VOLK_ML_AGENT__?.open === "function"', 'mounted Build workspace agent');
  const enteredBuild = await evaluate('(() => { const button=[...document.querySelectorAll("header nav button[aria-pressed]")].find((item)=>item.getAttribute("aria-pressed")!=="true"&&item.innerText.toLowerCase().includes("build")); if(!button)return true; button.click(); return true; })()');
  assert.equal(enteredBuild, true);
  await waitFor('Boolean(document.querySelector("[data-build-toolbar]"))', 'Build toolbar');

  for (const scenario of scenarios) {
    await setLanguages(scenario.language);
    await closeBuildMoreIfOpen();
    const current = await agentCall('getProject');
    current.graph = { nodes: [], edges: [] };
    current.data = null;
    current.trainedModel = null;
    current.customComponents = [];
    await agentCall('loadProject', current);
    const emptyBeforePreview = await agentCall('getProject');
    assert.equal(emptyBeforePreview.graph.nodes.length, 0);
    assert.equal(emptyBeforePreview.graph.edges.length, 0);
    assert.equal(emptyBeforePreview.data, null);

    await click('[data-build-toolbar] button[aria-expanded]');
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(scenario.importButton)}))`, `${scenario.id} import menu action`);
    await click(scenario.importButton);
    await upload(scenario.picker, scenario.filePath);
    await waitFor('Boolean(document.querySelector("[data-graph-proposal-preview]"))', `${scenario.id} read-only proposal preview`);
    assert.equal(semanticGraph(await agentCall('getProject')).nodes.length, 0, `${scenario.id}: staging does not mutate Build.`);
    const applyEnabled = await evaluate('document.querySelector("[data-graph-proposal-apply]")?.disabled === false');
    assert.equal(applyEnabled, true, `${scenario.id}: only explicit learner Apply can commit the proposal.`);
    await click('[data-graph-proposal-apply]');
    await waitFor('!document.querySelector("[data-graph-proposal-preview]")', `${scenario.id} explicit Apply completion`);

    const appliedProject = await agentCall('getProject');
    assert.deepEqual(semanticGraph(appliedProject), semanticGraph({ graph: scenario.expected.graph }), `${scenario.id}: explicit Apply installs its canonical architecture.`);
    assert.equal(appliedProject.data, null, `${scenario.id}: architecture import does not invent a dataset.`);
    assert.equal(appliedProject.trainedModel, null, `${scenario.id}: architecture import does not invent trained weights.`);
    const hiddenDenseId = scenario.expected.graph.nodes.find((node) => node.data.manifest.op === 'dense')?.id;
    assert.ok(hiddenDenseId, `${scenario.id}: the normalized graph has a registered Dense node.`);
    const beforePromptState = await agentCall('getState');
    await agentCall('selectNode', hiddenDenseId);
    await click('[data-build-toolbar] button[aria-expanded]');
    await waitFor('Boolean(document.querySelector("[data-explore-capacity-bridge-repair]"))', `${scenario.id} visible repair prompt`);
    const prompt = await evaluate(`(() => { const panel=document.querySelector('[data-explore-capacity-bridge-repair]'); return panel ? {text:panel.innerText,selected:panel.dataset.selectedNodeId,reason:panel.dataset.reasonCode,codes:panel.dataset.repairCodes,live:panel.getAttribute('aria-live')} : null; })()`);
    assert.equal(prompt.selected, hiddenDenseId, `${scenario.id}: the prompt binds the exact selected hidden layer.`);
    assert.equal(prompt.reason, 'DATASET_MISSING');
    assert.equal(prompt.codes, 'DATASET_PIPELINE_REQUIRED,TRAINING_EVALUATION_PATH_REQUIRED');
    assert.equal(prompt.live, 'polite');
    if (scenario.language === 'en') {
      assert.match(prompt.text, /Dataset → Train\/Test Split/);
      assert.match(prompt.text, /Supervised Trainer/);
      assert.match(prompt.text, /imported architecture remains unchanged/);
    } else {
      assert.match(prompt.text, /数据集/);
      assert.match(prompt.text, /监督训练器/);
      assert.match(prompt.text, /导入的模型结构保持不变/);
    }
    assert.equal(await evaluate('Boolean(document.querySelector("button[data-explore-capacity-bridge]"))'), false, `${scenario.id}: unsupported architecture cannot start a capacity session.`);
    assert.equal(await evaluate('Boolean(document.querySelector("[data-capacity-run], [data-capacity-results], [data-explore-capacity-bridge][data-lifecycle]"))'), false, `${scenario.id}: no comparison session or result was created.`);
    const graphAfterPrompt = semanticGraph(await agentCall('getProject'));
    assert.deepEqual(graphAfterPrompt, semanticGraph(appliedProject), `${scenario.id}: viewing guidance preserves the explicitly applied graph.`);
    const stateAfterPrompt = await agentCall('getState');
    assert.equal(JSON.stringify(stateAfterPrompt.execution.runtime), JSON.stringify(beforePromptState.execution.runtime), `${scenario.id}: viewing guidance does not run the model.`);
    assert.equal((await agentCall('getProject')).trainedModel, null);

    await click('[data-build-primary="run"]');
    await waitFor('Boolean(document.querySelector("div.fixed.z-50 h2"))', `${scenario.id} Runner dialog`);
    const runner = await evaluate(`(() => ({execute: Boolean(document.querySelector('[data-runner-execute]')),text:document.body.innerText.slice(-1600)}))()`);
    assert.equal(runner.execute, false, `${scenario.id}: unsupported imported architecture has no executable Runner action.`);
    const closeRunner = await evaluate('(() => { const root=document.querySelector("div.fixed.z-50"); const button=root?.querySelector("button[aria-label]"); if(!button)return false; button.click(); return true; })()');
    assert.equal(closeRunner, true, `${scenario.id}: the inspection runner can be closed without execution.`);
    assert.equal(JSON.stringify((await agentCall('getState')).execution.runtime), JSON.stringify(beforePromptState.execution.runtime));
    result.scenarios.push({ id: scenario.id, status: 'PASS', selectedHiddenDenseId: hiddenDenseId, repairCodes: prompt.codes, language: scenario.language });
  }

  assert.deepEqual(cloudRequests, [], 'The local repair projection must not call Cloud policy.');
  assert.deepEqual(browserErrors, [], 'The mounted browser has no runtime exceptions.');
  result.result = 'PASS';
} catch (error) {
  result.result = 'FAIL';
  result.error = error?.stack ?? String(error);
  throw error;
} finally {
  result.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(result, null, 2));
  cdp?.close();
  stopProcess(chromeProcess);
  stopProcess(viteProcess);
  try { fs.rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
}
