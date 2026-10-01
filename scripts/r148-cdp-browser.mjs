import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const baseUrl = 'http://127.0.0.1:5174';
const assets = path.resolve(process.env.VOLK_R148_OUTPUT_DIR || 'docs/acceptance/assets/r148');
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

async function waitForBrowserSelector(cdp, selector, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(cdp, `(() => ({ found: Boolean(document.querySelector(${JSON.stringify(selector)})), readyState: document.readyState, href: location.href, body: (document.body?.innerText || '').slice(0, 600), rootChildCount: document.querySelector('#root')?.childElementCount ?? null }))()`);
      if (last.found) return last;
    } catch (error) {
      last = { evaluationError: String(error) };
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for browser selector ${selector}: ${JSON.stringify(last)}`);
}

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

async function clickSelector(cdp, selector) {
  const clicked = await evaluate(cdp, `(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) {
    const diagnostic = await evaluate(cdp, `({ href: location.href, body: (document.body?.innerText || '').slice(0, 1200), buttons: [...document.querySelectorAll('button')].map((button) => ({ text: (button.textContent || '').replace(/\\s+/g, ' ').trim(), id: button.getAttribute('data-big-idea-id'), intro: button.hasAttribute('data-intro-start-episode') })).slice(0, 30) })`);
    throw new Error(`Enabled button not found: ${selector}; page=${JSON.stringify(diagnostic)}`);
  }
  await sleep(350);
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
    const rail = document.querySelector('[data-lumi-vertical-rail]');
    const visual = target?.querySelector('[data-lumi-mode]');
    return { presentation: node?.getAttribute('data-lumi-presentation-state') ?? null, bodyState: target?.getAttribute('data-lumi-body-state') ?? null, mode: visual?.getAttribute('data-lumi-mode') ?? null, presence: visual?.getAttribute('data-lumi-presence') ?? null, bubble: Boolean(document.querySelector('[data-lumi-context-bubble]')), targetStatus: target?.getAttribute('data-lumi-target-status') ?? rail?.getAttribute('data-lumi-track-status') ?? null };
  })()`);
  if (presentation && state.presentation !== presentation) throw new Error(`Unexpected LUMI presentation state: ${JSON.stringify(state)}`);
  if (bodyState && state.bodyState !== bodyState) throw new Error(`Unexpected LUMI body state: ${JSON.stringify(state)}`);
  if (mode && state.mode !== mode) throw new Error(`Unexpected LUMI visual mode: ${JSON.stringify(state)}`);
  if (bubble !== null && state.bubble !== bubble) throw new Error(`Unexpected LUMI context bubble state: ${JSON.stringify(state)}`);
  if (targetStatus && state.targetStatus !== targetStatus) throw new Error(`Unexpected LUMI target status: ${JSON.stringify(state)}`);
  return state;
}

async function assertSelectorTextContent(cdp, selector, text) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const found = await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.textContent?.includes(${JSON.stringify(text)}) ?? false`);
    if (found) return;
    await sleep(200);
  }
  const content = await evaluate(cdp, `({ content: document.querySelector(${JSON.stringify(selector)})?.textContent ?? null, body: (document.body?.innerText || '').slice(0, 1200), dialogs: [...document.querySelectorAll('[role=dialog]')].map((item) => item.innerText.slice(0, 400)) })`);
  throw new Error(`Expected semantic text not found in ${selector}: ${text}; actual=${JSON.stringify(content)}`);
}

async function readRailAlignment(cdp) {
  return evaluate(cdp, `(() => {
    const rail = document.querySelector('[data-lumi-vertical-rail]');
    const avatar = document.querySelector('[data-lumi-rail-avatar]');
    const target = document.querySelector('[data-lumi-course-control].ring-cyan-400');
    const avatarRect = avatar?.getBoundingClientRect();
    const targetRect = target?.getBoundingClientRect();
    const scrollport = document.querySelector('.ui-explore-episode-scrollport');
    const scrollRect = scrollport?.getBoundingClientRect();
    return {
      target: target?.getAttribute('data-lumi-control-id') ?? null,
      targetCenterY: targetRect ? targetRect.top + targetRect.height / 2 : null,
      avatarCenterY: avatarRect ? avatarRect.top + avatarRect.height / 2 : null,
      avatarLeft: avatarRect?.left ?? null,
      error: targetRect && avatarRect ? (avatarRect.top + avatarRect.height / 2) - (targetRect.top + targetRect.height / 2) : null,
      visible: Boolean(targetRect && scrollRect && targetRect.top >= scrollRect.top && targetRect.bottom <= scrollRect.bottom),
      railUpdate: rail?.getAttribute('data-lumi-track-update') ?? null,
      inlineTransition: avatar?.style.transition ?? null,
      scrollTop: scrollport?.scrollTop ?? null,
      maxScroll: scrollport ? scrollport.scrollHeight - scrollport.clientHeight : null,
    };
  })()`);
}

