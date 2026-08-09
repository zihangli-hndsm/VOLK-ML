export default function PlaygroundToolbar({ playground, snapshot, onDispatch, onPresent, onClose, t }) {
  const sourceLabel = snapshot.source.kind === 'workspace-dataset'
    ? t('playground.source.workspace', { name: snapshot.source.name })
    : t('playground.source.example');
  return <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 className="text-xl font-black text-slate-950">{t(playground.titleKey)}</h2>
      <p className="mt-1 text-sm text-slate-500">{t(playground.descriptionKey)}</p>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
        {sourceLabel}
        {snapshot.source.stale && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">{t('playground.source.stale')}</span>}
        {snapshot.script && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700">{snapshot.script.id}</span>}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{t('playground.agentReady')}</span>
      </p>
    </div>
    <div className="flex items-center gap-2">
      <button onClick={() => onDispatch({ type: 'RESET' })} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{t('playground.timeline.reset')}</button>
      <button onClick={onPresent} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">{t('playground.presentation.enter')}</button>
      <button aria-label={t('common.close')} onClick={onClose} className="rounded-full bg-slate-100 px-3 py-2 font-bold text-slate-700">✕</button>
    </div>
  </div>;
}
