import { useEffect, useState } from 'react';
import { resolveLumiCompanionState, LUMI_COMPANION_STATES, normalizeLumiSemanticTarget } from '../../core/ui/lumiCompanion.js';
import Lumi from './Lumi.jsx';

const continuationKeys = Object.freeze({
  'collect-more-data': 'playground.lumi.continuation.moreData',
  'repeat-many-times': 'playground.lumi.continuation.repeat',
  'noisier-world': 'playground.lumi.continuation.noisier',
});

export default function LumiCompanion({ snapshot, attention, onOpenGuidance, onOpenEvidence, onOpenIdeas, onOpenSettings, onSelectContinuation, isConfigured, configureLabel = null, askBusy = false, semanticAction = null, semanticTarget = null, recentConceptEvent = null, meaningfulResult = false, t }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);
  const runtime = snapshot?.inquiryRuntime;
  const hasConcept = runtime?.evidence?.status === 'evidenced'
    && (runtime?.candidateConcepts ?? []).includes('SAMPLING_VARIABILITY');
  const state = resolveLumiCompanionState({
    askBusy,
    semanticAction,
    semanticTarget: normalizeLumiSemanticTarget(semanticTarget ?? attention?.semanticTarget),
    recentConceptEvent: recentConceptEvent ?? (hasConcept ? { type: 'concept.evidenced', conceptId: 'SAMPLING_VARIABILITY' } : null),
    meaningfulResult,
    guidanceAvailable: Boolean(runtime?.stage && runtime.stage !== 'QUESTION') || Boolean(snapshot?.learnerInquiry?.candidates?.length),
  });
  const mode = state === LUMI_COMPANION_STATES.ILLUMINATE ? 'illuminate'
    : state === LUMI_COMPANION_STATES.OBSERVE || state === LUMI_COMPANION_STATES.NOTICE ? 'observe'
      : state === LUMI_COMPANION_STATES.GUIDE ? 'guide'
        : state === LUMI_COMPANION_STATES.THINK ? 'think' : 'idle';
  const question = runtime?.currentQuestion ? t(runtime.currentQuestion) : t('playground.lumi.companion.prompt');
  const continuations = (runtime?.continuations ?? []).slice(0, 3);
  const hasNotification = Boolean(hasConcept || meaningfulResult || attention?.evidenceTarget || continuations.length);
  return <aside data-lumi-companion="true" data-lumi-ambient="true" data-lumi-body-state={state} className={`lumi-companion relative fixed bottom-3 right-3 z-[70] w-[min(21rem,calc(100vw-1.5rem))] rounded-2xl border border-cyan-200 bg-white/95 p-3 shadow-xl backdrop-blur${open ? ' lumi-companion-open' : ''}`} aria-label={t('playground.lumi.companion.ariaLabel')}>
    <div className="flex items-start gap-2">
      <Lumi presence="ambient" mode={mode} onClick={() => setOpen((value) => !value)} expanded={open} label={open ? t('playground.lumi.companion.close') : t('playground.lumi.companion.open')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-black uppercase tracking-wide text-cyan-700">{t('playground.lumi.name')}</p><span data-lumi-companion-state="true" className="rounded-full bg-cyan-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-cyan-800">{state}</span></div>
        {hasNotification && <span data-lumi-notification="true" className="lumi-notification" aria-label={t('playground.lumi.companion.notification')} />}
        <p className="mt-1 text-xs font-bold leading-5 text-slate-800">{hasConcept ? t('playground.lumi.companion.conceptNotice') : question}</p>
        <span className="sr-only">{t('playground.agentGuide.entry')}</span>
      </div>
    </div>
    {open && <div data-lumi-companion-panel="true" role="dialog" aria-label={t('playground.lumi.companion.panelLabel')} className="mt-3 border-t border-cyan-100 pt-3">
    <div className="flex flex-wrap gap-1.5">
      <button type="button" onClick={onOpenGuidance} className="rounded-lg bg-cyan-700 px-2.5 py-1.5 text-[11px] font-black text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"><span className="sr-only">{t('playground.agentGuide.entry')}</span>{t('playground.lumi.companion.ask')}</button>
      {attention?.evidenceTarget && <button type="button" onClick={onOpenEvidence} className="rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 py-1.5 text-[11px] font-black text-cyan-900 focus:outline-none focus:ring-2 focus:ring-cyan-500">{t('playground.lumi.companion.evidence')}</button>}
      <button type="button" onClick={onOpenIdeas} className="rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1.5 text-[11px] font-black text-purple-900 focus:outline-none focus:ring-2 focus:ring-purple-500">{t('playground.lumi.companion.ideas')}</button>
      {onOpenSettings && <button type="button" onClick={onOpenSettings} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500">{isConfigured ? t('ai.settings') : (configureLabel ?? t('ai.configure'))}</button>}
    </div>
    {continuations.length > 0 && hasConcept && <div className="mt-2 border-t border-slate-100 pt-2"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{t('playground.lumi.companion.continuations')}</p><div className="mt-1 grid gap-1">{continuations.map((item) => <button key={item.id} type="button" onClick={() => { onSelectContinuation?.(item.id); onOpenGuidance?.(); }} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-[11px] font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500">{continuationKeys[item.id] ? t(continuationKeys[item.id]) : item.questionKey ? t(item.questionKey) : item.id}</button>)}</div></div>}
    </div>}
  </aside>;
}
