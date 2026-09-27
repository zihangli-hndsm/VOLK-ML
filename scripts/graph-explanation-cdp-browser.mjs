import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const baseUrl = 'http://127.0.0.1:5176';
const chromeDebugUrl = 'http://127.0.0.1:9226/json/list';
const graphDepths = ['Phenomenon', 'Evidence', 'Mechanism', 'Representation', 'Math', 'Code'];
const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-graph-explanation-chrome-'));
const chromePath = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browserErrors = [];
let viteProcess = null;
let chromeProcess = null;
let cdp = null;
let providerCallCount = 0;
const providerRequestQuestions = [];

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
    this.eventHandlers = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id && message.method) {
        const handler = this.eventHandlers.get(message.method);
        if (handler) Promise.resolve(handler(message.params)).catch(() => {});
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

  onEvent(method, handler) { this.eventHandlers.set(method, handler); }

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

async function evaluate(expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.result?.description ?? result.exceptionDetails.text ?? 'Browser evaluation failed.');
  return result.result?.value;
}

async function waitFor(expression, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const details = await evaluate('({ url: location.href, dialog: document.querySelector("[role=dialog]")?.innerText?.slice(0, 2800), text: document.body?.innerText?.slice(-1000), root: document.querySelector("#root")?.innerHTML?.slice(0, 1200) })');
  details.browserErrors = browserErrors.slice(-8);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(details)}`);
}

async function click(expression, label) {
  const clicked = await evaluate(expression);
  if (!clicked) throw new Error(`Could not click ${label}`);
  await new Promise((resolve) => setTimeout(resolve, 180));
}

async function enterCanonicalGraph() {
  return evaluate(`window.__VOLK_ML_AGENT__.open().then(async (api) => {
    const initial = api.getState();
    for (const item of initial.canvas.nodes) await api.removeNode(item.id);
    const components = ['tabular_data_node', 'train_test_split_node', 'linear_regression_node', 'gradient_descent_node', 'evaluate_node'];
    const ids = [];
    for (let index = 0; index < components.length; index += 1) {
      const added = await api.addNode({ componentId: components[index], id: 'g1-browser-' + index, position: { x: index * 120, y: 40 } });
      ids.push(added.nodeId);
    }
    await api.connect({ source: ids[0], sourceHandle: 'dataset', target: ids[1], targetHandle: 'dataset' });
    await api.connect({ source: ids[1], sourceHandle: 'split', target: ids[2], targetHandle: 'split' });
    await api.connect({ source: ids[2], sourceHandle: 'model', target: ids[3], targetHandle: 'model' });
    await api.connect({ source: ids[3], sourceHandle: 'trained_model', target: ids[4], targetHandle: 'trained_model' });
    return api.getState();
  })`, true);
}

async function graphSnapshot() {
  return evaluate(`window.__VOLK_ML_AGENT__.open().then((api) => {
    const state = api.getState();
    return ({
    nodes: state.canvas.nodes.map(({ id, componentId, position, parameters }) => ({ id, componentId, position, parameters })),
    edges: state.canvas.edges,
    dataset: state.dataset,
    runtime: state.execution.runtime,
    });
  })`, true);
}

async function fillQuestion(value) {
  return evaluate(`(() => {
    const field = document.querySelector('[aria-label="Question about this graph"]');
    if (!field) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

async function currentConsentChecked() {
  return evaluate('Boolean(document.querySelector("[role=dialog][aria-labelledby=graph-explanation-title] input[type=checkbox]:checked"))');
}

async function sendQuestion() {
  await click(`(() => { const button = document.querySelector('[data-testid="graph-explanation-ask"]'); if (!button || button.disabled) return false; button.click(); return true; })()`, 'graph explanation question');
}

async function waitForLatestReply(pattern, label) {
  await waitFor(`(() => {
    const history = document.querySelector('[role="dialog"][aria-labelledby="graph-explanation-title"] [aria-live]');
    const latest = history?.lastElementChild?.innerText ?? '';
    return ${JSON.stringify(pattern.source)}.length > 0 && new RegExp(${JSON.stringify(pattern.source)}, ${JSON.stringify(pattern.flags)}).test(latest);
  })()`, label);
}

async function waitForHostCondition(predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

try {
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5176', '--strictPort'], {
    cwd: process.cwd(), env: process.env, stdio: 'inherit',
  });
  await waitForHttp(`${baseUrl}/`);
  chromeProcess = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=9226', '--window-size=1440,1000',
    `--user-data-dir=${chromeProfile}`, 'about:blank',
  ], { stdio: 'ignore' });
  await waitForHttp(chromeDebugUrl);
  const pages = await (await fetch(chromeDebugUrl)).json();
  const page = pages.find((item) => item.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('Chrome DevTools page was unavailable.');
  cdp = new CdpClient(page.webSocketDebuggerUrl);
  cdp.onEvent('Fetch.requestPaused', async ({ requestId, request }) => {
    if (!request?.url?.startsWith(`${baseUrl}/mock-openai`) || request.method !== 'POST') {
      await cdp.send('Fetch.continueRequest', { requestId });
      return;
    }
    providerCallCount += 1;
    let responsePayload;
    try {
      const body = JSON.parse(request.postData ?? '{}');
      const prompt = (body.input ?? []).flatMap((item) => item.content ?? []).map((item) => item.text ?? '').join('\n');
      const requestMarker = 'Request: ';
      const requestOffset = prompt.lastIndexOf(requestMarker);
      const projection = requestOffset >= 0 ? JSON.parse(prompt.slice(requestOffset + requestMarker.length)) : null;
      const factId = projection?.facts?.[0]?.id;
      if (!projection?.requestId || !projection?.question || typeof factId !== 'string') throw new Error('fixture-request-invalid');
      providerRequestQuestions.push(projection.question);
      if (projection.question === 'Q6 delayed level change') await new Promise((resolve) => setTimeout(resolve, 1200));
      responsePayload = {
        status: 'completed',
        output: [{ type: 'message', content: [{
          type: 'output_text',
          text: JSON.stringify({
            schemaVersion: 1,
            requestId: projection.requestId,
            depth: projection.depth,
            explanation: `Deterministic browser provider reply: ${projection.question}`,
            factIds: [factId],
          }),
        }] }],
      };
    } catch {
      responsePayload = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }] };
    }
    await cdp.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'content-type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(responsePayload)).toString('base64'),
    });
  });
  cdp.onEvent('Runtime.exceptionThrown', (params) => browserErrors.push({ type: 'exception', text: params.exceptionDetails?.text, description: params.exceptionDetails?.exception?.description?.slice(0, 800) }));
  cdp.onEvent('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') browserErrors.push({ type: 'console', text: (params.args ?? []).map((item) => item.value ?? item.description ?? '').join(' ').slice(0, 800) });
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${baseUrl}/mock-openai*`, requestStage: 'Request' }] });
  await cdp.send('Page.navigate', { url: baseUrl });
  await waitFor('Boolean(document.querySelector("nav button[aria-pressed=\\\"true\\\"]"))', 'application shell');

  await click(`(() => {
    const button = [...document.querySelectorAll('nav button')].find((item) => /build/i.test(item.innerText));
    if (!button) return false;
    button.click();
    return true;
  })()`, 'Build workspace');
  await waitFor('Boolean(document.querySelector("[data-build-toolbar]"))', 'Build toolbar');
  const before = await enterCanonicalGraph();
  if (before.canvas.nodes.length !== 5 || before.canvas.edges.length !== 4) throw new Error(`Canonical graph fixture was not mounted: ${JSON.stringify({ nodes: before.canvas?.nodes?.length, edges: before.canvas?.edges?.length, apiVersion: before.apiVersion })}`);
  const semanticBefore = await graphSnapshot();

  await click(`(() => {
    const button = document.querySelector('[data-build-toolbar] button[aria-expanded]');
    if (!button) return false;
    button.click();
    return true;
  })()`, 'Build More menu');
  await click(`(() => {
    const root = document.querySelector('[data-build-more-actions]');
    const button = [...(root?.querySelectorAll('button') ?? [])].find((item) => /explain/i.test(item.innerText));
    if (!button) return false;
    button.click();
    return true;
  })()`, 'Explain this graph');
  await waitFor('Boolean(document.querySelector("[role=dialog][aria-labelledby=graph-explanation-title]"))', 'graph explanation dialog');
  await waitFor('document.querySelectorAll("[data-testid^=graph-explanation-depth-]").length === 6', 'six explanation depths');

  for (const depth of ['phenomenon', 'evidence', 'mechanism', 'representation', 'math', 'code']) {
    await click(`(() => { const button = document.querySelector('[data-testid="graph-explanation-depth-${depth}"]'); if (!button) return false; button.click(); return true; })()`, `${depth} depth`);
    const selected = await evaluate(`document.querySelector('[data-testid="graph-explanation-depth-${depth}"]')?.getAttribute('aria-pressed') === 'true'`);
    if (!selected) throw new Error(`Depth ${depth} did not become selected.`);
  }
  await click(`(() => { document.querySelector('[data-testid="graph-explanation-depth-evidence"]')?.click(); return Boolean(document.querySelector('[data-testid="graph-explanation-depth-evidence"]')); })()`, 'Evidence depth');
  const noRunEvidence = await evaluate('document.querySelector("[data-testid=graph-explanation-content]")?.innerText ?? ""');
  if (!/no successful Run|没有.*成功运行/.test(noRunEvidence)) throw new Error(`Evidence depth did not state that no current Run is available: ${noRunEvidence}`);

  const filled = await fillQuestion('Why does this graph have these connections?');
  if (!filled) throw new Error('Question field was unavailable.');
  await click(`(() => { const button = document.querySelector('[data-testid="graph-explanation-ask"]'); if (!button || button.disabled) return false; button.click(); return true; })()`, 'local explanation');
  await waitFor('document.querySelector("[role=dialog]")?.innerText.toLowerCase().includes("local graph reading")', 'local answer');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const narrowLayout = await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      dialogWidth: dialog?.clientWidth ?? 0,
      dialogContentWidth: dialog?.scrollWidth ?? 0,
    };
  })()`);
  if (narrowLayout.documentWidth > narrowLayout.viewportWidth || narrowLayout.dialogContentWidth > narrowLayout.dialogWidth + 1) {
    throw new Error(`Graph explanation overflows at narrow width: ${JSON.stringify(narrowLayout)}`);
  }
  const semanticAfter = await graphSnapshot();
  if (JSON.stringify(semanticBefore) !== JSON.stringify(semanticAfter)) throw new Error('Explanation depth selection or local question mutated graph, dataset, or Run state.');

  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await click(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-labelledby="graph-explanation-title"]');
    const button = [...(dialog?.querySelectorAll('button') ?? [])].find((item) => item.innerText.trim() === 'Configure');
    if (!button) return false;
    button.click();
    return true;
  })()`, 'open provider settings');
  await waitFor('Boolean([...document.querySelectorAll("h2")].find((heading) => heading.innerText === "Application AI settings"))', 'provider settings');
  await click(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.innerText.trim() === 'Advanced configuration'); if (!button) return false; button.click(); return true; })()`, 'provider advanced settings');
  const settingsFilled = await evaluate(`(() => {
    const setInput = (input, value) => {
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    };
    const keyLabel = [...document.querySelectorAll('label')].find((label) => label.innerText.includes('API key'));
    const endpointLabel = [...document.querySelectorAll('label')].find((label) => label.innerText.includes('Endpoint URL'));
    return setInput(keyLabel?.querySelector('input'), 'g1-browser-test-key')
      && setInput(endpointLabel?.querySelector('input'), ${JSON.stringify(`${baseUrl}/mock-openai`)});
  })()`);
  if (!settingsFilled) throw new Error('Provider settings controls were unavailable.');
  await click(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.innerText.trim() === 'Use this configuration'); if (!button || button.disabled) return false; button.click(); return true; })()`, 'save deterministic test provider configuration');
  await waitFor('Boolean(document.querySelector("[role=dialog][aria-labelledby=graph-explanation-title] input[type=checkbox]"))', 'configured provider consent control');
  if (await currentConsentChecked()) throw new Error('Provider consent was not unchecked after configuration.');

  await fillQuestion('Q0 without explicit opt-in');
  await sendQuestion();
  await waitForLatestReply(/Local graph reading/i, 'default local response with provider configured');
  if (providerCallCount !== 0) throw new Error('The configured provider was called without explicit consent.');

  await fillQuestion('Q1 one-use consent');
  await click('(() => { const checkbox = document.querySelector("[role=dialog][aria-labelledby=graph-explanation-title] input[type=checkbox]"); if (!checkbox || checkbox.checked) return false; checkbox.click(); return checkbox.checked; })()', 'opt in for Q1');
  if (!(await currentConsentChecked())) throw new Error('Q1 provider consent did not become active.');
  await sendQuestion();
  await waitForLatestReply(/Deterministic browser provider reply: Q1 one-use consent/, 'Q1 deterministic provider response');
  if (providerCallCount !== 1 || providerRequestQuestions[0] !== 'Q1 one-use consent') throw new Error(`Q1 did not make exactly one provider request: ${JSON.stringify({ providerCallCount, providerRequestQuestions })}`);
  if (await currentConsentChecked()) throw new Error('Provider consent was not consumed after Q1 completed.');

  await fillQuestion('Q2 no reused consent');
  if (await currentConsentChecked()) throw new Error('Q2 inherited Q1 provider consent.');
  await sendQuestion();
  await waitForLatestReply(/Local graph reading/i, 'Q2 local response without new consent');
  if (providerCallCount !== 1) throw new Error('Q2 unexpectedly reused Q1 provider consent.');

  await fillQuestion('Q3 original question');
  await click('(() => { const checkbox = document.querySelector("[role=dialog][aria-labelledby=graph-explanation-title] input[type=checkbox]"); if (!checkbox || checkbox.checked) return false; checkbox.click(); return checkbox.checked; })()', 'opt in for Q3');
  await fillQuestion('Q3 edited after consent');
  if (await currentConsentChecked()) throw new Error('Editing the question did not invalidate its provider consent.');
  await sendQuestion();
  await waitForLatestReply(/Local graph reading/i, 'Q3 local response after question edit');
  if (providerCallCount !== 1) throw new Error('An edited question unexpectedly used the previous consent.');

  await fillQuestion('Q4 depth changed after consent');
  await click('(() => { const checkbox = document.querySelector("[role=dialog][aria-labelledby=graph-explanation-title] input[type=checkbox]"); if (!checkbox || checkbox.checked) return false; checkbox.click(); return checkbox.checked; })()', 'opt in for Q4');
  await click('(() => { const button = document.querySelector("[data-testid=graph-explanation-depth-mechanism]"); if (!button) return false; button.click(); return true; })()', 'change depth after Q4 consent');
  if (await currentConsentChecked()) throw new Error('Changing explanation depth did not invalidate provider consent.');
  await sendQuestion();
  await waitForLatestReply(/Local graph reading/i, 'Q4 local response after depth change');
  if (providerCallCount !== 1) throw new Error('A depth-changed request unexpectedly used the previous consent.');

  await fillQuestion('Q5 provider configuration changed after consent');
  await click('(() => { const checkbox = document.querySelector("[role=dialog][aria-labelledby=graph-explanation-title] input[type=checkbox]"); if (!checkbox || checkbox.checked) return false; checkbox.click(); return checkbox.checked; })()', 'opt in for Q5');
  await click(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-labelledby="graph-explanation-title"]');
    const button = [...(dialog?.querySelectorAll('button') ?? [])].find((item) => item.innerText.trim() === 'Configure');
    if (!button) return false;
    button.click();
    return true;
  })()`, 'change provider configuration after consent');
  await waitFor('Boolean([...document.querySelectorAll("h2")].find((heading) => heading.innerText === "Application AI settings"))', 'provider settings for configuration invalidation');
  const configEdited = await evaluate(`(() => {
    const label = [...document.querySelectorAll('label')].find((item) => item.innerText.includes('Endpoint URL'));
    const input = label?.querySelector('input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(`${baseUrl}/mock-openai-v2`)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!configEdited) throw new Error('Provider endpoint setting was unavailable for the configuration invalidation check.');
  await click(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.innerText.trim() === 'Use this configuration'); if (!button || button.disabled) return false; button.click(); return true; })()`, 'save changed provider configuration');
  await waitFor('Boolean(document.querySelector("[role=dialog][aria-labelledby=graph-explanation-title] input[type=checkbox]"))', 'provider consent after configuration change');
  if (await currentConsentChecked()) throw new Error('Changing provider configuration did not invalidate consent.');
  await sendQuestion();
  await waitForLatestReply(/Local graph reading/i, 'Q5 local response after provider configuration change');
  if (providerCallCount !== 1) throw new Error('A provider configuration-changed request unexpectedly used previous consent.');

  await fillQuestion('Q6 delayed level change');
  await click('(() => { const checkbox = document.querySelector("[role=dialog][aria-labelledby=graph-explanation-title] input[type=checkbox]"); if (!checkbox || checkbox.checked) return false; checkbox.click(); return checkbox.checked; })()', 'opt in for delayed Q6');
  await sendQuestion();
  await waitForHostCondition(() => providerRequestQuestions.includes('Q6 delayed level change'), 'Q6 provider request to enter the in-flight fixture');
  if (await currentConsentChecked()) throw new Error('Q6 consent was not consumed before its provider request began.');
  await click('(() => { const button = document.querySelector("[data-testid=graph-explanation-technicality-technical-detail]"); if (!button) return false; button.click(); return true; })()', 'change declared technicality while Q6 is in flight');
  const levelChangeState = await evaluate(`(() => ({
    technicality: document.querySelector('[data-testid="graph-explanation-technicality-technical-detail"]')?.getAttribute('aria-pressed'),
    mathDepth: document.querySelector('[data-testid="graph-explanation-depth-math"]')?.getAttribute('aria-pressed'),
    consentChecked: Boolean(document.querySelector('[role="dialog"][aria-labelledby="graph-explanation-title"] input[type="checkbox"]:checked')),
  }))()`);
  if (levelChangeState.technicality !== 'true' || levelChangeState.mathDepth !== 'true' || levelChangeState.consentChecked) {
    throw new Error(`Declared technicality did not select its default or revoke consent: ${JSON.stringify(levelChangeState)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 1400));
  const staleProviderReplyShown = await evaluate(`(() => [...document.querySelectorAll('[role="dialog"][aria-labelledby="graph-explanation-title"] [aria-live] *')]
    .some((item) => item.innerText.includes('Deterministic browser provider reply: Q6 delayed level change')))()`);
  if (staleProviderReplyShown) throw new Error('The response from the old declared-technicality context was shown.');
  await sendQuestion();
  await waitForLatestReply(/Local graph reading/i, 'Q6 local response after technicality change');
  if (providerCallCount !== 2) throw new Error('The Q6 technicality change retained provider consent.');
  await click('(() => { const button = document.querySelector("[data-testid=graph-explanation-depth-code]"); if (!button) return false; button.click(); return true; })()', 'override the declared technicality with Code depth');
  const manualOverrideRemains = await evaluate('document.querySelector("[data-testid=graph-explanation-depth-code]")?.getAttribute("aria-pressed") === "true"');
  if (!manualOverrideRemains) throw new Error('The learner could not manually override the technicality default with Code depth.');

  const providerConsentOneUse = {
    calls: providerCallCount,
    questions: providerRequestQuestions,
    defaultOptInRequired: true,
    consumedAfterRequest: true,
    changedQuestionInvalidated: true,
    changedDepthInvalidated: true,
    changedProviderConfigInvalidated: true,
    changedDeclaredTechnicalityInvalidated: true,
    staleInFlightReplyDiscarded: true,
    preferenceSelectedDefaultDepth: true,
    manualDepthOverrideRemains: manualOverrideRemains,
  };
  const semanticAfterProviderTests = await graphSnapshot();
  if (JSON.stringify(semanticBefore) !== JSON.stringify(semanticAfterProviderTests)) throw new Error('Provider consent or explanations mutated graph, dataset, or Run state.');

  await click(`(() => { const button = document.querySelector('[role="dialog"][aria-labelledby="graph-explanation-title"] button[aria-label]'); if (!button) return false; button.click(); return true; })()`, 'close English explanation');
  await evaluate(`localStorage.setItem('volk-ml-language-settings', JSON.stringify({ primary: 'zh', secondary: 'en' }))`);
  await cdp.send('Page.reload');
  await waitFor('Boolean(document.querySelectorAll("nav button")[1]?.innerText.includes("构建"))', 'parallel-language app reload');
  await click(`(() => { const button = [...document.querySelectorAll('nav button')].find((item) => /构建|build/i.test(item.innerText)); if (!button) return false; button.click(); return true; })()`, 'Build in parallel-language mode');
  await waitFor('Boolean(document.querySelector("[data-build-toolbar]"))', 'parallel-language Build toolbar');
  await click(`(() => { const button = document.querySelector('[data-build-toolbar] button[aria-expanded]'); if (!button) return false; button.click(); return true; })()`, 'parallel-language Build More menu');
  await click(`(() => { const root = document.querySelector('[data-build-more-actions]'); const button = [...(root?.querySelectorAll('button') ?? [])].find((item) => /explain|解释/i.test(item.innerText)); if (!button) return false; button.click(); return true; })()`, 'parallel-language Explain this graph');
  await waitFor('Boolean(document.querySelector("[role=dialog][aria-labelledby=graph-explanation-title]"))', 'parallel-language explanation');
  const parallelMathLabel = await evaluate('document.querySelector("[data-testid=graph-explanation-depth-math]")?.innerText ?? ""');
  if (!parallelMathLabel.includes('数学') || !parallelMathLabel.includes('Math')) throw new Error(`Parallel-language depth label did not show both locales: ${parallelMathLabel}`);
  await click(`(() => { const button = document.querySelector('[role="dialog"][aria-labelledby="graph-explanation-title"] button[aria-label]'); if (!button) return false; button.click(); return true; })()`, 'close parallel-language explanation');

  await evaluate(`localStorage.setItem('volk-ml-language-settings', JSON.stringify({ primary: 'zh', secondary: null }))`);
  await cdp.send('Page.reload');
  await waitFor('Boolean(document.querySelectorAll("nav button")[1]?.innerText.includes("构建")) && !document.querySelectorAll("nav button")[1]?.innerText.includes("Build")', 'Chinese app reload');
  await click(`(() => { const button = [...document.querySelectorAll('nav button')].find((item) => /构建/.test(item.innerText)); if (!button) return false; button.click(); return true; })()`, 'Build in Chinese mode');
  await waitFor('Boolean(document.querySelector("[data-build-toolbar]"))', 'Chinese Build toolbar');
  await click(`(() => { const button = document.querySelector('[data-build-toolbar] button[aria-expanded]'); if (!button) return false; button.click(); return true; })()`, 'Chinese Build More menu');
  await click(`(() => { const root = document.querySelector('[data-build-more-actions]'); const button = [...(root?.querySelectorAll('button') ?? [])].find((item) => /解释/.test(item.innerText)); if (!button) return false; button.click(); return true; })()`, 'Chinese Explain this graph');
  await waitFor('Boolean(document.querySelector("[role=dialog][aria-labelledby=graph-explanation-title]"))', 'Chinese explanation');
  const chineseMathLabel = await evaluate('document.querySelector("[data-testid=graph-explanation-depth-math]")?.innerText ?? ""');
  if (!chineseMathLabel.includes('数学') || chineseMathLabel.includes('Math')) throw new Error(`Single-language depth label is not Chinese-only: ${chineseMathLabel}`);

  const outcome = {
    result: 'passed',
    workspace: 'Build',
    canonicalGraph: { nodes: before.canvas.nodes.length, connections: before.canvas.edges.length },
    depths: graphDepths,
    evidenceWithoutRun: noRunEvidence,
    narrowLayout,
    semanticWorkspaceUnchanged: true,
    providerConsentDefault: !(await currentConsentChecked()),
    providerConsentOneUse,
    parallelMathLabel: parallelMathLabel.trim(),
    chineseMathLabel: chineseMathLabel.trim(),
  };
  console.log(JSON.stringify(outcome, null, 2));
} finally {
  cdp?.close();
  stopProcess(chromeProcess);
  stopProcess(viteProcess);
  try { fs.rmSync(chromeProfile, { recursive: true, force: true }); } catch {}
}
