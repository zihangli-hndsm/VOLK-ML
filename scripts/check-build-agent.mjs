import { exerciseDatasets } from '../src/core/buildAgent/exerciseFixtures.js';
import {
  BUILD_EXECUTION_EXPECTATIONS,
  createBuildDatasetContext,
  fingerprintBuildDataset,
  projectBuildDatasetContext,
  planBuildGoal,
  materializeBuildBlueprint,
  createGraphProposal,
  assessGraphProposalAgainstDataset,
  validateGraphProposal,
  validateBuildGoal,
  validateModelDesignPlan,
} from '../src/core/buildAgent/index.js';
import { executeBrowserGraph } from '../src/core/browserRuntime.js';
import { analyzeBrowserExecutionGraph } from '../src/core/browserExecutionContract.js';
import { createAgentNode, connectAgentNodes } from '../src/core/canvasAgent.js';
import { componentById } from '../src/core/components.js';

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function expectCode(operation, code) {
  try {
    operation();
  } catch (error) {
    check(error?.code === code, `Expected ${code}, received ${error?.code ?? error?.message}`);
    return;
  }
  throw new Error(`Expected ${code}.`);
}

const goal = (goalId, overrides = {}) => ({
  version: 1,
  goalId,
  task: null,
  modelFamily: null,
  architecture: null,
  dataset: null,
  executionExpectation: 'browser-local',
  parameters: null,
  ...overrides,
});

for (const expected of ['browser-local', 'export-only', 'future-cloud', 'unsupported']) check(
  BUILD_EXECUTION_EXPECTATIONS.includes(expected), `Missing execution vocabulary ${expected}.`,
);

const wineContext = createBuildDatasetContext(exerciseDatasets.wine);
const irisContext = createBuildDatasetContext(exerciseDatasets.iris);
const mlpContext = createBuildDatasetContext(exerciseDatasets.mlpClassification);

check(wineContext.datasetFingerprint === createBuildDatasetContext(exerciseDatasets.wine).datasetFingerprint, 'Same semantic dataset must have a stable fingerprint.');
check(wineContext.datasetFingerprint === fingerprintBuildDataset(exerciseDatasets.wine), 'Context and local dataset fingerprint paths must agree.');
const changedWineDataset = {
  ...exerciseDatasets.wine,
  rows: exerciseDatasets.wine.rows.map((row, index) => index === 0 ? { ...row, quality: row.quality + 0.125 } : row),
};
check(wineContext.datasetFingerprint !== fingerprintBuildDataset(changedWineDataset), 'A relevant row change must change dataset identity.');
check(wineContext.datasetFingerprint !== createBuildDatasetContext({ ...exerciseDatasets.wine, task: 'classification' }).datasetFingerprint, 'A task change must change dataset identity.');
check(wineContext.datasetFingerprint === fingerprintBuildDataset({ ...exerciseDatasets.wine, name: 'renamed', fileContents: 'private-file-contents' }), 'Names and file contents are not dataset training semantics.');
check(wineContext.datasetFingerprint !== fingerprintBuildDataset({ ...exerciseDatasets.wine, rows: [...exerciseDatasets.wine.rows].reverse() }), 'Training row order is part of dataset identity.');

const projectedWineContext = projectBuildDatasetContext(wineContext);
check(!Object.hasOwn(projectedWineContext, 'rows'), 'Provider context must not contain rows.');
check(!Object.hasOwn(projectedWineContext, 'rawValues'), 'Provider context must not contain raw values.');
const wineDatasetWithSentinel = {
  ...exerciseDatasets.wine,
  rows: exerciseDatasets.wine.rows.map((row, index) => index === 0 ? { ...row, rowOnly: 'row-only-sentinel' } : row),
};
const projectedSentinelContext = projectBuildDatasetContext(createBuildDatasetContext(wineDatasetWithSentinel));
check(!JSON.stringify(projectedSentinelContext).includes('row-only-sentinel'), 'Provider projection must not serialize a row-only sentinel from an original row.');
expectCode(() => projectBuildDatasetContext({ ...wineContext, rows: [{ rowOnly: 'row-only-sentinel' }] }), 'BUILD_DATASET_CONTEXT_INVALID');

