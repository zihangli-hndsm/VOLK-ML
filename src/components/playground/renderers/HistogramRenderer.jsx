// Model-independent histogram: bins carry {start, end, count}. Renders as a
// small bar chart in the side panel and degrades to null without bins.
export default function HistogramRenderer({ props, t }) {
  const bins = props?.bins ?? [];
  if (!bins.length) return null;
  const width = 560;
  const height = 140;
  const maxCount = Math.max(...bins.map((bin) => bin.count));
  const span = Math.max(1, bins.length - 1);
  const xAt = (index) => (bins.length === 1 ? width / 2 : (index / span) * width);
  return <div className="rounded-xl border border-slate-200 bg-white p-3">
    <p className="text-xs font-black uppercase tracking-wider text-slate-500">{t('playground.histogramTitle')}</p>
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 block h-auto w-full">
      {bins.map((bin, index) => {
        const barWidth = Math.max(4, width / bins.length - 4);
        const barHeight = maxCount ? (bin.count / maxCount) * (height - 20) : 0;
        return <rect key={`bin-${index}`} x={xAt(index) - barWidth / 2} y={height - barHeight - 10}
          width={barWidth} height={barHeight} rx="3" fill="#6366f1" />;
      })}
    </svg>
  </div>;
}
