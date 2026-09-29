import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fitFeatureNormalization, normalizeFeatures } from '../src/core/knnMath.js';
import {
  compareWithFixedEnvelope,
  initializeOracleParameters,
  oracleMlpMicroBatch,
} from './webgpu-mlp-float64-oracle.mjs';

const baseUrl = 'http://127.0.0.1:5177';
const chromeDebugUrl = 'http://127.0.0.1:9227/json/list';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'volk-webgpu-h1t-chrome-'));
const cleanupProfile = () => {
  const tempRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(profile);
  if (path.dirname(resolved) === tempRoot && path.basename(resolved).startsWith('volk-webgpu-h1t-chrome-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
};
let viteProcess = null;
let chromeProcess = null;
let socket = null;
const result = { task: 'VOLK-ML H1-T WebGPU MLP training acceptance', status: 'NOT VERIFIED', browser: null, steps: [] };

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

async function waitFor(expression, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(await evaluate('({url:location.href,text:document.body?.innerText?.slice(0,900)})'))}`);
}

async function waitForBrowserPromise(expression, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression, true)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(await evaluate('({url:location.href,text:document.body?.innerText?.slice(0,900)})'))}`);
}

async function click(selector) {
  const clicked = await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) return false; element.click(); return true; })()`);
  assert.equal(clicked, true, `The browser can click ${selector}.`);
}

async function installGpuProbe(mode) {
  const installed = await evaluate(`(() => {
    const mode=${JSON.stringify(mode)};
    const ownDescriptor=Object.getOwnPropertyDescriptor(navigator,'gpu');
    const realGpu=navigator.gpu;
    if(!realGpu) return {ok:false,reason:'navigator.gpu is unavailable'};
    let submits=0;
    let lostTriggered=false;
    let resolveLost;
    let releaseStaleResult;
    const lostPromise=new Promise(resolve=>{resolveLost=resolve;});
    const queueFor=(queue)=>new Proxy(queue,{get(target,key){
      const value=Reflect.get(target,key,target);
      if(key==='submit') return (...args)=>{
        submits+=1;
        const result=value.apply(target,args);
        if(mode==='deadline' && submits===1) window.__VOLK_ML_H1_DEADLINE_TEST__?.arm();
        if(mode==='device-loss' && !lostTriggered){
          lostTriggered=true;
          queueMicrotask(()=>resolveLost({reason:'unknown',message:'Scripted H1 adapter loss'}));
        }
        return result;
      };
      if(key==='onSubmittedWorkDone') return (...args)=>{
        const workDone=value.apply(target,args);
        if(mode==='stale' && submits===1){
          return Promise.resolve(workDone).then(()=>new Promise(resolve=>{releaseStaleResult=resolve;}));
        }
        return workDone;
      };
      return typeof value==='function'?value.bind(target):value;
    }});
    const deviceFor=(device)=>{
      const queue=queueFor(device.queue);
      return new Proxy(device,{get(target,key){
        if(key==='queue') return queue;
        if(key==='lost' && mode==='device-loss') return lostPromise;
        const value=Reflect.get(target,key,target);
        return typeof value==='function'?value.bind(target):value;
      }});
    };
    const wrappedGpu={requestAdapter:async(options)=>{
      const adapter=await realGpu.requestAdapter(options);
      if(!adapter) return null;
      return {
        get limits(){return adapter.limits;},
        requestDevice:async(...args)=>deviceFor(await adapter.requestDevice(...args)),
      };
    }};
    try { Object.defineProperty(navigator,'gpu',{configurable:true,value:wrappedGpu}); }
    catch(error) { return {ok:false,reason:String(error)}; }
    const probe=Object.freeze({
      get submits(){return submits;},
      releaseStaleResult(){
        if(!releaseStaleResult) return false;
        const release=releaseStaleResult;
        releaseStaleResult=null;
        release();
        return true;
      },
      restore(){
        if(ownDescriptor) Object.defineProperty(navigator,'gpu',ownDescriptor);
        else delete navigator.gpu;
        if(window.__VOLK_ML_H1_GPU_PROBE__===probe) delete window.__VOLK_ML_H1_GPU_PROBE__;
      },
    });
    window.__VOLK_ML_H1_GPU_PROBE__=probe;
    return {ok:true,mode};
  })()`);
  assert.equal(installed?.ok, true, `The isolated browser can install the ${mode} GPU test adapter: ${JSON.stringify(installed)}.`);
}

async function installDeadlineProbe() {
  const installed = await evaluate(`(() => {
    const originalSetTimeout=window.setTimeout;
    const originalClearTimeout=window.clearTimeout;
    const pending=new Map();
    let nextId=0;
    let armed=false;
    const schedule=(id,item)=>{
      item.timer=originalSetTimeout.call(window,()=>{
        pending.delete(id);
        item.callback(...item.args);
      },250);
    };
    const arm=()=>{
      if(armed) return;
      armed=true;
      for(const [id,item] of pending) schedule(id,item);
    };
    window.setTimeout=function(callback,delay,...args){
      if(delay===120000){
        const id=-(++nextId);
        const item={callback,args,timer:null};
        pending.set(id,item);
        if(armed) schedule(id,item);
        return id;
      }
      return originalSetTimeout.call(window,callback,delay,...args);
    };
    window.clearTimeout=function(id){
      const item=pending.get(id);
      if(item){pending.delete(id);if(item.timer!==null) originalClearTimeout.call(window,item.timer);return;}
      return originalClearTimeout.call(window,id);
    };
    const hook=Object.freeze({
      arm,
      restore(){
        for(const item of pending.values()) if(item.timer!==null) originalClearTimeout.call(window,item.timer);
        pending.clear();
        window.setTimeout=originalSetTimeout;
        window.clearTimeout=originalClearTimeout;
        if(window.__VOLK_ML_H1_DEADLINE_TEST__===hook) delete window.__VOLK_ML_H1_DEADLINE_TEST__;
      },
    });
    window.__VOLK_ML_H1_DEADLINE_TEST__=hook;
    return {ok:true};
  })()`);
  assert.equal(installed?.ok, true, 'The browser can defer the bounded H0 deadline until real GPU work has begun.');
}

async function restoreFailureProbes() {
  await evaluate(`(() => {
    window.__VOLK_ML_H1_DEADLINE_TEST__?.restore();
    window.__VOLK_ML_H1_GPU_PROBE__?.restore();
    return true;
  })()`);
}

async function recoverRunnerWithCpu(project, label) {
  await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.loadProject(${JSON.stringify(project)}))`, true);
  await waitForBrowserPromise(`document.querySelector('[data-runner-execute]')?.disabled===false && window.__VOLK_ML_AGENT__.open().then(api=>api.getState()).then(state=>state.execution.runtime.status==='idle')`, `${label} CPU recovery controls`, 30_000);
  await click('[data-runner-execute]');
  await waitForBrowserPromise(`window.__VOLK_ML_AGENT__.open().then(api=>api.getState()).then(state=>state.execution.runtime.status==='succeeded' && state.execution.runtime.execution?.providerId==='browser-cpu')`, `${label} CPU recovery run`, 60_000);
  const recovered = await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.getProject())`, true);
  const recoveredState = await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.getState())`, true);
  assert.equal(recovered.trainedModel?.type, 'browser_mlp', `${label} leaves the CPU Run path usable after the WebGPU failure. state=${JSON.stringify(recoveredState.execution.runtime)} model=${JSON.stringify(recovered.trainedModel)}`);
  return recovered;
}