const mixedDataset = {
  name: 'private-dataset-name-sentinel',
  fileContents: 'private-file-contents-sentinel',
  task: 'classification',
  featureColumns: ['age', 'income', 'city'],
  targetColumn: 'churn',
  rows: Array.from({ length: 12 }, (_, index) => ({
    age: 20 + index,
    income: 30000 + index * 2500,
    city: `raw-city-sentinel-${index}`,
    churn: index % 2 ? 'yes-label-sentinel' : 'no-label-sentinel',
    unused: 'raw-cell-sentinel',
  })),
};
const mixedContext = createBuildDatasetContext(mixedDataset);
const mixedProjection = projectBuildDatasetContext(mixedContext);
const serializedMixedProjection = JSON.stringify(mixedProjection);
check(mixedProjection.featureColumns.some((column) => column.name === 'age' && column.type === 'number'), 'Mixed projection must retain numeric feature metadata.');
check(mixedProjection.featureColumns.some((column) => column.name === 'city' && column.type === 'text'), 'Mixed projection must retain text feature metadata.');
check(mixedProjection.targetColumn.name === 'churn' && mixedProjection.targetColumn.type === 'text', 'Mixed projection must retain target schema metadata.');
check(!Object.hasOwn(mixedProjection, 'datasetFingerprint'), 'Local dataset fingerprint is not part of provider projection.');
for (const sentinel of ['raw-city-sentinel', 'yes-label-sentinel', 'no-label-sentinel', 'raw-cell-sentinel', 'private-file-contents-sentinel', 'private-dataset-name-sentinel']) {
  check(!serializedMixedProjection.includes(sentinel), `Provider projection leaked ${sentinel}.`);
}
const mixedNumericPlan = planBuildGoal(goal('mixed-numeric-subset', {
  task: 'classification',
  dataset: { featureColumns: ['age', 'income'], targetColumn: 'churn' },
}), mixedContext);
check(mixedNumericPlan.kind === 'plan', 'A numeric selected subset from a mixed schema must plan successfully.');
const mixedTextPlan = planBuildGoal(goal('mixed-text-selection', {
  task: 'classification',
  dataset: { featureColumns: ['city', 'income'], targetColumn: 'churn' },
}), mixedContext);
check(mixedTextPlan.kind === 'unsupported' && mixedTextPlan.code === 'BUILD_NUMERIC_FEATURES_REQUIRED', 'Selected text features must remain a typed unsupported outcome.');
const mixedNumericProposal = createGraphProposal({ plan: mixedNumericPlan.plan, dataset: mixedDataset, datasetContext: mixedContext });
check(mixedNumericProposal.application.status === 'applicable', 'A selected numeric subset must be preflighted independently from unused text columns.');
check(mixedNumericProposal.application.reasons.length === 0, 'A materializable numeric subset must have no application blockers.');
check(JSON.stringify(mixedNumericProposal.datasetSelection.featureColumns) === JSON.stringify(['age', 'income']), 'Proposal must preserve the selected feature projection that passed preflight.');
expectCode(() => validateGraphProposal({ ...mixedNumericProposal, datasetSelection: { ...mixedNumericProposal.datasetSelection, featureColumns: ['city'] } }), 'BUILD_PROPOSAL_INVALID');
const missingCityDataset = {
  ...mixedDataset,
  rows: mixedDataset.rows.map((row, index) => index === 0 ? Object.fromEntries(Object.entries(row).filter(([name]) => name !== 'city')) : row),
};
const missingCityAsNull = {
  ...mixedDataset,
  rows: mixedDataset.rows.map((row, index) => index === 0 ? { ...row, city: null } : row),
};
const missingCityAsBlank = {
  ...mixedDataset,
  rows: mixedDataset.rows.map((row, index) => index === 0 ? { ...row, city: '  ' } : row),
};
const missingCityContext = createBuildDatasetContext(missingCityDataset);
check(missingCityContext.datasetFingerprint === createBuildDatasetContext(missingCityAsNull).datasetFingerprint, 'Missing-key and null cells must share the runtime missing-value identity.');
check(missingCityContext.datasetFingerprint === createBuildDatasetContext(missingCityAsBlank).datasetFingerprint, 'Blank cells must share the runtime missing-value identity.');
const missingCityPlan = planBuildGoal(goal('mixed-missing-unused-cell', {
  task: 'classification', dataset: { featureColumns: ['age', 'income'], targetColumn: 'churn' },
}), missingCityContext);
check(missingCityPlan.kind === 'plan', 'A missing unused mixed-schema cell must still form a planning context.');
const missingCityProposal = createGraphProposal({ plan: missingCityPlan.plan, dataset: missingCityDataset, datasetContext: missingCityContext });
check(missingCityProposal.application.status === 'applicable', 'A missing unused text cell must not block selected numeric-feature preflight.');
const sparseSelectedDataset = {
  ...mixedDataset,
  rows: mixedDataset.rows.map((row, index) => index < 2 ? row : { ...row, age: null }),
};
const sparseSelectedContext = createBuildDatasetContext(sparseSelectedDataset);
const sparseSelectedPlan = planBuildGoal(goal('mixed-sparse-selected-cell', {
  task: 'classification', dataset: { featureColumns: ['age', 'income'], targetColumn: 'churn' },
}), sparseSelectedContext);
check(sparseSelectedPlan.kind === 'plan', 'Target-valid planning remains distinct from selected-feature preflight.');
const sparseSelectedProposal = createGraphProposal({ plan: sparseSelectedPlan.plan, dataset: sparseSelectedDataset, datasetContext: sparseSelectedContext });
check(sparseSelectedProposal.application.status === 'blocked' && sparseSelectedProposal.application.reasons.includes('BUILD_BROWSER_PREFLIGHT_FAILED'), 'Insufficient selected-feature rows must be decided by normal browser preflight.');

