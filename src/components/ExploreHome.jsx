import BigIdeaEntrancePanel from './BigIdeaEntrancePanel.jsx';
import { listPlaygrounds } from '../core/playgrounds/registry.js';

export default function ExploreHome({ onOpenBigIdea, onOpenPlayground, t }) {
  return <main data-explore-home className="min-h-0 flex-1 overflow-auto px-3 py-5 sm:px-5 sm:py-8">
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <section className="rounded-3xl border border-white/80 bg-white/85 p-5 shadow-xl backdrop-blur sm:p-8">
        <div className="max-w-2xl">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">VOLK-ML</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">{t('surface.exploreTitle')}</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">{t('surface.explorePrompt')}</p>
        </div>
        <div className="mt-6">
          <BigIdeaEntrancePanel variant="home" onOpen={onOpenBigIdea} t={t} />
        </div>
      </section>

      <section className="rounded-3xl border border-white/80 bg-white/70 p-4 shadow-lg backdrop-blur sm:flex sm:items-center sm:justify-between sm:gap-5 sm:p-5">
        <div>
          <h2 className="font-black text-slate-900">{t('surface.openAnotherLab')}</h2>
          <p className="mt-1 text-sm text-slate-600">{t('surface.openAnotherLabHint')}</p>
        </div>
        <label className="mt-3 block min-w-0 sm:mt-0 sm:w-72">
          <span className="sr-only">{t('nav.playground')}</span>
          <select aria-label={t('nav.playground')} defaultValue="" onChange={(event) => {
            const id = event.target.value;
            if (id) onOpenPlayground(id);
            event.target.value = '';
          }} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200">
            <option value="">{t('surface.chooseLab')}</option>
            {listPlaygrounds().map((playground) => <option key={playground.id} value={playground.id}>{t(playground.titleKey)}</option>)}
          </select>
        </label>
      </section>
    </div>
  </main>;
}
