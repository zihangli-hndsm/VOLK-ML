export const MCP_TRANSPORT_API_VERSION = 1;
export const MCP_BRIDGE_PATH = '/v1/bridge';
export const MCP_BRIDGE_METHODS = Object.freeze({
  inspectWorkspace: 'inspectWorkspace',
  listComponents: 'listComponents',
  listCapabilities: 'listCapabilities',
  submitGraphProposal: 'submitGraphProposal',
  submitGraphPatchProposal: 'submitGraphPatchProposal',
  inspectProposal: 'inspectProposal',
  inspectResults: 'inspectResults',
  exportGraph: 'exportGraph',
  run: 'run',
});
export const MCP_TOOL_NAMES = Object.freeze({
  inspectWorkspace: 'volk_inspect_workspace',
  listComponents: 'volk_list_components',
  listCapabilities: 'volk_list_capabilities',
  submitGraphProposal: 'volk_submit_graph_proposal',
  submitGraphPatchProposal: 'volk_submit_graph_patch_proposal',
  inspectProposal: 'volk_inspect_proposal',
  inspectResults: 'volk_inspect_results',
  exportGraph: 'volk_export_graph',
  run: 'volk_request_run',
});

export const MCP_LIMITS = Object.freeze({
  maxBodyBytes: 1_300_000,
  maxResponseBytes: 1_600_000,
  maxJsonCodeUnits: 1_100_000,
  maxDepth: 48,
  maxValues: 60_000,
  maxPendingRequests: 2,
  requestDeadlineMs: 10_000,
  pollDeadlineMs: 5_000,
  heartbeatDeadlineMs: 5_000,
  sessionIdleMs: 20_000,
});

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9._~=-]{32,256}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLocalOrigin(origin) {
  if (typeof origin !== 'string' || origin.length > 256) return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function parseLocalBridgeEndpoint(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !LOCAL_HOSTS.has(url.hostname) || url.username || url.password || url.search || url.hash) return null;
    const path = url.pathname.replace(/\/+$/, '');
    if (path !== MCP_BRIDGE_PATH) return null;
    return url.origin + MCP_BRIDGE_PATH;
  } catch {
    return null;
  }
}

export function isValidSessionToken(value) {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export function isValidRequestId(value) {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

export function assertBoundedJson(value, maxCodeUnits = MCP_LIMITS.maxJsonCodeUnits) {
  const ancestors = new WeakSet();
  let values = 0;
  let codeUnits = 0;
  const visit = (current, depth) => {
    values += 1;
    if (values > MCP_LIMITS.maxValues || depth > MCP_LIMITS.maxDepth) throw new Error('MCP_JSON_BOUND');
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'string') {
      codeUnits += current.length;
      if (codeUnits > maxCodeUnits) throw new Error('MCP_JSON_BOUND');
      return;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new Error('MCP_JSON_VALUE');
      return;
    }
    if (!current || typeof current !== 'object' || ancestors.has(current)) throw new Error('MCP_JSON_VALUE');
    if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype) throw new Error('MCP_JSON_VALUE');
    ancestors.add(current);
    if (Array.isArray(current)) current.forEach((item) => visit(item, depth + 1));
    else Object.entries(current).forEach(([key, item]) => {
      codeUnits += key.length;
      visit(item, depth + 1);
    });
    ancestors.delete(current);
  };
  visit(value, 0);
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string' || serialized.length > maxCodeUnits) throw new Error('MCP_JSON_BOUND');
  return serialized;
}

export function makeMcpRequest({ requestId, method, params }) {
  if (!isValidRequestId(requestId) || !Object.values(MCP_BRIDGE_METHODS).includes(method)) {
    throw new Error('MCP_REQUEST_INVALID');
  }
  const normalizedParams = params ?? {};
  assertBoundedJson(normalizedParams);
  return { apiVersion: MCP_TRANSPORT_API_VERSION, requestId, method, params: normalizedParams };
}

export function safeMcpError(code, details = undefined) {
  const safeCode = typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(code) ? code : 'MCP_REQUEST_FAILED';
  const result = { code: safeCode };
  if (details !== undefined) {
    try {
      assertBoundedJson(details, 2048);
      result.details = JSON.parse(JSON.stringify(details));
    } catch {
      result.details = { reason: 'details-omitted' };
    }
  }
  return result;
}
