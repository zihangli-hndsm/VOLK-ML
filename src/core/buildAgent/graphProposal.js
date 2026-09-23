import { analyzeBrowserExecutionGraph } from '../browserExecutionContract.js';
import { compilePipelineToPyTorch, compilePipelineToTensorFlow } from '../compiler.js';
import { estimateExecutionPlan } from '../runtimeTiers.js';
import { validateAgentDataset } from '../canvasAgent.js';
import { assertDatasetContext, createBuildDatasetContext, fingerprintBuildDataset } from './datasetContext.js';
import { BUILD_BLUEPRINTS, materializeBuildBlueprint } from './graphBlueprints.js';
import { validateModelDesignPlan } from './modelDesignPlan.js';
import {
  canonicalGraphLayoutJsonV1,
  canonicalGraphSemanticsJsonV1,
  graphPresentationFingerprintV1,
  graphSemanticFingerprintV1,
} from '../graph/identity.js';
import {
  BUILD_AGENT_CONTRACT_VERSION,
  BUILD_EXECUTION_EXPECTATIONS,
  assertBuildIdentity,
  assertJsonSafe,
  boundedInteger,
  boundedStringArray,
  cloneJson,
  failBuildAgent,
  rejectUnknownFields,
  stableBuildIdentity,
} from './contracts.js';

const PROPOSAL_FIELDS = [
  'version', 'proposalId', 'planId', 'blueprintId', 'datasetFingerprint', 'datasetSelection',
  'modelDesignPlan', 'task', 'modelFamily', 'architecture', 'executionExpectation', 'graph',
  'validation', 'application', 'authority', 'requiresLearnerAcceptance',
];

function safeCompile(nodes, edges, compile) {
  try {
    const result = compile(nodes, edges);
    return { status: 'supported', report: result.report, irVersion: result.ir.version };
  } catch (error) {
    return { status: 'unsupported', reason: error?.translationKey ?? error?.code ?? 'BUILD_COMPILER_UNSUPPORTED' };
  }
}

function localBrowserAssessment(nodes, edges, dataset) {
  if (!dataset) return { valid: false, reason: 'dataset-required-for-local-validation', details: null };
  const assessment = analyzeBrowserExecutionGraph({ nodes, edges, dataset });
  return {
    valid: assessment.valid,
    reason: assessment.reason ?? null,
    details: assessment.translationParams ?? null,
  };
}

function projectDatasetForPlan(dataset, context, plan) {
  if (!dataset || !context) return null;
  const available = new Set(dataset.featureColumns);
  const selected = plan.dataset.featureColumns;
  if (
    selected.some((name) => !available.has(name))
    || plan.dataset.targetColumn !== dataset.targetColumn
  ) return null;
  const nonNumeric = selected.filter((name) => context.featureColumns.find((column) => column.name === name)?.type !== 'number');
  if (nonNumeric.length) failBuildAgent('BUILD_NUMERIC_FEATURES_REQUIRED', 'Selected graph features must be numeric.', { features: nonNumeric });
  const selectedColumns = new Set([...selected, plan.dataset.targetColumn]);
  return {
    ...dataset,
    columns: dataset.columns?.filter((column) => selectedColumns.has(column.name)),
    featureColumns: [...selected],
    targetColumn: plan.dataset.targetColumn,
  };
}

function datasetStale(expected, actual, source) {
  failBuildAgent('BUILD_DATASET_STALE', 'Build proposal is bound to a different dataset state.', {
    expectedFingerprint: expected,
    actualFingerprint: actual,
    source,
  });
}

function datasetSelectionForPlan(plan) {
  return {
    featureColumns: [...plan.dataset.featureColumns],
    targetColumn: plan.dataset.targetColumn,
  };
}

function proposalIdFor(modelDesignPlan, datasetSelection, graph) {
  return stableBuildIdentity({
    modelDesignPlan,
    datasetSelection,
    graphIdentity: {
      semanticFingerprint: graphSemanticFingerprintV1(graph),
      presentationFingerprint: graphPresentationFingerprintV1(graph),
    },
  }, 'proposal');
}