expectCode(() => validateBuildGoal({ ...goal('unknown'), opaque: true }), 'BUILD_GOAL_INVALID');

const winePlanResult = planBuildGoal(goal('wine-default'), wineContext);
check(winePlanResult.kind === 'plan' && winePlanResult.plan.modelFamily === 'linear-regression', 'Regression default must use linear baseline.');
const irisPlanResult = planBuildGoal(goal('iris-default'), irisContext);
check(irisPlanResult.kind === 'plan' && irisPlanResult.plan.modelFamily === 'knn', 'Classification default must use KNN baseline.');
const mlpPlanResult = planBuildGoal(goal('mlp-explicit', { task: 'classification', modelFamily: 'mlp', architecture: 'explicit-mlp', parameters: { hiddenUnits: 6 } }), mlpContext);
check(mlpPlanResult.kind === 'plan' && mlpPlanResult.plan.blueprintId === 'tabular-classification-mlp-v1', 'Explicit MLP must select MLP blueprint.');
const mlpRegressionPlanResult = planBuildGoal(goal('mlp-regression-explicit', { task: 'regression', modelFamily: 'mlp', architecture: 'explicit-mlp', parameters: { hiddenUnits: 6 } }), createBuildDatasetContext(exerciseDatasets.mlpRegression));
check(mlpRegressionPlanResult.kind === 'plan' && mlpRegressionPlanResult.plan.blueprintId === 'tabular-regression-mlp-v1', 'Explicit regression MLP must select the supported MLP regression blueprint.');
check(planBuildGoal(goal('cloud', { executionExpectation: 'future-cloud' }), wineContext).kind === 'unsupported', 'Future cloud must be typed unsupported.');
const unknownTarget = planBuildGoal(goal('unknown-target', {
  task: 'regression', dataset: { featureColumns: ['alcohol', 'sulphates', 'acidity'], targetColumn: 'missing_target' },
}), wineContext);
check(unknownTarget.kind === 'clarification' && unknownTarget.code === 'BUILD_TARGET_NOT_FOUND', 'Unknown target must request clarification.');
check(planBuildGoal(goal('unsupported-family', { modelFamily: 'transformer' }), wineContext).kind === 'unsupported', 'Unsupported model family must be typed unsupported.');
check(planBuildGoal(goal('unsupported-task', { task: 'image' }), wineContext).kind === 'unsupported', 'Unsupported task must be typed unsupported.');

