import { useCallback, useMemo, useState } from 'react';
import { Background, Controls, ReactFlow, addEdge, useEdgesState, useNodesState, type Connection } from '@xyflow/react';
import { motion } from 'framer-motion';
import { LanguageProvider, useVividTranslation } from './context/LanguageContext';
import { compilePipelineToPyTorch } from './compiler/compiler';
import { PipelineNode as PipelineNodeView } from './components/PipelineNode';
import { getDefaultParameters, pluginRegistry } from './plugins/registry';
import type { LanguageMode, PipelineNode, PluginManifest } from './types';

const nodeTypes = { pipelineNode: PipelineNodeView };

function createNode(manifest: PluginManifest, index: number): PipelineNode {
  return {
    id: `${manifest.id}-${crypto.randomUUID()}`,
    type: 'pipelineNode',
    position: { x: 120 + index * 80, y: 90 + index * 70 },
    data: { pluginId: manifest.id, label: manifest.name, manifest, parameters: getDefaultParameters(manifest) },
  };
}

function Workspace() {
  const { mode, setMode, t } = useVividTranslation();
  const [nodes, setNodes, onNodesChange] = useNodesState<PipelineNode>(pluginRegistry.slice(0, 2).map(createNode));
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedId, setSelectedId] = useState(nodes[0]?.id);
  const selectedNode = nodes.find((node) => node.id === selectedId) ?? nodes[0];

  const onConnect = useCallback((connection: Connection) => setEdges((eds) => addEdge(connection, eds)), [setEdges]);

  const addPluginNode = (manifest: PluginManifest) => {
    const node = createNode(manifest, nodes.length);
    setNodes((current) => [...current, node]);
    setSelectedId(node.id);
  };

  const updateParameter = (key: string, value: number | string) => {
    if (!selectedNode) return;
    setNodes((current) => current.map((node) => node.id === selectedNode.id
      ? { ...node, data: { ...node.data, parameters: { ...node.data.parameters, [key]: value } } }
      : node));
  };

  const exportCode = () => {
    const code = compilePipelineToPyTorch(nodes, edges);
    const blob = new Blob([code], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'volk_ml_pipeline.py';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const grouped = useMemo(() => Object.groupBy(pluginRegistry, (plugin) => plugin.category), []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-br from-sky-50 via-white to-indigo-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/70 bg-white/85 px-6 py-4 shadow-sm backdrop-blur">
        <div>
          <h1 className="text-2xl font-black text-slate-950">VOLK-ML</h1>
          <p className="text-sm text-slate-600">{t({ en: 'Vivid Online Learning Kit for Machine Learning', zh: '机器学习可视化在线学习工具包' })}</p>
        </div>
        <div className="flex rounded-full bg-slate-100 p-1 text-sm font-semibold">
          {(['en', 'zh', 'parallel'] as LanguageMode[]).map((option) => (
            <button key={option} onClick={() => setMode(option)} className={`rounded-full px-4 py-2 transition ${mode === option ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:bg-white'}`}>
              {option === 'en' ? 'English' : option === 'zh' ? '中文' : 'Parallel 并行'}
            </button>
          ))}
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_340px] gap-4 p-4">
        <motion.aside initial={{ x: -24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="overflow-auto rounded-3xl border border-white/80 bg-white/85 p-4 shadow-xl">
          <h2 className="text-lg font-bold text-slate-900">{t({ en: 'Playbook & Plugin Blocks', zh: '学习指南与插件模块' })}</h2>
          <p className="mt-2 text-sm text-slate-600">{t({ en: 'Add blocks from discovered manifest folders. New folders under src/plugins appear here automatically.', zh: '从自动发现的 manifest 文件夹添加模块。src/plugins 下的新文件夹会自动显示。' })}</p>
          <div className="mt-4 space-y-5">
            {Object.entries(grouped).map(([category, plugins]) => (
              <section key={category}>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">{category}</h3>
                <div className="space-y-2">
                  {plugins?.map((plugin) => (
                    <button key={plugin.id} onClick={() => addPluginNode(plugin)} className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-blue-400 hover:shadow-md">
                      <span className="block break-words font-semibold text-slate-900">{t(plugin.name)}</span>
                      <span className="mt-1 block break-words text-xs text-slate-500">{t(plugin.description)}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </motion.aside>

        <section className="overflow-hidden rounded-3xl border border-white/80 bg-white shadow-xl">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={(_, node) => setSelectedId(node.id)} nodeTypes={nodeTypes} fitView>
            <Background />
            <Controls />
          </ReactFlow>
        </section>

        <motion.aside initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="overflow-auto rounded-3xl border border-white/80 bg-white/85 p-4 shadow-xl">
          <h2 className="text-lg font-bold text-slate-900">{t({ en: 'Interactive Parameters', zh: '交互参数' })}</h2>
          {selectedNode ? (
            <div className="mt-4 space-y-5">
              <div className="rounded-2xl bg-blue-50 p-4">
                <p className="text-xs font-bold uppercase text-blue-600">{selectedNode.data.manifest.category}</p>
                <h3 className="break-words text-xl font-black text-slate-900">{t(selectedNode.data.label)}</h3>
              </div>
              {selectedNode.data.manifest.properties.map((property) => (
                <label key={property.key} className="block rounded-2xl border border-slate-200 bg-white p-4">
                  <span className="block break-words text-sm font-bold text-slate-800">{t(property.label)}</span>
                  <input className="mt-3 w-full accent-blue-600" type={property.type === 'slider' ? 'range' : 'text'} min={property.min} max={property.max} step={property.step} value={selectedNode.data.parameters[property.key]} onChange={(event) => updateParameter(property.key, property.type === 'text' ? event.target.value : Number(event.target.value))} />
                  <span className="mt-2 block text-sm text-slate-500">{selectedNode.data.parameters[property.key]}</span>
                </label>
              ))}
              <button onClick={exportCode} className="w-full rounded-2xl bg-slate-950 px-4 py-3 font-bold text-white shadow-lg transition hover:bg-blue-700">
                🛠️ {t({ en: 'Export PyTorch Code', zh: '编译为 PyTorch 代码' })}
              </button>
            </div>
          ) : <p className="mt-4 text-sm text-slate-500">{t({ en: 'Select or add a block to edit it.', zh: '选择或添加模块来编辑参数。' })}</p>}
        </motion.aside>
      </main>
    </div>
  );
}

export default function App() {
  return <LanguageProvider><Workspace /></LanguageProvider>;
}
