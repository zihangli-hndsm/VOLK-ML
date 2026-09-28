import React, { useEffect, useRef, useState } from 'react';

const numeric = (value) => Number.isFinite(value) ? Number(value.toFixed(4)) : null;

export default function ExploreCapacityBridgeDialog({
  open,
  session,
  build,
  projectSessionId,
  onClose,
  onStartNew,
  t,
}) {
  const [snapshot, setSnapshot] = useState(() => session?.getSnapshot() ?? null);
  const firstFocusRef = useRef(null);
  const latestBuildRef = useRef(build);
  latestBuildRef.current = build;

  useEffect(() => {
    if (!session) {
      setSnapshot(null);
      return undefined;
    }
    setSnapshot(session.getSnapshot());
    return session.subscribe(setSnapshot);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    session.reconcileSource(latestBuildRef.current, projectSessionId);
  }, [session, projectSessionId, build.nodes, build.edges, build.dataset, build.customComponents]);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    firstFocusRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open || !session || !snapshot) return null;

  const lifecycle = snapshot.lifecycle;
  const readOnly = ['completed', 'stale', 'closed'].includes(lifecycle);
  const canRun = lifecycle === 'ready' || lifecycle === 'failed';
  const comparison = snapshot.comparison;
  const reasonKey = snapshot.reasonCode ? `explore.capacity.reason.${snapshot.reasonCode}` : null;
  const supportedMetrics = comparison ? Object.entries(comparison.metrics) : [];
  const canStartNew = lifecycle === 'completed'
    || lifecycle === 'stale'
    || lifecycle === 'closed'
    || (lifecycle === 'failed' && Boolean(snapshot.graphIdentity));

  return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/60 p-2 sm:p-5" role="presentation">
    <section
      data-explore-capacity-bridge
      data-lifecycle={lifecycle}
      className="flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2.5rem)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="explore-capacity-title"
      aria-describedby="explore-capacity-description"
    >
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-600">{t('explore.capacity.eyebrow')}</p>
          <h2 id="explore-capacity-title" className="mt-1 text-xl font-black text-slate-950 sm:text-2xl">{t('explore.capacity.title')}</h2>
          <p id="explore-capacity-description" className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{t('explore.capacity.description')}</p>
        </div>
        <button ref={firstFocusRef} type="button" aria-label={t('common.close')} onClick={onClose} className="shrink-0 rounded-xl bg-slate-100 px-3 py-2 font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">✕</button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        {snapshot.reasonCode && <p data-capacity-reason className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          {t(reasonKey)}
          {snapshot.diagnosticCode && <span className="mt-1 block text-xs font-semibold">{t('explore.capacity.diagnostic', { detail: t(snapshot.diagnosticCode) })}</span>}
        </p>}

        {snapshot.dataset && <>
          <section className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2" aria-label={t('explore.capacity.snapshotLabel')}>
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t('explore.capacity.dataTask')}</p>
              <p className="mt-1 font-bold text-slate-900">{t(`buildIntent.task.${snapshot.dataset.task}`)}</p>
              <p className="mt-1 break-words text-sm text-slate-600">{t('explore.capacity.features', { features: snapshot.dataset.features.join(', '), target: snapshot.dataset.target })}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t('explore.capacity.matchedConditions')}</p>
              <p className="mt-1 text-sm leading-6 text-slate-700">{t('explore.capacity.matchedSummary', { seed: snapshot.training.seed, trainRows: snapshot.split.trainRows, testRows: snapshot.split.testRows, epochs: snapshot.training.epochs, batchSize: snapshot.training.batchSize })}</p>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2" aria-label={t('explore.capacity.widthComparison')}>
            <article className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-blue-800">{t('explore.capacity.baseline')}</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{snapshot.capacity.baselineWidth}</p>
              <p className="mt-1 text-sm text-slate-700">{t('explore.capacity.hiddenUnits')}</p>
            </article>
            <article className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
              <label className="block text-xs font-black uppercase tracking-wide text-indigo-800" htmlFor="explore-capacity-variant-width">{t('explore.capacity.variant')}</label>
              <input
                id="explore-capacity-variant-width"
                data-capacity-variant-width
                aria-describedby="explore-capacity-derived-width"
                type="number"
                min={snapshot.capacity.minWidth}
                max={snapshot.capacity.maxWidth}
                step="1"
                value={snapshot.capacity.variantWidth ?? snapshot.capacity.requestedVariantWidth ?? ''}
                disabled={readOnly || lifecycle === 'running'}
                onChange={(event) => session.setVariantWidth(event.target.value === '' ? null : Number(event.target.value))}
                className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-2xl font-black text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100"
              />
              <p className="mt-1 text-sm text-slate-700">{t('explore.capacity.hiddenUnits')}</p>
              <p id="explore-capacity-derived-width" className="mt-2 text-xs leading-5 text-indigo-950">{t('explore.capacity.derivedDimension', { width: snapshot.capacity.variantWidth ?? snapshot.capacity.requestedVariantWidth ?? '' })}</p>
            </article>
          </section>

          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">{t('explore.capacity.interpretationLimit')}</p>

          {lifecycle === 'running' && <p data-capacity-running role="status" aria-live="polite" className="rounded-2xl bg-slate-100 p-4 text-sm font-bold text-slate-700">
            {t(snapshot.activeRun?.stage === 'variant' ? 'explore.capacity.runningVariant' : 'explore.capacity.runningBaseline')}
          </p>}

          {comparison && <section data-capacity-results data-comparison-id={comparison.comparisonId} data-run-ids={comparison.runIds.join(',')} className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-lg font-black text-slate-950">{t('explore.capacity.resultsTitle')}</h3>
                <p className="mt-1 text-xs text-slate-600">{t('explore.capacity.actualRunNote', { runA: comparison.runIds[0], runB: comparison.runIds[1] })}</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-900">{t('explore.capacity.localOnly')}</span>
            </div>
            {supportedMetrics.length > 0 ? <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[26rem] border-separate border-spacing-y-1 text-left text-sm">
                <thead><tr className="text-xs uppercase tracking-wide text-slate-500"><th className="px-2 py-1">{t('explore.capacity.metric')}</th><th className="px-2 py-1">{t('explore.capacity.baseline')}</th><th className="px-2 py-1">{t('explore.capacity.variant')}</th><th className="px-2 py-1">{t('explore.capacity.delta')}</th></tr></thead>
                <tbody>{supportedMetrics.map(([key, values]) => <tr key={key} className="bg-white text-slate-900">
                  <th scope="row" className="rounded-l-lg px-2 py-2 font-bold">{t(`explore.capacity.metric.${key}`)}</th>
                  <td className="px-2 py-2 tabular-nums">{numeric(values.baseline)}</td>
                  <td className="px-2 py-2 tabular-nums">{numeric(values.variant)}</td>
                  <td className="rounded-r-lg px-2 py-2 tabular-nums">{numeric(values.delta)}</td>
                </tr>)}</tbody>
              </table>
            </div> : <p className="mt-4 text-sm text-slate-700">{t('explore.capacity.metricsUnavailable')}</p>}
            <p className="mt-4 text-xs leading-5 text-slate-600">{t('explore.capacity.metricSource')}</p>
          </section>}
        </>}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-4 sm:px-6">
        {lifecycle === 'running'
          ? <button type="button" data-capacity-cancel onClick={() => session.cancel()} className="rounded-xl bg-amber-100 px-4 py-2 font-bold text-amber-950 focus:outline-none focus:ring-2 focus:ring-amber-500">{t('explore.capacity.cancelRun')}</button>
          : canRun && <button type="button" data-capacity-run ref={!snapshot.dataset ? firstFocusRef : undefined} onClick={() => { session.runComparison().catch(() => {}); }} className="rounded-xl bg-indigo-600 px-4 py-2 font-bold text-white focus:outline-none focus:ring-2 focus:ring-indigo-500">{t(lifecycle === 'failed' ? 'explore.capacity.retry' : 'explore.capacity.run')}</button>}
        {canStartNew
          && <button type="button" data-capacity-new-session onClick={onStartNew} className="rounded-xl bg-indigo-100 px-4 py-2 font-bold text-indigo-900 focus:outline-none focus:ring-2 focus:ring-indigo-500">{t('explore.capacity.newComparison')}</button>}
        <button type="button" onClick={onClose} className="rounded-xl bg-slate-100 px-4 py-2 font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500">{t('common.close')}</button>
      </footer>
    </section>
  </div>;
}
