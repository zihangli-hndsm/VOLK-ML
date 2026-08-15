export default function ExploreShell({ contextBar, worldRegion, experimentRegion, detailsRegion }) {
  return <div data-ui-region="explore-shell" className="space-y-5">
    {contextBar}
    <div className="space-y-5">
      {worldRegion}
      {experimentRegion}
      {detailsRegion}
    </div>
  </div>;
}
