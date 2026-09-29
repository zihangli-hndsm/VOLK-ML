import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const baseUrl = 'http://127.0.0.1:5176';
const chromeDebugUrl = 'http://127.0.0.1:9226/json/list';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-webgpu-h1-chrome-'));
const cleanupProfile = () => {
  const tempRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(profile);
  if (path.dirname(resolved) === tempRoot && path.basename(resolved).startsWith('volk-webgpu-h1-chrome-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
};
let viteProcess = null;
let chromeProcess = null;
let socket = null;

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try { child.kill(); } catch { /* The process may already have exited. */ }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL'); } catch { /* Cleanup remains bounded if the process already ended. */ }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1000))]);
  }
}

function chromePath() {
  const candidates = [
    process.env.WEBGPU_CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* The local process may still be starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
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
      const pending = message.id && this.pending.get(message.id);
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
  const response = await socket.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'Browser evaluation failed.');
  return response.result?.value;
}

async function waitFor(expression, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(await evaluate('({url:location.href,text:document.body?.innerText?.slice(0,800)})'))}`);
}

async function click(selector) {
  const clicked = await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) return false; element.click(); return true; })()`);
  assert.equal(clicked, true, `The browser can click ${selector}.`);
}

function classificationModel() {
  return {
    type: 'browser_mlp', sourceNodeId: 'browser-contract-trainer', modelNodeId: 'browser-contract-output',
    featureColumns: ['x1', 'x2'], targetColumn: 'class',
    normalization: { means: [0.5, -0.25], stds: [2, 0.5] }, task: 'classification', labels: ['left', 'right'],
    layers: [
      { op: 'dense', input_features: 2, units: 2, use_bias: true, weights: [[0.5, -0.25], [0.75, 0.1]], bias: [0.1, -0.2] },
      { op: 'relu' },
      { op: 'dense', input_features: 2, units: 2, use_bias: true, weights: [[0.2, -0.4], [-0.3, 0.6]], bias: [0.05, 0.2] },
      { op: 'sigmoid' },
      { op: 'tanh' },
      { op: 'dense', input_features: 2, units: 2, use_bias: true, weights: [[0.9, -0.1], [-0.5, 0.7]], bias: [0.1, -0.05] },
      { op: 'softmax' },
    ],
  };
}

function regressionModel() {
  return {
    ...classificationModel(),
    task: 'regression', labels: [],
    layers: [
      { op: 'dense', input_features: 2, units: 3, use_bias: true, weights: [[0.1, 0.2], [-0.3, 0.4], [0.25, -0.1]], bias: [0, 0.2, -0.1] },
      { op: 'sigmoid' },
      { op: 'tanh' },
      { op: 'dense', input_features: 3, units: 1, use_bias: true, weights: [[0.2, 0.3, -0.5]], bias: [0.1] },
    ],
  };
}

function denseLayer(units, weights, bias) {
  return { op: 'dense', input_features: weights[0].length, units, use_bias: true, weights, bias };
}

function regressionBoundaryModel(layers) {
  return {
    ...regressionModel(),
    normalization: { means: [0, 0], stds: [1, 1] },
    layers,
  };
}

function boundaryCases() {
  return [
    {
      id: 'dense-near-zero',
      model: regressionBoundaryModel([denseLayer(1, [[1, 1]], [1e-7])]),
      input: [1, -1],
      focusOp: 'dense',
      focusStage: 0,
      condition: 'near-zero',
    },
    {
      id: 'relu-zero-crossing',
      model: regressionBoundaryModel([
        denseLayer(3, [[1, 0], [1, 0], [1, 0]], [-1 + 1e-7, -1, -1 - 1e-7]),
        { op: 'relu' },
        denseLayer(1, [[1, 1, 1]], [0]),
      ]),
      input: [1, 0],
      focusOp: 'relu',
      focusStage: 1,
      condition: 'positive-zero-negative',
    },
    {
      id: 'sigmoid-zero-input',
      model: regressionBoundaryModel([
        denseLayer(1, [[1, 0]], [-1 + 1e-7]),
        { op: 'sigmoid' },
        denseLayer(1, [[1]], [0]),
      ]),
      input: [1, 0],
      focusOp: 'sigmoid',
      focusStage: 1,
      condition: 'near-zero-input',
    },
    {
      id: 'tanh-zero-input',
      model: regressionBoundaryModel([
        denseLayer(1, [[1, 0]], [-1 + 1e-7]),
        { op: 'tanh' },
        denseLayer(1, [[1]], [0]),
      ]),
      input: [1, 0],
      focusOp: 'tanh',
      focusStage: 1,
      condition: 'near-zero-input',
    },
    {
      id: 'softmax-near-equal-logits',
      model: {
        ...regressionModel(),
        normalization: { means: [0, 0], stds: [1, 1] },
        task: 'classification',
        labels: ['a', 'b', 'c'],
        layers: [
          denseLayer(3, [[1, 0], [1, 0], [1, 0]], [-1, -1 + 1e-7, -1 - 1e-7]),
          { op: 'softmax' },
        ],
      },
      input: [1, 0],
      focusOp: 'softmax',
      focusStage: 1,
      condition: 'near-equal-logits',
    },
  ];
}

