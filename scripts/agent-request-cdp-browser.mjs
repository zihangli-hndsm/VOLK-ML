import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const baseUrl = 'http://127.0.0.1:5174';
const fixtureUrl = 'http://127.0.0.1:4179';
const artifact = path.resolve('docs/acceptance/assets/agent-request-contract');
fs.mkdirSync(artifact, { recursive: true });
let fixtureCalls = [];
let fixtureMode = 'normal';
let fixtureDelayMs = 0;
let viteProcess = null;
let chromeProcess = null;
const chromeProfile = path.join(os.tmpdir(), 'volk-agent-request-chrome-profile');

function fixtureResponseFor(prompt) {
  if (fixtureMode === 'invalid') return 'not-json';
  if (/taskMode=ask/.test(prompt)) return JSON.stringify({ answer: 'Fixture answer from the real browser transport.', tryExperiment: { question: 'What if we collect more data?', design: { goal: 'more-same-distribution-data' } }, depth: null });
  if (/taskMode=world-edit/.test(prompt)) return JSON.stringify({ kind: 'world-design', topic: null, explanation: null, depth: null, intent: null, requestedChange: null, requestedHolds: [], design: { mode: 'edit', recipe: null, patch: { version: 1, changes: [{ type: 'SET_NOISE', split: 'train', kind: 'position', amount: 0.1 }] } }, experimentDesign: null, reason: null, ambiguity: null });
  if (fixtureMode === 'delay') return JSON.stringify({ kind: 'explanation', topic: 'comparison', explanation: 'Delayed response must not appear after a mode switch.', depth: null, intent: null, requestedChange: null, requestedHolds: [], design: null, experimentDesign: null, reason: null, ambiguity: null });
  if (/taskMode=experiment-design/.test(prompt)) return JSON.stringify({ kind: 'experiment', topic: null, explanation: null, depth: null, intent: null, requestedChange: 'increase same-distribution training data', requestedHolds: [], design: null, experimentDesign: { version: 1, kind: 'exploration-design', goal: 'more-same-distribution-data', intervention: 'increase-same-distribution-sample-size', evidence: 'outcome-and-stability', prediction: false }, reason: null, ambiguity: null });
  return JSON.stringify({ kind: 'clarification', topic: null, explanation: null, depth: null, intent: null, requestedChange: null, requestedHolds: [], design: null, experimentDesign: null, reason: 'Fixture clarification.', ambiguity: null });
}

