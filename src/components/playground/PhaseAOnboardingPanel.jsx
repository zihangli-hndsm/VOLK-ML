export default function PhaseAOnboardingPanel({ snapshot, host, onDispatch, onOpenWorldTools, t }) {
  if (snapshot?.bigIdea?.phaseA !== 'onboarding') return null;
  const events = snapshot?.semanticEvents?.events ?? [];
  const hasLearnerAction = events.some((event) => event.actor === 'human' && ['world.changed', 'observation.sampled', 'experiment.duplicated', 'model.fit-completed', 'comparison.completed'].includes(event.type));
  const comparison = snapshot?.experimentWorkspace?.comparison;
  const sampleSameWorld = async () => {
    await onDispatch({ type: 'DUPLICATE_EXPERIMENT' });
    await onDispatch({ type: 'RESAMPLE_WORLD' });
  };
  const enterInquiry = async () => {
    await host.promotePhaseAInquiry?.({ id: snapshot.bigIdea.phaseATarget, seed: 7101 });
  };
  return <section data-phase-a-onboarding className="rounded-2xl border border-amber-100 bg-amber-50/70 p-3 text-sm text-slate-800">
    <p className="text-xs font-black uppercase tracking-wide text-amber-700">{t('phaseA.onboarding.kicker')}</p>
    <h2 className="mt-1 font-black">{t('phaseA.onboarding.title')}</h2>
    <p className="mt-1 text-xs leading-5 text-slate-600">{t('phaseA.onboarding.body')}</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <button type="button" onClick={() => onOpenWorldTools?.()} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-left text-xs font-bold">{t('phaseA.onboarding.changeWorld')}</button>
      <button type="button" onClick={sampleSameWorld} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-left text-xs font-bold">{t('phaseA.onboarding.resample')}</button>
      <button type="button" onClick={() => onDispatch({ type: 'RUN' })} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-left text-xs font-bold">{t('phaseA.onboarding.fit')}</button>
      <button type="button" disabled={!comparison?.againstExperimentId} onClick={() => onDispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: comparison.againstExperimentId })} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-left text-xs font-bold disabled:opacity-40">{t('phaseA.onboarding.compare')}</button>
    </div>
    <p className="mt-3 text-xs text-slate-500">{t('phaseA.onboarding.freeExploration')}</p>
    {hasLearnerAction && <div className="mt-3 rounded-xl border border-indigo-100 bg-white p-3"><p className="font-black text-indigo-700">{t('phaseA.trigger.title')}</p><p className="mt-1 text-xs text-slate-600">{t('phaseA.trigger.body')}</p><button type="button" onClick={enterInquiry} className="mt-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white">{t('phaseA.trigger.action')}</button></div>}
  </section>;
}