const result = { task: 'VOLK-ML H1 WebGPU MLP inference parity', status: 'NOT VERIFIED', browser: null, steps: [] };
try {
  const executable = chromePath();
  assert.ok(executable, 'Set WEBGPU_CHROME to a Chrome/Edge executable when it is not at a standard Windows path.');
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5176', '--strictPort'], {
    cwd: process.cwd(), env: process.env, stdio: 'ignore',
  });
  await waitForHttp(`${baseUrl}/`);
  chromeProcess = spawn(executable, [
    '--headless=new', '--remote-debugging-port=9226', '--window-size=1440,1000', '--enable-unsafe-webgpu',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  await waitForHttp(chromeDebugUrl);
  const pages = await (await fetch(chromeDebugUrl)).json();
  const page = pages.find((item) => item.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'A mounted Chrome DevTools page is available.');
  socket = new CdpClient(page.webSocketDebuggerUrl);
  await socket.send('Page.enable');
  await socket.send('Runtime.enable');
  await socket.send('Page.navigate', { url: baseUrl });
  await waitFor('Boolean(window.__VOLK_ML_AGENT__)', 'the mounted VOLK-ML application');

  const adapter = await evaluate(`(async()=>{
    if (!navigator.gpu) return {available:false, reason:'navigator.gpu missing'};
    const adapter=await navigator.gpu.requestAdapter({forceFallbackAdapter:false});
    if (!adapter) return {available:false, reason:'hardware adapter rejected'};
    const info=adapter.info ?? {};
    const description=[info.vendor,info.architecture,info.device,info.description].filter(Boolean).join(' ');
    if (info.isFallbackAdapter===true || /swiftshader|llvmpipe|software rasterizer|fallback/i.test(description)) {
      return {available:false, reason:'software/fallback adapter', description};
    }
    return {available:true, description:description || 'non-fallback adapter requested'};
  })()`, true);
  if (!adapter.available) {
    result.browser = adapter;
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 2;
  } else {
    result.browser = adapter;
    const operationMatrix = await evaluate(`(async()=>{
      const runtime=await import('/src/core/execution/browserWebGpuMlp.js');
      const browserRuntime=await import('/src/core/browserRuntime.js');
      const classification=${JSON.stringify(classificationModel())};
      const regression=${JSON.stringify(regressionModel())};
      const single=await runtime.runBrowserWebGpuMlpInference(classification,[0.1,-0.7]);
      const batch=await runtime.runBrowserWebGpuMlpBatchInference(classification,[[0.1,-0.7],[0.8,0.2]]);
      const regressionResult=await runtime.runBrowserWebGpuMlpInference(regression,[0.1,-0.7]);
      const boundaries=${JSON.stringify(boundaryCases())};
      const boundaryResults=[];
      for(const item of boundaries){
        const cpu=browserRuntime.traceBrowserMlpInference(item.model,item.input);
        const gpu=await runtime.runBrowserWebGpuMlpInference(item.model,item.input);
        const focused=cpu.stages[item.focusStage];
        if(focused?.op!==item.focusOp) throw new Error(item.id+': operation-stage mismatch');
        const stageBefore=cpu.stages[item.focusStage-1];
        let boundaryMagnitude=null;
        if(item.condition==='near-zero'){
          boundaryMagnitude=Math.max(...focused.values.map(Math.abs));
          if(boundaryMagnitude>2e-7) throw new Error(item.id+': dense output was not near zero');
        } else if(item.condition==='positive-zero-negative'){
          const values=stageBefore?.values ?? [];
          if(!(values[0]>0 && values[1]===0 && values[2]<0)) throw new Error(item.id+': ReLU input did not straddle zero');
          boundaryMagnitude=Math.max(...values.map(Math.abs));
          if(boundaryMagnitude>2e-7) throw new Error(item.id+': ReLU input was not near zero');
        } else if(item.condition==='near-zero-input'){
          const values=stageBefore?.values ?? [];
          boundaryMagnitude=Math.max(...values.map(Math.abs));
          if(boundaryMagnitude>2e-7) throw new Error(item.id+': activation input was not near zero');
          if(item.focusOp==='sigmoid' && Math.abs(focused.values[0]-0.5)>1e-7) throw new Error(item.id+': sigmoid output was not near 0.5');
          if(item.focusOp==='tanh' && Math.abs(focused.values[0])>2e-7) throw new Error(item.id+': tanh output was not near zero');
        } else if(item.condition==='near-equal-logits'){
          const logits=stageBefore?.values ?? [];
          boundaryMagnitude=Math.max(...logits)-Math.min(...logits);
          if(boundaryMagnitude>5e-7) throw new Error(item.id+': softmax logits were not near-equal');
          if(Math.max(...focused.values)-Math.min(...focused.values)>2e-7) throw new Error(item.id+': softmax outputs were not near-equal');
        }
        boundaryResults.push({id:item.id,condition:item.condition,boundaryMagnitude,parity:gpu.parity});
      }
      return {
        classificationOps:single.stages.map(stage=>stage.op),
        classificationParity:single.parity,
        batchRows:batch.predictions.length,
        batchParity:batch.parity,
        regressionOps:regressionResult.stages.map(stage=>stage.op),
        regressionParity:regressionResult.parity,
        boundaryResults,
      };
    })()`, true);
    assert.deepEqual(operationMatrix.classificationOps, ['dense', 'relu', 'dense', 'sigmoid', 'tanh', 'dense', 'softmax']);
    assert.deepEqual(operationMatrix.regressionOps, ['dense', 'sigmoid', 'tanh', 'dense']);
    assert.equal(operationMatrix.classificationParity.passed, true);
    assert.equal(operationMatrix.batchRows, 2);
    assert.equal(operationMatrix.batchParity.passed, true);
    assert.equal(operationMatrix.regressionParity.passed, true);
    assert.deepEqual(operationMatrix.boundaryResults.map((item) => item.id), [
      'dense-near-zero', 'relu-zero-crossing', 'sigmoid-zero-input', 'tanh-zero-input', 'softmax-near-equal-logits',
    ]);
    assert.ok(operationMatrix.boundaryResults.every((item) => item.parity.passed),
      'Every actual-GPU near-boundary case remains inside the existing fixed CPU parity gates.');
    result.steps.push({ id: 'real-hardware-operation-matrix-and-batch', status: 'PASS', operationMatrix });

    const project = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'examples', 'xor-mlp-concept.volkml.json'), 'utf8'));
    const trainer = project.graph.nodes.find((node) => node.data.manifest.op === 'supervised_trainer');
    assert.ok(trainer, 'The example provides a real connected browser MLP trainer.');
    trainer.data.parameters.epochs = 12;
    await evaluate(`(() => { if (document.querySelector('[data-build-toolbar]')) return true; const button=[...document.querySelectorAll('nav button')].find(item => /\\bBuild\\b|构建/i.test(item.innerText)); button?.click(); return Boolean(button); })()`);
    await waitFor('Boolean(document.querySelector("[data-build-toolbar]"))', 'the Build workspace');
    await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.loadProject(${JSON.stringify(project)}))`, true);
    await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.run())`, true);
    await waitFor('Boolean(document.querySelector("[data-build-primary=\\"run\\"]"))', 'the Build Runner action');
    await click('[data-build-primary="run"]');
    await waitFor('Boolean(document.querySelector("[data-webgpu-inference]"))', 'the explicit WebGPU prediction action');
    await evaluate(`(() => {
      const runner=document.querySelector('[data-webgpu-inference]')?.closest('section');
      const inputs=[...(runner?.querySelectorAll('input[type="number"]') ?? [])];
      if (inputs.length < 2) return false;
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      ['0.25','-0.4'].forEach((value,index)=>{setter.call(inputs[index],value);inputs[index].dispatchEvent(new Event('input',{bubbles:true}));inputs[index].dispatchEvent(new Event('change',{bubbles:true}));});
      return true;
    })()`);
    const before = await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.getProject())`, true);
    const beforeState = await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.getState())`, true);
    const beforeWeights = JSON.stringify(before.trainedModel?.layers?.map(layer => layer.weights ?? null));
    await click('[data-webgpu-inference]');
    await waitFor('Boolean(document.querySelector("[data-webgpu-result]"))', 'the typed WebGPU inference result');
    const ui = await evaluate(`(() => ({text:document.querySelector('[data-webgpu-result]')?.innerText ?? '', status:document.querySelector('[data-webgpu-result]')?.getAttribute('role')}))()`);
    assert.match(ui.text, /agrees with the CPU reference/i, 'The accepted GPU action is rendered as verified CPU parity.');
    const after = await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.getProject())`, true);
    const afterState = await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.getState())`, true);
    assert.equal(JSON.stringify(after.trainedModel?.layers?.map(layer => layer.weights ?? null)), beforeWeights,
      'WebGPU inference cannot mutate fitted weights in the project snapshot.');
    assert.equal(afterState.execution.runtime.execution.providerId, 'browser-cpu',
      'The local prediction does not replace the committed CPU fit execution record.');
    assert.deepEqual(afterState.execution.runtime.result, beforeState.execution.runtime.result,
      'The prediction does not mutate the committed fit result.');
    result.steps.push({ id: 'mounted-episode-explicit-webgpu-action-and-no-model-mutation', status: 'PASS', ui });
    result.status = 'PASS';
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  result.status = result.status === 'NOT VERIFIED' ? 'FAIL' : result.status;
  result.error = error?.stack ?? String(error);
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch { /* Closed by Chrome shutdown. */ }
  await stopProcess(chromeProcess);
  await stopProcess(viteProcess);
  cleanupProfile();
}
