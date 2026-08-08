export default function VoteBarRenderer({ props, t, colorByLabel }) {
  const voting = props?.voting ?? { counts: {}, predictedLabel: null, tie: false };
  const counts = voting?.counts && typeof voting.counts === 'object' ? voting.counts : {};
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
    <p className="text-xs font-black uppercase tracking-wider text-slate-500">{t('playground.votes')}</p>
    <div className="mt-2 space-y-1">
      {Object.entries(counts).map(([label, count]) => {
        const total = Object.values(counts).reduce((sum, value) => sum + value, 0) || 1;
        const predicted = voting.predictedLabel === label;
        const color = colorByLabel?.[label] ?? '#94a3b8';
        return <div key={label} className="flex items-center gap-2 text-sm">
          <span className="w-16 truncate font-bold" style={{ color }}>{label}</span>
          <div className="h-4 flex-1 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full" style={{ width: `${(count / total) * 100}%`, background: color }} />
          </div>
          <span className="w-6 text-right font-mono font-bold text-slate-700">{count}</span>
          {predicted && <span className="text-xs font-black text-slate-900">←</span>}
        </div>;
      })}
      {voting.tie && <p className="mt-1 text-xs font-bold text-amber-700">{t('playground.voteTie')}</p>}
    </div>
  </div>;
}
