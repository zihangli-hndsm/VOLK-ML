import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const baseUrl = 'http://127.0.0.1:5174';
const assets = path.resolve('docs/acceptance/assets/r148');
fs.mkdirSync(assets, { recursive: true });
let viteProcess = null;
let chromeProcess = null;
const chromeProfile = path.join(os.tmpdir(), 'volk-r148-chrome-profile');

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function startLocalServices() {
  try { await waitForHttp(`${baseUrl}/`, 500); } catch {
    viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5174'], {
      cwd: process.cwd(), env: { ...process.env, VITE_VOLK_TEACHING_DIALOGUE_PILOT: '1' }, stdio: 'inherit',
    });
    viteProcess.on('exit', (code, signal) => console.error(`R148_VITE_EXIT code=${code} signal=${signal ?? ''}`));
    await waitForHttp(`${baseUrl}/`);
  }
  fs.rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  chromeProcess = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=9222', '--window-size=1280,720',
    `--user-data-dir=${chromeProfile}`, 'about:blank',
  ], { stdio: 'ignore' });
  chromeProcess.on('exit', (code, signal) => console.error(`R148_CHROME_EXIT code=${code} signal=${signal ?? ''}`));
  await waitForHttp('http://127.0.0.1:9222/json/list');
}

function stopProcess(child) { if (child && !child.killed) { try { child.kill(); } catch {} } }

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
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      } else if (message.method === 'Runtime.exceptionThrown') {
        console.error(`BROWSER_EXCEPTION ${message.params?.exceptionDetails?.text ?? ''}`);
      } else if (message.method === 'Log.entryAdded') {
        console.error(`BROWSER_LOG ${message.params?.entry?.level ?? ''} ${message.params?.entry?.text ?? ''}`);
      }
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

async function connect() {
  const pages = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = pages.find((item) => item.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('Chrome DevTools page was not available.');
  const cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.setLifecycleEventsEnabled', { enabled: true });
  return cdp;
}

async function evaluate(cdp, expression, { awaitPromise = false } = {}) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Browser evaluation failed.');
  return result.result?.value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function capture(cdp, filename) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(assets, filename), Buffer.from(result.data, 'base64'));
}

async function startCanvasRecording(cdp) {
  const supported = await evaluate(cdp, `(() => typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function' && MediaRecorder.isTypeSupported('video/webm;codecs=vp8'))()`);
  if (!supported) throw new Error('Chrome did not expose the required WebM MediaRecorder capability.');
  await evaluate(cdp, `(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1280px;height:720px;pointer-events:none;opacity:0';
    document.body.appendChild(canvas);
    const context = canvas.getContext('2d');
    const chunks = [];
    const recorder = new MediaRecorder(canvas.captureStream(10), { mimeType: 'video/webm;codecs=vp8' });
    recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); });
    recorder.start(200);
    window.__r148Recorder = { canvas, context, recorder, chunks, ready: true };
    return true;
  })()`);
}

async function pushCanvasFrame(cdp, screenshotBase64) {
  await evaluate(cdp, `(() => new Promise((resolve, reject) => {
    const state = window.__r148Recorder;
    if (!state?.ready) return reject(new Error('R148 recorder is not active.'));
    const image = new Image();
    image.onload = () => { state.context.clearRect(0, 0, state.canvas.width, state.canvas.height); state.context.drawImage(image, 0, 0, state.canvas.width, state.canvas.height); resolve(true); };
    image.onerror = () => reject(new Error('R148 recorder could not decode a screenshot frame.'));
    image.src = 'data:image/png;base64,${screenshotBase64}';
  }))()`, { awaitPromise: true });
}

async function stopCanvasRecording(cdp, filename) {
  const encoded = await evaluate(cdp, `(() => new Promise((resolve, reject) => {
    const state = window.__r148Recorder;
    if (!state?.recorder) return reject(new Error('R148 recorder was not started.'));
    state.recorder.addEventListener('stop', async () => {
      try {
        const blob = new Blob(state.chunks, { type: 'video/webm' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        resolve(btoa(binary));
      } catch (error) { reject(error); }
    }, { once: true });
    state.recorder.stop();
  }))()`, { awaitPromise: true });
  fs.writeFileSync(path.join(assets, filename), Buffer.from(encoded, 'base64'));
}

