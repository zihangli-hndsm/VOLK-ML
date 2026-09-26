import { readFileSync, writeFileSync } from 'node:fs';
import { createGraphPatchProposal } from '../src/core/graph/graphPatchProposal.js';
import { createTorchExportGraphProposal } from '../src/core/graph/workspaceProposal.js';

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

const [mode, inputPath, argumentA, argumentB, argumentC, argumentD] = process.argv.slice(2);
if (mode === 'torch-proposal' && inputPath && argumentA && !argumentB) {
  const created = createTorchExportGraphProposal(readJson(inputPath));
  if (!created.ok) {
    fail(`TORCH_PROPOSAL_REJECTED ${created.diagnostics?.[0]?.code ?? 'UNKNOWN'}`);
  } else {
    writeJson(argumentA, created.proposal);
    process.stdout.write(`${JSON.stringify({ type: created.proposal.type, proposalId: created.proposal.proposalId, nodeCount: created.proposal.graph.nodes.length })}\n`);
  }
} else if (mode === 'patch-proposal' && inputPath && argumentA && argumentB && argumentC && argumentD) {
  const baseProposal = readJson(inputPath);
  if (baseProposal?.type !== 'WorkspaceGraphProposalV1' || !baseProposal.graph) {
    fail('TORCH_PROPOSAL_REQUIRED');
  } else {
    const nodeId = argumentA;
    const propertyKey = argumentB;
    let value;
    try { value = JSON.parse(argumentC); } catch {
      fail('PATCH_VALUE_INVALID_JSON');
      process.exit();
    }
    const node = baseProposal.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || !Object.hasOwn(node.data?.parameters ?? {}, propertyKey)) {
      fail('PATCH_TARGET_OR_PARAMETER_NOT_FOUND');
    } else {
      const created = createGraphPatchProposal({
        baseGraph: baseProposal.graph,
        operations: [{ op: 'UPDATE_PARAMETERS', nodeId, parameters: { ...node.data.parameters, [propertyKey]: value } }],
        source: { producer: 'external-agent', provenance: { artifactId: 'd3-first-hidden-layer', revision: '1', location: 'inline' } },
        rationale: 'Change the inspected first hidden layer to the learner-requested width.',
      });
      if (!created.ok) {
        fail(`PATCH_PROPOSAL_REJECTED ${created.diagnostics?.[0]?.code ?? 'UNKNOWN'}`);
      } else {
        writeJson(argumentD, created.proposal);
        process.stdout.write(`${JSON.stringify({ type: created.proposal.type, proposalId: created.proposal.proposalId, operationCount: created.proposal.operations.length })}\n`);
      }
    }
  }
} else {
  fail('USAGE d3-graph-proposal-helper.mjs torch-proposal <document.json> <proposal.json> | patch-proposal <base-proposal.json> <node-id> <parameter-key> <json-value> <patch-proposal.json>');
}
