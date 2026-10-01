export default function ExploreShell({ contextBar, worldRegion, experimentRegion, detailsRegion, episode = false }) {
  return <div data-ui-region="explore-shell" className="min-w-0 space-y-5">
    {contextBar}
    <div data-explore-main-layout={episode ? 'episode' : 'free'} className={episode ? 'grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,.85fr)]' : 'space-y-5'}>
      {worldRegion}
      {experimentRegion}
      {detailsRegion}
    </div>
  </div>;
}
