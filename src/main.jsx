import React, { Suspense, createContext, lazy, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MiniMap, Position, addEdge, getNodesBounds, getSmoothStepPath, useEdgesState, useNodesState } from '@xyflow/react';
import { motion } from 'framer-motion';
import '@xyflow/react/dist/style.css';
import { languages, localizedError, resolveMessage, translateError } from './i18n';
import { componentById, defaults, expandComposite, pluginRegistry } from './core/components';
import { describeRows, sampleDatasets } from './core/sampleDatasets';
import { executeBrowserGraph, predictWithModel } from './core/browserRuntime';
import { analyzeBrowserExecutionGraph } from './core/browserExecutionContract';
import { compilePipelineToPyTorch, compilePipelineToTensorFlow, graphToIR } from './core/compiler';
import { PROJECT_VERSION, projectContentSignature, validateProjectForWorkspace } from './core/project';
import { safeProjectFilename } from './core/localProjects';
import { createCustomComposite, rebuildCompositeInstance } from './core/customComposites';
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
import { createPlaygroundAgentApi } from './core/playgroundAgent';
import { createPlaygroundHost } from './core/playgroundHost';
import { getBigIdeaEntrance } from './core/exploration/bigIdeaRegistry.js';
import { UI_SURFACES } from './core/ui/uiArchitecture.js';
import { createBuildPanelPresentation, toggleBuildPanel } from './core/ui/buildSurfacePresentation.js';
import { createDeletionRequest, deletionSummary } from './core/deletionConfirmation.js';
import ArchitectureView from './components/ArchitectureView';
import ComponentLibrary from './components/ComponentLibrary';
import CompositeDialog from './components/CompositeDialog';
import DeletionConfirmDialog from './components/DeletionConfirmDialog.jsx';
import ExamplesDialog from './components/ExamplesDialog';
import { resolveLanguagePreference } from './core/languagePolicy.js';
import PlaygroundDialog from './components/playgrounds/PlaygroundDialog';
import VisualGlyph from './components/VisualGlyph';
import AiSettingsDialog from './components/AiSettingsDialog.jsx';
import ExploreHome from './components/ExploreHome.jsx';
import BuildToolbar from './components/BuildToolbar.jsx';
import { AiProvider, useAiProvider } from './components/ai/AiProviderContext.jsx';

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

