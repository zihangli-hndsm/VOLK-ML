import BigIdeaEntrancePanel from './BigIdeaEntrancePanel.jsx';
import { listPlaygrounds } from '../core/playgrounds/registry.js';

export default function ExploreHome({ onOpenBigIdea, onOpenPlayground, onOpenDirector, onOpenOnboarding, onRestartOnboarding, t }) {
  const debug = import.meta.env?.DEV === true && new URLSearchParams(window.location.search).get('directorDebug') === '1';
  return <main data-explore-home className="min-h-0 flex-1 overflow-auto px-3 py-5 sm:px-5 sm:py-8">
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <section className="rounded-3xl border border-white/80 bg-white/85 p-5 shadow-xl backdrop-blur sm:p-8">
        <div className="max-w-2xl">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">VOLK-ML</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">{t('surface.exploreTitle')}</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">{t('surface.explorePrompt')}</p>
        </div>
        {debug && <section data-phase-a-debug className="mb-4 rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-3"><p className="text-xs font-black uppercase tracking-wide text-amber-800">{t('phaseA.debug.title')}</p><p className="mt-1 text-xs text-amber-900">{t('phaseA.debug.body')}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={onOpenDirector} className="rounded-xl bg-white px-3 py-2 text-xs font-black">{t('phaseA.debug.launchDirector')}</button><button type="button" onClick={() => onOpenOnboarding?.('episode-1-sampling-variability', { seed: 7101, restart: true })} className="rounded-xl bg-white px-3 py-2 text-xs font-black">{t('phaseA.debug.startOnboarding')}</button><button type="button" onClick={() => onRestartOnboarding?.('episode-1-sampling-variability', { seed: 7101, restart: true })} className="rounded-xl bg-white px-3 py-2 text-xs font-black">{t('phaseA.debug.restartOnboarding')}</button><button type="button" onClick={() => onOpenBigIdea?.('episode-1-sampling-variability', { seed: 7101, restart: true })} className="rounded-xl bg-white px-3 py-2 text-xs font-black">{t('phaseA.debug.openEpisode')}</button></div></section>}
        <div className="mt-6">
          <button type="button" data-director-entry onClick={onOpenDirector} className="mb-4 w-full rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-left shadow-sm transition hover:border-indigo-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <span className="block text-xs font-black uppercase tracking-[0.16em] text-indigo-600">{t('director.kicker')}</span>
            <span className="mt-1 block text-lg font-black text-slate-950">{t('director.entryTitle')}</span>
            <span className="mt-1 block text-sm leading-6 text-slate-600">{t('director.entryBody')}</span>
          </button>
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
