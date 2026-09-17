import { createAgentRequest, taskContractPrompt } from '../../core/ai/agentRequestContract.js';

const MAX_MESSAGES = 20;
const MAX_MESSAGE_TEXT = 12_000;
const MAX_CLOUD_PROMPT_BYTES = 14_000;

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `volk-cloud-operation-${Date.now()}`;
}

function boundedMessage(value) {
  return String(value ?? '').slice(0, MAX_MESSAGE_TEXT);
}

function safeSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return null;
  try {
    const serialized = JSON.stringify(schema);
    return serialized.length <= 40_000 ? JSON.parse(serialized) : null;
  } catch {
    return null;
  }
}

function claimCloudAttempt(attemptBudget) {
  if (!attemptBudget || typeof attemptBudget !== 'object') return { attempt: 1 };
  const max = Number.isFinite(Number(attemptBudget.max)) ? Math.max(1, Math.floor(Number(attemptBudget.max))) : 2;
  const used = Number.isFinite(Number(attemptBudget.used)) ? Math.max(0, Math.floor(Number(attemptBudget.used))) : 0;
  if (used >= max) {
    const error = new Error('VOLK_CLOUD_ATTEMPT_BUDGET_EXHAUSTED');
    error.code = 'VOLK_CLOUD_ATTEMPT_BUDGET_EXHAUSTED';
    error.details = { stage: 'provider', reason: 'logical-attempt-budget', attempts: used, maxAttempts: max };
    throw error;
  }
  const record = { attempt: used + 1, status: 'started', usage: null };
  attemptBudget.max = max;
  attemptBudget.used = used + 1;
  attemptBudget.records = Array.isArray(attemptBudget.records) ? attemptBudget.records : [];
  attemptBudget.records.push(record);
  return record;
}

function promptBytes(value) {
  try { return new TextEncoder().encode(String(value ?? '')).length; } catch { return String(value ?? '').length; }
}

function boundedCloudPrompt(parts) {
  const withSchema = parts.filter(Boolean).join('\n').trim();
  if (promptBytes(withSchema) <= MAX_CLOUD_PROMPT_BYTES) return withSchema;
  const withoutSchema = parts.filter((part) => part && !String(part).startsWith('Return JSON matching this schema:')).join('\n').trim();
  if (promptBytes(withoutSchema) <= MAX_CLOUD_PROMPT_BYTES) return withoutSchema;
  let result = withoutSchema;
  while (promptBytes(result) > MAX_CLOUD_PROMPT_BYTES && result.length > 0) result = result.slice(0, Math.max(0, result.length - 256));
  return result;
}

export function createCloudAiGateway({ client, getAccessToken, onSettled } = {}) {
  const unavailable = () => {
    const error = new Error('VOLK_CLOUD_AI_UNAVAILABLE');
    error.code = 'VOLK_CLOUD_AI_UNAVAILABLE';
    throw error;
  };
  return Object.freeze({
    kind: 'volk-cloud',
    async complete({ system = '', messages = [], responseMode = 'text', responseSchema = null, taskMode = null, taskContext = null, taskInput = null, taskContract = null, requestId: requestedRequestId = null, signal = undefined, attemptBudget = null } = {}) {
      if (!client?.createAiOperation || typeof getAccessToken !== 'function') return unavailable();
      const boundedMessages = (Array.isArray(messages) ? messages : []).slice(-MAX_MESSAGES).map((message) => `${message?.role === 'assistant' ? 'Assistant' : 'Learner'}: ${boundedMessage(message?.content)}`);
      const schema = safeSchema(responseSchema);
      const operationRequestId = String(requestedRequestId ?? requestId()).slice(0, 96);
      const attempt = claimCloudAttempt(attemptBudget ?? { max: 2, used: 0, records: [] });
      let contractPrompt = '';
      if (taskMode) {
        const taskRequest = createAgentRequest({ taskMode, requestId: operationRequestId, context: taskContext ?? {}, input: taskInput, contract: taskContract });
        contractPrompt = taskContractPrompt(taskRequest);
      }
      const logicalPrompt = [boundedMessage(system), contractPrompt, ...boundedMessages, responseMode === 'json' && schema ? `Return JSON matching this schema: ${JSON.stringify(schema)}` : ''];
      const prompt = boundedCloudPrompt(logicalPrompt);
      const operation = { operationType: 'lumi-dialogue', input: { prompt } };
      const attemptRequestId = `${operationRequestId}:attempt-${attempt.attempt}`.slice(0, 120);
      try {
        const result = await client.createAiOperation({ accessToken: getAccessToken(), requestId: attemptRequestId, operation, signal });
        if (result.status === 'pending' || result.status === 'unknown') {
          const error = new Error('VOLK_CLOUD_OPERATION_PENDING');
          error.code = 'VOLK_CLOUD_OPERATION_PENDING';
          throw error;
        }
        if (result.status !== 'SUCCEEDED' || !result.result?.text) {
          const error = new Error('VOLK_CLOUD_PROVIDER_UNAVAILABLE');
          error.code = 'VOLK_CLOUD_PROVIDER_UNAVAILABLE';
          throw error;
        }
        attempt.status = 'completed';
        attempt.usage = result.result.usage ?? null;
        onSettled?.(result);
        return {
          text: result.result.text,
          provider: 'VOLK Cloud',
          protocol: 'volk-cloud-v1',
          model: 'platform-selected',
          usage: result.result.usage,
          wallet: { reservedCredits: result.reservedCredits, spentCredits: result.settledCredits },
        };
      } catch (error) {
        attempt.status = signal?.aborted ? 'aborted' : 'failed';
        throw error;
      }
    },
    getRequestTrace() { return []; },
  });
}
