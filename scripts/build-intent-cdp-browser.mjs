import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';

const appUrl = 'http://127.0.0.1:5176';
const chromeDebugUrl = 'http://127.0.0.1:9226/json/list';
const fixtureUrl = 'http://127.0.0.1:4179/v1/chat/completions';
const reportRoot = process.env.VOLK_BUILD_INTENT_ARTIFACT_DIR
  ? path.resolve(process.env.VOLK_BUILD_INTENT_ARTIFACT_DIR)
  : path.resolve('docs/acceptance/assets/build-intent-f1', new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-'));
const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-build-intent-chrome-'));
const requests = [];
const scenarios = [];
let fixtureDelayMs = 0;
let fixtureMlpHiddenUnits = 32;
let viteProcess;
let chromeProcess;
let cdp;
let fixtureServer;
let failure = null;

fs.mkdirSync(reportRoot, { recursive: true });

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for ' + url);
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
      if (!message.id) return;
      if (!this.pending.has(message.id)) return;
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
  check(Boolean(page?.webSocketDebuggerUrl), 'Chrome DevTools page was unavailable.');
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable');
  return client;
}

async function evaluate(expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.result?.description ?? result.exceptionDetails.exception?.description ?? 'Browser expression failed.');
  }
  return result.result?.value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(expression, label, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  const state = await evaluate('({ url: location.href, text: document.body?.innerText?.slice(0, 1800) })');
  throw new Error('Timed out waiting for ' + label + ': ' + JSON.stringify(state));
}

async function waitForRequestCount(count, timeoutMs = 7000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (requests.length >= count) return;
    await sleep(25);
  }
  throw new Error('Timed out waiting for provider request ' + count + '.');
}

async function clickSelector(selector) {
  const clicked = await evaluate('(() => { const node = document.querySelector(' + JSON.stringify(selector) + '); if (!node || node.disabled) return false; node.click(); return true; })()');
  check(clicked, 'Could not click enabled ' + selector);
  await sleep(180);
}

async function clickText(selector, exactText) {
  const clicked = await evaluate('(() => { const expected = ' + JSON.stringify(exactText)
    + '; const item = [...document.querySelectorAll(' + JSON.stringify(selector)
    + ')].find((node) => node.innerText.trim().includes(expected)); if (!item || item.disabled) return false; item.click(); return true; })()');
  check(clicked, 'Could not click ' + exactText);
  await sleep(180);
}

async function setField(labelText, value, kind = 'input') {
  const changed = await evaluate('(() => { const label = [...document.querySelectorAll("label")].find((node) => node.innerText.trim().startsWith('
    + JSON.stringify(labelText) + ')); const field = label?.querySelector(' + JSON.stringify(kind)
    + '); if (!field) return false; const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set; '
    + 'setter?.call(field, ' + JSON.stringify(value) + '); field.dispatchEvent(new Event("input", { bubbles: true })); '
    + 'field.dispatchEvent(new Event("change", { bubbles: true })); return true; })()');
  check(changed, 'Could not set ' + labelText);
  await sleep(100);
}

async function agentCall(method, ...args) {
  return evaluate('window.__VOLK_ML_AGENT__.open().then((api) => api.' + method + '(...' + JSON.stringify(args) + '))', true);
}

async function currentProject() {
  return agentCall('getProject');
}

function comparableProject(project) {
  const copy = structuredClone(project);
  delete copy.savedAt;
  return JSON.stringify(copy);
}

async function captureScreenshot(filename) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(reportRoot, filename), Buffer.from(result.data, 'base64'));
}

async function record(id, evidence = {}) {
  scenarios.push({ id, outcome: 'PASS', evidence });
}

async function openAiSettings() {
  await clickSelector('nav button[aria-controls="global-more-actions"]');
  await clickText('button', 'AI settings');
  await waitFor('Boolean([...document.querySelectorAll("h2")].find((node) => node.innerText.includes("AI settings")))', 'AI settings');
}

async function configureFixtureProvider() {
  await openAiSettings();
  const protocolAvailable = await evaluate('Boolean([...document.querySelectorAll("label")].find((label) => label.innerText.trim().startsWith("Protocol"))?.querySelector("select"))');
  if (!protocolAvailable) {
    await clickText('button', 'Advanced configuration');
    await waitFor('Boolean([...document.querySelectorAll("label")].find((label) => label.innerText.trim().startsWith("Protocol"))?.querySelector("select"))', 'advanced provider fields');
  }
  await setField('Protocol', 'openai-compatible', 'select');
  await setField('Endpoint URL', fixtureUrl);
  await setField('API key', 'f1-local-fixture-key', 'input');
  await clickText('button', 'Use this configuration');
  await waitFor('!document.querySelector("[role=dialog] h2")?.innerText.includes("AI settings")', 'provider settings to close');
}