const nonNumeric = createBuildDatasetContext({
  name: 'Unsupported feature fixture', task: 'classification', rows: [{ city: 'a', label: 'x' }, { city: 'b', label: 'y' }, { city: 'a', label: 'x' }],
  featureColumns: ['city'], targetColumn: 'label',
});
check(planBuildGoal(goal('text-feature'), nonNumeric).kind === 'unsupported', 'Non-numeric features must produce typed unsupported output.');

const runtimeFixtures = [
  ['wine', wineContext, winePlanResult.plan, (metrics) => metrics.r2 >= 0.98],
  ['iris', irisContext, irisPlanResult.plan, (metrics) => metrics.accuracy >= 0.65],
  ['mlp-classification', mlpContext, mlpPlanResult.plan, (metrics) => metrics.accuracy >= 0.9],
  ['mlp-regression', mlpRegressionPlanResult.context, mlpRegressionPlanResult.plan, (metrics) => metrics.r2 >= 0.98],
];

const sameSemanticsDifferentGoal = planBuildGoal(goal('different-request-id'), wineContext);
check(sameSemanticsDifferentGoal.plan.planId === winePlanResult.plan.planId, 'Request IDs must not replace semantic plan identity.');
const hiddenUnitsPlan = planBuildGoal(goal('changed-hidden-units', {
  task: 'classification', modelFamily: 'mlp', architecture: 'explicit-mlp', parameters: { hiddenUnits: 7 },
}), mlpContext);
check(hiddenUnitsPlan.plan.planId !== mlpPlanResult.plan.planId, 'Changing hiddenUnits must change semantic plan identity.');
const featureSubsetPlan = planBuildGoal(goal('changed-feature-set', {
  dataset: { featureColumns: ['alcohol', 'sulphates'], targetColumn: 'quality' },
}), wineContext);
check(featureSubsetPlan.plan.planId !== winePlanResult.plan.planId, 'Changing selected features must change semantic plan identity.');
const changedDatasetPlan = planBuildGoal(goal('changed-dataset'), createBuildDatasetContext(changedWineDataset));
check(changedDatasetPlan.plan.planId !== winePlanResult.plan.planId, 'Changing dataset identity must change semantic plan identity.');
const exportOnlyPlan = planBuildGoal(goal('export-only', { executionExpectation: 'export-only' }), wineContext);
check(exportOnlyPlan.plan.planId !== winePlanResult.plan.planId, 'Changing execution expectation must change semantic plan identity.');
const changedEpochPlan = planBuildGoal(goal('changed-epochs', { parameters: { epochs: 201 } }), wineContext);
check(changedEpochPlan.plan.planId !== winePlanResult.plan.planId, 'Changing training parameters must change semantic plan identity.');

expectCode(() => createGraphProposal({ plan: winePlanResult.plan, dataset: changedWineDataset, datasetContext: createBuildDatasetContext(changedWineDataset) }), 'BUILD_DATASET_STALE');
expectCode(() => createGraphProposal({ plan: winePlanResult.plan, dataset: exerciseDatasets.wine, datasetContext: createBuildDatasetContext(changedWineDataset) }), 'BUILD_DATASET_STALE');
expectCode(() => createGraphProposal({ plan: winePlanResult.plan, datasetContext: createBuildDatasetContext(changedWineDataset) }), 'BUILD_DATASET_STALE');