async function exerciseMountedFailure({ project, recoveryProject, label, mode, expectedStatus, expectedDiagnostic }) {
  await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.loadProject(${JSON.stringify(project)}))`, true);
  await waitForBrowserPromise(`document.querySelector('[data-webgpu-fit]')?.disabled===false && window.__VOLK_ML_AGENT__.open().then(api=>api.getState()).then(state=>state.execution.runtime.status==='idle')`, `${label} clean Runner fixture`, 30_000);
  const before = await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.getProject())`, true);
  assert.equal(before.trainedModel?.type, 'browser_mlp', `${label} begins with a committed model to protect from partial output.`);
  const beforeWeights = JSON.stringify(before.trainedModel.layers.map((layer) => ({ weights: layer.weights ?? null, bias: layer.bias ?? null })));
  if (mode === 'deadline') await installDeadlineProbe();
  await installGpuProbe(mode);
  let submitsAtIdentityChange = null;
  try {
    await click('[data-webgpu-fit]');
    await waitForBrowserPromise(`window.__VOLK_ML_AGENT__.open().then(api=>api.getState()).then(state=>state.execution.runtime.status==='running')`, `${label} active Runner fit`, 30_000);
    if (mode === 'stale') {
      await waitFor('window.__VOLK_ML_H1_GPU_PROBE__?.submits>0', `${label} actual GPU work before identity changes`, 30_000);
      submitsAtIdentityChange = await evaluate('window.__VOLK_ML_H1_GPU_PROBE__?.submits');
      assert.equal(submitsAtIdentityChange, 1,
        `${label} holds the first actual GPU completion so identity changes before the fit result can finish.`);
      assert.equal(await evaluate('window.__VOLK_ML_H1_TRAINING_TEST__?.invalidateProjectIdentityDuringRun()'), true,
        `${label} changes only the in-flight project-session identity through the development-only acceptance bridge.`);
      assert.equal(await evaluate('window.__VOLK_ML_H1_GPU_PROBE__?.releaseStaleResult()'), true,
        `${label} resumes the real GPU fit after the session identity has changed.`);
    }
    if (mode === 'deadline') {
      await waitFor('window.__VOLK_ML_H1_GPU_PROBE__?.submits>0', `${label} actual GPU work before the deadline is armed`, 30_000);
    }
    await waitForBrowserPromise(`window.__VOLK_ML_AGENT__.open().then(api=>api.getState()).then(state=>state.execution.runtime.status==='failed' && state.execution.runtime.execution?.status===${JSON.stringify(expectedStatus)} && state.execution.runtime.execution?.diagnostics?.includes(${JSON.stringify(expectedDiagnostic)}))`, `${label} expected failure envelope`, 45_000);
    await waitFor(`document.querySelector('[data-webgpu-fit]')?.disabled===false && document.querySelector('[data-runner-execute]')?.disabled===false && !document.querySelector('[data-runner-cancel]')`, `${label} cleared Runner busy and cancel state`);
    await waitFor('Boolean(document.querySelector("[data-webgpu-fit-result]"))', `${label} localized Runner failure result`);
    const state = await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.getState())`, true);
    assert.deepEqual(state.execution.runtime.activeNodeIds, [], `${label} clears active execution nodes after failure.`);
    const after = await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.getProject())`, true);
    if (mode === 'stale') {
      assert.equal(after.trainedModel, null, `${label} rejects the stale fit instead of committing it to the changed project identity.`);
    } else {
      assert.equal(JSON.stringify(after.trainedModel?.layers?.map((layer) => ({ weights: layer.weights ?? null, bias: layer.bias ?? null }))), beforeWeights,
        `${label} preserves the prior committed model without partial GPU parameters.`);
    }
    result.steps.push({ id: `${mode}-fit-clears-runner-and-rejects-partial-output`, status: 'PASS', executionStatus: expectedStatus, diagnostic: expectedDiagnostic, gpuSubmits: await evaluate('window.__VOLK_ML_H1_GPU_PROBE__?.submits ?? 0'), ...(submitsAtIdentityChange === null ? {} : { gpuSubmitsWhenIdentityChanged: submitsAtIdentityChange }) });
  } finally {
    await restoreFailureProbes();
  }
  const recovered = await recoverRunnerWithCpu(recoveryProject, `${label} recovery`);
  result.steps.push({ id: `${mode}-failure-followed-by-cpu-run`, status: 'PASS', provider: 'browser-cpu', modelType: recovered.trainedModel.type });
}

