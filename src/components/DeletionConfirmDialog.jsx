Exit code: 0
Wall time: 0.5 seconds
Output:
import { useEffect, useRef } from 'react';

export default function DeletionConfirmDialog({ summary, onCancel, onConfirm, t }) {
  const cancelRef = useRef(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  if (!summary) return null;
  const title = summary.nodeCount === 1 && summary.edgeCount === 0
    ? t('deletion.nodeTitle', { name: t(summary.nodeNames[0]) })
    : summary.edgeCount === 1 && summary.nodeCount === 0
      ? t('deletion.edgeTitle')
      : t('deletion.multipleTitle', { count: summary.nodeCount + summary.edgeCount });
  const body = summary.nodeCount > 0
    ? t('deletion.nodesBody', { nodes: summary.nodeCount, edges: summary.edgeCount })
    : t('deletion.edgeBody');
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/60 p-4" role="presentation" onMouseDown={onCancel}>
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="deletion-confirm-title"
      className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }}
    >
      <h2 id="deletion-confirm-title" className="text-xl font-black text-slate-950">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">{body}</p>
      {summary.nodeCount > 0 && <p className="mt-2 text-xs text-slate-500">{t('deletion.connectedEdges', { count: summary.edgeCount })}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button ref={cancelRef} onClick={onCancel} className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700">{t('common.cancel')}</button>
        <button onClick={onConfirm} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700">{t('common.delete')}</button>
      </div>
    </section>
  </div>;
}

