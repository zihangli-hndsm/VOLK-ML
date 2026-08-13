import { useEffect, useMemo, useState } from 'react';
import { getPlayground } from '../../core/playgrounds/registry.js';
import PlaygroundToolbar from './PlaygroundToolbar.jsx';
import PlaygroundStage from './PlaygroundStage.jsx';
import PlaygroundInspector from './PlaygroundInspector.jsx';
import PlaygroundTimeline from './PlaygroundTimeline.jsx';
import PlaygroundAgentPanel from './PlaygroundAgentPanel.jsx';
import DataWorkspace from './DataWorkspace.jsx';
import WorldBuilder from './WorldBuilder.jsx';
import FormulaRenderer from './renderers/FormulaRenderer.jsx';
import PresentationMode from './PresentationMode.jsx';
import ExperimentBar from './ExperimentBar.jsx';
import ExplorationEvidence from './ExplorationEvidence.jsx';
import GuidedExplore from './GuidedExplore.jsx';
import ExplorationAgentPanel from './ExplorationAgentPanel.jsx';
import ExplorationThreadPanel from './ExplorationThreadPanel.jsx';
import { createPlaybackScheduler } from '../../core/playgroundHost.js';

export default function UnifiedPlaygroundDialog({ open, playgroundId, host, agent, onClose, t, initialTab = 'model' }) {
  const [snapshot, setSnapshot] = useState(null);
  const [presentationMode, setPresentationMode] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [playbackError, setPlaybackError] = useState(null);
  const [guidance, setGuidance] = useState(null);
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
    setPlaybackError(null);
    setGuidance(null);
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
    if (!snapshot || playbackError) return undefined;
    let active = true;
    const reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const scheduler = createPlaybackScheduler({
      dispatch: (action) => host.dispatch(action),
      onError: ({ action, error, snapshot: scheduledSnapshot }) => {
        if (!active) return;
        const stepDefinition = scheduledSnapshot.script?.steps?.[scheduledSnapshot.scriptState?.step];
        const operation = stepDefinition?.invoke?.operation || t('playground.playback.operationUnknown');
        const reason = error?.code || error?.message || String(error);
        setPlaybackError({
          action: action.type,
          operation,
          reason,
          step: stepDefinition?.id || String(scheduledSnapshot.scriptState?.step ?? t('playground.playback.stepUnknown')),
        });
        const pauseAction = action.type === 'SCRIPT_STEP' ? { type: 'SCRIPT_PAUSE' } : { type: 'PAUSE' };
        host.dispatch(pauseAction).catch(() => {});
      },
    });
    scheduler.schedule(snapshot, { reducedMotion });
    return () => {
      active = false;
      scheduler.cancel();
    };
  }, [snapshot, host, playbackError, t]);

  const dispatchAction = (action) => {
    if (['PLAY', 'SCRIPT_PLAY', 'STEP', 'SCRIPT_STEP', 'RESET', 'SCRIPT_RESET'].includes(action.type)) {
      setPlaybackError(null);
    }
    return host.dispatch(action);
  };

  if (!open || !snapshot || !playground || snapshot.playgroundId !== playgroundId) return null;
  if (presentationMode) {
    return <PresentationMode
      playground={modelPlayground}
      snapshot={snapshot}
      onDispatch={dispatchAction}
      onExit={() => setPresentationMode(false)}
      t={t}
    />;
  }
  const formulaPrimitive = snapshot.primitives.find((primitive) => primitive.type === 'formula');
  return <div className="fixed inset-0 z-[75] grid place-items-center bg-slate-950/55 p-3 sm:p-5" onMouseDown={onClose}>
    <section className="max-h-[94vh] w-full max-w-6xl overflow-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
      <div className="space-y-4">
        <PlaygroundToolbar playground={playground} snapshot={snapshot} onDispatch={dispatchAction} onPresent={() => setPresentationMode(true)} onClose={onClose} t={t} highlightedAffordances={guidance?.affordances ?? []} />
        <ExperimentBar snapshot={snapshot} onDispatch={dispatchAction} t={t} highlightedAffordances={guidance?.affordances ?? []} />
        <GuidedExplore snapshot={snapshot} onDispatch={dispatchAction} onGuidanceChange={setGuidance} t={t} />
        {agent && <ExplorationThreadPanel agent={agent} snapshot={snapshot} t={t} />}
        <ExplorationEvidence snapshot={snapshot} t={t} />
        <div role="tablist" aria-label={t('playground.lab.tabs')} className="flex gap-2 border-b border-slate-200 pb-2">
          {['data', 'model'].map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} className={`rounded-xl px-4 py-2 text-sm font-black ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{t(`playground.lab.${tab}`)}</button>)}
        </div>
        {playbackError && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-black">{t('playground.playback.errorTitle')}</p>
          <p className="mt-1">{t('playground.playback.errorBody', playbackError)}</p>
          <p className="mt-1 text-xs">{t('playground.playback.errorStatePreserved')}</p>
        </div>}
        {agent && snapshot.model && <ExplorationAgentPanel agent={agent} snapshot={snapshot} t={t} />}
        {agent && snapshot.model && <details className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-black uppercase tracking-wider text-slate-600">{t('playground.explorationAgent.advancedTeaching')}</summary><div className="mt-3"><PlaygroundAgentPanel host={host} agent={agent} snapshot={snapshot} t={t} /></div></details>}
        {activeTab === 'data' ? <div className="space-y-4"><WorldBuilder snapshot={snapshot} onDispatch={dispatchAction} t={t} highlightedAffordances={guidance?.affordances ?? []} /><DataWorkspace snapshot={snapshot} onDispatch={dispatchAction} t={t} highlightedAffordances={guidance?.affordances ?? []} /></div> : <>
        {!snapshot.model ? <ModelEmptyState snapshot={snapshot} onDispatch={dispatchAction} t={t} /> : <>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <PlaygroundStage snapshot={snapshot} t={t} />
          </div>
          <PlaygroundInspector playground={modelPlayground} snapshot={snapshot} onDispatch={dispatchAction} t={t} />
        </div>
        <PlaygroundTimeline snapshot={snapshot} onDispatch={dispatchAction} t={t} />
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
