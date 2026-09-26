import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import {
  MCP_BRIDGE_METHODS,
  MCP_LIMITS,
  MCP_TOOL_NAMES,
  MCP_TRANSPORT_API_VERSION,
  assertBoundedJson,
  isLocalOrigin,
  isValidRequestId,
  isValidSessionToken,
  makeMcpRequest,
  safeMcpError,
} from '../src/core/mcpTransport.js';

const HOST = '127.0.0.1';
const mcpRequestKey = (id) => `${typeof id}:${String(id)}`;
const configuredPort = Number.parseInt(process.env.VOLK_MCP_PORT ?? '0', 10);
const sessionToken = process.env.VOLK_MCP_SESSION_TOKEN ?? '';
if (!Number.isInteger(configuredPort) || configuredPort < 0 || configuredPort > 65535) {
  console.error('VOLK_MCP_START_FAILED MCP_PORT_INVALID');
  process.exit(1);
}
if (!isValidSessionToken(sessionToken)) {
  console.error('VOLK_MCP_START_FAILED MCP_SESSION_TOKEN_REQUIRED');
  process.exit(1);
}

function requestOrigin(request) {
  const origin = request.headers.origin;
  return typeof origin === 'string' && isLocalOrigin(origin) ? origin : null;
}

function writeJson(response, status, value, origin = null) {
  let serialized;
  try { serialized = assertBoundedJson(value, MCP_LIMITS.maxResponseBytes); } catch {
    serialized = JSON.stringify({ ok: false, error: { code: 'MCP_RESPONSE_TOO_LARGE' } });
    status = 413;
  }
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(serialized, 'utf8'),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin';
  }
  response.writeHead(status, headers);
  response.end(serialized);
}

function writeEmpty(response, status, origin = null) {
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin';
  }
  response.writeHead(status, headers);
  response.end();
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MCP_LIMITS.maxBodyBytes) throw Object.assign(new Error('MCP_BODY_TOO_LARGE'), { code: 'MCP_BODY_TOO_LARGE' });
    chunks.push(chunk);
  }
  if (!total) return {};
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
    throw Object.assign(new Error('MCP_JSON_INVALID'), { code: 'MCP_JSON_INVALID' });
  }
  assertBoundedJson(value);
  return value;
}

function headerToken(request) {
  const token = request.headers['x-volk-mcp-session-token'];
  return typeof token === 'string' ? token : '';
}

class BrowserSessionBridge {
  constructor() {
    this.session = null;
    this.pollWaiters = [];
    this.pending = new Map();
    this.pendingByMcpRequest = new Map();
    this.queue = [];
    this.closed = false;
  }

  connect({ token, origin, clientNonce }) {
    if (token !== sessionToken || !isLocalOrigin(origin) || typeof clientNonce !== 'string' || !isValidRequestId(clientNonce)) {
      return { ok: false, error: safeMcpError('MCP_SESSION_REJECTED') };
    }
    if (this.session) return { ok: false, error: safeMcpError('MCP_SESSION_ALREADY_BOUND') };
    const sessionId = randomUUID();
    this.session = { sessionId, origin, clientNonce, lastSeen: Date.now() };
    return { apiVersion: MCP_TRANSPORT_API_VERSION, sessionId, bridgePath: '/v1/bridge', expiresInMs: MCP_LIMITS.sessionIdleMs };
  }

  authenticate(request, body = null) {
    const active = this.session;
    const bodySessionId = body?.sessionId;
    const sessionId = typeof bodySessionId === 'string' ? bodySessionId : new URL(request.url, `http://${HOST}`).searchParams.get('sessionId');
    const origin = requestOrigin(request);
    if (!active || headerToken(request) !== sessionToken || sessionId !== active.sessionId || origin !== active.origin) return null;
    active.lastSeen = Date.now();
    return active;
  }

  disconnect(sessionId) {
    if (!this.session || sessionId !== this.session.sessionId) return;
    for (const pending of [...this.pending.values()]) {
      this.finishPending(pending, { apiVersion: MCP_TRANSPORT_API_VERSION, requestId: pending.requestId, ok: false, error: safeMcpError('MCP_WORKSPACE_DISCONNECTED') });
    }
    this.queue = [];
    for (const waiter of this.pollWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      writeJson(waiter.response, 200, { type: 'disconnect' }, this.session.origin);
    }
    this.session = null;
  }

  heartbeat(sessionId) {
    if (!this.session || sessionId !== this.session.sessionId) return false;
    this.session.lastSeen = Date.now();
    return true;
  }

