import PlayQuickControl from './PlayQuickControl.jsx';
import InquiryConceptCard from './InquiryConceptCard.jsx';

export default function ExploreExperimentRegion({ children, episodePanel = null, onboardingPanel = null, experimentBar = null, playground, snapshot, inquiryCard, onDismissInquiryCard, onOpenInquiryEvidence, onAskAboutSelection, agent, onDispatch, onRequestLifecycle, t, intervention = null }) {
  const episodeActive = snapshot?.inquiryRuntime?.contractId === 'episode-1-sampling-variability';
  return <section data-ui-region="experiment-region" data-ui-layer="play" aria-label={t('playground.explore.experimentRegionLabel')} className="min-w-0 space-y-2 overflow-hidden">
    {!episodeActive && !snapshot?.inquiryRuntime && <PlayQuickControl playground={playground} snapshot={snapshot} onDispatch={onDispatch} t={t} intervention={intervention} />}
    {episodeActive ? <>
      {episodePanel}
      <details data-episode-advanced className="rounded-2xl border border-slate-200 bg-white/85 p-3">
        <summary className="cursor-pointer text-xs font-black text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">{t('episode.one.advancedTools')}</summary>
        <div className="mt-3 space-y-3">{experimentBar}</div>
      </details>
    </> : <>
      {onboardingPanel}
      {children}
      {experimentBar}
      <InquiryConceptCard card={inquiryCard} onDismiss={onDismissInquiryCard} onOpenEvidence={onOpenInquiryEvidence} agent={agent} onAskAbout={onAskAboutSelection} t={t} />
    </>}
  </section>;
}
