import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import {
  D3_ALLOWED_MCP_TOOLS,
  D3_MCP_SERVER_NAME,
  buildD3AgentPrompt,
  buildD3CodexArguments,
  classifyCodexStderr,
  listConfiguredMcpServerNames,
  summarizeCodexJsonEvent,
  summarizeD3RunnerError,
  validateD3PythonRuntimeAttestation,
  validateEffectiveD3McpConfigOutput,
} from './agent-application-d3-contract.mjs';
import { createCodexRun } from './agent-application-d3-codex-run.mjs';
import { createGraphPatchProposal } from '../src/core/graph/graphPatchProposal.js';
import { createTorchExportGraphProposal } from '../src/core/graph/workspaceProposal.js';

const repoRoot = process.cwd();
const scratch = 'D:/VOLK-ML-agent-application-d3-temp/contract-test';
const fakePythonPath = path.join(path.resolve('d3-test-python'), 'Scripts', 'python.exe');
const serverScript = `${repoRoot}/scripts/volk-mcp-server.mjs`;
const args = buildD3CodexArguments({
  codexPath: 'codex.exe',
  repositoryRoot: repoRoot,
  mcpServerScript: serverScript,
  scratchDirectory: scratch,
  prompt: 'D3 reference prompt',
  existingMcpServerNames: ['codex_app', 'cua_repl', 'node_repl', 'volk_ml_d3'],
});
assert.ok(args.includes('--json'));
assert.ok(args.includes('--ephemeral'));
assert.ok(args.indexOf('--ask-for-approval') < args.indexOf('exec'));
assert.equal(args[args.indexOf('--ask-for-approval') + 1], 'never');
assert.ok(args.includes('--sandbox') && args[args.indexOf('--sandbox') + 1] === 'workspace-write');
assert.ok(args.includes('--skip-git-repo-check'), 'The scratch-only working directory is intentionally not a Git checkout.');
assert.ok(args.includes('-C') && args[args.indexOf('-C') + 1] === scratch, 'The isolated scratch directory is the only writable Codex workspace.');
assert.equal(args.includes('--add-dir'), false, 'The repository is not granted an additional writable root.');
assert.equal(args.some((value) => value === '-m' || value === '--model'), false, 'The configured Codex model is not overridden.');
assert.equal(args.some((value) => value.includes('VOLK_MCP_SESSION_TOKEN=')), false, 'The session token is not embedded in Codex arguments.');
const mcpConfig = args[args.indexOf('-c') + 1];
assert.ok(mcpConfig.startsWith('mcp_servers = {'));
assert.ok(mcpConfig.includes(`${D3_MCP_SERVER_NAME} = {`));
assert.ok(mcpConfig.includes('enabled_tools = ["volk_inspect_workspace"'));
assert.ok(mcpConfig.includes('required = true'));
assert.ok(mcpConfig.includes('"codex_app" = { command = '));
assert.ok(mcpConfig.includes('"cua_repl" = { command = '));
assert.ok(mcpConfig.includes('"node_repl" = { command = '));
assert.ok(mcpConfig.includes('enabled = false'), 'Every inherited MCP server is disabled in this invocation.');
assert.equal(mcpConfig.includes('volk_request_run'), false);

let listedArguments = null;
const listedNames = listConfiguredMcpServerNames('codex.exe', repoRoot, (_command, invocationArgs) => {
  listedArguments = invocationArgs;
  return { status: 0, stdout: JSON.stringify([{ name: 'alpha_server' }, { name: 'beta-server' }]), stderr: '' };
});
assert.deepEqual(listedNames, ['alpha_server', 'beta-server']);
assert.deepEqual(listedArguments, ['mcp', 'list', '--json']);
assert.equal(listConfiguredMcpServerNames('codex.exe', repoRoot, () => ({ status: 1, stdout: '', stderr: '' })), null);
assert.equal(listConfiguredMcpServerNames('codex.exe', repoRoot, () => ({ status: 0, stdout: 'unexpected MCP listing output', stderr: '' })), null);
const safeEffectiveConfig = JSON.stringify([
  { name: 'alpha_server', enabled: false, transport: { type: 'stdio' } },
  { name: 'volk_ml_d3', enabled: true, transport: { type: 'stdio', env_vars: ['VOLK_MCP_PORT', 'VOLK_MCP_SESSION_TOKEN'] } },
]);
assert.deepEqual(validateEffectiveD3McpConfigOutput(safeEffectiveConfig, ['alpha_server']), {
  enabledServerName: 'volk_ml_d3',
  disabledInheritedServerCount: 1,
});
assert.equal(validateEffectiveD3McpConfigOutput(JSON.stringify([
  { name: 'alpha_server', enabled: true, transport: { type: 'stdio' } },
  { name: 'volk_ml_d3', enabled: true, transport: { type: 'stdio', env_vars: ['VOLK_MCP_PORT', 'VOLK_MCP_SESSION_TOKEN'] } },
]), ['alpha_server']), null);
assert.throws(() => buildD3CodexArguments({ codexPath: 'codex.exe', repositoryRoot: repoRoot, mcpServerScript: serverScript, scratchDirectory: scratch, prompt: 'x', existingMcpServerNames: ['unsafe.name'] }), /validated existing MCP server names/);

