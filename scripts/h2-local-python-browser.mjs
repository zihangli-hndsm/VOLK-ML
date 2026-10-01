import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { h2ClassificationDropoutFixture } from './h2-local-python/test-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = 'http://127.0.0.1:5173';
const localPolicyUrl = 'http://127.0.0.1:8766';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-h2-browser-'));
const browserResponses = [];
const browserErrors = [];
let vite = null;
let coordinator = null;
let chrome = null;
let cdp = null;
let coordinatorOutput = '';

function findChrome() {
  const candidates = [
    process.env.WEBGPU_CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try { child.kill(); } catch { /* The process may already have stopped. */ }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2500))]);
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL'); } catch { /* Cleanup remains bounded. */ }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1000))]);
  }
}

async function waitForHttp(url, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* Service may still be starting. */ }
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
      if (!message.id) {
        if (message.method === 'Network.responseReceived') {
          const response = message.params.response;
          if (response.url.includes('/v1/h2/')) browserResponses.push({ url: response.url, status: response.status });
        }
        if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails?.exception?.description ?? 'Browser exception');
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
          const line = (message.params.args ?? []).map((item) => item.value ?? item.description).join(' ');
          if (!/Failed to load resource/.test(line)) browserErrors.push(line);
        }
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
  close() { this.socket.close(); }
}

async function evaluate(expression, awaitPromise = false) {
  const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.result?.description ?? response.exceptionDetails.exception?.description ?? 'Browser evaluation failed.');
  return response.result?.value;
}

async function waitFor(expression, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const details = await evaluate('({url:location.href,text:document.body?.innerText?.slice(0,1000),agent:Boolean(window.__VOLK_ML_AGENT__)})');
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify({ details, browserErrors })}`);
}

async function click(selector) {
  const clicked = await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) return false; element.click(); return true; })()`);
  assert.equal(clicked, true, `An enabled ${selector} control is present.`);
}

async function waitForRuntime(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await evaluate('window.__VOLK_ML_AGENT__.open().then(api => api.getState())', true);
    if (state.execution?.runtime?.status === 'succeeded' || state.execution?.runtime?.status === 'failed') return state;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('The H2 fit did not settle within its bounded runtime deadline.');
}

async function installGraph(fixture = h2ClassificationDropoutFixture()) {
  const graph = {
    nodes: fixture.nodes.map((node) => ({ id: node.id, componentId: node.data.manifest.id, position: node.position, parameters: node.data.parameters })),
    edges: fixture.edges,
    dataset: fixture.dataset,
  };
  return evaluate(`window.__VOLK_ML_AGENT__.open().then(async api => {
    const project = api.getProject();
    for (const node of [...(project.graph?.nodes ?? [])]) await api.removeNode(node.id);
    await api.setDataset(${JSON.stringify(graph.dataset)});
    for (const node of ${JSON.stringify(graph.nodes)}) await api.addNode(node);
    for (const edge of ${JSON.stringify(graph.edges)}) await api.connect(edge);
    return api.getState();
  })`, true);
}

async function installBrowserCpuGraph() {
  const dataset = {
    name: 'H2 offline Browser CPU check',
    task: 'regression',
    featureColumns: ['feature'],
    targetColumn: 'target',
    rows: Array.from({ length: 16 }, (_, index) => ({ feature: index / 4, target: 1.75 * (index / 4) + (index % 3) * 0.1 })),
  };
  return evaluate(`window.__VOLK_ML_AGENT__.open().then(async api => {
    const state = api.getState();
    for (const node of [...state.canvas.nodes]) await api.removeNode(node.id);
    await api.setDataset(${JSON.stringify(dataset)});
    const components = ['tabular_data_node', 'train_test_split_node', 'linear_regression_node', 'gradient_descent_node', 'evaluate_node'];
    const ids = [];
    for (let index = 0; index < components.length; index += 1) {
      const added = await api.addNode({ componentId: components[index], id: 'h2-offline-' + index, position: { x: index * 120, y: 40 } });
      ids.push(added.nodeId);
    }
    await api.connect({ source: ids[0], sourceHandle: 'dataset', target: ids[1], targetHandle: 'dataset' });
    await api.connect({ source: ids[1], sourceHandle: 'split', target: ids[2], targetHandle: 'split' });
    await api.connect({ source: ids[2], sourceHandle: 'model', target: ids[3], targetHandle: 'model' });
    await api.connect({ source: ids[3], sourceHandle: 'trained_model', target: ids[4], targetHandle: 'trained_model' });
    return api.getState();
  })`, true);
}

