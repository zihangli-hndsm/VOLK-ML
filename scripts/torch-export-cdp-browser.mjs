import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const baseUrl = 'http://127.0.0.1:5177';
let chromeDebugUrl = '';
const repoRoot = process.cwd();
const evidenceDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-torch-export-b2-evidence-'));
const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-torch-export-chrome-'));
const validFixture = path.resolve('fixtures/torch-export/linear-relu.json');
const invalidFixture = path.resolve('fixtures/torch-export/invalid-unknown-field.json');
let viteProcess = null;
let chromeProcess = null;
let cdp = null;
const scenarios = [];

async function waitForHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for ' + url);
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
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
  await client.send('DOM.enable');
  await client.send('Log.enable');
  return client;
}

async function evaluate(expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Browser evaluation failed.');
  return result.result?.value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicateExpression, label, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(predicateExpression)) return;
    await sleep(100);
  }
  const details = await evaluate('({ url: location.href, text: document.body?.innerText?.slice(0, 2400) })');
  throw new Error('Timed out waiting for ' + label + ': ' + JSON.stringify(details));
}

async function clickSelector(selector) {
  const expression = '(() => { const item = document.querySelector(' + JSON.stringify(selector) + '); if (!item || item.disabled) return false; item.click(); return true; })()';
  const clicked = await evaluate(expression);
  if (!clicked) throw new Error('Could not click enabled control ' + selector);
  await sleep(150);
}

async function captureScreenshot(filename) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(evidenceDirectory, filename), Buffer.from(result.data, 'base64'));
}

async function agentCall(method, ...args) {
  const expression = 'window.__VOLK_ML_AGENT__.open().then((api) => api.' + method + '(...' + JSON.stringify(args) + '))';
  return evaluate(expression, true);
}

async function currentProject() {
  return agentCall('getProject');
}

function comparableProject(project) {
  const copy = structuredClone(project);
  delete copy.savedAt;
  return JSON.stringify(copy);
}

async function readPreviewState() {
  const expression = [
    '(() => {',
    'const root = document.querySelector("[data-graph-proposal-preview]");',
    'const readOnly = root?.querySelector("[data-graph-proposal-readonly]");',
    'return { visible: Boolean(root), sourceText: root?.innerText?.slice(0, 2400) ?? "",',
    'previewNodes: root?.querySelectorAll("[data-graph-preview-node]").length ?? 0,',
    'applyDisabled: root?.querySelector("[data-graph-proposal-apply]")?.disabled ?? null,',
    'graphControls: readOnly?.querySelectorAll("button,input,select,textarea").length ?? 0 };',
    '})()',
  ].join('');
  return evaluate(expression);
}

async function setSelectedFile(filePath) {
  const root = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const selected = await cdp.send('DOM.querySelector', {
    nodeId: root.root.nodeId,
    selector: '[data-torch-export-document-input]',
  });
  if (!selected.nodeId) throw new Error('Torch Export JSON file input is missing.');
  await cdp.send('DOM.setFileInputFiles', { nodeId: selected.nodeId, files: [filePath] });
  await evaluate('document.querySelector("[data-torch-export-document-input]")?.dispatchEvent(new Event("change", { bubbles: true }))');
}

async function openTorchExportPickerAndSetFile(filePath) {
  await clickSelector('[data-build-toolbar] button[aria-expanded]');
  await waitFor('Boolean(document.querySelector("[data-torch-export-import]"))', 'Torch Export JSON menu action');
  await clickSelector('[data-torch-export-import]');
  await setSelectedFile(filePath);
}

