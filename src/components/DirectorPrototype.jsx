import { useEffect, useReducer } from 'react';
import { createDirectorState, DIRECTOR_BEATS, DIRECTOR_HANDOFF, directorReducer } from '../core/director/directorPrototype.js';

const VISUAL_ITEMS = {
  references: ['director.reference.language', 'director.reference.vision', 'director.reference.agent'],
  flow: ['director.flow.world', 'director.flow.data', 'director.flow.model', 'director.flow.action'],
  factors: ['director.factor.world', 'director.factor.sample', 'director.factor.model', 'director.factor.learning'],
  experiment: ['director.experiment.baseline', 'director.experiment.duplicate', 'director.experiment.compare'],
  lumi: ['director.lumi.notice', 'director.lumi.ask', 'director.lumi.suggest', 'director.lumi.silent'],
  scale: ['director.scale.world', 'director.scale.model'],
  welcome: [],
};

export default function DirectorPrototype({ open, onClose, onStartExploration, t }) {
  const [state, dispatch] = useReducer(directorReducer, undefined, createDirectorState);
  const beat = DIRECTOR_BEATS[state.beatIndex];
  const debug = import.meta.env?.DEV === true && new URLSearchParams(window.location.search).get('directorDebug') === '1';

  useEffect(() => {
    if (!open || !state.playing) return undefined;
    const timer = window.setInterval(() => dispatch({ type: 'TICK', deltaMs: 100 }), 100);
    return () => window.clearInterval(timer);
  }, [open, state.playing]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
      if (event.key === 'ArrowRight') dispatch({ type: 'NEXT_BEAT' });
      if (event.key === 'ArrowLeft') dispatch({ type: 'PREVIOUS_BEAT' });
      if (event.key === ' ' && !isEditable(event.target)) { event.preventDefault(); dispatch({ type: state.playing ? 'PAUSE' : 'PLAY' }); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, state.playing]);

  if (!open) return null;
  const start = () => { onClose?.(); onStartExploration?.(DIRECTOR_HANDOFF.target, { seed: DIRECTOR_HANDOFF.seed, restart: true }); };
  const visual = VISUAL_ITEMS[beat.visualKind] ?? [];
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/70 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="director-title" data-director-prototype data-handoff-target={DIRECTOR_HANDOFF.target}>
    <section className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 p-4 sm:p-6">
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">{t('director.kicker')}</p><h1 id="director-title" className="mt-1 text-2xl font-black text-slate-950 sm:text-3xl">{t('director.title')}</h1><p className="mt-1 text-sm text-slate-600">{t('director.subtitle')}</p></div>
        <button type="button" aria-label={t('common.close')} onClick={onClose} className="rounded-xl bg-slate-100 px-3 py-2 font-bold">✕</button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3"><span className="text-xs font-black uppercase tracking-wide text-slate-500">{t('director.beatLabel', { current: state.beatIndex + 1, total: DIRECTOR_BEATS.length })}</span><span className="h-1.5 flex-1 rounded-full bg-slate-100"><span className="block h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${((state.beatIndex + 1) / DIRECTOR_BEATS.length) * 100}%` }} /></span></div>
        <article className="mt-5 rounded-3xl border border-indigo-100 bg-indigo-50/60 p-5 sm:p-8"><h2 className="text-xl font-black text-slate-950 sm:text-2xl">{t(beat.titleKey)}</h2><p className="mt-3 max-w-2xl text-sm leading-7 text-slate-700 sm:text-base">{t(beat.bodyKey)}</p>{beat.questionKey && <p className="mt-4 rounded-2xl bg-white p-4 text-base font-black text-indigo-800">{t(beat.questionKey)}</p>}{visual.length > 0 && <div className={`mt-6 grid gap-2 ${beat.visualKind === 'flow' ? 'sm:grid-cols-4' : 'sm:grid-cols-2'}`}>{visual.map((item, index) => <div key={item} className="rounded-2xl border border-white bg-white p-3 text-sm font-black text-slate-800 shadow-sm">{beat.visualKind === 'flow' ? <><span className="text-indigo-500">{index + 1}</span> {t(item)}</> : t(item)}</div>)}</div>}{beat.visualKind === 'welcome' && <div className="mt-6 rounded-2xl bg-white p-4 text-sm font-bold text-slate-700">{t('director.welcomeHint')}</div>}</article>
        <p className="mt-4 text-center text-xs text-slate-500">{t('director.presentationOnly')}</p>
        {debug && <aside className="mt-4 rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" data-director-debug><p className="font-black">{t('director.debug.title')}</p><p className="mt-1">{t('director.debug.state', { beat: state.beatIndex + 1, time: state.timeMs, target: DIRECTOR_HANDOFF.target })}</p><label className="mt-2 block font-bold">{t('director.debug.selectBeat')}<select value={state.beatIndex} onChange={(event) => dispatch({ type: 'SEEK_BEAT', beatIndex: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-2 py-1 font-bold">{DIRECTOR_BEATS.map((item, index) => <option key={item.id} value={index}>{index + 1}. {t(item.titleKey)}</option>)}</select></label><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => dispatch({ type: 'PREVIOUS_BEAT' })} className="rounded-lg bg-white px-2 py-1 font-bold">{t('director.debug.previous')}</button><button type="button" onClick={() => dispatch({ type: 'NEXT_BEAT' })} className="rounded-lg bg-white px-2 py-1 font-bold">{t('director.debug.next')}</button><button type="button" onClick={() => dispatch({ type: 'SEEK_BEAT', beatIndex: 0 })} className="rounded-lg bg-white px-2 py-1 font-bold">{t('director.debug.seek')}</button></div></aside>}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 p-4 sm:p-6"><div className="flex gap-2"><button type="button" onClick={() => dispatch({ type: 'PREVIOUS_BEAT' })} disabled={state.beatIndex === 0} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold disabled:opacity-40">{t('director.previous')}</button><button type="button" onClick={() => dispatch({ type: state.playing ? 'PAUSE' : 'PLAY' })} className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-black text-white">{t(state.playing ? 'director.pause' : 'director.play')}</button><button type="button" onClick={() => dispatch({ type: 'NEXT_BEAT' })} disabled={state.beatIndex === DIRECTOR_BEATS.length - 1} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold disabled:opacity-40">{t('director.next')}</button><button type="button" onClick={() => dispatch({ type: 'RESET' })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold">{t('director.restart')}</button></div><div className="flex gap-2"><button type="button" onClick={start} className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-black text-indigo-700">{t('director.skip')}</button><button type="button" onClick={start} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">{t('director.cta')}</button></div></footer>
    </section>
  </div>;
}

const isEditable = (target) => target?.matches?.('input, textarea, select, [contenteditable="true"]');