async function assertRailAlignment(cdp, expectedControlId, { exerciseScroll = true } = {}) {
  let measurement = null;
  for (let attempt = 0; attempt < 18; attempt += 1) {
    measurement = await readRailAlignment(cdp);
    if (measurement.target === expectedControlId && Number.isFinite(measurement.error) && Math.abs(measurement.error) <= 4) break;
    await sleep(50);
  }
  const samples = [{ ...measurement, phase: 'settled' }];
  if (measurement.target !== expectedControlId || !Number.isFinite(measurement.error)) {
    throw new Error(`LUMI alignment target mismatch for ${expectedControlId}: ${JSON.stringify(measurement)}`);
  }
  if (Math.abs(measurement.error) > 4) throw new Error(`LUMI avatar is not centered on ${expectedControlId}: ${JSON.stringify(measurement)}`);
  if (!exerciseScroll) return measurement;
  const baselineLeft = measurement.avatarLeft;
  const originalScroll = measurement.scrollTop;
  const maxScroll = measurement.maxScroll;
  for (const delta of [-16, 16]) {
    const requestedScroll = Math.max(0, Math.min(maxScroll, originalScroll + delta));
    if (requestedScroll === measurement.scrollTop) continue;
    await evaluate(cdp, `(() => {
      const scrollport = document.querySelector('.ui-explore-episode-scrollport');
      if (!scrollport) return false;
      const max = Math.max(0, scrollport.scrollHeight - scrollport.clientHeight);
      scrollport.scrollTop = Math.max(0, Math.min(max, ${JSON.stringify(originalScroll + delta)}));
      return true;
    })()`);
    await sleep(80);
    measurement = await readRailAlignment(cdp);
    if (measurement.target === expectedControlId && measurement.visible) {
      if (Math.abs(measurement.error) > 4) throw new Error(`LUMI scroll tracking missed ${expectedControlId}: ${JSON.stringify(measurement)}`);
      if (Math.abs(measurement.avatarLeft - baselineLeft) > 1) throw new Error(`LUMI rail moved horizontally during same-layout scrolling: ${JSON.stringify({ baselineLeft, measurement })}`);
      if (measurement.railUpdate !== 'scroll' || measurement.inlineTransition !== 'none') throw new Error(`LUMI scroll update was delayed or animated: ${JSON.stringify(measurement)}`);
      samples.push({ ...measurement, delta });
    }
  }
  await evaluate(cdp, `(() => { const node = document.querySelector('.ui-explore-episode-scrollport'); if (node) node.scrollTop = ${JSON.stringify(originalScroll)}; })()`);
  await sleep(80);
  const restored = await readRailAlignment(cdp);
  if (restored.target === expectedControlId && restored.visible && Math.abs(restored.error) > 4) throw new Error(`LUMI did not realign after scroll restoration: ${JSON.stringify(restored)}`);
  samples.push({ ...restored, phase: 'restored' });
  return { controlId: expectedControlId, samples };
}

