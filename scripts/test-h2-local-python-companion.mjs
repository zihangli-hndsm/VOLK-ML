import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { createH2LocalPythonServer } from './h2-local-python/server.mjs';
import {
  projectH2LocalPythonRequestV2,
  validateH2LocalPythonRequestV2,
  validateH2LocalPythonResultV2,
} from '../src/core/execution/h2LocalPython.js';
import { h2ClassificationDropoutFixture, h2RegressionFixture } from './h2-local-python/test-fixtures.mjs';

if (process.platform !== 'win32') {
  process.stdout.write('H2 companion HTTP acceptance requires the frozen Windows runtime; skipped on this platform.\n');
  process.exit(0);
}

const origin = 'http://localhost:5173';
const server = await createH2LocalPythonServer({ port: 0 });
const port = server.address().port;
const base = `http://127.0.0.1:${port}/v1/h2`;
const credential = server.connectionCredential;
const runsRoot = path.join(process.env.LOCALAPPDATA, 'VOLK', 'h2-local-python-v1', 'runs');
const runEvidence = [];
const expectedReference = process.env.VOLK_H2_REFERENCE_EXPECTED
  ? JSON.parse(fs.readFileSync(process.env.VOLK_H2_REFERENCE_EXPECTED, 'utf8')) : null;

function assertNear(actual, expected, label, { absolute = 2e-6, relative = 2e-5 } = {}) {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected), `${label} values are finite.`);
  assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected),
    `${label} is within the frozen tolerance: actual ${actual}, expected ${expected}.`);
}

function compareReference(result, fixtureId, actualSplit) {
  if (!expectedReference) return;
  const expected = expectedReference.fixtures.find((fixture) => fixture.fixtureId === fixtureId);
  assert.ok(expected, `The pinned independent reference contains ${fixtureId}.`);
  assert.equal(actualSplit.algorithm, expected.split.algorithm);
  assert.equal(actualSplit.seed, expected.split.seed);
  assert.deepEqual(actualSplit.trainIndices, expected.split.trainIndices, `${fixtureId} training split matches the independent reference.`);
  assert.deepEqual(actualSplit.testIndices, expected.split.testIndices, `${fixtureId} held-out split matches the independent reference.`);
  assert.equal(result.epochLoss.length, expected.epochLoss.length);
  result.epochLoss.forEach((loss, index) => assertNear(loss, expected.epochLoss[index], `${fixtureId} epoch loss ${index}`));
  assert.equal(result.metrics.task, expected.metrics.task);
  assert.equal(result.metrics.heldOutRows, expected.metrics.heldOutRows);
  if (result.metrics.task === 'classification') {
    assert.equal(result.metrics.accuracy, expected.metrics.accuracy);
    assertNear(result.metrics.macroF1, expected.metrics.macroF1, `${fixtureId} macro-F1`, { absolute: 1e-12, relative: 0 });
  } else {
    assertNear(result.metrics.rmse, expected.metrics.rmse, `${fixtureId} RMSE`);
    assertNear(result.metrics.r2, expected.metrics.r2, `${fixtureId} R²`);
  }
  const payload = Buffer.from(result.parameters.payloadBase64, 'base64');
  const actualTensors = new Map(result.parameters.tensors.map((descriptor) => [
    descriptor.name,
    Array.from({ length: descriptor.length / 4 }, (_, index) => payload.readFloatLE(descriptor.offset + index * 4)),
  ]));
  const expectedTensorNames = Object.keys(expected.parameters).sort((left, right) => {
    const [, leftLayer, leftKind] = left.match(/^layers\.(\d+)\.(weight|bias)$/) ?? [];
    const [, rightLayer, rightKind] = right.match(/^layers\.(\d+)\.(weight|bias)$/) ?? [];
    return Number(leftLayer) - Number(rightLayer) || (leftKind === 'weight' ? -1 : 1);
  });
  assert.deepEqual(result.parameters.tensors.map((descriptor) => descriptor.name), expectedTensorNames,
    `${fixtureId} tensor manifest order matches graph Dense ordinals in the independent reference.`);
  for (const [name, values] of Object.entries(expected.parameters)) {
    assert.equal(actualTensors.get(name).length, values.length, `${fixtureId} ${name} tensor size matches.`);
    actualTensors.get(name).forEach((value, index) => assertNear(value, values[index], `${fixtureId} ${name}[${index}]`));
  }
}

function ownedRuns() {
  if (!fs.existsSync(runsRoot)) return [];
  return fs.readdirSync(runsRoot, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => path.join(runsRoot, item.name))
    .filter((folder) => fs.existsSync(path.join(folder, '.volk-h2-owned'))
      && fs.readFileSync(path.join(folder, '.volk-h2-owned'), 'ascii') === 'volk-h2-owned-v1\n')
    .sort();
}

function connectionHeaders(activeCredential = credential, includeConnectionId = true) {
  return {
    Origin: origin,
    'Content-Type': 'application/json',
    Authorization: `Bearer ${activeCredential.token}`,
    ...(includeConnectionId ? { 'X-Volk-H2-Connection-Id': activeCredential.connectionId } : {}),
  };
}