async function setLanguages(primary, secondary) {
  const openSettings = await evaluate('(() => { const toggle = document.querySelector("nav button[aria-controls=global-more-actions]"); if (!toggle) return false; toggle.click(); return true; })()');
  assert.equal(openSettings, true);
  const languageButton = await evaluate('(() => { const button = [...document.querySelectorAll("#global-more-actions button")].find((item) => /language|语言/i.test(item.innerText)); if (!button) return false; button.click(); return true; })()');
  assert.equal(languageButton, true);
  await waitFor('Boolean([...document.querySelectorAll("label")].find((label) => /primary language|主要语言|主语言/i.test(label.innerText))?.querySelector("select"))', 'language settings dialog');
  const applied = await evaluate('(() => { const labels = [...document.querySelectorAll("label")]; const primaryLabel = labels.find((label) => /primary language|主要语言|主语言/i.test(label.innerText)); const parallelLabel = labels.find((label) => /parallel language|并行语言/i.test(label.innerText)); if (!primaryLabel || !parallelLabel) return false; const setValue = (select, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; setter.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); }; setValue(primaryLabel.querySelector("select"), ' + JSON.stringify(primary) + '); setValue(parallelLabel.querySelector("select"), ' + JSON.stringify(secondary ?? 'none') + '); const dialog = primaryLabel.closest("div.fixed.inset-0"); const button = [...dialog.querySelectorAll("button")].find((item) => /apply|应用/i.test(item.innerText)); if (!button) return false; button.click(); return true; })()');
  assert.equal(applied, true);
}

async function enterBuild() {
  const clicked = await evaluate([
    '(() => {',
    'const button = [...document.querySelectorAll("nav button")].find((item) => item.getAttribute("aria-pressed") !== "true" && /build/i.test(item.innerText));',
    'if (!button) return false; button.click(); return true;',
    '})()',
  ].join(''));
  if (!clicked) throw new Error('Could not enter the Build workspace.');
  await waitFor('Boolean(window.__VOLK_ML_AGENT__ && window.__VOLK_ML_AGENT__.listInstances().length)', 'Build workspace and Canvas Agent');
  const state = await agentCall('getState');
  for (const node of state.canvas.nodes) await agentCall('removeNode', node.id);
}

async function startServices() {
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5177', '--strictPort'], {
    cwd: repoRoot,
    env: { ...process.env, VITE_VOLK_API_URL: '' },
    stdio: 'inherit',
  });
  await waitForHttp(baseUrl + '/');
  const debugPort = await getFreePort();
  chromeDebugUrl = 'http://127.0.0.1:' + debugPort + '/json/list';
  chromeProcess = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--disable-gpu',
    '--remote-debugging-port=' + debugPort,
    '--window-size=1440,1000',
    '--user-data-dir=' + chromeProfile,
    'about:blank',
  ], { stdio: 'ignore' });
  await waitForHttp(chromeDebugUrl);
  cdp = await connectBrowser();
  await cdp.send('Page.navigate', { url: baseUrl + '/' });
  await waitFor('Boolean(document.querySelector("nav button[aria-pressed=\\\"true\\\"]"))', 'application shell');
  await enterBuild();
}

const report = {
  task: 'VOLK-ML Torch Export B2 JSON import browser acceptance',
  browser: null,
  scenarios,
  cloud: 'disabled by empty VITE_VOLK_API_URL; import is local-only',
  artifacts: { directory: evidenceDirectory },
};

