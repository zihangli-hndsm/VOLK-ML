export default function RankedResultsRenderer({ props = {} }) {
  return <ol data-primitive="ranked-results" className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-white p-3">
    {(props.items ?? []).map((item) => <li key={String(item.id)} className="flex min-w-0 items-center justify-between gap-3 text-sm">
      <span className="min-w-0 truncate text-slate-700">{item.rank}. {item.title}</span>
      {item.score !== undefined && <span className="shrink-0 font-mono text-xs text-slate-500">{Number(item.score).toFixed(3)}</span>}
    </li>)}
  </ol>;
}

