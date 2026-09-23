import { analyzeBrowserExecutionGraph } from '../browserExecutionContract.js';
import { compilePipelineToPyTorch, compilePipelineToTensorFlow } from '../compiler.js';
import { estimateExecutionPlan } from '../runtimeTiers.js';
import { validateAgentDataset } from '../canvasAgent.js';
import { assertDatasetContext, createBuildDatasetContext, fingerprintBuildDataset } from './datasetContext.js';
import { BUILD_BLUEPRINTS, materializeBuildBlueprint } from './graphBlueprints.js';
import { validateModelDesignPlan } from './modelDesignPlan.js';
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
const MAX_PROPOSAL_NODES = 256;
const MAX_PROPOSAL_EDGES = 512;
const MAX_CANONICAL_GRAPH_CODE_UNITS = 1_000_000;

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
    graph: semanticGraphProjection(graph),
  }, 'proposal');
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJsonValue(value[key])]));
}

function assertBoundedGraphJsonSafe(value, path = 'graph', depth = 0, ancestors = new WeakSet(), budget = { values: 0, codeUnits: 0 }) {
  budget.values += 1;
  if (budget.values > 50_000 || depth > 32) {
    failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', 'Proposal graph exceeds the canonical traversal bounds.');
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    budget.codeUnits += value.length;
    if (budget.codeUnits > MAX_CANONICAL_GRAPH_CODE_UNITS) {
      failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', 'Proposal graph exceeds the canonical comparison size bound.');
    }
    return;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', `Proposal graph contains a non-finite number at ${path}.`);
  }
  if (!value || typeof value !== 'object' || ancestors.has(value)) {
    failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', `Proposal graph contains a non-JSON value at ${path}.`);
  }
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
    failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', `Proposal graph contains a non-plain object at ${path}.`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) {
      failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', `Proposal graph contains a sparse or extended array at ${path}.`);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', `Proposal graph contains a sparse array at ${path}.`);
      assertBoundedGraphJsonSafe(value[index], `${path}[${index}]`, depth + 1, ancestors, budget);
    }
  } else {
    const entries = Object.entries(value);
    for (const [key, child] of entries) {
      budget.codeUnits += key.length;
      if (budget.codeUnits > MAX_CANONICAL_GRAPH_CODE_UNITS) {
        failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', 'Proposal graph exceeds the canonical comparison size bound.');
      }
      assertBoundedGraphJsonSafe(child, `${path}.${key}`, depth + 1, ancestors, budget);
    }
  }
  ancestors.delete(value);
}

function portContract(ports, path) {
  if (!Array.isArray(ports)) failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', `Proposal graph has an invalid port contract at ${path}.`);
  const projected = ports.map((port) => {
    if (!port || typeof port.name !== 'string' || typeof port.type !== 'string') {
      failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', `Proposal graph has an invalid port contract at ${path}.`);
    }
    return { name: port.name, type: port.type };
  });
  return projected.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : left.type < right.type ? -1 : left.type > right.type ? 1 : 0);
}

function componentContract(manifest, path) {
  if (
    !Number.isInteger(manifest.schemaVersion)
    || typeof manifest.kind !== 'string'
    || !Array.isArray(manifest.properties)
    || !manifest.runtime || typeof manifest.runtime !== 'object'
    || !manifest.compatibility || typeof manifest.compatibility !== 'object'
  ) failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', `Proposal graph has an invalid component contract at ${path}.`);
  return {
    schemaVersion: manifest.schemaVersion,
    kind: manifest.kind,
    properties: manifest.properties.map((property) => {
      if (!property || typeof property !== 'object' || Array.isArray(property)) {
        failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', `Proposal graph has an invalid property schema at ${path}.`);
      }
      const { label: _presentationLabel, ...semanticSchema } = property;
      return semanticSchema;
    }),
    runtime: manifest.runtime,
    compatibility: manifest.compatibility,
    composition: manifest.composition ?? null,
  };
}

function semanticGraphProjection(graph) {
  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', 'Proposal graph is structurally invalid.');
  }
  const nodes = graph.nodes.map((node) => {
    const manifest = node?.data?.manifest;
    const parameters = node?.data?.parameters;
    const position = node?.position;
    if (
      !node || typeof node.id !== 'string' || !node.id
      || !manifest || typeof manifest.id !== 'string' || !manifest.id
      || typeof manifest.op !== 'string' || !manifest.op
      || !parameters || typeof parameters !== 'object' || Array.isArray(parameters)
      || !position || !Number.isFinite(position.x) || !Number.isFinite(position.y)
    ) failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', 'Proposal graph node is missing canonical semantic fields.');
    return {
      id: node.id,
      componentId: manifest.id,
      operation: manifest.op,
      componentContract: componentContract(manifest, node.id),
      parameters,
      inputs: portContract(manifest.inputs, `${node.id}.inputs`),
      outputs: portContract(manifest.outputs, `${node.id}.outputs`),
      position: { x: position.x, y: position.y },
    };
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const edges = graph.edges.map((edge) => {
    if (
      !edge || typeof edge.id !== 'string' || !edge.id
      || typeof edge.source !== 'string' || !edge.source
      || typeof edge.sourceHandle !== 'string' || !edge.sourceHandle
      || typeof edge.target !== 'string' || !edge.target
      || typeof edge.targetHandle !== 'string' || !edge.targetHandle
    ) failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', 'Proposal graph edge is missing canonical semantic fields.');
    return {
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
    };
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  if (typeof graph.blueprintId !== 'string' || !graph.blueprintId) {
    failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', 'Proposal graph blueprint identity is missing.');
  }
  return { blueprintId: graph.blueprintId, nodes, edges };
}

function canonicalGraphJson(graph) {
  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', 'Proposal graph is structurally invalid.');
  }
  if (graph.nodes.length > MAX_PROPOSAL_NODES || graph.edges.length > MAX_PROPOSAL_EDGES) {
    failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', 'Proposal graph exceeds the canonical comparison bounds.', {
      maxNodes: MAX_PROPOSAL_NODES,
      maxEdges: MAX_PROPOSAL_EDGES,
    });
  }
  assertBoundedGraphJsonSafe(graph);
  const canonical = JSON.stringify(canonicalJsonValue(semanticGraphProjection(graph)));
  if (typeof canonical !== 'string' || canonical.length > MAX_CANONICAL_GRAPH_CODE_UNITS) {
    failBuildAgent('BUILD_PROPOSAL_GRAPH_MISMATCH', 'Proposal graph exceeds the canonical comparison size bound.', {
      maxCodeUnits: MAX_CANONICAL_GRAPH_CODE_UNITS,
    });
  }
  return canonical;
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
