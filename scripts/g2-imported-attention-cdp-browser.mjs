import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import {
  G2_LOCAL_MODEL_CACHE_DATABASE,
  G2_LOCAL_MODEL_CACHE_STORE,
  g2LocalModelCacheKey,
} from '../src/core/localModelCache.js';
import { G2_ATTENTION_PROFILE_ID, G2_ATTENTION_PROFILE_SHA256 } from '../src/core/playground/importedAttention/profile.js';

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
const connectionCode = randomBytes(32).toString('base64url');
const childEnv = {
  ...process.env,
  VOLK_G2_RUNNER_TOKEN: connectionCode,
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
const modelReference = { profileId: G2_ATTENTION_PROFILE_ID, sha256: G2_ATTENTION_PROFILE_SHA256 };
const modelCacheKey = g2LocalModelCacheKey(modelReference);
const runtimeArgs = [path.join(root, 'dev/g2_attention/server.py')];

function stopProcess(child) {
  if (child && child.exitCode === null) {
    try { child.kill(); } catch {}
  }
}

function startRuntime() {
  return spawn(python, runtimeArgs, {
    cwd: root, env: childEnv, windowsHide: true, stdio: 'ignore',
  });
}

async function waitForRuntimeStopped(timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch('http://127.0.0.1:8765/health', {
        headers: { Origin: baseUrl, 'X-VOLK-Local-Authorization': connectionCode },
        signal: AbortSignal.timeout(300),
      });
    } catch {
      return;
    }
    await sleep(100);
  }
  throw new Error('Timed out waiting for the local G2 runner to stop.');
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, url.endsWith('/health') ? {
        headers: { Origin: baseUrl, 'X-VOLK-Local-Authorization': connectionCode },
      } : undefined);
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
    this.events = [];
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method) {
        this.events.push(message);
        return;
      }
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
  const state = await evaluate(`({url:location.href,text:document.body?.innerText?.slice(0,1600),
    g2Status:document.querySelector('[data-g2-runner-status]')?.getAttribute('data-g2-runner-status'),
    alert:document.querySelector('[role=alert]')?.innerText,
    importDisabled:document.querySelector('[data-g2-import-model]')?.disabled,
    compareDisabled:document.querySelector('[data-g2-run-comparison]')?.disabled})`);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}`);
}

async function click(selector) {
  const clicked = await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) return false; element.click(); return true; })()`);
  assert.equal(clicked, true, `Can click ${selector}.`);
  await sleep(120);
}

function rawHttpStatus({ host = '127.0.0.1:8765', origin = baseUrl, token = connectionCode, method = 'GET', path: requestPath = '/health', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest('http://127.0.0.1:8765', {
      method,
      path: requestPath,
      headers: { Host: host, Origin: origin, 'X-VOLK-Local-Authorization': token, ...headers },
    }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
    request.end();
  });
}

