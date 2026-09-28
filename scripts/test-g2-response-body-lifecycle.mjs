import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createLocalAttentionClient } from '../src/services/localAttention/client.js';
import {
  G2_ATTENTION_API_VERSION,
  G2_ATTENTION_PROFILE_ID,
  G2_ATTENTION_PROFILE_SHA256,
  G2_INPUT_IDS_A,
  G2_INPUT_IDS_B,
} from '../src/core/playground/importedAttention/profile.js';

const modelHash = `sha256:${G2_ATTENTION_PROFILE_SHA256}`;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const uniformRow = () => Array.from({ length: 6 }, () => 1 / 6);
const uniformMatrix = () => Array.from({ length: 6 }, uniformRow);
function sample(firstRow) {
  const heads = [uniformMatrix(), uniformMatrix()];
  heads[0][0] = firstRow;
  return {
    logits: [0.4, 0.8],
    attentionProbabilities: [heads, [uniformMatrix(), uniformMatrix()]],
  };
}
function comparisonResponse(request) {
  return {
    apiVersion: G2_ATTENTION_API_VERSION,
    profileId: G2_ATTENTION_PROFILE_ID,
    modelHash: request.modelHash,
    requestId: request.requestId,
    inputIdsA: request.inputIdsA,
    inputIdsB: request.inputIdsB,
    sampleA: sample([1, 0, 0, 0, 0, 0]),
    sampleB: sample([0, 0.5, 0.1, 0.1, 0.2, 0.1]),
  };
}

let nextScenario = null;
const server = createServer(async (request, response) => {
  const scenario = nextScenario;
  nextScenario = null;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const headers = { 'content-type': 'application/json' };
  const finish = (value) => {
    response.writeHead(200, headers);
    response.end(JSON.stringify(value));
  };
  response.on('close', () => scenario?.closed.resolve());

  if (scenario.mode === 'stalled-body') {
    response.writeHead(200, headers);
    response.write('{"apiVersion":');
    scenario.headers.resolve();
    return;
  }
  if (scenario.mode === 'late-after-cancel') {
    response.writeHead(200, headers);
    response.write('{"apiVersion":');
    scenario.headers.resolve();
    setTimeout(() => {
      scenario.lateWrite.resolve();
      if (!response.destroyed) response.end(JSON.stringify(comparisonResponse(body)));
    }, 250);
    return;
  }
  if (scenario.mode === 'timeout-before-headers') {
    setTimeout(() => {
      scenario.lateWrite.resolve();
      if (!response.destroyed) finish(comparisonResponse(body));
    }, 300);
    return;
  }
  if (scenario.mode === 'partial-json') {
    response.writeHead(200, headers);
    response.end('{"apiVersion":');
    return;
  }
  assert.equal(scenario.mode, 'valid');
  finish(comparisonResponse(body));
});

function enqueue(mode) {
  const scenario = { mode, headers: deferred(), closed: deferred(), lateWrite: deferred() };
  nextScenario = scenario;
  return scenario;
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const client = createLocalAttentionClient({
  baseUrl: `http://127.0.0.1:${server.address().port}`,
  timeoutMs: 100,
});

try {
  const bodyTimeout = enqueue('stalled-body');
  const stalledBodyRequest = client.compare({ modelHash });
  await bodyTimeout.headers.promise;
  await assert.rejects(stalledBodyRequest, (error) => error.code === 'requestTimeout');
  await bodyTimeout.closed.promise;

  const partialJson = enqueue('partial-json');
  await assert.rejects(client.compare({ modelHash }), (error) => error.code === 'responseInvalid');
  await partialJson.closed.promise;

  const callerCancelled = enqueue('late-after-cancel');
  const abortController = new AbortController();
  const cancelledRequest = client.compare({ modelHash, signal: abortController.signal });
  await callerCancelled.headers.promise;
  abortController.abort('caller-cancelled-after-headers');
  await assert.rejects(cancelledRequest, (error) => error.name === 'AbortError');
  await callerCancelled.closed.promise;
  await callerCancelled.lateWrite.promise;

  const beforeHeaders = enqueue('timeout-before-headers');
  await assert.rejects(client.compare({ modelHash }), (error) => error.code === 'requestTimeout');
  await beforeHeaders.lateWrite.promise;

  const retry = enqueue('valid');
  const validated = await client.compare({ modelHash });
  await retry.closed.promise;
  assert.equal(validated.requestId.startsWith('g2-'), true);
  assert.equal(validated.modelHash, modelHash);
  assert.deepEqual(validated.inputIdsA, [...G2_INPUT_IDS_A]);
  assert.deepEqual(validated.inputIdsB, [...G2_INPUT_IDS_B]);

  console.log(JSON.stringify({
    status: 'PASS',
    assertions: [
      'timeout remains active after headers while consuming a stalled body',
      'partial JSON is rejected without returning a response value',
      'caller abort after headers settles independently of the timeout',
      'late body completion after cancellation cannot resolve the cancelled request',
      'timeout before headers settles the request',
      'a subsequent valid request retries successfully',
    ],
  }, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
