import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Background, Controls, Handle, MiniMap, Position, addEdge, useEdgesState, useNodesState } from '@xyflow/react';
import { motion } from 'framer-motion';
import '@xyflow/react/dist/style.css';

const PROJECT_VERSION = 3;
const languages = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
];
const LANGUAGE_STORAGE_KEY = 'volk-ml-language-settings';

const pluginRegistry = [
  {
    id: 'tabular_data_node', name: { en: 'Tabular Data', zh: '表格数据' }, category: 'Data',
    description: { en: 'Provides the CSV or JSON dataset configured in the Data workspace.', zh: '提供在数据工作区配置的 CSV 或 JSON 数据集。' },
    inputs: [], outputs: [{ name: 'dataset', type: 'Table' }], properties: [],
    pytorch_template: '# Load the configured tabular dataset',
  },
  {
    id: 'train_test_split_node', name: { en: 'Train/Test Split', zh: '训练/测试集划分' }, category: 'Preprocessing',
    description: { en: 'Cleans numeric rows and creates a deterministic train/test split.', zh: '清理数值行并确定性划分训练集与测试集。' },
    inputs: [{ name: 'dataset', type: 'Table' }], outputs: [{ name: 'split', type: 'DatasetSplit' }],
    properties: [{ key: 'train_ratio', label: { en: 'Training Ratio', zh: '训练集比例' }, type: 'slider', min: 0.5, max: 0.9, step: 0.05, default: 0.8 }],
    pytorch_template: 'train_set, test_set = train_test_split(dataset, train_size={train_ratio}, random_state=2026)',
  },
  {
    id: 'knn_node', name: { en: 'K-Nearest Neighbors', zh: 'K-近邻算法' }, category: 'Classification',
    description: { en: 'Classifies points by voting among nearby examples.', zh: '通过附近样本投票对数据点分类。' },
    inputs: [{ name: 'dataset', type: 'Table' }], outputs: [{ name: 'model', type: 'Model' }, { name: 'boundary', type: 'Mesh' }],
    properties: [{ key: 'k_value', label: { en: 'Number of Neighbors (K)', zh: '邻居数量 (K)' }, type: 'slider', min: 1, max: 21, step: 2, default: 3 }],
    pytorch_template: 'from sklearn.neighbors import KNeighborsClassifier\nmodel = KNeighborsClassifier(n_neighbors={k_value})',
  },
  {
    id: 'linear_regression_node', name: { en: 'Linear Regression', zh: '线性回归' }, category: 'Regression',
    description: { en: 'Fits a straight line to predict continuous values.', zh: '拟合直线来预测连续数值。' },
    inputs: [{ name: 'split', type: 'DatasetSplit' }], outputs: [{ name: 'model', type: 'ModelSpec' }],
    properties: [{ key: 'learning_rate', label: { en: 'Learning Rate', zh: '学习率' }, type: 'slider', min: 0.001, max: 0.2, step: 0.001, default: 0.01 }],
    pytorch_template: 'import torch\nmodel = torch.nn.Linear(in_features=1, out_features=1)\noptimizer = torch.optim.SGD(model.parameters(), lr={learning_rate})',
  },
  {
    id: 'gradient_descent_node', name: { en: 'Gradient Descent', zh: '梯度下降' }, category: 'Optimization',
    description: { en: 'Iteratively updates parameters in the direction that reduces loss.', zh: '沿着降低损失的方向迭代更新参数。' },
    inputs: [{ name: 'model', type: 'ModelSpec' }], outputs: [{ name: 'trained_model', type: 'TrainedModel' }],
    properties: [{ key: 'epochs', label: { en: 'Training Epochs', zh: '训练轮数' }, type: 'slider', min: 10, max: 500, step: 10, default: 100 }],
    pytorch_template: 'for epoch in range({epochs}):\n    optimizer.zero_grad()\n    loss.backward()\n    optimizer.step()',
  },
  {
    id: 'evaluate_node', name: { en: 'Evaluate Regression', zh: '回归评估' }, category: 'Evaluation',
    description: { en: 'Computes RMSE and R² on the connected test set.', zh: '在连接的测试集上计算 RMSE 和 R²。' },
    inputs: [{ name: 'trained_model', type: 'TrainedModel' }], outputs: [{ name: 'metrics', type: 'Metrics' }], properties: [],
    pytorch_template: '# Evaluate RMSE and R2 on the test set',
  },
  {
    id: 'predictor_node', name: { en: 'Interactive Predictor', zh: '交互预测器' }, category: 'Inference',
    description: { en: 'Creates an input form for trying the connected trained model.', zh: '为连接的已训练模型创建交互输入表单。' },
    inputs: [{ name: 'trained_model', type: 'TrainedModel' }], outputs: [{ name: 'prediction', type: 'Prediction' }], properties: [],
    pytorch_template: '# Run inference with the trained model',
  },
];

const LanguageContext = createContext(null);
const ConnectionContext = createContext({ pendingConnection: null, onPortTap: () => {} });
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
  const t = useCallback((value) => {
    if (typeof value === 'string') return value;
    const first = value?.[primary] ?? value?.en ?? Object.values(value ?? {})[0] ?? '';
    const second = secondary ? value?.[secondary] : null;
    return second && second !== first ? `${first} · ${second}` : first;
  }, [primary, secondary]);
  const setLanguages = ({ primary: nextPrimary, secondary: nextSecondary }) => {
    setPrimary(nextPrimary);
    setSecondary(nextSecondary && nextSecondary !== nextPrimary ? nextSecondary : null);
  };
  return <LanguageContext.Provider value={{ primary, secondary, setLanguages, t }}>{children}</LanguageContext.Provider>;
}
function useVividTranslation() { return useContext(LanguageContext); }

const defaults = (manifest) => Object.fromEntries(manifest.properties.map((property) => [property.key, property.default]));
const createNode = (manifest, index) => ({
  id: `${manifest.id}-${crypto.randomUUID()}`,
  type: 'pipelineNode',
  position: { x: 120 + index * 110, y: 90 + index * 90 },
  data: { label: manifest.name, manifest, parameters: defaults(manifest) },
});

