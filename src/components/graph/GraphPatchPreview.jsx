import React, { useEffect, useMemo, useRef } from 'react';
import { Background, ReactFlow } from '@xyflow/react';
import { deriveGraphPatchDiff } from '../../core/graph/workspacePatchApply.js';
import { validateGraphPatchProposal } from '../../core/graph/graphPatchProposal.js';

const changeKeys = ['existing', 'removed', 'changed', 'added'];
const changeStyles = {
  existing: { node: 'border-slate-300 bg-white text-slate-800', edge: '#64748b' },
  removed: { node: 'border-rose-400 bg-rose-50 text-rose-900', edge: '#e11d48' },
  changed: { node: 'border-amber-400 bg-amber-50 text-amber-950', edge: '#d97706' },
  added: { node: 'border-emerald-400 bg-emerald-50 text-emerald-950', edge: '#059669' },
};

const diagnosticKeys = new Set([
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

function diagnosticKey(diagnostic) {
  return diagnosticKeys.has(diagnostic?.code)
    ? `graphPatch.reason.${diagnostic.code}`
    : 'graphPatch.reason.generic';
}

function classMap(diff, kind) {
  return new Map(changeKeys.flatMap((change) => diff?.[kind]?.[change]?.map((item) => [item.id, change]) ?? []));
}

function nodeLabel(node, t) {
  return t(node.data?.label ?? node.data?.manifest?.name ?? node.data?.manifest?.id ?? node.id);
}

function DiffNode({ data }) {
  return <div className={`min-w-32 max-w-56 rounded-xl border-2 px-3 py-2 shadow-md ${changeStyles[data.change].node}`} data-graph-patch-node data-change-kind={data.change}>
    <p className="break-words text-xs font-bold">{data.label}</p>
    <p className="mt-1 break-all font-mono text-[9px] opacity-70">{data.id}</p>
    <p className="mt-1 text-[9px] font-bold uppercase">{data.changeLabel}</p>
  </div>;
}

const nodeTypes = { patchDiff: DiffNode };

function ReadOnlyGraph({ graph, diff, side, t }) {
  const changes = classMap(diff, 'nodes');
  const edgeChanges = classMap(diff, 'edges');
  const nodes = (graph?.nodes ?? []).map((node) => {
    const change = changes.get(node.id) ?? 'existing';
    return {
      id: node.id,
      type: 'patchDiff',
      position: node.position,
      draggable: false,
      selectable: false,
      focusable: false,
      data: { id: node.id, label: nodeLabel(node, t), change, changeLabel: t(`graphPatch.${change}`) },
    };
  });
  const edges = (graph?.edges ?? []).map((edge) => {
    const change = edgeChanges.get(edge.id) ?? 'existing';
    return {
      ...edge,
      type: 'default',
      selectable: false,
      focusable: false,
      label: t(`graphPatch.${change}`),
      labelStyle: { fontSize: 9, fontWeight: 700, fill: changeStyles[change].edge },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.92 },
      style: { stroke: changeStyles[change].edge, strokeWidth: change === 'existing' ? 1.5 : 2.5, strokeDasharray: change === 'removed' ? '5 4' : undefined },
    };
  });
  const label = t(side === 'before' ? 'graphPatch.readOnlyBefore' : 'graphPatch.readOnlyAfter');
  return <div className="h-56 min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 sm:h-64" data-graph-patch-readonly="true" aria-label={label} aria-readonly="true">
    {nodes.length > 0 ? <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
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
      fitViewOptions={{ padding: 0.18, minZoom: 0.18, maxZoom: 0.9 }}
      minZoom={0.12}
      maxZoom={1}
      proOptions={{ hideAttribution: true }}
    ><Background gap={24} size={1} color="#cbd5e1" /></ReactFlow> : <div className="grid h-full place-items-center text-sm text-slate-500">{t('graphPatch.noItems')}</div>}
  </div>;
}

function shownValue(value, present, t) {
  if (!present) return t('graphPatch.missingValue');
  if (value === undefined) return t('graphPatch.missingValue');
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function routeLabel(route, t) {
  return t('graphPatch.connectionRoute', route);
}

function DiffItem({ item, kind, change, t }) {
  if (kind === 'node' && change === 'changed') {
    return <li className="rounded-xl border border-slate-200 bg-white p-3" data-patch-item={item.id}>
      <p className="break-words text-xs font-bold text-slate-900">{t(item.label)} <span className="font-mono text-[10px] text-slate-500">{item.id}</span></p>
      {item.parameterChanges?.length > 0 && <div className="mt-2 space-y-1"><p className="text-[10px] font-bold uppercase text-slate-500">{t('graphPatch.parameterChanges')}</p>{item.parameterChanges.map((change) => <div key={change.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 text-[10px]"><span className="break-all font-mono text-slate-500">{change.key}</span><span className="break-all text-right"><span className="text-rose-700">{shownValue(change.before, change.hasBefore, t)}</span><span className="px-1 text-slate-400">→</span><span className="text-emerald-700">{shownValue(change.after, change.hasAfter, t)}</span></span></div>)}</div>}
      {item.moved && <p className="mt-2 text-[10px] text-slate-600">{t('graphPatch.positionChange')}: <span className="font-mono">{JSON.stringify(item.beforePosition)}</span><span className="px-1">→</span><span className="font-mono">{JSON.stringify(item.afterPosition)}</span></p>}
    </li>;
  }
  if (kind === 'edge' && change === 'changed') {
    return <li className="rounded-xl border border-slate-200 bg-white p-3" data-patch-item={item.id}><p className="break-all font-mono text-[10px] font-bold">{item.id}</p><p className="mt-1 break-words text-xs text-rose-700">{routeLabel(item.beforeEndpoint, t)}</p><p className="mt-1 break-words text-xs text-emerald-700">{routeLabel(item.afterEndpoint, t)}</p></li>;
  }
  const route = kind === 'edge' ? routeLabel(item.beforeEndpoint ?? item.afterEndpoint ?? item.endpoint, t) : null;
  return <li className="rounded-xl border border-slate-200 bg-white p-3" data-patch-item={item.id}>
      <p className="break-words text-xs font-bold text-slate-900">{kind === 'node' ? t(item.label) : item.id} <span className="font-mono text-[10px] text-slate-500">{kind === 'node' ? item.id : ''}</span></p>
    {route && <p className="mt-1 break-words text-[10px] text-slate-600">{route}</p>}
  </li>;
}

function DiffBucket({ name, items, kind, t }) {
  return <section className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3" data-patch-diff-group={`${kind}-${name}`}>
    <div className="flex items-center justify-between gap-2">
      <h4 className="text-xs font-black text-slate-900">{t(`graphPatch.${name}`)}</h4>
      <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-600">{t('graphPatch.changeCount', { count: items.length })}</span>
    </div>
    {items.length ? <ul className="mt-2 space-y-2">{items.map((item) => <DiffItem key={item.id} item={item} kind={kind} change={name} t={t} />)}</ul> : <p className="mt-2 text-[10px] text-slate-500">{t('graphPatch.noItems')}</p>}
  </section>;
}

function ChangeGroups({ changes, kind, t }) {
  return <div className="grid min-w-0 gap-2 sm:grid-cols-2">{changeKeys.map((name) => <DiffBucket key={name} name={name} items={changes?.[name] ?? []} kind={kind} t={t} />)}</div>;
}

function operationDescription(operation, t) {
  const detail = operation.nodeId ?? operation.edgeId ?? operation.node?.id ?? operation.edge?.id ?? '';
  const fields = operation.op === 'UPDATE_PARAMETERS' ? Object.keys(operation.parameters ?? {}).join(', ')
    : operation.op === 'MOVE_NODE' ? JSON.stringify(operation.position)
      : operation.op === 'CONNECT' ? operation.edge?.id : '';
  return [detail, fields].filter(Boolean).join(' · ');
}

function safeSourceLabel(producer) {
  return ({
    'local-agent': 'graphPatch.producer.localAgent',
    'external-agent': 'graphPatch.producer.externalAgent',
    human: 'graphPatch.producer.human',
    adapter: 'graphPatch.producer.adapter',
    'project-transform': 'graphPatch.producer.projectTransform',
  })[producer] ?? 'graphPatch.producer.unknown';
}

export default function GraphPatchPreview({ proposal, applyEligibility, onCancel, onApply, t }) {
  const cancelRef = useRef(null);
  const checked = useMemo(() => validateGraphPatchProposal(proposal), [proposal]);
  const diff = useMemo(() => (checked.valid
    ? deriveGraphPatchDiff(proposal.baseGraph, checked.resultGraph, proposal.operations)
    : null), [checked, proposal]);
  const diagnostic = applyEligibility?.diagnostics?.[0] ?? (checked.valid ? null : checked.diagnostics?.[0]);
  const beforeGraph = diff ? proposal.baseGraph : null;
  const afterGraph = diff ? checked.resultGraph : null;

  useEffect(() => {
    cancelRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector('[data-graph-patch-preview] [role="dialog"]');
      const focusable = [...(dialog?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])]
        .filter((element) => !element.hasAttribute('data-reactflow-focusable'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const groupClass = (name) => ({
    existing: 'border-slate-300 bg-slate-50',
    removed: 'border-rose-300 bg-rose-50',
    changed: 'border-amber-300 bg-amber-50',
    added: 'border-emerald-300 bg-emerald-50',
  })[name];

  return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/60 p-1.5 sm:p-5" data-graph-patch-preview data-apply-block-code={diagnostic?.code ?? ''}>
    <section role="dialog" aria-modal="true" aria-labelledby="graph-patch-title" className="flex h-full max-h-[96dvh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:h-auto sm:max-h-[94dvh] sm:rounded-3xl">
      <header className="border-b border-slate-100 p-4 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">{t('graphPatch.title')}</p>
        <h2 id="graph-patch-title" className="mt-1 text-lg font-black text-slate-950 sm:text-2xl">{t('graphPatch.heading')}</h2>
        <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-600 sm:text-sm">{t('graphPatch.description')}</p>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3 sm:p-5">
        {diff ? <>
          <div className="grid gap-3 lg:grid-cols-2">
            <section className="min-w-0 space-y-2"><h3 className="font-black text-slate-900">{t('graphPatch.beforeGraph')}</h3><ReadOnlyGraph graph={beforeGraph} diff={diff} side="before" t={t} /></section>
            <section className="min-w-0 space-y-2"><h3 className="font-black text-slate-900">{t('graphPatch.afterGraph')}</h3><ReadOnlyGraph graph={afterGraph} diff={diff} side="after" t={t} /></section>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="space-y-2" aria-labelledby="graph-patch-node-diff"><h3 id="graph-patch-node-diff" className="font-black text-slate-900">{t('graphPatch.nodeDiff')}</h3><ChangeGroups changes={diff.nodes} kind="node" t={t} /></section>
            <section className="space-y-2" aria-labelledby="graph-patch-edge-diff"><h3 id="graph-patch-edge-diff" className="font-black text-slate-900">{t('graphPatch.edgeDiff')}</h3><ChangeGroups changes={diff.edges} kind="edge" t={t} /></section>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 p-4">
              <h3 className="font-black text-slate-900">{t('graphPatch.source')}</h3>
              <p className="mt-1 break-words text-xs text-slate-700">{t(safeSourceLabel(proposal.source.producer))}{proposal.source.provenance?.artifactId ? ` · ${proposal.source.provenance.artifactId}` : ''}</p>
              <h4 className="mt-3 text-xs font-bold text-slate-600">{t('graphPatch.rationale')}</h4>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{proposal.rationale}</p>
            </section>
            <section className="rounded-2xl border border-slate-200 p-4">
              <h3 className="font-black text-slate-900">{t('graphPatch.operations')}</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-slate-700">{proposal.operations.map((operation, index) => <li key={`${index}:${operation.op}`}><span className="font-bold">{t(`graphPatch.operation.${operation.op}`)}</span>{operationDescription(operation, t) && <span className="ml-1 break-all font-mono">{operationDescription(operation, t)}</span>}</li>)}</ol>
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-[11px] leading-5 text-amber-900">{t('graphPatch.unsupportedNotice')}</p>
            </section>
          </div>
        </> : <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4" role="status"><p className="text-sm font-bold">{t(diagnosticKey(diagnostic))}</p></section>}

        <section className={`rounded-2xl border p-4 ${applyEligibility?.ok ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`} aria-live="polite" data-graph-patch-eligibility>
          <h3 className="font-black text-slate-900">{t('graphPatch.applyEligibility')}</h3>
          <p className="mt-1 text-sm font-bold">{applyEligibility?.ok ? t('graphPatch.eligible') : t('graphPatch.blocked')}</p>
          {!applyEligibility?.ok && <p className="mt-1 text-xs text-slate-700">{t(diagnosticKey(diagnostic))}</p>}
        </section>
      </div>

      <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 p-3 sm:flex-row sm:justify-end sm:p-5">
        <button ref={cancelRef} type="button" data-graph-patch-cancel onClick={onCancel} className="rounded-xl bg-slate-100 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-200">{t('graphPatch.cancel')}</button>
        <button type="button" data-graph-patch-apply disabled={!applyEligibility?.ok} onClick={onApply} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">{t('graphPatch.apply')}</button>
      </footer>
    </section>
  </div>;
}