async function main() {
  assert.equal(process.platform, 'win32', 'the H2 browser acceptance uses the required Windows Job Object supervisor.');
  const chromePath = findChrome();
  assert.ok(chromePath, 'Chrome or Edge is installed for the real browser acceptance.');

  const childEnvironment = {
    ...process.env,
    VITE_VOLK_H2_LOCAL_PYTHON_URL: localPolicyUrl,
  };
  delete childEnvironment.VITE_VOLK_API_URL;
  delete childEnvironment.VITE_VOLK_CLOUD_URL;
  coordinator = spawn(process.execPath, ['scripts/h2-local-python/server.mjs'], {
    cwd: root, env: childEnvironment, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'],
  });
  coordinator.stdout.setEncoding('utf8');
  coordinator.stdout.on('data', (chunk) => { coordinatorOutput += chunk; });
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: root, env: childEnvironment, windowsHide: true, stdio: 'ignore',
  });
  await waitForHttp(`${localPolicyUrl}/v1/h2/health`);
  const pairingDeadline = Date.now() + 10_000;
  while (!/H2_PAIRING_TOKEN=([A-Za-z0-9_-]{43});/.test(coordinatorOutput) && Date.now() < pairingDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const connectionToken = coordinatorOutput.match(/H2_PAIRING_TOKEN=([A-Za-z0-9_-]{43});/)?.[1];
  assert.ok(connectionToken, 'the local companion generated its pairing code outside the browser bundle.');
  const health = await (await fetch(`${localPolicyUrl}/v1/h2/health`, { headers: { Authorization: `Bearer ${connectionToken}` } })).json();
  assert.equal(health.schemaVersion, 'volk.h2.health.v2');
  assert.equal(health.connected, true);
  assert.equal(health.available, true, `The paired pinned local runtime is available (${health.reason ?? 'ready'}).`);
  await waitForHttp(baseUrl);
  const servedEntry = await fetch(`${baseUrl}/src/main.jsx`).then((response) => response.text());
  assert.equal(servedEntry.includes(connectionToken), false, 'the pairing credential is not embedded in the served frontend module.');

  chrome = spawn(chromePath, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profile}`, baseUrl,
  ], { windowsHide: true, stdio: 'ignore' });
  const activePortPath = path.join(profile, 'DevToolsActivePort');
  const portDeadline = Date.now() + 20_000;
  while (!fs.existsSync(activePortPath) && Date.now() < portDeadline) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(fs.existsSync(activePortPath), 'Headless browser opened an isolated debugging endpoint.');
  const debugPort = Number(fs.readFileSync(activePortPath, 'utf8').split(/\r?\n/)[0]);
  await waitForHttp(`http://127.0.0.1:${debugPort}/json/list`);
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const page = pages.find((target) => target.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'The browser page exposes its test-only CDP connection.');
  cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await waitFor('Boolean(window.__VOLK_ML_AGENT__?.open)', 'mounted Build workspace agent');

  await click('button[aria-pressed="false"]');
  await waitFor('Boolean(document.querySelector("[data-build-toolbar]"))', 'Build workspace surface');
  const before = await installGraph();
  assert.equal(before.execution?.runtime?.status, 'idle');
  await click('[data-build-primary="run"]');
  await waitFor('Boolean(document.querySelector("[data-h2-fit]"))', 'the local Python fit action');
  await waitFor('Boolean(document.querySelector("[data-h2-connection-token]"))', 'local runtime pairing control');
  await evaluate(`(() => { const input=document.querySelector('[data-h2-connection-token]'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(input,${JSON.stringify(connectionToken)}); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await click('[data-h2-connect]');
  await waitFor('document.querySelector("[data-h2-fit]")?.disabled === false', 'explicit local companion pairing');
  await click('[data-h2-fit]');
  await waitFor('document.querySelector("[data-h2-fit-result]")?.textContent?.includes("training completed") || document.querySelector("[data-h2-fit-result]")?.textContent?.includes("训练完成")', 'accepted local Python model result', 75_000);

  const finalState = await waitForRuntime();
  assert.equal(finalState.execution.runtime.status, 'succeeded', JSON.stringify(finalState.execution.runtime.error));
  assert.equal(finalState.execution.runtime.execution.providerId, 'local-python-h2');
  assert.equal(finalState.execution.runtime.execution.provenance, 'live-local');
  const model = await evaluate('window.__VOLK_ML_AGENT__.open().then(api => api.getProject().trainedModel)', true);
  assert.equal(model?.trainingSummary?.provider, 'local-python');
  assert.ok(Array.isArray(model.lossHistory) && model.lossHistory.length === 4);
  const preflight = browserResponses.find((entry) => entry.url.includes('/v1/h2/authorize') && entry.status === 200);
  const corsPreflight = browserResponses.find((entry) => entry.url.includes('/v1/h2/authorize') && entry.status === 204);
  const fit = browserResponses.find((entry) => entry.url.includes('/v1/h2/fit') && entry.status === 200);
  assert.ok(preflight, 'the configured browser sent the actual authorization request and received HTTP 200.');
  assert.ok(corsPreflight, 'the browser completed the authorization CORS preflight.');
  assert.ok(fit, 'the configured browser sent the actual local fit request and received HTTP 200.');
  assert.deepEqual(browserErrors, [], `The browser reports no runtime errors: ${browserErrors.join('; ')}`);

  await stopProcess(coordinator);
  coordinator = null;
  await evaluate('location.reload()');
  await waitFor('Boolean(window.__VOLK_ML_AGENT__?.open)', 'workspace agent after offline reload');
  await click('button[aria-pressed="false"]');
  await waitFor('Boolean(document.querySelector("[data-build-toolbar]"))', 'Build workspace after offline reload');
  await installGraph();
  await click('[data-build-primary="run"]');
  await waitFor('document.querySelector("[data-h2-fit]")?.disabled === true', 'offline local fit remains unavailable');
  await installBrowserCpuGraph();
  await waitFor('document.querySelector("[data-runner-execute]")?.disabled === false', 'supported Browser CPU Run remains available offline');
  await click('[data-runner-execute]');
  const offlineState = await waitForRuntime();
  assert.equal(offlineState.execution.runtime.status, 'succeeded', 'ordinary Browser CPU execution remains usable without the companion.');
  assert.equal(offlineState.execution.runtime.execution.providerId, 'browser-cpu');
  assert.equal(browserResponses.filter((entry) => entry.url.includes('/v1/h2/fit') && entry.status === 200).length, 1,
    'offline Browser CPU Run does not secretly dispatch a second local Python fit.');
  process.stdout.write(`H2 browser acceptance passed: local HTTP returned 200 and accepted ${model.lossHistory.length} CPU epochs; after companion shutdown, Browser CPU Run still completed without fallback or another H2 request.\n`);
}

try {
  await main();
} finally {
  cdp?.close();
  await stopProcess(chrome);
  await stopProcess(vite);
  await stopProcess(coordinator);
  const tempRoot = path.resolve(os.tmpdir());
  const resolvedProfile = path.resolve(profile);
  if (path.dirname(resolvedProfile) === tempRoot && path.basename(resolvedProfile).startsWith('volk-h2-browser-')) {
    fs.rmSync(resolvedProfile, { recursive: true, force: true });
  }
}
