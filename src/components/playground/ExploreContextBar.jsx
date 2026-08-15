import { useState } from 'react';

export default function ExploreContextBar({ playground, snapshot, onDispatch, onPresent, onClose, t, highlightedAffordances = [] }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const highlight = highlightedAffordances.includes('model.run') ? ' ring-2 ring-amber-400 ring-offset-1' : '';
  const source = snapshot.source ?? {};
  const sourceLabel = source.kind === 'workspace-dataset'
    ? t('playground.source.workspace', { name: source.name })
    : t('playground.source.example');
  const closeMenu = () => setMoreOpen(false);
  return <header data-ui-region="context-bar" aria-label={t('playground.explore.contextBarLabel')} className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
    <div className="flex min-w-0 items-start gap-3">
      <button type="button" aria-label={t('common.close')} onClick={onClose} className="mt-0.5 shrink-0 rounded-xl bg-slate-100 px-3 py-2 font-bold text-slate-700 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500">←</button>
      <div className="min-w-0">
        <h2 className="truncate text-xl font-black text-slate-950">{t(playground.titleKey)}</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">{t(playground.descriptionKey)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
          <span>{sourceLabel}</span>
          {source.stale && <span role="status" className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">{t('playground.source.stale')}</span>}
          {snapshot.script && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700">{snapshot.script.id}</span>}
          {snapshot.model && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">{t(snapshot.model.titleKey)}</span>}
        </div>
      </div>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      {snapshot.model && <button data-affordance-id="model.run" type="button" onClick={() => onDispatch({ type: 'RUN' })} className={`rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500${highlight}`}>{t('playground.lifecycle.run')}</button>}
      <div className="relative">
        <button type="button" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.explore.more')}</button>
        {moreOpen && <div role="menu" aria-label={t('playground.explore.more')} className="absolute right-0 z-10 mt-2 grid min-w-52 gap-1 rounded-2xl border border-slate-200 bg-white p-2 text-left shadow-xl">
          {snapshot.model && <button role="menuitem" type="button" onClick={() => { closeMenu(); onDispatch({ type: 'RESET_LEARNING' }); }} className="rounded-xl px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.lifecycle.resetLearning')}</button>}
          <button role="menuitem" type="button" onClick={() => { closeMenu(); onDispatch({ type: 'RESTORE_ORIGINAL_DATA' }); }} className="rounded-xl px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.lifecycle.restoreData')}</button>
          {snapshot.model && <button role="menuitem" type="button" onClick={() => { closeMenu(); onPresent(); }} className="rounded-xl px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.presentation.enter')}</button>}
        </div>}
      </div>
    </div>
  </header>;
}
