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
        {snapshot.model && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">{t(snapshot.model.titleKey)}</span>}
      </p>
    </div>
    <div className="flex items-center gap-2">
      {snapshot.model && <>
        <button onClick={() => onDispatch({ type: 'RUN' })} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white">{t('playground.lifecycle.run')}</button>
        <button onClick={() => onDispatch({ type: 'RESET_LEARNING' })} className="rounded-xl bg-blue-100 px-3 py-2 text-xs font-bold text-blue-700">{t('playground.lifecycle.resetLearning')}</button>
      </>}
      <button onClick={() => onDispatch({ type: 'RESTORE_ORIGINAL_DATA' })} className="rounded-xl bg-rose-100 px-3 py-2 text-xs font-bold text-rose-700">{t('playground.lifecycle.restoreData')}</button>
      {snapshot.model && <button onClick={onPresent} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">{t('playground.presentation.enter')}</button>}
      <button aria-label={t('common.close')} onClick={onClose} className="rounded-full bg-slate-100 px-3 py-2 font-bold text-slate-700">✕</button>
    </div>
  </div>;
}
