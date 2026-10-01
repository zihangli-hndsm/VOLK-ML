import React, { Suspense, createContext, lazy, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MiniMap, Position, addEdge, getNodesBounds, getSmoothStepPath, useEdgesState, useNodesState } from '@xyflow/react';
import { motion } from 'framer-motion';
import '@xyflow/react/dist/style.css';
import './index.css';
import { languages, localizedError, resolveMessage, translateError } from './i18n';
import { componentById, defaults, expandComposite, pluginRegistry } from './core/components';
import { describeRows, sampleDatasets } from './core/sampleDatasets';
import { BROWSER_MLP_SEED, executeBrowserGraph, predictWithModel } from './core/browserRuntime';
import { analyzeBrowserExecutionGraph } from './core/browserExecutionContract';
import { graphSemanticFingerprintV1 } from './core/graph/identity.js';
import { artifactFingerprintJsonV1 } from './core/graph/artifactFingerprint.js';
import { acceptExecutionResultV1, createExecutionRequestV1, createExecutionResultV1 } from './core/execution/executionContract.js';
import {
  assessBrowserWebGpuMlpInference,
  browserWebGpuMlpConfigIdentity,
  BROWSER_WEBGPU_MLP_PROVIDER_VERSION,
  runBrowserWebGpuMlpInference,
} from './core/execution/browserWebGpuMlp.js';
import {
  BROWSER_WEBGPU_MLP_TRAINING_ADAPTER_ID,
  BROWSER_WEBGPU_MLP_TRAINING_PROVIDER_VERSION,
  BROWSER_WEBGPU_MLP_TRAINING_SEMANTICS_VERSION,
} from './core/execution/browserWebGpuMlpTraining.js';
import {
  H2_LOCAL_PYTHON_COMPILER_VERSION,
  h2DatasetExecutionIdentityV1,
  h2ResultToBrowserMlpV1,
  projectH2LocalPythonRequestV2,
} from './core/execution/h2LocalPython.js';
import { checkH2LocalPythonHealth, runH2LocalPythonFit } from './services/h2LocalPythonClient.js';
import { compilePipelineToPyTorch, compilePipelineToTensorFlow, graphToIR } from './core/compiler';
import { PROJECT_VERSION, projectContentSignature, validateProjectForWorkspace } from './core/project';
import { safeProjectFilename } from './core/localProjects';
import { createCustomComposite, rebuildCompositeInstance } from './core/customComposites';
import { assessConnection } from './core/connections';
import { estimateExecutionPlan, executionTiers } from './core/runtimeTiers';
import { stageForManifest, stageStyles, visualKindForManifest } from './core/visualLanguage';
import { resolvePlatformServices } from './platform/services';
import { CLOUD_AVAILABILITY } from './services/volkCloud/index.js';
import {
  CanvasAgentError,
  canvasExecutionInputSignature,
  connectAgentNodes,
  createAgentNode,
  createCanvasAgentApi,
  createCanvasAgentSnapshot,
  disconnectAgentEdge,
  invalidateAgentNodeStatuses,
  installCanvasAgentBridge,
  removeAgentNode,
  selectAgentNode,
  summarizeAgentComponent,
  updateAgentNode,
  validateAgentDataset,
} from './core/canvasAgent';
import { runCanvasAgentExerciseSuite } from './core/agentExerciseSuite';
import { AGENT_APPLICATION_API_VERSION, createAgentApplicationApi, createAgentApplicationResultBinding } from './core/agentApplicationApi.js';
import { beginLumiRun, settleLumiRun } from './core/buildAgent/lumiResultReasoning.js';
import { installAgentApplicationBridge } from './core/agentApplicationBridge.js';
import { connectMcpBrowserBridgeFromLocation } from './core/mcpBrowserBridge.js';
import { createPlaygroundAgentApi } from './core/playgroundAgent';
import { createPlaygroundHost } from './core/playgroundHost';
import { createTeachingDialogueProvider } from './core/exploration/teachingDialoguePilot.js';
import { getBigIdeaEntrance } from './core/exploration/bigIdeaRegistry.js';
import { compareExploreEnvironment, createBuildExploreBridge, createExploreEnvironmentIdentity, createExploreWorkspaceRecord, EXPLORE_WORKSPACE_LIFECYCLES } from './core/exploration/exploreWorkspace.js';
import { createExploreBridgeSessionV1, inspectExploreCapacityBuild } from './core/exploration/buildCapacityBridge.js';
import { UI_SURFACES } from './core/ui/uiArchitecture.js';
import { createBuildPanelPresentation, toggleBuildPanel } from './core/ui/buildSurfacePresentation.js';
import { createDeletionRequest, deletionSummary } from './core/deletionConfirmation.js';
import { commitWorkspaceGraphApply, prepareWorkspaceGraphApply } from './core/graph/workspaceApply.js';
import { GRAPH_PATCH_PROPOSAL_TYPE, validateGraphPatchProposal } from './core/graph/graphPatchProposal.js';
import { commitWorkspaceGraphPatchApply, prepareWorkspaceGraphPatchApply } from './core/graph/workspacePatchApply.js';
import { createOnnxGraphProposal, createTorchExportGraphProposal, validateWorkspaceGraphProposal } from './core/graph/workspaceProposal.js';
import { MAX_ONNX_DOCUMENT_CODE_UNITS } from './core/graph/onnxAdapter.js';
import { MAX_TORCH_EXPORT_DOCUMENT_CODE_UNITS } from './core/graph/torchExportAdapter.js';
import ImportedAttentionExperience from './components/ExploreImportedAttentionExperience.jsx';
import ArchitectureView from './components/ArchitectureView';
import ComponentLibrary from './components/ComponentLibrary';
import CompositeDialog from './components/CompositeDialog';
import DeletionConfirmDialog from './components/DeletionConfirmDialog.jsx';
import ExamplesDialog from './components/ExamplesDialog';
import { resolveLanguagePreference } from './core/languagePolicy.js';
import PlaygroundDialog from './components/playgrounds/PlaygroundDialog';
import VisualGlyph from './components/VisualGlyph';
import AiSettingsDialog from './components/AiSettingsDialog.jsx';
import AccountDialog from './components/AccountDialog.jsx';
import ExploreHome from './components/ExploreHome.jsx';
import ExploreCapacityBridgeDialog from './components/ExploreCapacityBridgeDialog.jsx';
import DirectorPrototype from './components/DirectorPrototype.jsx';
import BuildToolbar from './components/BuildToolbar.jsx';
import LumiBuildIntentDialog from './components/buildAgent/LumiBuildIntentDialog.jsx';
import LumiGraphEditDialog from './components/buildAgent/LumiGraphEditDialog.jsx';
import LumiResultReasoningPanel from './components/buildAgent/LumiResultReasoningPanel.jsx';
import GraphProposalPreview from './components/graph/GraphProposalPreview.jsx';
import GraphPatchPreview from './components/graph/GraphPatchPreview.jsx';
import { WorkspaceGraphProposalContext } from './components/graph/WorkspaceGraphProposalContext.jsx';
import { AiProvider, useAiProvider } from './components/ai/AiProviderContext.jsx';
import { VolkCloudProvider, useVolkCloud } from './services/volkCloud/VolkCloudContext.jsx';

const TutorialDialog = lazy(() => import('./components/TutorialDialog'));
const ExplanationDialog = lazy(() => import('./components/ExplanationDialog'));

const LANGUAGE_STORAGE_KEY = 'volk-ml-language-settings';
const platformServices = resolvePlatformServices();
const SHOW_CLOUD_STATUS = import.meta.env.DEV === true;

const LanguageContext = createContext(null);
const ConnectionContext = createContext({
  pendingConnection: null,
  onPortTap: () => {},
  onDeleteNode: () => {},
  onDeleteEdge: () => {},
  onOpenTutorial: () => {},
  canConnectToInput: () => false,
});
function LanguageProvider({ children }) {
  const storedLanguage = useMemo(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
      const available = new Set(languages.map((language) => language.code));
      const primary = available.has(saved?.primary) ? saved.primary : 'en';
      const secondary = available.has(saved?.secondary) && saved.secondary !== primary ? saved.secondary : null;
      return { primary, secondary };
    } catch { return { primary: 'en', secondary: null }; }
  }, []);
  const [primary, setPrimary] = useState(storedLanguage.primary);
  const [secondary, setSecondary] = useState(storedLanguage.secondary);
  useEffect(() => {
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, JSON.stringify({ primary, secondary })); } catch { /* Storage may be unavailable in private contexts. */ }
  }, [primary, secondary]);
  const t = useCallback((value, params = {}) => {
    const first = resolveMessage(value, primary, params);
    const second = secondary ? resolveMessage(value, secondary, params) : null;
    return second && second !== first ? `${first} · ${second}` : first;
  }, [primary, secondary]);
  const setLanguages = ({ primary: nextPrimary, secondary: nextSecondary }) => {
    setPrimary(nextPrimary);
    setSecondary(nextSecondary && nextSecondary !== nextPrimary ? nextSecondary : null);
  };
  return <LanguageContext.Provider value={{ primary, secondary, setLanguages, t }}>{children}</LanguageContext.Provider>;
}
function useVividTranslation() { return useContext(LanguageContext); }

const readablePortType = (type, t) => {
  const key = `portType.${type}`;
  const translated = t(key);
  return translated === key ? type : translated;
};

const createNode = (manifest, position) => ({
  id: `${manifest.id}-${crypto.randomUUID()}`,
  type: 'pipelineNode',
  position,
  data: { label: manifest.name, manifest, parameters: defaults(manifest) },
});

function makeDefaultGraph() {
  const specs = [
    ['pipeline-data', 'tabular_data_node', 40, 220],
    ['pipeline-split', 'train_test_split_node', 480, 220],
    ['pipeline-linear', 'linear_regression_node', 920, 220],
    ['pipeline-optimizer', 'gradient_descent_node', 1360, 220],
    ['pipeline-evaluate', 'evaluate_node', 1800, 40],
    ['pipeline-predictor', 'predictor_node', 1800, 400],
  ];
  const nodes = specs.map(([id, manifestId, x, y]) => {
    const manifest = componentById.get(manifestId);
    return { id, type: 'pipelineNode', position: { x, y }, data: { label: manifest.name, manifest, parameters: defaults(manifest), status: 'idle' } };
  });
  const edge = (id, source, sourceHandle, target, targetHandle) => ({ id, source, sourceHandle, target, targetHandle, type: 'deletable' });
  return { nodes, edges: [
    edge('data-split', 'pipeline-data', 'dataset', 'pipeline-split', 'dataset'),
    edge('split-linear', 'pipeline-split', 'split', 'pipeline-linear', 'split'),
    edge('linear-optimizer', 'pipeline-linear', 'model', 'pipeline-optimizer', 'model'),
    edge('optimizer-evaluate', 'pipeline-optimizer', 'trained_model', 'pipeline-evaluate', 'trained_model'),
    edge('optimizer-predictor', 'pipeline-optimizer', 'trained_model', 'pipeline-predictor', 'trained_model'),
  ] };
}

function downloadText(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function projectFromWorkspace(state) {
  return {
    format: 'VOLK-ML',
    version: PROJECT_VERSION,
    name: state.projectName.trim() || state.fallbackProjectName || 'Sample Project',
    savedAt: new Date().toISOString(),
    language: { primary: state.primary, secondary: state.secondary },
    workspace: {
      libraryMode: state.libraryMode,
      leftWidth: state.leftWidth,
      rightWidth: state.rightWidth,
      viewMode: state.viewMode,
    },
    graph: {
      nodes: state.nodes.map(({ selected, dragging, ...node }) => node),
      edges: state.edges.map(({ selected, ...edge }) => edge),
    },
    customComponents: state.customComponents,
    data: state.dataset,
    trainedModel: state.model,
    localModelReferences: state.localModelReferences ?? [],
  };
}

const GRAPH_PATCH_DIAGNOSTIC_CODES = new Set([
  'GRAPH_PATCH_BASE_STALE',
  'GRAPH_PATCH_APPLY_WORKSPACE_BUSY',
  'GRAPH_PATCH_APPLY_PROJECT_INVALID',
  'GRAPH_PATCH_APPLY_COMPONENT_DEFINITION_COLLISION',
  'GRAPH_PATCH_APPLY_WORKSPACE_CHANGED',
  'GRAPH_PATCH_APPLY_PREPARATION_INVALID',
  'GRAPH_PATCH_INVALID',
  'GRAPH_PATCH_OPERATION_UNSUPPORTED',
  'GRAPH_PATCH_AUTHORITY_INVALID',
  'GRAPH_PATCH_CAPABILITY_SNAPSHOT_MISMATCH',
  'GRAPH_PATCH_VERSION_UNSUPPORTED',
]);

function graphPatchDiagnosticKey(diagnostic) {
  return GRAPH_PATCH_DIAGNOSTIC_CODES.has(diagnostic?.code)
    ? `graphPatch.reason.${diagnostic.code}`
    : 'graphPatch.reason.generic';
}

function executionPlanFor(nodes, edges, dataset) {
  const connectedIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const connectedNodes = nodes.filter((node) => connectedIds.has(node.id));
  const plan = estimateExecutionPlan(connectedNodes, dataset, {
    webgpu: typeof navigator !== 'undefined' && Boolean(navigator.gpu),
    edges,
  });
  return { ...plan, canRunHere: platformServices.compute.canExecuteInBrowser(plan) };
}

function runtimeErrorInfo(error) {
  return {
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    code: error?.code,
    translationKey: error?.translationKey,
    translationParams: error?.translationParams,
  };
}

function assertAgentWritable(state, message = 'Canvas cannot change while execution is running.') {
  if (state.runtime.status === 'running') throw new CanvasAgentError('INSTANCE_BUSY', message);
}

function recordProposalLifecycle(historyRef, proposal, status) {
  if (!proposal || typeof proposal.proposalId !== 'string') return;
  historyRef.current = [...historyRef.current, {
    proposalId: proposal.proposalId,
    type: proposal.type === GRAPH_PATCH_PROPOSAL_TYPE ? 'graph-patch' : 'graph',
    status,
  }].slice(-12);
}

const idleRuntimeState = () => ({
  status: 'idle',
  activeNodeIds: [],
  losses: [],
  result: null,
  execution: null,
  error: null,
  startedAt: null,
  finishedAt: null,
});

function PipelineNode({ id, data, selected }) {
  const { t } = useVividTranslation();
  const { pendingConnection, onPortTap, onDeleteNode, onOpenTutorial, canConnectToInput } = useContext(ConnectionContext);
  const stage = stageForManifest(data.manifest);
  const stageStyle = stageStyles[stage];
  const statusStyle = data.status === 'success' ? 'ring-4 ring-emerald-300' : data.status === 'running' ? 'ring-4 ring-amber-300' : data.status === 'error' ? 'ring-4 ring-red-300' : selected ? 'ring-4 ring-blue-200' : '';
  return <div className={`relative min-w-80 max-w-[26rem] overflow-hidden rounded-2xl border-2 bg-white shadow-lg ${stageStyle.border} ${statusStyle}`} style={data.manifest.color ? { borderColor: data.manifest.color } : undefined}>
    {data.manifest.inputs.map((input, index) => <Handle key={input.name} type="target" position={Position.Left} id={input.name} style={{ top: 44 + index * 32, width: 20, height: 20, borderWidth: 3 }} />)}
    <div className="grid grid-cols-[minmax(0,1fr)_30%]">
    <div className="min-w-0 p-4">
    {data.manifest.inputs.length > 0 && <div className="mb-3 flex flex-wrap gap-1">{data.manifest.inputs.map((input) => {
      const compatible = canConnectToInput(id, input);
      return <button key={input.name} title={`${t('common.input')}: ${readablePortType(input.type, t)}`} onClick={(event) => { event.stopPropagation(); onPortTap({ direction: 'input', nodeId: id, port: input }); }} className={`nodrag nopan rounded-full border px-3 py-2 text-xs font-bold transition ${pendingConnection ? compatible ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-400' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>◀ {input.name} · {readablePortType(input.type, t)}</button>;
    })}</div>}
    <div className="flex flex-wrap items-center justify-between gap-2"><p className={`text-xs font-semibold uppercase tracking-wide ${stageStyle.text}`}>{t(`category.${data.manifest.category}`)}</p><div className="flex items-center gap-1">{data.manifest.kind === 'composite' && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">{t('component.composite')}</span>}{data.status && data.status !== 'idle' && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${data.status === 'success' ? 'bg-emerald-100 text-emerald-700' : data.status === 'running' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{t(`status.${data.status}`)}</span>}{!data.manifest.customComposite && <button aria-label={t('tutorial.learn')} title={t('tutorial.learn')} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onOpenTutorial(data.manifest); }} className="nodrag nopan grid h-10 w-10 place-items-center rounded-full bg-blue-50 text-sm font-black text-blue-700 hover:bg-blue-100">?</button>}<button aria-label={t('component.delete')} title={t('component.delete')} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onDeleteNode(id); }} className="nodrag nopan grid h-10 w-10 place-items-center rounded-full bg-red-50 text-sm font-bold text-red-600 hover:bg-red-100">⌫</button></div></div>
    <h3 className="mt-1 break-words text-base font-bold text-slate-900">{t(data.label)}</h3>
    <p className="mt-2 break-words text-sm text-slate-600">{t(data.manifest.description)}</p>
    <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">{t('framework.pytorch')} {t(`compatibility.${data.manifest.compatibility?.pytorch ?? 'unsupported'}`)} · {t('framework.tensorflow')} {t(`compatibility.${data.manifest.compatibility?.tensorflow ?? 'unsupported'}`)}</p>
    <div className="mt-3 flex flex-wrap gap-1 text-[11px] text-slate-500">{data.manifest.outputs.map((output) => {
      const active = pendingConnection?.nodeId === id && pendingConnection?.port.name === output.name;
      return <button key={output.name} title={`${t('common.output')}: ${readablePortType(output.
type, t)}`} onClick={(event) => { event.stopPropagation(); onPortTap({ direction: 'output', nodeId: id, port: output }); }} className={`nodrag nopan rounded-full border px-3 py-2 text-left text-xs font-bold transition ${active ? 'border-amber-400 bg-amber-100 text-amber-800 ring-2 ring-amber-200' : 'border-slate-200 bg-slate-100 hover:border-blue-400'}`}>{output.name} · {readablePortType(output.type, t)} ▶</button>;
    })}</div>
    </div>
    <div className={`grid min-h-44 place-items-center border-l border-slate-100 p-2 ${stageStyle.soft}`} style={data.manifest.color ? { backgroundColor: `${data.manifest.color}18` } : undefined}><VisualGlyph kind={visualKindForManifest(data.manifest)} className="h-full w-full" /></div>
    </div>
    {data.manifest.outputs.map((output, index) => <Handle key={output.name} type="source" position={Position.Right} id={output.name} style={{ top: 44 + index * 32, width: 20, height: 20, borderWidth: 3 }} />)}
  </div>;
}

function DeletableEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, selected }) {
  const { t } = useVividTranslation();
  const { onDeleteEdge } = useContext(ConnectionContext);
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return <>
    <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={{ ...style, stroke: selected ? '#ef4444' : '#64748b', strokeWidth: selected ? 3 : 2 }} interactionWidth={28} />
    <EdgeLabelRenderer>
      <button
        aria-label={t('connection.delete')}
        title={t('connection.delete')}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); onDeleteEdge(id); }}
        className={`nodrag nopan absolute grid h-10 w-10 place-items-center rounded-full border bg-white text-sm font-bold text-red-600 shadow-md transition ${selected ? 'scale-110 border-red-300 opacity-100' : 'border-slate-200 opacity-70 hover:opacity-100'}`}
        style={{ pointerEvents: 'all', transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
      >⌫</button>
    </EdgeLabelRenderer>
  </>;
}

const edgeTypes = { deletable: DeletableEdge };

function LossChart({ values }) {
  const { t } = useVividTranslation();
  if (!values.length) return <div className="grid h-40 place-items-center text-sm text-slate-400">{t('runner.lossEmpty')}</div>;
  const width = 520;
  const height = 160;
  const max = Math.max(...values, 0.0001);
  const points = values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * width},${height - (value / max) * (height - 12)}`).join(' ');
  return <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full overflow-visible rounded-xl bg-slate-950 p-2" role="img" aria-label={t('runner.lossChartLabel')}>
    <polyline fill="none" stroke="#38bdf8" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" points={points} />
  </svg>;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(value.trim()); value = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = []; value = '';
    } else value += character;
  }
  row.push(value.trim());
  if (row.some((cell) => cell !== '')) rows.push(row);
  if (rows.length < 2) throw localizedError('error.csvRows');
  const headers = rows[0].map((header, index) => header || `column_${index + 1}`);
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
}

function DataDialog({ open, onClose, dataset, onDataset }) {
  const { t } = useVividTranslation();
  const fileRef = useRef(null);
  if (!open) return null;
  const loadFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = file.name.toLowerCase().endsWith('.csv') ? parseCsv(text) : JSON.parse(text);
      const rows = Array.isArray(parsed) ? parsed : parsed.data;
      if (!Array.isArray(rows) || !rows.length) throw localizedError('error.noRows');
      const columns = describeRows(rows);
      const numeric = columns.filter((column) => column.type === 'number').map((column) => column.name);
      onDataset({ name: file.name, rows, columns, featureColumns: numeric.slice(0, -1), targetColumn: numeric.at(-1) ?? '', task: 'regression', trainRatio: 0.8 });
    } catch (error) { window.alert(t('data.importFailed', { message: translateError(error, t) })); }
  };
  const toggleFeature = (name) => onDataset({ ...dataset, featureColumns: dataset.featureColumns.includes(name) ? dataset.featureColumns.filter((column) => column !== name) : [...dataset.featureColumns, name] });
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={onClose}>
    <section className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-black">{t('data.title')}</h2><p className="mt-1 text-sm text-slate-500">{t('data.privacy')}</p></div><button aria-label={t('common.close')} className="rounded-full p-2 hover:bg-slate-100" onClick={onClose}>✕</button></div>
      <div className="mt-5 flex flex-wrap gap-2"><button onClick={() => fileRef.current?.click()} className="rounded-xl bg-blue-600 px-4 py-2 font-bold text-white">↑{t('data.upload')}</button>{sampleDatasets.map((sample) => <button key={sample.labelKey} onClick={() => onDataset(sample.dataset)} className="rounded-xl bg-slate-100 px-4 py-2 font-bold">{t(sample.labelKey)}</button>)}<input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" className="hidden" onChange={loadFile} /></div>
      {!dataset ? <div className="mt-8 grid min-h-56 place-items-center rounded-3xl border-2 border-dashed border-slate-200 text-center text-slate-400"><div><p className="text-4xl">▦</p><p className="mt-3 font-bold">{t('data.empty')}</p></div></div> : <>
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="overflow-hidden rounded-2xl border"><div className="flex items-center justify-between bg-slate-50 px-4 py-3"><div><p className="font-bold">{dataset.name}</p><p className="text-xs text-slate-500">{t('data.shape', { rows: dataset.rows.length, columns: dataset.columns.length })}</p></div></div><div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-100"><tr>{dataset.columns.map((column) => <th key={column.name} className="whitespace-nowrap px-3 py-2"><span className="font-bold">{column.name}</span><span className="ml-2 text-[10px] font-normal text-slate-400">{column.type}</span></th>)}</tr></thead><tbody>{dataset.rows.slice(0, 8).map((row, index) => <tr key={index} className="border-t">{dataset.columns.map((column) => <td key={column.name} className="max-w-40 truncate px-3 py-2">{String(row[column.name] ?? '')}</td>)}</tr>)}</tbody></table></div></div>
          <div className="space-y-4 rounded-2xl bg-slate-50 p-4"><label className="block text-sm font-black">{t('data.task')}<select value={dataset.task ?? 'regression'} onChange={(event) => { const task = event.target.value; const eligibleTargets = task === 'classification' ? dataset.columns : dataset.columns.filter((column) => column.type === 'number'); const targetColumn = eligibleTargets.some((column) => column.name === dataset.targetColumn) ? dataset.targetColumn : eligibleTargets.at(-1)?.name ?? ''; onDataset({ ...dataset, task, targetColumn, featureColumns: dataset.featureColumns.filter((column) => column !== targetColumn) }); }} className="mt-2 w-full rounded-xl border bg-white p-2"><option value="regression">{t('data.regression')}</option><option value="classification">{t('data.classification')}</option></select></label><div><p className="text-sm font-black">{t('data.inputFeatures')}</p><div className="mt-2 max-h-36 space-y-2 overflow-auto">{dataset.columns.filter((column) => column.type === 'number' && column.name !== dataset.targetColumn).map((column) => <label key={column.name} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dataset.featureColumns.includes(column.name)} onChange={() => toggleFeature(column.name)} />{column.name}</label>)}</div></div><label className="block text-sm font-black">{t('data.target')}<select value={dataset.targetColumn} onChange={(event) => onDataset({ ...dataset, targetColumn: event.target.value, featureColumns: dataset.featureColumns.filter((column) => column !== event.target.value) })} className="mt-2 w-full rounded-xl border bg-white p-2">{dataset.columns.filter((column) => dataset.task === 'classification' || column.type === 'number').map((column) => <option key={column.name}>{column.name}</option>)}</select></label><div className="rounded-xl bg-white p-3 text-xs text-slate-500"><p>{t('data.task')}: <strong className="text-slate-900">{t(`data.${dataset.task ?? 'regression'}`)}</strong></p><p className="mt-1">{t('data.splitHint')}</p><p className="mt-1">{t('data.missingHint')}</p></div></div>
        </div>
        <button disabled={!dataset.featureColumns.length || !dataset.targetColumn} onClick={onClose} className="mt-5 w-full rounded-2xl bg-emerald-600 px-4 py-3 font-bold text-white disabled:opacity-40">{t('data.use')}</button>
      </>}
    </section>
  </div>;
}