function normalizeRows(rows, featureCount) {
  const normalization = fitFeatureNormalization(rows, featureCount);
  return rows.map((sample) => ({ ...sample, x: normalizeFeatures(sample.x, normalization) }));
}

function maxAbsoluteError(actual, expected) {
  assert.equal(actual.length, expected.length);
  return actual.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - expected[index])), 0);
}

function verifyOracleCase({ gpuResult, architecture, rows, task, labels, optimizer, learningRate, momentum = 0, name, exactReluZero = false }) {
  const normalized = normalizeRows(rows, architecture.inputSize);
  let parameters = initializeOracleParameters(architecture).parameters;
  let state = null;
  const diagnostics = gpuResult.diagnostics;
  const initialParameters = initializeOracleParameters(architecture).parameters;
  assert.ok(diagnostics.length >= 2, `${name} exercised multiple actual-GPU optimizer steps.`);
  const maxima = { forward: 0, loss: 0, meanGradient: 0, updatedParameter: 0 };
  for (const diagnostic of diagnostics) {
    const samples = diagnostic.sampleIndices.map((index) => normalized[index]);
    if (exactReluZero && diagnostic.step === 1) {
      assert.deepEqual(diagnostic.sampleIndices, [0], `${name} begins with its exact-zero hidden activation fixture.`);
      assert.equal(samples[0].x[0], 0, `${name} normalized the selected ReLU input to exact zero.`);
      assert.deepEqual(diagnostic.meanGradients.slice(0, 4), [0, 0, 0, 0],
        `${name} uses the exact-zero ReLU derivative policy for every first-layer weight and bias gradient.`);
    }
    const expected = oracleMlpMicroBatch({
      architecture,
      parameters,
      samples,
      task,
      labels,
      optimizer,
      learningRate,
      momentum,
      state,
    });
    state = expected.state;
    const forwardActual = diagnostic.outputs.flat();
    const forwardExpected = expected.outputs.flat();
    maxima.forward = Math.max(maxima.forward, maxAbsoluteError(forwardActual, forwardExpected));
    maxima.loss = Math.max(maxima.loss, maxAbsoluteError(diagnostic.sampleLosses, expected.sampleLosses));
    maxima.meanGradient = Math.max(maxima.meanGradient, maxAbsoluteError(diagnostic.meanGradients, expected.meanGradients));
    maxima.updatedParameter = Math.max(maxima.updatedParameter, maxAbsoluteError(diagnostic.updatedParameters, expected.updatedParameters));
    assert.equal(compareWithFixedEnvelope(forwardActual, forwardExpected), true,
      `${name} microbatch ${diagnostic.step} forward values match the fixed Float64 oracle envelope. actual=${JSON.stringify(forwardActual)} expected=${JSON.stringify(forwardExpected)} inputRows=${JSON.stringify(samples)} indices=${JSON.stringify(diagnostic.sampleIndices)} initial=${JSON.stringify(diagnostic.initialParameters)} gpuControl=${JSON.stringify(diagnostic.controlValues)} loss=${JSON.stringify(diagnostic.sampleLosses)} gradient=${JSON.stringify(diagnostic.meanGradients)} updated=${JSON.stringify(diagnostic.updatedParameters)}`);
    assert.equal(compareWithFixedEnvelope(diagnostic.sampleLosses, expected.sampleLosses), true,
      `${name} microbatch ${diagnostic.step} losses match the fixed Float64 oracle envelope.`);
    assert.equal(compareWithFixedEnvelope(diagnostic.meanGradients, expected.meanGradients), true,
      `${name} microbatch ${diagnostic.step} mean gradients match the fixed Float64 oracle envelope.`);
    assert.equal(compareWithFixedEnvelope(diagnostic.updatedParameters, expected.updatedParameters), true,
      `${name} microbatch ${diagnostic.step} optimizer updates match the fixed Float64 oracle envelope.`);
    assert.equal(compareWithFixedEnvelope(diagnostic.initialParameters, initialParameters), true,
      `${name} seeded initialization matches the independent Float64 oracle.`);
    parameters = expected.updatedParameters;
  }
  assert.equal(state.steps, diagnostics.length, `${name} oracle advanced optimizer state for every actual GPU update.`);
  return { microBatches: diagnostics.length, lastStep: diagnostics.at(-1).step, maximumAbsoluteErrors: maxima };
}

