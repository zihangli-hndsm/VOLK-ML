import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { artifactFingerprintJsonV1 } from '../src/core/graph/artifactFingerprint.js';

const baseUrl = 'http://127.0.0.1:5176';
const chromeDebugUrl = 'http://127.0.0.1:9226/json/list';
const python = process.env.ONNX_PYTHON ?? process.env.PYTHON ?? 'python';
const pythonConfigured = Boolean(process.env.ONNX_PYTHON || process.env.PYTHON);
const pythonEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-onnx-b3-'));
const normalizedPath = path.join(tempRoot, 'model.onnx.json');
const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-onnx-b3-chrome-'));
let viteProcess = null;
let chromeProcess = null;
let cdp = null;

function stopProcess(child) {
  if (child && child.exitCode === null) {
    try { child.kill(); } catch {}
  }
}

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
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
  assert.ok(page?.webSocketDebuggerUrl, 'Chrome DevTools page is available.');
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('DOM.enable');
  return client;
}

async function evaluate(expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Browser evaluation failed.');
  return result.result?.value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(await evaluate('({url:location.href,text:document.body?.innerText?.slice(0,1600)})'))}`);
}

async function click(selector) {
  const result = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) return false; element.click(); return true; })()`);
  assert.equal(result, true, `Can click ${selector}.`);
  await sleep(150);
}

async function uploadFile(selector, filePath) {
  const documentNode = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector });
  assert.ok(nodeId, `File input ${selector} exists.`);
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [filePath] });
  await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(selector)})?.dispatchEvent(new Event('change',{bubbles:true}))`,
  });
}

async function openOnnxPicker(filePath = normalizedPath) {
  await click('[data-build-toolbar] button[aria-expanded]');
  await waitFor('Boolean(document.querySelector("[data-onnx-import]"))', 'ONNX import action in Build More');
  await click('[data-onnx-import]');
  await uploadFile('[data-onnx-document-input]', filePath);
}

async function openOnnxPickerAndUpload(filePath = normalizedPath) {
  await openOnnxPicker(filePath);
  await waitFor("Boolean(document.querySelector('[data-graph-proposal-preview]'))", 'read-only ONNX proposal preview');
}

async function setLanguages(primary, secondary = null) {
  const opened = await evaluate('(() => { const toggle=document.querySelector("nav button[aria-controls=global-more-actions]"); if (!toggle) return false; toggle.click(); return true; })()');
  assert.equal(opened, true, 'Language settings entry is available.');
  const selected = await evaluate('(() => { const button=[...document.querySelectorAll("#global-more-actions button")].find((item)=>/language|语言/i.test(item.innerText)); if (!button) return false; button.click(); return true; })()');
  assert.equal(selected, true, 'Language settings can be opened.');
  await waitFor('Boolean([...document.querySelectorAll("label")].find((label)=>/primary language|主要语言|主语言/i.test(label.innerText))?.querySelector("select"))', 'language settings dialog');
  const applied = await evaluate(`(() => {
    const labels=[...document.querySelectorAll('label')];
    const primaryLabel=labels.find((label)=>/primary language|主要语言|主语言/i.test(label.innerText));
    const parallelLabel=labels.find((label)=>/parallel language|并行语言/i.test(label.innerText));
    if (!primaryLabel || !parallelLabel) return false;
    const setValue=(select,value)=>{const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(select,value);select.dispatchEvent(new Event('change',{bubbles:true}));};
    setValue(primaryLabel.querySelector('select'),${JSON.stringify(primary)});
    setValue(parallelLabel.querySelector('select'),${JSON.stringify(secondary ?? 'none')});
    const dialog=primaryLabel.closest('div.fixed.inset-0');
    const button=[...dialog.querySelectorAll('button')].find((item)=>/apply|应用/i.test(item.innerText));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(applied, true, 'Requested language mode can be applied.');
}

async function currentProject() {
  return agentCall('getProject');
}

function comparableProject(project) {
  const copy = structuredClone(project);
  delete copy.savedAt;
  return JSON.stringify(copy);
}

function resealDocument(value) {
  value.documentFingerprint = artifactFingerprintJsonV1(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'documentFingerprint')));
  return value;
}

