// Cloud-owned Auth v1 wire contract. ML validates/project responses; Cloud
// remains authoritative for identity, Credits, usage, provider, and settlement.

export const CLOUD_AUTH_API_VERSION = 1;
export const CLOUD_AUTH_ENDPOINTS = Object.freeze({
  register: '/v1/auth/register', login: '/v1/auth/login', me: '/v1/auth/me', logout: '/v1/auth/logout',
  recoveryReissue: '/v1/auth/recovery-codes/reissue', passwordReset: '/v1/auth/password-reset',
  wallet: '/v1/me/wallet', entitlements: '/v1/me/entitlements', redemptions: '/v1/me/redemptions',
  redemption: '/v1/redemptions', aiOperation: '/v1/ai/operations',
});
export const WIPE_NOTICE_VERSION = 'auth-wipe-test-v1';

export const AUTH_STATUS = Object.freeze({
  SIGNED_OUT: 'signed-out', AUTHENTICATED: 'authenticated', ENTITLEMENT_REQUIRED: 'entitlement-required',
  ENTITLEMENT_EXPIRED: 'entitlement-expired', INSUFFICIENT_CREDITS: 'insufficient-credits', PENDING: 'pending',
  PROVIDER_UNAVAILABLE: 'provider-unavailable',
});

const MAX_ITEMS = 64;
const boundedText = (value, max = 240) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
const boundedCount = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.min(1_000_000_000, Math.floor(Number(value))) : null;
const boundedDate = (value) => boundedText(value, 80);
const normalizeUsername = (value) => String(value ?? '').trim().toLowerCase();
export function isValidUsername(value) { return /^[a-z][a-z0-9_]{2,31}$/.test(normalizeUsername(value)) && !['admin', 'owner', 'root', 'system', 'support', 'volk'].includes(normalizeUsername(value)); }
function contractError(reason) { const error = new Error('VOLK_CLOUD_AUTH_CONTRACT_INVALID'); error.code = error.message; error.details = { reason }; return error; }
function object(value, reason) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw contractError(reason); return value; }
function account(value) { if (value == null) return null; object(value, 'account-shape'); if (value.email != null) throw contractError('email-not-allowed'); const username = normalizeUsername(value.username); if (!isValidUsername(username)) throw contractError('username-shape'); return Object.freeze({ id: boundedText(value.id, 120), username, role: boundedText(value.role, 80), createdAt: boundedDate(value.createdAt) }); }
function wallet(value) { if (value == null) return null; object(value, 'wallet-shape'); return Object.freeze({ availableCredits: boundedCount(value.availableCredits), reservedCredits: boundedCount(value.reservedCredits), spentCredits: boundedCount(value.spentCredits) }); }
function list(value, itemReason, mapItem) { if (!Array.isArray(value) || value.length > MAX_ITEMS) throw contractError(itemReason); return Object.freeze(value.map((item) => { object(item, `${itemReason}-item`); return Object.freeze(mapItem(item)); })); }
function entitlements(value) { return list(value, 'entitlements-shape', (item) => ({ id: boundedText(item.id, 120), kind: boundedText(item.kind, 120), startsAt: boundedDate(item.startsAt), endsAt: boundedDate(item.endsAt) })); }
function redemptions(value) { return list(value, 'redemptions-shape', (item) => ({ id: boundedText(item.id, 120), creditsGranted: boundedCount(item.creditsGranted), createdAt: boundedDate(item.createdAt) })); }

export function normalizeCloudAccount(value) { return account(value); }
export function normalizeCloudLoginResponse(payload, { recovery = false } = {}) { object(payload, 'login-shape'); if (typeof payload.accessToken !== 'string' || !payload.accessToken.trim()) throw contractError('access-token-shape'); if (payload.tokenType !== 'bearer') throw contractError('token-type'); return Object.freeze({ apiVersion: CLOUD_AUTH_API_VERSION, accessToken: payload.accessToken.trim().slice(0, 4096), tokenType: 'bearer', account: account(payload.account), recoveryCode: recovery ? normalizeRecoveryCode(payload.recoveryCode) : undefined }); }
function normalizeRecoveryCode(value) { if (typeof value !== 'string' || value.trim().length < 8 || value.length > 256) throw contractError('recovery-code-shape'); return value.trim(); }
export function normalizeCloudRecoveryResponse(payload) { object(payload, 'recovery-response-shape'); return Object.freeze({ apiVersion: CLOUD_AUTH_API_VERSION, recoveryCode: normalizeRecoveryCode(payload.recoveryCode) }); }
export function normalizeCloudPasswordResetResponse(payload) { return normalizeCloudRecoveryResponse(payload); }
export function normalizeCloudAccountResponse(payload) { return Object.freeze({ apiVersion: CLOUD_AUTH_API_VERSION, account: account(payload) }); }
export function normalizeCloudWalletResponse(payload) { object(payload, 'wallet-response-shape'); return Object.freeze({ apiVersion: CLOUD_AUTH_API_VERSION, wallet: wallet(payload) }); }
export function normalizeCloudEntitlementsResponse(payload) { const values = Array.isArray(payload) ? payload : object(payload, 'entitlements-response-shape').entitlements ?? payload.items ?? []; return Object.freeze({ apiVersion: CLOUD_AUTH_API_VERSION, entitlements: entitlements(values) }); }
export function normalizeCloudRedemptionsResponse(payload) { const values = Array.isArray(payload) ? payload : object(payload, 'redemptions-response-shape').redemptions ?? payload.items ?? []; return Object.freeze({ apiVersion: CLOUD_AUTH_API_VERSION, redemptions: redemptions(values) }); }
export function normalizeCloudRedemptionResponse(payload) { object(payload, 'redemption-response-shape'); const source = payload.redemption ?? payload; const hasRedemption = source.id != null || source.creditsGranted != null || source.createdAt != null; return Object.freeze({ apiVersion: CLOUD_AUTH_API_VERSION, redemption: hasRedemption ? redemptions([source])[0] : null, wallet: wallet(payload.wallet) }); }
export function normalizeCloudAiOperationResponse(payload) { object(payload, 'operation-response-shape'); const result = payload.result == null ? null : object(payload.result, 'operation-result-shape'); const usage = result?.usage == null ? null : object(result.usage, 'operation-usage-shape'); const status = ['RESERVED', 'RUNNING', 'SUCCEEDED', 'UNKNOWN_USAGE', 'FAILED'].includes(payload.status) ? payload.status : 'UNKNOWN_USAGE'; return Object.freeze({ apiVersion: CLOUD_AUTH_API_VERSION, id: boundedText(payload.id, 120), status, reservedCredits: boundedCount(payload.reservedCredits), settledCredits: boundedCount(payload.settledCredits), result: result ? Object.freeze({ text: boundedText(result.text, 20_000), usage: usage ? Object.freeze({ inputTokens: boundedCount(usage.inputTokens), outputTokens: boundedCount(usage.outputTokens), totalTokens: boundedCount(usage.totalTokens) }) : null }) : null, errorCode: boundedText(payload.errorCode, 120) }); }
export function entitlementStatus({ account: currentAccount, entitlements: values = [] } = {}) { if (!currentAccount) return AUTH_STATUS.SIGNED_OUT; if (values.some((item) => item.endsAt && Date.parse(item.endsAt) < Date.now())) return AUTH_STATUS.ENTITLEMENT_EXPIRED; if (values.length === 0) return AUTH_STATUS.ENTITLEMENT_REQUIRED; return AUTH_STATUS.AUTHENTICATED; }