const prompt = buildD3AgentPrompt({
  repositoryRoot: repoRoot,
  scratchDirectory: scratch,
  pythonPath: 'D:/venvs/torch-export/Scripts/python.exe',
  mcpPort: 5190,
});
const normalizedRepoRoot = repoRoot.replaceAll('\\', '/');
assert.equal(/\{\{[A-Z_]+\}\}/.test(prompt), false, 'All bounded runtime prompt values are substituted.');
assert.ok(prompt.includes('torch.export'));
assert.ok(prompt.includes(`${normalizedRepoRoot}/fixtures/graph-infrastructure-d3/pytorch-repo/README.md`));
assert.ok(prompt.includes(`${normalizedRepoRoot}/scripts/d3-graph-proposal-helper.mjs`));
assert.ok(prompt.includes(`${normalizedRepoRoot}/fixtures/graph-infrastructure-d3/pytorch-repo/export_document.py`));
assert.ok(prompt.includes('volk_submit_graph_proposal'));
assert.ok(prompt.includes('volk_submit_graph_patch_proposal'));
assert.match(prompt, /never fan out MCP calls/);
assert.match(prompt, /wait for its completed[\s\S]{0,16}result, and only then issue the next/);
assert.match(prompt, /Do not call Run or Apply/);
assert.equal(prompt.includes('VOLK_MCP_SESSION_TOKEN'), false);
const runnerSource = readFileSync('scripts/agent-application-d3-reference.mjs', 'utf8');
const codexRunSource = readFileSync('scripts/agent-application-d3-codex-run.mjs', 'utf8');
const starterClearer = runnerSource.match(/async function clearStarterGraphWithLearnerClicks\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';
assert.match(starterClearer, /\.react-flow__node button/);
assert.match(starterClearer, /deletion-confirm-title/);
assert.match(starterClearer, /clickLearnerTarget/);
assert.doesNotMatch(starterClearer, /__VOLK_ML_AGENT__|applicationRequest/);
assert.doesNotMatch(runnerSource, /\.click\(\)/, 'The runner never invokes learner controls through HTMLElement.click().');
const learnerClicker = runnerSource.match(/async function clickLearnerTarget\([\s\S]*?\n\}/)?.[0] ?? '';
assert.match(learnerClicker, /elementFromPoint|inspectLearnerTarget/);
assert.match(learnerClicker, /Input\.dispatchMouseEvent/);
assert.match(learnerClicker, /outside-viewport|visuallyOpaque/);
const blockedGuardPosition = learnerClicker.indexOf('if (expectBlocked)');
const mousePressPosition = learnerClicker.indexOf("type: 'mousePressed'");
assert.ok(blockedGuardPosition >= 0 && mousePressPosition > blockedGuardPosition,
  'A blocked-target regression returns before any pointer press can be dispatched.');
assert.match(runnerSource, /Start fresh/);
assert.match(runnerSource, /requireRestorePrompt: true/);
assert.match(runnerSource, /occlusionNegativeControl/);
assert.match(runnerSource, /message\.params\?\.type === 'beforeunload'/,
  'Only a browser beforeunload confirmation may be accepted to complete the requested fresh-document navigation.');
assert.match(runnerSource, /Page\.handleJavaScriptDialog', \{ accept: true \}/);
assert.match(runnerSource, /beforeUnloadDialogsAccepted/);
assert.match(runnerSource, /restorePromptAbsentAtScreenshots/);
assert.match(runnerSource, /journeyResult\.screenshots = screenshotFiles/);
assert.doesNotMatch(runnerSource, /browserJourney\.screenshots/,
  'Screenshot paths are attached to the resolved browser journey, not its Promise.');
for (const stage of ['before-b1', 'b1-preview', 'after-b1', 'c2-preview', 'after-c2']) {
  assert.ok(runnerSource.includes(`captureAcceptanceScreenshot(screenshots, '${stage}')`), `Browser evidence includes ${stage}.`);
}

const document = JSON.parse(readFileSync('fixtures/torch-export/linear-relu.json', 'utf8'));
const imported = createTorchExportGraphProposal(document);
assert.equal(imported.ok, true, JSON.stringify(imported.diagnostics));
assert.equal(imported.proposal.type, 'WorkspaceGraphProposalV1');
const hidden = imported.proposal.graph.nodes.find((node) => node.data.manifest.op === 'dense');
assert.ok(hidden);
assert.equal(hidden.data.parameters.units, 32);
const patch = createGraphPatchProposal({
  baseGraph: imported.proposal.graph,
  operations: [{ op: 'UPDATE_PARAMETERS', nodeId: hidden.id, parameters: { ...hidden.data.parameters, units: 128 } }],
  source: { producer: 'external-agent', provenance: { artifactId: 'd3-contract-test', revision: '1', location: 'inline' } },
  rationale: 'Update the first hidden layer width for the contract check.',
});
assert.equal(patch.ok, true, JSON.stringify(patch.diagnostics));
assert.equal(patch.proposal.type, 'GraphPatchProposalV1');
assert.equal(patch.proposal.requiresUserAcceptance, true);
assert.equal(patch.proposal.authority, 'detached-proposal');

const eventSummary = summarizeCodexJsonEvent({
  type: 'item.completed',
  item: {
    type: 'mcp_tool_call',
    name: 'volk_submit_graph_patch_proposal',
    status: 'completed',
    arguments: { proposal: { ...patch.proposal, privateSentinel: 'do-not-persist-this-payload' } },
  },
});
assert.deepEqual(eventSummary.proposal, {
  kind: 'graph-patch',
  proposalId: patch.proposal.proposalId,
  operationCount: 1,
  operation: 'UPDATE_PARAMETERS',
  targetNodeId: hidden.id,
  changedParameterKeys: ['units'],
  hiddenUnitsChangedTo128: true,
});
assert.equal(JSON.stringify(eventSummary).includes('do-not-persist-this-payload'), false);
assert.equal(JSON.stringify(eventSummary).includes(JSON.stringify(patch.proposal.baseGraph)), false);

const busyToolSummary = summarizeCodexJsonEvent({
  type: 'item.completed',
  item: {
    type: 'mcp_tool_call',
    name: 'volk_list_components',
    status: 'failed',
    result: {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code: 'MCP_WORKSPACE_BUSY' } }) }],
    },
  },
});
assert.equal(busyToolSummary.status, 'failed');
assert.equal(busyToolSummary.isError, true);
assert.equal(busyToolSummary.mcpErrorCode, 'MCP_WORKSPACE_BUSY');
assert.equal(busyToolSummary.failureClass, 'workspace-capacity');
const unclassifiedToolSummary = summarizeCodexJsonEvent({
  type: 'item.completed',
  item: {
    type: 'mcp_tool_call',
    name: 'volk_list_components',
    status: 'failed',
    result: { content: [{ type: 'text', text: 'provider secret must not be retained' }] },
  },
});
assert.equal(unclassifiedToolSummary.failureClass, 'mcp-tool-failure-unclassified');
assert.equal('mcpErrorCode' in unclassifiedToolSummary, false);
assert.equal(JSON.stringify(unclassifiedToolSummary).includes('provider secret'), false,
  'Tool failure classification never retains raw provider or tool-result text.');

