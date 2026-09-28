import { exerciseDatasets } from '../src/core/buildAgent/exerciseFixtures.js';
import {
  createBuildDatasetContext,
  materializeBuildBlueprint,
  planBuildGoal,
} from '../src/core/buildAgent/index.js';
import { validateAgentDataset } from '../src/core/canvasAgent.js';

export function makeBuildExploreCapacityFixture({ privateRowMarker = false, task = 'classification' } = {}) {
  const exercise = exerciseDatasets[task === 'regression' ? 'mlpRegression' : 'mlpClassification'];
  const raw = {
    ...exercise,
    name: 'bridge-source-sentinel',
    rows: exercise.rows.map((row, index) => ({
      ...row,
      ...(task === 'classification' ? {
        label: index % 2 ? 'bridge-private-negative-sentinel' : 'bridge-private-positive-sentinel',
      } : {}),
      ...(privateRowMarker ? { privateFixtureMarker: 'bridge-private-row-sentinel' } : {}),
    })),
  };
  const dataset = validateAgentDataset(raw);
  const context = createBuildDatasetContext(dataset);
  const planned = planBuildGoal({
    version: 1,
    goalId: 'capacity-bridge-fixture',
    task,
    modelFamily: 'mlp',
    architecture: 'explicit-mlp',
    executionExpectation: 'browser-local',
    parameters: { hiddenUnits: 2 },
  }, context);
  if (planned.kind !== 'plan') throw new Error(`Bridge fixture did not plan: ${planned.code ?? planned.kind}`);
  const graph = materializeBuildBlueprint({
    blueprintId: planned.plan.blueprintId,
    plan: planned.plan,
    datasetContext: context,
  });
  return { ...graph, dataset, customComponents: [] };
}