function makeDefaultGraph() {
  const specs = [
    ['pipeline-data', 'tabular_data_node', 40, 180],
    ['pipeline-split', 'train_test_split_node', 340, 180],
    ['pipeline-linear', 'linear_regression_node', 650, 180],
    ['pipeline-optimizer', 'gradient_descent_node', 960, 180],
    ['pipeline-evaluate', 'evaluate_node', 1270, 70],
    ['pipeline-predictor', 'predictor_node', 1270, 300],
  ];
  const nodes = specs.map(([id, manifestId, x, y]) => {
    const manifest = pluginRegistry.find((plugin) => plugin.id === manifestId);
    return { id, type: 'pipelineNode', position: { x, y }, data: { label: manifest.name, manifest, parameters: defaults(manifest), status: 'idle' } };
  });
  const edge = (id, source, sourceHandle, target, targetHandle) => ({ id, source, sourceHandle, target, targetHandle, type: 'smoothstep' });
  return { nodes, edges: [
    edge('data-split', 'pipeline-data', 'dataset', 'pipeline-split', 'dataset'),
    edge('split-linear', 'pipeline-split', 'split', 'pipeline-linear', 'split'),
    edge('linear-optimizer', 'pipeline-linear', 'model', 'pipeline-optimizer', 'model'),
    edge('optimizer-evaluate', 'pipeline-optimizer', 'trained_model', 'pipeline-evaluate', 'trained_model'),
    edge('optimizer-predictor', 'pipeline-optimizer', 'trained_model', 'pipeline-predictor', 'trained_model'),
  ] };
}

function resolvePort(manifest, direction, handleId) {
  const ports = direction === 'output' ? manifest.outputs : manifest.inputs;
  return ports.find((port) => port.name === handleId) ?? (ports.length === 1 ? ports[0] : null);
}

function compileExecutionGraph(nodes, edges) {
  if (!edges.length) throw new Error('Connect the components before running.');
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const activeIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const activeNodes = nodes.filter((node) => activeIds.has(node.id));
  const incoming = new Map(activeNodes.map((node) => [node.id, []]));
  const outgoing = new Map(activeNodes.map((node) => [node.id, []]));
  edges.forEach((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) throw new Error('A connection references a missing component.');
    const output = resolvePort(source.data.manifest, 'output', edge.sourceHandle);
    const input = resolvePort(target.data.manifest, 'input', edge.targetHandle);
    if (!output || !input) throw new Error(`Invalid connection between ${source.data.manifest.name.en} and ${target.data.manifest.name.en}.`);
    if (output.type !== input.type) throw new Error(`Type mismatch: ${output.type} cannot connect to ${input.type}.`);
    incoming.get(target.id).push({ edge, source, output, input });
    outgoing.get(source.id).push(target.id);
  });
  activeNodes.forEach((node) => node.data.manifest.inputs.forEach((input) => {
    const matches = incoming.get(node.id).filter((connection) => connection.input.name === input.name);
    if (!matches.length) throw new Error(`${node.data.manifest.name.en} is missing its ${input.name} input.`);
    if (matches.length > 1) throw new Error(`${node.data.manifest.name.en} has multiple connections to ${input.name}.`);
  }));
  const indegree = new Map(activeNodes.map((node) => [node.id, incoming.get(node.id).length]));
  const queue = activeNodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(nodeById.get(id));
    outgoing.get(id).forEach((targetId) => { const next = indegree.get(targetId) - 1; indegree.set(targetId, next); if (next === 0) queue.push(targetId); });
  }
  if (order.length !== activeNodes.length) throw new Error('Pipeline contains a cycle.');
  if (!order.some((node) => node.data.manifest.id === 'tabular_data_node')) throw new Error('Pipeline needs a connected Tabular Data component.');
  return { order, incoming };
}

function compilePipelineToPyTorch(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map();
  edges.forEach((edge) => {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  });
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const ordered = [];
  while (queue.length) {
    const id = queue.shift();
    ordered.push(nodeById.get(id));
    (outgoing.get(id) ?? []).forEach((target) => {
      const next = indegree.get(target) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    });
  }
  if (ordered.length !== nodes.length) throw new Error('Pipeline graph contains a cycle.');
  return ['# Generated by VOLK-ML', '# Review tensor shapes and dataset bindings before running.', '', ...ordered.map((node, index) => `# Step ${index + 1}: ${node.data.manifest.name.en}\n${node.data.manifest.pytorch_template.replace(/\{(\w+)\}/g, (_, key) => node.data.parameters[key] ?? `{${key}}`)}`)].join('\n\n');
}

