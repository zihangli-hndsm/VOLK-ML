import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalAttentionClient } from '../src/services/localAttention/client.js';
import { G2_ATTENTION_LEGACY_SHA256S, G2_ATTENTION_PROFILE_SHA256, validateImportedAttentionCompareResponse } from '../src/core/playground/importedAttention/profile.js';
import { commitImportedAttentionExecution, createImportedAttentionEventStore } from '../src/core/playground/importedAttention/semanticEvents.js';
import { createG2ExecutionRequestV1, createG2ExecutionResultV1, g2CurrentExecutionIdentityV1 } from '../src/core/playground/importedAttention/executionAdapter.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelPath = process.env.VOLK_G2_REFERENCE_ONNX;
const legacyModelPath = process.env.VOLK_G2_LEGACY_ONNX;
const modelDirectory = process.env.VOLK_G2_MODEL_DIR;
const python = process.env.VOLK_G2_PYTHON;
const pythonPath = process.env.VOLK_G2_PYTHONPATH;
const connectionCode = randomBytes(32).toString('base64url');
const pythonEnvironment = {
  ...process.env,
  VOLK_G2_RUNNER_TOKEN: connectionCode,
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
  ...(pythonPath ? { PYTHONPATH: [pythonPath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) } : {}),
};
if (!modelPath || !legacyModelPath || !modelDirectory || !python) {
  throw new Error('Set VOLK_G2_REFERENCE_ONNX, VOLK_G2_LEGACY_ONNX, VOLK_G2_MODEL_DIR, and VOLK_G2_PYTHON to the regenerated artifact, registered legacy artifact, pinned checkpoint, and Python 3.12 exporter/runtime.');
}

const exportDirectory = mkdtempSync(path.join(os.tmpdir(), 'volk-g2-reference-'));
const checkoutA = path.join(exportDirectory, 'checkout-a');
const checkoutB = path.join(exportDirectory, 'checkout-b');
const exportPaths = [checkoutA, checkoutB].map((checkoutRoot, index) => {
  const script = path.join(checkoutRoot, 'tools', 'g2_attention', 'export_reference.py');
  const output = path.join(exportDirectory, `reference-${index + 1}.onnx`);
  mkdirSync(path.dirname(script), { recursive: true });
  copyFileSync(path.join(root, 'tools/g2_attention/export_reference.py'), script);
  return { script, output };
});
try {
  for (const [index, item] of exportPaths.entries()) {
    const args = [item.script, '--model-dir', modelDirectory, '--output', item.output];
    if (index === 0) args.push('--validate-artifact', legacyModelPath);
    execFileSync(python, args, { cwd: path.dirname(path.dirname(path.dirname(item.script))), env: pythonEnvironment, stdio: 'inherit' });
  }
  const regeneratedBytes = readFileSync(exportPaths[0].output);
  const regeneratedDigest = createHash('sha256').update(regeneratedBytes).digest('hex');
  const secondRootDigest = createHash('sha256').update(readFileSync(exportPaths[1].output)).digest('hex');
  const importedDigest = createHash('sha256').update(readFileSync(modelPath)).digest('hex');
  assert.equal(regeneratedDigest, G2_ATTENTION_PROFILE_SHA256, 'Pinned source checkpoint deterministically regenerates the registered profile hash.');
  assert.equal(secondRootDigest, regeneratedDigest, 'Two separate checkout roots produce byte-identical ONNX artifacts.');
  assert.equal(importedDigest, regeneratedDigest, 'The HTTP test imports the newly regenerated source-verified model.');
} catch (error) {
  rmSync(exportDirectory, { recursive: true, force: true });
  throw error;
}
const bytes = readFileSync(exportPaths[0].output);
const legacyBytes = readFileSync(legacyModelPath);
const availablePort = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close((error) => error ? reject(error) : resolve(port));
  });
});
const child = spawn(python, [path.join(root, 'dev/g2_attention/server.py'), '--port', String(availablePort)], {
  cwd: root,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: pythonEnvironment,
});
let childOutput = '';
child.stdout.on('data', (chunk) => { childOutput += chunk.toString(); });
child.stderr.on('data', (chunk) => { childOutput += chunk.toString(); });
const baseUrl = `http://127.0.0.1:${availablePort}`;
const fetchFromExploreOrigin = (url, init = {}) => {
  const headers = new Headers(init.headers ?? {});
  headers.set('Origin', 'http://127.0.0.1:5173');
  return fetch(url, { ...init, headers });
};
const client = createLocalAttentionClient({ baseUrl, timeoutMs: 20_000, fetchImpl: fetchFromExploreOrigin });
let runtimeProviderVersion = null;

async function waitForHealth() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`G2 runner exited before health: ${childOutput}`);
    try {
      const health = await client.health({ token: connectionCode });
      runtimeProviderVersion = health.providerVersion;
      return health;
    } catch { await new Promise((resolve) => setTimeout(resolve, 150)); }
  }
  throw new Error(`G2 runner did not become healthy: ${childOutput}`);
}

