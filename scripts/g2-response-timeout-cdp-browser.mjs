import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
  G2_ATTENTION_API_VERSION,
  G2_ATTENTION_PROFILE_ID,
  G2_ATTENTION_PROFILE_SHA256,
  G2_INPUT_IDS_A,
  G2_INPUT_IDS_B,
} from '../src/core/playground/importedAttention/profile.js';

const root = process.cwd();
const appUrl = 'http://127.0.0.1:5179';
const chromeDebugUrl = 'http://127.0.0.1:9231/json/list';
const artifactPath = process.env.VOLK_G2_REFERENCE_ONNX;
const chrome = process.env.VOLK_CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
if (!artifactPath || !fs.existsSync(artifactPath)) {
  throw new Error('Set VOLK_G2_REFERENCE_ONNX to the pinned G2 ONNX artifact before running the response lifecycle browser check.');
}
assert.ok(fs.existsSync(chrome), `Chrome executable exists: ${chrome}`);
const connectionCode = randomBytes(32).toString('base64url');

const corsHeaders = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type, X-VOLK-API-Version, X-VOLK-Request-Id, X-VOLK-Local-Authorization',
  'Access-Control-Max-Age': '300',
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const makeStall = () => ({ headers: deferred(), closed: deferred(), late: deferred() });
const matrix = (firstRow) => [firstRow, ...Array.from({ length: 5 }, () => Array.from({ length: 6 }, () => 1 / 6))];
const makeSample = (firstRow, logits) => ({
  logits,
  attentionProbabilities: [
    [matrix(firstRow), Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 1 / 6))],
    Array.from({ length: 2 }, () => Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 1 / 6))),
  ],
});
const responseFor = (request) => ({
  apiVersion: G2_ATTENTION_API_VERSION,
  providerVersion: request.providerVersion,
  profileId: G2_ATTENTION_PROFILE_ID,
  modelHash: request.modelHash,
  requestId: request.requestId,
  inputIdsA: request.inputIdsA,
  inputIdsB: request.inputIdsB,
  sampleA: makeSample([1, 0, 0, 0, 0, 0], [0.4, 0.8]),
  sampleB: makeSample([0, 0.5, 0.1, 0.1, 0.2, 0.1], [0.2, 1.1]),
});

const serverState = {
  loaded: false,
  modelHash: null,
  compareCount: 0,
  stalls: new Map([[2, makeStall()], [5, makeStall()]]),
  retryResponseSent: deferred(),
  importHash: null,
};
const localServer = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin === appUrl) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  for (const [name, value] of Object.entries(corsHeaders)) response.setHeader(name, value);
  if (request.method === 'OPTIONS') {
    if (origin !== appUrl || request.headers.host !== '127.0.0.1:8765') {
      response.writeHead(403);
      response.end();
      return;
    }
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.headers.host !== '127.0.0.1:8765' || origin !== appUrl) {
    response.writeHead(403, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'ORIGIN_NOT_ALLOWED' } }));
    return;
  }
  if (request.headers['x-volk-local-authorization'] !== connectionCode) {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'AUTHORIZATION_INVALID' } }));
    return;
  }
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      apiVersion: G2_ATTENTION_API_VERSION,
      profileId: G2_ATTENTION_PROFILE_ID,
      provider: 'CPUExecutionProvider',
      providerVersion: '1.30.0',
      adapterId: 'onnxruntime-cpu',
      executionContractVersion: 1,
      maxConcurrentRequests: 1,
      status: 'ok',
      modelLoaded: serverState.loaded,
      modelHash: serverState.modelHash,
    }));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  if (request.method === 'POST' && request.url === '/v1/model/import') {
    const digest = createHash('sha256').update(bytes).digest('hex');
    serverState.importHash = digest;
    const requestId = request.headers['x-volk-request-id'];
    if (digest !== G2_ATTENTION_PROFILE_SHA256 || request.headers['x-volk-api-version'] !== G2_ATTENTION_API_VERSION) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'MODEL_PROFILE_MISMATCH' } }));
      return;
    }
    serverState.loaded = true;
    serverState.modelHash = `sha256:${digest}`;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      apiVersion: G2_ATTENTION_API_VERSION,
      profileId: G2_ATTENTION_PROFILE_ID,
      modelHash: serverState.modelHash,
      requestId,
    }));
    return;
  }
  if (request.method === 'POST' && request.url === '/v1/compare') {
    const body = JSON.parse(bytes.toString('utf8'));
    serverState.compareCount += 1;
    if (!serverState.loaded || body.modelHash !== serverState.modelHash) {
      response.writeHead(409, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'MODEL_PROFILE_MISMATCH' } }));
      return;
    }
    const stall = serverState.stalls.get(serverState.compareCount);
    if (stall) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.flushHeaders();
      response.write('{"apiVersion":');
      stall.headers.resolve();
      response.on('close', () => stall.closed.resolve());
      setTimeout(() => {
        stall.late.resolve();
        if (!response.destroyed) response.end(JSON.stringify(responseFor(body)));
      }, 450);
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(responseFor(body)));
    if (serverState.compareCount === 3) serverState.retryResponseSent.resolve();
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: { code: 'NOT_FOUND' } }));
});

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