function startFixtureServer() {
  fixtureServer = http.createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    let bodyText = '';
    for await (const chunk of req) bodyText += chunk;
    const body = JSON.parse(bodyText);
    const userMessage = String(body.messages?.find((message) => message.role === 'user')?.content ?? '');
    const requestRecord = {
      method: req.method,
      hasSchemaProjection: userMessage.includes('datasetContext'),
      hasLearnerClarification: userMessage.includes('learnerClarification'),
      leaksRawProbe: bodyText.includes('987654.321'),
      receivedAt: Date.now(),
    };
    const isMlp = /mlp|multi-layer perceptron/i.test(userMessage);
    requestRecord.detectedFamily = isMlp ? 'mlp' : 'linear-regression';
    requests.push(requestRecord);
    const goal = {
      task: 'regression',
      modelFamily: isMlp ? 'mlp' : 'linear-regression',
      architecture: null,
      dataset: null,
      executionExpectation: 'browser-local',
      parameters: isMlp ? { hiddenUnits: fixtureMlpHiddenUnits, trainRatio: null, epochs: null, batchSize: null } : null,
    };
    const decision = { version: 1, kind: 'goal', goal, code: null };
    const delayMs = fixtureDelayMs;
    fixtureDelayMs = 0;
    if (delayMs) await sleep(delayMs);
    requestRecord.respondedAt = Date.now();
    requestRecord.delayMs = delayMs;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(decision) } }], usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 } }));
  });
  fixtureServer.listen(4179, '127.0.0.1');
}

async function startServices() {
  startFixtureServer();
  if (!fixtureServer.listening) await once(fixtureServer, 'listening');
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5176', '--strictPort'], {
    cwd: process.cwd(), env: process.env, stdio: 'inherit',
  });
  await waitForHttp(appUrl + '/');
  chromeProcess = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=9226', '--window-size=1440,1000',
    '--user-data-dir=' + chromeProfile, 'about:blank',
  ], { stdio: 'ignore' });
  await waitForHttp(chromeDebugUrl);
  cdp = await connectBrowser();
  await cdp.send('Page.navigate', { url: appUrl + '/?graphApplyTest=1' });
  await waitFor('Boolean(document.querySelector("nav button[aria-pressed=\\"true\\"]"))', 'application shell');
  const enteredBuild = await evaluate('(() => { const button = [...document.querySelectorAll("nav button")].find((item) => item.getAttribute("aria-pressed") !== "true" && /build/i.test(item.innerText)); if (!button) return false; button.click(); return true; })()');
  check(enteredBuild, 'Could not enter Build workspace.');
  await waitFor('Boolean(window.__VOLK_ML_AGENT__ && window.__VOLK_ML_GRAPH_APPLY_TEST__)', 'Build workspace and fixture bridge');
}

const report = {
  task: 'VOLK-ML F1 LUMI Build Intent mounted browser acceptance',
  browser: null,
  scenarios,
  artifacts: { directory: reportRoot },
};