const fixtureServer = http.createServer((request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-methods', 'POST, OPTIONS, GET');
  response.setHeader('access-control-allow-headers', 'content-type, authorization');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  if (request.method === 'GET' && request.url?.startsWith('/control')) {
    const mode = new URL(request.url, fixtureUrl).searchParams.get('mode');
    fixtureMode = ['normal', 'invalid', 'delay'].includes(mode) ? mode : 'normal';
    fixtureDelayMs = fixtureMode === 'delay' ? 900 : 0;
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ mode: fixtureMode })); return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') { response.writeHead(404); response.end(); return; }
  let raw = '';
  request.on('data', (chunk) => { raw += chunk; });
  request.on('end', () => {
    const body = JSON.parse(raw || '{}');
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const prompt = messages.map((message) => String(message?.content ?? '')).join('\n');
    const repair = messages.some((message) => String(message?.content ?? '').includes('Repair the previous response'));
    fixtureCalls.push({ method: 'POST', status: 200, requestId: body.requestId ?? null, logicalRequestId: prompt.match(/requestId=([^;\s.]+)/)?.[1] ?? null, taskMode: prompt.match(/taskMode=([^;\s]+)/)?.[1] ?? null, repair, hasTaskRules: prompt.includes('Task rules:'), hasExample: prompt.includes('Valid output example:'), containsSecret: raw.includes('fixture-key') });
    const text = fixtureResponseFor(prompt);
    const send = () => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { content: text } }] })); };
    if (fixtureDelayMs) setTimeout(send, fixtureDelayMs); else send();
  });
});

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function startServices() {
  await new Promise((resolve, reject) => fixtureServer.listen(4179, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  try { await waitForHttp(`${baseUrl}/agent-request-contract-harness.html`, 500); } catch {
    viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5174'], { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
    await waitForHttp(`${baseUrl}/agent-request-contract-harness.html`);
  }
  fs.rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  chromeProcess = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--disable-gpu', '--remote-debugging-port=9223', '--window-size=1280,900', `--user-data-dir=${chromeProfile}`, 'about:blank'], { stdio: 'ignore' });
  await waitForHttp('http://127.0.0.1:9223/json/list');
}

class CdpClient {
  constructor(url) { this.socket = new WebSocket(url); this.sequence = 0; this.pending = new Map(); this.ready = new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', reject, { once: true }); }); this.socket.addEventListener('message', (event) => { const message = JSON.parse(event.data); if (message.id && this.pending.has(message.id)) { const entry = this.pending.get(message.id); this.pending.delete(message.id); if (message.error) entry.reject(new Error(JSON.stringify(message.error))); else entry.resolve(message.result); } }); }
  async send(method, params = {}) { await this.ready; const id = ++this.sequence; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  close() { this.socket.close(); }
}

async function connect() {
  const pages = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = pages.find((item) => item.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('Chrome DevTools page unavailable.');
  const cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  return cdp;
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Browser evaluation failed.');
  return result.result?.value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function click(cdp, text, exact = true) {
  const found = await evaluate(cdp, `(() => { const button = [...document.querySelectorAll('button')].find((item) => ${exact ? `(item.textContent || '').trim() === ${JSON.stringify(text)}` : `(item.textContent || '').includes(${JSON.stringify(text)}`}); if (!button) return false; button.click(); return true; })()`);
  if (!found) throw new Error(`Button not found: ${text}`);
  await sleep(160);
}

async function setInput(cdp, value) {
  await evaluate(cdp, `(() => { const input = document.querySelector('input'); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
}

async function assertText(cdp, text, present = true) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const found = await evaluate(cdp, `Boolean(document.body?.innerText?.includes(${JSON.stringify(text)}))`);
    if (found === present) return;
    await sleep(100);
  }
  const diagnostic = await evaluate(cdp, '({ text: document.body?.innerText?.slice(0, 4000), runtime: document.querySelector("[data-harness-runtime-state]")?.textContent, faults: document.querySelector("[data-harness-faults]")?.textContent, details: [...document.querySelectorAll("details")].map((item) => item.textContent) })');
  throw new Error(`Expected text presence=${present}: ${text}; diagnostic=${JSON.stringify({ ...diagnostic, fixtureCalls })}`);
}

await startServices();
let cdp;
try {
  cdp = await connect();
  await cdp.send('Page.navigate', { url: `${baseUrl}/agent-request-contract-harness.html` });
  await sleep(900);
  await assertText(cdp, 'Agent request contract harness');
  const initialRuntimeState = await evaluate(cdp, 'JSON.parse(document.querySelector("[data-harness-runtime-state]")?.textContent || "null")');
  if (!initialRuntimeState?.worldId || initialRuntimeState.worldGenerator !== 'world-recipe' || !initialRuntimeState.modelAttached) throw new Error(`Harness did not initialize the real World Recipe/model boundary: ${JSON.stringify(initialRuntimeState)}`);
  await setInput(cdp, 'Explain this result.');
  await click(cdp, 'playground.agentGuide.ask');
  await assertText(cdp, 'ai.tryInWorld');
  await click(cdp, 'ai.tryInWorld');
  await assertText(cdp, 'proposal calls 1');
  const afterInjectedFailure = await evaluate(cdp, 'JSON.parse(document.querySelector("[data-harness-runtime-state]")?.textContent || "null")');
  if (JSON.stringify(afterInjectedFailure) !== JSON.stringify(initialRuntimeState)) throw new Error('Injected pending proposal failure mutated the real host state.');
  await click(cdp, 'Parent rerender');
  await assertText(cdp, 'proposal calls 1');
  await setInput(cdp, 'Please propose a bounded experiment.');
  await click(cdp, 'playground.agentGuide.ask');
  await assertText(cdp, 'proposal calls 2');
  await assertText(cdp, 'playground.pedagogical.runExperiment');
  await assertText(cdp, 'execute calls 0');
  const experimentProposalState = await evaluate(cdp, 'JSON.parse(document.querySelector("[data-harness-runtime-state]")?.textContent || "null")');
  if (experimentProposalState.activeExperimentId !== initialRuntimeState.activeExperimentId || experimentProposalState.comparison?.enabled) throw new Error('Experiment proposal mutated active host state before learner confirmation.');
  await click(cdp, 'playground.pedagogical.runExperiment');
  await assertText(cdp, 'execute calls 1');
  const afterExperiment = await evaluate(cdp, 'JSON.parse(document.querySelector("[data-harness-execution-transitions]")?.textContent || "[]")');
  const dimensionsAreDisjoint = (comparison) => {
    const changed = new Set(comparison?.changed ?? []);
    return !(comparison?.unchanged ?? []).some((factor) => changed.has(factor));
  };
  if (afterExperiment.length !== 1 || afterExperiment[0].before.worldId !== afterExperiment[0].after.worldId || afterExperiment[0].before.activeExperimentId === afterExperiment[0].after.activeExperimentId || !afterExperiment[0].after.comparison?.enabled || !afterExperiment[0].after.comparison.unchanged.includes('world') || !dimensionsAreDisjoint(afterExperiment[0].after.comparison)) throw new Error(`Real experiment planner/host transition was not observed: ${JSON.stringify(afterExperiment)}`);

  await evaluate(cdp, `fetch(${JSON.stringify(`${fixtureUrl}/control?mode=invalid`)})`, true);
  await click(cdp, 'ai.askTab');
  await setInput(cdp, 'Invalid response please.');
  await click(cdp, 'playground.agentGuide.ask');
  await assertText(cdp, 'ai.diagnostic.AI_RESPONSE_INVALID');

  await evaluate(cdp, `fetch(${JSON.stringify(`${fixtureUrl}/control?mode=normal`)})`, true);
  await click(cdp, 'ai.worldTab');
  await setInput(cdp, 'Increase World noise.');
  await click(cdp, 'playground.agentGuide.proposeWorld');
  await assertText(cdp, 'playground.agentGuide.tryIt');
  await assertText(cdp, 'execute calls 1');
  const worldProposalState = await evaluate(cdp, 'JSON.parse(document.querySelector("[data-harness-runtime-state]")?.textContent || "null")');
  if (worldProposalState.activeExperimentId !== afterExperiment[0].after.activeExperimentId || worldProposalState.worldId !== afterExperiment[0].after.worldId) throw new Error('World proposal mutated host state before learner confirmation.');
  await click(cdp, 'playground.agentGuide.tryIt');
  await assertText(cdp, 'execute calls 2');
  const afterWorld = await evaluate(cdp, 'JSON.parse(document.querySelector("[data-harness-execution-transitions]")?.textContent || "[]")');
  if (afterWorld.length !== 2 || afterWorld[1].before.worldId !== afterWorld[1].after.worldId || !afterWorld[1].after.comparison?.enabled || !afterWorld[1].after.comparison.changed.includes('world') || afterWorld[1].after.comparison.unchanged.includes('world') || !dimensionsAreDisjoint(afterWorld[1].after.comparison)) throw new Error(`Real World Recipe/patch host transition was not observed: ${JSON.stringify(afterWorld)}`);
  if (afterWorld.some((transition) => !dimensionsAreDisjoint(transition.after?.comparison))) throw new Error(`Comparison changed/held dimensions overlap: ${JSON.stringify(afterWorld)}`);

  await evaluate(cdp, `fetch(${JSON.stringify(`${fixtureUrl}/control?mode=delay`)})`, true);
  await click(cdp, 'ai.experimentTab');
  await setInput(cdp, 'What if we compare the delayed response?');
  await click(cdp, 'playground.agentGuide.ask');
  await click(cdp, 'ai.worldTab');
  await sleep(1200);
  await click(cdp, 'ai.experimentTab');
  await assertText(cdp, 'Delayed response must not appear after a mode switch.', false);

  const modeCounts = Object.fromEntries(['ask', 'experiment-design', 'world-edit'].map((mode) => [mode, fixtureCalls.filter((entry) => entry.taskMode === mode).length]));
  const repairs = fixtureCalls.filter((entry) => entry.repair);
  if (modeCounts.ask !== 3 || modeCounts['experiment-design'] !== 1 || modeCounts['world-edit'] !== 1 || repairs.length !== 1 || repairs[0].taskMode !== 'ask') throw new Error(`Unexpected browser provider call/repair accounting: ${JSON.stringify({ modeCounts, repairs })}`);
  if (fixtureCalls.some((entry) => !entry.logicalRequestId)) throw new Error(`Missing logical request/correlation identity in provider evidence: ${JSON.stringify(fixtureCalls)}`);
  if (fixtureCalls.some((entry) => entry.status !== 200 || entry.containsSecret || !entry.hasTaskRules || !entry.hasExample)) throw new Error(`Unsafe or incomplete browser fixture request: ${JSON.stringify(fixtureCalls)}`);
  const body = await evaluate(cdp, '({ href: location.href, text: document.body.innerText.slice(0, 2000) })');
  fs.writeFileSync(path.join(artifact, 'browser-evidence.json'), `${JSON.stringify({ schema: 'agent-request-contract-browser-evidence-v2', result: 'PASS', fixtureCalls, browserObservedCalls: fixtureCalls, initialRuntimeState, executionTransitions: afterWorld, componentFaultInjection: { kind: 'pending-task', delegatedToRealAgent: false, successfulProposalsAndExecutionsDelegated: true }, body, checks: ['real production ExploreAgentSurface + AskVolkPanel mounted', 'real data-lab host/model/World Recipe initialization', 'real gateway -> interpreter -> planner -> scenario validator proposal path', 'real HTTP CORS preflight/POST transport fixture', 'normal Experiment provider design remains proposal-only before click', 'normal World provider patch remains proposal-only before click', 'real host semantic state captured before and after explicit confirmation', 'pending proposal failure consumed once across rerender', 'explicit retry creates one new logical request', 'proposal never executes without learner click', 'malformed provider output diagnostic', 'mode switch suppresses stale response', 'repair counted across request messages'] }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ result: 'PASS', fixtureCalls, executionTransitions: afterWorld, artifact: path.join(artifact, 'browser-evidence.json') }, null, 2));
} finally {
  cdp?.close();
  chromeProcess?.kill();
  viteProcess?.kill();
  fixtureServer.close();
  try { fs.rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
}
