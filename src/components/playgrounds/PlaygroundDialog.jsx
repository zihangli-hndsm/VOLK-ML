import { useEffect, useMemo, useState } from 'react';
import { getPlayground } from '../../core/playgrounds/registry.js';
import PlaygroundShell from './PlaygroundShell.jsx';

export default function PlaygroundDialog({ open, playgroundId, host, onClose, t }) {
  const [snapshot, setSnapshot] = useState(null);
  const playground = useMemo(() => (playgroundId ? getPlayground(playgroundId) : null), [playgroundId]);

  useEffect(() => {
    if (!open || !playgroundId || !host) return undefined;
    let active = true;
    let unsubscribe = () => {};
    setSnapshot(null);
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
    if (!snapshot || snapshot.status !== 'playing') return undefined;
    if (snapshot.timeline.totalSteps > 0 && snapshot.timeline.step >= snapshot.timeline.totalSteps) return undefined;
    const scenario = snapshot.scenario
      ? playground?.scenarios.find((item) => item.id === snapshot.scenario.id)
      : null;
    const base = scenario ? scenario.steps[snapshot.scenario.stepIndex]?.durationMs ?? 600 : 600;
    const reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const delay = reducedMotion ? 0 : base / Math.max(0.25, snapshot.timeline.speed);
    const timer = setTimeout(() => {
      if (snapshot.scenario) {
        host.dispatch({ type: 'SCENARIO_NEXT' });
      } else if (snapshot.playgroundId === 'linear-regression' && snapshot.scene.training.totalSteps === 0) {
        host.dispatch({ type: 'START_TRAINING' });
      } else {
        host.dispatch({ type: 'STEP' });
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [snapshot, host, playground]);

  if (!open || !snapshot || !playground || snapshot.playgroundId !== playgroundId) return null;
  return <div className="fixed inset-0 z-[75] grid place-items-center bg-slate-950/55 p-3 sm:p-5" onMouseDown={onClose}>
    <section className="max-h-[94vh] w-full max-w-6xl overflow-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
      <PlaygroundShell playground={playground} snapshot={snapshot} onDispatch={(action) => host.dispatch(action)} onClose={onClose} t={t} />
    </section>
  </div>;
}