async function assertConnectionFailuresDoNotLaunch(draft) {
  const before = ownedRuns();
  const missing = await fetch(`${base}/authorize`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
  });
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error.code, 'H2_CONNECTION_REQUIRED');

  const wrong = await fetch(`${base}/authorize`, {
    method: 'POST', headers: connectionHeaders({ ...credential, token: 'A'.repeat(43) }), body: JSON.stringify(draft),
  });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error.code, 'H2_CONNECTION_INVALID');

  const stale = await fetch(`${base}/authorize`, {
    method: 'POST', headers: connectionHeaders({ ...credential, connectionId: crypto.randomUUID() }), body: JSON.stringify(draft),
  });
  assert.equal(stale.status, 401);
  assert.equal((await stale.json()).error.code, 'H2_CONNECTION_STALE');

  const expiredServer = await createH2LocalPythonServer({
    port: 0,
    connectionCredential: { token: 'B'.repeat(43), expiresAt: Date.now() - 1 },
  });
  try {
    const expired = await fetch(`http://127.0.0.1:${expiredServer.address().port}/v1/h2/authorize`, {
      method: 'POST', headers: connectionHeaders(expiredServer.connectionCredential), body: JSON.stringify(draft),
    });
    assert.equal(expired.status, 401);
    assert.equal((await expired.json()).error.code, 'H2_CONNECTION_EXPIRED');
  } finally {
    expiredServer.close();
    await once(expiredServer, 'close');
  }

  const restartedServer = await createH2LocalPythonServer({
    port: 0,
    connectionCredential: { token: credential.token, expiresAt: credential.expiresAt },
  });
  try {
    const restartedBase = `http://127.0.0.1:${restartedServer.address().port}/v1/h2`;
    assert.notEqual(restartedServer.connectionCredential.connectionId, credential.connectionId,
      'each coordinator process creates a fresh connection generation even when the configured bearer remains the same');
    const preRestart = await fetch(`${restartedBase}/authorize`, {
      method: 'POST', headers: connectionHeaders(credential), body: JSON.stringify(draft),
    });
    assert.equal(preRestart.status, 401);
    assert.equal((await preRestart.json()).error.code, 'H2_CONNECTION_STALE');
    const paired = await fetch(`${restartedBase}/authorize`, {
      method: 'POST', headers: connectionHeaders(restartedServer.connectionCredential), body: JSON.stringify(draft),
    });
    assert.equal(paired.status, 200, 'the fresh process credential accepts its correctly paired client');
  } finally {
    restartedServer.close();
    await once(restartedServer, 'close');
  }
  assert.deepEqual(ownedRuns(), before, 'missing, wrong, stale, expired, and pre-restart credentials never create a run directory or launch Python');
}

async function assertMalformedDraftRejectedBeforeLaunch(draft, mutate, code, label) {
  const before = ownedRuns();
  const malformed = structuredClone(draft);
  mutate(malformed);
  const response = await fetch(`${base}/authorize`, {
    method: 'POST', headers: connectionHeaders(), body: JSON.stringify(malformed),
  });
  assert.equal(response.status, 422, `${label} is rejected before execution authorization`);
  assert.equal((await response.json()).error.code, code, `${label} uses its stable diagnostic`);
  assert.deepEqual(ownedRuns(), before, `${label} does not create a run directory or launch Python`);
}

