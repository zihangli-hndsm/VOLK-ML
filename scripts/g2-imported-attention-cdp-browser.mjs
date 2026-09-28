import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const baseUrl = 'http://127.0.0.1:5173';
const chromeDebugUrl = 'http://127.0.0.1:9227/json/list';
const artifactPath = process.env.VOLK_G2_REFERENCE_ONNX;
const python = process.env.VOLK_G2_PYTHON;
if (!artifactPath || !fs.existsSync(artifactPath) || !python) {
  throw new Error('Set VOLK_G2_REFERENCE_ONNX to the pinned ONNX artifact and VOLK_G2_PYTHON to the local runtime Python before running the G2 browser check.');
}
const chrome = process.env.VOLK_CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
assert.ok(fs.existsSync(chrome), `Chrome executable exists: ${chrome}`);
const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-g2-chrome-'));
const childEnv = {
  ...process.env,
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
  ...(process.env.VOLK_G2_PYTHONPATH
    ? { PYTHONPATH: [process.env.VOLK_G2_PYTHONPATH, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) }
    : {}),
};
let viteProcess;
let runtimeProcess;
let chromeProcess;
let cdp;
const report = { task: 'VOLK-ML G2 imported attention browser acceptance', steps: [] };

function stopProcess(child) {
  if (child && child.exitCode === null) {
    try { child.kill(); } catch {}
  }
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
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
  if (result.exceptionDetails) {
    throw new Error(result.result?.exception?.description ?? result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Browser evaluation failed.');
  }
  return result.result?.value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  const state = await evaluate('({url:location.href,text:document.body?.innerText?.slice(0,1200)})');
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}`);
}

async function click(selector) {
  const clicked = await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) return false; element.click(); return true; })()`);
  assert.equal(clicked, true, `Can click ${selector}.`);
  await sleep(120);
}

async function uploadModel(filePath) {
  const documentNode = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '[data-g2-model-input]' });
  assert.ok(nodeId, 'G2 model file input is mounted.');
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [filePath] });
  await cdp.send('Runtime.evaluate', { expression: "document.querySelector('[data-g2-model-input]')?.dispatchEvent(new Event('change',{bubbles:true}))" });
}

async function currentProject() {
  return evaluate("window.__VOLK_ML_AGENT__.open().then((api) => api.getProject())", true);
}