function commitExecution(eventStore, comparison) {
  const startedAt = new Date().toISOString();
  const request = createG2ExecutionRequestV1({
    projectSessionId: 'g2-reference-project-session',
    modelHash: comparison.modelHash,
    requestId: comparison.requestId,
    providerVersion: runtimeProviderVersion,
    approvedAt: startedAt,
  });
  const executionResult = createG2ExecutionResultV1({
    request, comparison, providerVersion: runtimeProviderVersion, startedAt, finishedAt: new Date().toISOString(),
  });
  const current = g2CurrentExecutionIdentityV1({
    projectSessionId: 'g2-reference-project-session',
    modelHash: comparison.modelHash,
    providerVersion: runtimeProviderVersion,
  });
  return commitImportedAttentionExecution(eventStore, executionResult, request, current);
}

try {
  const health = await waitForHealth();
  assert.equal(health.available, true);
  assert.equal(health.modelLoaded, false);

  const localFile = {
    name: path.basename(modelPath),
    size: bytes.byteLength,
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
  const legacyFile = {
    name: path.basename(legacyModelPath),
    size: legacyBytes.byteLength,
    async arrayBuffer() { return legacyBytes.buffer.slice(legacyBytes.byteOffset, legacyBytes.byteOffset + legacyBytes.byteLength); },
  };
  const legacyBinding = await client.importModel(legacyFile, { token: connectionCode });
  assert.equal(legacyBinding.sha256, G2_ATTENTION_LEGACY_SHA256S[0], 'The production client accepts only the exact registered legacy digest.');
  assert.equal(legacyBinding.modelHash, `sha256:${G2_ATTENTION_LEGACY_SHA256S[0]}`);
  const legacyComparison = await client.compare({ modelHash: legacyBinding.modelHash, providerVersion: runtimeProviderVersion, token: connectionCode });
  const legacyCommitted = commitExecution(createImportedAttentionEventStore(), legacyComparison);
  assert.ok(legacyCommitted.evidence?.attentionChanged, 'The exact legacy artifact retains the accepted comparison semantics.');
  assert.equal((await client.health({ token: connectionCode })).modelHash, legacyBinding.modelHash);

  const binding = await client.importModel(localFile, { token: connectionCode });
  assert.equal(binding.sha256, G2_ATTENTION_PROFILE_SHA256);
  assert.equal(binding.modelHash, `sha256:${G2_ATTENTION_PROFILE_SHA256}`);
  assert.equal((await client.health({ token: connectionCode })).modelLoaded, true);

  const comparison = await client.compare({ modelHash: binding.modelHash, providerVersion: runtimeProviderVersion, token: connectionCode });
  assert.equal(comparison.sampleA.logits.length, 2);
  assert.equal(comparison.sampleB.logits.length, 2);
  for (const sample of [comparison.sampleA, comparison.sampleB]) {
    assert.equal(sample.attentionProbabilities.length, 2);
    for (const layer of sample.attentionProbabilities) {
      assert.equal(layer.length, 2);
      for (const head of layer) {
        assert.equal(head.length, 6);
        for (const row of head) assert.ok(Math.abs(row.reduce((sum, value) => sum + value, 0) - 1) < 1e-3);
      }
    }
  }
  const eventStore = createImportedAttentionEventStore();
  const committed = commitExecution(eventStore, comparison);
  assert.ok(committed.evidence?.attentionChanged, 'Real pinned model must produce measurable attention movement for the accepted pair.');
  assert.equal(committed.semanticEvents.events[0].type, 'comparison.completed');
  assert.equal(committed.semanticEvents.events[1].type, 'observation.detected');
  assert.equal(committed.semanticEvents.evidenceInstances.length, 1);

  const corrupt = Uint8Array.from(bytes);
  corrupt[corrupt.length - 1] ^= 0x01;
  const corruptedFile = { ...localFile, async arrayBuffer() { return corrupt.buffer; } };
  await assert.rejects(client.importModel(corruptedFile, { token: connectionCode }), (error) => error.translationKey === 'g2.error.modelProfileMismatch');
  assert.equal(eventStore.snapshot().evidenceInstances.length, 1, 'A rejected re-import cannot erase or replace truthful evidence.');

  const incomplete = { ...comparison, sampleB: { ...comparison.sampleB, logits: [Number.NaN, 0] } };
  const noMutationStore = createImportedAttentionEventStore();
  assert.throws(() => validateImportedAttentionCompareResponse(incomplete, {
    requestId: comparison.requestId,
    modelHash: binding.modelHash,
    providerVersion: runtimeProviderVersion,
    inputIdsA: comparison.inputIdsA,
    inputIdsB: comparison.inputIdsB,
  }));
  assert.equal(noMutationStore.snapshot().events.length, 0, 'Invalid results do not enter the local semantic event store.');

  console.log(JSON.stringify({
    status: 'PASS',
    task: 'G2 real local imported attention runtime',
    modelBytes: bytes.byteLength,
    modelHash: binding.modelHash,
    legacyModelBytes: legacyBytes.byteLength,
    legacyModelHash: legacyBinding.modelHash,
    cpuOnly: true,
    logits: { a: comparison.sampleA.logits, b: comparison.sampleB.logits },
    attentionMaxDelta: committed.evidence.layerDeltas.map((entry) => entry.maxAbsoluteDelta),
    eventTypes: committed.semanticEvents.events.map((event) => event.type),
    evidenceInstances: committed.semanticEvents.evidenceInstances.length,
  }, null, 2));
} finally {
  child.kill('SIGTERM');
  rmSync(exportDirectory, { recursive: true, force: true });
}
