import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const chromePath = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-lumi-result-f3-'));
const profilePath = path.join(tempRoot, 'chrome-profile');
fs.mkdirSync(profilePath, { recursive: true });
const fixtureRequests = [];
let fixtureServer;
let viteProcess;
let chromeProcess;
let cdp;
let fixturePort;
let appPort;
let debugPort;
let resultResponseMode = 'normal';
let currentStage = 'setup';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
function stopProcess(child) { if (child && child.exitCode === null) { try { child.kill(); } catch {} } }

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
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
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
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.result?.description ?? result.exceptionDetails.exception?.description ?? 'Browser expression failed.');
  return result.result?.value;
}

async function waitFor(predicate, label, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(predicate)) return;
    await sleep(100);
  }
  const diagnostic = await evaluate('({ url: location.href, text: document.body?.innerText?.slice(0, 1800) })');
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(diagnostic)}`);
}

async function clickSelector(selector) {
  const clicked = await evaluate(`(() => { const item = document.querySelector(${JSON.stringify(selector)}); if (!item || item.disabled) return false; item.click(); return true; })()`);
  assert.equal(clicked, true, `Enabled control exists: ${selector}`);
  await sleep(160);
}

async function clickText(selector, text) {
  const clicked = await evaluate(`(() => { const item = [...document.querySelectorAll(${JSON.stringify(selector)})].find((entry) => (entry.innerText ?? '').includes(${JSON.stringify(text)})); if (!item || item.disabled) return false; item.click(); return true; })()`);
  assert.equal(clicked, true, `Enabled control includes: ${text}`);
  await sleep(160);
}

async function setValue(selector, value) {
  const changed = await evaluate(`(() => { const item = document.querySelector(${JSON.stringify(selector)}); if (!item) return false; const proto = item instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : item instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set; if (!setter) return false; setter.call(item, ${JSON.stringify(value)}); item.dispatchEvent(new Event('input', { bubbles: true })); item.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  assert.equal(changed, true, `Field exists: ${selector}`);
}

async function setField(labelText, value, type = 'input') {
  const changed = await evaluate(`(() => { const label = [...document.querySelectorAll('label')].find((entry) => (entry.innerText ?? '').trim().startsWith(${JSON.stringify(labelText)})); const item = label?.querySelector(${JSON.stringify(type)}); if (!item) return false; const proto = item instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set; if (!setter) return false; setter.call(item, ${JSON.stringify(value)}); item.dispatchEvent(new Event('input', { bubbles: true })); item.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  assert.equal(changed, true, `Field under ${labelText} exists.`);
  await sleep(120);
}

async function agent(method, args = []) {
  return evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => { await api[${JSON.stringify(method)}](...${JSON.stringify(args)}); return true; })`, true);
}

async function configureProvider() {
  await clickSelector('nav button[aria-controls="global-more-actions"]');
  await clickText('button', 'AI settings');
  await waitFor('Boolean([...document.querySelectorAll("h2")].find((item) => item.innerText.includes("AI settings")))', 'AI settings');
  const advanced = await evaluate('Boolean([...document.querySelectorAll("label")].find((item) => item.innerText.trim().startsWith("Protocol"))?.querySelector("select"))');
  if (!advanced) {
    await clickText('button', 'Advanced configuration');
    await waitFor('Boolean([...document.querySelectorAll("label")].find((item) => item.innerText.trim().startsWith("Protocol"))?.querySelector("select"))', 'advanced provider controls');
  }
  await setField('Protocol', 'openai-compatible', 'select');
  await setField('Endpoint URL', `http://127.0.0.1:${fixturePort}/v1/chat/completions`);
  await setField('API key', 'f3-local-fixture-secret');
  await clickText('button', 'Use this configuration');
  await waitFor('!document.querySelector("[role=dialog] h2")?.innerText.includes("AI settings")', 'AI settings to close');
}

function createFixtureServer() {
  fixtureServer = http.createServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    response.setHeader('access-control-allow-headers', 'authorization, content-type');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || '{}');
    const user = String(body.messages?.find((entry) => entry.role === 'user')?.content ?? '');
    const parsed = JSON.parse(user);
    const item = { method: request.method, url: request.url, authorization: request.headers.authorization ?? '', request: parsed, bodyContainsFixtureKey: raw.includes('f3-local-fixture-secret') };
    fixtureRequests.push(item);
    let decision;
    if (parsed.contract === 'LumiResultReasoningV1') {
      const citedFact = parsed.facts?.find((fact) => fact.kind === 'metric')?.factId ?? parsed.facts?.[0]?.factId;
      decision = {
        contract: 'LumiResultReasoningV1', version: 1, requestId: parsed.requestId, kind: 'reasoning',
        statements: [{ kind: 'observation', text: 'This Run includes a metric linked to the current local result.', factIds: [citedFact] }],
        suggestions: [
          { id: 'inspect-loss', authority: 'suggestion-only', requiresLearnerAcceptance: true },
          { id: 'review-graph-layout', authority: 'suggestion-only', requiresLearnerAcceptance: true },
        ], understanding: 'not-assessed',
      };
      if (resultResponseMode === 'stale') decision.requestId = `${parsed.requestId}-stale`;
      resultResponseMode = 'normal';
    } else if (parsed.contract === 'GraphEditIntentPlanV1') {
      decision = { version: 1, requestId: parsed.requestId, kind: 'plan', steps: [{ op: 'MOVE_NODE', nodeRef: 'node_2', relation: 'right-of', anchorRef: 'node_1' }], code: null };
    } else {
      response.writeHead(422, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unsupported fixture contract' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(decision) } }], usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } }));
  });
}

