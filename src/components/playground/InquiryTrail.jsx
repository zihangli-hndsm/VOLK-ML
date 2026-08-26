export default function InquiryTrail({ episodes = [], compact = false, t }) {
  if (episodes.length === 0) return null;
  return <section data-inquiry-trail="true" className={`rounded-2xl border border-slate-200 bg-white p-3 ${compact ? 'text-[11px]' : ''}`} aria-label={t('playground.inquiryTrail.ariaLabel')}>
    <div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{t('playground.inquiryTrail.kicker')}</p><h3 className="text-sm font-black text-slate-950">{t('playground.inquiryTrail.title')}</h3></div><span className="rounded-full bg-cyan-50 px-2 py-1 text-[10px] font-black text-cyan-800">{episodes.length}</span></div>
    <ol className="mt-3 space-y-2" aria-label={t('playground.inquiryTrail.listLabel')}>
      {episodes.map((episode, index) => <li key={episode.id} data-inquiry-episode={episode.id} className="flex min-w-0 items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 px-2 py-2"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-600 text-[10px] font-black text-white">{index + 1}</span><div className="min-w-0"><p className="text-xs font-black text-slate-800">{t(episode.titleKey)}</p>{episode.sourceIds.length > 0 && <p className="mt-0.5 break-words text-[10px] text-slate-500">{t('playground.inquiryTrail.sourceCount', { count: episode.sourceIds.length })}</p>}</div></li>)}
    </ol>
    <p className="mt-3 text-[11px] text-slate-500">{t('playground.inquiryTrail.boundary')}</p>
  </section>;
}