async function executeFixture(fixture, fixtureId) {
  const draft = await projectH2LocalPythonRequestV2(fixture);
  const preflight = await fetch(`${base}/authorize`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,authorization,x-volk-h2-connection-id',
    },
  });
  assert.equal(preflight.status, 204, 'strict local CORS preflight accepts the configured Vite origin');
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);

  const authorizationResponse = await fetch(`${base}/authorize`, {
    method: 'POST',
    headers: connectionHeaders(),
    body: JSON.stringify(draft),
  });
  if (authorizationResponse.status !== 200) assert.fail(`authorization failed: ${await authorizationResponse.text()}`);
  const authorizationEnvelope = await authorizationResponse.json();
  assert.equal(authorizationEnvelope.schemaVersion, 'volk.h2.authorization.v1');
  assert.equal(authorizationEnvelope.authorization.requestFingerprint, draft.identity.normalizedRequestFingerprint);
  const request = { ...draft, authorization: authorizationEnvelope.authorization };
  const rejectedFit = await fetch(`${base}/fit`, {
    method: 'POST',
    headers: connectionHeaders({ ...credential, connectionId: crypto.randomUUID() }),
    body: JSON.stringify(request),
  });
  assert.equal(rejectedFit.status, 401, 'an execution token cannot move to a different connection generation');
  assert.equal((await rejectedFit.json()).error.code, 'H2_CONNECTION_STALE');
  const response = await fetch(`${base}/fit`, {
    method: 'POST',
    headers: connectionHeaders(),
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(125_000),
  });
  if (response.status !== 200) assert.fail(`training failed (${response.status}): ${await response.text()}`);
  const result = await response.json();
  const validated = await validateH2LocalPythonRequestV2(request);
  assert.equal(validateH2LocalPythonResultV2(result, validated), true);
  assert.equal(result.lifecycle.processTerminated, true, 'success is returned only after the child process has exited');
  assert.equal(result.lifecycle.resultDiscarded, false);
  assert.equal(result.provenance.provider, 'local-python');
  assert.deepEqual(result.runIdentity.targetSemantics, {
    task: draft.dataset.task,
    targetName: draft.dataset.targetName,
    classMapping: draft.dataset.classVocabulary.map((sourceValue, classIndex) => ({ sourceValue, classIndex })),
  }, 'the result is bound to the original target vocabulary and deterministic class mapping');
  assert.equal(result.provenance.pythonVersion, expectedReference?.reference.python ?? '3.12.10');
  assert.equal(result.provenance.pytorchVersion, expectedReference?.reference.torch ?? '2.14.0+cpu');
  assert.equal(result.provenance.numpyVersion, expectedReference?.reference.numpy ?? '2.5.3');
  assert.equal(result.parameters.payloadBase64.length > 0, true);
  assert.equal(result.epochLoss.length, draft.training.epochs);
  compareReference(result, fixtureId, draft.split);
  runEvidence.push({ fixtureId, task: result.metrics.task, runId: result.runIdentity.runId, metrics: result.metrics, epochs: result.epochLoss.length });

  const replay = await fetch(`${base}/fit`, {
    method: 'POST',
    headers: connectionHeaders(),
    body: JSON.stringify(request),
  });
  assert.equal(replay.status, 422, 'one-time confirmation cannot be replayed');
  assert.equal((await replay.json()).error.code, 'H2_AUTHORIZATION_EXPIRED_OR_REPLAYED');
  return result;
}

try {
  const unpairedHealth = await fetch(`${base}/health`, { headers: { Origin: origin } });
  const unpairedHealthBody = await unpairedHealth.json();
  assert.equal(unpairedHealthBody.available, false, 'an unpaired local status is never reported as executable');
  assert.equal(unpairedHealthBody.reason, 'H2_CONNECTION_REQUIRED');
  const health = await fetch(`${base}/health`, { headers: { Origin: origin, Authorization: `Bearer ${credential.token}` } });
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.schemaVersion, 'volk.h2.health.v2');
  assert.equal(healthBody.connected, true);
  assert.equal(healthBody.available, true, 'the app-local pinned runtime is installed');
  assert.equal(healthBody.connectionId, credential.connectionId);

  const draft = await projectH2LocalPythonRequestV2(h2RegressionFixture());
  await assertConnectionFailuresDoNotLaunch(draft);
  for (const value of [null, '', ' \t ', false]) {
    await assertMalformedDraftRejectedBeforeLaunch(draft,
      (request) => { request.dataset.rows[0].features[0] = value; },
      'H2_DATASET_NUMERIC_VALUE_INVALID', `invalid feature ${JSON.stringify(value)}`);
    await assertMalformedDraftRejectedBeforeLaunch(draft,
      (request) => { request.dataset.rows[0].target = value; },
      'H2_DATASET_NUMERIC_VALUE_INVALID', `invalid regression target ${JSON.stringify(value)}`);
  }
  await assertMalformedDraftRejectedBeforeLaunch(draft,
    (request) => { request.graph.nodes.find((item) => item.componentId === 'tensor_input_node').parameters.shape = '2,3'; },
    'H2_GRAPH_INPUT_SHAPE_INVALID', 'rank-two input shape');
  await assertMalformedDraftRejectedBeforeLaunch(draft,
    (request) => { request.graph.nodes.find((item) => item.nodeId === 'hidden').parameters.units = 3.5; },
    'H2_GRAPH_LAYER_DIMENSION_INVALID', 'fractional Dense width');
  await assertMalformedDraftRejectedBeforeLaunch(draft,
    (request) => { request.graph.nodes.find((item) => item.nodeId === 'output-layer').parameters.input_features = 7; },
    'H2_GRAPH_LAYER_DIMENSION_MISMATCH', 'inconsistent connected Dense widths');
  const regression = await executeFixture(h2RegressionFixture(), 'h2-regression-v1');
  const classification = await executeFixture(h2ClassificationDropoutFixture(), 'h2-classification-dropout-v1');
  assert.equal(regression.metrics.task, 'regression');
  assert.equal(classification.metrics.task, 'classification');
  assert.equal(classification.provenance.pytorchVersion, '2.14.0+cpu');
  assert.equal(classification.parameters.tensors[0].name, 'layers.0.weight');
  process.stdout.write(`H2 real companion HTTP runs passed${expectedReference ? ' against the independent frozen numerical reference' : ''}: ${JSON.stringify(runEvidence)}\n`);
} finally {
  server.close();
  await once(server, 'close');
}
