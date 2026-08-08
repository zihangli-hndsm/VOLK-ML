// Model-independent parameter trajectory: draws {step, value} points as a
// line plus dots in a fixed mini-plot inside the stage SVG. Degrades to null
// when there is nothing to draw.
export default function ParameterTrajectoryRenderer({ props, t }) {
  const points = props?.points ?? [];
  if (!points.length) return null;
  const left = 340;
  const right = 620;
  const top = 28;
  const bottom = 120;
  const width = right - left;
  const height = bottom - top;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-9, max - min);
  const xAt = (point) => left + ((point.step - points[0].step) / Math.max(1, points.at(-1).step - points[0].step)) * width;
  const yAt = (value) => bottom - ((value - min) / span) * (height - 12) - 6;
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${xAt(point).toFixed(1)} ${yAt(point.value).toFixed(1)}`).join(' ');
  return <g>
    <rect x={left} y={top} width={width} height={height} fill="#f8fafc" stroke="#cbd5e1" rx="6" />
    <text x={left + 8} y={top + 14} fontSize="10" fontWeight="800" fill="#475569">{t('playground.parameterTrajectoryTitle')}</text>
    <path d={path} fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    {points.map((point) => <circle key={`traj-${point.step}`} cx={xAt(point)} cy={yAt(point.value)} r="3" fill="#7c3aed" />)}
    <text x={left + 8} y={bottom + 12} fontSize="9" fill="#64748b">{t('playground.parameterTrajectoryX')}</text>
    <text x={left + 8} y={top + 24} fontSize="9" fill="#64748b">{t('playground.parameterTrajectoryY')}</text>
  </g>;
}
