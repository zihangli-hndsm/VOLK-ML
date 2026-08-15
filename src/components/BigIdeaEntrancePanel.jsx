import { listBigIdeaEntrances } from '../core/exploration/bigIdeaRegistry.js';

export default function BigIdeaEntrancePanel({ onOpen, t, variant = 'strip' }) {
  const entries = listBigIdeaEntrances();
  const isHome = variant === 'home';
  return <section data-big-idea-panel={variant} aria-label={t('bigIdea.ariaLabel')} className={isHome ? 'rounded-2xl' : 'relative z-50 max-h-[38vh] shrink-0 overflow-auto border-b border-white/70 bg-white/95 px-3 py-3 backdrop-blur sm:px-5'}>
    <div className={isHome ? '' : 'mx-auto max-w-[1600px]'}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-base font-black text-slate-950 sm:text-lg">{t('bigIdea.sectionTitle')}</h2>
        <p className="text-xs text-slate-600 sm:max-w-md sm:text-right">{t('bigIdea.sectionSubtitle')}</p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {entries.map((entry) => <button
          key={entry.id}
          type="button"
          data-big-idea-id={entry.id}
          onClick={() => onOpen(entry.id)}
          className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-blue-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <span className="block truncate text-sm font-black text-slate-900">{t(entry.titleKey)}</span>
          <span className="mt-1 block text-xs leading-5 text-slate-600">{t(entry.summaryKey)}</span>
          <span className="mt-2 inline-flex rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-black text-white">{t('bigIdea.explore')}</span>
        </button>)}
      </div>
    </div>
  </section>;
}