const rowsForRegression = [
  { index: 0, x: [-2], y: -1.2 }, { index: 1, x: [-1], y: -0.3 },
  { index: 2, x: [1], y: 0.8 }, { index: 3, x: [2], y: 1.7 },
];
const rowsForClassification = [
  { index: 0, x: [-2], y: 'left' }, { index: 1, x: [-1], y: 'left' },
  { index: 2, x: [1], y: 'right' }, { index: 3, x: [2], y: 'right' },
];
const oracleCases = [
  {
    name: 'regression-tanh-sgd-momentum', task: 'regression', rows: rowsForRegression, labels: [],
    loss: 'mse_loss', optimizer: 'sgd_optimizer', learningRate: 0.025, momentum: 0.35, batchSize: 2,
    architecture: { inputSize: 1, modelNodeId: 'reg-tanh-output', layers: [
      { op: 'dense', input_features: 1, units: 2, use_bias: true }, { op: 'tanh' },
      { op: 'dense', input_features: 2, units: 1, use_bias: true },
    ] },
  },
  {
    name: 'regression-relu-exact-zero-adam', task: 'regression', rows: [
      { index: 0, x: [0], y: 0.5 }, { index: 1, x: [-1], y: -0.7 }, { index: 2, x: [1], y: 0.8 },
    ], labels: [], loss: 'mse_loss', optimizer: 'adam_optimizer', learningRate: 0.02, momentum: 0, batchSize: 1,
    exactReluZero: true,
    architecture: { inputSize: 1, modelNodeId: 'reg-relu-output', layers: [
      { op: 'dense', input_features: 1, units: 2, use_bias: true }, { op: 'relu' },
      { op: 'dense', input_features: 2, units: 1, use_bias: true },
    ] },
  },
  {
    name: 'regression-sigmoid-sgd-no-momentum', task: 'regression', rows: rowsForRegression, labels: [],
    loss: 'mse_loss', optimizer: 'sgd_optimizer', learningRate: 0.02, momentum: 0, batchSize: 2,
    architecture: { inputSize: 1, modelNodeId: 'reg-sigmoid-output', layers: [
      { op: 'dense', input_features: 1, units: 2, use_bias: true }, { op: 'sigmoid' },
      { op: 'dense', input_features: 2, units: 1, use_bias: true },
    ] },
  },
  {
    name: 'regression-hidden-softmax-adam', task: 'regression', rows: rowsForRegression, labels: [],
    loss: 'mse_loss', optimizer: 'adam_optimizer', learningRate: 0.01, momentum: 0, batchSize: 2,
    architecture: { inputSize: 1, modelNodeId: 'reg-softmax-output', layers: [
      { op: 'dense', input_features: 1, units: 2, use_bias: true }, { op: 'softmax' },
      { op: 'dense', input_features: 2, units: 2, use_bias: true },
      { op: 'tanh' }, { op: 'dense', input_features: 2, units: 1, use_bias: true },
    ] },
  },
  {
    name: 'classification-full-activation-adam', task: 'classification', rows: rowsForClassification, labels: ['left', 'right'],
    loss: 'cross_entropy_loss', optimizer: 'adam_optimizer', learningRate: 0.02, momentum: 0, batchSize: 2,
    architecture: { inputSize: 1, modelNodeId: 'class-activation-output', layers: [
      { op: 'dense', input_features: 1, units: 3, use_bias: true }, { op: 'relu' },
      { op: 'dense', input_features: 3, units: 2, use_bias: true }, { op: 'sigmoid' },
      { op: 'tanh' }, { op: 'dense', input_features: 2, units: 2, use_bias: true }, { op: 'softmax' },
    ] },
  },
  {
    name: 'classification-softmax-sgd-no-momentum', task: 'classification', rows: rowsForClassification, labels: ['left', 'right'],
    loss: 'cross_entropy_loss', optimizer: 'sgd_optimizer', learningRate: 0.02, momentum: 0, batchSize: 2,
    architecture: { inputSize: 1, modelNodeId: 'class-sgd-output', layers: [
      { op: 'dense', input_features: 1, units: 2, use_bias: true }, { op: 'softmax' },
    ] },
  },
  {
    name: 'classification-softmax-sgd-momentum', task: 'classification', rows: rowsForClassification, labels: ['left', 'right'],
    loss: 'cross_entropy_loss', optimizer: 'sgd_optimizer', learningRate: 0.02, momentum: 0.6, batchSize: 2,
    architecture: { inputSize: 1, modelNodeId: 'class-sgd-momentum-output', layers: [
      { op: 'dense', input_features: 1, units: 2, use_bias: true }, { op: 'softmax' },
    ] },
  },
];

