import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { connectMcpBrowserBridge } from '../src/core/mcpBrowserBridge.js';
import { MCP_TOOL_NAMES } from '../src/core/mcpTransport.js';

const token = randomBytes(32).toString('base64url');
const origin = 'http://127.0.0.1:5173';
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['scripts/volk-mcp-server.mjs'],
  cwd: process.cwd(),
  env: { ...process.env, VOLK_MCP_PORT: '0', VOLK_MCP_SESSION_TOKEN: token },
  stderr: 'pipe',
  maxBufferSize: 2_000_000,
});
const client = new Client({ name: 'volk-ml-d3-concurrency-check', version: '1.0.0' });
let stopBridge = null;
let serverReadyBuffer = '';

const serverReady = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('MCP_SERVER_READY_TIMEOUT')), 10_000);
  transport.stderr.on('data', (chunk) => {
    serverReadyBuffer += chunk.toString('utf8');
    const lines = serverReadyBuffer.split(/\r?\n/);
    serverReadyBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('VOLK_MCP_READY ')) {
        clearTimeout(timer);
        try { resolve(JSON.parse(line.slice('VOLK_MCP_READY '.length))); } catch { reject(new Error('MCP_SERVER_READY_INVALID')); }
      }
      if (line.startsWith('VOLK_MCP_START_FAILED')) {
        clearTimeout(timer);
        reject(new Error('MCP_SERVER_START_FAILED'));
      }
    }
  });
});

function mcpEnvelope(result) {
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  return text ? JSON.parse(text) : null;
}

async function callTool(name) {
  const response = await client.callTool({ name, arguments: {} });
  const envelope = mcpEnvelope(response);
  assert.ok(envelope, 'MCP calls return their bounded structured envelope.');
  return {
    tool: name,
    isError: response.isError === true,
    ok: envelope.ok === true,
    errorCode: typeof envelope.error?.code === 'string' ? envelope.error.code : null,
  };
}

try {
  const connectedClient = client.connect(transport);
  const ready = await serverReady;
  await connectedClient;

  const browserDispatches = [];
  stopBridge = connectMcpBrowserBridge({
    endpoint: `http://127.0.0.1:${ready.port}/v1/bridge`,
    token,
    origin,
    api: { request: async (request) => {
      browserDispatches.push(request.method);
      await new Promise((resolve) => setTimeout(resolve, 250));
      return {
        apiVersion: 1,
        requestId: request.requestId,
        ok: true,
        result: { method: request.method },
      };
    } },
    fetchImpl: (url, init = {}) => fetch(url, {
      ...init,
      headers: { ...init.headers, origin },
    }),
  });

  let workspaceConnected = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${ready.port}/health`);
    workspaceConnected = (await response.json()).workspaceConnected === true;
    if (workspaceConnected) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(workspaceConnected, true, 'The local browser bridge is connected before MCP calls begin.');

  const initialReads = [
    MCP_TOOL_NAMES.inspectWorkspace,
    MCP_TOOL_NAMES.listCapabilities,
    MCP_TOOL_NAMES.listComponents,
  ];
  const parallel = await Promise.all(initialReads.map(callTool));
  assert.equal(parallel[0].ok, true);
  assert.equal(parallel[1].ok, true);
  assert.deepEqual(parallel[2], {
    tool: MCP_TOOL_NAMES.listComponents,
    isError: true,
    ok: false,
    errorCode: 'MCP_WORKSPACE_BUSY',
  }, 'The bounded D2 transport safely rejects a third simultaneous request.');
  assert.deepEqual(browserDispatches, ['inspectWorkspace', 'listCapabilities'],
    'The rejected third call never reaches the browser API.');

  browserDispatches.length = 0;
  const sequential = [];
  for (const tool of initialReads) sequential.push(await callTool(tool));
  assert.equal(sequential.length, 3);
  assert.ok(sequential.every((result) => result.ok && !result.isError && result.errorCode === null));
  assert.deepEqual(browserDispatches, ['inspectWorkspace', 'listCapabilities', 'listComponents']);

  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    test: 'D3 initial MCP inspection concurrency',
    parallelNegativeControl: {
      calls: initialReads,
      rejectedTool: MCP_TOOL_NAMES.listComponents,
      errorCode: parallel[2].errorCode,
      browserDispatchCount: 2,
    },
    sequentialPositiveControl: {
      calls: sequential.map((result) => result.tool),
      completedCount: sequential.length,
    },
    transportLimitPreserved: 2,
    modelCalls: 0,
  })}\n`);
} finally {
  stopBridge?.();
  try { await client.close(); } catch {}
  try { await transport.close(); } catch {}
}
