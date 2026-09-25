import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const baseUrl = 'http://127.0.0.1:5176';
const chromeDebugUrl = 'http://127.0.0.1:9226/json/list';
const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-graph-patch-c2-'));
let viteProcess = null;
let chromeProcess = null;
let cdp = null;
const scenarios = [];
const browserErrors = [];

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
      if (!message.id) {
        if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? 'Runtime exception');
        if (message.method === 'Log.entryAdded' && message.params.entry?.level === 'error') browserErrors.push(message.params.entry.text);
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserErrors.push((message.params.args ?? []).map((item) => item.value ?? item.description).join(' '));
        return;
      }
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

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function connectBrowser() {
  const pages = await (await fetch(chromeDebugUrl)).json();
  const page = pages.find((item) => item.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('Chrome DevTools page was unavailable.');
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable');
  return client;
}

async function evaluate(expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Browser evaluation failed.');
  return result.result?.value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, label, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(predicate)) return;
    await sleep(100);
  }
  const details = await evaluate('({ url: location.href, ready: document.readyState, body: document.body?.innerHTML?.slice(0, 1400), text: document.body?.innerText?.slice(0, 2200), root: document.getElementById("root")?.innerHTML?.slice(0, 2400), graphPatch: Boolean(document.querySelector("[data-graph-patch-preview]")), graphProposal: Boolean(document.querySelector("[data-graph-proposal-preview]")), patchBlockCode: document.querySelector("[data-graph-patch-preview]")?.getAttribute("data-apply-block-code"), patchApplyDisabled: document.querySelector("[data-graph-patch-apply]")?.disabled, patchEligibility: document.querySelector("[data-graph-patch-eligibility]")?.innerText })');
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify({ ...details, browserErrors })}`);
}

async function clickSelector(selector) {
  const clicked = await evaluate(`(() => { const item = document.querySelector(${JSON.stringify(selector)}); if (!item || item.disabled) return false; item.click(); return true; })()`);
  if (!clicked) throw new Error(`Could not click enabled control ${selector}`);
  await sleep(180);
}

async function agentCall(method, ...args) {
  return evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => api.${method}(...${JSON.stringify(args)}))`, true);
}

async function currentProject() { return agentCall('getProject'); }

function comparableProject(project) {
  const copy = structuredClone(project);
  delete copy.savedAt;
  return JSON.stringify(copy);
}

async function stageProposal(proposal) {
  return evaluate(`window.__VOLK_ML_GRAPH_APPLY_TEST__.stageProposal(${JSON.stringify(proposal)})`, true);
}

async function patchFixture() {
  return evaluate('window.__VOLK_ML_GRAPH_APPLY_TEST__.createOccupiedPatchFixture()', true);
}

async function readPatchPreview() {
  return evaluate(`(() => {
    const root = document.querySelector('[data-graph-patch-preview]');
    const dialog = root?.querySelector('[role="dialog"]');
    const rect = dialog?.getBoundingClientRect();
    const footer = root?.querySelector('footer')?.getBoundingClientRect();
    const apply = root?.querySelector('[data-graph-patch-apply]');
    const cancel = root?.querySelector('[data-graph-patch-cancel]');
    const groups = Object.fromEntries([...root?.querySelectorAll('[data-patch-diff-group]') ?? []].map((group) => [group.getAttribute('data-patch-diff-group'), group.querySelectorAll('[data-patch-item]').length]));
    return {
      visible: Boolean(root),
      blockedBy: root?.getAttribute('data-apply-block-code') || null,
      applyDisabled: apply?.disabled ?? null,
      accessibleDialog: Boolean(dialog?.getAttribute('aria-modal') === 'true'),
      focusStartsOnCancel: document.activeElement === cancel,
      interactiveControlsInsideReadOnlyGraphs: root?.querySelectorAll('[data-graph-patch-readonly] button,[data-graph-patch-readonly] input,[data-graph-patch-readonly] select,[data-graph-patch-readonly] textarea').length ?? 0,
      nodeMarkers: root?.querySelectorAll('[data-graph-patch-node]').length ?? 0,
      groups,
      unsupportedNotice: root?.innerText.includes('Unsupported operations') ?? false,
      viewport: { width: innerWidth, height: innerHeight },
      dialogRect: rect ? { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left } : null,
      footerRect: footer ? { top: footer.top, right: footer.right, bottom: footer.bottom, left: footer.left } : null,
      text: root?.innerText ?? '',
    };
  })()`);
}

async function record(id, evidence = {}) { scenarios.push({ id, result: 'PASS', evidence }); }