try {
  const healthBefore = await fetch('http://127.0.0.1:8765/health').catch(() => null);
  assert.equal(healthBefore, null, 'The browser acceptance owns its local runner port.');
  runtimeProcess = spawn(python, [path.join(root, 'dev/g2_attention/server.py')], {
    cwd: root, env: childEnv, windowsHide: true, stdio: 'ignore',
  });
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: root, env: process.env, windowsHide: true, stdio: 'ignore',
  });
  const [healthResponse] = await Promise.all([waitForHttp('http://127.0.0.1:8765/health'), waitForHttp(`${baseUrl}/`)]);
  const health = await healthResponse.json();
  assert.equal(health.provider, 'CPUExecutionProvider');
  assert.equal(health.modelLoaded, false);
  chromeProcess = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=9227', '--window-size=1440,1000',
    `--user-data-dir=${tempProfile}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  await waitForHttp(chromeDebugUrl);
  cdp = await connectBrowser();
  await cdp.send('Page.navigate', { url: `${baseUrl}/` });
  await waitFor('Boolean(document.querySelector("[data-explore-home]"))', 'Explore Home');
  await click('[data-g2-imported-attention-entry]');
  await waitFor('Boolean(document.querySelector("[data-g2-imported-attention]"))', 'G2 imported-attention surface');
  await waitFor('document.querySelector("[data-g2-runner-status]")?.getAttribute("data-g2-runner-status") === "available"', 'local CPU runner health');
  assert.equal(await evaluate('document.querySelector("[data-g2-run-comparison]")?.disabled'), true, 'No comparison can run before a model is linked.');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-g2-evidence]"))'), false, 'Opening the G2 surface creates no evidence.');
  await click('[data-g2-import-model]');
  await uploadModel(artifactPath);
  await waitFor('document.querySelector("[data-g2-run-comparison]")?.disabled === false', 'matching model import');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-g2-evidence]"))'), false, 'Selecting a model does not execute inference or create evidence.');
  const project = await currentProject();
  assert.equal(project.localModelReferences?.length, 1, 'Only a bounded local profile/hash reference is saved.');
  assert.equal(project.localModelReferences[0].profileId, 'bert-tiny-sst2-attention-v25-cpu-v1');
  assert.equal(project.localModelReferences[0].sha256, '19b18790c5cc466d086ec473e91566bc3e852a74878fbae68f78d483a45c6cef');
  assert.equal(JSON.stringify(project.localModelReferences).includes(path.basename(artifactPath)), false, 'Project state never retains the selected path or filename.');
  report.steps.push({ id: 'import-does-not-run-and-project-retains-only-allowlisted-reference', status: 'PASS' });

  await click('[data-g2-run-comparison]');
  await waitFor('Boolean(document.querySelector("[data-g2-evidence]"))', 'deterministic evidence from explicit local comparison', 25_000);
  assert.equal(await evaluate('document.querySelector("[data-g2-evidence]")?.getAttribute("data-g2-event-count")'), '2');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-g2-concept-eligible]"))'), true, 'The concept is surfaced only after measured attention movement.');
  const results = await evaluate(`(() => ({
    grids: document.querySelectorAll('[data-g2-evidence] ~ section [role="grid"]').length,
    tokens: document.querySelector('[data-g2-imported-attention]')?.innerText.includes('good') && document.querySelector('[data-g2-imported-attention]')?.innerText.includes('bad'),
    text: document.querySelector('[data-g2-evidence]')?.innerText ?? '',
    viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth },
  }))()`);
  assert.equal(results.grids, 8, 'Both inputs render two layers by two heads as real attention matrices.');
  assert.equal(results.tokens, true, 'A/B labels remain visible alongside the results.');
  assert.match(results.text, /attention/i);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await waitFor('innerWidth === 390', 'compact viewport');
  const compact = await evaluate('({width:innerWidth,documentWidth:document.documentElement.scrollWidth,dialog:document.querySelector("[data-g2-imported-attention]")?.getBoundingClientRect().toJSON()})');
  assert.ok(compact.documentWidth <= compact.width, 'G2 surface has no horizontal overflow at mobile width.');
  assert.ok(compact.dialog.left >= 0 && compact.dialog.right <= compact.width, 'G2 surface remains within the mobile viewport.');
  const evidenceBeforeOffline = await evaluate('({text:document.querySelector("[data-g2-evidence]")?.innerText,eventCount:document.querySelector("[data-g2-evidence]")?.getAttribute("data-g2-event-count"),concept:Boolean(document.querySelector("[data-g2-concept-eligible]"))})');
  report.steps.push({ id: 'explicit-local-comparison-renders-results-evidence-and-concept', status: 'PASS', matrices: results.grids, mobile: compact });

  await click('[data-g2-imported-attention] header button');
  await waitFor('!document.querySelector("[data-g2-imported-attention]")', 'G2 surface closes');
  stopProcess(runtimeProcess);
  runtimeProcess = null;
  await sleep(250);
  await click('[data-g2-imported-attention-entry]');
  await waitFor('Boolean(document.querySelector("[data-g2-imported-attention]"))', 'offline G2 surface');
  await waitFor('document.querySelector("[data-g2-runner-status]")?.getAttribute("data-g2-runner-status") === "offline"', 'offline runner status');
  assert.equal(await evaluate('document.querySelector("[data-g2-run-comparison]")?.disabled'), true, 'Offline state cannot submit an experiment.');
  assert.deepEqual(await evaluate('({text:document.querySelector("[data-g2-evidence]")?.innerText,eventCount:document.querySelector("[data-g2-evidence]")?.getAttribute("data-g2-event-count"),concept:Boolean(document.querySelector("[data-g2-concept-eligible]"))})'), evidenceBeforeOffline, 'Offline re-entry preserves existing deterministic evidence without adding or altering it.');
  const browserRequests = await evaluate('performance.getEntriesByType("resource").map((entry)=>entry.name)');
  assert.equal(browserRequests.some((url) => /\/v0\/lumi\/respond|127\.0\.0\.1:8010|localhost:8010/i.test(url)), false, 'G2 sends no Cloud policy or inference request.');
  report.steps.push({ id: 'offline-runner-fails-closed-without-cloud-and-without-fabricated-evidence', status: 'PASS' });
  report.browser = await cdp.send('Browser.getVersion');
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = error?.stack ?? String(error);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
  cdp?.close();
  stopProcess(chromeProcess);
  stopProcess(viteProcess);
  stopProcess(runtimeProcess);
  try { fs.rmSync(tempProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
}
