import assert from 'node:assert/strict';
import {
  MCP_BRIDGE_PATH,
  MCP_LIMITS,
  MCP_TOOL_NAMES,
  MCP_TRANSPORT_API_VERSION,
  assertBoundedJson,
  isLocalOrigin,
  isValidRequestId,
  isValidSessionToken,
  makeMcpRequest,
  parseLocalBridgeEndpoint,
  safeMcpError,
} from '../src/core/mcpTransport.js';

assert.equal(MCP_TRANSPORT_API_VERSION, 1);
assert.equal(MCP_BRIDGE_PATH, '/v1/bridge');
assert.equal(Object.keys(MCP_TOOL_NAMES).length, 9);
assert.equal(isLocalOrigin('http://127.0.0.1:5173'), true);
assert.equal(isLocalOrigin('http://localhost:5182'), true);
assert.equal(isLocalOrigin('https://127.0.0.1:5173'), false);
assert.equal(isLocalOrigin('http://evil.example'), false);
assert.equal(isLocalOrigin('http://127.0.0.1:5173.evil.example'), false);
assert.equal(parseLocalBridgeEndpoint('http://127.0.0.1:5180/v1/bridge'), 'http://127.0.0.1:5180/v1/bridge');
assert.equal(parseLocalBridgeEndpoint('http://127.0.0.1:5180/v1/bridge/'), 'http://127.0.0.1:5180/v1/bridge');
assert.equal(parseLocalBridgeEndpoint('http://127.0.0.1:5180/other'), null);
assert.equal(parseLocalBridgeEndpoint('http://evil.example:5180/v1/bridge'), null);
assert.equal(isValidSessionToken('0123456789abcdef0123456789abcdef'), true);
assert.equal(isValidSessionToken('short'), false);
assert.equal(isValidRequestId('mcp-request-1'), true);
assert.equal(isValidRequestId('bad request'), false);

const request = makeMcpRequest({ requestId: 'transport-test-1', method: 'inspectWorkspace', params: {} });
assert.deepEqual(request, { apiVersion: 1, requestId: 'transport-test-1', method: 'inspectWorkspace', params: {} });
assert.throws(() => makeMcpRequest({ requestId: 'transport-test-2', method: 'unknown', params: {} }), /MCP_REQUEST_INVALID/);
assert.throws(() => assertBoundedJson({ value: 'x'.repeat(MCP_LIMITS.maxJsonCodeUnits + 1) }), /MCP_JSON_BOUND/);
assert.throws(() => assertBoundedJson({ value: Number.NaN }), /MCP_JSON_VALUE/);
assert.deepEqual(safeMcpError('MCP_TEST', { reason: 'bounded' }), { code: 'MCP_TEST', details: { reason: 'bounded' } });
assert.equal(safeMcpError('not safe').code, 'MCP_REQUEST_FAILED');

console.log('MCP transport contract checks passed.');
