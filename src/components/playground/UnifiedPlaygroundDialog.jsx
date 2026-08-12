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

export default function UnifiedPlaygroundDialog({ open, playgroundId, host, agent, onClose, t }) {
  const [snapshot, setSnapshot] = useState(null);
  const [presentationMode, setPresentationMode] = useState(false);
  const playground = useMemo(() => (playgroundId ? getPlayground(playgroundId) : null), [playgroundId]);

  useEffect(() => {
    if (!open || !playgroundId || !host) return undefined;
    let active = true;
    let unsubscribe = () => {};
    setSnapshot(null);
    setPresentationMode(false);
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
      playground={playground}
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
        {agent && <PlaygroundAgentPanel host={host} agent={agent} snapshot={snapshot} t={t} />}
        <DataWorkspace snapshot={snapshot} onDispatch={(action) => host.dispatch(action)} t={t} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <PlaygroundStage snapshot={snapshot} t={t} />
          </div>
          <PlaygroundInspector playground={playground} snapshot={snapshot} onDispatch={(action) => host.dispatch(action)} t={t} />
        </div>
        <PlaygroundTimeline snapshot={snapshot} onDispatch={(action) => host.dispatch(action)} t={t} />
        <div className="rounded-2xl bg-slate-950 p-4 text-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('playground.formulaTitle')}</p>
          <div className="mt-2">
            {formulaPrimitive
              ? <FormulaRenderer props={formulaPrimitive.props} t={t} />
              : <p className="font-mono text-sm font-bold text-sky-300">—</p>}
          </div>
        </div>
      </div>
    </section>
  </div>;
}