const commandSummary = summarizeCodexJsonEvent({
  type: 'item.completed',
  item: { type: 'command_execution', status: 'completed', exit_code: 0, command: 'python fixtures/graph-infrastructure-d3/pytorch-repo/export_document.py' },
}, { pythonPath: 'D:/venvs/torch-export/Scripts/python.exe' });
assert.equal(commandSummary.ranD3Exporter, true);
assert.equal(commandSummary.usedPythonPath, false);
assert.equal(JSON.stringify(commandSummary).includes('fixtures/'), false, 'Raw commands are not retained in sanitized command evidence.');
const pinnedPythonSummary = summarizeCodexJsonEvent({
  type: 'item.completed',
  item: { type: 'command_execution', status: 'completed', exit_code: 0, command: 'python fixtures/graph-infrastructure-d3/pytorch-repo/export_document.py' },
}, { pythonPath: 'D:/venvs/torch-export/Scripts/python.exe', configuredPythonOnPath: true });
assert.equal(pinnedPythonSummary.ranD3Exporter, true);
assert.equal(pinnedPythonSummary.usedPythonPath, false, 'PATH pinning is configuration, not proof of which executable a shell command ran.');
const unpinnedPythonSummary = summarizeCodexJsonEvent({
  type: 'item.completed',
  item: { type: 'command_execution', status: 'completed', exit_code: 0, command: 'python fixtures/graph-infrastructure-d3/pytorch-repo/export_document.py' },
}, { pythonPath: 'D:/venvs/torch-export/Scripts/python.exe' });
assert.equal(unpinnedPythonSummary.usedPythonPath, false);
const powershellWrappedPythonSummary = summarizeCodexJsonEvent({
  type: 'item.completed',
  item: {
    type: 'command_execution',
    status: 'completed',
    exit_code: 0,
    command: 'powershell.exe -NoProfile -Command "& \'python\' fixtures/graph-infrastructure-d3/pytorch-repo/export_document.py"',
  },
});
assert.equal(powershellWrappedPythonSummary.ranD3Exporter, true, 'The real command wrapper still identifies the exporter operation.');
assert.equal(powershellWrappedPythonSummary.usedPythonPath, false, 'Wrapped command text never proves the Python executable identity.');
const testRuntimeAttestation = {
  type: 'D3PythonRuntimeAttestationV1',
  nonce: 'test-one-time-nonce',
  pythonExecutable: fakePythonPath,
  pythonExecutableSha256: 'a'.repeat(64),
  pythonVersion: '3.12.10',
  torchVersion: '2.14.0+cpu',
};
const validatedRuntimeAttestation = validateD3PythonRuntimeAttestation({
  attestation: testRuntimeAttestation,
  expectedNonce: testRuntimeAttestation.nonce,
  configuredPythonPath: fakePythonPath,
  configuredPythonSha256: testRuntimeAttestation.pythonExecutableSha256,
  expectedPythonVersion: testRuntimeAttestation.pythonVersion,
  expectedTorchVersion: testRuntimeAttestation.torchVersion,
});
assert.equal(validatedRuntimeAttestation.valid, true);
assert.equal(validatedRuntimeAttestation.configuredPathMatched, true);
assert.equal(validatedRuntimeAttestation.executableHashMatched, true);
for (const [change, reason] of [
  [{ nonce: 'wrong' }, 'nonce-mismatch'],
  [{ pythonExecutable: `${fakePythonPath}.wrong` }, 'python-path-mismatch'],
  [{ pythonExecutableSha256: 'b'.repeat(64) }, 'python-binary-mismatch'],
  [{ pythonVersion: '3.11.0' }, 'python-version-mismatch'],
  [{ torchVersion: '0.0.0' }, 'torch-version-mismatch'],
]) {
  const invalid = validateD3PythonRuntimeAttestation({
    attestation: { ...testRuntimeAttestation, ...change },
    expectedNonce: testRuntimeAttestation.nonce,
    configuredPythonPath: fakePythonPath,
    configuredPythonSha256: testRuntimeAttestation.pythonExecutableSha256,
    expectedPythonVersion: testRuntimeAttestation.pythonVersion,
    expectedTorchVersion: testRuntimeAttestation.torchVersion,
  });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.reason, reason);
}
assert.equal(classifyCodexStderr('VOLK_MCP_START_FAILED MCP_SESSION_TOKEN_REQUIRED'), 'volk-mcp-start-failed');
assert.equal(classifyCodexStderr('MCP client failed to start: handshake'), 'codex-mcp-start-failed');
assert.equal(classifyCodexStderr("error: unexpected argument '--ask-for-approval' found"), 'codex-cli-argument-error');
assert.equal(classifyCodexStderr('quota exceeded'), 'quota');
assert.equal(classifyCodexStderr('connection closed'), null);
assert.deepEqual(summarizeD3RunnerError(Object.assign(new TypeError('private error detail'), { code: 'ENOENT' })), {
  name: 'TypeError', code: 'ENOENT',
});
assert.deepEqual(summarizeD3RunnerError(Object.assign(new Error('private error detail'), { code: 'PRIVATE_CODE' })), {
  name: 'Error', code: null,
});
assert.equal(JSON.stringify(summarizeD3RunnerError(new Error('private error detail'))).includes('private error detail'), false);
assert.match(runnerSource, /VOLK-ML-AgentApplicationD3FailureV1/);
assert.match(runnerSource, /Page\.captureScreenshot/);
assert.match(runnerSource, /mcpTokenParameterPresent: params\.has\('mcpToken'\)/);
assert.match(codexRunSource, /processStartErrorCode/);
const failureSnapshotProjector = runnerSource.match(/browserSnapshot = await evaluate\(`\(\(\) => \{([\s\S]*?)\}\)\(\)`\);/)?.[1] ?? '';
assert.ok(failureSnapshotProjector.length > 0, 'Runner has a bounded browser failure snapshot projector.');
assert.doesNotMatch(failureSnapshotProjector, /innerText|textContent|document\.title|\.value|mcpToken\s*:/,
  'Failure diagnostics do not extract page copy or credential values.');

