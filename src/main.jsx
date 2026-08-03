import React, { Suspense, createContext, lazy, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MiniMap, Position, addEdge, getSmoothStepPath, useEdgesState, useNodesState } from '@xyflow/react';
import { motion } from 'framer-motion';
import '@xyflow/react/dist/style.css';
import { languages, localizedError, resolveMessage, translateError } from './i18n';
import { componentById, defaults, expandComposite, pluginRegistry } from './core/components';
import { executeBrowserGraph, predictWithModel } from './core/browserRuntime';
import { compilePipelineToPyTorch, compilePipelineToTensorFlow, graphToIR } from './core/compiler';
import { PROJECT_VERSION, projectContentSignature, validateProjectForWorkspace } from './core/project';
import { safeProjectFilename } from './core/localProjects';
import { createCustomComposite } from './core/customComposites';
import { assessConnection } from './core/connections';
import { estimateExecutionPlan, executionTiers } from './core/runtimeTiers';
import { stageForManifest, stageStyles, visualKindForManifest } from './core/visualLanguage';
import { resolvePlatformServices } from './platform/services';
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
import ArchitectureView from './components/ArchitectureView';
import ComponentLibrary from './components/ComponentLibrary';
import CompositeDialog from './components/CompositeDialog';
import VisualGlyph from './components/VisualGlyph';

const TutorialDialog = lazy(() => import('./components/TutorialDialog'));
const ExplanationDialog = lazy(() => import('./components/ExplanationDialog'));

const LANGUAGE_STORAGE_KEY = 'volk-ml-language-settings';
const platformServices = resolvePlatformServices();

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
    return second && second !== first ? `${first} 路 ${second}` : first;
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

