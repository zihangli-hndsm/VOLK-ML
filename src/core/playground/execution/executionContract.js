// Shared execution metadata for future heavier Phase 9 adapters. The current
// slices are synchronous, but every adapter now has one bounded place to
// declare whether a later runner may schedule work asynchronously.

export const EXECUTION_MODES = Object.freeze(['sync', 'async']);
export const EXECUTION_STATUSES = Object.freeze(['idle', 'running', 'completed', 'failed', 'cancelled']);

export function normalizeExecutionCapability(value = {}) {
  const mode = EXECUTION_MODES.includes(value.mode) ? value.mode : 'sync';
  return {
    mode,
    supportsCancellation: Boolean(value.supportsCancellation),
    maxConcurrentRuns: Number.isInteger(value.maxConcurrentRuns) && value.maxConcurrentRuns > 0
      ? Math.min(4, value.maxConcurrentRuns)
      : 1,
  };
}

export function createExecutionRequest({ sessionId, domain, operation, inputFingerprint = null } = {}) {
  if (typeof sessionId !== 'string' || !sessionId || typeof domain !== 'string' || !domain || typeof operation !== 'string' || !operation) {
    throw Object.assign(new Error('INVALID_EXECUTION_REQUEST'), { code: 'INVALID_EXECUTION_REQUEST' });
  }
  return {
    version: 1,
    sessionId,
    domain,
    operation,
    inputFingerprint: typeof inputFingerprint === 'string' ? inputFingerprint.slice(0, 256) : null,
  };
}

export function normalizeExecutionStatus(value = {}) {
  const status = EXECUTION_STATUSES.includes(value.status) ? value.status : 'idle';
  return {
    version: 1,
    status,
    runId: typeof value.runId === 'string' ? value.runId.slice(0, 128) : null,
    errorCode: typeof value.errorCode === 'string' ? value.errorCode.slice(0, 128) : null,
  };
}