async function assertRailPromptNoOcclusion(cdp, label = 'current') {
  const state = await evaluate(cdp, `(() => {
    const rail = document.querySelector('[data-lumi-vertical-rail]');
    const prompt = document.querySelector('[data-lumi-rail-prompt]');
    const avatar = document.querySelector('[data-lumi-rail-avatar]');
    const image = avatar?.querySelector('img.lumi-visual');
    const controls = document.querySelector('.lumi-rail-controls');
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
    };
    const overlaps = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
    return { viewport: { innerWidth, innerHeight, devicePixelRatio, mobileLayout: matchMedia('(max-width: 767px)').matches }, rail: rect(rail), prompt: rect(prompt), avatarImage: rect(image), controls: rect(controls), imageLoaded: Boolean(image?.complete && image.naturalWidth > 0), placement: prompt?.getAttribute('data-lumi-rail-prompt-placement') ?? null, compact: prompt?.getAttribute('data-lumi-rail-prompt-compact') ?? null, promptCoversAvatar: overlaps(rect(prompt), rect(image)), promptCoversControls: overlaps(rect(prompt), rect(controls)) };
  })()`);
  if (state.prompt && (!state.imageLoaded || state.promptCoversAvatar || state.promptCoversControls)) {
    throw new Error(`LUMI prompt occludes its avatar/controls or the avatar image is unavailable (${label}): ${JSON.stringify(state)}`);
  }
  if (state.prompt && (state.prompt.left < state.rail.left - 1 || state.prompt.right > state.rail.right + 1)) {
    throw new Error(`LUMI prompt escaped the reserved rail (${label}): ${JSON.stringify(state)}`);
  }
  return state;
}

async function runBubbleViewportMatrix(cdp, prefix) {
  const viewports = [[390, 844], [768, 1024], [1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]];
  const results = [];
  for (const [width, height] of viewports) {
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 767 });
    let actual = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      actual = await evaluate(cdp, '({ innerWidth, innerHeight })');
      if (actual.innerWidth === width && actual.innerHeight === height) break;
      await sleep(50);
    }
    if (actual?.innerWidth !== width || actual?.innerHeight !== height) throw new Error(`Browser did not adopt requested viewport ${width}x${height}: ${JSON.stringify(actual)}`);
    await sleep(650);
    const state = await assertRailPromptNoOcclusion(cdp, `${width}x${height}`);
    if (state.viewport.innerWidth !== width || state.viewport.innerHeight !== height) throw new Error(`Browser viewport changed during ${width}x${height} bubble check: ${JSON.stringify(state.viewport)}`);
    const overflow = await evaluate(cdp, `({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth })`);
    if (overflow.documentWidth > overflow.width + 1 || overflow.bodyWidth > overflow.width + 1) throw new Error(`LUMI rail layout caused horizontal overflow at ${width}x${height}: ${JSON.stringify(overflow)}`);
    if (state.prompt) await capture(cdp, `${prefix}-bubble-${width}x${height}.png`);
    results.push({ requestedViewport: `${width}x${height}`, actualViewport: state.viewport, promptVisible: Boolean(state.prompt), placement: state.placement, compact: state.compact, avatarImage: state.avatarImage, prompt: state.prompt, controls: state.controls });
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await sleep(250);
  const restored = await evaluate(cdp, '({ innerWidth, innerHeight })');
  if (restored.innerWidth !== 1280 || restored.innerHeight !== 720) throw new Error(`Browser viewport did not restore to 1280x720: ${JSON.stringify(restored)}`);
  return { viewports: results, restoredViewport: restored };
}

