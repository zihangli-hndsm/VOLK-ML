import React, { useEffect, useState } from 'react';
import { tutorialFor } from '../core/tutorials.js';
import { visualKindForManifest } from '../core/visualLanguage.js';
import { playgroundsFor } from '../core/playgrounds/registry.js';
import VisualGlyph from './VisualGlyph.jsx';

export default function TutorialDialog({ manifest, dataset, onOpenPlayground, onClose, t }) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setPlaying(false);
  }, [manifest?.id]);
  if (!manifest) return null;
  const tutorial = tutorialFor(manifest);
  if (!tutorial) return null;
  const availablePlaygrounds = playgroundsFor({ manifest, dataset });
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/55 p-3 sm:p-5" onMouseDown={onClose}>
    <section className="max-h-[94vh] w-full max-w-4xl overflow-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-7" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-wider text-blue-600">{t('tutorial.title')}</p><h2 className="mt-1 text-2xl font-black text-slate-950">{t(manifest.name)}</h2><p className="mt-1 text-sm text-slate-500">{t(`category.${manifest.category}`)}</p></div>
        <button aria-label={t('common.close')} onClick={onClose} className="rounded-full bg-slate-100 px-3 py-2 font-bold hover:bg-slate-200">✕</button>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div>
          <button onClick={() => setPlaying((value) => !value)} className="w-full text-left">
            <div aria-label={t('tutorial.visual')} className="grid min-h-56 place-items-center overflow-hidden rounded-3xl bg-gradient-to-br from-sky-50 to-violet-100 p-5">
              <VisualGlyph kind={visualKindForManifest(manifest)} animated={playing} className="h-56 w-full" />
            </div>
            <span className="mt-2 block text-center text-xs font-bold text-blue-600">{playing ? t('tutorial.pauseAnimation') : t('tutorial.playAnimation')}</span>
          </button>
          <p className="mt-2 text-center text-xs text-slate-400">{t('tutorial.visualHint')}</p>
          <div className="mt-4 overflow-x-auto rounded-2xl bg-slate-950 p-4 text-center"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('tutorial.formula')}</p><p className="mt-2 whitespace-nowrap font-mono text-sm font-bold text-sky-300">{t(tutorial.formula)}</p></div>
        </div>
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 p-4"><h3 className="text-xs font-black uppercase tracking-wider text-blue-600">{t('tutorial.purpose')}</h3><p className="mt-2 text-sm leading-6 text-slate-700">{t(manifest.description)}</p></section>
          <section className="rounded-2xl border border-slate-200 p-4"><h3 className="text-xs font-black uppercase tracking-wider text-violet-600">{t('tutorial.intuition')}</h3><p className="mt-2 text-sm leading-6 text-slate-700">{t(tutorial.intuition)}</p></section>
          <section className="rounded-2xl border border-slate-200 p-4"><h3 className="text-xs font-black uppercase tracking-wider text-emerald-600">{t('tutorial.principle')}</h3><p className="mt-2 text-sm leading-6 text-slate-700">{t(tutorial.principle)}</p></section>
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><h3 className="text-xs font-black uppercase tracking-wider text-amber-700">{t('tutorial.example')}</h3><p className="mt-2 text-sm leading-6 text-amber-950">{t(tutorial.example)}</p></section>
        </div>
      </div>
      {availablePlaygrounds.length > 0 && <div className="mt-6 space-y-2">
        {availablePlaygrounds.map((playground) => <button
          key={playground.id}
          onClick={() => onOpenPlayground(playground.id)}
          className="w-full rounded-2xl bg-blue-600 px-4 py-3 font-bold text-white shadow-lg hover:bg-blue-700"
        >{t('playground.open')} · {t(playground.titleKey)}</button>)}
      </div>}
    </section>
  </div>;
}