const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-g2-response-timeout-'));
let chromeProcess;
let viteProcess;
let cdp;
const report = { task: 'VOLK-ML G2 response-body cancellation browser acceptance', steps: [] };

async function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return response; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
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
    throw new Error(result.result?.exception?.description ?? result.exceptionDetails.text ?? 'Browser evaluation failed.');
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
  const state = await evaluate('({url:location.href,text:document.body?.innerText?.slice(0,1400)})');
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}`);
}

async function waitForSignal(promise, label, timeoutMs = 8_000) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForCompareCount(count, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverState.compareCount >= count) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for comparison request ${count}; saw ${serverState.compareCount}.`);
}

async function click(selector) {
  const result = await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); if(!element||element.disabled)return false; element.click(); return true; })()`);
  assert.equal(result, true, `Can click ${selector}.`);
  await sleep(100);
}

async function connectG2Runner() {
  const entered = await evaluate(`(() => {
    const input = document.querySelector('[data-g2-connection-code]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(connectionCode)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  assert.equal(entered, true, 'The local runner connection code field is available.');
  await click('[data-g2-connect-runner]');
  await waitFor('document.querySelector("[data-g2-runner-status]")?.getAttribute("data-g2-runner-status")==="available"', 'authorized test runner connection');
}

async function uploadModel(filePath) {
  const documentNode = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '[data-g2-model-input]' });
  assert.ok(nodeId, 'G2 model file input is mounted.');
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [filePath] });
  await cdp.send('Runtime.evaluate', { expression: "document.querySelector('[data-g2-model-input]')?.dispatchEvent(new Event('change',{bubbles:true}))" });
}

function closeProcess(child) {
  if (child && child.exitCode === null) {
    try { child.kill(); } catch {}
  }
}

