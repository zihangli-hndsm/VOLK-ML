import { createAgentRequest, taskContractPrompt } from '../../core/ai/agentRequestContract.js';

const MAX_MESSAGES = 20;
const MAX_MESSAGE_TEXT = 12_000;

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

export function createCloudAiGateway({ client, getAccessToken, onSettled } = {}) {
  const unavailable = () => {
    const error = new Error('VOLK_CLOUD_AI_UNAVAILABLE');
    error.code = 'VOLK_CLOUD_AI_UNAVAILABLE';
    throw error;
  };
  return Object.freeze({
    kind: 'volk-cloud',
    async complete({ system = '', messages = [], responseMode = 'text', responseSchema = null, taskMode = null, taskContext = null, taskInput = null, taskContract = null, requestId: requestedRequestId = null } = {}) {
      if (!client?.createAiOperation || typeof getAccessToken !== 'function') return unavailable();
      const boundedMessages = (Array.isArray(messages) ? messages : []).slice(-MAX_MESSAGES).map((message) => `${message?.role === 'assistant' ? 'Assistant' : 'Learner'}: ${boundedMessage(message?.content)}`);
      const schema = safeSchema(responseSchema);
      const operationRequestId = String(requestedRequestId ?? requestId()).slice(0, 96);
      let contractPrompt = '';
      if (taskMode) {
        const taskRequest = createAgentRequest({ taskMode, requestId: operationRequestId, context: taskContext ?? {}, input: taskInput, contract: taskContract });
        contractPrompt = taskContractPrompt(taskRequest);
      }
      const prompt = [boundedMessage(system), contractPrompt, ...boundedMessages, responseMode === 'json' && schema ? `Return JSON matching this schema: ${JSON.stringify(schema)}` : ''].filter(Boolean).join('\n').slice(0, 40_000);
      const operation = { operationType: 'lumi-dialogue', input: { prompt } };
      const result = await client.createAiOperation({ accessToken: getAccessToken(), requestId: operationRequestId, operation });
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
      onSettled?.(result);
      return {
        text: result.result.text,
        provider: 'VOLK Cloud',
        protocol: 'volk-cloud-v1',
        model: 'platform-selected',
        usage: result.result.usage,
        wallet: { reservedCredits: result.reservedCredits, spentCredits: result.settledCredits },
      };
    },
    getRequestTrace() { return []; },
  });
}
