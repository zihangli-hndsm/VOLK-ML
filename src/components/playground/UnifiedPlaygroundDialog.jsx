import { useEffect, useMemo, useState } from 'react';
import { getPlayground } from '../../core/playgrounds/registry.js';
import PlaygroundToolbar from './PlaygroundToolbar.jsx';
import PlaygroundStage from './PlaygroundStage.jsx';
import PlaygroundInspector from './PlaygroundInspector.jsx';
import PlaygroundTimeline from './PlaygroundTimeline.jsx';
import PlaygroundAgentPanel from './PlaygroundAgentPanel.jsx';
import DataWorkspace from './DataWorkspace.jsx';
import FormulaRenderer from './renderers/FormulaRenderer.jsx';
import PresentationMode from './PresentationMode.jsx';

export default function UnifiedPlaygroundDialog({ open, playgroundId, host, agent, onClose, t, initialTab = 'model' }) {
  const [snapshot, setSnapshot] = useState(null);
  const [presentationMode, setPresentationMode] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);
  const playground = useMemo(() => (playgroundId ? getPlayground(playgroundId) : null), [playgroundId]);
  const modelPlayground = useMemo(
    () => getPlayground(snapshot?.modelPlaygroundId ?? snapshot?.playgroundId ?? playgroundId) ?? playground,
    [snapshot?.modelPlaygroundId, snapshot?.playgroundId, playgroundId, playground],
  );

  useEffect(() => {
    if (!open || !playgroundId || !host) return undefined;
    let active = true;
    let unsubscribe = () => {};
    setSnapshot(null);
    setPresentationMode(false);
    setActiveTab(initialTab);
    host.ensureOpen(playgroundId).then(() => {
      if (!active) return;
      try {
        setSnapshot(host.getState());
      } catch {
        setSnapshot(null);
      }
      unsubscribe = host.subscribe((next) => {
        if (active) setSnapshot(next);
      });
    }).catch(() => setSnapshot(null));
    return () => {
      active = false;
      unsubscribe();
      host.close().catch(() => {});
    };
  }, [open, playgroundId, host]);

  useEffect(() => {
    if (!snapshot) return undefined;
    const script = snapshot.scriptState;
    if (!script || script.status !== 'playing') return undefined;
    if (script.step >= script.totalSteps) return undefined;
    const stepDefinition = snapshot.script?.steps?.[script.step];
    const base = stepDefinition?.durationMs ?? 600;
    const reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const delay = reducedMotion ? 0 : base / Math.max(0.25, snapshot.timeline.speed);
    const timer = setTimeout(() => host.dispatch({ type: 'SCRIPT_STEP' }), delay);
    return () => clearTimeout(timer);
  }, [snapshot, host]);

  if (!open || !snapshot || !playground || snapshot.playgroundId !== playgroundId) return null;
  if (presentationMode) {
    return <PresentationMode
      playground={modelPlayground}
      snapshot={snapshot}
      onDispatch={(action) => host.dispatch(action)}
      onExit={() => setPresentationMode(false)}
      t={t}
    />;
  }
  const formulaPrimitive = snapshot.primitives.find((primitive) => primitive.type === 'formula');
  return <div className="fixed inset-0 z-[75] grid place-items-center bg-slate-950/55 p-3 sm:p-5" onMouseDown={onClose}>
    <section className="max-h-[94vh] w-full max-w-6xl overflow-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
      <div className="space-y-4">
        <PlaygroundToolbar playground={playground} snapshot={snapshot} onDispatch={(action) => host.dispatch(action)} onPresent={() => setPresentationMode(true)} onClose={onClose} t={t} />
        <div role="tablist" aria-label={t('playground.lab.tabs')} className="flex gap-2 border-b border-slate-200 pb-2">
          {['data', 'model'].map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} className={`rounded-xl px-4 py-2 text-sm font-black ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{t(`playground.lab.${tab}`)}</button>)}
        </div>
        {agent && snapshot.model && <PlaygroundAgentPanel host={host} agent={agent} snapshot={snapshot} t={t} />}
        {activeTab === 'data' ? <DataWorkspace snapshot={snapshot} onDispatch={(action) => host.dispatch(action)} t={t} /> : <>
        {!snapshot.model ? <ModelEmptyState snapshot={snapshot} onDispatch={(action) => host.dispatch(action)} t={t} /> : <>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <PlaygroundStage snapshot={snapshot} t={t} />
          </div>
          <PlaygroundInspector playground={modelPlayground} snapshot={snapshot} onDispatch={(action) => host.dispatch(action)} t={t} />
        </div>
        <PlaygroundTimeline snapshot={snapshot} onDispatch={(action) => host.dispatch(action)} t={t} />
        <div className="rounded-2xl bg-slate-950 p-4 text-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('playground.formulaTitle')}</p>
          <div className="mt-2">
            {formulaPrimitive
              ? <FormulaRenderer props={formulaPrimitive.props} t={t} />
              : <p className="font-mono text-sm font-bold text-sky-300">—</p>}
          </div>
        </div></>}</>}
      </div>
    </section>
  </div>;
}

function ModelEmptyState({ snapshot, onDispatch, t }) {
  return <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
    <h3 className="text-lg font-black text-slate-900">{t('playground.model.emptyTitle')}</h3>
    <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">{t('playground.model.emptyBody')}</p>
    {snapshot.availableModels?.length ? <div className="mx-auto mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
      {snapshot.availableModels.map((model) => <button key={model.id} type="button" onClick={() => onDispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: model.id })} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-400 hover:shadow">
        <span className="block font-black text-slate-900">{t(model.titleKey)}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{t(model.descriptionKey)}</span>
      </button>)}
    </div> : <p className="mt-5 text-sm font-bold text-amber-700">{t('playground.model.noCompatible')}</p>}
  </section>;
}