function canonicalGraphJson(graph) {
  try {
    return `${canonicalGraphSemanticsJsonV1(graph)}\n${canonicalGraphLayoutJsonV1(graph)}`;
  } catch (error) {
    failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', 'Proposal graph is invalid or exceeds canonical comparison bounds.', {
      cause: error?.code ?? 'GRAPH_IDENTITY_INVALID',
    });
  }
}

function applicationGate({ executionExpectation, datasetBindingCurrent, selectedFeaturesMaterializable, browser, tier, source }) {
  const reasons = [];
  if (!datasetBindingCurrent) reasons.push('BUILD_DATASET_BINDING_UNVERIFIED');
  if (!selectedFeaturesMaterializable) reasons.push('BUILD_SELECTED_FEATURES_NOT_MATERIALIZABLE');
  if (executionExpectation === 'browser-local') {
    if (!browser.valid) reasons.push('BUILD_BROWSER_PREFLIGHT_FAILED');
    if (!tier.canRunHere) reasons.push('BUILD_BROWSER_EXECUTION_UNAVAILABLE');
  } else if (executionExpectation === 'export-only') {
    if (!Object.values(source).some((assessment) => assessment.status === 'supported')) {
      reasons.push('BUILD_SOURCE_EXPORT_UNAVAILABLE');
    }
  } else {
    reasons.push('BUILD_EXECUTION_EXPECTATION_UNAVAILABLE');
  }
  return { status: reasons.length ? 'blocked' : 'applicable', reasons };
}

function validateProposalValidation(value) {
  rejectUnknownFields(value, [
    'datasetBindingCurrent', 'selectedFeaturesMaterializable', 'browser', 'tier', 'source',
  ], 'BUILD_PROPOSAL_INVALID', 'proposal.validation');
  if (typeof value.datasetBindingCurrent !== 'boolean' || typeof value.selectedFeaturesMaterializable !== 'boolean') {
    failBuildAgent('BUILD_PROPOSAL_INVALID', 'Proposal validation binding facts must be boolean.');
  }
  rejectUnknownFields(value.browser, ['valid', 'reason', 'details'], 'BUILD_PROPOSAL_INVALID', 'proposal.validation.browser');
  if (typeof value.browser.valid !== 'boolean') failBuildAgent('BUILD_PROPOSAL_INVALID', 'proposal.validation.browser.valid must be boolean.');
  if (value.browser.reason !== null && (typeof value.browser.reason !== 'string' || value.browser.reason.length > 160)) {
    failBuildAgent('BUILD_PROPOSAL_INVALID', 'proposal.validation.browser.reason must be bounded text or null.');
  }
  if (value.browser.valid !== (value.browser.reason === null)) failBuildAgent('BUILD_PROPOSAL_INVALID', 'Browser validity and reason disagree.');
  assertJsonSafe(value.browser.details, 'BUILD_PROPOSAL_INVALID');

  rejectUnknownFields(value.tier, ['executionExpectation', 'canRunHere', 'browserBackendComplete', 'reasons'], 'BUILD_PROPOSAL_INVALID', 'proposal.validation.tier');
  if (!['browser-local', 'export-only', 'unsupported'].includes(value.tier.executionExpectation)) {
    failBuildAgent('BUILD_PROPOSAL_INVALID', 'proposal.validation.tier.executionExpectation is unsupported.');
  }
  if (typeof value.tier.canRunHere !== 'boolean' || typeof value.tier.browserBackendComplete !== 'boolean') {
    failBuildAgent('BUILD_PROPOSAL_INVALID', 'Proposal validation tier capabilities must be boolean.');
  }
  boundedStringArray(value.tier.reasons, 'proposal.validation.tier.reasons', { max: 16 });

  rejectUnknownFields(value.source, ['pytorch', 'tensorflow'], 'BUILD_PROPOSAL_INVALID', 'proposal.validation.source');
  for (const framework of ['pytorch', 'tensorflow']) {
    const assessment = value.source[framework];
    if (!assessment || !['supported', 'unsupported'].includes(assessment.status)) {
      failBuildAgent('BUILD_PROPOSAL_INVALID', `proposal.validation.source.${framework}.status is unsupported.`);
    }
    if (assessment.status === 'supported') {
      rejectUnknownFields(assessment, ['status', 'report', 'irVersion'], 'BUILD_PROPOSAL_INVALID', `proposal.validation.source.${framework}`);
      if (!Array.isArray(assessment.report) || assessment.report.length > 256) failBuildAgent('BUILD_PROPOSAL_INVALID', 'Compiler report is invalid.');
      boundedInteger(assessment.irVersion, `proposal.validation.source.${framework}.irVersion`, { min: 1, max: 1_000 });
    } else {
      rejectUnknownFields(assessment, ['status', 'reason'], 'BUILD_PROPOSAL_INVALID', `proposal.validation.source.${framework}`);
      boundedStringArray([assessment.reason], `proposal.validation.source.${framework}.reason`, { max: 1, itemMax: 160 });
    }
  }
  return value;
}