function LanguageDialog({ open, onClose }) {
  const { primary, secondary, setLanguages, t } = useVividTranslation();
  const [draftPrimary, setDraftPrimary] = useState(primary);
  const [draftSecondary, setDraftSecondary] = useState(secondary ?? 'none');
  useEffect(() => {
    if (open) {
      setDraftPrimary(primary);
      setDraftSecondary(secondary ?? 'none');
    }
  }, [open, primary, secondary]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4" onMouseDown={onClose}>
    <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between"><h2 className="text-xl font-black">{t('language.title')}</h2><button aria-label={t('common.close')} className="rounded-full p-2 hover:bg-slate-100" onClick={onClose}>✕</button></div>
      <p className="mt-2 text-sm text-slate-500">{t('language.description')}</p>
      <label className="mt-5 block text-sm font-bold">{t('language.primary')}
        <select className="mt-2 w-full rounded-xl border p-3" value={draftPrimary} onChange={(event) => { setDraftPrimary(event.target.value); if (draftSecondary === event.target.value) setDraftSecondary('none'); }}>
          {languages.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
        </select>
      </label>
      <label className="mt-4 block text-sm font-bold">{t('language.parallel')}
        <select className="mt-2 w-full rounded-xl border p-3" value={draftSecondary} onChange={(event) => setDraftSecondary(event.target.value)}>
          <option value="none">{t('language.single')}</option>
          {languages.filter((language) => language.code !== draftPrimary).map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
        </select>
      </label>
      <button className="mt-6 w-full rounded-2xl bg-blue-600 px-4 py-3 font-bold text-white" onClick={() => { setLanguages({ primary: draftPrimary, secondary: draftSecondary === 'none' ? null : draftSecondary }); onClose(); }}>{t('common.apply')}</button>
    </section>
  </div>;
}

function TierPanel({ plan, onExport }) {
  const { t } = useVividTranslation();
  const tone = plan.recommendedTier === 'L0' ? 'border-emerald-200 bg-emerald-50' : plan.recommendedTier === 'L1' ? 'border-blue-200 bg-blue-50' : plan.recommendedTier === 'L2' ? 'border-amber-200 bg-amber-50' : 'border-rose-200 bg-rose-50';
  return <div className={`mt-4 rounded-3xl border p-4 ${tone}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t('tier.recommended')}</p><h3 className="mt-1 text-lg font-black">{plan.recommendedTier} · {t(`tier.${plan.recommendedTier}.name`)}</h3><p className="mt-1 text-xs text-slate-600">{t(`tier.${plan.recommendedTier}.description`)}</p></div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-xl bg-white/80 px-3 py-2"><p className="text-slate-400">{t('tier.parameters')}</p><p className="font-black">{plan.parameters.toLocaleString()}</p></div>
        <div className="rounded-xl bg-white/80 px-3 py-2"><p className="text-slate-400">{t('tier.memory')}</p><p className="font-black">{plan.peakMemoryMB} MB</p></div>
        <div className="rounded-xl bg-white/80 px-3 py-2"><p className="text-slate-400">{t('tier.operations')}</p><p className="font-black">{plan.operationsPerStep.toLocaleString()}</p></div>
      </div>
    </div>
    <div className="mt-3 grid gap-2 sm:grid-cols-4">{executionTiers.map((tier) => <div key={tier.id} className={`rounded-2xl border p-3 ${tier.id === plan.recommendedTier ? 'border-slate-900 bg-white shadow-sm' : 'border-white/80 bg-white/50'}`}><div className="flex items-center justify-between"><span className="font-black">{tier.id}</span><span className={`h-2 w-2 rounded-full ${tier.available ? 'bg-emerald-500' : 'bg-slate-300'}`} /></div><p className="mt-1 text-xs font-bold">{t(tier.nameKey)}</p><p className="mt-1 text-[10px] text-slate-500">{tier.available ? t('tier.available') : t('tier.exportOnly')}</p></div>)}</div>
    {plan.reasons.length > 0 && <ul className="mt-3 space-y-1 text-xs text-slate-600">{plan.reasons.map((reason) => <li key={reason}>• {t(reason)}</li>)}</ul>}
    {!plan.canRunHere && <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => onExport('pytorch')} className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-bold text-white">{t('compiler.exportPyTorch')}</button><button onClick={() => onExport('tensorflow')} className="rounded-xl bg-orange-500 px-3 py-2 text-sm font-bold text-white">{t('compiler.exportTensorFlow')}</button></div>}
  </div>;
}

function PropertyControl({ property, value, onChange }) {
  const { t } = useVividTranslation();
  const inputClass = 'mt-3 w-full rounded-xl border border-slate-200 bg-white p-2 text-sm accent-blue-600';
  if (property.type === 'select') {
    return <select className={inputClass} value={value} onChange={(event) => onChange(event.target.value)}>{property.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  }
  if (property.type === 'boolean') {
    return <select className={inputClass} value={String(value)} onChange={(event) => onChange(event.target.value === 'true')}><option value="true">{t('common.enabled')}</option><option value="false">{t('common.disabled')}</option></select>;
  }
  if (property.type === 'code') {
    return <textarea className={`${inputClass} min-h-28 resize-y font-mono leading-6`} value={value} spellCheck="false" onChange={(event) => onChange(event.target.value)} />;
  }
  return <><input className={property.type === 'slider' ? 'mt-3 w-full accent-blue-600' : inputClass} type={property.type === 'slider' ? 'range' : property.type === 'number' ? 'number' : 'text'} min={property.min} max={property.max} step={property.step} value={value} onChange={(event) => onChange(property.type === 'text' ? event.target.value : Number(event.target.value))} />{property.type === 'slider' && <span className="mt-2 block text-sm text-slate-500">{value}</span>}</>;
}

function webGpuDiagnosticMessageKey(code) {
  if (code === 'WEBGPU_PARITY_MISMATCH' || code === 'WEBGPU_NON_FINITE_OUTPUT') return 'runner.webgpuParityFailure';
  if (code === 'WEBGPU_TIMEOUT') return 'runner.webgpuTimeout';
  if (code === 'WEBGPU_CANCELLED') return 'runner.webgpuCancelled';
  if (code === 'WEBGPU_GRAPH_UNSUPPORTED' || code === 'WEBGPU_MODEL_UNSUPPORTED') return 'runner.webgpuUnsupportedModel';
  if (code === 'WEBGPU_OPERATION_UNSUPPORTED') return 'runner.webgpuUnsupportedOperation';
  if (code === 'WEBGPU_INPUT_INVALID') return 'runner.webgpuInputInvalid';
  if (code === 'WEBGPU_NON_FINITE_INPUT') return 'runner.numericFeatures';
  if (code === 'WEBGPU_MODEL_INVALID') return 'runner.webgpuModelInvalid';
  if (code === 'WEBGPU_MODEL_LIMIT_EXCEEDED' || code === 'WEBGPU_INPUT_OVER_BUDGET' || code === 'WEBGPU_BUDGET_INVALID') return 'runner.webgpuLimits';
  if (code === 'RESULT_IDENTITY_STALE' || code === 'WEBGPU_RESULT_STALE') return 'runner.webgpuStale';
  if (code === 'WEBGPU_UNAVAILABLE' || code === 'WEBGPU_ADAPTER_UNAVAILABLE' || code === 'WEBGPU_DEVICE_UNAVAILABLE') return 'runner.webgpuTrainingUnavailable';
  if (code === 'WEBGPU_TRAINING_LIMIT_EXCEEDED' || code === 'WEBGPU_RESOURCE_LIMIT' || code === 'WEBGPU_INPUT_OVER_BUDGET') return 'runner.webgpuTrainingLimits';
  if (code?.startsWith('WEBGPU_TRAINING_')) return 'runner.webgpuTrainingFailed';
  if (code === 'EXECUTION_TIMEOUT' || code === 'WEBGPU_TIMEOUT') return 'runner.webgpuTimeout';
  if (code === 'EXECUTION_CANCELLED' || code === 'WEBGPU_CANCELLED') return 'runner.webgpuCancelled';
  return 'runner.webgpuDeviceFailure';
}

function RunnerDialog({ open, onClose, nodes, edges, customComponents, dataset, model, runtime, resultBinding, runHistory, language, onSelectLumiSuggestion, onRun, onRunWebGpuTraining, onCancelRun, onWebGpuInference, onCancelWebGpuInference, onValidation, onOpenData, onExport }) {
  const { t } = useVividTranslation();
  const [inputs, setInputs] = useState({});
  const [prediction, setPrediction] = useState(null);
  const [webGpuExecution, setWebGpuExecution] = useState(null);
  const [webGpuRunning, setWebGpuRunning] = useState(false);
  const [webGpuTrainingResult, setWebGpuTrainingResult] = useState(null);
  const [webGpuTrainingRunning, setWebGpuTrainingRunning] = useState(false);
  const [h2Health, setH2Health] = useState({ available: false, reason: 'H2_COMPANION_OFFLINE' });
  const [h2PairingTokenInput, setH2PairingTokenInput] = useState('');
  const [h2Connection, setH2Connection] = useState(null);
  const [h2FitResult, setH2FitResult] = useState(null);
  const [h2FitRunning, setH2FitRunning] = useState(false);
  const [graphError, setGraphError] = useState('');
  const [planNames, setPlanNames] = useState([]);
  const webGpuInputIdentityRef = useRef('');
  const graphSignature = useMemo(() => JSON.stringify({
    nodes: nodes.map((node) => ({ id: node.id, manifestId: node.data.manifest.id, parameters: node.data.parameters })),
    edges: edges.map((edge) => ({ source: edge.source, sourceHandle: edge.sourceHandle, target: edge.target, targetHandle: edge.targetHandle })),
  }), [nodes, edges]);
  // Always derive cards from current props so a Run-triggered render cannot
  // retain stale workload values.
  const executionPlan = executionPlanFor(nodes, edges, dataset);
  const h2GraphCandidate = nodes.some((node) => node.data.manifest.op === 'supervised_trainer');
  const webGpuCapability = assessBrowserWebGpuMlpInference(model);
  const webGpuGraphContract = model?.type === 'browser_mlp'
    ? analyzeBrowserExecutionGraph({ nodes, edges, dataset }) : null;
  const webGpuGraphSupported = Boolean(webGpuGraphContract?.valid
    && webGpuGraphContract.root?.data?.manifest?.op === 'supervised_trainer'
    && webGpuGraphContract.root.id === model?.sourceNodeId);
  const webGpuTrainingGraphContract = dataset
    ? analyzeBrowserExecutionGraph({ nodes, edges, dataset }) : null;
  const webGpuTrainingGraphSupported = Boolean(webGpuTrainingGraphContract?.valid
    && webGpuTrainingGraphContract.root?.data?.manifest?.op === 'supervised_trainer');
  const webGpuTrainingAvailable = typeof navigator !== 'undefined' && Boolean(navigator.gpu);
  const webGpuSupported = webGpuCapability.supported && webGpuGraphSupported;
  const webGpuModelIdentity = webGpuCapability.supported ? JSON.stringify(browserWebGpuMlpConfigIdentity(model)) : '';
  const webGpuInputIdentity = JSON.stringify({
    model: webGpuModelIdentity,
    features: model?.featureColumns?.map((column) => inputs[column] ?? '') ?? [],
  });
  webGpuInputIdentityRef.current = webGpuInputIdentity;
  const needsDataset = useMemo(() => {
    const connectedIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
    return nodes.some(
      (node) => connectedIds.has(node.id) && node.data.manifest.op === 'tabular_data',
    );
  }, [graphSignature]);
  useEffect(() => {
    if (open) {
      setPrediction(null);
      setWebGpuExecution(null);
      setWebGpuRunning(false);
      setWebGpuTrainingResult(null);
      setWebGpuTrainingRunning(false);
      setH2FitResult(null);
      setH2FitRunning(false);
      setGraphError('');
      try {
        const connectedIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
        const connectedNodes = nodes.filter((node) => connectedIds.has(node.id));
        const connectedEdges = edges.filter(
          (edge) => connectedIds.has(edge.source) && connectedIds.has(edge.target),
        );
        if (!h2GraphCandidate) {
          const contract = analyzeBrowserExecutionGraph({ nodes, edges, dataset });
          if (!contract.valid) {
            onValidation(contract.nodeIds ?? []);
            const error = localizedError(contract.reason, contract.translationParams);
            error.nodeIds = contract.nodeIds;
            throw error;
          }
        }
        const ir = graphToIR(connectedNodes, connectedEdges);
        const nodeById = new Map(connectedNodes.map((node) => [node.id, node]));
        setPlanNames(ir.nodes.filter((node) => edges.some((edge) => edge.source === node.id || edge.target === node.id)).map((node) => t(nodeById.get(node.id).data.manifest.name)));
      }
      catch (error) { setPlanNames([]); setGraphError(translateError(error, t)); }
    }
  }, [open, graphSignature, dataset, onValidation, h2GraphCandidate, t]);
  useEffect(() => {
    if (!open || !h2GraphCandidate) return undefined;
    let active = true;
    const controller = new AbortController();
    checkH2LocalPythonHealth({ signal: controller.signal, token: h2Connection?.token }).then((health) => {
      if (active) setH2Health(health);
    });
    return () => { active = false; controller.abort(); };
  }, [open, h2GraphCandidate, h2Connection]);
  useEffect(() => {
    setWebGpuExecution(null);
    if (webGpuRunning) onCancelWebGpuInference();
  }, [webGpuInputIdentity]);
  if (!open) return null;
  const running = runtime.status === 'running';
  const losses = runtime.status === 'idle' ? model?.lossHistory ?? [] : runtime.losses ?? [];
  const runtimeError = runtime.error ? translateError(runtime.error, t) : '';
  const visibleError = graphError || runtimeError;

  const tryPrediction = () => {
    if (!model?.hasPredictor) return;
    const raw = model.featureColumns.map((column) => inputs[column]);
    const isMissing = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
    if (raw.some(isMissing)) { setPrediction(t('runner.enterEveryFeature')); return; }
    const x = raw.map(Number);
    if (!x.every(Number.isFinite)) { setPrediction(t('runner.numericFeatures')); return; }
    setPrediction(predictWithModel(model, x));
  };
  const tryWebGpuPrediction = async () => {
    if (!model?.hasPredictor || !webGpuSupported) return;
    const raw = model.featureColumns.map((column) => inputs[column]);
    const isMissing = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
    if (raw.some(isMissing)) { setWebGpuExecution({ localError: 'WEBGPU_INPUT_INVALID' }); return; }
    const x = raw.map(Number);
    if (!x.every(Number.isFinite)) { setWebGpuExecution({ localError: 'WEBGPU_NON_FINITE_INPUT' }); return; }
    const requestInputIdentity = webGpuInputIdentityRef.current;
    setWebGpuRunning(true);
    setWebGpuExecution(null);
    try {
      const result = await onWebGpuInference({
        model,
        rawFeatures: x,
        isCurrent: () => webGpuInputIdentityRef.current === requestInputIdentity,
      });
      setWebGpuExecution(result);
    } catch (error) {
      setWebGpuExecution({ localError: error?.code ?? 'WEBGPU_EXECUTION_FAILED' });
    } finally {
      setWebGpuRunning(false);
    }
  };
  const tryWebGpuTraining = async () => {
    if (!webGpuTrainingGraphSupported || !webGpuTrainingAvailable || running || webGpuTrainingRunning) return;
    setWebGpuTrainingRunning(true);
    setWebGpuTrainingResult(null);
    try {
      await onRunWebGpuTraining();
      setWebGpuTrainingResult({ status: 'succeeded' });
    } catch (error) {
      setWebGpuTrainingResult({ status: 'failed', localError: error?.code ?? 'WEBGPU_TRAINING_EXECUTION_FAILED' });
    } finally {
      setWebGpuTrainingRunning(false);
    }
  };
  const tryH2LocalPythonFit = async () => {
    if (!h2GraphCandidate || !dataset || !h2Health.available || !h2Connection || running || h2FitRunning) return;
    setH2FitRunning(true);
    setH2FitResult(null);
    try {
      await onRun({ providerId: 'local-python-h2', h2Connection });
      setH2FitResult({ status: 'succeeded' });
    } catch (error) {
      setH2FitResult({ status: 'failed', localError: error?.code ?? 'H2_TRAINING_FAILED' });
    } finally {
      setH2FitRunning(false);
    }
  };
  const connectH2LocalPython = async () => {
    const token = h2PairingTokenInput.trim();
    if (!token) return;
    const health = await checkH2LocalPythonHealth({ token });
    setH2Health(health);
    if (health.available && health.connectionId) {
      setH2Connection({ token, connectionId: health.connectionId });
      setH2PairingTokenInput('');
    }
  };
  const disconnectH2LocalPython = () => {
    setH2Connection(null);
    setH2Health({ available: false, connected: false, connectionId: null, reason: 'H2_CONNECTION_REQUIRED' });
  };
  const closeRunner = () => {
    if (webGpuRunning) onCancelWebGpuInference();
    if (webGpuTrainingRunning || h2FitRunning) onCancelRun();
    onClose();
  };

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={closeRunner}>
    <section className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-black">{t('runner.title')}</h2><p className="mt-1 text-sm text-slate-500">{t('runner.description')}</p></div><button aria-label={t('common.close')} className="rounded-full p-2 hover:bg-slate-100" onClick={closeRunner}>✕</button></div>
      {planNames.length > 0 && <div className="mt-4 flex flex-wrap items-center gap-1 text-xs">{planNames.map((name, index) => <React.Fragment key={`${name}-${index}`}><span className="rounded-full bg-slate-100 px-2 py-1 font-bold">{name}</span>{index < planNames.length - 1 && <span className="text-slate-300">→</span>}</React.Fragment>)}</div>}
      <TierPanel plan={executionPlan} onExport={onExport} />
      {visibleError && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">⚠ {visibleError}</div>}
      {(needsDataset || h2GraphCandidate) && !dataset ? <div className="mt-6 rounded-3xl border-2 border-dashed p-10 text-center"><p className="text-slate-500">{t('runner.datasetRequired')}</p><button onClick={() => { onClose(); onOpenData(); }} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 font-bold text-white">{t('runner.openData')}</button></div> : executionPlan.canRunHere || webGpuTrainingGraphSupported || h2GraphCandidate ? <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div><div className="rounded-2xl bg-slate-50 p-4"><p className="font-black">{dataset?.name ?? t('runner.browserGraph')}</p><p className="mt-1 text-xs text-slate-500">{dataset ? `${dataset.featureColumns.join(', ')} → ${dataset.targetColumn}` : t('runner.noDatasetRequired')}</p></div><div id="runner-loss-chart" className="mt-4"><LossChart values={losses} /></div>{executionPlan.canRunHere && <button data-runner-execute type="button" disabled={running || webGpuRunning || webGpuTrainingRunning || h2FitRunning || (dataset && !dataset.featureColumns.length) || Boolean(graphError)} onClick={() => onRun().catch(() => {})} className="mt-4 w-full rounded-2xl bg-emerald-600 px-4 py-3 font-bold text-white disabled:opacity-50">{running ? t('runner.executing') : model ? `↻ ${t('runner.executeAgain')}` : `▶ ${t('runner.execute')}`}</button>}{webGpuTrainingGraphSupported && <><button data-webgpu-fit type="button" disabled={!webGpuTrainingAvailable || running || webGpuRunning || webGpuTrainingRunning || h2FitRunning || Boolean(graphError)} onClick={() => tryWebGpuTraining().catch(() => {})} className="mt-2 w-full rounded-2xl border border-indigo-300 bg-indigo-50 px-4 py-3 font-bold text-indigo-900 disabled:opacity-50">{webGpuTrainingRunning ? t('runner.webgpuFitting') : t('runner.webgpuFit')}</button><p className="mt-1 text-xs text-slate-500">{t(webGpuTrainingAvailable ? 'runner.webgpuFitNote' : 'runner.webgpuTrainingUnavailable')}</p></>}{h2GraphCandidate && <div data-h2-connection-panel className="mt-3 rounded-2xl border border-violet-200 bg-violet-50 p-4">{h2Connection ? <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-bold text-violet-900">{t('runner.h2Connected')}</p><button data-h2-disconnect type="button" onClick={disconnectH2LocalPython} className="rounded-xl border border-violet-300 bg-white px-3 py-2 text-sm font-bold text-violet-900">{t('runner.h2Disconnect')}</button></div> : <><label className="block text-xs font-bold text-violet-950" htmlFor="h2-pairing-code">{t('runner.h2PairingCode')}<input id="h2-pairing-code" data-h2-connection-token type="password" autoComplete="off" value={h2PairingTokenInput} onChange={(event) => setH2PairingTokenInput(event.target.value)} className="mt-1 w-full rounded-xl border border-violet-200 bg-white p-2 font-mono" /></label><p className="mt-2 text-xs text-violet-900">{t('runner.h2PairingPrompt')}</p><button data-h2-connect type="button" disabled={!h2PairingTokenInput.trim()} onClick={() => connectH2LocalPython().catch(() => {})} className="mt-3 rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{t('runner.h2Connect')}</button></>}{!h2Health.available && <p data-h2-health role="status" className="mt-2 text-xs text-slate-600">{t('runner.h2Unavailable')}</p>}<button data-h2-fit type="button" disabled={!h2Health.available || !h2Connection || running || webGpuRunning || webGpuTrainingRunning || h2FitRunning || !dataset} onClick={() => tryH2LocalPythonFit().catch(() => {})} className="mt-3 w-full rounded-2xl border border-violet-300 bg-white px-4 py-3 font-bold text-violet-900 disabled:opacity-50">{h2FitRunning ? t('runner.h2Fitting') : t('runner.h2Fit')}</button>{h2Health.available && <p data-h2-health role="status" className="mt-1 text-xs text-slate-600">{t('runner.h2FitNote')}</p>}</div>}{running && <button data-runner-cancel type="button" onClick={onCancelRun} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700">{h2FitRunning ? t('runner.h2Cancel') : webGpuTrainingRunning ? t('runner.webgpuCancel') : t('runner.cancelExecution')}</button>}{webGpuTrainingResult && <div data-webgpu-fit-result role="status" aria-live="polite" className={`mt-3 rounded-xl p-4 text-sm ${webGpuTrainingResult.status === 'succeeded' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>{webGpuTrainingResult.status === 'succeeded' ? <><p className="font-bold">{t('runner.webgpuFitPassed')}</p>{runtime.execution?.providerId === 'browser-webgpu-mlp-training' && runtime.execution.output?.trainingSummary && <p className="mt-2 text-xs">{t('runner.webgpuFitSummary', { dispatches: runtime.execution.output.trainingSummary.dispatchCount, steps: runtime.execution.output.trainingSummary.optimizerSteps, finalLoss: Number(runtime.execution.output.trainingSummary.finalTrainingLoss).toFixed(5) })}</p>}</> : <p className="font-bold">{t(webGpuDiagnosticMessageKey(webGpuTrainingResult.localError))}</p>}</div>}{h2FitResult && <div data-h2-fit-result role="status" aria-live="polite" className={`mt-3 rounded-xl p-4 text-sm ${h2FitResult.status === 'succeeded' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>{h2FitResult.status === 'succeeded' ? <><p className="font-bold">{t('runner.h2FitPassed')}</p>{runtime.execution?.providerId === 'local-python-h2' && runtime.execution.output?.trainingSummary && <p className="mt-2 text-xs">{t('runner.h2FitSummary', { epochs: runtime.execution.output.lossCount, finalLoss: Number(runtime.execution.output.trainingSummary.finalTrainingLoss).toFixed(5) })}</p>}</> : <p className="font-bold">{t('runner.h2FitFailed')}</p>}</div>}</div>
        <div className="space-y-4">{model ? <>{model.metrics ? <div><h3 className="font-black">{t('runner.evaluationOutput')}</h3><div className="mt-2 grid grid-cols-2 gap-2">{Object.entries(model.metrics).map(([key, value]) => <div key={key} className="rounded-2xl bg-slate-100 p-3"><p className="text-[10px] uppercase text-slate-500">{key}</p><p className="mt-1 font-mono font-bold">{typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(4) : value}</p></div>)}</div></div> : <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-700">{t('runner.evaluationMissing')}</div>}{model.hasPredictor ? <div className="rounded-2xl border p-4"><h3 className="font-black">{t('runner.predictorOutput')}</h3><div className="mt-3 grid grid-cols-2 gap-2">{model.featureColumns.map((column) => <label key={column} className="text-xs font-bold">{column}<input type="number" inputMode="decimal" value={inputs[column] ?? ''} onChange={(event) => setInputs({ ...inputs, [column]: event.target.value })} className="mt-1 w-full rounded-xl border p-2 font-mono" /></label>)}</div><button onClick={tryPrediction} className="mt-3 w-full rounded-xl bg-blue-600 px-3 py-2 font-bold text-white">{t('runner.predict', { target: model.targetColumn })}</button>{prediction !== null && <div className="mt-3 rounded-xl bg-blue-50 p-4 text-center"><p className="text-xs text-blue-600">{t('runner.prediction')}</p><p className="mt-1 text-2xl font-black">{typeof prediction === 'number' ? prediction.toFixed(4) : prediction}</p></div>}{model.type === 'browser_mlp' && <><button data-webgpu-inference type="button" disabled={!webGpuSupported || webGpuRunning} onClick={() => tryWebGpuPrediction().catch(() => {})} className="mt-3 w-full rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 font-bold text-indigo-900 disabled:opacity-50">{webGpuRunning ? t('runner.webgpuPredicting') : t('runner.webgpuPredict')}</button>{!webGpuSupported && <p className="mt-2 text-xs text-slate-500" role="status">{webGpuCapability.reason === 'WEBGPU_UNAVAILABLE' ? t('runner.webgpuUnavailable') : t('runner.webgpuUnsupportedModel')}</p>}{webGpuRunning && <button data-webgpu-cancel type="button" onClick={onCancelWebGpuInference} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700">{t('runner.webgpuCancel')}</button>}{webGpuExecution && <div data-webgpu-result role="status" aria-live="polite" className={`mt-3 rounded-xl p-4 text-sm ${webGpuExecution.status === 'succeeded' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>{webGpuExecution.status === 'succeeded' ? <><p className="font-bold">{t('runner.webgpuPassed')}</p><p className="mt-2 text-xs">{t('runner.webgpuPrediction')}: <span className="font-mono font-bold">{typeof webGpuExecution.output.prediction === 'number' ? webGpuExecution.output.prediction.toFixed(4) : webGpuExecution.output.prediction}</span></p><p className="mt-1 text-xs">{t('runner.webgpuMaxError')}: <span className="font-mono">{webGpuExecution.output.parity.maxAbsoluteError.toExponential(2)}</span></p></> : <p className="font-bold">{t(webGpuDiagnosticMessageKey(webGpuExecution.localError ?? webGpuExecution.diagnostics?.[0] ?? 'WEBGPU_EXECUTION_FAILED'))}</p>}</div>}</>}</div> : <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-700">{t('runner.predictorMissing')}</div>}<p className="text-xs text-slate-400">{t('runner.weightsSaved', { nodeId: model.sourceNodeId })}</p></> : <div className="grid min-h-64 place-items-center rounded-3xl bg-slate-50 p-6 text-center text-slate-400"><div><p className="text-4xl">⌁</p><p className="mt-3">{t('runner.emptyOutput')}</p></div></div>}</div>
      </div> : <div className="mt-5 rounded-3xl border border-dashed border-slate-300 p-8 text-center text-slate-500"><p className="text-3xl">⇧</p><p className="mt-3 font-bold">{t('tier.useHigherTier', { tier: executionPlan.recommendedTier })}</p><p className="mt-1 text-sm">{t('tier.designStillAvailable')}</p></div>}
      <LumiResultReasoningPanel nodes={nodes} edges={edges} customComponents={customComponents} dataset={dataset} runtime={runtime} resultBinding={resultBinding} runHistory={runHistory} language={language} onSelectSuggestion={onSelectLumiSuggestion} t={t} />
    </section>
  </div>;
}
// Panel width bounds, shared by the range sliders and the divider drag
// clamps. The right panel is right-anchored, so its slider inverts the
// presentation value (drag left = wider) while `rightWidth` always stays the
// real width.
const LEFT_PANEL_MIN = 220;
const LEFT_PANEL_MAX = 520;
const RIGHT_PANEL_MIN = 260;
const RIGHT_PANEL_MAX = 640;
const isEditableCanvasTarget = (target) => {
  const element = typeof Element !== 'undefined' && target instanceof Element ? target : null;
  return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
};
function Workspace() {
  const { primary, secondary, setLanguages, t } = useVividTranslation();
  const { openSettings, config, gateway } = useAiProvider();
  const { client: volkCloudClient, cloudStatus } = useVolkCloud();
  const aiConfigRef = useRef(config);
  aiConfigRef.current = config;
  const teachingDialoguePolicy = useMemo(() => createTeachingDialogueProvider({ gateway, getConfig: () => aiConfigRef.current }), [gateway]);
  const [developmentMatrixDriver, setDevelopmentMatrixDriver] = useState(null);
  useEffect(() => {
    if (import.meta.env.DEV !== true) return undefined;
    let active = true;
    import('./core/exploration/teachingDialogueT7Matrix.js').then(({ createTeachingDialogueT7BrowserDriver }) => {
      if (!active) return;
      const driver = createTeachingDialogueT7BrowserDriver({ provider: teachingDialoguePolicy });
      setDevelopmentMatrixDriver(driver);
      globalThis.__VOLK_ML_T7_MATRIX__ = driver;
    }).catch(() => {});
    return () => {
      active = false;
      setDevelopmentMatrixDriver(null);
      if (globalThis.__VOLK_ML_T7_MATRIX__) delete globalThis.__VOLK_ML_T7_MATRIX__;
    };
  }, [teachingDialoguePolicy]);
  const initialGraph = useMemo(() => makeDefaultGraph(), []);
  const initialBuildPresentation = useMemo(() => createBuildPanelPresentation({ viewportWidth: window.innerWidth }), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph.edges);
  const [selectedId, setSelectedId] = useState(nodes[0]?.id);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [leftOpen, setLeftOpen] = useState(initialBuildPresentation.leftOpen);
  const [rightOpen, setRightOpen] = useState(initialBuildPresentation.rightOpen);
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(initialBuildPresentation.rightWidth);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [libraryMode, setLibraryMode] = useState('detailed');
  const [viewMode, setViewMode] = useState('canvas');
  const [query, setQuery] = useState('');
  const [languageOpen, setLanguageOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [lumiBuildIntentOpen, setLumiBuildIntentOpen] = useState(false);
  const [lumiGraphEditOpen, setLumiGraphEditOpen] = useState(false);
  const [lumiGraphEditSeed, setLumiGraphEditSeed] = useState('');
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [compositeOpen, setCompositeOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [playgroundOpen, setPlaygroundOpen] = useState(false);
  const [g2AttentionOpen, setG2AttentionOpen] = useState(false);
  const [g2AnchorNodeId, setG2AnchorNodeId] = useState(null);
  const [g2AnchorProjectSessionId, setG2AnchorProjectSessionId] = useState(null);
  const [g2ProjectSession, setG2ProjectSession] = useState(0);
  const [exploreCapacityBridge, setExploreCapacityBridge] = useState(null);
  const [exploreCapacityBridgeOpen, setExploreCapacityBridgeOpen] = useState(false);
  const [directorOpen, setDirectorOpen] = useState(false);
  const [playgroundId, setPlaygroundId] = useState(null);
  const [playgroundInitialTab, setPlaygroundInitialTab] = useState('model');
  const [exploreWorkspaceKey, setExploreWorkspaceKey] = useState(null);
  const [exploreRecovery, setExploreRecovery] = useState(null);
  const [surface, setSurface] = useState(UI_SURFACES.EXPLORE);
  const graphProposalSubmissionAllowedRef = useRef(surface === UI_SURFACES.BUILD);
  graphProposalSubmissionAllowedRef.current = surface === UI_SURFACES.BUILD;
  const [globalMoreOpen, setGlobalMoreOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [tutorialManifest, setTutorialManifest] = useState(null);
  const [projectName, setProjectName] = useState(() => t('project.sampleName'));
  const [customComponents, setCustomComponents] = useState([]);
  const [restoreCandidate, setRestoreCandidate] = useState(null);
  const [localReady, setLocalReady] = useState(false);
  const [autosavedAt, setAutosavedAt] = useState(null);
  const [persistenceRevision, setPersistenceRevision] = useState(0);
  const [dataset, setDataset] = useState(null);
  const [localModelReferences, setLocalModelReferences] = useState([]);
  const [model, setModel] = useState(null);
  const [runtime, setRuntime] = useState(idleRuntimeState);
  const [runHistory, setRunHistory] = useState([]);
  const [pendingConnection, setPendingConnection] = useState(null);
  const [pendingDeletion, setPendingDeletion] = useState(null);
  const [notice, setNotice] = useState('');
  const [stagedGraphProposal, setStagedGraphProposal] = useState(null);
  const stagedGraphProposalRef = useRef(null);
  stagedGraphProposalRef.current = stagedGraphProposal;
  const [stagedExploreToBuild, setStagedExploreToBuild] = useState(null);
  const stagedExploreToBuildRef = useRef(null);
  stagedExploreToBuildRef.current = stagedExploreToBuild;
  const [graphApplyCommitDiagnostic, setGraphApplyCommitDiagnostic] = useState(null);
  const graphApplyCommitInProgressRef = useRef(false);
  const [graphApplyTestBridge, setGraphApplyTestBridge] = useState(null);
  const proposalHistoryRef = useRef([]);
  const resultBindingRef = useRef(null);
  const runHistoryRef = useRef(runHistory);
  const agentApplicationApiRef = useRef(null);
  const proposalSubmitAdapterRef = useRef(null);
  const GraphApplyTestBridgeComponent = graphApplyTestBridge;
  const buildPresentation = useMemo(() => createBuildPanelPresentation({ viewportWidth, leftOpen, rightOpen, rightWidth }), [viewportWidth, leftOpen, rightOpen, rightWidth]);
  const toggleLeftPanel = useCallback(() => {
    const next = toggleBuildPanel(buildPresentation, 'left');
    setLeftOpen(next.leftOpen);
    setRightOpen(next.rightOpen);
  }, [buildPresentation]);
  const toggleRightPanel = useCallback(() => {
    const next = toggleBuildPanel(buildPresentation, 'right');
    setLeftOpen(next.leftOpen);
    setRightOpen(next.rightOpen);
  }, [buildPresentation]);
  const wasCompactBuildRef = useRef(initialBuildPresentation.compact);
  const instanceIdRef = useRef(`workspace-${crypto.randomUUID()}`);
  const agentSubscribersRef = useRef(new Set());
  const importRef = useRef(null);
  const fileHandleRef = useRef(null);
  const lastDownloadSignature = useRef('');
  const workspaceStateRef = useRef(null);
  const exploreCapacityBridgeRef = useRef(null);
  const projectSessionIdRef = useRef(`project-session-${crypto.randomUUID()}`);
  const executionControllerRef = useRef(null);
  const webGpuInferenceControllerRef = useRef(null);
  const agentAdapterRef = useRef(null);
  const exploreWorkspacesRef = useRef(new Map());
  const exploreForkCounterRef = useRef(0);
  const activeExploreAgentRef = useRef(null);
  const agentPlaygroundHostRef = useRef(null);
  const agentPlaygroundRef = useRef(null);
  if (!agentPlaygroundHostRef.current) {
    agentPlaygroundHostRef.current = createPlaygroundHost({ getDataset: () => null, exploreRecipeId: 'agent-session' });
    const fallbackAgent = createPlaygroundAgentApi(agentPlaygroundHostRef.current);
    agentPlaygroundRef.current = new Proxy(fallbackAgent, {
      get(target, property) {
        return activeExploreAgentRef.current?.[property] ?? target[property];
      },
    });
  }
  const getExploreWorkspace = useCallback((key, recipeId = null, datasetProvider = () => null, lifecycle = EXPLORE_WORKSPACE_LIFECYCLES.PERSISTENT) => {
    const existing = exploreWorkspacesRef.current.get(key);
    if (existing) return existing;
    const host = createPlaygroundHost({ getDataset: datasetProvider, exploreRecipeId: recipeId, cloudClient: volkCloudClient, teachingDialoguePolicy });
    const agent = createPlaygroundAgentApi(host);
    const workspace = {
      key,
      host,
      agent,
      record: createExploreWorkspaceRecord({ id: key, recipeId, playgroundId: null, lifecycle }),
    };
    exploreWorkspacesRef.current.set(key, workspace);
    return workspace;
  }, [teachingDialoguePolicy, volkCloudClient]);
  const disposeEphemeralExploreWorkspaces = useCallback((exceptKey = null) => {
    let disposedActive = false;
    for (const [key, workspace] of exploreWorkspacesRef.current.entries()) {
      if (key === exceptKey || workspace.record.lifecycle !== EXPLORE_WORKSPACE_LIFECYCLES.EPHEMERAL) continue;
      exploreWorkspacesRef.current.delete(key);
      if (key === exploreWorkspaceKey) disposedActive = true;
      workspace.host.close().catch(() => {});
    }
    if (disposedActive) {
      activeExploreAgentRef.current = null;
      setExploreWorkspaceKey(null);
    }
  }, [exploreWorkspaceKey]);
  const closeExploreWorkspace = useCallback(() => {
    const key = exploreWorkspaceKey;
    const workspace = key ? exploreWorkspacesRef.current.get(key) : null;
    setPlaygroundOpen(false);
    if (!workspace || workspace.record.lifecycle !== EXPLORE_WORKSPACE_LIFECYCLES.EPHEMERAL) return;
    exploreWorkspacesRef.current.delete(key);
    activeExploreAgentRef.current = null;
    workspace.host.close().catch(() => {});
    setExploreWorkspaceKey(null);
    setExploreRecovery((current) => current?.key === key ? null : current);
  }, [exploreWorkspaceKey]);
  const activeExploreWorkspace = exploreWorkspaceKey ? exploreWorkspacesRef.current.get(exploreWorkspaceKey) : null;
  activeExploreAgentRef.current = activeExploreWorkspace?.agent ?? null;
  const flowWrapperRef = useRef(null);
  const reactFlowInstanceRef = useRef(null);
  const pendingFitRef = useRef(false);
  workspaceStateRef.current = {
    projectName,
    fallbackProjectName: t('project.sampleName'),
    primary,
    secondary,
    libraryMode,
    leftWidth,
    rightWidth,
    viewMode,
    nodes,
    edges,
    customComponents,
    dataset,
    model,
    localModelReferences,
    runtime,
    selectedId,
  };
  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
  const g2BuildGraph = useMemo(() => ({ nodes, edges, componentDefinitions: customComponents }), [nodes, edges, customComponents]);
  const selectedNodes = nodes.filter((node) => node.selected);
  const selectedCapacityNodeId = selectedNodes.length === 1 ? selectedNodes[0].id : null;
  const exploreCapacityBridgeAssessment = useMemo(() => {
    if (!selectedCapacityNodeId) return null;
    return inspectExploreCapacityBuild({ nodes, edges, dataset, customComponents }, {
      selectedNodeId: selectedCapacityNodeId,
    });
  }, [nodes, edges, dataset, customComponents, selectedCapacityNodeId]);
  const canOpenExploreCapacityBridge = exploreCapacityBridgeAssessment?.supported === true;
  const capacityBridgeRepair = exploreCapacityBridgeAssessment?.repair ?? null;
  const availablePlugins = useMemo(() => [...pluginRegistry, ...customComponents], [customComponents]);
  const filteredPlugins = useMemo(() => availablePlugins.filter((plugin) => {
    const haystack = [plugin.category, ...Object.values(plugin.name), ...Object.values(plugin.description)].join(' ').toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [availablePlugins, query]);
  const projectSignature = useMemo(() => projectContentSignature({
    name: projectName,
    graph: {
      nodes: nodes.map(({ selected, dragging, ...node }) => node),
      edges: edges.map(({ selected, ...edge }) => edge),
    },
    customComponents,
    data: dataset,
    trainedModel: model,
    localModelReferences,
  }), [projectName, nodes, edges, dataset, customComponents, model, localModelReferences]);
  const executionInputSignature = useMemo(
    () => canvasExecutionInputSignature(nodes, edges, dataset),
    [nodes, edges, dataset],
  );
  const previousExecutionSignature = useRef(executionInputSignature);
  const makeProject = useCallback(() => projectFromWorkspace(workspaceStateRef.current), []);
  const stageGraphProposal = useCallback((proposal) => {
    const previous = stagedGraphProposalRef.current;
    if (previous && previous.proposalId !== proposal.proposalId) recordProposalLifecycle(proposalHistoryRef, previous, 'superseded');
    const stagedTransfer = stagedExploreToBuildRef.current;
    if (stagedTransfer?.proposal?.graphPatchProposal?.proposalId !== proposal.proposalId) {
      stagedExploreToBuildRef.current = null;
      setStagedExploreToBuild(null);
    }
    stagedGraphProposalRef.current = proposal;
    setStagedGraphProposal(proposal);
    recordProposalLifecycle(proposalHistoryRef, proposal, 'staged');
  }, []);
  const clearGraphProposal = useCallback((status = 'cancelled') => {
    const previous = stagedGraphProposalRef.current;
    if (previous) recordProposalLifecycle(proposalHistoryRef, previous, status);
    stagedGraphProposalRef.current = null;
    setStagedGraphProposal(null);
    stagedExploreToBuildRef.current = null;
    setStagedExploreToBuild(null);
  }, []);
  const submitWorkspaceGraphProposal = useCallback((candidate) => {
    if (!graphProposalSubmissionAllowedRef.current) return { ok: false, diagnostics: [{ code: 'GRAPH_APPLY_BUILD_WORKSPACE_REQUIRED' }] };
    if (candidate?.type === GRAPH_PATCH_PROPOSAL_TYPE || candidate?.baseGraphFingerprint !== undefined) {
      const checkedPatch = validateGraphPatchProposal(candidate);
      if (!checkedPatch.valid) {
        const issue = checkedPatch.diagnostics?.[0] ?? { code: 'GRAPH_PATCH_INVALID' };
        setNotice(t(graphPatchDiagnosticKey(issue)));
        return { ok: false, diagnostics: checkedPatch.diagnostics };
      }
      setGraphApplyCommitDiagnostic(null);
      stageGraphProposal(checkedPatch.proposal);
      return { ok: true, proposalId: checkedPatch.proposal.proposalId };
    }
    const checked = validateWorkspaceGraphProposal(candidate);
    if (!checked.valid) return { ok: false, diagnostics: checked.diagnostics };
    setGraphApplyCommitDiagnostic(null);
    stageGraphProposal(checked.proposal);
    return { ok: true, proposalId: checked.proposal.proposalId };
  }, [stageGraphProposal, t]);
  proposalSubmitAdapterRef.current = submitWorkspaceGraphProposal;
  const useExploreCapacityInProject = useCallback(() => {
    const session = exploreCapacityBridgeRef.current;
    const current = workspaceStateRef.current;
    const currentBuild = {
      nodes: current.nodes,
      edges: current.edges,
      dataset: current.dataset,
      customComponents: current.customComponents,
    };
    const created = session?.createExploreToBuildProposalV1({
      currentBuild,
      currentProjectSessionId: projectSessionIdRef.current,
    });
    if (!created?.ok) {
      setNotice(t('explore.capacity.transferBlocked'));
      return;
    }
    const transfer = { proposal: created.proposal, session };
    stagedExploreToBuildRef.current = transfer;
    setStagedExploreToBuild(transfer);
    const submitted = submitWorkspaceGraphProposal(created.proposal.graphPatchProposal);
    if (!submitted.ok) {
      stagedExploreToBuildRef.current = null;
      setStagedExploreToBuild(null);
      setNotice(t('explore.capacity.transferBlocked'));
    }
  }, [submitWorkspaceGraphProposal, t]);
  const importTorchExportDocument = useCallback(async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      if (file.size > MAX_TORCH_EXPORT_DOCUMENT_CODE_UNITS * 2) throw new Error('document-size');
      const raw = await file.text();
      if (raw.length > MAX_TORCH_EXPORT_DOCUMENT_CODE_UNITS) throw new Error('document-size');
      const document = JSON.parse(raw);
      const created = createTorchExportGraphProposal(document);
      if (!created.ok) {
        setNotice(t('graphApply.torchImportFailed'));
        return;
      }
      const submitted = submitWorkspaceGraphProposal(created.proposal);
      if (!submitted.ok) setNotice(t('graphApply.torchImportFailed'));
    } catch {
      setNotice(t('graphApply.torchImportFailed'));
    }
  }, [submitWorkspaceGraphProposal, t]);
  const importOnnxDocument = useCallback(async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      if (file.size > MAX_ONNX_DOCUMENT_CODE_UNITS * 2) throw new Error('document-size');
      const raw = await file.text();
      if (raw.length > MAX_ONNX_DOCUMENT_CODE_UNITS) throw new Error('document-size');
      const document = JSON.parse(raw);
      const created = createOnnxGraphProposal(document);
      if (!created.ok) {
        setNotice(t('graphApply.onnxImportFailed'));
        return;
      }
      const submitted = submitWorkspaceGraphProposal(created.proposal);
      if (!submitted.ok) setNotice(t('graphApply.onnxImportFailed'));
    } catch {
      setNotice(t('graphApply.onnxImportFailed'));
    }
  }, [submitWorkspaceGraphProposal, t]);
  const cancelGraphProposalPreview = useCallback(() => {
    setGraphApplyCommitDiagnostic(null);
    clearGraphProposal('cancelled');
  }, [clearGraphProposal]);
  const graphApplyEligibility = useMemo(() => {
    if (!stagedGraphProposal) return null;
    const state = workspaceStateRef.current;
    const transfer = stagedExploreToBuild;
    const g3Patch = stagedGraphProposal.source?.provenance?.artifactId === 'g3-explore-to-build-v1';
    if (g3Patch) {
      const currentBuild = {
        nodes: state.nodes,
        edges: state.edges,
        dataset: state.dataset,
        customComponents: state.customComponents,
      };
      const sourceValid = Boolean(transfer
        && transfer.proposal?.graphPatchProposal?.proposalId === stagedGraphProposal.proposalId
        && transfer.session?.validateExploreToBuildProposalV1(transfer.proposal, {
          currentBuild,
          currentProjectSessionId: projectSessionIdRef.current,
        })?.valid);
      if (!sourceValid) return { ok: false, diagnostics: [{ code: 'EXPLORE_TO_BUILD_SOURCE_STALE' }] };
    }
    const prepare = stagedGraphProposal.type === GRAPH_PATCH_PROPOSAL_TYPE
      ? prepareWorkspaceGraphPatchApply
      : prepareWorkspaceGraphApply;
    return prepare(stagedGraphProposal, {
      currentProject: projectFromWorkspace(state),
      runtime: state.runtime,
    });
  }, [
    stagedGraphProposal,
    projectName,
    primary,
    secondary,
    libraryMode,
    leftWidth,
    rightWidth,
    viewMode,
    nodes,
    edges,
    customComponents,
    dataset,
    model,
    runtime,
    stagedExploreToBuild,
  ]);
  const graphApplyEligibilityForPreview = graphApplyCommitDiagnostic && graphApplyEligibility
    ? { ...graphApplyEligibility, ok: false, diagnostics: [graphApplyCommitDiagnostic] }
    : graphApplyEligibility;
  const applyStagedGraphProposal = useCallback(() => {
    if (!stagedGraphProposal || graphApplyCommitInProgressRef.current) return;
    graphApplyCommitInProgressRef.current = true;
    try {
      const isPatch = stagedGraphProposal.type === GRAPH_PATCH_PROPOSAL_TYPE;
      const prepare = isPatch ? prepareWorkspaceGraphPatchApply : prepareWorkspaceGraphApply;
      const commit = isPatch ? commitWorkspaceGraphPatchApply : commitWorkspaceGraphApply;
      const latestState = workspaceStateRef.current;
      let prepared = prepare(stagedGraphProposal, {
        currentProject: projectFromWorkspace(latestState),
        runtime: latestState.runtime,
      });
      const stagedTransfer = stagedExploreToBuildRef.current;
      const g3Patch = stagedGraphProposal.source?.provenance?.artifactId === 'g3-explore-to-build-v1';
      if (prepared.ok && g3Patch) {
        const sourceValid = Boolean(stagedTransfer
          && stagedTransfer.proposal?.graphPatchProposal?.proposalId === stagedGraphProposal.proposalId
          && stagedTransfer.session?.validateExploreToBuildProposalV1(stagedTransfer.proposal, {
            currentBuild: {
              nodes: latestState.nodes,
              edges: latestState.edges,
              dataset: latestState.dataset,
              customComponents: latestState.customComponents,
            },
            currentProjectSessionId: projectSessionIdRef.current,
          })?.valid);
        if (!sourceValid) prepared = { ok: false, diagnostics: [{ code: 'EXPLORE_TO_BUILD_SOURCE_STALE' }] };
      }
      const committed = prepared.ok
        ? commit(prepared, {
          currentProject: projectFromWorkspace(workspaceStateRef.current),
          runtime: workspaceStateRef.current.runtime,
        })
        : prepared;
      if (!committed.ok) {
        const issue = committed.diagnostics?.[0] ?? { code: isPatch ? 'GRAPH_PATCH_APPLY_PROJECT_INVALID' : 'GRAPH_APPLY_PROJECT_INVALID' };
        setGraphApplyCommitDiagnostic(issue);
        return;
      }

      const nextProject = committed.project;
      const nextNodes = nextProject.graph.nodes.map((node) => ({
        ...node,
        selected: false,
        type: 'pipelineNode',
        data: {
          ...node.data,
          label: node.data.label ?? node.data.manifest.name,
          status: node.data.status ?? 'idle',
        },
      }));
      const nextEdges = nextProject.graph.edges.map((edge) => ({ ...edge, selected: false, type: 'deletable' }));
      const nextState = {
        ...workspaceStateRef.current,
        projectName: nextProject.name,
        nodes: nextNodes,
        edges: nextEdges,
        customComponents: nextProject.customComponents,
        dataset: nextProject.data ?? null,
        model: nextProject.trainedModel ?? null,
        runtime: committed.runtime,
        selectedId: committed.selectedNodeId ?? null,
      };
      workspaceStateRef.current = nextState;
      previousExecutionSignature.current = canvasExecutionInputSignature(nextNodes, nextEdges, nextState.dataset);
      setProjectName(nextState.projectName);
      setNodes(nextNodes);
      setEdges(nextEdges);
      setCustomComponents(nextState.customComponents);
      setDataset(nextState.dataset);
      setModel(nextState.model);
      setRuntime(committed.runtime);
      setSelectedId(nextState.selectedId);
      setPendingConnection(null);
      setPendingDeletion(null);
      setGraphApplyCommitDiagnostic(null);
      if (!isPatch || committed.semanticChanged) resultBindingRef.current = null;
      clearGraphProposal('applied');
      setNotice(isPatch
        ? t(committed.semanticChanged ? 'graphPatch.appliedSemantic' : 'graphPatch.appliedLayout')
        : t('graphApply.applied'));
    } finally {
      graphApplyCommitInProgressRef.current = false;
    }
  }, [clearGraphProposal, setEdges, setNodes, stagedGraphProposal, t]);
  const applyProject = useCallback((rawProject, { languagePolicy = 'project' } = {}) => {
    clearGraphProposal('superseded');
    resultBindingRef.current = null;
    setGraphApplyCommitDiagnostic(null);
    const language = resolveLanguagePreference({
      projectPrimary: rawProject?.language?.primary,
      projectSecondary: rawProject?.language?.secondary,
      currentPrimary: workspaceStateRef.current.primary,
      currentSecondary: workspaceStateRef.current.secondary,
      policy: languagePolicy,
    });
    const migratedProject = validateProjectForWorkspace(rawProject);
    const project = {
      ...migratedProject,
      data: migratedProject.data === null || migratedProject.data === undefined
        ? null
        : validateAgentDataset(migratedProject.data),
    };
    const customById = new Map((project.customComponents ?? []).map((manifest) => [manifest.id, manifest]));
    const restoredNodes = project.graph.nodes.map((node) => {
      const manifestId = node.data?.manifest?.id;
      const currentManifest = node.data?.manifest?.customComposite === true
        ? node.data.manifest
        : componentById.get(manifestId)
          ?? customById.get(manifestId)
          ?? node.data?.manifest;
      if (!currentManifest) throw localizedError('error.unknownComponent', { component: manifestId });
      return {
        ...node,
        selected: false,
        type: 'pipelineNode',
        data: {
          ...node.data,
          label: currentManifest.name,
          manifest: currentManifest,
          parameters: { ...defaults(currentManifest), ...node.data?.parameters },
        },
      };
    });
    const restoredEdges = project.graph.edges.map((edge) => ({ ...edge, selected: false, type: 'deletable' }));
    exploreCapacityBridgeRef.current?.dispose();
    exploreCapacityBridgeRef.current = null;
    setExploreCapacityBridge(null);
    setExploreCapacityBridgeOpen(false);
    projectSessionIdRef.current = `project-session-${crypto.randomUUID()}`;
    setG2ProjectSession((session) => session + 1);
    const nextRuntime = idleRuntimeState();
    workspaceStateRef.current = {
      ...workspaceStateRef.current,
      projectName: project.name || t('project.sampleName'),
      primary: language.primary,
      secondary: language.secondary,
      libraryMode: project.workspace?.libraryMode ?? workspaceStateRef.current.libraryMode,
      leftWidth: Number.isFinite(project.workspace?.leftWidth) ? project.workspace.leftWidth : workspaceStateRef.current.leftWidth,
      rightWidth: Number.isFinite(project.workspace?.rightWidth) ? project.workspace.rightWidth : workspaceStateRef.current.rightWidth,
      viewMode: project.workspace?.viewMode ?? workspaceStateRef.current.viewMode,
      nodes: restoredNodes,
      edges: restoredEdges,
      customComponents: project.customComponents ?? [],
      dataset: project.data ?? null,
      model: project.trainedModel ?? null,
      localModelReferences: project.localModelReferences ?? [],
      runtime: nextRuntime,
      selectedId: restoredNodes[0]?.id ?? null,
    };
    previousExecutionSignature.current = canvasExecutionInputSignature(restoredNodes, restoredEdges, project.data);
    setProjectName(workspaceStateRef.current.projectName);
    setCustomComponents(workspaceStateRef.current.customComponents);
    setNodes(restoredNodes);
    setEdges(restoredEdges);
    setSelectedId(restoredNodes[0]?.id);
    if (language.apply && project.language?.primary) setLanguages(project.language);
    if (project.workspace?.libraryMode) setLibraryMode(project.workspace.libraryMode);
    if (project.workspace?.viewMode) setViewMode(project.workspace.viewMode);
    if (Number.isFinite(project.workspace?.leftWidth)) setLeftWidth(project.workspace.leftWidth);
    if (Number.isFinite(project.workspace?.rightWidth)) setRightWidth(project.workspace.rightWidth);
    setDataset(project.data ?? null);
    setLocalModelReferences(project.localModelReferences ?? []);
    setModel(project.trainedModel ?? null);
    setRuntime(nextRuntime);
    pendingFitRef.current = true;
    return project;
  }, [clearGraphProposal, setNodes, setEdges, setLanguages, t]);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (buildPresentation.compact && !wasCompactBuildRef.current) {
      setLeftOpen(false);
      setRightOpen(false);
    }
    wasCompactBuildRef.current = buildPresentation.compact;
  }, [buildPresentation.compact]);

  useEffect(() => {
    let active = true;
    platformServices.projects.load().then((project) => {
      if (!active) return;
      if (project?.graph) setRestoreCandidate(project);
      else setLocalReady(true);
    }).catch(() => {
      if (active) setLocalReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV !== true || new URLSearchParams(window.location.search).get('graphApplyTest') !== '1') return undefined;
    let active = true;
    import('./components/graph/GraphApplyBrowserTestBridge.jsx').then(({ default: Bridge }) => {
      if (active) setGraphApplyTestBridge(() => Bridge);
    }).catch(() => {});
    return () => {
      active = false;
      setGraphApplyTestBridge(null);
    };
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV !== true || new URLSearchParams(window.location.search).get('h1TrainingTest') !== '1') return undefined;
    // This isolated browser-acceptance hook is absent from production and can only invalidate an active run identity.
    const bridge = Object.freeze({
      invalidateProjectIdentityDuringRun: () => {
        if (workspaceStateRef.current.runtime.status !== 'running' || !executionControllerRef.current) {
          throw new Error('Project identity can only be invalidated during an active execution.');
        }
        projectSessionIdRef.current = `project-session-${crypto.randomUUID()}`;
        return true;
      },
    });
    window.__VOLK_ML_H1_TRAINING_TEST__ = bridge;
    return () => {
      if (window.__VOLK_ML_H1_TRAINING_TEST__ === bridge) delete window.__VOLK_ML_H1_TRAINING_TEST__;
    };
  }, []);

  useEffect(() => {
    if (!localReady) return undefined;
    const timeout = window.setTimeout(() => {
      platformServices.projects.save(makeProject()).then(() => {
        setAutosavedAt(new Date());
      }).catch((error) => {
        setNotice(t('project.localSaveFailed', { message: error.message }));
      });
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [localReady, projectSignature, makeProject, t]);

  useEffect(() => {
    if (graphApplyCommitDiagnostic) setGraphApplyCommitDiagnostic(null);
  }, [
    projectName,
    primary,
    secondary,
    libraryMode,
    leftWidth,
    rightWidth,
    viewMode,
    nodes,
    edges,
    customComponents,
    dataset,
    model,
    runtime,
  ]);

  useEffect(() => {
    if (!lastDownloadSignature.current) lastDownloadSignature.current = projectSignature;
  }, []);

  useEffect(() => {
    const beforeUnload = (event) => {
      if (projectSignature === lastDownloadSignature.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [projectSignature]);
  const connectionNotice = useCallback((assessment) => {
    if (assessment.reason === 'type') return t('connection.incompatibleTypes', {
      source: readablePortType(assessment.sourceType, t),
      target: readablePortType(assessment.targetType, t),
    });
    if (assessment.reason === 'occupied') return t('connection.inputOccupied');
    if (assessment.reason === 'cycle') return t('connection.cycle');
    if (assessment.reason === 'self') return t('connection.self');
    return t('connection.incompatible');
  }, [t]);
  const assess = useCallback((connection) => assessConnection(connection, nodes, edges), [nodes, edges]);
  const isValidConnection = useCallback((connection) => assess(connection).valid, [assess]);
  const onConnect = useCallback((connection) => {
    const assessment = assess(connection);
    if (!assessment.valid) { setNotice(connectionNotice(assessment)); return; }
    setEdges((current) => addEdge({ ...connection, type: 'deletable' }, current));
    setPendingConnection(null);
    setModel(null);
  }, [assess, connectionNotice, setEdges]);
  const onPortTap = useCallback(({ direction, nodeId, port }) => {
    if (direction === 'output') {
      setPendingConnection((current) => current?.nodeId === nodeId && current?.port.name === port.name ? null : { nodeId, port, type: port.type });
      return;
    }
    if (!pendingConnection) { setNotice(t('connection.tapOutputFirst')); return; }
    const connection = { source: pendingConnection.nodeId, sourceHandle: pendingConnection.port.name, target: nodeId, targetHandle: port.name };
    const assessment = assess(connection);
    if (!assessment.valid) { setNotice(connectionNotice(assessment)); return; }
    setEdges((current) => addEdge({ ...connection, id: `tap-${crypto.randomUUID()}`, type: 'deletable' }, current));
    setPendingConnection(null);
    setModel(null);
    setNotice(t('connection.connected'));
  }, [pendingConnection, assess, connectionNotice, setEdges, t]);
  const canConnectToInput = useCallback((nodeId, port) => {
    if (!pendingConnection) return false;
    return assess({
      source: pendingConnection.nodeId,
      sourceHandle: pendingConnection.port.name,
      target: nodeId,
      targetHandle: port.name,
    }).valid;
  }, [pendingConnection, assess]);
  const handleEdgesChange = useCallback((changes) => {
    const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    if (removed.length) setPendingDeletion(createDeletionRequest({ nodes, edges, edgeIds: removed }));
    const safeChanges = changes.filter((change) => change.type !== 'remove');
    if (safeChanges.some((change) => change.type === 'add')) setModel(null);
    if (safeChanges.length) onEdgesChange(safeChanges);
  }, [edges, nodes, onEdgesChange]);
  const handleNodesChange = useCallback((changes) => {
    const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    if (removed.length) setPendingDeletion(createDeletionRequest({ nodes, edges, nodeIds: removed }));
    const safeChanges = changes.filter((change) => change.type !== 'remove');
    if (safeChanges.some((change) => change.type === 'add')) setModel(null);
    if (safeChanges.length) onNodesChange(safeChanges);
  }, [edges, nodes, onNodesChange]);
  const requestDeletion = useCallback(({ nodeIds = [], edgeIds = [] } = {}) => {
    const request = createDeletionRequest({ nodes, edges, nodeIds, edgeIds });
    if (request.nodeIds.length || request.edgeIds.length) setPendingDeletion(request);
  }, [edges, nodes]);
  const deleteNode = useCallback((nodeId) => requestDeletion({ nodeIds: [nodeId] }), [requestDeletion]);
  const deleteEdge = useCallback((edgeId) => requestDeletion({ edgeIds: [edgeId] }), [requestDeletion]);
  const confirmDeletion = useCallback(() => {
    if (!pendingDeletion) return;
    const nodeIds = new Set(pendingDeletion.nodeIds);
    const edgeIds = new Set(pendingDeletion.edgeIds);
    setNodes((current) => current.filter((node) => !nodeIds.has(node.id)));
    setEdges((current) => current.filter((edge) => !edgeIds.has(edge.id)));
    setSelectedId((current) => nodeIds.has(current) ? null : current);
    setPendingConnection((current) => current && nodeIds.has(current.nodeId) ? null : current);
    setModel(null);
    setPendingDeletion(null);
    setNotice(t('component.deleted'));
  }, [pendingDeletion, setEdges, setNodes, t]);
  const handleCanvasKeyDown = useCallback((event) => {
    if (!['Delete', 'Backspace'].includes(event.key) || isEditableCanvasTarget(event.target)) return;
    const nodeIds = nodes.filter((node) => node.selected).map((node) => node.id);
    const edgeIds = edges.filter((edge) => edge.selected).map((edge) => edge.id);
    if (!nodeIds.length && !edgeIds.length) return;
    event.preventDefault();
    requestDeletion({ nodeIds, edgeIds });
  }, [edges, nodes, requestDeletion]);
  const handleCanvasNodeClick = useCallback((event, node) => {
    const multi = multiSelectMode || event.shiftKey || event.metaKey || event.ctrlKey;
    const selectedIds = new Set(nodes.filter((item) => item.selected).map((item) => item.id));
    if (multi) {
      if (selectedIds.has(node.id)) selectedIds.delete(node.id);
      else selectedIds.add(node.id);
    } else {
      selectedIds.clear();
      selectedIds.add(node.id);
    }
    const changes = nodes.map((item) => ({ type: 'select', id: item.id, selected: selectedIds.has(item.id) }));
    if (changes.length) onNodesChange(changes);
    const nextSelectedId = selectedIds.has(node.id)
      ? node.id
      : nodes.some((item) => item.id === selectedId && selectedIds.has(item.id))
        ? selectedId
        : nodes.find((item) => selectedIds.has(item.id))?.id ?? null;
    setSelectedId(nextSelectedId);
  }, [multiSelectMode, nodes, onNodesChange, selectedId]);
  const handleCanvasPaneClick = useCallback(() => {
    const changes = nodes.filter((item) => item.selected).map((item) => ({ type: 'select', id: item.id, selected: false }));
    if (changes.length) onNodesChange(changes);
    setSelectedId(null);
  }, [nodes, onNodesChange]);
  const fitCanvasToContainer = useCallback(() => {
    const container = flowWrapperRef.current;
    const instance = reactFlowInstanceRef.current;
    if (!container || !instance?.setViewport) return false;
    const rect = container.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return false;
    const bounds = getNodesBounds(nodes);
    if (!bounds.width || !bounds.height) return false;
    const padding = 0.18;
    const zoom = Math.min(
      rect.width / (bounds.width * (1 + padding * 2)),
      rect.height / (bounds.height * (1 + padding * 2)),
      2,
    );
    instance.setViewport({
      x: rect.width / 2 - (bounds.x + bounds.width / 2) * zoom,
      y: rect.height / 2 - (bounds.y + bounds.height / 2) * zoom,
      zoom,
    });
    return true;
  }, [nodes]);
  const fitCanvasRef = useRef(fitCanvasToContainer);
  fitCanvasRef.current = fitCanvasToContainer;
  const settleTimersRef = useRef(new Set());
  const fitCanvasWithResettle = () => {
    let previous = null;
    let stable = 0;
    let attempts = 0;
    const attempt = () => {
      attempts += 1;
      const fitted = fitCanvasRef.current();
      if (!fitted || attempts >= 16) return;
      const viewport = reactFlowInstanceRef.current?.getViewport?.();
      const key = viewport ? `${viewport.x.toFixed(2)},${viewport.y.toFixed(2)},${viewport.zoom.toFixed(4)}` : null;
      if (key && key === previous) {
        stable += 1;
        if (stable >= 2) return;
      } else {
        stable = 0;
      }
      previous = key;
      settleTimersRef.current.add(setTimeout(attempt, 250));
    };
    settleTimersRef.current.forEach((id) => clearTimeout(id));
    settleTimersRef.current.clear();
    attempt();
  };
  useEffect(() => {
    const container = flowWrapperRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const scheduleFit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fitCanvasWithResettle);
    };
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!pendingFitRef.current) return undefined;
    pendingFitRef.current = false;
    let attempt = 0;
    settleTimersRef.current.forEach((id) => clearTimeout(id));
    settleTimersRef.current.clear();
    const tryFit = () => {
      if (attempt >= 4) return;
      attempt += 1;
      fitCanvasWithResettle();
    };
    const frame = requestAnimationFrame(tryFit);
    return () => cancelAnimationFrame(frame);
  }, [nodes]);
  const updateRuntime = useCallback((update) => {
    const current = workspaceStateRef.current.runtime;
    const next = typeof update === 'function' ? update(current) : update;
    workspaceStateRef.current = { ...workspaceStateRef.current, runtime: next };
    setRuntime(next);
    return next;
  }, []);
  const updateRunHistory = useCallback((update) => {
    const next = typeof update === 'function' ? update(runHistoryRef.current) : update;
    runHistoryRef.current = next;
    setRunHistory(next);
    return next;
  }, []);
  const setNodeStatus = useCallback((ids, status) => {
    const nextNodes = workspaceStateRef.current.nodes.map((node) => ids.includes(node.id)
      ? { ...node, data: { ...node.data, status } }
      : node);
    workspaceStateRef.current = { ...workspaceStateRef.current, nodes: nextNodes };
    setNodes(nextNodes);
  }, [setNodes]);
  const handleRunnerValidation = useCallback((nodeIds) => {
    const state = workspaceStateRef.current;
    const knownIds = new Set(state.nodes.map((node) => node.id));
    const ids = [...new Set(nodeIds.filter((id) => knownIds.has(id)))];
    const nextNodes = state.nodes.map((node) => ids.includes(node.id)
      ? { ...node, data: { ...node.data, status: 'error' } }
      : { ...node, data: { ...node.data, status: 'idle' } });
    workspaceStateRef.current = { ...state, nodes: nextNodes };
    setNodes(nextNodes);
    if (ids[0]) setSelectedId(ids[0]);
  }, [setNodes]);
  const runBrowserGraph = useCallback(async ({ providerId = 'browser-cpu', h2Connection = null } = {}) => {
    if (!['browser-cpu', 'browser-webgpu-mlp-training', 'local-python-h2'].includes(providerId)) {
      throw new CanvasAgentError('EXECUTION_PROVIDER_UNSUPPORTED', 'The requested browser provider is unsupported.');
    }
    const isWebGpuTraining = providerId === 'browser-webgpu-mlp-training';
    const isH2LocalPython = providerId === 'local-python-h2';
    const providerVersion = isH2LocalPython ? H2_LOCAL_PYTHON_COMPILER_VERSION
      : isWebGpuTraining ? BROWSER_WEBGPU_MLP_TRAINING_PROVIDER_VERSION : 'browser-runtime-v1';
    const state = workspaceStateRef.current;
    if (state.runtime.status === 'running') {
      throw new CanvasAgentError('INSTANCE_BUSY', 'Canvas execution is already running.');
    }
    resultBindingRef.current = null;
    const startedAt = new Date().toISOString();
    const startedWithSignature = canvasExecutionInputSignature(state.nodes, state.edges, state.dataset);
    const runAttemptId = `run-${crypto.randomUUID()}`;
    const executionRunId = `execution-${crypto.randomUUID()}`;
    let runBinding = null;
    let executionRequest = null;
    let executionEnvelope = null;
    let executionTimeout = null;
    let h2RequestDraft = null;
    try {
      runBinding = createAgentApplicationResultBinding({ nodes: state.nodes, edges: state.edges, customComponents: state.customComponents, dataset: state.dataset });
    } catch { /* Invalid inputs still produce a safe failed session-history entry. */ }
    updateRunHistory((history) => beginLumiRun(history, { attemptId: runAttemptId, binding: runBinding, startedAt }));
    let currentNode = null;
    let validationNodeIds = [];
    setNodeStatus(state.nodes.map((node) => node.id), 'idle');
    updateRuntime({
      status: 'running',
      activeNodeIds: [],
      losses: [],
      result: null,
      execution: null,
      error: null,
      startedAt,
      finishedAt: null,
    });
    try {
      const contract = isH2LocalPython ? null
        : analyzeBrowserExecutionGraph({ nodes: state.nodes, edges: state.edges, dataset: state.dataset });
      if (contract && !contract.valid) {
        validationNodeIds = contract.nodeIds ?? [];
        const error = localizedError(contract.reason, contract.translationParams);
        error.nodeIds = validationNodeIds;
        throw error;
      }
      const plan = executionPlanFor(state.nodes, state.edges, state.dataset);
      if (isWebGpuTraining) {
        const webGpuAvailable = typeof navigator !== 'undefined' && Boolean(navigator.gpu);
        if (!webGpuAvailable) throw Object.assign(new Error('WEBGPU_UNAVAILABLE'), { code: 'WEBGPU_UNAVAILABLE' });
        if (contract.root?.data?.manifest?.op !== 'supervised_trainer') {
          throw Object.assign(new Error('WEBGPU_TRAINING_GRAPH_UNSUPPORTED'), { code: 'WEBGPU_TRAINING_GRAPH_UNSUPPORTED' });
        }
      } else if (!isH2LocalPython && !plan.canRunHere) {
        throw localizedError('error.higherTierRequired', { tier: plan.recommendedTier });
      }
      if (isH2LocalPython) {
        h2RequestDraft = await projectH2LocalPythonRequestV2({
          sessionId: projectSessionIdRef.current,
          nodes: state.nodes,
          edges: state.edges,
          dataset: state.dataset,
        });
      }
      const graphFingerprint = graphSemanticFingerprintV1({
        nodes: state.nodes,
        edges: state.edges,
        componentDefinitions: state.customComponents,
      });
      const inputIdentity = isH2LocalPython
        ? `sha256:${h2RequestDraft.identity.datasetFingerprint}`
        : artifactFingerprintJsonV1({
        task: state.dataset.task,
        featureColumns: state.dataset.featureColumns,
        targetColumn: state.dataset.targetColumn,
        rows: state.dataset.rows,
      });
      const configIdentity = artifactFingerprintJsonV1(isH2LocalPython ? {
        adapter: 'volk-h2-local-python',
        version: H2_LOCAL_PYTHON_COMPILER_VERSION,
        profile: h2RequestDraft.profile,
        normalizedRequestFingerprint: h2RequestDraft.identity.normalizedRequestFingerprint,
      } : isWebGpuTraining ? {
        adapter: BROWSER_WEBGPU_MLP_TRAINING_ADAPTER_ID,
        version: providerVersion,
        semantics: BROWSER_WEBGPU_MLP_TRAINING_SEMANTICS_VERSION,
        seed: BROWSER_MLP_SEED,
      } : {
        adapter: 'volk-browser-runtime',
        version: 'browser-runtime-v1',
        deterministicSeeds: 'registered-browser-adapter-defaults-v1',
      });
      const requestBytes = new TextEncoder().encode(isH2LocalPython ? JSON.stringify(h2RequestDraft) : startedWithSignature).byteLength;
      executionRequest = createExecutionRequestV1({
        requestId: executionRunId,
        projectSessionId: projectSessionIdRef.current,
        graphIdentity: { kind: 'graph', fingerprint: graphFingerprint },
        inputIdentity,
        configIdentity,
        providerId,
        mode: 'fit',
        budget: {
          maxDurationMs: 120_000,
          maxInputBytes: 20 * 1024 * 1024,
          maxOutputBytes: isWebGpuTraining || isH2LocalPython ? 256 * 1024 : 32 * 1024,
        },
        approvedAt: startedAt,
      });
      if (requestBytes > executionRequest.budget.maxInputBytes) {
        throw Object.assign(new Error('EXECUTION_INPUT_OVER_BUDGET'), { code: 'EXECUTION_INPUT_OVER_BUDGET' });
      }
      const controller = new AbortController();
      executionControllerRef.current = controller;
      executionTimeout = window.setTimeout(() => controller.abort('deadline'), executionRequest.budget.maxDurationMs);
      const finalModel = isH2LocalPython
        ? h2ResultToBrowserMlpV1({
          ...await runH2LocalPythonFit(h2RequestDraft, { signal: controller.signal, connection: h2Connection }),
          dataset: state.dataset,
        })
        : await executeBrowserGraph({
          nodes: state.nodes,
          edges: state.edges,
          dataset: state.dataset,
          onNodeStatus: (ids, status) => {
            currentNode = status === 'running'
              ? state.nodes.find((node) => ids.includes(node.id)) ?? currentNode
              : currentNode;
            setNodeStatus(ids, status);
            updateRuntime((current) => ({
              ...current,
              activeNodeIds: status === 'running'
                ? [...new Set([...current.activeNodeIds, ...ids])]
                : current.activeNodeIds.filter((id) => !ids.includes(id)),
            }));
          },
          onLoss: (losses) => updateRuntime((current) => ({ ...current, losses })),
          onYield: () => new Promise((resolve) => requestAnimationFrame(resolve)),
          signal: controller.signal,
          trainingProvider: isWebGpuTraining ? 'browser-webgpu' : 'browser-cpu',
        });
      const currentState = workspaceStateRef.current;
      const currentGraphFingerprint = graphSemanticFingerprintV1({
        nodes: currentState.nodes,
        edges: currentState.edges,
        componentDefinitions: currentState.customComponents,
      });
      const currentInputIdentity = currentState.dataset
        ? isH2LocalPython
          ? await h2DatasetExecutionIdentityV1(currentState.dataset)
          : artifactFingerprintJsonV1({
            task: currentState.dataset.task,
            featureColumns: currentState.dataset.featureColumns,
            targetColumn: currentState.dataset.targetColumn,
            rows: currentState.dataset.rows,
          })
        : null;
      const currentRequestContext = {
        projectSessionId: projectSessionIdRef.current,
        graphIdentity: currentGraphFingerprint,
        inputIdentity: currentInputIdentity,
        configIdentity,
      };
      if (canvasExecutionInputSignature(currentState.nodes, currentState.edges, currentState.dataset) !== startedWithSignature) {
        executionEnvelope = createExecutionResultV1({
          request: executionRequest,
          runId: runAttemptId,
          status: 'stale',
          providerVersion: 'browser-runtime-v1',
          startedAt,
          finishedAt: new Date().toISOString(),
          diagnostics: ['WORKSPACE_CHANGED'],
        });
        updateRuntime((current) => ({ ...current, execution: executionEnvelope }));
        const changedError = new CanvasAgentError('WORKSPACE_CHANGED', 'Workspace changed while the pipeline was running.');
        changedError.translationKey = 'error.workspaceChangedDuringRun';
        throw changedError;
      }
      const { test, trainingSummary, ...modelWithoutTest } = finalModel;
      const persistableModel = isH2LocalPython
        ? { ...modelWithoutTest, trainingSummary }
        : modelWithoutTest;
      executionEnvelope = createExecutionResultV1({
        request: executionRequest,
        runId: runAttemptId,
        status: 'succeeded',
        providerVersion,
        startedAt,
        finishedAt: new Date().toISOString(),
        output: {
          modelType: persistableModel.type,
          sourceNodeId: persistableModel.sourceNodeId,
          modelNodeId: persistableModel.modelNodeId ?? null,
          metrics: persistableModel.metrics ?? null,
          lossCount: Array.isArray(persistableModel.lossHistory) ? persistableModel.lossHistory.length : 0,
          trainedAt: persistableModel.trainedAt ?? null,
          ...(trainingSummary ? { trainingSummary } : {}),
        },
      });
      const acceptedExecution = acceptExecutionResultV1(executionEnvelope, executionRequest, currentRequestContext);
      if (!acceptedExecution.accepted) {
        executionEnvelope = createExecutionResultV1({
          request: executionRequest,
          runId: runAttemptId,
          status: 'stale',
          providerVersion,
          startedAt,
          finishedAt: new Date().toISOString(),
          diagnostics: ['RESULT_IDENTITY_STALE'],
        });
        updateRuntime((current) => ({ ...current, execution: executionEnvelope }));
        const staleError = new CanvasAgentError('WORKSPACE_CHANGED', 'Execution identity is no longer current.');
        staleError.translationKey = 'error.workspaceChangedDuringRun';
        throw staleError;
      }
      workspaceStateRef.current = { ...workspaceStateRef.current, model: persistableModel };
      try {
        resultBindingRef.current = createAgentApplicationResultBinding({
          nodes: state.nodes,
          edges: state.edges,
          customComponents: state.customComponents,
          dataset: state.dataset,
        });
      } catch {
        resultBindingRef.current = null;
      }
      updateRunHistory((history) => settleLumiRun(history, runAttemptId, {
        status: 'succeeded',
        model: persistableModel,
        losses: persistableModel.lossHistory ?? [],
        finishedAt: new Date().toISOString(),
      }));
      setModel(persistableModel);
      updateRuntime((current) => ({
        ...current,
        status: 'succeeded',
        activeNodeIds: [],
        losses: persistableModel.lossHistory ?? current.losses,
        error: null,
        result: {
          type: persistableModel.type,
          sourceNodeId: persistableModel.sourceNodeId,
          metrics: persistableModel.metrics ?? null,
        },
        execution: executionEnvelope,
        finishedAt: new Date().toISOString(),
      }));
      return persistableModel;
    } catch (error) {
      if (executionRequest && !executionEnvelope) {
        const errorCode = typeof error?.code === 'string' ? error.code : 'RUN_FAILED';
        const status = ['EXECUTION_TIMEOUT', 'H2_DEADLINE_EXCEEDED'].includes(errorCode) ? 'timed-out'
          : ['EXECUTION_CANCELLED', 'H2_CANCELLED'].includes(errorCode) ? 'cancelled' : 'failed';
        try {
          executionEnvelope = createExecutionResultV1({
            request: executionRequest,
            runId: runAttemptId,
            status,
          providerVersion,
            startedAt,
            finishedAt: new Date().toISOString(),
            diagnostics: [errorCode.replace(/[^A-Z0-9._-]/gi, '_').toUpperCase().slice(0, 64) || 'RUN_FAILED'],
            cancellationDisposition: status === 'cancelled' || status === 'timed-out' ? 'client-discarded' : 'none',
          });
        } catch { executionEnvelope = null; }
      }
      updateRunHistory((history) => settleLumiRun(history, runAttemptId, {
        status: 'failed',
        errorCode: typeof error?.code === 'string' ? error.code : 'RUN_FAILED',
        finishedAt: new Date().toISOString(),
      }));
      resultBindingRef.current = null;
      if (isH2LocalPython && !error?.translationKey) error.translationKey = 'runner.h2FitFailed';
      if (error?.code === 'WORKSPACE_CHANGED') {
        const nextNodes = invalidateAgentNodeStatuses(workspaceStateRef.current.nodes);
        workspaceStateRef.current = { ...workspaceStateRef.current, nodes: nextNodes, model: null };
        setNodes(nextNodes);
        setModel(null);
        updateRuntime({
          ...idleRuntimeState(),
          status: 'failed',
          execution: executionEnvelope,
          error: runtimeErrorInfo(error),
          finishedAt: new Date().toISOString(),
        });
      } else if (['EXECUTION_CANCELLED', 'EXECUTION_TIMEOUT', 'H2_CANCELLED', 'H2_DEADLINE_EXCEEDED'].includes(error?.code)) {
        const nextNodes = invalidateAgentNodeStatuses(workspaceStateRef.current.nodes);
        workspaceStateRef.current = { ...workspaceStateRef.current, nodes: nextNodes };
        setNodes(nextNodes);
        updateRuntime((current) => ({
          ...current,
          status: 'failed',
          activeNodeIds: [],
          losses: isWebGpuTraining || isH2LocalPython ? (state.runtime?.losses ?? []) : current.losses,
          execution: executionEnvelope,
          error: runtimeErrorInfo(error),
          finishedAt: new Date().toISOString(),
        }));
      } else {
        const attributedIds = Array.isArray(error?.nodeIds) ? error.nodeIds : validationNodeIds;
        const knownIds = new Set(state.nodes.map((node) => node.id));
        const errorIds = attributedIds.length
          ? [...new Set(attributedIds)].filter((id) => knownIds.has(id))
          : currentNode ? [currentNode.id] : [];
        setNodeStatus(errorIds, 'error');
        if (errorIds[0]) setSelectedId(errorIds[0]);
        updateRuntime((current) => ({
          ...current,
          status: 'failed',
          activeNodeIds: [],
          losses: isWebGpuTraining || isH2LocalPython ? (state.runtime?.losses ?? []) : current.losses,
          execution: executionEnvelope,
          error: runtimeErrorInfo(error),
          finishedAt: new Date().toISOString(),
        }));
      }
      throw error;
    } finally {
      if (executionTimeout !== null) window.clearTimeout(executionTimeout);
      executionControllerRef.current = null;
    }
  }, [setNodeStatus, setNodes, updateRunHistory, updateRuntime]);
  const cancelBrowserExecution = useCallback(() => executionControllerRef.current?.abort('user-cancelled'), []);
  const cancelWebGpuInference = useCallback(() => webGpuInferenceControllerRef.current?.abort('user-cancelled'), []);
  const runWebGpuInference = useCallback(async ({ model: requestedModel, rawFeatures, isCurrent = () => true }) => {
    const state = workspaceStateRef.current;
    const startedAt = new Date().toISOString();
    const requestId = `webgpu-${crypto.randomUUID()}`;
    const runId = `run-${crypto.randomUUID()}`;
    let request = null;
    const configProjection = browserWebGpuMlpConfigIdentity(requestedModel);
    const configIdentity = artifactFingerprintJsonV1({
      adapter: 'volk-browser-webgpu-mlp',
      providerVersion: BROWSER_WEBGPU_MLP_PROVIDER_VERSION,
      config: configProjection,
    });
    const inputIdentity = artifactFingerprintJsonV1({
      featureColumns: requestedModel.featureColumns,
      rawFeatures,
    });
    const graphFingerprint = graphSemanticFingerprintV1({
      nodes: state.nodes,
      edges: state.edges,
      componentDefinitions: state.customComponents,
    });
    const graphContract = analyzeBrowserExecutionGraph({ nodes: state.nodes, edges: state.edges, dataset: state.dataset });
    if (!graphContract.valid || graphContract.root?.data?.manifest?.op !== 'supervised_trainer'
      || graphContract.root.id !== requestedModel.sourceNodeId) {
      throw Object.assign(new Error('WEBGPU_GRAPH_UNSUPPORTED'), { code: 'WEBGPU_GRAPH_UNSUPPORTED' });
    }
    const fittedGraphFingerprint = state.runtime?.execution?.graphIdentity?.fingerprint;
    if (fittedGraphFingerprint && fittedGraphFingerprint !== graphFingerprint) {
      throw Object.assign(new Error('WEBGPU_RESULT_STALE'), { code: 'WEBGPU_RESULT_STALE' });
    }
    const boundedInputBytes = new TextEncoder().encode(JSON.stringify({ configProjection, rawFeatures })).byteLength;
    const startedSessionId = projectSessionIdRef.current;
    if (boundedInputBytes > 20 * 1024 * 1024) {
      throw Object.assign(new Error('WEBGPU_INPUT_OVER_BUDGET'), { code: 'WEBGPU_INPUT_OVER_BUDGET' });
    }
    if (!state.model || artifactFingerprintJsonV1({
      adapter: 'volk-browser-webgpu-mlp',
      providerVersion: BROWSER_WEBGPU_MLP_PROVIDER_VERSION,
      config: browserWebGpuMlpConfigIdentity(state.model),
    }) !== configIdentity || !isCurrent()) {
      throw Object.assign(new Error('WEBGPU_RESULT_STALE'), { code: 'WEBGPU_RESULT_STALE' });
    }
    request = createExecutionRequestV1({
      requestId,
      projectSessionId: startedSessionId,
      graphIdentity: { kind: 'graph', fingerprint: graphFingerprint },
      inputIdentity,
      configIdentity,
      providerId: 'browser-webgpu',
      mode: 'inference',
      budget: {
        maxDurationMs: 30_000,
        maxInputBytes: Math.max(1, boundedInputBytes),
        maxOutputBytes: 16_384,
      },
      approvedAt: startedAt,
    });
    const controller = new AbortController();
    webGpuInferenceControllerRef.current = controller;
    try {
      const inference = await runBrowserWebGpuMlpInference(requestedModel, rawFeatures, {
        signal: controller.signal,
        maxDurationMs: request.budget.maxDurationMs,
      });
      const stateAfterInference = workspaceStateRef.current;
      let currentGraphFingerprint = null;
      let currentConfigIdentity = null;
      try {
        currentGraphFingerprint = graphSemanticFingerprintV1({
          nodes: stateAfterInference.nodes,
          edges: stateAfterInference.edges,
          componentDefinitions: stateAfterInference.customComponents,
        });
        currentConfigIdentity = stateAfterInference.model
          ? artifactFingerprintJsonV1({
            adapter: 'volk-browser-webgpu-mlp',
            providerVersion: BROWSER_WEBGPU_MLP_PROVIDER_VERSION,
            config: browserWebGpuMlpConfigIdentity(stateAfterInference.model),
          }) : null;
      } catch { /* An invalidated graph/model cannot accept a delayed result. */ }
      const currentInputIdentity = isCurrent() ? inputIdentity : artifactFingerprintJsonV1({ stale: true, requestId });
      const accepted = acceptExecutionResultV1(createExecutionResultV1({
        request,
        runId,
        status: 'succeeded',
        providerVersion: inference.providerVersion,
        startedAt,
        finishedAt: new Date().toISOString(),
        output: {
          task: requestedModel.task,
          prediction: requestedModel.task === 'classification'
            ? requestedModel.labels[inference.values.indexOf(Math.max(...inference.values))]
            : inference.values[0],
          parity: {
            passed: inference.parity.passed,
            normalizationMaxAbsError: inference.parity.normalizationMaxAbsError,
            maxAbsoluteError: Math.max(inference.parity.normalizationMaxAbsError, ...Object.values(inference.parity.maxAbsoluteErrorByOperation)),
          },
        },
        provenance: 'live-webgpu',
      }), request, {
        projectSessionId: projectSessionIdRef.current,
        graphIdentity: currentGraphFingerprint,
        inputIdentity: currentInputIdentity,
        configIdentity: currentConfigIdentity,
      });
      if (accepted.accepted) return createExecutionResultV1({
        request,
        runId,
        status: 'succeeded',
        providerVersion: inference.providerVersion,
        startedAt,
        finishedAt: new Date().toISOString(),
        output: accepted.output,
        provenance: 'live-webgpu',
      });
      return createExecutionResultV1({
        request,
        runId,
        status: 'stale',
        providerVersion: BROWSER_WEBGPU_MLP_PROVIDER_VERSION,
        startedAt,
        finishedAt: new Date().toISOString(),
        diagnostics: ['RESULT_IDENTITY_STALE'],
        provenance: 'live-webgpu',
      });
    } catch (error) {
      if (!request) throw error;
      const code = typeof error?.code === 'string' && /^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(error.code)
        ? error.code : 'WEBGPU_EXECUTION_FAILED';
      const status = code === 'WEBGPU_TIMEOUT' ? 'timed-out'
        : code === 'WEBGPU_CANCELLED' ? 'cancelled'
          : code === 'WEBGPU_RESULT_STALE' ? 'stale' : 'failed';
      return createExecutionResultV1({
        request,
        runId,
        status,
        providerVersion: BROWSER_WEBGPU_MLP_PROVIDER_VERSION,
        startedAt,
        finishedAt: new Date().toISOString(),
        diagnostics: [code],
        cancellationDisposition: status === 'cancelled' || status === 'timed-out' ? 'client-discarded' : 'none',
        provenance: 'live-webgpu',
      });
    } finally {
      webGpuInferenceControllerRef.current = null;
    }
  }, []);
  useEffect(() => {
    if (previousExecutionSignature.current === executionInputSignature) return;
    previousExecutionSignature.current = executionInputSignature;
    if (workspaceStateRef.current.runtime.status !== 'running') {
      const nextNodes = invalidateAgentNodeStatuses(workspaceStateRef.current.nodes);
      workspaceStateRef.current = { ...workspaceStateRef.current, nodes: nextNodes, model: null };
      setNodes(nextNodes);
      setModel(null);
      updateRuntime(idleRuntimeState());
    }
  }, [executionInputSignature, setNodes, updateRuntime]);
  const viewportCenterPosition = () => {
    const container = flowWrapperRef.current;
    const instance = reactFlowInstanceRef.current;
    if (!container || !instance?.screenToFlowPosition) return { x: 120, y: 90 };
    const rect = container.getBoundingClientRect();
    return instance.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };
  const addPluginNode = (manifest) => { const node = createNode(manifest, viewportCenterPosition()); setNodes((current) => [...current, node]); setSelectedId(node.id); setModel(null); };
  const deleteCustomComponent = (manifest) => {
    if (!window.confirm(t('library.deleteCustomConfirm', { name: t(manifest.name) }))) return;
    setCustomComponents((current) => current.filter((item) => item.id !== manifest.id));
    setNotice(t('library.customDeleted', { name: t(manifest.name) }));
  };
  const updateParameter = (key, value) => { setNodes((current) => current.map((node) => node.id === selectedNode?.id ? { ...node, data: { ...node.data, parameters: { ...node.data.parameters, [key]: value }, status: 'idle' } } : node)); setModel(null); };
  const exportCode = (framework) => {
    try {
      const result = framework === 'tensorflow' ? compilePipelineToTensorFlow(nodes, edges) : compilePipelineToPyTorch(nodes, edges);
      downloadText(`volk_ml_${framework}_pipeline.py`, result.code, 'text/x-python');
      setNotice(t('compiler.exported', { framework: t(`framework.${framework}`) }));
    }
    catch (error) { setNotice(translateError(error, t)); }
  };
  const exportSourceMap = async (framework) => {
    try {
      const api = agentApplicationApiRef.current;
      if (!api) throw new Error('SOURCE_EXPORT_API_UNAVAILABLE');
      const response = await api.request({
        apiVersion: AGENT_APPLICATION_API_VERSION,
        requestId: `source-map-${crypto.randomUUID()}`,
        method: 'exportGraph',
        params: { framework, includeManifest: true },
      });
      if (!response.ok || !response.result?.manifest) throw new Error('SOURCE_EXPORT_MANIFEST_UNAVAILABLE');
      downloadText(`volk_ml_${framework}_source_export.json`, JSON.stringify({
        type: 'VolkSourceExportBundleV1',
        framework,
        source: response.result.code,
        manifest: response.result.manifest,
      }, null, 2), 'application/json');
      setNotice(t('compiler.sourceMapExported', { framework: t(`framework.${framework}`) }));
    } catch {
      setNotice(t('compiler.sourceMapFailed'));
    }
  };
  const expandSelectedComposite = () => {
    if (!selectedNode?.data.manifest.composition) return;
    try {
      const expansion = expandComposite(selectedNode);
      const compositeOrigin = {
        id: selectedNode.id,
        label: selectedNode.data.label,
        manifest: selectedNode.data.manifest,
        parameters: selectedNode.data.parameters,
        position: selectedNode.position,
      };
      const unrelated = edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id);
      const redirected = [];
      edges.filter((edge) => edge.target === selectedNode.id).forEach((edge) => {
        (expansion.inputs[edge.targetHandle] ?? []).forEach((target) => redirected.push({
          ...edge,
          id: `expanded-input-${crypto.randomUUID()}`,
          target: target.nodeId,
          targetHandle: target.port,
        }));
      });
      edges.filter((edge) => edge.source === selectedNode.id).forEach((edge) => {
        const source = expansion.outputs[edge.sourceHandle];
        if (source) redirected.push({
          ...edge,
          id: `expanded-output-${crypto.randomUUID()}`,
          source: source.nodeId,
          sourceHandle: source.port,
        });
      });
      const expandedNodes = expansion.nodes.map((node) => ({
        ...node,
        data: { ...node.data, compositeOrigin },
      }));
      setNodes((current) => [...current.filter((node) => node.id !== selectedNode.id), ...expandedNodes]);
      setEdges([...unrelated, ...expansion.edges, ...redirected].map((edge) => ({ ...edge, type: 'deletable' })));
      setSelectedId(expandedNodes[0]?.id);
      setModel(null);
      setNotice(t('component.expanded'));
    } catch (error) { setNotice(translateError(error, t)); }
  };
  const collapseSelectedComposite = () => {
    const origin = selectedNode?.data.compositeOrigin;
    if (!origin) return;
    const groupNodes = nodes.filter((node) => node.data.compositeOrigin?.id === origin.id);
    const groupIds = new Set(groupNodes.map((node) => node.id));
    if (!groupNodes.length) return;
    const rebuilt = rebuildCompositeInstance({ origin, groupNodes, edges });
    const parent = {
      id: origin.id,
      type: 'pipelineNode',
      position: rebuilt.position,
      data: {
        label: origin.label,
        manifest: rebuilt.manifest,
        parameters: rebuilt.parameters,
        status: 'idle',
      },
    };
    setNodes((current) => [...current.filter((node) => !groupIds.has(node.id)), parent]);
    setEdges([
      ...edges.filter((edge) => !groupIds.has(edge.source) && !groupIds.has(edge.target)),
      ...rebuilt.edges,
    ].map((edge) => ({ ...edge, type: 'deletable' })));
    setSelectedId(parent.id);
    setModel(null);
    setNotice(t('component.collapsed'));
  };
  const createCompositeFromSelection = ({ name, color }) => {
    try {
      const result = createCustomComposite({ selectedNodes, edges, name, color });
      const selectedIds = new Set(selectedNodes.map((node) => node.id));
      setNodes((current) => [
        ...current.filter((node) => !selectedIds.has(node.id)).map((node) => ({ ...node, selected: false })),
        result.instance,
      ]);
      setEdges(result.nextEdges.map((edge) => ({ ...edge, type: 'deletable' })));
      setCustomComponents((current) => [...current, result.manifest]);
      setSelectedId(result.instance.id);
      setCompositeOpen(false);
      setModel(null);
      setNotice(t('composite.created'));
    } catch (error) {
      setNotice(t(error.message === 'error.compositeNestedSelection' ? 'composite.noNested' : 'composite.selectTwo'));
    }
  };
  const exportProject = async () => {
    const project = makeProject();
    const content = JSON.stringify(project, null, 2);
    try {
      if (window.showSaveFilePicker) {
        const handle = fileHandleRef.current ?? await window.showSaveFilePicker({
          suggestedName: safeProjectFilename(project.name),
          types: [{
            description: t('project.fileType'),
            accept: { 'application/json': ['.json'] },
          }],
        });
        fileHandleRef.current = handle;
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
      } else {
        downloadText(safeProjectFilename(project.name), content, 'application/json');
      }
      lastDownloadSignature.current = projectSignature;
      setPersistenceRevision((revision) => revision + 1);
      setNotice(t('project.saved'));
    } catch (error) {
      if (error.name !== 'AbortError') setNotice(t('project.importFailed', { message: error.message }));
    }
  };
  const importProject = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      fileHandleRef.current = null;
      applyProject(JSON.parse(await file.text()));
      lastDownloadSignature.current = projectSignature;
      setPersistenceRevision((revision) => revision + 1);
      setNotice(t('project.imported'));
    } catch (error) {
      setNotice(t('project.importFailed', { message: translateError(error, t) }));
    }
  };
  const getAgentSnapshot = useCallback(() => {
    const state = workspaceStateRef.current;
    const project = projectFromWorkspace(state);
    return createCanvasAgentSnapshot({
      instanceId: instanceIdRef.current,
      project,
      nodes: state.nodes,
      edges: state.edges,
      selectedNodeId: state.selectedId,
      viewMode: state.viewMode,
      runtime: state.runtime,
      executionPlan: executionPlanFor(state.nodes, state.edges, state.dataset),
      dirty: projectContentSignature(project) !== lastDownloadSignature.current,
    });
  }, []);
  const commitAgentGraph = useCallback(({ nextNodes, nextEdges, nextSelectedId, invalidateArtifacts = true }) => {
    assertAgentWritable(workspaceStateRef.current, 'Canvas graph cannot change while execution is running.');
    if (invalidateArtifacts) resultBindingRef.current = null;
    const currentNodes = invalidateArtifacts ? invalidateAgentNodeStatuses(nextNodes) : nextNodes;
    const synchronizedNodes = selectAgentNode(currentNodes, nextSelectedId);
    const nextRuntime = invalidateArtifacts ? idleRuntimeState() : workspaceStateRef.current.runtime;
    workspaceStateRef.current = {
      ...workspaceStateRef.current,
      nodes: synchronizedNodes,
      edges: nextEdges,
      selectedId: nextSelectedId,
      model: invalidateArtifacts ? null : workspaceStateRef.current.model,
      runtime: nextRuntime,
    };
    setNodes(synchronizedNodes);
    setEdges(nextEdges);
    setSelectedId(nextSelectedId);
    setPendingConnection(null);
    if (invalidateArtifacts) {
      setModel(null);
      setRuntime(nextRuntime);
    }
  }, [setNodes, setEdges]);
  const agentAddNode = useCallback(async (request) => {
    const state = workspaceStateRef.current;
    const manifest = [...pluginRegistry, ...state.customComponents]
      .find((item) => item.id === request?.componentId);
    const node = createAgentNode({ nodes: state.nodes, manifest, request });
    commitAgentGraph({
      nextNodes: [...state.nodes, node],
      nextEdges: state.edges,
      nextSelectedId: node.id,
    });
    return { nodeId: node.id };
  }, [commitAgentGraph]);
  const agentUpdateNode = useCallback(async (nodeId, patch) => {
    const state = workspaceStateRef.current;
    const previousNode = state.nodes.find((node) => node.id === nodeId);
    const nextNodes = updateAgentNode(state.nodes, nodeId, patch);
    const nextNode = nextNodes.find((node) => node.id === nodeId);
    const parametersChanged = Object.keys(patch?.parameters ?? {})
      .some((key) => !Object.is(previousNode.data.parameters[key], nextNode.data.parameters[key]));
    commitAgentGraph({
      nextNodes,
      nextEdges: state.edges,
      nextSelectedId: nodeId,
      invalidateArtifacts: parametersChanged,
    });
    return { nodeId };
  }, [commitAgentGraph]);
  const agentRemoveNode = useCallback(async (nodeId) => {
    const state = workspaceStateRef.current;
    const next = removeAgentNode(state.nodes, state.edges, nodeId);
    commitAgentGraph({
      nextNodes: next.nodes,
      nextEdges: next.edges,
      nextSelectedId: state.selectedId === nodeId ? next.nodes[0]?.id ?? null : state.selectedId,
    });
    return { nodeId };
  }, [commitAgentGraph]);
  const agentConnect = useCallback(async (request) => {
    const state = workspaceStateRef.current;
    const nextEdges = connectAgentNodes(state.nodes, state.edges, request);
    const edgeId = nextEdges.at(-1).id;
    commitAgentGraph({ nextNodes: state.nodes, nextEdges, nextSelectedId: state.selectedId });
    return { edgeId };
  }, [commitAgentGraph]);
  const agentDisconnect = useCallback(async (edgeId) => {
    const state = workspaceStateRef.current;
    commitAgentGraph({
      nextNodes: state.nodes,
      nextEdges: disconnectAgentEdge(state.edges, edgeId),
      nextSelectedId: state.selectedId,
    });
    return { edgeId };
  }, [commitAgentGraph]);
  const agentSelectNode = useCallback(async (nodeId) => {
    const state = workspaceStateRef.current;
    assertAgentWritable(state, 'Canvas selection cannot change while execution is running.');
    const nextNodes = selectAgentNode(state.nodes, nodeId);
    workspaceStateRef.current = { ...state, nodes: nextNodes, selectedId: nodeId };
    setNodes(nextNodes);
    setSelectedId(nodeId);
    return { nodeId };
  }, [setNodes]);
  const agentRenameProject = useCallback(async (name) => {
    assertAgentWritable(workspaceStateRef.current, 'Project cannot be renamed while execution is running.');
    if (typeof name !== 'string' || !name.trim()) {
      throw new CanvasAgentError('INVALID_PROJECT_NAME', 'Project name cannot be empty.');
    }
    const nextName = name.trim();
    workspaceStateRef.current = { ...workspaceStateRef.current, projectName: nextName };
    setProjectName(nextName);
    return { name: nextName };
  }, []);
  const agentSetDataset = useCallback(async (nextDataset) => {
    assertAgentWritable(workspaceStateRef.current, 'Dataset cannot change while execution is running.');
    resultBindingRef.current = null;
    const validatedDataset = validateAgentDataset(nextDataset);
    const nextRuntime = idleRuntimeState();
    const nextNodes = invalidateAgentNodeStatuses(workspaceStateRef.current.nodes);
    workspaceStateRef.current = {
      ...workspaceStateRef.current,
      nodes: nextNodes,
      dataset: validatedDataset,
      model: null,
      runtime: nextRuntime,
    };
    setNodes(nextNodes);
    setDataset(validatedDataset);
    setModel(null);
    setRuntime(nextRuntime);
    return { hasDataset: Boolean(validatedDataset), rows: validatedDataset?.rows.length ?? 0 };
  }, [setNodes]);
  const agentLoadProject = useCallback(async (project) => {
    assertAgentWritable(workspaceStateRef.current, 'Project cannot change while execution is running.');
    applyProject(project);
    const normalized = projectFromWorkspace(workspaceStateRef.current);
    lastDownloadSignature.current = projectContentSignature(normalized);
    setPersistenceRevision((revision) => revision + 1);
    return { name: normalized.name, version: normalized.version };
  }, [applyProject]);
  const agentExportCode = useCallback(async (framework, options = {}) => {
    if (!['pytorch', 'tensorflow'].includes(framework)) {
      throw new CanvasAgentError('UNSUPPORTED_FRAMEWORK', `Unsupported framework: ${framework}.`, { framework });
    }
    const state = workspaceStateRef.current;
    const result = framework === 'tensorflow'
      ? compilePipelineToTensorFlow(state.nodes, state.edges)
      : compilePipelineToPyTorch(state.nodes, state.edges);
    const filename = `volk_ml_${framework}_pipeline.py`;
    if (options?.download) downloadText(filename, result.code, 'text/x-python');
    return result.code;
  }, []);
  const agentDownloadProject = useCallback(async () => {
    assertAgentWritable(workspaceStateRef.current, 'Project cannot be downloaded while execution is running.');
    const project = projectFromWorkspace(workspaceStateRef.current);
    const content = JSON.stringify(project, null, 2);
    const filename = safeProjectFilename(project.name);
    downloadText(filename, content, 'application/json');
    lastDownloadSignature.current = projectContentSignature(project);
    setPersistenceRevision((revision) => revision + 1);
    return { filename, bytes: new Blob([content]).size };
  }, []);
  agentAdapterRef.current = {
    getState: getAgentSnapshot,
    playground: agentPlaygroundRef.current,
    listComponents: () => [...pluginRegistry, ...workspaceStateRef.current.customComponents].map(summarizeAgentComponent),
    addNode: agentAddNode,
    updateNode: agentUpdateNode,
    removeNode: agentRemoveNode,
    connect: agentConnect,
    disconnect: agentDisconnect,
    selectNode: agentSelectNode,
    renameProject: agentRenameProject,
    setDataset: agentSetDataset,
    loadProject: agentLoadProject,
    getProject: () => projectFromWorkspace(workspaceStateRef.current),
    run: runBrowserGraph,
    exportCode: agentExportCode,
    downloadProject: agentDownloadProject,
    subscribe(listener) {
      agentSubscribersRef.current.add(listener);
      return () => agentSubscribersRef.current.delete(listener);
    },
  };
  if (!agentApplicationApiRef.current) {
    agentApplicationApiRef.current = createAgentApplicationApi({
      getContext: () => {
        const state = workspaceStateRef.current;
        return {
          project: projectFromWorkspace(state),
          nodes: state.nodes,
          edges: state.edges,
          dataset: state.dataset,
          runtime: state.runtime,
          executionPlan: executionPlanFor(state.nodes, state.edges, state.dataset),
          resultBinding: resultBindingRef.current,
          currentProposal: stagedGraphProposalRef.current,
          proposalHistory: proposalHistoryRef.current,
          components: [...pluginRegistry, ...state.customComponents],
        };
      },
      submitProposal: (proposal) => proposalSubmitAdapterRef.current?.(proposal)
        ?? { ok: false, diagnostics: [{ code: 'PROPOSAL_SUBMISSION_UNAVAILABLE' }] },
    });
  }
  useEffect(() => installAgentApplicationBridge(agentApplicationApiRef.current, window), []);
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const stop = connectMcpBrowserBridgeFromLocation();
    if (typeof stop.pause === 'function') window.__VOLK_ML_MCP_BRIDGE_TEST__ = Object.freeze({ pause: stop.pause, resume: stop.resume, stop });
    return () => {
      if (window.__VOLK_ML_MCP_BRIDGE_TEST__?.stop === stop) delete window.__VOLK_ML_MCP_BRIDGE_TEST__;
      stop();
    };
  }, []);
  useEffect(() => {
    const forward = (method) => (...args) => agentAdapterRef.current[method](...args);
    const api = createCanvasAgentApi({
      instanceId: instanceIdRef.current,
      getState: forward('getState'),
      playground: agentPlaygroundRef.current,
      listComponents: forward('listComponents'),
      addNode: forward('addNode'),
      updateNode: forward('updateNode'),
      removeNode: forward('removeNode'),
      connect: forward('connect'),
      disconnect: forward('disconnect'),
      selectNode: forward('selectNode'),
      renameProject: forward('renameProject'),
      setDataset: forward('setDataset'),
      loadProject: forward('loadProject'),
      getProject: forward('getProject'),
      run: forward('run'),
      exportCode: forward('exportCode'),
      downloadProject: forward('downloadProject'),
      subscribe: forward('subscribe'),
    });
    return installCanvasAgentBridge(api, window);
  }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('agent-test') !== '1') return undefined;
    let active = true;
    runCanvasAgentExerciseSuite(window).then((result) => {
      if (active) window.__VOLK_ML_AGENT_TEST_RESULT__ = result;
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!agentSubscribersRef.current.size) return;
    const snapshot = getAgentSnapshot();
    agentSubscribersRef.current.forEach((listener) => {
      try { listener(snapshot); } catch { /* One agent listener must not block the workspace. */ }
    });
  }, [projectSignature, runtime, selectedId, viewMode, persistenceRevision, getAgentSnapshot]);
  const startResize = (side, event) => {
    event.preventDefault();
    const startX = event.clientX;
    const initial = side === 'left' ? leftWidth : rightWidth;
    const move = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = initial + (side === 'left' ? delta : -delta);
      const min = side === 'left' ? LEFT_PANEL_MIN : RIGHT_PANEL_MIN;
      const max = side === 'left' ? LEFT_PANEL_MAX : RIGHT_PANEL_MAX;
      (side === 'left' ? setLeftWidth : setRightWidth)(Math.min(max, Math.max(min, next)));
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const openExplorePlayground = useCallback(async (id, { recipeId = null, initialTab = null } = {}) => {
    const key = `playground:${id}`;
    disposeEphemeralExploreWorkspaces(key);
    const workspace = getExploreWorkspace(key, recipeId);
    try {
      await workspace.host.ensureOpen(id);
      setExploreWorkspaceKey(key);
      setPlaygroundInitialTab(initialTab ?? (id === 'data-lab' ? 'data' : 'model'));
      setPlaygroundId(id);
      setPlaygroundOpen(true);
      setExploreRecovery(null);
    } catch (error) {
      setNotice(translateError(error, t));
    }
  }, [disposeEphemeralExploreWorkspaces, getExploreWorkspace, t]);

  const openBigIdea = useCallback(async (id, { seed, restart = false } = {}) => {
    const entrance = getBigIdeaEntrance(id);
    if (!entrance) return;
    const key = `big-idea:${id}`;
    disposeEphemeralExploreWorkspaces(key);
    const workspace = getExploreWorkspace(key, id);
    try {
      let current = null;
      try { current = workspace.host.getState(); } catch { /* first open */ }
      if (current && restart) {
        await workspace.host.restartBigIdeaEntrance({ id, seed });
      } else if (current) {
        const expected = createExploreEnvironmentIdentity({
          recipeId: id,
          playgroundId: entrance.startingPoint.playgroundId,
          modelAdapterId: entrance.startingPoint.modelAdapterId,
        });
        const compatibility = compareExploreEnvironment(expected, workspace.host.getExploreEnvironmentIdentity());
        if (!compatibility.compatible) {
          setExploreRecovery({ key, id, expected, actual: compatibility.actual, host: workspace.host });
          setExploreWorkspaceKey(key);
          setPlaygroundId(entrance.startingPoint.playgroundId);
          // Keep the mismatched host closed. Opening the dialog would let its
          // ensureOpen effect silently rebase the session before recovery is
          // explicitly accepted.
          setPlaygroundOpen(false);
          return;
        }
      } else {
        await workspace.host.openBigIdeaEntrance({ id, seed });
      }
      setExploreWorkspaceKey(key);
      setPlaygroundInitialTab(entrance.startingPoint.playgroundId === 'data-lab' ? 'data' : 'model');
      setPlaygroundId(entrance.startingPoint.playgroundId);
      setPlaygroundOpen(true);
      setExploreRecovery(null);
    } catch (error) {
      setNotice(translateError(error, t));
    }
  }, [disposeEphemeralExploreWorkspaces, getExploreWorkspace, t]);

  const openPhaseAHandoff = useCallback(async (id, { seed, restart = false } = {}) => {
    const entrance = getBigIdeaEntrance(id);
    if (!entrance) return;
    const key = `phase-a:${id}`;
    disposeEphemeralExploreWorkspaces(key);
    const workspace = getExploreWorkspace(key, id);
    try {
      const current = (() => { try { return workspace.host.getState(); } catch { return null; } })();
      if (current && restart) await workspace.host.restartPhaseAHandoff({ id, seed });
      else if (!current) await workspace.host.openPhaseAHandoff({ id, seed });
      setExploreWorkspaceKey(key);
      setPlaygroundInitialTab('data');
      setPlaygroundId(entrance.startingPoint.playgroundId);
      setPlaygroundOpen(true);
      setExploreRecovery(null);
    } catch (error) {
      setNotice(translateError(error, t));
    }
  }, [disposeEphemeralExploreWorkspaces, getExploreWorkspace, t]);

  const openExploreFromBuild = useCallback((target = 'data-lab') => {
    const modelNode = nodes.find((node) => ['knn_node', 'linear_regression_node', 'supervised_trainer_node'].includes(node.data?.manifest?.id));
    const modelAdapterId = modelNode?.data?.manifest?.id === 'knn_node' ? 'knn' : modelNode?.data?.manifest?.id === 'supervised_trainer_node' ? 'mlp' : modelNode?.data?.manifest?.id === 'linear_regression_node' ? 'linear-regression' : null;
    const bridge = createBuildExploreBridge({ build: { dataset, modelAdapterId }, target });
    if (!bridge.supported) {
      setNotice(t('explore.workspace.bridgeUnsupported'));
      return;
    }
    disposeEphemeralExploreWorkspaces();
    exploreForkCounterRef.current = (exploreForkCounterRef.current % 8) + 1;
    const key = `${bridge.workspace.id}:fork-${exploreForkCounterRef.current}`;
    const workspace = getExploreWorkspace(key, bridge.workspace.recipeId, () => structuredClone(dataset), EXPLORE_WORKSPACE_LIFECYCLES.EPHEMERAL);
    workspace.host.ensureOpen(target).then(async () => {
      await workspace.host.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: bridge.modelPlaygroundId, actor: 'system' });
      setExploreWorkspaceKey(key);
      setPlaygroundInitialTab('data');
      setPlaygroundId(target);
      setPlaygroundOpen(true);
      setNotice(t('explore.workspace.bridgeCreated'));
    }).catch((error) => setNotice(translateError(error, t)));
  }, [dataset, disposeEphemeralExploreWorkspaces, getExploreWorkspace, nodes, t]);

  const openExploreCapacityBridge = useCallback((selectedNodeId, { newSession = false, requireSelection = true } = {}) => {
    if (typeof selectedNodeId !== 'string' || !selectedNodeId) return;
    const current = workspaceStateRef.current;
    if (requireSelection) {
      const selectedNow = current.nodes.filter((node) => node.selected);
      if (selectedNow.length !== 1 || selectedNow[0].id !== selectedNodeId) return;
    }
    const build = {
      nodes: current.nodes,
      edges: current.edges,
      dataset: current.dataset,
      customComponents: current.customComponents,
    };
    const assessment = inspectExploreCapacityBuild(build, { selectedNodeId });
    if (!assessment.supported) return;
    const existing = exploreCapacityBridgeRef.current;
    const existingSnapshot = existing?.getSnapshot();
    if (!newSession
      && existingSnapshot?.projectSessionId === projectSessionIdRef.current
      && existingSnapshot.graphIdentity
      && existingSnapshot.selectedHiddenNode?.nodeId === selectedNodeId) {
      setExploreCapacityBridgeOpen(true);
      return;
    }
    existing?.dispose();
    const nextSession = createExploreBridgeSessionV1({
      build,
      selectedNodeId,
      projectSessionId: projectSessionIdRef.current,
    });
    exploreCapacityBridgeRef.current = nextSession;
    setExploreCapacityBridge(nextSession);
    setExploreCapacityBridgeOpen(true);
  }, []);

  const closeExploreCapacityBridge = useCallback(() => {
    exploreCapacityBridgeRef.current?.close();
    setExploreCapacityBridgeOpen(false);
  }, []);

  const activeExploreHost = activeExploreWorkspace?.host ?? null;
  const activeExploreAgent = activeExploreWorkspace?.agent ?? null;
  const canResumeExplore = (() => {
    if (playgroundOpen || activeExploreWorkspace?.record.lifecycle !== EXPLORE_WORKSPACE_LIFECYCLES.PERSISTENT) return false;
    try {
      const current = activeExploreWorkspace.host.getState();
      return Boolean(current?.playgroundId && current?.experimentWorkspace?.activeExperimentId);
    } catch {
      return false;
    }
  })();
  const handleLumiResultSuggestion = useCallback((suggestionId) => {
    if (suggestionId === 'inspect-loss') {
      document.getElementById('runner-loss-chart')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (suggestionId === 'review-graph-layout') {
      const ordered = [...nodes].sort((left, right) => left.id.localeCompare(right.id));
      const source = ordered[1];
      const target = ordered[0];
      const sourceName = source ? t(source.data.label) : '';
      const targetName = target ? t(target.data.label) : '';
      setLumiGraphEditSeed(sourceName && targetName
        ? t('lumiResult.graphEditPrompt', { source: sourceName, target: targetName })
        : t('lumiResult.graphEditPromptGeneric'));
      setLumiGraphEditOpen(true);
    }
  }, [nodes, t]);

  const asideBase = 'fixed bottom-3 top-[76px] z-30 overflow-auto rounded-3xl border border-white/80 bg-white/95 p-4 shadow-2xl backdrop-blur transition-transform lg:static lg:z-auto lg:h-auto lg:rounded-3xl lg:bg-white/85 lg:shadow-xl';
  return <WorkspaceGraphProposalContext.Provider value={surface === UI_SURFACES.BUILD ? submitWorkspaceGraphProposal : null}><div className="flex h-[100dvh] flex-col overflow-hidden bg-gradient-to-br from-sky-50 via-white to-indigo-100">
    <header data-top-level-surface={surface} className="z-40 flex min-h-[64px] items-center justify-between gap-3 border-b border-white/70 bg-white/90 px-3 py-2 shadow-sm backdrop-blur sm:px-5">
      <div className="flex min-w-0 items-center gap-3"><div className="shrink-0"><h1 className="text-xl font-black text-slate-950 sm:text-2xl">VOLK-ML</h1><p className="hidden truncate text-xs text-slate-600 xl:block">{t('app.tagline')}</p></div><span className="hidden text-xs font-bold text-slate-400 sm:inline">{autosavedAt ? t('project.autosaved') : t('project.unsaved')}</span>{SHOW_CLOUD_STATUS && <span data-cloud-status={cloudStatus.status} aria-live="polite" className={`hidden rounded-full px-2 py-1 text-[10px] font-black sm:inline ${cloudStatus.status === CLOUD_AVAILABILITY.AVAILABLE ? 'bg-emerald-100 text-emerald-800' : cloudStatus.status === CLOUD_AVAILABILITY.CHECKING ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-800'}`}>{t(`cloud.status.${cloudStatus.status}`)}</span>}</div>
      <nav aria-label={t('surface.navigation')} className="flex items-center gap-1.5 text-sm">
        <button type="button" aria-pressed={surface === UI_SURFACES.EXPLORE} className={`rounded-xl px-3 py-2 font-bold ${surface === UI_SURFACES.EXPLORE ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => { closeExploreCapacityBridge(); clearGraphProposal('cancelled'); setGraphApplyCommitDiagnostic(null); setSurface(UI_SURFACES.EXPLORE); }}>{t('ui.surface.explore')}</button>
        <button type="button" aria-pressed={surface === UI_SURFACES.BUILD} className={`rounded-xl px-3 py-2 font-bold ${surface === UI_SURFACES.BUILD ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setSurface(UI_SURFACES.BUILD)}>{t('ui.surface.build')}</button>
        <div className="relative">
          <button type="button" aria-expanded={globalMoreOpen} aria-controls="global-more-actions" className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={() => setGlobalMoreOpen((value) => !value)}>⋯ <span className="hidden sm:inline">{t('surface.more')}</span></button>
          {globalMoreOpen && <div id="global-more-actions" className="absolute right-0 top-full z-50 mt-2 grid min-w-52 gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl"><button type="button" className="flex items-center gap-3 rounded-xl px-3 py-2 text-left font-bold hover:bg-slate-100" onClick={() => { openSettings(); setGlobalMoreOpen(false); }}><span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-indigo-100 text-sm font-black text-indigo-700">⚙</span><span>{t('nav.aiSettings')}</span></button><button type="button" className="flex items-center gap-3 rounded-xl px-3 py-2 text-left font-bold hover:bg-slate-100" onClick={() => { setAccountOpen(true); setGlobalMoreOpen(false); }}><span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-100 text-sm font-black text-emerald-700">◎</span><span>{t('account.title')}</span></button><button type="button" className="flex items-center gap-3 rounded-xl px-3 py-2 text-left font-bold hover:bg-slate-100" onClick={() => { setLanguageOpen(true); setGlobalMoreOpen(false); }}><span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-200 text-sm font-black text-slate-800">文</span><span>{t('language.title')}</span></button></div>}
        </div>
      </nav>
    </header>

    {surface === UI_SURFACES.EXPLORE ? <ExploreHome onOpenBigIdea={openBigIdea} onOpenPlayground={openExplorePlayground} onOpenDirector={() => setDirectorOpen(true)} onOpenBuild={() => setSurface(UI_SURFACES.BUILD)} onResumeExplore={() => { if (canResumeExplore) setPlaygroundOpen(true); }} canResumeExplore={canResumeExplore} onOpenImportedAttention={() => { setG2AnchorNodeId(null); setG2AnchorProjectSessionId(null); setG2AttentionOpen(true); }} t={t} /> : <>
      <BuildToolbar projectName={projectName} setProjectName={setProjectName} autosavedAt={autosavedAt} onToggleLeft={toggleLeftPanel} onToggleRight={toggleRightPanel} viewMode={viewMode} setViewMode={setViewMode} setExplanationOpen={setExplanationOpen} selectedNodes={selectedNodes} setCompositeOpen={setCompositeOpen} multiSelectMode={multiSelectMode} setMultiSelectMode={setMultiSelectMode} setExamplesOpen={setExamplesOpen} dataset={dataset} setDataOpen={setDataOpen} exportProject={exportProject} importRef={importRef} importProject={importProject} importTorchExport={importTorchExportDocument} importOnnx={importOnnxDocument} onOpenExplorePlayground={openExplorePlayground} onOpenG2ForNode={(nodeId) => { setG2AnchorNodeId(nodeId); setG2AnchorProjectSessionId(projectSessionIdRef.current); setG2AttentionOpen(true); }} onExploreCurrentSetup={openExploreFromBuild} onOpenExploreCapacityBridge={(nodeId) => openExploreCapacityBridge(nodeId)} canOpenExploreCapacityBridge={canOpenExploreCapacityBridge} selectedCapacityNodeId={selectedCapacityNodeId} capacityBridgeRepair={capacityBridgeRepair} setRunnerOpen={setRunnerOpen} graphOccupied={nodes.length > 0 || edges.length > 0} onOpenBuildIntent={() => setLumiBuildIntentOpen(true)} onOpenGraphEdit={() => setLumiGraphEditOpen(true)} t={t} />

    <main data-build-surface className="relative grid min-h-0 flex-1 grid-cols-[0_minmax(0,1fr)_0] gap-3 p-3 lg:grid-cols-[var(--left-panel)_minmax(0,1fr)_var(--right-panel)]" style={{ '--left-panel': `${leftOpen ? leftWidth : 0}px`, '--right-panel': `${rightOpen ? rightWidth : 0}px` }}>
      <motion.aside initial={false} animate={{ x: leftOpen ? 0 : '-110%' }} style={{ width: `min(${leftWidth}px, calc(100vw - 24px))` }} className={`${asideBase} left-3 lg:transform-none ${leftOpen ? 'lg:block' : 'lg:hidden'}`}>
        <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-black">{t('library.title')}</h2><button aria-label={t('common.close')} className="rounded-lg p-2 hover:bg-slate-100" onClick={() => setLeftOpen(false)}>✕</button></div>
        <div className="mt-3 flex gap-2"><div className="relative min-w-0 flex-1"><span className="absolute left-3 top-2.5">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('library.search')} className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500" /></div><button className="rounded-xl border px-3 text-sm font-bold" onClick={() => setLibraryMode((mode) => mode === 'compact' ? 'detailed' : 'compact')}>{libraryMode === 'compact' ? '☷' : '≡'}</button></div>
        <label className="mt-3 flex items-center gap-3 text-xs text-slate-500"><span>{t('common.width')}</span><input type="range" min={LEFT_PANEL_MIN} max={LEFT_PANEL_MAX} value={leftWidth} onChange={(event) => setLeftWidth(Number(event.target.value))} className="min-w-0 flex-1 accent-blue-600" /><span>{leftWidth}px</span></label>
        <p className="mt-2 text-xs text-slate-400">{t('library.summary', { count: filteredPlugins.length, mode: `library.${libraryMode}` })}</p>
        <ComponentLibrary plugins={filteredPlugins} query={query} mode={libraryMode} onAdd={addPluginNode} onTutorial={setTutorialManifest} onDeleteCustom={deleteCustomComponent} t={t} />
        <div className="absolute bottom-8 right-0 top-8 hidden w-2 cursor-col-resize touch-none lg:block" onPointerDown={(event) => startResize('left', event)} />
      </motion.aside>

      <section ref={flowWrapperRef} tabIndex={0} onKeyDown={handleCanvasKeyDown} className="relative col-start-2 overflow-hidden rounded-3xl border border-white/80 bg-white shadow-xl outline-none">
        {pendingConnection && <div className="absolute left-1/2 top-3 z-20 flex max-w-[calc(100%_-_24px)] -translate-x-1/2 items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-xs font-bold text-white shadow-xl"><span className="truncate">{pendingConnection.port.name} · {readablePortType(pendingConnection.type, t)} → {t('connection.tapMatching')}</span><button aria-label={t('common.close')} className="nodrag rounded-full bg-white/20 px-2 py-1" onClick={() => setPendingConnection(null)}>✕</button></div>}
        {viewMode === 'canvas' ? <ConnectionContext.Provider value={{ pendingConnection, onPortTap, onDeleteNode: deleteNode, onDeleteEdge: deleteEdge, onOpenTutorial: setTutorialManifest, canConnectToInput }}><ReactFlow nodes={nodes} edges={edges} deleteKeyCode={null} onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange} onConnect={onConnect} isValidConnection={isValidConnection} onInit={(instance) => { reactFlowInstanceRef.current = instance; fitCanvasWithResettle(); }} onNodeClick={handleCanvasNodeClick} onPaneClick={handleCanvasPaneClick} nodeTypes={{ pipelineNode: PipelineNode }} edgeTypes={edgeTypes}><Background /><MiniMap pannable zoomable nodeColor={(node) => stageStyles[stageForManifest(node.data.manifest)].hex} /><Controls /></ReactFlow></ConnectionContext.Provider> : <ArchitectureView nodes={nodes} edges={edges} onSelect={setSelectedId} t={t} />}
      </section>

      <motion.aside initial={false} animate={{ x: rightOpen ? 0 : '110%' }} style={{ width: `min(${rightWidth}px, calc(100vw - 24px))` }} className={`${asideBase} right-3 lg:transform-none ${rightOpen ? 'lg:block' : 'lg:hidden'}`}>
        <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-black">{t('parameters.title')}</h2><button aria-label={t('common.close')} className="rounded-lg p-2 hover:bg-slate-100" onClick={() => setRightOpen(false)}>✕</button></div>
        <label className="mt-3 block text-xs font-bold text-slate-500">{t('project.name')}<input value={projectName} onChange={(event) => setProjectName(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-500" /></label>
        <label className="mt-3 flex items-center gap-3 text-xs text-slate-500"><span>{t('common.width')}</span><input type="range" min={RIGHT_PANEL_MIN} max={RIGHT_PANEL_MAX} value={RIGHT_PANEL_MIN + RIGHT_PANEL_MAX - rightWidth} aria-valuetext={`${rightWidth}px`} onChange={(event) => setRightWidth(RIGHT_PANEL_MIN + RIGHT_PANEL_MAX - Number(event.target.value))} className="min-w-0 flex-1 accent-blue-600" /><span>{rightWidth}px</span></label>
        {selectedNode ? <div className="mt-4 space-y-5"><div className="rounded-2xl bg-blue-50 p-4"><p className="text-xs font-bold uppercase text-blue-600">{t(`category.${selectedNode.data.manifest.category}`)}</p><h3 className="break-words text-xl font-black text-slate-900">{t(selectedNode.data.label)}</h3><div className="mt-2 flex gap-2 text-[10px] font-bold uppercase"><span className="rounded-full bg-slate-900 px-2 py-1 text-white">{t('framework.pytorch')}: {t(`compatibility.${selectedNode.data.manifest.compatibility?.pytorch ?? 'unsupported'}`)}</span><span className="rounded-full bg-orange-100 px-2 py-1 text-orange-700">{t('framework.tensorflow')}: {t(`compatibility.${selectedNode.data.manifest.compatibility?.tensorflow ?? 'unsupported'}`)}</span></div></div>{selectedNode.data.manifest.properties.map((property) => <label key={property.key} className="block rounded-2xl border border-slate-200 bg-white p-4"><span className="block break-words text-sm font-bold text-slate-800">{t(property.label)}</span><PropertyControl property={property} value={selectedNode.data.parameters[property.key]} onChange={(value) => updateParameter(property.key, value)} /></label>)}{selectedNode.data.manifest.composition && <button onClick={expandSelectedComposite} className="w-full rounded-2xl bg-violet-600 px-4 py-3 font-bold text-white shadow-lg">{t('component.expand')}</button>}{selectedNode.data.compositeOrigin && <button onClick={collapseSelectedComposite} className="w-full rounded-2xl bg-violet-100 px-4 py-3 font-bold text-violet-700">{t('component.collapse')}</button>}<div className="grid grid-cols-2 gap-2"><button onClick={() => exportCode('pytorch')} className="rounded-2xl bg-slate-950 px-3 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-blue-700">{t('compiler.exportPyTorch')}</button><button onClick={() => exportCode('tensorflow')} className="rounded-2xl bg-orange-500 px-3 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-orange-600">{t('compiler.exportTensorFlow')}</button><button data-testid="compiler-export-source-map-pytorch" onClick={() => exportSourceMap('pytorch')} className="rounded-2xl bg-indigo-100 px-3 py-3 text-sm font-bold text-indigo-800 shadow transition hover:bg-indigo-200">{t('compiler.exportSourceMap', { framework: t('framework.pytorch') })}</button><button data-testid="compiler-export-source-map-tensorflow" onClick={() => exportSourceMap('tensorflow')} className="rounded-2xl bg-indigo-100 px-3 py-3 text-sm font-bold text-indigo-800 shadow transition hover:bg-indigo-200">{t('compiler.exportSourceMap', { framework: t('framework.tensorflow') })}</button></div></div> : <p className="mt-6 text-sm text-slate-500">{t('parameters.empty')}</p>}
        <div className="absolute bottom-8 left-0 top-8 hidden w-2 cursor-col-resize touch-none lg:block" onPointerDown={(event) => startResize('right', event)} />
      </motion.aside>
    </main>
    </>}
    {notice && <button onClick={() => setNotice('')} className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-2xl">{notice} · ✕</button>}
    {restoreCandidate && surface === UI_SURFACES.BUILD && <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 p-4"><section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><h2 className="text-xl font-black">{t('project.restoreTitle')}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{t('project.restoreDescription')}</p><p className="mt-3 rounded-xl bg-slate-100 p-3 font-bold">{restoreCandidate.name || t('project.sampleName')}</p><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={() => { applyProject(restoreCandidate); setRestoreCandidate(null); setLocalReady(true); }} className="rounded-2xl bg-blue-600 px-4 py-3 font-bold text-white">{t('project.restore')}</button><button onClick={() => { platformServices.projects.remove().finally(() => { setRestoreCandidate(null); setLocalReady(true); }); }} className="rounded-2xl bg-slate-100 px-4 py-3 font-bold text-slate-700">{t('project.startFresh')}</button></div></section></div>}
    {pendingDeletion && <DeletionConfirmDialog summary={deletionSummary({ nodes, edges, pendingDeletion })} onCancel={() => setPendingDeletion(null)} onConfirm={confirmDeletion} t={t} />}
    <LanguageDialog open={languageOpen} onClose={() => setLanguageOpen(false)} />
    <DataDialog open={dataOpen} onClose={() => setDataOpen(false)} dataset={dataset} onDataset={(nextDataset) => { setDataset(nextDataset); setModel(null); }} />
    <RunnerDialog open={runnerOpen} onClose={() => setRunnerOpen(false)} nodes={nodes} edges={edges} customComponents={customComponents} dataset={dataset} model={model} runtime={runtime} resultBinding={resultBindingRef.current} runHistory={runHistory} language={primary} onSelectLumiSuggestion={handleLumiResultSuggestion} onRun={runBrowserGraph} onRunWebGpuTraining={() => runBrowserGraph({ providerId: 'browser-webgpu-mlp-training' })} onCancelRun={cancelBrowserExecution} onWebGpuInference={runWebGpuInference} onCancelWebGpuInference={cancelWebGpuInference} onValidation={handleRunnerValidation} onOpenData={() => setDataOpen(true)} onExport={exportCode} />
    <CompositeDialog open={compositeOpen} selectedCount={selectedNodes.length} onClose={() => setCompositeOpen(false)} onCreate={createCompositeFromSelection} t={t} />
    <ExamplesDialog open={examplesOpen} onClose={() => setExamplesOpen(false)} onLoad={(project) => { applyProject(project, { languagePolicy: 'preserve-current' }); setExamplesOpen(false); setNotice(t('examples.loaded')); }} t={t} />
    {explanationOpen && <Suspense fallback={<div className="fixed inset-0 z-[75] grid place-items-center bg-slate-950/55 p-4"><div className="rounded-2xl bg-white px-5 py-4 font-bold text-slate-700 shadow-2xl">{t('agent.thinking')}</div></div>}><ExplanationDialog open nodes={nodes} edges={edges} customComponents={customComponents} dataset={dataset} model={model} runtime={runtime} resultBinding={resultBindingRef.current} language={primary} onClose={() => setExplanationOpen(false)} t={t} /></Suspense>}
    <AiSettingsDialog t={t} />
    <AccountDialog t={t} open={accountOpen} onClose={() => setAccountOpen(false)} />
    {tutorialManifest && <Suspense fallback={<div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/55 p-4"><div className="rounded-2xl bg-white px-5 py-4 font-bold text-slate-700 shadow-2xl">{t('tutorial.loading')}</div></div>}><TutorialDialog manifest={tutorialManifest} dataset={dataset} onOpenPlayground={(id) => openExplorePlayground(id)} onClose={() => setTutorialManifest(null)} t={t} /></Suspense>}
    {exploreRecovery && <div className="fixed inset-0 z-[85] grid place-items-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="explore-recovery-title"><section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><h2 id="explore-recovery-title" className="text-xl font-black">{t('explore.workspace.recoveryTitle')}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{t('explore.workspace.recoveryBody')}</p><div className="mt-5 grid gap-2 sm:grid-cols-2"><button type="button" className="rounded-2xl bg-blue-600 px-4 py-3 font-bold text-white" onClick={async () => { try { await exploreRecovery.host.restartBigIdeaEntrance({ id: exploreRecovery.id }); setExploreWorkspaceKey(exploreRecovery.key); setPlaygroundId(exploreRecovery.expected.playgroundId); setPlaygroundInitialTab(exploreRecovery.expected.playgroundId === 'data-lab' ? 'data' : 'model'); setExploreRecovery(null); setPlaygroundOpen(true); } catch (error) { setNotice(translateError(error, t)); } }}>{t('explore.workspace.restore')}</button><button type="button" className="rounded-2xl bg-slate-100 px-4 py-3 font-bold text-slate-700" onClick={() => setExploreRecovery(null)}>{t('common.close')}</button></div></section></div>}
    <PlaygroundDialog open={playgroundOpen} playgroundId={playgroundId} initialTab={playgroundInitialTab} host={activeExploreHost} agent={activeExploreAgent} developmentMatrixDriver={developmentMatrixDriver} preserveSession={activeExploreWorkspace?.record.lifecycle === EXPLORE_WORKSPACE_LIFECYCLES.PERSISTENT} strictOpen onClose={closeExploreWorkspace} t={t} />
    <ImportedAttentionExperience key={g2ProjectSession} open={g2AttentionOpen} onClose={() => { setG2AttentionOpen(false); setG2AnchorNodeId(null); setG2AnchorProjectSessionId(null); }} onClearBinding={() => { setG2AnchorNodeId(null); setG2AnchorProjectSessionId(null); }} projectSessionId={projectSessionIdRef.current} localModelReference={localModelReferences[0] ?? null} onModelBound={(reference) => setLocalModelReferences([reference])} bindingAnchorNodeId={g2AnchorNodeId} bindingProjectSessionId={g2AnchorProjectSessionId} selectedNodeId={selectedNode?.id ?? null} buildGraph={g2BuildGraph} t={t} />
    <ExploreCapacityBridgeDialog
      open={surface === UI_SURFACES.BUILD && exploreCapacityBridgeOpen}
      session={exploreCapacityBridge}
      build={{ nodes, edges, dataset, customComponents }}
      projectSessionId={projectSessionIdRef.current}
      onClose={closeExploreCapacityBridge}
      onUseInProject={useExploreCapacityInProject}
      onStartNew={() => {
        const selectedNodeId = exploreCapacityBridgeRef.current?.getSnapshot().selectedHiddenNode?.nodeId;
        openExploreCapacityBridge(selectedNodeId, { newSession: true, requireSelection: false });
      }}
      t={t}
    />
    {surface === UI_SURFACES.BUILD && <LumiBuildIntentDialog open={lumiBuildIntentOpen} onClose={() => setLumiBuildIntentOpen(false)} nodes={nodes} edges={edges} dataset={dataset} t={t} />}
    {surface === UI_SURFACES.BUILD && <LumiGraphEditDialog open={lumiGraphEditOpen} initialRequest={lumiGraphEditSeed} onClose={() => { setLumiGraphEditOpen(false); setLumiGraphEditSeed(''); }} nodes={nodes} edges={edges} customComponents={customComponents} language={primary} hasStagedProposal={Boolean(stagedGraphProposal)} t={t} />}
    <DirectorPrototype open={directorOpen} onClose={() => setDirectorOpen(false)} onStartExploration={openPhaseAHandoff} t={t} />
    {surface === UI_SURFACES.BUILD && stagedGraphProposal?.type === GRAPH_PATCH_PROPOSAL_TYPE && <GraphPatchPreview proposal={stagedGraphProposal} exploreToBuildProposal={stagedExploreToBuild?.proposal ?? null} applyEligibility={graphApplyEligibilityForPreview} onCancel={cancelGraphProposalPreview} onApply={applyStagedGraphProposal} t={t} />}
    {surface === UI_SURFACES.BUILD && stagedGraphProposal && stagedGraphProposal.type !== GRAPH_PATCH_PROPOSAL_TYPE && <GraphProposalPreview proposal={stagedGraphProposal} applyEligibility={graphApplyEligibilityForPreview} onCancel={cancelGraphProposalPreview} onApply={applyStagedGraphProposal} t={t} />}
    {surface === UI_SURFACES.BUILD && GraphApplyTestBridgeComponent && <GraphApplyTestBridgeComponent />}
  </div></WorkspaceGraphProposalContext.Provider>;
}

createRoot(document.getElementById('root')).render(<LanguageProvider><VolkCloudProvider><AiProvider><Workspace /></AiProvider></VolkCloudProvider></LanguageProvider>);