const createNode = (manifest, index) => ({
  id: `${manifest.id}-${crypto.randomUUID()}`,
  type: 'pipelineNode',
  position: { x: 120 + index * 110, y: 90 + index * 90 },
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
  };
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

const idleRuntimeState = () => ({
  status: 'idle',
  activeNodeIds: [],
  losses: [],
  result: null,
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
      return <button key={input.name} title={`${t('common.input')}: ${readablePortType(input.type, t)}`} onClick={(event) => { event.stopPropagation(); onPortTap({ direction: 'input', nodeId: id, port: input }); }} className={`nodrag nopan rounded-full border px-3 py-2 text-xs font-bold transition ${pendingConnection ? compatible ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-400' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>鈼€ {input.name} 路 {readablePortType(input.type, t)}</button>;
    })}</div>}
    <div className="flex flex-wrap items-center justify-between gap-2"><p className={`text-xs font-semibold uppercase tracking-wide ${stageStyle.text}`}>{t(`category.${data.manifest.category}`)}</p><div className="flex items-center gap-1">{data.manifest.kind === 'composite' && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">{t('component.composite')}</span>}{data.status && data.status !== 'idle' && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${data.status === 'success' ? 'bg-emerald-100 text-emerald-700' : data.status === 'running' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{t(`status.${data.status}`)}</span>}{!data.manifest.customComposite && <button aria-label={t('tutorial.learn')} title={t('tutorial.learn')} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onOpenTutorial(data.manifest); }} className="nodrag nopan grid h-10 w-10 place-items-center rounded-full bg-blue-50 text-sm font-black text-blue-700 hover:bg-blue-100">?</button>}<button aria-label={t('component.delete')} title={t('component.delete')} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onDeleteNode(id); }} className="nodrag nopan grid h-10 w-10 place-items-center rounded-full bg-red-50 text-sm font-bold text-red-600 hover:bg-red-100">鈱?/button></div></div>
    <h3 className="mt-1 break-words text-base font-bold text-slate-900">{t(data.label)}</h3>
    <p className="mt-2 break-words text-sm text-slate-600">{t(data.manifest.description)}</p>
    <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">{t('framework.pytorch')} {t(`compatibility.${data.manifest.compatibility?.pytorch ?? 'unsupported'}`)} 路 {t('framework.tensorflow')} {t(`compatibility.${data.manifest.compatibility?.tensorflow ?? 'unsupported'}`)}</p>
    <div className="mt-3 flex flex-wrap gap-1 text-[11px] text-slate-500">{data.manifest.outputs.map((output) => {
      const active = pendingConnection?.nodeId === id && pendingConnection?.port.name === output.name;
      return <button key={output.name} title={`${t('common.output')}: ${readablePortType(output.type, t)}`} onClick={(event) => { event.stopPropagation(); onPortTap({ direction: 'output', nodeId: id, port: output }); }} className={`nodrag nopan rounded-full border px-3 py-2 text-left text-xs font-bold transition ${active ? 'border-amber-400 bg-amber-100 text-amber-800 ring-2 ring-amber-200' : 'border-slate-200 bg-slate-100 hover:border-blue-400'}`}>{output.name} 路 {readablePortType(output.type, t)} 鈻?/button>;
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
      >鈱?/button>
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

function describeRows(rows) {
  if (!rows.length || typeof rows[0] !== 'object' || Array.isArray(rows[0])) throw localizedError('error.objectRows');
  const names = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return names.map((name) => {
    const present = rows.map((row) => row[name]).filter((value) => value !== '' && value !== null && value !== undefined);
    const numericCount = present.filter((value) => Number.isFinite(Number(value))).length;
    return { name, type: present.length > 0 && numericCount === present.length ? 'number' : 'text', missing: rows.length - present.length };
  });
}

function makeSampleDataset() {
  const rows = Array.from({ length: 100 }, (_, index) => {
    const studyHours = 1 + (index % 20) * 0.45;
    const practiceTests = (index * 7) % 11;
    const score = 35 + studyHours * 4.8 + practiceTests * 1.7 + Math.sin(index * 1.9) * 2;
    return { study_hours: Number(studyHours.toFixed(2)), practice_tests: practiceTests, exam_score: Number(score.toFixed(2)) };
  });
  return { name: 'exam_scores_sample', rows, columns: describeRows(rows), featureColumns: ['study_hours', 'practice_tests'], targetColumn: 'exam_score', task: 'regression', trainRatio: 0.8 };
}

function makeClassificationSampleDataset() {
  const labels = ['setosa', 'versicolor', 'virginica'];
  const rows = Array.from({ length: 90 }, (_, index) => {
    const group = index % labels.length;
    const offset = Math.floor(index / labels.length);
    return {
      sepal_length: Number((4.8 + group * 0.9 + Math.sin(offset) * 0.18).toFixed(2)),
      sepal_width: Number((3.5 - group * 0.35 + Math.cos(offset * 1.3) * 0.12).toFixed(2)),
      petal_length: Number((1.4 + group * 2.05 + Math.sin(offset * 0.7) * 0.2).toFixed(2)),
      species: labels[group],
    };
  });
  return {
    name: 'flower_classification_sample',
    rows,
    columns: describeRows(rows),
    featureColumns: ['sepal_length', 'sepal_width', 'petal_length'],
    targetColumn: 'species',
    task: 'classification',
    trainRatio: 0.8,
  };
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
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-black">{t('data.title')}</h2><p className="mt-1 text-sm text-slate-500">{t('data.privacy')}</p></div><button aria-label={t('common.close')} className="rounded-full p-2 hover:bg-slate-100" onClick={onClose}>鉁?/button></div>
      <div className="mt-5 flex flex-wrap gap-2"><button onClick={() => fileRef.current?.click()} className="rounded-xl bg-blue-600 px-4 py-2 font-bold text-white">鈫?{t('data.up…11384 tokens truncated…back(async (edgeId) => {
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
  useEffect(() => {
    const forward = (method) => (...args) => agentAdapterRef.current[method](...args);
    const api = createCanvasAgentApi({
      instanceId: instanceIdRef.current,
      getState: forward('getState'),
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
      (side === 'left' ? setLeftWidth : setRightWidth)(Math.min(side === 'left' ? 520 : 640, Math.max(side === 'left' ? 220 : 260, next)));
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const asideBase = 'fixed bottom-3 top-[76px] z-30 overflow-auto rounded-3xl border border-white/80 bg-white/95 p-4 shadow-2xl backdrop-blur transition-transform lg:static lg:z-auto lg:h-auto lg:rounded-3xl lg:bg-white/85 lg:shadow-xl';
  return <div className="flex h-[100dvh] flex-col overflow-hidden bg-gradient-to-br from-sky-50 via-white to-indigo-100">
    <header className="z-40 flex min-h-[64px] items-center justify-between gap-3 border-b border-white/70 bg-white/90 px-3 py-2 shadow-sm backdrop-blur sm:px-5">
      <div className="flex min-w-0 items-center gap-3"><div className="shrink-0"><h1 className="text-xl font-black text-slate-950 sm:text-2xl">VOLK-ML</h1><p className="hidden truncate text-xs text-slate-600 xl:block">{t('app.tagline')}</p></div><label className="hidden min-w-0 md:block"><span className="sr-only">{t('project.name')}</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} className="w-44 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-blue-500 lg:w-56" /><span className="mt-0.5 block text-[10px] text-slate-400">{autosavedAt ? t('project.autosaved') : t('project.unsaved')}</span></label></div>
      <nav className="flex items-center gap-1.5 overflow-x-auto text-sm">
        <button className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={() => setLeftOpen((value) => !value)}>鈽?<span className="hidden sm:inline">{t('nav.blocks')}</span></button>
        <button className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={() => setRightOpen((value) => !value)}>鈿?<span className="hidden sm:inline">{t('nav.parameters')}</span></button>
        <button className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={() => setViewMode((value) => value === 'canvas' ? 'architecture' : 'canvas')}>{viewMode === 'canvas' ? '鈱? : '鈱?} <span className="hidden lg:inline">{t(`nav.${viewMode === 'canvas' ? 'architecture' : 'canvas'}`)}</span></button>
        <button className="rounded-xl bg-violet-100 px-3 py-2 font-bold text-violet-700" onClick={() => setExplanationOpen(true)}>鉁?<span className="hidden xl:inline">{t('nav.explain')}</span></button>
        <button disabled={selectedNodes.length < 2} className="rounded-xl bg-blue-100 px-3 py-2 font-bold text-blue-700 disabled:opacity-40" onClick={() => setCompositeOpen(true)}>鈻?<span className="hidden xl:inline">{t('nav.group')}</span></button>
        <button className={`rounded-xl px-3 py-2 font-bold ${dataset ? 'bg-blue-100 text-blue-700' : 'bg-slate-100'}`} onClick={() => setDataOpen(true)}>鈻?<span className="hidden sm:inline">{t('nav.data')}</span></button>
        <button className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={exportProject}>鈫?<span className="hidden md:inline">JSON</span></button>
        <button className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={() => importRef.current?.click()}>鈫?<span className="hidden md:inline">{t('nav.import')}</span></button>
        <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={importProject} />
        <button className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={() => setLanguageOpen(true)}>鏂?/button>
        <button className="rounded-xl bg-emerald-600 px-3 py-2 font-bold text-white" onClick={() => setRunnerOpen(true)}>鈻?<span className="hidden sm:inline">{t('nav.run')}</span></button>
      </nav>
    </header>

    <main className="relative grid min-h-0 flex-1 grid-cols-[0_minmax(0,1fr)_0] gap-3 p-3 lg:grid-cols-[var(--left-panel)_minmax(0,1fr)_var(--right-panel)]" style={{ '--left-panel': `${leftOpen ? leftWidth : 0}px`, '--right-panel': `${rightOpen ? rightWidth : 0}px` }}>
      <motion.aside initial={false} animate={{ x: leftOpen ? 0 : '-110%' }} style={{ width: `min(${leftWidth}px, calc(100vw - 24px))` }} className={`${asideBase} left-3 lg:transform-none ${leftOpen ? 'lg:block' : 'lg:hidden'}`}>
        <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-black">{t('library.title')}</h2><button aria-label={t('common.close')} className="rounded-lg p-2 hover:bg-slate-100" onClick={() => setLeftOpen(false)}>鉁?/button></div>
        <div className="mt-3 flex gap-2"><div className="relative min-w-0 flex-1"><span className="absolute left-3 top-2.5">鈱?/span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('library.search')} className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500" /></div><button className="rounded-xl border px-3 text-sm font-bold" onClick={() => setLibraryMode((mode) => mode === 'compact' ? 'detailed' : 'compact')}>{libraryMode === 'compact' ? '鈽? : '鈮?}</button></div>
        <label className="mt-3 flex items-center gap-3 text-xs text-slate-500"><span>{t('common.width')}</span><input type="range" min="220" max="520" value={leftWidth} onChange={(event) => setLeftWidth(Number(event.target.value))} className="min-w-0 flex-1 accent-blue-600" /><span>{leftWidth}px</span></label>
        <p className="mt-2 text-xs text-slate-400">{t('library.summary', { count: filteredPlugins.length, mode: `library.${libraryMode}` })}</p>
        <ComponentLibrary plugins={filteredPlugins} query={query} mode={libraryMode} onAdd={addPluginNode} onTutorial={setTutorialManifest} onDeleteCustom={deleteCustomComponent} t={t} />
        <div className="absolute bottom-8 right-0 top-8 hidden w-2 cursor-col-resize touch-none lg:block" onPointerDown={(event) => startResize('left', event)} />
      </motion.aside>

      <section className="relative col-start-2 overflow-hidden rounded-3xl border border-white/80 bg-white shadow-xl">
        {pendingConnection && <div className="absolute left-1/2 top-3 z-20 flex max-w-[calc(100%_-_24px)] -translate-x-1/2 items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-xs font-bold text-white shadow-xl"><span className="truncate">{pendingConnection.port.name} 路 {readablePortType(pendingConnection.type, t)} 鈫?{t('connection.tapMatching')}</span><button aria-label={t('common.close')} className="nodrag rounded-full bg-white/20 px-2 py-1" onClick={() => setPendingConnection(null)}>鉁?/button></div>}
        {viewMode === 'canvas' ? <ConnectionContext.Provider value={{ pendingConnection, onPortTap, onDeleteNode: deleteNode, onDeleteEdge: deleteEdge, onOpenTutorial: setTutorialManifest, canConnectToInput }}><ReactFlow nodes={nodes} edges={edges} onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange} onConnect={onConnect} isValidConnection={isValidConnection} onNodeClick={(_, node) => setSelectedId(node.id)} nodeTypes={{ pipelineNode: PipelineNode }} edgeTypes={edgeTypes} fitView><Background /><MiniMap pannable zoomable nodeColor={(node) => stageStyles[stageForManifest(node.data.manifest)].hex} /><Controls /></ReactFlow></ConnectionContext.Provider> : <ArchitectureView nodes={nodes} edges={edges} onSelect={setSelectedId} t={t} />}
      </section>

      <motion.aside initial={false} animate={{ x: rightOpen ? 0 : '110%' }} style={{ width: `min(${rightWidth}px, calc(100vw - 24px))` }} className={`${asideBase} right-3 lg:transform-none ${rightOpen ? 'lg:block' : 'lg:hidden'}`}>
        <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-black">{t('parameters.title')}</h2><button aria-label={t('common.close')} className="rounded-lg p-2 hover:bg-slate-100" onClick={() => setRightOpen(false)}>鉁?/button></div>
        <label className="mt-3 block text-xs font-bold text-slate-500">{t('project.name')}<input value={projectName} onChange={(event) => setProjectName(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-500" /></label>
        <label className="mt-3 flex items-center gap-3 text-xs text-slate-500"><span>{t('common.width')}</span><input type="range" min="260" max="640" value={rightWidth} onChange={(event) => setRightWidth(Number(event.target.value))} className="min-w-0 flex-1 accent-blue-600" /><span>{rightWidth}px</span></label>
        {selectedNode ? <div className="mt-4 space-y-5"><div className="rounded-2xl bg-blue-50 p-4"><p className="text-xs font-bold uppercase text-blue-600">{t(`category.${selectedNode.data.manifest.category}`)}</p><h3 className="break-words text-xl font-black text-slate-900">{t(selectedNode.data.label)}</h3><div className="mt-2 flex gap-2 text-[10px] font-bold uppercase"><span className="rounded-full bg-slate-900 px-2 py-1 text-white">{t('framework.pytorch')}: {t(`compatibility.${selectedNode.data.manifest.compatibility?.pytorch ?? 'unsupported'}`)}</span><span className="rounded-full bg-orange-100 px-2 py-1 text-orange-700">{t('framework.tensorflow')}: {t(`compatibility.${selectedNode.data.manifest.compatibility?.tensorflow ?? 'unsupported'}`)}</span></div></div>{selectedNode.data.manifest.properties.map((property) => <label key={property.key} className="block rounded-2xl border border-slate-200 bg-white p-4"><span className="block break-words text-sm font-bold text-slate-800">{t(property.label)}</span><PropertyControl property={property} value={selectedNode.data.parameters[property.key]} onChange={(value) => updateParameter(property.key, value)} /></label>)}{selectedNode.data.manifest.composition && <button onClick={expandSelectedComposite} className="w-full rounded-2xl bg-violet-600 px-4 py-3 font-bold text-white shadow-lg">{t('component.expand')}</button>}{selectedNode.data.compositeOrigin && <button onClick={collapseSelectedComposite} className="w-full rounded-2xl bg-violet-100 px-4 py-3 font-bold text-violet-700">{t('component.collapse')}</button>}<div className="grid grid-cols-2 gap-2"><button onClick={() => exportCode('pytorch')} className="rounded-2xl bg-slate-950 px-3 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-blue-700">{t('compiler.exportPyTorch')}</button><button onClick={() => exportCode('tensorflow')} className="rounded-2xl bg-orange-500 px-3 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-orange-600">{t('compiler.exportTensorFlow')}</button></div></div> : <p className="mt-6 text-sm text-slate-500">{t('parameters.empty')}</p>}
        <div className="absolute bottom-8 left-0 top-8 hidden w-2 cursor-col-resize touch-none lg:block" onPointerDown={(event) => startResize('right', event)} />
      </motion.aside>
    </main>
    {notice && <button onClick={() => setNotice('')} className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-2xl">{notice} 路 鉁?/button>}
    {restoreCandidate && <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 p-4"><section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><h2 className="text-xl font-black">{t('project.restoreTitle')}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{t('project.restoreDescription')}</p><p className="mt-3 rounded-xl bg-slate-100 p-3 font-bold">{restoreCandidate.name || t('project.sampleName')}</p><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={() => { applyProject(restoreCandidate); setRestoreCandidate(null); setLocalReady(true); }} className="rounded-2xl bg-blue-600 px-4 py-3 font-bold text-white">{t('project.restore')}</button><button onClick={() => { platformServices.projects.remove().finally(() => { setRestoreCandidate(null); setLocalReady(true); }); }} className="rounded-2xl bg-slate-100 px-4 py-3 font-bold text-slate-700">{t('project.startFresh')}</button></div></section></div>}
    <LanguageDialog open={languageOpen} onClose={() => setLanguageOpen(false)} />
    <DataDialog open={dataOpen} onClose={() => setDataOpen(false)} dataset={dataset} onDataset={(nextDataset) => { setDataset(nextDataset); setModel(null); }} />
    <RunnerDialog open={runnerOpen} onClose={() => setRunnerOpen(false)} nodes={nodes} edges={edges} dataset={dataset} model={model} runtime={runtime} onRun={runBrowserGraph} onOpenData={() => setDataOpen(true)} onExport={exportCode} />
    <CompositeDialog open={compositeOpen} selectedCount={selectedNodes.length} onClose={() => setCompositeOpen(false)} onCreate={createCompositeFromSelection} t={t} />
    {explanationOpen && <Suspense fallback={<div className="fixed inset-0 z-[75] grid place-items-center bg-slate-950/55 p-4"><div className="rounded-2xl bg-white px-5 py-4 font-bold text-slate-700 shadow-2xl">{t('agent.thinking')}</div></div>}><ExplanationDialog open nodes={nodes} edges={edges} language={primary} onClose={() => setExplanationOpen(false)} t={t} /></Suspense>}
    {tutorialManifest && <Suspense fallback={<div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/55 p-4"><div className="rounded-2xl bg-white px-5 py-4 font-bold text-slate-700 shadow-2xl">{t('tutorial.loading')}</div></div>}><TutorialDialog manifest={tutorialManifest} dataset={dataset} onClose={() => setTutorialManifest(null)} t={t} /></Suspense>}
  </div>;
}

createRoot(document.getElementById('root')).render(<LanguageProvider><Workspace /></LanguageProvider>);

