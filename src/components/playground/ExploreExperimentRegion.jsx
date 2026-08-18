export default function ExploreExperimentRegion({ children, t }) {
  return <section data-ui-region="experiment-region" data-ui-layer="play" aria-label={t('playground.explore.experimentRegionLabel')} className="min-w-0 overflow-hidden">{children}</section>;
}
