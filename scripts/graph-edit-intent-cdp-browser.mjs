import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { componentById } from '../src/core/components.js';
import { createAgentNode } from '../src/core/canvasAgent.js';
import { createCustomComposite } from '../src/core/customComposites.js';

const taskRoot = process.env.VOLK_F2_TASK_ROOT ?? 'D:\\VOLK-ML-F2-acceptance-20260927\\continuation';
const baseUrl = 'http://127.0.0.1:5178';
const fixtureUrl = 'http://127.0.0.1:4180';
const debugUrl = 'http://127.0.0.1:9228/json/list';
const outputDirectory = path.join(taskRoot, 'evidence', `graph-edit-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`);
const profileRoot = path.join(taskRoot, 'temp');
const viteCache = path.join(taskRoot, 'vite-cache');
for (const directory of [outputDirectory, profileRoot, viteCache]) fs.mkdirSync(directory, { recursive: true });

const chromePath = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chromeProfile = fs.mkdtempSync(path.join(profileRoot, 'volk-graph-edit-intent-'));
const fixtureKey = 'f2-local-fixture-secret';
const privateNodeIds = ['f2-input-a', 'f2-dense-a', 'f2-dense-b', 'f2-add-a', 'f2-table-a'];
const privateProjectName = 'F2 private project title';
let viteProcess = null;
let chromeProcess = null;
let cdp = null;
let fixtureMode = 'normal';
let fixtureCalls = [];
let corsPreflights = 0;
const scenarios = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function stopProcess(child) { if (child && child.exitCode === null) { try { child.kill(); } catch {} } }

function fixturePlan(intent) {
  const projection = intent?.semanticGraphContext;
  const names = new Map((projection?.componentCatalog ?? []).map((entry) => [entry.ref, entry.name ?? '']));
  const dense = projection?.nodes?.find((entry) => /dense/i.test(names.get(entry.componentRef) ?? entry.name ?? ''));
  const input = projection?.nodes?.find((entry) => /tensor input/i.test(names.get(entry.componentRef) ?? entry.name ?? ''));
  if (!dense || !input) return { version: 1, requestId: intent?.requestId, kind: 'clarification', steps: [], code: 'request-ambiguous' };
  return { version: 1, requestId: intent.requestId, kind: 'plan', steps: [{ op: 'MOVE_NODE', nodeRef: dense.ref, relation: 'right-of', anchorRef: input.ref }], code: null };
}

const fixtureServer = http.createServer((request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  response.setHeader('access-control-allow-headers', 'authorization, content-type');
  if (request.method === 'OPTIONS') { corsPreflights += 1; response.writeHead(204); response.end(); return; }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') { response.writeHead(404); response.end(); return; }
  let raw = '';
  request.on('data', (chunk) => { raw += chunk; if (raw.length > 1_000_000) request.destroy(); });
  request.on('end', () => {
    let body;
    try { body = JSON.parse(raw || '{}'); } catch { response.writeHead(400); response.end(); return; }
    const user = (body.messages ?? []).find((entry) => entry.role === 'user')?.content ?? '';
    let intent;
    try { intent = JSON.parse(user); } catch {}
    fixtureCalls.push({
      mode: fixtureMode,
      status: fixtureMode === 'http-503' ? 503 : 200,
      requestId: intent?.requestId ?? null,
      contract: intent?.contract ?? null,
      nodeCount: intent?.semanticGraphContext?.nodes?.length ?? 0,
      edgeCount: intent?.semanticGraphContext?.edges?.length ?? 0,
      boundedRequest: String(intent?.learnerRequest ?? '').length <= 240,
      excludesRawGraphIds: privateNodeIds.every((id) => !String(user).includes(id)),
      excludesProjectName: !String(user).includes(privateProjectName),
      excludesCredentialFromBody: !raw.includes(fixtureKey),
    });
    if (fixtureMode === 'network-drop') { response.destroy(); return; }
    if (fixtureMode === 'http-503') { response.writeHead(503, { 'content-type': 'application/json' }); response.end('{"error":{"message":"fixture unavailable"}}'); return; }
    const content = fixtureMode === 'malformed' ? '{not-json' : JSON.stringify(fixturePlan(intent));
    const send = () => { if (response.destroyed) return; response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { content } }] })); };
    if (fixtureMode === 'delay') setTimeout(send, 900); else send();
  });
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

async function evaluate(expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Browser evaluation failed.');
  return result.result?.value;
}

