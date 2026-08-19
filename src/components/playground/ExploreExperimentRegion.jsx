import PlayQuickControl from './PlayQuickControl.jsx';
import InquiryConceptCard from './InquiryConceptCard.jsx';

export default function ExploreExperimentRegion({ children, playground, snapshot, inquiryCard, onDismissInquiryCard, onOpenInquiryEvidence, onDispatch, t }) {
  return <section data-ui-region="experiment-region" data-ui-layer="play" aria-label={t('playground.explore.experimentRegionLabel')} className="min-w-0 space-y-2 overflow-hidden">
    <PlayQuickControl playground={playground} snapshot={snapshot} onDispatch={onDispatch} t={t} />
    {children}
    <InquiryConceptCard card={inquiryCard} onDismiss={onDismissInquiryCard} onOpenEvidence={onOpenInquiryEvidence} t={t} />
  </section>;
}