async function runThroughRunner(project, label) {
  const trainer = project.graph.nodes.find((node) => node.data.manifest.op === 'supervised_trainer');
  assert.ok(trainer, `${label} has a connected Supervised Trainer.`);
  trainer.data.parameters.epochs = 24;
  trainer.data.parameters.batch_size = Math.min(16, trainer.data.parameters.batch_size);

  await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.loadProject(${JSON.stringify(project)}))`, true);
  await waitFor('Boolean(document.querySelector("[data-runner-execute]"))', `${label} Runner surface`);
  await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.run({providerId:'browser-webgpu-mlp-training'}))`, true);
  await waitFor(`window.__VOLK_ML_AGENT__.open().then(api=>api.getState()).then(state=>state.execution.runtime.status==='succeeded' && state.execution.runtime.execution?.providerId==='browser-cpu')`, `${label} Agent/LUMI run remains CPU-only`, 60_000);
  const agentCpuProject = await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.getProject())`, true);
  assert.ok(agentCpuProject.trainedModel?.type === 'browser_mlp', `${label} retains a normal CPU-trained model after an Agent request carrying an unsupported GPU preference.`);
  const agentCpuWeights = JSON.stringify(agentCpuProject.trainedModel.layers.map((layer) => ({ weights: layer.weights ?? null, bias: layer.bias ?? null })));
  const cpuProject = agentCpuProject;
  const cpuWeights = JSON.stringify(cpuProject.trainedModel?.layers?.map((layer) => ({ weights: layer.weights ?? null, bias: layer.bias ?? null })));
  assert.equal(cpuWeights, agentCpuWeights, `${label} begins from the model committed by the Agent API's default CPU-only path.`);

  const action = await evaluate(`(async()=>{
    const api=await window.__VOLK_ML_AGENT__.open();
    const state=await api.getState();
    const project=await api.getProject();
    const {analyzeBrowserExecutionGraph}=await import('/src/core/browserExecutionContract.js');
    const contract=analyzeBrowserExecutionGraph({nodes:project.graph.nodes,edges:project.graph.edges,dataset:project.data});
    return {
      present:Boolean(document.querySelector('[data-webgpu-fit]')),
      disabled:document.querySelector('[data-webgpu-fit]')?.disabled,
      label:document.querySelector('[data-webgpu-fit]')?.innerText ?? '',
      cpuAction:Boolean(document.querySelector('[data-runner-execute]')),
      runtimeStatus:state.execution.runtime.status,
      runtimeProvider:state.execution.runtime.execution?.providerId ?? null,
      dataset:Boolean(project.data),
      graphValid:contract.valid,
      graphReason:contract.reason ?? null,
      rootOperation:contract.root?.data?.manifest?.op ?? null,
      webgpu:typeof navigator!=='undefined' && Boolean(navigator.gpu)
    };
  })()` , true);
  assert.equal(action.present, true, `${label} exposes the separate WebGPU fit action.`);
  assert.equal(action.disabled, false, `${label} enables the learner-approved WebGPU fit action: ${JSON.stringify(action)}.`);
  assert.equal(action.cpuAction, true, `${label} retains the distinct CPU Run action.`);

  await click('[data-webgpu-fit]');
  await waitFor('document.querySelector("[data-webgpu-fit]")?.disabled === true', `${label} duplicate-fit protection`);
  await waitFor(`window.__VOLK_ML_AGENT__.open().then(api=>api.getState()).then(state=>state.execution.runtime.status==='succeeded' && state.execution.runtime.execution?.providerId==='browser-webgpu-mlp-training' && Boolean(state.execution.runtime.execution?.output?.trainingSummary))`, `${label} accepted WebGPU fit`, 120_000);
  await waitFor('Boolean(document.querySelector("[data-webgpu-fit-result]"))', `${label} visible fit result`);
  const state = await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.getState())`, true);
  const gpuProject = await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.getProject())`, true);
  const execution = state.execution.runtime.execution;
  const summary = execution.output?.trainingSummary;
  assert.equal(execution.provenance, 'live-webgpu', `${label} records actual WebGPU provenance.`);
  assert.equal(typeof summary?.dispatchCount, 'number', `${label} includes GPU dispatch evidence.`);
  assert.ok(summary.dispatchCount > 0, `${label} dispatched actual GPU compute work.`);
  assert.equal(summary.providerVersion, 'browser-webgpu-mlp-training-wgsl-v1');
  assert.ok(summary.finalTrainingLoss < summary.initialLoss, `${label} reduced training loss.`);
  assert.equal(Object.hasOwn(gpuProject.trainedModel ?? {}, 'trainingSummary'), false,
    `${label} keeps provider diagnostics out of the persisted model.`);
  const cpuSnapshotCheck = await evaluate(`(async()=>{
    const project=await window.__VOLK_ML_AGENT__.open().then(api=>api.getProject());
    const {predictWithModel}=await import('/src/core/browserRuntime.js');
    const model=structuredClone(project.trainedModel);
    const row=project.data.rows[0];
    const features=model.featureColumns.map((column)=>Number(row[column]));
    return {
      task:model.task,prediction:predictWithModel(model,features),labels:model.labels,
      metrics:model.metrics,trainRows:model.trainRows,testRows:model.testRows,dataRows:project.data.rows.length,
      modelHasTest:Object.hasOwn(model,'test')
    };
  })()`, true);
  assert.ok(cpuSnapshotCheck.trainRows > 0 && cpuSnapshotCheck.testRows > 0 && cpuSnapshotCheck.trainRows + cpuSnapshotCheck.testRows <= cpuSnapshotCheck.dataRows,
    `${label} preserves distinct bounded train/test accounting.`);
  assert.equal(cpuSnapshotCheck.modelHasTest, false, `${label} does not duplicate held-out source rows in the persisted model.`);
  assert.ok(cpuSnapshotCheck.metrics && Object.values(cpuSnapshotCheck.metrics).every(Number.isFinite),
    `${label} has finite held-out metrics from the existing Browser inference/evaluation path.`);
  if (label === 'classification') assert.ok(cpuSnapshotCheck.labels.includes(cpuSnapshotCheck.prediction), 'The committed classification snapshot returns a registered class.');
  else assert.ok(Number.isFinite(cpuSnapshotCheck.prediction), 'The committed regression snapshot returns a finite numeric prediction.');
  assert.notEqual(JSON.stringify(gpuProject.trainedModel?.layers?.map((layer) => ({ weights: layer.weights ?? null, bias: layer.bias ?? null }))), cpuWeights,
    `${label} committed only after the explicit GPU fit action and produced updated parameters.`);
  const visible = await evaluate(`document.querySelector('[data-webgpu-fit-result]')?.innerText ?? ''`);
  assert.match(visible, /WebGPU training completed|WebGPU 训练完成/i, `${label} renders the accepted GPU fit result.`);
  return {
    task: label,
    epochs: gpuProject.trainedModel.epochs,
    initialLoss: summary.initialLoss,
    finalTrainingLoss: summary.finalTrainingLoss,
    optimizerSteps: summary.optimizerSteps,
    dispatchCount: summary.dispatchCount,
    cpuSnapshotCheck,
    cpuProvider: 'browser-cpu',
    fitProvider: execution.providerId,
  };
}

