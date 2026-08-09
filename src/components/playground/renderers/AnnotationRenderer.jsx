export default function AnnotationRenderer({ props, t }) {
  const { observation } = props;
  if (!observation) return null;
  return <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3" style={{ opacity: props.motionOpacity ?? 1 }}>
    <h3 className="text-xs font-black uppercase tracking-wider text-violet-700">{t('playground.observationTitle')}</h3>
    <p className="mt-2 text-sm font-bold text-slate-900">{t(observation.titleKey)}</p>
    <p className="mt-1 text-sm leading-6 text-slate-700">{t(observation.bodyKey, observation.params)}</p>
  </div>;
}