try {
  await new Promise((resolve) => localServer.listen(8765, '127.0.0.1', resolve));
  assert.equal((await fetch('http://127.0.0.1:8765/health', { headers: { Origin: appUrl, 'X-VOLK-Local-Authorization': connectionCode } }).then((response) => response.status)), 200);
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5179', '--strictPort'], {
    cwd: root, env: process.env, windowsHide: true, stdio: 'ignore',
  });
  await waitForHttp(`${appUrl}/`);
  chromeProcess = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=9231', '--window-size=1440,1000',
    `--user-data-dir=${tempProfile}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  await waitForHttp(chromeDebugUrl);
  cdp = await connectBrowser();
  await cdp.send('Page.navigate', { url: `${appUrl}/` });
  await waitFor('Boolean(document.querySelector("[data-explore-home]"))', 'Explore Home');
  await click('[data-g2-imported-attention-entry]');
  await waitFor('Boolean(document.querySelector("[data-g2-imported-attention]"))', 'G2 surface');
  await connectG2Runner();
  await click('[data-g2-import-model]');
  await uploadModel(artifactPath);
  await waitFor('document.querySelector("[data-g2-run-comparison]")?.disabled===false', 'verified fixture import');
  assert.equal(serverState.importHash, G2_ATTENTION_PROFILE_SHA256, 'The production client sent the pinned bytes to the real HTTP test runner.');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-g2-evidence]"))'), false, 'Import creates no inference or Evidence.');

  await click('[data-g2-run-comparison]');
  await waitFor('Boolean(document.querySelector("[data-g2-evidence]"))', 'initial explicit comparison');
  assert.equal(serverState.compareCount, 1);
  assert.equal(await evaluate('document.querySelector("[data-g2-evidence]")?.getAttribute("data-g2-event-count")'), '2');
  const priorEvidence = await evaluate(`(() => ({
    text:document.querySelector('[data-g2-evidence]')?.innerText,
    eventCount:document.querySelector('[data-g2-evidence]')?.getAttribute('data-g2-event-count'),
    concept:Boolean(document.querySelector('[data-g2-concept-eligible]')),
  }))()`);
  report.steps.push({ id: 'valid-result-creates-baseline-evidence-before-cancellation-case', status: 'PASS' });

  await click('[data-g2-run-comparison]');
  await waitForSignal(serverState.stalls.get(2).headers.promise, 'second comparison response headers');
  assert.equal(await evaluate('document.querySelector("[data-g2-run-comparison]")?.disabled'), true, 'Busy state remains active while the response body stalls.');
  assert.deepEqual(await evaluate(`(() => ({
    text:document.querySelector('[data-g2-evidence]')?.innerText,
    eventCount:document.querySelector('[data-g2-evidence]')?.getAttribute('data-g2-event-count'),
    concept:Boolean(document.querySelector('[data-g2-concept-eligible]')),
  }))()`), priorEvidence, 'Headers without a complete response do not replace prior results or Evidence.');
  await click('[data-g2-imported-attention] header button');
  await waitFor('!document.querySelector("[data-g2-imported-attention]")', 'G2 closes during the stalled response');
  await waitForSignal(serverState.stalls.get(2).closed.promise, 'caller cancellation reaches the pending HTTP body');
  await waitForSignal(serverState.stalls.get(2).late.promise, 'late server response after caller cancellation');
  await sleep(100);

  await click('[data-g2-imported-attention-entry]');
  await waitFor('Boolean(document.querySelector("[data-g2-imported-attention]"))', 'G2 reopens after cancellation');
  await waitFor('document.querySelector("[data-g2-run-comparison]")?.disabled===false', 'retry control after reopen');
  assert.deepEqual(await evaluate(`(() => ({
    text:document.querySelector('[data-g2-evidence]')?.innerText,
    eventCount:document.querySelector('[data-g2-evidence]')?.getAttribute('data-g2-event-count'),
    concept:Boolean(document.querySelector('[data-g2-concept-eligible]')),
  }))()`), priorEvidence, 'A late response after cancellation cannot mutate the previous UI evidence.');
  report.steps.push({ id: 'close-reopen-late-response-is-contained-and-prior-evidence-is-preserved', status: 'PASS' });

  await click('[data-g2-run-comparison]');
  await waitForSignal(serverState.retryResponseSent.promise, 'retry comparison response');
  await waitFor('document.querySelector("[data-g2-run-comparison]")?.disabled===false && document.querySelector("[data-g2-evidence]")?.getAttribute("data-g2-event-count")==="3"', 'successful comparison retry');
  assert.equal(serverState.compareCount, 3, 'A fresh explicit learner action reaches the runner after cancellation.');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-g2-concept-eligible]"))'), true, 'The recovered retry renders validated Evidence.');
  report.steps.push({ id: 'retry-after-body-cancellation-completes-and-commits-only-the-new-valid-response', status: 'PASS' });

  await click('[data-g2-run-comparison]');
  await waitForCompareCount(4);
  await waitFor('document.querySelector("[data-g2-evidence]")?.getAttribute("data-g2-event-count") === "4"', 'fourth successful repeated comparison');
  const priorRun = await evaluate(`(() => { const node=document.querySelector('[data-g2-evidence]'); return {
    runId:node?.getAttribute('data-g2-run-id'), experimentIds:node?.getAttribute('data-g2-experiment-ids'),
    evidenceInstances:node?.getAttribute('data-g2-evidence-instance-count'),
  }; })()`);
  assert.equal(priorRun.evidenceInstances, '1', 'Repeated valid comparisons deduplicate the fixed semantic condition.');
  report.steps.push({ id: 'repeat-comparison-keeps-distinct-run-identity-without-duplicating-evidence', status: 'PASS' });

  await click('[data-g2-run-comparison]');
  await waitForSignal(serverState.stalls.get(5).headers.promise, 'fifth comparison response headers before project switch');
  assert.equal(await evaluate('document.querySelector("[data-g2-run-comparison]")?.disabled'), true, 'The project-switch stale-response case is still in flight.');
  const loadedProject = await evaluate(`window.__VOLK_ML_AGENT__.open().then(async(api)=>{
    const project=await api.getProject();
    return api.loadProject({...project,name:(project.name||'Project')+' - cancel G2 session'});
  })`, true);
  assert.ok(loadedProject?.name, 'The same-hash project switch uses the supported project API.');
  await connectG2Runner();
  await waitForSignal(serverState.stalls.get(5).closed.promise, 'project switch aborts the in-flight response body');
  await waitForSignal(serverState.stalls.get(5).late.promise, 'late response attempt after project switch');
  await waitFor('Boolean(document.querySelector("[data-g2-imported-attention]")) && !document.querySelector("[data-g2-evidence]") && document.querySelector("[data-g2-runner-status]")?.getAttribute("data-g2-runner-status") === "available" && document.querySelector("[data-g2-run-comparison]")?.disabled === false', 'clean G2 session after project switch');
  assert.equal((await evaluate('window.__VOLK_ML_AGENT__.open().then((api)=>api.getProject())', true)).localModelReferences?.[0]?.sha256, G2_ATTENTION_PROFILE_SHA256, 'The exact linked model hash remains unchanged across the project switch.');
  assert.equal(serverState.compareCount, 5, 'Project loading does not implicitly execute another comparison.');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-g2-evidence]"))'), false, 'Neither a prior run nor its late response leaks into the new project session.');
  report.steps.push({ id: 'same-hash-project-switch-aborts-stale-response-and-clears-prior-inquiry-state', status: 'PASS' });

  await click('[data-g2-run-comparison]');
  await waitForCompareCount(6);
  await waitFor('document.querySelector("[data-g2-evidence]")?.getAttribute("data-g2-event-count") === "2"', 'explicit comparison in the new G2 session');
  const newSessionRun = await evaluate(`(() => { const node=document.querySelector('[data-g2-evidence]'); return {
    runId:node?.getAttribute('data-g2-run-id'), experimentIds:node?.getAttribute('data-g2-experiment-ids'),
    evidenceInstances:node?.getAttribute('data-g2-evidence-instance-count'),
  }; })()`);
  assert.notEqual(newSessionRun.runId, priorRun.runId, 'The next learner comparison has fresh runtime identity.');
  assert.notEqual(newSessionRun.experimentIds, priorRun.experimentIds, 'The fresh project session cannot reuse prior experiment IDs.');
  assert.equal(newSessionRun.evidenceInstances, '1', 'New-session Evidence comes only from the explicit current comparison.');
  report.steps.push({ id: 'fresh-project-session-requires-explicit-run-to-recreate-evidence', status: 'PASS' });
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = error?.stack ?? String(error);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
  cdp?.close();
  closeProcess(chromeProcess);
  closeProcess(viteProcess);
  localServer.closeAllConnections();
  await new Promise((resolve) => localServer.close(resolve));
  try { fs.rmSync(tempProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
}
