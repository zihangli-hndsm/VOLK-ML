import { useState } from 'react';
import BigIdeaEntrancePanel from './BigIdeaEntrancePanel.jsx';
import { listPlaygrounds } from '../core/playgrounds/registry.js';
import {
  INTRO_ENTRY_IDS,
  markIntroDismissed,
  readIntroPreference,
  rememberIntroEntry,
  writeIntroPreference,
} from '../core/ui/introExperience.js';

const EPISODE_ONE = 'episode-1-sampling-variability';
const FREE_EXPLORATION = 'free-exploration';

export default function ExploreHome({
  onOpenBigIdea,
  onOpenPlayground,
  onOpenDirector,
  onOpenImportedAttention,
  onOpenBuild,
  onResumeExplore,
  canResumeExplore = false,
  t,
}) {
  const [preference, setPreference] = useState(() => readIntroPreference());
  const [introExpanded, setIntroExpanded] = useState(() => !preference.dismissed);
  const [moreOpen, setMoreOpen] = useState(false);
  const debug = import.meta.env?.DEV === true && new URLSearchParams(window.location.search).get('directorDebug') === '1';

  const savePreference = (next) => {
    const stored = writeIntroPreference(next);
    setPreference(stored);
    return stored;
  };
  const startEpisode = ({ remember = true } = {}) => {
    const next = rememberIntroEntry(markIntroDismissed(preference), EPISODE_ONE);
    savePreference(remember ? next : preference);
    setIntroExpanded(false);
    onOpenBigIdea?.(EPISODE_ONE, { seed: 7101 });
  };
  const startFreeExploration = () => {
    savePreference(rememberIntroEntry(markIntroDismissed(preference), FREE_EXPLORATION));
    setIntroExpanded(false);
    onOpenPlayground?.('linear-regression');
  };
  const reopenLastEntry = () => {
    if (preference.lastEntryId === EPISODE_ONE) onOpenBigIdea?.(EPISODE_ONE, { seed: 7101 });
    if (preference.lastEntryId === FREE_EXPLORATION) onOpenPlayground?.('linear-regression');
  };
  const dismissIntro = () => {
    savePreference(markIntroDismissed(preference));
    setIntroExpanded(false);
  };
  const showIntro = () => {
    setIntroExpanded(true);
    savePreference({ ...preference, dismissed: false });
  };

  return <main data-explore-home data-intro-version="1" className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-5 sm:py-5">
    <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:gap-4">
      <section data-home-intro className="rounded-3xl border border-white/80 bg-white/90 p-4 shadow-xl backdrop-blur sm:p-6">
        {introExpanded ? <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,.72fr)] lg:items-end">
          <div className="max-w-2xl">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">VOLK-ML · {t('intro.kicker')}</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{t('intro.title')}</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">{t('intro.body')}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-1">
            <button type="button" data-intro-start-episode onClick={() => startEpisode()} className="min-h-12 rounded-2xl bg-indigo-600 px-4 py-3 text-left text-sm font-black text-white shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">{t('intro.startEpisode')}</button>
            <button type="button" data-intro-skip onClick={dismissIntro} className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500">{t('intro.skip')}</button>
          </div>
        </div> : <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 text-sm font-bold text-slate-700">{t('intro.collapsed')}</p>
          <button type="button" data-intro-reopen onClick={showIntro} className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">{t('intro.viewGuide')}</button>
        </div>}
      </section>

      <section data-work-entry className="grid gap-2 rounded-3xl border border-white/80 bg-white/75 p-3 shadow-lg backdrop-blur sm:grid-cols-3 sm:p-4" aria-label={t('intro.workEntry.label')}>
        <button type="button" data-work-entry-explore onClick={startFreeExploration} className="min-h-14 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-left focus:outline-none focus:ring-2 focus:ring-cyan-500">
          <span className="block text-xs font-black uppercase tracking-wide text-cyan-800">{t('intro.workEntry.exploreTitle')}</span>
          <span className="mt-1 block text-xs leading-5 text-slate-600">{t('intro.workEntry.exploreBody')}</span>
        </button>
        <button type="button" data-work-entry-build onClick={onOpenBuild} className="min-h-14 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <span className="block text-xs font-black uppercase tracking-wide text-slate-800">{t('intro.workEntry.buildTitle')}</span>
          <span className="mt-1 block text-xs leading-5 text-slate-600">{t('intro.workEntry.buildBody')}</span>
        </button>
        <button type="button" data-work-entry-import onClick={onOpenImportedAttention} className="min-h-14 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left focus:outline-none focus:ring-2 focus:ring-cyan-500">
          <span className="block text-xs font-black uppercase tracking-wide text-slate-800">{t('intro.workEntry.importTitle')}</span>
          <span className="mt-1 block text-xs leading-5 text-slate-600">{t('intro.workEntry.importBody')}</span>
        </button>
      </section>

      {(canResumeExplore || preference.lastEntryId && INTRO_ENTRY_IDS.includes(preference.lastEntryId)) && <section data-home-recent-entry className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white/70 px-4 py-3">
        <p className="text-xs font-bold text-slate-700">{canResumeExplore ? t('intro.continueAvailable') : t('intro.reopenAvailable')}</p>
        {canResumeExplore
          ? <button type="button" data-intro-resume-current onClick={onResumeExplore} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white">{t('intro.continueWork')}</button>
          : <button type="button" data-intro-reopen-entry onClick={reopenLastEntry} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-800">{t(preference.lastEntryId === FREE_EXPLORATION ? 'intro.reopenFree' : 'intro.reopenEpisode')}</button>}
      </section>}

      <details data-explore-secondary-entries open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)} className="rounded-3xl border border-white/80 bg-white/65 p-4 shadow-lg backdrop-blur">
        <summary className="cursor-pointer list-none rounded-xl px-1 py-1 text-sm font-black text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500">{t('intro.moreEntries')}</summary>
        <div className="mt-4 space-y-4">
          <button type="button" data-director-entry onClick={onOpenDirector} className="w-full rounded-2xl border border-indigo-200 bg-indigo-50 p-3 text-left focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <span className="block text-xs font-black uppercase tracking-wide text-indigo-700">{t('director.kicker')}</span>
            <span className="mt-1 block text-sm font-black text-slate-950">{t('director.entryTitle')}</span>
            <span className="mt-1 block text-xs leading-5 text-slate-600">{t('director.entryBody')}</span>
          </button>
          <BigIdeaEntrancePanel variant="home" onOpen={(id) => onOpenBigIdea?.(id, { seed: 7101 })} t={t} />
          <section className="rounded-2xl border border-slate-200 bg-white p-3">
            <h2 className="text-sm font-black text-slate-900">{t('surface.openAnotherLab')}</h2>
            <p className="mt-1 text-xs text-slate-600">{t('surface.openAnotherLabHint')}</p>
            <label className="mt-3 block min-w-0">
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
      </details>

      {debug && <section data-phase-a-debug className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-3"><p className="text-xs font-black uppercase tracking-wide text-amber-800">{t('phaseA.debug.title')}</p><p className="mt-1 text-xs text-amber-900">{t('phaseA.debug.body')}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={onOpenDirector} className="rounded-xl bg-white px-3 py-2 text-xs font-black">{t('phaseA.debug.launchDirector')}</button><button type="button" onClick={() => onOpenBigIdea?.(EPISODE_ONE, { seed: 7101, restart: true })} className="rounded-xl bg-white px-3 py-2 text-xs font-black">{t('phaseA.debug.openEpisode')}</button></div></section>}
    </div>
  </main>;
}
