import { endpointSafety } from './aiSettings.js';
import { getProviderProtocol } from './providerRegistry.js';
import { createExplorationAiInterpreter } from '../exploration/explorationAiInterpreter.js';
import { createAiDiagnostic } from './diagnostics.js';

const probeSchema = {
  name: 'volk_ml_connection_probe',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
  },
};

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `ai-probe-${Date.now()}`;
}

function stage(id, status, diagnostic = null) {
  return { id, status, ...(diagnostic ? { code: diagnostic.errorCode, diagnostic } : {}) };
}

function result({ status, requestId, started, stages, gateway }) {
  return {
    version: 1,
    status,
    requestId,
    latencyMs: Date.now() - started,
    stages,
    requestTrace: gateway?.getRequestTrace?.().slice(-8) ?? [],
  };
}

export async function probeProviderConnection({ gateway, config } = {}) {
  const requestId = makeId();
  const stages = [];
  const started = Date.now();
  const protocol = getProviderProtocol(config?.protocol);
  const endpoint = config?.endpoint || protocol?.defaultEndpoint || '';
  const safety = endpointSafety(endpoint);
  if (!config?.apiKey?.trim() || !config?.model?.trim()) {
    const diagnostic = createAiDiagnostic({
      error: { code: 'AI_CONFIG_MISSING', message: 'Provider configuration is incomplete.' },
      config: { ...config, endpoint },
      stage: 'configuration',
      requestId,
    });
    stages.push(stage('configuration', 'failed', diagnostic));
    return result({ status: 'failed', requestId, started, stages, gateway });
  }
  if (!safety.safe) {
    const diagnostic = createAiDiagnostic({
      error: { code: 'AI_ENDPOINT_INVALID', message: 'Provider endpoint is not safe.' },
      config: { ...config, endpoint },
      stage: 'configuration',
      requestId,
    });
    stages.push(stage('configuration', 'failed', diagnostic));
    return result({ status: 'failed', requestId, started, stages, gateway });
  }
  stages.push(stage('configuration', 'passed'));

  const call = async (stageId, callback) => {
    const callStarted = Date.now();
    try {
      const value = await callback();
      stages.push({ id: stageId, status: 'passed', latencyMs: Date.now() - callStarted });
      return value;
    } catch (error) {
      const diagnostic = createAiDiagnostic({
        error,
        config: { ...config, endpoint },
        stage: stageId,
        requestId,
        latencyMs: Date.now() - callStarted,
      });
      stages.push(stage(stageId, 'failed', diagnostic));
      return null;
    }
  };

  const basic = await call('network', async () => {
    const response = await gateway.complete({
      config,
      system: 'Return one short availability word. Do not include learner or application data.',
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      responseMode: 'text',
    });
    if (!response.text.trim()) {
      const error = new Error('Provider returned no text.');
      error.code = 'AI_OUTPUT_MISSING';
      throw error;
    }
    return response;
  });
  if (!basic) return result({ status: 'failed', requestId, started, stages, gateway });
  stages.push(stage('authentication', 'passed'));
  stages.push(stage('model', 'passed'));
  stages.push(stage('basic-text', 'passed'));

  const structured = await call('structured-output', async () => {
    const response = await gateway.complete({
      config,
      system: 'Return only the requested probe JSON.',
      messages: [{ role: 'user', content: 'Return {"ok":true}.' }],
      responseMode: 'json',
      responseSchema: probeSchema,
    });
    let parsed;
    try { parsed = JSON.parse(response.text); } catch {
      const error = new Error('Structured output was not valid JSON.');
      error.code = 'AI_STRUCTURED_OUTPUT_UNSUPPORTED';
      throw error;
    }
    if (parsed?.ok !== true) {
      const error = new Error('Structured output did not satisfy the VOLK probe schema.');
      error.code = 'AI_STRUCTURED_OUTPUT_UNSUPPORTED';
      throw error;
    }
    return parsed;
  });
  if (!structured) return result({ status: 'failed', requestId, started, stages, gateway });

  const interpreter = createExplorationAiInterpreter({ gateway });
  const interpreted = await call('interpreter', () => interpreter.interpret({
    request: 'What does a training step mean?',
    context: { presentation: { availableDepths: ['mechanism', 'evidence'] } },
    config,
  }));
  if (!interpreted) return result({ status: 'failed', requestId, started, stages, gateway });
  return result({ status: 'ready', requestId, started, stages, gateway });
}