try {
  const executable = chromePath();
  assert.ok(executable, 'Set WEBGPU_CHROME to a Chrome/Edge executable when it is not at a standard Windows path.');
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5177', '--strictPort'], {
    cwd: process.cwd(), env: process.env, stdio: 'ignore',
  });
  await waitForHttp(`${baseUrl}/`);
  chromeProcess = spawn(executable, [
    '--headless=new', '--remote-debugging-port=9227', '--window-size=1440,1000', '--enable-unsafe-webgpu',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  await waitForHttp(chromeDebugUrl);
  const pages = await (await fetch(chromeDebugUrl)).json();
  const page = pages.find((item) => item.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'A mounted Chrome DevTools page is available.');
  socket = new CdpClient(page.webSocketDebuggerUrl);
  await socket.send('Page.enable');
  await socket.send('Runtime.enable');
  await socket.send('Log.enable');
  await socket.send('Page.navigate', { url: `${baseUrl}/?h1TrainingTest=1` });
  await waitFor('Boolean(window.__VOLK_ML_AGENT__)', 'the mounted VOLK-ML application');
  await waitFor('Boolean(window.__VOLK_ML_H1_TRAINING_TEST__?.invalidateProjectIdentityDuringRun)', 'the development-only H1 stale-identity acceptance bridge');

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
  result.browser = adapter;
  if (!adapter.available) {
    result.status = 'SKIPPED_NO_PHYSICAL_WEBGPU';
    result.reason = adapter.reason;
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 2;
  } else {
    const uniformProbe = await evaluate(`(async()=>{
      const adapter=await navigator.gpu.requestAdapter({forceFallbackAdapter:false});
      const device=await adapter.requestDevice();
      const uniformData=new ArrayBuffer(32);const view=new DataView(uniformData);
      [2,3,1,4].forEach((value,index)=>view.setUint32(index*4,value,true));
      const uniform=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      const output=device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
      const readback=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      device.queue.writeBuffer(uniform,0,uniformData);
      const module=device.createShaderModule({code:
        'struct Control{a:u32,b:u32,c:u32,d:u32};@group(0)@binding(0)var<uniform>control:Control;@group(0)@binding(1)var<storage,read_write>output:array<u32>;@compute@workgroup_size(1)fn main(){output[0]=control.a;output[1]=control.b;output[2]=control.c;output[3]=control.d;}'
      });
      const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
      const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:{buffer:output}}]});
      const encoder=device.createCommandEncoder();const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();encoder.copyBufferToBuffer(output,0,readback,0,16);device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();await readback.mapAsync(GPUMapMode.READ);
      const values=Array.from(new Uint32Array(readback.getMappedRange()));readback.unmap();uniform.destroy();output.destroy();readback.destroy();device.destroy();
      return values;
    })()`, true);
    assert.deepEqual(uniformProbe, [2, 3, 1, 4], 'The real GPU reads the bounded H1-T control uniform layout.');
    result.steps.push({ id: 'real-gpu-training-control-uniform-layout', status: 'PASS', values: uniformProbe });
    const gpuOracleCases = await evaluate(`(async()=>{
      const {trainBrowserWebGpuMlp}=await import('/src/core/execution/browserWebGpuMlpTraining.js');
      const specifications=${JSON.stringify(oracleCases)};
      const results=[];
      for(const spec of specifications){
        const diagnostics=[];
        const model=await trainBrowserWebGpuMlp({
          architecture:spec.architecture,
          split:{dataset:{task:spec.task,featureColumns:['x'],targetColumn:'y'},train:spec.rows,test:[]},
          loss:{op:spec.loss},optimizer:{op:spec.optimizer,learning_rate:spec.learningRate,momentum:spec.momentum},
          trainer:{id:'oracle-trainer',epochs:2,batch_size:spec.batchSize,shuffle:false},
          onMicroBatch:(item)=>diagnostics.push(item),gpu:navigator.gpu
        });
        results.push({...spec,result:{diagnostics,summary:model.trainingSummary}});
      }
      return results;
    })()`, true);
    const oracleReports = gpuOracleCases.map((testCase) => ({
      name: testCase.name,
      ...verifyOracleCase({ ...testCase, gpuResult: testCase.result, name: testCase.name }),
    }));
    result.steps.push({ id: 'actual-gpu-microbatch-float64-oracle', status: 'PASS', fixedEnvelope: '1e-5 + 5e-4 * abs(reference)', cases: oracleReports });

    const classificationProject = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'examples', 'xor-mlp-concept.volkml.json'), 'utf8'));
    const regressionProject = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'examples', 'energy-demand-mlp.volkml.json'), 'utf8'));
    await evaluate(`(() => { if (document.querySelector('[data-build-toolbar]')) return true; const button=[...document.querySelectorAll('nav button')].find(item => /\\bBuild\\b|构建/i.test(item.innerText)); button?.click(); return Boolean(button); })()`);
    await waitFor('Boolean(document.querySelector("[data-build-toolbar]"))', 'the Build workspace');
    await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.loadProject(${JSON.stringify(classificationProject)}))`, true);
    await evaluate(`(() => { const button=document.querySelector('[data-build-primary="run"]'); if(!button) return false; button.click(); return true; })()`);
    await waitFor('Boolean(document.querySelector("[data-runner-execute]"))', 'the Runner fit controls');

    result.steps.push({ id: 'explicit-runner-classification-fit', status: 'PASS', ...(await runThroughRunner(classificationProject, 'classification')) });
    result.steps.push({ id: 'explicit-runner-regression-fit', status: 'PASS', ...(await runThroughRunner(regressionProject, 'regression')) });

    const priorFittedProject = await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.getProject())`, true);
    assert.equal(priorFittedProject.trainedModel?.type, 'browser_mlp', 'The regression exercise left a committed model for cancellation preservation.');
    const cancellationProject = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'examples', 'energy-demand-mlp.volkml.json'), 'utf8'));
    cancellationProject.trainedModel = priorFittedProject.trainedModel;
    const cancellationTrainer = cancellationProject.graph.nodes.find((node) => node.data.manifest.op === 'supervised_trainer');
    cancellationTrainer.data.parameters.epochs = 500;
    cancellationTrainer.data.parameters.batch_size = 32;
    await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.loadProject(${JSON.stringify(cancellationProject)}))`, true);
    await waitFor('Boolean(document.querySelector("[data-runner-execute]"))', 'the Runner cancellation fixture');
    const cancellationProjectState = await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.getState())`, true);
    assert.equal(cancellationProjectState.execution.runtime.status, 'idle', 'The cancellation project starts from its own clean execution state.');
    const beforeCancellation = await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.getProject())`, true);
    assert.equal(beforeCancellation.trainedModel?.type, 'browser_mlp', 'Cancellation begins with a previously committed model to preserve.');
    const cancellationBaseline = JSON.stringify(beforeCancellation.trainedModel?.layers?.map((layer) => ({ weights: layer.weights ?? null, bias: layer.bias ?? null })));
    await waitFor(`document.querySelector('[data-webgpu-fit]')?.disabled === false && window.__VOLK_ML_AGENT__.open().then(api=>api.getState()).then(state=>state.execution.runtime.status==='idle')`, 'available WebGPU cancellation action', 30_000);
    await click('[data-webgpu-fit]');
    await waitFor(`window.__VOLK_ML_AGENT__.open().then(api=>api.getState()).then(state=>state.execution.runtime.status==='running')`, 'active cancellable GPU training');
    await waitFor('Boolean(document.querySelector("[data-runner-cancel]"))', 'the explicit cancellation action');
    await click('[data-runner-cancel]');
    await waitFor(`window.__VOLK_ML_AGENT__.open().then(api=>api.getState()).then(state=>state.execution.runtime.status==='failed' && state.execution.runtime.execution?.status==='cancelled')`, 'cancelled GPU result without partial commit', 30_000);
    const afterCancellation = await evaluate(`window.__VOLK_ML_AGENT__.open().then(api=>api.getProject())`, true);
    assert.equal(JSON.stringify(afterCancellation.trainedModel?.layers?.map((layer) => ({ weights: layer.weights ?? null, bias: layer.bias ?? null }))), cancellationBaseline,
      'A cancelled WebGPU fit preserves the previously committed CPU model without partial GPU updates.');
    result.steps.push({ id: 'cancelled-fit-keeps-previous-model', status: 'PASS', provider: 'browser-webgpu-mlp-training', executionStatus: 'cancelled' });

    const cpuRecoveryProject = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'examples', 'energy-demand-mlp.volkml.json'), 'utf8'));
    const recoveryTrainer = cpuRecoveryProject.graph.nodes.find((node) => node.data.manifest.op === 'supervised_trainer');
    recoveryTrainer.data.parameters.epochs = 24;
    recoveryTrainer.data.parameters.batch_size = Math.min(16, recoveryTrainer.data.parameters.batch_size);
    const deadlineProject = structuredClone(cancellationProject);
    await exerciseMountedFailure({
      project: deadlineProject,
      recoveryProject: cpuRecoveryProject,
      label: 'explicit H0 deadline expiry',
      mode: 'deadline',
      expectedStatus: 'timed-out',
      expectedDiagnostic: 'EXECUTION_TIMEOUT',
    });
    const deviceLossProject = structuredClone(cancellationProject);
    await exerciseMountedFailure({
      project: deviceLossProject,
      recoveryProject: cpuRecoveryProject,
      label: 'local WebGPU device loss',
      mode: 'device-loss',
      expectedStatus: 'failed',
      expectedDiagnostic: 'WEBGPU_DEVICE_LOST',
    });
    const staleIdentityProject = structuredClone(cancellationProject);
    await exerciseMountedFailure({
      project: staleIdentityProject,
      recoveryProject: cpuRecoveryProject,
      label: 'stale project-session identity',
      mode: 'stale',
      expectedStatus: 'stale',
      expectedDiagnostic: 'RESULT_IDENTITY_STALE',
    });
    result.status = 'PASS';
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  result.status = 'FAIL';
  result.error = error?.stack ?? String(error);
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch { /* Closed by Chrome shutdown. */ }
  await stopProcess(chromeProcess);
  await stopProcess(viteProcess);
  cleanupProfile();
}
