import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync as defaultSpawnSync } from 'node:child_process';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const D3_REFERENCE_PROMPT_PATH = path.resolve(SCRIPT_DIRECTORY, '../docs/architecture/agent-mcp-d3-reference.md');
export const D3_MCP_SERVER_NAME = 'volk_ml_d3';
export const D3_ALLOWED_MCP_TOOLS = Object.freeze([
  'volk_inspect_workspace',
  'volk_list_components',
  'volk_list_capabilities',
  'volk_submit_graph_proposal',
  'volk_submit_graph_patch_proposal',
  'volk_inspect_proposal',
]);

const ALLOWED_MCP_TOOL_SET = new Set(D3_ALLOWED_MCP_TOOLS);
const SAFE_PROCESS_ERROR_CODES = new Set(['EACCES', 'EINVAL', 'ENOENT', 'ENOTDIR', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET']);
const SAFE_PROCESS_ERROR_NAMES = new Set(['D3Error', 'Error', 'TypeError', 'RangeError', 'ReferenceError']);
const SAFE_MCP_ERROR_CLASSIFICATIONS = Object.freeze({
  MCP_WORKSPACE_BUSY: 'workspace-capacity',
  MCP_WORKSPACE_DEADLINE: 'workspace-deadline',
  MCP_WORKSPACE_DISCONNECTED: 'workspace-disconnected',
  MCP_POLL_BUSY: 'transport-busy',
  MCP_BODY_TOO_LARGE: 'payload-bound',
  MCP_RESPONSE_TOO_LARGE: 'payload-bound',
  MCP_JSON_BOUND: 'payload-bound',
  MCP_JSON_VALUE: 'protocol-invalid',
  MCP_JSON_INVALID: 'protocol-invalid',
  MCP_REQUEST_INVALID: 'protocol-invalid',
  MCP_RESPONSE_INVALID: 'protocol-invalid',
  MCP_ROUTE_NOT_FOUND: 'protocol-invalid',
  MCP_METHOD_NOT_ALLOWED: 'protocol-invalid',
  MCP_SESSION_REJECTED: 'session-rejected',
  MCP_ORIGIN_REJECTED: 'session-rejected',
  BROWSER_REQUEST_FAILED: 'browser-dispatch-failed',
});
const MAX_MCP_ERROR_TEXT_CODE_UNITS = 4_096;

function safeMcpErrorCode(value) {
  if (typeof value === 'string' && Object.hasOwn(SAFE_MCP_ERROR_CLASSIFICATIONS, value)) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.error?.code === 'string'
    && Object.hasOwn(SAFE_MCP_ERROR_CLASSIFICATIONS, value.error.code)) return value.error.code;
  return null;
}

function safeMcpErrorCodeFromContent(content) {
  if (!Array.isArray(content)) return null;
  for (const block of content.slice(0, 4)) {
    if (block?.type !== 'text' || typeof block.text !== 'string'
      || block.text.length > MAX_MCP_ERROR_TEXT_CODE_UNITS) continue;
    try {
      const code = safeMcpErrorCode(JSON.parse(block.text));
      if (code) return code;
    } catch {}
  }
  return null;
}

function safeMcpFailureCode(item) {
  const candidates = [
    item?.error,
    item?.result,
    item?.result?.structuredContent,
    item?.structuredContent,
  ];
  for (const candidate of candidates) {
    const code = safeMcpErrorCode(candidate);
    if (code) return code;
  }
  const contentCandidates = [
    item?.content,
    item?.result?.content,
    item?.result?.structuredContent?.content,
    item?.structuredContent?.content,
  ];
  for (const content of contentCandidates) {
    const code = safeMcpErrorCodeFromContent(content);
    if (code) return code;
  }
  return null;
}

function tomlValue(value) {
  return JSON.stringify(value);
}

export function normalizeConfigPath(value) {
  return value.replaceAll('\\', '/');
}

export function listConfiguredMcpServerNames(codexPath, repositoryRoot, spawnSyncImpl = defaultSpawnSync) {
  if (typeof codexPath !== 'string' || !codexPath || typeof repositoryRoot !== 'string' || !repositoryRoot) return null;
  const result = spawnSyncImpl(codexPath, ['mcp', 'list', '--json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    timeout: 15_000,
  });
  if (result?.error || result?.status !== 0) return null;
  let servers;
  try { servers = JSON.parse(result.stdout); } catch { return null; }
  if (!Array.isArray(servers)) return null;
  const names = servers.map((server) => server?.name);
  if (names.some((name) => typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(name))) return null;
  return [...new Set(names)];
}

export function validateEffectiveD3McpConfigOutput(output, inheritedNames) {
  if (typeof output !== 'string' || !Array.isArray(inheritedNames)) return null;
  let servers;
  try { servers = JSON.parse(output); } catch { return null; }
  if (!Array.isArray(servers)) return null;
  const byName = new Map();
  for (const server of servers) {
    if (typeof server?.name !== 'string' || byName.has(server.name)) return null;
    byName.set(server.name, server);
  }
  const enabled = servers.filter((server) => server.enabled === true).map((server) => server.name);
  if (enabled.length !== 1 || enabled[0] !== D3_MCP_SERVER_NAME) return null;
  for (const name of inheritedNames) {
    if (name !== D3_MCP_SERVER_NAME && byName.get(name)?.enabled !== false) return null;
  }
  const d3 = byName.get(D3_MCP_SERVER_NAME);
  const envVars = d3?.transport?.env_vars;
  if (d3?.transport?.type !== 'stdio'
    || !Array.isArray(envVars)
    || !envVars.includes('VOLK_MCP_PORT')
    || !envVars.includes('VOLK_MCP_SESSION_TOKEN')) return null;
  return { enabledServerName: D3_MCP_SERVER_NAME, disabledInheritedServerCount: inheritedNames.filter((name) => name !== D3_MCP_SERVER_NAME).length };
}

export function buildD3CodexArguments({ codexPath, repositoryRoot, mcpServerScript, scratchDirectory, prompt, existingMcpServerNames = [] } = {}) {
  if (![codexPath, repositoryRoot, mcpServerScript, scratchDirectory, prompt].every((value) => typeof value === 'string' && value)) {
    throw new TypeError('D3 Codex invocation needs explicit paths and prompt text.');
  }
  if (!Array.isArray(existingMcpServerNames)
    || existingMcpServerNames.some((name) => typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(name))) {
    throw new TypeError('D3 Codex invocation needs validated existing MCP server names.');
  }
  const args = [
    '--ask-for-approval', 'never',
    'exec', '--json', '--ephemeral', '--sandbox', 'workspace-write', '--skip-git-repo-check',
    '-C', scratchDirectory,
  ];
  const settings = [
    `command = ${tomlValue(normalizeConfigPath(process.execPath))}`,
    `args = ${tomlValue([normalizeConfigPath(mcpServerScript)])}`,
    `cwd = ${tomlValue(normalizeConfigPath(repositoryRoot))}`,
    `env_vars = ${tomlValue(['VOLK_MCP_PORT', 'VOLK_MCP_SESSION_TOKEN'])}`,
    `enabled_tools = ${tomlValue(D3_ALLOWED_MCP_TOOLS)}`,
    'default_tools_approval_mode = "approve"',
    'enabled = true',
    'required = true',
  ];
  const disabledInheritedServers = [...new Set(existingMcpServerNames)]
    .filter((name) => name !== D3_MCP_SERVER_NAME)
    .map((name) => `${tomlValue(name)} = { command = ${tomlValue(normalizeConfigPath(process.execPath))}, args = [], enabled = false }`);
  disabledInheritedServers.push(`${D3_MCP_SERVER_NAME} = { ${settings.join(', ')} }`);
  args.push('-c', `mcp_servers = { ${disabledInheritedServers.join(', ')} }`);
  args.push(prompt);
  return args;
}

function parseObject(value) {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function safeToolName(item) {
  const candidates = [item?.tool, item?.tool_name, item?.toolName, item?.name, item?.server_tool];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const direct = D3_ALLOWED_MCP_TOOLS.find((tool) => candidate === tool
      || candidate.endsWith(`.${tool}`)
      || candidate.endsWith(`/${tool}`)
      || candidate.endsWith(`__${tool}`));
    if (direct && ALLOWED_MCP_TOOL_SET.has(direct)) return direct;
  }
  return null;
}

function proposalFromItem(item) {
  for (const candidate of [item?.arguments, item?.input, item?.params, item?.arguments_json]) {
    const parsed = parseObject(candidate);
    if (parsed?.proposal && typeof parsed.proposal === 'object') return parsed.proposal;
  }
  return null;
}

export function classifyCodexStderr(stderr) {
  const text = typeof stderr === 'string' ? stderr.toLowerCase() : '';
  if (/rate.?limit|quota|usage limit/.test(text)) return 'quota';
  if (/not logged in|unauthorized|authentication/.test(text)) return 'auth';
  if (/volk_mcp_start_failed/.test(text)) return 'volk-mcp-start-failed';
  if (/failed to load bootstrap configuration|invalid transport|mcp.*(failed to start|handshake|initialize)/.test(text)) return 'codex-mcp-start-failed';
  if (/unexpected argument|unrecognized argument|unknown argument/.test(text)) return 'codex-cli-argument-error';
  return null;
}

export function summarizeD3RunnerError(error) {
  return {
    name: SAFE_PROCESS_ERROR_NAMES.has(error?.name) ? error.name : 'Error',
    code: SAFE_PROCESS_ERROR_CODES.has(error?.code) ? error.code : null,
  };
}

export function validateD3PythonRuntimeAttestation({
  attestation,
  expectedNonce,
  configuredPythonPath,
  configuredPythonSha256,
  expectedPythonVersion,
  expectedTorchVersion,
} = {}) {
  const invalid = (reason) => ({ valid: false, reason });
  if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) return invalid('attestation-missing');
  if (attestation.type !== 'D3PythonRuntimeAttestationV1') return invalid('schema-invalid');
  if (typeof expectedNonce !== 'string' || !expectedNonce || attestation.nonce !== expectedNonce) return invalid('nonce-mismatch');
  if (typeof configuredPythonPath !== 'string' || !configuredPythonPath
    || typeof attestation.pythonExecutable !== 'string'
    || normalizeConfigPath(attestation.pythonExecutable).replace(/\/+$/, '').toLowerCase()
      !== normalizeConfigPath(configuredPythonPath).replace(/\/+$/, '').toLowerCase()) return invalid('python-path-mismatch');
  if (typeof configuredPythonSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(configuredPythonSha256)
    || typeof attestation.pythonExecutableSha256 !== 'string'
    || attestation.pythonExecutableSha256.toLowerCase() !== configuredPythonSha256.toLowerCase()) return invalid('python-binary-mismatch');
  if (typeof attestation.pythonVersion !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(attestation.pythonVersion)) return invalid('python-version-invalid');
  if (typeof expectedPythonVersion === 'string' && expectedPythonVersion
    && attestation.pythonVersion !== expectedPythonVersion) return invalid('python-version-mismatch');
  if (typeof attestation.torchVersion !== 'string' || !/^\d+\.\d+/.test(attestation.torchVersion)
    || (typeof expectedTorchVersion === 'string' && expectedTorchVersion && attestation.torchVersion !== expectedTorchVersion)) {
    return invalid('torch-version-mismatch');
  }
  return {
    valid: true,
    configuredPathMatched: true,
    executableHashMatched: true,
    pythonVersion: attestation.pythonVersion,
    torchVersion: attestation.torchVersion,
    pythonExecutableSha256: attestation.pythonExecutableSha256.toLowerCase(),
  };
}