async function agentCall(method, ...args) {
  return evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => api.${method}(...${JSON.stringify(args)}))`, true);
}

async function readPreviewState() {
  return evaluate(`(() => {
    const root=document.querySelector('[data-graph-proposal-preview]');
    const dialog=root?.querySelector('[role="dialog"]');
    const rect=dialog?.getBoundingClientRect();
    const cancel=root?.querySelector('[data-graph-proposal-cancel]')?.getBoundingClientRect();
    return {
      text:root?.innerText ?? '',
      count:root?.querySelectorAll('[data-graph-preview-node]').length ?? 0,
      disabled:root?.querySelector('[data-graph-proposal-apply]')?.disabled ?? null,
      blockedBy:root?.getAttribute('data-apply-block-code') || null,
      dialogRect:rect ? {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height} : null,
      cancelRect:cancel ? {left:cancel.left,top:cancel.top,right:cancel.right,bottom:cancel.bottom,width:cancel.width,height:cancel.height} : null,
      viewport:{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth},
    };
  })()`);
}

function writeNormalizedFixture() {
  const probe = spawnSync(python, ['-c', 'import onnx, numpy; print(onnx.__version__)'], { encoding: 'utf8', env: pythonEnv });
  if (probe.error?.code === 'ENOENT' || probe.status !== 0) {
    assert.ok(!pythonConfigured, `Configured ONNX_PYTHON/PYTHON must provide a working ONNX runtime: ${probe.stderr ?? probe.error}`);
    throw new Error('ONNX browser test requires ONNX and NumPy; set PYTHON to the configured ONNX 1.23 runtime.');
  }
  const source = [
    'import json, sys',
    'from pathlib import Path',
    'root = Path(sys.argv[1])',
    'sys.path.insert(0, str(root / "tests"))',
    'sys.path.insert(0, str(root / "tools" / "onnx"))',
    'from onnx_model_fixtures import make_model',
    'from extract_onnx import extract_model',
    'print(json.dumps(extract_model(make_model("gemm-mlp"), model_identifier="browser_fixture"), separators=(",", ":")))',
  ].join('\n');
  const result = spawnSync(python, ['-c', source, process.cwd()], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, env: pythonEnv });
  assert.equal(result.status, 0, `Real ONNX ModelProto extraction succeeds before browser upload: ${result.stderr}`);
  fs.writeFileSync(normalizedPath, result.stdout.trim(), 'utf8');
  return JSON.parse(result.stdout.trim());
}

const document = writeNormalizedFixture();
let result = { task: 'VOLK-ML Graph Infrastructure B3 ONNX browser acceptance', browser: null, steps: [] };

try {
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5176', '--strictPort'], {
    cwd: process.cwd(), env: process.env, stdio: 'inherit',
  });
  await waitForHttp(`${baseUrl}/`);
  chromeProcess = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=9226', '--window-size=1440,1000',
    `--user-data-dir=${chromeProfile}`, 'about:blank',
  ], { stdio: 'ignore' });
  await waitForHttp(chromeDebugUrl);
  cdp = await connectBrowser();
  await cdp.send('Page.navigate', { url: `${baseUrl}/?graphApplyTest=1` });
  await waitFor('Boolean(document.querySelector("nav button[aria-pressed=\\\"true\\\"]"))', 'application shell');
  const buildEntered = await evaluate(`(() => { const button=[...document.querySelectorAll('nav button')].find((item)=>item.getAttribute('aria-pressed')!=='true'&&/build/i.test(item.innerText)); button?.click(); return Boolean(button); })()`);
  assert.equal(buildEntered, true, 'Enter existing Build workspace.');
  await waitFor('Boolean(window.__VOLK_ML_AGENT__ && window.__VOLK_ML_GRAPH_APPLY_TEST__)', 'Build workspace and graph proposal test bridge');
  const state = await agentCall('getState');
  for (const node of state.canvas.nodes) await agentCall('removeNode', node.id);
  const empty = await agentCall('getProject');
  assert.equal(empty.graph.nodes.length, 0);
  assert.equal(empty.graph.edges.length, 0);
  result.steps.push({ id: 'empty-target-created-through-normal-agent', status: 'PASS' });

  await setLanguages('en');
  const beforeEnglishCancel = await currentProject();
  await openOnnxPickerAndUpload();
  const englishPreview = await readPreviewState();
  assert.match(englishPreview.text, /ONNX adapter/i, 'English preview identifies the ONNX adapter.');
  assert.equal(englishPreview.count, 6, 'English preview shows the complete canonicalized MLP.');
  assert.equal(englishPreview.disabled, false, 'Apply is enabled for the current empty target.');
  assert.equal(comparableProject(beforeEnglishCancel), comparableProject(await currentProject()), 'Opening the ONNX preview leaves the canonical project untouched.');
  await click('[data-graph-proposal-cancel]');
  await waitFor("!document.querySelector('[data-graph-proposal-preview]')", 'English ONNX preview to close after Cancel');
  assert.equal(comparableProject(beforeEnglishCancel), comparableProject(await currentProject()), 'Cancel leaves the canonical project unchanged.');
  result.steps.push({ id: 'onnx-english-preview-cancel-preserves-project', status: 'PASS', preview: englishPreview });

  await setLanguages('zh');
  const beforeChineseCancel = await currentProject();
  await openOnnxPickerAndUpload();
  const chinesePreview = await readPreviewState();
  assert.match(chinesePreview.text, /ONNX 适配器/, 'Chinese ONNX preview is localized.');
  assert.match(chinesePreview.text, /已由适配器验证并从来源文档重新生成图/);
  await click('[data-graph-proposal-cancel]');
  await waitFor("!document.querySelector('[data-graph-proposal-preview]')", 'Chinese ONNX preview to close after Cancel');
  assert.equal(comparableProject(beforeChineseCancel), comparableProject(await currentProject()));
  result.steps.push({ id: 'onnx-chinese-preview-cancel-preserves-project', status: 'PASS' });

  await setLanguages('zh', 'en');
  const beforeParallelCancel = await currentProject();
  await openOnnxPickerAndUpload();
  const parallelPreview = await readPreviewState();
  assert.match(parallelPreview.text, /ONNX 适配器/);
  assert.match(parallelPreview.text, /ONNX adapter/);
  assert.match(parallelPreview.text, /已由适配器验证并从来源文档重新生成图/);
  assert.match(parallelPreview.text, /Adapter-verified; graph rematerialized from source/);
  await click('[data-graph-proposal-cancel]');
  await waitFor("!document.querySelector('[data-graph-proposal-preview]')", 'parallel-language ONNX preview to close after Cancel');
  assert.equal(comparableProject(beforeParallelCancel), comparableProject(await currentProject()));
  result.steps.push({ id: 'onnx-parallel-language-preview-cancel-preserves-project', status: 'PASS' });

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await waitFor('innerWidth === 390', 'compact viewport');
  const beforeCompactCancel = await currentProject();
  await openOnnxPickerAndUpload();
  const compactPreview = await readPreviewState();
  assert.equal(compactPreview.count, 6, 'Compact preview renders the complete ONNX proposal.');
  assert.equal(compactPreview.disabled, false);
  assert.ok(compactPreview.dialogRect.left >= 0 && compactPreview.dialogRect.right <= compactPreview.viewport.width, 'Preview dialog fits the compact viewport horizontally.');
  assert.ok(compactPreview.dialogRect.top >= 0 && compactPreview.dialogRect.bottom <= compactPreview.viewport.height, 'Preview dialog fits the compact viewport vertically.');
  assert.ok(compactPreview.cancelRect.left >= 0 && compactPreview.cancelRect.right <= compactPreview.viewport.width, 'Cancel remains reachable in compact layout.');
  assert.ok(compactPreview.cancelRect.top >= 0 && compactPreview.cancelRect.bottom <= compactPreview.viewport.height, 'Cancel remains visible in compact layout.');
  assert.ok(compactPreview.viewport.documentWidth <= compactPreview.viewport.width, 'Compact ONNX preview does not create horizontal page overflow.');
  await click('[data-graph-proposal-cancel]');
  await waitFor("!document.querySelector('[data-graph-proposal-preview]')", 'compact ONNX preview to close after Cancel');
  assert.equal(comparableProject(beforeCompactCancel), comparableProject(await currentProject()));
  result.steps.push({ id: 'onnx-compact-preview-cancel-preserves-project', status: 'PASS', viewport: compactPreview.viewport, dialogRect: compactPreview.dialogRect });
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await waitFor('innerWidth > 639', 'desktop viewport restored');
  await setLanguages('en');

  // Revalidation must use the current target after the real ONNX document has been previewed.
  await openOnnxPickerAndUpload();
  await agentCall('addNode', { componentId: 'relu_node', id: 'onnx-occupied-target-probe', position: { x: 45, y: 55 } });
  await waitFor("document.querySelector('[data-graph-proposal-apply]')?.disabled === true", 'ONNX Apply blocked after its target becomes occupied');
  const occupiedPreview = await readPreviewState();
  assert.equal(occupiedPreview.blockedBy, 'TARGET_WORKSPACE_NOT_EMPTY', 'The stale/current occupied target is reported explicitly.');
  assert.equal(occupiedPreview.disabled, true);
  const occupiedProjectBeforeApplyAttempt = await currentProject();
  await evaluate("document.querySelector('[data-graph-proposal-apply]')?.click()");
  await sleep(100);
  assert.equal(comparableProject(occupiedProjectBeforeApplyAttempt), comparableProject(await currentProject()), 'Disabled Apply cannot replace the newly occupied target.');
  await click('[data-graph-proposal-cancel]');
  await waitFor("!document.querySelector('[data-graph-proposal-preview]')", 'stale-target preview to close');
  assert.equal(comparableProject(occupiedProjectBeforeApplyAttempt), comparableProject(await currentProject()), 'Cancel preserves the intentional target mutation.');
  await agentCall('removeNode', 'onnx-occupied-target-probe');
  const restoredEmpty = await currentProject();
  assert.equal(restoredEmpty.graph.nodes.length, 0);
  assert.equal(restoredEmpty.graph.edges.length, 0);
  result.steps.push({ id: 'onnx-stale-occupied-target-blocks-apply', status: 'PASS', blockedBy: occupiedPreview.blockedBy, disabled: occupiedPreview.disabled });

  // Import the normalized document again through Build More, then apply explicitly.
  await openOnnxPickerAndUpload();
  const previewBeforeApply = await readPreviewState();
  assert.equal(previewBeforeApply.disabled, false);
  await click('[data-graph-proposal-apply]');
  await waitFor("!document.querySelector('[data-graph-proposal-preview]')", 'preview to close after explicit Apply');
  const applied = await currentProject();
  const ids = applied.graph.nodes.map((node) => node.data.manifest.id);
  assert.deepEqual(ids, ['tensor_input_node', 'dense_node', 'relu_node', 'dense_node', 'softmax_node', 'model_output_node']);
  assert.equal(applied.graph.edges.length, 5);
  assert.equal(applied.trainedModel, null, 'Architecture import does not mark the model as trained.');
  const exported = await agentCall('exportCode', 'pytorch');
  assert.match(exported, /nn\.Linear\(4, 3, bias=True\)/);
  assert.doesNotMatch(exported, /123456\.75/, 'Trained values never enter the canonical graph/compiler path.');
  result.steps.push({ id: 'explicit-apply-to-canonical-build-graph', status: 'PASS', nodeCount: applied.graph.nodes.length, edgeCount: applied.graph.edges.length, sourceExportWorks: true });

  const badDocument = structuredClone(document);
  badDocument.onnx.opsetVersion = 28;
  resealDocument(badDocument);
  const badPath = path.join(tempRoot, 'unsupported-opset.json');
  fs.writeFileSync(badPath, JSON.stringify(badDocument), 'utf8');
  await openOnnxPicker(badPath);
  await waitFor('document.body.innerText.includes("No proposal was opened")', 'unsupported ONNX opset notice');
  assert.equal(await evaluate("Boolean(document.querySelector('[data-graph-proposal-preview]'))"), false, 'Unsupported opset is rejected before staging.');
  const afterInvalid = await currentProject();
  assert.deepEqual(afterInvalid.graph, applied.graph, 'Invalid normalized document does not mutate canonical workspace state.');
  result.steps.push({ id: 'invalid-version-contained-without-workspace-mutation', status: 'PASS' });

  result.browser = await cdp.send('Browser.getVersion');
  result.viewport = await evaluate('({width:innerWidth,height:innerHeight})');
  result.normalizedFingerprint = document.documentFingerprint;
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
