import PlayQuickControl from './PlayQuickControl.jsx';
import InquiryConceptCard from './InquiryConceptCard.jsx';

export default function ExploreExperimentRegion({ children, playground, snapshot, inquiryCard, onDismissInquiryCard, onOpenInquiryEvidence, onAskAboutSelection, agent, onDispatch, t, intervention = null }) {
  return <section data-ui-region="experiment-region" data-ui-layer="play" aria-label={t('playground.explore.experimentRegionLabel')} className="min-w-0 space-y-2 overflow-hidden">
    {!snapshot?.inquiryRuntime && <PlayQuickControl playground={playground} snapshot={snapshot} onDispatch={onDispatch} t={t} intervention={intervention} />}
    {children}
    <InquiryConceptCard card={inquiryCard} onDismiss={onDismissInquiryCard} onOpenEvidence={onOpenInquiryEvidence} agent={agent} onAskAbout={onAskAboutSelection} t={t} />
  </section>;
}
