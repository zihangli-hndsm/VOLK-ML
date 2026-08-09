export default function LossCurveRenderer({ props, motion, t }) {
  const { lossHistory, currentStep } = props;
  const values = lossHistory.slice(0, Math.max(1, Math.ceil(currentStep)));
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-9, max - min);
  const width = 560;
  const height = 140;
  const xAt = (index) => (values.length === 1 ? width / 2 : (index / (values.length - 1)) * width);
  const yAt = (value) => height - ((value - min) / span) * (height - 8) - 4;
  const path = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(1)} ${yAt(value).toFixed(1)}`).join(' ');
  return <div className="rounded-xl border border-slate-200 bg-white p-3">
    <p className="text-xs font-black uppercase tracking-wider text-slate-500">{t('playground.lossCurveTitle')}</p>
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 block h-auto w-full">
      <path d={path} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        pathLength="1" strokeDasharray="1" strokeDashoffset={motion?.isAnimating ? 1 - motion.progress : 0} opacity={props.motionOpacity ?? 1} />
      <circle cx={xAt(values.length - 1)} cy={yAt(values.at(-1))} r="4" fill="#2563eb" opacity={props.motionOpacity ?? 1} />
    </svg>
  </div>;
}