export function summarizeCodexJsonEvent(event) {
  const item = event?.item && typeof event.item === 'object' ? event.item : {};
  if (item.type === 'mcp_tool_call' || item.type === 'mcp_tool_call_output') {
    const tool = safeToolName(item);
    const summary = { eventType: event.type, itemType: item.type, tool: tool ?? 'unsupported' };
    if (item.type === 'mcp_tool_call') {
      const proposal = proposalFromItem(item);
      if (proposal?.type === 'WorkspaceGraphProposalV1') {
        summary.proposal = {
          kind: 'whole-graph',
          proposalId: typeof proposal.proposalId === 'string' ? proposal.proposalId : null,
          nodeCount: Array.isArray(proposal.graph?.nodes) ? proposal.graph.nodes.length : null,
        };
      } else if (proposal?.type === 'GraphPatchProposalV1') {
        const operation = Array.isArray(proposal.operations) ? proposal.operations[0] : null;
        const changedNode = proposal.baseGraph?.nodes?.find((node) => node.id === operation?.nodeId);
        const changedKeys = operation?.op === 'UPDATE_PARAMETERS'
          ? Object.keys(operation.parameters ?? {}).filter((key) => operation.parameters[key] !== changedNode?.data?.parameters?.[key])
          : [];
        summary.proposal = {
          kind: 'graph-patch',
          proposalId: typeof proposal.proposalId === 'string' ? proposal.proposalId : null,
          operationCount: proposal.operations?.length ?? null,
          operation: operation?.op ?? null,
          targetNodeId: typeof operation?.nodeId === 'string' ? operation.nodeId : null,
          changedParameterKeys: changedKeys.slice(0, 8),
          hiddenUnitsChangedTo128: changedKeys.includes('units') && operation?.parameters?.units === 128,
        };
      }
    }
    if (typeof item.status === 'string' && /^(completed|failed|in_progress)$/.test(item.status)) summary.status = item.status;
    const isError = item.result?.isError === true || item.isError === true;
    if (isError) summary.isError = true;
    if (summary.status === 'failed' || isError) {
      const errorCode = safeMcpFailureCode(item);
      summary.failureClass = errorCode
        ? SAFE_MCP_ERROR_CLASSIFICATIONS[errorCode]
        : 'mcp-tool-failure-unclassified';
      if (errorCode) summary.mcpErrorCode = errorCode;
    }
    return summary;
  }
  if (item.type === 'command_execution') {
    const command = typeof item.command === 'string' ? item.command : '';
    const normalized = command.replaceAll('\\', '/').toLowerCase();
    return {
      eventType: event.type,
      itemType: item.type,
      status: typeof item.status === 'string' ? item.status : null,
      exitCode: Number.isInteger(item.exit_code) ? item.exit_code : null,
      inspectedD3Fixture: normalized.includes('pytorch-repo') && /readme\.md|model\.py/.test(normalized),
      ranD3Exporter: normalized.includes('export_document.py'),
      usedPythonPath: false,
      usedTorchProposalHelper: normalized.includes('d3-graph-proposal-helper.mjs') && normalized.includes('torch-proposal'),
      usedPatchProposalHelper: normalized.includes('d3-graph-proposal-helper.mjs') && normalized.includes('patch-proposal'),
    };
  }
  if (event?.type === 'turn.completed') {
    const usage = event.usage;
    if (usage && typeof usage === 'object') {
      const numeric = (key) => Number.isFinite(usage[key]) ? usage[key] : null;
      return {
        eventType: event.type,
        usage: {
          inputTokens: numeric('input_tokens'),
          outputTokens: numeric('output_tokens'),
          reasoningOutputTokens: numeric('reasoning_output_tokens'),
        },
      };
    }
  }
  if (event?.type === 'turn.failed' || event?.type === 'error') {
    return { eventType: event.type, failed: true, failureClass: 'agent-turn-failed' };
  }
  return { eventType: typeof event?.type === 'string' ? event.type : 'unknown' };
}

export function buildD3AgentPrompt({ repositoryRoot, scratchDirectory, pythonPath, mcpPort }) {
  const template = fs.readFileSync(D3_REFERENCE_PROMPT_PATH, 'utf8');
  return template
    .replaceAll('{{REPOSITORY_ROOT}}', normalizeConfigPath(repositoryRoot))
    .replaceAll('{{SCRATCH_DIRECTORY}}', normalizeConfigPath(scratchDirectory))
    .replaceAll('{{PYTHON_PATH}}', normalizeConfigPath(pythonPath))
    .replaceAll('{{MCP_PORT}}', String(mcpPort));
}
