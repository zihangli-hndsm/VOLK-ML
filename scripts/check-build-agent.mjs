import { exerciseDatasets } from '../src/core/buildAgent/exerciseFixtures.js';
import {
  BUILD_EXECUTION_EXPECTATIONS,
  createBuildDatasetContext,
  projectBuildDatasetContext,
  planBuildGoal,
  materializeBuildBlueprint,
  createGraphProposal,
  validateBuildGoal,
  validateModelDesignPlan,
} from '../src/core/buildAgent/index.js';
import { executeBrowserGraph } from '../src/core/browserRuntime.js';
import { analyzeBrowserExecutionGraph } from '../src/core/browserExecutionContract.js';

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
  ['mlp-regression', createBuildDatasetContext(exerciseDatasets.mlpRegression), {
    version: 1, planId: 'mlp-regression-check', blueprintId: 'tabular-regression-mlp-v1', task: 'regression', modelFamily: 'mlp', architecture: 'explicit-mlp',
    dataset: { featureColumns: ['feature_a', 'feature_b'], targetColumn: 'target', featureCount: 2, classCount: null },
    training: { trainRatio: 0.8, epochs: 250, batchSize: 10, shuffle: true, loss: 'mse', optimizer: 'sgd', hiddenUnits: 6 }, executionExpectation: 'browser-local', capabilityRefs: ['model.mlp'],
  }, (metrics) => metrics.r2 >= 0.98],
];

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
  if (name === 'iris') check(proposal.validation.source.pytorch.status === 'unsupported', 'KNN source export must remain explicitly unsupported.');
  const copy = createGraphProposal({ plan, dataset, datasetContext: context });
  proposal.graph.nodes[0].id = 'mutated-locally';
  check(copy.graph.nodes[0].id !== 'mutated-locally', `${name} proposal must be detached from subsequent proposals.`);
}

console.log(`Build Agent A checks passed (${runtimeFixtures.length} executable blueprints).`);