async function setLanguage(primary, secondary = 'none') {
  await clickSelector('nav button[aria-controls="global-more-actions"]');
  const opened = await evaluate(`(() => { const items = document.querySelectorAll('#global-more-actions button'); const item = items[items.length - 1]; if (!item) return false; item.click(); return true; })()`);
  if (!opened) throw new Error('Could not open language preferences.');
  await waitFor('document.querySelectorAll("section select").length >= 2', 'language preferences');
  const selected = await evaluate(`(() => {
    const selects = [...document.querySelectorAll('section select')].slice(-2);
    if (selects.length !== 2) return false;
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    set.call(selects[0], ${JSON.stringify(primary)});
    selects[0].dispatchEvent(new Event('change', { bubbles: true }));
    set.call(selects[1], ${JSON.stringify(secondary)});
    selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    const apply = selects[1].closest('section')?.querySelectorAll('button');
    apply?.[apply.length - 1]?.click();
    return true;
  })()`);
  if (!selected) throw new Error('Could not set language preferences.');
  await sleep(250);
}

async function keyPress(key, code, windowsVirtualKeyCode) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  await sleep(120);
}

async function openBuild() {
  await waitFor(`Boolean(document.querySelector('nav button[aria-pressed="true"]'))`, 'application shell');
  const entered = await evaluate(`(() => { const button = [...document.querySelectorAll('nav button')].find((item) => item.innerText.trim() === 'Build' || item.innerText.includes('构建')); if (!button) return false; button.click(); return true; })()`);
  if (!entered) throw new Error('Could not enter Build.');
  await waitFor('Boolean(window.__VOLK_ML_AGENT__ && window.__VOLK_ML_AGENT__.listInstances().length && window.__VOLK_ML_GRAPH_APPLY_TEST__)', 'Build workspace and source-neutral submission bridge');
}

async function startServices() {
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5176', '--strictPort'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  await waitForHttp(`${baseUrl}/`);
  chromeProcess = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--disable-gpu',
    '--remote-debugging-port=9226',
    '--window-size=1440,1000',
    `--user-data-dir=${chromeProfile}`,
    'about:blank',
  ], { stdio: 'ignore' });
  await waitForHttp(chromeDebugUrl);
  cdp = await connectBrowser();
  await cdp.send('Page.navigate', { url: `${baseUrl}/?graphApplyTest=1` });
  await openBuild();
}

const report = { task: 'VOLK-ML C2 Graph Patch Preview/Apply mounted browser acceptance', scenarios, browser: null };