async function connectG2Runner(expectedStatus = 'available', code = connectionCode) {
  const entered = await evaluate(`(() => {
    const input = document.querySelector('[data-g2-connection-code]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(code)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  assert.equal(entered, true, 'The local runner connection code field is available.');
  await click('[data-g2-connect-runner]');
  await waitFor(`document.querySelector("[data-g2-runner-status]")?.getAttribute("data-g2-runner-status") === ${JSON.stringify(expectedStatus)}`, `local runner state ${expectedStatus}`);
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

async function currentProjectFromStorage() {
  return evaluate(`new Promise((resolve,reject)=>{
    const open=indexedDB.open('volk-ml-local',1);
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const database=open.result;
      const transaction=database.transaction('projects','readonly');
      const request=transaction.objectStore('projects').get('current-project');
      request.onsuccess=()=>{ resolve(request.result ?? null); database.close(); };
      request.onerror=()=>{ database.close(); reject(request.error); };
    };
  })`, true);
}

async function cacheRecordSummary() {
  return evaluate(`new Promise((resolve,reject)=>{
    const open=indexedDB.open(${JSON.stringify(G2_LOCAL_MODEL_CACHE_DATABASE)},1);
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const database=open.result;
      const transaction=database.transaction(${JSON.stringify(G2_LOCAL_MODEL_CACHE_STORE)},'readonly');
      const request=transaction.objectStore(${JSON.stringify(G2_LOCAL_MODEL_CACHE_STORE)}).get(${JSON.stringify(modelCacheKey)});
      request.onsuccess=()=>{
        const record=request.result;
        resolve(record ? { keys:Object.keys(record).sort(), profileId:record.profileId, sha256:record.sha256, size:record.bytes?.size ?? null, type:record.bytes?.type ?? null } : null);
        database.close();
      };
      request.onerror=()=>{ database.close(); reject(request.error); };
    };
  })`, true);
}

async function mutateCacheBytes() {
  return evaluate(`new Promise((resolve,reject)=>{
    const open=indexedDB.open(${JSON.stringify(G2_LOCAL_MODEL_CACHE_DATABASE)},1);
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const database=open.result;
      const read=database.transaction(${JSON.stringify(G2_LOCAL_MODEL_CACHE_STORE)},'readonly').objectStore(${JSON.stringify(G2_LOCAL_MODEL_CACHE_STORE)}).get(${JSON.stringify(modelCacheKey)});
      read.onerror=()=>{ database.close(); reject(read.error); };
      read.onsuccess=async()=>{
        if(!read.result){ database.close(); reject(new Error('Expected cached G2 artifact.')); return; }
        const record=read.result;
        const bytes=new Uint8Array(await record.bytes.arrayBuffer());
        bytes[0]^=255;
        record.bytes=new Blob([bytes],{type:'application/octet-stream'});
        const transaction=database.transaction(${JSON.stringify(G2_LOCAL_MODEL_CACHE_STORE)},'readwrite');
        transaction.objectStore(${JSON.stringify(G2_LOCAL_MODEL_CACHE_STORE)}).put(record,${JSON.stringify(modelCacheKey)});
        transaction.oncomplete=()=>{ database.close(); resolve(true); };
        transaction.onerror=()=>{ database.close(); reject(transaction.error); };
        transaction.onabort=()=>{ database.close(); reject(transaction.error); };
      };
    };
  })`, true);
}

async function clearModelCache() {
  return evaluate(`new Promise((resolve,reject)=>{
    const open=indexedDB.open(${JSON.stringify(G2_LOCAL_MODEL_CACHE_DATABASE)},1);
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const database=open.result;
      const transaction=database.transaction(${JSON.stringify(G2_LOCAL_MODEL_CACHE_STORE)},'readwrite');
      transaction.objectStore(${JSON.stringify(G2_LOCAL_MODEL_CACHE_STORE)}).clear();
      transaction.oncomplete=()=>{ database.close(); resolve(true); };
      transaction.onerror=()=>{ database.close(); reject(transaction.error); };
      transaction.onabort=()=>{ database.close(); reject(transaction.error); };
    };
  })`, true);
}

async function runtimeRouteCount(route) {
  return cdp.events.filter((event) => event.method === 'Network.requestWillBeSent'
    && event.params.request.method === 'POST'
    && new URL(event.params.request.url).pathname === route).length;
}

async function waitForRuntimeRouteCount(route, minimumCount, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await runtimeRouteCount(route) >= minimumCount) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${route} POST count >= ${minimumCount}.`);
}

function runtimeRouteStatuses(route) {
  const requests = cdp.events.filter((event) => event.method === 'Network.requestWillBeSent'
    && event.params.request.method === 'POST'
    && new URL(event.params.request.url).pathname === route);
  return requests.map((request) => cdp.events.find((event) => event.method === 'Network.responseReceived'
    && event.params.requestId === request.params.requestId)?.params.response.status ?? null);
}

async function restoreSavedProject() {
  const buildClicked = await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('nav button')).find((item)=>item.innerText.trim()==='Build');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(buildClicked, true, 'The normal Build surface is available for the saved-project restore flow.');
  await waitFor("Array.from(document.querySelectorAll('h2')).some((heading)=>heading.innerText.trim()==='Continue local project?')", 'local project restore prompt');
  const restored = await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item)=>item.innerText.trim()==='Restore project');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(restored, true, 'The locally saved project can be restored after refresh.');
  const exploreClicked = await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('nav button')).find((item)=>item.innerText.trim()==='Explore');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(exploreClicked, true, 'Explore can be reopened after restoring the saved project.');
  await waitFor('Boolean(document.querySelector("[data-explore-home]"))', 'Explore Home after project restore');
}