async function waitFor(expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await sleep(100); }
  const diagnostic = await evaluate('({ href: location.href, width: innerWidth, text: document.body?.innerText?.slice(0, 1600) })');
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(diagnostic)}`);
}

async function waitUntil(predicate, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(100); }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function waitForHttp(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { if ((await fetch(url)).ok) return; } catch {} await sleep(100); }
  throw new Error(`Timed out waiting for ${url}`);
}

async function clickSelector(selector) {
  const result = await evaluate(`(() => { const item = document.querySelector(${JSON.stringify(selector)}); if (!item || item.disabled) return false; item.click(); return true; })()`);
  assert.equal(result, true, `Enabled UI control exists: ${selector}`);
  await sleep(150);
}

async function clickText(selector, text) {
  const result = await evaluate(`(() => { const item = [...document.querySelectorAll(${JSON.stringify(selector)})].find((entry) => (entry.textContent ?? '').includes(${JSON.stringify(text)})); if (!item || item.disabled) return false; item.click(); return true; })()`);
  assert.equal(result, true, `Enabled control includes text: ${text}`);
  await sleep(150);
}

async function setValue(selector, value) {
  const result = await evaluate(`(() => {
    const item = document.querySelector(${JSON.stringify(selector)});
    if (!item) return false;
    const prototype = item instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : item instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) return false;
    setter.call(item, ${JSON.stringify(value)});
    item.dispatchEvent(new Event('input', { bubbles: true }));
    item.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  assert.equal(result, true, `Field exists: ${selector}`);
  await sleep(80);
}

async function setLabelField(labelText, value, fieldType) {
  const result = await evaluate(`(() => {
    const label = [...document.querySelectorAll('label')].find((entry) => (entry.innerText ?? '').toLowerCase().includes(${JSON.stringify(labelText.toLowerCase())}));
    const field = label?.querySelector(${JSON.stringify(fieldType)});
    if (!field) return false;
    const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return field.value;
  })()`);
  assert.equal(result, String(value), `Field under ${labelText} label accepts the requested value.`);
  await sleep(80);
}

async function agentCall(method, ...args) {
  return evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => api[${JSON.stringify(method)}](...${JSON.stringify(args)}))`, true);
}

async function agentDo(method, ...args) {
  return evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => { await api[${JSON.stringify(method)}](...${JSON.stringify(args)}); return true; })`, true);
}

async function currentProject() {
  const text = await evaluate('window.__VOLK_ML_AGENT__.open().then((api) => JSON.stringify(api.getProject()))', true);
  assert.equal(typeof text, 'string', 'Canonical project snapshot is JSON-safe.');
  return JSON.parse(text);
}

function stableProject(project) {
  const copy = structuredClone(project);
  delete copy.savedAt;
  for (const node of copy.graph?.nodes ?? []) delete node.measured;
  return JSON.stringify(copy);
}
async function record(id, evidence = {}) { scenarios.push({ id, outcome: 'PASS', evidence }); }

async function openBuild() {
  await waitFor('Boolean(document.querySelector("nav[aria-label]"))', 'application navigation', 30_000);
  const clicked = await evaluate(`(() => { const button = [...document.querySelectorAll('nav[aria-label] button')].find((item) => /build/i.test(item.innerText ?? '')); if (!button) return false; button.click(); return true; })()`);
  assert.equal(clicked, true, 'Build navigation is present.');
  await waitFor('Boolean(document.querySelector("[data-build-surface]")) && Boolean(window.__VOLK_ML_AGENT__?.listInstances?.().length)', 'mounted Build and Canvas Agent');
}

async function currentProjectReset(nodeSpecs, edges = []) {
  if (await evaluate('Boolean(document.querySelector("[data-graph-patch-preview]"))')) await clickSelector('[data-graph-patch-cancel]');
  if (await evaluate('Boolean(document.querySelector("[data-lumi-graph-edit]"))')) await clickSelector('[data-lumi-graph-edit] header button');
  const before = await currentProject();
  for (const node of before.graph.nodes) await agentDo('removeNode', node.id);
  const next = await currentProject();
  if (next.name !== privateProjectName) await agentDo('renameProject', privateProjectName);
  for (const [index, spec] of nodeSpecs.entries()) {
    await agentDo('addNode', { componentId: spec.componentId, id: spec.id, position: spec.position ?? { x: index * 220, y: 80 } });
  }
  for (const edge of edges) await agentDo('connect', edge);
  const result = await currentProject();
  assert.equal(result.graph.nodes.length, nodeSpecs.length, 'Fixture graph node count is exact.');
  assert.equal(result.graph.edges.length, edges.length, 'Fixture graph edge count is exact.');
  return result;
}

