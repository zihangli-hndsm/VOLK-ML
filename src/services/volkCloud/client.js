import { normalizeVolkApiUrl } from './config.js';
import {
  CLOUD_AUTH_API_VERSION,
  CLOUD_AUTH_ENDPOINTS,
  normalizeCloudAccountResponse,
  normalizeCloudWalletResponse,
  normalizeCloudEntitlementsResponse,
  normalizeCloudRedemptionsResponse,
  normalizeCloudAiOperationResponse,
  normalizeCloudLoginResponse,
  normalizeCloudRedemptionResponse,
  normalizeCloudRecoveryResponse,
  normalizeCloudPasswordResetResponse,
  isValidUsername,
  WIPE_NOTICE_VERSION,
} from './authContract.js';

function cloudError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

function mapCloudFailure(status, body, fallbackCode = 'VOLK_CLOUD_REQUEST_FAILED') {
  const remoteCode = String(body?.error?.code ?? body?.code ?? '').toLowerCase();
  const code = remoteCode.includes('insufficient') || status === 402 ? 'VOLK_CLOUD_INSUFFICIENT_CREDITS'
    : remoteCode === 'invalid_access_code' || remoteCode === 'access_code_exhausted' ? 'VOLK_CLOUD_INVALID_ACCESS_CODE'
      : remoteCode.includes('entitlement') && remoteCode.includes('expired') ? 'VOLK_CLOUD_ENTITLEMENT_EXPIRED'
      : remoteCode.includes('entitlement') || status === 403 ? 'VOLK_CLOUD_ENTITLEMENT_REQUIRED'
        : remoteCode.includes('pending') || remoteCode.includes('unknown_operation') ? 'VOLK_CLOUD_OPERATION_PENDING'
          : remoteCode.includes('provider') || remoteCode === 'billing_unavailable' ? 'VOLK_CLOUD_PROVIDER_UNAVAILABLE'
            : status === 401 ? 'VOLK_CLOUD_AUTH_REQUIRED' : fallbackCode;
  return cloudError(code, { status: Number(status) || null });
}