async function recordCurrentPage(cdp, filename, action) {
  await startCanvasRecording(cdp);
  let running = true;
  const pump = (async () => {
    while (running) {
      const frame = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await pushCanvasFrame(cdp, frame.data);
      await sleep(100);
    }
  })();
  try {
    return await action();
  } finally {
    running = false;
    await pump;
    await stopCanvasRecording(cdp, filename);
  }
}

async function clickButton(cdp, text) {
  const found = await evaluate(cdp, `(() => {
    const buttons = [...document.querySelectorAll('button')];
    const button = buttons.find((item) => (item.textContent || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(text)}));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!found) throw new Error(`Button not found: ${text}`);
  await sleep(450);
}

async function assertText(cdp, text) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const found = await evaluate(cdp, `Boolean(document.body?.innerText?.includes(${JSON.stringify(text)}))`);
      if (found) return;
    } catch {}
    await sleep(500);
  }
  const diagnostic = await evaluate(cdp, '({ href: location.href, title: document.title, body: (document.body?.innerText || "").slice(0, 400) })');
  throw new Error(`Expected visible text not found: ${text}; diagnostic=${JSON.stringify(diagnostic)}`);
}

async function assertLumi(cdp, { presentation, bubble = null, targetStatus = null, bodyState = null, mode = null } = {}) {
  const state = await evaluate(cdp, `(() => {
    const node = document.querySelector('[data-lumi-presentation-state]');
    const target = document.querySelector('[data-lumi-companion]');
    const visual = target?.querySelector('[data-lumi-mode]');
    return { presentation: node?.getAttribute('data-lumi-presentation-state') ?? null, bodyState: target?.getAttribute('data-lumi-body-state') ?? null, mode: visual?.getAttribute('data-lumi-mode') ?? null, presence: visual?.getAttribute('data-lumi-presence') ?? null, bubble: Boolean(document.querySelector('[data-lumi-context-bubble]')), targetStatus: target?.getAttribute('data-lumi-target-status') ?? null };
  })()`);
  if (presentation && state.presentation !== presentation) throw new Error(`Unexpected LUMI presentation state: ${JSON.stringify(state)}`);
  if (bodyState && state.bodyState !== bodyState) throw new Error(`Unexpected LUMI body state: ${JSON.stringify(state)}`);
  if (mode && state.mode !== mode) throw new Error(`Unexpected LUMI visual mode: ${JSON.stringify(state)}`);
  if (bubble !== null && state.bubble !== bubble) throw new Error(`Unexpected LUMI context bubble state: ${JSON.stringify(state)}`);
  if (targetStatus && state.targetStatus !== targetStatus) throw new Error(`Unexpected LUMI target status: ${JSON.stringify(state)}`);
  return state;
}

async function assertEpisodeTarget(cdp, { key, controlId, inactive = [] } = {}) {
  await evaluate(cdp, `document.querySelector('[data-lumi-course-control="${key}"][data-lumi-control-id="${controlId}"]')?.scrollIntoView?.({ block: 'center', inline: 'nearest' })`);
  const read = () => evaluate(cdp, `(() => {
    const target = document.querySelector('[data-lumi-course-control="${key}"][data-lumi-control-id="${controlId}"]');
    const inactive = ${JSON.stringify(inactive)}.map(([targetKey, id]) => document.querySelector('[data-lumi-course-control="' + targetKey + '"][data-lumi-control-id="' + id + '"]'));
    return {
      targetExists: Boolean(target),
      targetDisabled: Boolean(target?.disabled),
      targetHighlighted: Boolean(target?.className?.includes('ring-cyan-400')),
      inactiveHighlighted: inactive.some((item) => item?.className?.includes('ring-cyan-400')),
    };
  })()`);
  let result = await read();
  for (let attempt = 0; attempt < 12 && (!result.targetExists || result.targetDisabled || !result.targetHighlighted || result.inactiveHighlighted); attempt += 1) {
    await sleep(250);
    result = await read();
  }
  if (!result.targetExists || result.targetDisabled || !result.targetHighlighted || result.inactiveHighlighted) {
    const diagnostic = await evaluate(cdp, "({ guidance: document.querySelector('[data-lumi-guidance-target]')?.getAttribute('data-lumi-guidance-target') ?? null, resolved: document.querySelector('[data-lumi-resolved-target-status]')?.getAttribute('data-lumi-resolved-target-status') ?? null, companion: document.querySelector('[data-lumi-companion]')?.outerHTML.slice(0, 800) ?? null, controls: [...document.querySelectorAll('[data-lumi-course-control]')].map((item) => ({ id: item.getAttribute('data-lumi-control-id'), className: item.className, disabled: item.disabled })) })");
    throw new Error(`Episode target assertion failed for ${key}/${controlId}: ${JSON.stringify({ result, diagnostic })}`);
  }
  await assertLumi(cdp, { targetStatus: 'ready' });
}

async function open(pageUrl, cdp) {
  await cdp.send('Page.navigate', { url: pageUrl });
  await sleep(1300);
}

async function runEpisode(cdp, { reducedMotion = false, prefix, recordingFilename = null }) {
  await open(`${baseUrl}/?directorDebug=1&r148=cdp`, cdp);
  if (reducedMotion) await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await assertText(cdp, 'Episode 1 · Why did the AI change?');
  await clickButton(cdp, 'Episode 1 · Why did the AI change?');
  await assertText(cdp, 'If the World stays the same, will a learned model stay the same?');
  const flow = async () => {
    await capture(cdp, `${prefix}-01-entry.png`);
    await assertEpisodeTarget(cdp, { key: 'model.fit', controlId: 'episode-fit-a', inactive: [['world.sample', 'episode-sample'], ['model.fit', 'episode-fit-b'], ['experiment.compare', 'episode-compare']] });
    await clickButton(cdp, 'Skip prediction');
    await clickButton(cdp, 'Fit A');
    await capture(cdp, `${prefix}-02-fit-a.png`);
    await assertEpisodeTarget(cdp, { key: 'world.sample', controlId: 'episode-sample', inactive: [['model.fit', 'episode-fit-a'], ['model.fit', 'episode-fit-b'], ['experiment.compare', 'episode-compare']] });
    await clickButton(cdp, 'Sample same World');
    await capture(cdp, `${prefix}-03-resample.png`);
    await assertEpisodeTarget(cdp, { key: 'model.fit', controlId: 'episode-fit-b', inactive: [['model.fit', 'episode-fit-a'], ['world.sample', 'episode-sample'], ['experiment.compare', 'episode-compare']] });
    await clickButton(cdp, 'Fit B');
    await capture(cdp, `${prefix}-04-fit-b.png`);
    await assertEpisodeTarget(cdp, { key: 'experiment.compare', controlId: 'episode-compare', inactive: [['model.fit', 'episode-fit-a'], ['world.sample', 'episode-sample'], ['model.fit', 'episode-fit-b']] });
    await clickButton(cdp, 'Compare A / B');
    await assertText(cdp, 'Sampling variability');
    await assertText(cdp, 'EVIDENCED');
    await assertText(cdp, 'CHANGED');
    await assertText(cdp, 'HELD CONSTANT');
    const staleCompare = await evaluate(cdp, "document.querySelector('[data-lumi-course-control=\\\"experiment.compare\\\"][data-lumi-control-id=\\\"episode-compare\\\"]')?.className?.includes('ring-cyan-400') ?? false");
    if (staleCompare) throw new Error('Compare target remained highlighted after comparison completed.');
    await capture(cdp, `${prefix}-05-concept.png`);
    await sleep(1200);
    await capture(cdp, `${prefix}-06-recovered.png`);
  };
  if (recordingFilename) await recordCurrentPage(cdp, recordingFilename, flow);
  else await flow();
  return { result: 'PASS', reducedMotion, viewport: '1280x720', cloud: 'off', frames: 6, recording: recordingFilename };
}

async function runLifecycle(cdp) {
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await open(`${baseUrl}/r148-lifecycle-harness.html`, cdp);
  const flow = async () => {
    await clickButton(cdp, 'Start Ask');
    await sleep(650);
    await assertLumi(cdp, { presentation: 'THINK', bubble: false, targetStatus: 'ready' });
    await clickButton(cdp, 'Parent rerender');
    await sleep(650);
    await assertLumi(cdp, { presentation: 'THINK', bubble: false, targetStatus: 'ready' });
    const callsAfterRerender = await evaluate(cdp, "Number(document.querySelector('[data-harness-calls]')?.textContent.match(/ask calls (\\d+)/)?.[1] ?? -1)");
    if (callsAfterRerender !== 1) throw new Error(`Parent rerender duplicated Ask provider call: ${callsAfterRerender}`);
    await clickButton(cdp, 'Resolve Ask');
    await sleep(650);
    await assertLumi(cdp, { presentation: 'GUIDE', bubble: true, bodyState: 'GUIDE', mode: 'guide', targetStatus: 'ready' });
    await sleep(4500);
    await assertLumi(cdp, { presentation: 'GUIDE', bubble: false, bodyState: 'GUIDE', mode: 'guide', targetStatus: 'ready' });
    await clickButton(cdp, 'Parent rerender');
    await sleep(350);
    await assertLumi(cdp, { presentation: 'GUIDE', bubble: false, bodyState: 'GUIDE', mode: 'guide', targetStatus: 'ready' });
    await clickButton(cdp, 'Start Ask');
    await sleep(250);
    await clickButton(cdp, 'Reject Ask');
    await sleep(350);
    await clickButton(cdp, 'episode.one.teachingDialogue.hintAction');
    await sleep(650);
    await assertLumi(cdp, { presentation: 'THINK', bubble: false, targetStatus: 'ready' });
    await clickButton(cdp, 'Parent rerender');
    await sleep(650);
    await assertLumi(cdp, { presentation: 'THINK', bubble: false, targetStatus: 'ready' });
    const teachingCallsAfterRerender = await evaluate(cdp, "Number(document.querySelector('[data-harness-calls]')?.textContent.match(/teaching calls (\\d+)/)?.[1] ?? -1)");
    if (teachingCallsAfterRerender !== 1) throw new Error(`Parent rerender duplicated Teaching provider call: ${teachingCallsAfterRerender}`);
    await clickButton(cdp, 'Resolve Teaching');
    await sleep(650);
    await assertLumi(cdp, { presentation: 'GUIDE', bubble: true, targetStatus: 'ready' });
    await clickButton(cdp, 'episode.one.teachingDialogue.hintAction');
    await sleep(250);
    await clickButton(cdp, 'episode.one.teachingDialogue.stop');
    await sleep(350);
    await assertLumi(cdp, { presentation: 'AMBIENT', bubble: false, bodyState: 'AMBIENT', mode: 'idle', targetStatus: 'ready' });
    await clickButton(cdp, 'Parent rerender');
    await sleep(350);
    await assertLumi(cdp, { presentation: 'AMBIENT', bubble: false, bodyState: 'AMBIENT', mode: 'idle', targetStatus: 'ready' });
    await clickButton(cdp, 'Resolve Teaching oldest');
    await sleep(350);
    await assertLumi(cdp, { presentation: 'AMBIENT', bubble: false, bodyState: 'AMBIENT', mode: 'idle', targetStatus: 'ready' });
    await clickButton(cdp, 'Reset trace');
    await sleep(650);
    await assertLumi(cdp, { presentation: 'AMBIENT', bubble: false, bodyState: 'AMBIENT', mode: 'idle', targetStatus: 'ready' });
    await clickButton(cdp, 'Restore GUIDE');
    await clickButton(cdp, 'episode.one.teachingDialogue.hintAction');
    await sleep(250);
    const staleTeachingSuccessBefore = await evaluate(cdp, "(document.querySelector('#r148-trace')?.innerText.match(/\\\"source\\\": \\\"teaching-dialogue\\\",\\s*\\\"phase\\\": \\\"success\\\"/g) || []).length");
    await clickButton(cdp, 'Teaching context change');
    await sleep(450);
    await clickButton(cdp, 'Resolve Teaching oldest');
    await sleep(450);
    const staleTeachingSuccessAfter = await evaluate(cdp, "(document.querySelector('#r148-trace')?.innerText.match(/\\\"source\\\": \\\"teaching-dialogue\\\",\\s*\\\"phase\\\": \\\"success\\\"/g) || []).length");
    if (staleTeachingSuccessAfter !== staleTeachingSuccessBefore) throw new Error(`Stale Teaching completion changed the trace: ${staleTeachingSuccessBefore} -> ${staleTeachingSuccessAfter}`);
    await assertLumi(cdp, { presentation: 'GUIDE', targetStatus: 'ready' });
    await clickButton(cdp, 'episode.one.teachingDialogue.hintAction');
    await sleep(250);
    await clickButton(cdp, 'Resolve Teaching');
    await sleep(650);
    await assertLumi(cdp, { presentation: 'GUIDE', bubble: true, targetStatus: 'ready' });
    await clickButton(cdp, 'Surface concept');
    await sleep(350);
    await assertLumi(cdp, { presentation: 'ILLUMINATE', bubble: true, targetStatus: 'ready' });
    await clickButton(cdp, 'Consume concept');
    await sleep(350);
    await assertLumi(cdp, { presentation: 'AMBIENT', bubble: false, bodyState: 'AMBIENT', mode: 'idle', targetStatus: 'ready' });
    await clickButton(cdp, 'Parent rerender');
    await sleep(350);
    await assertLumi(cdp, { presentation: 'AMBIENT', bubble: false, bodyState: 'AMBIENT', mode: 'idle', targetStatus: 'ready' });
    await clickButton(cdp, 'STAY_SILENT');
    await sleep(350);
    await assertLumi(cdp, { presentation: 'AMBIENT', bubble: false, bodyState: 'AMBIENT', mode: 'idle', targetStatus: 'ready' });
    await clickButton(cdp, 'Restore GUIDE');
    await clickButton(cdp, 'Withdraw target');
    await sleep(350);
    await assertLumi(cdp, { presentation: 'AMBIENT', bubble: false, bodyState: 'AMBIENT', mode: 'idle', targetStatus: 'missing' });
    await clickButton(cdp, 'Restore target');
    await clickButton(cdp, 'Start Ask');
    await sleep(250);
    await clickButton(cdp, 'Resolve Ask');
    await sleep(650);
    await assertLumi(cdp, { presentation: 'GUIDE', targetStatus: 'ready' });
    await clickButton(cdp, 'Start Ask');
    await sleep(250);
    await clickButton(cdp, 'Reject Ask');
    await sleep(350);
    await clickButton(cdp, 'Start Ask');
    await sleep(650);
    await assertLumi(cdp, { presentation: 'THINK', bubble: false, targetStatus: 'ready' });
    await clickButton(cdp, 'Unmount children');
    await sleep(650);
    await assertLumi(cdp, { presentation: 'AMBIENT', bubble: false, bodyState: 'AMBIENT', mode: 'idle', targetStatus: 'ready' });
  };
  await recordCurrentPage(cdp, 'lumi-lifecycle.webm', flow);
  const trace = await evaluate(cdp, 'document.querySelector("#r148-trace")?.innerText || ""');
  if (!trace.includes('"phase": "success"') || !trace.includes('"phase": "cancel"') || !trace.includes('"phase": "error"')) throw new Error('Mounted lifecycle trace did not contain success, error, and cancel.');
  await capture(cdp, 'mounted-lifecycle.png');
  return { result: 'PASS', checkpoints: ['Ask success/finish', 'natural bubble expiry + rerender', 'Ask rejection/error', 'Teaching success/finish', 'Teaching stop + stale completion', 'reset arbitration', 'context-switch stale completion', 'concept consume + STAY_SILENT', 'target withdrawal', 'Ask unmount/cancel'] };
}

async function runAccessibility(cdp) {
  await open(`${baseUrl}/?directorDebug=1&r148=a11y`, cdp);
  await evaluate(cdp, `localStorage.setItem('volk-ml-language-settings', JSON.stringify({ primary: 'zh', secondary: null }));`);
  await cdp.send('Page.reload');
  await sleep(1100);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  await assertText(cdp, '第 1 集');
  const narrow = await evaluate(cdp, '({ innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth })');
  if (narrow.scrollWidth > narrow.innerWidth + 1 || narrow.bodyScrollWidth > narrow.innerWidth + 1) throw new Error(`Narrow layout overflowed: ${JSON.stringify(narrow)}`);
  const focusable = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').includes('第 1 集'));
    if (!button) return false;
    button.focus();
    return document.activeElement === button;
  })()`);
  if (!focusable) throw new Error('Episode entry did not accept keyboard focus.');
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(300);
  if (!(await evaluate(cdp, `document.body.innerText.includes('如果 World 不变')`))) await clickButton(cdp, '第 1 集');
  await assertText(cdp, '如果 World 不变');
  await capture(cdp, 'zh-narrow.png');
  await evaluate(cdp, `localStorage.setItem('volk-ml-language-settings', JSON.stringify({ primary: 'en', secondary: 'zh' }));`);
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await cdp.send('Page.reload');
  await sleep(1100);
  await assertText(cdp, 'Episode 1');
  await assertText(cdp, '第 1 集');
  await capture(cdp, 'parallel-entry.png');
  await evaluate(cdp, `localStorage.setItem('volk-ml-language-settings', JSON.stringify({ primary: 'en', secondary: null }));`);
  return { result: 'PASS', narrowViewport: '390x844', language: 'zh', parallel: 'en+zh', keyboardFocus: true, overflow: false };
}

