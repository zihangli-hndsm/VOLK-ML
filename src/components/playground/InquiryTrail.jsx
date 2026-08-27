export default function InquiryTrail({ entries = [], episodes = [], compact = false, t }) {
  if (entries.length === 0 && episodes.length === 0) return null;
  return <section data-inquiry-trail="true" className={`rounded-2xl border border-slate-200 bg-white p-3 ${compact ? 'text-[11px]' : ''}`} aria-label={t('playground.inquiryTrail.ariaLabel')}>
    <div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{t('playground.inquiryTrail.kicker')}</p><h3 className="text-sm font-black text-slate-950">{t('playground.inquiryTrail.title')}</h3></div><span className="rounded-full bg-cyan-50 px-2 py-1 text-[10px] font-black text-cyan-800">{entries.length}</span></div>
    <ol className="mt-3 space-y-2" aria-label={t('playground.inquiryTrail.listLabel')}>
      {entries.map((entry, index) => <li key={entry.id} data-inquiry-trail-entry={entry.id} className="flex min-w-0 items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 px-2 py-2"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-600 text-[10px] font-black text-white">{index + 1}</span><div className="min-w-0"><p className="text-xs font-black text-slate-800">{t(entry.titleKey)}</p>{entry.sourceIds.length > 0 && <p className="mt-0.5 break-words text-[10px] text-slate-500">{t('playground.inquiryTrail.sourceCount', { count: entry.sourceIds.length })}</p>}</div></li>)}
    </ol>
    {episodes.length > 0 && <p className="mt-2 text-[10px] font-bold text-slate-500">{t('playground.inquiryTrail.episodeCount', { count: episodes.length })}</p>}
    <p className="mt-3 text-[11px] text-slate-500">{t('playground.inquiryTrail.boundary')}</p>
  </section>;
}
