export default function ExploreShell({ contextBar, worldRegion, experimentRegion, detailsRegion }) {
  return <div data-ui-region="explore-shell" className="min-w-0 space-y-5">
    {contextBar}
    <div className="space-y-5">
      {worldRegion}
      {experimentRegion}
      {detailsRegion}
    </div>
  </div>;
}
