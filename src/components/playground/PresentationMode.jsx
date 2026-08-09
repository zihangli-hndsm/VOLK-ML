import { useEffect, useRef } from 'react';
import PlaygroundStage from './PlaygroundStage.jsx';
import AnnotationRenderer from './renderers/AnnotationRenderer.jsx';
import FormulaRenderer from './renderers/FormulaRenderer.jsx';
import { getPresentationPlaybackAction, hasScriptPlayback, isEditablePresentationTarget } from './presentationMode.js';

export default function PresentationMode({ playground, snapshot, onDispatch, onExit, t }) {
  const rootRef = useRef(null);
  const scripted = hasScriptPlayback(snapshot);
  const totalSteps = scripted ? snapshot.scriptState.totalSteps : snapshot.timeline.totalSteps;
  const step = scripted ? snapshot.scriptState.step : snapshot.timeline.step;
  const playing = scripted ? snapshot.scriptState.status === 'playing' : snapshot.status === 'playing';
  const annotationPrimitive = snapshot.primitives.find((primitive) => primitive.type === 'annotation');
  const formulaPrimitive = snapshot.primitives.find((primitive) => primitive.type === 'formula');
  const hasFormula = Boolean(formulaPrimitive && snapshot.script?.layout?.side?.includes(formulaPrimitive.id));

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const dispatchPlayback = (command) => {
    const action = getPresentationPlaybackAction(snapshot, command);
    if (action) onDispatch(action);
  };

  const handleKeyDown = (event) => {
    if (isEditablePresentationTarget(event.target)) return;
    if (event.key === ' ') {
      event.preventDefault();
      dispatchPlayback('play-pause');
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      dispatchPlayback('restart');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onExit();
    }
  };

  return <div
    ref={rootRef}
    tabIndex={-1}
    onKeyDown={handleKeyDown}
    className="fixed inset-0 z-[80] flex min-h-0 flex-col bg-slate-950 text-white outline-none"
    aria-label={t('playground.presentation.stageLabel')}
  >
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
      <div>
        <h1 className="text-sm font-black tracking-wide sm:text-base">{t(playground.titleKey)}</h1>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{t('playground.presentation.mode')}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="mr-1 font-mono text-xs font-bold text-slate-300">{step}{totalSteps ? ` / ${totalSteps}` : ''}</span>
        <button onClick={() => dispatchPlayback('restart')} className="rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/20">{t('playground.presentation.restart')}</button>
        <button onClick={() => dispatchPlayback('play-pause')} disabled={scripted && !snapshot.capabilities.canPlay && !playing} className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-40">
          {playing ? t('playground.timeline.pause') : t('playground.timeline.play')}
        </button>
        <button onClick={onExit} className="rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/20">{t('playground.presentation.exit')}</button>
      </div>
    </header>
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-auto px-3 py-4 sm:px-6 sm:py-6">
      <section className="aspect-video w-full max-w-[1280px] overflow-hidden rounded-2xl bg-white shadow-2xl" aria-label={t('playground.presentation.teachingStage')}>
        <PlaygroundStage snapshot={snapshot} t={t} />
      </section>
      {(annotationPrimitive || hasFormula) && <section className="grid w-full max-w-[1280px] gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-label={t('playground.presentation.teachingContent')}>
        {annotationPrimitive && <AnnotationRenderer props={annotationPrimitive.props} t={t} />}
        {hasFormula && <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('playground.formulaTitle')}</p>
          <div className="mt-2"><FormulaRenderer props={formulaPrimitive.props} t={t} /></div>
        </div>}
      </section>}
    </main>
    <footer className="shrink-0 px-4 pb-3 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 sm:px-6">{t('playground.presentation.keyboardHint')}</footer>
  </div>;
}