async function seedStandard() {
  return currentProjectReset([
    { componentId: 'tensor_input_node', id: 'f2-input-a' },
    { componentId: 'dense_node', id: 'f2-dense-a' },
    { componentId: 'dense_node', id: 'f2-dense-b' },
    { componentId: 'add_node', id: 'f2-add-a' },
    { componentId: 'tabular_data_node', id: 'f2-table-a' },
  ], [
    { id: 'f2-edge-input-dense-a', source: 'f2-input-a', sourceHandle: 'tensor', target: 'f2-dense-a', targetHandle: 'input' },
    { id: 'f2-edge-input-dense-b', source: 'f2-input-a', sourceHandle: 'tensor', target: 'f2-dense-b', targetHandle: 'input' },
    { id: 'f2-edge-dense-a-add', source: 'f2-dense-a', sourceHandle: 'output', target: 'f2-add-a', targetHandle: 'a' },
    { id: 'f2-edge-dense-b-add', source: 'f2-dense-b', sourceHandle: 'output', target: 'f2-add-a', targetHandle: 'b' },
  ]);
}

async function openEditor() {
  await clickSelector('[data-graph-edit-open]');
  await waitFor('Boolean(document.querySelector("[data-lumi-graph-edit] textarea"))', 'graph-edit dialog');
}

async function closeEditor() {
  if (await evaluate('Boolean(document.querySelector("[data-lumi-graph-edit]"))')) {
    await clickSelector('[data-lumi-graph-edit] header button');
    await waitFor('!document.querySelector("[data-lumi-graph-edit]")', 'editor closed');
  }
}

async function setRequest(value) { await setValue('[data-lumi-graph-edit] textarea', value); }

async function outcomeSummary() {
  return evaluate(`(() => ({
    plan: Boolean(document.querySelector('[data-graph-edit-plan]')),
    clarification: Boolean(document.querySelector('[data-graph-edit-clarification]')),
    alert: document.querySelector('[data-lumi-graph-edit] [role=alert]')?.innerText ?? '',
    reason: document.querySelector('[data-graph-edit-clarification] h3')?.innerText ?? '',
    candidates: [...document.querySelectorAll('[data-graph-edit-candidate]')].map((item) => ({ kind: item.dataset.graphEditCandidate, label: item.innerText })),
  }))()`);
}

async function waitForOutcome(timeoutMs = 10_000) {
  await waitFor('Boolean(document.querySelector("[data-graph-edit-plan], [data-graph-edit-clarification], [data-lumi-graph-edit] [role=alert], [data-lumi-graph-edit] [role=status]"))', 'interpretation outcome', timeoutMs);
}

async function interpretLocally(request) {
  await openEditor();
  await setRequest(request);
  assert.equal(await evaluate('document.querySelector("[data-lumi-graph-edit] input[type=checkbox]")?.checked ?? null'), false, 'Local path does not opt into provider use.');
  const calls = fixtureCalls.length;
  await clickSelector('[data-graph-edit-interpret]');
  await waitForOutcome();
  assert.equal(fixtureCalls.length, calls, 'Local resolver sends no HTTP request.');
}

async function selectCandidate(kind, labelPart = '', index = 0) {
  const label = await evaluate(`(() => {
    const list = [...document.querySelectorAll('[data-graph-edit-candidate]')].filter((item) => item.dataset.graphEditCandidate === ${JSON.stringify(kind)});
    const item = ${JSON.stringify(labelPart)} ? list.find((entry) => (entry.innerText ?? '').toLowerCase().includes(${JSON.stringify(labelPart.toLowerCase())})) : list[${index}];
    if (!item) return null;
    item.click();
    return item.innerText;
  })()`);
  assert.ok(label, `A ${kind} candidate exists${labelPart ? ` matching ${labelPart}` : ''}.`);
  await waitFor('Boolean(document.querySelector("[data-graph-edit-resolve]"))', 'continue with selected candidate');
  await clickSelector('[data-graph-edit-resolve]');
  await waitForOutcome();
  return label;
}

async function readPatch() {
  return evaluate(`(() => {
    const root = document.querySelector('[data-graph-patch-preview]');
    if (!root) return null;
    return {
      applyDisabled: root.querySelector('[data-graph-patch-apply]')?.disabled ?? true,
      beforeAfterViews: root.querySelectorAll('[data-graph-patch-readonly]').length,
      operations: [...root.querySelectorAll('ol li')].map((item) => item.innerText),
      changeItems: root.querySelectorAll('[data-patch-item]').length,
      eligibility: root.querySelector('[data-graph-patch-eligibility]')?.innerText ?? '',
    };
  })()`);
}

async function stageDiff() {
  await clickSelector('[data-graph-edit-review]');
  await waitFor('Boolean(document.querySelector("[data-graph-patch-preview]"))', 'read-only graph diff');
  const patch = await readPatch();
  assert.ok(patch && !patch.applyDisabled, `Patch preview is eligible: ${JSON.stringify(patch)}`);
  assert.equal(patch.beforeAfterViews, 2, 'Before and after graph views are both read-only.');
  return patch;
}

