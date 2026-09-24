import { useEffect } from 'react';
import {
  componentById,
  expandComposite,
} from '../../core/components.js';
import { createAgentNode, connectAgentNodes } from '../../core/canvasAgent.js';
import { createCustomComposite, rebuildCompositeInstance } from '../../core/customComposites.js';
import {
  adaptBuildAgentGraphProposal,
  createVolkProjectGraphProposal,
} from '../../core/graph/workspaceProposal.js';
import {
  createBuildDatasetContext,
  createGraphProposal,
  planBuildGoal,
} from '../../core/buildAgent/index.js';
import { exerciseDatasets } from '../../core/buildAgent/exerciseFixtures.js';
import { PROJECT_VERSION, validateProjectForWorkspace } from '../../core/project.js';
import { useWorkspaceGraphProposalSubmission } from './WorkspaceGraphProposalContext.jsx';

const TEST_GLOBAL = '__VOLK_ML_GRAPH_APPLY_TEST__';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createLinearRegressionFixture() {
  const dataset = clone(exerciseDatasets.wine);
  const datasetContext = createBuildDatasetContext(dataset);
  const planned = planBuildGoal({
    version: 1,
    goalId: 'graph-apply-browser-fixture',
    task: 'regression',
    modelFamily: 'linear-regression',
    architecture: 'baseline',
    dataset: null,
    executionExpectation: 'browser-local',
    parameters: null,
  }, datasetContext);
  if (planned.kind !== 'plan') throw new Error(`Browser fixture could not be planned: ${planned.code ?? planned.kind}`);
  const nativeProposal = createGraphProposal({ plan: planned.plan, dataset, datasetContext });
  const adapted = adaptBuildAgentGraphProposal(nativeProposal);
  if (!adapted.ok) throw new Error(`Browser fixture could not be adapted: ${adapted.diagnostics?.[0]?.code ?? 'unknown'}`);
  return { dataset, proposal: clone(adapted.proposal) };
}

function createRebuiltCompositeFixture() {
  const dense = createAgentNode({
    nodes: [],
    manifest: componentById.get('dense_node'),
    request: { id: 'graph-apply-composite-dense', position: { x: 20, y: 30 }, parameters: { units: 6 } },
  });
  const relu = createAgentNode({
    nodes: [dense],
    manifest: componentById.get('relu_node'),
    request: { id: 'graph-apply-composite-relu', position: { x: 250, y: 30 } },
  });
  const edges = connectAgentNodes([dense, relu], [], {
    id: 'graph-apply-composite-edge',
    source: dense.id,
    sourceHandle: 'output',
    target: relu.id,
    targetHandle: 'input',
  });
  const composite = createCustomComposite({ selectedNodes: [dense, relu], edges, name: 'Dense six then ReLU', color: '#3777aa' });
  const catalogueTemplate = structuredClone(composite.manifest);
  const expanded = expandComposite(composite.instance);
  const expandedDense = expanded.nodes.find((node) => node.data.manifest.id === 'dense_node');
  expandedDense.data.parameters.units = 7;
  const rebuilt = rebuildCompositeInstance({
    origin: {
      id: composite.instance.id,
      label: composite.instance.data.label,
      manifest: composite.instance.data.manifest,
      parameters: composite.instance.data.parameters,
      position: composite.instance.position,
    },
    groupNodes: expanded.nodes,
    edges: expanded.edges,
  });
  const instance = {
    id: composite.instance.id,
    type: 'pipelineNode',
    position: rebuilt.position,
    data: { label: composite.instance.data.label, manifest: rebuilt.manifest, parameters: rebuilt.parameters, status: 'idle' },
  };
  const project = {
    format: 'VOLK-ML',
    version: PROJECT_VERSION,
    name: 'Source project must not replace current metadata',
    customComponents: [catalogueTemplate],
    graph: { nodes: [instance], edges: [] },
    data: null,
    trainedModel: null,
  };
  const result = createVolkProjectGraphProposal(project);
  if (!result.ok) throw new Error(`Composite VOLK proposal failed: ${result.diagnostics?.[0]?.code ?? 'unknown'}`);
  return {
    proposal: clone(result.proposal),
    customComponentId: catalogueTemplate.id,
    catalogueUnits: catalogueTemplate.composition.nodes.find((node) => node.componentId === 'dense_node').parameters.units,
    instanceUnits: rebuilt.manifest.composition.nodes.find((node) => node.componentId === 'dense_node').parameters.units,
  };
}

export default function GraphApplyBrowserTestBridge() {
  const submitProposal = useWorkspaceGraphProposalSubmission();

  useEffect(() => {
    const bridge = Object.freeze({
      createBuildAgentFixture: () => createLinearRegressionFixture(),
      createRebuiltCompositeFixture: () => createRebuiltCompositeFixture(),
      stageProposal: (proposal) => submitProposal(clone(proposal)),
      validateCurrentProject: async () => {
        const api = await window.__VOLK_ML_AGENT__?.open?.();
        const project = api?.getProject?.();
        if (!project) throw new Error('Canvas Agent project snapshot is unavailable.');
        validateProjectForWorkspace(project);
        return true;
      },
    });
    window[TEST_GLOBAL] = bridge;
    return () => {
      if (window[TEST_GLOBAL] === bridge) delete window[TEST_GLOBAL];
    };
  }, [submitProposal]);

  return null;
}