/**
 * Build a detached proposal and verify that its semantic dataset binding is
 * still current before computing its single authoritative applicability gate.
 */
export function createGraphProposal({ plan, dataset = null, datasetContext = null } = {}) {
  const validatedPlan = validateModelDesignPlan(plan);
  let context = datasetContext ? assertDatasetContext(datasetContext) : null;
  let localDataset = null;
  let actualFingerprint = null;

  if (dataset) {
    try {
      localDataset = validateAgentDataset(dataset);
      actualFingerprint = fingerprintBuildDataset(localDataset);
    } catch (error) {
      if (error?.code?.startsWith?.('BUILD_')) throw error;
      failBuildAgent('BUILD_DATASET_CONTEXT_INVALID', 'Local dataset cannot be validated for proposal preflight.', {
        cause: error?.code ?? 'INVALID_DATASET',
      });
    }
    if (context && context.datasetFingerprint !== actualFingerprint) {
      datasetStale(context.datasetFingerprint, actualFingerprint, 'context-vs-dataset');
    }
    if (!context) context = createBuildDatasetContext(localDataset);
  }

  if (context && context.datasetFingerprint !== validatedPlan.dataset.fingerprint) {
    datasetStale(validatedPlan.dataset.fingerprint, context.datasetFingerprint, 'plan-vs-context');
  }
  if (actualFingerprint && actualFingerprint !== validatedPlan.dataset.fingerprint) {
    datasetStale(validatedPlan.dataset.fingerprint, actualFingerprint, 'plan-vs-dataset');
  }

  const graph = materializeBuildBlueprint({ blueprintId: validatedPlan.blueprintId, plan: validatedPlan, datasetContext: context });
  const selectedDataset = projectDatasetForPlan(localDataset, context, validatedPlan);
  const browser = localBrowserAssessment(graph.nodes, graph.edges, selectedDataset);
  const tier = estimateExecutionPlan(graph.nodes, selectedDataset, { edges: graph.edges });
  const source = {
    pytorch: safeCompile(graph.nodes, graph.edges, compilePipelineToPyTorch),
    tensorflow: safeCompile(graph.nodes, graph.edges, compilePipelineToTensorFlow),
  };
  const datasetBindingCurrent = Boolean(context)
    && context.datasetFingerprint === validatedPlan.dataset.fingerprint
    && (!actualFingerprint || actualFingerprint === validatedPlan.dataset.fingerprint);
  const selectedFeaturesMaterializable = Boolean(selectedDataset);
  const application = applicationGate({
    executionExpectation: validatedPlan.executionExpectation,
    datasetBindingCurrent,
    selectedFeaturesMaterializable,
    browser,
    tier,
    source,
  });
  const proposal = {
    version: BUILD_AGENT_CONTRACT_VERSION,
    proposalId: proposalIdFor(validatedPlan, datasetSelectionForPlan(validatedPlan), graph),
    planId: validatedPlan.planId,
    blueprintId: validatedPlan.blueprintId,
    datasetFingerprint: validatedPlan.dataset.fingerprint,
    datasetSelection: datasetSelectionForPlan(validatedPlan),
    modelDesignPlan: cloneJson(validatedPlan),
    task: validatedPlan.task,
    modelFamily: validatedPlan.modelFamily,
    architecture: validatedPlan.architecture,
    executionExpectation: validatedPlan.executionExpectation,
    graph: cloneJson(graph),
    validation: {
      datasetBindingCurrent,
      selectedFeaturesMaterializable,
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
    application,
    authority: 'detached-proposal',
    requiresLearnerAcceptance: true,
  };
  assertJsonSafe(proposal, 'BUILD_PROPOSAL_INVALID');
  return validateGraphProposal(proposal);
}

export function validateGraphProposal(value) {
  rejectUnknownFields(value, PROPOSAL_FIELDS, 'BUILD_PROPOSAL_INVALID', 'proposal');
  if (value.version !== BUILD_AGENT_CONTRACT_VERSION) failBuildAgent('BUILD_CONTRACT_VERSION_UNSUPPORTED', 'proposal.version is unsupported.');
  assertBuildIdentity(value.proposalId, 'proposal', 'proposal.proposalId');
  assertBuildIdentity(value.planId, 'plan', 'proposal.planId');
  assertBuildIdentity(value.datasetFingerprint, 'dataset', 'proposal.datasetFingerprint');
  const modelDesignPlan = validateModelDesignPlan(value.modelDesignPlan);
  if (
    value.planId !== modelDesignPlan.planId
    || value.datasetFingerprint !== modelDesignPlan.dataset.fingerprint
    || value.blueprintId !== modelDesignPlan.blueprintId
    || value.task !== modelDesignPlan.task
    || value.modelFamily !== modelDesignPlan.modelFamily
    || value.architecture !== modelDesignPlan.architecture
    || value.executionExpectation !== modelDesignPlan.executionExpectation
  ) failBuildAgent('BUILD_PROPOSAL_INVALID', 'Proposal identity fields must match the embedded ModelDesignPlanV1.');
  rejectUnknownFields(value.datasetSelection, ['featureColumns', 'targetColumn'], 'BUILD_PROPOSAL_INVALID', 'proposal.datasetSelection');
  const selectedFeatures = boundedStringArray(value.datasetSelection.featureColumns, 'proposal.datasetSelection.featureColumns', { max: 64 });
  if (!selectedFeatures.length) failBuildAgent('BUILD_PROPOSAL_INVALID', 'Proposal dataset selection requires at least one feature.');
  const targetColumn = boundedStringArray([value.datasetSelection.targetColumn], 'proposal.datasetSelection.targetColumn', { max: 1 })[0];
  if (selectedFeatures.includes(targetColumn)) failBuildAgent('BUILD_PROPOSAL_INVALID', 'Proposal target cannot also be a selected feature.');
  if (
    JSON.stringify(selectedFeatures) !== JSON.stringify(modelDesignPlan.dataset.featureColumns)
    || targetColumn !== modelDesignPlan.dataset.targetColumn
  ) failBuildAgent('BUILD_PROPOSAL_INVALID', 'Proposal dataset selection must match the embedded ModelDesignPlanV1.');
  if (!BUILD_EXECUTION_EXPECTATIONS.includes(value.executionExpectation)) failBuildAgent('BUILD_PROPOSAL_INVALID', 'proposal.executionExpectation is unsupported.');
  const blueprint = BUILD_BLUEPRINTS[value.blueprintId];
  if (!blueprint || blueprint.task !== value.task || blueprint.modelFamily !== value.modelFamily || blueprint.architecture !== value.architecture) {
    failBuildAgent('BUILD_PROPOSAL_INVALID', 'Proposal identity does not match a registered blueprint.');
  }
  if (value.authority !== 'detached-proposal' || value.requiresLearnerAcceptance !== true) failBuildAgent('BUILD_PROPOSAL_INVALID', 'Proposal authority must remain detached and learner-confirmed.');
  validateProposalValidation(value.validation);
  rejectUnknownFields(value.application, ['status', 'reasons'], 'BUILD_PROPOSAL_INVALID', 'proposal.application');
  if (!['applicable', 'blocked'].includes(value.application.status)) failBuildAgent('BUILD_PROPOSAL_INVALID', 'proposal.application.status is unsupported.');
  const reasons = boundedStringArray(value.application.reasons, 'proposal.application.reasons', { max: 8 });
  if ((value.application.status === 'applicable') !== (reasons.length === 0)) failBuildAgent('BUILD_PROPOSAL_INVALID', 'proposal.application status and reasons disagree.');
  const expectedApplication = applicationGate({
    executionExpectation: value.executionExpectation,
    datasetBindingCurrent: value.validation.datasetBindingCurrent,
    selectedFeaturesMaterializable: value.validation.selectedFeaturesMaterializable,
    browser: value.validation.browser,
    tier: value.validation.tier,
    source: value.validation.source,
  });
  if (value.application.status !== expectedApplication.status
    || JSON.stringify(reasons) !== JSON.stringify(expectedApplication.reasons)) {
    failBuildAgent('BUILD_PROPOSAL_INVALID', 'Proposal application gate does not match its validation facts.');
  }
  const proposalGraph = canonicalGraphJson(value.graph);
  // Plans carry the selected feature count and class count required by the
  // canonical builder, so rematerialization does not need current dataset
  // state. Dataset freshness is checked separately by the freshness helper.
  const canonicalGraph = materializeBuildBlueprint({
    blueprintId: modelDesignPlan.blueprintId,
    plan: modelDesignPlan,
    datasetContext: null,
  });
  if (value.graph?.blueprintId !== modelDesignPlan.blueprintId) {
    failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', 'Proposal graph blueprint identity differs from the embedded plan.');
  }
  if (proposalGraph !== canonicalGraphJson(canonicalGraph)) {
    failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', 'Proposal graph differs from its registered canonical blueprint.');
  }
  if (value.proposalId !== proposalIdFor(modelDesignPlan, value.datasetSelection, canonicalGraph)) {
    failBuildAgent('BUILD_PROPOSAL_INVALID', 'proposal.proposalId does not match the embedded plan and canonical graph.');
  }
  assertJsonSafe(value, 'BUILD_PROPOSAL_INVALID');
  return structuredClone(value);
}

/** Pure stale check for a future Apply boundary; it never applies a proposal. */
export function assessGraphProposalAgainstDataset(proposal, currentDatasetContext) {
  try {
    const validatedProposal = validateGraphProposal(proposal);
    const currentContext = assertDatasetContext(currentDatasetContext);
    if (validatedProposal.datasetFingerprint !== currentContext.datasetFingerprint) {
      return { compatible: false, code: 'BUILD_DATASET_STALE' };
    }
    const selectedNames = new Set(currentContext.featureColumns.map((column) => column.name));
    if (
      validatedProposal.datasetSelection.targetColumn !== currentContext.targetColumn.name
      || validatedProposal.datasetSelection.featureColumns.some((name) => !selectedNames.has(name))
      || validatedProposal.datasetSelection.featureColumns.some((name) => currentContext.featureColumns.find((column) => column.name === name)?.type !== 'number')
    ) return { compatible: false, code: 'BUILD_PROPOSAL_DATASET_SELECTION_INVALID' };
    return { compatible: true };
  } catch (error) {
    return { compatible: false, code: error?.code ?? 'BUILD_PROPOSAL_INVALID' };
  }
}

export function isDetachedGraphProposal(value) {
  return value?.version === BUILD_AGENT_CONTRACT_VERSION
    && value?.authority === 'detached-proposal'
    && value?.requiresLearnerAcceptance === true;
}