  poll(request, response) {
    if (!this.session) return writeJson(response, 409, { ok: false, error: safeMcpError('MCP_WORKSPACE_DISCONNECTED') }, requestOrigin(request));
    const message = this.takeQueuedRequest();
    if (message) return writeJson(response, 200, message, this.session.origin);
    if (this.pollWaiters.length >= 1) return writeJson(response, 429, { ok: false, error: safeMcpError('MCP_POLL_BUSY') }, this.session.origin);
    const timer = setTimeout(() => {
      const index = this.pollWaiters.findIndex((item) => item.response === response);
      if (index >= 0) this.pollWaiters.splice(index, 1);
      writeJson(response, 200, { type: 'keepalive' }, this.session?.origin ?? null);
    }, MCP_LIMITS.pollDeadlineMs);
    this.pollWaiters.push({ response, timer });
  }

  deliverNext() {
    if (!this.pollWaiters.length) return;
    const message = this.takeQueuedRequest();
    const waiter = this.pollWaiters.shift();
    if (!message || !waiter) return;
    clearTimeout(waiter.timer);
    const pending = this.pending.get(message.requestId);
    if (!pending) return writeJson(waiter.response, 200, { type: 'keepalive' }, this.session?.origin ?? null);
    pending.state = 'delivered';
    writeJson(waiter.response, 200, message, this.session?.origin ?? null);
  }

  takeQueuedRequest() {
    while (this.queue.length) {
      const message = this.queue.shift();
      const pending = this.pending.get(message.requestId);
      if (!pending || pending.state !== 'queued' || pending.expiresAt <= Date.now()) continue;
      pending.state = 'delivered';
      return message;
    }
    return null;
  }

  removeQueuedRequest(requestId) {
    this.queue = this.queue.filter((item) => item.requestId !== requestId);
  }

  cleanupPending(pending) {
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener('abort', pending.onAbort);
    this.pending.delete(pending.requestId);
    if (pending.mcpRequestId !== undefined) this.pendingByMcpRequest.delete(mcpRequestKey(pending.mcpRequestId));
    this.removeQueuedRequest(pending.requestId);
  }

  finishPending(pending, value) {
    if (this.pending.get(pending.requestId) !== pending) return false;
    this.cleanupPending(pending);
    pending.resolve(value);
    return true;
  }

  cancelPending(pending) {
    if (this.pending.get(pending.requestId) !== pending) return false;
    this.cleanupPending(pending);
    const error = Object.assign(new Error('MCP_WORKSPACE_CANCELLED'), { code: 'MCP_WORKSPACE_CANCELLED' });
    pending.reject(error);
    return true;
  }

  cancelMcpRequest(mcpRequestId) {
    const requestId = this.pendingByMcpRequest.get(mcpRequestKey(mcpRequestId));
    const pending = requestId ? this.pending.get(requestId) : null;
    if (pending) this.cancelPending(pending);
  }

  claimDispatch(requestId) {
    const pending = this.pending.get(requestId);
    if (!pending || pending.state !== 'delivered' || pending.expiresAt <= Date.now()) return false;
    pending.state = 'dispatched';
    return true;
  }

  submitResponse(body) {
    if (!this.session || !isValidRequestId(body?.requestId)) return false;
    const pending = this.pending.get(body.requestId);
    if (!pending || pending.state !== 'dispatched' || pending.expiresAt <= Date.now()) return false;
    try { assertBoundedJson(body.response, MCP_LIMITS.maxResponseBytes); } catch { return false; }
    return this.finishPending(pending, body.response);
  }

  request(request, { signal, mcpRequestId } = {}) {
    if (!this.session) return Promise.resolve({ apiVersion: MCP_TRANSPORT_API_VERSION, requestId: request.requestId, ok: false, error: safeMcpError('MCP_WORKSPACE_DISCONNECTED') });
    if (signal?.aborted) return Promise.reject(Object.assign(new Error('MCP_WORKSPACE_CANCELLED'), { code: 'MCP_WORKSPACE_CANCELLED' }));
    if (this.pending.size >= MCP_LIMITS.maxPendingRequests || this.queue.length >= MCP_LIMITS.maxPendingRequests) {
      return Promise.resolve({ apiVersion: MCP_TRANSPORT_API_VERSION, requestId: request.requestId, ok: false, error: safeMcpError('MCP_WORKSPACE_BUSY') });
    }
    return new Promise((resolve, reject) => {
      const expiresAt = Date.now() + MCP_LIMITS.requestDeadlineMs;
      const pending = { requestId: request.requestId, resolve, reject, signal, mcpRequestId, expiresAt, state: 'queued', timer: null, onAbort: null };
      pending.onAbort = () => this.cancelPending(pending);
      const timer = setTimeout(() => {
        this.finishPending(pending, { apiVersion: MCP_TRANSPORT_API_VERSION, requestId: request.requestId, ok: false, error: safeMcpError('MCP_WORKSPACE_DEADLINE') });
      }, MCP_LIMITS.requestDeadlineMs);
      pending.timer = timer;
      this.pending.set(request.requestId, pending);
      if (mcpRequestId !== undefined) this.pendingByMcpRequest.set(mcpRequestKey(mcpRequestId), request.requestId);
      signal?.addEventListener('abort', pending.onAbort, { once: true });
      this.queue.push({ type: 'request', requestId: request.requestId, expiresAt, request });
      this.deliverNext();
    });
  }