const fakePythonDirectory = path.dirname(fakePythonPath);
const fakeChildPath = [fakePythonDirectory, `${fakePythonDirectory}-fallback`].join(path.delimiter);
const fakeEnvironment = { VOLK_D3_PYTHON: fakePythonPath, PATH: fakeChildPath };
let fakeSpawnCount = 0;
let fakeSpawnConfiguration = null;
const fakeChild = new EventEmitter();
fakeChild.stdout = new PassThrough();
fakeChild.stderr = new PassThrough();
fakeChild.exitCode = null;
fakeChild.signalCode = null;
fakeChild.killed = false;
fakeChild.kill = () => { fakeChild.killed = true; };
const fakeLaunchState = { spawnAttempted: false, childHandleCreated: false, processStarted: null, processStartErrorCode: null };
const fakeRun = createCodexRun({
  codexPath: 'codex.exe',
  args: ['exec', '--json'],
  env: fakeEnvironment,
  cwd: repoRoot,
  launchState: fakeLaunchState,
  spawnImpl: (...configuration) => {
    fakeSpawnCount += 1;
    fakeSpawnConfiguration = configuration;
    setImmediate(() => fakeChild.emit('spawn'));
    return fakeChild;
  },
  stopProcessTreeImpl: (child) => child.kill(),
  maxRunMs: 5_000,
  maxEvents: 8,
});
await new Promise((resolve) => setImmediate(resolve));
assert.equal(fakeSpawnCount, 1);
assert.equal(fakeSpawnConfiguration[2].env, fakeEnvironment);
assert.equal(fakeRun.pythonDirectoryPinned, true, 'The actual Codex setup function records the configured PATH pin before spawn.');
assert.equal(fakeLaunchState.processStarted, true);
assert.equal(fakeLaunchState.childHandleCreated, true);
fakeChild.stdout.write(`${JSON.stringify({
  type: 'item.completed',
  item: {
    type: 'command_execution',
    status: 'completed',
    exit_code: 0,
    command: 'python fixtures/graph-infrastructure-d3/pytorch-repo/export_document.py PRIVATE-SENTINEL',
  },
})}\n`);
fakeChild.stdout.write(`${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 2, reasoning_output_tokens: 1 } })}\n`);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(fakeRun.summary.commandFlags.ranD3Exporter, true);
assert.equal(fakeRun.summary.commandFlags.usedPythonPath, false, 'Codex command text cannot set the configured-executable proof flag.');
assert.deepEqual(fakeRun.summary.usage, { inputTokens: 3, outputTokens: 2, reasoningOutputTokens: 1 });
assert.equal(JSON.stringify(fakeRun.summary).includes('PRIVATE-SENTINEL'), false, 'The no-model setup test keeps command text out of provenance.');
fakeChild.stdout.end();
fakeChild.stderr.end();
fakeChild.exitCode = 0;
fakeChild.emit('close', 0);
assert.deepEqual(await fakeRun.completion, { exitCode: 0 });

let invalidConfigSpawnCount = 0;
const invalidLaunchState = { spawnAttempted: false, childHandleCreated: false, processStarted: null, processStartErrorCode: null };
assert.throws(() => createCodexRun({
  codexPath: 'codex.exe',
  args: ['exec'],
  env: { PATH: fakeChildPath },
  cwd: repoRoot,
  launchState: invalidLaunchState,
  spawnImpl: () => { invalidConfigSpawnCount += 1; return fakeChild; },
}), /Configured D3 Python executable is required/);
assert.equal(invalidConfigSpawnCount, 0, 'Invalid runtime configuration is rejected before any child process is spawned.');
assert.equal(invalidLaunchState.spawnAttempted, false);

console.log('D3 reference checks passed: invocation isolation, allowlist, prompt bounds, detached B1/C2 semantics, JSONL redaction, and stubbed child setup.');
