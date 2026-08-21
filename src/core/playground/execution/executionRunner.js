import { normalizeExecutionCapability, normalizeExecutionStatus } from './executionContract.js';

// A small adapter-neutral runner seam for future expensive domain operations.
// It owns run identity, bounded concurrency, and cancellation state only; it
// never commits World/Experiment state and never makes animation or UI state
// part of execution.
export function createExecutionRunner({ capability = {}, execute } = {}) {
  const normalized = normalizeExecutionCapability(capability);
  if (typeof execute !== 'function') throw Object.assign(new Error('INVALID_EXECUTION_RUNNER'), { code: 'INVALID_EXECUTION_RUNNER' });
  let sequence = 0;
  const active = new Map();

  const run = async (request, { replace = false } = {}) => {
    if (active.size >= normalized.maxConcurrentRuns) {
      if (!replace || !normalized.supportsCancellation) {
        return { ...normalizeExecutionStatus({ status: 'failed', errorCode: 'EXECUTION_BUSY' }), runId: null };
      }
      for (const current of active.values()) current.controller.abort();
    }
    const runId = `execution-${++sequence}`;
    const controller = new AbortController();
    active.set(runId, { controller });
    try {
      const value = await execute({ request, runId, signal: controller.signal });
      if (controller.signal.aborted) return { ...normalizeExecutionStatus({ status: 'cancelled', runId }), value: null };
      return { ...normalizeExecutionStatus({ status: 'completed', runId }), value };
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        return { ...normalizeExecutionStatus({ status: 'cancelled', runId }), value: null };
      }
      return { ...normalizeExecutionStatus({ status: 'failed', runId, errorCode: error?.code ?? 'EXECUTION_FAILED' }), value: null };
    } finally {
      active.delete(runId);
    }
  };

  return Object.freeze({
    capability: normalized,
    run,
    cancel(runId) {
      const current = active.get(runId);
      if (!current || !normalized.supportsCancellation) return false;
      current.controller.abort();
      return true;
    },
    status() {
      return { running: active.size > 0, activeRunCount: active.size };
    },
  });
}