function downloadText(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function PipelineNode({ id, data, selected }) {
  const { t } = useVividTranslation();
  const { pendingConnection, onPortTap } = useContext(ConnectionContext);
  const statusStyle = data.status === 'success' ? 'border-emerald-500' : data.status === 'running' ? 'border-amber-400' : data.status === 'error' ? 'border-red-500' : selected ? 'border-blue-500' : 'border-slate-200';
  return <div className={`min-w-52 max-w-72 rounded-2xl border-2 bg-white p-4 shadow-lg ${statusStyle}`}>
    {data.manifest.inputs.map((input, index) => <Handle key={input.name} type="target" position={Position.Left} id={input.name} style={{ top: 44 + index * 32, width: 20, height: 20, borderWidth: 3 }} />)}
    {data.manifest.inputs.length > 0 && <div className="mb-3 flex flex-wrap gap-1">{data.manifest.inputs.map((input) => {
      const compatible = pendingConnection?.type === input.type;
      return <button key={input.name} title={`Input: ${input.type}`} onClick={(event) => { event.stopPropagation(); onPortTap({ direction: 'input', nodeId: id, port: input }); }} className={`nodrag nopan rounded-full border px-3 py-2 text-xs font-bold transition ${pendingConnection ? compatible ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-400' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>◀ {input.name}: {input.type}</button>;
    })}</div>}
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">{data.manifest.category}</p>{data.status && data.status !== 'idle' && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${data.status === 'success' ? 'bg-emerald-100 text-emerald-700' : data.status === 'running' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{data.status}</span>}</div>
    <h3 className="mt-1 break-words text-base font-bold text-slate-900">{t(data.label)}</h3>
    <p className="mt-2 break-words text-sm text-slate-600">{t(data.manifest.description)}</p>
    <div className="mt-3 flex flex-wrap gap-1 text-[11px] text-slate-500">{data.manifest.outputs.map((output) => {
      const active = pendingConnection?.nodeId === id && pendingConnection?.port.name === output.name;
      return <button key={output.name} title={`Output: ${output.type}`} onClick={(event) => { event.stopPropagation(); onPortTap({ direction: 'output', nodeId: id, port: output }); }} className={`nodrag nopan rounded-full border px-3 py-2 text-left text-xs font-bold transition ${active ? 'border-amber-400 bg-amber-100 text-amber-800 ring-2 ring-amber-200' : 'border-slate-200 bg-slate-100 hover:border-blue-400'}`}>{output.name}: {output.type} ▶</button>;
    })}</div>
    {data.manifest.outputs.map((output, index) => <Handle key={output.name} type="source" position={Position.Right} id={output.name} style={{ top: 44 + index * 32, width: 20, height: 20, borderWidth: 3 }} />)}
  </div>;
}

function LossChart({ values }) {
  if (!values.length) return <div className="grid h-40 place-items-center text-sm text-slate-400">Run the model to see loss</div>;
  const width = 520;
  const height = 160;
  const max = Math.max(...values, 0.0001);
  const points = values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * width},${height - (value / max) * (height - 12)}`).join(' ');
  return <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full overflow-visible rounded-xl bg-slate-950 p-2" role="img" aria-label="Training loss curve">
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
  if (rows.length < 2) throw new Error('CSV needs a header and at least one data row.');
  const headers = rows[0].map((header, index) => header || `column_${index + 1}`);
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
}

function describeRows(rows) {
  if (!rows.length || typeof rows[0] !== 'object' || Array.isArray(rows[0])) throw new Error('Data must be an array of objects.');
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
      if (!Array.isArray(rows) || !rows.length) throw new Error('No rows found.');
      const columns = describeRows(rows);
      const numeric = columns.filter((column) => column.type === 'number').map((column) => column.name);
      onDataset({ name: file.name, rows, columns, featureColumns: numeric.slice(0, -1), targetColumn: numeric.at(-1) ?? '', task: 'regression', trainRatio: 0.8 });
    } catch (error) { window.alert(`Data import failed: ${error.message}`); }
  };
  const toggleFeature = (name) => onDataset({ ...dataset, featureColumns: dataset.featureColumns.includes(name) ? dataset.featureColumns.filter((column) => column !== name) : [...dataset.featureColumns, name] });
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={onClose}>
    <section className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-black">{t({ en: 'Data workspace', zh: '数据工作区' })}</h2><p className="mt-1 text-sm text-slate-500">CSV and JSON stay in this browser and are never uploaded.</p></div><button className="rounded-full p-2 hover:bg-slate-100" onClick={onClose}>✕</button></div>
      <div className="mt-5 flex flex-wrap gap-2"><button onClick={() => fileRef.current?.click()} className="rounded-xl bg-blue-600 px-4 py-2 font-bold text-white">↑ Upload CSV / JSON</button><button onClick={() => onDataset(makeSampleDataset())} className="rounded-xl bg-slate-100 px-4 py-2 font-bold">Use sample dataset</button><input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" className="hidden" onChange={loadFile} /></div>
      {!dataset ? <div className="mt-8 grid min-h-56 place-items-center rounded-3xl border-2 border-dashed border-slate-200 text-center text-slate-400"><div><p className="text-4xl">▦</p><p className="mt-3 font-bold">Choose a local file or start with the sample</p></div></div> : <>
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="overflow-hidden rounded-2xl border"><div className="flex items-center justify-between bg-slate-50 px-4 py-3"><div><p className="font-bold">{dataset.name}</p><p className="text-xs text-slate-500">{dataset.rows.length} rows · {dataset.columns.length} columns</p></div></div><div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-100"><tr>{dataset.columns.map((column) => <th key={column.name} className="whitespace-nowrap px-3 py-2"><span className="font-bold">{column.name}</span><span className="ml-2 text-[10px] font-normal text-slate-400">{column.type}</span></th>)}</tr></thead><tbody>{dataset.rows.slice(0, 8).map((row, index) => <tr key={index} className="border-t">{dataset.columns.map((column) => <td key={column.name} className="max-w-40 truncate px-3 py-2">{String(row[column.name] ?? '')}</td>)}</tr>)}</tbody></table></div></div>
          <div className="space-y-4 rounded-2xl bg-slate-50 p-4"><div><p className="text-sm font-black">Input features</p><div className="mt-2 max-h-36 space-y-2 overflow-auto">{dataset.columns.filter((column) => column.type === 'number' && column.name !== dataset.targetColumn).map((column) => <label key={column.name} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dataset.featureColumns.includes(column.name)} onChange={() => toggleFeature(column.name)} />{column.name}</label>)}</div></div><label className="block text-sm font-black">Prediction target<select value={dataset.targetColumn} onChange={(event) => onDataset({ ...dataset, targetColumn: event.target.value, featureColumns: dataset.featureColumns.filter((column) => column !== event.target.value) })} className="mt-2 w-full rounded-xl border bg-white p-2">{dataset.columns.filter((column) => column.type === 'number').map((column) => <option key={column.name}>{column.name}</option>)}</select></label><div className="rounded-xl bg-white p-3 text-xs text-slate-500"><p>Task: <strong className="text-slate-900">Regression</strong></p><p className="mt-1">Split ratio is controlled by the connected Train/Test Split node.</p><p className="mt-1">Missing values are skipped during training.</p></div></div>
        </div>
        <button disabled={!dataset.featureColumns.length || !dataset.targetColumn} onClick={onClose} className="mt-5 w-full rounded-2xl bg-emerald-600 px-4 py-3 font-bold text-white disabled:opacity-40">Use this dataset · 使用此数据</button>
      </>}
    </section>
  </div>;
}

function LanguageDialog({ open, onClose }) {
  const { primary, secondary, setLanguages } = useVividTranslation();
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
      <div className="flex items-center justify-between"><h2 className="text-xl font-black">Language settings · 语言设置</h2><button className="rounded-full p-2 hover:bg-slate-100" onClick={onClose}>✕</button></div>
      <p className="mt-2 text-sm text-slate-500">Choose one language, or add any second language for parallel labels.</p>
      <label className="mt-5 block text-sm font-bold">Primary language
        <select className="mt-2 w-full rounded-xl border p-3" value={draftPrimary} onChange={(event) => { setDraftPrimary(event.target.value); if (draftSecondary === event.target.value) setDraftSecondary('none'); }}>
          {languages.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
        </select>
      </label>
      <label className="mt-4 block text-sm font-bold">Parallel language
        <select className="mt-2 w-full rounded-xl border p-3" value={draftSecondary} onChange={(event) => setDraftSecondary(event.target.value)}>
          <option value="none">None · 单语言</option>
          {languages.filter((language) => language.code !== draftPrimary).map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
        </select>
      </label>
      <button className="mt-6 w-full rounded-2xl bg-blue-600 px-4 py-3 font-bold text-white" onClick={() => { setLanguages({ primary: draftPrimary, secondary: draftSecondary === 'none' ? null : draftSecondary }); onClose(); }}>Apply · 应用</button>
    </section>
  </div>;
}

function RunnerDialog({ open, onClose, nodes, edges, dataset, model, onModel, onOpenData, onNodeStatus }) {
  const { t } = useVividTranslation();
  const [running, setRunning] = useState(false);
  const [losses, setLosses] = useState(model?.lossHistory ?? []);
  const [inputs, setInputs] = useState({});
  const [prediction, setPrediction] = useState(null);
  const [graphError, setGraphError] = useState('');
  const [planNames, setPlanNames] = useState([]);
  const graphSignature = useMemo(() => JSON.stringify({
    nodes: nodes.map((node) => ({ id: node.id, manifestId: node.data.manifest.id, parameters: node.data.parameters })),
    edges: edges.map((edge) => ({ source: edge.source, sourceHandle: edge.sourceHandle, target: edge.target, targetHandle: edge.targetHandle })),
  }), [nodes, edges]);
  useEffect(() => {
    if (open) {
      setLosses(model?.lossHistory ?? []);
      setPrediction(null);
      setGraphError('');
      try { setPlanNames(compileExecutionGraph(nodes, edges).order.map((node) => node.data.manifest.name.en)); }
      catch (error) { setPlanNames([]); setGraphError(error.message); }
    }
  }, [open, model, graphSignature]);
  if (!open) return null;

  const run = async () => {
    if (running) return;
    setGraphError('');
    setPrediction(null);
    setLosses([]);
    onNodeStatus(nodes.map((node) => node.id), 'idle');
    let currentNode = null;
    try {
      const plan = compileExecutionGraph(nodes, edges);
      if (!dataset) throw new Error('Tabular Data has no dataset. Open the Data workspace and import one.');
      setRunning(true);
      const outputs = new Map();
      let finalModel = null;
      const inputValue = (node, inputName) => {
        const connection = plan.incoming.get(node.id).find((item) => item.input.name === inputName);
        return connection ? outputs.get(connection.source.id) : undefined;
      };
      for (const node of plan.order) {
        currentNode = node;
        onNodeStatus([node.id], 'running');
        const manifestId = node.data.manifest.id;
        let output;
        if (manifestId === 'tabular_data_node') {
          output = dataset;
        } else if (manifestId === 'train_test_split_node') {
          const sourceDataset = inputValue(node, 'dataset');
          const valid = sourceDataset.rows.map((row, index) => {
            const rawFeatures = sourceDataset.featureColumns.map((column) => row[column]);
            const rawTarget = row[sourceDataset.targetColumn];
            const isMissing = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
            if (rawFeatures.some(isMissing) || isMissing(rawTarget)) return null;
            return { index, x: rawFeatures.map(Number), y: Number(rawTarget) };
          }).filter((sample) => sample && sample.x.every(Number.isFinite) && Number.isFinite(sample.y));
          if (valid.length < 3) throw new Error('Train/Test Split needs at least three complete numeric rows.');
          const shuffled = [...valid];
          let seed = 2026;
          for (let index = shuffled.length - 1; index > 0; index -= 1) {
            seed = (seed * 1664525 + 1013904223) % 4294967296;
            const target = seed % (index + 1);
            [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
          }
          const trainRatio = node.data.parameters.train_ratio;
          const splitIndex = Math.max(1, Math.min(shuffled.length - 1, Math.floor(shuffled.length * trainRatio)));
          output = { dataset: sourceDataset, train: shuffled.slice(0, splitIndex), test: shuffled.slice(splitIndex), trainRatio };
        } else if (manifestId === 'linear_regression_node') {
          output = { type: 'linear_regression_spec', split: inputValue(node, 'split'), learningRate: node.data.parameters.learning_rate, modelNodeId: node.id };
        } else if (manifestId === 'gradient_descent_node') {
          const spec = inputValue(node, 'model');
          const { dataset: sourceDataset, train, test } = spec.split;
          const xMeans = sourceDataset.featureColumns.map((_, feature) => train.reduce((sum, sample) => sum + sample.x[feature], 0) / train.length);
          const xStds = sourceDataset.featureColumns.map((_, feature) => Math.sqrt(train.reduce((sum, sample) => sum + (sample.x[feature] - xMeans[feature]) ** 2, 0) / train.length) || 1);
          const yMean = train.reduce((sum, sample) => sum + sample.y, 0) / train.length;
          const yStd = Math.sqrt(train.reduce((sum, sample) => sum + (sample.y - yMean) ** 2, 0) / train.length) || 1;
          const normalized = train.map((sample) => ({ x: sample.x.map((value, feature) => (value - xMeans[feature]) / xStds[feature]), y: (sample.y - yMean) / yStd }));
          let weights = sourceDataset.featureColumns.map(() => 0);
          let bias = 0;
          const history = [];
          const epochs = node.data.parameters.epochs;
          for (let epoch = 0; epoch < epochs; epoch += 1) {
            let loss = 0;
            const dw = weights.map(() => 0);
            let db = 0;
            normalized.forEach(({ x, y }) => {
              const error = weights.reduce((sum, weight, feature) => sum + weight * x[feature], bias) - y;
              loss += error * error;
              dw.forEach((_, feature) => { dw[feature] += 2 * error * x[feature]; });
              db += 2 * error;
            });
            loss /= normalized.length;
            weights = weights.map((weight, feature) => weight - spec.learningRate * (dw[feature] / normalized.length));
            bias -= spec.learningRate * (db / normalized.length);
            history.push(loss);
            if (epoch % Math.max(1, Math.floor(epochs / 50)) === 0 || epoch === epochs - 1) {
              setLosses([...history]);
              await new Promise((resolve) => requestAnimationFrame(resolve));
            }
          }
          output = { type: 'linear_regression', sourceNodeId: node.id, modelNodeId: spec.modelNodeId, featureColumns: sourceDataset.featureColumns, targetColumn: sourceDataset.targetColumn, weights, bias, normalization: { xMeans, xStds, yMean, yStd }, test, trainRows: train.length, testRows: test.length, metrics: null, lossHistory: history, epochs, learningRate: spec.learningRate, trainedAt: new Date().toISOString(), hasPredictor: false };
          finalModel = output;
        } else if (manifestId === 'evaluate_node') {
          const trained = inputValue(node, 'trained_model');
          const { xMeans, xStds, yMean, yStd } = trained.normalization;
          const predict = (sample) => trained.weights.reduce((sum, weight, feature) => sum + weight * ((sample.x[feature] - xMeans[feature]) / xStds[feature]), trained.bias) * yStd + yMean;
          const predictions = trained.test.map((sample) => ({ actual: sample.y, predicted: predict(sample) }));
          const mse = predictions.reduce((sum, item) => sum + (item.predicted - item.actual) ** 2, 0) / predictions.length;
          const testMean = predictions.reduce((sum, item) => sum + item.actual, 0) / predictions.length;
          const total = predictions.reduce((sum, item) => sum + (item.actual - testMean) ** 2, 0);
          const residual = predictions.reduce((sum, item) => sum + (item.actual - item.predicted) ** 2, 0);
          trained.metrics = { rmse: Math.sqrt(mse), r2: total ? 1 - residual / total : 0, trainRows: trained.trainRows, testRows: trained.testRows };
          output = trained.metrics;
          finalModel = trained;
        } else if (manifestId === 'predictor_node') {
          const trained = inputValue(node, 'trained_model');
          trained.hasPredictor = true;
          output = trained;
          finalModel = trained;
        } else {
          throw new Error(`${node.data.manifest.name.en} does not have a browser execution backend yet.`);
        }
        outputs.set(node.id, output);
        onNodeStatus([node.id], 'success');
      }
      if (!finalModel) throw new Error('Pipeline did not produce a trained model.');
      const { test, ...persistableModel } = finalModel;
      onModel(persistableModel);
    } catch (error) {
      setGraphError(error.message);
      if (currentNode) onNodeStatus([currentNode.id], 'error');
    } finally {
      setRunning(false);
    }
  };

  const tryPrediction = () => {
    if (!model?.hasPredictor) return;
    const raw = model.featureColumns.map((column) => inputs[column]);
    const isMissing = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
    if (raw.some(isMissing)) { setPrediction('Please enter every feature.'); return; }
    const x = raw.map(Number);
    if (!x.every(Number.isFinite)) { setPrediction('Every feature must be numeric.'); return; }
    const { xMeans, xStds, yMean, yStd } = model.normalization;
    const normalizedPrediction = model.weights.reduce((sum, weight, feature) => sum + weight * ((x[feature] - xMeans[feature]) / xStds[feature]), model.bias);
    setPrediction(normalizedPrediction * yStd + yMean);
  };

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={onClose}>
    <section className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-black">{t({ en: 'Execute visual pipeline', zh: '执行可视化管线' })}</h2><p className="mt-1 text-sm text-slate-500">Only connected components are compiled and run.</p></div><button className="rounded-full p-2 hover:bg-slate-100" onClick={onClose}>✕</button></div>
      {planNames.length > 0 && <div className="mt-4 flex flex-wrap items-center gap-1 text-xs">{planNames.map((name, index) => <React.Fragment key={`${name}-${index}`}><span className="rounded-full bg-slate-100 px-2 py-1 font-bold">{name}</span>{index < planNames.length - 1 && <span className="text-slate-300">→</span>}</React.Fragment>)}</div>}
      {graphError && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">⚠ {graphError}</div>}
      {!dataset ? <div className="mt-6 rounded-3xl border-2 border-dashed p-10 text-center"><p className="text-slate-500">The connected Tabular Data node needs a dataset.</p><button onClick={() => { onClose(); onOpenData(); }} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 font-bold text-white">Open data workspace</button></div> : <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div><div className="rounded-2xl bg-slate-50 p-4"><p className="font-black">{dataset.name}</p><p className="mt-1 text-xs text-slate-500">{dataset.featureColumns.join(', ')} → {dataset.targetColumn}</p></div><div className="mt-4"><LossChart values={losses} /></div><button disabled={running || !dataset.featureColumns.length || Boolean(graphError)} onClick={run} className="mt-4 w-full rounded-2xl bg-emerald-600 px-4 py-3 font-bold text-white disabled:opacity-50">{running ? 'Executing graph…' : model ? '↻ Execute again' : '▶ Execute connected pipeline'}</button></div>
        <div className="space-y-4">{model ? <>{model.metrics ? <div><h3 className="font-black">Evaluation node output</h3><div className="mt-2 grid grid-cols-2 gap-2">{Object.entries(model.metrics).map(([key, value]) => <div key={key} className="rounded-2xl bg-slate-100 p-3"><p className="text-[10px] uppercase text-slate-500">{key}</p><p className="mt-1 font-mono font-bold">{typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(4) : value}</p></div>)}</div></div> : <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-700">Connect an Evaluate Regression node to produce test metrics.</div>}{model.hasPredictor ? <div className="rounded-2xl border p-4"><h3 className="font-black">Predictor node output</h3><div className="mt-3 grid grid-cols-2 gap-2">{model.featureColumns.map((column) => <label key={column} className="text-xs font-bold">{column}<input type="number" inputMode="decimal" value={inputs[column] ?? ''} onChange={(event) => setInputs({ ...inputs, [column]: event.target.value })} className="mt-1 w-full rounded-xl border p-2 font-mono" /></label>)}</div><button onClick={tryPrediction} className="mt-3 w-full rounded-xl bg-blue-600 px-3 py-2 font-bold text-white">Predict {model.targetColumn}</button>{prediction !== null && <div className="mt-3 rounded-xl bg-blue-50 p-4 text-center"><p className="text-xs text-blue-600">Prediction</p><p className="mt-1 text-2xl font-black">{typeof prediction === 'number' ? prediction.toFixed(4) : prediction}</p></div>}</div> : <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-700">Connect an Interactive Predictor node to enable manual inference.</div>}<p className="text-xs text-slate-400">Weights belong to Gradient Descent node {model.sourceNodeId} and are saved in project JSON.</p></> : <div className="grid min-h-64 place-items-center rounded-3xl bg-slate-50 p-6 text-center text-slate-400"><div><p className="text-4xl">⌁</p><p className="mt-3">Execute a valid connected graph to produce outputs.</p></div></div>}</div>
      </div>}
    </section>
  </div>;
}
function Workspace() {
  const { primary, secondary, setLanguages, t } = useVividTranslation();
  const initialGraph = useMemo(() => makeDefaultGraph(), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph.edges);
  const [selectedId, setSelectedId] = useState(nodes[0]?.id);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(340);
  const [libraryMode, setLibraryMode] = useState('detailed');
  const [query, setQuery] = useState('');
  const [languageOpen, setLanguageOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [dataset, setDataset] = useState(null);
  const [model, setModel] = useState(null);
  const [pendingConnection, setPendingConnection] = useState(null);
  const [notice, setNotice] = useState('');
  const importRef = useRef(null);
  const selectedNode = nodes.find((node) => node.id === selectedId) ?? nodes[0];
  const filteredPlugins = useMemo(() => pluginRegistry.filter((plugin) => {
    const haystack = [plugin.category, ...Object.values(plugin.name), ...Object.values(plugin.description)].join(' ').toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [query]);
  const grouped = useMemo(() => filteredPlugins.reduce((acc, plugin) => ({ ...acc, [plugin.category]: [...(acc[plugin.category] ?? []), plugin] }), {}), [filteredPlugins]);
  const isValidConnection = useCallback((connection) => {
    const source = nodes.find((node) => node.id === connection.source);
    const target = nodes.find((node) => node.id === connection.target);
    const output = source && resolvePort(source.data.manifest, 'output', connection.sourceHandle);
    const input = target && resolvePort(target.data.manifest, 'input', connection.targetHandle);
    return Boolean(output && input && output.type === input.type && connection.source !== connection.target);
  }, [nodes]);
  const onConnect = useCallback((connection) => {
    if (!isValidConnection(connection)) { setNotice(t({ en: 'These port types are incompatible', zh: '这些端口类型不兼容' })); return; }
    setEdges((current) => addEdge({ ...connection, type: 'smoothstep' }, current));
    setPendingConnection(null);
    setModel(null);
  }, [isValidConnection, setEdges, t]);
  const onPortTap = useCallback(({ direction, nodeId, port }) => {
    if (direction === 'output') {
      setPendingConnection((current) => current?.nodeId === nodeId && current?.port.name === port.name ? null : { nodeId, port, type: port.type });
      return;
    }
    if (!pendingConnection) { setNotice(t({ en: 'Tap an output port first', zh: '请先点按一个输出端口' })); return; }
    const connection = { source: pendingConnection.nodeId, sourceHandle: pendingConnection.port.name, target: nodeId, targetHandle: port.name };
    if (!isValidConnection(connection)) { setNotice(`${t({ en: 'Incompatible port types', zh: '端口类型不兼容' })}: ${pendingConnection.type} → ${port.type}`); return; }
    setEdges((current) => addEdge({ ...connection, id: `tap-${crypto.randomUUID()}`, type: 'smoothstep' }, current.filter((edge) => !(edge.target === nodeId && edge.targetHandle === port.name))));
    setPendingConnection(null);
    setModel(null);
    setNotice(t({ en: 'Components connected', zh: '组件已连接' }));
  }, [pendingConnection, isValidConnection, setEdges, t]);
  const handleEdgesChange = useCallback((changes) => {
    if (changes.some((change) => change.type === 'remove' || change.type === 'add')) setModel(null);
    onEdgesChange(changes);
  }, [onEdgesChange]);
  const handleNodesChange = useCallback((changes) => {
    if (changes.some((change) => change.type === 'remove' || change.type === 'add')) setModel(null);
    onNodesChange(changes);
  }, [onNodesChange]);
  const setNodeStatus = useCallback((ids, status) => setNodes((current) => current.map((node) => ids.includes(node.id) ? { ...node, data: { ...node.data, status } } : node)), [setNodes]);
  const addPluginNode = (manifest) => { const node = createNode(manifest, nodes.length); setNodes((current) => [...current, node]); setSelectedId(node.id); setModel(null); };
  const updateParameter = (key, value) => { setNodes((current) => current.map((node) => node.id === selectedNode?.id ? { ...node, data: { ...node.data, parameters: { ...node.data.parameters, [key]: value }, status: 'idle' } } : node)); setModel(null); };
  const exportCode = () => downloadText('volk_ml_pipeline.py', compilePipelineToPyTorch(nodes, edges), 'text/x-python');
  const exportProject = () => {
    const project = { format: 'VOLK-ML', version: PROJECT_VERSION, savedAt: new Date().toISOString(), language: { primary, secondary }, workspace: { libraryMode, leftWidth, rightWidth }, graph: { nodes, edges }, data: dataset, trainedModel: model };
    downloadText('volk_ml_project.json', JSON.stringify(project, null, 2), 'application/json');
    setNotice(t({ en: 'Project JSON saved', zh: '项目 JSON 已保存' }));
  };
  const importProject = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const project = JSON.parse(await file.text());
      if (project.format !== 'VOLK-ML' || !Array.isArray(project.graph?.nodes) || !Array.isArray(project.graph?.edges)) throw new Error('Invalid VOLK-ML project');
      const restoredNodes = project.graph.nodes.map((node) => {
        const manifestId = node.data?.manifest?.id;
        const currentManifest = pluginRegistry.find((plugin) => plugin.id === manifestId) ?? node.data?.manifest;
        if (!currentManifest) throw new Error(`Unknown component: ${manifestId}`);
        return { ...node, type: 'pipelineNode', data: { ...node.data, label: currentManifest.name, manifest: currentManifest, parameters: { ...defaults(currentManifest), ...node.data?.parameters } } };
      });
      setNodes(restoredNodes);
      setEdges(project.graph.edges);
      setSelectedId(restoredNodes[0]?.id);
      if (project.language?.primary) setLanguages(project.language);
      if (project.workspace?.libraryMode) setLibraryMode(project.workspace.libraryMode);
      if (Number.isFinite(project.workspace?.leftWidth)) setLeftWidth(project.workspace.leftWidth);
      if (Number.isFinite(project.workspace?.rightWidth)) setRightWidth(project.workspace.rightWidth);
      setDataset(project.data ?? null);
      setModel(project.trainedModel ?? null);
      setNotice(t({ en: 'Project imported successfully', zh: '项目导入成功' }));
    } catch (error) {
      setNotice(`${t({ en: 'Import failed', zh: '导入失败' })}: ${error.message}`);
    }
  };
  const startResize = (side, event) => {
    event.preventDefault();
    const startX = event.clientX;
    const initial = side === 'left' ? leftWidth : rightWidth;
    const move = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = initial + (side === 'left' ? delta : -delta);
      (side === 'left' ? setLeftWidth : setRightWidth)(Math.min(520, Math.max(220, next)));
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const asideBase = 'fixed bottom-3 top-[76px] z-30 overflow-auto rounded-3xl border border-white/80 bg-white/95 p-4 shadow-2xl backdrop-blur transition-transform lg:static lg:z-auto lg:h-auto lg:rounded-3xl lg:bg-white/85 lg:shadow-xl';
  return <div className="flex h-[100dvh] flex-col overflow-hidden bg-gradient-to-br from-sky-50 via-white to-indigo-100">
    <header className="z-40 flex min-h-[64px] items-center justify-between gap-3 border-b border-white/70 bg-white/90 px-3 py-2 shadow-sm backdrop-blur sm:px-5">
      <div className="min-w-0"><h1 className="text-xl font-black text-slate-950 sm:text-2xl">VOLK-ML</h1><p className="hidden truncate text-xs text-slate-600 sm:block">{t({ en: 'Visual bridges for PyTorch & TensorFlow', zh: '连接 PyTorch 与 TensorFlow 的可视化桥梁' })}</p></div>
      <nav className="flex items-center gap-1.5 overflow-x-auto text-sm">
        <button className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={() => setLeftOpen((value) => !value)}>☰ <span className="hidden sm:inline">Blocks</span></button>
        <button className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={() => setRightOpen((value) => !value)}>⚙ <span className="hidden sm:inline">Params</span></button>
        <button className={`rounded-xl px-3 py-2 font-bold ${dataset ? 'bg-blue-100 text-blue-700' : 'bg-slate-100'}`} onClick={() => setDataOpen(true)}>▦ <span className="hidden sm:inline">Data</span></button>
        <button className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={exportProject}>↓ <span className="hidden md:inline">JSON</span></button>
        <button className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={() => importRef.current?.click()}>↑ <span className="hidden md:inline">Import</span></button>
        <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={importProject} />
        <button className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={() => setLanguageOpen(true)}>文</button>
        <button className="rounded-xl bg-emerald-600 px-3 py-2 font-bold text-white" onClick={() => setRunnerOpen(true)}>▶ <span className="hidden sm:inline">Run</span></button>
      </nav>
    </header>

    <main className="relative grid min-h-0 flex-1 grid-cols-[0_minmax(0,1fr)_0] gap-3 p-3 lg:grid-cols-[var(--left-panel)_minmax(0,1fr)_var(--right-panel)]" style={{ '--left-panel': `${leftOpen ? leftWidth : 0}px`, '--right-panel': `${rightOpen ? rightWidth : 0}px` }}>
      <motion.aside initial={false} animate={{ x: leftOpen ? 0 : '-110%' }} style={{ width: `min(${leftWidth}px, calc(100vw - 24px))` }} className={`${asideBase} left-3 lg:transform-none ${leftOpen ? 'lg:block' : 'lg:hidden'}`}>
        <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-black">{t({ en: 'Components', zh: '组件库' })}</h2><button className="rounded-lg p-2 hover:bg-slate-100" onClick={() => setLeftOpen(false)}>✕</button></div>
        <div className="mt-3 flex gap-2"><div className="relative min-w-0 flex-1"><span className="absolute left-3 top-2.5">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t({ en: 'Search components', zh: '搜索组件' })} className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500" /></div><button className="rounded-xl border px-3 text-sm font-bold" onClick={() => setLibraryMode((mode) => mode === 'compact' ? 'detailed' : 'compact')}>{libraryMode === 'compact' ? '☷' : '≡'}</button></div>
        <label className="mt-3 flex items-center gap-3 text-xs text-slate-500"><span>Width</span><input type="range" min="220" max="520" value={leftWidth} onChange={(event) => setLeftWidth(Number(event.target.value))} className="min-w-0 flex-1 accent-blue-600" /><span>{leftWidth}px</span></label>
        <p className="mt-2 text-xs text-slate-400">{filteredPlugins.length} components · {libraryMode}</p>
        <div className="mt-4 space-y-5">{Object.entries(grouped).map(([category, plugins]) => <section key={category}><h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">{category}</h3><div className="space-y-2">{plugins.map((plugin) => <button key={plugin.id} onClick={() => addPluginNode(plugin)} className={`w-full rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:border-blue-400 hover:shadow-md ${libraryMode === 'compact' ? 'px-3 py-2' : 'p-3'}`}><span className="block break-words font-semibold text-slate-900">{t(plugin.name)}</span>{libraryMode === 'detailed' && <span className="mt-1 block break-words text-xs text-slate-500">{t(plugin.description)}</span>}</button>)}</div></section>)}</div>
        <div className="absolute bottom-8 right-0 top-8 hidden w-2 cursor-col-resize touch-none lg:block" onPointerDown={(event) => startResize('left', event)} />
      </motion.aside>

      <section className="relative col-start-2 overflow-hidden rounded-3xl border border-white/80 bg-white shadow-xl">
        {pendingConnection && <div className="absolute left-1/2 top-3 z-20 flex max-w-[calc(100%_-_24px)] -translate-x-1/2 items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-xs font-bold text-white shadow-xl"><span className="truncate">{pendingConnection.port.name}: {pendingConnection.type} → {t({ en: 'tap a matching input', zh: '点按匹配的输入端口' })}</span><button className="nodrag rounded-full bg-white/20 px-2 py-1" onClick={() => setPendingConnection(null)}>✕</button></div>}
        <ConnectionContext.Provider value={{ pendingConnection, onPortTap }}><ReactFlow nodes={nodes} edges={edges} onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange} onConnect={onConnect} isValidConnection={isValidConnection} onNodeClick={(_, node) => setSelectedId(node.id)} nodeTypes={{ pipelineNode: PipelineNode }} fitView><Background /><MiniMap pannable zoomable /><Controls /></ReactFlow></ConnectionContext.Provider>
      </section>

      <motion.aside initial={false} animate={{ x: rightOpen ? 0 : '110%' }} style={{ width: `min(${rightWidth}px, calc(100vw - 24px))` }} className={`${asideBase} right-3 lg:transform-none ${rightOpen ? 'lg:block' : 'lg:hidden'}`}>
        <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-black">{t({ en: 'Parameters', zh: '参数设置' })}</h2><button className="rounded-lg p-2 hover:bg-slate-100" onClick={() => setRightOpen(false)}>✕</button></div>
        <label className="mt-3 flex items-center gap-3 text-xs text-slate-500"><span>Width</span><input type="range" min="220" max="520" value={rightWidth} onChange={(event) => setRightWidth(Number(event.target.value))} className="min-w-0 flex-1 accent-blue-600" /><span>{rightWidth}px</span></label>
        {selectedNode ? <div className="mt-4 space-y-5"><div className="rounded-2xl bg-blue-50 p-4"><p className="text-xs font-bold uppercase text-blue-600">{selectedNode.data.manifest.category}</p><h3 className="break-words text-xl font-black text-slate-900">{t(selectedNode.data.label)}</h3></div>{selectedNode.data.manifest.properties.map((property) => <label key={property.key} className="block rounded-2xl border border-slate-200 bg-white p-4"><span className="block break-words text-sm font-bold text-slate-800">{t(property.label)}</span><input className="mt-3 w-full accent-blue-600" type={property.type === 'slider' ? 'range' : 'text'} min={property.min} max={property.max} step={property.step} value={selectedNode.data.parameters[property.key]} onChange={(event) => updateParameter(property.key, property.type === 'text' ? event.target.value : Number(event.target.value))} /><span className="mt-2 block text-sm text-slate-500">{selectedNode.data.parameters[property.key]}</span></label>)}<button onClick={exportCode} className="w-full rounded-2xl bg-slate-950 px-4 py-3 font-bold text-white shadow-lg transition hover:bg-blue-700">🛠️ {t({ en: 'Export PyTorch Code', zh: '导出 PyTorch 代码' })}</button></div> : <p className="mt-6 text-sm text-slate-500">Select a component to edit it.</p>}
        <div className="absolute bottom-8 left-0 top-8 hidden w-2 cursor-col-resize touch-none lg:block" onPointerDown={(event) => startResize('right', event)} />
      </motion.aside>
    </main>
    {notice && <button onClick={() => setNotice('')} className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-2xl">{notice} · ✕</button>}
    <LanguageDialog open={languageOpen} onClose={() => setLanguageOpen(false)} />
    <DataDialog open={dataOpen} onClose={() => setDataOpen(false)} dataset={dataset} onDataset={(nextDataset) => { setDataset(nextDataset); setModel(null); }} />
    <RunnerDialog open={runnerOpen} onClose={() => setRunnerOpen(false)} nodes={nodes} edges={edges} dataset={dataset} model={model} onModel={setModel} onOpenData={() => setDataOpen(true)} onNodeStatus={setNodeStatus} />
  </div>;
}

createRoot(document.getElementById('root')).render(<LanguageProvider><Workspace /></LanguageProvider>);
