export default function LumiExplorationPlannerPanel({ plan, compact = false, t, onAccept }) {
  const suggestions = plan?.suggestions ?? [];
  if (suggestions.length === 0) return null;
  return <section data-lumi-exploration-planner="true" className={`rounded-2xl border border-cyan-200 bg-cyan-50/50 p-3 ${compact ? 'text-[11px]' : ''}`} aria-label={t('playground.lumiPlanner.ariaLabel')}>
    <div className="flex items-center gap-2"><span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-600 text-sm font-black text-white">✦</span><div><p className="text-[10px] font-black uppercase tracking-wide text-cyan-700">{t('playground.lumiPlanner.kicker')}</p><h3 className="text-sm font-black text-cyan-950">{t('playground.lumiPlanner.title')}</h3></div></div>
    <p className="mt-2 text-xs text-cyan-950">{t('playground.lumiPlanner.boundary')}</p>
    <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label={t('playground.lumiPlanner.listLabel')}>
      {suggestions.map((item) => <li key={item.id} data-lumi-suggestion={item.kind} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-cyan-100 bg-white px-3 py-2"><span className="min-w-0 text-xs font-bold text-slate-800">{t(item.reasonKey)}</span><button type="button" onClick={() => onAccept?.(item)} className="shrink-0 rounded-lg border border-cyan-300 bg-cyan-50 px-2 py-1 text-[10px] font-black text-cyan-900 focus:outline-none focus:ring-2 focus:ring-cyan-500">{t('playground.lumiPlanner.open')}</button></li>)}
    </ul>
  </section>;
}
