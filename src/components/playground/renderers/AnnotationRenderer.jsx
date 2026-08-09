const motionOpacityFor = (props) => (
  props.motionProgress === undefined || props.motionOpacity !== 1
    ? props.motionOpacity ?? 1
    : 0.72 + Math.abs(props.motionProgress - 0.5) * 0.56
);

export default function AnnotationRenderer({ props, t }) {
  const { observation } = props;
  if (!observation) return null;
  return <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3" style={{ opacity: motionOpacityFor(props) }}>
    <h3 className="text-xs font-black uppercase tracking-wider text-violet-700">{t('playground.observationTitle')}</h3>
    <p className="mt-2 text-sm font-bold text-slate-900">{t(observation.titleKey)}</p>
    <p className="mt-1 text-sm leading-6 text-slate-700">{t(observation.bodyKey, observation.params)}</p>
  </div>;
}