for (const [name, context, plan, metricCheck] of runtimeFixtures) {
  validateModelDesignPlan(plan);
  const dataset = exerciseDatasets[name === 'mlp-classification' ? 'mlpClassification' : name === 'mlp-regression' ? 'mlpRegression' : name];
  const graph = materializeBuildBlueprint({ blueprintId: plan.blueprintId, plan, datasetContext: context });
  check(new Set(graph.nodes.map((node) => node.id)).size === graph.nodes.length, `${name} graph IDs must be unique.`);
  const browser = analyzeBrowserExecutionGraph({ nodes: graph.nodes, edges: graph.edges, dataset });
  check(browser.valid, `${name} graph must pass browser preflight: ${browser.reason ?? 'unknown'}.`);
  const result = await executeBrowserGraph({ nodes: graph.nodes, edges: graph.edges, dataset });
  check(metricCheck(result.metrics), `${name} exercise metric is below baseline.`);
  const proposal = createGraphProposal({ plan, dataset, datasetContext: context });
  check(proposal.authority === 'detached-proposal' && proposal.requiresLearnerAcceptance, `${name} proposal must remain detached.`);
  check(proposal.executionExpectation === 'browser-local', `${name} proposal expectation must use external vocabulary.`);
  check(proposal.validation.browser.valid, `${name} proposal browser assessment must be valid.`);
  check(proposal.datasetFingerprint === plan.dataset.fingerprint, `${name} proposal must carry its plan dataset identity.`);
  check(proposal.modelDesignPlan.planId === plan.planId, `${name} proposal must embed the complete validated ModelDesignPlanV1.`);
  check(proposal.application.status === 'applicable' && proposal.application.reasons.length === 0, `${name} current browser-local proposal must pass the authoritative application gate.`);
  check(validateGraphProposal(proposal).proposalId === proposal.proposalId, `${name} proposal semantic identity must validate.`);
  check(assessGraphProposalAgainstDataset(proposal, context).compatible, `${name} proposal must match its current context.`);
  if (name === 'iris') check(proposal.validation.source.pytorch.status === 'unsupported', 'KNN source export must remain explicitly unsupported.');
  const copy = createGraphProposal({ plan, dataset, datasetContext: context });
  proposal.graph.nodes[0].id = 'mutated-locally';
  check(copy.graph.nodes[0].id !== 'mutated-locally', `${name} proposal must be detached from subsequent proposals.`);
}

const wineProposal = createGraphProposal({ plan: winePlanResult.plan, dataset: exerciseDatasets.wine, datasetContext: wineContext });
check(assessGraphProposalAgainstDataset(wineProposal, createBuildDatasetContext(changedWineDataset)).code === 'BUILD_DATASET_STALE', 'Pure proposal assessment must reject changed dataset identity.');
const exportProposal = createGraphProposal({ plan: exportOnlyPlan.plan, dataset: exerciseDatasets.wine, datasetContext: wineContext });
check(exportProposal.application.status === 'applicable', 'Export-only applicability must not require browser-local execution.');
check(exportProposal.validation.source.pytorch.status === 'supported' || exportProposal.validation.source.tensorflow.status === 'supported', 'Export-only gate must use compiler capability results.');
check(validateGraphProposal(exportProposal).proposalId === exportProposal.proposalId, 'A valid export-only proposal must pass its public validator.');
expectCode(() => validateGraphProposal({
  ...exportProposal,
  validation: {
    ...exportProposal.validation,
    source: {
      pytorch: { status: 'unsupported', reason: 'error.frameworkUnsupported' },
      tensorflow: { status: 'unsupported', reason: 'error.frameworkUnsupported' },
    },
  },
}), 'BUILD_PROPOSAL_INVALID');

