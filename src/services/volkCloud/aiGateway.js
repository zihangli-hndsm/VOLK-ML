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
    async complete({ system = '', messages = [], responseMode = 'text', responseSchema = null } = {}) {
      if (!client?.createAiOperation || typeof getAccessToken !== 'function') return unavailable();
      const boundedMessages = (Array.isArray(messages) ? messages : []).slice(-MAX_MESSAGES).map((message) => `${message?.role === 'assistant' ? 'Assistant' : 'Learner'}: ${boundedMessage(message?.content)}`);
      const schema = safeSchema(responseSchema);
      const prompt = [boundedMessage(system), ...boundedMessages, responseMode === 'json' && schema ? `Return JSON matching this schema: ${JSON.stringify(schema)}` : ''].filter(Boolean).join('\n').slice(0, 40_000);
      const operation = { operationType: 'lumi-dialogue', input: { prompt } };
      const result = await client.createAiOperation({ accessToken: getAccessToken(), requestId: requestId(), operation });
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