  expireIdle() {
    if (this.session && Date.now() - this.session.lastSeen > MCP_LIMITS.sessionIdleMs) this.disconnect(this.session.sessionId);
  }
}

function toolEnvelope(response) {
  const safe = response && typeof response === 'object'
    ? response
    : { apiVersion: MCP_TRANSPORT_API_VERSION, requestId: 'mcp-invalid', ok: false, error: safeMcpError('MCP_RESPONSE_INVALID') };
  let text;
  try { text = JSON.stringify(safe); } catch { text = JSON.stringify({ ok: false, error: safeMcpError('MCP_RESPONSE_INVALID') }); }
  return {
    content: [{ type: 'text', text }],
    structuredContent: safe,
    isError: safe.ok !== true,
  };
}

function createMcpServer(bridge) {
  const server = new McpServer({ name: 'volk-ml-local-workspace', version: '1.0.0' });
  server.server.setNotificationHandler('notifications/cancelled', (notification) => {
    bridge.cancelMcpRequest(notification.params?.requestId);
  });
  const empty = z.object({}).strict();
  const proposal = z.object({ proposal: z.unknown() }).strict();
  const framework = z.object({ framework: z.enum(['pytorch', 'tensorflow']) }).strict();
  const output = z.object({
    apiVersion: z.number(),
    requestId: z.string(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
  }).strict();
  const definitions = [
    ['inspectWorkspace', 'Inspect the mounted VOLK workspace using the row-free D1 projection.', empty],
    ['listComponents', 'List bounded component capabilities without free-form graph values.', empty],
    ['listCapabilities', 'Inspect current compiler, browser, tier, and authority capabilities.', empty],
    ['submitGraphProposal', 'Stage a whole-graph proposal for the existing learner preview; never Apply it.', proposal],
    ['submitGraphPatchProposal', 'Stage a graph patch proposal for the existing learner preview; never Apply it.', proposal],
    ['inspectProposal', 'Inspect current proposal eligibility and bounded lifecycle metadata.', empty],
    ['inspectResults', 'Inspect current browser-local result freshness and safe scalar metrics.', empty],
    ['exportGraph', 'Export source through the local compiler without execution or download.', framework],
    ['run', 'Request a run; the mounted application always requires explicit learner confirmation.', empty],
  ];
  for (const [method, description, inputSchema] of definitions) {
    server.registerTool(MCP_TOOL_NAMES[method], {
      title: MCP_TOOL_NAMES[method],
      description,
      inputSchema,
      outputSchema: output,
      annotations: { readOnlyHint: method !== 'submitGraphProposal' && method !== 'submitGraphPatchProposal', destructiveHint: false, openWorldHint: false },
    }, async (args, context) => {
      const requestId = `mcp-${randomUUID()}`.slice(0, 96);
      try {
        const request = makeMcpRequest({ requestId, method: MCP_BRIDGE_METHODS[method], params: args ?? {} });
        const response = await bridge.request(request, { signal: context?.signal, mcpRequestId: context?.mcpReq?.id });
        return toolEnvelope(response);
      } catch (error) {
        if (context?.signal?.aborted || error?.code === 'MCP_WORKSPACE_CANCELLED') throw error;
        return toolEnvelope({ apiVersion: MCP_TRANSPORT_API_VERSION, requestId, ok: false, error: safeMcpError(error?.code ?? error?.message) });
      }
    });
  }
  return server;
}

function createBridgeServer(bridge) {
  return http.createServer(async (request, response) => {
    const origin = requestOrigin(request);
    const url = new URL(request.url ?? '/', `http://${HOST}`);
    if (request.method === 'OPTIONS') {
      if (!origin) return writeEmpty(response, 403);
      response.writeHead(204, {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type,x-volk-mcp-session-token',
        'access-control-max-age': '60',
        vary: 'Origin',
      });
      return response.end();
    }
    if (url.pathname === '/health' && request.method === 'GET') {
      return writeJson(response, 200, { apiVersion: MCP_TRANSPORT_API_VERSION, ok: true, workspaceConnected: Boolean(bridge.session) });
    }
    if (url.pathname !== '/v1/bridge/connect' && url.pathname !== '/v1/bridge/poll' && url.pathname !== '/v1/bridge/dispatch' && url.pathname !== '/v1/bridge/response'
      && url.pathname !== '/v1/bridge/heartbeat' && url.pathname !== '/v1/bridge/disconnect') return writeJson(response, 404, { ok: false, error: safeMcpError('MCP_ROUTE_NOT_FOUND') }, origin);
    if (!origin) return writeJson(response, 403, { ok: false, error: safeMcpError('MCP_ORIGIN_REJECTED') });
    try {
      if (url.pathname === '/v1/bridge/connect' && request.method === 'POST') {
        const body = await readJson(request);
        if (body.origin !== origin) return writeJson(response, 403, { ok: false, error: safeMcpError('MCP_ORIGIN_REJECTED') }, origin);
        const result = bridge.connect(body);
        return writeJson(response, result.ok === false ? 403 : 200, result, origin);
      }
      if (url.pathname === '/v1/bridge/poll' && request.method === 'GET') {
        if (!bridge.authenticate(request)) return writeJson(response, 401, { ok: false, error: safeMcpError('MCP_SESSION_REJECTED') }, origin);
        return bridge.poll(request, response);
      }
      if (request.method !== 'POST') return writeJson(response, 405, { ok: false, error: safeMcpError('MCP_METHOD_NOT_ALLOWED') }, origin);
      const body = await readJson(request);
      if (!bridge.authenticate(request, body)) return writeJson(response, 401, { ok: false, error: safeMcpError('MCP_SESSION_REJECTED') }, origin);
      if (url.pathname === '/v1/bridge/heartbeat') return writeJson(response, 200, { apiVersion: MCP_TRANSPORT_API_VERSION, ok: true }, origin);
      if (url.pathname === '/v1/bridge/dispatch') {
        const accepted = bridge.claimDispatch(body.requestId);
        return writeJson(response, accepted ? 200 : 409, { apiVersion: MCP_TRANSPORT_API_VERSION, active: accepted }, origin);
      }
      if (url.pathname === '/v1/bridge/disconnect') {
        bridge.disconnect(body.sessionId);
        return writeJson(response, 200, { apiVersion: MCP_TRANSPORT_API_VERSION, ok: true }, origin);
      }
      if (url.pathname === '/v1/bridge/response') {
        const accepted = bridge.submitResponse(body);
        return writeJson(response, accepted ? 200 : 409, { apiVersion: MCP_TRANSPORT_API_VERSION, ok: accepted }, origin);
      }
      return writeJson(response, 404, { ok: false, error: safeMcpError('MCP_ROUTE_NOT_FOUND') }, origin);
    } catch (error) {
      const code = error?.code === 'MCP_BODY_TOO_LARGE' ? 'MCP_BODY_TOO_LARGE' : error?.code === 'MCP_JSON_INVALID' ? 'MCP_JSON_INVALID' : 'MCP_REQUEST_INVALID';
      return writeJson(response, code === 'MCP_BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: safeMcpError(code) }, origin);
    }
  });
}

const bridge = new BrowserSessionBridge();
const httpServer = createBridgeServer(bridge);
const timer = setInterval(() => bridge.expireIdle(), 2000);
httpServer.on('error', (error) => console.error(`VOLK_MCP_BRIDGE_ERROR ${error.code ?? 'UNKNOWN'}`));
await new Promise((resolve, reject) => {
  httpServer.once('error', reject);
  httpServer.listen(configuredPort, HOST, resolve);
});
const port = httpServer.address().port;
console.error(`VOLK_MCP_READY ${JSON.stringify({ apiVersion: MCP_TRANSPORT_API_VERSION, port, host: HOST, bridgePath: '/v1/bridge', sessionTokenConfigured: true })}`);

const handle = serveStdio(() => createMcpServer(bridge));
async function shutdown() {
  clearInterval(timer);
  bridge.disconnect(bridge.session?.sessionId);
  await handle.close();
  await new Promise((resolve) => httpServer.close(() => resolve()));
}
process.once('SIGINT', () => { void shutdown().finally(() => process.exit(0)); });
process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(0)); });