try {
  await startServices();
  const browserVersion = await cdp.send('Browser.getVersion');
  report.browser = {
    product: browserVersion.product,
    userAgent: await evaluate('navigator.userAgent'),
    desktopViewport: await evaluate('({ width: innerWidth, height: innerHeight })'),
  };

  const emptyProject = await currentProject();
  assert.equal(emptyProject.graph.nodes.length, 0);
  assert.equal(emptyProject.graph.edges.length, 0);

  await openTorchExportPickerAndSetFile(validFixture);
  await waitFor('Boolean(document.querySelector("[data-graph-proposal-preview]"))', 'Torch Export proposal preview');
  const preview = await readPreviewState();
  assert.equal(preview.previewNodes, 5);
  assert.equal(preview.applyDisabled, false);
  assert.equal(preview.graphControls, 0);
  assert.match(preview.sourceText, /Adapter-verified/i);
  assert.match(preview.sourceText, /trained parameter values are not imported/i);
  await captureScreenshot('desktop-preview.png');
  const beforeCancel = await currentProject();
  await clickSelector('[data-graph-proposal-cancel]');
  await waitFor('!document.querySelector("[data-graph-proposal-preview]")', 'preview to close after Cancel');
  const afterCancel = await currentProject();
  assert.equal(comparableProject(beforeCancel), comparableProject(afterCancel));
  assert.equal(comparableProject(emptyProject), comparableProject(afterCancel));
  scenarios.push({ id: 'desktop-preview-cancel-no-mutation', result: 'PASS', preview, canonicalProjectUnchanged: true });

  await openTorchExportPickerAndSetFile(invalidFixture);
  await waitFor('document.body.innerText.includes("No proposal was opened")', 'invalid-document notice');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-graph-proposal-preview]"))'), false);
  const afterInvalid = await currentProject();
  assert.equal(comparableProject(emptyProject), comparableProject(afterInvalid));
  scenarios.push({ id: 'invalid-json-stages-no-proposal', result: 'PASS', canonicalProjectUnchanged: true });

  await openTorchExportPickerAndSetFile(validFixture);
  await waitFor('Boolean(document.querySelector("[data-graph-proposal-preview]"))', 'second valid Torch Export preview');
  await clickSelector('[data-graph-proposal-apply]');
  await waitFor('!document.querySelector("[data-graph-proposal-preview]")', 'preview to close after explicit Apply');
  const appliedProject = await currentProject();
  assert.equal(appliedProject.graph.nodes.length, 5);
  assert.equal(appliedProject.graph.edges.length, 4);
  assert.equal(appliedProject.trainedModel, null);
  await captureScreenshot('desktop-applied.png');
  scenarios.push({ id: 'explicit-apply-adds-reference-mlp-architecture-only', result: 'PASS', nodes: 5, edges: 4, trainedModel: null });

  await setLanguages('zh', null);
  const projectBeforeChinesePreview = await currentProject();
  await openTorchExportPickerAndSetFile(validFixture);
  await waitFor('Boolean(document.querySelector("[data-graph-proposal-preview]"))', 'Chinese single-language preview');
  const chinesePreview = await readPreviewState();
  assert.match(chinesePreview.sourceText, /已由适配器验证并从来源文档重新生成图/);
  assert.match(chinesePreview.sourceText, /已训练参数值不会复制到工作区/);
  await clickSelector('[data-graph-proposal-cancel]');
  await waitFor('!document.querySelector("[data-graph-proposal-preview]")', 'Chinese preview to close');
  assert.equal(comparableProject(projectBeforeChinesePreview), comparableProject(await currentProject()));
  scenarios.push({ id: 'chinese-single-language-preview-cancel', result: 'PASS' });

  await setLanguages('zh', 'en');
  await openTorchExportPickerAndSetFile(validFixture);
  await waitFor('Boolean(document.querySelector("[data-graph-proposal-preview]"))', 'parallel-language preview');
  const parallelPreview = await readPreviewState();
  assert.match(parallelPreview.sourceText, /已由适配器验证并从来源文档重新生成图/);
  assert.match(parallelPreview.sourceText, /Adapter-verified; graph rematerialized from source/);
  await clickSelector('[data-graph-proposal-cancel]');
  await waitFor('!document.querySelector("[data-graph-proposal-preview]")', 'parallel preview to close');
  scenarios.push({ id: 'parallel-language-preview-cancel', result: 'PASS' });

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await waitFor('innerWidth === 390', 'compact viewport');
  await clickSelector('[data-build-toolbar] button[aria-expanded]');
  await waitFor('Boolean(document.querySelector("[data-build-more-compact][role=\\\"dialog\\\"]"))', 'compact Build More sheet');
  await captureScreenshot('compact-menu.png');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-torch-export-import]"))'), true);
  await clickSelector('[data-torch-export-import]');
  await setSelectedFile(invalidFixture);
  await waitFor('document.body.innerText.includes("No proposal was opened")', 'compact invalid-document notice');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-graph-proposal-preview]"))'), false);
  scenarios.push({ id: 'compact-import-action-and-invalid-document', result: 'PASS', viewport: { width: 390, height: 844 } });

  fs.writeFileSync(path.join(evidenceDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (cdp) {
    await Promise.race([
      cdp.send('Browser.close').catch(() => {}),
      sleep(750),
    ]);
  }
  cdp?.close();
  stopProcess(chromeProcess);
  stopProcess(viteProcess);
  try { fs.rmSync(chromeProfile, { recursive: true, force: true }); } catch {}
}
