import React, { useEffect, useMemo, useRef } from 'react';
import { Background, Handle, Position, ReactFlow } from '@xyflow/react';
import VisualGlyph from '../VisualGlyph.jsx';
import { stageForManifest, stageStyles, visualKindForManifest } from '../../core/visualLanguage.js';

const producerKey = (producer) => ({
  'build-agent': 'graphApply.producer.buildAgent',
  'volk-project': 'graphApply.producer.volkProject',
  'external-agent': 'graphApply.producer.externalAgent',
  'human-import': 'graphApply.producer.humanImport',
  'onnx-adapter': 'graphApply.producer.onnx',
  'torch-export-adapter': 'graphApply.producer.torchExport',
  'torch-fx-adapter': 'graphApply.producer.torchFx',
  'tensorflow-adapter': 'graphApply.producer.tensorflow',
  'keras-adapter': 'graphApply.producer.keras',
  'unknown-import': 'graphApply.producer.unknown',
}[producer] ?? 'graphApply.producer.unknown');

const valueKey = (value) => `graphApply.value.${value}`;

function ProposalNode({ data }) {
  const manifest = data.manifest;
  const stage = stageForManifest(manifest);
  const style = stageStyles[stage];
  const properties = Object.entries(data.parameters ?? {}).slice(0, 8);
  return <div data-graph-preview-node className={`relative min-w-56 max-w-80 overflow-hidden rounded-2xl border-2 bg-white shadow-md ${style.border}`} style={manifest.color ? { borderColor: manifest.color } : undefined}>
    {manifest.inputs.map((input, index) => <Handle key={input.name} type="target" position={Position.Left} id={input.name} isConnectable={false} style={{ top: 52 + index * 28 }} />)}
    <div className="grid grid-cols-[minmax(0,1fr)_28%]">
      <div className="min-w-0 p-3">
        <p className={`text-[10px] font-bold uppercase tracking-wide ${style.text}`}>{data.t(`category.${manifest.category}`)}</p>
        <h3 className="mt-1 break-words text-sm font-black text-slate-900">{data.t(data.label ?? manifest.name)}</h3>
        <p className="mt-1 line-clamp-2 text-xs text-slate-600">{data.t(manifest.description)}</p>
        {properties.length > 0 && <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 border-t border-slate-100 pt-2 text-[10px] text-slate-500">
          {properties.map(([key, value]) => <React.Fragment key={key}><dt className="truncate font-semibold">{key}</dt><dd className="truncate text-right font-mono">{String(value)}</dd></React.Fragment>)}
        </dl>}
        <div className="mt-2 flex flex-wrap gap-1">
          {manifest.inputs.map((port) => <span key={`in:${port.name}`} className="rounded-full bg-blue-50 px-2 py-1 text-[9px] font-bold text-blue-700">◀ {port.name}</span>)}
          {manifest.outputs.map((port) => <span key={`out:${port.name}`} className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-700">{port.name} ▶</span>)}
        </div>
      </div>
      <div className={`grid min-h-36 place-items-center border-l border-slate-100 p-1 ${style.soft}`} style={manifest.color ? { backgroundColor: `${manifest.color}18` } : undefined}>
        <VisualGlyph kind={visualKindForManifest(manifest)} className="h-full w-full" />
      </div>
    </div>
    {manifest.outputs.map((output, index) => <Handle key={output.name} type="source" position={Position.Right} id={output.name} isConnectable={false} style={{ top: 52 + index * 28 }} />)}
  </div>;
}

function applyDiagnosticKey(diagnostic) {
  const known = new Set([
    'GRAPH_APPLY_WORKSPACE_BUSY',
    'GRAPH_APPLY_DATASET_REQUIRED',
    'TARGET_WORKSPACE_NOT_EMPTY',
    'GRAPH_APPLY_COMPONENT_DEFINITION_COLLISION',
    'GRAPH_APPLY_PROJECT_INVALID',
    'GRAPH_APPLY_WORKSPACE_CHANGED',
    'GRAPH_APPLY_PREPARATION_INVALID',
    'BUILD_DATASET_STALE',
    'BUILD_PROPOSAL_DATASET_SELECTION_INVALID',
  ]);
  return known.has(diagnostic?.code) ? `graphApply.reason.${diagnostic.code}` : 'graphApply.reason.generic';
}

function uniqueWarnings(conversion = {}) {
  return [...new Set([
    ...(conversion.warnings ?? []),
    ...(conversion.approximated ?? []).map((value) => `APPROXIMATED:${value}`),
    ...(conversion.missing ?? []).map((value) => `MISSING:${value}`),
    ...(conversion.unsupported ?? []).map((value) => `UNSUPPORTED:${value}`),
  ])];
}

export default function GraphProposalPreview({ proposal, applyEligibility, onCancel, onApply, t }) {
  const cancelRef = useRef(null);
  const nodes = useMemo(() => proposal.graph.nodes.map((node) => ({
    ...node,
    type: 'proposalPreview',
    selected: false,
    draggable: false,
    connectable: false,
    data: { ...node.data, t },
  })), [proposal.graph.nodes, t]);
  const edges = useMemo(() => proposal.graph.edges.map((edge) => ({
    ...edge,
    type: 'default',
    selectable: false,
    style: { stroke: '#64748b', strokeWidth: 2 },
  })), [proposal.graph.edges]);
  const componentSummary = useMemo(() => {
    const counts = new Map();
    proposal.graph.nodes.forEach((node) => counts.set(node.data.manifest.id, (counts.get(node.data.manifest.id) ?? 0) + 1));
    return [...counts.entries()].map(([componentId, count]) => ({
      componentId,
      count,
      name: proposal.graph.nodes.find((node) => node.data.manifest.id === componentId)?.data.label,
    }));
  }, [proposal.graph.nodes]);
  const warnings = useMemo(() => uniqueWarnings(proposal.conversion), [proposal.conversion]);
  const diagnostic = applyEligibility?.diagnostics?.[0] ?? null;
  const datasetBoundCapabilities = applyEligibility?.preparation?.datasetBoundCapabilities;

  useEffect(() => {
    cancelRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/60 p-2 sm:p-5" data-graph-proposal-preview data-apply-block-code={diagnostic?.code ?? ''}>
    <section role="dialog" aria-modal="true" aria-labelledby="graph-proposal-title" className="flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:max-h-[92dvh]">
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 p-4 sm:p-6">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">{t('graphApply.title')}</p>
          <h2 id="graph-proposal-title" className="mt-1 text-xl font-black text-slate-950 sm:text-2xl">{t('graphApply.heading')}</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{t('graphApply.description')}</p>
        </div>
        <button ref={cancelRef} type="button" data-graph-proposal-cancel aria-label={t('graphApply.cancel')} onClick={onCancel} className="shrink-0 rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200">{t('graphApply.cancel')}</button>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.8fr)] lg:p-6">
        <div className="min-h-64 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50" data-graph-proposal-readonly="true" aria-label={t('graphApply.readOnlyGraph')}>
          {nodes.length > 0 ? <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={{ proposalPreview: ProposalNode }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            selectNodesOnDrag={false}
            panOnDrag={false}
            panOnScroll={false}
            zoomOnScroll={false}
            zoomOnDoubleClick={false}
            preventScrolling
            fitView
            fitViewOptions={{ padding: 0.16, minZoom: 0.25, maxZoom: 0.9 }}
            minZoom={0.15}
            maxZoom={1}
            proOptions={{ hideAttribution: true }}
          ><Background gap={24} size={1} color="#cbd5e1" /></ReactFlow> : <div className="grid h-full min-h-64 place-items-center p-6 text-sm text-slate-500">{t('graphApply.emptyGraph')}</div>}
        </div>

        <div className="space-y-3">
          <section className="rounded-2xl border border-slate-200 p-4">
            <h3 className="font-black text-slate-900">{t('graphApply.proposalDetails')}</h3>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
              <dt className="font-semibold text-slate-500">{t('graphApply.source')}</dt><dd className="break-words font-bold text-slate-800">{t(producerKey(proposal.source.producer))} · {proposal.source.format}</dd>
              <dt className="font-semibold text-slate-500">{t('graphApply.fidelity')}</dt><dd className="font-bold text-slate-800">{t(valueKey(proposal.conversion.fidelity))}</dd>
              <dt className="font-semibold text-slate-500">{t('graphApply.verification')}</dt><dd className="font-bold text-slate-800">{t(valueKey(proposal.conversion.verification))}</dd>
              <dt className="font-semibold text-slate-500">{t('graphApply.graphSize')}</dt><dd className="font-bold text-slate-800">{t('graphApply.graphSizeValue', { nodes: nodes.length, edges: edges.length })}</dd>
              <dt className="font-semibold text-slate-500">{t('graphApply.browser')}</dt><dd className="font-bold text-slate-800">{t(valueKey(datasetBoundCapabilities?.browserExecution?.status ?? proposal.capabilitySnapshot.browserExecution.status))}</dd>
              <dt className="font-semibold text-slate-500">{t('graphApply.pytorch')}</dt><dd className="font-bold text-slate-800">{t(valueKey(proposal.capabilitySnapshot.compilers.pytorch.status))}</dd>
              <dt className="font-semibold text-slate-500">{t('graphApply.tensorflow')}</dt><dd className="font-bold text-slate-800">{t(valueKey(proposal.capabilitySnapshot.compilers.tensorflow.status))}</dd>
            </dl>
            <p className="mt-3 text-[11px] text-slate-500">{t('graphApply.sourceNote')}</p>
          </section>

          <section className="rounded-2xl border border-slate-200 p-4">
            <h3 className="font-black text-slate-900">{t('graphApply.components')}</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">{componentSummary.map((item) => <span key={item.componentId} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{t(item.name)}{item.count > 1 ? ` × ${item.count}` : ''}</span>)}</div>
          </section>

          {proposal.source.producer === 'build-agent' && <section className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
            <h3 className="font-black text-slate-900">{t('graphApply.buildAgentDetails')}</h3>
            {proposal.source.datasetBinding && <p className="mt-2 break-words text-xs text-slate-700">{t('graphApply.datasetBinding', { features: proposal.source.datasetBinding.featureColumns.join(', '), target: proposal.source.datasetBinding.targetColumn })}</p>}
            {proposal.source.rationale?.length > 0 && <div className="mt-3"><p className="text-xs font-bold text-slate-600">{t('graphApply.rationale')}</p><ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-700">{proposal.source.rationale.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></div>}
            {proposal.source.limitations?.length > 0 && <div className="mt-3"><p className="text-xs font-bold text-slate-600">{t('graphApply.limitations')}</p><ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-700">{proposal.source.limitations.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></div>}
          </section>}

          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <h3 className="font-black text-slate-900">{t('graphApply.warnings')}</h3>
            {warnings.length > 0 ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-900">{warnings.map((warning) => <li key={warning} className="break-words font-mono">{warning}</li>)}</ul> : <p className="mt-1 text-xs text-amber-900">{t('graphApply.noWarnings')}</p>}
          </section>

          <section className={`rounded-2xl border p-4 ${applyEligibility?.ok ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`} aria-live="polite">
            <h3 className="font-black text-slate-900">{t('graphApply.applyEligibility')}</h3>
            <p className="mt-1 text-sm font-bold">{applyEligibility?.ok ? t('graphApply.eligible') : t('graphApply.blocked')}</p>
            {!applyEligibility?.ok && <p className="mt-1 text-xs text-slate-700">{t(applyDiagnosticKey(diagnostic))}</p>}
          </section>
        </div>
      </div>

      <footer className="flex flex-col-reverse gap-2 border-t border-slate-100 p-4 sm:flex-row sm:justify-end sm:p-5">
        <button type="button" data-graph-proposal-cancel onClick={onCancel} className="rounded-xl bg-slate-100 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-200">{t('graphApply.cancel')}</button>
        <button type="button" data-graph-proposal-apply disabled={!applyEligibility?.ok} onClick={onApply} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">{t('graphApply.apply')}</button>
      </footer>
    </section>
  </div>;
}