export function createVolkCloudClient({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 3000 } = {}) {
  const apiUrl = normalizeVolkApiUrl(baseUrl);
  if (typeof fetchImpl !== 'function') throw cloudError('VOLK_CLOUD_FETCH_UNAVAILABLE');
  async function requestJson(path, { method = 'GET', token = null, body = undefined, idempotencyKey = null } = {}) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = `Bearer ${token}`;
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
      const response = await fetchImpl(`${apiUrl}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller?.signal });
      let payload = null;
      try { payload = await response.json(); } catch { payload = null; }
      if (!response.ok) throw mapCloudFailure(response.status, payload);
      return payload;
    } catch (error) {
      if (error?.code) throw error;
      if (error?.name === 'AbortError') throw cloudError('VOLK_CLOUD_REQUEST_TIMEOUT');
      throw cloudError('VOLK_CLOUD_UNREACHABLE');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return Object.freeze({
    apiUrl,
    async health() {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const response = await fetchImpl(`${apiUrl}/health`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller?.signal,
        });
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        if (!response.ok) throw cloudError('VOLK_CLOUD_HEALTH_FAILED', { status: response.status });
        return body;
      } catch (error) {
        if (error?.code) throw error;
        throw cloudError('VOLK_CLOUD_HEALTH_UNREACHABLE');
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    async lumiRespond(request) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const response = await fetchImpl(`${apiUrl}/v0/lumi/respond`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller?.signal,
        });
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        if (!response.ok) throw cloudError('VOLK_CLOUD_LUMI_FAILED', { status: response.status });
        return body;
      } catch (error) {
        if (error?.code) throw error;
        throw cloudError('VOLK_CLOUD_LUMI_UNREACHABLE');
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    async register({ username, password } = {}) {
      const canonical = String(username ?? '').trim().toLowerCase();
      if (!isValidUsername(canonical) || !String(password ?? '')) throw cloudError('VOLK_CLOUD_LOGIN_REQUIRED');
      return normalizeCloudLoginResponse(await requestJson(CLOUD_AUTH_ENDPOINTS.register, {
        method: 'POST',
        body: { username: canonical, password: String(password).slice(0, 512), wipeNoticeVersion: WIPE_NOTICE_VERSION },
      }), { recovery: true });
    },
    async login({ username, password } = {}) {
      const canonical = String(username ?? '').trim().toLowerCase();
      if (!isValidUsername(canonical) || !String(password ?? '')) throw cloudError('VOLK_CLOUD_LOGIN_REQUIRED');
      return normalizeCloudLoginResponse(await requestJson(CLOUD_AUTH_ENDPOINTS.login, {
        method: 'POST', body: { username: canonical, password: String(password).slice(0, 512) },
      }));
    },
    async reissueRecoveryCode({ accessToken, currentPassword } = {}) {
      if (!accessToken) throw cloudError('VOLK_CLOUD_AUTH_REQUIRED');
      if (!String(currentPassword ?? '')) throw cloudError('VOLK_CLOUD_LOGIN_REQUIRED');
      return normalizeCloudRecoveryResponse(await requestJson(CLOUD_AUTH_ENDPOINTS.recoveryReissue, { method: 'POST', token: accessToken, body: { currentPassword: String(currentPassword).slice(0, 512) } }));
    },
    async resetPassword({ username, recoveryCode, newPassword } = {}) {
      const canonical = String(username ?? '').trim().toLowerCase();
      if (!isValidUsername(canonical) || !String(recoveryCode ?? '').trim() || !String(newPassword ?? '')) throw cloudError('VOLK_CLOUD_PASSWORD_RESET_REQUIRED');
      return normalizeCloudPasswordResetResponse(await requestJson(CLOUD_AUTH_ENDPOINTS.passwordReset, { method: 'POST', body: { username: canonical, recoveryCode: String(recoveryCode).trim().slice(0, 256), newPassword: String(newPassword).slice(0, 512) } }));
    },
    async logout({ accessToken } = {}) {
      if (!accessToken) return { apiVersion: CLOUD_AUTH_API_VERSION, status: 'signed-out' };
      await requestJson(CLOUD_AUTH_ENDPOINTS.logout, { method: 'POST', token: accessToken });
      return { apiVersion: CLOUD_AUTH_API_VERSION, status: 'signed-out' };
    },
    async getAccount({ accessToken } = {}) {
      if (!accessToken) throw cloudError('VOLK_CLOUD_AUTH_REQUIRED');
      return normalizeCloudAccountResponse(await requestJson(CLOUD_AUTH_ENDPOINTS.me, { token: accessToken }));
    },
    async getWallet({ accessToken } = {}) {
      if (!accessToken) throw cloudError('VOLK_CLOUD_AUTH_REQUIRED');
      return normalizeCloudWalletResponse(await requestJson(CLOUD_AUTH_ENDPOINTS.wallet, { token: accessToken }));
    },
    async getEntitlements({ accessToken } = {}) {
      if (!accessToken) throw cloudError('VOLK_CLOUD_AUTH_REQUIRED');
      return normalizeCloudEntitlementsResponse(await requestJson(CLOUD_AUTH_ENDPOINTS.entitlements, { token: accessToken }));
    },
    async getRedemptions({ accessToken } = {}) {
      if (!accessToken) throw cloudError('VOLK_CLOUD_AUTH_REQUIRED');
      return normalizeCloudRedemptionsResponse(await requestJson(CLOUD_AUTH_ENDPOINTS.redemptions, { token: accessToken }));
    },
    async getAccountSnapshot({ accessToken } = {}) {
      const [currentAccount, currentWallet, currentEntitlements, currentRedemptions] = await Promise.all([
        this.getAccount({ accessToken }), this.getWallet({ accessToken }), this.getEntitlements({ accessToken }), this.getRedemptions({ accessToken }),
      ]);
      return Object.freeze({ apiVersion: CLOUD_AUTH_API_VERSION, account: currentAccount.account, wallet: currentWallet.wallet, entitlements: currentEntitlements.entitlements, redemptions: currentRedemptions.redemptions });
    },
    async redeemLumiKey({ accessToken, code, requestId } = {}) {
      if (!accessToken) throw cloudError('VOLK_CLOUD_AUTH_REQUIRED');
      if (!String(code ?? '').trim() || !String(requestId ?? '').trim()) throw cloudError('VOLK_CLOUD_REDEMPTION_REQUIRED');
      return normalizeCloudRedemptionResponse(await requestJson(CLOUD_AUTH_ENDPOINTS.redemption, {
        method: 'POST', token: accessToken, idempotencyKey: String(requestId).slice(0, 120),
        body: { code: String(code).trim().slice(0, 240), idempotencyKey: String(requestId).slice(0, 120) },
      }));
    },
    async createAiOperation({ accessToken, requestId, operation } = {}) {
      if (!accessToken) throw cloudError('VOLK_CLOUD_AUTH_REQUIRED');
      if (!String(requestId ?? '').trim() || !operation || typeof operation !== 'object') throw cloudError('VOLK_CLOUD_OPERATION_REQUIRED');
      const operationType = operation.operationType ?? 'lumi-dialogue';
      const prompt = String(operation.input?.prompt ?? operation.prompt ?? '').slice(0, 40_000);
      if (!prompt) throw cloudError('VOLK_CLOUD_OPERATION_REQUIRED');
      return normalizeCloudAiOperationResponse(await requestJson(CLOUD_AUTH_ENDPOINTS.aiOperation, {
        method: 'POST', token: accessToken, idempotencyKey: String(requestId).slice(0, 120),
        body: { idempotencyKey: String(requestId).slice(0, 120), operationType, input: { prompt } },
      }));
    },
  });
}

export function createVolkCloudClientForConfig(config, options = {}) {
  if (!config?.apiUrl) return null;
  return createVolkCloudClient({ ...options, baseUrl: config.apiUrl });
}