const invalidBrowserDataset = {
  name: 'Invalid local sample fixture', task: 'regression', featureColumns: ['x'], targetColumn: 'y',
  rows: [{ x: 1, y: 2 }, { x: null, y: 3 }, { x: null, y: 4 }],
};
const invalidBrowserContext = createBuildDatasetContext(invalidBrowserDataset);
const invalidBrowserPlan = planBuildGoal(goal('invalid-browser-sample'), invalidBrowserContext);
check(invalidBrowserPlan.kind === 'plan', 'Target-valid planning should be separated from selected-feature runtime preflight.');
const blockedProposal = createGraphProposal({ plan: invalidBrowserPlan.plan, dataset: invalidBrowserDataset, datasetContext: invalidBrowserContext });
check(blockedProposal.application.status === 'blocked', 'Invalid browser-local preflight must block proposal application.');
check(blockedProposal.application.reasons.includes('BUILD_BROWSER_PREFLIGHT_FAILED'), 'Blocked application must provide a stable preflight reason.');
check(validateGraphProposal(blockedProposal).proposalId === blockedProposal.proposalId, 'A consistent blocked browser proposal must pass its public validator.');
expectCode(() => validateGraphProposal({
  ...wineProposal,
  validation: {
    ...wineProposal.validation,
    browser: { ...wineProposal.validation.browser, valid: false, reason: 'error.datasetMissing' },
  },
}), 'BUILD_PROPOSAL_INVALID');
expectCode(() => validateGraphProposal({
  ...wineProposal,
  validation: {
    ...wineProposal.validation,
    tier: { ...wineProposal.validation.tier, canRunHere: false, executionExpectation: 'unsupported' },
  },
}), 'BUILD_PROPOSAL_INVALID');
check(assessGraphProposalAgainstDataset(blockedProposal, invalidBrowserContext).compatible, 'Dataset freshness is separate from browser applicability.');

const noDatasetProposal = createGraphProposal({ plan: winePlanResult.plan });
check(noDatasetProposal.application.status === 'blocked' && noDatasetProposal.application.reasons.includes('BUILD_DATASET_BINDING_UNVERIFIED'), 'Unverified binding must block application.');
check(hiddenUnitsPlan.plan.planId !== mlpPlanResult.plan.planId, 'Hidden-unit semantic identity must remain distinct.');
const hiddenUnitsProposal = createGraphProposal({ plan: hiddenUnitsPlan.plan, dataset: exerciseDatasets.mlpClassification, datasetContext: mlpContext });
check(hiddenUnitsProposal.proposalId !== createGraphProposal({ plan: mlpPlanResult.plan, dataset: exerciseDatasets.mlpClassification, datasetContext: mlpContext }).proposalId, 'Proposal identity must follow semantic plan identity.');

const mlpProposal = createGraphProposal({ plan: mlpPlanResult.plan, dataset: exerciseDatasets.mlpClassification, datasetContext: mlpContext });
check(createGraphProposal({ plan: mlpPlanResult.plan, dataset: exerciseDatasets.mlpClassification, datasetContext: mlpContext }).proposalId === mlpProposal.proposalId, 'Identical full plans and canonical graphs must produce the same proposal identity.');
const graphMutation = (mutate) => {
  const candidate = structuredClone(mlpProposal);
  mutate(candidate.graph);
  return candidate;
};
expectCode(() => validateGraphProposal(graphMutation((graph) => {
  graph.nodes.find((node) => node.id === 'build-hidden').data.parameters.units = 7;
})), 'BUILD_PROPOSAL_GRAPH_MISMATCH');
expectCode(() => validateGraphProposal(graphMutation((graph) => {
  graph.nodes.find((node) => node.id === 'build-relu').data.manifest.id = 'sigmoid_node';
})), 'BUILD_PROPOSAL_GRAPH_MISMATCH');
expectCode(() => validateGraphProposal(graphMutation((graph) => {
  graph.nodes.find((node) => node.id === 'build-relu').data.manifest.runtime.browserBackend = 'webgpu';
})), 'BUILD_PROPOSAL_GRAPH_MISMATCH');
expectCode(() => validateGraphProposal(graphMutation((graph) => {
  graph.nodes.find((node) => node.id === 'build-split').data.manifest.properties
    .find((property) => property.key === 'train_ratio').min = 0.55;
})), 'BUILD_PROPOSAL_GRAPH_MISMATCH');
expectCode(() => validateGraphProposal(graphMutation((graph) => { graph.edges.pop(); })), 'BUILD_PROPOSAL_GRAPH_MISMATCH');
expectCode(() => validateGraphProposal(graphMutation((graph) => {
  graph.edges.find((edge) => edge.id === 'build-edge-hidden-relu').target = 'build-head';
})), 'BUILD_PROPOSAL_GRAPH_MISMATCH');
expectCode(() => validateGraphProposal(graphMutation((graph) => {
  graph.nodes.find((node) => node.id === 'build-relu').position.x += 1;
})), 'BUILD_PROPOSAL_GRAPH_MISMATCH');
const presentationOnlyProposal = structuredClone(mlpProposal);
const presentationNode = presentationOnlyProposal.graph.nodes.find((node) => node.id === 'build-relu');
presentationNode.data.label = 'localized presentation label';
presentationNode.data.status = 'success';
presentationNode.data.manifest.name = { en: 'Presentation only', zh: '仅用于呈现' };
presentationNode.data.manifest.description = { en: 'Non-semantic description', zh: '非语义描述' };
check(validateGraphProposal(presentationOnlyProposal).proposalId === mlpProposal.proposalId, 'Labels, runtime status, and localized manifest copy must not affect semantic graph identity.');