async function waitForRailPrompt(cdp, { visible, controlId = null, timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let state = null;
  while (Date.now() < deadline) {
    state = await evaluate(cdp, `(() => {
      const prompt = document.querySelector('[data-lumi-rail-prompt]');
      const rail = document.querySelector('[data-lumi-vertical-rail]');
      const active = document.querySelector('[data-lumi-course-control].ring-cyan-400');
      return { visible: Boolean(prompt), identity: prompt?.getAttribute('data-lumi-rail-prompt-identity') ?? null, targetIdentity: rail?.getAttribute('data-lumi-rail-target-identity') ?? null, controlId: rail?.getAttribute('data-lumi-rail-control-id') || active?.getAttribute('data-lumi-control-id') || null, text: prompt?.innerText ?? null, direction: rail?.getAttribute('data-lumi-track-direction') ?? null, status: rail?.getAttribute('data-lumi-track-status') ?? null };
    })()`);
    if (state.visible === visible && (!controlId || state.controlId === controlId)) return state;
    await sleep(100);
  }
  throw new Error(`LUMI rail prompt state did not settle: ${JSON.stringify({ expected: { visible, controlId }, state })}`);
}

async function exerciseExplicitHelpRearm(cdp) {
  const controlId = 'episode-next-resample';
  const initial = await waitForRailPrompt(cdp, { visible: true, controlId });
  await sleep(6250);
  const expired = await waitForRailPrompt(cdp, { visible: false, controlId, timeoutMs: 1500 });
  if (expired.targetIdentity !== initial.identity) throw new Error(`Prompt timeout changed the active target identity: ${JSON.stringify({ initial, expired })}`);
  await sleep(300);
  await waitForRailPrompt(cdp, { visible: false, controlId, timeoutMs: 500 });

  await clickSelector(cdp, '[data-enter-free-exploration]');
  await waitForRailPrompt(cdp, { visible: false, timeoutMs: 700 });
  await clickSelector(cdp, '[data-free-exploration-help]');
  const reopened = await waitForRailPrompt(cdp, { visible: true, controlId });
  if (reopened.identity !== initial.identity) throw new Error(`Explicit help did not reopen guidance for the same target: ${JSON.stringify({ initial, reopened })}`);
  await clickSelector(cdp, '[data-lumi-rail-dismiss]');
  await waitForRailPrompt(cdp, { visible: false, timeoutMs: 700 });
  await sleep(300);
  await waitForRailPrompt(cdp, { visible: false, timeoutMs: 500 });
  await clickSelector(cdp, '[data-free-exploration-help-dismiss]');
  await clickSelector(cdp, '[data-free-exploration-help]');
  const rearmedAfterDismiss = await waitForRailPrompt(cdp, { visible: true, controlId });
  if (rearmedAfterDismiss.identity !== initial.identity) throw new Error(`Learner help failed to re-arm the dismissed target: ${JSON.stringify({ initial, rearmedAfterDismiss })}`);

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 360, deviceScaleFactor: 1, mobile: false });
  await sleep(350);
  const beforeReveal = await waitForRailPrompt(cdp, { visible: true, controlId, timeoutMs: 3000 });
  const beforeWheel = await evaluate(cdp, `(() => {
    const scrollport = document.querySelector('.ui-explore-episode-scrollport');
    if (!scrollport) return null;
    const rect = scrollport.getBoundingClientRect();
    return { scrollTop: scrollport.scrollTop, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, maxScroll: scrollport.scrollHeight - scrollport.clientHeight };
  })()`);
  if (!beforeWheel || beforeWheel.maxScroll <= 0) throw new Error(`Episode 1 scrollport is not scrollable in the offscreen case: ${JSON.stringify(beforeWheel)}`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: beforeWheel.x, y: beforeWheel.y, deltaX: 0, deltaY: 450 });
  await sleep(350);
  const offscreen = await evaluate(cdp, `(() => {
    const scrollport = document.querySelector('.ui-explore-episode-scrollport');
    const target = document.querySelector('[data-lumi-course-control="world.sample"]');
    const clip = scrollport?.getBoundingClientRect();
    const rect = target?.getBoundingClientRect();
    return { scrollTop: scrollport?.scrollTop ?? null, targetTop: rect?.top ?? null, scrollTopEdge: clip?.top ?? null, scrollBottom: clip?.bottom ?? null };
  })()`);
  if (offscreen.scrollTop === beforeWheel.scrollTop) throw new Error(`Real wheel input did not scroll the Episode 1 pane: ${JSON.stringify({ beforeWheel, offscreen })}`);
  const direction = await evaluate(cdp, `(() => ({ status: document.querySelector('[data-lumi-vertical-rail]')?.getAttribute('data-lumi-track-status'), direction: document.querySelector('[data-lumi-vertical-rail]')?.getAttribute('data-lumi-track-direction'), text: document.querySelector('[data-lumi-rail-prompt]')?.innerText ?? null, scrollTop: document.querySelector('.ui-explore-episode-scrollport')?.scrollTop ?? null }))()`);
  if (direction.status !== 'offscreen' || direction.direction !== 'up' || !direction.text?.toLowerCase().includes('above')) throw new Error(`Offscreen target direction was not communicated: ${JSON.stringify({ offscreen, direction, beforeReveal })}`);
  await sleep(350);
  const stillNotRevealed = await evaluate(cdp, `document.querySelector('.ui-explore-episode-scrollport')?.scrollTop ?? null`);
  if (stillNotRevealed !== direction.scrollTop) throw new Error(`LUMI scrolled without learner confirmation: ${JSON.stringify({ direction, stillNotRevealed })}`);
  await clickSelector(cdp, '[data-lumi-rail-reveal]');
  await sleep(700);
  const afterReveal = await evaluate(cdp, `(() => ({ status: document.querySelector('[data-lumi-vertical-rail]')?.getAttribute('data-lumi-track-status'), targetVisible: (() => { const scroller = document.querySelector('.ui-explore-episode-scrollport'); const target = document.querySelector('[data-lumi-course-control="world.sample"]')?.getBoundingClientRect(); const clip = scroller?.getBoundingClientRect(); return Boolean(target && clip && target.top >= clip.top && target.bottom <= clip.bottom); })(), scrollTop: document.querySelector('.ui-explore-episode-scrollport')?.scrollTop ?? null }))()`);
  if (afterReveal.status !== 'ready' || !afterReveal.targetVisible || afterReveal.scrollTop === stillNotRevealed) throw new Error(`Learner-confirmed reveal failed: ${JSON.stringify({ stillNotRevealed, afterReveal })}`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  return { result: 'PASS', targetControlId: controlId, timeoutSuppressed: true, dismissSuppressed: true, explicitHelpRearmedSameIdentity: true, actualWheelInput: true, offscreenDirection: direction.direction, automaticScroll: false, revealedOnlyAfterClick: true };
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
  const alignment = await assertRailAlignment(cdp, controlId);
  const bubble = await assertRailPromptNoOcclusion(cdp, controlId);
  return { ...alignment, bubble };
}