function writeSlideshow(prefix, title) {
  const frames = fs.readdirSync(assets).filter((file) => file.startsWith(prefix) && file.endsWith('.png')).sort();
  const html = `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font:16px system-ui;background:#0f172a;color:#e2e8f0;margin:0;padding:24px}main{max-width:1280px;margin:auto}figure{margin:0 0 24px}img{display:block;width:100%;border-radius:12px;background:white}figcaption{padding:8px 0;font-weight:700}</style><main><h1>${title}</h1>${frames.map((file, index) => `<figure><img src="${file}" alt="${title} frame ${index + 1}"><figcaption>${file}</figcaption></figure>`).join('')}</main>`;
  fs.writeFileSync(path.join(assets, `${prefix}-slideshow.html`), html, 'utf8');
}

await startLocalServices();
let cdp;
try {
  cdp = await connect();
  const normal = await runEpisode(cdp, { prefix: 'normal', reducedMotion: false, recordingFilename: 'episode-normal.webm' });
  const reduced = await runEpisode(cdp, { prefix: 'reduced', reducedMotion: true });
  const mountedLifecycle = await runLifecycle(cdp);
  const accessibility = await runAccessibility(cdp);
  writeSlideshow('normal', 'R148 normal-motion Episode 1 evidence sequence');
  writeSlideshow('reduced', 'R148 reduced-motion Episode 1 evidence sequence');
  const trace = {
    schema: 'r148-cdp-browser-evidence-v1',
    command: 'powershell -ExecutionPolicy Bypass -File scripts/run-r148-browser.ps1',
    browser: 'Google Chrome headless via Chrome DevTools Protocol',
    viewport: '1280x720',
    cloud: 'off',
    normal,
    reduced,
    mountedLifecycle,
    accessibility,
    artifacts: ['episode-normal.webm', 'lumi-lifecycle.webm', 'normal-slideshow.html', 'reduced-slideshow.html', 'normal-01-entry.png', 'normal-02-fit-a.png', 'normal-03-resample.png', 'normal-04-fit-b.png', 'normal-05-concept.png', 'normal-06-recovered.png', 'reduced-05-concept.png', 'reduced-06-recovered.png', 'zh-narrow.png', 'parallel-entry.png', 'mounted-lifecycle.png'],
  };
  fs.writeFileSync(path.join(assets, 'r148-trace.json'), `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(trace, null, 2));
} finally {
  cdp?.close();
  stopProcess(chromeProcess);
  stopProcess(viteProcess);
  try { fs.rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
}