let unrelatedNodes = [];
for (const [id, x] of [['unrelated-relu-a', 20], ['unrelated-relu-b', 140]]) {
  unrelatedNodes = [...unrelatedNodes, createAgentNode({
    nodes: unrelatedNodes,
    manifest: componentById.get('relu_node'),
    request: { id, position: { x, y: 420 } },
  })];
}
const unrelatedEdges = connectAgentNodes(unrelatedNodes, [], {
  id: 'unrelated-relu-edge', source: 'unrelated-relu-a', sourceHandle: 'output',
  target: 'unrelated-relu-b', targetHandle: 'input',
});
expectCode(() => validateGraphProposal(graphMutation((graph) => {
  graph.nodes.push(...unrelatedNodes);
  graph.edges.push(...unrelatedEdges);
})), 'BUILD_PROPOSAL_GRAPH_MISMATCH');

const embeddedPlanMutations = [
  ['hiddenUnits', (plan) => { plan.training.hiddenUnits = 7; }],
  ['trainRatio', (plan) => { plan.training.trainRatio = 0.7; }],
  ['selected features', (plan) => { plan.dataset.featureColumns[0] = 'different-feature'; }],
  ['executionExpectation', (plan) => { plan.executionExpectation = 'export-only'; }],
];
for (const [name, mutate] of embeddedPlanMutations) {
  const candidate = structuredClone(mlpProposal);
  mutate(candidate.modelDesignPlan);
  expectCode(() => validateGraphProposal(candidate), 'BUILD_PLAN_INVALID');
  check(candidate.planId === mlpProposal.planId, `${name} tampering must not silently rewrite the proposal identity.`);
}
const changedRatioResult = planBuildGoal(goal('valid-changed-train-ratio', {
  task: 'classification', modelFamily: 'mlp', architecture: 'explicit-mlp',
  parameters: { hiddenUnits: 6, trainRatio: 0.7 },
}), mlpContext);
check(changedRatioResult.kind === 'plan' && validateModelDesignPlan(changedRatioResult.plan), 'Changed trainRatio fixture must be an independently valid plan.');
expectCode(() => validateGraphProposal({
  ...mlpProposal,
  planId: changedRatioResult.plan.planId,
  modelDesignPlan: changedRatioResult.plan,
  graph: mlpProposal.graph,
}), 'BUILD_PROPOSAL_GRAPH_MISMATCH');
expectCode(() => validateGraphProposal({ ...mlpProposal, planId: hiddenUnitsPlan.plan.planId }), 'BUILD_PROPOSAL_INVALID');
check(
  assessGraphProposalAgainstDataset(mlpProposal, createBuildDatasetContext(exerciseDatasets.mlpClassification)).compatible,
  'Exact canonical graph validation must remain separate from current dataset freshness.',
);

console.log(`Build Agent A checks passed (${runtimeFixtures.length} executable blueprints).`);