function RunnerDialog({ open, onClose, nodes, edges, dataset, model, runtime, onRun, onValidation, onOpenData, onExport }) {
  const { t } = useVividTranslation();
  const [inputs, setInputs] = useState({});
  const [prediction, setPrediction] = useState(null);
  const [graphError, setGraphError] = useState('');
  const [planNames, setPlanNames] = useState([]);
  const graphSignature = useMemo(() => JSON.stringify({
    nodes: nodes.map((node) => ({ id: node.id, manifestId: node.data.manifest.id, parameters: node.data.parameters })),
    edges: edges.map((edge) => ({ source: edge.source, sourceHandle: edge.sourceHandle, target: edge.target, targetHandle: edge.targetHandle })),
  }), [nodes, edges]);
  // Always derive cards from current props so a Run-triggered render cannot
  // retain stale workload values.
  const executionPlan = executionPlanFor(nodes, edges, dataset);
  const needsDataset = useMemo(() => {
    const connectedIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
    return nodes.some(
      (node) => connectedIds.has(node.id) && node.data.manifest.op === 'tabular_data',
    );
  }, [graphSignature]);
  useEffect(() => {
    if (open) {
      setPrediction(null);
      setGraphError('');
      try {
        const connectedIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
        const connectedNodes = nodes.filter((node) => connectedIds.has(node.id));
        const connectedEdges = edges.filter(
          (edge) => connectedIds.has(edge.source) && connectedIds.has(edge.target),
        );
        const contract = analyzeBrowserExecutionGraph({ nodes, edges, dataset });
        if (!contract.valid) {
          onValidation(contract.nodeIds ?? []);
          const error = localizedError(contract.reason, contract.translationParams);
          error.nodeIds = contract.nodeIds;
          throw error;
        }
        const ir = graphToIR(connectedNodes, connectedEdges);
        const nodeById = new Map(connectedNodes.map((node) => [node.id, node]));
        setPlanNames(ir.nodes.filter((node) => edges.some((edge) => edge.source === node.id || edge.target === node.id)).map((node) => t(nodeById.get(node.id).data.manifest.name)));
      }
      catch (error) { setPlanNames([]); setGraphError(translateError(error, t)); }
    }
  }, [open, graphSignature, dataset, onValidation, t]);
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

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={onClose}>
    <section className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-black">{t('runner.title')}</h2><p className="mt-1 text-sm text-slate-500">{t('runner.description')}</p></div><button aria-label={t('common.close')} className="rounded-full p-2 hover:bg-slate-100" onClick={onClose}>✕</button></div>
      {planNames.length > 0 && <div className="mt-4 flex flex-wrap items-center gap-1 text-xs">{planNames.map((name, index) => <React.Fragment key={`${name}-${index}`}><span className="rounded-full bg-slate-100 px-2 py-1 font-bold">{name}</span>{index < planNames.length - 1 && <span className="text-slate-300">→</span>}</React.Fragment>)}</div>}
      <TierPanel plan={executionPlan} onExport={onExport} />
      {visibleError && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">⚠ {visibleError}</div>}
      {needsDataset && !dataset ? <div className="mt-6 rounded-3xl border-2 border-dashed p-10 text-center"><p className="text-slate-500">{t('runner.datasetRequired')}</p><button onClick={() => { onClose(); onOpenData(); }} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 font-bold text-white">{t('runner.openData')}</button></div> : executionPlan.canRunHere ? <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div><div className="rounded-2xl bg-slate-50 p-4"><p className="font-black">{dataset?.name ?? t('runner.browserGraph')}</p><p className="mt-1 text-xs text-slate-500">{dataset ? `${dataset.featureColumns.join(', ')} → ${dataset.targetColumn}` : t('runner.noDatasetRequired')}</p></div><div className="mt-4"><LossChart values={losses} /></div><button disabled={running || (dataset && !dataset.featureColumns.length) || Boolean(graphError)} onClick={() => onRun().catch(() => {})} className="mt-4 w-full rounded-2xl bg-emerald-600 px-4 py-3 font-bold text-white disabled:opacity-50">{running ? t('runner.executing') : model ? `↻ ${t('runner.executeAgain')}` : `▶ ${t('runner.execute')}`}</button></div>
        <div className="space-y-4">{model ? <>{model.metrics ? <div><h3 className="font-black">{t('runner.evaluationOutput')}</h3><div className="mt-2 grid grid-cols-2 gap-2">{Object.entries(model.metrics).map(([key, value]) => <div key={key} className="rounded-2xl bg-slate-100 p-3"><p className="text-[10px] uppercase text-slate-500">{key}</p><p className="mt-1 font-mono font-bold">{typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(4) : value}</p></div>)}</div></div> : <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-700">{t('runner.evaluationMissing')}</div>}{model.hasPredictor ? <div className="rounded-2xl border p-4"><h3 className="font-black">{t('runner.predictorOutput')}</h3><div className="mt-3 grid grid-cols-2 gap-2">{model.featureColumns.map((column) => <label key={column} className="text-xs font-bold">{column}<input type="number" inputMode="decimal" value={inputs[column] ?? ''} onChange={(event) => setInputs({ ...inputs, [column]: event.target.value })} className="mt-1 w-full rounded-xl border p-2 font-mono" /></label>)}</div><button onClick={tryPrediction} className="mt-3 w-full rounded-xl bg-blue-600 px-3 py-2 font-bold text-white">{t('runner.predict', { target: model.targetColumn })}</button>{prediction !== null && <div className="mt-3 rounded-xl bg-blue-50 p-4 text-center"><p className="text-xs text-blue-600">{t('runner.prediction')}</p><p className="mt-1 text-2xl font-black">{typeof prediction === 'number' ? prediction.toFixed(4) : prediction}</p></div>}</div> : <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-700">{t('runner.predictorMissing')}</div>}<p className="text-xs text-slate-400">{t('runner.weightsSaved', { nodeId: model.sourceNodeId })}</p></> : <div className="grid min-h-64 place-items-center rounded-3xl bg-slate-50 p-6 text-center text-slate-400"><div><p className="text-4xl">⌁</p><p className="mt-3">{t('runner.emptyOutput')}</p></div></div>}</div>
      </div> : <div className="mt-5 rounded-3xl border border-dashed border-slate-300 p-8 text-center text-slate-500"><p className="text-3xl">⇧</p><p className="mt-3 font-bold">{t('tier.useHigherTier', { tier: executionPlan.recommendedTier })}</p><p className="mt-1 text-sm">{t('tier.designStillAvailable')}</p></div>}
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
  const { openSettings } = useAiProvider();
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
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [compositeOpen, setCompositeOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [playgroundOpen, setPlaygroundOpen] = useState(false);
  const [playgroundId, setPlaygroundId] = useState(null);
  const [playgroundInitialTab, setPlaygroundInitialTab] = useState('model');
  const [surface, setSurface] = useState(UI_SURFACES.EXPLORE);
  const [globalMoreOpen, setGlobalMoreOpen] = useState(false);
  const [tutorialManifest, setTutorialManifest] = useState(null);
  const [projectName, setProjectName] = useState(() => t('project.sampleName'));
  const [customComponents, setCustomComponents] = useState([]);
  const [restoreCandidate, setRestoreCandidate] = useState(null);
  const [localReady, setLocalReady] = useState(false);
  const [autosavedAt, setAutosavedAt] = useState(null);
  const [persistenceRevision, setPersistenceRevision] = useState(0);
  const [dataset, setDataset] = useState(null);
  const [model, setModel] = useState(null);
  const [runtime, setRuntime] = useState(idleRuntimeState);
  const [pendingConnection, setPendingConnection] = useState(null);
  const [pendingDeletion, setPendingDeletion] = useState(null);
  const [notice, setNotice] = useState('');
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
  const agentAdapterRef = useRef(null);
  const playgroundHostRef = useRef(null);
  const playgroundAgentRef = useRef(null);
  if (!playgroundHostRef.current) {
    playgroundHostRef.current = createPlaygroundHost({ getDataset: () => workspaceStateRef.current.dataset });
    playgroundAgentRef.current = createPlaygroundAgentApi(playgroundHostRef.current);
  }
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
    runtime,
    selectedId,
  };
  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
  const selectedNodes = nodes.filter((node) => node.selected);
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
  }), [projectName, nodes, edges, dataset, customComponents, model]);
  const executionInputSignature = useMemo(
    () => canvasExecutionInputSignature(nodes, edges, dataset),
    [nodes, edges, dataset],
  );
  const previousExecutionSignature = useRef(executionInputSignature);
  const makeProject = useCallback(() => projectFromWorkspace(workspaceStateRef.current), []);
  const applyProject = useCallback((rawProject, { languagePolicy = 'project' } = {}) => {
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
    setModel(project.trainedModel ?? null);
    setRuntime(nextRuntime);
    pendingFitRef.current = true;
    return project;
  }, [setNodes, setEdges, setLanguages, t]);

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
  const runBrowserGraph = useCallback(async () => {
    const state = workspaceStateRef.current;
    if (state.runtime.status === 'running') {
      throw new CanvasAgentError('INSTANCE_BUSY', 'Canvas execution is already running.');
    }
    const startedAt = new Date().toISOString();
    const startedWithSignature = canvasExecutionInputSignature(state.nodes, state.edges, state.dataset);
    let currentNode = null;
    let validationNodeIds = [];
    setNodeStatus(state.nodes.map((node) => node.id), 'idle');
    updateRuntime({
      status: 'running',
      activeNodeIds: [],
      losses: [],
      result: null,
      error: null,
      startedAt,
      finishedAt: null,
    });
    try {
      const contract = analyzeBrowserExecutionGraph({ nodes: state.nodes, edges: state.edges, dataset: state.dataset });
      if (!contract.valid) {
        validationNodeIds = contract.nodeIds ?? [];
        const error = localizedError(contract.reason, contract.translationParams);
        error.nodeIds = validationNodeIds;
        throw error;
      }
      const plan = executionPlanFor(state.nodes, state.edges, state.dataset);
      if (!plan.canRunHere) throw localizedError('error.higherTierRequired', { tier: plan.recommendedTier });
      const finalModel = await executeBrowserGraph({
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
      });
      const currentState = workspaceStateRef.current;
      if (canvasExecutionInputSignature(currentState.nodes, currentState.edges, currentState.dataset) !== startedWithSignature) {
        const changedError = new CanvasAgentError('WORKSPACE_CHANGED', 'Workspace changed while the pipeline was running.');
        changedError.translationKey = 'error.workspaceChangedDuringRun';
        throw changedError;
      }
      const { test, ...persistableModel } = finalModel;
      workspaceStateRef.current = { ...workspaceStateRef.current, model: persistableModel };
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
        finishedAt: new Date().toISOString(),
      }));
      return persistableModel;
    } catch (error) {
      if (error?.code === 'WORKSPACE_CHANGED') {
        const nextNodes = invalidateAgentNodeStatuses(workspaceStateRef.current.nodes);
        workspaceStateRef.current = { ...workspaceStateRef.current, nodes: nextNodes, model: null };
        setNodes(nextNodes);
        setModel(null);
        updateRuntime({
          ...idleRuntimeState(),
          status: 'failed',
          error: runtimeErrorInfo(error),
          finishedAt: new Date().toISOString(),
        });
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
          error: runtimeErrorInfo(error),
          finishedAt: new Date().toISOString(),
        }));
      }
      throw error;
    }
  }, [setNodeStatus, setNodes, updateRuntime]);
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
  useEffect(() => {
    const host = playgroundHostRef.current;
    if (!host) return;
    try {
      const current = host.getState();
      if (!current || current.source.kind !== 'workspace-dataset' || current.source.stale) return;
      const probe = host.currentSourceFingerprint();
      if (probe && probe.fingerprint !== current.source.fingerprint) host.markSourceStale();
    } catch { /* no playground session open */ }
  }, [dataset]);
  const exportCode = (framework) => {
    try {
      const result = framework === 'tensorflow' ? compilePipelineToTensorFlow(nodes, edges) : compilePipelineToPyTorch(nodes, edges);
      downloadText(`volk_ml_${framework}_pipeline.py`, result.code, 'text/x-python');
      setNotice(t('compiler.exported', { framework: t(`framework.${framework}`) }));
    }
    catch (error) { setNotice(translateError(error, t)); }
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
    playground: playgroundAgentRef.current,
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
      playground: playgroundAgentRef.current,
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

  const openBigIdea = useCallback(async (id) => {
    const entrance = getBigIdeaEntrance(id);
    if (!entrance) return;
    try {
      await playgroundHostRef.current.openBigIdeaEntrance({ id });
      setPlaygroundInitialTab(entrance.startingPoint.playgroundId === 'data-lab' ? 'data' : 'model');
      setPlaygroundId(entrance.startingPoint.playgroundId);
      setPlaygroundOpen(true);
    } catch (error) {
      setNotice(translateError(error, t));
    }
  }, [t]);

  const asideBase = 'fixed bottom-3 top-[76px] z-30 overflow-auto rounded-3xl border border-white/80 bg-white/95 p-4 shadow-2xl backdrop-blur transition-transform lg:static lg:z-auto lg:h-auto lg:rounded-3xl lg:bg-white/85 lg:shadow-xl';
  return <div className="flex h-[100dvh] flex-col overflow-hidden bg-gradient-to-br from-sky-50 via-white to-indigo-100">
    <header data-top-level-surface={surface} className="z-40 flex min-h-[64px] items-center justify-between gap-3 border-b border-white/70 bg-white/90 px-3 py-2 shadow-sm backdrop-blur sm:px-5">
      <div className="flex min-w-0 items-center gap-3"><div className="shrink-0"><h1 className="text-xl font-black text-slate-950 sm:text-2xl">VOLK-ML</h1><p className="hidden truncate text-xs text-slate-600 xl:block">{t('app.tagline')}</p></div><span className="hidden text-xs font-bold text-slate-400 sm:inline">{autosavedAt ? t('project.autosaved') : t('project.unsaved')}</span></div>
      <nav aria-label={t('surface.navigation')} className="flex items-center gap-1.5 text-sm">
        <button type="button" aria-pressed={surface === UI_SURFACES.EXPLORE} className={`rounded-xl px-3 py-2 font-bold ${surface === UI_SURFACES.EXPLORE ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setSurface(UI_SURFACES.EXPLORE)}>{t('ui.surface.explore')}</button>
        <button type="button" aria-pressed={surface === UI_SURFACES.BUILD} className={`rounded-xl px-3 py-2 font-bold ${surface === UI_SURFACES.BUILD ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setSurface(UI_SURFACES.BUILD)}>{t('ui.surface.build')}</button>
        <div className="relative">
          <button type="button" aria-expanded={globalMoreOpen} aria-controls="global-more-actions" className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={() => setGlobalMoreOpen((value) => !value)}>⋯ <span className="hidden sm:inline">{t('surface.more')}</span></button>
          {globalMoreOpen && <div id="global-more-actions" className="absolute right-0 top-full z-50 mt-2 grid min-w-48 gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl"><button type="button" className="rounded-xl px-3 py-2 text-left font-bold hover:bg-slate-100" onClick={() => { openSettings(); setGlobalMoreOpen(false); }}>⚙ {t('nav.aiSettings')}</button><button type="button" className="rounded-xl px-3 py-2 text-left font-bold hover:bg-slate-100" onClick={() => { setLanguageOpen(true); setGlobalMoreOpen(false); }}>文 {t('language.title')}</button></div>}
        </div>
      </nav>
    </header>

    {surface === UI_SURFACES.EXPLORE ? <ExploreHome onOpenBigIdea={openBigIdea} onOpenPlayground={(id) => { setPlaygroundInitialTab(id === 'data-lab' ? 'data' : 'model'); setPlaygroundId(id); setPlaygroundOpen(true); }} t={t} /> : <>
      <BuildToolbar projectName={projectName} setProjectName={setProjectName} autosavedAt={autosavedAt} onToggleLeft={toggleLeftPanel} onToggleRight={toggleRightPanel} viewMode={viewMode} setViewMode={setViewMode} setExplanationOpen={setExplanationOpen} selectedNodes={selectedNodes} setCompositeOpen={setCompositeOpen} multiSelectMode={multiSelectMode} setMultiSelectMode={setMultiSelectMode} setExamplesOpen={setExamplesOpen} dataset={dataset} setDataOpen={setDataOpen} exportProject={exportProject} importRef={importRef} importProject={importProject} setPlaygroundInitialTab={setPlaygroundInitialTab} setPlaygroundId={setPlaygroundId} setPlaygroundOpen={setPlaygroundOpen} setRunnerOpen={setRunnerOpen} t={t} />

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
        {selectedNode ? <div className="mt-4 space-y-5"><div className="rounded-2xl bg-blue-50 p-4"><p className="text-xs font-bold uppercase text-blue-600">{t(`category.${selectedNode.data.manifest.category}`)}</p><h3 className="break-words text-xl font-black text-slate-900">{t(selectedNode.data.label)}</h3><div className="mt-2 flex gap-2 text-[10px] font-bold uppercase"><span className="rounded-full bg-slate-900 px-2 py-1 text-white">{t('framework.pytorch')}: {t(`compatibility.${selectedNode.data.manifest.compatibility?.pytorch ?? 'unsupported'}`)}</span><span className="rounded-full bg-orange-100 px-2 py-1 text-orange-700">{t('framework.tensorflow')}: {t(`compatibility.${selectedNode.data.manifest.compatibility?.tensorflow ?? 'unsupported'}`)}</span></div></div>{selectedNode.data.manifest.properties.map((property) => <label key={property.key} className="block rounded-2xl border border-slate-200 bg-white p-4"><span className="block break-words text-sm font-bold text-slate-800">{t(property.label)}</span><PropertyControl property={property} value={selectedNode.data.parameters[property.key]} onChange={(value) => updateParameter(property.key, value)} /></label>)}{selectedNode.data.manifest.composition && <button onClick={expandSelectedComposite} className="w-full rounded-2xl bg-violet-600 px-4 py-3 font-bold text-white shadow-lg">{t('component.expand')}</button>}{selectedNode.data.compositeOrigin && <button onClick={collapseSelectedComposite} className="w-full rounded-2xl bg-violet-100 px-4 py-3 font-bold text-violet-700">{t('component.collapse')}</button>}<div className="grid grid-cols-2 gap-2"><button onClick={() => exportCode('pytorch')} className="rounded-2xl bg-slate-950 px-3 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-blue-700">{t('compiler.exportPyTorch')}</button><button onClick={() => exportCode('tensorflow')} className="rounded-2xl bg-orange-500 px-3 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-orange-600">{t('compiler.exportTensorFlow')}</button></div></div> : <p className="mt-6 text-sm text-slate-500">{t('parameters.empty')}</p>}
        <div className="absolute bottom-8 left-0 top-8 hidden w-2 cursor-col-resize touch-none lg:block" onPointerDown={(event) => startResize('right', event)} />
      </motion.aside>
    </main>
    </>}
    {notice && <button onClick={() => setNotice('')} className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-2xl">{notice} · ✕</button>}
    {restoreCandidate && <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 p-4"><section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><h2 className="text-xl font-black">{t('project.restoreTitle')}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{t('project.restoreDescription')}</p><p className="mt-3 rounded-xl bg-slate-100 p-3 font-bold">{restoreCandidate.name || t('project.sampleName')}</p><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={() => { applyProject(restoreCandidate); setRestoreCandidate(null); setLocalReady(true); }} className="rounded-2xl bg-blue-600 px-4 py-3 font-bold text-white">{t('project.restore')}</button><button onClick={() => { platformServices.projects.remove().finally(() => { setRestoreCandidate(null); setLocalReady(true); }); }} className="rounded-2xl bg-slate-100 px-4 py-3 font-bold text-slate-700">{t('project.startFresh')}</button></div></section></div>}
    {pendingDeletion && <DeletionConfirmDialog summary={deletionSummary({ nodes, edges, pendingDeletion })} onCancel={() => setPendingDeletion(null)} onConfirm={confirmDeletion} t={t} />}
    <LanguageDialog open={languageOpen} onClose={() => setLanguageOpen(false)} />
    <DataDialog open={dataOpen} onClose={() => setDataOpen(false)} dataset={dataset} onDataset={(nextDataset) => { setDataset(nextDataset); setModel(null); }} />
    <RunnerDialog open={runnerOpen} onClose={() => setRunnerOpen(false)} nodes={nodes} edges={edges} dataset={dataset} model={model} runtime={runtime} onRun={runBrowserGraph} onValidation={handleRunnerValidation} onOpenData={() => setDataOpen(true)} onExport={exportCode} />
    <CompositeDialog open={compositeOpen} selectedCount={selectedNodes.length} onClose={() => setCompositeOpen(false)} onCreate={createCompositeFromSelection} t={t} />
    <ExamplesDialog open={examplesOpen} onClose={() => setExamplesOpen(false)} onLoad={(project) => { applyProject(project, { languagePolicy: 'preserve-current' }); setExamplesOpen(false); setNotice(t('examples.loaded')); }} t={t} />
    {explanationOpen && <Suspense fallback={<div className="fixed inset-0 z-[75] grid place-items-center bg-slate-950/55 p-4"><div className="rounded-2xl bg-white px-5 py-4 font-bold text-slate-700 shadow-2xl">{t('agent.thinking')}</div></div>}><ExplanationDialog open nodes={nodes} edges={edges} language={primary} onClose={() => setExplanationOpen(false)} t={t} /></Suspense>}
    <AiSettingsDialog t={t} />
    {tutorialManifest && <Suspense fallback={<div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/55 p-4"><div className="rounded-2xl bg-white px-5 py-4 font-bold text-slate-700 shadow-2xl">{t('tutorial.loading')}</div></div>}><TutorialDialog manifest={tutorialManifest} dataset={dataset} onOpenPlayground={(id) => { setPlaygroundId(id); setPlaygroundOpen(true); }} onClose={() => setTutorialManifest(null)} t={t} /></Suspense>}
    <PlaygroundDialog open={playgroundOpen} playgroundId={playgroundId} initialTab={playgroundInitialTab} host={playgroundHostRef.current} agent={playgroundAgentRef.current} onClose={() => setPlaygroundOpen(false)} t={t} />
  </div>;
}

createRoot(document.getElementById('root')).render(<LanguageProvider><AiProvider><Workspace /></AiProvider></LanguageProvider>);