async function waitForServer(url, label) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function run() {
  assert.equal(fs.existsSync(chromePath), true, `Chrome binary exists at ${chromePath}.`);
  fixturePort = await freePort();
  appPort = await freePort();
  debugPort = await freePort();
  createFixtureServer();
  await new Promise((resolve) => fixtureServer.listen(fixturePort, '127.0.0.1', resolve));
  const viteEntry = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  viteProcess = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'], { cwd: root, stdio: 'ignore', windowsHide: true });
  await waitForServer(`http://127.0.0.1:${appPort}`, 'Vite');
  chromeProcess = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profilePath}`, `http://127.0.0.1:${appPort}`,
  ], { stdio: 'ignore', windowsHide: true });
  await waitForServer(`http://127.0.0.1:${debugPort}/json/version`, 'Chrome DevTools');
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const page = pages.find((entry) => entry.type === 'page');
  assert(page?.webSocketDebuggerUrl, 'Chrome page debugger is available.');
  cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await waitFor('Boolean(document.querySelector("nav[aria-label]"))', 'application navigation');
  currentStage = 'open-build';
  await clickText('nav[aria-label] button', 'Build');
  await waitFor('Boolean(document.querySelector("[data-build-surface]")) && Boolean(window.__VOLK_ML_AGENT__?.listInstances?.().length)', 'Build workspace and Agent API');
  currentStage = 'configure-provider';
  await configureProvider();

  currentStage = 'seed-real-run';
  const graphReady = await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => {
    const project = api.getProject();
    for (const node of project.graph.nodes) await api.removeNode(node.id);
    const dataset = { name: 'F3 private display name', task: 'regression', featureColumns: ['feature_x'], targetColumn: 'target_y', rows: Array.from({ length: 16 }, (_, index) => ({ feature_x: 120001.125 + index * 0.375, target_y: 4.125 + (120001.125 + index * 0.375) * 0.75, private_row_probe: 'F3_RAW_CELL_SENTINEL' })) };
    await api.setDataset(dataset);
    const specs = [
      { componentId: 'tabular_data_node', id: 'F3_OPAQUE_DATA_NODE', position: { x: 40, y: 40 } },
      { componentId: 'train_test_split_node', id: 'F3_OPAQUE_SPLIT_NODE', position: { x: 240, y: 40 }, parameters: { train_ratio: 0.8 } },
      { componentId: 'linear_regression_node', id: 'F3_OPAQUE_MODEL_NODE', position: { x: 440, y: 40 }, parameters: { learning_rate: 0.05 } },
      { componentId: 'gradient_descent_node', id: 'F3_OPAQUE_TRAIN_NODE', position: { x: 640, y: 40 }, parameters: { epochs: 30 } },
      { componentId: 'evaluate_node', id: 'F3_OPAQUE_EVAL_NODE', position: { x: 840, y: 40 } },
    ];
    for (const spec of specs) await api.addNode(spec);
    const links = [
      ['F3_OPAQUE_DATA_NODE', 'dataset', 'F3_OPAQUE_SPLIT_NODE', 'dataset'],
      ['F3_OPAQUE_SPLIT_NODE', 'split', 'F3_OPAQUE_MODEL_NODE', 'split'],
      ['F3_OPAQUE_MODEL_NODE', 'model', 'F3_OPAQUE_TRAIN_NODE', 'model'],
      ['F3_OPAQUE_TRAIN_NODE', 'trained_model', 'F3_OPAQUE_EVAL_NODE', 'trained_model'],
    ];
    for (const [source, sourceHandle, target, targetHandle] of links) await api.connect({ source, sourceHandle, target, targetHandle });
    return api.getProject().graph.nodes.length === 5 && api.getProject().graph.edges.length === 4;
  })`, true);
  assert.equal(graphReady, true, 'Real Agent API created a valid regression graph and dataset.');
  currentStage = 'open-run-dialog';
  await clickSelector('[data-build-primary="run"]');
  currentStage = 'wait-run-control';
  await waitFor('Boolean(document.querySelector("[data-runner-execute]"))', 'Run dialog');
  currentStage = 'click-run';
  await clickSelector('[data-runner-execute]');
  currentStage = 'wait-lumi-result';
  await waitFor('Boolean(document.querySelector("[data-lumi-result-reasoning]"))', 'LUMI result panel');
  await waitFor('Boolean(document.querySelector("[data-run-history-status=succeeded]"))', 'successful Run history record');
  currentStage = 'inspect-current';
  const currentState = await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => ({ status: api.getState().execution.runtime.status, finishedAt: api.getState().execution.runtime.finishedAt }))`, true);
  assert.equal(currentState.status, 'succeeded', 'Browser runtime completed successfully.');
  currentStage = 'capture-result-baseline';
  const compactWorkspace = `(api) => { const project = api.getProject(); const runtime = api.getState().execution.runtime; return JSON.stringify({ graph: { nodes: project.graph.nodes.map((node) => ({ id: node.id, componentId: node.data.manifest.id, position: node.position, parameters: node.data.parameters })), edges: project.graph.edges }, dataset: project.data ? { name: project.data.name, task: project.data.task, featureColumns: project.data.featureColumns, targetColumn: project.data.targetColumn, rowCount: project.data.rows.length } : null, runtime: { status: runtime.status, result: runtime.result, losses: runtime.losses, finishedAt: runtime.finishedAt } }); }`;
  await evaluate(`window.__F3_COMPACT_WORKSPACE__ = ${compactWorkspace}; window.__F3_RESULT_BASELINE__ = window.__VOLK_ML_AGENT__.open().then((api) => window.__F3_COMPACT_WORKSPACE__(api)); true`, true);
  currentStage = 'local-fallback';
  await clickSelector('[data-lumi-result-generate]');
  await waitFor('Boolean(document.querySelector("[data-lumi-result-outcome=local]"))', 'deterministic local result reflection');
  assert.equal(fixtureRequests.length, 0, 'An unchecked result request stays local and does not contact the configured provider.');
  const localUnchanged = await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => window.__F3_COMPACT_WORKSPACE__(api) === await window.__F3_RESULT_BASELINE__)`, true);
  assert.equal(localUnchanged, true, 'Local reflection leaves the Run result unchanged.');
  currentStage = 'consent-click';
  await clickSelector('[data-lumi-result-consent]');
  currentStage = 'request-click';
  await clickSelector('[data-lumi-result-generate]');
  currentStage = 'wait-provider-result';
  await waitFor('Boolean(document.querySelector("[data-lumi-result-outcome=provider]"))', 'typed provider result');
  assert.equal(fixtureRequests.length, 1, 'The actual configured provider gateway sent one LUMI Result request.');
  const policyRequest = fixtureRequests[0];
  assert.equal(policyRequest.method, 'POST', 'Provider request used HTTP POST.');
  assert.equal(policyRequest.url, '/v1/chat/completions', 'Provider request used the configured compatibility endpoint.');
  assert.equal(policyRequest.request.contract, 'LumiResultReasoningV1', 'Provider request uses the versioned contract.');
  assert.equal(policyRequest.request.version, 1, 'Provider request carries contract version 1.');
  assert(policyRequest.request.requestId, 'Provider request carries a correlation identity.');
  assert.equal(policyRequest.bodyContainsFixtureKey, false, 'API credentials are not placed in the provider body.');
  const serializedRequest = JSON.stringify(policyRequest.request);
  for (const secret of ['F3_OPAQUE_DATA_NODE', 'F3_OPAQUE_MODEL_NODE', 'F3_RAW_CELL_SENTINEL', 'F3 private display name', '120001.125']) {
    assert.equal(serializedRequest.includes(secret), false, `Semantic projection excludes ${secret}.`);
  }
  const afterReasoning = await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => window.__F3_COMPACT_WORKSPACE__(api) === await window.__F3_RESULT_BASELINE__)`, true);
  assert.equal(afterReasoning, true, 'Validated LUMI output changed neither graph/project nor deterministic Run result.');
  currentStage = 'stale-provider-fallback';
  resultResponseMode = 'stale';
  await clickSelector('[data-lumi-result-consent]');
  await clickSelector('[data-lumi-result-generate]');
  await waitFor('Boolean(document.querySelector("[data-lumi-result-outcome=local]")) && Boolean(document.querySelector("[data-lumi-result-reasoning]")?.innerText.includes("provider was unavailable"))', 'stale provider response local fallback');
  assert.equal(fixtureRequests.length, 2, 'The stale-policy case made exactly one additional HTTP request.');
  const afterStale = await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => window.__F3_COMPACT_WORKSPACE__(api) === await window.__F3_RESULT_BASELINE__)`, true);
  assert.equal(afterStale, true, 'A stale response cannot mutate graph or deterministic result.');
  const acceptedAction = await evaluate(`Boolean(document.querySelector('[data-lumi-result-suggestion="review-graph-layout"]'))`);
  assert.equal(acceptedAction, true, 'Typed suggestion is rendered as an inert learner button.');

  currentStage = 'f2-proposal';
  await clickSelector('[data-lumi-result-suggestion="review-graph-layout"]');
  await waitFor('Boolean(document.querySelector("[data-lumi-graph-edit] textarea"))', 'existing F2 graph-edit dialog');
  const prefilledRequest = await evaluate('document.querySelector("[data-lumi-graph-edit] textarea")?.value ?? ""');
  assert(prefilledRequest.length > 0, 'Selecting the suggestion only opens the F2 request surface.');
  await clickSelector('[data-lumi-graph-edit] input[type="checkbox"]');
  await clickSelector('[data-graph-edit-interpret]');
  await waitFor('Boolean(document.querySelector("[data-graph-edit-plan]"))', 'typed F2 intent plan');
  assert.equal(fixtureRequests.length, 3, 'The existing F2 consent boundary made its own provider request.');
  assert.equal(fixtureRequests[2].request.contract, 'GraphEditIntentPlanV1', 'F3 proposal uses the existing typed F2 contract.');
  const beforePreview = await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => window.__F3_COMPACT_WORKSPACE__(api) === await window.__F3_RESULT_BASELINE__)`, true);
  assert.equal(beforePreview, true, 'Provider suggestion and F2 interpretation still do not mutate graph or runtime.');
  currentStage = 'c2-preview';
  await clickSelector('[data-graph-edit-review]');
  await waitFor('Boolean(document.querySelector("[data-graph-patch-preview]"))', 'read-only C2 graph patch preview');
  const stagedState = await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => window.__F3_COMPACT_WORKSPACE__(api) === await window.__F3_RESULT_BASELINE__)`, true);
  assert.equal(stagedState, true, 'C2 proposal preview remains read-only before learner Apply.');
  currentStage = 'explicit-apply';
  await clickSelector('[data-graph-patch-apply]');
  await waitFor('!document.querySelector("[data-graph-patch-preview]")', 'explicit learner Apply');
  const afterApply = await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => ({ status: api.getState().execution.runtime.status, finishedAt: api.getState().execution.runtime.finishedAt, nodeCount: api.getProject().graph.nodes.length }))`, true);
  assert.equal(afterApply.status, 'succeeded', 'Layout-only Apply does not rerun or invalidate current model output.');
  assert.equal(afterApply.finishedAt, currentState.finishedAt, 'LUMI suggestion did not auto-run the graph.');
  assert.equal(afterApply.nodeCount, 5, 'Explicit C2 Apply preserves the graph node set.');
  assert.equal(fixtureRequests.length, 3, 'The graph proposal path does not make a hidden extra policy request.');
  const currentHistory = await evaluate(`(() => { const root = document.querySelector('[data-lumi-result-reasoning]'); const item = document.querySelector('[data-run-history-status=succeeded]'); return { current: root?.dataset.lumiResultCurrent, freshness: item?.dataset.runHistoryFreshness, label: item?.innerText ?? '', canGenerate: Boolean(document.querySelector('[data-lumi-result-generate]')) }; })()`);
  assert.equal(currentHistory.current, 'true', 'A current successful Run is presented as current.');
  assert.equal(currentHistory.freshness, 'current', 'Layout-only Apply retains the current history badge.');
  assert.equal(currentHistory.canGenerate, true, 'A current result can be interpreted.');

  currentStage = 'stale-after-graph-parameter-change';
  const parameterChanged = await evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => { const node = api.getProject().graph.nodes.find((item) => item.data.manifest.id === 'linear_regression_node'); if (!node) return false; await api.updateNode(node.id, { parameters: { learning_rate: 0.051 } }); return true; })`, true);
  assert.equal(parameterChanged, true, 'The current registered linear-regression component was edited through the mounted Agent adapter.');
  const graphStale = '(() => { const root = document.querySelector("[data-lumi-result-reasoning]"); const item = document.querySelector("[data-run-history-status=succeeded]"); return Boolean(root?.dataset.lumiResultCurrent === "false" && root.innerText.includes("There is no current result for this graph and dataset") && item?.dataset.runHistoryFreshness === "historical" && item.innerText.includes("historical result") && !document.querySelector("[data-lumi-result-generate]")); })()';
  await waitFor(graphStale, 'stale notice and historical badge after semantic graph edit');
  const afterGraphEdit = await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => ({ status: api.getState().execution.runtime.status, current: document.querySelector('[data-lumi-result-reasoning]')?.dataset.lumiResultCurrent, freshness: document.querySelector('[data-run-history-status=succeeded]')?.dataset.runHistoryFreshness, canGenerate: Boolean(document.querySelector('[data-lumi-result-generate]')) }))`, true);
  assert.equal(afterGraphEdit.current, 'false', 'A semantic graph edit removes current-result eligibility.');
  assert.equal(afterGraphEdit.freshness, 'historical', 'The previous successful Run is displayed as historical after a graph edit.');
  assert.equal(afterGraphEdit.canGenerate, false, 'A stale Run cannot generate a current interpretation.');

  currentStage = 'refresh-run-after-graph-edit';
  await clickSelector('[data-runner-execute]');
  await waitFor('Boolean(document.querySelector("[data-lumi-result-reasoning]")?.dataset.lumiResultCurrent === "true" && document.querySelector("[data-run-history-status=succeeded][data-run-history-freshness=current]"))', 'fresh result after graph edit');

  currentStage = 'stale-after-dataset-replacement';
  await agent('setDataset', [{ name: 'F3 replacement dataset', task: 'regression', featureColumns: ['feature_x'], targetColumn: 'target_y', rows: Array.from({ length: 16 }, (_, index) => ({ feature_x: 120001.125 + index * 0.375, target_y: 100.125 + (120001.125 + index * 0.375) * 0.75 })) }]);
  const datasetStale = '(() => { const root = document.querySelector("[data-lumi-result-reasoning]"); const item = document.querySelector("[data-run-history-status=succeeded]"); return Boolean(root?.dataset.lumiResultCurrent === "false" && root.innerText.includes("There is no current result for this graph and dataset") && item?.dataset.runHistoryFreshness === "historical" && item.innerText.includes("historical result") && !document.querySelector("[data-lumi-result-generate]")); })()';
  await waitFor(datasetStale, 'stale notice and historical badge after dataset replacement');
  const afterDatasetChange = await evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => {
    const runtime = api.getState().execution.runtime;
    return {
      status: runtime.status,
      current: document.querySelector('[data-lumi-result-reasoning]')?.dataset.lumiResultCurrent,
      freshness: document.querySelector('[data-run-history-status=succeeded]')?.dataset.runHistoryFreshness,
      canGenerate: Boolean(document.querySelector('[data-lumi-result-generate]')),
    };
  })`, true);
  assert.equal(afterDatasetChange.current, 'false', 'A replacement dataset removes current-result eligibility.');
  assert.equal(afterDatasetChange.freshness, 'historical', 'The successful Run is displayed as historical after dataset replacement.');
  assert.equal(afterDatasetChange.canGenerate, false, 'A stale Run cannot generate a current interpretation after dataset replacement.');
  assert.equal(fixtureRequests.length, 3, 'Freshness changes do not invoke the provider policy.');
  console.log(JSON.stringify({ result: 'PASS', scenarios: ['real-browser-run-current-binding', 'no-consent-local-fallback', 'consented-provider-http-request', 'typed-fact-referenced-response', 'no-raw-data-or-opaque-identifiers', 'stale-provider-response-local-fallback', 'provider-output-does-not-mutate-run', 'selected-suggestion-routes-through-f2-c1-and-c2', 'read-only-preview-before-explicit-apply', 'no-automatic-rerun', 'layout-only-apply-remains-current', 'graph-edit-shows-stale-and-historical', 'dataset-replacement-shows-stale-and-historical', 'stale-result-cannot-generate-interpretation'], requestCount: fixtureRequests.length }, null, 2));
}

let failure = null;
try { await run(); }
catch (error) { failure = error; console.error(`Stage ${currentStage}:`, error?.stack ?? String(error)); }
finally {
  cdp?.close();
  stopProcess(chromeProcess);
  stopProcess(viteProcess);
  if (fixtureServer?.listening) await new Promise((resolve) => fixtureServer.close(resolve));
  try {
    const resolvedTemp = path.resolve(tempRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());
    if (resolvedTemp.startsWith(resolvedSystemTemp + path.sep) && path.basename(resolvedTemp).startsWith('volk-lumi-result-f3-')) fs.rmSync(resolvedTemp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
}
if (failure) process.exitCode = 1;