try {
  await startServices();
  const browserVersion = await cdp.send('Browser.getVersion');
  report.browser = { product: browserVersion.product, userAgent: await evaluate('navigator.userAgent') };

  const initialFixture = await patchFixture();
  await agentCall('setDataset', initialFixture.dataset);
  const initialProject = await currentProject();
  const invalid = structuredClone(initialFixture.proposal);
  invalid.rationale += ' changed';
  const invalidResult = await stageProposal(invalid);
  if (invalidResult.ok) throw new Error('Tampered patch unexpectedly staged.');
  await waitFor('!document.querySelector("[data-graph-patch-preview]")', 'invalid patch remains outside preview');
  const afterInvalid = await currentProject();
  if (comparableProject(initialProject) !== comparableProject(afterInvalid)) throw new Error('Invalid patch changed the canonical project.');
  await record('invalid-proposal-rejected-locally', { diagnostic: invalidResult.diagnostics?.[0]?.code, noPreview: true, projectUnchanged: true });

  const stageEnglish = await stageProposal(initialFixture.proposal);
  if (!stageEnglish.ok) throw new Error(`Could not stage the valid occupied-graph patch: ${JSON.stringify(stageEnglish)}`);
  await waitFor('Boolean(document.querySelector("[data-graph-patch-preview]"))', 'English patch preview');
  const englishPreview = await readPatchPreview();
  if (!englishPreview.accessibleDialog || englishPreview.applyDisabled || !englishPreview.focusStartsOnCancel || englishPreview.interactiveControlsInsideReadOnlyGraphs !== 0) {
    throw new Error(`English preview was not accessible and read-only: ${JSON.stringify(englishPreview)}`);
  }
  for (const kind of ['existing', 'removed', 'changed', 'added']) {
    if (!(englishPreview.groups[`node-${kind}`] > 0)) throw new Error(`Node diff category ${kind} was not visibly represented: ${JSON.stringify(englishPreview.groups)}`);
  }
  for (const kind of ['existing', 'removed', 'added', 'changed']) {
    if (englishPreview.groups[`edge-${kind}`] === undefined) throw new Error(`Edge diff category ${kind} was not rendered.`);
  }
  if (!englishPreview.unsupportedNotice) throw new Error('Preview omitted the unsupported-operation notice.');
  if (comparableProject(initialProject) !== comparableProject(await currentProject())) throw new Error('Opening the patch preview changed the canonical project.');
  await record('english-read-only-diff-and-cancel', { groups: englishPreview.groups, keyboardFocus: 'Cancel', readonlyControlCount: 0, noMutation: true });
  await clickSelector('[data-graph-patch-cancel]');
  await waitFor('!document.querySelector("[data-graph-patch-preview]")', 'cancel closes patch preview');
  if (comparableProject(initialProject) !== comparableProject(await currentProject())) throw new Error('Cancel changed the canonical project.');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await setLanguage('zh', 'none');
  const chineseFixture = await patchFixture();
  const stageChinese = await stageProposal(chineseFixture.proposal);
  if (!stageChinese.ok) throw new Error(`Chinese patch failed to stage: ${JSON.stringify(stageChinese)}`);
  await waitFor('Boolean(document.querySelector("[data-graph-patch-preview]"))', 'Chinese compact patch preview');
  const chinesePreview = await readPatchPreview();
  if (!chinesePreview.text.includes('应用前请检查这些更改')) throw new Error('Chinese single-language copy was not shown.');
  if (chinesePreview.dialogRect.top < 0 || chinesePreview.dialogRect.bottom > chinesePreview.viewport.height + 1
    || chinesePreview.footerRect.bottom > chinesePreview.viewport.height + 1) throw new Error('Compact preview controls overflowed the viewport.');
  await record('chinese-compact-layout', { viewport: chinesePreview.viewport, dialogRect: chinesePreview.dialogRect, controlsVisible: chinesePreview.footerRect.bottom <= chinesePreview.viewport.height + 1 });
  await clickSelector('[data-graph-patch-cancel]');
  await waitFor('!document.querySelector("[data-graph-patch-preview]")', 'Chinese preview cancellation');

  await setLanguage('en', 'zh');
  const parallelFixture = await patchFixture();
  const stageParallel = await stageProposal(parallelFixture.proposal);
  if (!stageParallel.ok) throw new Error(`Parallel-language patch failed to stage: ${JSON.stringify(stageParallel)}`);
  await waitFor('Boolean(document.querySelector("[data-graph-patch-preview]"))', 'parallel-language compact patch preview');
  const parallelPreview = await readPatchPreview();
  if (!parallelPreview.text.includes('Review these changes before applying') || !parallelPreview.text.includes('应用前请检查这些更改')) {
    throw new Error('Parallel-language copy was not shown in the patch preview.');
  }
  await keyPress('Escape', 'Escape', 27);
  await waitFor('!document.querySelector("[data-graph-patch-preview]")', 'Escape closes parallel-language preview');
  await record('parallel-language-and-keyboard-cancel', { englishAndChinesePresent: true, escapeCloses: true });

  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await setLanguage('en', 'none');
  const staleFixture = await patchFixture();
  const projectBeforeStale = await currentProject();
  const staleStage = await stageProposal(staleFixture.proposal);
  if (!staleStage.ok) throw new Error(`Could not stage stale-guard scenario: ${JSON.stringify(staleStage)}`);
  await waitFor('Boolean(document.querySelector("[data-graph-patch-preview]"))', 'stale patch preview');
  const originalPosition = projectBeforeStale.graph.nodes.find((node) => node.id === 'pipeline-linear').position;
  await agentCall('updateNode', 'pipeline-linear', { position: { x: originalPosition.x + 5, y: originalPosition.y + 7 } });
  await waitFor('document.querySelector("[data-graph-patch-preview]")?.getAttribute("data-apply-block-code") === "GRAPH_PATCH_BASE_STALE"', 'stale base blocks Apply');
  const stalePreview = await readPatchPreview();
  if (!stalePreview.applyDisabled) throw new Error('A stale patch still allowed Apply.');
  await clickSelector('[data-graph-patch-cancel]');
  await waitFor('!document.querySelector("[data-graph-patch-preview]")', 'stale preview cancellation');
  const learnerMutation = await currentProject();
  if (learnerMutation.graph.nodes.find((node) => node.id === 'pipeline-linear').position.x !== originalPosition.x + 5) throw new Error('The newer learner graph mutation was overwritten.');
  await agentCall('updateNode', 'pipeline-linear', { position: originalPosition });
  await record('stale-live-graph-edit-preserved', { blockedBy: stalePreview.blockedBy, learnerMutationPreserved: true });

  const finalFixture = await patchFixture();
  const beforeApply = await currentProject();
  const finalStage = await stageProposal(finalFixture.proposal);
  if (!finalStage.ok) throw new Error(`Final patch failed to stage: ${JSON.stringify(finalStage)}`);
  await waitFor('Boolean(document.querySelector("[data-graph-patch-preview]"))', 'final eligible patch preview');
  const finalPreview = await readPatchPreview();
  if (finalPreview.applyDisabled) throw new Error(`Final patch unexpectedly blocked: ${finalPreview.blockedBy}`);
  await keyPress('Tab', 'Tab', 9);
  const focusedApply = await evaluate('document.activeElement?.matches("[data-graph-patch-apply]") ?? false');
  if (!focusedApply) throw new Error('Tab did not move focus from Cancel to Apply.');
  await evaluate(`(() => { window.__patchKeyboardTrace = []; document.addEventListener('keydown', (event) => window.__patchKeyboardTrace.push({ type: 'keydown', key: event.key, target: event.target?.getAttribute?.('data-graph-patch-apply') !== null ? event.target?.outerHTML?.slice(0, 160) : event.target?.tagName }), true); document.querySelector('[data-graph-patch-apply]')?.addEventListener('click', () => window.__patchKeyboardTrace.push({ type: 'button-click' })); })()`);
  await keyPress(' ', 'Space', 32);
  const keyboardTrace = await evaluate('window.__patchKeyboardTrace');
  if (!keyboardTrace.some((event) => event.type === 'button-click')) throw new Error(`Space did not activate the focused Apply button: ${JSON.stringify(keyboardTrace)}`);
  await waitFor('!document.querySelector("[data-graph-patch-preview]")', 'explicit keyboard Apply');
  const appliedProject = await currentProject();
  const appliedById = new Map(appliedProject.graph.nodes.map((node) => [node.id, node]));
  if (!appliedById.has('patch-added-evaluate') || appliedById.has('pipeline-predictor')) throw new Error('Patch node additions/removals did not apply exactly.');
  const linearAfter = appliedById.get('pipeline-linear');
  if (linearAfter.data.parameters[finalFixture.expected.parameter] !== finalFixture.expected.afterValue) throw new Error('Patch parameter change was not applied.');
  if (linearAfter.position.x !== beforeApply.graph.nodes.find((node) => node.id === 'pipeline-linear').position.x + 24) throw new Error('Patch layout move was not applied.');
  if (!appliedProject.graph.edges.some((edge) => edge.id === 'patch-edge-added') || appliedProject.graph.edges.some((edge) => edge.id === 'optimizer-predictor')) throw new Error('Patch connection changes did not apply exactly.');
  if (appliedProject.name !== beforeApply.name || JSON.stringify(appliedProject.data) !== JSON.stringify(beforeApply.data)
    || JSON.stringify(appliedProject.language) !== JSON.stringify(beforeApply.language)
    || JSON.stringify(appliedProject.workspace) !== JSON.stringify(beforeApply.workspace)) throw new Error('Patch Apply overwrote unrelated project metadata or dataset.');
  if (appliedProject.trainedModel !== null) throw new Error('Semantic graph Apply did not invalidate trained-model state.');
  if (await evaluate('window.__VOLK_ML_GRAPH_APPLY_TEST__.validateCurrentProject()', true) !== true) throw new Error('Applied patch failed canonical project validation.');
  await record('explicit-keyboard-apply', { added: 'patch-added-evaluate', removed: 'pipeline-predictor', changed: 'pipeline-linear', metadataPreserved: true, canonicalValidation: true, applyInitiallyFocused: finalPreview.focusStartsOnCancel });

  await agentCall('updateNode', 'pipeline-linear', { parameters: { ...linearAfter.data.parameters, learning_rate: Math.min(0.2, linearAfter.data.parameters.learning_rate + 0.001) } });
  const runResult = await agentCall('run');
  if (!runResult?.type) throw new Error('The patched graph did not run through the normal browser runtime.');
  const exported = await agentCall('exportCode', 'pytorch');
  if (typeof exported !== 'string' || exported.length < 100) throw new Error('The patched graph did not export through the normal compiler path.');
  const download = await agentCall('downloadProject');
  if (!download?.filename || download.bytes < 100) throw new Error('The patched project did not serialize through the normal project path.');
  await waitFor("document.querySelector('[data-build-toolbar]')?.innerText.includes('Saved locally')", 'normal local autosave after patched graph edit', 12000);
  await record('post-apply-edit-run-export-save', { editAccepted: true, runType: runResult.type, exportCharacters: exported.length, downloadBytes: download.bytes, localAutosave: true });

  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = error?.stack ?? String(error);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  cdp?.close();
  stopProcess(chromeProcess);
  stopProcess(viteProcess);
  try { fs.rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  console.log(JSON.stringify(report, null, 2));
}
