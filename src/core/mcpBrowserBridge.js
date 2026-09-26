import {
  MCP_LIMITS,
  MCP_TRANSPORT_API_VERSION,
  assertBoundedJson,
  isValidRequestId,
  isValidSessionToken,
  parseLocalBridgeEndpoint,
} from './mcpTransport.js';

function makeRequestId(prefix) {
  const suffix = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`.slice(0, 96);
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, abort: () => controller.abort(), clear: () => clearTimeout(timer) };
}

function responseError(code) {
  return {
    apiVersion: MCP_TRANSPORT_API_VERSION,
    requestId: makeRequestId('browser-error'),
    ok: false,
    error: { code },
  };
}

export function connectMcpBrowserBridge({
  endpoint,
  token,
  api = globalThis.__VOLK_ML_AGENT_APPLICATION__,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  origin = globalThis.location?.origin ?? '',
} = {}) {
  const base = parseLocalBridgeEndpoint(endpoint);
  const validToken = isValidSessionToken(token);
  const stopState = { stopped: false, paused: false, disconnected: false, sessionId: null, pollController: null, pollPromise: null, heartbeat: null };
  if (!base || !validToken || typeof fetchImpl !== 'function' || !api || typeof api.request !== 'function') {
    return () => { stopState.stopped = true; };
  }

  async function requestJson(path, { method = 'POST', body, timeoutMs = MCP_LIMITS.heartbeatDeadlineMs } = {}) {
    const timeout = timeoutSignal(timeoutMs);
    try {
      const init = {
        method,
        signal: timeout.signal,
        headers: {
          accept: 'application/json',
          'x-volk-mcp-session-token': token,
        },
      };
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = assertBoundedJson(body, MCP_LIMITS.maxJsonCodeUnits);
      }
      const response = await fetchImpl(`${base}${path}`, init);
      if (!response.ok) return null;
      const value = await response.json();
      assertBoundedJson(value, MCP_LIMITS.maxResponseBytes);
      return value;
    } catch {
      return null;
    } finally {
      timeout.clear();
    }
  }

  async function sendResponse(requestId, response) {
    if (stopState.stopped || !stopState.sessionId || !isValidRequestId(requestId)) return;
    await requestJson('/response', {
      body: { apiVersion: MCP_TRANSPORT_API_VERSION, sessionId: stopState.sessionId, requestId, response },
      timeoutMs: MCP_LIMITS.requestDeadlineMs,
    });
  }

  async function pollLoop() {
    while (!stopState.stopped && !stopState.paused && stopState.sessionId) {
      const timeout = timeoutSignal(MCP_LIMITS.pollDeadlineMs + 1000);
      stopState.pollController = timeout;
      let message = null;
      try {
        const response = await fetchImpl(`${base}/poll?sessionId=${encodeURIComponent(stopState.sessionId)}`, {
          method: 'GET',
          signal: timeout.signal,
          headers: { accept: 'application/json', 'x-volk-mcp-session-token': token },
        });
        if (response.ok && response.status !== 204) {
          message = await response.json();
          assertBoundedJson(message, MCP_LIMITS.maxResponseBytes);
        }
      } catch {
        if (!stopState.stopped) await new Promise((resolve) => setTimeout(resolve, 250));
      } finally {
        timeout.clear();
        stopState.pollController = null;
      }
      if (!message || stopState.stopped) continue;
      if (message.type === 'disconnect') {
        stopState.disconnected = true;
        break;
      }
      if (message.type !== 'request' || !isValidRequestId(message.requestId) || !message.request
        || !Number.isFinite(message.expiresAt) || message.expiresAt <= Date.now()) continue;
      const dispatch = await requestJson('/dispatch', {
        body: { apiVersion: MCP_TRANSPORT_API_VERSION, sessionId: stopState.sessionId, requestId: message.requestId },
        timeoutMs: MCP_LIMITS.heartbeatDeadlineMs,
      });
      if (stopState.stopped || stopState.paused || !dispatch?.active || message.expiresAt <= Date.now()) continue;
      let result;
      try {
        result = await api.request(message.request);
        assertBoundedJson(result, MCP_LIMITS.maxResponseBytes);
      } catch {
        result = responseError('BROWSER_REQUEST_FAILED');
      }
      if (message.expiresAt > Date.now()) await sendResponse(message.requestId, result);
    }
  }

  function startPolling() {
    if (stopState.pollPromise || stopState.stopped || stopState.paused || stopState.disconnected || !stopState.sessionId) return;
    const current = pollLoop();
    stopState.pollPromise = current;
    void current.finally(() => {
      if (stopState.pollPromise === current) stopState.pollPromise = null;
      startPolling();
    });
  }

  async function start() {
    const connected = await requestJson('/connect', {
      body: {
        apiVersion: MCP_TRANSPORT_API_VERSION,
        token,
        origin,
        clientNonce: makeRequestId('browser'),
      },
      timeoutMs: MCP_LIMITS.requestDeadlineMs,
    });
    if (!connected || connected.apiVersion !== MCP_TRANSPORT_API_VERSION || typeof connected.sessionId !== 'string') return;
    stopState.sessionId = connected.sessionId;
    stopState.heartbeat = setInterval(() => {
      void requestJson('/heartbeat', {
        body: { apiVersion: MCP_TRANSPORT_API_VERSION, sessionId: stopState.sessionId },
        timeoutMs: MCP_LIMITS.heartbeatDeadlineMs,
      });
    }, Math.max(1000, Math.floor(MCP_LIMITS.sessionIdleMs / 3)));
    startPolling();
  }

  void start();
  const stop = () => {
    stopState.stopped = true;
    if (stopState.heartbeat) clearInterval(stopState.heartbeat);
    stopState.pollController?.abort();
    if (stopState.sessionId) {
      void requestJson('/disconnect', {
        body: { apiVersion: MCP_TRANSPORT_API_VERSION, sessionId: stopState.sessionId },
        timeoutMs: MCP_LIMITS.heartbeatDeadlineMs,
      });
    }
  };
  stop.pause = () => {
    stopState.paused = true;
    stopState.pollController?.abort();
  };
  stop.resume = () => {
    if (stopState.stopped || stopState.disconnected) return;
    stopState.paused = false;
    startPolling();
  };
  return stop;
}

export function connectMcpBrowserBridgeFromLocation(options = {}) {
  const search = new URLSearchParams(globalThis.location?.search ?? '');
  const endpoint = search.get('mcpBridge');
  const token = search.get('mcpToken');
  if (!endpoint || !token) return () => {};
  return connectMcpBrowserBridge({ ...options, endpoint, token });
}