async function applyDiff() {
  const patch = await stageDiff();
  await clickSelector('[data-graph-patch-apply]');
  await waitFor('!document.querySelector("[data-graph-patch-preview]") && !document.querySelector("[data-lumi-graph-edit]")', 'explicit Apply committed');
  return { patch, project: await currentProject() };
}

async function cancelDiff() {
  const before = await currentProject();
  const patch = await stageDiff();
  await clickSelector('[data-graph-patch-cancel]');
  await waitFor('!document.querySelector("[data-graph-patch-preview]") && !document.querySelector("[data-lumi-graph-edit]")', 'Cancel closed preview');
  assert.equal(stableProject(before), stableProject(await currentProject()), 'Cancel leaves the canonical project unchanged.');
  return patch;
}

async function configureProvider() {
  await clickSelector('nav button[aria-controls="global-more-actions"]');
  await clickText('#global-more-actions button', 'AI settings');
  await waitFor('Boolean([...document.querySelectorAll("h2")].some((item) => /AI settings/i.test(item.innerText)))', 'provider settings dialog');
  await setLabelField('Model', '__custom__', 'select');
  await setLabelField('Model', 'f2-browser-fixture', 'input');
  await setLabelField('API key', fixtureKey, 'input');
  await clickText('button', 'Advanced configuration');
  await waitFor('Boolean([...document.querySelectorAll("label")].find((item) => /protocol/i.test(item.innerText))?.querySelector("select"))', 'advanced provider settings');
  await setLabelField('Protocol', 'openai-compatible', 'select');
  await setLabelField('Endpoint URL', `${fixtureUrl}/v1/chat/completions`, 'input');
  await clickText('button', 'Use this configuration');
  await waitFor('![...document.querySelectorAll("h2")].some((item) => /AI settings/i.test(item.innerText))', 'provider settings closed');
}

async function setConsent(checked) {
  const actual = await evaluate(`(() => { const input = document.querySelector('[data-lumi-graph-edit] input[type="checkbox"]'); if (!input) return null; if (input.checked !== ${checked}) input.click(); return input.checked; })()`);
  assert.equal(actual, checked, 'Provider consent is explicit and per-request.');
}

async function providerFailure(mode) {
  fixtureMode = mode;
  await openEditor();
  await setRequest('move Dense / Linear right of Tensor Input');
  await setConsent(true);
  const before = await currentProject();
  const count = fixtureCalls.length;
  await clickSelector('[data-graph-edit-interpret]');
  await waitFor('Boolean(document.querySelector("[data-lumi-graph-edit] [role=alert]"))', `${mode} local fallback`, 15_000);
  const outcome = await outcomeSummary();
  assert.match(outcome.alert, /provider|服务商/i, `${mode} shows a contained provider diagnostic.`);
  assert.equal(await evaluate('Boolean(document.querySelector("[data-graph-patch-preview]"))'), false, `${mode} cannot stage a patch.`);
  assert.equal(stableProject(before), stableProject(await currentProject()), `${mode} leaves the graph unchanged.`);
  assert.ok(fixtureCalls.length > count, `${mode} reached the real local HTTP fixture.`);
  await closeEditor();
  await record(`provider-${mode}-local-fallback`, { calls: fixtureCalls.length - count, graphUnchanged: true });
}

async function addCustomComposite() {
  const dense = createAgentNode({ nodes: [], manifest: componentById.get('dense_node'), request: { id: 'f2-custom-inner-dense', position: { x: 0, y: 0 } } });
  const relu = createAgentNode({ nodes: [dense], manifest: componentById.get('relu_node'), request: { id: 'f2-custom-inner-relu', position: { x: 220, y: 0 } } });
  const edge = { id: 'f2-custom-internal-edge', source: dense.id, sourceHandle: 'output', target: relu.id, targetHandle: 'input', type: 'deletable' };
  const definition = createCustomComposite({ selectedNodes: [dense, relu], edges: [edge], name: 'Custom Feature Block', color: '#0f766e' }).manifest;
  const current = await currentProject();
  await agentDo('loadProject', { ...current, customComponents: [...(current.customComponents ?? []), definition] });
  return definition;
}

async function recordScreenshot(name) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(outputDirectory, name), Buffer.from(result.data, 'base64'));
}

