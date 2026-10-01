import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import { createH2LocalPythonServer } from './h2-local-python/server.mjs';
import {
  projectH2LocalPythonRequestV1,
  validateH2LocalPythonRequestV1,
  validateH2LocalPythonResultV1,
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

async function executeFixture(fixture, fixtureId) {
  const draft = await projectH2LocalPythonRequestV1(fixture);
  const preflight = await fetch(`${base}/authorize`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(preflight.status, 204, 'strict local CORS preflight accepts the configured Vite origin');
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);

  const authorizationResponse = await fetch(`${base}/authorize`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  });
  if (authorizationResponse.status !== 200) assert.fail(`authorization failed: ${await authorizationResponse.text()}`);
  const authorizationEnvelope = await authorizationResponse.json();
  assert.equal(authorizationEnvelope.schemaVersion, 'volk.h2.authorization.v1');
  assert.equal(authorizationEnvelope.authorization.requestFingerprint, draft.identity.normalizedRequestFingerprint);
  const request = { ...draft, authorization: authorizationEnvelope.authorization };
  const response = await fetch(`${base}/fit`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(125_000),
  });
  if (response.status !== 200) assert.fail(`training failed (${response.status}): ${await response.text()}`);
  const result = await response.json();
  const validated = await validateH2LocalPythonRequestV1(request);
  assert.equal(validateH2LocalPythonResultV1(result, validated), true);
  assert.equal(result.lifecycle.processTerminated, true, 'success is returned only after the child process has exited');
  assert.equal(result.lifecycle.resultDiscarded, false);
  assert.equal(result.provenance.provider, 'local-python');
  assert.equal(result.provenance.pythonVersion, expectedReference?.reference.python ?? '3.12.10');
  assert.equal(result.provenance.pytorchVersion, expectedReference?.reference.torch ?? '2.14.0+cpu');
  assert.equal(result.provenance.numpyVersion, expectedReference?.reference.numpy ?? '2.5.3');
  assert.equal(result.parameters.payloadBase64.length > 0, true);
  assert.equal(result.epochLoss.length, draft.training.epochs);
  compareReference(result, fixtureId, draft.split);
  runEvidence.push({ fixtureId, task: result.metrics.task, runId: result.runIdentity.runId, metrics: result.metrics, epochs: result.epochLoss.length });

  const replay = await fetch(`${base}/fit`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  assert.equal(replay.status, 422, 'one-time confirmation cannot be replayed');
  assert.equal((await replay.json()).error.code, 'H2_AUTHORIZATION_EXPIRED_OR_REPLAYED');
  return result;
}

try {
  const health = await fetch(`${base}/health`, { headers: { Origin: origin } });
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.available, true, 'the app-local pinned runtime is installed');

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
