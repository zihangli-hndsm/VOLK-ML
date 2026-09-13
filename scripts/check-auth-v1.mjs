import assert from 'node:assert/strict';
import { createVolkCloudClient } from '../src/services/volkCloud/client.js';
import { createCloudAiGateway } from '../src/services/volkCloud/aiGateway.js';
import { createRecoveryPresentationState, transitionRecoveryPresentation } from '../src/services/volkCloud/recoveryPresentation.js';

let recoveryState = createRecoveryPresentationState();
recoveryState = transitionRecoveryPresentation(recoveryState, { type: 'ISSUED', code: 'RECOVERY-SYNTHETIC-1234' });
assert.equal(recoveryState.code, 'RECOVERY-SYNTHETIC-1234');
for (const type of ['SIGN_OUT', 'DISMISS', 'AUTH_INVALIDATED', 'LEAVE_CONTEXT']) {
  assert.equal(transitionRecoveryPresentation(recoveryState, { type }).code, null);
}

const calls = [];
const fetchImpl = async (url, init) => {
  calls.push({ url, init });
  const path = new URL(url).pathname;
  const body = path === '/v1/auth/register'
    ? { accessToken: 'opaque-session', tokenType: 'bearer', account: { id: 'acct-1', username: 'learner_1', role: 'user', createdAt: '2026-01-01T00:00:00Z' }, recoveryCode: 'RECOVERY-SYNTHETIC-1234' }
    : path === '/v1/auth/login'
      ? { accessToken: 'opaque-session', tokenType: 'bearer', account: { id: 'acct-1', username: 'learner_1', role: 'user', createdAt: '2026-01-01T00:00:00Z' } }
    : path === '/v1/auth/me'
      ? { id: 'acct-1', username: 'learner_1', role: 'user', createdAt: '2026-01-01T00:00:00Z' }
      : path === '/v1/me/wallet'
        ? { availableCredits: 90, reservedCredits: 10, spentCredits: 1 }
        : path === '/v1/me/entitlements' || path === '/v1/me/redemptions'
          ? []
          : path === '/v1/redemptions'
          ? { id: 'red-1', creditsGranted: 100, createdAt: '2026-01-01T00:00:00Z', wallet: { availableCredits: 190, reservedCredits: 0, spentCredits: 1 } }
            : path === '/v1/auth/recovery-codes/reissue' || path === '/v1/auth/password-reset'
              ? { recoveryCode: 'RECOVERY-SYNTHETIC-5678' }
            : path === '/v1/ai/operations'
              ? { id: 'op-1', status: 'SUCCEEDED', reservedCredits: 10, settledCredits: 1, result: { text: 'safe', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } }, errorCode: null }
              : { ok: true };
  return { ok: true, status: 200, json: async () => body };
};

const client = createVolkCloudClient({ baseUrl: 'http://cloud.test', fetchImpl });
const registered = await client.register({ username: ' New_User1 ', password: 'at-least-12-characters' });
assert.equal(registered.tokenType, 'bearer');
assert.equal(registered.account.username, 'learner_1');
assert.equal(registered.recoveryCode, 'RECOVERY-SYNTHETIC-1234');
const login = await client.login({ username: ' Learner_1 ', password: 'at-least-12-characters' });
assert.equal(login.tokenType, 'bearer');
const reissued = await client.reissueRecoveryCode({ accessToken: login.accessToken, currentPassword: 'at-least-12-characters' });
assert.equal(reissued.recoveryCode, 'RECOVERY-SYNTHETIC-5678');
const reset = await client.resetPassword({ username: 'Learner_1', recoveryCode: reissued.recoveryCode, newPassword: 'new-password-1234' });
assert.equal(reset.recoveryCode, 'RECOVERY-SYNTHETIC-5678');
const snapshot = await client.getAccountSnapshot({ accessToken: login.accessToken });
assert.equal(snapshot.wallet.availableCredits, 90);
const redemption = await client.redeemLumiKey({ accessToken: login.accessToken, code: 'VOLK-FIX-TEST', requestId: 'redemption-1' });
assert.equal(redemption.wallet.availableCredits, 190);
const operation = await client.createAiOperation({ accessToken: login.accessToken, requestId: 'operation-1', operation: { operationType: 'lumi-dialogue', input: { prompt: 'bounded semantic prompt' } } });
assert.equal(operation.status, 'SUCCEEDED');
const operationCall = calls.find((call) => call.url.endsWith('/v1/ai/operations'));
const operationBody = JSON.parse(operationCall.init.body);
assert.deepEqual(Object.keys(operationBody).sort(), ['idempotencyKey', 'input', 'operationType']);
assert.equal(operationBody.input.prompt, 'bounded semantic prompt');

const gateway = createCloudAiGateway({ client, getAccessToken: () => login.accessToken });
const completion = await gateway.complete({ messages: [{ role: 'user', content: 'hello' }] });
assert.equal(completion.text, 'safe');

console.log('Auth v1 client contract checks passed.');
