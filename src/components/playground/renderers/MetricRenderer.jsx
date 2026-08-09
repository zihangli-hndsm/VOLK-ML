const formatMetric = (value) => (
  typeof value === 'number' ? (Number.isInteger(value) ? String(value) : value.toFixed(4)) : String(value)
);

export default function MetricRenderer({ props, t }) {
  const { metrics = {} } = props ?? {};
  return <div className="rounded-2xl border border-slate-200 p-3" style={{ opacity: props.motionOpacity ?? 1 }}>
    <h3 className="text-xs font-black uppercase tracking-wider text-emerald-600">{t('playground.metricsTitle')}</h3>
    <dl className="mt-2 space-y-1">
      {Object.entries(metrics).map(([key, value]) => (
        <div key={key} className="flex items-center justify-between gap-2 text-sm">
          <dt className="text-slate-500">{t(`playground.metric.${key}`)}</dt>
          <dd className="font-mono font-bold text-slate-900">{formatMetric(value)}</dd>
        </div>
      ))}
    </dl>
  </div>;
}
