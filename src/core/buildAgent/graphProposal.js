import { analyzeBrowserExecutionGraph } from '../browserExecutionContract.js';
import { graphToIR, compatibilityReport } from '../compiler.js';
import { estimateExecutionPlan } from '../runtimeTiers.js';
import { validateAgentDataset } from '../canvasAgent.js';
import { assertDatasetContext } from './datasetContext.js';
import { materializeBuildBlueprint } from './graphBlueprints.js';
import { validateModelDesignPlan } from './modelDesignPlan.js';
import { BUILD_AGENT_CONTRACT_VERSION, assertJsonSafe, cloneJson, failBuildAgent } from './contracts.js';

function safeCompile(nodes, edges, framework) {
  try {
    const ir = graphToIR(nodes, edges);
    const report = compatibilityReport(nodes, framework);
    const unsupported = report.filter((item) => item.quality === 'unsupported');
    return {
      status: unsupported.length ? 'unsupported' : 'supported',
      report,
      irVersion: ir.version,
      ...(unsupported.length ? { reason: 'BUILD_COMPONENT_EXPORT_UNSUPPORTED', unsupportedComponents: unsupported.map((item) => item.componentId) } : {}),
    };
  } catch (error) {
    return { status: 'unsupported', reason: error?.translationKey ?? error?.code ?? 'BUILD_COMPILER_UNSUPPORTED' };
  }
}

function localBrowserAssessment(nodes, edges, dataset) {
  if (!dataset) return { valid: false, reason: 'dataset-required-for-local-validation' };
  const assessment = analyzeBrowserExecutionGraph({ nodes, edges, dataset });
  return {
    valid: assessment.valid,
    reason: assessment.reason ?? null,
    details: assessment.details ?? null,
  };
}

/**
 * Build a detached proposal. It contains a graph blueprint and capability
 * assessments, but no Canvas Agent handle and no project/workspace mutation.
 */
export function createGraphProposal({ plan, dataset = null, datasetContext = null } = {}) {
  const validatedPlan = validateModelDesignPlan(plan);
  const context = datasetContext ? assertDatasetContext(datasetContext) : null;
  let localDataset = dataset;
  if (dataset) {
    try {
      localDataset = validateAgentDataset(dataset);
    } catch (error) {
      failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Local dataset cannot be validated for proposal preflight.', { cause: error?.code ?? 'INVALID_DATASET' });
    }
  }
  const graph = materializeBuildBlueprint({ blueprintId: validatedPlan.blueprintId, plan: validatedPlan, datasetContext: context });
  const browser = localBrowserAssessment(graph.nodes, graph.edges, localDataset);
  const tier = estimateExecutionPlan(graph.nodes, localDataset, { edges: graph.edges });
  const source = {
    pytorch: safeCompile(graph.nodes, graph.edges, 'pytorch'),
    tensorflow: safeCompile(graph.nodes, graph.edges, 'tensorflow'),
  };
  const proposal = {
    version: BUILD_AGENT_CONTRACT_VERSION,
    proposalId: `build-proposal-${validatedPlan.planId}`.slice(0, 224),
    planId: validatedPlan.planId,
    blueprintId: validatedPlan.blueprintId,
    task: validatedPlan.task,
    modelFamily: validatedPlan.modelFamily,
    architecture: validatedPlan.architecture,
    executionExpectation: validatedPlan.executionExpectation,
    graph: cloneJson(graph),
    validation: {
      browser,
      tier: {
        executionExpectation: validatedPlan.executionExpectation === 'export-only'
          ? 'export-only'
          : tier.canRunHere ? 'browser-local' : 'unsupported',
        canRunHere: tier.canRunHere,
        browserBackendComplete: tier.browserBackendComplete,
        reasons: tier.reasons ?? [],
      },
      source,
    },
    authority: 'detached-proposal',
    requiresLearnerAcceptance: true,
  };
  assertJsonSafe(proposal, 'BUILD_PROPOSAL_INVALID');
  return structuredClone(proposal);
}

export function isDetachedGraphProposal(value) {
  return value?.version === BUILD_AGENT_CONTRACT_VERSION
    && value?.authority === 'detached-proposal'
    && value?.requiresLearnerAcceptance === true;
}