async function restartRuntime() {
  stopProcess(runtimeProcess);
  runtimeProcess = null;
  await waitForRuntimeStopped();
  runtimeProcess = startRuntime();
  const response = await waitForHttp('http://127.0.0.1:8765/health');
  const health = await response.json();
  assert.equal(health.modelLoaded, false, 'A restarted local runner begins without an in-memory model.');
  return health;
}

try {
  const healthBefore = await fetch('http://127.0.0.1:8765/health', {
    headers: { Origin: baseUrl, 'X-VOLK-Local-Authorization': connectionCode },
  }).catch(() => null);
  assert.equal(healthBefore, null, 'The browser acceptance owns its local runner port.');
  runtimeProcess = startRuntime();
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: root, env: process.env, windowsHide: true, stdio: 'ignore',
  });
  const [healthResponse] = await Promise.all([waitForHttp('http://127.0.0.1:8765/health'), waitForHttp(`${baseUrl}/`)]);
  const health = await healthResponse.json();
  assert.equal(health.provider, 'CPUExecutionProvider');
  assert.equal(health.modelLoaded, false);
  const wrongCodeResponse = await fetch('http://127.0.0.1:8765/health', {
    headers: { Origin: baseUrl, 'X-VOLK-Local-Authorization': connectionCode.slice(0, -1) + (connectionCode.endsWith('x') ? 'y' : 'x') },
  });
  assert.equal(wrongCodeResponse.status, 401, 'The actual companion rejects an invalid per-process connection code.');
  const wrongOriginResponse = await fetch('http://127.0.0.1:8765/health', {
    headers: { Origin: 'https://untrusted.example', 'X-VOLK-Local-Authorization': connectionCode },
  });
  assert.equal(wrongOriginResponse.status, 403, 'The actual companion rejects an unregistered browser origin.');
  assert.equal(await rawHttpStatus({ host: 'localhost:8765' }), 403, 'The actual companion rejects DNS-rebound or non-canonical Host requests.');
  const allowedPreflight = await fetch('http://127.0.0.1:8765/v1/compare', {
    method: 'OPTIONS',
    headers: { Origin: baseUrl, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-volk-local-authorization' },
  });
  assert.equal(allowedPreflight.status, 204, 'The actual companion allows only the browser preflight used by the local client.');
  const rejectedPreflight = await fetch('http://127.0.0.1:8765/v1/compare', {
    method: 'OPTIONS',
    headers: { Origin: baseUrl, 'Access-Control-Request-Method': 'DELETE', 'Access-Control-Request-Headers': 'content-type,x-volk-local-authorization' },
  });
  assert.equal(rejectedPreflight.status, 403, 'The actual companion rejects unsupported preflight methods.');
  report.steps.push({ id: 'loopback-authorization-host-origin-and-preflight-boundary', status: 'PASS' });
  chromeProcess = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=9227', '--window-size=1440,1000',
    `--user-data-dir=${tempProfile}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  await waitForHttp(chromeDebugUrl);
  cdp = await connectBrowser();
  await cdp.send('Network.enable');
  const downloadPath = path.join(tempProfile, 'downloads');
  fs.mkdirSync(downloadPath, { recursive: true });
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath });
  await cdp.send('Page.navigate', { url: `${baseUrl}/` });
  await waitFor('Boolean(document.querySelector("[data-explore-home]"))', 'Explore Home');
  await click('[data-g2-imported-attention-entry]');
  await waitFor('Boolean(document.querySelector("[data-g2-imported-attention]"))', 'G2 imported-attention surface');
  await connectG2Runner('offline', connectionCode.slice(0, -1) + (connectionCode.endsWith('x') ? 'y' : 'x'));
  assert.equal(await evaluate('document.querySelector("[role=alert]")?.innerText.includes("authorization") || Boolean(document.querySelector("[role=alert]"))'), true, 'A wrong local connection code is rejected without enabling model actions.');
  await connectG2Runner();
  assert.equal(await evaluate('document.querySelector("[data-g2-run-comparison]")?.disabled'), true, 'No comparison can run before a model is linked.');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-g2-evidence]"))'), false, 'Opening the G2 surface creates no evidence.');
  await click('[data-g2-import-model]');
  await uploadModel(artifactPath);
  await waitFor('document.querySelector("[data-g2-run-comparison]")?.disabled === false', 'matching model import');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-g2-evidence]"))'), false, 'Selecting a model does not execute inference or create evidence.');
  const project = await currentProject();
  assert.equal(project.localModelReferences?.length, 1, 'Only a bounded local profile/hash reference is saved.');
  assert.equal(project.localModelReferences[0].profileId, 'bert-tiny-sst2-attention-v25-cpu-v1');
  assert.equal(project.localModelReferences[0].sha256, G2_ATTENTION_PROFILE_SHA256);
  assert.equal(JSON.stringify(project.localModelReferences).includes(path.basename(artifactPath)), false, 'Project state never retains the selected path or filename.');
  const cacheSummary = await cacheRecordSummary();
  assert.deepEqual(cacheSummary.keys, ['bytes', 'profileId', 'sha256'], 'The cache stores only identity and verified bytes, with no original filename or path.');
  assert.equal(cacheSummary.profileId, modelReference.profileId);
  assert.equal(cacheSummary.sha256, modelReference.sha256);
  assert.equal(cacheSummary.size, fs.statSync(artifactPath).size);
  assert.equal(cacheSummary.type, 'application/octet-stream');
  const projectSaveDeadline = Date.now() + 10_000;
  let storedProject = null;
  while (Date.now() < projectSaveDeadline) {
    storedProject = await currentProjectFromStorage();
    if (storedProject?.localModelReferences?.[0]?.sha256 === modelReference.sha256) break;
    await sleep(100);
  }
  assert.equal(storedProject?.localModelReferences?.[0]?.sha256, modelReference.sha256, 'The project hash reference is locally persisted before recovery tests.');
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath });
  const downloadResult = await evaluate("window.__VOLK_ML_AGENT__.open().then((api) => api.downloadProject())", true);
  assert.equal(downloadResult.bytes < fs.statSync(artifactPath).size / 2, true, 'The downloaded project stays small and cannot contain model weights.');
  const downloadDeadline = Date.now() + 10_000;
  let exportedFile = null;
  while (Date.now() < downloadDeadline) {
    exportedFile = fs.readdirSync(downloadPath).find((name) => name.endsWith('.volkml.json'));
    if (exportedFile) break;
    await sleep(100);
  }
  assert.ok(exportedFile, 'Project export downloads a portable JSON file.');
  const exportedProjectText = fs.readFileSync(path.join(downloadPath, exportedFile), 'utf8');
  const exportedProject = JSON.parse(exportedProjectText);
  assert.deepEqual(exportedProject.localModelReferences, [modelReference], 'Export contains only the allowlisted profile/hash reference.');
  assert.equal(exportedProjectText.includes(path.basename(artifactPath)), false, 'Export does not retain the original local filename.');
  assert.equal(exportedProjectText.includes(Buffer.from(fs.readFileSync(artifactPath)).toString('base64')), false, 'Export contains no model bytes.');
  report.steps.push({ id: 'import-caches-verified-bytes-locally-and-project-export-keeps-hash-only-reference', status: 'PASS', cacheBytes: cacheSummary.size, projectExportBytes: downloadResult.bytes });

  const importsBeforeCleanRestart = await runtimeRouteCount('/v1/model/import');
  await restartRuntime();
  await waitForRuntimeRouteCount('/v1/model/import', importsBeforeCleanRestart + 1);
  await waitFor('document.querySelector("[data-g2-run-comparison]")?.disabled === false', 'runner restart recovery before the first explicit comparison', 20_000);
  assert.equal(await runtimeRouteCount('/v1/model/import') > importsBeforeCleanRestart, true, 'A clean runner restart reimports the local cached artifact.');
  assert.equal(runtimeRouteStatuses('/v1/model/import').at(-1), 200, 'The clean runner restart cache import succeeds.');
  assert.equal(await runtimeRouteCount('/v1/compare'), 0, 'Runner restart recovery before the learner acts never calls inference.');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-g2-evidence]"))'), false, 'Runner restart recovery before the learner acts creates no evidence.');
  report.steps.push({ id: 'runner-restart-cache-restoration-does-not-run-inference-before-explicit-action', status: 'PASS' });

  const importsBeforeRefresh = await runtimeRouteCount('/v1/model/import');
  await click('[data-g2-imported-attention] header button');
  await waitFor('!document.querySelector("[data-g2-imported-attention]")', 'G2 closes before page-refresh recovery');
  stopProcess(runtimeProcess);
  runtimeProcess = null;
  await waitForRuntimeStopped();
  runtimeProcess = startRuntime();
  const cleanRunnerResponse = await waitForHttp('http://127.0.0.1:8765/health');
  assert.equal((await cleanRunnerResponse.json()).modelLoaded, false, 'The refresh-recovery fixture starts with an empty runtime.');
  await cdp.send('Page.navigate', { url: `${baseUrl}/` });
  await waitFor('Boolean(document.querySelector("[data-explore-home]"))', 'Explore after browser refresh');
  await restoreSavedProject();
  await click('[data-g2-imported-attention-entry]');
  await waitFor('Boolean(document.querySelector("[data-g2-imported-attention]"))', 'G2 after browser refresh');
  await connectG2Runner();
  await waitForRuntimeRouteCount('/v1/model/import', importsBeforeRefresh + 1);
  await waitFor('document.querySelector("[data-g2-run-comparison]")?.disabled === false', 'cached artifact reimport after browser refresh');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-g2-evidence]"))'), false, 'Page refresh and cached model reimport do not run inference or create evidence.');
  assert.equal(await runtimeRouteCount('/v1/model/import') > importsBeforeRefresh, true, 'Refresh recovery actually reimports cached bytes into the loopback runner.');
  assert.equal(runtimeRouteStatuses('/v1/model/import').at(-1), 200, 'Cached model recovery receives a successful local runner response.');
  assert.equal(await runtimeRouteCount('/v1/compare'), 0, 'Refresh recovery never calls the inference/comparison route.');
  assert.equal((await currentProject()).localModelReferences?.[0]?.sha256, modelReference.sha256, 'Refresh preserves the hash-only project reference.');
  report.steps.push({ id: 'page-refresh-restores-cached-bytes-into-runner-without-inference-or-evidence', status: 'PASS' });

  await click('[data-g2-run-comparison]');
  await waitFor('Boolean(document.querySelector("[data-g2-evidence]"))', 'deterministic evidence from explicit local comparison', 25_000);
  assert.equal(await runtimeRouteCount('/v1/compare'), 1, 'Only the learner-confirmed comparison executes inference.');
  assert.equal(runtimeRouteStatuses('/v1/compare').at(-1), 200, 'The explicit comparison returns successfully from the real local runner.');
  assert.equal(await evaluate('document.querySelector("[data-g2-evidence]")?.getAttribute("data-g2-event-count")'), '2');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-g2-concept-eligible]"))'), true, 'The concept is surfaced only after measured attention movement.');
  const firstRun = await evaluate(`(() => { const node=document.querySelector('[data-g2-evidence]'); return {
    runId:node?.getAttribute('data-g2-run-id'), experimentIds:node?.getAttribute('data-g2-experiment-ids'),
    evidenceInstances:node?.getAttribute('data-g2-evidence-instance-count'),
  }; })()`);
  assert.ok(firstRun.runId && firstRun.experimentIds, 'A committed comparison exposes its semantic per-run identity.');
  await click('[data-g2-run-comparison]');
  await waitForRuntimeRouteCount('/v1/compare', 2);
  await waitFor('document.querySelector("[data-g2-evidence]")?.getAttribute("data-g2-event-count") === "3"', 'repeat comparison semantic events');
  const repeatedRun = await evaluate(`(() => { const node=document.querySelector('[data-g2-evidence]'); return {
    runId:node?.getAttribute('data-g2-run-id'), experimentIds:node?.getAttribute('data-g2-experiment-ids'),
    evidenceInstances:node?.getAttribute('data-g2-evidence-instance-count'),
  }; })()`);
  assert.notEqual(repeatedRun.runId, firstRun.runId, 'A repeated successful comparison receives a distinct run identity.');
  assert.notEqual(repeatedRun.experimentIds, firstRun.experimentIds, 'Repeated comparison experiment IDs are unique per run.');
  assert.equal(repeatedRun.evidenceInstances, '1', 'Repeating the same condition does not duplicate Evidence.');
  report.steps.push({ id: 'repeat-comparison-has-distinct-experiment-identities-with-condition-deduped-evidence', status: 'PASS' });

  const switchedProject = await evaluate(`window.__VOLK_ML_AGENT__.open().then(async(api)=>{
    const project=await api.getProject();
    return api.loadProject({...project,name:(project.name||'Project')+' - G2 session switch'});
  })`, true);
  assert.ok(switchedProject?.name, 'The supported project-load API completed the same-hash session switch.');
  await connectG2Runner();
  await waitFor('Boolean(document.querySelector("[data-g2-imported-attention]")) && !document.querySelector("[data-g2-evidence]") && document.querySelector("[data-g2-runner-status]")?.getAttribute("data-g2-runner-status") === "available" && document.querySelector("[data-g2-run-comparison]")?.disabled === false', 'G2 state invalidation after project switch');
  assert.equal((await currentProject()).localModelReferences?.[0]?.sha256, modelReference.sha256, 'The project switch preserves the identical artifact reference.');
  assert.equal(await runtimeRouteCount('/v1/compare'), 2, 'Project loading itself does not execute inference.');
  await click('[data-g2-run-comparison]');
  await waitForRuntimeRouteCount('/v1/compare', 3);
  await waitFor('document.querySelector("[data-g2-evidence]")?.getAttribute("data-g2-event-count") === "2"', 'explicit inference after clean project session');
  const freshSessionRun = await evaluate(`(() => { const node=document.querySelector('[data-g2-evidence]'); return {
    runId:node?.getAttribute('data-g2-run-id'), experimentIds:node?.getAttribute('data-g2-experiment-ids'),
    evidenceInstances:node?.getAttribute('data-g2-evidence-instance-count'),
  }; })()`);
  assert.notEqual(freshSessionRun.runId, repeatedRun.runId, 'The new project session creates new run identities only after explicit learner action.');
  assert.equal(freshSessionRun.evidenceInstances, '1', 'Evidence is rebuilt from the explicit result in the clean project session.');
  report.steps.push({ id: 'same-hash-project-switch-clears-session-evidence-and-requires-explicit-inference', status: 'PASS' });
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

  const comparisonsBeforeRecovery = await runtimeRouteCount('/v1/compare');
  const importsBeforeRunnerRestart = await runtimeRouteCount('/v1/model/import');
  await restartRuntime();
  await waitForRuntimeRouteCount('/v1/model/import', importsBeforeRunnerRestart + 1);
  await waitFor('document.querySelector("[data-g2-run-comparison]")?.disabled === false', 'runner restart reloads the cached artifact', 20_000);
  assert.equal(await runtimeRouteCount('/v1/model/import') > importsBeforeRunnerRestart, true, 'Runner restart recovery performs a fresh model import.');
  assert.equal(runtimeRouteStatuses('/v1/model/import').at(-1), 200, 'Runner restart cache recovery is acknowledged successfully.');
  assert.deepEqual(await evaluate('({text:document.querySelector("[data-g2-evidence]")?.innerText,eventCount:document.querySelector("[data-g2-evidence]")?.getAttribute("data-g2-event-count"),concept:Boolean(document.querySelector("[data-g2-concept-eligible]"))})'), evidenceBeforeOffline, 'Runtime restart reloads weights without changing existing evidence or events.');
  assert.equal(await runtimeRouteCount('/v1/compare'), comparisonsBeforeRecovery, 'Runtime restart recovery does not execute inference.');
  report.steps.push({ id: 'runner-restart-reimports-cached-weights-without-new-inference-or-evidence', status: 'PASS' });

  await clearModelCache();
  await restartRuntime();
  await waitFor('document.querySelector("[data-g2-runner-status]")?.getAttribute("data-g2-runner-status") === "available" && document.querySelector("[data-g2-run-comparison]")?.disabled === true', 'missing local cache relink state', 20_000);
  assert.equal(await evaluate('Boolean(document.querySelector("[data-g2-imported-attention]")?.innerText.includes("Select the exact matching file"))'), true, 'A missing same-device cache clearly asks the learner to relink.');
  assert.deepEqual(await evaluate('({text:document.querySelector("[data-g2-evidence]")?.innerText,eventCount:document.querySelector("[data-g2-evidence]")?.getAttribute("data-g2-event-count"),concept:Boolean(document.querySelector("[data-g2-concept-eligible]"))})'), evidenceBeforeOffline, 'A missing cache disables execution without altering existing evidence.');
  assert.equal(await runtimeRouteCount('/v1/compare'), comparisonsBeforeRecovery, 'Missing-cache recovery does not execute inference.');
  report.steps.push({ id: 'missing-local-cache-fails-closed-and-offers-relink', status: 'PASS' });

  await click('[data-g2-import-model]');
  await uploadModel(artifactPath);
  await waitFor('document.querySelector("[data-g2-run-comparison]")?.disabled === false', 'manual relink after missing cache');
  const relinkDeadline = Date.now() + 5_000;
  let relinkedCache = null;
  while (Date.now() < relinkDeadline) {
    relinkedCache = await cacheRecordSummary();
    if (relinkedCache?.sha256 === modelReference.sha256) break;
    await sleep(100);
  }
  assert.equal(relinkedCache?.sha256, modelReference.sha256, 'Manual relinking repopulates the verified local cache.');
  assert.equal(await mutateCacheBytes(), true, 'The browser acceptance corrupts only its isolated local fixture.');
  await restartRuntime();
  await waitFor('document.querySelector("[role=alert]")?.innerText.includes("saved local model copy")', 'corrupt local cache rejection', 20_000);
  assert.equal(await evaluate('document.querySelector("[data-g2-run-comparison]")?.disabled'), true, 'Corrupt cached bytes cannot enable inference.');
  assert.equal(await cacheRecordSummary(), null, 'Corrupt cached bytes are discarded after hash mismatch.');
  assert.deepEqual(await evaluate('({text:document.querySelector("[data-g2-evidence]")?.innerText,eventCount:document.querySelector("[data-g2-evidence]")?.getAttribute("data-g2-event-count"),concept:Boolean(document.querySelector("[data-g2-concept-eligible]"))})'), evidenceBeforeOffline, 'Corrupt-cache rejection preserves prior deterministic evidence.');
  assert.equal(await runtimeRouteCount('/v1/compare'), comparisonsBeforeRecovery, 'Corrupt-cache rejection does not execute inference.');
  report.steps.push({ id: 'corrupt-local-cache-is-rejected-and-preserves-evidence', status: 'PASS' });

  await click('[data-g2-import-model]');
  await uploadModel(artifactPath);
  await waitFor('document.querySelector("[data-g2-run-comparison]")?.disabled === false', 'manual relink after cache corruption');

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
  await click('[data-g2-clear-cache]');
  await waitFor('document.querySelector("[data-g2-cache-policy]")?.innerText.includes("local model cache was cleared")', 'learner-facing cache clear confirmation');
  assert.equal(await cacheRecordSummary(), null, 'The learner-facing cache control removes the local artifact bytes.');
  assert.deepEqual(await evaluate('({text:document.querySelector("[data-g2-evidence]")?.innerText,eventCount:document.querySelector("[data-g2-evidence]")?.getAttribute("data-g2-event-count"),concept:Boolean(document.querySelector("[data-g2-concept-eligible]"))})'), evidenceBeforeOffline, 'Clearing local bytes cannot change prior semantic evidence.');
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