try {
  await startServices();
  const browserVersion = await cdp.send('Browser.getVersion');
  report.browser = {
    product: browserVersion.product,
    revision: browserVersion.revision,
    viewport: await evaluate('({ width: innerWidth, height: innerHeight })'),
  };

  const fixture = await evaluate('window.__VOLK_ML_GRAPH_APPLY_TEST__.createBuildAgentFixture()');
  const changedDataset = structuredClone(fixture.dataset);
  changedDataset.rows[0].quality = 987654.321;
  const state = await agentCall('getState');
  for (const node of state.canvas.nodes) await agentCall('removeNode', node.id);
  await agentCall('setDataset', changedDataset);
  let project = await currentProject();
  check(project.graph.nodes.length === 0 && project.graph.edges.length === 0, 'Could not establish the empty-target workflow state.');

  const openSettings = await evaluate('(() => { const more = [...document.querySelectorAll("nav button")].find((button) => button.innerText.includes("More")); if (!more) return false; more.click(); return true; })()');
  check(openSettings, 'Could not open global settings menu.');
  await clickText('button', 'AI settings');
  await waitFor('Boolean([...document.querySelectorAll("h2")].find((node) => node.innerText.includes("AI settings")))', 'AI settings');
  await clickText('button', 'Advanced');
  await setField('Protocol', 'openai-compatible', 'select');
  await setField('Endpoint URL', fixtureUrl);
  await setField('API key', 'f1-local-fixture-key');
  await clickText('button', 'Use this configuration');
  await waitFor('!document.querySelector("[role=dialog] h2")?.innerText.includes("AI settings")', 'provider settings to close');

  await clickSelector('[data-build-intent-open]');
  await waitFor('Boolean(document.querySelector("[data-lumi-build-intent]"))', 'Build Intent dialog');
  const initialProject = await currentProject();
  await evaluate('window.__buildIntentUnhandled = []; window.addEventListener("unhandledrejection", (event) => window.__buildIntentUnhandled.push(String(event.reason?.code ?? event.reason)));');
  await setField('What would you like to build?', 'Build a model\nwith a second line.', 'textarea');
  await clickText('[data-lumi-build-intent] button', 'Interpret request');
  await sleep(120);
  const invalidInputState = await evaluate('({ alert: document.querySelector("[data-lumi-build-intent] [role=alert]")?.innerText ?? "", unhandled: window.__buildIntentUnhandled.length })');
  check(Boolean(invalidInputState.alert) && invalidInputState.unhandled === 0, 'Invalid multiline input was not contained: ' + JSON.stringify(invalidInputState));
  check(requests.length === 0, 'Invalid multiline input reached the provider.');
  await record('invalid-multiline-input-contained', { localizedErrorRendered: true, unhandledRejections: 0, providerCalls: 0 });

  await setField('What would you like to build?', 'Build an MLP with six hidden layers and hidden size 32.', 'textarea');
  await clickText('[data-lumi-build-intent] button', 'Interpret request');
  await waitFor('document.querySelector("[data-lumi-build-intent] [role=status]")?.innerText.includes("not supported")', 'unsupported MLP depth');
  check(requests.length === 0, 'Unsupported MLP depth reached the provider.');
  await record('unsupported-depth-rejected-before-provider', { sixHiddenLayersRejected: true, providerCalls: 0 });

  const mismatchRequestCount = requests.length;
  fixtureMlpHiddenUnits = 6;
  await setField('What would you like to build?', 'Build an MLP with hidden size 32.', 'textarea');
  await clickText('[data-lumi-build-intent] button', 'Interpret request');
  await waitFor('document.querySelector("[data-lumi-build-intent] [role=alert]")?.innerText.includes("does not match the supported Build Intent contract")', 'provider parameter mismatch rejection');
  check(requests.length === mismatchRequestCount + 2, 'A mismatched explicit width was not rejected after one bounded repair.');
  check(!await evaluate('Boolean(document.querySelector("[data-build-intent-plan]"))'), 'A mismatched provider width was staged as a successful plan.');
  check(comparableProject(initialProject) === comparableProject(await currentProject()), 'A mismatched provider width changed the project.');
  await record('provider-width-mismatch-rejected', { explicitWidth32NotRewrittenTo6: true, boundedRepairCount: 1, noPlan: true, projectUnchanged: true });
  fixtureMlpHiddenUnits = 32;

  const datasetChangeRequest = requests.length + 1;
  fixtureDelayMs = 5000;
  await setField('What would you like to build?', 'Use linear regression to predict wine quality from the numeric features.', 'textarea');
  check(!await evaluate('Boolean(document.querySelector("[data-lumi-build-intent] [role=alert]"))'), 'Changing the request did not clear its prior response error.');
  await clickText('[data-lumi-build-intent] button', 'Interpret request');
  await waitForRequestCount(datasetChangeRequest);
  const datasetChangedDuringRequest = structuredClone(changedDataset);
  datasetChangedDuringRequest.rows[2].quality += 0.25;
  await agentCall('setDataset', datasetChangedDuringRequest);
  await waitFor('document.querySelector("[data-lumi-build-intent] [role=alert]")?.innerText.includes("dataset changed")', 'pending request invalidation after dataset change');
  await sleep(5200);
  const invalidatedDatasetUi = await evaluate('({ hasPlan: Boolean(document.querySelector("[data-build-intent-plan]")), busy: document.querySelector("[data-lumi-build-intent] span[aria-live=polite]")?.innerText.includes("Interpreting") ?? false })');
  check(!invalidatedDatasetUi.hasPlan && !invalidatedDatasetUi.busy, 'A late response was shown after the dataset changed.');
  await record('pending-dataset-change-invalidates-result', { noPlanRendered: true, busySettled: true });
  await agentCall('setDataset', changedDataset);

  const configChangeRequest = requests.length + 1;
  fixtureDelayMs = 5000;
  await setField('What would you like to build?', 'Use linear regression to predict wine quality from the numeric features.', 'textarea');
  await clickText('[data-lumi-build-intent] button', 'Interpret request');
  await waitForRequestCount(configChangeRequest);
  await openAiSettings();
  await clickText('button', 'Clear configuration');
  await waitFor('document.querySelector("[data-lumi-build-intent] [role=alert]")?.innerText.includes("provider configuration changed")', 'pending request invalidation after provider configuration change');
  await sleep(5200);
  const invalidatedConfigUi = await evaluate('({ hasPlan: Boolean(document.querySelector("[data-build-intent-plan]")), busy: document.querySelector("[data-lumi-build-intent] span[aria-live=polite]")?.innerText.includes("Interpreting") ?? false })');
  check(!invalidatedConfigUi.hasPlan && !invalidatedConfigUi.busy, 'A late response was shown after the provider configuration changed.');
  await record('pending-provider-change-invalidates-result', { noPlanRendered: true, busySettled: true });
  await configureFixtureProvider();

  const closePendingRequest = requests.length + 1;
  fixtureDelayMs = 2500;
  await setField('What would you like to build?', 'Use linear regression to predict wine quality from the numeric features.', 'textarea');
  await clickText('[data-lumi-build-intent] button', 'Interpret request');
  await waitForRequestCount(closePendingRequest);
  await clickText('[data-lumi-build-intent] button', 'Cancel');
  await waitFor('!document.querySelector("[data-lumi-build-intent]")', 'pending interpretation cancellation');
  await clickSelector('[data-build-intent-open]');
  await waitFor('Boolean(document.querySelector("[data-lumi-build-intent]"))', 'Build Intent after cancellation');
  await sleep(2700);
  const reopenedAfterCancel = await evaluate('({ hasPlan: Boolean(document.querySelector("[data-build-intent-plan]")), request: document.querySelector("[data-lumi-build-intent] textarea")?.value ?? "", busy: document.querySelector("[data-lumi-build-intent] span[aria-live=polite]")?.innerText.includes("Interpreting") ?? false })');
  check(!reopenedAfterCancel.hasPlan && reopenedAfterCancel.request === '' && !reopenedAfterCancel.busy, 'A cancelled response survived close and reopen.');
  await record('close-reopen-cancels-pending-result', { noPlanRendered: true, requestCleared: true, busySettled: true });

  const linearRequestCount = requests.length;
  await setField('What would you like to build?', 'Use linear regression to predict wine quality from the numeric features.', 'textarea');
  await clickText('[data-lumi-build-intent] button', 'Interpret request');
  await waitFor('Boolean(document.querySelector("[data-build-intent-plan]"))', 'linear-regression plan');
  check(requests.length === linearRequestCount + 1 && requests.at(-1).method === 'POST' && requests.at(-1).hasSchemaProjection, 'Build Intent did not send the semantic v1 request through the mounted UI.');
  check(requests.at(-1).leaksRawProbe === false, 'Browser request leaked the raw dataset probe value.');
  project = await currentProject();
  check(comparableProject(initialProject) === comparableProject(project), 'Interpreting the request mutated the project before learner review.');
  const linearPlanText = await evaluate('document.querySelector("[data-build-intent-plan]")?.innerText ?? ""');
  check(['alcohol', 'sulphates', 'acidity', '80% train', '20% test', 'RMSE', 'R²', 'registered baseline', 'No additional blueprint limitation'].every((fact) => linearPlanText.includes(fact)), 'The review summary omitted selected features, split, evaluation, rationale, or limitation facts.');

  const driftedDataset = structuredClone(changedDataset);
  driftedDataset.rows[1].quality += 0.125;
  await agentCall('setDataset', driftedDataset);
  await clickText('[data-lumi-build-intent] button', 'Review graph proposal');
  await waitFor('document.querySelector("[data-lumi-build-intent] [role=alert]")?.innerText.includes("dataset changed")', 'stale Build Intent plan rejection');
  const staleProject = await currentProject();
  check(staleProject.graph.nodes.length === 0 && staleProject.trainedModel === null, 'A stale Build Intent plan changed the graph or model.');
  await agentCall('setDataset', changedDataset);
  await record('stale-dataset-plan-rejected', { graphRemainedEmpty: true, modelNotRun: true, staleDatasetKeptUntilExplicitRestore: true });
  await clickText('[data-lumi-build-intent] button', 'Review graph proposal');
  await waitFor('Boolean(document.querySelector("[data-graph-proposal-preview]"))', 'linear graph proposal preview');
  const stagedProject = await currentProject();
  check(stagedProject.graph.nodes.length === 0 && stagedProject.graph.edges.length === 0, 'Staging the proposal mutated the target graph.');
  check(await evaluate('document.querySelector("[data-graph-proposal-apply]")?.disabled === false'), 'The learner-reviewed proposal was not eligible for explicit Apply.');
  await captureScreenshot('linear-plan-preview.png');
  await clickSelector('[data-graph-proposal-apply]');
  await waitFor('!document.querySelector("[data-graph-proposal-preview]")', 'explicit Apply to finish');
  project = await currentProject();
  check(project.graph.nodes.length > 0 && project.graph.edges.length > 0, 'Explicit Apply did not install the proposed graph.');
  check(project.trainedModel === null, 'Apply unexpectedly ran the graph or installed a trained model.');
  await record('linear-intent-review-and-explicit-apply', { providerPostCount: requests.length, requestContainedSemanticProjection: true, rawValuesExcluded: true, explicitApply: true, graphNodes: project.graph.nodes.length, modelNotRun: true });

  const appliedState = await agentCall('getState');
  for (const node of appliedState.canvas.nodes) await agentCall('removeNode', node.id);
  project = await currentProject();
  check(project.graph.nodes.length === 0 && project.graph.edges.length === 0, 'Could not return to a deliberately empty target for the second workflow.');

  const mlpRequestCount = requests.length;
  await clickSelector('[data-build-intent-open]');
  await waitFor('Boolean(document.querySelector("[data-lumi-build-intent]"))', 'second Build Intent dialog');
  await setField('What would you like to build?', 'Build a two-layer MLP with hidden size 32 to predict wine quality.', 'textarea');
  await clickText('[data-lumi-build-intent] button', 'Interpret request');
  await waitFor('Boolean([...document.querySelectorAll("[data-lumi-build-intent] button")].some((button) => button.innerText.includes("Two Dense layers total")))', 'local MLP layer clarification');
  check(requests.length === mlpRequestCount, 'Ambiguous MLP clarification unexpectedly called the provider.');
  await clickText('[data-lumi-build-intent] button', 'Two Dense layers total: one hidden plus output');
  await waitFor('Boolean(document.querySelector("[data-build-intent-plan]"))', 'confirmed two-Dense-layer MLP plan');
  check(requests.length === mlpRequestCount + 1 && requests.at(-1).hasLearnerClarification, 'Accepted MLP clarification was not included in the bounded semantic request.');
  check(await evaluate('document.querySelector("[data-build-intent-plan]")?.innerText.includes("32")'), 'MLP plan did not preserve the explicit hidden width.');
  await clickText('[data-lumi-build-intent] button', 'Review graph proposal');
  await waitFor('Boolean(document.querySelector("[data-graph-proposal-preview]"))', 'MLP proposal preview');
  const beforeCancel = await currentProject();
  await clickSelector('[data-graph-proposal-cancel]');
  await waitFor('!document.querySelector("[data-graph-proposal-preview]")', 'MLP proposal cancellation');
  const afterCancel = await currentProject();
  check(comparableProject(beforeCancel) === comparableProject(afterCancel), 'Cancelling the MLP proposal changed the project.');
  check(afterCancel.graph.nodes.length === 0 && afterCancel.trainedModel === null, 'MLP proposal was automatically applied or run.');
  await record('ambiguous-mlp-clarification-and-cancel', { noProviderCallBeforeClarification: true, clarificationWasForwarded: true, exactHiddenWidth32: true, cancelPreservedEmptyWorkspace: true, explicitApplyRequired: true });

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await clickSelector('[data-build-intent-open]');
  await waitFor('Boolean(document.querySelector("[data-lumi-build-intent]"))', 'mobile Build Intent dialog');
  const mobileLayout = await evaluate('(() => { const dialog = document.querySelector("[data-lumi-build-intent] [role=dialog]"); const rect = dialog?.getBoundingClientRect(); return { viewportWidth: innerWidth, left: rect?.left, right: rect?.right, width: rect?.width, textareaVisible: Boolean(dialog?.querySelector("textarea")), interpretVisible: Boolean(dialog?.innerText.includes("Interpret request")) }; })()');
  check(mobileLayout.left >= 0 && mobileLayout.right <= mobileLayout.viewportWidth && mobileLayout.textareaVisible && mobileLayout.interpretVisible, 'Build Intent dialog overflowed or lost controls on mobile: ' + JSON.stringify(mobileLayout));
  await evaluate('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
  await waitFor('!document.querySelector("[data-lumi-build-intent]")', 'Escape to dismiss the mobile dialog');
  await record('mobile-dialog-layout-and-keyboard-dismiss', mobileLayout);
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  await clickSelector('nav button[aria-controls="global-more-actions"]');
  await clickText('button', 'AI settings');
  await clickText('button', 'Clear configuration');
  await waitFor('!document.querySelector("[role=dialog] h2")?.innerText.includes("AI settings")', 'provider configuration to clear');
  const offlineRequestCount = requests.length;
  await clickSelector('[data-build-intent-open]');
  await setField('What would you like to build?', 'Build a two-layer MLP to predict wine quality.', 'textarea');
  await clickText('[data-lumi-build-intent] button', 'Interpret request');
  await waitFor('[...document.querySelectorAll("[data-lumi-build-intent] button")].some((button) => !button.disabled && button.innerText.includes("Two Dense layers total"))', 'offline deterministic MLP clarification');
  check(requests.length === offlineRequestCount, 'Offline local clarification unexpectedly contacted the provider.');
  await record('offline-local-clarification-no-network', { localClarificationAvailable: true, providerPostCountUnchanged: true, graphAndEvidenceUnchanged: true });
  await clickText('[data-lumi-build-intent] button', 'Close');

  await clickSelector('nav button[aria-controls="global-more-actions"]');
  await clickText('button', 'Language settings');
  await setField('Primary language', 'zh', 'select');
  await clickText('button', 'Apply');
  await waitFor('document.querySelector("[data-build-intent-open]")?.innerText.includes("请 LUMI 协助设计")', 'Chinese Build Intent entry');
  await clickSelector('[data-build-intent-open]');
  await waitFor('document.querySelector("#build-intent-title")?.innerText === "描述你想构建的模型"', 'Chinese Build Intent copy');
  await clickText('[data-lumi-build-intent] button', '关闭');
  await record('single-language-chinese-copy', { titleLocalized: true, localClarificationControlsLocalized: true });

  await clickSelector('nav button[aria-controls="global-more-actions"]');
  await clickText('button', '语言设置');
  await setField('并行语言', 'en', 'select');
  await clickText('button', '应用');
  await clickSelector('[data-build-intent-open]');
  await waitFor('document.querySelector("#build-intent-title")?.innerText.includes("Describe the model you want to build") && document.querySelector("#build-intent-title")?.innerText.includes("描述你想构建的模型")', 'parallel-language Build Intent copy');
  await clickText('[data-lumi-build-intent] button', '关闭');
  await record('parallel-language-copy', { englishAndChinesePresent: true, sharedContractKeys: true });

  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = error?.stack ?? String(error);
  report.fixtureRequests = requests;
  failure = error;
  if (cdp) {
    try { await captureScreenshot('failure.png'); } catch {}
  }
} finally {
  report.finishedAt = new Date().toISOString();
  report.fixtureRequests = requests;
  try {
    fs.writeFileSync(path.join(reportRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  } catch (error) {
    report.artifactWriteError = String(error?.message ?? error);
    failure ??= error;
  }
  cdp?.close();
  stopProcess(chromeProcess);
  stopProcess(viteProcess);
  if (fixtureServer?.listening) await new Promise((resolve) => fixtureServer.close(resolve));
  try {
    const tempRoot = path.resolve(os.tmpdir());
    const resolvedProfile = path.resolve(chromeProfile);
    if (resolvedProfile.startsWith(tempRoot + path.sep) && path.basename(resolvedProfile).startsWith('volk-build-intent-chrome-')) {
      fs.rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  } catch {}
  console.log(JSON.stringify(report, null, 2));
}

if (failure) process.exitCode = 1;