async function start() {
  await new Promise((resolve, reject) => fixtureServer.listen(4180, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const viteSource = `import { createServer } from 'vite'; const server = await createServer({ root: process.cwd(), cacheDir: ${JSON.stringify(viteCache)}, server: { host: '127.0.0.1', port: 5178, strictPort: true } }); await server.listen();`;
  viteProcess = spawn(process.execPath, ['--input-type=module', '-e', viteSource], { cwd: process.cwd(), env: process.env, stdio: 'ignore' });
  await waitForHttp(`${baseUrl}/`);
  chromeProcess = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9228', '--window-size=1440,1000', `--user-data-dir=${chromeProfile}`, 'about:blank'], { stdio: 'ignore' });
  await waitForHttp(debugUrl);
  const pages = await (await fetch(debugUrl)).json();
  const page = pages.find((entry) => entry.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'Chrome CDP page exists.');
  cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.navigate', { url: baseUrl });
  await openBuild();
}

const report = {
  schema: 'volk-ml-f2-graph-edit-mounted-browser-acceptance-v1',
  task: 'Typed graph-edit ambiguity resolution, local/provider workflows, and explicit Apply',
  browser: null,
  fixture: { url: fixtureUrl, calls: fixtureCalls, corsPreflights: 0 },
  scenarios,
  artifacts: { directory: outputDirectory },
  result: 'RUNNING',
};

try {
  await start();
  const browser = await cdp.send('Browser.getVersion');
  report.browser = { product: browser.product, viewport: await evaluate('({ width: innerWidth, height: innerHeight })') };
  await currentProjectReset([], []);
  await seedStandard();
  await configureProvider();

  const noConsentCalls = fixtureCalls.length;
  await openEditor();
  await setRequest('move Dense / Linear right of Tensor Input');
  await clickSelector('[data-graph-edit-interpret]');
  await waitForOutcome();
  assert.equal((await outcomeSummary()).clarification, true, 'Unconsented local parsing reveals ambiguous node targets.');
  assert.equal(fixtureCalls.length, noConsentCalls, 'No provider call occurs without learner consent.');
  await closeEditor();
  await record('provider-declined-consent-runs-locally-with-no-request', { providerCalls: 0 });

  await openEditor();
  await setRequest('move Dense / Linear right of Tensor Input');
  await setConsent(true);
  await clickSelector('[data-graph-edit-interpret]');
  await waitFor('Boolean(document.querySelector("[data-graph-edit-plan]"))', 'typed provider proposal');
  assert.ok(corsPreflights > 0, 'Cross-origin provider request completes CORS preflight.');
  assert.equal(fixtureCalls.at(-1)?.contract, 'GraphEditIntentPlanV1');
  assert.ok(fixtureCalls.at(-1)?.requestId);
  assert.equal(fixtureCalls.at(-1)?.excludesRawGraphIds, true);
  assert.equal(fixtureCalls.at(-1)?.excludesProjectName, true);
  assert.equal(fixtureCalls.at(-1)?.excludesCredentialFromBody, true);
  const providerPatch = await cancelDiff();
  await record('consented-provider-plan-is-typed-preview-only-and-cancelable', { request: fixtureCalls.at(-1), preflights: corsPreflights, patch: providerPatch, canonicalProjectUnchanged: true });

  await currentProjectReset([{ componentId: 'tensor_input_node', id: 'f2-input-a' }, { componentId: 'dense_node', id: 'f2-dense-a' }]);
  const localCalls = fixtureCalls.length;
  await openEditor();
  await setRequest('set Dense / Linear units to 96');
  await clickSelector('[data-graph-edit-interpret]');
  await waitFor('Boolean(document.querySelector("[data-graph-edit-plan]"))', 'local UPDATE plan');
  const beforeLocal = await currentProject();
  const appliedLocal = await applyDiff();
  assert.equal(appliedLocal.project.graph.nodes.find((node) => node.id === 'f2-dense-a').data.parameters.units, 96);
  assert.notEqual(stableProject(beforeLocal), stableProject(appliedLocal.project), 'The workspace changes only after Apply.');
  assert.equal(fixtureCalls.length, localCalls, 'Local UPDATE uses no provider request.');
  await record('local-update-uses-the-mounted-preview-and-explicit-apply', { before: 64, after: 96, providerCalls: 0, operations: appliedLocal.patch.operations });

  await currentProjectReset([{ componentId: 'dense_node', id: 'f2-dense-a' }]);
  await openEditor();
  await setRequest('set Dense / Linear units or use bias to 96');
  await clickSelector('[data-graph-edit-interpret]');
  await waitForOutcome();
  let outcome = await outcomeSummary();
  assert.ok(outcome.clarification && outcome.candidates.length === 2 && outcome.candidates.every((item) => item.kind === 'property'));
  const propertySelection = await selectCandidate('property', 'units');
  assert.equal((await outcomeSummary()).plan, true);
  const propertyApply = await applyDiff();
  assert.equal(propertyApply.project.graph.nodes.find((node) => node.id === 'f2-dense-a').data.parameters.units, 96);
  await record('property-candidates-are-typed-consumed-and-applied', { selected: propertySelection, candidates: outcome.candidates.map((item) => item.label) });

  await currentProjectReset([{ componentId: 'tensor_input_node', id: 'f2-input-a' }]);
  await openEditor();
  await setRequest('add a component');
  await clickSelector('[data-graph-edit-interpret]');
  await waitForOutcome();
  outcome = await outcomeSummary();
  assert.ok(outcome.candidates.length > 1 && outcome.candidates.every((item) => item.kind === 'component'));
  const componentSelection = await selectCandidate('component', 'Dense / Linear');
  const componentApply = await applyDiff();
  assert.equal(componentApply.project.graph.nodes.filter((node) => node.data.manifest.id === 'dense_node').length, 1);
  await record('built-in-component-candidate-is-consumed-and-applied', { selected: componentSelection, nodeCount: componentApply.project.graph.nodes.length });

  await currentProjectReset([{ componentId: 'relu_node', id: 'f2-relu-a' }]);
  const composite = await addCustomComposite();
  await openEditor();
  await setRequest('add Custom Feature Block');
  await clickSelector('[data-graph-edit-interpret]');
  await waitFor('Boolean(document.querySelector("[data-graph-edit-plan]"))', 'custom composite ADD plan');
  const customApply = await applyDiff();
  assert.ok(customApply.project.customComponents.some((item) => item.id === composite.id));
  assert.ok(customApply.project.graph.nodes.some((node) => node.data.manifest.id === composite.id));
  await record('existing-custom-composite-can-be-added-through-the-same-intent-contract', { componentId: composite.id });

  await seedStandard();
  await openEditor();
  await setRequest('remove Tensor Input');
  await clickSelector('[data-graph-edit-interpret]');
  await waitFor('Boolean(document.querySelector("[data-graph-edit-plan]"))', 'remove-node plan');
  const cascadeBefore = await currentProject();
  const cascadePatch = await stageDiff();
  assert.equal(cascadePatch.operations.length, 3, 'Two disconnect operations are explicit before removal.');
  await clickSelector('[data-graph-patch-apply]');
  await waitFor('!document.querySelector("[data-graph-patch-preview]") && !document.querySelector("[data-lumi-graph-edit]")', 'cascade Apply');
  const cascadeAfter = await currentProject();
  assert.equal(cascadeAfter.graph.nodes.some((node) => node.id === 'f2-input-a'), false);
  assert.equal(cascadeAfter.graph.edges.length, cascadeBefore.graph.edges.length - 2);
  await record('remove-previews-full-disconnect-cascade-before-explicit-apply', { operations: cascadePatch.operations, removedEdges: 2 });

  await seedStandard();
  await openEditor();
  await setRequest('disconnect a connection');
  await clickSelector('[data-graph-edit-interpret]');
  await waitForOutcome();
  outcome = await outcomeSummary();
  assert.ok(outcome.candidates.length === 4 && outcome.candidates.every((item) => item.kind === 'edge'));
  const edgeSelection = await selectCandidate('edge', '', 1);
  assert.equal((await outcomeSummary()).plan, true);
  const edgeApply = await applyDiff();
  assert.equal(edgeApply.project.graph.edges.length, 3);
  await record('ambiguous-edge-choice-is-consumed-and-applied', { selected: edgeSelection, remainingEdges: 3 });

  await currentProjectReset([{ componentId: 'dense_node', id: 'f2-dense-a' }, { componentId: 'dense_node', id: 'f2-dense-b' }]);
  await openEditor();
  await setRequest('remove Dense / Linear');
  await clickSelector('[data-graph-edit-interpret]');
  await waitForOutcome();
  outcome = await outcomeSummary();
  assert.ok(outcome.candidates.length === 2 && outcome.candidates.every((item) => item.kind === 'node'));
  const nodeSelection = await selectCandidate('node', 'node option 2');
  assert.equal((await outcomeSummary()).plan, true);
  const nodeApply = await applyDiff();
  assert.deepEqual(nodeApply.project.graph.nodes.map((node) => node.id), ['f2-dense-a']);
  await record('ambiguous-node-choice-is-consumed-and-applied', { selected: nodeSelection, remaining: 'f2-dense-a' });

  await currentProjectReset([{ componentId: 'tensor_input_node', id: 'f2-input-a' }, { componentId: 'add_node', id: 'f2-add-a' }]);
  await openEditor();
  await setRequest('connect Tensor Input to Add');
  await clickSelector('[data-graph-edit-interpret]');
  await waitForOutcome();
  outcome = await outcomeSummary();
  assert.ok(outcome.candidates.length === 2 && outcome.candidates.every((item) => item.kind === 'port-pair'));
  const portSelection = await selectCandidate('port-pair', '.b');
  assert.equal((await outcomeSummary()).plan, true);
  const portApply = await applyDiff();
  assert.equal(portApply.project.graph.edges[0].targetHandle, 'b');
  await record('ambiguous-compatible-port-choice-is-consumed-and-applied', { selected: portSelection, targetPort: 'b' });

  await currentProjectReset([{ componentId: 'dense_node', id: 'f2-dense-a' }, { componentId: 'dense_node', id: 'f2-dense-b' }, { componentId: 'add_node', id: 'f2-add-a' }]);
  await openEditor();
  await setRequest('connect Dense / Linear to Add');
  await clickSelector('[data-graph-edit-interpret]');
  await waitForOutcome();
  outcome = await outcomeSummary();
  assert.ok(outcome.candidates.length > 1 && outcome.candidates.every((item) => item.kind === 'node-pair'));
  const pairSelection = await selectCandidate('node-pair', 'Connect Dense / Linear to Add');
  outcome = await outcomeSummary();
  assert.ok(outcome.clarification && outcome.candidates.length === 2 && outcome.candidates.every((item) => item.kind === 'port-pair'));
  const nestedPort = await selectCandidate('port-pair', '.b');
  assert.equal((await outcomeSummary()).plan, true);
  const pairApply = await applyDiff();
  assert.equal(pairApply.project.graph.edges[0].targetHandle, 'b');
  assert.ok(['f2-dense-a', 'f2-dense-b'].includes(pairApply.project.graph.edges[0].source));
  await record('ambiguous-node-pair-and-port-pair-selections-are-consumed', { pairSelection, nestedPort, edge: pairApply.project.graph.edges[0] });

  await currentProjectReset([{ componentId: 'tabular_data_node', id: 'f2-table-a' }, { componentId: 'dense_node', id: 'f2-dense-a' }]);
  const invalidBefore = await currentProject();
  await openEditor();
  await setRequest('connect Table to Dense / Linear');
  await clickSelector('[data-graph-edit-interpret]');
  await waitForOutcome();
  outcome = await outcomeSummary();
  assert.ok(outcome.clarification);
  assert.ok(outcome.reason.length > 0, 'The invalid typed request explains why it needs clarification.');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-graph-edit-review], [data-graph-patch-preview]"))'), false);
  assert.equal(stableProject(invalidBefore), stableProject(await currentProject()));
  await closeEditor();
  await record('invalid-typed-connection-has-no-review-or-mutation', { reason: outcome.reason });

  await currentProjectReset([
    { componentId: 'dense_node', id: 'f2-dense-a', position: { x: 200, y: 100 } },
    { componentId: 'dense_node', id: 'f2-dense-b', position: { x: 200, y: 300 } },
    { componentId: 'tensor_input_node', id: 'f2-input-a', position: { x: 0, y: 100 } },
  ]);
  await openEditor();
  await setRequest('move Dense / Linear right of Tensor Input');
  await clickSelector('[data-graph-edit-interpret]');
  await waitForOutcome();
  outcome = await outcomeSummary();
  assert.ok(outcome.candidates.length > 1 && outcome.candidates.every((item) => item.kind === 'node-pair'));
  const moveSelection = await selectCandidate('node-pair', 'Move Dense / Linear relative to Tensor Input');
  assert.equal((await outcomeSummary()).plan, true);
  const beforeMove = await currentProject();
  const moveApply = await applyDiff();
  const moved = moveApply.project.graph.nodes.filter((node) => node.data.manifest.id === 'dense_node').filter((node) => node.position.x > beforeMove.graph.nodes.find((old) => old.id === node.id).position.x);
  assert.equal(moved.length, 1, 'Only the selected node moves relative to its anchor.');
  await record('move-node-selection-uses-the-selected-node-pair', { selected: moveSelection, moved: moved.map((node) => ({ id: node.id, position: node.position })) });

  await seedStandard();
  await providerFailure('network-drop');
  await providerFailure('http-503');
  await providerFailure('malformed');

  fixtureMode = 'delay';
  await openEditor();
  await setRequest('move Dense / Linear right of Tensor Input');
  await setConsent(true);
  const staleCalls = fixtureCalls.length;
  await clickSelector('[data-graph-edit-interpret]');
  await waitUntil(() => fixtureCalls.length > staleCalls, 'delayed provider request reaches fixture');
  const dense = (await currentProject()).graph.nodes.find((node) => node.id === 'f2-dense-a');
  assert.ok(dense);
  await agentDo('updateNode', dense.id, { parameters: { units: dense.data.parameters.units + 1 } });
  await waitFor('Boolean(document.querySelector("[data-lumi-graph-edit] [role=alert]"))', 'stale provider response diagnostic');
  await sleep(1_100);
  const staleOutcome = await outcomeSummary();
  assert.match(staleOutcome.alert, /graph or provider changed|图或服务商设置/i);
  assert.equal(staleOutcome.plan, false);
  assert.equal(await evaluate('Boolean(document.querySelector("[data-graph-patch-preview]"))'), false);
  await closeEditor();
  await record('stale-provider-result-is-discarded-after-graph-identity-changes', { requestCount: fixtureCalls.length - staleCalls, planDiscarded: true });

  await currentProjectReset([{ componentId: 'dense_node', id: 'f2-dense-a' }, { componentId: 'dense_node', id: 'f2-dense-b' }]);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await openEditor();
  assert.equal(await evaluate('document.activeElement === document.querySelector("[data-lumi-graph-edit] textarea")'), true, 'Focus enters the request field.');
  assert.equal(await evaluate('document.querySelector("[data-lumi-graph-edit] [role=dialog]").getBoundingClientRect().width <= innerWidth'), true, 'Dialog fits compact width.');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor('!document.querySelector("[data-lumi-graph-edit]")', 'Escape closes the modal');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await record('compact-mobile-keyboard-focus-and-escape-dismissal', { width: 390, focusStartsInRequest: true, escapeDismisses: true });

  await clickSelector('nav button[aria-controls="global-more-actions"]');
  await clickSelector('#global-more-actions button:last-child');
  await waitFor('Boolean(document.querySelector("div.fixed.inset-0.z-50 select"))', 'language settings dialog');
  await setLabelField('Primary language', 'zh', 'select');
  await setLabelField('Parallel language', 'none', 'select');
  await clickSelector('div.fixed.inset-0.z-50 section > button:last-child');
  await waitFor('!document.querySelector("div.fixed.inset-0.z-50")', 'Chinese settings applied');
  await waitFor('JSON.parse(localStorage.getItem("volk-ml-language-settings") || "{}").primary === "zh"', 'Chinese preference persisted');
  await openEditor();
  const zhTitle = await evaluate('document.querySelector("#graph-edit-title")?.innerText ?? ""');
  assert.match(zhTitle, /描述要对这张图做的更改/);
  await setRequest('删除 全连接 / 线性层');
  await clickSelector('[data-graph-edit-interpret]');
  await waitForOutcome();
  outcome = await outcomeSummary();
  assert.ok(outcome.candidates.length === 2 && outcome.candidates.every((item) => item.kind === 'node'));
  assert.match(outcome.candidates[0].label, /全连接/);
  await closeEditor();
  await record('chinese-local-node-chooser', { title: zhTitle, candidateLabels: outcome.candidates.map((item) => item.label) });

  await clickSelector('nav button[aria-controls="global-more-actions"]');
  await clickSelector('#global-more-actions button:last-child');
  await waitFor('Boolean(document.querySelector("div.fixed.inset-0.z-50 select"))', 'parallel-language dialog');
  await setLabelField('主要语言', 'zh', 'select');
  await setLabelField('并行语言', 'en', 'select');
  await clickSelector('div.fixed.inset-0.z-50 section > button:last-child');
  await waitFor('!document.querySelector("div.fixed.inset-0.z-50")', 'parallel language applied');
  await openEditor();
  const parallelTitle = await evaluate('document.querySelector("#graph-edit-title")?.innerText ?? ""');
  assert.match(parallelTitle, /描述要对这张图做的更改/);
  assert.match(parallelTitle, /Describe a change to this graph/);
  await closeEditor();
  await record('parallel-language-graph-editor-remains-readable', { title: parallelTitle });

  assert.ok(corsPreflights >= 1, `Expected at least one cross-origin provider request to complete CORS preflight; saw ${corsPreflights}.`);
  assert.ok(fixtureCalls.every((call) => call.boundedRequest && call.excludesRawGraphIds && call.excludesProjectName && call.excludesCredentialFromBody), 'All captured provider requests exclude raw IDs, project name and credential from body.');
  report.fixture.calls = fixtureCalls;
  report.fixture.corsPreflights = corsPreflights;
  report.result = 'PASS';
  await recordScreenshot('graph-edit-parallel-language.png');
} catch (error) {
  report.result = 'FAIL';
  report.error = error?.stack ?? String(error);
  report.fixture.calls = fixtureCalls;
  report.fixture.corsPreflights = corsPreflights;
  if (cdp) { try { await recordScreenshot('graph-edit-failure.png'); } catch {} }
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  report.chromeProfile = chromeProfile;
  fs.writeFileSync(path.join(outputDirectory, 'browser-evidence.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  cdp?.close();
  stopProcess(chromeProcess);
  stopProcess(viteProcess);
  fixtureServer.close();
  console.log(JSON.stringify(report, null, 2));
}