async function open(pageUrl, cdp) {
  const navigation = await cdp.send('Page.navigate', { url: pageUrl });
  if (navigation.errorText) throw new Error(`Browser navigation failed for ${pageUrl}: ${navigation.errorText}`);
  const deadline = Date.now() + 15000;
  let readyState = null;
  while (Date.now() < deadline) {
    try {
      readyState = await evaluate(cdp, 'document.readyState');
      if (readyState === 'complete') return;
    } catch { /* Navigation replaces the current execution context. */ }
    await sleep(100);
  }
  throw new Error(`Browser document did not finish loading at ${pageUrl}; readyState=${JSON.stringify(readyState)}`);
}

async function runEpisode(cdp, { reducedMotion = false, prefix, recordingFilename = null }) {
  await open(`${baseUrl}/?directorDebug=1&r148=cdp`, cdp);
  if (reducedMotion) await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await waitForBrowserSelector(cdp, '[data-explore-home]');
  await clickSelector(cdp, '[data-big-idea-id="episode-1-sampling-variability"]');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await evaluate(cdp, 'Boolean(document.querySelector("[data-inquiry-episode]"))')) break;
    await sleep(200);
  }
  await assertSelectorTextContent(cdp, '[data-inquiry-episode] h3', 'If the World stays the same, will a learned model stay the same?');
  let bubbleViewports = null;
  if (!reducedMotion) {
    await waitForRailPrompt(cdp, { visible: true, controlId: 'episode-next-baseline-fit' });
    bubbleViewports = await runBubbleViewportMatrix(cdp, prefix);
  }
  const flow = async () => {
    let promptRearm = null;
    const alignments = [];
    await capture(cdp, `${prefix}-01-entry.png`);
    alignments.push(await assertEpisodeTarget(cdp, { key: 'model.fit', controlId: 'episode-next-baseline-fit', inactive: [['world.sample', 'episode-next-resample'], ['model.fit', 'episode-next-fit-b'], ['experiment.compare', 'episode-next-compare']] }));
    await clickButton(cdp, 'Skip prediction');
    await clickButton(cdp, 'Fit A');
    await capture(cdp, `${prefix}-02-fit-a.png`);
    alignments.push(await assertEpisodeTarget(cdp, { key: 'world.sample', controlId: 'episode-next-resample', inactive: [['model.fit', 'episode-next-baseline-fit'], ['model.fit', 'episode-next-fit-b'], ['experiment.compare', 'episode-next-compare']] }));
    if (!reducedMotion) promptRearm = await exerciseExplicitHelpRearm(cdp);
    await clickButton(cdp, 'Sample same World');
    await capture(cdp, `${prefix}-03-resample.png`);
    if (!reducedMotion) {
      await clickSelector(cdp, '[data-free-exploration-help]');
      await waitForRailPrompt(cdp, { visible: true, controlId: 'episode-next-fit-b' });
    }
    alignments.push(await assertEpisodeTarget(cdp, { key: 'model.fit', controlId: 'episode-next-fit-b', inactive: [['model.fit', 'episode-next-baseline-fit'], ['world.sample', 'episode-next-resample'], ['experiment.compare', 'episode-next-compare']] }));
    await clickButton(cdp, 'Fit B');
    await capture(cdp, `${prefix}-04-fit-b.png`);
    if (!reducedMotion) {
      await clickSelector(cdp, '[data-free-exploration-help]');
      await waitForRailPrompt(cdp, { visible: true, controlId: 'episode-next-compare' });
    }
    alignments.push(await assertEpisodeTarget(cdp, { key: 'experiment.compare', controlId: 'episode-next-compare', inactive: [['model.fit', 'episode-next-baseline-fit'], ['world.sample', 'episode-next-resample'], ['model.fit', 'episode-next-fit-b']] }));
    await clickButton(cdp, 'Compare A / B');
    await assertText(cdp, 'Sampling variability');
    await assertText(cdp, 'EVIDENCED');
    await assertText(cdp, 'CHANGED');
    await assertText(cdp, 'HELD CONSTANT');
    const staleCompare = await evaluate(cdp, "document.querySelector('[data-lumi-course-control=\\\"experiment.compare\\\"][data-lumi-control-id=\\\"episode-next-compare\\\"]')?.className?.includes('ring-cyan-400') ?? false");
    if (staleCompare) throw new Error('Compare target remained highlighted after comparison completed.');
    await capture(cdp, `${prefix}-05-concept.png`);
    await sleep(1200);
    await capture(cdp, `${prefix}-06-recovered.png`);
    return { promptRearm, alignments };
  };
  const verification = recordingFilename ? await recordCurrentPage(cdp, recordingFilename, flow) : await flow();
  return { result: 'PASS', reducedMotion, viewport: '1280x720', cloud: 'off', frames: 6, recording: recordingFilename, bubbleViewports, ...verification };
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
  await evaluate(cdp, `localStorage.setItem('volk-ml-language-settings', JSON.stringify({ primary: 'zh', secondary: null })); localStorage.removeItem('volk.ml.intro-preference.v1');`);
  await open(`${baseUrl}/?directorDebug=1&r148=a11y`, cdp);
  await waitForBrowserSelector(cdp, '[data-explore-home]');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  const narrow = await evaluate(cdp, '({ innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth })');
  if (narrow.scrollWidth > narrow.innerWidth + 1 || narrow.bodyScrollWidth > narrow.innerWidth + 1) throw new Error(`Narrow layout overflowed: ${JSON.stringify(narrow)}`);
  await clickSelector(cdp, '[data-explore-secondary-entries] > summary');
  const focusable = await evaluate(cdp, `(() => {
    const button = document.querySelector('[data-big-idea-id="episode-1-sampling-variability"]');
    if (!button) return false;
    button.focus();
    return document.activeElement === button;
  })()`);
  if (!focusable) throw new Error('Episode entry did not accept keyboard focus.');
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(300);
  const enterActivatedEntry = await evaluate(cdp, 'Boolean(document.querySelector("[data-inquiry-episode] h3"))');
  if (!enterActivatedEntry) await clickSelector(cdp, '[data-big-idea-id="episode-1-sampling-variability"]');
  await assertSelectorTextContent(cdp, '[data-inquiry-episode] h3', '如果 World 不变，学到的模型也会不变吗？');
  await capture(cdp, 'zh-narrow.png');
  await evaluate(cdp, `localStorage.setItem('volk-ml-language-settings', JSON.stringify({ primary: 'en', secondary: 'zh' }));`);
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await open(`${baseUrl}/?directorDebug=1&r148=a11y-parallel`, cdp);
  await waitForBrowserSelector(cdp, '[data-explore-home]');
  await assertText(cdp, 'Episode 1');
  await assertText(cdp, '第 1 集');
  await capture(cdp, 'parallel-entry.png');
  await evaluate(cdp, `localStorage.setItem('volk-ml-language-settings', JSON.stringify({ primary: 'en', secondary: null }));`);
  return { result: 'PASS', narrowViewport: '390x844', language: 'zh', parallel: 'en+zh', keyboardFocus: true, enterActivatedEntry, overflow: false };
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
